/**
 * research-status-handler — `AllObjectStatusText` on the `world` socket, and
 * the two research sentences parsed out of its answer.
 *
 * The member is a published Delphi FUNCTION of two integers
 * (`Interface Server/InterfaceServer.pas:148`), so the frame carries `"^"`,
 * the facility id first and the tycoon proxy id second — the order Voyager
 * itself passes (`ServerCnxHandler.pas:1416`).
 *
 * The parse targets exactly two format strings: `'%d%% research completed'`
 * (`Kernel/SimHints.pas:332`) and `'Researching %s. Cost: %s.'` (`:333`).
 * Neither is emitted while the centre is idle
 * (`Kernel/ResearchCenter.pas:713-733`), which is why "no research active" is a
 * first-class answer and not a failure.
 */

import {
  getActiveResearchStatus,
  parseResearchStatusText,
  markActiveDeveloping,
} from './research-status-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '../__tests__/session/fake-session-context';
import type { ResearchInventionItem } from '../../shared/types';
import { RdoValue } from '../../shared/rdo-types';
import { RdoVerb, RdoAction } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RDO_MEMBERS } from '../../shared/rdo-members';

const BUILDING_ID = '40133601';
const X = 118;
const Y = 226;

/** The three sections `TWorld.RDOAllObjectStatusText` joins with ':-:'. */
function statusText(main: string, secondary: string, hint = 'Hint: click to focus.'): string {
  return `res="%${main}:-:${secondary}:-:${hint}:-:"`;
}

function withFocus(): FakeSessionCtx {
  const fake = makeSessionCtx();
  (fake.ctx.focusBuilding as jest.Mock).mockResolvedValue({
    buildingId: BUILDING_ID,
    buildingName: 'Research Center',
    ownerName: 'SPO_test3',
  });
  return fake;
}

// ===========================================================================
// getActiveResearchStatus — the wire
// ===========================================================================

describe('getActiveResearchStatus', () => {
  it('calls AllObjectStatusText on the world context, facility id then tycoon proxy id', async () => {
    const fake = withFocus();
    fake.respond(() => statusText('37% research completed', 'Researching Green Tech. Cost: $1,250,000.'));

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

  it('reads both sentences out of a full three-section answer', async () => {
    const fake = withFocus();
    fake.respond(() => statusText(
      '37% research completed',
      'Researching Green Tech. Cost: $1,250,000. Company supported at 200%.',
    ));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toEqual({
      percentComplete: 37,
      inventionName: 'Green Tech',
    });
  });

  it('answers null — never the digit — when the facade answers the integer ERROR_Unknown', async () => {
    const fake = withFocus();
    fake.respond(() => 'res="#1"');

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('swallows a transport failure and answers null rather than rejecting', async () => {
    const fake = withFocus();
    fake.respond(() => { throw new Error('world socket gone'); });

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('answers null and sends nothing when the building cannot be focused', async () => {
    const fake = makeSessionCtx();
    (fake.ctx.focusBuilding as jest.Mock).mockRejectedValue(new Error('no object at (118, 226)'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it('asks nothing when the session is not in a world', async () => {
    const fake = makeSessionCtx({ worldContextId: null });

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.ctx.focusBuilding).not.toHaveBeenCalled();
    expect(fake.sent).toHaveLength(0);
  });

  it('asks nothing when the tycoon proxy id is not known yet', async () => {
    const fake = makeSessionCtx({ fTycoonProxyId: null });

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it('catalogues AllObjectStatusText exactly as InterfaceServer.pas:148 declares it', () => {
    expect(RDO_MEMBERS.AllObjectStatusText).toEqual({ kind: 'function', arity: 2 });
  });
});

// ===========================================================================
// parseResearchStatusText — the two format strings
// ===========================================================================

describe('parseResearchStatusText', () => {
  it('reads the percentage alone when only the sttMain sentence is present', () => {
    expect(parseResearchStatusText('37% research completed:-::-:Hint')).toEqual({ percentComplete: 37 });
  });

  it('reads the name alone when only the sttSecondary sentence is present', () => {
    expect(parseResearchStatusText(':-:Researching Green Tech. Cost: $12.:-:Hint'))
      .toEqual({ inventionName: 'Green Tech' });
  });

  it('answers null when the centre is idle and neither sentence was written', () => {
    expect(parseResearchStatusText('Research Center:-:Company supported at 200%.:-:Hint: click.')).toBeNull();
  });

  it('answers null on an empty status text', () => {
    expect(parseResearchStatusText('')).toBeNull();
  });

  it('keeps an invention name that contains a period, stopping at ". Cost:"', () => {
    expect(parseResearchStatusText('Researching GreenTech.Level1. Cost: $1,250,000.'))
      .toEqual({ inventionName: 'GreenTech.Level1' });
  });

  it('does not mistake "Company supported at 200%." for the research percentage', () => {
    expect(parseResearchStatusText('Company supported at 200%.')).toBeNull();
  });

  it('reads 0% and 100% as numbers, not as absent', () => {
    expect(parseResearchStatusText('0% research completed')).toEqual({ percentComplete: 0 });
    expect(parseResearchStatusText('100 % Research Completed')).toEqual({ percentComplete: 100 });
  });
});

// ===========================================================================
// markActiveDeveloping — exactly one item
// ===========================================================================

describe('markActiveDeveloping', () => {
  function items(...names: string[]): ResearchInventionItem[] {
    return names.map((name, i) => ({ inventionId: `id${i}`, name }));
  }

  it('marks the one item whose name matches, ignoring case and surrounding space', () => {
    const developing = items('Solar Panels', '  green tech ');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing.map(i => i.active)).toEqual([undefined, true]);
  });

  it('marks only the first when two developing items share the name', () => {
    const developing = items('Green Tech', 'Green Tech');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing.map(i => i.active)).toEqual([true, undefined]);
  });

  it('marks nothing when the active research belongs to another category tab', () => {
    const developing = items('Solar Panels');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing[0].active).toBeUndefined();
  });

  it('is a no-op on a null status', () => {
    const developing = items('Green Tech');

    markActiveDeveloping(developing, null);

    expect(developing[0].active).toBeUndefined();
  });

  it('is a no-op when the server gave a percentage but no name', () => {
    const developing = items('Green Tech');

    markActiveDeveloping(developing, { percentComplete: 37 });

    expect(developing[0].active).toBeUndefined();
  });
});
