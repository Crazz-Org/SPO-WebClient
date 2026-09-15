/**
 * Tests for the opaque-overlay option: the `opaqueOverlayColor` pure helper, and the
 * `drawZoneOverlay` / `setTransparentOverlays` wiring. The monolith is too heavy to instantiate
 * in jsdom, so the private method is exercised via prototype `.call()` with a crafted host —
 * same pattern as renderer-glass-buildings.test.ts in this directory.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer, opaqueOverlayColor } from './isometric-map-renderer';
import { Rotation } from '../../shared/map-config';
import type { SurfaceData } from '../../shared/types/domain-types';

describe('opaqueOverlayColor', () => {
  it('strips the alpha from an rgba string with no spaces', () => {
    expect(opaqueOverlayColor('rgba(0,128,128,0.3)')).toBe('rgb(0, 128, 128)');
  });

  it('strips the alpha from an rgba string with spaces after the commas', () => {
    expect(opaqueOverlayColor('rgba(255, 99, 71, 0.35)')).toBe('rgb(255, 99, 71)');
  });

  it('returns a non-rgba color untouched', () => {
    expect(opaqueOverlayColor('transparent')).toBe('transparent');
    expect(opaqueOverlayColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
  });
});

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
    getRotation: () => Rotation;
    mapToScreen: (i: number, j: number) => { x: number; y: number };
  };
  canvas: { width: number; height: number };
  zoneOverlayEnabled: boolean;
  overlayIsHeatmap: boolean;
  overlayIsTowns: boolean;
  cachedZoneSurfaces: Map<string, { x: number; y: number; data: SurfaceData; lastLoadTime: number }>;
  transparentOverlays: boolean;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function makeCtx(): Ctx {
  const fills: string[] = [];
  const ctx: Ctx = {
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(() => { fills.push(ctx.fillStyle); }),
    fillStyle: '',
  };
  (ctx as unknown as { fills: string[] }).fills = fills;
  return ctx;
}

function fills(ctx: Ctx): string[] {
  return (ctx as unknown as { fills: string[] }).fills;
}

function makeHost(overrides: Partial<Host> = {}): Host {
  const data: SurfaceData = {
    width: 2,
    height: 1,
    rows: [[2, 2]], // ZoneType.RESIDENTIAL — rgba(0,128,128,0.3), per domain-types.ts:464
  };
  return {
    ctx: makeCtx(),
    terrainRenderer: {
      getZoomLevel: () => 3,
      getRotation: () => Rotation.NORTH,
      mapToScreen: (i, j) => ({ x: 400 + j * 10, y: 300 + i * 10 }),
    },
    canvas: { width: 800, height: 600 },
    zoneOverlayEnabled: true,
    overlayIsHeatmap: false,
    overlayIsTowns: false,
    cachedZoneSurfaces: new Map([['0,0', { x: 0, y: 0, data, lastLoadTime: 0 }]]),
    transparentOverlays: true,
    ...overrides,
  };
}

const BOUNDS = { minI: 0, maxI: 20, minJ: 0, maxJ: 20 };

function drawZoneOverlay(host: Host): void {
  (proto.drawZoneOverlay as (this: Host, bounds: unknown) => void).call(host, BOUNDS);
}

describe('drawZoneOverlay — transparentOverlays gate', () => {
  it('fills every tile with the translucent rgba color when the option is on', () => {
    const host = makeHost({ transparentOverlays: true });
    drawZoneOverlay(host);

    const logged = fills(host.ctx);
    expect(logged.length).toBeGreaterThan(0);
    for (const f of logged) expect(f.startsWith('rgba(')).toBe(true);
  });

  it('fills every tile with the opaque rgb color when the option is off', () => {
    const host = makeHost({ transparentOverlays: false });
    drawZoneOverlay(host);

    const logged = fills(host.ctx);
    expect(logged.length).toBeGreaterThan(0);
    for (const f of logged) expect(f.startsWith('rgb(')).toBe(true);
  });
});

describe('setTransparentOverlays', () => {
  it('stores the flag and requests a render', () => {
    const host: { transparentOverlays?: boolean; requestRender: jest.Mock } = { requestRender: jest.fn() };
    (proto.setTransparentOverlays as (this: unknown, enabled: boolean) => void).call(host, false);
    expect(host.transparentOverlays).toBe(false);
    expect(host.requestRender).toHaveBeenCalled();
  });
});
