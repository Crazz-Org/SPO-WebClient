/**
 * research-status-handler — `AllObjectStatusText` on the `world` socket, and
 * the two sentences a Research Center writes into its status text.
 *
 * The member is a published Delphi FUNCTION of two integers
 * (`Interface Server/InterfaceServer.pas:148`), so the frame carries `"^"` and
 * `Id` then `TycoonId` — the order Voyager itself passes
 * (`ServerCnxHandler.pas:1416`). The other half of the file is the parse: the
 * percentage (`Kernel/SimHints.pas:332`), the invention name
 * (`Kernel/SimHints.pas:333`), either alone, and neither — which is exactly
 * what the server emits when `fCurrResearch` is nil.
 */

import {
  getActiveResearchStatus,
  markActiveDeveloping,
  parseResearchStatusText,
} from './research-status-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '../__tests__/session/fake-session-context';
import { RdoValue } from '../../shared/rdo-types';
import { RdoVerb, RdoAction } from '../../shared/types';
import type { ResearchInventionItem } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RDO_MEMBERS } from '../../shared/rdo-members';

const BUILDING_ID = '30441088';
const X = 118;
const Y = 226;

/** A focused building, the way `focusBuilding` answers in production. */
function withFocus(fake: FakeSessionCtx): FakeSessionCtx {
  (fake.ctx.focusBuilding as jest.Mock).mockResolvedValue({
    buildingId: BUILDING_ID,
    buildingName: 'Research Center',
    ownerName: 'SPO_test3',
  });
  return fake;
}

/** The three sections as the world joins them (`StatusTextSeparator = ':-:'`). */
function sections(main: string, secondary: string, hint = 'Hint: keep going.'): string {
  return `res="%${main}:-:${secondary}:-:${hint}"`;
}

describe('getActiveResearchStatus', () => {
  it('calls AllObjectStatusText on the world context with the building id then the tycoon proxy id', async () => {
    const fake = withFocus(makeSessionCtx());
    fake.respond(() => sections('37% research completed', ''));

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

  it('reads both the percentage and the invention name out of the joined sections', async () => {
    const fake = withFocus(makeSessionCtx());
    fake.respond(() => sections(
      'Research Center. 37% research completed',
      'Researching Green Tech. Cost: $1,250,000. Company supported at 200%.',
    ));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toEqual({
      percentComplete: 37,
      inventionName: 'Green Tech',
    });
  });

  it('answers the percentage alone when only the main section carries a sentence', async () => {
    const fake = withFocus(makeSessionCtx());
    fake.respond(() => sections('37% research completed', 'Company supported at 200%.'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toEqual({ percentComplete: 37 });
  });

  it('answers the invention name alone when only the secondary section carries a sentence', async () => {
    const fake = withFocus(makeSessionCtx());
    fake.respond(() => sections('Research Center', 'Researching Green Tech. Cost: $1,250,000.'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toEqual({ inventionName: 'Green Tech' });
  });

  it('answers null when nothing is being researched — neither sentence is emitted', async () => {
    const fake = withFocus(makeSessionCtx());
    fake.respond(() => sections('Research Center', 'Company supported at 200%.'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('captures an invention name containing a period whole', async () => {
    const fake = withFocus(makeSessionCtx());
    fake.respond(() => sections('', 'Researching Dr. Kloner Cloning Vats. Cost: $2,000,000.'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toEqual({
      inventionName: 'Dr. Kloner Cloning Vats',
    });
  });

  it('answers null — never the digit — when the facade answers the integer ERROR_Unknown', async () => {
    const fake = withFocus(makeSessionCtx());
    fake.respond(() => 'res="#1"');

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('swallows a transport failure and answers null rather than rejecting', async () => {
    const fake = withFocus(makeSessionCtx());
    fake.respond(() => new Error('Request timeout: AllObjectStatusText'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('asks nothing when the building cannot be focused', async () => {
    const fake = makeSessionCtx();
    (fake.ctx.focusBuilding as jest.Mock).mockRejectedValue(new Error('no building there'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it('asks nothing when the session is not in a world', async () => {
    const fake = withFocus(makeSessionCtx({ worldContextId: null }));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it('asks nothing when the model-server tycoon pointer is not known yet', async () => {
    const fake = withFocus(makeSessionCtx({ fTycoonProxyId: null }));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it('catalogues AllObjectStatusText exactly as InterfaceServer.pas:148 declares it', () => {
    expect(RDO_MEMBERS.AllObjectStatusText).toEqual({ kind: 'function', arity: 2 });
  });
});

describe('parseResearchStatusText', () => {
  it('does not mistake "Company supported at 200%." for the research percentage', () => {
    expect(parseResearchStatusText('Company supported at 200%.')).toBeNull();
  });

  it('reads a zero percentage rather than treating it as absent', () => {
    expect(parseResearchStatusText('0% research completed')).toEqual({ percentComplete: 0 });
  });

  it('trims the captured invention name', () => {
    expect(parseResearchStatusText('Researching   Green Tech . Cost: $1.')).toEqual({
      inventionName: 'Green Tech',
    });
  });
});

describe('markActiveDeveloping', () => {
  function items(...names: string[]): ResearchInventionItem[] {
    return names.map((name, i) => ({ inventionId: `Inv${i}`, name }));
  }

  it('marks exactly the one developing item the status text names', () => {
    const developing = items('Robotics', 'Green Tech', 'Nanotech');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing.map(i => i.active)).toEqual([undefined, true, undefined]);
  });

  it('matches trimmed and case-insensitively', () => {
    const developing = items('green tech');

    markActiveDeveloping(developing, { inventionName: '  GREEN TECH  ' });

    expect(developing[0].active).toBe(true);
  });

  it('marks only the first when two items share the name', () => {
    const developing = items('Green Tech', 'Green Tech');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing.map(i => i.active)).toEqual([true, undefined]);
  });

  it('marks nothing when the active research belongs to another category', () => {
    const developing = items('Robotics');

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing[0].active).toBeUndefined();
  });

  it('is a no-op on a null status and on a status carrying only a percentage', () => {
    const developing = items('Green Tech');

    markActiveDeveloping(developing, null);
    markActiveDeveloping(developing, { percentComplete: 37 });

    expect(developing[0].active).toBeUndefined();
  });
});
