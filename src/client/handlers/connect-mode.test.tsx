/**
 * N10 — the connect mode: one mode, two origins, and a hidden (never
 * destroyed) sheet stack while it runs.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { startConnectModeFromPicker, cancelConnectMode } from './building-action-handler';
import { useBuildingStore } from '../store/building-store';
import { useUiStore } from '../store/ui-store';
import type { ClientHandlerContext } from './client-context';

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    updateBuildingDetails: jest.fn(),
    setPendingUpdate: jest.fn(),
    confirmPendingUpdate: jest.fn(),
    failPendingUpdate: jest.fn(),
  },
}));
jest.mock('../components/common/Toast', () => ({
  showToast: jest.fn(() => 'toast-id'),
  dismissToast: jest.fn(),
}));

interface FakeRenderer {
  setConnectMode: jest.Mock;
  setConnectModeCallback: jest.Mock;
}

function makeCtx(): ClientHandlerContext & { renderer: FakeRenderer } {
  const renderer: FakeRenderer = {
    setConnectMode: jest.fn(),
    setConnectModeCallback: jest.fn(),
  };
  return {
    isConnectMode: false,
    connectSourceBuilding: null,
    connectKeyboardHandler: null,
    getRenderer: () => renderer,
    renderer,
    sendRequest: jest.fn(async () => ({ success: true, resultMessage: 'Connected' })),
    showNotification: jest.fn(),
    // The post-connect refresh walks the details pipeline — give it its maps
    inFlightBuildingDetails: new Map(),
    speculativeBuildingDetails: new Map(),
    speculativeBuildingResolved: new Map(),
    currentFocusedVisualClass: null,
  } as unknown as ClientHandlerContext & { renderer: FakeRenderer };
}

function seedPicker(): void {
  useBuildingStore.getState().setConnectionPicker({
    fluidName: 'Fabrics',
    fluidId: 'fab',
    direction: 'input',
    buildingX: 40,
    buildingY: 50,
  });
}

describe('connect mode from the picker (Pick on map)', () => {
  beforeEach(() => {
    useUiStore.setState({ connectMode: { active: false, subject: '' }, mobileTab: 'more' });
    useBuildingStore.setState({ connectionPicker: null });
  });

  it('enters the mode with the picker building as source and the fluid as subject', () => {
    const ctx = makeCtx();
    seedPicker();
    startConnectModeFromPicker(ctx);

    expect(ctx.isConnectMode).toBe(true);
    expect(ctx.connectSourceBuilding).toEqual({ x: 40, y: 50 });
    expect(useUiStore.getState().connectMode).toEqual({ active: true, subject: 'Fabrics' });
    expect(useUiStore.getState().mobileTab).toBe('map');
    expect(ctx.renderer.setConnectMode).toHaveBeenCalledWith(true);
    // No entry toast — the mode bar announces the mode now
    expect(ctx.showNotification).not.toHaveBeenCalled();
    cancelConnectMode(ctx);
  });

  it('does nothing without a picker context', () => {
    const ctx = makeCtx();
    startConnectModeFromPicker(ctx);
    expect(ctx.isConnectMode).toBe(false);
    expect(useUiStore.getState().connectMode.active).toBe(false);
  });

  it('cancelling reveals the stack again and resets the renderer', () => {
    const ctx = makeCtx();
    seedPicker();
    startConnectModeFromPicker(ctx);
    cancelConnectMode(ctx);

    expect(ctx.isConnectMode).toBe(false);
    expect(ctx.connectSourceBuilding).toBeNull();
    expect(useUiStore.getState().connectMode.active).toBe(false);
    expect(ctx.renderer.setConnectMode).toHaveBeenLastCalledWith(false);
    expect(ctx.renderer.setConnectModeCallback).toHaveBeenLastCalledWith(null);
    // The picker context was NOT cleared — the sheet comes back as it was
    expect(useBuildingStore.getState().connectionPicker?.fluidName).toBe('Fabrics');
  });

  it('a map click connects source to target, then leaves the mode (one-shot)', async () => {
    const ctx = makeCtx();
    seedPicker();
    startConnectModeFromPicker(ctx);

    const cb = ctx.renderer.setConnectModeCallback.mock.calls[0][0] as (x: number, y: number) => void;
    cb(60, 70);
    await new Promise((r) => setTimeout(r, 0));

    expect(ctx.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({ sourceX: 40, sourceY: 50, targetX: 60, targetY: 70 }),
    );
    expect(ctx.showNotification).toHaveBeenCalledWith('Connected', 'success');
    expect(useUiStore.getState().connectMode.active).toBe(false);
  });

  it('a server refusal is reported as an error, not a success toast', async () => {
    const ctx = makeCtx();
    seedPicker();
    (ctx.sendRequest as jest.Mock).mockImplementation(async () => (
      { success: false, resultMessage: 'You are not allowed to do that!' }
    ));
    startConnectModeFromPicker(ctx);

    const cb = ctx.renderer.setConnectModeCallback.mock.calls[0][0] as (x: number, y: number) => void;
    cb(60, 70);
    await new Promise((r) => setTimeout(r, 0));

    expect(ctx.showNotification).toHaveBeenCalledWith('You are not allowed to do that!', 'error');
    expect(useUiStore.getState().connectMode.active).toBe(false);
  });

  it('a transport error still leaves the mode and reveals the stack', async () => {
    const ctx = makeCtx();
    seedPicker();
    (ctx.sendRequest as jest.Mock).mockImplementation(async () => { throw new Error('socket closed'); });
    startConnectModeFromPicker(ctx);

    const cb = ctx.renderer.setConnectModeCallback.mock.calls[0][0] as (x: number, y: number) => void;
    cb(60, 70);
    await new Promise((r) => setTimeout(r, 0));

    expect(ctx.showNotification).toHaveBeenCalledWith('Connection failed: socket closed', 'error');
    expect(useUiStore.getState().connectMode.active).toBe(false);
  });
});

describe('connect mode from the inspector (connectMap)', () => {
  it('enters the same mode, subject = the source building name', async () => {
    const { handleBuildingAction } = await import('./building-action-handler');
    const ctx = makeCtx();
    useUiStore.setState({ connectMode: { active: false, subject: '' } });
    await handleBuildingAction(ctx, 'connectMap', {
      buildingId: 'b1', x: 40, y: 50, visualClass: '100', templateName: 'T',
      buildingName: 'North Mill', ownerName: 'Me', securityId: 's', canGovern: false,
      tabs: [], groups: {}, timestamp: 0,
    } as never);
    expect(ctx.isConnectMode).toBe(true);
    expect(useUiStore.getState().connectMode).toEqual({ active: true, subject: 'North Mill' });
    cancelConnectMode(ctx);
  });
});

describe('Escape ownership while the mode runs', () => {
  it('one keypress leaves the mode and never reaches the window listeners', () => {
    const ctx = makeCtx();
    seedPicker();
    useUiStore.getState().setRootSurface({ kind: 'building' });
    useUiStore.getState().pushSurface({ kind: 'supplierSearch' });
    startConnectModeFromPicker(ctx);

    const windowSpy = jest.fn();
    window.addEventListener('keydown', windowSpy);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', windowSpy);

    expect(ctx.isConnectMode).toBe(false);
    // The same keypress must NOT fall through to useKeyboardShortcuts —
    // it would pop a surface of the just-restored stack (live QA, lot f)
    expect(windowSpy).not.toHaveBeenCalled();
    expect(useUiStore.getState().stack).toHaveLength(2);
    useUiStore.getState().clearSurfaces();
  });

  it('dismissTopmost refuses to pop the hidden stack', () => {
    useUiStore.setState({ connectMode: { active: true, subject: 'Fabrics' } });
    useUiStore.getState().setRootSurface({ kind: 'building' });
    useUiStore.getState().pushSurface({ kind: 'supplierSearch' });
    useUiStore.getState().dismissTopmost();
    expect(useUiStore.getState().stack).toHaveLength(2);
    useUiStore.setState({ connectMode: { active: false, subject: '' } });
    useUiStore.getState().clearSurfaces();
  });
});
