/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `bank-tv-live-reads` — driven through the real gateway.
 *
 * Part 1 fixes the catalogue and the wire: `RDOEstimateLoan` is a 1-argument
 * `function` (so `"^"` and one `#` argument), and the five sliders are read
 * through catalogued `get` accessors. Part 2 opens both inspectors against an
 * `RdoMock` loaded with the scenario and asserts the six values arrive populated
 * — from the block, since the cache fixture no longer holds any of them.
 */

import { RdoProtocol } from '@/server/rdo';
import { RdoValue } from '@/shared/rdo-types';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import type { RdoPacket } from '@/shared/types';
import { getBuildingBasicDetails } from '@/server/session/building-details-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import {
  registerInspectorTabs,
  clearInspectorTabsCache,
  TV_GENERAL_GROUP,
} from '@/shared/building-details';
import { RdoMock } from '../rdo-mock';
import {
  createBankTvLiveReadsScenario,
  BANK_LIVE_READS_BLOCK,
  TV_LIVE_READS_BLOCK,
  BANK_LIVE_READS_TYCOON,
  BANK_LIVE_READS_ANSWERS,
  TV_LIVE_READS_ANSWERS,
} from './bank-tv-live-reads-scenario';

const { rdo } = createBankTvLiveReadsScenario();

const X = 118;
const Y = 226;
/** Probe visual classes — nothing else in the suite registers them. */
const BANK_CLASS = '9570';
const TV_CLASS = '9571';

describe('bank-tv-live-reads scenario — the catalogue and the wire', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('RDOEstimateLoan is a catalogued 1-argument function', () => {
    // StdBlocks/Banks.pas:45 — `function RDOEstimateLoan( ClientId : integer ) : olevariant;`
    expect(RDO_MEMBERS.RDOEstimateLoan).toEqual({ kind: 'function', arity: 1 });
  });

  it('all five slider members are catalogued readable accessors', () => {
    for (const member of ['BudgetPerc', 'Interest', 'Term', 'HoursOnAir', 'Commercials'] as const) {
      const spec = RDO_MEMBERS[member];
      expect(spec.kind).toBe('accessor');
      expect((spec as { access: readonly string[] }).access).toContain('get');
    }
  });

  it('the call frame carries "^" and exactly one # argument', () => {
    const call = rdo.exchanges.find(e => e.id === 'btl-rdo-estloan')!;
    expect(call.request).toContain('"^"');
    expect(call.request).toContain(RdoValue.int(BANK_LIVE_READS_TYCOON).format());
    expect(call.matchKeys?.argsPattern).toHaveLength(1);
  });

  it('matches each frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });

  it('the answered Hours On Air lies inside the slider Voyager draws', () => {
    const hours = TV_GENERAL_GROUP.properties.find(p => p.rdoName === 'HoursOnAir')!;
    const value = parseInt(TV_LIVE_READS_ANSWERS.hoursOnAir, 10);
    expect(value).toBeGreaterThanOrEqual(hours.min!);
    expect(value).toBeLessThanOrEqual(hours.max!);
  });
});

describe('bank-tv-live-reads scenario — the drive', () => {
  beforeAll(() => {
    registerInspectorTabs(BANK_CLASS, [{ tabName: 'BankGeneral', tabHandler: 'BankGeneral' }], 'Bank');
    registerInspectorTabs(TV_CLASS, [{ tabName: 'TVGeneral', tabHandler: 'TVGeneral' }], 'TV Station');
  });

  afterAll(() => {
    clearInspectorTabsCache();
  });

  function makeCtx(block: string): { fake: FakeSessionCtx; mock: RdoMock } {
    const fake = makeSessionCtx({
      sockets: ['map', 'construction'],
      fTycoonProxyId: BANK_LIVE_READS_TYCOON,
    });
    let next = 900001;
    fake.cacher.createObject.mockImplementation(async () => String(next++));
    fake.cacher.getPropertyList.mockImplementation(
      async (_id: string, names: string[]) =>
        names.map(n => (n === 'Name' ? 'Probe' : n === 'CurrBlock' ? block : '')),
    );
    (fake.ctx.focusBuilding as jest.Mock).mockResolvedValue({
      buildingId: '40133602', buildingName: 'Probe', ownerName: '',
    });

    const mock = new RdoMock();
    mock.addScenario(rdo);

    fake.respond((packet) => {
      const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
      const r = mock.match(frame);
      return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
    });

    return { fake, mock };
  }

  it('populates the bank sheet from the block, not the cache', async () => {
    const { fake, mock } = makeCtx(BANK_LIVE_READS_BLOCK);

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, BANK_CLASS);

    const bank = details.groups['bankGeneral'];
    // The FormatMoney punctuation is stripped by the gateway (MathUtils.pas:87-109).
    expect(bank).toContainEqual({ name: 'EstLoan', value: '5000000' });
    expect(bank).toContainEqual({ name: 'BudgetPerc', value: BANK_LIVE_READS_ANSWERS.budgetPerc });
    expect(bank).toContainEqual({ name: 'Interest', value: BANK_LIVE_READS_ANSWERS.interest });
    expect(bank).toContainEqual({ name: 'Term', value: BANK_LIVE_READS_ANSWERS.term });
    expect(mock.getConsumedIds()).toEqual(new Set([
      'btl-rdo-estloan', 'btl-rdo-budgetperc', 'btl-rdo-interest', 'btl-rdo-term',
    ]));
  });

  it('populates the TV sheet from the block, under the template read key', async () => {
    const { fake, mock } = makeCtx(TV_LIVE_READS_BLOCK);

    const details = await getBuildingBasicDetails(fake.ctx, X, Y, TV_CLASS);

    const tv = details.groups['tvGeneral'];
    expect(tv).toContainEqual({ name: 'HoursOnAir', value: TV_LIVE_READS_ANSWERS.hoursOnAir });
    // Two m on the wire, one m in the group (Voyager/TVGeneralSheet.pas:15).
    expect(tv).toContainEqual({ name: 'Comercials', value: TV_LIVE_READS_ANSWERS.commercials });
    expect(mock.getConsumedIds()).toEqual(new Set(['btl-rdo-hoursonair', 'btl-rdo-commercials']));
  });

  it('across both inspectors every one of the six exchanges is consumed', async () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);

    for (const [block, visualClass] of [
      [BANK_LIVE_READS_BLOCK, BANK_CLASS],
      [TV_LIVE_READS_BLOCK, TV_CLASS],
    ] as const) {
      const fake = makeSessionCtx({
        sockets: ['map', 'construction'],
        fTycoonProxyId: BANK_LIVE_READS_TYCOON,
      });
      let next = 900001;
      fake.cacher.createObject.mockImplementation(async () => String(next++));
      fake.cacher.getPropertyList.mockImplementation(
        async (_id: string, names: string[]) => names.map(n => (n === 'CurrBlock' ? block : '')),
      );
      (fake.ctx.focusBuilding as jest.Mock).mockResolvedValue({
        buildingId: '40133602', buildingName: 'Probe', ownerName: '',
      });
      fake.respond((packet) => {
        const r = mock.match(`${RdoProtocol.format(packet as RdoPacket)};`);
        return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
      });

      await getBuildingBasicDetails(fake.ctx, X, Y, visualClass);
    }

    expect(mock.getConsumedIds()).toEqual(new Set(rdo.exchanges.map(e => e.id)));
  });
});
