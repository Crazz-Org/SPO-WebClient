/**
 * Tests for the renderer's losing-facility tint (drawBuildings reddening /
 * setSignalLosingFacilities / reddenTexture). Same prototype `.call()` harness as
 * renderer-glass-buildings.test.ts — the monolith is too heavy to instantiate in jsdom.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { Rotation } from '../../shared/map-config';
import type { MapBuilding } from '../../shared/types/domain-types';

type Ctx = {
  drawImage: jest.Mock;
  save: jest.Mock;
  restore: jest.Mock;
  translate: jest.Mock;
  scale: jest.Mock;
  fillRect: jest.Mock;
  fillStyle: string;
  globalAlpha: number;
};

type Host = {
  ctx: Ctx;
  terrainRenderer: {
    getZoomLevel: () => number;
    getRotation: () => Rotation;
    mapToScreen: (i: number, j: number) => { x: number; y: number };
  };
  canvas: { width: number; height: number };
  allBuildings: MapBuilding[];
  facilityDimensionsCache: Map<string, { xsize: number; ysize: number }>;
  hoveredBuilding: MapBuilding | null;
  selectedBuilding: MapBuilding | null;
  buildingEffects: Map<string, unknown>;
  hasAnimatedBuildings: boolean;
  isOnWaterPlatform: () => boolean;
  gameObjectTextureCache: {
    getTextureSync: () => unknown;
    getAnimatedTexture: () => null;
  };
  glassForeignBuildings: boolean;
  ownTycoonId: number;
  signalLosingFacilities: boolean;
  hiddenFacIds: ReadonlySet<number>;
  reddenTexture: jest.Mock;
  losingScratch: unknown;
  requestRender: jest.Mock;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

const TEX = { width: 64, height: 64 };
const REDDENED = { reddened: true };

function makeCtx(sourceLog: unknown[]): Ctx {
  const ctx: Ctx = {
    drawImage: jest.fn((source: unknown) => {
      sourceLog.push(source);
    }),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    fillRect: jest.fn(),
    fillStyle: '',
    globalAlpha: 1,
  };
  return ctx;
}

function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: 400 + j * 10, y: 300 + i * 10 };
}

function makeBuilding(tycoonId: number, x: number, y: number, alert: boolean): MapBuilding {
  return { visualClass: 'house', tycoonId, options: 0, x, y, level: 0, alert, attack: 0 };
}

function makeHost(sourceLog: unknown[], overrides: Partial<Host> = {}): Host {
  return {
    ctx: makeCtx(sourceLog),
    terrainRenderer: {
      getZoomLevel: () => 3,
      getRotation: () => Rotation.NORTH,
      mapToScreen: centeredMapToScreen,
    },
    canvas: { width: 800, height: 600 },
    allBuildings: [],
    facilityDimensionsCache: new Map(),
    hoveredBuilding: null,
    selectedBuilding: null,
    buildingEffects: new Map(),
    hasAnimatedBuildings: false,
    isOnWaterPlatform: () => false,
    gameObjectTextureCache: {
      getTextureSync: () => TEX,
      getAnimatedTexture: () => null,
    },
    glassForeignBuildings: false,
    ownTycoonId: 0,
    signalLosingFacilities: false,
    hiddenFacIds: new Set(),
    reddenTexture: jest.fn(() => REDDENED),
    losingScratch: null,
    requestRender: jest.fn(),
    ...overrides,
  };
}

const BOUNDS = { minI: 0, maxI: 20, minJ: 0, maxJ: 20 };

function drawBuildings(host: Host): void {
  (proto.drawBuildings as (this: Host, bounds: unknown) => void).call(host, BOUNDS);
}

describe('drawBuildings — losing-facility reddening', () => {
  it('tints exactly the alert-and-own building, leaves the foreign alert building untouched', () => {
    const sourceLog: unknown[] = [];
    const host = makeHost(sourceLog, {
      allBuildings: [
        makeBuilding(7, 1, 1, true), // own, alert -> reddened
        makeBuilding(7, 2, 2, false), // own, not alert -> plain
        makeBuilding(9, 3, 3, true), // foreign, alert -> plain
      ],
      signalLosingFacilities: true,
      ownTycoonId: 7,
    });
    drawBuildings(host);
    expect(sourceLog).toEqual([REDDENED, TEX, TEX]);
    expect(host.reddenTexture).toHaveBeenCalledTimes(1);
    expect(host.reddenTexture).toHaveBeenCalledWith(TEX);
  });

  it('reddens nothing when the option is off', () => {
    const sourceLog: unknown[] = [];
    const host = makeHost(sourceLog, {
      allBuildings: [
        makeBuilding(7, 1, 1, true),
        makeBuilding(7, 2, 2, false),
        makeBuilding(9, 3, 3, true),
      ],
      signalLosingFacilities: false,
      ownTycoonId: 7,
    });
    drawBuildings(host);
    expect(host.reddenTexture).not.toHaveBeenCalled();
    expect(sourceLog).toEqual([TEX, TEX, TEX]);
  });

  it('reddens nothing when no tycoon id is known yet', () => {
    const sourceLog: unknown[] = [];
    const host = makeHost(sourceLog, {
      allBuildings: [makeBuilding(7, 1, 1, true)],
      signalLosingFacilities: true,
      ownTycoonId: 0,
    });
    drawBuildings(host);
    expect(host.reddenTexture).not.toHaveBeenCalled();
    expect(sourceLog).toEqual([TEX]);
  });

  it('glassing and reddening are independent: a foreign alert building glasses but is not reddened', () => {
    const sourceLog: unknown[] = [];
    const host = makeHost(sourceLog, {
      allBuildings: [makeBuilding(9, 1, 1, true)],
      glassForeignBuildings: true,
      signalLosingFacilities: true,
      ownTycoonId: 7,
    });
    drawBuildings(host);
    expect(host.reddenTexture).not.toHaveBeenCalled();
    expect(sourceLog).toEqual([TEX]);
    expect(host.ctx.globalAlpha).toBe(1); // reset after drawing
  });
});

describe('setSignalLosingFacilities', () => {
  it('stores the flag and requests a render', () => {
    const host: { signalLosingFacilities?: boolean; requestRender: jest.Mock } = { requestRender: jest.fn() };
    (proto.setSignalLosingFacilities as (this: unknown, enabled: boolean) => void).call(host, true);
    expect(host.signalLosingFacilities).toBe(true);
    expect(host.requestRender).toHaveBeenCalled();
  });
});

describe('reddenTexture', () => {
  type FakeCtx = {
    ops: Array<{ op: string; composite: string; fillStyle?: string }>;
    globalCompositeOperation: string;
    fillStyle: string;
    clearRect: jest.Mock;
    drawImage: jest.Mock;
    fillRect: jest.Mock;
  };

  function makeFakeSctx(): FakeCtx {
    const ops: FakeCtx['ops'] = [];
    const sctx: FakeCtx = {
      ops,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      clearRect: jest.fn(() => ops.push({ op: 'clearRect', composite: sctx.globalCompositeOperation })),
      drawImage: jest.fn(() => ops.push({ op: 'drawImage', composite: sctx.globalCompositeOperation })),
      fillRect: jest.fn(() =>
        ops.push({ op: 'fillRect', composite: sctx.globalCompositeOperation, fillStyle: sctx.fillStyle }),
      ),
    };
    return sctx;
  }

  function makeFakeCanvas(sctx: FakeCtx | null, width = 0, height = 0) {
    return {
      width,
      height,
      getContext: jest.fn(() => sctx),
    };
  }

  it('composes the tint under source-atop and returns the scratch canvas', () => {
    const sctx = makeFakeSctx();
    const fakeCanvas = makeFakeCanvas(sctx);
    const host = { losingScratch: fakeCanvas };
    const texture = { width: 32, height: 48 } as unknown as ImageBitmap;

    const result = (proto.reddenTexture as (this: unknown, t: ImageBitmap) => unknown).call(host, texture);

    expect(fakeCanvas.width).toBe(32);
    expect(fakeCanvas.height).toBe(48);
    expect(sctx.ops).toEqual([
      { op: 'clearRect', composite: 'source-over' },
      { op: 'drawImage', composite: 'source-over' },
      { op: 'fillRect', composite: 'source-atop', fillStyle: 'rgba(255, 0, 0, 0.45)' },
    ]);
    expect(sctx.globalCompositeOperation).toBe('source-over');
    expect(result).toBe(fakeCanvas);
  });

  it('returns the texture unchanged when no 2D context can be had', () => {
    const fakeCanvas = makeFakeCanvas(null);
    const host = { losingScratch: fakeCanvas };
    const texture = { width: 10, height: 10 } as unknown as ImageBitmap;

    const result = (proto.reddenTexture as (this: unknown, t: ImageBitmap) => unknown).call(host, texture);

    expect(result).toBe(texture);
  });

  it('lazily creates the scratch canvas on first use', () => {
    const sctx = makeFakeSctx();
    const fakeCanvas = makeFakeCanvas(sctx);
    const createElement = jest.fn((_tag: string) => fakeCanvas);
    const originalDocument = (globalThis as { document?: unknown }).document;
    Object.assign(globalThis, { document: { createElement } });
    try {
      const host: { losingScratch: unknown } = { losingScratch: null };
      const texture = { width: 16, height: 16 } as unknown as ImageBitmap;

      const result = (proto.reddenTexture as (this: typeof host, t: ImageBitmap) => unknown).call(host, texture);

      expect(createElement).toHaveBeenCalledWith('canvas');
      expect(host.losingScratch).toBe(fakeCanvas);
      expect(result).toBe(fakeCanvas);
    } finally {
      Object.assign(globalThis, { document: originalDocument });
    }
  });
});
