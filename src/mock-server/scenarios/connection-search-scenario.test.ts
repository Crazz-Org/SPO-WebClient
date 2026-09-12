/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * The `Role` argument of the two searches, checked where it is actually built.
 *
 * The assertion that matters is the ninth argument of the frame the real
 * gateway emits: `"#54"` for a supplier search with every box ticked, `"#78"`
 * for a customer search. 54 is not a number chosen here — it is the `#54` of the
 * captured trace (`src/server/__tests__/rdo/connection-search.test.ts:9`), and
 * the client used to send 27 for the same four boxes.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoProtocol } from '@/server/rdo';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import { RdoValue } from '@/shared/rdo-types';
import {
  ALL_CONNECTION_ROLES, rolesToMask, type ConnectionRoleFlags,
} from '@/shared/connection-roles';
import { searchConnections } from '@/server/session/politics-handler';
import { resolveRoadReachability } from '@/server/session/connection-reachability';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '@/server/__tests__/session/fake-session-context';
import { RdoMock } from '../rdo-mock';
import type { RdoPacket } from '@/shared/types';
import {
  createConnectionSearchScenario,
  connectionSearchArgs,
  CONNECTION_SEARCH_CACHER_ID,
  CONNECTION_SEARCH_QUERY,
  ROLE_ARG_INDEX,
  SORT_MODE_ARG_INDEX,
  QUALITY_SORT_MODE,
  SUPPLIER_SEARCH_ROLE,
  CLIENT_SEARCH_ROLE,
  REACHABILITY_TEMP_OBJECT,
  CONNECTION_SEARCH_ROWS,
  BUILDING_NEAR_CIRCUITS,
} from './connection-search-scenario';

const { rdo } = createConnectionSearchScenario();

const NO_ROLES: ConnectionRoleFlags = {
  producer: false, distributer: false, importer: false,
  exporter: false, buyer: false, compImporter: false,
};

/**
 * Drive the real gateway with the captured query and give back the frame it
 * put on the wire. Nothing here builds a frame by hand.
 */
async function emit(direction: 'input' | 'output', roles: number, sortMode?: number) {
  const fake = makeSessionCtx({
    currentWorldInfo: { name: 'Shamba', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 7000 },
  });
  fake.respond(() => 'res="%"');

  const q = CONNECTION_SEARCH_QUERY;
  await searchConnections(fake.ctx, q.x, q.y, q.fluidId, direction, { roles, sortMode });

  expect(fake.sent).toHaveLength(1);
  const packet = fake.sent[0].packet;
  return { packet, frame: `${RdoProtocol.format(packet as never)};` };
}

describe('connection-search scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('both searches are 9-argument functions, so both frames carry "^"', () => {
    for (const member of ['FindSuppliers', 'FindClients'] as const) {
      expect(RDO_MEMBERS[member].kind).toBe('function');
      expect(RDO_MEMBERS[member]).toHaveProperty('arity', 9);
    }
    for (const ex of rdo.exchanges) {
      expect(ex.request).toContain('"^"');
      expect(ex.request).not.toContain('"*"');
    }
  });

  it('SetObject and GetPropertyList — the reachability sweep\'s members — are also catalogued functions', () => {
    for (const member of ['SetObject', 'GetPropertyList'] as const) {
      expect(RDO_MEMBERS[member].kind).toBe('function');
    }
  });

  it('the cacher id the exchanges address is the one a session holds', () => {
    expect(CONNECTION_SEARCH_CACHER_ID).toBe(FAKE_CONTEXT_IDS.cacherId);
  });

  it('every request parses as a well-formed sel/call frame', () => {
    for (const ex of rdo.exchanges) {
      const parsed = RdoProtocol.parse(ex.request);
      expect(parsed.verb).toBe('sel');
      expect(parsed.action).toBe('call');
      expect(parsed.member).toBe(ex.matchKeys!.member);
    }
  });

  it('matches each search frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });
});

describe('connection-search scenario — the Role argument on the wire', () => {
  it('a supplier search with every box ticked puts "#54" ninth', async () => {
    const { packet, frame } = await emit('input', rolesToMask('input', ALL_CONNECTION_ROLES));

    expect(packet.member).toBe('FindSuppliers');
    expect(packet.args?.[ROLE_ARG_INDEX]).toBe(RdoValue.int(54).format());
    // …and "#1" eighth: smPrice, the delivered-cost order (Cache/FluidLinks.pas:9-11).
    expect(packet.args?.[SORT_MODE_ARG_INDEX]).toBe(RdoValue.int(1).format());

    const mock = new RdoMock();
    mock.addScenario(rdo);
    expect(mock.match(frame)!.exchange.id).toBe('cs-rdo-001');
  });

  it('choosing quality puts "#2" eighth and lands on its own exchange', async () => {
    const { packet, frame } = await emit('input', SUPPLIER_SEARCH_ROLE, QUALITY_SORT_MODE);

    expect(packet.member).toBe('FindSuppliers');
    expect(packet.args?.[SORT_MODE_ARG_INDEX]).toBe(RdoValue.int(2).format());
    expect(packet.args?.[ROLE_ARG_INDEX]).toBe(RdoValue.int(54).format());

    // Only the eighth argument differs from cs-rdo-001 — matching is per-argument
    // (rdo-mock.ts:190-194), so the two cannot collide.
    const mock = new RdoMock();
    mock.addScenario(rdo);
    expect(mock.match(frame)!.exchange.id).toBe('cs-rdo-003');
  });

  it('a customer search with every box ticked puts "#78" ninth', async () => {
    const { packet, frame } = await emit('output', rolesToMask('output', ALL_CONNECTION_ROLES));

    expect(packet.member).toBe('FindClients');
    expect(packet.args?.[ROLE_ARG_INDEX]).toBe(RdoValue.int(78).format());

    const mock = new RdoMock();
    mock.addScenario(rdo);
    expect(mock.match(frame)!.exchange.id).toBe('cs-rdo-002');
  });

  it('the two exchanges carry exactly those two masks', () => {
    expect(SUPPLIER_SEARCH_ROLE).toBe(54);
    expect(CLIENT_SEARCH_ROLE).toBe(78);
    expect(connectionSearchArgs('input', 'Shamba')[ROLE_ARG_INDEX].format()).toBe('"#54"');
    expect(connectionSearchArgs('output', 'Shamba')[ROLE_ARG_INDEX].format()).toBe('"#78"');
  });

  it('SortMode is the eighth argument, Role the ninth', () => {
    expect(SORT_MODE_ARG_INDEX).toBe(ROLE_ARG_INDEX - 1);
    expect(connectionSearchArgs('input', 'Shamba')[SORT_MODE_ARG_INDEX].format()).toBe('"#1"');
    expect(connectionSearchArgs('input', 'Shamba', QUALITY_SORT_MODE)[SORT_MODE_ARG_INDEX].format()).toBe('"#2"');
  });

  it('Factories only puts "#2" on the wire — rolProducer, not rolNeutral', async () => {
    const { packet } = await emit('input', rolesToMask('input', { ...NO_ROLES, producer: true }));
    expect(packet.args?.[ROLE_ARG_INDEX]).toBe('"#2"');
  });

  it('no box ticked reaches the wire as "#0", not as a fallback mask', async () => {
    // `byte([])` is what Voyager emits; the gateway's `??` is what lets 0
    // through where `||` used to replace it with 31.
    const { packet } = await emit('input', rolesToMask('input', NO_ROLES));
    expect(packet.args?.[ROLE_ARG_INDEX]).toBe('"#0"');
  });
});

describe('connection-search scenario — the road flag', () => {
  /**
   * Wire `searchConnections` and `resolveRoadReachability` to a single
   * `RdoMock`, the same pattern as `gate-map-scenario.test.ts:71-92`. Both the
   * search and the sweep's `SetObject` travel the `"^"` channel, so the mock
   * answers them through `fake.respond` — including the `res="#0"` of the row
   * the cache cannot load, which is the answer the sweep has to read. Only
   * `GetPropertyList` is mocked on the cacher pool, since the fake never wires
   * that helper back onto the wire.
   */
  function makeReachabilityCtx() {
    const fake = makeSessionCtx({
      currentWorldInfo: { name: 'Shamba', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 7000 },
    });
    fake.cacher.createObject.mockResolvedValue(REACHABILITY_TEMP_OBJECT);

    const mock = new RdoMock();
    mock.addScenario(rdo);

    fake.respond((packet) => {
      const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
      const r = mock.match(frame);
      return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
    });

    /** The position the last `SetObject` frame addressed — what the cache holds now. */
    const loadedPosition = (): { x: number; y: number } => {
      const sets = fake.sent.filter(s => s.packet.member === 'SetObject');
      const args = sets[sets.length - 1].packet.args ?? [];
      return {
        x: parseInt((args[0] ?? '').replace(/[^\d-]/g, ''), 10),
        y: parseInt((args[1] ?? '').replace(/[^\d-]/g, ''), 10),
      };
    };

    fake.cacher.getPropertyList.mockImplementation(async (id: string, names: string[]) => {
      const frame = rdoCall('GetPropertyList', id, RdoValue.string(names.join('\t') + '\t')).toFrame();
      const r = mock.match(frame);
      if (!r) throw new Error('no GetPropertyList exchange');
      // The scenario fixes the query SHAPE with one exchange; the VALUE
      // depends on which position the last SetObject loaded, exactly as the
      // real cache server would answer about whatever object is loaded.
      const { x, y } = loadedPosition();
      if (x === CONNECTION_SEARCH_QUERY.x && y === CONNECTION_SEARCH_QUERY.y) {
        return [BUILDING_NEAR_CIRCUITS];
      }
      const row = CONNECTION_SEARCH_ROWS.find(r2 => r2.x === x && r2.y === y);
      // An unloaded object answers '' for every property
      // (Cache Server/CachedObjectWrap.pas:209-235) — never an exception.
      return [row?.circuits ?? ''];
    });

    return { fake, mock };
  }

  it('searchConnections returns the four parsed rows', async () => {
    const { fake } = makeReachabilityCtx();
    const q = CONNECTION_SEARCH_QUERY;

    const results = await searchConnections(fake.ctx, q.x, q.y, q.fluidId, 'input', { roles: SUPPLIER_SEARCH_ROLE });

    expect(results).toEqual(CONNECTION_SEARCH_ROWS.map(row => ({
      x: row.x, y: row.y,
      facilityName: row.facility, companyName: row.company, town: row.town,
      price: '$80', quality: '40',
    })));
  });

  it('resolveRoadReachability resolves the connected/not-connected/unknown split', async () => {
    const { fake, mock } = makeReachabilityCtx();
    const q = CONNECTION_SEARCH_QUERY;

    const entries = await resolveRoadReachability(
      fake.ctx, q.x, q.y,
      CONNECTION_SEARCH_ROWS.map(({ x, y }) => ({ x, y })),
    );

    expect(entries.map(e => e.connected)).toEqual(CONNECTION_SEARCH_ROWS.map(r => r.connected));

    const consumed = mock.getConsumedIds();
    expect(consumed.has('cs-rdo-setobject-building')).toBe(true);
    expect(consumed.has('cs-rdo-nearcircuits')).toBe(true);
    for (const row of CONNECTION_SEARCH_ROWS) {
      expect(consumed.has(`cs-rdo-setobject-${row.x}-${row.y}`)).toBe(true);
    }
  });

  it('the row the cache cannot load is null on the SetObject answer alone, not on a failed read', async () => {
    const { fake } = makeReachabilityCtx();
    const q = CONNECTION_SEARCH_QUERY;
    const unloadable = CONNECTION_SEARCH_ROWS.find(r => r.circuits === null)!;

    // The cache answers a property list for every position, as the real one
    // does — '' on a released object. Only `res="#0"` on that row's SetObject
    // (cs-rdo-setobject-131-298) can tell "nothing here" from "no circuits".
    const entries = await resolveRoadReachability(fake.ctx, q.x, q.y, [{ x: unloadable.x, y: unloadable.y }]);

    expect(entries).toEqual([{ x: unloadable.x, y: unloadable.y, connected: null }]);
    // The unloaded object is never read.
    expect(fake.cacher.getPropertyList).toHaveBeenCalledTimes(1); // the building only
  });

  it('a run whose building answer is empty resolves every loadable candidate false, never null', async () => {
    const { fake } = makeReachabilityCtx();
    const q = CONNECTION_SEARCH_QUERY;
    // The building is a facility the cache holds with no circuits at all:
    // Intercept is false against anything (FluidLinks.pas:121).
    fake.cacher.getPropertyList.mockResolvedValue(['']);

    const loadableRows = CONNECTION_SEARCH_ROWS.filter(r => r.circuits !== null);
    const entries = await resolveRoadReachability(
      fake.ctx, q.x, q.y,
      loadableRows.map(({ x, y }) => ({ x, y })),
    );

    expect(entries.map(e => e.connected)).toEqual(loadableRows.map(() => false));
  });

  it('the consumed ids include the search and every reachability exchange', async () => {
    const { fake, mock } = makeReachabilityCtx();
    const q = CONNECTION_SEARCH_QUERY;

    await searchConnections(fake.ctx, q.x, q.y, q.fluidId, 'input', { roles: SUPPLIER_SEARCH_ROLE });
    await resolveRoadReachability(fake.ctx, q.x, q.y, CONNECTION_SEARCH_ROWS.map(({ x, y }) => ({ x, y })));

    const consumed = mock.getConsumedIds();
    expect(consumed.has('cs-rdo-001')).toBe(true);
    expect(consumed.has('cs-rdo-setobject-building')).toBe(true);
    expect(consumed.has('cs-rdo-nearcircuits')).toBe(true);
    for (const row of CONNECTION_SEARCH_ROWS) {
      expect(consumed.has(`cs-rdo-setobject-${row.x}-${row.y}`)).toBe(true);
    }
  });
});
