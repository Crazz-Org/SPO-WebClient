/**
 * Tests for the renderer's aircraft wiring (drawAircraft / setAircraftAnimationsEnabled /
 * the widened startAnimationLoop condition). The monolith is too heavy to instantiate in
 * jsdom, so these private/public methods are exercised via prototype `.call()` with a
 * crafted host — the same pattern renderer-e2e-probe.test.ts uses in this directory.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { AircraftAnimationSystem } from './aircraft-animation-system';

type Host = {
  terrainRenderer: { getZoomLevel: () => number; mapToScreen: (i: number, j: number) => { x: number; y: number } };
  canvas: { width: number; height: number };
  ctx: CanvasRenderingContext2D;
  aircraftSystem: AircraftAnimationSystem;
  requestRender: jest.Mock;
  startAnimationLoop: jest.Mock;
  animationLoopRunning: boolean;
  lastRenderTime: number;
  lastVehicleFrameTime: number;
  vehicleSystemReady: boolean;
  vehicleSystem: unknown;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function makeCtx(): CanvasRenderingContext2D {
  return {
    save: jest.fn(), restore: jest.fn(), translate: jest.fn(), rotate: jest.fn(),
    beginPath: jest.fn(), ellipse: jest.fn(), arc: jest.fn(), rect: jest.fn(), fillRect: jest.fn(),
    moveTo: jest.fn(), lineTo: jest.fn(), fill: jest.fn(), stroke: jest.fn(),
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: 400 + j * 10, y: 300 + i * 10 };
}

function makeHost(zoomLevel: number): Host {
  return {
    terrainRenderer: { getZoomLevel: () => zoomLevel, mapToScreen: centeredMapToScreen },
    canvas: { width: 800, height: 600 },
    ctx: makeCtx(),
    aircraftSystem: new AircraftAnimationSystem(),
    requestRender: jest.fn(),
    startAnimationLoop: jest.fn(),
    animationLoopRunning: false,
    lastRenderTime: 0,
    lastVehicleFrameTime: 0,
    vehicleSystemReady: false,
    vehicleSystem: null,
  };
}

function drawAircraft(host: Host, bounds: { minI: number; maxI: number; minJ: number; maxJ: number }, deltaTime: number): void {
  (proto.drawAircraft as (this: Host, bounds: unknown, deltaTime: number) => void).call(host, bounds, deltaTime);
}

function setAircraftAnimationsEnabled(host: Host, enabled: boolean): void {
  (proto.setAircraftAnimationsEnabled as (this: Host, enabled: boolean) => void).call(host, enabled);
}

function startAnimationLoop(host: Host): void {
  (proto.startAnimationLoop as (this: Host) => void).call(host);
}

const BOUNDS = { minI: 0, maxI: 20, minJ: 0, maxJ: 20 };

describe('drawAircraft', () => {
  beforeEach(() => {
    (global as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame = undefined;
  });

  it('leaves the aircraft count at 0 and does not start the loop below Z2', () => {
    const host = makeHost(1);
    host.aircraftSystem.setRandomSource(() => 0.01);
    drawAircraft(host, BOUNDS, 0.016);
    expect(host.aircraftSystem.getAircraftCount()).toBe(0);
    expect(host.startAnimationLoop).not.toHaveBeenCalled();
  });

  it('spawns and starts the loop at Z2', () => {
    const host = makeHost(2);
    host.aircraftSystem.setRandomSource(() => 0.01);
    drawAircraft(host, BOUNDS, 0.016);
    expect(host.aircraftSystem.getAircraftCount()).toBe(1);
    expect(host.startAnimationLoop).toHaveBeenCalled();
  });

  it('touches no ctx method when the system is disabled, even at Z2', () => {
    const host = makeHost(2);
    host.aircraftSystem.setEnabled(false);
    host.aircraftSystem.setRandomSource(() => 0.01);
    drawAircraft(host, BOUNDS, 0.016);
    expect(host.aircraftSystem.getAircraftCount()).toBe(0);
    expect((host.ctx.fill as jest.Mock)).not.toHaveBeenCalled();
    expect((host.ctx.beginPath as jest.Mock)).not.toHaveBeenCalled();
  });
});

describe('setAircraftAnimationsEnabled', () => {
  it('empties the system and calls requestRender', () => {
    const host = makeHost(2);
    host.aircraftSystem.setRandomSource(() => 0.01);
    drawAircraft(host, BOUNDS, 0.016);
    expect(host.aircraftSystem.getAircraftCount()).toBe(1);

    setAircraftAnimationsEnabled(host, false);
    expect(host.aircraftSystem.getAircraftCount()).toBe(0);
    expect(host.requestRender).toHaveBeenCalled();
  });
});

describe('startAnimationLoop — widened condition', () => {
  it('keeps ticking (calling requestRender) when only the aircraft system is active, vehicles not ready', () => {
    let capturedCallback: (() => void) | null = null;
    (global as unknown as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame =
      (cb: () => void) => { capturedCallback = cb; return 1; };

    const host = makeHost(2);
    host.vehicleSystemReady = false;
    host.vehicleSystem = null;
    host.aircraftSystem.setRandomSource(() => 0.01);
    // Populate the aircraft system so isActive() is true.
    host.aircraftSystem.update(0.016, BOUNDS);
    expect(host.aircraftSystem.isActive()).toBe(true);

    startAnimationLoop(host);
    expect(capturedCallback).not.toBeNull();

    host.lastVehicleFrameTime = 0;
    (capturedCallback as unknown as () => void)();

    expect(host.requestRender).toHaveBeenCalled();
  });
});
