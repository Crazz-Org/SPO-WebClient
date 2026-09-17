/**
 * Tests for the renderer's building-glassing (drawBuildings alpha / setGlassForeignBuildings /
 * setOwnTycoonId). The monolith is too heavy to instantiate in jsdom, so these private/public
 * methods are exercised via prototype `.call()` with a crafted host — same pattern as
 * renderer-aircraft.test.ts in this directory.
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
    getTextureSync: () => { width: number; height: number };
    getAnimatedTexture: () => null;
  };
  glassForeignBuildings: boolean;
  ownTycoonId: number;
  hiddenFacIds: ReadonlySet<number>;
  requestRender: jest.Mock;
  drawBuildingSelectionEffect: jest.Mock;
  drawSelectionBurst: jest.Mock;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function makeCtx(): Ctx {
  const alphaLog: number[] = [];
  const ctx: Ctx = {
    drawImage: jest.fn(() => { alphaLog.push(ctx.globalAlpha); }),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    fillRect: jest.fn(),
    fillStyle: '',
    globalAlpha: 1,
  };
  (ctx as unknown as { alphaLog: number[] }).alphaLog = alphaLog;
  return ctx;
}

function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: 400 + j * 10, y: 300 + i * 10 };
}

function makeBuilding(tycoonId: number, x: number, y: number): MapBuilding {
  return { visualClass: 'house', tycoonId, options: 0, x, y, level: 0, alert: false, attack: 0 };
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
    allBuildings: [],
    facilityDimensionsCache: new Map(),
    hoveredBuilding: null,
    selectedBuilding: null,
    buildingEffects: new Map(),
    hasAnimatedBuildings: false,
    isOnWaterPlatform: () => false,
    gameObjectTextureCache: {
      getTextureSync: () => ({ width: 64, height: 64 }),
      getAnimatedTexture: () => null,
    },
    glassForeignBuildings: true,
    ownTycoonId: 0,
    hiddenFacIds: new Set(),
    requestRender: jest.fn(),
    drawBuildingSelectionEffect: jest.fn(),
    drawSelectionBurst: jest.fn(),
    ...overrides,
  };
}

const BOUNDS = { minI: 0, maxI: 20, minJ: 0, maxJ: 20 };

function drawBuildings(host: Host): void {
  (proto.drawBuildings as (this: Host, bounds: unknown) => void).call(host, BOUNDS);
}

function alphaLog(host: Host): number[] {
  return (host.ctx as unknown as { alphaLog: number[] }).alphaLog;
}

// The block below used to encode the *wrong* behaviour — glassing keyed to `ownTycoonId`, with
// `selectedBuilding` never set — which was the bug this test file's card (#894) fixed. Per
// CLAUDE.md a test is never quietly edited to force a pass, so this block is rewritten openly:
// legacy (`~/SPO-Original`) confirms glassing keys off the *selected* building's owner, not the
// local player — `Voyager/Components/MapIsoView/Map.pas:1415-1416`
// (`if (fInstances[idx].fCompany <> Company) and fGlassBuildings then include(...)`),
// `Map.pas:5979` (`Company := fMap.fInstances[idx].fCompany;`, the clicked building's owner),
// and `Map.pas:1405-1406` (the whole block under `with fSelection do if ok` — no selection ⇒
// nothing glassed).
describe('drawBuildings — glassing', () => {
  it("glasses a building whose owner differs from the selected building's owner; buildings sharing that owner, including the selected one, stay solid", () => {
    const selected = makeBuilding(9, 2, 2);
    const host = makeHost({
      allBuildings: [makeBuilding(7, 1, 1), selected, makeBuilding(9, 3, 3)],
      glassForeignBuildings: true,
      selectedBuilding: selected,
    });
    drawBuildings(host);
    expect(alphaLog(host)).toEqual([0.5, 1, 1]);
    expect(host.ctx.globalAlpha).toBe(1);
  });

  it('draws every building solid when the option is off, even with a building selected', () => {
    const selected = makeBuilding(9, 2, 2);
    const host = makeHost({
      allBuildings: [makeBuilding(7, 1, 1), selected],
      glassForeignBuildings: false,
      selectedBuilding: selected,
    });
    drawBuildings(host);
    expect(alphaLog(host)).toEqual([1, 1]);
  });

  it('glasses nothing when no building is selected, regardless of ownTycoonId', () => {
    const host = makeHost({
      allBuildings: [makeBuilding(7, 1, 1), makeBuilding(9, 2, 2)],
      glassForeignBuildings: true,
      selectedBuilding: null,
      ownTycoonId: 7,
    });
    drawBuildings(host);
    expect(alphaLog(host)).toEqual([1, 1]);
  });

  it('keys glassing off the selected owner even when that owner is not the local player', () => {
    const selected = makeBuilding(9, 2, 2);
    const host = makeHost({
      allBuildings: [makeBuilding(7, 1, 1), selected],
      glassForeignBuildings: true,
      selectedBuilding: selected,
      ownTycoonId: 7,
    });
    drawBuildings(host);
    expect(alphaLog(host)).toEqual([0.5, 1]);
    expect(host.ctx.globalAlpha).toBe(1);
  });
});

describe('setGlassForeignBuildings / setOwnTycoonId', () => {
  function call(host: Partial<Host>, method: string, ...args: unknown[]): void {
    (proto[method] as (this: unknown, ...a: unknown[]) => void).apply(host, args);
  }

  it('setGlassForeignBuildings stores the flag and requests a render', () => {
    const host: { glassForeignBuildings?: boolean; requestRender: jest.Mock } = { requestRender: jest.fn() };
    call(host as unknown as Partial<Host>, 'setGlassForeignBuildings', false);
    expect(host.glassForeignBuildings).toBe(false);
    expect(host.requestRender).toHaveBeenCalled();
  });

  it('setOwnTycoonId parses a decimal string', () => {
    const host: { ownTycoonId?: number; requestRender: jest.Mock } = { requestRender: jest.fn() };
    call(host as unknown as Partial<Host>, 'setOwnTycoonId', '42');
    expect(host.ownTycoonId).toBe(42);
    expect(host.requestRender).toHaveBeenCalled();
  });

  it('setOwnTycoonId maps an empty string to 0', () => {
    const host: { ownTycoonId?: number; requestRender: jest.Mock } = { requestRender: jest.fn() };
    call(host as unknown as Partial<Host>, 'setOwnTycoonId', '');
    expect(host.ownTycoonId).toBe(0);
  });

  it('setOwnTycoonId maps undefined to 0', () => {
    const host: { ownTycoonId?: number; requestRender: jest.Mock } = { requestRender: jest.fn() };
    call(host as unknown as Partial<Host>, 'setOwnTycoonId', undefined);
    expect(host.ownTycoonId).toBe(0);
  });
});
