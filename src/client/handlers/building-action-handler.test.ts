/**
 * Tests for building-action-handler — the refresh that follows a connection change.
 *
 * `requestBuildingRefreshProperties` cannot show a connection that was just made
 * or dropped: it returns every lazy tab as `undefined`
 * (building-details-handler.ts:575-579) and the store carries the previous
 * values forward (building-store.ts:213-216). These tests pin the invalidation
 * that makes the lists re-read, and the ordering it depends on.
 */

import { refreshAfterConnectionChange, handleBuildingAction } from './building-action-handler';
import { useBuildingStore } from '../store/building-store';
import { useUiStore } from '../store/ui-store';
import { ClientBridge } from '../bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';
import type { BuildingDetailsResponse } from '../../shared/types';

/* ── Mocks ──────────────────────────────────────────────────────────── */

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    // Reproduces the ONE thing about the real bridge the ordering depends on:
    // it carries the lazy fields forward BEFORE handing the result to setDetails
    // (client-bridge.ts:486-489, then :492), and setDetails computes `preloaded`
    // from the object it is given (building-store.ts:198-200). That is the round
    // trip that re-marks a tab 'loaded' and would undo an early invalidation.
    //
    // Mocking this as a bare `setDetails(details)` makes the ordering test
    // vacuous: the raw refresh response carries no `supplies` key, `preloaded`
    // stays empty, and the assertion holds whichever order the handler used.
    updateBuildingDetails: jest.fn((details: BuildingDetailsResponse) => {
      const current = useBuildingStore.getState().details;
      useBuildingStore.getState().setDetails({
        ...details,
        supplies: details.supplies ?? current?.supplies,
        products: details.products ?? current?.products,
        compInputs: details.compInputs ?? current?.compInputs,
        warehouseWares: details.warehouseWares ?? current?.warehouseWares,
      });
    }),
    // The optimistic-feedback trio the SET path drives on its way through.
    setPendingUpdate: jest.fn(),
    confirmPendingUpdate: jest.fn(),
    failPendingUpdate: jest.fn(),
  },
}));

jest.mock('../components/common/Toast', () => ({
  showToast: jest.fn(() => 'toast-id'),
  dismissToast: jest.fn(),
}));

const makeDetails = (x: number, y: number): BuildingDetailsResponse => ({
  buildingId: `bld-${x}-${y}`,
  x,
  y,
  visualClass: '1234',
  templateName: 'Warehouse',
  buildingName: 'Warehouse',
  ownerName: 'TestCorp',
  securityId: 'sec-1',
  canGovern: true,
  tabs: [],
  groups: {},
  timestamp: Date.now(),
});

const mockSupplies = [{ metaFluid: 'steel', name: 'Steel', connectionCount: 1, connections: [] }];
const mockProducts = [{
  metaFluid: 'oil', name: 'Oil', quality: '80', pricePc: '100',
  avgPrice: '50', marketPrice: '60', lastFluid: '', connectionCount: 1, connections: [],
}];

function makeCtx(refreshed: BuildingDetailsResponse | null = makeDetails(10, 20)): ClientHandlerContext {
  return {
    currentFocusedVisualClass: '1234',
    sendRequest: jest.fn().mockImplementation(async () => {
      if (refreshed === null) throw new Error('refresh failed');
      return { details: refreshed };
    }),
    showNotification: jest.fn(),
  } as unknown as ClientHandlerContext;
}

/** Put the store in the state a loaded supplies+products panel leaves behind. */
function seedLoadedPanel(): void {
  useBuildingStore.getState().setDetails(makeDetails(10, 20));
  useBuildingStore.getState().mergeTabData(
    'supplies', { supplies: mockSupplies as never }, 10, 20,
  );
  useBuildingStore.getState().mergeTabData(
    'products', { products: mockProducts as never }, 10, 20,
  );
}

describe('refreshAfterConnectionChange', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useBuildingStore.getState().clearDetails();
  });

  it('clears the load state of both connection lists', async () => {
    seedLoadedPanel();
    expect(useBuildingStore.getState().tabLoadingStates['supplies']).toBe('loaded');
    expect(useBuildingStore.getState().tabLoadingStates['products']).toBe('loaded');

    await refreshAfterConnectionChange(makeCtx(), 10, 20);

    expect(useBuildingStore.getState().tabLoadingStates['supplies']).toBeUndefined();
    expect(useBuildingStore.getState().tabLoadingStates['products']).toBeUndefined();
  });

  it('invalidates AFTER updateBuildingDetails, or setDetails puts the tabs straight back to loaded', async () => {
    // The whole defect in one assertion. setDetails re-marks a lazy tab 'loaded'
    // whenever the carried-forward data is non-empty, so invalidating before the
    // refresh lands is silently undone and the stale list never re-reads.
    seedLoadedPanel();

    await refreshAfterConnectionChange(makeCtx(), 10, 20);

    expect(ClientBridge.updateBuildingDetails).toHaveBeenCalledTimes(1);
    expect(useBuildingStore.getState().tabLoadingStates['supplies']).toBeUndefined();
  });

  it('leaves the current rows on screen so the panel does not flash empty', async () => {
    seedLoadedPanel();

    await refreshAfterConnectionChange(makeCtx(), 10, 20);

    expect(useBuildingStore.getState().details!.supplies).toBe(mockSupplies);
    expect(useBuildingStore.getState().details!.products).toBe(mockProducts);
  });

  it('does not touch lazy tabs that carry no connection list', async () => {
    seedLoadedPanel();
    useBuildingStore.getState().mergeTabData(
      'compInputs', { compInputs: [{ name: 'x' }] as never }, 10, 20,
    );

    await refreshAfterConnectionChange(makeCtx(), 10, 20);

    expect(useBuildingStore.getState().tabLoadingStates['compInputs']).toBe('loaded');
  });

  it('still invalidates when the refresh request fails', async () => {
    // A failed refresh is the case where a re-read matters most: the lists are
    // known to be stale and nothing else will clear them.
    seedLoadedPanel();

    await refreshAfterConnectionChange(makeCtx(null), 10, 20);

    expect(ClientBridge.updateBuildingDetails).not.toHaveBeenCalled();
    expect(useBuildingStore.getState().tabLoadingStates['supplies']).toBeUndefined();
  });

  it('falls back to visual class 0 when none is focused', async () => {
    seedLoadedPanel();
    const ctx = makeCtx();
    (ctx as { currentFocusedVisualClass: string | null }).currentFocusedVisualClass = null;

    await refreshAfterConnectionChange(ctx, 10, 20);

    expect(ctx.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({ x: 10, y: 20, visualClass: '0' }),
    );
  });
});

describe('Quick Trade buttons', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useBuildingStore.getState().clearDetails();
  });

  /**
   * `handleBuildingAction` is fire-and-forget, and the trade actions await a
   * SET plus a refresh. Draining the microtask queue is enough — nothing here
   * uses a timer.
   */
  const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

  function makeTradeCtx(setSucceeds: boolean) {
    const details = makeDetails(10, 20);
    const ctx = {
      currentFocusedVisualClass: '1234',
      inFlightSetProperty: new Map(),
      showNotification: jest.fn(),
      sendRequest: jest.fn().mockImplementation(async (req: { type: string }) => {
        if (req.type === 'REQ_BUILDING_SET_PROPERTY') {
          return { success: setSucceeds, newValue: '', confirmed: undefined };
        }
        return { details };
      }),
    } as unknown as ClientHandlerContext;
    return { ctx, details };
  }

  it.each([
    ['tradeConnect:1', 'warehouses'],
    ['tradeConnect:2', 'factories'],
    ['tradeConnect:4', 'stores'],
  ])('%s reports only that the request went out', async (actionId, label) => {
    // Not "Connected all your X": the server connects the facilities that match
    // and connecting none is a normal outcome (Kernel/Kernel.pas:4537-4554).
    // Nothing on the wire reports the count, so the toast must not imply one.
    const { ctx, details } = makeTradeCtx(true);
    seedLoadedPanel();

    handleBuildingAction(ctx, actionId, details);
    await drain();

    expect(ctx.showNotification).toHaveBeenCalledWith(
      `Sent connect request for your ${label}`, 'success',
    );
  });

  it('tradeDisconnect reports only that the request went out', async () => {
    const { ctx, details } = makeTradeCtx(true);
    seedLoadedPanel();

    handleBuildingAction(ctx, 'tradeDisconnect:1', details);
    await drain();

    expect(ctx.showNotification).toHaveBeenCalledWith(
      'Sent disconnect request for your warehouses', 'success',
    );
  });

  it('re-reads the connection lists after a successful connect', async () => {
    // Without this the refresh carries the old lists forward and the button
    // looks dead even when the server did the work.
    const { ctx, details } = makeTradeCtx(true);
    seedLoadedPanel();

    handleBuildingAction(ctx, 'tradeConnect:1', details);
    await drain();

    expect(useBuildingStore.getState().tabLoadingStates['supplies']).toBeUndefined();
    expect(useBuildingStore.getState().tabLoadingStates['products']).toBeUndefined();
  });

  it('does not refresh, and says so, when the SET failed', async () => {
    const { ctx, details } = makeTradeCtx(false);
    seedLoadedPanel();

    handleBuildingAction(ctx, 'tradeConnect:1', details);
    await drain();

    expect(ctx.showNotification).toHaveBeenCalledWith('Failed to connect warehouses', 'error');
    expect(useBuildingStore.getState().tabLoadingStates['supplies']).toBe('loaded');
  });

  it('does not refresh, and says so, when the disconnect SET failed', async () => {
    const { ctx, details } = makeTradeCtx(false);
    seedLoadedPanel();

    handleBuildingAction(ctx, 'tradeDisconnect:4', details);
    await drain();

    expect(ctx.showNotification).toHaveBeenCalledWith('Failed to disconnect stores', 'error');
    expect(useBuildingStore.getState().tabLoadingStates['products']).toBe('loaded');
  });
});

describe('connectFacilities', () => {
  it('sends the coordinate list with the trailing comma and announces "Connected" (T3)', async () => {
    const { connectFacilities } = await import('./building-action-handler');
    const { showToast } = await import('../components/common/Toast');
    const ctx = {
      ...makeCtx(),
      sendRequest: jest.fn().mockImplementation(async (req: { type?: string }) =>
        req.type === 'REQ_BUILDING_SET_PROPERTY' ? { success: true } : { details: makeDetails(10, 20) }),
      refreshBuildingDetails: jest.fn().mockResolvedValue(undefined),
      getRenderer: () => null,
      inFlightSetProperty: new Map(),
    } as unknown as ClientHandlerContext;
    await connectFacilities(ctx, 10, 20, 'Cotton', 'input', [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    const sent = (ctx.sendRequest as jest.Mock).mock.calls.map((c) => c[0] as { propertyName?: string; additionalParams?: { connectionList?: string } });
    const setReq = sent.find((r) => r.propertyName === 'RDOConnectInput');
    expect(setReq?.additionalParams?.connectionList).toBe('1,2,3,4,');
    expect(showToast).toHaveBeenCalledWith('2 suppliers connected.', 'success', { title: 'Connected' });
  });
});

describe('the SaveIndicator key of a write (B6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useBuildingStore.getState().clearDetails();
  });

  const setPropCtx = (success: boolean, confirmed?: boolean) => ({
    ...makeCtx(),
    sendRequest: jest.fn().mockImplementation(async (req: { type?: string }) =>
      req.type === 'REQ_BUILDING_SET_PROPERTY'
        ? { success, confirmed }
        : { details: makeDetails(10, 20) }),
    refreshBuildingDetails: jest.fn().mockResolvedValue(undefined),
    getRenderer: () => null,
    inFlightSetProperty: new Map(),
  } as unknown as ClientHandlerContext);

  it('a connection is keyed by its gate, not by the coordinates it happens to carry', async () => {
    const { connectFacilities } = await import('./building-action-handler');
    await connectFacilities(setPropCtx(true), 10, 20, 'Cotton', 'input', [{ x: 1, y: 2 }]);
    expect(ClientBridge.setPendingUpdate).toHaveBeenCalledWith('RDOConnectInput:Cotton', '0');
    // OB-1: `RDOConnectInput` is a Pascal `procedure` whose witness is a count,
    // so the gateway answers `confirmed: undefined`. The indicator must be told
    // that, not handed the same settle call a verified write gets.
    expect(ClientBridge.confirmPendingUpdate)
      .toHaveBeenCalledWith('RDOConnectInput:Cotton', 'unconfirmed');
  });

  it('a write the gateway verified is the only one that claims confirmation', async () => {
    const { setBuildingProperty } = await import('./building-action-handler');
    await setBuildingProperty(setPropCtx(true, true), 10, 20, 'RDOSetPrice', '220', { index: '0' });
    expect(ClientBridge.confirmPendingUpdate)
      .toHaveBeenCalledWith('RDOSetPrice:{"index":"0"}', 'confirmed');
  });

  it('a write the gateway could not check still succeeds, but says so', async () => {
    const { setBuildingProperty } = await import('./building-action-handler');
    // `confirmed` absent — the gateway's honest answer when the witness reads
    // the same either way, or the object cache has not refreshed (OB-28/OB-29).
    await expect(
      setBuildingProperty(setPropCtx(true), 10, 20, 'RDOSetPrice', '220', { index: '0' }),
    ).resolves.toBe(true);
    expect(ClientBridge.confirmPendingUpdate)
      .toHaveBeenCalledWith('RDOSetPrice:{"index":"0"}', 'unconfirmed');
    expect(ClientBridge.failPendingUpdate).not.toHaveBeenCalled();
  });

  it('a property keeps the default key — member plus parameters', async () => {
    const { setBuildingProperty } = await import('./building-action-handler');
    await setBuildingProperty(setPropCtx(true), 10, 20, 'RDOSetInputMaxPrice', '120', { fluidId: 'Cotton' });
    expect(ClientBridge.setPendingUpdate).toHaveBeenCalledWith('RDOSetInputMaxPrice:{"fluidId":"Cotton"}', '120');
  });

  it('a rename is pending, then settled — unconfirmed, the set reply being unread', async () => {
    const { renameFacility, RENAME_PENDING_KEY } = await import('./building-action-handler');
    const ctx = {
      ...makeCtx(),
      sendRequest: jest.fn().mockResolvedValue({ success: true, newName: 'North Mill' }),
    } as unknown as ClientHandlerContext;
    await expect(renameFacility(ctx, 10, 20, 'North Mill')).resolves.toBe(true);
    expect(ClientBridge.setPendingUpdate).toHaveBeenCalledWith(RENAME_PENDING_KEY, 'North Mill');
    expect(ClientBridge.confirmPendingUpdate)
      .toHaveBeenCalledWith(RENAME_PENDING_KEY, 'unconfirmed');
    expect(ClientBridge.failPendingUpdate).not.toHaveBeenCalled();
  });

  it('a refused rename says so, with the reason the server gave', async () => {
    const { renameFacility, RENAME_PENDING_KEY } = await import('./building-action-handler');
    const ctx = {
      ...makeCtx(),
      sendRequest: jest.fn().mockResolvedValue({ success: false, message: 'Name already taken' }),
    } as unknown as ClientHandlerContext;
    await expect(renameFacility(ctx, 10, 20, 'North Mill')).resolves.toBe(false);
    expect(ClientBridge.failPendingUpdate).toHaveBeenCalledWith(RENAME_PENDING_KEY, 'North Mill', 'Name already taken');
  });

  it('a rename that never reaches the server fails with the transport error', async () => {
    const { renameFacility, RENAME_PENDING_KEY } = await import('./building-action-handler');
    const ctx = {
      ...makeCtx(),
      sendRequest: jest.fn().mockRejectedValue(new Error('socket closed')),
    } as unknown as ClientHandlerContext;
    await expect(renameFacility(ctx, 10, 20, 'North Mill')).resolves.toBe(false);
    expect(ClientBridge.failPendingUpdate).toHaveBeenCalledWith(RENAME_PENDING_KEY, 'North Mill', 'socket closed');
  });
});

describe('movie actions (issue 573)', () => {
  const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

  beforeEach(() => {
    jest.clearAllMocks();
    useBuildingStore.getState().clearDetails();
  });

  function makeMovieCtx(setSucceeds: boolean) {
    const details = makeDetails(10, 20);
    const ctx = {
      currentFocusedVisualClass: '1234',
      inFlightSetProperty: new Map(),
      inFlightBuildingDetails: new Map(),
      showNotification: jest.fn(),
      sendRequest: jest.fn().mockImplementation(async (req: { type: string }) => {
        if (req.type === 'REQ_BUILDING_SET_PROPERTY') {
          return { success: setSucceeds, newValue: '', confirmed: undefined };
        }
        return { details };
      }),
    } as unknown as ClientHandlerContext;
    return { ctx, details };
  }

  it('launchMovie sends the rowData as additionalParams and reports success', async () => {
    const { ctx, details } = makeMovieCtx(true);
    const rowData = { filmName: 'Epic', budget: '2500000', months: '18', autoRel: '0', autoProd: '1' };

    handleBuildingAction(ctx, 'launchMovie', details, rowData);
    await drain();

    expect(ctx.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REQ_BUILDING_SET_PROPERTY', additionalParams: rowData }),
    );
    expect(ctx.showNotification).toHaveBeenCalledWith('Launching movie: Epic', 'success');
  });

  it('launchMovie with no rowData sends nothing and shows an error', async () => {
    const { ctx, details } = makeMovieCtx(true);

    handleBuildingAction(ctx, 'launchMovie', details);
    await drain();

    expect(ctx.sendRequest).not.toHaveBeenCalled();
    expect(ctx.showNotification).toHaveBeenCalledWith('Launch refused: invalid budget or months', 'error');
  });

  it('launchMovie with unparseable months sends nothing and shows an error', async () => {
    const { ctx, details } = makeMovieCtx(true);
    const rowData = { filmName: 'Epic', budget: '2500000', months: 'x', autoRel: '0', autoProd: '1' };

    handleBuildingAction(ctx, 'launchMovie', details, rowData);
    await drain();

    expect(ctx.sendRequest).not.toHaveBeenCalled();
    expect(ctx.showNotification).toHaveBeenCalledWith('Launch refused: invalid budget or months', 'error');
  });

  it('launchMovie shows "Failed to launch movie" when the SET fails', async () => {
    const { ctx, details } = makeMovieCtx(false);
    const rowData = { filmName: 'Epic', budget: '2500000', months: '18', autoRel: '0', autoProd: '1' };

    handleBuildingAction(ctx, 'launchMovie', details, rowData);
    await drain();

    expect(ctx.showNotification).toHaveBeenCalledWith('Failed to launch movie', 'error');
  });

  it('cancelMovie shows the success toast and refreshes when the SET succeeds, after confirm', async () => {
    const originalConfirm = (global as { confirm?: (msg?: string) => boolean }).confirm;
    (global as { confirm?: (msg?: string) => boolean }).confirm = jest.fn(() => true);
    try {
      const { ctx, details } = makeMovieCtx(true);

      handleBuildingAction(ctx, 'cancelMovie', details);
      await drain();

      expect(ctx.showNotification).toHaveBeenCalledWith('Movie production cancelled', 'success');
    } finally {
      (global as { confirm?: (msg?: string) => boolean }).confirm = originalConfirm;
    }
  });

  it('releaseMovie shows "Movie released" only when the SET succeeds', async () => {
    const { ctx, details } = makeMovieCtx(true);

    handleBuildingAction(ctx, 'releaseMovie', details);
    await drain();

    expect(ctx.showNotification).toHaveBeenCalledWith('Movie released', 'success');
  });

  it('releaseMovie shows "Failed to release movie" and never "Movie released" when the SET fails', async () => {
    const { ctx, details } = makeMovieCtx(false);

    handleBuildingAction(ctx, 'releaseMovie', details);
    await drain();

    expect(ctx.showNotification).toHaveBeenCalledWith('Failed to release movie', 'error');
    expect(ctx.showNotification).not.toHaveBeenCalledWith('Movie released', 'success');
  });

  it('cancelMovie shows the error toast when the SET fails, after confirm', async () => {
    const originalConfirm = (global as { confirm?: (msg?: string) => boolean }).confirm;
    (global as { confirm?: (msg?: string) => boolean }).confirm = jest.fn(() => true);
    try {
      const { ctx, details } = makeMovieCtx(false);

      handleBuildingAction(ctx, 'cancelMovie', details);
      await drain();

      expect(ctx.showNotification).toHaveBeenCalledWith('Failed to cancel movie', 'error');
    } finally {
      (global as { confirm?: (msg?: string) => boolean }).confirm = originalConfirm;
    }
  });
});

describe('downgrade asks first (B5)', () => {
  beforeEach(() => {
    useUiStore.setState({ modal: null, modalBeneath: null, confirmPayload: null });
  });

  it('DOWNGRADE opens a destructive Dialog and sends nothing yet', async () => {
    const { upgradeBuildingAction } = await import('./building-action-handler');
    const ctx = {
      ...makeCtx(),
      sendRequest: jest.fn().mockResolvedValue({ success: true }),
    } as unknown as ClientHandlerContext;

    const result = upgradeBuildingAction(ctx, 10, 20, 'DOWNGRADE');
    const { modal, confirmPayload } = useUiStore.getState();
    expect(modal).toBe('confirm');
    expect(confirmPayload?.title).toBe('Downgrade Building');
    expect(confirmPayload?.options?.kind).toBe('destructive');
    expect(confirmPayload?.options?.confirmLabel).toBe('Downgrade');
    expect(ctx.sendRequest).not.toHaveBeenCalled();

    // The player confirms — only now does the request go out
    confirmPayload?.onConfirm();
    await expect(result).resolves.toBe(true);
    expect(ctx.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({ x: 10, y: 20, action: 'DOWNGRADE' }),
    );
  });

  it('START_UPGRADE and STOP_UPGRADE go straight through, no Dialog', async () => {
    const { upgradeBuildingAction } = await import('./building-action-handler');
    const ctx = {
      ...makeCtx(),
      sendRequest: jest.fn().mockResolvedValue({ success: true }),
    } as unknown as ClientHandlerContext;

    await expect(upgradeBuildingAction(ctx, 10, 20, 'START_UPGRADE', 2)).resolves.toBe(true);
    await expect(upgradeBuildingAction(ctx, 10, 20, 'STOP_UPGRADE')).resolves.toBe(true);
    expect(useUiStore.getState().modal).toBeNull();
    expect(ctx.sendRequest).toHaveBeenCalledTimes(2);
  });

  it('a refused downgrade resolves false after the confirm', async () => {
    const { upgradeBuildingAction } = await import('./building-action-handler');
    const ctx = {
      ...makeCtx(),
      sendRequest: jest.fn().mockResolvedValue({ success: false, message: 'no level' }),
    } as unknown as ClientHandlerContext;

    const result = upgradeBuildingAction(ctx, 10, 20, 'DOWNGRADE');
    useUiStore.getState().confirmPayload?.onConfirm();
    await expect(result).resolves.toBe(false);
  });
});

describe('requestWorkerCounts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('asks for exactly the classes it was given and hands the figures back', async () => {
    const { requestWorkerCounts } = await import('./building-action-handler');
    const counts = [{ kind: 0, workers: 5 }, { kind: 2, workers: 69 }];
    const ctx = {
      ...makeCtx(),
      sendRequest: jest.fn().mockResolvedValue({ counts }),
    } as unknown as ClientHandlerContext;

    await expect(requestWorkerCounts(ctx, 472, 392, [0, 2])).resolves.toEqual(counts);
    expect(ctx.sendRequest).toHaveBeenCalledWith({
      type: 'REQ_BUILDING_WORKER_COUNTS',
      x: 472,
      y: 392,
      kinds: [0, 2],
    });
  });

  it('returns null and logs when the request fails — a stale figure, not a broken panel', async () => {
    const { requestWorkerCounts } = await import('./building-action-handler');
    const ctx = {
      ...makeCtx(),
      sendRequest: jest.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as ClientHandlerContext;

    await expect(requestWorkerCounts(ctx, 472, 392, [1])).resolves.toBeNull();
    expect(ClientBridge.log).toHaveBeenCalledWith('Error', expect.stringContaining('timeout'));
  });
});
