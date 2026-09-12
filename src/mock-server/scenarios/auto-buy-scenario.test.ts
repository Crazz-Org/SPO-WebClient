/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * Automatic buying, checked where the frames and the reads are actually built.
 *
 * Two things have to hold and neither is visible in a reply:
 *
 *  1. the gate header is read with TEN names, in the reference client's order
 *     (`Voyager/SupplySheetForm.pas:460`) — without `tidSelected` the browser
 *     never learns the flag's state;
 *  2. the emitted frame is addressed to the GATE's own `ObjectId`
 *     (`Kernel/Kernel.pas:1623`, `SupplySheetForm.pas:1001` → `:697-699`), not
 *     to the facility's `CurrBlock` or `ObjectId`.
 *
 * Nothing here builds a frame by hand: the gateway's own `setBuildingProperty`
 * and `getBuildingGateConnections` are driven, and what they emit is matched
 * back against the exchange it must be.
 */

import { setBuildingProperty } from '@/server/session/building-property-handler';
import {
  getBuildingGateConnections,
  setActiveInspectorForTest,
  releaseInspector,
  AsyncMutex,
} from '@/server/session/building-details-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import { RdoMock } from '../rdo-mock';
import {
  createAutoBuyScenario,
  AUTO_BUY_TARGETS,
  AUTO_BUY_GATE_PATH,
  SUPPLY_HEADER_NAMES,
} from './auto-buy-scenario';

const { rdo } = createAutoBuyScenario();

const X = 706;
const Y = 436;

// ── The catalogue half ──────────────────────────────────────────────────────

describe('auto-buy scenario — the frames', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('is a 1-argument procedure, so every frame carries "*" and none carries "^"', () => {
    expect(RDO_MEMBERS.RDOSelSelected.kind).toBe('procedure');
    expect(RDO_MEMBERS.RDOSelSelected).toHaveProperty('arity', 1);

    for (const ex of rdo.exchanges) {
      expect(ex.request).toContain('"*"');
      expect(ex.request).not.toContain('"^"');
    }
  });

  /** A procedure answers nothing — no reply can say the write landed (OB-28). */
  it('answers nothing at all', () => {
    for (const ex of rdo.exchanges) {
      expect(ex.response).toBe('');
    }
  });

  it('addresses the gate, and neither of the two block ids', () => {
    for (const ex of rdo.exchanges) {
      expect(ex.matchKeys?.targetId).toBe(AUTO_BUY_TARGETS.gateObjectId);
      expect(ex.request).toContain(AUTO_BUY_TARGETS.gateObjectId);
      expect(ex.request).not.toContain(AUTO_BUY_TARGETS.currBlock);
      expect(ex.request).not.toContain(AUTO_BUY_TARGETS.objectId);
    }
  });

  it('offers exactly the two WordBool arguments, never "#1"', () => {
    const args = rdo.exchanges.map(e => e.matchKeys!.argsPattern![0]).sort();
    expect(args).toEqual(['"#-1"', '"#0"']);
    expect(args).not.toContain('"#1"');
  });
});

// ── The header the gate is read with ────────────────────────────────────────

describe('auto-buy scenario — the ten header names', () => {
  let fake: FakeSessionCtx;

  const HEADER: Record<string, string> = {
    MetaFluid: AUTO_BUY_TARGETS.fluidId,
    FluidValue: '1200',
    LastCostPerc: '85',
    minK: '30',
    MaxPrice: '150',
    QPSorted: '1',
    SortMode: '0',
    cnxCount: '0',
    Selected: '1',
    ObjectId: AUTO_BUY_TARGETS.gateObjectId,
  };

  beforeEach(() => {
    fake = makeSessionCtx({ sockets: ['map'] });
    setActiveInspectorForTest(fake.ctx, {
      tempObjectId: AUTO_BUY_TARGETS.tempObject,
      x: X,
      y: Y,
      visualClass: '4722',
      mutex: new AsyncMutex(),
      gateMap: '',
      hasSupplies: true,
      hasProducts: false,
      hasCompInputs: false,
      isWarehouse: false,
    });
    fake.respond((packet) => {
      if (packet.member === 'SetPath') return 'res="#-1"';
      return '';
    });
    fake.cacher.getPropertyList.mockImplementation(
      async (_id: string, names: string[]) => names.map(n => HEADER[n] ?? ''),
    );
  });

  afterEach(() => {
    releaseInspector(fake.ctx);
  });

  it('is ten names long — Voyager reads ten, not nine', () => {
    expect(SUPPLY_HEADER_NAMES).toHaveLength(10);
    expect(SUPPLY_HEADER_NAMES[8]).toBe('Selected');
    expect(SUPPLY_HEADER_NAMES[9]).toBe('ObjectId');
  });

  it("reads the gate header with those ten names, in Voyager's order", async () => {
    const { supply } = await getBuildingGateConnections(
      fake.ctx, X, Y, 'supplies', AUTO_BUY_GATE_PATH, AUTO_BUY_TARGETS.fluidId,
    );

    expect(fake.cacher.getPropertyList).toHaveBeenCalledWith(
      AUTO_BUY_TARGETS.tempObject, [...SUPPLY_HEADER_NAMES],
    );
    // The flag reaches the browser, which is the whole point of the tenth read.
    expect(supply?.selected).toBe('1');
  });

  it('carries a cleared flag just as faithfully', async () => {
    HEADER.Selected = '0';

    const { supply } = await getBuildingGateConnections(
      fake.ctx, X, Y, 'supplies', AUTO_BUY_GATE_PATH, AUTO_BUY_TARGETS.fluidId,
    );

    expect(supply?.selected).toBe('0');
    HEADER.Selected = '1';
  });
});

// ── The target on the wire ──────────────────────────────────────────────────

describe('auto-buy scenario — the target on the wire', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * A context whose cacher answers the four questions one auto-buy write asks:
   * the two block ids, the gate listing, the gate's own ObjectId, and the
   * witness.
   */
  function makeCtx(selected = '1'): FakeSessionCtx {
    const fake = makeSessionCtx({ sockets: ['construction'] });
    fake.cacher.createObject.mockResolvedValue(AUTO_BUY_TARGETS.tempObject);
    fake.cacher.getPropertyList.mockImplementation(async (_id: string, props: string[]) => {
      if (props[0] === 'CurrBlock') return [AUTO_BUY_TARGETS.currBlock, AUTO_BUY_TARGETS.objectId];
      if (props[0] === 'InputCount') return ['1'];
      if (/^InputPath\d+$/.test(props[0])) return [AUTO_BUY_GATE_PATH];
      if (props[0] === 'ObjectId') return [AUTO_BUY_TARGETS.gateObjectId];
      return [selected];
    });
    return fake;
  }

  it.each([
    { value: '1', id: 'auto-buy-on' },
    { value: '0', id: 'auto-buy-off' },
  ])('$value reaches the wire as $id, addressed to the gate', async ({ value, id }) => {
    const fake = makeCtx(value);

    const pending = setBuildingProperty(fake.ctx, X, Y, 'RDOSelSelected', value, {
      fluidId: AUTO_BUY_TARGETS.fluidId,
    });
    await jest.advanceTimersByTimeAsync(200);
    const result = await pending;

    const exchange = rdo.exchanges.find(e => e.id === id)!;
    // Byte-equal to the scenario frame — this is what pins the target.
    expect(fake.frames.construction).toEqual([exchange.request]);
    const frame = fake.frames.construction[0];
    expect(frame).not.toContain(AUTO_BUY_TARGETS.currBlock);
    expect(frame).not.toContain(AUTO_BUY_TARGETS.objectId);
    // The gate id was resolved by walking onto the gate, as the read-back does.
    expect(fake.cacher.setPath).toHaveBeenCalledWith(
      AUTO_BUY_TARGETS.tempObject, AUTO_BUY_GATE_PATH,
    );

    const mock = new RdoMock();
    mock.addScenario(rdo);
    expect(mock.match(frame)!.exchange.id).toBe(id);

    // `Cache.WriteBoolean` stores '1'/'0' (Cache/CacheAgent.pas:150-152).
    expect(result.confirmed).toBe(true);
  });

  it('refuses rather than guessing a target when no fluid id names the gate', async () => {
    const fake = makeCtx();

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSelSelected', '1'));

    expect(fake.frames.construction).toEqual([]);
    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.log.error).toHaveBeenCalledWith(
      expect.stringContaining('RDOSelSelected cannot be addressed'),
    );
  });

  it('refuses when no input gate carries that fluid', async () => {
    const fake = makeCtx();

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSelSelected', '1', {
      fluidId: 'Uranium',
    }));

    expect(fake.frames.construction).toEqual([]);
    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.log.error).toHaveBeenCalledWith(
      expect.stringContaining('RDOSelSelected cannot be addressed'),
    );
  });

  /** The handler sleeps 200 ms before its read-back; time is faked, not waited. */
  async function settle<T>(pending: Promise<T>): Promise<T> {
    await jest.advanceTimersByTimeAsync(200);
    return pending;
  }
});
