/**
 * `queueResearchDirect` / `cancelResearchDirect` mark an optimistic pending
 * op before the write goes out and roll it back if the write comes back
 * `false` — the block must not lie about an item the server refused (#888).
 */

import { queueResearchDirect, cancelResearchDirect } from './building-action-handler';
import { useBuildingStore } from '../store/building-store';
import type { ClientHandlerContext } from './client-context';

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    setPendingUpdate: jest.fn(),
    confirmPendingUpdate: jest.fn(),
    failPendingUpdate: jest.fn(),
  },
}));

function makeCtx(sendRequestImpl: (req: unknown) => Promise<unknown>): ClientHandlerContext {
  return {
    inFlightSetProperty: new Map(),
    sendRequest: jest.fn().mockImplementation(sendRequestImpl),
    sendMessage: jest.fn(),
    showNotification: jest.fn(),
  } as unknown as ClientHandlerContext;
}

describe('queueResearchDirect / cancelResearchDirect — optimistic pending (#888)', () => {
  beforeEach(() => {
    useBuildingStore.setState({ research: null });
  });

  it('records a queue entry before the request settles', async () => {
    let resolveReq!: (v: unknown) => void;
    const ctx = makeCtx(() => new Promise((resolve) => { resolveReq = resolve; }));

    const call = queueResearchDirect(ctx, 10, 20, 'A1');

    expect(useBuildingStore.getState().research?.pendingOps.get('A1')?.op).toBe('queue');

    resolveReq({ success: true, confirmed: true, newValue: '0' });
    await call;
  });

  it('a { success: false } response clears the entry and notifies an error', async () => {
    const ctx = makeCtx(async () => ({ success: false }));

    await queueResearchDirect(ctx, 10, 20, 'A1');

    expect(useBuildingStore.getState().research?.pendingOps.has('A1')).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith('Research could not be queued', 'error');
  });

  it('records a cancel entry and rolls it back the same way on failure', async () => {
    const ctx = makeCtx(async () => ({ success: false }));

    await cancelResearchDirect(ctx, 10, 20, 'D1');

    expect(useBuildingStore.getState().research?.pendingOps.has('D1')).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith('Research could not be cancelled', 'error');
  });

  it('cancelResearchDirect records the op as cancel before the write settles', async () => {
    let resolveReq!: (v: unknown) => void;
    const ctx = makeCtx(() => new Promise((resolve) => { resolveReq = resolve; }));

    const call = cancelResearchDirect(ctx, 10, 20, 'D1');

    expect(useBuildingStore.getState().research?.pendingOps.get('D1')?.op).toBe('cancel');

    resolveReq({ success: true, confirmed: true, newValue: '0' });
    await call;
  });

  it('a resolving write leaves the entry in place for setResearchInventory to settle', async () => {
    const ctx = makeCtx(async (req) => {
      const r = req as { type?: string };
      if (r.type === 'REQ_BUILDING_SET_PROPERTY') return { success: true, confirmed: true, newValue: '0' };
      return {};
    });

    await queueResearchDirect(ctx, 10, 20, 'A1');

    expect(useBuildingStore.getState().research?.pendingOps.get('A1')?.op).toBe('queue');
    expect(ctx.showNotification).toHaveBeenCalledWith('Research queued', 'success');
  });
});
