/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * The trade settings, checked where the frames are actually built.
 *
 * The assertion that matters is the argument: three values per member and no
 * others, `"#1"` provably absent from the trade-level set. Nothing here builds a
 * frame by hand — the gateway's own `setBuildingProperty` is driven and each
 * frame it emits is matched back against the exchange it must be.
 */

import { RDO_MEMBERS } from '@/shared/rdo-members';
import { setBuildingProperty } from '@/server/session/building-property-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { TRADE_MODE_VALUES, TRADE_LEVEL_VALUES } from '@/shared/building-details/trade-settings';
import { RdoMock } from '../rdo-mock';
import { createTradeSettingsScenario, TRADE_TARGETS } from './trade-settings-scenario';

const { rdo } = createTradeSettingsScenario();

const X = 706;
const Y = 436;

/**
 * A context whose construction socket exists and whose cacher answers the two
 * questions this handler asks: the bind ids and the read-back.
 */
function makeCtx(): FakeSessionCtx {
  const fake = makeSessionCtx({ sockets: ['construction'] });
  fake.cacher.createObject.mockResolvedValue(TRADE_TARGETS.tempObject);
  fake.cacher.getPropertyList.mockImplementation(async (_id: string, props: string[]) => {
    if (props[0] === 'CurrBlock') return [TRADE_TARGETS.currBlock, TRADE_TARGETS.objectId];
    return ['0'];
  });
  return fake;
}

/** The handler sleeps 200 ms before its read-back; time is faked, not waited. */
async function emit(member: string, value: number): Promise<string> {
  const fake = makeCtx();
  const pending = setBuildingProperty(fake.ctx, X, Y, member, String(value));
  await jest.advanceTimersByTimeAsync(200);
  await pending;
  expect(fake.frames.construction).toHaveLength(1);
  return fake.frames.construction[0];
}

describe('trade-settings scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('both members are 1-argument procedures, so every frame carries "*"', () => {
    for (const member of ['RDOSetRole', 'RDOSetTradeLevel'] as const) {
      expect(RDO_MEMBERS[member].kind).toBe('procedure');
      expect(RDO_MEMBERS[member]).toHaveProperty('arity', 1);
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

  it('offers exactly the legal arguments of each member, and no others', () => {
    const argsFor = (member: string) => rdo.exchanges
      .filter(e => e.matchKeys?.member === member)
      .map(e => e.matchKeys!.argsPattern![0])
      .sort();

    expect(argsFor('RDOSetRole')).toEqual(['"#2"', '"#5"', '"#6"']);
    expect(argsFor('RDOSetTradeLevel')).toEqual(['"#0"', '"#2"', '"#3"']);
    // tlvPupil is unreachable from the combo, so it is unreachable here too.
    expect(argsFor('RDOSetTradeLevel')).not.toContain('"#1"');
  });

  it('matches each frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });
});

describe('trade-settings scenario — the arguments on the wire', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const cases: { member: string; slug: string; value: number }[] = [
    ...TRADE_MODE_VALUES.map(value => ({ member: 'RDOSetRole', slug: 'rdo-set-role', value })),
    ...TRADE_LEVEL_VALUES.map(value => ({ member: 'RDOSetTradeLevel', slug: 'rdo-set-trade-level', value })),
  ];

  it.each(cases)('$member $value reaches the wire as its own exchange', async ({ member, slug, value }) => {
    const frame = await emit(member, value);

    expect(frame).toMatchRdoFormat();

    const mock = new RdoMock();
    mock.addScenario(rdo);
    expect(mock.match(frame)!.exchange.id).toBe(`trade-${slug}-${value}`);
  });
});
