/**
 * The optimistic marks behind the research-queue block (#888).
 *
 * The block paints the move at the click, so the mark has to be in the store BEFORE
 * `setBuildingProperty` resolves — and it has to come back out when the write fails.
 * `setBuildingProperty` never throws (its own catch returns `false`), so the rollback
 * that matters is the `false` branch, not the `catch`.
 */

import { queueResearchDirect, cancelResearchDirect } from './building-action-handler';
import { useBuildingStore } from '../store/building-store';
import type { ClientHandlerContext } from './client-context';
import type { WsMessage } from '../../shared/types';

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    setPendingUpdate: jest.fn(),
    confirmPendingUpdate: jest.fn(),
    failPendingUpdate: jest.fn(),
  },
}));

jest.mock('../components/common/Toast', () => ({
  showToast: jest.fn(() => 'toast-id'),
  dismissToast: jest.fn(),
}));

interface TestCtx {
  ctx: ClientHandlerContext;
  settle: (response: { success: boolean; confirmed?: boolean }) => void;
  showNotification: jest.Mock;
  sendMessage: jest.Mock;
}

/**
 * A ctx whose `sendRequest` hangs until `settle` is called — the only way to observe
 * the store between the click and the response. `inFlightSetProperty` is mandatory:
 * `setBuildingProperty` dereferences it on its first line.
 */
function makeDeferredCtx(): TestCtx {
  let resolve!: (value: WsMessage) => void;
  const showNotification = jest.fn();
  const sendMessage = jest.fn();
  const ctx = {
    inFlightSetProperty: new Map<string, Promise<boolean>>(),
    sendRequest: jest.fn(() => new Promise<WsMessage>((r) => { resolve = r; })),
    sendMessage,
    showNotification,
  } as unknown as ClientHandlerContext;

  return {
    ctx,
    settle: (response) => resolve(response as unknown as WsMessage),
    showNotification,
    sendMessage,
  };
}

function pendingOp(inventionId: string): string | undefined {
  return useBuildingStore.getState().research?.pendingOps.get(inventionId)?.op;
}

describe('research optimistic marks', () => {
  beforeEach(() => {
    useBuildingStore.setState({ research: null });
    jest.clearAllMocks();
  });

  it("queueResearchDirect records a 'queue' mark before the write settles", async () => {
    const { ctx, settle } = makeDeferredCtx();

    const done = queueResearchDirect(ctx, 10, 20, 'A1');
    expect(pendingOp('A1')).toBe('queue');

    settle({ success: true });
    await done;
  });

  it('a successful queue leaves the mark for the inventory read to settle', async () => {
    const { ctx, settle, showNotification, sendMessage } = makeDeferredCtx();

    const done = queueResearchDirect(ctx, 10, 20, 'A1');
    settle({ success: true });
    await done;

    expect(pendingOp('A1')).toBe('queue');
    expect(showNotification).toHaveBeenCalledWith('Research queued', 'success');
    expect(sendMessage).toHaveBeenCalled();
  });

  it('a refused queue rolls the mark back and says so', async () => {
    const { ctx, settle, showNotification, sendMessage } = makeDeferredCtx();

    const done = queueResearchDirect(ctx, 10, 20, 'A1');
    settle({ success: false });
    await done;

    expect(pendingOp('A1')).toBeUndefined();
    expect(showNotification).toHaveBeenCalledWith('Research could not be queued', 'error');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("cancelResearchDirect records a 'cancel' mark before the write settles", async () => {
    const { ctx, settle } = makeDeferredCtx();

    const done = cancelResearchDirect(ctx, 10, 20, 'D1');
    expect(pendingOp('D1')).toBe('cancel');

    settle({ success: true });
    await done;
  });

  it('a successful cancel leaves the mark and notifies success', async () => {
    const { ctx, settle, showNotification } = makeDeferredCtx();

    const done = cancelResearchDirect(ctx, 10, 20, 'D1');
    settle({ success: true });
    await done;

    expect(pendingOp('D1')).toBe('cancel');
    expect(showNotification).toHaveBeenCalledWith('Research cancelled', 'success');
  });

  it('a refused cancel rolls the mark back and says so', async () => {
    const { ctx, settle, showNotification } = makeDeferredCtx();

    const done = cancelResearchDirect(ctx, 10, 20, 'D1');
    settle({ success: false });
    await done;

    expect(pendingOp('D1')).toBeUndefined();
    expect(showNotification).toHaveBeenCalledWith('Research could not be cancelled', 'error');
  });

  it('a throwing write rolls the queue mark back', async () => {
    const ctx = {
      inFlightSetProperty: {
        get: () => { throw new Error('boom'); },
      },
      sendRequest: jest.fn(),
      sendMessage: jest.fn(),
      showNotification: jest.fn(),
    } as unknown as ClientHandlerContext;

    await queueResearchDirect(ctx, 10, 20, 'A1');

    expect(pendingOp('A1')).toBeUndefined();
    expect(ctx.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('Failed to queue research'), 'error',
    );
  });

  it('a throwing write rolls the cancel mark back', async () => {
    const ctx = {
      inFlightSetProperty: {
        get: () => { throw new Error('boom'); },
      },
      sendRequest: jest.fn(),
      sendMessage: jest.fn(),
      showNotification: jest.fn(),
    } as unknown as ClientHandlerContext;

    await cancelResearchDirect(ctx, 10, 20, 'D1');

    expect(pendingOp('D1')).toBeUndefined();
    expect(ctx.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('Failed to cancel research'), 'error',
    );
  });
});
