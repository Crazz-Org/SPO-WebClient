/**
 * misc-handlers — the research inventory route.
 *
 * What is worth pinning here is the ORDER of the two steps this handler owns:
 * the `.dat` catalogue fills the display names in first, and only then is the
 * active invention marked. The object cache writes `dev{cat}RsName{i}` only for
 * a volatile invention (`Inventions/Inventions.pas:756-759`), so for the whole
 * standard research tree the item still carries its id in `name` when the
 * session layer hands it over — marking before the enrichment would never match.
 */

import type { WebSocket } from 'ws';
import { handleResearchInventory } from './misc-handlers';
import type { WsHandlerContext } from './types';
import type { DatInvention, DatInventionIndex } from '../../shared/research-dat-parser';
import {
  WsMessageType,
  type WsMessage,
  type ResearchCategoryData,
  type WsRespResearchInventory,
} from '../../shared/types';

const X = 118;
const Y = 226;
const CAT = 2;

function datInvention(id: string, name: string, parent = 'Farms'): DatInvention {
  return { id, name, category: 'Industry', description: '', parent, cached: true, properties: [], requires: [] };
}

/** Only `byId` is read by the handler; the other maps stay empty on purpose. */
function makeIndex(inventions: DatInvention[]): DatInventionIndex {
  return {
    byId: new Map(inventions.map(inv => [inv.id, inv])),
    byCategory: new Map(),
    byCategoryAndParent: new Map(),
    categoryTabs: [],
    tabToCategories: new Map(),
  };
}

function makeCtx(data: ResearchCategoryData, inventionIndex: DatInventionIndex | null) {
  const sent: WsMessage[] = [];
  const ws = {
    send: jest.fn((payload: string) => sent.push(JSON.parse(payload) as WsMessage)),
  } as unknown as WebSocket;
  const getResearchInventory = jest.fn().mockResolvedValue(data);
  const ctx = { ws, session: { getResearchInventory }, inventionIndex } as unknown as WsHandlerContext;
  return { ctx, sent, getResearchInventory };
}

const REQUEST = {
  type: WsMessageType.REQ_RESEARCH_INVENTORY,
  wsRequestId: 'r1',
  buildingX: X,
  buildingY: Y,
  categoryIndex: CAT,
} as unknown as WsMessage;

function answer(sent: WsMessage[]): ResearchCategoryData {
  return (sent[0] as WsRespResearchInventory).data;
}

describe('handleResearchInventory', () => {
  it('marks the developing item the status text names, by the display name the .dat catalogue just supplied', async () => {
    const { ctx, sent, getResearchInventory } = makeCtx(
      {
        categoryIndex: CAT,
        available: [],
        // Non-volatile: the cache gave no name, so `name` is still the id.
        developing: [
          { inventionId: 'Silos', name: 'Silos' },
          { inventionId: 'AdvFarm', name: 'AdvFarm' },
        ],
        completed: [],
        activeResearch: { percentComplete: 41, inventionName: 'Advanced Farming' },
      },
      makeIndex([datInvention('AdvFarm', 'Advanced Farming'), datInvention('Silos', 'Grain Silos')]),
    );

    await handleResearchInventory(ctx, REQUEST);

    expect(getResearchInventory).toHaveBeenCalledWith(X, Y, CAT);
    const data = answer(sent);
    expect(data.developing.map(i => i.name)).toEqual(['Grain Silos', 'Advanced Farming']);
    expect(data.developing.map(i => i.active)).toEqual([undefined, true]);
    expect(data.activeResearch).toEqual({ percentComplete: 41, inventionName: 'Advanced Farming' });
  });

  it('marks a volatile item whose name came from the cache and is left alone by the enrichment', async () => {
    const { ctx, sent } = makeCtx(
      {
        categoryIndex: CAT,
        available: [],
        developing: [{ inventionId: 'VOL_1', name: '  Green Tech  ', volatile: true }],
        completed: [],
        activeResearch: { inventionName: 'green tech' },
      },
      makeIndex([]),
    );

    await handleResearchInventory(ctx, REQUEST);

    expect(answer(sent).developing[0].active).toBe(true);
  });

  it('marks nothing when the named invention is not in this category tab', async () => {
    const { ctx, sent } = makeCtx(
      {
        categoryIndex: CAT,
        available: [],
        developing: [{ inventionId: 'Silos', name: 'Silos' }],
        completed: [],
        activeResearch: { percentComplete: 41, inventionName: 'Advanced Farming' },
      },
      makeIndex([datInvention('Silos', 'Grain Silos')]),
    );

    await handleResearchInventory(ctx, REQUEST);

    const data = answer(sent);
    expect(data.developing[0].active).toBeUndefined();
    // the name still reaches the client, so nothing is lost
    expect(data.activeResearch?.inventionName).toBe('Advanced Farming');
  });

  it('marks nothing and still answers when there is no active research', async () => {
    const { ctx, sent } = makeCtx(
      {
        categoryIndex: CAT,
        available: [{ inventionId: 'AdvFarm', name: 'AdvFarm' }],
        developing: [{ inventionId: 'Silos', name: 'Silos' }],
        completed: [],
      },
      makeIndex([datInvention('AdvFarm', 'Advanced Farming'), datInvention('Silos', 'Grain Silos')]),
    );

    await handleResearchInventory(ctx, REQUEST);

    const data = answer(sent);
    expect(data.activeResearch).toBeUndefined();
    expect(data.developing[0].active).toBeUndefined();
    // the enrichment still ran
    expect(data.available[0].name).toBe('Advanced Farming');
  });

  it('with no .dat index loaded leaves the ids in place and marks nothing', async () => {
    const { ctx, sent } = makeCtx(
      {
        categoryIndex: CAT,
        available: [],
        developing: [{ inventionId: 'AdvFarm', name: 'AdvFarm' }],
        completed: [],
        activeResearch: { inventionName: 'Advanced Farming' },
      },
      null,
    );

    await handleResearchInventory(ctx, REQUEST);

    const data = answer(sent);
    expect(data.developing[0].name).toBe('AdvFarm');
    expect(data.developing[0].active).toBeUndefined();
  });
});
