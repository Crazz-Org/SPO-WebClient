/**
 * Permanent E2E fixtures — SPO_test3's own facility of each kind in Helartia (#1149).
 *
 * The owner-setter flows need an owned, **finished** facility whose inspector template carries
 * the kind's groups. This module finds one by kind at run time (`findFixture`) — never by
 * coordinates committed to the tree, because the world moves — and `ensureFixtures` builds each
 * missing kind once. That build is the one permanent mutation the maintainer sanctioned
 * (2026-09-29, doc/E2E-POLICY.md §9): nothing here is restored. A kind locked behind research
 * gets one research step per run instead (#1233, RESEARCH_UNLOCKS) — permanent setup data too
 * (maintainer, 2026-10-01): never cancelled, no pending restore.
 *
 * The placement helpers (`listBuildable`, `findFreeLot`, `placeFacility`) are exported for the
 * build-and-demolish flow (#1150).
 *
 * The e2e tsconfig cannot import `src/client/**`, so two client helpers are mirrored here,
 * a few lines each: the construction-state test (`isConstructionState` in
 * `facility-dimensions-cache.ts`) and the zone-colour parse (`parseZoneRequirementValue` in
 * `isometric-map-renderer.ts`).
 */

import { WsMessageType } from '../shared/types/message-types';
import type {
  WsEventTycoonUpdate,
  WsRespAllFacilityDimensions,
  WsRespBuildingCategories,
  WsRespBuildingFacilities,
  WsRespGetProfile,
  WsRespLoginSuccess,
  WsRespMapData,
  WsRespSearchMenuDirectory,
  WsRespSurfaceData,
} from '../shared/types/message-types';
import { SurfaceType } from '../shared/types/domain-types';
import type {
  BuildingInfo,
  DirectoryPage,
  DirectoryRef,
  FacilityDimensions,
  MapBuilding,
  MapSegment,
} from '../shared/types/domain-types';
import { ERROR_TooManyFacilities } from '../shared/error-codes';
import { isWater } from '../shared/land-utils';
import { GOVERNED_TOWN, HTTP_BASE, PRIMARY_ACCOUNT, TIMEOUTS, WORLD_NAME } from './config';
import { LOG_MARKERS, awaitMarker, findCurrentSurvivalLog, openLogWindow, type LogWindow } from './live-log';
import {
  findTown,
  propertyValue,
  readBuildingDetails,
  readSectionGroups,
  setBuildingProperty,
  type LiveSession,
} from './session';
import {
  RESEARCH_TARGET,
  queueResearchLineMatches,
  readResearchDetails,
  researchCost,
  researchInventory,
  researchLevel,
  researchState,
  type ResearchState,
} from './research';
import { toErrorMessage } from '../shared/error-utils';
import { WsDriverError } from './ws-driver';
import { sleep as defaultSleep } from './sleep';

// ---------------------------------------------------------------------------------------------
// 1. The kind table
// ---------------------------------------------------------------------------------------------

export type FixtureKindId = 'industry' | 'store' | 'warehouse' | 'residential' | 'research' | 'bank' | 'tv';

export interface FixtureCandidate {
  facilityClass: string;
  why: string;
}

export interface FixtureKind {
  id: FixtureKindId;
  /** Template group ids (`details.tabs[].id`) that carry the kind's owner settings — all required. */
  groups: readonly string[];
  neededBy: string;
  /**
   * Classes the fixture is built from. The build menu cannot say which groups a class will carry,
   * so this list is committed and the groups check it after the fact: a finished fixture built from
   * a candidate without the kind's groups is a FAIL naming the class. `TWorld.NewFacility` accepts
   * only a class whose cluster is nil or the company's own (`Kernel/World.pas:3058-3067`), and only
   * the classes the build menu offers are ever picked, so every cluster is listed.
   */
  candidates: readonly FixtureCandidate[];
}

export const FIXTURE_KINDS: readonly FixtureKind[] = [
  {
    id: 'industry',
    groups: ['indGeneral', 'supplies', 'products'],
    neededBy: '#1152, #1153, #1154',
    candidates: [
      { facilityClass: 'PGISmallFarm', why: 'IndGeneral,Products,Supplies — PGI/PGIPack1.dpr:1626' },
      { facilityClass: 'MarikoSmallFarm', why: 'IndGeneral,Products,Supplies — Mariko/MarikoPack1.dpr:1405' },
      { facilityClass: 'MoabFarm', why: 'IndGeneral,Products,Supplies — Moab/MoabPack1.dpr:953' },
      { facilityClass: 'DissSmallFarm', why: 'IndGeneral,Products,Supplies — Dissidents/DissidentPack1.dpr:1305' },
    ],
  },
  {
    id: 'store',
    groups: ['srvGeneral', 'supplies'],
    neededBy: '#1152',
    candidates: [
      { facilityClass: 'PGIFoodStore', why: 'SrvGeneral,Supplies — PGI/PGIPack1.dpr:2954' },
      { facilityClass: 'MarikoFoodStore', why: 'SrvGeneral,Supplies — Mariko/MarikoPack1.dpr:2676' },
      { facilityClass: 'MoabFoodStore', why: 'SrvGeneral,Supplies — Moab/MoabPack1.dpr:1707' },
      { facilityClass: 'DissFoodStore', why: 'SrvGeneral,Supplies — Dissidents/DissidentPack1.dpr:2653' },
      { facilityClass: 'MagnaSupermarketA', why: 'SrvGeneral,Supplies — Magna/MagnaPack1.dpr:826' },
    ],
  },
  {
    id: 'warehouse',
    groups: ['whGeneral'],
    neededBy: '#1153',
    // Cluster + 'WHCOMMON' (Model Extensions/Standards.pas:209) + 'UWMegaStorage' (UW/UWConst.pas:50),
    // copied per cluster by CopyCommonFacilities (Standards.pas:243-269) from General/GeneralPack1.dpr:722.
    candidates: [
      { facilityClass: 'PGIWHCOMMONUWMegaStorage', why: 'WHGeneral — General/GeneralPack1.dpr:722, copied by PGI/PGIPack1.dpr:1595' },
      { facilityClass: 'MarikoWHCOMMONUWMegaStorage', why: 'WHGeneral — General/GeneralPack1.dpr:722, copied by Mariko/MarikoPack1.dpr:1372' },
      { facilityClass: 'MoabWHCOMMONUWMegaStorage', why: 'WHGeneral — General/GeneralPack1.dpr:722, copied by Moab/MoabPack1.dpr:922' },
      { facilityClass: 'DissidentsWHCOMMONUWMegaStorage', why: 'WHGeneral — General/GeneralPack1.dpr:722, copied by Dissidents/DissidentPack1.dpr:1270' },
    ],
  },
  {
    id: 'residential',
    groups: ['resGeneral'],
    neededBy: '#1154',
    candidates: [
      { facilityClass: 'PGIHighClassLoCost', why: 'ResGeneral — PGI/PGIPack1.dpr:201' },
      { facilityClass: 'MarikoHighClassLoCost', why: 'ResGeneral — Mariko/MarikoPack1.dpr:417' },
      { facilityClass: 'KnightsLoCost', why: 'ResGeneral — Moab/MoabPack1.dpr:187' },
      { facilityClass: 'DissHighClassLoCost', why: 'ResGeneral — Dissidents/DissidentPack1.dpr:356' },
      { facilityClass: 'MagnaWhirlpool', why: 'ResGeneral — Magna/MagnaPack1.dpr:199' },
    ],
  },
  {
    // `hqInventions` is injected by registerInspectorTabs when the class carries HqGeneral.
    // A second HQ answers ERROR_TooManyFacilities (uniqueness) -> unproven, never FAIL.
    id: 'research',
    groups: ['hqInventions'],
    neededBy: '#1154',
    candidates: [
      { facilityClass: 'PGIGeneralHeadquarterSTA', why: 'HqGeneral — PGI/PGIPack1.dpr:3436' },
      { facilityClass: 'MarikoGeneralHeadquarterSTA', why: 'HqGeneral — Mariko/MarikoPack1.dpr:3120' },
      { facilityClass: 'MoabGeneralHeadquarterSTA', why: 'HqGeneral — Moab/MoabPack1.dpr:2108' },
      { facilityClass: 'DissGeneralHeadquarterSTA', why: 'HqGeneral — Dissidents/DissidentPack1.dpr:3176' },
      { facilityClass: 'MagnaResearchCenter', why: 'HqGeneral — Magna/MagnaPack1.dpr:905' },
    ],
  },
  {
    id: 'bank',
    groups: ['bankGeneral'],
    neededBy: '#1154',
    // The only BankGeneral class; another cluster ends unproven "not offered".
    candidates: [{ facilityClass: 'DissBank', why: 'BankGeneral — Dissidents/DissidentPack1.dpr:317' }],
  },
  {
    id: 'tv',
    groups: ['tvGeneral'],
    neededBy: '#1154',
    candidates: [
      { facilityClass: 'PGITVStation', why: 'TVGeneral — PGI/PGIPack1.dpr:3687' },
      { facilityClass: 'MarikoTVStation', why: 'TVGeneral — Mariko/MarikoPack1.dpr:3376' },
      { facilityClass: 'MoabTVStation', why: 'TVGeneral — Moab/MoabPack1.dpr:2367' },
      { facilityClass: 'DissTVStation', why: 'TVGeneral — Dissidents/DissidentPack1.dpr:3430' },
    ],
  },
];

/**
 * Cash kept back after a build. It keeps SPO_test3 solvent for the rest of the nightly
 * (`bank-borrow-payoff` needs a positive balance, `Kernel/Kernel.pas:11572`) and for the
 * fixtures' upkeep. Nightly spend is accepted by the maintainer (2026-09-29).
 */
export const FIXTURE_CASH_FLOOR = 10_000_000;

/** The kind's groups missing from a template's tabs (exact id match). */
export function missingGroups(tabs: { id: string }[], kind: FixtureKind): string[] {
  const ids = new Set(tabs.map(t => t.id));
  return kind.groups.filter(g => !ids.has(g));
}

export function carriesKind(tabs: { id: string }[], kind: FixtureKind): boolean {
  return missingGroups(tabs, kind).length === 0;
}

/**
 * Classes placeFacility refuses before sending. A transcendence block flags its owner at
 * placement (`TCompany.FacilityCreated`, `Kernel/Kernel.pas:10127-10128`) — before any
 * after-the-fact check could catch it; the only ones are `ParadigmMausoleum` and
 * `LegendMausoleum` (`Model Extensions/General/GeneralPack1.dpr:1251-1261`, `:1286-1296`).
 */
export function isRefusedClass(facilityClass: string): boolean {
  return /Mausoleum/.test(facilityClass) || facilityClass === 'Capitol';
}

// ---------------------------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------------------------

/** Mirror of `parseZoneRequirementValue` (`isometric-map-renderer.ts`): the ZONES value a class needs, 0 for none. */
const ZONE_COLOR_VALUES: Record<string, number> = { red: 2, blue: 7, yellow: 6, green: 8, orange: 9, purple: 1 };
const ZONE_RESERVED = 1;

export function zoneValueOf(zoneRequirement: string): number {
  const match = /(red|blue|yellow|green|orange|purple)\s+zone/i.exec(zoneRequirement || '');
  return match ? ZONE_COLOR_VALUES[match[1].toLowerCase()] : 0;
}

/** SPO_test3's persistent tycoon id, as `RESP_LOGIN_SUCCESS` carried it. */
export function ownTycoonId(session: LiveSession): string {
  const login = session.driver.seen(WsMessageType.RESP_LOGIN_SUCCESS)[0] as WsRespLoginSuccess | undefined;
  if (!login?.tycoonId) throw new Error('No RESP_LOGIN_SUCCESS tycoonId seen on this session');
  return String(login.tycoonId);
}

/**
 * `MapBuilding.tycoonId` is `Company.Owner.Id` (`TycoonToStr`, `Kernel/World.pas:3295-3300`,
 * emitted `:3331`) — a role company's owner is the role tycoon, so this also excludes the Mayor.
 */
function ownedBy(b: MapBuilding, tycoonId: string): boolean {
  return String(b.tycoonId) === tycoonId;
}

const dimsCache = new WeakMap<LiveSession, Promise<Record<string, FacilityDimensions>>>();

export function facilityDimensions(session: LiveSession): Promise<Record<string, FacilityDimensions>> {
  let cached = dimsCache.get(session);
  if (!cached) {
    cached = session.driver
      .request<WsRespAllFacilityDimensions>(
        { type: WsMessageType.REQ_GET_ALL_FACILITY_DIMENSIONS },
        WsMessageType.RESP_ALL_FACILITY_DIMENSIONS,
      )
      .then(r => r.dimensions);
    dimsCache.set(session, cached);
  }
  return cached;
}

/** Mirror of `isConstructionState` (`facility-dimensions-cache.ts`). */
export function isConstructionClass(dims: Record<string, FacilityDimensions>, visualClass: string): boolean {
  return dims[visualClass]?.textureFilename?.startsWith('Construction') === true;
}

async function readMap(
  session: LiveSession,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<{ buildings: MapBuilding[]; segments: MapSegment[] }> {
  const response = await session.driver.request<WsRespMapData>(
    { type: WsMessageType.REQ_MAP_LOAD, x, y, width, height },
    [WsMessageType.RESP_MAP_DATA, WsMessageType.EVENT_MAP_DATA],
    TIMEOUTS.login,
  );
  return { buildings: response.data?.buildings ?? [], segments: response.data?.segments ?? [] };
}

/** The building anchored exactly at (x, y), read from a small window around it. */
async function buildingAt(session: LiveSession, x: number, y: number): Promise<MapBuilding | undefined> {
  const span = 8;
  const { buildings } = await readMap(session, Math.max(0, x - span), Math.max(0, y - span), span * 2 + 1, span * 2 + 1);
  return buildings.find(b => b.x === x && b.y === y);
}

async function readSurface(
  session: LiveSession,
  surfaceType: SurfaceType,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<number[][]> {
  const { data } = await session.driver.request<WsRespSurfaceData>(
    { type: WsMessageType.REQ_GET_SURFACE, surfaceType, x1, y1, x2, y2 },
    WsMessageType.RESP_SURFACE_DATA,
  );
  return data.rows;
}

// ---------------------------------------------------------------------------------------------
// 2. "In Helartia" — the server's own test
// ---------------------------------------------------------------------------------------------

/** The TOWNS surface value at a tile — the server's `NearestTown` → `TownMap[x,y]` (`Kernel/World.pas:5930`, served `:4467`). */
export async function townValueAt(session: LiveSession, x: number, y: number): Promise<number | undefined> {
  const rows = await readSurface(session, SurfaceType.TOWNS, x, y, x, y);
  return rows[0]?.[0];
}

/** The TOWNS value at Helartia's town-hall tile. */
export async function helartiaValue(session: LiveSession): Promise<number | undefined> {
  const hall = await findTown(session, GOVERNED_TOWN);
  return townValueAt(session, hall.x, hall.y);
}

// ---------------------------------------------------------------------------------------------
// 3. Placement helpers
// ---------------------------------------------------------------------------------------------

/** What the company may build now — `available` rows only (a locked row's class is guessed from an icon). */
export async function listBuildable(session: LiveSession): Promise<BuildingInfo[]> {
  return (await readBuildMenu(session)).filter(f => f.available === true);
}

/**
 * Every row of the company's build menu, locked rows kept. A locked row carries no kernel class
 * (its class is guessed from an icon), only the server's own `requirement` sentence.
 */
export async function readBuildMenu(session: LiveSession): Promise<BuildingInfo[]> {
  const companyName = session.company.name;
  const { categories } = await session.driver.request<WsRespBuildingCategories>(
    { type: WsMessageType.REQ_GET_BUILDING_CATEGORIES, companyName },
    WsMessageType.RESP_BUILDING_CATEGORIES,
  );
  const out: BuildingInfo[] = [];
  for (const c of categories) {
    const { facilities } = await session.driver.request<WsRespBuildingFacilities>(
      {
        type: WsMessageType.REQ_GET_BUILDING_FACILITIES,
        companyName,
        cluster: c.cluster,
        kind: c.kind,
        kindName: c.kindName,
        folder: c.folder,
        tycoonLevel: c.tycoonLevel,
      },
      WsMessageType.RESP_BUILDING_FACILITIES,
    );
    out.push(...facilities);
  }
  return out;
}

/** An 8-bit uncompressed BMP read as land ids — the layout `parseBmp` in `terrain-loader.ts` reads. */
export interface Terrain {
  width: number;
  height: number;
  landId(x: number, y: number): number | undefined;
}

export function parseTerrainBmp(buffer: ArrayBuffer): Terrain {
  const view = new DataView(buffer);
  if (String.fromCharCode(view.getUint8(0), view.getUint8(1)) !== 'BM') throw new Error('terrain: not a BMP');
  const dataOffset = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const bpp = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  if (bpp !== 8 || compression !== 0) throw new Error(`terrain: unsupported BMP (${bpp} bpp, compression ${compression})`);
  const height = Math.abs(rawHeight);
  const stride = Math.ceil(width / 4) * 4;
  const bytes = new Uint8Array(buffer);
  return {
    width,
    height,
    landId(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return undefined;
      const row = rawHeight > 0 ? height - 1 - y : y;
      return bytes[dataOffset + row * stride + x];
    },
  };
}

export interface FixtureDeps {
  survivalLogUrl?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

const terrainCache = new WeakMap<LiveSession, Promise<Terrain>>();

/** The world's terrain, as the browser loads it: `/api/map-data/<map>` → `bmpUrl` → the BMP. Throws on failure. */
export function loadTerrain(session: LiveSession, fetchImpl: typeof fetch = fetch): Promise<Terrain> {
  let cached = terrainCache.get(session);
  if (!cached) {
    cached = (async () => {
      const name = session.world?.name ?? WORLD_NAME;
      const meta = await fetchImpl(`${HTTP_BASE}/api/map-data/${encodeURIComponent(name)}`);
      if (!meta.ok) throw new Error(`terrain: map-data ${meta.status} for ${name}`);
      const { bmpUrl } = (await meta.json()) as { bmpUrl: string };
      const bmp = await fetchImpl(new URL(bmpUrl, HTTP_BASE).href);
      if (!bmp.ok) throw new Error(`terrain: BMP ${bmp.status} at ${bmpUrl}`);
      return parseTerrainBmp(await bmp.arrayBuffer());
    })();
    terrainCache.set(session, cached);
    // A failed read is not cached: the next call retries.
    cached.catch(() => terrainCache.delete(session));
  }
  return cached;
}

/** The lot-search window: 64×64 around Helartia's hall. */
export const LOT_WINDOW = 64;

interface LotArea {
  hall: { x: number; y: number };
  x0: number;
  y0: number;
  helartia: number | undefined;
  towns: number[][];
  zones: number[][];
  buildings: MapBuilding[];
  segments: MapSegment[];
  dims: Record<string, FacilityDimensions>;
}

async function readLotArea(session: LiveSession): Promise<LotArea> {
  const hall = await findTown(session, GOVERNED_TOWN);
  const x0 = Math.max(0, hall.x - LOT_WINDOW / 2);
  const y0 = Math.max(0, hall.y - LOT_WINDOW / 2);
  const x2 = x0 + LOT_WINDOW - 1;
  const y2 = y0 + LOT_WINDOW - 1;
  const { buildings, segments } = await readMap(session, x0, y0, LOT_WINDOW, LOT_WINDOW);
  const towns = await readSurface(session, SurfaceType.TOWNS, x0, y0, x2, y2);
  const zones = await readSurface(session, SurfaceType.ZONES, x0, y0, x2, y2);
  const dims = await facilityDimensions(session);
  const helartia = towns[hall.y - y0]?.[hall.x - x0];
  return { hall, x0, y0, helartia, towns, zones, buildings, segments, dims };
}

function cell(rows: number[][], area: LotArea, x: number, y: number): number | undefined {
  return rows[y - area.y0]?.[x - area.x0];
}

/**
 * A free NW corner for a `xsize × ysize` facility in Helartia, nearest the hall first, or null.
 *
 * The server rule: `TWorld.NewFacility` checks the zone only through
 * `MatchesZone(x, y, XSize, YSize, ZoneType)`, unless the class has `mfcIgnoreZoning`
 * (`Kernel/World.pas:3077`). `MatchesZone` ORs over the footprint, so one matching tile is enough
 * (`Kernel/World.pas:5767-5788`). Per tile, `ZoneMatches` (`Protocol/Protocol.pas:433-445`): tile 0
 * matches every class; tile reserved (1) also matches every class (`result := true;//false;`,
 * `:438-439`); tile residential (2) matches classes 3/4/5; any other tile matches the same zone, or
 * a class with no zone. `AreaIsClear` separately needs every tile free of objects and roads, and
 * not water (`Kernel/World.pas:5700-5742`).
 *
 * The client rule — a strict subset (if every tile matches, at least one does). Every footprint
 * tile must: sit inside the window with a margin (a building anchored outside it can reach in);
 * read Helartia's value on TOWNS; hold the required zone or zone 0, or with no requirement any
 * zone but reserved; not be water (`Kernel/World.pas:5724-5726` — WaterQuest is not assumed); and
 * carry no building footprint and no road. Reserved is refused for every class, stricter than the
 * server on purpose: reserved land is the mayor's.
 *
 * Accepted consequence: Helartia has a mayor and SPO_test3 holds the role (`TTycoon.AssumeRole`
 * sets `SuperRole`, `Kernel/Kernel.pas:11377`), so a footprint more than half unzoned
 * (`AreaIsZoned`, `Kernel/World.pas:5790-5810`) gets the `facForbiddenZone` trouble bit when built
 * (`Kernel/World.pas:3128-3133`) and keeps it every period (`Kernel/Kernel.pas:4093-4095`). Its
 * only effect: a demolition ordered by a later zoning change pays no refund
 * (`Kernel/World.pas:1556-1559`). An owner's own demolition (`place-rename-demolish`) still takes
 * the level-based refund (`Kernel/World.pas:1561-1563`).
 */
export async function findFreeLot(
  session: LiveSession,
  footprint: { xsize: number; ysize: number },
  zoneRequirement: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<{ x: number; y: number } | null> {
  const area = await readLotArea(session);
  const terrain = await loadTerrain(session, deps.fetchImpl);
  if (area.helartia === undefined) return null;

  const margin = Math.max(1, ...Object.values(area.dims).map(d => Math.max(d.xsize || 1, d.ysize || 1)));
  const blocked = new Set<string>();
  const key = (x: number, y: number): string => `${x},${y}`;
  for (const b of area.buildings) {
    const d = area.dims[b.visualClass];
    const w = d?.xsize || 1;
    const h = d?.ysize || 1;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) blocked.add(key(b.x + dx, b.y + dy));
  }
  for (const s of area.segments) {
    for (let y = Math.min(s.y1, s.y2); y <= Math.max(s.y1, s.y2); y++) {
      for (let x = Math.min(s.x1, s.x2); x <= Math.max(s.x1, s.x2); x++) blocked.add(key(x, y));
    }
  }

  const required = zoneValueOf(zoneRequirement);
  const lo = { x: area.x0 + margin, y: area.y0 + margin };
  const hi = { x: area.x0 + LOT_WINDOW - margin, y: area.y0 + LOT_WINDOW - margin }; // exclusive
  const tileOk = (x: number, y: number): boolean => {
    if (x < lo.x || y < lo.y || x >= hi.x || y >= hi.y) return false;
    if (cell(area.towns, area, x, y) !== area.helartia) return false;
    const zone = cell(area.zones, area, x, y);
    if (zone === undefined || zone === ZONE_RESERVED) return false;
    if (required > 0 && zone !== required && zone !== 0) return false;
    const land = terrain.landId(x, y);
    if (land === undefined || isWater(land)) return false;
    return !blocked.has(key(x, y));
  };

  const corners: { x: number; y: number; d: number }[] = [];
  for (let y = lo.y; y + footprint.ysize <= hi.y; y++) {
    for (let x = lo.x; x + footprint.xsize <= hi.x; x++) {
      corners.push({ x, y, d: Math.max(Math.abs(x - area.hall.x), Math.abs(y - area.hall.y)) });
    }
  }
  corners.sort((a, b) => a.d - b.d);
  for (const c of corners) {
    let ok = true;
    for (let dy = 0; ok && dy < footprint.ysize; dy++) {
      for (let dx = 0; ok && dx < footprint.xsize; dx++) ok = tileOk(c.x + dx, c.y + dy);
    }
    if (ok) return { x: c.x, y: c.y };
  }
  return null;
}

export interface ReadBack {
  visualClass: string;
  tycoonId: string;
  construction: boolean;
}

export interface PlaceResult {
  /** NewFacility's result code: 0 = created. */
  code: number;
  /** What reads back at (x, y) — null when nothing is anchored there. */
  readBack: ReadBack | null;
  /** The read-back is the placed class (or a construction site) owned by SPO_test3. */
  confirmed: boolean;
}

/**
 * Place one facility and read back what stands at its lot.
 *
 * The reply carries a result code but no id (`TWorld.RDONewFacility` discards it), so the
 * facility is found again by position. The read-back confirms when the building anchored at
 * (x, y) is a construction-state class or the placed class's own visual class (registered, or
 * completed = registered + 1, `Kernel/KernelCache.pas:291`) — and its owner is SPO_test3.
 */
export async function placeFacility(
  session: LiveSession,
  facilityClass: string,
  x: number,
  y: number,
  opts: { visualClassId?: string; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<PlaceResult> {
  if (isRefusedClass(facilityClass)) {
    throw new Error(`placeFacility refuses ${facilityClass}: a transcendence block or the Capitol is never placed`);
  }
  let code = 0;
  try {
    await session.driver.request(
      { type: WsMessageType.REQ_PLACE_BUILDING, facilityClass, x, y },
      WsMessageType.RESP_BUILDING_PLACED,
    );
  } catch (err: unknown) {
    if (!(err instanceof WsDriverError) || err.forType !== WsMessageType.REQ_PLACE_BUILDING) throw err;
    code = err.code;
  }
  if (code !== 0) return { code, readBack: null, confirmed: false };

  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const tycoonId = ownTycoonId(session);
  const dims = await facilityDimensions(session);
  const own = new Set<string>();
  if (opts.visualClassId) {
    own.add(opts.visualClassId);
    own.add(String(Number(opts.visualClassId) + 1));
  }
  const deadline = now() + TIMEOUTS.readBack;
  for (;;) {
    const b = await buildingAt(session, x, y);
    const readBack: ReadBack | null = b
      ? { visualClass: b.visualClass, tycoonId: String(b.tycoonId), construction: isConstructionClass(dims, b.visualClass) }
      : null;
    const confirmed =
      readBack !== null && readBack.tycoonId === tycoonId && (readBack.construction || own.has(readBack.visualClass));
    if (confirmed) return { code, readBack, confirmed };
    if (now() >= deadline) return { code, readBack, confirmed: false };
    await sleep(TIMEOUTS.readBackPoll);
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Discovery
// ---------------------------------------------------------------------------------------------

export interface Holding {
  x: number;
  y: number;
  visualClass: string;
  name: string;
  tabIds: string[];
}

export interface Site {
  x: number;
  y: number;
  visualClass: string;
}

export interface Holdings {
  holdings: Holding[];
  sites: Site[];
}

async function readDirectory(session: LiveSession, ref: DirectoryRef): Promise<DirectoryPage> {
  const response = await session.driver.request<WsRespSearchMenuDirectory>(
    { type: WsMessageType.REQ_SEARCH_MENU_DIRECTORY, ref },
    WsMessageType.RESP_SEARCH_MENU_DIRECTORY,
  );
  return response.page;
}

/**
 * SPO_test3's facilities in Helartia, from the directory's tycoon branch (`TycoonCompanies.asp` →
 * `TycoonCompany.asp` → `TycoonFacilities.asp`), descending only into its own company
 * (`session.company`, which `pickCompany` keeps off a role company). Each row must read Helartia
 * on TOWNS and carry SPO_test3's tycoon id on its lot; a construction-state class is a site.
 */
export async function scanHoldings(session: LiveSession): Promise<Holdings> {
  const tycoon = PRIMARY_ACCOUNT.username;
  const company = session.company.name;
  const out: Holdings = { holdings: [], sites: [] };

  const companies = await readDirectory(session, { kind: 'tycoon-companies', tycoon });
  if (companies.kind !== 'folder' || !companies.items.includes(company)) return out;
  const kinds = await readDirectory(session, { kind: 'tycoon-company', tycoon, company });
  if (kinds.kind !== 'folder') return out;

  const helartia = await helartiaValue(session);
  const tycoonId = ownTycoonId(session);
  const dims = await facilityDimensions(session);
  for (const facKind of kinds.items) {
    const page = await readDirectory(session, { kind: 'tycoon-facility-kind', tycoon, company, facKind });
    if (page.kind !== 'facility-list') continue;
    for (const row of page.facilities) {
      if (helartia === undefined || (await townValueAt(session, row.x, row.y)) !== helartia) continue;
      const b = await buildingAt(session, row.x, row.y);
      if (!b || !ownedBy(b, tycoonId)) continue;
      if (isConstructionClass(dims, b.visualClass)) {
        out.sites.push({ x: row.x, y: row.y, visualClass: b.visualClass });
        continue;
      }
      const details = await readBuildingDetails(session, row.x, row.y, b.visualClass);
      out.holdings.push({
        x: row.x,
        y: row.y,
        visualClass: b.visualClass,
        name: row.name,
        tabIds: details.tabs.map(t => t.id),
      });
    }
  }
  return out;
}

export interface FixtureLookup {
  kind: FixtureKindId;
  found?: { x: number; y: number; visualClass: string; name: string };
  reason?: string;
}

export function pickFixture(holdings: Holding[], sites: Site[], kind: FixtureKind): FixtureLookup {
  const hit = holdings.find(h => carriesKind(h.tabIds.map(id => ({ id })), kind));
  if (hit) return { kind: kind.id, found: { x: hit.x, y: hit.y, visualClass: hit.visualClass, name: hit.name } };
  // A site cannot be tied to a class: nothing read later says what it will become.
  if (sites.length > 0) return { kind: kind.id, reason: 'under construction' };
  return { kind: kind.id, reason: `none in ${GOVERNED_TOWN}` };
}

/** SPO_test3's own finished facility of a kind in Helartia, or null-found with the reason. */
export async function findFixture(session: LiveSession, kind: FixtureKind): Promise<FixtureLookup> {
  const { holdings, sites } = await scanHoldings(session);
  return pickFixture(holdings, sites, kind);
}

/**
 * `null` when (x, y) is SPO_test3's own facility in Helartia, else why not — the checks
 * `scanHoldings` applies to each directory row: TOWNS reads Helartia, a building is anchored
 * there, and its lot carries SPO_test3's tycoon id (#1153: a counterpart is never another
 * player's, since a link is written on both gates, `Kernel/Kernel.pas:6784-6785`).
 */
export async function ownLotRefusal(session: LiveSession, x: number, y: number): Promise<string | null> {
  const helartia = await helartiaValue(session);
  const town = await townValueAt(session, x, y);
  if (helartia === undefined || town !== helartia) {
    return `(${x},${y}) is not in ${GOVERNED_TOWN} (TOWNS ${String(town)}, ${GOVERNED_TOWN} ${String(helartia)})`;
  }
  const b = await buildingAt(session, x, y);
  if (!b) return `no building anchored at (${x},${y})`;
  const tycoonId = ownTycoonId(session);
  if (!ownedBy(b, tycoonId)) return `(${x},${y}) is owned by tycoon ${String(b.tycoonId)}, not ${PRIMARY_ACCOUNT.username} (${tycoonId})`;
  return null;
}

/** One facility row of SPO_test3's directory branch. */
export interface TycoonFacility {
  company: string;
  x: number;
  y: number;
  name: string;
}

/**
 * Every company the directory lists for SPO_test3 and every facility row under each, in any town
 * — no Helartia filter. Quick Trade's disconnect reaches every facility of the tycoon's companies
 * (`Kernel/Kernel.pas:4537-4553`), so its guards need the whole list.
 */
export async function listTycoonFacilities(
  session: LiveSession,
): Promise<{ companies: string[]; facilities: TycoonFacility[] }> {
  const tycoon = PRIMARY_ACCOUNT.username;
  const out: { companies: string[]; facilities: TycoonFacility[] } = { companies: [], facilities: [] };
  const companies = await readDirectory(session, { kind: 'tycoon-companies', tycoon });
  if (companies.kind !== 'folder') return out;
  for (const company of companies.items) {
    out.companies.push(company);
    const kinds = await readDirectory(session, { kind: 'tycoon-company', tycoon, company });
    if (kinds.kind !== 'folder') continue;
    for (const facKind of kinds.items) {
      const page = await readDirectory(session, { kind: 'tycoon-facility-kind', tycoon, company, facKind });
      if (page.kind !== 'facility-list') continue;
      for (const row of page.facilities) out.facilities.push({ company, x: row.x, y: row.y, name: row.name });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 5. ensureFixtures
// ---------------------------------------------------------------------------------------------

export interface FixtureOutcome {
  kind: FixtureKindId;
  status: 'found' | 'under construction' | 'built' | 'unproven' | 'FAIL';
  x?: number;
  y?: number;
  visualClass?: string;
  facilityClass?: string;
  /** The `New Facility:` line, on `built`. */
  logLine?: string;
  reason?: string;
}

/** The last `EVENT_TYCOON_UPDATE`'s cash, or null when none arrived or it does not parse. */
export async function readCash(session: LiveSession): Promise<number | null> {
  try {
    await session.driver.waitFor(
      m => m.type === WsMessageType.EVENT_TYCOON_UPDATE,
      TIMEOUTS.request,
      'EVENT_TYCOON_UPDATE (cash)',
    );
  } catch {
    return null;
  }
  const events = session.driver.seen(WsMessageType.EVENT_TYCOON_UPDATE) as WsEventTycoonUpdate[];
  const last = events[events.length - 1];
  if (!last) return null;
  const digits = String(last.cash).replace(/[^0-9.-]/g, '');
  const cash = Number(digits);
  return digits !== '' && Number.isFinite(cash) ? cash : null;
}

/** `New Facility: <class> Company: <id> x: <x> y: <y>` (`Kernel/World.pas:3565`), on all four fields. */
export function newFacilityLineMatches(line: string, facilityClass: string, companyId: string, x: number, y: number): boolean {
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `New Facility: ${esc(facilityClass)} Company: ${esc(companyId)} x: ${x} y: ${y}(\\s|$)`,
  ).test(line);
}

const SITE_REASON = `SPO_test3 owns a construction site in ${GOVERNED_TOWN}; a site cannot be tied to a class`;

/**
 * Find each kind; build each missing one once. Never places while SPO_test3 owns a construction
 * site in Helartia — a site left by an earlier run cannot be attributed to a kind, so a build then
 * could duplicate a permanent fixture. The attribution is never taken from
 * `FacilityDimensions.facId`: whether a construction class carries it is [UNKNOWN].
 */
export async function ensureFixtures(session: LiveSession, deps: FixtureDeps = {}): Promise<FixtureOutcome[]> {
  const { holdings, sites } = await scanHoldings(session);
  const outcomes = new Map<FixtureKindId, FixtureOutcome>();
  for (const kind of FIXTURE_KINDS) {
    const hit = pickFixture(holdings, [], kind).found;
    if (hit) outcomes.set(kind.id, { kind: kind.id, status: 'found', x: hit.x, y: hit.y, visualClass: hit.visualClass });
  }
  const ordered = (): FixtureOutcome[] => FIXTURE_KINDS.map(k => outcomes.get(k.id) as FixtureOutcome);
  const absent = FIXTURE_KINDS.filter(k => !outcomes.has(k.id));
  if (absent.length === 0) return ordered();

  // Construction guard: the directory's sites, and every owned construction lot in the window.
  const tycoonId = ownTycoonId(session);
  const area = await readLotArea(session);
  const windowSite = area.buildings.some(
    b =>
      ownedBy(b, tycoonId) &&
      isConstructionClass(area.dims, b.visualClass) &&
      area.helartia !== undefined &&
      cell(area.towns, area, b.x, b.y) === area.helartia,
  );
  if (sites.length > 0 || windowSite) {
    for (const k of absent) outcomes.set(k.id, { kind: k.id, status: 'under construction', reason: SITE_REASON });
    return ordered();
  }

  let cash = await readCash(session);
  const menu = await readBuildMenu(session);
  const buildable = menu.filter(f => f.available === true);
  const locked = menu.filter(f => f.available !== true);
  let logWindow: LogWindow | undefined;
  const companyId = session.company.id;
  const research: ResearchRun = {
    session,
    holdings,
    deps,
    logWindow: async () => (logWindow ??= await openLogWindow(deps.survivalLogUrl ?? (await findCurrentSurvivalLog()))),
  };

  for (const kind of absent) {
    const set = (o: Omit<FixtureOutcome, 'kind'>): void => {
      outcomes.set(kind.id, { kind: kind.id, ...o });
    };
    const offered = buildable.filter(b => kind.candidates.some(c => c.facilityClass === b.facilityClass));
    if (offered.length === 0) {
      // Not offered: when research unlocks the kind, take one step of it (#1233).
      let researched: Awaited<ReturnType<typeof researchUnlock>>;
      try {
        researched = await researchUnlock(research, kind, locked, cash);
      } catch (err: unknown) {
        set({ status: 'unproven', reason: `research step: ${toErrorMessage(err)}` });
        continue;
      }
      if (researched) {
        set(researched.outcome);
        if (cash !== null) cash -= researched.spent;
        continue;
      }
      set({ status: 'unproven', reason: `no candidate offered to ${session.company.name}` });
      continue;
    }
    if (cash === null) {
      set({ status: 'unproven', reason: 'cash unknown — no EVENT_TYCOON_UPDATE received' });
      continue;
    }
    const budget = cash - FIXTURE_CASH_FLOOR;
    const byCost = [...offered].sort((a, b) => a.cost - b.cost);
    const info = byCost.find(b => b.cost <= budget);
    if (!info) {
      set({ status: 'unproven', reason: `cost ${byCost[0].cost} exceeds the cash floor` });
      continue;
    }
    const dims = await facilityDimensions(session);
    const d = dims[info.visualClassId];
    const footprint =
      info.xsize && info.ysize ? { xsize: info.xsize, ysize: info.ysize } : d ? { xsize: d.xsize, ysize: d.ysize } : null;
    if (!footprint) {
      set({ status: 'unproven', facilityClass: info.facilityClass, reason: 'footprint unknown' });
      continue;
    }
    const lot = await findFreeLot(session, footprint, info.zoneRequirement, { fetchImpl: deps.fetchImpl });
    if (!lot) {
      set({ status: 'unproven', facilityClass: info.facilityClass, reason: `no free lot in ${GOVERNED_TOWN}` });
      continue;
    }

    logWindow ??= await openLogWindow(deps.survivalLogUrl ?? (await findCurrentSurvivalLog()));
    const where = `(${lot.x},${lot.y})`;
    const placed = await placeFacility(session, info.facilityClass, lot.x, lot.y, {
      visualClassId: info.visualClassId,
      now: deps.now,
      sleep: deps.sleep,
    });
    const base = { x: lot.x, y: lot.y, facilityClass: info.facilityClass };
    if (placed.code === ERROR_TooManyFacilities) {
      set({ status: 'unproven', ...base, reason: 'facility limit or company uniqueness' });
      continue;
    }
    if (placed.code !== 0) {
      set({ status: 'FAIL', ...base, reason: `NewFacility answered ${placed.code} for ${info.facilityClass} at ${where}` });
      continue;
    }
    // The class's cost is spent once NewFacility answered 0, whatever the read-back shows.
    cash -= info.cost;
    if (!placed.confirmed || !placed.readBack) {
      set({
        status: 'FAIL',
        ...base,
        reason: `nothing of ${info.facilityClass} (placed or construction) owned by SPO_test3 reads back at ${where}`,
      });
      continue;
    }
    const line = await awaitMarker(
      logWindow,
      {
        marker: LOG_MARKERS.RDONewFacility,
        match: l => newFacilityLineMatches(l, info.facilityClass, companyId, lot.x, lot.y),
      },
      TIMEOUTS.logSettle,
      undefined,
      deps.now,
      deps.sleep,
    );
    if (line === null) {
      set({
        status: 'FAIL',
        ...base,
        reason: `no New Facility: line for ${info.facilityClass}, company ${companyId}, ${where}`,
      });
      continue;
    }
    const vc = placed.readBack.visualClass;
    if (!placed.readBack.construction) {
      const details = await readBuildingDetails(session, lot.x, lot.y, vc);
      const missing = missingGroups(details.tabs, kind);
      if (missing.length > 0) {
        set({
          status: 'FAIL',
          ...base,
          visualClass: vc,
          logLine: line,
          reason: `candidate ${info.facilityClass} (visual class ${vc}) built a facility without ${missing.join(', ')} — a wrong FIXTURE_KINDS entry`,
        });
        continue;
      }
    }
    set({ status: 'built', ...base, visualClass: vc, logLine: line });
  }
  return ordered();
}

// ---------------------------------------------------------------------------------------------
// 6. Research that unlocks a kind (#1233)
// ---------------------------------------------------------------------------------------------

export interface ResearchUnlock {
  facilityClass: string;
  /** The invention id (`research.0.dat`) whose research makes the class buildable. */
  inventionId: string;
  why: string;
}

/**
 * A class the build menu offers only once an invention is owned. `FacilityList.asp:208` makes a
 * class available when the company owns its technology; an invention links itself to every class
 * whose `TechnologyKind` equals its `tech` attribute (`TInvention.EnableFacilities`,
 * `Inventions/Inventions.pas:582-595`). That attribute is not in the SPO-Original tree, so each
 * entry is checked live: a locked build-menu row's `requirement` must name the invention.
 * Kept apart from FIXTURE_KINDS on purpose: it changes no kind's candidates.
 */
export const RESEARCH_UNLOCKS: readonly ResearchUnlock[] = [
  {
    facilityClass: 'DissBank',
    inventionId: 'Banking',
    why: "TechnologyKind := tidInventionKind_Banking — Model Extensions/Dissidents/DissidentPack1.dpr:327; 'Banking', Model Extensions/Standards.pas:43",
  },
  {
    facilityClass: 'DissTVStation',
    inventionId: 'BasicTelevision',
    why: "TechnologyKind := tidInventionKind_Television — Model Extensions/Dissidents/DissidentPack1.dpr:3441; 'TV', Model Extensions/Standards.pas:37",
  },
];

/** One invention of the research index the gateway serves (`/api/research-inventions`, research.0.dat). */
export interface IndexedInvention {
  id: string;
  name: string;
  /** Prerequisite display names. */
  requires: string[];
}

export interface ResearchIndex {
  byId: Map<string, IndexedInvention>;
  byName: Map<string, IndexedInvention>;
}

/** The research index, as the client reads it. Throws on failure. */
export async function loadResearchIndex(fetchImpl: typeof fetch = fetch): Promise<ResearchIndex> {
  const res = await fetchImpl(`${HTTP_BASE}/api/research-inventions`);
  if (!res.ok) throw new Error(`research index: /api/research-inventions answered ${res.status}`);
  const { inventions } = (await res.json()) as { inventions?: IndexedInvention[] };
  if (!Array.isArray(inventions)) throw new Error('research index: no inventions array');
  const index: ResearchIndex = { byId: new Map(), byName: new Map() };
  for (const inv of inventions) {
    const entry = { id: inv.id, name: inv.name, requires: inv.requires ?? [] };
    index.byId.set(entry.id, entry);
    index.byName.set(entry.name, entry);
  }
  return index;
}

/** `Requires research <name> at <location>.` (`TMetaFacility.EvaluateTexts`, Kernel/Kernel.pas:3312-3315; Kernel/SimHints.pas:390) → the location. */
export function requiredResearchAt(requirement: string | undefined, name: string): string | undefined {
  const prefix = `Requires research ${name} at `;
  const text = (requirement ?? '').trim();
  return text.startsWith(prefix) ? text.slice(prefix.length).replace(/\.$/, '') : undefined;
}

interface Listed {
  state: ResearchState;
  enabled: boolean;
  category: number;
}

/** What one ensureFixtures run learnt about research — read once, updated by its own queues. */
interface ResearchRun {
  session: LiveSession;
  holdings: Holding[];
  deps: FixtureDeps;
  logWindow: () => Promise<LogWindow>;
  index?: ResearchIndex;
  inventory?: Map<string, Listed>;
  reserve?: number | null;
}

async function runIndex(run: ResearchRun): Promise<ResearchIndex> {
  run.index ??= await loadResearchIndex(run.deps.fetchImpl);
  return run.index;
}

/** Every category of the HQ's inventory, up to `CatCount` (the highest index, Kernel/ResearchCenter.pas:820). */
async function runInventory(run: ResearchRun, hq: Holding): Promise<Map<string, Listed>> {
  if (run.inventory) return run.inventory;
  const groups = await readSectionGroups(run.session, hq.x, hq.y, 'hqInventions', hq.visualClass);
  const parsed = Number(propertyValue(groups, 'hqInventions', 'CatCount') ?? '0');
  const catMax = Number.isFinite(parsed) ? parsed : 0;
  const listed = new Map<string, Listed>();
  for (let category = 0; category <= catMax; category++) {
    const { data } = await researchInventory(run.session, hq, category);
    for (const item of [...data.developing, ...data.completed, ...data.available]) {
      listed.set(item.inventionId, {
        state: researchState(data, item.inventionId),
        enabled: data.available.some(i => i.inventionId === item.inventionId && i.enabled === true),
        category,
      });
    }
  }
  run.inventory = listed;
  return listed;
}

/** The live cost of research-roundtrip's own queue, or null when its details show no price. */
async function runReserve(run: ResearchRun, hq: Holding): Promise<number | null> {
  if (run.reserve === undefined) {
    try {
      const details = await readResearchDetails(run.session, hq, RESEARCH_TARGET.id);
      run.reserve = /(?:^|\s)Price:/.test(details.properties) ? researchCost(details.properties) : null;
    } catch {
      run.reserve = null;
    }
  }
  return run.reserve;
}

async function readLevelName(session: LiveSession): Promise<string> {
  try {
    const answer = await session.driver.request<WsRespGetProfile>(
      { type: WsMessageType.REQ_GET_PROFILE },
      WsMessageType.RESP_GET_PROFILE,
    );
    return answer.profile?.levelName?.trim() || '(unread)';
  } catch {
    return '(unread)';
  }
}

type Unproven = Omit<FixtureOutcome, 'kind'>;

/**
 * A kind no candidate of which is offered: research the invention that unlocks it, one step per
 * run. Returns null when the kind has no entry in RESEARCH_UNLOCKS or the build menu has no locked
 * row at all — the caller keeps "no candidate offered". Every other path is unproven or FAIL, and
 * sends at most one `RDOQueueResearch`; it never sends `RDOCancelResearch` (on an owned invention
 * it reaches `RetireInvention`, a sell, Kernel/ResearchCenter.pas:372) and records no pending
 * restore: queued research is permanent fixture setup (doc/E2E-POLICY.md §9).
 */
async function researchUnlock(
  run: ResearchRun,
  kind: FixtureKind,
  locked: BuildingInfo[],
  cash: number | null,
): Promise<{ outcome: Unproven; spent: number } | null> {
  const unlock = RESEARCH_UNLOCKS.find(u => kind.candidates.some(c => c.facilityClass === u.facilityClass));
  if (!unlock || locked.length === 0) return null;
  const done = (reason: string, status: FixtureOutcome['status'] = 'unproven'): { outcome: Unproven; spent: number } => ({
    outcome: { status, facilityClass: unlock.facilityClass, reason },
    spent: 0,
  });
  const { session } = run;
  const company = session.company.name;

  const index = await runIndex(run);
  const target = index.byId.get(unlock.inventionId);
  if (!target) return done(`${unlock.inventionId} is not in the research index`);
  const location = locked.map(r => requiredResearchAt(r.requirement, target.name)).find(l => l !== undefined);
  if (location === undefined) return done(`no locked row requires ${target.name}`);

  const research = FIXTURE_KINDS.find(k => k.id === 'research') as FixtureKind;
  const hq = run.holdings.find(h => carriesKind(h.tabIds.map(id => ({ id })), research));
  if (!hq) return done(`no research fixture — ${target.name} is researched at an HQ (${location}); nothing sent`);
  const at = `${hq.name} (${hq.x},${hq.y})`;
  const inventory = await runInventory(run, hq);
  const stateOf = (id: string): ResearchState => inventory.get(id)?.state ?? 'absent';

  switch (stateOf(target.id)) {
    case 'owned':
      return done(`${target.name} is owned but ${unlock.facilityClass} is still not offered to ${company}`);
    case 'developing':
      return done(`researching ${target.name}`);
    case 'absent':
      return done(`${target.name} is not listed at ${at}; it is researched at ${location}`);
    default:
      break;
  }

  // The chain, prerequisites first. QueueResearch drops an invention not Enabled at queue time
  // (Kernel/ResearchCenter.pas:320), so only the first missing link is queued this run.
  const order: IndexedInvention[] = [];
  const seen = new Set<string>();
  const visit = (inv: IndexedInvention): void => {
    if (seen.has(inv.id)) return;
    seen.add(inv.id);
    for (const name of inv.requires) {
      const pre = index.byName.get(name);
      if (!pre) throw new Error(`prerequisite "${name}" of ${inv.name} is not in the research index`);
      visit(pre);
    }
    order.push(inv);
  };
  visit(target);
  const next = order.find(
    inv => stateOf(inv.id) !== 'owned' && inv.requires.every(n => stateOf((index.byName.get(n) as IndexedInvention).id) === 'owned'),
  ) as IndexedInvention;
  const label = next.id === target.id ? next.name : `${next.name} (for ${target.name})`;
  const nextState = stateOf(next.id);
  if (nextState === 'developing') return done(`researching ${label}`);
  if (nextState === 'absent') return done(`${label} is not listed at ${at}`);
  if (next.id === RESEARCH_TARGET.id) return done(`${label} is research-roundtrip's own target; the builder never queues it`);

  const details = await readResearchDetails(session, hq, next.id);
  if (!(inventory.get(next.id) as Listed).enabled) {
    const level = researchLevel(details.properties) ?? '(unread)';
    return done(
      `${label} needs level ${level}; ${PRIMARY_ACCOUNT.username} is ${await readLevelName(session)} — ` +
        'a level can only be earned, not seeded; nothing sent',
    );
  }

  // A Time > 0 invention is accepted with no cash check and dropped at start when the budget is
  // short (Kernel/ResearchCenter.pas:240-253); a Time = 0 one is bought at once (:319-334).
  const cost = researchCost(details.properties);
  if (cash === null) return done('cash unknown — no EVENT_TYCOON_UPDATE received; nothing sent');
  const reserve = await runReserve(run, hq);
  if (reserve === null) return done(`research reserve unknown — ${RESEARCH_TARGET.name}'s details show no price; nothing sent`);
  const budget = cash - FIXTURE_CASH_FLOOR - reserve;
  if (cost > budget) {
    return done(
      `${label} costs $${cost} (Price + License), above cash $${cash} − floor $${FIXTURE_CASH_FLOOR} − ` +
        `${RESEARCH_TARGET.name} reserve $${reserve}; nothing sent`,
    );
  }

  const window = await run.logWindow();
  await setBuildingProperty(session, hq.x, hq.y, 'RDOQueueResearch', '0', { inventionId: next.id, priority: '10' });
  const line = await awaitMarker(
    window,
    { marker: LOG_MARKERS.RDOQueueResearch, match: l => queueResearchLineMatches(l, next.id) },
    TIMEOUTS.logSettle,
    undefined,
    run.deps.now,
    run.deps.sleep,
  );
  const listed = inventory.get(next.id) as Listed;
  const now = run.deps.now ?? Date.now;
  const sleep = run.deps.sleep ?? defaultSleep;
  const deadline = now() + TIMEOUTS.readBack;
  let after: ResearchState;
  for (;;) {
    after = researchState((await researchInventory(session, hq, listed.category)).data, next.id);
    if (after !== 'available' || now() >= deadline) break;
    await sleep(TIMEOUTS.readBackPoll);
  }
  if (after === 'available') return done(`server did not take the queue for ${label}; not retried`);
  if (after === 'absent') return done(`${next.id} reads absent at ${at} after the queue`, 'FAIL');
  inventory.set(next.id, { ...listed, state: after });
  if (line === null) return { ...done(`no Queue Research: line for ${next.id} at ${at}`, 'FAIL'), spent: cost };
  return { outcome: { status: 'unproven', facilityClass: unlock.facilityClass, logLine: line, reason: `researching ${label}` }, spent: cost };
}
