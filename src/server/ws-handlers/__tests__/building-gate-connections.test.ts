/**
 * REQ_BUILDING_GATE_CONNECTIONS — the click-time half of the Supplies/Products
 * tabs, at the WebSocket frontier.
 *
 * REQ_BUILDING_TAB_DATA answers with the gates and their headers and NO
 * connection rows; this message asks for the rows of one gate. The frontier's
 * job is narrow — pass the gate identity through unchanged, echo it back so the
 * client can route a late reply, and turn a failure into an error frame rather
 * than a hung request.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { handleBuildingGateConnections } from '../building-handlers';
import type { WsHandlerContext } from '../types';

interface Recorded {
  ctx: WsHandlerContext;
  sent: Array<Record<string, unknown>>;
  getBuildingGateConnections: jest.Mock;
}

function createCtx(result: unknown = {}): Recorded {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send(payload: string): void {
      sent.push(JSON.parse(payload) as Record<string, unknown>);
    },
  } as unknown as WebSocket;

  const getBuildingGateConnections = jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });

  const ctx = { ws, session: { getBuildingGateConnections } } as unknown as WsHandlerContext;
  return { ctx, sent, getBuildingGateConnections };
}

const request = (over: Partial<Record<string, unknown>> = {}): WsMessage => ({
  type: WsMessageType.REQ_BUILDING_GATE_CONNECTIONS,
  wsRequestId: 'req-1',
  x: 924,
  y: 820,
  tabId: 'supplies',
  path: 'Seg0',
  name: 'Books',
  visualClass: '9013',
  ...over,
}) as unknown as WsMessage;

const SUPPLY = {
  path: 'Seg0', name: 'Books', metaFluid: 'Books', fluidValue: '1200',
  connectionCount: 1, connections: [{
    facilityName: 'Farm A', companyName: 'Yellow Inc.', createdBy: 'SPO_test3',
    price: '100', overprice: '10', lastValue: '900', cost: '$12', quality: '95%',
    connected: true, x: 40, y: 50,
  }],
};

describe('handleBuildingGateConnections', () => {
  it('headerOnly: passes the flag to the session and echoes it (#1347)', async () => {
    const r = createCtx({ supply: { ...SUPPLY, connections: [] } });

    await handleBuildingGateConnections(r.ctx, request({ headerOnly: true }));

    expect(r.getBuildingGateConnections).toHaveBeenCalledWith(924, 820, 'supplies', 'Seg0', 'Books', '9013', true);
    expect(r.sent[0].headerOnly).toBe(true);
  });

  it('no headerOnly echo when the request did not set it', async () => {
    const r = createCtx({ supply: SUPPLY });

    await handleBuildingGateConnections(r.ctx, request());

    expect('headerOnly' in r.sent[0]).toBe(false);
  });

  it('headerOnly: false is not echoed and not forwarded', async () => {
    const r = createCtx({ supply: SUPPLY });

    await handleBuildingGateConnections(r.ctx, request({ headerOnly: false }));

    expect(r.getBuildingGateConnections).toHaveBeenCalledWith(924, 820, 'supplies', 'Seg0', 'Books', '9013');
    expect('headerOnly' in r.sent[0]).toBe(false);
  });

  it('passes the gate identity to the session unchanged', async () => {
    const r = createCtx({ supply: SUPPLY });

    await handleBuildingGateConnections(r.ctx, request());

    expect(r.getBuildingGateConnections).toHaveBeenCalledWith(924, 820, 'supplies', 'Seg0', 'Books', '9013');
  });

  it('echoes the coordinates, the tab and the path back with the rows', async () => {
    // The client merges on this identity: a reply for a gate of a building the
    // user has left, or for a gate the tab no longer lists, has to be
    // recognisable as such rather than land on whatever is on screen.
    const r = createCtx({ supply: SUPPLY });

    await handleBuildingGateConnections(r.ctx, request());

    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toEqual({
      type: WsMessageType.RESP_BUILDING_GATE_CONNECTIONS,
      wsRequestId: 'req-1',
      x: 924,
      y: 820,
      tabId: 'supplies',
      path: 'Seg0',
      supply: SUPPLY,
    });
  });

  it('carries a product gate in the product half of the reply', async () => {
    const product = {
      path: 'Gate0', name: 'Cars', metaFluid: 'Cars', lastFluid: '80', quality: '90%',
      pricePc: '110', avgPrice: '$4', marketPrice: '$5', connectionCount: 0, connections: [],
    };
    const r = createCtx({ product });

    await handleBuildingGateConnections(r.ctx, request({ tabId: 'products', path: 'Gate0', name: 'Cars' }));

    expect(r.sent[0].product).toEqual(product);
    expect(r.sent[0].supply).toBeUndefined();
  });

  it('answers with neither half when the gate could not be reached', async () => {
    // `getBuildingGateConnections` returns {} when SetPath is refused. The
    // client reads that as a failed read, not as a gate with no connections.
    const r = createCtx({});

    await handleBuildingGateConnections(r.ctx, request());

    expect(r.sent[0].supply).toBeUndefined();
    expect(r.sent[0].product).toBeUndefined();
    expect(r.sent[0].type).toBe(WsMessageType.RESP_BUILDING_GATE_CONNECTIONS);
  });

  it('turns a session failure into an error frame instead of a hung request', async () => {
    const r = createCtx(new Error('Request timeout: SetPath'));

    await handleBuildingGateConnections(r.ctx, request());

    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].type).toBe(WsMessageType.RESP_ERROR);
    expect(r.sent[0].wsRequestId).toBe('req-1');
  });
});
