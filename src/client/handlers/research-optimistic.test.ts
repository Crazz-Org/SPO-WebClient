/**
 * Tests for the #888 optimistic mark/rollback around queueResearchDirect /
 * cancelResearchDirect — the block must paint before the write round-trip finishes,
 * and roll back cleanly when the write does not land.
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

function resetStore(): void {
  useBuildingStore.setState({ research: null });
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function makeCtx(sendRequest: jest.Mock): ClientHandlerContext {
  return {
    inFlightSetProperty: new Map(),
    sendRequest,
    sendMessage: jest.fn(),
    showNotification: jest.fn(),
  } as unknown as ClientHandlerContext;
}

describe('queueResearchDirect — optimistic mark', () => {
  beforeEach(resetStore);

  it('records a queue entry before the request settles', async () => {
    const { promise, resolve } = deferred<{ success: boolean }>();
    const ctx = makeCtx(jest.fn().mockReturnValue(promise));

    const call = queueResearchDirect(ctx, 10, 20, 'A1');

    expect(useBuildingStore.getState().research?.pendingOps.get('A1')?.op).toBe('queue');

    resolve({ success: true });
    await call;
  });

  it('clears the entry and notifies an error when the response says success: false', async () => {
    const ctx = makeCtx(jest.fn().mockResolvedValue({ success: false }));

    await queueResearchDirect(ctx, 10, 20, 'A1');

    expect(useBuildingStore.getState().research?.pendingOps.has('A1')).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith('Research could not be queued', 'error');
  });

  it('clears the entry when the write rejects (setBuildingProperty swallows the throw and resolves false)', async () => {
    const ctx = makeCtx(jest.fn().mockRejectedValue(new Error('network down')));

    await queueResearchDirect(ctx, 10, 20, 'A1');

    expect(useBuildingStore.getState().research?.pendingOps.has('A1')).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith('Research could not be queued', 'error');
  });

  it('leaves the entry in place on success, for setResearchInventory to settle', async () => {
    const ctx = makeCtx(jest.fn().mockResolvedValue({ success: true }));

    await queueResearchDirect(ctx, 10, 20, 'A1');

    expect(useBuildingStore.getState().research?.pendingOps.get('A1')?.op).toBe('queue');
  });
});

describe('cancelResearchDirect — optimistic mark', () => {
  beforeEach(resetStore);

  it('records a cancel entry before the request settles', async () => {
    const { promise, resolve } = deferred<{ success: boolean }>();
    const ctx = makeCtx(jest.fn().mockReturnValue(promise));

    const call = cancelResearchDirect(ctx, 10, 20, 'D1');

    expect(useBuildingStore.getState().research?.pendingOps.get('D1')?.op).toBe('cancel');

    resolve({ success: true });
    await call;
  });

  it('clears the entry and notifies an error when the response says success: false', async () => {
    const ctx = makeCtx(jest.fn().mockResolvedValue({ success: false }));

    await cancelResearchDirect(ctx, 10, 20, 'D1');

    expect(useBuildingStore.getState().research?.pendingOps.has('D1')).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith('Research could not be cancelled', 'error');
  });
});
