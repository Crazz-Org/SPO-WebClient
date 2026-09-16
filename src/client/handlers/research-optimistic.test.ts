/**
 * Tests for the optimistic overlay around queueResearchDirect / cancelResearchDirect (#888).
 *
 * The block reads `research.pendingOps` and must show the effect of a write before the
 * server read-back agrees with it — these tests pin the mark-before-write / rollback-on-
 * failure contract those two handlers now carry.
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

function makeCtx(sendRequestImpl: () => Promise<unknown>): ClientHandlerContext {
  return {
    inFlightSetProperty: new Map(),
    sendRequest: jest.fn().mockImplementation(sendRequestImpl),
    sendMessage: jest.fn(),
    showNotification: jest.fn(),
  } as unknown as ClientHandlerContext;
}

describe('queueResearchDirect / cancelResearchDirect — optimistic overlay (#888)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useBuildingStore.setState({ research: null });
  });

  it('records a "queue" entry before the request settles', async () => {
    let resolveRequest!: (v: unknown) => void;
    const ctx = makeCtx(() => new Promise((resolve) => { resolveRequest = resolve; }));

    const promise = queueResearchDirect(ctx, 10, 20, 'AI.Level1');

    // The mark happens synchronously, before the awaited request resolves.
    expect(useBuildingStore.getState().research?.pendingOps.get('AI.Level1')?.op).toBe('queue');

    resolveRequest({ success: true });
    await promise;
  });

  it('a { success: false } response clears the entry and notifies an error', async () => {
    const ctx = makeCtx(async () => ({ success: false }));

    await queueResearchDirect(ctx, 10, 20, 'AI.Level1');

    expect(useBuildingStore.getState().research?.pendingOps.has('AI.Level1')).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith('Research could not be queued', 'error');
  });

  it('cancelResearchDirect records a "cancel" entry and rolls it back the same way', async () => {
    const ctx = makeCtx(async () => ({ success: false }));

    await cancelResearchDirect(ctx, 10, 20, 'AI.Level1');

    expect(useBuildingStore.getState().research?.pendingOps.has('AI.Level1')).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith('Research could not be cancelled', 'error');
  });

  it('a resolving write leaves the entry in place for setResearchInventory to settle', async () => {
    const ctx = makeCtx(async () => ({ success: true }));

    await queueResearchDirect(ctx, 10, 20, 'AI.Level1');

    expect(useBuildingStore.getState().research?.pendingOps.get('AI.Level1')?.op).toBe('queue');
    expect(ctx.showNotification).toHaveBeenCalledWith('Research queued', 'success');
  });

  it('cancelResearchDirect on success leaves the entry in place and notifies success', async () => {
    const ctx = makeCtx(async () => ({ success: true }));

    await cancelResearchDirect(ctx, 10, 20, 'AI.Level1');

    expect(useBuildingStore.getState().research?.pendingOps.get('AI.Level1')?.op).toBe('cancel');
    expect(ctx.showNotification).toHaveBeenCalledWith('Research cancelled', 'success');
  });

  it('a rejected request is swallowed by setBuildingProperty as ok=false, rolling back the mark', async () => {
    // setBuildingProperty's own try/catch never rethrows (building-action-handler.ts:481-485),
    // so a thrown sendRequest surfaces here as the ok===false branch, not the outer catch.
    const ctx = makeCtx(async () => { throw new Error('socket closed'); });

    await queueResearchDirect(ctx, 10, 20, 'AI.Level1');

    expect(useBuildingStore.getState().research?.pendingOps.has('AI.Level1')).toBe(false);
    expect(ctx.showNotification).toHaveBeenCalledWith('Research could not be queued', 'error');
  });
});
