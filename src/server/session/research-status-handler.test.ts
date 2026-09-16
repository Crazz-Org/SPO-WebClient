/**
 * research-status-handler — `AllObjectStatusText` on the `world` socket.
 *
 * The member is a published Delphi FUNCTION taking two `TObjId`
 * (`Interface Server/InterfaceServer.pas:148`), so the frame carries `"^"` and
 * two `RdoValue.int` arguments in Id-then-TycoonId order — the order Voyager
 * itself passes (`ServerCnxHandler.pas:1416`).
 *
 * The other half of the file is the two formatted strings the Research Center
 * appends when it is actually researching something — `mtidResearchMain`
 * (`Kernel/SimHints.pas:332`) and `mtidResearchSec` (`:333`) — and the fact
 * that NEITHER is emitted while `fCurrResearch` is nil
 * (`Kernel/ResearchCenter.pas:717,734`).
 */

import {
  getActiveResearchStatus,
  markActiveDeveloping,
  parseResearchStatusText,
} from './research-status-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '../__tests__/session/fake-session-context';
import type { ResearchInventionItem } from '../../shared/types';
import { RdoValue } from '../../shared/rdo-types';
import { RdoVerb, RdoAction } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RDO_MEMBERS } from '../../shared/rdo-members';

const X = 118;
const Y = 226;
/** The facility object id `focusBuilding` resolves — not any argument passed in. */
const BUILDING_ID = '40133601';

/** A fake with `focusBuilding` answering, which is what the handler needs to emit. */
function makeFocusedCtx(overrides: Parameters<typeof makeSessionCtx>[0] = {}): FakeSessionCtx {
  const fake = makeSessionCtx(overrides);
  (fake.ctx.focusBuilding as jest.Mock).mockResolvedValue({
    buildingId: BUILDING_ID,
    buildingName: 'Research Center',
    ownerName: 'SPO_test3',
  });
  return fake;
}

/** The `':-:'` join `TWorld.RDOAllObjectStatusText` writes (`Kernel/World.pas:4222`). */
function statusPayload(main: string, secondary: string, hint = 'Hint: Keep the workers coming.'): string {
  return `res="%${main}:-:${secondary}:-:${hint}"`;
}

// ===========================================================================
// getActiveResearchStatus — the wire
// ===========================================================================

describe('getActiveResearchStatus — emission', () => {
  it('calls AllObjectStatusText on the world context with the focused building id then the tycoon proxy id', async () => {
    const fake = makeFocusedCtx();
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

  it('asks nothing and answers null when the session is not in a world', async () => {
    const fake = makeFocusedCtx({ worldContextId: null });

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
    expect(fake.ctx.focusBuilding).not.toHaveBeenCalled();
  });

  it('asks nothing and answers null when InitClient never supplied the tycoon proxy id', async () => {
    const fake = makeFocusedCtx({ fTycoonProxyId: null });

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
    expect(fake.ctx.focusBuilding).not.toHaveBeenCalled();
  });

  it('answers null and sends nothing when the building cannot be focused', async () => {
    const fake = makeSessionCtx();
    (fake.ctx.focusBuilding as jest.Mock).mockRejectedValue(new Error('No building at (118, 226)'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it('swallows a transport failure and answers null rather than rejecting', async () => {
    const fake = makeFocusedCtx();
    fake.respond(() => new Error('Request timeout: AllObjectStatusText'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('answers null — never the digit — when the facade answers the integer ERROR_Unknown', async () => {
    const fake = makeFocusedCtx();
    fake.respond(() => 'res="#1"');

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.log.debug).toHaveBeenCalledWith(expect.stringContaining('error code'));
  });
});

// ===========================================================================
// getActiveResearchStatus — the two formatted strings
// ===========================================================================

describe('getActiveResearchStatus — parsing the answer', () => {
  async function read(payload: string) {
    const fake = makeFocusedCtx();
    fake.respond(() => payload);
    return getActiveResearchStatus(fake.ctx, X, Y);
  }

  it('reads both the percentage and the invention name out of a full three-section answer', async () => {
    const status = await read(statusPayload(
      '37% research completed',
      'Researching Green Tech. Cost: $1,250,000. Company supported at 200%.',
    ));

    expect(status).toEqual({ percentComplete: 37, inventionName: 'Green Tech' });
  });

  it('reads the percentage alone when only the sttMain string is present', async () => {
    const status = await read(statusPayload('12% research completed', 'Company supported at 200%.'));

    expect(status).toEqual({ percentComplete: 12 });
    expect(status?.inventionName).toBeUndefined();
  });

  it('reads the name alone when only the sttSecondary string is present', async () => {
    const status = await read(statusPayload('Operational.', 'Researching Green Tech. Cost: $1,250,000.'));

    expect(status).toEqual({ inventionName: 'Green Tech' });
    expect(status?.percentComplete).toBeUndefined();
  });

  it('answers null when no research is active — neither string is emitted', async () => {
    const status = await read(statusPayload(
      'Operational. Efficiency 95%.',
      'Company supported at 200%.',
    ));

    expect(status).toBeNull();
  });

  it('answers null on an empty payload', async () => {
    await expect(read('')).resolves.toBeNull();
  });
});

// ===========================================================================
// parseResearchStatusText — the two formats, directly
// ===========================================================================

describe('parseResearchStatusText', () => {
  it('captures an invention name containing a period whole, stopping at ". Cost:"', () => {
    expect(parseResearchStatusText('Researching Green Tech v.2. Cost: $10.')).toEqual({
      inventionName: 'Green Tech v.2',
    });
  });

  it('does not mistake "Company supported at 200%." for the research percentage', () => {
    expect(parseResearchStatusText('Company supported at 200%.')).toBeNull();
  });

  it('trims surrounding whitespace off the captured name', () => {
    expect(parseResearchStatusText('Researching   Green Tech  . Cost: $10.')).toEqual({
      inventionName: 'Green Tech',
    });
  });

  it('tolerates the space the format string does not have between the number and the %', () => {
    expect(parseResearchStatusText('8 % research completed')).toEqual({ percentComplete: 8 });
  });

  it('answers null on a status text with neither string', () => {
    expect(parseResearchStatusText('Operational.:-::-:Hint: nothing to say.')).toBeNull();
  });
});

// ===========================================================================
// markActiveDeveloping
// ===========================================================================

describe('markActiveDeveloping', () => {
  function items(...names: string[]): ResearchInventionItem[] {
    return names.map((name, i) => ({ inventionId: `INV_${i}`, name }));
  }

  it('marks exactly one item, matching the name trimmed and case-insensitively', () => {
    const developing = items('Alpha', '  green tech ', 'Omega');

    markActiveDeveloping(developing, { inventionName: 'Green Tech', percentComplete: 37 });

    expect(developing.map(i => i.active)).toEqual([undefined, true, undefined]);
  });

  it('marks only the first when two developing items share the name', () => {
    const developing = items('Green Tech', 'Green Tech');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing.map(i => i.active)).toEqual([true, undefined]);
  });

  it('marks nothing when no item matches — the active research is on another tab', () => {
    const developing = items('Alpha', 'Omega');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing.every(i => i.active === undefined)).toBe(true);
  });

  it('is a no-op on a null status', () => {
    const developing = items('Green Tech');
    markActiveDeveloping(developing, null);
    expect(developing[0].active).toBeUndefined();
  });

  it('is a no-op on a status carrying only a percentage', () => {
    const developing = items('Green Tech');
    markActiveDeveloping(developing, { percentComplete: 37 });
    expect(developing[0].active).toBeUndefined();
  });

  it('is a no-op on an empty list', () => {
    const developing: ResearchInventionItem[] = [];
    markActiveDeveloping(developing, { inventionName: 'Green Tech' });
    expect(developing).toEqual([]);
  });
});

// ===========================================================================
// The catalogue
// ===========================================================================

describe('the AllObjectStatusText catalogue entry', () => {
  it('matches the declaration at Interface Server/InterfaceServer.pas:148', () => {
    expect(RDO_MEMBERS.AllObjectStatusText).toEqual({ kind: 'function', arity: 2 });
  });
});
