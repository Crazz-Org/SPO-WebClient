/**
 * research-handler — research inventory (cacher reads) and invention details
 * (two RDO functions on the `construction` socket).
 *
 * `getResearchInventory` never touches an RDO socket: it is a cache walk over a
 * temp object. What matters there is the batching (`BATCH_SIZE = 50`, counted
 * in calls to `cacherGetPropertyList`), the `'error'` slot filter, and that the
 * temp object handed back by `cacherCreateObject` is the one closed at the end.
 *
 * `getResearchDetails` reads `CurrBlock` from the cache and targets it with
 * `RDOGetInvPropsByLang` / `RDOGetInvDescEx` — both olevariant functions, hence
 * `"^"` + QueryId on `sendRdoRequest`. §4bis: the target is the value the cache
 * returned, never a constant.
 *
 * `parseResearchItems` (session-utils.ts) is used real, never re-implemented.
 */

import { getResearchInventory, getResearchDetails } from './research-handler';
import { makeSessionCtx } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '../__tests__/session/fake-session-context';
import { RdoValue } from '../../shared/rdo-types';
import { RdoVerb, RdoAction } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';

// §4bis "IDs dynamiques" — distinct from every argument the tests pass.
const TEMP_OBJ = '7734';
const CURR_BLOCK = '40133601';
const X = 118;
const Y = 226;
const CAT = 2;

// ===========================================================================
// getResearchInventory
// ===========================================================================

describe('getResearchInventory', () => {
  /** Answers the count call with `counts`, then every batch with `batchValues(batchIndex)`. */
  function makeInventoryCtx(
    counts: [string, string, string],
    batchValues: (props: string[], batchIndex: number) => string[] = props => props.map(() => ''),
  ): FakeSessionCtx {
    const fake = makeSessionCtx();
    fake.cacher.createObject.mockResolvedValue(TEMP_OBJ);
    let calls = 0;
    fake.cacher.getPropertyList.mockImplementation(async (_id, props) => {
      const n = calls++;
      if (n === 0) return counts;
      return batchValues(props, n - 1);
    });
    return fake;
  }

  it('threads one temp object through SetObject, GetPropertyList and CloseObject', async () => {
    const fake = makeInventoryCtx(['0', '0', '0']);

    await getResearchInventory(fake.ctx, X, Y, CAT);

    expect(fake.ctx.connectMapService).toHaveBeenCalled();
    expect(fake.cacher.setObject).toHaveBeenCalledWith(TEMP_OBJ, X, Y);
    expect(fake.cacher.getPropertyList).toHaveBeenCalledWith(TEMP_OBJ, ['avlCount2', 'devCount2', 'hasCount2']);
    expect(fake.cacher.closeObject).toHaveBeenCalledWith(TEMP_OBJ);
  });

  it('with zero items reads only the counts and returns three empty lists', async () => {
    const fake = makeInventoryCtx(['0', '0', '0']);

    const data = await getResearchInventory(fake.ctx, X, Y, CAT);

    expect(fake.cacher.getPropertyList).toHaveBeenCalledTimes(1);
    expect(data).toEqual({ categoryIndex: CAT, available: [], developing: [], completed: [] });
  });

  it('treats an empty count slot as zero', async () => {
    const fake = makeInventoryCtx(['', '', '']);
    const data = await getResearchInventory(fake.ctx, X, Y, CAT);
    expect(fake.cacher.getPropertyList).toHaveBeenCalledTimes(1);
    expect(data.available).toEqual([]);
  });

  it('with fewer than 50 item properties issues a single batch, in avl/dev/has order', async () => {
    // 1 avl (5 props) + 1 dev (4 props) + 1 has (5 props) = 14 props
    const fake = makeInventoryCtx(['1', '1', '1'], props => props.map(p => `v:${p}`));

    await getResearchInventory(fake.ctx, X, Y, CAT);

    expect(fake.cacher.getPropertyList).toHaveBeenCalledTimes(2);
    expect(fake.cacher.getPropertyList).toHaveBeenNthCalledWith(2, TEMP_OBJ, [
      'avl2RsId0', 'avl2RsEnabled0', 'avl2RsName0', 'avl2RsDyn0', 'avl2RsParent0',
      'dev2RsId0', 'dev2RsName0', 'dev2RsDyn0', 'dev2RsParent0',
      'has2RsId0', 'has2RsCost0', 'has2RsName0', 'has2RsDyn0', 'has2RsParent0',
    ]);
  });

  it('with more than 50 item properties splits into batches of 50 — the count of calls is what is checked', async () => {
    // 12 avl × 5 = 60 props → batches of 50 + 10
    const batches: string[][] = [];
    const fake = makeInventoryCtx(['12', '0', '0'], props => { batches.push(props); return props.map(() => ''); });

    await getResearchInventory(fake.ctx, X, Y, CAT);

    // 1 count call + 2 batch calls
    expect(fake.cacher.getPropertyList).toHaveBeenCalledTimes(3);
    expect(batches.map(b => b.length)).toEqual([50, 10]);
    expect(batches[1][0]).toBe('avl2RsId10');
  });

  it('exactly 50 item properties is one batch, not two', async () => {
    // 10 avl × 5 = 50
    const fake = makeInventoryCtx(['10', '0', '0']);
    await getResearchInventory(fake.ctx, X, Y, CAT);
    expect(fake.cacher.getPropertyList).toHaveBeenCalledTimes(2);
  });

  it('maps the batch values onto the items through the real parseResearchItems', async () => {
    const values = new Map<string, string>([
      ['avl2RsId0', 'INV_A'], ['avl2RsEnabled0', '1'], ['avl2RsName0', 'Alpha'], ['avl2RsDyn0', 'yes'], ['avl2RsParent0', 'ROOT'],
      ['dev2RsId0', 'INV_D'], ['dev2RsName0', 'Delta'], ['dev2RsDyn0', 'no'], ['dev2RsParent0', ''],
      ['has2RsId0', 'INV_H'], ['has2RsCost0', '1500'], ['has2RsName0', ''], ['has2RsDyn0', ''], ['has2RsParent0', 'ROOT'],
    ]);
    const fake = makeInventoryCtx(['1', '1', '1'], props => props.map(p => values.get(p) ?? ''));

    const data = await getResearchInventory(fake.ctx, X, Y, CAT);

    expect(data.available).toEqual([{ inventionId: 'INV_A', name: 'Alpha', enabled: true, cost: undefined, parent: 'ROOT', volatile: true }]);
    expect(data.developing).toEqual([{ inventionId: 'INV_D', name: 'Delta', enabled: undefined, cost: undefined, parent: undefined, volatile: undefined }]);
    // name falls back to the id when the slot is empty
    expect(data.completed).toEqual([{ inventionId: 'INV_H', name: 'INV_H', enabled: undefined, cost: '1500', parent: 'ROOT', volatile: undefined }]);
  });

  it('drops an "error" slot and an item whose id is missing, keeps empty strings as values', async () => {
    // Two avl items: item 0 has its id in error, item 1 is fine with an empty name
    const fake = makeInventoryCtx(['2', '0', '0'], props => props.map(p => {
      if (p === 'avl2RsId0') return 'error';
      if (p === 'avl2RsId1') return 'INV_B';
      return '';
    }));

    const data = await getResearchInventory(fake.ctx, X, Y, CAT);

    expect(data.available).toEqual([{ inventionId: 'INV_B', name: 'INV_B', enabled: false, cost: undefined, parent: undefined, volatile: undefined }]);
  });

  it('tolerates a batch answer shorter than the batch (missing slots stay unset)', async () => {
    const fake = makeInventoryCtx(['1', '0', '0'], () => ['INV_S']);

    const data = await getResearchInventory(fake.ctx, X, Y, CAT);

    // only RsId0 was set; name falls back to the id, enabled false
    expect(data.available).toEqual([{ inventionId: 'INV_S', name: 'INV_S', enabled: false, cost: undefined, parent: undefined, volatile: undefined }]);
  });

  it('carries the active research and marks the one developing item the status text names', async () => {
    const values = new Map<string, string>([
      ['dev2RsId0', 'INV_D'], ['dev2RsName0', 'Delta'],
      ['dev2RsId1', 'INV_E'], ['dev2RsName1', 'Epsilon'],
    ]);
    const fake = makeInventoryCtx(['0', '2', '0'], props => props.map(p => values.get(p) ?? ''));
    (fake.ctx.focusBuilding as jest.Mock).mockResolvedValue({
      buildingId: '40211977', buildingName: 'Research Center', ownerName: 'SPO_test3',
    });
    fake.respond(() => 'res="%12% research completed:-:Researching Epsilon. Cost: $400,000.:-::-:"');

    const data = await getResearchInventory(fake.ctx, X, Y, CAT);

    expect(data.activeResearch).toEqual({ percentComplete: 12, inventionName: 'Epsilon' });
    expect(data.developing.map(i => i.active)).toEqual([undefined, true]);
  });

  it('leaves the three lists exactly as before when the status read fails', async () => {
    // The default fake has no focusBuilding implementation: the status read
    // throws inside the handler, is swallowed, and nothing is marked.
    const fake = makeInventoryCtx(['0', '1', '0'], props => props.map(p => (p === 'dev2RsId0' ? 'INV_D' : '')));

    const data = await getResearchInventory(fake.ctx, X, Y, CAT);

    expect(data.activeResearch).toBeUndefined();
    expect(data.developing).toEqual([{ inventionId: 'INV_D', name: 'INV_D', enabled: undefined, cost: undefined, parent: undefined, volatile: undefined }]);
  });

  it('closes the temp object even when a cache read throws, and rethrows', async () => {
    const fake = makeSessionCtx();
    fake.cacher.createObject.mockResolvedValue(TEMP_OBJ);
    fake.cacher.getPropertyList.mockRejectedValue(new Error('Request timeout: GetPropertyList'));

    await expect(getResearchInventory(fake.ctx, X, Y, CAT)).rejects.toThrow('Request timeout: GetPropertyList');
    expect(fake.cacher.closeObject).toHaveBeenCalledWith(TEMP_OBJ);
  });
});

// ===========================================================================
// getResearchDetails
// ===========================================================================

describe('getResearchDetails', () => {
  /** `null` means "the cache answers no slot at all". */
  function makeDetailsCtx(currBlock: string | null = CURR_BLOCK): FakeSessionCtx {
    const fake = makeSessionCtx();
    fake.cacher.createObject.mockResolvedValue(TEMP_OBJ);
    fake.cacher.getPropertyList.mockResolvedValue(currBlock === null ? [] : [currBlock]);
    return fake;
  }

  it('reads CurrBlock through a temp object it closes afterwards', async () => {
    const fake = makeDetailsCtx();

    await getResearchDetails(fake.ctx, X, Y, 'INV_A');

    expect(fake.ctx.connectConstructionService).toHaveBeenCalled();
    expect(fake.ctx.connectMapService).toHaveBeenCalled();
    expect(fake.cacher.setObject).toHaveBeenCalledWith(TEMP_OBJ, X, Y);
    expect(fake.cacher.getPropertyList).toHaveBeenCalledWith(TEMP_OBJ, ['CurrBlock']);
    expect(fake.cacher.closeObject).toHaveBeenCalledWith(TEMP_OBJ);
  });

  it('targets the CurrBlock the cache returned with RDOGetInvPropsByLang then RDOGetInvDescEx, "^" and lang "0"', async () => {
    const fake = makeDetailsCtx();
    fake.respond((_p, i) => (i === 0 ? 'res="%Props here"' : 'res="%A description"'));

    const details = await getResearchDetails(fake.ctx, X, Y, 'INV_A');

    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[0].socketName).toBe('construction');
    expect(fake.sent[0].category).toBe(TimeoutCategory.NORMAL);
    expect(fake.sent[0].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: CURR_BLOCK,
      action: RdoAction.CALL,
      member: 'RDOGetInvPropsByLang',
      separator: '"^"',
      args: [RdoValue.string('INV_A').format(), RdoValue.string('0').format()],
    });
    expect(fake.sent[1].socketName).toBe('construction');
    expect(fake.sent[1].category).toBe(TimeoutCategory.NORMAL);
    expect(fake.sent[1].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: CURR_BLOCK,
      action: RdoAction.CALL,
      member: 'RDOGetInvDescEx',
      separator: '"^"',
      args: [RdoValue.string('INV_A').format(), RdoValue.string('0').format()],
    });
    expect(details).toEqual({ inventionId: 'INV_A', properties: 'Props here', description: 'A description' });
  });

  it('returns empty strings when both answers are empty payloads', async () => {
    const fake = makeDetailsCtx();
    const details = await getResearchDetails(fake.ctx, X, Y, 'INV_A');
    expect(details).toEqual({ inventionId: 'INV_A', properties: '', description: '' });
  });

  it('passes a bare payload through as the value when it carries no res= property (parsePropertyResponse fallback)', async () => {
    // rdo-helpers.ts parsePropertyResponse: a payload without `res="…"` is
    // returned as-is, minus a type prefix — the documented backward-compat path.
    const fake = makeDetailsCtx();
    fake.respond((_p, i) => (i === 0 ? '%bare props' : 'bare desc'));
    const details = await getResearchDetails(fake.ctx, X, Y, 'INV_A');
    expect(details.properties).toBe('bare props');
    expect(details.description).toBe('bare desc');
  });

  it('refuses when the construction service has no worldId, before touching the cache', async () => {
    const fake = makeSessionCtx({ worldId: null });
    await expect(getResearchDetails(fake.ctx, X, Y, 'INV_A')).rejects.toThrow('Construction service not initialized - worldId is null');
    expect(fake.cacher.createObject).not.toHaveBeenCalled();
    expect(fake.sent).toHaveLength(0);
  });

  it('throws, closes the temp object and sends nothing when CurrBlock is empty', async () => {
    const fake = makeDetailsCtx('');
    await expect(getResearchDetails(fake.ctx, X, Y, 'INV_A')).rejects.toThrow(`No CurrBlock for building at (${X}, ${Y})`);
    expect(fake.cacher.closeObject).toHaveBeenCalledWith(TEMP_OBJ);
    expect(fake.sent).toHaveLength(0);
  });

  it('throws the same way when the cache answers no slot at all', async () => {
    const fake = makeDetailsCtx(null);
    await expect(getResearchDetails(fake.ctx, X, Y, 'INV_A')).rejects.toThrow('No CurrBlock');
    expect(fake.sent).toHaveLength(0);
  });

  it('propagates a timeout on the first RDO call and does not issue the second', async () => {
    const fake = makeDetailsCtx();
    fake.respond(() => new Error('Request timeout: RDOGetInvPropsByLang'));
    await expect(getResearchDetails(fake.ctx, X, Y, 'INV_A')).rejects.toThrow('Request timeout: RDOGetInvPropsByLang');
    expect(fake.sent).toHaveLength(1);
  });
});
