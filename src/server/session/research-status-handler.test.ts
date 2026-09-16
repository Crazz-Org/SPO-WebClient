/**
 * research-status-handler — `AllObjectStatusText` on the `world` socket, and the
 * two sentences the Research Center writes into it.
 *
 * The member is a published Delphi FUNCTION of two integers
 * (`Interface Server/InterfaceServer.pas:148`), so the frame carries `"^"`, the
 * facility id, then the tycoon proxy id — the order Voyager itself passes
 * (`Voyager/URLHandlers/ServerCnxHandler.pas:1416`).
 *
 * The parse half covers both formatted strings — `'%d%% research completed'`
 * (`Kernel/SimHints.pas:332`) and `'Researching %s. Cost: %s.'` (`:333`) —
 * each alone, both together, and the case the server emits while nothing is
 * being researched: neither string at all.
 */

import { getActiveResearchStatus, parseResearchStatusText, markActiveDeveloping } from './research-status-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '../__tests__/session/fake-session-context';
import type { ResearchInventionItem } from '../../shared/types';
import { RdoValue } from '../../shared/rdo-types';
import { RdoVerb, RdoAction } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RDO_MEMBERS } from '../../shared/rdo-members';

const BUILDING_ID = '40155328';
const X = 118;
const Y = 226;

/** A fake whose `focusBuilding` resolves, which is what the handler needs to reach the wire. */
function makeStatusCtx(overrides: Record<string, unknown> = {}): FakeSessionCtx {
  const fake = makeSessionCtx(overrides);
  (fake.ctx.focusBuilding as jest.Mock).mockResolvedValue({
    buildingId: BUILDING_ID,
    buildingName: 'Research Center',
    ownerName: 'SPO_test3',
  });
  return fake;
}

/** The three `':-:'`-joined sections as `RDOAllObjectStatusText` builds them (World.pas:4222). */
function statusPayload(main: string, secondary: string, hint = 'Hint: keep it up.'): string {
  return `res="%${main}:-:${secondary}:-:${hint}:-:"`;
}

// ===========================================================================
// getActiveResearchStatus — the wire
// ===========================================================================

describe('getActiveResearchStatus — the call', () => {
  it('calls AllObjectStatusText on the world context, facility id then tycoon proxy id', async () => {
    const fake = makeStatusCtx();
    fake.respond(() => statusPayload('37% research completed', 'Researching Green Tech. Cost: $1,250,000.'));

    await getActiveResearchStatus(fake.ctx, X, Y);

    expect(fake.ctx.focusBuilding).toHaveBeenCalledWith(X, Y);
    expect(fake.sent).toHaveLength(1);
    const [req] = fake.sent;
    expect(req.socketName).toBe('world');
    expect(req.category).toBe(TimeoutCategory.FAST);
    expect(req.packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: FAKE_CONTEXT_IDS.worldContextId,
      action: RdoAction.CALL,
      member: 'AllObjectStatusText',
      separator: '"^"',
      args: [
        RdoValue.int(parseInt(BUILDING_ID, 10)).format(),
        RdoValue.int(FAKE_CONTEXT_IDS.tycoonProxyId).format(),
      ],
    });
  });

  it('reads both formatted strings out of the joined three-section answer', async () => {
    const fake = makeStatusCtx();
    fake.respond(() => statusPayload(
      'Research Center. 37% research completed',
      'Researching Green Tech. Cost: $1,250,000. Company supported at 200%.',
    ));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toEqual({
      percentComplete: 37,
      inventionName: 'Green Tech',
    });
  });

  it('answers null when the facility is researching nothing (neither string emitted)', async () => {
    const fake = makeStatusCtx();
    fake.respond(() => statusPayload('Research Center. Owned by SPO_test3.', 'Company supported at 200%.'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('answers null — never the digit — when the facade answers the integer ERROR_Unknown', async () => {
    const fake = makeStatusCtx();
    fake.respond(() => 'res="#1"');

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('swallows a transport failure and answers null rather than rejecting', async () => {
    const fake = makeStatusCtx();
    fake.respond(() => new Error('Request timeout: AllObjectStatusText'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('answers null and sends nothing when the building cannot be focused', async () => {
    const fake = makeSessionCtx();
    (fake.ctx.focusBuilding as jest.Mock).mockRejectedValue(new Error('No building at (118, 226)'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it.each([
    ['no worldContextId', { worldContextId: null }],
    ['no fTycoonProxyId', { fTycoonProxyId: null }],
  ])('asks nothing and answers null with %s', async (_label, override) => {
    const fake = makeStatusCtx(override);

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
    expect(fake.ctx.focusBuilding).not.toHaveBeenCalled();
  });

  it('catalogues AllObjectStatusText exactly as InterfaceServer.pas:148 declares it', () => {
    expect(RDO_MEMBERS.AllObjectStatusText).toEqual({ kind: 'function', arity: 2 });
  });
});

// ===========================================================================
// parseResearchStatusText — the two formats
// ===========================================================================

describe('parseResearchStatusText', () => {
  it('reads the percentage alone when only the sttMain sentence is there', () => {
    expect(parseResearchStatusText('Research Center. 37% research completed:-::-:'))
      .toEqual({ percentComplete: 37 });
  });

  it('reads the name alone when only the sttSecondary sentence is there', () => {
    expect(parseResearchStatusText(':-:Researching Green Tech. Cost: $1,250,000.:-:'))
      .toEqual({ inventionName: 'Green Tech' });
  });

  it('reads both when both are there', () => {
    expect(parseResearchStatusText('12% research completed:-:Researching Bio Fuel. Cost: $10.:-:'))
      .toEqual({ percentComplete: 12, inventionName: 'Bio Fuel' });
  });

  it('returns null when no research is active', () => {
    expect(parseResearchStatusText('Research Center. Owned by SPO_test3.:-:Company supported at 200%.:-:Hint: hi:-:'))
      .toBeNull();
  });

  it('does not mistake "Company supported at 37%." for the research percentage', () => {
    expect(parseResearchStatusText('Company supported at 37%.:-::-:')).toBeNull();
  });

  it('captures an invention name containing a period, stopping at ". Cost:"', () => {
    expect(parseResearchStatusText('Researching Green Tech v1.2. Cost: $99.'))
      .toEqual({ inventionName: 'Green Tech v1.2' });
  });

  it('reads 0 and 100 as percentages', () => {
    expect(parseResearchStatusText('0% research completed')).toEqual({ percentComplete: 0 });
    expect(parseResearchStatusText('100% research completed')).toEqual({ percentComplete: 100 });
  });
});

// ===========================================================================
// markActiveDeveloping
// ===========================================================================

describe('markActiveDeveloping', () => {
  const items = (...names: string[]): ResearchInventionItem[] =>
    names.map((name, i) => ({ inventionId: `INV_${i}`, name }));

  it('marks exactly the one item the status text names', () => {
    const developing = items('Alpha', 'Green Tech', 'Omega');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing.map(d => d.active)).toEqual([undefined, true, undefined]);
  });

  it('matches trimmed and case-insensitively', () => {
    const developing = items('green TECH');

    markActiveDeveloping(developing, { inventionName: '  Green Tech  ' });

    expect(developing[0].active).toBe(true);
  });

  it('marks only the first when two developing items share the name', () => {
    const developing = items('Green Tech', 'Green Tech');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing.map(d => d.active)).toEqual([true, undefined]);
  });

  it('marks nothing when no developing item carries that name', () => {
    const developing = items('Alpha', 'Omega');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing.every(d => d.active === undefined)).toBe(true);
  });

  it.each([
    ['a null status', null],
    ['a status with no name', { percentComplete: 37 }],
    ['a status whose name is blank', { inventionName: '   ' }],
  ])('is a no-op on %s', (_label, status) => {
    const developing = items('Alpha');

    markActiveDeveloping(developing, status);

    expect(developing[0].active).toBeUndefined();
  });
});
