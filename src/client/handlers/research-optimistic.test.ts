/**
 * queueResearchDirect / cancelResearchDirect (#888): mark an optimistic
 * `pendingOps` entry before the write goes out, so the "In research queue"
 * block can paint the change immediately, and roll it back when
 * `setBuildingProperty` comes back `false` — it never throws for a rejected
 * write (building-action-handler.ts:481-485), so only the boolean return can
 * tell a real failure from a fire-and-forget success.
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeCtx(sendRequest: jest.Mock): ClientHandlerContext {
  return {
    sendRequest,
    sendMessage: jest.fn(),
    inFlightSetProperty: new Map(),
    showNotification: jest.fn(),
  } as unknown as ClientHandlerContext;
}

describe('queueResearchDirect / cancelResearchDirect — optimistic pendingOps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useBuildingStore.setState({ research: null });
  });

  it('queueResearchDirect records a "queue" entry before the request settles', async () => {
    const { promise, resolve } = deferred<{ success: boolean }>();
    const ctx = makeCtx(jest.fn().mockReturnValue(promise));

    const call = queueResearchDirect(ctx, 10, 20, 'A1');

    expect(useBuildingStore.getState().research?.pendingOps.get('A1')?.op).toBe('queue');

    resolve({ success: true });
    await call;
  });

  it('a { success: false } response clears the entry and notifies an error', async () => {
    const ctx = makeCtx(jest.fn().mockResolvedValue({ success: false }));

    await queueResearchDirect(ctx, 10, 20, 'A1');

    expect(useBuildingStore.getState().research?.pendingOps.has('A1')).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith('Research could not be queued', 'error');
  });

  it('cancelResearchDirect records a "cancel" entry and rolls it back on failure', async () => {
    const ctx = makeCtx(jest.fn().mockResolvedValue({ success: false }));

    const call = cancelResearchDirect(ctx, 10, 20, 'D1');
    // Synchronous mark happens before the awaited request resolves.
    expect(useBuildingStore.getState().research?.pendingOps.get('D1')?.op).toBe('cancel');

    await call;

    expect(useBuildingStore.getState().research?.pendingOps.has('D1')).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith('Research could not be cancelled', 'error');
  });

  it('a resolving write leaves the entry in place for setResearchInventory to settle', async () => {
    const ctx = makeCtx(jest.fn().mockResolvedValue({ success: true, confirmed: true }));

    await queueResearchDirect(ctx, 10, 20, 'A1');

    expect(useBuildingStore.getState().research?.pendingOps.get('A1')?.op).toBe('queue');
    expect(ctx.showNotification).toHaveBeenCalledWith('Research queued', 'success');
  });

  it('a rejected request rolls the entry back and notifies an error', async () => {
    // setBuildingProperty never throws — its own catch turns a rejection into
    // `false` (building-action-handler.ts:481-485) — so this exercises the
    // same `!ok` rollback branch as an explicit `{ success: false }`.
    const ctx = makeCtx(jest.fn().mockRejectedValue(new Error('network down')));

    await queueResearchDirect(ctx, 10, 20, 'A1');

    expect(useBuildingStore.getState().research?.pendingOps.has('A1')).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith('Research could not be queued', 'error');
  });
});
