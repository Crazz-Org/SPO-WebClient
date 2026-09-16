/**
 * research-status-handler — `AllObjectStatusText` on the `world` socket, and the
 * two sentences a Research Center writes into it.
 *
 * The member is a published Delphi FUNCTION of two integers
 * (`Interface Server/InterfaceServer.pas:148`), so the frame carries `"^"` and
 * two `RdoValue.int` arguments in Id-then-TycoonId order — the order Voyager
 * itself passes (`ServerCnxHandler.pas:1416`).
 *
 * The parse side covers the two formatted strings
 * (`Kernel/SimHints.pas:332` and `:333`) separately and together, and the case
 * the server emits neither: nothing is being researched.
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

const X = 118;
const Y = 226;
// §4bis "IDs dynamiques" — distinct from every context id the fake carries.
const BUILDING_ID = '40211977';

/** The three sections `TWorld.RDOAllObjectStatusText` joins with `':-:'`. */
function statusPayload(main: string, secondary: string, hint = 'Hint: Keep researching.'): string {
  return `res="%${main}:-:${secondary}:-:${hint}:-:"`;
}

function makeStatusCtx(): FakeSessionCtx {
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

describe('getActiveResearchStatus — emission', () => {
  it('calls AllObjectStatusText on the world context with the focused building id then the tycoon proxy id', async () => {
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

  it('reads both sentences out of a three-section answer', async () => {
    const fake = makeStatusCtx();
    fake.respond(() => statusPayload(
      '37% research completed',
      'Researching Green Tech. Cost: $1,250,000. Company supported at 200%.',
    ));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toEqual({
      percentComplete: 37,
      inventionName: 'Green Tech',
    });
  });

  it('answers null — never the digit — when the facade answers the integer ERROR_Unknown', async () => {
    const fake = makeStatusCtx();
    fake.respond(() => 'res="#1"');

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('swallows a transport failure and answers null rather than rejecting', async () => {
    const fake = makeStatusCtx();
    fake.respond(() => { throw new Error('world socket gone'); });

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('swallows a focusBuilding failure, and sends nothing', async () => {
    const fake = makeStatusCtx();
    (fake.ctx.focusBuilding as jest.Mock).mockRejectedValue(new Error('no object at (118, 226)'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it.each([
    ['no world context', { worldContextId: null }],
    ['no tycoon proxy id', { fTycoonProxyId: null }],
  ])('asks nothing and answers null with %s', async (_label, override) => {
    const fake = makeSessionCtx(override);

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.ctx.focusBuilding).not.toHaveBeenCalled();
    expect(fake.sent).toHaveLength(0);
  });

  it('catalogues AllObjectStatusText exactly as InterfaceServer.pas:148 declares it', () => {
    expect(RDO_MEMBERS.AllObjectStatusText).toEqual({ kind: 'function', arity: 2 });
  });
});

// ===========================================================================
// parseResearchStatusText — the two formatted strings
// ===========================================================================

describe('parseResearchStatusText', () => {
  it('reads the percentage alone when only the sttMain sentence is there', () => {
    const text = '37% research completed:-::-:Hint: Go to "Settings".:-:';
    expect(parseResearchStatusText(text)).toEqual({ percentComplete: 37 });
  });

  it('reads the invention name alone when only the sttSecondary sentence is there', () => {
    const text = ':-:Researching Green Tech. Cost: $1,250,000.:-::-:';
    expect(parseResearchStatusText(text)).toEqual({ inventionName: 'Green Tech' });
  });

  it('answers null when nothing is being researched — neither sentence is emitted', () => {
    const text = 'Level 3. Profit: $12,000.:-:Company supported at 200%.:-:Hint: Go to "Settings" to carry out new researchs.:-:';
    expect(parseResearchStatusText(text)).toBeNull();
  });

  it('is not fooled by "Company supported at 200%." — only "% research completed" counts', () => {
    expect(parseResearchStatusText('Company supported at 200%.')).toBeNull();
  });

  it('captures an invention name containing a period, stopping at the ". Cost:" that closes the sentence', () => {
    const text = 'Researching Nano Tech v1.5 Refinement. Cost: $980,000. Company supported at 100%.';
    expect(parseResearchStatusText(text)).toEqual({ inventionName: 'Nano Tech v1.5 Refinement' });
  });

  it('reads 0% and 100% as numbers, not as absent', () => {
    expect(parseResearchStatusText('0% research completed')).toEqual({ percentComplete: 0 });
    expect(parseResearchStatusText('100% research completed')).toEqual({ percentComplete: 100 });
  });
});

// ===========================================================================
// markActiveDeveloping
// ===========================================================================

describe('markActiveDeveloping', () => {
  function items(...names: string[]): ResearchInventionItem[] {
    return names.map((name, i) => ({ inventionId: `INV_${i}`, name }));
  }

  it('marks exactly the one item whose name matches, ignoring case and surrounding spaces', () => {
    const developing = items('Solar Panels', '  green tech ', 'Hydro');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing.map(i => i.active)).toEqual([undefined, true, undefined]);
  });

  it('marks only the first when two developing items share the name', () => {
    const developing = items('Green Tech', 'Green Tech');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing.map(i => i.active)).toEqual([true, undefined]);
  });

  it('marks nothing when the named research belongs to another category tab', () => {
    const developing = items('Solar Panels');

    markActiveDeveloping(developing, { inventionName: 'Green Tech', percentComplete: 37 });

    expect(developing[0].active).toBeUndefined();
  });

  it.each([
    ['a null status', null],
    ['a status with no invention name', { percentComplete: 37 }],
    ['a status whose name is blank', { inventionName: '   ' }],
  ])('is a no-op on %s', (_label, status) => {
    const developing = items('Green Tech');

    markActiveDeveloping(developing, status);

    expect(developing[0].active).toBeUndefined();
  });
});
