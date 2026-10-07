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
import { handleResearchInventory, handleNearCircuits, validateNearCircuitsTiles, MAX_NEAR_CIRCUITS_TILES, handleFacilityStatusBatch, validateFacilityStatusIds, MAX_FACILITY_STATUS_BATCH_IDS } from './misc-handlers';
import type { WsHandlerContext } from './types';
import type { DatInvention, DatInventionIndex } from '../../shared/research-dat-parser';
import {
  WsMessageType,
  type WsMessage,
  type ResearchCategoryData,
  type WsRespResearchInventory,
  type WsRespNearCircuits,
  type WsRespFacilityStatusBatch,
  type WsRespError,
} from '../../shared/types';
import * as ErrorCodes from '../../shared/error-codes';

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

// =============================================================================
// REQ_NEAR_CIRCUITS — raw NearCircuits per tile, validated before any RDO frame
// =============================================================================

describe('validateNearCircuitsTiles', () => {
  it('accepts 1..MAX tiles of non-negative integer x, y and copies only x, y', () => {
    expect(validateNearCircuitsTiles([{ x: 0, y: 5, extra: 1 }])).toEqual({ tiles: [{ x: 0, y: 5 }] });
    const max = Array.from({ length: MAX_NEAR_CIRCUITS_TILES }, (_, i) => ({ x: i, y: i }));
    expect(validateNearCircuitsTiles(max)).toEqual({ tiles: max });
  });

  it.each([
    ['not an array', 'x'],
    ['missing', undefined],
    ['empty', []],
    ['a null tile', [null]],
    ['a string tile', ['1,2']],
    ['a fractional coordinate', [{ x: 1.5, y: 2 }]],
    ['a negative coordinate', [{ x: -1, y: 2 }]],
    ['a string coordinate', [{ x: '1', y: 2 }]],
    ['a missing y', [{ x: 1 }]],
    ['an infinite x', [{ x: Infinity, y: 2 }]],
  ])('refuses %s', (_label, raw) => {
    expect(validateNearCircuitsTiles(raw)).toHaveProperty('error');
  });

  it('refuses one tile over MAX_NEAR_CIRCUITS_TILES', () => {
    const over = Array.from({ length: MAX_NEAR_CIRCUITS_TILES + 1 }, (_, i) => ({ x: i, y: i }));
    expect(validateNearCircuitsTiles(over)).toEqual({ error: `at most ${MAX_NEAR_CIRCUITS_TILES} tiles per request` });
  });
});

describe('handleNearCircuits', () => {
  function makeNcCtx(read: jest.Mock) {
    const sent: WsMessage[] = [];
    const ws = { send: jest.fn((payload: string) => sent.push(JSON.parse(payload) as WsMessage)) } as unknown as WebSocket;
    const ctx = { ws, session: { readNearCircuitsAt: read } } as unknown as WsHandlerContext;
    return { ctx, sent };
  }

  it('answers one RESP_NEAR_CIRCUITS frame with the session\'s tiles, under the request id', async () => {
    const tiles = [{ x: 1, y: 2, circuits: '17,' }, { x: 3, y: 4, circuits: null }];
    const read = jest.fn().mockResolvedValue(tiles);
    const { ctx, sent } = makeNcCtx(read);

    await handleNearCircuits(ctx, { type: WsMessageType.REQ_NEAR_CIRCUITS, wsRequestId: 'n1', tiles: [{ x: 1, y: 2 }, { x: 3, y: 4 }] } as unknown as WsMessage);

    expect(read).toHaveBeenCalledWith([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    expect(sent).toHaveLength(1);
    const resp = sent[0] as WsRespNearCircuits;
    expect(resp.type).toBe(WsMessageType.RESP_NEAR_CIRCUITS);
    expect(resp.wsRequestId).toBe('n1');
    expect(resp.tiles).toEqual(tiles);
  });

  it('refuses an invalid body with ERROR_InvalidParameter and reads nothing', async () => {
    const read = jest.fn();
    const { ctx, sent } = makeNcCtx(read);

    await handleNearCircuits(ctx, { type: WsMessageType.REQ_NEAR_CIRCUITS, wsRequestId: 'n2', tiles: [] } as unknown as WsMessage);

    expect(read).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    const err = sent[0] as WsRespError;
    expect(err.type).toBe(WsMessageType.RESP_ERROR);
    expect(err.wsRequestId).toBe('n2');
    expect(err.code).toBe(ErrorCodes.ERROR_InvalidParameter);
  });

  it('turns a session failure into a RESP_ERROR', async () => {
    const read = jest.fn().mockRejectedValue(new Error('boom'));
    const { ctx, sent } = makeNcCtx(read);

    await handleNearCircuits(ctx, { type: WsMessageType.REQ_NEAR_CIRCUITS, wsRequestId: 'n3', tiles: [{ x: 1, y: 1 }] } as unknown as WsMessage);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe(WsMessageType.RESP_ERROR);
    expect(sent[0].wsRequestId).toBe('n3');
  });
});

// =============================================================================
// REQ_FACILITY_STATUS_BATCH — status text per facility id, validated before any RDO frame
// =============================================================================

describe('validateFacilityStatusIds', () => {
  it('accepts 1..MAX non-zero 32-bit ids as numbers or digit strings, normalised to decimal strings', () => {
    expect(validateFacilityStatusIds(['127706280', 202334236, '-5', '007'])).toEqual({ ids: ['127706280', '202334236', '-5', '7'] });
    const max = Array.from({ length: MAX_FACILITY_STATUS_BATCH_IDS }, (_, i) => String(i + 1));
    expect(validateFacilityStatusIds(max)).toEqual({ ids: max });
  });

  it.each([
    ['not an array', 'x'],
    ['missing', undefined],
    ['empty', []],
    ['zero (no facility)', [0]],
    ['"0"', ['0']],
    ['a fractional id', [1.5]],
    ['a non-digit string', ['12a']],
    ['a prefixed string', ['#123']],
    ['an object', [{ id: 1 }]],
    ['null', [null]],
    ['over int32', [2147483648]],
    ['an 11-digit string', ['12345678901']],
    ['NaN', [NaN]],
  ])('refuses %s', (_label, raw) => {
    expect(validateFacilityStatusIds(raw)).toHaveProperty('error');
  });

  it('refuses one id over MAX_FACILITY_STATUS_BATCH_IDS', () => {
    const over = Array.from({ length: MAX_FACILITY_STATUS_BATCH_IDS + 1 }, (_, i) => i + 1);
    expect(validateFacilityStatusIds(over)).toEqual({ error: `at most ${MAX_FACILITY_STATUS_BATCH_IDS} ids per request` });
  });
});

describe('handleFacilityStatusBatch', () => {
  function makeFsCtx(read: jest.Mock) {
    const sent: WsMessage[] = [];
    const ws = { send: jest.fn((payload: string) => sent.push(JSON.parse(payload) as WsMessage)) } as unknown as WebSocket;
    const ctx = { ws, session: { readFacilityStatusBatch: read } } as unknown as WsHandlerContext;
    return { ctx, sent };
  }

  it('answers ONE RESP_FACILITY_STATUS_BATCH frame with every entry, under the request id', async () => {
    const entries = [
      { id: '1', status: 'ok', text: { buildingName: 'A', ownerName: 'B', salesInfo: '', revenue: '$5/h', revenuePerHour: 5, detailsText: '', hintsText: '' } },
      { id: '2', status: 'unknown', error: 'no answer within 10000 ms' },
      { id: '3', status: 'error', error: 'unknown id' },
    ];
    const read = jest.fn().mockResolvedValue(entries);
    const { ctx, sent } = makeFsCtx(read);

    await handleFacilityStatusBatch(ctx, { type: WsMessageType.REQ_FACILITY_STATUS_BATCH, wsRequestId: 'f1', ids: ['1', 2, '3'] } as unknown as WsMessage);

    expect(read).toHaveBeenCalledWith(['1', '2', '3']);
    expect(sent).toHaveLength(1);
    const resp = sent[0] as WsRespFacilityStatusBatch;
    expect(resp.type).toBe(WsMessageType.RESP_FACILITY_STATUS_BATCH);
    expect(resp.wsRequestId).toBe('f1');
    expect(resp.entries).toEqual(entries);
  });

  it('refuses an invalid body with ERROR_InvalidParameter and reads nothing', async () => {
    const read = jest.fn();
    const { ctx, sent } = makeFsCtx(read);

    await handleFacilityStatusBatch(ctx, { type: WsMessageType.REQ_FACILITY_STATUS_BATCH, wsRequestId: 'f2', ids: [0] } as unknown as WsMessage);

    expect(read).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    const err = sent[0] as WsRespError;
    expect(err.type).toBe(WsMessageType.RESP_ERROR);
    expect(err.wsRequestId).toBe('f2');
    expect(err.code).toBe(ErrorCodes.ERROR_InvalidParameter);
  });

  it('turns a session failure into a RESP_ERROR', async () => {
    const read = jest.fn().mockRejectedValue(new Error('boom'));
    const { ctx, sent } = makeFsCtx(read);

    await handleFacilityStatusBatch(ctx, { type: WsMessageType.REQ_FACILITY_STATUS_BATCH, wsRequestId: 'f3', ids: [1] } as unknown as WsMessage);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe(WsMessageType.RESP_ERROR);
    expect(sent[0].wsRequestId).toBe('f3');
  });
});
