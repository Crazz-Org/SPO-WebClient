/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * The Workforce tab's live read, checked where it is actually built.
 *
 * Three things are asserted against the real gateway, not against a hand-written
 * frame: `RDOGetWorkers` goes out once per staffed class, it goes out on the
 * BLOCK, and a class with no jobs draws no call at all. The gateway's own
 * `readWorkerCounts` is driven and each frame it emits is matched back against
 * its exchange.
 */

import { RdoProtocol } from '@/server/rdo';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import {
  readWorkerCounts,
  setActiveInspectorForTest,
  releaseInspector,
  AsyncMutex,
} from '@/server/session/building-details-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { workerPollKinds } from '@/client/components/building/property-utils';
import type { BuildingPropertyValue } from '@/shared/types';
import { RdoVerb, RdoAction } from '@/shared/types';
import { RdoMock } from '../rdo-mock';
import {
  createWorkerCountsScenario,
  WORKER_COUNTS,
  WORKER_COUNTS_BLOCK,
  WORKER_COUNTS_TEMP_OBJECT,
} from './worker-counts-scenario';

const { rdo } = createWorkerCountsScenario();

/** The coordinates MOCK_FACTORY sits on. */
const X = 472;
const Y = 392;

/** All three classes staffed — the fixture the poll reads its class list from. */
const BASE: Record<string, string> = {
  Workers0: '3', WorkersMax0: '27',
  Workers1: '14', WorkersMax1: '14',
  Workers2: '69', WorkersMax2: '70',
};

function props(overrides: Record<string, string> = {}): BuildingPropertyValue[] {
  return Object.entries({ ...BASE, ...overrides })
    .map(([name, value]) => ({ name, value }) as BuildingPropertyValue);
}

/**
 * Drive the real gateway against the mock, and hand back what went on the wire.
 * The mock answers; anything it has no exchange for is an error, so a frame the
 * fixture does not describe fails loudly instead of silently returning ''.
 */
function makeDriver() {
  const rdoMock = new RdoMock();
  rdoMock.addScenario(rdo);

  const fake: FakeSessionCtx = makeSessionCtx({ sockets: ['construction'] });
  fake.cacher.getPropertyList.mockResolvedValue([WORKER_COUNTS_BLOCK]);
  fake.cacher.setObject.mockResolvedValue(undefined);
  setActiveInspectorForTest(fake.ctx, {
    tempObjectId: WORKER_COUNTS_TEMP_OBJECT,
    x: X,
    y: Y,
    visualClass: 'PGIChemicalPlantA',
    mutex: new AsyncMutex(),
    gateMap: '',
    hasSupplies: false,
    hasProducts: false,
    hasCompInputs: false,
    isWarehouse: false,
  });

  fake.respond((packet) => {
    const frame = `${RdoProtocol.format(packet as never)};`;
    const hit = rdoMock.match(frame);
    return hit ? hit.response.replace(/^A\d+\s+/, '') : new Error(`L1: no exchange for ${frame}`);
  });

  const drive = (overrides: Record<string, string> = {}) =>
    readWorkerCounts(fake.ctx, X, Y, workerPollKinds(props(overrides)));

  const workerFrames = () => fake.sent
    .filter(s => s.packet.member === 'RDOGetWorkers')
    .map(s => ({ packet: s.packet, frame: `${RdoProtocol.format(s.packet as never)};` }));

  return { fake, rdoMock, drive, workerFrames };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('worker-counts scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('RDOGetWorkers is a 1-argument function, so every frame carries "^"', () => {
    expect(RDO_MEMBERS.RDOGetWorkers.kind).toBe('function');
    expect(RDO_MEMBERS.RDOGetWorkers).toHaveProperty('arity', 1);

    for (const ex of rdo.exchanges) {
      expect(ex.request).toContain('"^"');
      expect(ex.request).not.toContain('"*"');
    }
  });

  it('matches each frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });

  it('every request is a sel/call on the block, never on the temp object', () => {
    for (const ex of rdo.exchanges) {
      expect(ex.matchKeys?.targetId).toBe(WORKER_COUNTS_BLOCK);
      expect(ex.matchKeys?.targetId).not.toBe(WORKER_COUNTS_TEMP_OBJECT);
      expect(ex.matchKeys?.verb).toBe('sel');
      expect(ex.matchKeys?.action).toBe('call');
    }
  });
});

describe('worker-counts scenario — the calls on the wire', () => {
  it('the first tick asks once per staffed class — three calls', async () => {
    const { fake, rdoMock, drive, workerFrames } = makeDriver();

    const counts = await drive();

    expect(counts).toEqual([
      { kind: 0, workers: WORKER_COUNTS[0] },
      { kind: 1, workers: WORKER_COUNTS[1] },
      { kind: 2, workers: WORKER_COUNTS[2] },
    ]);

    const frames = workerFrames();
    expect(frames).toHaveLength(3);
    frames.forEach((f, kind) => {
      expect(f.packet.verb).toBe(RdoVerb.SEL);
      expect(f.packet.action).toBe(RdoAction.CALL);
      expect(f.packet.targetId).toBe(WORKER_COUNTS_BLOCK);
      expect(f.packet.args).toEqual([`"#${kind}"`]);
      expect(rdoMock.match(f.frame)!.exchange.id).toBe(`wc-rdo-get-workers-${kind}`);
    });

    // The block is read once, from the cache, and never asked for again.
    expect(fake.cacher.getPropertyList).toHaveBeenCalledTimes(1);
    expect(fake.cacher.getPropertyList).toHaveBeenCalledWith(WORKER_COUNTS_TEMP_OBJECT, ['CurrBlock']);

    releaseInspector(fake.ctx);
  });

  it('a class with no jobs costs no call — two calls', async () => {
    const { fake, drive, workerFrames } = makeDriver();

    expect(workerPollKinds(props({ WorkersMax1: '0' }))).toEqual([0, 2]);
    await drive({ WorkersMax1: '0' });

    const frames = workerFrames();
    expect(frames).toHaveLength(2);
    expect(frames.map(f => f.packet.args?.[0])).toEqual(['"#0"', '"#2"']);
    expect(frames.some(f => f.packet.args?.[0] === '"#1"')).toBe(false);

    releaseInspector(fake.ctx);
  });

  it('after the tab is left, nothing is emitted — zero calls', async () => {
    const { fake, drive, workerFrames } = makeDriver();

    await drive();
    const before = fake.sent.length;

    // Leaving the tab unmounts the poll on the client; the gateway's own half of
    // that promise is that a tick arriving after the panel is gone is inert.
    releaseInspector(fake.ctx);

    await expect(drive()).resolves.toEqual([]);
    expect(fake.sent).toHaveLength(before);
    expect(workerFrames()).toHaveLength(3);
  });
});
