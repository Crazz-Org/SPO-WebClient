/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * A multi-row disconnect, checked where the frame is actually built.
 *
 * The assertion that matters is the second argument: every selected pair in one
 * `%`-prefixed string, one frame for the whole selection. Nothing here builds a
 * frame by hand — the gateway's own `setBuildingProperty` is driven and the
 * frame it emits is matched back against the exchange it must be.
 */

import { RDO_MEMBERS } from '@/shared/rdo-members';
import { setBuildingProperty } from '@/server/session/building-property-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { RdoMock } from '../rdo-mock';
import {
  createDisconnectConnectionsScenario,
  DISCONNECT_TARGETS,
  DISCONNECT_FLUID,
  DISCONNECT_LIST,
} from './disconnect-connections-scenario';

const { rdo } = createDisconnectConnectionsScenario();

const X = 706;
const Y = 436;

/**
 * A context whose construction socket exists and whose cacher answers the two
 * questions this handler asks: the bind ids and the read-back.
 */
function makeCtx(): FakeSessionCtx {
  const fake = makeSessionCtx({ sockets: ['construction'] });
  fake.cacher.createObject.mockResolvedValue(DISCONNECT_TARGETS.tempObject);
  fake.cacher.getPropertyList.mockImplementation(async (_id: string, props: string[]) => {
    if (props[0] === 'CurrBlock') return [DISCONNECT_TARGETS.currBlock, DISCONNECT_TARGETS.objectId];
    return ['0'];
  });
  return fake;
}

/** The handler sleeps 200 ms before its read-back; time is faked, not waited. */
async function emit(member: string): Promise<string> {
  const fake = makeCtx();
  const pending = setBuildingProperty(fake.ctx, X, Y, member, '0', {
    fluidId: DISCONNECT_FLUID,
    connectionList: DISCONNECT_LIST,
  });
  await jest.advanceTimersByTimeAsync(200);
  await pending;
  // One selection, one frame — not one frame per pair.
  expect(fake.frames.construction).toHaveLength(1);
  return fake.frames.construction[0];
}

describe('disconnect-connections scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('both members are 2-argument procedures, so every frame carries "*"', () => {
    for (const member of ['RDODisconnectInput', 'RDODisconnectOutput'] as const) {
      expect(RDO_MEMBERS[member].kind).toBe('procedure');
      expect(RDO_MEMBERS[member]).toHaveProperty('arity', 2);
    }

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

  /**
   * `ParseGateList` (Kernel/Kernel0.pas:4157-4180) splits on `,` and reads the
   * tokens in pairs; the token after the last comma is never read. Six tokens is
   * three connections.
   */
  it('carries three pairs in one list, trailing comma included', () => {
    expect(DISCONNECT_LIST.endsWith(',')).toBe(true);
    const tokens = DISCONNECT_LIST.split(',').slice(0, -1);
    expect(tokens).toHaveLength(6);
    expect(tokens.length % 2).toBe(0);
    expect(tokens).toEqual(['10', '20', '30', '40', '50', '60']);
  });

  it('matches each frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });
});

describe('disconnect-connections scenario — the argument on the wire', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const cases = [
    { member: 'RDODisconnectInput', id: 'disconnect-input-3' },
    { member: 'RDODisconnectOutput', id: 'disconnect-output-3' },
  ];

  it.each(cases)('$member sends the whole selection as one frame', async ({ member, id }) => {
    const frame = await emit(member);

    expect(frame).toMatchRdoFormat();
    expect(frame).toContain('"*"');
    expect(frame).not.toContain('"^"');

    // The three pairs travel as ONE argument, not three.
    const occurrences = frame.split(`"%${DISCONNECT_LIST}"`).length - 1;
    expect(occurrences).toBe(1);

    const mock = new RdoMock();
    mock.addScenario(rdo);
    expect(mock.match(frame)!.exchange.id).toBe(id);
  });
});
