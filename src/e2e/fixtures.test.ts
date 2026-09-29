import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage } from '@/shared/types/message-types';
import type {
  BuildingInfo,
  DirectoryFacilityRow,
  DirectoryRef,
  FacilityDimensions,
  MapBuilding,
  MapSegment,
} from '@/shared/types/domain-types';
import { SurfaceType } from '@/shared/types/domain-types';
import { ERROR_AreaNotClear, ERROR_TooManyFacilities } from '@/shared/error-codes';
import {
  FIXTURE_CASH_FLOOR,
  FIXTURE_KINDS,
  carriesKind,
  ensureFixtures,
  findFixture,
  findFreeLot,
  isRefusedClass,
  listTycoonFacilities,
  loadTerrain,
  missingGroups,
  newFacilityLineMatches,
  ownLotRefusal,
  parseTerrainBmp,
  placeFacility,
  readCash,
  zoneValueOf,
  type FixtureKind,
  type FixtureKindId,
  type FixtureOutcome,
} from './fixtures';
import { WsDriver, WsDriverError } from './ws-driver';
import * as liveLog from './live-log';
import { PRIMARY_ACCOUNT } from './config';
import type { LiveSession } from './session';

// ---------------------------------------------------------------------------------------------
// A fake world behind a fake driver
// ---------------------------------------------------------------------------------------------

const OWN = 42;
const HALL = { x: 100, y: 200 };
const HELARTIA = 5;
const OTHER_TOWN = 6;
const OWN_COMPANY = 'SPO_test3 - Green';
const ROLE_COMPANY = 'Mayor of Helartia';
const COMPANY_ID = '1';
const MAP_W = 300;
const MAP_H = 300;
const WATER = 0xc0;

const kind = (id: FixtureKindId): FixtureKind => FIXTURE_KINDS.find(k => k.id === id) as FixtureKind;

/** One finished visual class per kind, and the tabs its inspector carries. */
const KIND_VC: Record<FixtureKindId, string> = {
  industry: '4116', store: '4602', warehouse: '532', residential: '4452', research: '602', bank: '2262', tv: '4982',
};
const CONSTRUCTION_VC = '9001';

interface Row {
  x: number;
  y: number;
  name?: string;
}

class World {
  towns: (x: number, y: number) => number = (x, y) =>
    (x === HALL.x && y === HALL.y) || (x >= 110 && x < 130 && y >= 210 && y < 230) ? HELARTIA : OTHER_TOWN;
  zones: (x: number, y: number) => number = () => 0;
  water: (x: number, y: number) => boolean = () => false;
  buildings: MapBuilding[] = [{ ...mb('7010', 0, HALL.x, HALL.y) }];
  segments: MapSegment[] = [];
  dims: Record<string, FacilityDimensions> = {
    '7010': dim('7010', 2, 2, 'TownHall.gif'),
    [CONSTRUCTION_VC]: dim(CONSTRUCTION_VC, 2, 2, 'Construction64.gif'),
  };
  tabs: Record<string, string[]> = {};
  companies = [OWN_COMPANY, ROLE_COMPANY];
  facKinds: Record<string, Record<string, Row[]>> = { [OWN_COMPANY]: {}, [ROLE_COMPANY]: {} };
  buildable: BuildingInfo[] = [];
  cash: string | null = '$50,000,000';
  /** What REQ_PLACE_BUILDING does: a code, and what lands on the lot. */
  place: (cls: string, x: number, y: number) => { code: number; lands?: MapBuilding; line?: string } = (cls, x, y) => ({
    code: 0,
    lands: mb(CONSTRUCTION_VC, OWN, x, y),
    line: `12:00 New Facility: ${cls} Company: ${COMPANY_ID} x: ${x} y: ${y}`,
  });
  logLines: string[] = [];
  requests: WsMessage[] = [];

  constructor() {
    for (const [k, vc] of Object.entries(KIND_VC)) {
      this.dims[vc] = dim(vc, 2, 2, `${k}.gif`);
      this.tabs[vc] = kind(k as FixtureKindId).groups.concat(['finances']);
    }
  }

  /** An owned, finished facility of a kind, listed under SPO_test3's own company. */
  own(k: FixtureKindId, x: number, y: number, opts: { vc?: string; owner?: number; company?: string } = {}): void {
    const vc = opts.vc ?? KIND_VC[k];
    this.buildings.push(mb(vc, opts.owner ?? OWN, x, y));
    const company = opts.company ?? OWN_COMPANY;
    (this.facKinds[company][k] ??= []).push({ x, y, name: `${k} ${x},${y}` });
  }

  offer(facilityClass: string, cost: number, visualClassId = '4601', extra: Partial<BuildingInfo> = {}): void {
    this.buildable.push({
      name: facilityClass, facilityClass, visualClassId, cost, area: 0, description: '', zoneRequirement: '',
      iconPath: '', available: true, xsize: 2, ysize: 2, ...extra,
    });
  }

  respond(msg: WsMessage): unknown {
    this.requests.push(msg);
    const m = msg as WsMessage & Record<string, unknown>;
    switch (msg.type) {
      case WsMessageType.REQ_SEARCH_MENU_TOWNS:
        return { towns: [{ name: 'Helartia', x: HALL.x, y: HALL.y, path: 'p', classId: 'c' }] };
      case WsMessageType.REQ_MAP_LOAD: {
        const { x, y, width, height } = m as unknown as { x: number; y: number; width: number; height: number };
        const inside = (b: { x: number; y: number }) => b.x >= x && b.x < x + width && b.y >= y && b.y < y + height;
        return { type: WsMessageType.RESP_MAP_DATA, data: { buildings: this.buildings.filter(inside), segments: this.segments } };
      }
      case WsMessageType.REQ_GET_SURFACE: {
        const { surfaceType, x1, y1, x2, y2 } = m as unknown as { surfaceType: SurfaceType; x1: number; y1: number; x2: number; y2: number };
        const f = surfaceType === SurfaceType.TOWNS ? this.towns : this.zones;
        const rows: number[][] = [];
        for (let y = y1; y <= y2; y++) {
          const r: number[] = [];
          for (let x = x1; x <= x2; x++) r.push(f(x, y));
          rows.push(r);
        }
        return { data: { rows, width: rows.length, height: rows[0]?.length ?? 0 } };
      }
      case WsMessageType.REQ_GET_ALL_FACILITY_DIMENSIONS:
        return { dimensions: this.dims, civicVisualClassIds: [] };
      case WsMessageType.REQ_SEARCH_MENU_DIRECTORY: {
        const ref = m.ref as DirectoryRef;
        if (ref.kind === 'tycoon-companies') return { page: { kind: 'folder', items: this.companies, ownedBy: null } };
        if (ref.kind === 'tycoon-company') {
          return { page: { kind: 'folder', items: Object.keys(this.facKinds[ref.company] ?? {}), ownedBy: null } };
        }
        if (ref.kind === 'tycoon-facility-kind') {
          const rows = this.facKinds[ref.company]?.[ref.facKind] ?? [];
          const facilities: DirectoryFacilityRow[] = rows.map(r => ({
            name: r.name ?? 'f', itemName: 'i', path: 'p', iconUrl: '', company: ref.company, x: r.x, y: r.y,
          }));
          return { page: { kind: 'facility-list', facilities } };
        }
        return { page: { kind: 'folder', items: [], ownedBy: null } };
      }
      case WsMessageType.REQ_BUILDING_DETAILS: {
        const tabs = (this.tabs[m.visualClass as string] ?? []).map(id => ({ id, name: id, icon: '', order: 0, handlerName: id }));
        return { details: { tabs, groups: {} } };
      }
      case WsMessageType.REQ_GET_BUILDING_CATEGORIES:
        return {
          categories: [
            { kindName: 'Commerce', kind: 'K1', cluster: 'PGI', folder: 'f1', tycoonLevel: 0, iconPath: '' },
            { kindName: 'Media', kind: 'K2', cluster: 'PGI', folder: 'f2', tycoonLevel: 1, iconPath: '' },
          ],
        };
      case WsMessageType.REQ_GET_BUILDING_FACILITIES:
        // Everything under the first category, plus a locked row that must never be picked.
        return m.kind === 'K1'
          ? { facilities: this.buildable }
          : { facilities: [{ ...this.buildable[0], facilityClass: 'PGITVStation', cost: 1, available: false }].filter(f => f.name) };
      case WsMessageType.REQ_PLACE_BUILDING: {
        const r = this.place(m.facilityClass as string, m.x as number, m.y as number);
        if (r.line) this.logLines.push(r.line);
        if (r.code !== 0) return new WsDriverError('refused', r.code, WsMessageType.REQ_PLACE_BUILDING);
        if (r.lands) this.buildings.push(r.lands);
        return { type: WsMessageType.RESP_BUILDING_PLACED, x: m.x, y: m.y };
      }
      default:
        return undefined;
    }
  }

  session(): LiveSession {
    const seen = (type: WsMessageType): WsMessage[] => {
      if (type === WsMessageType.RESP_LOGIN_SUCCESS) return [{ type, tycoonId: String(OWN) } as WsMessage];
      if (type === WsMessageType.EVENT_TYCOON_UPDATE) {
        return this.cash === null ? [] : [{ type, cash: '$1' } as WsMessage, { type, cash: this.cash } as WsMessage];
      }
      return [];
    };
    return {
      driver: {
        close: jest.fn(),
        log: [],
        errors: [],
        send: jest.fn(),
        seen: jest.fn(seen),
        waitFor: jest.fn(async () => {
          if (this.cash === null) throw new Error('Timed out');
          return seen(WsMessageType.EVENT_TYCOON_UPDATE)[0];
        }),
        request: jest.fn(async (msg: WsMessage) => {
          const r = this.respond(msg);
          if (r instanceof Error) throw r;
          return r;
        }),
      } as unknown as WsDriver,
      account: PRIMARY_ACCOUNT,
      company: { id: COMPANY_ID, name: OWN_COMPANY },
      worlds: 1,
      companies: [],
      world: { name: 'planitia' } as LiveSession['world'],
      playerX: 0,
      playerY: 0,
    };
  }

  /** The terrain BMP, bottom-up, 8-bit, rows padded to 4 bytes. */
  fetchImpl(): jest.Mock {
    const bmp = makeBmp(MAP_W, MAP_H, (x, y) => (this.water(x, y) ? WATER : 0));
    return jest.fn(async (url: string) =>
      url.includes('/api/map-data/')
        ? { ok: true, status: 200, json: async () => ({ bmpUrl: '/proxy/planitia.bmp' }) }
        : { ok: true, status: 200, arrayBuffer: async () => bmp },
    );
  }

  placed(): WsMessage[] {
    return this.requests.filter(r => r.type === WsMessageType.REQ_PLACE_BUILDING);
  }
}

function mb(visualClass: string, tycoonId: number, x: number, y: number): MapBuilding {
  return { visualClass, tycoonId, options: 0, x, y, level: 0, alert: false, attack: 0 };
}

function dim(visualClass: string, xsize: number, ysize: number, textureFilename: string): FacilityDimensions {
  return { visualClass, name: visualClass, facid: '', xsize, ysize, level: 0, textureFilename };
}

function makeBmp(width: number, height: number, pixel: (x: number, y: number) => number, topDown = false): ArrayBuffer {
  const stride = Math.ceil(width / 4) * 4;
  const dataOffset = 14 + 40 + 256 * 4;
  const buf = new ArrayBuffer(dataOffset + stride * height);
  const v = new DataView(buf);
  v.setUint8(0, 0x42);
  v.setUint8(1, 0x4d);
  v.setUint32(10, dataOffset, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, topDown ? -height : height, true);
  v.setUint16(28, 8, true);
  v.setUint32(30, 0, true);
  const bytes = new Uint8Array(buf);
  for (let y = 0; y < height; y++) {
    const row = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) bytes[dataOffset + row * stride + x] = pixel(x, y);
  }
  return buf;
}

/** A clock that runs out any poll at its second read. */
function fastClock(): { now: () => number; sleep: jest.Mock } {
  let t = 0;
  return { now: () => (t += 100_000), sleep: jest.fn(async () => undefined) };
}

function spyLog(w: World) {
  jest.spyOn(liveLog, 'findCurrentSurvivalLog').mockResolvedValue('http://logs/Survival.log');
  const open = jest.spyOn(liveLog, 'openLogWindow').mockResolvedValue({ url: 'u', offset: 0, openedAt: 'now' });
  const marker = jest.spyOn(liveLog, 'awaitMarker').mockImplementation((async (_w: unknown, proof: liveLog.LogProof) =>
    w.logLines.find(l => l.includes(proof.marker) && (proof.match?.(l) ?? true)) ?? null) as typeof liveLog.awaitMarker);
  return { open, marker };
}

/** Every kind present except the listed ones. */
function ownAllBut(w: World, ...missing: FixtureKindId[]): void {
  let x = 110;
  for (const k of FIXTURE_KINDS) {
    if (missing.includes(k.id)) continue;
    w.own(k.id, x, 228);
    x += 2;
  }
}

async function ensure(w: World, deps: Parameters<typeof ensureFixtures>[1] = {}): Promise<Record<string, FixtureOutcome>> {
  const out = await ensureFixtures(w.session(), { survivalLogUrl: 'log', fetchImpl: w.fetchImpl(), ...fastClock(), ...deps });
  return Object.fromEntries(out.map(o => [o.kind, o]));
}

afterEach(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------------------------
// The kind table
// ---------------------------------------------------------------------------------------------

describe('FIXTURE_KINDS', () => {
  it('names the seven kinds with the groups the card requires', () => {
    expect(Object.fromEntries(FIXTURE_KINDS.map(k => [k.id, k.groups]))).toEqual({
      industry: ['indGeneral', 'supplies', 'products'],
      store: ['srvGeneral', 'supplies'],
      warehouse: ['whGeneral'],
      residential: ['resGeneral'],
      research: ['hqInventions'],
      bank: ['bankGeneral'],
      tv: ['tvGeneral'],
    });
  });

  it('commits no candidate placeFacility refuses, and no mausoleum or studio', () => {
    const all = FIXTURE_KINDS.flatMap(k => k.candidates);
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      expect(isRefusedClass(c.facilityClass)).toBe(false);
      expect(c.facilityClass).not.toMatch(/Movie|Studio/);
      expect(c.why).toMatch(/\.dpr:\d+/);
    }
  });

  it('checks a template against a kind by exact group id', () => {
    expect(carriesKind([{ id: 'indGeneral' }, { id: 'supplies' }, { id: 'products' }], kind('industry'))).toBe(true);
    expect(missingGroups([{ id: 'indGeneral' }, { id: 'supplies-2' }], kind('industry'))).toEqual(['supplies', 'products']);
  });

  it('keeps the cash floor at ten million', () => {
    expect(FIXTURE_CASH_FLOOR).toBe(10_000_000);
  });
});

describe('small readers', () => {
  it('reads the zone colour the way the client does', () => {
    expect(zoneValueOf('Building must be located in blue zone or no zone at all.')).toBe(7);
    expect(zoneValueOf('RED zone')).toBe(2);
    expect(zoneValueOf('anywhere')).toBe(0);
    expect(zoneValueOf('')).toBe(0);
  });

  it('reads a bottom-up BMP with padded rows, and a top-down one', () => {
    const px = (x: number, y: number) => x * 10 + y;
    const up = parseTerrainBmp(makeBmp(3, 2, px));
    expect([up.width, up.height]).toEqual([3, 2]);
    expect([up.landId(0, 0), up.landId(2, 0), up.landId(1, 1), up.landId(2, 1)]).toEqual([0, 20, 11, 21]);
    expect(up.landId(3, 0)).toBeUndefined();
    expect(up.landId(0, -1)).toBeUndefined();
    const down = parseTerrainBmp(makeBmp(3, 2, px, true));
    expect([down.landId(0, 1), down.landId(2, 0)]).toEqual([1, 20]);
  });

  it('refuses a file that is not an 8-bit uncompressed BMP', () => {
    expect(() => parseTerrainBmp(new ArrayBuffer(64))).toThrow('not a BMP');
    const deep = makeBmp(2, 2, () => 0);
    new DataView(deep).setUint16(28, 24, true);
    expect(() => parseTerrainBmp(deep)).toThrow('unsupported BMP');
  });

  it('reads the last cash event, and none as unknown', async () => {
    const w = new World();
    w.cash = '$1,234,567.50';
    expect(await readCash(w.session())).toBe(1234567.5);
    w.cash = 'n/a';
    expect(await readCash(w.session())).toBeNull();
    w.cash = null;
    expect(await readCash(w.session())).toBeNull();
  });

  it('matches the New Facility line on class, company and position, whole numbers only', () => {
    const line = '12:00 New Facility: PGIFoodStore Company: 1 x: 120 y: 12';
    expect(newFacilityLineMatches(line, 'PGIFoodStore', '1', 120, 12)).toBe(true);
    expect(newFacilityLineMatches(`${line}3`, 'PGIFoodStore', '1', 120, 12)).toBe(false);
    expect(newFacilityLineMatches(line, 'PGIFoodStore', '2', 120, 12)).toBe(false);
    expect(newFacilityLineMatches(line, 'PGIFood', '1', 120, 12)).toBe(false);
  });

  it('throws on a failed terrain read, and retries it next time', async () => {
    const w = new World();
    const s = w.session();
    const bad = jest.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(loadTerrain(s, bad)).rejects.toThrow('map-data 500');
    const noBmp = jest.fn(async (url: string) =>
      url.includes('/api/') ? { ok: true, json: async () => ({ bmpUrl: '/x.bmp' }) } : { ok: false, status: 404 },
    ) as unknown as typeof fetch;
    await expect(loadTerrain(s, noBmp)).rejects.toThrow('BMP 404');
    const good = w.fetchImpl();
    await expect(loadTerrain(s, good as unknown as typeof fetch)).resolves.toMatchObject({ width: MAP_W });
    expect(good).toHaveBeenCalledWith(expect.stringMatching(/\/api\/map-data\/planitia$/));
  });
});

// ---------------------------------------------------------------------------------------------
// placeFacility
// ---------------------------------------------------------------------------------------------

describe('placeFacility', () => {
  it.each(['ParadigmMausoleum', 'LegendMausoleum', 'SPECIALCOMMONParadigmMausoleum', 'Capitol'])(
    'refuses %s without sending anything',
    async cls => {
      const w = new World();
      const s = w.session();
      await expect(placeFacility(s, cls, 120, 220)).rejects.toThrow(/refuses/);
      expect(s.driver.request).not.toHaveBeenCalled();
    },
  );

  it('confirms a construction site owned by SPO_test3 at the lot', async () => {
    const w = new World();
    const r = await placeFacility(w.session(), 'PGIFoodStore', 120, 220, fastClock());
    expect(r).toEqual({ code: 0, readBack: { visualClass: CONSTRUCTION_VC, tycoonId: '42', construction: true }, confirmed: true });
  });

  it('confirms the placed class once finished (registered + 1)', async () => {
    const w = new World();
    w.place = (_c, x, y) => ({ code: 0, lands: mb('4602', OWN, x, y) });
    const r = await placeFacility(w.session(), 'PGIFoodStore', 120, 220, { visualClassId: '4601', ...fastClock() });
    expect(r.confirmed).toBe(true);
    expect(r.readBack?.construction).toBe(false);
  });

  it('does not confirm another class, and polls until the bound', async () => {
    const w = new World();
    w.place = (_c, x, y) => ({ code: 0, lands: mb('4116', OWN, x, y) });
    const clock = fastClock();
    const r = await placeFacility(w.session(), 'PGIFoodStore', 120, 220, { visualClassId: '4601', ...clock });
    expect(r.confirmed).toBe(false);
    expect(r.readBack?.visualClass).toBe('4116');
    expect(clock.sleep).toHaveBeenCalled();
  });

  it("does not confirm another tycoon's site", async () => {
    const w = new World();
    w.place = (_c, x, y) => ({ code: 0, lands: mb(CONSTRUCTION_VC, 77, x, y) });
    const r = await placeFacility(w.session(), 'PGIFoodStore', 120, 220, fastClock());
    expect(r).toMatchObject({ code: 0, confirmed: false, readBack: { tycoonId: '77' } });
  });

  it("returns the server's refusal code with no read-back", async () => {
    const w = new World();
    w.place = () => ({ code: ERROR_TooManyFacilities });
    const s = w.session();
    expect(await placeFacility(s, 'PGIFoodStore', 120, 220)).toEqual({ code: 33, readBack: null, confirmed: false });
    expect(w.requests.filter(r => r.type === WsMessageType.REQ_MAP_LOAD)).toHaveLength(0);
  });

  it('rethrows anything that is not the placement refusal', async () => {
    const w = new World();
    const s = w.session();
    (s.driver.request as jest.Mock).mockRejectedValueOnce(new Error('socket died'));
    await expect(placeFacility(s, 'PGIFoodStore', 120, 220)).rejects.toThrow('socket died');
    (s.driver.request as jest.Mock).mockRejectedValueOnce(new WsDriverError('x', 3, WsMessageType.REQ_MAP_LOAD));
    await expect(placeFacility(s, 'PGIFoodStore', 120, 220)).rejects.toThrow('x');
  });

  it('throws when the login carried no tycoon id', async () => {
    const w = new World();
    const s = w.session();
    (s.driver.seen as jest.Mock).mockReturnValue([]);
    await expect(placeFacility(s, 'PGIFoodStore', 120, 220, fastClock())).rejects.toThrow('tycoonId');
  });
});

// ---------------------------------------------------------------------------------------------
// findFreeLot
// ---------------------------------------------------------------------------------------------

describe('findFreeLot', () => {
  /** Helartia is a single 2×2 blue lot at (120,220) (plus the hall tile). */
  function oneLot(): World {
    const w = new World();
    const inLot = (x: number, y: number) => x >= 120 && x < 122 && y >= 220 && y < 222;
    w.towns = (x, y) => ((x === HALL.x && y === HALL.y) || inLot(x, y) ? HELARTIA : OTHER_TOWN);
    w.zones = (x, y) => (inLot(x, y) ? 7 : 0);
    return w;
  }
  const lot = (w: World, zone = 'blue zone') =>
    findFreeLot(w.session(), { xsize: 2, ysize: 2 }, zone, { fetchImpl: w.fetchImpl() as unknown as typeof fetch });

  it('returns the only passing lot', async () => {
    expect(await lot(oneLot())).toEqual({ x: 120, y: 220 });
  });

  it('refuses a lot with a tile of the wrong zone', async () => {
    const w = oneLot();
    const base = w.zones;
    w.zones = (x, y) => (x === 121 && y === 221 ? 2 : base(x, y));
    expect(await lot(w)).toBeNull();
  });

  it('refuses a reserved tile even with no zone requirement', async () => {
    const w = oneLot();
    expect(await lot(w, '')).toEqual({ x: 120, y: 220 });
    w.zones = (x, y) => (x === 120 && y === 220 ? 1 : 7);
    expect(await lot(w, '')).toBeNull();
  });

  it('refuses a lot with a water tile', async () => {
    const w = oneLot();
    w.water = (x, y) => x === 121 && y === 220;
    expect(await lot(w)).toBeNull();
  });

  it("refuses a lot with another town's tile", async () => {
    const w = oneLot();
    const base = w.towns;
    w.towns = (x, y) => (x === 120 && y === 221 ? OTHER_TOWN : base(x, y));
    expect(await lot(w)).toBeNull();
  });

  it('refuses a lot an object covers, even anchored outside it', async () => {
    const w = oneLot();
    w.buildings.push(mb('4116', 77, 119, 219)); // 2×2 from (119,219) reaches (120,220)
    expect(await lot(w)).toBeNull();
  });

  it('refuses a lot a road crosses', async () => {
    const w = oneLot();
    w.segments.push({ x1: 125, y1: 221, x2: 118, y2: 221, unknown1: 0, unknown2: 0, unknown3: 0, unknown4: 0, unknown5: 0, unknown6: 0 });
    expect(await lot(w)).toBeNull();
  });

  it('returns the lot nearest the hall', async () => {
    const w = new World();
    w.towns = () => HELARTIA;
    expect(await findFreeLot(w.session(), { xsize: 1, ysize: 1 }, '', { fetchImpl: w.fetchImpl() as unknown as typeof fetch }))
      .toEqual({ x: 99, y: 199 });
  });

  it('finds nothing when the hall tile reads no town value', async () => {
    const w = new World();
    const s = w.session();
    const inner = s.driver.request as jest.Mock;
    const real = inner.getMockImplementation() as (m: WsMessage) => Promise<unknown>;
    inner.mockImplementation(async (m: WsMessage) =>
      m.type === WsMessageType.REQ_GET_SURFACE ? { data: { rows: [] } } : real(m));
    expect(await findFreeLot(s, { xsize: 1, ysize: 1 }, '', { fetchImpl: w.fetchImpl() as unknown as typeof fetch })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// findFixture
// ---------------------------------------------------------------------------------------------

describe('findFixture', () => {
  it("finds SPO_test3's own finished facility of the kind in Helartia", async () => {
    const w = new World();
    w.own('industry', 120, 220);
    expect(await findFixture(w.session(), kind('industry'))).toEqual({
      kind: 'industry',
      found: { x: 120, y: 220, visualClass: '4116', name: 'industry 120,220' },
    });
  });

  it('ignores a matching facility outside Helartia (another TOWNS value)', async () => {
    const w = new World();
    w.own('industry', 60, 60);
    expect(await findFixture(w.session(), kind('industry'))).toEqual({ kind: 'industry', reason: 'none in Helartia' });
  });

  it.each([
    ['another player', 77],
    ['the Mayor role tycoon', 88],
  ])('ignores one whose lot reads %s', async (_label, owner) => {
    const w = new World();
    w.own('industry', 120, 220, { owner });
    expect((await findFixture(w.session(), kind('industry'))).found).toBeUndefined();
  });

  it('ignores one the directory lists only under the role company', async () => {
    const w = new World();
    w.own('industry', 120, 220, { company: ROLE_COMPANY });
    const r = await findFixture(w.session(), kind('industry'));
    expect(r.found).toBeUndefined();
    const asked = w.requests
      .filter(q => q.type === WsMessageType.REQ_SEARCH_MENU_DIRECTORY)
      .map(q => (q as unknown as { ref: DirectoryRef }).ref);
    expect(asked.some(ref => 'company' in ref && ref.company === ROLE_COMPANY)).toBe(false);
  });

  it('reports under construction for an owned construction site', async () => {
    const w = new World();
    w.own('industry', 120, 220, { vc: CONSTRUCTION_VC });
    expect(await findFixture(w.session(), kind('industry'))).toEqual({ kind: 'industry', reason: 'under construction' });
  });

  it('skips a row with nothing anchored at it, and one of another kind', async () => {
    const w = new World();
    w.facKinds[OWN_COMPANY].industry = [{ x: 121, y: 221 }];
    w.own('store', 120, 224);
    expect(await findFixture(w.session(), kind('industry'))).toEqual({ kind: 'industry', reason: 'none in Helartia' });
  });

  it('finds nothing when the own company is not listed', async () => {
    const w = new World();
    w.own('industry', 120, 220);
    w.companies = [ROLE_COMPANY];
    expect((await findFixture(w.session(), kind('industry'))).found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// ownLotRefusal and listTycoonFacilities (#1153)
// ---------------------------------------------------------------------------------------------

describe('ownLotRefusal', () => {
  it("is null for SPO_test3's own facility in Helartia", async () => {
    const w = new World();
    w.own('warehouse', 120, 220);
    expect(await ownLotRefusal(w.session(), 120, 220)).toBeNull();
  });

  it('refuses a lot outside Helartia, before reading the map', async () => {
    const w = new World();
    w.own('warehouse', 60, 60);
    expect(await ownLotRefusal(w.session(), 60, 60)).toBe(`(60,60) is not in Helartia (TOWNS ${OTHER_TOWN}, Helartia ${HELARTIA})`);
    expect(w.requests.some(r => r.type === WsMessageType.REQ_MAP_LOAD)).toBe(false);
  });

  it('refuses a lot with no building anchored at it', async () => {
    const w = new World();
    expect(await ownLotRefusal(w.session(), 121, 221)).toBe('no building anchored at (121,221)');
  });

  it("refuses another player's facility, naming its owner", async () => {
    const w = new World();
    w.own('warehouse', 120, 220, { owner: 77 });
    expect(await ownLotRefusal(w.session(), 120, 220)).toBe(`(120,220) is owned by tycoon 77, not SPO_test3 (${OWN})`);
  });
});

describe('listTycoonFacilities', () => {
  it('walks every company the directory lists, in any town, with every facility row', async () => {
    const w = new World();
    w.own('industry', 120, 220);
    w.own('warehouse', 60, 60);
    w.own('store', 124, 224, { company: ROLE_COMPANY });
    expect(await listTycoonFacilities(w.session())).toEqual({
      companies: [OWN_COMPANY, ROLE_COMPANY],
      facilities: [
        { company: OWN_COMPANY, x: 120, y: 220, name: 'industry 120,220' },
        { company: OWN_COMPANY, x: 60, y: 60, name: 'warehouse 60,60' },
        { company: ROLE_COMPANY, x: 124, y: 224, name: 'store 124,224' },
      ],
    });
  });

  it('returns nothing when the tycoon page is not a folder', async () => {
    const w = new World();
    const s = w.session();
    (s.driver.request as jest.Mock).mockImplementation(async () => ({ page: { kind: 'facility', facility: null } }));
    expect(await listTycoonFacilities(s)).toEqual({ companies: [], facilities: [] });
  });

  it('skips a company or a kind whose page is not the expected shape', async () => {
    const w = new World();
    w.own('industry', 120, 220);
    const s = w.session();
    const respond = w.respond.bind(w);
    (s.driver.request as jest.Mock).mockImplementation(async (msg: WsMessage) => {
      const ref = (msg as unknown as { ref: DirectoryRef }).ref;
      if (ref.kind === 'tycoon-company' && ref.company === ROLE_COMPANY) return { page: { kind: 'facility', facility: null } };
      if (ref.kind === 'tycoon-facility-kind') return { page: { kind: 'folder', items: [], ownedBy: null } };
      return respond(msg);
    });
    expect(await listTycoonFacilities(s)).toEqual({ companies: [OWN_COMPANY, ROLE_COMPANY], facilities: [] });
  });
});

// ---------------------------------------------------------------------------------------------
// ensureFixtures
// ---------------------------------------------------------------------------------------------

describe('ensureFixtures', () => {
  it('places nothing, and lists nothing to build, when every kind is present', async () => {
    const w = new World();
    ownAllBut(w);
    const out = await ensure(w);
    expect(Object.values(out).map(o => o.status)).toEqual(Array(7).fill('found'));
    expect(out.industry).toMatchObject({ x: 110, y: 228, visualClass: '4116' });
    expect(w.placed()).toHaveLength(0);
    expect(w.requests.some(r => r.type === WsMessageType.REQ_GET_BUILDING_CATEGORIES)).toBe(false);
  });

  it('blocks every placement while the directory lists an owned construction site', async () => {
    const w = new World();
    ownAllBut(w, 'store', 'tv');
    w.own('store', 126, 220, { vc: CONSTRUCTION_VC });
    w.offer('PGIFoodStore', 1);
    const out = await ensure(w);
    expect(w.placed()).toHaveLength(0);
    expect(out.store).toMatchObject({ status: 'under construction', reason: expect.stringMatching(/construction site/) });
    expect(out.tv.status).toBe('under construction');
    expect(out.industry.status).toBe('found');
  });

  it('blocks every placement on an owned construction site present at the start with no record anywhere', async () => {
    const w = new World();
    ownAllBut(w, 'bank');
    w.buildings.push(mb(CONSTRUCTION_VC, OWN, 124, 224)); // on the map only — not in the directory
    w.offer('DissBank', 1);
    const out = await ensure(w);
    expect(w.placed()).toHaveLength(0);
    expect(out.bank.status).toBe('under construction');
  });

  it("does not count another player's construction site, nor an owned one outside Helartia", async () => {
    const w = new World();
    ownAllBut(w, 'bank');
    w.buildings.push(mb(CONSTRUCTION_VC, 77, 124, 224), mb(CONSTRUCTION_VC, OWN, 80, 180));
    const out = await ensure(w);
    expect(out.bank).toMatchObject({ status: 'unproven', reason: `no candidate offered to ${OWN_COMPANY}` });
  });

  it('places exactly one facility per missing kind — the cheapest offered, affordable candidate', async () => {
    const w = new World();
    ownAllBut(w, 'store', 'tv');
    spyLog(w);
    w.offer('MagnaSupermarketA', 45_000_000); // above 50M - floor
    w.offer('PGIFoodStore', 3_000_000);
    w.offer('MarikoFoodStore', 2_000_000);
    w.offer('SomethingElse', 1); // not a candidate
    w.offer('PGITVStation', 20_000_000);
    const out = await ensure(w);
    expect(w.placed().map(p => (p as unknown as { facilityClass: string }).facilityClass)).toEqual(['MarikoFoodStore', 'PGITVStation']);
    expect(out.store).toMatchObject({
      status: 'built', facilityClass: 'MarikoFoodStore', visualClass: CONSTRUCTION_VC,
      logLine: expect.stringMatching(/New Facility: MarikoFoodStore Company: 1/),
    });
    expect(out.tv.status).toBe('built');
    const [a, b] = [out.store, out.tv];
    expect(`${a.x},${a.y}`).not.toBe(`${b.x},${b.y}`);
  });

  it('spends what it built: a second kind the remaining cash cannot afford stays unproven', async () => {
    const w = new World();
    ownAllBut(w, 'store', 'tv');
    spyLog(w);
    w.cash = '$40,000,000';
    w.offer('PGIFoodStore', 20_000_000);
    w.offer('PGITVStation', 20_000_000);
    const out = await ensure(w);
    expect(out.store.status).toBe('built');
    expect(out.tv).toMatchObject({ status: 'unproven', reason: 'cost 20000000 exceeds the cash floor' });
    expect(w.placed()).toHaveLength(1);
  });

  it('resolves the Survival log once, lazily, when none is injected', async () => {
    const w = new World();
    ownAllBut(w, 'store', 'tv');
    spyLog(w);
    w.offer('PGIFoodStore', 1);
    w.offer('PGITVStation', 1);
    await ensure(w, { survivalLogUrl: undefined });
    expect(liveLog.findCurrentSurvivalLog).toHaveBeenCalledTimes(1);
    expect(liveLog.openLogWindow).toHaveBeenCalledWith('http://logs/Survival.log');
  });

  it('builds a finished facility carrying its groups', async () => {
    const w = new World();
    ownAllBut(w, 'store');
    spyLog(w);
    w.offer('PGIFoodStore', 1, '4601');
    w.place = (cls, x, y) => ({ code: 0, lands: mb('4602', OWN, x, y), line: `New Facility: ${cls} Company: 1 x: ${x} y: ${y}` });
    const out = await ensure(w);
    expect(out.store).toMatchObject({ status: 'built', visualClass: '4602' });
  });

  it('FAILs naming the class when a finished fixture from a candidate lacks the kind groups', async () => {
    const w = new World();
    ownAllBut(w, 'store');
    spyLog(w);
    w.offer('PGIFoodStore', 1, '4601');
    w.tabs['4602'] = ['srvGeneral']; // no supplies
    w.place = (cls, x, y) => ({ code: 0, lands: mb('4602', OWN, x, y), line: `New Facility: ${cls} Company: 1 x: ${x} y: ${y}` });
    const out = await ensure(w);
    expect(out.store.status).toBe('FAIL');
    expect(out.store.reason).toMatch(/candidate PGIFoodStore \(visual class 4602\) built a facility without supplies/);
  });

  it.each<[string, (w: World) => void, RegExp]>([
    ['a kind not offered', () => undefined, /no candidate offered/],
    ['a cost above the cash floor', w => { w.cash = '$12,000,000'; w.offer('PGIFoodStore', 3_000_000); }, /cost 3000000 exceeds the cash floor/],
    ['no cash event', w => { w.cash = null; w.offer('PGIFoodStore', 1); }, /cash unknown/],
    ['no free lot', w => { w.towns = (x, y) => (x === HALL.x && y === HALL.y ? HELARTIA : OTHER_TOWN); w.offer('PGIFoodStore', 1); }, /no free lot in Helartia/],
    ['an unknown footprint', w => { w.offer('PGIFoodStore', 1, '1234', { xsize: undefined, ysize: undefined }); }, /footprint unknown/],
  ])('records unproven without placing for %s', async (_label, arrange, reason) => {
    const w = new World();
    ownAllBut(w, 'store');
    spyLog(w);
    arrange(w);
    const out = await ensure(w);
    expect(out.store).toMatchObject({ status: 'unproven', reason: expect.stringMatching(reason) });
    expect(w.placed()).toHaveLength(0);
  });

  it('takes the footprint from the dimensions when the build menu gives none', async () => {
    const w = new World();
    ownAllBut(w, 'store');
    spyLog(w);
    w.offer('PGIFoodStore', 1, '4602', { xsize: undefined, ysize: undefined });
    expect((await ensure(w)).store.status).toBe('built');
  });

  it('records ERROR_TooManyFacilities as unproven', async () => {
    const w = new World();
    ownAllBut(w, 'research');
    spyLog(w);
    w.offer('PGIGeneralHeadquarterSTA', 1);
    w.place = () => ({ code: ERROR_TooManyFacilities });
    const out = await ensure(w);
    expect(out.research).toMatchObject({ status: 'unproven', reason: 'facility limit or company uniqueness' });
  });

  it('FAILs on any other non-zero code', async () => {
    const w = new World();
    ownAllBut(w, 'store');
    spyLog(w);
    w.offer('PGIFoodStore', 1);
    w.place = () => ({ code: ERROR_AreaNotClear });
    const out = await ensure(w);
    expect(out.store).toMatchObject({ status: 'FAIL', reason: expect.stringMatching(/NewFacility answered 3 for PGIFoodStore/) });
  });

  it.each<[string, (x: number, y: number) => MapBuilding | undefined]>([
    ['nothing at the lot', () => undefined],
    ['another class at the lot', (x, y) => mb('4116', OWN, x, y)],
    ["another tycoon's site at the lot", (x, y) => mb(CONSTRUCTION_VC, 77, x, y)],
  ])('FAILs on code 0 with %s', async (_label, lands) => {
    const w = new World();
    ownAllBut(w, 'store');
    spyLog(w);
    w.offer('PGIFoodStore', 1);
    w.place = (cls, x, y) => ({ code: 0, lands: lands(x, y), line: `New Facility: ${cls} Company: 1 x: ${x} y: ${y}` });
    const out = await ensure(w);
    expect(out.store).toMatchObject({ status: 'FAIL', reason: expect.stringMatching(/nothing of PGIFoodStore .* reads back/) });
  });

  it.each<[string, (cls: string, x: number, y: number) => string | undefined]>([
    ['no line at all', () => undefined],
    ['a line with another company', (cls, x, y) => `New Facility: ${cls} Company: 9 x: ${x} y: ${y}`],
    ['a line whose y only starts with the lot y', (cls, x, y) => `New Facility: ${cls} Company: 1 x: ${x} y: ${y}3`],
    ['a line with another class', (_c, x, y) => `New Facility: PGITVStation Company: 1 x: ${x} y: ${y}`],
  ])('FAILs on code 0 and a read-back, with %s', async (_label, line) => {
    const w = new World();
    ownAllBut(w, 'store');
    spyLog(w);
    w.offer('PGIFoodStore', 1);
    w.place = (cls, x, y) => ({ code: 0, lands: mb(CONSTRUCTION_VC, OWN, x, y), line: line(cls, x, y) });
    const out = await ensure(w);
    expect(out.store).toMatchObject({ status: 'FAIL', reason: expect.stringMatching(/no New Facility: line for PGIFoodStore, company 1/) });
  });

  it('never picks a locked build-menu row', async () => {
    const w = new World();
    ownAllBut(w, 'tv');
    spyLog(w);
    w.offer('PGIFoodStore', 1); // the locked PGITVStation row rides in the second category
    const out = await ensure(w);
    expect(out.tv.status).toBe('unproven');
    expect(w.placed()).toHaveLength(0);
  });
});
