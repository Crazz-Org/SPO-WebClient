/**
 * Tests for the renderer's transparent-overlays switch (drawZoneOverlay / setTransparentOverlays).
 * The monolith is too heavy to instantiate in jsdom, so drawZoneOverlay is exercised via
 * prototype `.call()` with a crafted host — same pattern as renderer-glass-buildings.test.ts.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import type { SurfaceData } from '../../shared/types/domain-types';

type Ctx = {
  beginPath: jest.Mock;
  moveTo: jest.Mock;
  lineTo: jest.Mock;
  closePath: jest.Mock;
  fill: jest.Mock;
  fillStyle: string;
};

type Host = {
  ctx: Ctx;
  terrainRenderer: {
    getZoomLevel: () => number;
    mapToScreen: (i: number, j: number) => { x: number; y: number };
  };
  canvas: { width: number; height: number };
  zoneOverlayEnabled: boolean;
  overlayIsHeatmap: boolean;
  overlayIsTowns: boolean;
  cachedZoneSurfaces: Map<string, { x: number; y: number; data: SurfaceData; lastLoadTime: number }>;
  transparentOverlays: boolean;
  requestRender: jest.Mock;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function makeCtx(): Ctx {
  const fillStyleLog: string[] = [];
  const ctx: Ctx = {
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(() => { fillStyleLog.push(ctx.fillStyle); }),
    fillStyle: '',
  };
  (ctx as unknown as { fillStyleLog: string[] }).fillStyleLog = fillStyleLog;
  return ctx;
}

function fillStyleLog(host: Host): string[] {
  return (host.ctx as unknown as { fillStyleLog: string[] }).fillStyleLog;
}

function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: 400 + j * 10, y: 300 + i * 10 };
}

function zoneSurfaceData(value: number): SurfaceData {
  return { width: 65, height: 65, rows: [[value]] };
}

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    ctx: makeCtx(),
    terrainRenderer: {
      getZoomLevel: () => 3,
      mapToScreen: centeredMapToScreen,
    },
    canvas: { width: 800, height: 600 },
    zoneOverlayEnabled: true,
    overlayIsHeatmap: false,
    overlayIsTowns: false,
    cachedZoneSurfaces: new Map([['0,0', { x: 0, y: 0, data: zoneSurfaceData(2), lastLoadTime: Date.now() }]]),
    transparentOverlays: true,
    requestRender: jest.fn(),
    ...overrides,
  };
}

const BOUNDS = { minI: 0, maxI: 20, minJ: 0, maxJ: 20 };

function drawZoneOverlay(host: Host): void {
  (proto.drawZoneOverlay as (this: Host, bounds: unknown) => void).call(host, BOUNDS);
}

describe('drawZoneOverlay — transparent overlays switch', () => {
  it('paints the zone overlay translucent by default', () => {
    const host = makeHost({ transparentOverlays: true });
    drawZoneOverlay(host);
    expect(fillStyleLog(host)).toEqual(['rgba(0,128,128,0.3)']);
  });

  it('paints the zone overlay opaque when the option is off', () => {
    const host = makeHost({ transparentOverlays: false });
    drawZoneOverlay(host);
    expect(fillStyleLog(host)).toEqual(['rgb(0,128,128)']);
  });

  it('paints the heatmap overlay opaque when the option is off', () => {
    const host = makeHost({
      transparentOverlays: false,
      overlayIsHeatmap: true,
      cachedZoneSurfaces: new Map([['0,0', { x: 0, y: 0, data: zoneSurfaceData(1), lastLoadTime: Date.now() }]]),
    });
    drawZoneOverlay(host);
    expect(fillStyleLog(host)).toEqual(['rgb(255,0,0)']);
  });
});

describe('setTransparentOverlays', () => {
  it('stores the flag and requests a render — the no-reload resume', () => {
    const host: { transparentOverlays?: boolean; requestRender: jest.Mock } = { requestRender: jest.fn() };
    (proto.setTransparentOverlays as (this: unknown, enabled: boolean) => void).call(host, false);
    expect(host.transparentOverlays).toBe(false);
    expect(host.requestRender).toHaveBeenCalled();
  });
});
