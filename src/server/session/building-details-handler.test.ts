/// <reference path="../__tests__/matchers/rdo-matchers.d.ts" />

/**
 * building-details-handler — the Voyager object inspector.
 *
 * Two things make this file the hardest of the mission to test, and both are
 * addressed head-on below:
 *
 *  1. MODULE STATE. `activeInspectors` is a WeakMap keyed by SessionContext
 *     (:82). Every `it` therefore builds a FRESH context; nothing is shared at
 *     `describe` level, and `releaseInspector` runs in `afterEach` for the
 *     contexts a test armed by hand through `setActiveInspectorForTest` (:124).
 *
 *  2. DYNAMIC IDs (plan §4bis). The cacher hands out a temp object id at
 *     runtime; that id must travel unchanged through SetObject →
 *     GetPropertyList → SetPath → CloseObject. The fake therefore issues
 *     distinct, non-trivial ids (900001, 900002, …) that match nothing a test
 *     passes as an argument, so a handler that reuses the wrong id is visible.
 *
 * `AsyncMutex` already has __tests__/async-mutex.test.ts — not duplicated here.
 */

import { describe, it, expect } from '@jest/globals';
import {
  releaseInspector,
  getActiveInspector,
  getActiveInspectorTempObjectId,
  setActiveInspectorForTest,
  AsyncMutex,
  getBuildingBasicDetails,
  getBuildingTabData,
  getBuildingGateConnections,
  getBuildingServiceFigures,
  refreshBuildingProperties,
} from './building-details-handler';
import type { ActiveInspector } from './building-details-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import { RdoProtocol } from '../rdo';
import type { FakeSessionCtx } from '../__tests__/session/fake-session-context';
import type { SessionContext } from './session-context';
import type { BuildingPropertyValue, RdoPacket } from '../../shared/types';
import { RdoVerb, RdoAction } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RdoValue } from '../../shared/rdo-types';
import {
  registerInspectorTabs,
  clearInspectorTabsCache,
  HANDLER_TO_GROUP,
  PropertyType,
} from '../../shared/building-details';
import type { PropertyGroup } from '../../shared/building-details';

// ===========================================================================
// HARNESS
// ===========================================================================

const X = 118;
const Y = 226;
/** First id `cacherCreateObject` hands out — nothing else in a test equals it. */
const FIRST_TEMP = '900001';

/** Contexts that armed the module WeakMap and must be released afterwards. */
const armedContexts: SessionContext[] = [];

type DetailsCtxOptions = Partial<SessionContext> & { sockets?: string[] };

function makeDetailsCtx(overrides: DetailsCtxOptions = {}): FakeSessionCtx {
  const fake = makeSessionCtx({ sockets: ['map'], ...overrides });
  let next = 900001;
  fake.cacher.createObject.mockImplementation(async () => String(next++));
  // No business default: a test that depends on a property says so itself.
  fake.cacher.getPropertyList.mockResolvedValue([]);
  armedContexts.push(fake.ctx);
  return fake;
}

/** Answer `cacherGetPropertyList` from a name → value table, positionally. */
function cacheValues(fake: FakeSessionCtx, table: Record<string, string>): void {
  fake.cacher.getPropertyList.mockImplementation(
    async (_id: string, names: string[]) => names.map(n => table[n] ?? '')
  );
}

/** Answer `sendRdoRequest` from a member → payload table. */
function rdoMembers(fake: FakeSessionCtx, table: Record<string, string | Error>): void {
  fake.respond((packet) => table[packet.member ?? ''] ?? '');
}

type FocusMock = jest.MockedFunction<SessionContext['focusBuilding']>;
function focusReturns(fake: FakeSessionCtx, buildingId: string, buildingName = '', ownerName = ''): void {
  (fake.ctx.focusBuilding as FocusMock).mockResolvedValue({ buildingId, buildingName, ownerName });
}

/**
 * Register a data-driven template, as BuildingDataService does at startup from
 * CLASSES.BIN [InspectorInfo] (property-templates.ts:55).
 */
function registerTabs(visualClass: string, handlers: string[], className = 'Test Building'): void {
  registerInspectorTabs(
    visualClass,
    handlers.map(h => ({ tabName: h, tabHandler: h })),
    className,
  );
}

/**
 * A property group that no shipped template contains.
 *
 * `HANDLER_TO_GROUP` is the extension point CLASSES.BIN registration goes
 * through; injecting a key here is the only way to reach three code paths of
 * `fetchPropertiesAndGroups` that the handler supports but that none of the 36
 * shipped groups exercises: an indexed property carrying a `maxProperty`
 * (:784, :868-874) and an indexed property with no `countProperty` (:876-890).
 * The key is removed again in `afterEach`; no production file is touched.
 */
const PROBE_INDEXED_GROUP: PropertyGroup = {
  id: 'probeIndexed',
  name: 'Probe',
  icon: 'P',
  order: 0,
  properties: [
    // Counted + max: drives the `def.maxProperty` fetch and the paired read-back.
    {
      rdoName: 'prbVal', displayName: 'Value', type: PropertyType.NUMBER,
      indexed: true, countProperty: 'prbCount', maxProperty: 'prbMax',
    },
    // Counted, no max, sharing the same count: the second property must not
    // push the count value a second time.
    {
      rdoName: 'prbBare', displayName: 'Bare', type: PropertyType.NUMBER,
      indexed: true, countProperty: 'prbCount',
    },
    // Uncounted + columns: collected as a fixed 0-9 sweep, then read back by
    // the `else if (prop.indexed)` branch.
    {
      rdoName: 'prbFree', displayName: 'Free', type: PropertyType.NUMBER,
      indexed: true, maxProperty: 'prbFreeMax',
      columns: [
        { rdoSuffix: 'prbFree', label: 'F', type: PropertyType.NUMBER },
        { rdoSuffix: 'prbFreeMax', label: 'M', type: PropertyType.NUMBER },
      ],
    },
    // Uncounted, no max.
    {
      rdoName: 'prbLoose', displayName: 'Loose', type: PropertyType.NUMBER,
      indexed: true,
      columns: [{ rdoSuffix: 'prbLoose', label: 'L', type: PropertyType.NUMBER }],
    },
  ],
};

/**
 * A group carrying `CurrBlock`.
 *
 * FINDING (lot 3): `enrichVotesTab` (:930) reads `CurrBlock` out of the values
 * the template collected, but `CurrBlock` appears in exactly one shipped group
 * — GENERIC_GROUP (template-groups.ts:25) — and GENERIC_GROUP is reachable only
 * through the fallback GENERIC_TEMPLATE, which has no `votes` tab. No
 * CLASSES.BIN registration can therefore produce a template with both, so on
 * the shipped data the RDOVoteOf enrichment never fires. The probe group makes
 * the enrichment reachable so its wire form can still be pinned; the
 * "never fires" case is pinned separately, on the real town-hall template.
 */
const PROBE_BLOCK_GROUP: PropertyGroup = {
  id: 'probeBlock',
  name: 'Block',
  icon: '', // every shipped group names an icon; the fallback is defensive only
  order: 0,
  properties: [
    { rdoName: 'CurrBlock', displayName: 'Block ID', type: PropertyType.TEXT },
  ],
};

afterEach(() => {
  for (const ctx of armedContexts) releaseInspector(ctx);
  armedContexts.length = 0;
  clearInspectorTabsCache();
  delete HANDLER_TO_GROUP['probeIndexed'];
  delete HANDLER_TO_GROUP['probeBlock'];
  jest.restoreAllMocks();
});

// ===========================================================================
// ACTIVE INSPECTOR — the module WeakMap
// ===========================================================================

function makeInspector(over: Partial<ActiveInspector> = {}): ActiveInspector {
  return {
    tempObjectId: FIRST_TEMP,
    x: X,
    y: Y,
    visualClass: '4722',
    mutex: new AsyncMutex(),
    gateMap: '',
    hasSupplies: false,
    hasProducts: false,
    hasCompInputs: false,
    isWarehouse: false,
    ...over,
  };
}

describe('the active inspector registry', () => {
  it('hands back the inspector only for the coordinates it was opened on', () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector());

    expect(getActiveInspector(fake.ctx, X, Y)?.tempObjectId).toBe(FIRST_TEMP);
    expect(getActiveInspector(fake.ctx, X, Y + 1)).toBeUndefined();
    expect(getActiveInspector(fake.ctx, X + 1, Y)).toBeUndefined();
  });

  it('reports no inspector for a context that never opened one', () => {
    const fake = makeDetailsCtx();

    expect(getActiveInspector(fake.ctx, X, Y)).toBeUndefined();
    expect(getActiveInspectorTempObjectId(fake.ctx)).toBeUndefined();
  });

  // The cacher KeepAlive timer keep-alives the TCachedObjectWrap temp object,
  // not the TCacheServer root (ObjectInspectorHandleViewer.pas:1172-1180).
  it('exposes the temp object id the KeepAlive timer has to refresh', () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({ tempObjectId: '900042' }));

    expect(getActiveInspectorTempObjectId(fake.ctx)).toBe('900042');
  });

  it('closes the Delphi temp object when the inspector is released', () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({ tempObjectId: '900042' }));

    releaseInspector(fake.ctx);

    expect(fake.cacher.closeObject).toHaveBeenCalledWith('900042');
    expect(getActiveInspectorTempObjectId(fake.ctx)).toBeUndefined();
  });

  it('is a no-op when there is nothing to release', () => {
    const fake = makeDetailsCtx();

    releaseInspector(fake.ctx);

    expect(fake.cacher.closeObject).not.toHaveBeenCalled();
  });

  it('keeps two sessions apart — the WeakMap is keyed by context', () => {
    const a = makeDetailsCtx();
    const b = makeDetailsCtx();
    setActiveInspectorForTest(a.ctx, makeInspector({ tempObjectId: '900011' }));
    setActiveInspectorForTest(b.ctx, makeInspector({ tempObjectId: '900022' }));

    releaseInspector(a.ctx);

    expect(getActiveInspectorTempObjectId(a.ctx)).toBeUndefined();
    expect(getActiveInspectorTempObjectId(b.ctx)).toBe('900022');
  });
});

// ===========================================================================
// getBuildingBasicDetails — Phase 1+2 and the inspector it leaves behind
// ===========================================================================

describe('getBuildingBasicDetails', () => {
  it('threads one temp object through create → setObject → getPropertyList', async () => {
    const fake = makeDetailsCtx();
    registerTabs('4722', ['unkGeneral']);
    focusReturns(fake, '40133602', 'Supermarket', 'SPO_test3');
    cacheValues(fake, { Name: 'Supermarket', Cost: '$500K', ObjectId: '40133602' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '4722');

    expect(fake.cacher.createObject).toHaveBeenCalledTimes(1);
    expect(fake.cacher.setObject).toHaveBeenCalledWith(FIRST_TEMP, X, Y);
    for (const call of fake.cacher.getPropertyList.mock.calls) {
      expect(call[0]).toBe(FIRST_TEMP);
    }
    // The object stays OPEN: it is the inspector the tab requests will reuse.
    expect(fake.cacher.closeObject).not.toHaveBeenCalled();
    expect(getActiveInspectorTempObjectId(fake.ctx)).toBe(FIRST_TEMP);
    expect(details.x).toBe(X);
    expect(details.y).toBe(Y);
    expect(details.visualClass).toBe('4722');
  });

  it('releases a previous inspector before opening a new one, same building or not', async () => {
    const fake = makeDetailsCtx();
    registerTabs('4722', ['unkGeneral']);
    focusReturns(fake, '40133602');
    setActiveInspectorForTest(fake.ctx, makeInspector({ tempObjectId: '900999' }));

    await getBuildingBasicDetails(fake.ctx, X, Y, '4722');

    // Stale object closed first — otherwise the Delphi side leaks one wrap per
    // click on the same building.
    expect(fake.cacher.closeObject).toHaveBeenCalledWith('900999');
    expect(getActiveInspectorTempObjectId(fake.ctx)).toBe(FIRST_TEMP);
  });

  it('builds one tab entry per template group, in template order', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9001', ['IndGeneral', 'Workforce', 'facManagement'], 'Factory');
    focusReturns(fake, '40133602', 'Plant', 'SPO_test3');
    cacheValues(fake, { Name: 'Plant', Workers0: '120', UpgradeLevel: '2' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9001');

    expect(details.templateName).toBe('Factory');
    expect(details.tabs.map(t => t.id)).toEqual(['indGeneral', 'workforce', 'upgrade']);
    expect(details.tabs.map(t => t.handlerName)).toEqual(['IndGeneral', 'Workforce', 'facManagement']);
    expect(details.tabs[0].order).toBe(0);
    expect(details.tabs[1].order).toBe(10);
  });

  it('prefers the focused building id, then ObjectId, then CurrBlock', async () => {
    // An unregistered visual class falls back to GENERIC_TEMPLATE, the only
    // template whose group carries ObjectId and CurrBlock at all.
    const VC = 'unregistered';

    const focused = makeDetailsCtx();
    focusReturns(focused, '40133602');
    cacheValues(focused, { ObjectId: '40133777', CurrBlock: '40133888' });
    expect((await getBuildingBasicDetails(focused.ctx, X, Y, VC)).buildingId).toBe('40133602');

    const noFocus = makeDetailsCtx();
    focusReturns(noFocus, '');
    cacheValues(noFocus, { ObjectId: '40133777', CurrBlock: '40133888' });
    expect((await getBuildingBasicDetails(noFocus.ctx, X, Y, VC)).buildingId).toBe('40133777');

    const blockOnly = makeDetailsCtx();
    focusReturns(blockOnly, '');
    cacheValues(blockOnly, { CurrBlock: '40133888' });
    expect((await getBuildingBasicDetails(blockOnly.ctx, X, Y, VC)).buildingId).toBe('40133888');

    const nothing = makeDetailsCtx();
    focusReturns(nothing, '');
    nothing.cacher.getPropertyList.mockResolvedValue([]); // server answered nothing
    expect((await getBuildingBasicDetails(nothing.ctx, X, Y, VC)).buildingId).toBe('');
  });

  it('keeps going when the focus call fails — the inspector is still usable', async () => {
    const fake = makeDetailsCtx();
    (fake.ctx.focusBuilding as FocusMock).mockRejectedValue(new Error('SwitchFocusEx timeout'));
    cacheValues(fake, { CurrBlock: '40133888', SecurityId: '77' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, 'unregistered');

    expect(details.buildingName).toBe('');
    expect(details.ownerName).toBe('');
    expect(details.securityId).toBe('77');
    expect(fake.log.warn).toHaveBeenCalled();
  });

  it('refuses to open an inspector before the map service is initialised', async () => {
    const fake = makeDetailsCtx({ cacherId: null });
    registerTabs('4722', ['unkGeneral']);
    focusReturns(fake, '40133602');

    await expect(getBuildingBasicDetails(fake.ctx, X, Y, '4722')).rejects.toThrow(
      'Map service not initialized'
    );
    expect(fake.cacher.createObject).not.toHaveBeenCalled();
  });

  it('closes the temp object and forgets the inspector when a phase fails', async () => {
    const fake = makeDetailsCtx();
    registerTabs('4722', ['unkGeneral']);
    focusReturns(fake, '40133602');
    fake.cacher.getPropertyList.mockRejectedValue(new Error('Request timeout: GetPropertyList'));

    await expect(getBuildingBasicDetails(fake.ctx, X, Y, '4722')).rejects.toThrow('Request timeout');

    expect(fake.cacher.closeObject).toHaveBeenCalledWith(FIRST_TEMP);
    expect(getActiveInspectorTempObjectId(fake.ctx)).toBeUndefined();
  });

  it('leaves the heavy tabs unfetched — that is what makes it the lazy path', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9002', ['IndGeneral', 'Supplies', 'Products', 'compInputs']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Plant' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9002');

    expect(details.supplies).toBeUndefined();
    expect(details.products).toBeUndefined();
    expect(details.compInputs).toBeUndefined();
    // No GetInputNames / GetOutputNames went out.
    expect(fake.sent).toEqual([]);
    // …but the inspector knows which lazy tabs exist.
    const inspector = getActiveInspector(fake.ctx, X, Y);
    expect(inspector?.hasSupplies).toBe(true);
    expect(inspector?.hasProducts).toBe(true);
    expect(inspector?.hasCompInputs).toBe(true);
  });

  describe('warehouses', () => {
    it('fetches the ware names eagerly and pairs them with the GateMap bits', async () => {
      const fake = makeDetailsCtx();
      registerTabs('7001', ['WHGeneral']);
      focusReturns(fake, '40133602');
      cacheValues(fake, {
        GateMap: '101',
        InputCount: '3',
        'Input0.0': 'Books',
        'Input1.0': 'Cars',
        'Input2.0': 'Fresh Food',
      });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '7001');

      // Kernel.pas:5840-5854 — WriteString('Input' + i + '.', MetaFluid.Name_MLS)
      expect(details.warehouseWares).toEqual([
        { name: 'Books', enabled: true, index: 0 },
        { name: 'Cars', enabled: false, index: 1 },
        { name: 'Fresh Food', enabled: true, index: 2 },
      ]);
      expect(getActiveInspector(fake.ctx, X, Y)?.gateMap).toBe('101');
    });

    it('names a gate "Ware N" when the cache holds no MLS name, and disables it past the GateMap', async () => {
      const fake = makeDetailsCtx();
      registerTabs('7001', ['WHGeneral']);
      focusReturns(fake, '40133602');
      cacheValues(fake, { GateMap: '1', InputCount: '2', 'Input0.0': 'Books' });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '7001');

      expect(details.warehouseWares).toEqual([
        { name: 'Books', enabled: true, index: 0 },
        { name: 'Ware 1', enabled: false, index: 1 },
      ]);
    });

    it('skips the ware fetch when InputCount is absent or absurd', async () => {
      for (const inputCount of ['0', '51']) {
        const fake = makeDetailsCtx();
        registerTabs('7001', ['WHGeneral']);
        focusReturns(fake, '40133602');
        cacheValues(fake, { GateMap: '111', InputCount: inputCount });

        const details = await getBuildingBasicDetails(fake.ctx, X, Y, '7001');

        expect(details.warehouseWares).toEqual([]);
      }
    });

    it('treats an unreadable GateMap as no gates enabled', async () => {
      const fake = makeDetailsCtx();
      registerTabs('7001', ['WHGeneral']);
      focusReturns(fake, '40133602');
      // 'error' means the cache could not read it — the name is dropped, so the
      // GateMap is absent rather than empty.
      cacheValues(fake, { GateMap: 'error', InputCount: '2', 'Input0.0': 'Books' });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '7001');

      expect(details.warehouseWares).toEqual([
        { name: 'Books', enabled: false, index: 0 },
        { name: 'Ware 1', enabled: false, index: 1 },
      ]);
      expect(getActiveInspector(fake.ctx, X, Y)?.gateMap).toBe('');
    });

    it('reads no wares when InputCount comes back empty', async () => {
      const fake = makeDetailsCtx();
      registerTabs('7001', ['WHGeneral']);
      focusReturns(fake, '40133602');
      cacheValues(fake, { GateMap: '11' }); // InputCount answers ''

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '7001');

      expect(details.warehouseWares).toEqual([]);
    });

    it('degrades to no wares when the ware read fails', async () => {
      const fake = makeDetailsCtx();
      registerTabs('7001', ['WHGeneral']);
      focusReturns(fake, '40133602');
      let call = 0;
      fake.cacher.getPropertyList.mockImplementation(async (_id: string, names: string[]) => {
        call++;
        if (names[0] === 'InputCount') throw new Error('Request timeout: GetPropertyList');
        return names.map(n => (n === 'GateMap' ? '11' : ''));
      });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '7001');

      expect(call).toBeGreaterThan(1);
      expect(details.warehouseWares).toEqual([]);
      expect(fake.log.warn).toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// fetchPropertiesAndGroups — driven through getBuildingBasicDetails
// ===========================================================================

describe('property collection and grouping', () => {
  it('opens on ONE batch — the header group, not the whole template', async () => {
    const fake = makeDetailsCtx();
    // ResGeneral (20) + Workforce (24) + facManagement (8) + townJobs (18) — over 50.
    registerTabs('9003', ['ResGeneral', 'Workforce', 'facManagement', 'townJobs']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Tower' });

    await getBuildingBasicDetails(fake.ctx, X, Y, '9003');

    // This used to be four groups and more than one batch. The opening read is
    // now the first group plus the header fields, which fits in one.
    const batches = fake.cacher.getPropertyList.mock.calls;
    expect(batches).toHaveLength(1);
    expect(batches[0][1].length).toBeLessThanOrEqual(50);
  });

  it('splits a section read into batches of 50 properties', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9003', ['ResGeneral', 'Workforce', 'facManagement', 'townJobs']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Tower' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9003');
    fake.cacher.getPropertyList.mockClear();

    // A civic tab consolidates several server groups and asks for them at once,
    // which is where the 50-name cap still has to hold.
    const groupIds = details.tabs.slice(1).map(t => t.id);
    await getBuildingTabData(fake.ctx, X, Y, groupIds[0], '9003', groupIds);

    const batches = fake.cacher.getPropertyList.mock.calls;
    expect(batches.length).toBeGreaterThan(1);
    for (const [, names] of batches) expect(names.length).toBeLessThanOrEqual(50);
  });

  it('never publishes a gate group in `groups` — its values do not come from the property bag', async () => {
    const fake = makeDetailsCtx();
    // `Supplies` declares `ObjectId` as its "Gate Object" column, and `ObjectId` is
    // also a HEADER property read for every building. The opening read therefore had
    // a value for it, `groups['supplies']` came back holding the BUILDING's object id
    // under a name that means the GATE's, and the client read the mere presence of
    // the key as "this gate is loaded" — so it never sent REQ_BUILDING_TAB_DATA and
    // the Supplies tab said "No supply inputs" on every building.
    registerTabs('9101', ['IndGeneral', 'Supplies']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Liquor plant', ObjectId: '40133602', Cost: '$500K' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9101');

    // The tab is still offered — only its property bag is absent.
    expect(details.tabs.map(t => t.id)).toContain('supplies');
    expect(Object.keys(details.groups)).not.toContain('supplies');
    // The header group is unaffected: it IS a property group.
    expect(details.groups['indGeneral']).toBeDefined();
  });

  it('drops a property the cache answered "error" for', async () => {
    const fake = makeDetailsCtx();
    registerTabs('4722', ['unkGeneral']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Shop', Creator: 'error', Cost: '$500K' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '4722');

    const names = details.groups['unkGeneral'].map(v => v.name);
    expect(names).toContain('Name');
    expect(names).toContain('Cost');
    expect(names).not.toContain('Creator');
  });

  it('tolerates a short response — the missing tail reads as empty', async () => {
    const fake = makeDetailsCtx();
    registerTabs('4722', ['unkGeneral']);
    focusReturns(fake, '40133602');
    // One value for a batch of many: everything after index 0 is absent.
    fake.cacher.getPropertyList.mockResolvedValue(['Shop']);

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '4722');

    expect(details.groups['unkGeneral'][0]).toEqual({ name: 'Name', value: 'Shop' });
  });

  it('expands a counted table into per-index columns and keeps the count itself', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9004', ['BankLoans']);
    focusReturns(fake, '40133602');
    cacheValues(fake, {
      LoanCount: '2',
      Debtor0: 'SPO_test3', Amount0: '$1,000K', Interest0: '5%', Term0: '10',
      Debtor1: 'Fred', Amount1: '$250K', Interest1: '7%', Term1: '4',
    });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9004');

    const loans = details.groups['bankLoans'];
    expect(loans[0]).toEqual({ name: 'LoanCount', value: '2' });
    expect(loans).toContainEqual({ name: 'Debtor1', value: 'Fred', index: 1 });
    expect(loans).toContainEqual({ name: 'Term0', value: '10', index: 0 });
    // Index 2 was never requested — the count decides how far the sweep goes.
    expect(loans.some(v => v.name === 'Debtor2')).toBe(false);
  });

  it('applies a per-column index suffix where the column overrides the property one', async () => {
    const fake = makeDetailsCtx();
    // townGeneral: covName has indexSuffix '.0'; the covValue column overrides it to ''.
    registerTabs('9005', ['townGeneral']);
    focusReturns(fake, '40133602');
    cacheValues(fake, {
      covCount: '1',
      'covName0.0': 'Schools',
      covValue0: '87%',
      ActualRuler: 'SPO_test3',
    });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9005');

    const town = details.groups['townGeneral'];
    expect(town).toContainEqual({ name: 'covName0.0', value: 'Schools', index: 0 });
    expect(town).toContainEqual({ name: 'covValue0', value: '87%', index: 0 });
  });

  it('logs the service table rows it reads back', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9006', ['SrvGeneral']);
    focusReturns(fake, '40133602');
    cacheValues(fake, {
      ServiceCount: '1',
      'srvNames0.0': 'Groceries',
      srvPrices0: '100',
      srvSupplies0: '50',
    });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9006');

    expect(details.groups['srvGeneral']).toContainEqual({ name: 'srvNames0.0', value: 'Groceries', index: 0 });
    // Indexed `srv*` reads are traced individually (:801-803).
    expect(fake.log.debug).toHaveBeenCalledWith(expect.stringContaining('TABLE: srvNames0.0'));
  });

  it('warns about an implausible count but still fetches it', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9004', ['BankLoans']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { LoanCount: '60' });

    await getBuildingBasicDetails(fake.ctx, X, Y, '9004');

    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('Unusually high count'));
    // 60 rows x 4 columns = 240 indexed properties, batched by 50.
    const indexedBatches = fake.cacher.getPropertyList.mock.calls.filter(
      ([, names]) => names[0].startsWith('Debtor')
    );
    expect(indexedBatches.length).toBeGreaterThan(1);
  });

  it('treats an absent count as zero and issues no indexed read at all', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9004', ['BankLoans']);
    focusReturns(fake, '40133602');
    cacheValues(fake, {}); // the cache answers every name with an empty string

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9004');

    // One batch for LoanCount, and nothing after it: no count, no rows.
    expect(fake.cacher.getPropertyList).toHaveBeenCalledTimes(1);
    expect(details.groups['bankLoans']).toEqual([{ name: 'LoanCount', value: '' }]);
  });

  it('pairs a plain property with its max property', async () => {
    const fake = makeDetailsCtx();
    // ResGeneral's Repair/RepairPrice is the only such pairing in the templates.
    registerTabs('9007', ['ResGeneral']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { Repair: '40', RepairPrice: '$12K' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9007');

    const res = details.groups['resGeneral'];
    expect(res).toContainEqual({ name: 'Repair', value: '40' });
    expect(res).toContainEqual({ name: 'RepairPrice', value: '$12K' });
  });

  it('emits the three workforce rows as a flat indexed list', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9008', ['Workforce']);
    focusReturns(fake, '40133602');
    cacheValues(fake, {
      Workers0: '10', WorkersMax0: '20', WorkersK0: '80', Salaries0: '100', WorkForcePrice0: '5',
      Workers1: '4', WorkersMax1: '8',
      Workers2: '0',
    });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9008');

    const wf = details.groups['workforce'];
    expect(wf).toContainEqual({ name: 'Workers0', value: '10', index: 0 });
    expect(wf).toContainEqual({ name: 'WorkForcePrice0', value: '5', index: 0 });
    expect(wf).toContainEqual({ name: 'WorkersMax1', value: '8', index: 1 });
    expect(wf).toContainEqual({ name: 'Workers2', value: '0', index: 2 });
    // Five names per class, three classes, in class order — the Delphi cache
    // answers every requested name, empty when it holds nothing.
    expect(wf).toHaveLength(15);
    expect(wf.slice(0, 5).map(v => v.name)).toEqual([
      'Workers0', 'WorkersMax0', 'WorkersK0', 'Salaries0', 'WorkForcePrice0',
    ]);
    expect(wf).toContainEqual({ name: 'WorkersK1', value: '', index: 1 });
  });

  it('omits a group that declares no cache-backed property', async () => {
    const fake = makeDetailsCtx();
    // The compInputs tab is a pure lazy handler: ADVERTISEMENT_GROUP has an
    // empty property list, so it contributes a tab but never a group.
    registerTabs('9021', ['compInputs']);
    focusReturns(fake, '40133602');
    cacheValues(fake, {});

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9021');

    expect(details.tabs.map(t => t.id)).toEqual(['advertisement']);
    expect(details.groups).toEqual({});
  });

  // These two shapes are supported by the handler but appear in none of the 36
  // shipped groups; the probe group registers them the way CLASSES.BIN would.
  it('fetches and pairs the max property of a counted indexed property', async () => {
    const fake = makeDetailsCtx();
    HANDLER_TO_GROUP['probeIndexed'] = PROBE_INDEXED_GROUP;
    registerTabs('9009', ['probeIndexed']);
    focusReturns(fake, '40133602');
    cacheValues(fake, {
      prbCount: '2',
      prbVal0: '3', prbMax0: '9',
      prbVal1: '4', prbMax1: '8',
      prbFree0: '1', prbFreeMax0: '2',
    });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9009');

    const probe = details.groups['probeIndexed'];
    expect(probe).toContainEqual({ name: 'prbVal1', value: '4', index: 1 });
    expect(probe).toContainEqual({ name: 'prbMax1', value: '8', index: 1 });
    // The count stops the counted sweep at 2 — index 2 was never requested.
    expect(probe.some(v => v.name === 'prbVal2')).toBe(false);
    // The uncounted property is swept over a fixed 0-9 range instead.
    expect(probe).toContainEqual({ name: 'prbFree0', value: '1', index: 0 });
    expect(probe).toContainEqual({ name: 'prbFreeMax0', value: '2', index: 0 });
    expect(probe).toContainEqual({ name: 'prbFree9', value: '', index: 9 });
  });

  // The Delphi cache answers 'error' for a property it cannot read. Those names
  // are dropped from the value map rather than stored, which is the only way a
  // group can end up asking for a value that is genuinely absent.
  describe('properties the cache answered "error" for', () => {
    it('omits an erroring count, so its table shows no rows at all', async () => {
      const fake = makeDetailsCtx();
      registerTabs('9004', ['BankLoans']);
      focusReturns(fake, '40133602');
      cacheValues(fake, { LoanCount: 'error' });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9004');

      expect(details.groups['bankLoans']).toBeUndefined();
    });

    it('omits an erroring cell but keeps the rest of the row', async () => {
      const fake = makeDetailsCtx();
      registerTabs('9004', ['BankLoans']);
      focusReturns(fake, '40133602');
      cacheValues(fake, { LoanCount: '1', Debtor0: 'error', Amount0: '$1,000K' });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9004');

      const loans = details.groups['bankLoans'];
      expect(loans.some(v => v.name === 'Debtor0')).toBe(false);
      expect(loans).toContainEqual({ name: 'Amount0', value: '$1,000K', index: 0 });
    });

    it('reads a non-numeric count as zero rows', async () => {
      const fake = makeDetailsCtx();
      registerTabs('9004', ['BankLoans']);
      focusReturns(fake, '40133602');
      cacheValues(fake, { LoanCount: 'plenty' });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9004');

      expect(details.groups['bankLoans']).toEqual([{ name: 'LoanCount', value: 'plenty' }]);
    });

    it('omits an erroring max property while keeping its base value', async () => {
      const fake = makeDetailsCtx();
      registerTabs('9007', ['ResGeneral']);
      focusReturns(fake, '40133602');
      cacheValues(fake, { Repair: '40', RepairPrice: 'error' });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9007');

      const res = details.groups['resGeneral'];
      expect(res).toContainEqual({ name: 'Repair', value: '40' });
      expect(res.some(v => v.name === 'RepairPrice')).toBe(false);
    });

    it('omits erroring cells across every indexed shape at once', async () => {
      const fake = makeDetailsCtx();
      HANDLER_TO_GROUP['probeIndexed'] = PROBE_INDEXED_GROUP;
      registerTabs('9022', ['probeIndexed']);
      focusReturns(fake, '40133602');
      cacheValues(fake, {
        prbCount: '2',
        prbVal0: 'error', prbMax0: '9',
        prbVal1: '4', prbMax1: 'error',
        prbBare0: '1',
        prbFree0: '1', prbFreeMax0: 'error',
        prbFree3: 'error',
        prbLoose0: '7',
      });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9022');
      const names = details.groups['probeIndexed'].map(v => v.name);

      expect(names).not.toContain('prbVal0');
      expect(names).not.toContain('prbMax1');
      expect(names).not.toContain('prbFreeMax0');
      expect(names).not.toContain('prbFree3');
      // The shared count is pushed once, by the first property that needs it.
      expect(names.filter(n => n === 'prbCount')).toHaveLength(1);
      expect(names).toContain('prbBare1');
      expect(names).toContain('prbLoose0');
    });

    it('omits an erroring count of an indexed property, and reads no rows', async () => {
      const fake = makeDetailsCtx();
      HANDLER_TO_GROUP['probeIndexed'] = PROBE_INDEXED_GROUP;
      registerTabs('9025', ['probeIndexed']);
      focusReturns(fake, '40133602');
      cacheValues(fake, { prbCount: 'error', prbLoose0: '7' });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9025');
      const names = details.groups['probeIndexed'].map(v => v.name);

      expect(names).not.toContain('prbCount');
      expect(names).not.toContain('prbVal0');
      expect(names).toContain('prbLoose0');
    });

    it('reads a non-numeric count of an indexed property as zero rows', async () => {
      const fake = makeDetailsCtx();
      HANDLER_TO_GROUP['probeIndexed'] = PROBE_INDEXED_GROUP;
      registerTabs('9026', ['probeIndexed']);
      focusReturns(fake, '40133602');
      cacheValues(fake, { prbCount: 'lots' });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9026');
      const names = details.groups['probeIndexed'].map(v => v.name);

      expect(names).toContain('prbCount');
      expect(names).not.toContain('prbVal0');
    });

    it('drops an erroring value out of an indexed batch response', async () => {
      const fake = makeDetailsCtx();
      registerTabs('9006', ['SrvGeneral']);
      focusReturns(fake, '40133602');
      // Phase 2 asks for the srv* columns; the first batch comes back short.
      fake.cacher.getPropertyList.mockImplementation(async (_id: string, names: string[]) => {
        if (names.includes('ServiceCount')) return names.map(n => (n === 'ServiceCount' ? '1' : ''));
        return ['error']; // one value for six names
      });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9006');

      const srv = details.groups['srvGeneral'].map(v => v.name);
      expect(srv).not.toContain('srvNames0.0');
      // The names after the short tail read as empty strings, so they survive.
      expect(srv).toContain('srvPrices0');
    });
  });

  it('decodes a captured MoneyGraphInfo payload into exactly count points', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9010', ['Chart']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { MoneyGraphInfo: '12,-29,42,0,18,40,68,122,158,183,212,205,230,255,241,' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9010');

    const expected = [
      -29, -23.98824, -17.86275, -10.06667, 4.96863, 14.99216,
      21.95294, 30.02745, 28.07843, 35.03922, 42, 38.10196,
    ];
    expect(details.moneyGraph).toHaveLength(12);
    expected.forEach((v, i) => {
      expect(details.moneyGraph?.[i]).toBeCloseTo(v, 3);
    });
    expect(details.moneyGraph).not.toContain(12);
    expect(details.moneyGraph?.[1]).not.toBe(-29);
    expect(details.moneyGraph?.[2]).not.toBe(42);
  });

  it('empties the series when a byte is non-numeric', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9010', ['Chart']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { MoneyGraphInfo: '12,-29,42,0,18,x,68,122,158,183,212,205,230,255,241,' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9010');

    expect(details.moneyGraph).toEqual([]);
  });

  it('empties the series when fewer bytes than count are present', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9010', ['Chart']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { MoneyGraphInfo: '12,-29,42,0,18,40,' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9010');

    expect(details.moneyGraph).toEqual([]);
  });

  it('ignores extra trailing tokens beyond count bytes', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9010', ['Chart']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { MoneyGraphInfo: '12,-29,42,0,18,40,68,122,158,183,212,205,230,255,241,,7,9' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9010');

    expect(details.moneyGraph).toHaveLength(12);
  });

  it('returns an empty series for a graph string with no samples', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9010', ['Chart']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { MoneyGraphInfo: '0' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9010');

    expect(details.moneyGraph).toEqual([]);
  });

  it('leaves the graph undefined when the property is absent', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9010', ['Chart']);
    focusReturns(fake, '40133602');
    cacheValues(fake, {});

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9010');

    expect(details.moneyGraph).toBeUndefined();
  });
});

// ===========================================================================
// enrichVotesTab — the one RDO call the property phase makes
// ===========================================================================

describe('votes enrichment', () => {
  /**
   * townGeneral auto-injects the Votes tab (property-templates.ts:102-110); the
   * probe group supplies the `CurrBlock` the enrichment needs and that no
   * shipped group pairs with a votes tab — see PROBE_BLOCK_GROUP above.
   */
  function makeVotesCtx(over: DetailsCtxOptions = {}): FakeSessionCtx {
    const fake = makeDetailsCtx({ activeUsername: 'SPO_test3', ...over });
    HANDLER_TO_GROUP['probeBlock'] = PROBE_BLOCK_GROUP;
    registerTabs('9011', ['townGeneral', 'probeBlock']);
    focusReturns(fake, '40133602');
    return fake;
  }

  /**
   * Open the facility, then open the section that carries `CurrBlock`.
   *
   * The enrichment used to ride on `getBuildingBasicDetails`, back when that
   * call read the whole template. It reads the header group only now, so the
   * enrichment fires where the group it depends on is actually read: the
   * section request. Same behaviour, one round-trip later, and only for a user
   * who opened the tab.
   */
  async function openVotesSection(fake: FakeSessionCtx): Promise<{ [groupId: string]: BuildingPropertyValue[] }> {
    await getBuildingBasicDetails(fake.ctx, X, Y, '9011');
    fake.sent.length = 0;
    const tab = await getBuildingTabData(fake.ctx, X, Y, 'probeBlock', '9011', ['probeBlock']);
    return tab.groups ?? {};
  }

  // The reason the enrichment exists — and the reason it never runs in
  // production. Pinned on the real registration, with no probe group.
  it('never fires on a real town hall: no shipped template carries CurrBlock', async () => {
    const fake = makeDetailsCtx({ activeUsername: 'SPO_test3' });
    registerTabs('9020', ['townGeneral']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { ActualRuler: 'Fred', RulerName: 'Fred', CurrBlock: '40133888' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9020');

    // The votes tab is built…
    expect(details.groups['votes']).toBeDefined();
    // …but CurrBlock is never among the names asked for, so the guard at :932
    // returns early and RDOVoteOf is never sent.
    const asked = fake.cacher.getPropertyList.mock.calls.flatMap(([, names]) => names);
    expect(asked).not.toContain('CurrBlock');
    expect(fake.sent).toEqual([]);
    expect(details.groups['votes'].some(v => v.name === 'VoteOf')).toBe(false);
  });

  it('asks RDOVoteOf on CurrBlock and appends the answer to the votes tab', async () => {
    const fake = makeVotesCtx();
    cacheValues(fake, { CurrBlock: '40133888', RulerName: 'Fred', RulerVotes: '120' });
    rdoMembers(fake, { RDOVoteOf: 'res="%Fred"' });

    const groups = await openVotesSection(fake);

    expect(fake.sent).toHaveLength(1);
    const [{ packet, socketName, category }] = fake.sent;
    expect(socketName).toBe('construction');
    expect(packet.verb).toBe(RdoVerb.SEL);
    // The vote is cast on the town-hall BLOCK, not on the inspector temp object.
    expect(packet.targetId).toBe('40133888');
    expect(packet.action).toBe(RdoAction.CALL);
    expect(packet.member).toBe('RDOVoteOf');
    expect(packet.separator).toBe('"^"');
    expect(packet.args).toEqual([RdoValue.string('SPO_test3').format()]);
    expect(category).toBe(TimeoutCategory.NORMAL);
    expect(groups['votes']).toContainEqual({ name: 'VoteOf', value: 'Fred' });
  });

  it('connects the construction service first when its socket is down', async () => {
    const fake = makeVotesCtx();
    // No 'construction' socket declared → getSocket returns undefined.
    cacheValues(fake, { CurrBlock: '40133888', RulerName: 'Fred' });
    rdoMembers(fake, { RDOVoteOf: 'res="%Fred"' });

    await openVotesSection(fake);

    expect(fake.ctx.connectConstructionService).toHaveBeenCalled();
  });

  it('does not reconnect when the construction socket is already up', async () => {
    const fake = makeVotesCtx({ sockets: ['map', 'construction'] });
    cacheValues(fake, { CurrBlock: '40133888', RulerName: 'Fred' });
    rdoMembers(fake, { RDOVoteOf: 'res="%Fred"' });

    await openVotesSection(fake);

    expect(fake.ctx.connectConstructionService).not.toHaveBeenCalled();
  });

  it('falls back to the cached username when no active one is set', async () => {
    const fake = makeVotesCtx({ activeUsername: null, cachedUsername: 'CachedGuy' });
    cacheValues(fake, { CurrBlock: '40133888', RulerName: 'Fred' });
    rdoMembers(fake, { RDOVoteOf: 'res="%Fred"' });

    await openVotesSection(fake);

    expect(fake.sent[0].packet.args).toEqual([RdoValue.string('CachedGuy').format()]);
  });

  it('skips the enrichment when the block id is unknown', async () => {
    const fake = makeVotesCtx();
    cacheValues(fake, { RulerName: 'Fred' }); // no CurrBlock

    await openVotesSection(fake);

    expect(fake.sent).toEqual([]);
  });

  it('skips the enrichment when no username is known', async () => {
    const fake = makeVotesCtx({ activeUsername: null, cachedUsername: null });
    cacheValues(fake, { CurrBlock: '40133888', RulerName: 'Fred' });

    await openVotesSection(fake);

    expect(fake.sent).toEqual([]);
  });

  it('skips the enrichment entirely when the template has no votes tab', async () => {
    const fake = makeDetailsCtx({ activeUsername: 'SPO_test3' });
    focusReturns(fake, '40133602');
    cacheValues(fake, { CurrBlock: '40133888', Name: 'Shop' });

    // GENERIC_TEMPLATE does collect CurrBlock, but it has no votes group.
    await getBuildingBasicDetails(fake.ctx, X, Y, 'unregistered');

    // It does carry an upgrade tab, so the one request on the wire is that
    // enrichment's — never RDOVoteOf.
    expect(fake.sent.map(s => s.packet.member)).toEqual(['RDOAcceptCloning']);
  });

  it('leaves the tab alone when the server returns no vote', async () => {
    const fake = makeVotesCtx();
    cacheValues(fake, { CurrBlock: '40133888', RulerName: 'Fred' });
    rdoMembers(fake, { RDOVoteOf: 'res="%"' });

    const groups = await openVotesSection(fake);

    expect(groups['votes'].some(v => v.name === 'VoteOf')).toBe(false);
  });

  it('leaves the tab alone when the reply carries no payload at all', async () => {
    const fake = makeVotesCtx();
    cacheValues(fake, { CurrBlock: '40133888', RulerName: 'Fred' });
    const noPayload: RdoPacket = { raw: '', type: 'RESPONSE', rid: 3 };
    fake.respond(() => noPayload);

    const groups = await openVotesSection(fake);

    expect(groups['votes'].some(v => v.name === 'VoteOf')).toBe(false);
  });

  it('swallows a failed RDOVoteOf — the rest of the sheet still renders', async () => {
    const fake = makeVotesCtx();
    cacheValues(fake, { CurrBlock: '40133888', RulerName: 'Fred' });
    fake.respond(() => new Error('Request timeout: RDOVoteOf'));

    const groups = await openVotesSection(fake);

    expect(groups['votes']).toBeDefined();
    expect(fake.log.debug).toHaveBeenCalledWith(expect.stringContaining('VoteOf enrichment failed'));
  });
});

// ===========================================================================
// enrichUpgradeTab — AcceptCloning is read live, never from the object cache
// ===========================================================================

describe('upgrade enrichment', () => {
  /**
   * The upgrade tab is a LAZY section since the opening read was narrowed to the
   * header: `getBuildingBasicDetails` never builds `groups['upgrade']` any more,
   * so the enrichment lives on the section read the menu entry triggers.
   * `facManagement` is the CLASSES.BIN handler that maps to UPGRADE_GROUP.
   */
  function makeUpgradeCtx(over: DetailsCtxOptions = {}): FakeSessionCtx {
    const fake = makeDetailsCtx(over);
    registerTabs('9013', ['unkGeneral', 'facManagement']);
    focusReturns(fake, '40133602');
    return fake;
  }

  /** Open the building, then open its upgrade section — what the UI does. */
  async function openUpgradeSection(fake: FakeSessionCtx) {
    await getBuildingBasicDetails(fake.ctx, X, Y, '9013');
    fake.sent.length = 0;
    return getBuildingTabData(fake.ctx, X, Y, 'upgrade', '9013', ['upgrade']);
  }

  it('asks RDOAcceptCloning on CurrBlock and appends the answer to the upgrade tab', async () => {
    const fake = makeUpgradeCtx();
    cacheValues(fake, { CurrBlock: '40133888', Name: 'Shop' });
    rdoMembers(fake, { RDOAcceptCloning: 'RDOAcceptCloning="#1"' });

    const data = await openUpgradeSection(fake);

    expect(fake.sent).toHaveLength(1);
    const [{ packet, socketName, category }] = fake.sent;
    expect(socketName).toBe('construction');
    expect(packet.verb).toBe(RdoVerb.SEL);
    // The block, not the inspector temp object — Voyager binds the same way
    // (ManagementSheet.pas:272-273).
    expect(packet.targetId).toBe('40133888');
    expect(packet.action).toBe(RdoAction.GET);
    expect(packet.member).toBe('RDOAcceptCloning');
    expect(category).toBe(TimeoutCategory.NORMAL);
    expect(data.groups!['upgrade']).toContainEqual({ name: 'AcceptCloning', value: '1' });
  });

  it('carries a cleared flag through as "0" rather than dropping it', async () => {
    const fake = makeUpgradeCtx();
    cacheValues(fake, { CurrBlock: '40133888', Name: 'Shop' });
    rdoMembers(fake, { RDOAcceptCloning: 'RDOAcceptCloning="#0"' });

    const data = await openUpgradeSection(fake);

    expect(data.groups!['upgrade']).toContainEqual({ name: 'AcceptCloning', value: '0' });
  });

  // The bug this whole change is about: the name used to travel inside the
  // section's GetPropertyList, and the cache answers '' for a name it does not
  // hold — a permanently unchecked box, plus a duplicate entry once the live
  // value arrived.
  it('never asks the object cache for AcceptCloning — one entry, not two', async () => {
    const fake = makeUpgradeCtx();
    cacheValues(fake, { CurrBlock: '40133888', Name: 'Shop' });
    rdoMembers(fake, { RDOAcceptCloning: 'RDOAcceptCloning="#1"' });

    const data = await openUpgradeSection(fake);

    const asked = fake.cacher.getPropertyList.mock.calls.flatMap(([, names]) => names);
    expect(asked).not.toContain('AcceptCloning');
    // …but the block id it binds to IS asked for, which is what makes the live
    // read reachable at all (ManagementSheet.pas:243).
    expect(asked).toContain('CurrBlock');
    expect(data.groups!['upgrade'].filter(v => v.name === 'AcceptCloning')).toHaveLength(1);
  });

  it('connects the construction service first when its socket is down', async () => {
    const fake = makeUpgradeCtx();
    cacheValues(fake, { CurrBlock: '40133888', Name: 'Shop' });
    rdoMembers(fake, { RDOAcceptCloning: 'RDOAcceptCloning="#1"' });

    const data = await openUpgradeSection(fake);

    expect(fake.ctx.connectConstructionService).toHaveBeenCalled();
    expect(data.groups!['upgrade']).toContainEqual({ name: 'AcceptCloning', value: '1' });
  });

  it('does not reconnect when the construction socket is already up', async () => {
    const fake = makeUpgradeCtx({ sockets: ['map', 'construction'] });
    cacheValues(fake, { CurrBlock: '40133888', Name: 'Shop' });
    rdoMembers(fake, { RDOAcceptCloning: 'RDOAcceptCloning="#1"' });

    await openUpgradeSection(fake);

    expect(fake.ctx.connectConstructionService).not.toHaveBeenCalled();
  });

  it('skips the enrichment when the block id is unknown', async () => {
    const fake = makeUpgradeCtx();
    cacheValues(fake, { Name: 'Shop' }); // CurrBlock answers ''

    await openUpgradeSection(fake);

    expect(fake.sent).toEqual([]);
  });

  it('never fires on the opening read — the upgrade tab is not built there', async () => {
    const fake = makeUpgradeCtx();
    cacheValues(fake, { CurrBlock: '40133888', Name: 'Shop' });
    rdoMembers(fake, { RDOAcceptCloning: 'RDOAcceptCloning="#1"' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9013');

    expect(details.groups['upgrade']).toBeUndefined();
    expect(fake.sent).toEqual([]);
  });

  it('skips the enrichment when the opened section has no upgrade tab', async () => {
    const fake = makeUpgradeCtx();
    registerTabs('9014', ['unkGeneral', 'Workforce']);
    cacheValues(fake, { CurrBlock: '40133888', Name: 'Shop' });

    await getBuildingBasicDetails(fake.ctx, X, Y, '9014');
    fake.sent.length = 0;
    const data = await getBuildingTabData(fake.ctx, X, Y, 'workforce', '9014', ['workforce']);

    expect(data.groups!['upgrade']).toBeUndefined();
    expect(fake.sent.map(r => r.packet.member)).not.toContain('RDOAcceptCloning');
  });

  it('leaves the tab alone when the server answers with nothing', async () => {
    const fake = makeUpgradeCtx();
    cacheValues(fake, { CurrBlock: '40133888', Name: 'Shop' });
    rdoMembers(fake, { RDOAcceptCloning: '' });

    const data = await openUpgradeSection(fake);

    expect(data.groups!['upgrade'].some(v => v.name === 'AcceptCloning')).toBe(false);
  });

  it('swallows a failed RDOAcceptCloning — the rest of the section still renders', async () => {
    const fake = makeUpgradeCtx();
    cacheValues(fake, { CurrBlock: '40133888', Name: 'Shop' });
    fake.respond(() => new Error('Request timeout: RDOAcceptCloning'));

    const data = await openUpgradeSection(fake);

    expect(data.groups!['upgrade']).toBeDefined();
    expect(data.groups!['upgrade'].some(v => v.name === 'AcceptCloning')).toBe(false);
    expect(fake.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('AcceptCloning enrichment failed'),
    );
  });
});

// ===========================================================================
// GATE ENUMERATION — GetInputNames / GetOutputNames wire form and parsing
// ===========================================================================

describe('gate enumeration', () => {
  async function supplyPathsFor(payload: string): Promise<string[]> {
    const fake = makeDetailsCtx();
    registerTabs('9013', ['Supplies']);
    setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true }));
    cacheValues(fake, { MetaFluid: 'X', cnxCount: '0' });
    fake.respond((packet) => {
      if (packet.member === 'GetInputNames') return payload;
      if (packet.member === 'SetPath') return 'res="#-1"';
      return '';
    });
    const data = await getBuildingTabData(fake.ctx, X, Y, 'supplies');
    return (data.supplies ?? []).map(s => s.path);
  }

  it('calls GetInputNames on the temp object with (integer, widestring)', async () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true }));
    fake.respond(() => 'res="%0"');

    await getBuildingTabData(fake.ctx, X, Y, 'supplies');

    const [{ packet, socketName, category }] = fake.sent;
    expect(socketName).toBe('map');
    expect(packet.targetId).toBe(FIRST_TEMP); // the inspector's object, not x/y
    expect(packet.member).toBe('GetInputNames');
    expect(packet.args).toEqual([RdoValue.int(0).format(), RdoValue.string('0').format()]);
    expect(category).toBe(TimeoutCategory.NORMAL);
  });

  it('splits "path::\\nname" entries separated by CRLF', async () => {
    expect(await supplyPathsFor('res="%Seg0::\nBooks\r\nSeg1::\nCars"')).toEqual(['Seg0', 'Seg1']);
  });

  it('treats 0, -1 and an empty payload as "no gates"', async () => {
    expect(await supplyPathsFor('res="%0"')).toEqual([]);
    expect(await supplyPathsFor('res="%-1"')).toEqual([]);
    expect(await supplyPathsFor('')).toEqual([]);
  });

  it('drops an entry with no :: separator', async () => {
    expect(await supplyPathsFor('res="%garbage\r\nSeg1::\nCars"')).toEqual(['Seg1']);
  });

  it('cuts a gate name at the first NUL byte', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9013', ['Supplies']);
    setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true }));
    cacheValues(fake, { MetaFluid: 'X', cnxCount: '0' });
    fake.respond((packet) => {
      if (packet.member === 'GetInputNames') return `res="%Seg0::\nBooks${String.fromCharCode(0)}${String.fromCharCode(0)}junk"`;
      if (packet.member === 'SetPath') return 'res="#-1"';
      return '';
    });

    const data = await getBuildingTabData(fake.ctx, X, Y, 'supplies');

    expect(data.supplies?.[0].name).toBe('Books');
  });

  it('uses GetOutputNames for the products tab', async () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({ hasProducts: true }));
    fake.respond(() => 'res="%0"');

    await getBuildingTabData(fake.ctx, X, Y, 'products');

    expect(fake.sent[0].packet.member).toBe('GetOutputNames');
  });

  it('returns no products when GetOutputNames answers nothing', async () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({ hasProducts: true }));
    fake.respond((packet) => (packet.member === 'GetOutputNames' ? 'res="%-1"' : ''));

    expect((await getBuildingTabData(fake.ctx, X, Y, 'products')).products).toEqual([]);
  });

  it('drops a product entry with no :: separator', async () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({ hasProducts: true }));
    cacheValues(fake, { MetaFluid: 'X', cnxCount: '0' });
    fake.respond((packet) => {
      if (packet.member === 'GetOutputNames') return `res="%broken\r\nGate1::\nCars${String.fromCharCode(0)}tail"`;
      if (packet.member === 'SetPath') return 'res="#-1"';
      return '';
    });

    const data = await getBuildingTabData(fake.ctx, X, Y, 'products');

    expect(data.products?.map(p => [p.path, p.name])).toEqual([['Gate1', 'Cars']]);
  });
});

// ===========================================================================
// getBuildingTabData — lazy phases 3+4
// ===========================================================================

describe('getBuildingTabData', () => {
  it('resets the temp object to the building root before every tab read', async () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true }));
    fake.respond(() => 'res="%0"');

    await getBuildingTabData(fake.ctx, X, Y, 'supplies');

    // A previous tab may have left the object on a gate sub-path; without this
    // reset GetInputNames reads from the wrong context (:376-378).
    expect(fake.cacher.setObject).toHaveBeenCalledWith(FIRST_TEMP, X, Y);
  });

  it('returns nothing for a tab asked for with no group list and no gate data', async () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector());

    expect(await getBuildingTabData(fake.ctx, X, Y, 'indGeneral')).toEqual({});
    expect(fake.sent).toEqual([]);
  });

  // ── section reads: the groups the opening read deliberately skipped ──────

  it('reads a section group the opening read skipped', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9101', ['IndGeneral', 'Workforce']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Plant', Workers0: '25', WorkersMax0: '40' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9101');
    // The opening read stopped at the header group.
    expect(details.groups['Workforce']).toBeUndefined();

    const workforceId = details.tabs[1].id;
    const tab = await getBuildingTabData(fake.ctx, X, Y, workforceId, '9101', [workforceId]);

    expect(tab.groups?.[workforceId]).toBeDefined();
    expect(tab.groups?.[workforceId]).toContainEqual(
      expect.objectContaining({ name: 'Workers0', value: '25' }),
    );
  });

  it('refreshes the header group alongside the section, so the header stays live', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9102', ['IndGeneral', 'Workforce']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Plant', ROI: '14%', Workers0: '25' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9102');
    const [generalId, workforceId] = details.tabs.map(t => t.id);

    const tab = await getBuildingTabData(fake.ctx, X, Y, workforceId, '9102', [workforceId]);

    // `collectTemplatePropertyNamesForGroups` folds the first group back in.
    expect(tab.groups?.[generalId]).toContainEqual(
      expect.objectContaining({ name: 'ROI', value: '14%' }),
    );
  });

  it('reads the several groups a civic tab consolidates in one request', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9103', ['capitolGeneral', 'capitolTowns', 'ministeries']);
    focusReturns(fake, '40133602');
    cacheValues(fake, {
      Name: 'Capitol', townCount: '1', townName0: 'Helartia',
      ministryCount: '1', ministryName0: 'Agriculture',
    });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9103');
    const groupIds = details.tabs.slice(1).map(t => t.id);

    const tab = await getBuildingTabData(fake.ctx, X, Y, 'administration', '9103', groupIds);

    // Whatever the groups turn out to hold, the read covered both ids and only
    // the ids asked for — no third group rode along beyond the header one.
    const returned = new Set(Object.keys(tab.groups ?? {}));
    for (const id of returned) {
      expect([...groupIds, details.tabs[0].id]).toContain(id);
    }
  });

  it('holds the inspector mutex, so a section read cannot race a gate read', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9104', ['IndGeneral', 'Workforce']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Plant', Workers0: '25' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9104');
    const workforceId = details.tabs[1].id;
    fake.cacher.setObject.mockClear();

    await getBuildingTabData(fake.ctx, X, Y, workforceId, '9104', [workforceId]);

    // The reset to building root runs before the read, exactly as the gate path
    // needs — a previous SetPath must not decide what a section sees.
    expect(fake.cacher.setObject).toHaveBeenCalledWith(FIRST_TEMP, X, Y);
  });

  it('returns nothing when the tab exists but the template says it has no data', async () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: false }));

    expect(await getBuildingTabData(fake.ctx, X, Y, 'supplies')).toEqual({});
  });

  it('lists a supply gate and reads nothing whatsoever about it', async () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true }));
    // The cache would answer every header property. Nothing asks it to.
    cacheValues(fake, {
      MetaFluid: 'Fresh Food', FluidValue: '1200', LastCostPerc: '85', minK: '30',
      MaxPrice: '150', QPSorted: '1', SortMode: '0', cnxCount: '1', ObjectId: '40133999',
    });
    fake.respond((packet) => {
      if (packet.member === 'GetInputNames') return 'res="%Seg0::\nFresh Food"';
      if (packet.member === 'SetPath') return 'res="#-1"';
      return '';
    });

    const { supplies } = await getBuildingTabData(fake.ctx, X, Y, 'supplies');

    // path and name come from GetInputNames; everything else is undefined,
    // which the panel renders as "not read yet" rather than as a zero.
    expect(supplies).toEqual([{ path: 'Seg0', name: 'Fresh Food', connections: [] }]);
    expect(supplies?.[0].connectionCount).toBeUndefined();
    expect(supplies?.[0].metaFluid).toBeUndefined();
    expect(fake.sent.filter(f => f.packet.member === 'SetPath')).toHaveLength(0);
    expect(fake.cacher.getPropertyList).not.toHaveBeenCalled();
  });

  // A packet with no payload at all is what a truncated or dropped frame
  // produces; every read on this path has to survive it.
  describe('payload-less replies', () => {
    const NO_PAYLOAD: RdoPacket = { raw: '', type: 'RESPONSE', rid: 1 };

    it('treats a payload-less GetInputNames as no gates', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true }));
      fake.respond(() => NO_PAYLOAD);

      expect((await getBuildingTabData(fake.ctx, X, Y, 'supplies')).supplies).toEqual([]);
    });

    it('treats a payload-less GetOutputNames as no gates', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasProducts: true }));
      fake.respond(() => NO_PAYLOAD);

      expect((await getBuildingTabData(fake.ctx, X, Y, 'products')).products).toEqual([]);
    });

  });

  it('lists a product gate the same way, through GetOutputNames alone', async () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({ hasProducts: true }));
    cacheValues(fake, {
      MetaFluid: 'Cars', LastFluid: '80', FluidQuality: '90%', PricePc: '110',
      AvgPrice: '$4', MarketPrice: '$5', cnxCount: '0',
    });
    fake.respond((packet) => {
      if (packet.member === 'GetOutputNames') return 'res="%Gate0::\nCars"';
      return '';
    });

    const { products } = await getBuildingTabData(fake.ctx, X, Y, 'products');

    expect(products).toEqual([{ path: 'Gate0', name: 'Cars', connections: [] }]);
    expect(fake.cacher.getPropertyList).not.toHaveBeenCalled();
  });

  describe('warehouse gates', () => {
    const THIRTY_PATHS = Array.from({ length: 30 }, (_, i) => `Seg${i}::\nWare${i}`).join('\r\n');

    it('reads only the gates the GateMap enables', async () => {
      const fake = makeDetailsCtx();
      // Real Import Storage GateMap: bits 0, 11 and 24 set.
      const gateMap = '100000000001000000000000100000';
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true, isWarehouse: true, gateMap }));
      cacheValues(fake, { MetaFluid: 'X', cnxCount: '0', InputCount: '3', 'Input0.0': 'Books' });
      fake.respond((packet) => {
        if (packet.member === 'GetInputNames') return `res="%${THIRTY_PATHS}"`;
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });

      const { supplies, warehouseWares } = await getBuildingTabData(fake.ctx, X, Y, 'supplies');

      expect(supplies?.map(s => s.path)).toEqual(['Seg0', 'Seg11', 'Seg24']);
      // A warehouse also gets the ware list back so the client can label them.
      expect(warehouseWares).toHaveLength(3);
    });

    it('reads no gate at all when every bit of the GateMap is clear', async () => {
      const fake = makeDetailsCtx();
      const gateMap = '0'.repeat(30);
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true, isWarehouse: true, gateMap }));
      cacheValues(fake, { InputCount: '0' });
      fake.respond((packet) => {
        if (packet.member === 'GetInputNames') return `res="%${THIRTY_PATHS}"`;
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });

      const { supplies } = await getBuildingTabData(fake.ctx, X, Y, 'supplies');

      expect(supplies).toEqual([]);
      expect(fake.sent.some(s => s.packet.member === 'SetPath')).toBe(false);
    });

    it('ignores the gates a short GateMap does not cover', async () => {
      const fake = makeDetailsCtx();
      // Only the first three gates are described; the other 27 stay closed.
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true, isWarehouse: true, gateMap: '101' }));
      cacheValues(fake, { MetaFluid: 'X', cnxCount: '0', InputCount: '0' });
      fake.respond((packet) => {
        if (packet.member === 'GetInputNames') return `res="%${THIRTY_PATHS}"`;
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });

      const { supplies } = await getBuildingTabData(fake.ctx, X, Y, 'supplies');

      expect(supplies?.map(s => s.path)).toEqual(['Seg0', 'Seg2']);
    });

    it('reads every gate when the warehouse has no GateMap at all', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasProducts: true, isWarehouse: true, gateMap: '' }));
      cacheValues(fake, { MetaFluid: 'X', cnxCount: '0', InputCount: '0' });
      fake.respond((packet) => {
        if (packet.member === 'GetOutputNames') return 'res="%Gate0::\nA\r\nGate1::\nB"';
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });

      const { products, warehouseWares } = await getBuildingTabData(fake.ctx, X, Y, 'products');

      expect(products?.map(p => p.path)).toEqual(['Gate0', 'Gate1']);
      expect(warehouseWares).toEqual([]);
    });

    it('filters the product gates of a warehouse by the same GateMap', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasProducts: true, isWarehouse: true, gateMap: '011' }));
      cacheValues(fake, { MetaFluid: 'X', cnxCount: '0', InputCount: '0' });
      fake.respond((packet) => {
        if (packet.member === 'GetOutputNames') return 'res="%G0::\nA\r\nG1::\nB\r\nG2::\nC"';
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });

      const { products } = await getBuildingTabData(fake.ctx, X, Y, 'products');

      expect(products?.map(p => p.path)).toEqual(['G1', 'G2']);
    });
  });

  describe('non-warehouse gates and the GateMap', () => {
    it('lists only the supply gates the GateMap does not mark disabled', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true, isWarehouse: false, gateMap: '101' }));
      cacheValues(fake, { MetaFluid: 'X', cnxCount: '0' });
      fake.respond((packet) => {
        if (packet.member === 'GetInputNames') {
          return 'res="%In0::\nA\r\nIn1::\nB\r\nIn2::\nC"';
        }
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });

      const { supplies } = await getBuildingTabData(fake.ctx, X, Y, 'supplies');

      expect(supplies?.map(s => s.path)).toEqual(['In0', 'In2']);
      expect(fake.sent.some(s => s.packet.member === 'SetPath')).toBe(false);
      expect(fake.cacher.getPropertyList).not.toHaveBeenCalled();
    });

    it('lists only the product gates the GateMap does not mark disabled', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasProducts: true, isWarehouse: false, gateMap: '01' }));
      cacheValues(fake, { MetaFluid: 'X', cnxCount: '0' });
      fake.respond((packet) => {
        if (packet.member === 'GetOutputNames') return 'res="%Out0::\nA\r\nOut1::\nB"';
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });

      const { products } = await getBuildingTabData(fake.ctx, X, Y, 'products');

      expect(products?.map(p => p.path)).toEqual(['Out1']);
    });

    it('lists every gate when the GateMap is empty', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true, isWarehouse: false, gateMap: '' }));
      cacheValues(fake, { MetaFluid: 'X', cnxCount: '0' });
      fake.respond((packet) => {
        if (packet.member === 'GetInputNames') {
          return 'res="%In0::\nA\r\nIn1::\nB\r\nIn2::\nC"';
        }
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });

      const { supplies } = await getBuildingTabData(fake.ctx, X, Y, 'supplies');

      expect(supplies?.map(s => s.path)).toEqual(['In0', 'In1', 'In2']);
    });

    it('lists every gate when the GateMap is shorter than the gate list — no off-by-one', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true, isWarehouse: false, gateMap: '1' }));
      cacheValues(fake, { MetaFluid: 'X', cnxCount: '0' });
      fake.respond((packet) => {
        if (packet.member === 'GetInputNames') {
          return 'res="%In0::\nA\r\nIn1::\nB\r\nIn2::\nC"';
        }
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });

      const { supplies } = await getBuildingTabData(fake.ctx, X, Y, 'supplies');

      expect(supplies?.map(s => s.path)).toEqual(['In0', 'In1', 'In2']);
    });

    it('leaves a gate listed when its map character is neither "0" nor "1"', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true, isWarehouse: false, gateMap: '1x1' }));
      cacheValues(fake, { MetaFluid: 'X', cnxCount: '0' });
      fake.respond((packet) => {
        if (packet.member === 'GetInputNames') {
          return 'res="%In0::\nA\r\nIn1::\nB\r\nIn2::\nC"';
        }
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });

      const { supplies } = await getBuildingTabData(fake.ctx, X, Y, 'supplies');

      expect(supplies?.map(s => s.path)).toEqual(['In0', 'In1', 'In2']);
    });

    it('reads the GateMap for an on-demand, non-warehouse inspector and applies it', async () => {
      const fake = makeDetailsCtx();
      registerTabs('9013', ['Supplies']);
      cacheValues(fake, { GateMap: '10', MetaFluid: 'X', cnxCount: '0' });
      fake.respond((packet) => {
        if (packet.member === 'GetInputNames') return 'res="%In0::\nA\r\nIn1::\nB"';
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });

      const { supplies } = await getBuildingTabData(fake.ctx, X, Y, 'supplies', '9013');

      expect(getActiveInspector(fake.ctx, X, Y)?.gateMap).toBe('10');
      expect(fake.cacher.getPropertyList).toHaveBeenCalledWith(FIRST_TEMP, ['GateMap']);
      expect(supplies?.map(s => s.path)).toEqual(['In0']);
    });

    it('opens a non-warehouse inspector with every gate listed when the GateMap read fails', async () => {
      const fake = makeDetailsCtx();
      registerTabs('9013', ['Supplies']);
      fake.cacher.getPropertyList.mockImplementation(async (_id: string, names: string[]) => {
        if (names.includes('GateMap')) throw new Error('Request timeout: GetPropertyList');
        return names.map(() => '');
      });
      fake.respond((packet) => {
        if (packet.member === 'GetInputNames') return 'res="%In0::\nA\r\nIn1::\nB"';
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });

      const { supplies } = await getBuildingTabData(fake.ctx, X, Y, 'supplies', '9013');

      expect(getActiveInspector(fake.ctx, X, Y)?.gateMap).toBe('');
      expect(supplies?.map(s => s.path)).toEqual(['In0', 'In1']);
    });
  });

  describe('company inputs', () => {
    it('reads seven indexed properties per input', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasCompInputs: true }));
      cacheValues(fake, {
        cInputCount: '2',
        'cInput0.0': 'Advertising', cInputSup0: '12.5', cInputDem0: '20', cInputRatio0: '62',
        cInputMax0: '100', cEditable0: 'YES', 'cUnits0.0': 'units',
        'cInput1.0': 'Security', cInputSup1: '0', cInputDem1: '5', cInputRatio1: '0',
        cInputMax1: '80', cEditable1: 'no', 'cUnits1.0': 'guards',
      });

      const { compInputs } = await getBuildingTabData(fake.ctx, X, Y, 'compInputs');

      expect(compInputs).toEqual([
        { name: 'Advertising', supplied: 12.5, demanded: 20, ratio: 62, maxDemand: 100, editable: true, units: 'units' },
        { name: 'Security', supplied: 0, demanded: 5, ratio: 0, maxDemand: 80, editable: false, units: 'guards' },
      ]);
    });

    it('returns nothing when the company declares no inputs', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasCompInputs: true }));
      cacheValues(fake, { cInputCount: '0' });

      expect((await getBuildingTabData(fake.ctx, X, Y, 'compInputs')).compInputs).toEqual([]);
    });

    it('batches the indexed reads at 49 properties', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasCompInputs: true }));
      // 8 inputs x 7 properties = 56 names → two batches.
      cacheValues(fake, { cInputCount: '8' });

      await getBuildingTabData(fake.ctx, X, Y, 'compInputs');

      const batches = fake.cacher.getPropertyList.mock.calls.filter(
        ([, names]) => names[0] !== 'cInputCount'
      );
      expect(batches.map(([, names]) => names.length)).toEqual([49, 7]);
    });

    it('falls back to sane defaults for values the cache never wrote', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasCompInputs: true }));
      cacheValues(fake, { cInputCount: '1' });

      const { compInputs } = await getBuildingTabData(fake.ctx, X, Y, 'compInputs');

      expect(compInputs).toEqual([
        { name: '', supplied: 0, demanded: 0, ratio: 0, maxDemand: 100, editable: false, units: '' },
      ]);
    });

    it('returns nothing when the count comes back empty', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasCompInputs: true }));
      cacheValues(fake, {}); // cInputCount answers ''

      expect((await getBuildingTabData(fake.ctx, X, Y, 'compInputs')).compInputs).toEqual([]);
    });

    it('fills in defaults for a batch the server answered short', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasCompInputs: true }));
      fake.cacher.getPropertyList.mockImplementation(async (_id: string, names: string[]) =>
        (names[0] === 'cInputCount' ? ['1'] : []) // no values at all for the batch
      );

      const { compInputs } = await getBuildingTabData(fake.ctx, X, Y, 'compInputs');

      expect(compInputs).toEqual([
        { name: '', supplied: 0, demanded: 0, ratio: 0, maxDemand: 100, editable: false, units: '' },
      ]);
    });

    it('returns nothing when the count read fails', async () => {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({ hasCompInputs: true }));
      fake.cacher.getPropertyList.mockRejectedValue(new Error('Request timeout: GetPropertyList'));

      expect((await getBuildingTabData(fake.ctx, X, Y, 'compInputs')).compInputs).toEqual([]);
      expect(fake.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error fetching comp input data'), expect.anything()
      );
    });
  });

  describe('on-demand inspector', () => {
    it('opens one when the building was loaded through the legacy path', async () => {
      const fake = makeDetailsCtx();
      registerTabs('7001', ['WHGeneral', 'Supplies']);
      cacheValues(fake, { GateMap: '10', MetaFluid: 'X', cnxCount: '0' });
      fake.respond((packet) => (packet.member === 'GetInputNames' ? 'res="%0"' : ''));

      await getBuildingTabData(fake.ctx, X, Y, 'supplies', '7001');

      expect(fake.cacher.createObject).toHaveBeenCalledTimes(1);
      expect(fake.cacher.setObject).toHaveBeenCalledWith(FIRST_TEMP, X, Y);
      const inspector = getActiveInspector(fake.ctx, X, Y);
      expect(inspector?.tempObjectId).toBe(FIRST_TEMP);
      expect(inspector?.isWarehouse).toBe(true);
      expect(inspector?.gateMap).toBe('10');
    });

    it('opens one with no GateMap when the warehouse answers nothing', async () => {
      const fake = makeDetailsCtx();
      registerTabs('7001', ['WHGeneral', 'Supplies']);
      fake.cacher.getPropertyList.mockResolvedValue([]); // GateMap read answers nothing
      fake.respond(() => 'res="%0"');

      await getBuildingTabData(fake.ctx, X, Y, 'supplies', '7001');

      expect(getActiveInspector(fake.ctx, X, Y)?.gateMap).toBe('');
    });

    it('closes a stale inspector before opening the on-demand one', async () => {
      const fake = makeDetailsCtx();
      registerTabs('9013', ['Supplies']);
      setActiveInspectorForTest(fake.ctx, makeInspector({ tempObjectId: '900999', x: X + 5 }));
      fake.respond(() => 'res="%0"');

      await getBuildingTabData(fake.ctx, X, Y, 'supplies', '9013');

      expect(fake.cacher.closeObject).toHaveBeenCalledWith('900999');
    });

    it('falls back to the generic template when no visual class is given', async () => {
      const fake = makeDetailsCtx();

      const data = await getBuildingTabData(fake.ctx, X, Y, 'supplies');

      // GENERIC_TEMPLATE has neither supplies nor products.
      expect(data).toEqual({});
      expect(getActiveInspector(fake.ctx, X, Y)?.hasSupplies).toBe(false);
    });

    it('tolerates a warehouse whose GateMap read fails', async () => {
      const fake = makeDetailsCtx();
      registerTabs('7001', ['WHGeneral']);
      fake.cacher.getPropertyList.mockRejectedValue(new Error('Request timeout: GetPropertyList'));

      await getBuildingTabData(fake.ctx, X, Y, 'whGeneral', '7001');

      expect(getActiveInspector(fake.ctx, X, Y)?.gateMap).toBe('');
    });

    it('refuses to open one before the map service is initialised', async () => {
      const fake = makeDetailsCtx({ cacherId: null });
      registerTabs('9013', ['Supplies']);

      await expect(getBuildingTabData(fake.ctx, X, Y, 'supplies', '9013')).rejects.toThrow(
        'Map service not initialized'
      );
    });

    it('closes the fresh object when SetObject fails, then rethrows', async () => {
      const fake = makeDetailsCtx();
      registerTabs('9013', ['Supplies']);
      fake.cacher.setObject.mockRejectedValue(new Error('Request timeout: SetObject'));

      await expect(getBuildingTabData(fake.ctx, X, Y, 'supplies', '9013')).rejects.toThrow(
        'Request timeout: SetObject'
      );
      expect(fake.cacher.closeObject).toHaveBeenCalledWith(FIRST_TEMP);
      expect(getActiveInspector(fake.ctx, X, Y)).toBeUndefined();
    });
  });

  it('serialises two tab reads on the same inspector', async () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true, hasProducts: true }));
    const order: string[] = [];
    fake.respond((packet) => {
      order.push(packet.member ?? '');
      return 'res="%0"';
    });

    await Promise.all([
      getBuildingTabData(fake.ctx, X, Y, 'supplies'),
      getBuildingTabData(fake.ctx, X, Y, 'products'),
    ]);

    // The mutex must not let the products SetObject land between the supplies
    // SetObject and its GetInputNames — that is the SetPath race it exists for.
    expect(order).toEqual(['GetInputNames', 'GetOutputNames']);
  });
  /**
   * THE OPTIMISATION, stated as a budget.
   *
   * Opening the tab used to cost, per gate, a SetPath, a GetPropertyList AND one
   * GetSubObjectProps per connection — on a live 30-gate warehouse (Export
   * Storage 4 at 924/820) that measured 162 round-trips in 32.4 s. Deferring the
   * connection rows removed 91 of them; deferring the headers removes the other
   * 60, because the accordion draws every gate COLLAPSED and a collapsed row has
   * nothing to say that a header would fill in.
   *
   * What is left is the one call that names the gates —
   * `UpdateFingersToList` does exactly this and no more
   * (Voyager/ProdSheetForm.pas:274-297) — and everything else waits for a click.
   */
  describe('the tab read is one call', () => {
    const THIRTY = Array.from({ length: 30 }, (_, i) => `Seg${i}::\nWare${i}`).join('\r\n');

    function warehouseCtx(kind: 'supplies' | 'products'): FakeSessionCtx {
      const fake = makeDetailsCtx();
      setActiveInspectorForTest(fake.ctx, makeInspector({
        hasSupplies: kind === 'supplies', hasProducts: kind === 'products',
      }));
      // Every gate would answer a header and claim connections. Nothing asks.
      cacheValues(fake, { MetaFluid: 'Ware', cnxCount: '3' });
      fake.respond((packet) => {
        if (packet.member === 'GetInputNames' || packet.member === 'GetOutputNames') {
          return `res="%${THIRTY}"`;
        }
        if (packet.member === 'SetPath') return 'res="#-1"';
        return '';
      });
      return fake;
    }

    it.each(['supplies', 'products'] as const)(
      'touches no gate at all when opening %s',
      async (kind) => {
        const fake = warehouseCtx(kind);

        const data = await getBuildingTabData(fake.ctx, X, Y, kind);
        const gates = data.supplies ?? data.products ?? [];

        expect(gates).toHaveLength(30);
        expect(fake.sent.filter(s => s.packet.member === 'SetPath')).toHaveLength(0);
        expect(fake.sent.filter(s => s.packet.member === 'GetSubObjectProps')).toHaveLength(0);
        expect(fake.cacher.getPropertyList).not.toHaveBeenCalled();
        // Undefined, not zero: nothing was read, and the panel says so.
        expect(gates.every(g => g.connectionCount === undefined)).toBe(true);
        expect(gates.every(g => g.connections.length === 0)).toBe(true);
      },
    );

    it.each(['supplies', 'products'] as const)(
      'spends exactly one round-trip on %s, whatever the gate count',
      async (kind) => {
        const fake = warehouseCtx(kind);

        await getBuildingTabData(fake.ctx, X, Y, kind);

        const listCalls = fake.sent.filter(
          s => s.packet.member === 'GetInputNames' || s.packet.member === 'GetOutputNames',
        );
        expect(listCalls).toHaveLength(1);
        // One call for 30 gates, where the first cut spent 61 and the original
        // shape spent 61 + one per connection.
        expect(fake.sent.length + fake.cacher.getPropertyList.mock.calls.length).toBe(1);
      },
    );
  });

});

// ===========================================================================
// getBuildingGateConnections — the rows behind a click
//
// The tab read above stops at the gate headers. Everything a connection row is
// made of lives here, on the one-gate-at-a-time path the reference client uses
// (`LoadFingerInfo`, Voyager/SupplySheetForm.pas:440-506).
// ===========================================================================

describe('getBuildingGateConnections', () => {
  /** Answer as a healthy gate would, with `rows` as the GetSubObjectProps reply. */
  function gateCtx(
    kind: 'supplies' | 'products',
    props: Record<string, string>,
    rows: string | Error | RdoPacket,
  ): FakeSessionCtx {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({
      hasSupplies: kind === 'supplies', hasProducts: kind === 'products',
    }));
    cacheValues(fake, props);
    fake.respond((packet) => {
      if (packet.member === 'SetPath') return 'res="#-1"';
      if (packet.member === 'GetSubObjectProps') return rows;
      return '';
    });
    return fake;
  }

  it("reads one gate on the inspector's own object: SetPath, header, then rows", async () => {
    const fake = gateCtx('supplies', {
      MetaFluid: 'Fresh Food', FluidValue: '1200', LastCostPerc: '85', minK: '30',
      MaxPrice: '150', QPSorted: '1', SortMode: '0', cnxCount: '1', ObjectId: '40133999',
    }, 'res="%Farm A\tSPO_test3\tYellow Inc.\t100\t10\t900\t$12\t95%\t1\t40\t50\t"');

    const { supply } = await getBuildingGateConnections(
      fake.ctx, X, Y, 'supplies', 'Seg0', 'Fresh Food',
    );

    expect(supply).toEqual({
      path: 'Seg0',
      name: 'Fresh Food',
      metaFluid: 'Fresh Food',
      fluidValue: '1200',
      lastCostPerc: '85',
      minK: '30',
      maxPrice: '150',
      qpSorted: '1',
      sortMode: '0',
      connectionCount: 1,
      connections: [{
        facilityName: 'Farm A', createdBy: 'SPO_test3', companyName: 'Yellow Inc.',
        price: '100', overprice: '10', lastValue: '900', cost: '$12', quality: '95%',
        connected: true, x: 40, y: 50,
      }],
    });
    // SetPath goes to the SAME object the inspector owns — §4bis.
    const setPath = fake.sent.find(s => s.packet.member === 'SetPath');
    expect(setPath?.packet.targetId).toBe(FIRST_TEMP);
    expect(setPath?.packet.args).toEqual([RdoValue.string('Seg0').format()]);
    expect(setPath?.category).toBe(TimeoutCategory.SLOW);
  });

  it('reads a product gate with its own column set', async () => {
    const fake = gateCtx('products', {
      MetaFluid: 'Cars', LastFluid: '80', FluidQuality: '90%', PricePc: '110',
      AvgPrice: '$4', MarketPrice: '$5', cnxCount: '1',
    }, 'res="%Toy Store 3\tYellow Inc.\t900\t1\t$12\t40\t50\t"');

    const { product } = await getBuildingGateConnections(
      fake.ctx, X, Y, 'products', 'Gate0', 'Cars',
    );

    expect(product).toEqual({
      path: 'Gate0', name: 'Cars', metaFluid: 'Cars', lastFluid: '80', quality: '90%',
      pricePc: '110', avgPrice: '$4', marketPrice: '$5', connectionCount: 1,
      connections: [{
        facilityName: 'Toy Store 3', companyName: 'Yellow Inc.', createdBy: '',
        price: '', overprice: '', lastValue: '900', cost: '$12', quality: '',
        connected: true, x: 40, y: 50,
      }],
    });
  });

  it('does not reset the object to the building root first', async () => {
    // SetPath resolves through the world spool and releases whatever the object
    // held (Cache Server/CachedObjectWrap.pas:156-168), so the reset the tab
    // read needs for GetInputNames buys nothing here — and it would be one more
    // round-trip on the click path, which is the path being made cheap.
    const fake = gateCtx('supplies', { cnxCount: '0' }, '');

    await getBuildingGateConnections(fake.ctx, X, Y, 'supplies', 'Seg0', 'Books');

    expect(fake.cacher.setObject).not.toHaveBeenCalled();
  });

  it('opens an inspector on the fly when none is armed', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9013', ['Supplies']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { cnxCount: '0' });
    fake.respond((packet) => (packet.member === 'SetPath' ? 'res="#-1"' : ''));

    const { supply } = await getBuildingGateConnections(
      fake.ctx, X, Y, 'supplies', 'Seg0', 'Books', '9013',
    );

    expect(supply?.path).toBe('Seg0');
    expect(getActiveInspector(fake.ctx, X, Y)).toBeDefined();
  });

  it('returns nothing when SetPath is refused', async () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector({ hasSupplies: true }));
    fake.respond(() => 'res="#0"');

    expect(await getBuildingGateConnections(fake.ctx, X, Y, 'supplies', 'Seg0', 'Books')).toEqual({});
    expect(await getBuildingGateConnections(fake.ctx, X, Y, 'products', 'Gate0', 'Cars')).toEqual({});
  });

  it('caps the connection sweep at 20 however many the gate claims', async () => {
    const fake = gateCtx('supplies', { MetaFluid: 'Books', cnxCount: '75' },
      'res="%a\tb\tc\td\te\tf\tg\th\t1\t0\t0\t"');

    const { supply } = await getBuildingGateConnections(fake.ctx, X, Y, 'supplies', 'Seg0', 'Books');

    expect(supply?.connectionCount).toBe(75); // reported as the server said
    expect(supply?.connections).toHaveLength(20); // but only 20 were read
    expect(fake.sent.filter(s => s.packet.member === 'GetSubObjectProps')).toHaveLength(20);
  });

  it('suffixes every requested property name with the sub-index', async () => {
    // Voyager/SupplySheetForm.pas:474-491 builds the query the same way; the
    // index is part of each NAME, not a separate argument.
    const fake = gateCtx('supplies', { MetaFluid: 'Books', cnxCount: '2' },
      'res="%a\tb\tc\td\te\tf\tg\th\t1\t0\t0\t"');

    await getBuildingGateConnections(fake.ctx, X, Y, 'supplies', 'Seg0', 'Books');

    const queries = fake.sent
      .filter(s => s.packet.member === 'GetSubObjectProps')
      .map(s => s.packet.args?.[1] ?? '');
    expect(queries.some(q => q.includes('cnxFacilityName0') && q.includes('cnxYPos0'))).toBe(true);
    expect(queries.some(q => q.includes('cnxFacilityName1') && q.includes('cnxYPos1'))).toBe(true);
  });

  it('drops a connection row the server answered short', async () => {
    const fake = gateCtx('supplies', { MetaFluid: 'Books', cnxCount: '1' },
      'res="%only\ttwo\t"'); // fewer than the 11 columns a supply needs

    const { supply } = await getBuildingGateConnections(fake.ctx, X, Y, 'supplies', 'Seg0', 'Books');

    expect(supply?.connections).toEqual([]);
  });

  it('drops a product connection row the server answered short', async () => {
    const fake = gateCtx('products', { MetaFluid: 'Cars', cnxCount: '1' },
      'res="%only\ttwo\t"'); // fewer than the 7 columns a product needs

    const { product } = await getBuildingGateConnections(fake.ctx, X, Y, 'products', 'Gate0', 'Cars');

    expect(product?.connections).toEqual([]);
  });

  it('does not guess columns from a tab-less reply', async () => {
    // This used to split on whitespace. The cache server writes one value + TAB
    // per requested name and nothing else (Cache Server/CachedObjectWrap.pas:
    // 225-230), so a tab-less reply is malformed, not an alternative encoding --
    // and guessing is worse than refusing: real facility names contain spaces
    // ("Import Storage 4", "Toy Store 3", live capture), so the guess silently
    // shifts every column and reports a supplier that does not exist.
    const fake = gateCtx('products', { MetaFluid: 'Cars', cnxCount: '1' },
      'res="%Import Storage 4 YellowInc 900 1 $12 40 50"');

    const { product } = await getBuildingGateConnections(fake.ctx, X, Y, 'products', 'Gate0', 'Cars');

    expect(product?.connections).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failing sub-index(es): 0'),
    );
  });

  it('keeps a connection row whose columns are all empty', async () => {
    // The live defect behind "cnxCount says 1" above an empty list. A stale
    // sub-object cache answers with seven empty columns, and cleanPayload ends
    // in .trim() (rdo-helpers.ts:106), so the row -- being nothing but tabs --
    // was reduced to '' and dropped. The count and the list then disagreed with
    // nothing said. The row must survive, blank.
    const fake = gateCtx('products', { MetaFluid: 'Cars', cnxCount: '1' },
      'res="%\t\t\t\t\t\t\t"');

    const { product } = await getBuildingGateConnections(fake.ctx, X, Y, 'products', 'Gate0', 'Cars');

    expect(product?.connectionCount).toBe(1);
    expect(product?.connections).toHaveLength(1);
    expect(product?.connections[0].facilityName).toBe('');
    expect(fake.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('returned an empty GetSubObjectProps payload'),
    );
  });

  it('keeps a supply row whose columns are all empty', async () => {
    const fake = gateCtx('supplies', { MetaFluid: 'Books', cnxCount: '1' },
      'res="%\t\t\t\t\t\t\t\t\t\t\t"');

    const { supply } = await getBuildingGateConnections(fake.ctx, X, Y, 'supplies', 'Seg0', 'Books');

    expect(supply?.connectionCount).toBe(1);
    expect(supply?.connections).toHaveLength(1);
  });

  it('substitutes the documented defaults for every blank supply column', async () => {
    // 12 columns: only the first and last carry text, so columns 1-10 blank.
    const fake = gateCtx('supplies', { MetaFluid: 'Books', cnxCount: '1' },
      `res="%head${'\t'.repeat(11)}tail"`);

    const { supply } = await getBuildingGateConnections(fake.ctx, X, Y, 'supplies', 'Seg0', 'Books');

    expect(supply?.connections).toEqual([{
      facilityName: 'head', createdBy: '', companyName: '', price: '0', overprice: '0',
      lastValue: '', cost: '$0', quality: '0%', connected: false, x: 0, y: 0,
    }]);
  });

  it('substitutes the documented defaults for every blank product column', async () => {
    const fake = gateCtx('products', { MetaFluid: 'Cars', cnxCount: '1' },
      `res="%head${'\t'.repeat(7)}tail"`);

    const { product } = await getBuildingGateConnections(fake.ctx, X, Y, 'products', 'Gate0', 'Cars');

    expect(product?.connections).toEqual([{
      facilityName: 'head', companyName: '', createdBy: '', price: '', overprice: '',
      lastValue: '', cost: '', quality: '', connected: false, x: 0, y: 0,
    }]);
  });

  it('returns no connections when the sub-object read fails', async () => {
    const fake = gateCtx('supplies', { MetaFluid: 'Books', cnxCount: '1' },
      new Error('Request timeout: GetSubObjectProps'));

    const { supply } = await getBuildingGateConnections(fake.ctx, X, Y, 'supplies', 'Seg0', 'Books');

    expect(supply?.connections).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Error fetching sub-object 0'), expect.anything()
    );
  });

  it('reads no connections from a payload-less GetSubObjectProps', async () => {
    const fake = gateCtx('supplies', { MetaFluid: 'Books', cnxCount: '1' },
      { raw: '', type: 'RESPONSE', rid: 1 });

    const { supply } = await getBuildingGateConnections(fake.ctx, X, Y, 'supplies', 'Seg0', 'Books');

    expect(supply?.connections).toEqual([]);
  });

  it('says so when cnxCount and the rows disagree, instead of dropping the row silently', async () => {
    // The live symptom: a warehouse showing "1 supplier" above an empty list.
    // The count comes off the gate, the rows come from GetSubObjectProps, and
    // an empty payload used to remove the row with nothing said. The
    // discrepancy still reaches the client -- that is deliberate, the UI
    // reports it -- but it must be traceable in the log too.
    const fake = gateCtx('supplies', { MetaFluid: 'Books', cnxCount: '1' },
      { raw: '', type: 'RESPONSE', rid: 1 });

    const { supply } = await getBuildingGateConnections(fake.ctx, X, Y, 'supplies', 'Seg0', 'Books');

    expect(supply?.connectionCount).toBe(1);
    expect(supply?.connections).toHaveLength(0);
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('cnxCount says 1 but 1 connection(s) returned an empty'),
    );
    // The index is the one datum that makes a partial gate read reproducible:
    // with 12 suppliers, #7 failing must not look like #0 failing.
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failing sub-index(es): 0'),
    );
  });

  it('says so on the clients list too', async () => {
    const fake = gateCtx('products', { MetaFluid: 'Cars', cnxCount: '2' },
      { raw: '', type: 'RESPONSE', rid: 1 });

    const { product } = await getBuildingGateConnections(fake.ctx, X, Y, 'products', 'Gate0', 'Cars');

    expect(product?.connectionCount).toBe(2);
    expect(product?.connections).toHaveLength(0);
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('cnxCount says 2 but 2 client connection(s) returned an empty'),
    );
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failing sub-index(es): 0, 1'),
    );
  });

  it('stays quiet when every row came back', async () => {
    // The warning has to be absent on the happy path, or it is noise nobody
    // reads when it does fire.
    const fake = gateCtx('supplies', { MetaFluid: 'Books', cnxCount: '1' },
      'res="%Farm\tBob\tBobCorp\t10\t0\t5\t$1\t90%\t1\t12\t34\t"');

    const { supply } = await getBuildingGateConnections(fake.ctx, X, Y, 'supplies', 'Seg0', 'Books');

    expect(supply?.connections).toHaveLength(1);
    expect(fake.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('returned an empty GetSubObjectProps payload'),
    );
  });

  it('serialises against a tab read on the same inspector', async () => {
    // Both take the inspector's mutex, and they must: the temp object is shared
    // and SetPath repositions it, so an interleaved GetInputNames would read
    // from a gate instead of the building.
    const fake = makeDetailsCtx();
    const inspector = makeInspector({ hasSupplies: true });
    setActiveInspectorForTest(fake.ctx, inspector);
    cacheValues(fake, { MetaFluid: 'Books', cnxCount: '0' });

    const order: string[] = [];
    fake.respond((packet) => {
      order.push(packet.member ?? '');
      if (packet.member === 'GetInputNames') return 'res="%Seg0::\nBooks"';
      if (packet.member === 'SetPath') return 'res="#-1"';
      return '';
    });

    await Promise.all([
      getBuildingTabData(fake.ctx, X, Y, 'supplies'),
      getBuildingGateConnections(fake.ctx, X, Y, 'supplies', 'Seg0', 'Books'),
    ]);

    // The tab read's GetInputNames must not fall between the gate read's
    // SetPath and its header — i.e. the two runs do not interleave.
    const gateStart = order.lastIndexOf('SetPath');
    expect(order.indexOf('GetInputNames')).toBeLessThan(gateStart);
  });
});

// ===========================================================================
// THE MEASUREMENT — Export Storage 4 (924/820), 30 output gates
//
// Reproduces the shape that was measured live: a warehouse with 30 enabled
// gates carrying 91 connections between them. The old code read every one of
// those connections while opening the tab, for an accordion that draws every
// gate COLLAPSED; the numbers below are the whole point of the split.
// ===========================================================================

describe('the Export Storage 4 budget', () => {
  /** 91 connections over 30 gates: 3 each, one gate carrying the extra. */
  const CNX_PER_GATE = (i: number): number => (i === 0 ? 4 : 3);
  const TOTAL_CNX = Array.from({ length: 30 }, (_, i) => CNX_PER_GATE(i)).reduce((a, b) => a + b, 0);

  function storageCtx(over: { isWarehouse?: boolean } = {}): FakeSessionCtx {
    const fake = makeDetailsCtx();
    const gateMap = '1'.repeat(30);
    setActiveInspectorForTest(fake.ctx, makeInspector({
      hasProducts: true, isWarehouse: over.isWarehouse ?? true, gateMap,
    }));
    let currentGate = 0;
    fake.cacher.getPropertyList.mockImplementation(async (_id: string, names: string[]) => {
      if (names[0] === 'InputCount') return ['30'];
      if (names[0]?.startsWith('Input')) return names.map((_, i) => `Ware${i}`);
      return names.map(n => (n === 'cnxCount' ? String(CNX_PER_GATE(currentGate)) : 'x'));
    });
    fake.respond((packet) => {
      if (packet.member === 'GetOutputNames') {
        return `res="%${Array.from({ length: 30 }, (_, i) => `Seg${i}::\nWare${i}`).join('\r\n')}"`;
      }
      if (packet.member === 'SetPath') {
        const arg = packet.args?.[0] ?? '';
        const m = /Seg(\d+)/.exec(arg);
        if (m) currentGate = parseInt(m[1], 10);
        return 'res="#-1"';
      }
      return 'res="%a\tb\tc\td\te\tf\tg\t"';
    });
    return fake;
  }

  const roundTrips = (fake: FakeSessionCtx): number =>
    fake.sent.length + fake.cacher.getPropertyList.mock.calls.length;

  it('opens the tab for 3 round-trips instead of 154', async () => {
    const fake = storageCtx();

    const { products } = await getBuildingTabData(fake.ctx, X, Y, 'products');

    expect(products).toHaveLength(30);
    // 1 GetOutputNames + the warehouse ware names (InputCount, then the
    // Input{i}.0 batch — 2 GetPropertyList). Nothing per gate.
    expect(roundTrips(fake)).toBe(3);
    expect(fake.sent.filter(s => s.packet.member === 'SetPath')).toHaveLength(0);
    expect(fake.sent.filter(s => s.packet.member === 'GetSubObjectProps')).toHaveLength(0);
    // 60 header round-trips and 91 connection reads, for a screen showing 30
    // collapsed rows. That is what 154 was made of.
    expect(TOTAL_CNX).toBe(91);
  });

  it('is 1 round-trip on a non-warehouse, where there are no ware names to read', async () => {
    const fake = storageCtx({ isWarehouse: false });

    const { products } = await getBuildingTabData(fake.ctx, X, Y, 'products');

    expect(products).toHaveLength(30);
    expect(roundTrips(fake)).toBe(1);
  });

  it('spends 2 + n round-trips on the gate the user actually opens', async () => {
    const fake = storageCtx();
    await getBuildingTabData(fake.ctx, X, Y, 'products');
    const afterTab = roundTrips(fake);

    await getBuildingGateConnections(fake.ctx, X, Y, 'products', 'Seg1', 'Ware1');

    // SetPath + the header + one GetSubObjectProps per connection of THIS gate.
    expect(roundTrips(fake) - afterTab).toBe(2 + CNX_PER_GATE(1));
  });
});

// ===========================================================================
// refreshBuildingProperties — re-read on the SAME temp object
// ===========================================================================

describe('refreshBuildingProperties', () => {
  it('re-reads on the existing object without creating another one', async () => {
    const fake = makeDetailsCtx();
    registerTabs('4722', ['unkGeneral']);
    setActiveInspectorForTest(fake.ctx, makeInspector({ tempObjectId: '900500' }));
    cacheValues(fake, { Name: 'Shop', Cost: '$500K', ObjectId: '40133602' });
    focusReturns(fake, '40133602', 'Shop', 'SPO_test3');

    const details = await refreshBuildingProperties(fake.ctx, X, Y, '4722');

    expect(fake.cacher.createObject).not.toHaveBeenCalled();
    expect(fake.cacher.setObject).toHaveBeenCalledWith('900500', X, Y);
    expect(fake.cacher.getPropertyList.mock.calls.every(c => c[0] === '900500')).toBe(true);
    expect(details.buildingId).toBe('40133602');
    // The lazy tabs are deliberately not refetched — the client carries them.
    expect(details.supplies).toBeUndefined();
    expect(details.warehouseWares).toBeUndefined();
    expect(details.refreshedGroups).toBeUndefined();
  });

  it('falls back to a full open when no inspector is live', async () => {
    const fake = makeDetailsCtx();
    registerTabs('4722', ['unkGeneral']);
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Shop' });

    const details = await refreshBuildingProperties(fake.ctx, X, Y, '4722');

    expect(fake.cacher.createObject).toHaveBeenCalledTimes(1);
    expect(details.buildingId).toBe('40133602');
    expect(getActiveInspectorTempObjectId(fake.ctx)).toBe(FIRST_TEMP);
  });

  it('reuses the cached focus instead of re-issuing SwitchFocusEx', async () => {
    const fake = makeDetailsCtx({
      currentFocusedCoords: { x: X, y: Y },
      currentFocusedBuildingId: '40133602',
      currentFocusedBuildingName: 'Shop',
      currentFocusedOwnerName: 'SPO_test3',
    });
    registerTabs('4722', ['unkGeneral']);
    setActiveInspectorForTest(fake.ctx, makeInspector());
    cacheValues(fake, { Name: 'Shop' });

    const details = await refreshBuildingProperties(fake.ctx, X, Y, '4722');

    expect(fake.ctx.focusBuilding).not.toHaveBeenCalled();
    expect(details.buildingName).toBe('Shop');
    expect(details.ownerName).toBe('SPO_test3');
  });

  it('reads empty strings for a focus cached without a name', async () => {
    const fake = makeDetailsCtx({
      currentFocusedCoords: { x: X, y: Y },
      currentFocusedBuildingId: '40133602',
      currentFocusedBuildingName: null,
      currentFocusedOwnerName: null,
    });
    registerTabs('4722', ['unkGeneral']);
    setActiveInspectorForTest(fake.ctx, makeInspector());
    cacheValues(fake, { Name: 'Shop' });

    const details = await refreshBuildingProperties(fake.ctx, X, Y, '4722');

    expect(details.buildingName).toBe('');
    expect(details.ownerName).toBe('');
  });

  it('re-focuses when the session is focused on another building', async () => {
    const fake = makeDetailsCtx({
      currentFocusedCoords: { x: X + 9, y: Y },
      currentFocusedBuildingId: '40133111',
    });
    registerTabs('4722', ['unkGeneral']);
    setActiveInspectorForTest(fake.ctx, makeInspector());
    cacheValues(fake, { Name: 'Shop' });
    focusReturns(fake, '40133602', 'Shop', 'SPO_test3');

    const details = await refreshBuildingProperties(fake.ctx, X, Y, '4722');

    expect(fake.ctx.focusBuilding).toHaveBeenCalledWith(X, Y);
    expect(details.buildingId).toBe('40133602');
  });

  it('keeps the refresh when the re-focus fails', async () => {
    const fake = makeDetailsCtx();
    setActiveInspectorForTest(fake.ctx, makeInspector());
    cacheValues(fake, { Name: 'Shop', CurrBlock: '40133888' });
    (fake.ctx.focusBuilding as FocusMock).mockRejectedValue(new Error('server busy'));

    const details = await refreshBuildingProperties(fake.ctx, X, Y, 'unregistered');

    expect(details.buildingId).toBe('40133888'); // fallback to the cache value
    expect(details.buildingName).toBe('');
  });

  it('reports an empty building id when the refresh identifies nothing', async () => {
    const fake = makeDetailsCtx();
    HANDLER_TO_GROUP['probeBlock'] = PROBE_BLOCK_GROUP;
    registerTabs('9027', ['unkGeneral', 'probeBlock']);
    setActiveInspectorForTest(fake.ctx, makeInspector());
    cacheValues(fake, { Name: 'Shop', CurrBlock: 'error' });
    focusReturns(fake, '');

    const details = await refreshBuildingProperties(fake.ctx, X, Y, '9027');

    expect(details.buildingId).toBe('');
    expect(details.tabs.find(t => t.id === 'probeBlock')?.icon).toBe('');
  });

  it('narrows the read to the active tab plus the overview', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9015', ['IndGeneral', 'Workforce', 'facManagement']);
    setActiveInspectorForTest(fake.ctx, makeInspector());
    cacheValues(fake, { Name: 'Plant', UpgradeLevel: '2' });
    focusReturns(fake, '40133602');

    const details = await refreshBuildingProperties(fake.ctx, X, Y, '9015', 'upgrade');

    const asked = fake.cacher.getPropertyList.mock.calls.flatMap(([, names]) => names);
    expect(asked).toContain('UpgradeLevel'); // the active tab
    expect(asked).toContain('Name');         // plus the overview header
    expect(asked).not.toContain('Workers0'); // the workforce tab is left alone
    expect(details.refreshedGroups).toEqual(Object.keys(details.groups));
  });

  it('reads everything when the active tab is a lazy one', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9016', ['IndGeneral', 'Supplies', 'facManagement']);
    setActiveInspectorForTest(fake.ctx, makeInspector());
    cacheValues(fake, { Name: 'Plant', UpgradeLevel: '2' });
    focusReturns(fake, '40133602');

    const details = await refreshBuildingProperties(fake.ctx, X, Y, '9016', 'supplies');

    // supplies/products/compInputs are fetched by getBuildingTabData, never here.
    const asked = fake.cacher.getPropertyList.mock.calls.flatMap(([, names]) => names);
    expect(asked).toContain('UpgradeLevel');
    expect(details.refreshedGroups).toBeUndefined();
  });

  it('reads everything for a template with two tabs or fewer', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9017', ['IndGeneral', 'facManagement']);
    setActiveInspectorForTest(fake.ctx, makeInspector());
    cacheValues(fake, { Name: 'Plant', UpgradeLevel: '2' });
    focusReturns(fake, '40133602');

    const details = await refreshBuildingProperties(fake.ctx, X, Y, '9017', 'upgrade');

    expect(details.refreshedGroups).toBeUndefined();
  });

  it('picks up a GateMap changed by RDOSelectWare since the last read', async () => {
    const fake = makeDetailsCtx();
    registerTabs('7001', ['WHGeneral']);
    setActiveInspectorForTest(fake.ctx, makeInspector({ isWarehouse: true, gateMap: '100' }));
    cacheValues(fake, { GateMap: '111', Name: 'Storage' });
    focusReturns(fake, '40133602');

    await refreshBuildingProperties(fake.ctx, X, Y, '7001');

    expect(getActiveInspector(fake.ctx, X, Y)?.gateMap).toBe('111');
  });

  it('keeps the previous GateMap when the refresh returns none', async () => {
    const fake = makeDetailsCtx();
    registerTabs('7001', ['WHGeneral']);
    setActiveInspectorForTest(fake.ctx, makeInspector({ isWarehouse: true, gateMap: '100' }));
    cacheValues(fake, { Name: 'Storage' });
    focusReturns(fake, '40133602');

    await refreshBuildingProperties(fake.ctx, X, Y, '7001');

    expect(getActiveInspector(fake.ctx, X, Y)?.gateMap).toBe('100');
  });

  it('drops the dead object and reopens one when the refresh fails on it', async () => {
    const fake = makeDetailsCtx();
    registerTabs('4722', ['unkGeneral']);
    setActiveInspectorForTest(fake.ctx, makeInspector({ tempObjectId: '900500' }));
    focusReturns(fake, '40133602', 'Shop', 'SPO_test3');
    let firstAttempt = true;
    fake.cacher.setObject.mockImplementation(async (id: string) => {
      if (firstAttempt && id === '900500') {
        firstAttempt = false;
        throw new Error('error 8'); // the Delphi object went away
      }
    });
    cacheValues(fake, { Name: 'Shop' });

    const details = await refreshBuildingProperties(fake.ctx, X, Y, '4722');

    expect(fake.cacher.closeObject).toHaveBeenCalledWith('900500');
    expect(fake.cacher.createObject).toHaveBeenCalledTimes(1);
    expect(details.buildingName).toBe('Shop');
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Refresh failed on existing object'), expect.anything()
    );
  });

  it('releases the mutex so a tab read can follow a failed refresh', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9013', ['Supplies']);
    const inspector = makeInspector({ tempObjectId: '900500', hasSupplies: true });
    setActiveInspectorForTest(fake.ctx, inspector);
    focusReturns(fake, '40133602');
    fake.cacher.setObject.mockRejectedValueOnce(new Error('error 8'));
    cacheValues(fake, { MetaFluid: 'X', cnxCount: '0' });
    fake.respond(() => 'res="%0"');

    await refreshBuildingProperties(fake.ctx, X, Y, '9013');

    // The mutex of the *original* inspector must be free again.
    const release = await inspector.mutex.acquire();
    expect(typeof release).toBe('function');
    release();
  });
});

// ===========================================================================
// BANK AND TV — the six values the cache never holds, read live off the block
// ===========================================================================

/**
 * These six names used to be fetched through `GetPropertyList` like any other,
 * and the Delphi StoreToCache routines never wrote them — TBankBlock writes the
 * loan list alone (StdBlocks/Banks.pas:188-206), TBroadcaster only antenna data
 * (StdBlocks/Broadcast.pas:431-453) — so the cacher answered `''` every time and
 * six sliders rendered blank forever.
 *
 * They now carry `notCached` and are read live off `CurrBlock`, which is exactly
 * what the reference client does (Voyager/BankGeneralSheet.pas:258-273,
 * Voyager/TVGeneralSheet.pas:269-275). The tests below pin both halves: the names
 * no longer go to the cache, and the emitted frames carry the right form, target
 * and argument.
 */
describe('bank and TV values read live off the block', () => {
  /** The block id the cache answers for `CurrBlock`, distinct from every focus id. */
  const BLOCK = '40133888';

  it('reads HoursOnAir and Commercials off the block instead of the cache', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9018', ['TVGeneral'], 'TV Station');
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Channel 5', CurrBlock: BLOCK });
    rdoMembers(fake, { HoursOnAir: 'HoursOnAir="#18"', Commercials: 'Commercials="#35"' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9018');

    const asked = fake.cacher.getPropertyList.mock.calls.flatMap(([, names]) => names);
    expect(asked).not.toContain('HoursOnAir');
    expect(asked).not.toContain('Comercials'); // one 'm' — the published name is 'Commercials'
    expect(asked).toContain('CurrBlock');

    expect(fake.sent).toHaveLength(2);
    for (const sent of fake.sent) {
      expect(sent.socketName).toBe('construction');
      expect(sent.category).toBe(TimeoutCategory.NORMAL);
      expect(sent.packet.action).toBe(RdoAction.GET);
      expect(sent.packet.targetId).toBe(BLOCK);
    }
    expect(fake.sent.map(s => s.packet.member)).toEqual(['HoursOnAir', 'Commercials']);

    const tv = details.groups['tvGeneral'];
    // The published `Commercials` lands under the template's read key `Comercials`
    // (Voyager/TVGeneralSheet.pas:15, :275).
    expect(tv.filter(p => p.name === 'HoursOnAir')).toEqual([{ name: 'HoursOnAir', value: '18' }]);
    expect(tv.filter(p => p.name === 'Comercials')).toEqual([{ name: 'Comercials', value: '35' }]);
    expect(tv.filter(p => p.name === 'Name')).toEqual([{ name: 'Name', value: 'Channel 5' }]);
  });

  it('reads EstLoan, BudgetPerc, Interest and Term off the block instead of the cache', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9019', ['BankGeneral'], 'Bank');
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'First Bank', CurrBlock: BLOCK });
    rdoMembers(fake, {
      RDOEstimateLoan: 'res="%$5,000,000"',
      BudgetPerc: 'BudgetPerc="#75"',
      Interest: 'Interest="#12"',
      Term: 'Term="#5"',
    });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9019');

    const asked = fake.cacher.getPropertyList.mock.calls.flatMap(([, names]) => names);
    for (const name of ['EstLoan', 'Interest', 'Term', 'BudgetPerc']) {
      expect(asked).not.toContain(name);
    }

    expect(fake.sent).toHaveLength(4);
    expect(fake.sent.map(s => s.packet.member))
      .toEqual(['RDOEstimateLoan', 'BudgetPerc', 'Interest', 'Term']);

    const [estLoan, ...gets] = fake.sent;
    expect(estLoan.packet.action).toBe(RdoAction.CALL);
    expect(estLoan.packet.targetId).toBe(BLOCK);
    expect(RdoProtocol.format(estLoan.packet as RdoPacket))
      .toContain(`call RDOEstimateLoan "^" ${RdoValue.int(FAKE_CONTEXT_IDS.tycoonProxyId).format()}`);
    for (const g of gets) {
      expect(g.packet.action).toBe(RdoAction.GET);
      expect(g.packet.targetId).toBe(BLOCK);
    }

    const bank = details.groups['bankGeneral'];
    // FormatMoney punctuation stripped (Utils/Misc/MathUtils.pas:87-109).
    expect(bank).toContainEqual({ name: 'EstLoan', value: '5000000' });
    expect(bank).toContainEqual({ name: 'BudgetPerc', value: '75' });
    expect(bank).toContainEqual({ name: 'Interest', value: '12' });
    expect(bank).toContainEqual({ name: 'Term', value: '5' });
    expect(bank).toContainEqual({ name: 'Name', value: 'First Bank' });
  });

  it('sends the InitClient proxy id to RDOEstimateLoan, never the persistent tycoon id', async () => {
    // The server pointer-casts the argument, `TMoneyDealer(ClientId)`
    // (StdBlocks/Banks.pas:149); the persistent TTycoon.Id would dereference nothing.
    const fake = makeDetailsCtx();
    registerTabs('9020', ['BankGeneral'], 'Bank');
    focusReturns(fake, '40133602');
    cacheValues(fake, { CurrBlock: BLOCK });
    rdoMembers(fake, { RDOEstimateLoan: 'res="%$0"' });

    await getBuildingBasicDetails(fake.ctx, X, Y, '9020');

    const args = fake.sent[0].packet.args;
    expect(args).toEqual([RdoValue.int(FAKE_CONTEXT_IDS.tycoonProxyId).format()]);
    expect(args![0]).not.toBe(RdoValue.int(parseInt(FAKE_CONTEXT_IDS.tycoonId, 10)).format());
  });

  it('normalises the FormatMoney answer: $0 and a negative loan', async () => {
    for (const [answer, expected] of [['$0', '0'], ['-$1,234', '-1234']] as const) {
      const fake = makeDetailsCtx();
      registerTabs('9021', ['BankGeneral'], 'Bank');
      focusReturns(fake, '40133602');
      cacheValues(fake, { CurrBlock: BLOCK });
      rdoMembers(fake, { RDOEstimateLoan: `res="%${answer}"` });

      const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9021');

      expect(details.groups['bankGeneral']).toContainEqual({ name: 'EstLoan', value: expected });
    }
  });

  it('skips RDOEstimateLoan with no proxy id, and still issues the three gets', async () => {
    const fake = makeDetailsCtx({ fTycoonProxyId: null });
    registerTabs('9022', ['BankGeneral'], 'Bank');
    focusReturns(fake, '40133602');
    cacheValues(fake, { CurrBlock: BLOCK });
    rdoMembers(fake, { BudgetPerc: 'BudgetPerc="#75"', Interest: 'Interest="#12"', Term: 'Term="#5"' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9022');

    expect(fake.sent.map(s => s.packet.member)).toEqual(['BudgetPerc', 'Interest', 'Term']);
    expect(details.groups['bankGeneral']).toContainEqual({ name: 'Interest', value: '12' });
    expect(details.groups['bankGeneral'].some(p => p.name === 'EstLoan')).toBe(false);
  });

  it('a rejected RDOEstimateLoan leaves the three gets running', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9023', ['BankGeneral'], 'Bank');
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'First Bank', CurrBlock: BLOCK });
    rdoMembers(fake, {
      RDOEstimateLoan: new Error('Request timeout: RDOEstimateLoan'),
      BudgetPerc: 'BudgetPerc="#75"',
      Interest: 'Interest="#12"',
      Term: 'Term="#5"',
    });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9023');

    const bank = details.groups['bankGeneral'];
    expect(bank.some(p => p.name === 'EstLoan')).toBe(false);
    expect(bank).toContainEqual({ name: 'Term', value: '5' });
  });

  it('a rejected get is swallowed and the sheet still renders', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9024', ['BankGeneral'], 'Bank');
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'First Bank', CurrBlock: BLOCK });
    rdoMembers(fake, {
      RDOEstimateLoan: 'res="%$5,000,000"',
      BudgetPerc: new Error('Request timeout: BudgetPerc'),
    });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9024');

    const bank = details.groups['bankGeneral'];
    expect(bank).toContainEqual({ name: 'EstLoan', value: '5000000' });
    expect(bank).toContainEqual({ name: 'Name', value: 'First Bank' });
    expect(bank.some(p => p.name === 'Interest')).toBe(false);
  });

  it('a rejected TV read is swallowed and the sheet still renders', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9031', ['TVGeneral'], 'TV Station');
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Channel 5', CurrBlock: BLOCK });
    rdoMembers(fake, { HoursOnAir: new Error('Request timeout: HoursOnAir') });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9031');

    const tv = details.groups['tvGeneral'];
    expect(tv.some(p => p.name === 'HoursOnAir')).toBe(false);
    expect(tv.some(p => p.name === 'Comercials')).toBe(false);
    expect(tv).toContainEqual({ name: 'Name', value: 'Channel 5' });
  });

  it('an empty answer pushes no entry', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9025', ['TVGeneral'], 'TV Station');
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Channel 5', CurrBlock: BLOCK });
    rdoMembers(fake, { HoursOnAir: '', Commercials: 'Commercials="#35"' });

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, '9025');

    const tv = details.groups['tvGeneral'];
    expect(tv.some(p => p.name === 'HoursOnAir')).toBe(false);
    expect(tv).toContainEqual({ name: 'Comercials', value: '35' });
  });

  it('sends nothing when the cache has no CurrBlock, for either building', async () => {
    for (const [visualClass, handler, name] of [
      ['9026', 'BankGeneral', 'Bank'],
      ['9027', 'TVGeneral', 'TV Station'],
    ] as const) {
      const fake = makeDetailsCtx();
      registerTabs(visualClass, [handler], name);
      focusReturns(fake, '40133602');
      cacheValues(fake, { Name: name });
      rdoMembers(fake, {});

      await getBuildingBasicDetails(fake.ctx, X, Y, visualClass);

      expect(fake.sent).toHaveLength(0);
    }
  });

  it('connects the construction socket when the session has none', async () => {
    for (const [visualClass, handler, name] of [
      ['9028', 'BankGeneral', 'Bank'],
      ['9029', 'TVGeneral', 'TV Station'],
    ] as const) {
      const fake = makeDetailsCtx({ sockets: ['map'] });
      registerTabs(visualClass, [handler], name);
      focusReturns(fake, '40133602');
      cacheValues(fake, { CurrBlock: BLOCK });
      rdoMembers(fake, {});

      await getBuildingBasicDetails(fake.ctx, X, Y, visualClass);

      expect(fake.ctx.connectConstructionService).toHaveBeenCalled();
    }
  });

  it('re-reads the sliders on a refresh, so a moved slider shows the server value', async () => {
    const fake = makeDetailsCtx();
    registerTabs('9030', ['TVGeneral'], 'TV Station');
    const inspector = makeInspector({ tempObjectId: '900500' });
    setActiveInspectorForTest(fake.ctx, inspector);
    focusReturns(fake, '40133602');
    cacheValues(fake, { Name: 'Channel 5', CurrBlock: BLOCK });
    rdoMembers(fake, { HoursOnAir: 'HoursOnAir="#7"', Commercials: 'Commercials="#35"' });

    const details = await refreshBuildingProperties(fake.ctx, X, Y, '9030');

    expect(details.groups['tvGeneral']).toContainEqual({ name: 'HoursOnAir', value: '7' });
  });
});

// ===========================================================================
// getBuildingServiceFigures — the live Offer / Demand pair of one service
// ===========================================================================

describe('getBuildingServiceFigures', () => {
  /** A fake whose `getCacherPropertyListAt` answers a CurrBlock, as the map service does. */
  function serviceCtx(currBlock: string, sockets: string[] = ['construction']): FakeSessionCtx {
    const fake = makeSessionCtx({ sockets });
    (fake.ctx.getCacherPropertyListAt as jest.MockedFunction<SessionContext['getCacherPropertyListAt']>)
      .mockResolvedValue([currBlock]);
    return fake;
  }

  it('reads both figures off the block on the construction socket', async () => {
    const fake = serviceCtx('40133600');
    rdoMembers(fake, { RDOGetDemand: 'res="#37"', RDOGetSupply: 'res="#64"' });

    const figures = await getBuildingServiceFigures(fake.ctx, X, Y, 1);

    expect(figures).toEqual({ demand: '37', supply: '64' });
    expect(fake.sent.map(s => s.socketName)).toEqual(['construction', 'construction']);
    expect(fake.sent.map(s => s.category)).toEqual([TimeoutCategory.NORMAL, TimeoutCategory.NORMAL]);
  });

  it('sends the service index as the single argument of each call', async () => {
    const fake = serviceCtx('40133600');
    rdoMembers(fake, { RDOGetDemand: 'res="#37"', RDOGetSupply: 'res="#64"' });

    await getBuildingServiceFigures(fake.ctx, X, Y, 2);

    expect(fake.sent.map(s => s.packet.member)).toEqual(['RDOGetDemand', 'RDOGetSupply']);
    for (const s of fake.sent) {
      expect(s.packet.verb).toBe(RdoVerb.SEL);
      expect(s.packet.action).toBe(RdoAction.CALL);
      expect(s.packet.targetId).toBe('40133600');
      expect(s.packet.args).toEqual([RdoValue.int(2).format()]);
    }
  });

  it('refuses a tile with no building rather than calling on an empty id', async () => {
    const fake = serviceCtx('');

    await expect(getBuildingServiceFigures(fake.ctx, X, Y, 0))
      .rejects.toThrow(`No building found at (${X}, ${Y})`);
    expect(fake.sent).toHaveLength(0);
  });

  it('opens the construction connection only when there is none', async () => {
    const open = serviceCtx('40133600');
    rdoMembers(open, { RDOGetDemand: 'res="#1"', RDOGetSupply: 'res="#2"' });
    await getBuildingServiceFigures(open.ctx, X, Y, 0);
    expect(open.ctx.connectConstructionService).not.toHaveBeenCalled();

    const closed = serviceCtx('40133600', []);
    rdoMembers(closed, { RDOGetDemand: 'res="#1"', RDOGetSupply: 'res="#2"' });
    await getBuildingServiceFigures(closed.ctx, X, Y, 0);
    expect(closed.ctx.connectConstructionService).toHaveBeenCalledTimes(1);
  });

  it('answers empty strings when the block says nothing, rather than inventing a 0', async () => {
    // A blank figure and a figure of 0 are different claims: the client shows
    // the cached column until a real answer arrives.
    const fake = serviceCtx('40133600');
    rdoMembers(fake, { RDOGetDemand: '', RDOGetSupply: '' });

    expect(await getBuildingServiceFigures(fake.ctx, X, Y, 0)).toEqual({ demand: '', supply: '' });
  });
});
