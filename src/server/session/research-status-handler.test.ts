/**
 * research-status-handler — `AllObjectStatusText` on the `world` socket, and
 * the two sentences read out of its answer.
 *
 * The member is a published Delphi FUNCTION of two integers
 * (`Interface Server/InterfaceServer.pas:148`), so the frame carries `"^"` and
 * `RdoValue.int` arguments in Id-then-TycoonId order — the order Voyager itself
 * passes (`ServerCnxHandler.pas:1416`). The rest of the file is the parse of the
 * two formatted strings (`Kernel/SimHints.pas:332` and `:333`), including the
 * case the card names explicitly: no research active, so neither is emitted.
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

/** The fake with a focused building — the normal path, the panel already open. */
function makeStatusCtx(payload: string | Error): FakeSessionCtx {
  const fake = makeSessionCtx();
  (fake.ctx.focusBuilding as jest.Mock).mockResolvedValue({
    buildingId: BUILDING_ID, buildingName: 'Research Center', ownerName: 'SPO_test3',
  });
  fake.respond(() => payload);
  return fake;
}

describe('getActiveResearchStatus', () => {
  it('calls AllObjectStatusText on the world context with the building id then the tycoon proxy id', async () => {
    const fake = makeStatusCtx('res="%"');

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
    const fake = makeStatusCtx(
      'res="%37% research completed:-:Researching Green Tech. Cost: $1,250,000. Company supported at 200%.:-:Hint: keep the workers coming.:-:"'
    );

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toEqual({
      percentComplete: 37, inventionName: 'Green Tech',
    });
  });

  it('answers null — never the digit — when the façade answers the integer ERROR_Unknown', async () => {
    const fake = makeStatusCtx('res="#1"');

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('swallows a transport failure and answers null rather than rejecting', async () => {
    const fake = makeStatusCtx(new Error('Request timeout: AllObjectStatusText'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
  });

  it('answers null and sends nothing when the building cannot be focused', async () => {
    const fake = makeSessionCtx();
    (fake.ctx.focusBuilding as jest.Mock).mockRejectedValue(new Error('no building there'));

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it.each([
    ['no worldContextId', { worldContextId: null }],
    ['no fTycoonProxyId', { fTycoonProxyId: null }],
  ])('asks nothing and answers null with %s', async (_label, override) => {
    const fake = makeSessionCtx(override);

    await expect(getActiveResearchStatus(fake.ctx, X, Y)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
    expect(fake.ctx.focusBuilding).not.toHaveBeenCalled();
  });

  it('catalogues AllObjectStatusText exactly as InterfaceServer.pas:148 declares it', () => {
    expect(RDO_MEMBERS.AllObjectStatusText).toEqual({ kind: 'function', arity: 2 });
  });
});

describe('parseResearchStatusText', () => {
  it('reads the percentage alone when only the sttMain sentence is there', () => {
    expect(parseResearchStatusText('37% research completed:-::-:')).toEqual({ percentComplete: 37 });
  });

  it('reads the invention name alone when only the sttSecondary sentence is there', () => {
    expect(parseResearchStatusText(':-:Researching Green Tech. Cost: $1,250,000.:-:'))
      .toEqual({ inventionName: 'Green Tech' });
  });

  it('answers null when no research is active — neither sentence is emitted', () => {
    expect(parseResearchStatusText(
      'Research Center:-:Company supported at 200%.:-:Hint: Go to "Settings" to carry out new researchs.:-:'
    )).toBeNull();
  });

  it('answers null on an empty answer', () => {
    expect(parseResearchStatusText('')).toBeNull();
  });

  it('captures an invention name containing a period whole, stopping at ". Cost:"', () => {
    expect(parseResearchStatusText('Researching Green Tech. Level 2. Cost: $10.'))
      .toEqual({ inventionName: 'Green Tech. Level 2' });
  });

  it('does not mistake "Company supported at 200%." for the progress percentage', () => {
    expect(parseResearchStatusText('Company supported at 200%.')).toBeNull();
  });
});

describe('markActiveDeveloping', () => {
  const items = (): ResearchInventionItem[] => [
    { inventionId: 'GreenTech.Level1', name: 'Green Tech' },
    { inventionId: 'Robotics.Level1', name: 'Robotics' },
  ];

  it('marks exactly one item, matched trimmed and case-insensitively', () => {
    const developing = items();

    markActiveDeveloping(developing, { inventionName: '  green tech ' });

    expect(developing.map(i => i.active)).toEqual([true, undefined]);
  });

  it('marks only the first when two items share the name', () => {
    const developing: ResearchInventionItem[] = [
      { inventionId: 'A', name: 'Green Tech' },
      { inventionId: 'B', name: 'Green Tech' },
    ];

    markActiveDeveloping(developing, { inventionName: 'Green Tech' });

    expect(developing.map(i => i.active)).toEqual([true, undefined]);
  });

  it('marks nothing when the named research is not in this category', () => {
    const developing = items();

    markActiveDeveloping(developing, { inventionName: 'Aerospace' });

    expect(developing.every(i => i.active === undefined)).toBe(true);
  });

  it.each([
    ['a null status', null],
    ['a status carrying only the percentage', { percentComplete: 37 }],
  ])('is a no-op on %s', (_label, status) => {
    const developing = items();

    markActiveDeveloping(developing, status);

    expect(developing.every(i => i.active === undefined)).toBe(true);
  });
});
