/**
 * Tests for the renderer's data-overlay opacity switch (drawZoneOverlay fill colour /
 * setTransparentOverlays). The monolith is too heavy to instantiate in jsdom, so this
 * private/public pair is exercised via prototype `.call()` with a crafted host — same
 * pattern as renderer-glass-buildings.test.ts in this directory.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { Rotation } from '../../shared/map-config';
import { ZoneType } from '../../shared/types/domain-types';

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
  cachedZoneSurfaces: Map<string, { x: number; y: number; data: { rows: number[][] } }>;
  transparentOverlays: boolean;
  requestRender: jest.Mock;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function makeCtx(): Ctx {
  const fillStyles: string[] = [];
  const ctx = {
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(() => { fillStyles.push(ctx.fillStyle); }),
    fillStyle: '',
  } as Ctx;
  (ctx as unknown as { fillStyles: string[] }).fillStyles = fillStyles;
  return ctx;
}

function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: 400 + j * 10, y: 300 + i * 10 };
}

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    ctx: makeCtx(),
    terrainRenderer: {
      getZoomLevel: () => 3,
      getRotation: () => Rotation.NORTH,
      mapToScreen: centeredMapToScreen,
    },
    canvas: { width: 800, height: 600 },
    zoneOverlayEnabled: true,
    overlayIsHeatmap: false,
    overlayIsTowns: false,
    cachedZoneSurfaces: new Map([
      ['0,0', { x: 0, y: 0, data: { rows: [[ZoneType.RESIDENTIAL]] } }],
    ]),
    transparentOverlays: true,
    requestRender: jest.fn(),
    ...overrides,
  };
}

const BOUNDS = { minI: 0, maxI: 20, minJ: 0, maxJ: 20 };

function drawZoneOverlay(host: Host): void {
  (proto.drawZoneOverlay as (this: Host, bounds: unknown) => void).call(host, BOUNDS);
}

function fillStyles(host: Host): string[] {
  return (host.ctx as unknown as { fillStyles: string[] }).fillStyles;
}

describe('drawZoneOverlay — transparent overlays switch', () => {
  it('leaves the translucent rgba fill untouched when the option is on', () => {
    const host = makeHost({ transparentOverlays: true });
    drawZoneOverlay(host);
    expect(fillStyles(host)).toEqual(['rgba(0,128,128,0.3)']);
  });

  it('strips the alpha to an rgb fill when the option is off', () => {
    const host = makeHost({ transparentOverlays: false });
    drawZoneOverlay(host);
    expect(fillStyles(host)).toEqual(['rgb(0, 128, 128)']);
  });

  it('also strips the baked alpha out of a heatmap colour when the option is off', () => {
    const host = makeHost({
      transparentOverlays: false,
      overlayIsHeatmap: true,
      cachedZoneSurfaces: new Map([
        ['0,0', { x: 0, y: 0, data: { rows: [[0.8]] } }],
      ]),
    });
    drawZoneOverlay(host);
    const styles = fillStyles(host);
    expect(styles).toHaveLength(1);
    expect(styles[0].startsWith('rgba')).toBe(false);
    expect(styles[0].startsWith('rgb(')).toBe(true);
  });
});

describe('setTransparentOverlays', () => {
  function call(host: Partial<Host>, method: string, ...args: unknown[]): void {
    (proto[method] as (this: unknown, ...a: unknown[]) => void).apply(host, args);
  }

  it('stores the flag and requests a render', () => {
    const host: { transparentOverlays?: boolean; requestRender: jest.Mock } = { requestRender: jest.fn() };
    call(host as unknown as Partial<Host>, 'setTransparentOverlays', false);
    expect(host.transparentOverlays).toBe(false);
    expect(host.requestRender).toHaveBeenCalledTimes(1);
  });
});
