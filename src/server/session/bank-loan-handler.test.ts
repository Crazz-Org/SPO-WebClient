/**
 * `askBankLoan` — the two things that can silently go wrong on this member.
 *
 * The ARGUMENTS: `RDOAskLoan( ClientId : integer; Amount : widestring )`
 * (`StdBlocks/Banks.pas:46`) dereferences its first argument as a pointer
 * (`TMoneyDealer(ClientId)`, `:165`). An amount packed as an integer, or a
 * security id packed as a string, is not a wrong number on screen — it is a bad
 * pointer on the model server. So the packing is asserted on the wire, not on
 * the return value.
 *
 * The ANSWER: three server ordinals (`Kernel/Kernel.pas:1750`) and Voyager's
 * fourth, client-side one (`Voyager/BankGeneralSheet.pas:22`). Each must reach
 * its own outcome — that is the whole point of the card, four distinguishable
 * answers rather than one generic failure.
 */

import { describe, it, expect } from '@jest/globals';
import { askBankLoan, bankLoanVerdictOf } from './bank-loan-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import { RdoProtocol } from '../rdo';
import { RdoValue } from '../../shared/rdo-types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RdoVerb, RdoAction } from '../../shared/types';
import type { RdoPacket } from '../../shared/types';

const X = 924;
const Y = 820;
const BLOCK = '130200144';

function makeCtx(answer: string | Error = 'res="#0"', overrides = {}) {
  const fake = makeSessionCtx({ sockets: ['construction'], ...overrides });
  (fake.ctx.getCacherPropertyListAt as jest.Mock).mockResolvedValue([BLOCK]);
  fake.respond(() => answer);
  return fake;
}

describe('askBankLoan — the wire', () => {
  it('packs the security id as an integer and the amount as a string, on the "^" function path', async () => {
    const fake = makeCtx();

    await askBankLoan(fake.ctx, X, Y, '1000000');

    expect(fake.sent).toHaveLength(1);
    const sent = fake.sent[0];
    expect(sent.socketName).toBe('construction');
    expect(sent.category).toBe(TimeoutCategory.NORMAL);

    const packet = sent.packet as Partial<RdoPacket>;
    expect(packet.verb).toBe(RdoVerb.SEL);
    expect(packet.action).toBe(RdoAction.CALL);
    expect(packet.member).toBe('RDOAskLoan');
    expect(packet.targetId).toBe(BLOCK);
    expect(packet.args).toEqual([
      RdoValue.int(FAKE_CONTEXT_IDS.tycoonProxyId).format(),
      RdoValue.string('1000000').format(),
    ]);

    expect(RdoProtocol.format(packet as RdoPacket)).toContain('call RDOAskLoan "^"');
  });

  it('opens the construction connection when it is not already held', async () => {
    const fake = makeCtx('res="#0"', { sockets: [] });

    await askBankLoan(fake.ctx, X, Y, '1000000');

    expect(fake.ctx.connectConstructionService).toHaveBeenCalled();
  });

  it('does not reopen a connection it already holds', async () => {
    const fake = makeCtx();

    await askBankLoan(fake.ctx, X, Y, '1000000');

    expect(fake.ctx.connectConstructionService).not.toHaveBeenCalled();
  });
});

describe('askBankLoan — the four answers', () => {
  it.each([
    ['0', 'approved'],
    ['1', 'rejected'],
    ['2', 'notEnoughFunds'],
    ['3', 'error'],
  ])('ordinal %s reaches its own outcome (%s)', async (ordinal, verdict) => {
    const fake = makeCtx(`res="#${ordinal}"`);

    expect(await askBankLoan(fake.ctx, X, Y, '1000000')).toEqual({ verdict, result: ordinal });
  });

  it.each([
    ['an empty answer', ''],
    ['a non-numeric answer', 'xyz'],
    ['an unknown ordinal', '9'],
  ])('reads %s as brqError', (_label, raw) => {
    expect(bankLoanVerdictOf(raw)).toBe('error');
  });

  it('tolerates surrounding whitespace on the ordinal', () => {
    expect(bankLoanVerdictOf(' 2 ')).toBe('notEnoughFunds');
  });
});

describe('askBankLoan — what it refuses to send', () => {
  it('answers brqError without calling when there is no security id', async () => {
    const fake = makeCtx('res="#0"', { fTycoonProxyId: null });

    expect(await askBankLoan(fake.ctx, X, Y, '1000000')).toEqual({ verdict: 'error', result: '' });
    expect(fake.sent).toHaveLength(0);
  });

  it('turns a failed call into brqError rather than throwing into the caller', async () => {
    const fake = makeCtx(new Error('Request timeout: RDOAskLoan'));

    expect(await askBankLoan(fake.ctx, X, Y, '1000000')).toEqual({ verdict: 'error', result: '' });
    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('[BankLoan]'));
  });

  it('rejects when no building stands at the coordinates, and sends nothing', async () => {
    const fake = makeSessionCtx({ sockets: ['construction'] });
    (fake.ctx.getCacherPropertyListAt as jest.Mock).mockResolvedValue([]);

    await expect(askBankLoan(fake.ctx, X, Y, '1000000'))
      .rejects.toThrow(`No building found at (${X}, ${Y})`);
    expect(fake.sent).toHaveLength(0);
  });
});
