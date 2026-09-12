/**
 * Building Action Handler — extracted from StarpeaceClient.
 *
 * Handles building action button dispatch, trade connect/disconnect,
 * manual connect mode, clone facility, movie actions, politics inline actions,
 * repair actions, and research actions.
 */

import {
  WsMessageType,
  WsMessage,
  WsReqBuildingDetails,
  WsRespBuildingDetails,
  WsReqBuildingTabData,
  WsRespBuildingTabData,
  WsReqBuildingGateConnections,
  WsRespBuildingGateConnections,
  WsReqBuildingServiceFigures,
  WsRespBuildingServiceFigures,
  WsReqBuildingRefreshProperties,
  WsRespBuildingRefreshProperties,
  WsReqBuildingSetProperty,
  WsRespBuildingSetProperty,
  WsReqBuildingUpgrade,
  WsRespBuildingUpgrade,
  WsReqRenameFacility,
  WsRespRenameFacility,
  WsReqDeleteFacility,
  WsRespDeleteFacility,
  WsReqCloneFacility,
  WsRespCloneFacility,
  WsReqSearchConnections,
  WsReqConnectionReachability,
  WsReqPoliticsVote,
  WsRespPoliticsVote,
  BuildingDetailsResponse,
} from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { showToast, dismissToast } from '../components/common/Toast';
import { ClientBridge } from '../bridge/client-bridge';
import { useBuildingStore, gateKey } from '../store/building-store';
import type { GateTabId } from '../store/building-store';
import { useGameStore } from '../store/game-store';
import { useUiStore } from '../store/ui-store';
import type { ClientHandlerContext } from './client-context';
import { connectionPendingKey } from './connection-pending-key';
import { isGateTab } from '@/shared/building-details';
import { parseFilmMonths } from '../components/building/property-utils';

// ── Building Details ────────────────────────────────────────────────────────

export function requestBuildingDetails(
  ctx: ClientHandlerContext,
  x: number,
  y: number,
  visualClass: string
): Promise<BuildingDetailsResponse | null> {
  const key = `${x},${y}`;
  const existing = ctx.inFlightBuildingDetails.get(key);
  if (existing) {
    ClientBridge.log('Building', `Dedup: reusing in-flight request at (${x}, ${y})`);
    return existing;
  }

  const promise = requestBuildingDetailsImpl(ctx, x, y, visualClass);
  ctx.inFlightBuildingDetails.set(key, promise);
  promise.finally(() => ctx.inFlightBuildingDetails.delete(key));
  return promise;
}

async function requestBuildingDetailsImpl(
  ctx: ClientHandlerContext,
  x: number,
  y: number,
  visualClass: string
): Promise<BuildingDetailsResponse | null> {
  ClientBridge.log('Building', `Requesting details at (${x}, ${y})`);

  try {
    const req: WsReqBuildingDetails = {
      type: WsMessageType.REQ_BUILDING_DETAILS,
      x,
      y,
      visualClass
    };

    const response = await ctx.sendRequest(req) as WsRespBuildingDetails;
    ClientBridge.log('Building', `Got details: ${response.details.templateName}`);
    return response.details;
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to get building details: ${toErrorMessage(err)}`);
    return null;
  }
}

export async function refreshBuildingDetails(ctx: ClientHandlerContext, x: number, y: number): Promise<void> {
  const vc = ctx.currentFocusedVisualClass || '0';
  // Reset lazy tab states so they re-fetch on next view
  useBuildingStore.getState().resetTabLoadingStates();
  const details = await requestBuildingDetails(ctx, x, y, vc);
  if (details) {
    ClientBridge.updateBuildingDetails(details);
  } else {
    // If we're in a loading/error state with no details, surface the error
    // so the user sees a retry button instead of an eternal skeleton.
    const state = useBuildingStore.getState();
    if (state.isLoading && !state.details) {
      state.setDetailsError('Failed to load building details. Please try again.');
    }
  }
}

// ── Lightweight Property Refresh ────────────────────────────────────────────

/**
 * Lightweight refresh: re-reads building properties on the existing Delphi
 * temp object. Used by EVENT_BUILDING_REFRESH (~5s interval) to avoid
 * creating a new temp object and leaking the old one.
 * Falls back to full requestBuildingDetails on the server if no inspector exists.
 */
export async function requestBuildingRefreshProperties(
  ctx: ClientHandlerContext,
  x: number,
  y: number,
  visualClass: string,
  activeTabId?: string,
): Promise<BuildingDetailsResponse | null> {
  ClientBridge.log('Building', `Refreshing properties at (${x}, ${y})${activeTabId ? ` [tab=${activeTabId}]` : ''}`);

  try {
    const req: WsReqBuildingRefreshProperties = {
      type: WsMessageType.REQ_BUILDING_REFRESH_PROPERTIES,
      x,
      y,
      visualClass,
      activeTabId,
    };

    const response = await ctx.sendRequest(req) as WsRespBuildingRefreshProperties;
    ClientBridge.log('Building', `Refreshed properties: ${response.details.templateName}`);
    return response.details;
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to refresh properties: ${toErrorMessage(err)}`);
    return null;
  }
}

// ── Tab Data (Lazy Loading) ─────────────────────────────────────────────────

/**
 * Tabs whose data comes from a gate walk (SetPath + per-gate reads) rather than
 * from the template's property list. They are fetched by id, with no `groupIds`.
 * Every OTHER tab is now lazy too — its group is read when the section opens —
 * but through the `groupIds` path, so this set stays what it always was: the
 * three specials.
 */
/** The gate-backed tabs, named once in `shared/building-details` and read from there. */
export function isLazyTab(tabId: string): boolean {
  return isGateTab(tabId);
}

export async function requestTabData(
  ctx: ClientHandlerContext,
  x: number,
  y: number,
  tabId: string,
  visualClass: string,
  groupIds?: string[],
): Promise<void> {
  // Don't send requests when disconnected
  if (useGameStore.getState().status !== 'connected') return;

  const store = useBuildingStore.getState();

  // Already loaded or loading — skip
  const state = store.tabLoadingStates[tabId];
  if (state === 'loaded' || state === 'loading') return;

  ClientBridge.log('Building', `Requesting tab data: ${tabId} at (${x},${y})`);
  store.setTabLoading(tabId);

  try {
    const req: WsReqBuildingTabData = {
      type: WsMessageType.REQ_BUILDING_TAB_DATA,
      x,
      y,
      tabId,
      visualClass,
      ...(groupIds && groupIds.length > 0 ? { groupIds } : {}),
    };

    const response = await ctx.sendRequest(req) as WsRespBuildingTabData;
    store.mergeTabData(tabId, response, x, y);
    ClientBridge.log('Building', `Tab data received: ${tabId}`);
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to get tab data ${tabId}: ${toErrorMessage(err)}`);
    // Mark as error (not idle) to prevent useEffect retry loop.
    // Manual refresh or building re-select will reset to idle.
    useBuildingStore.setState((s) => ({
      tabLoadingStates: { ...s.tabLoadingStates, [tabId]: 'error' },
    }));
  }
}

// ── Gate Connections (Lazy, one gate at a time) ─────────────────────────────

/**
 * Read one gate's connection rows.
 *
 * `requestTabData` above returns the Supplies/Products gates with their headers
 * and empty connection lists — enough for the collapsed accordion. This fills a
 * single gate in when the user opens it, which is the point of the split: a
 * 30-gate warehouse costs 30 SetPath + 30 GetPropertyList to open the tab
 * instead of that plus one GetSubObjectProps per connection of every gate,
 * almost all of it for rows nobody looks at.
 *
 * The reference client does the same one-gate-at-a-time read and memoises it
 * (`if reload or not Info.Loaded`, Voyager/ProdSheetForm.pas:464); here the memo
 * is `gateLoadingStates` and the early return below.
 */
export async function requestGateConnections(
  ctx: ClientHandlerContext,
  x: number,
  y: number,
  tabId: GateTabId,
  path: string,
  name: string,
  visualClass: string,
): Promise<void> {
  // Don't send requests when disconnected
  if (useGameStore.getState().status !== 'connected') return;

  const store = useBuildingStore.getState();

  // Already loaded or loading — skip
  const state = store.gateLoadingStates[gateKey(tabId, path)];
  if (state === 'loaded' || state === 'loading') return;

  ClientBridge.log('Building', `Requesting gate connections: ${tabId} '${path}' at (${x},${y})`);
  store.setGateLoading(tabId, path);

  try {
    const req: WsReqBuildingGateConnections = {
      type: WsMessageType.REQ_BUILDING_GATE_CONNECTIONS,
      x,
      y,
      tabId,
      path,
      name,
      visualClass,
    };

    const response = await ctx.sendRequest(req) as WsRespBuildingGateConnections;
    const gate = tabId === 'supplies' ? response.supply : response.product;
    if (!gate) {
      // SetPath failed server-side: the gate is gone, or the shared temp object
      // was pointed somewhere else. Nothing to merge, and retrying on every
      // render would hammer it — mark it errored like the tab path does.
      ClientBridge.log('Error', `Gate ${tabId} '${path}' returned no data`);
      useBuildingStore.getState().setGateError(tabId, path);
      return;
    }
    useBuildingStore.getState().mergeGateData(tabId, path, gate, x, y);
    ClientBridge.log('Building', `Gate connections received: ${tabId} '${path}' (${gate.connections.length} rows)`);
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to get gate ${tabId} '${path}': ${toErrorMessage(err)}`);
    // Mark as error (not idle) to prevent a useEffect retry loop.
    useBuildingStore.getState().setGateError(tabId, path);
  }
}

// ── Service Figures (live, one service at a time) ───────────────────────────

/**
 * Read the live Offer / Demand pair of one service off the block.
 *
 * The General tab's cached `srvSupplies{i}` / `srvDemands{i}` columns only move
 * with the 30-second whole-tab refresh. The reference client polls the block
 * instead, for the selected finger alone (Voyager/SrvGeneralSheetForm.pas:411-413),
 * which is what this is: one request per tick, whatever the service count.
 *
 * The answer is returned rather than written to a store on purpose — the
 * figures live in the card list's own state, so they disappear with the tab.
 */
export async function requestServiceFigures(
  ctx: ClientHandlerContext,
  x: number,
  y: number,
  serviceIndex: number,
): Promise<{ supply: string; demand: string } | null> {
  if (useGameStore.getState().status !== 'connected') return null;

  try {
    const req: WsReqBuildingServiceFigures = {
      type: WsMessageType.REQ_BUILDING_SERVICE_FIGURES,
      x,
      y,
      serviceIndex,
    };

    const response = await ctx.sendRequest(req) as WsRespBuildingServiceFigures;
    return { supply: response.supply, demand: response.demand };
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to read service ${serviceIndex} figures at (${x},${y}): ${toErrorMessage(err)}`);
    return null;
  }
}

// ── Set Property ────────────────────────────────────────────────────────────

/**
 * `pendingKey` names the write for the SaveIndicator. It defaults to the member plus its
 * parameters, which is right for a property — one control, one key. It is wrong for the
 * connection family: `connectionList` carries the coordinates being connected, so the key
 * changes with every click and no control can watch it. Those callers pass a key of their
 * own, one per gate, which is the granularity the panel actually shows (B6).
 */
export function setBuildingProperty(
  ctx: ClientHandlerContext,
  x: number,
  y: number,
  propertyName: string,
  value: string,
  additionalParams?: Record<string, string>,
  pendingKey?: string
): Promise<boolean> {
  const dedupKey = `${x},${y}:${propertyName}:${JSON.stringify(additionalParams ?? {})}`;
  const existing = ctx.inFlightSetProperty.get(dedupKey);
  if (existing) {
    ClientBridge.log('Building', `Dedup: reusing in-flight setBuildingProperty for ${dedupKey}`);
    return existing;
  }
  const promise = setBuildingPropertyImpl(ctx, x, y, propertyName, value, additionalParams, pendingKey);
  ctx.inFlightSetProperty.set(dedupKey, promise);
  promise.finally(() => ctx.inFlightSetProperty.delete(dedupKey));
  return promise;
}

async function setBuildingPropertyImpl(
  ctx: ClientHandlerContext,
  x: number,
  y: number,
  propertyName: string,
  value: string,
  additionalParams?: Record<string, string>,
  pendingKeyOverride?: string
): Promise<boolean> {
  ClientBridge.log('Building', `Setting ${propertyName}=${value} at (${x}, ${y})`);

  const pendingKey = pendingKeyOverride ?? (additionalParams
    ? `${propertyName}:${JSON.stringify(additionalParams)}`
    : propertyName);

  ClientBridge.setPendingUpdate(pendingKey, value);

  try {
    const req: WsReqBuildingSetProperty = {
      type: WsMessageType.REQ_BUILDING_SET_PROPERTY,
      x,
      y,
      propertyName,
      value,
      additionalParams
    };

    const response = await ctx.sendRequest(req) as WsRespBuildingSetProperty;

    if (response.success) {
      // M-E: `success` means the command went out, not that it took effect.
      // `confirmed === false` means the gateway re-read the value and the server
      // positively disagrees with the write. Marking that as confirmed would
      // paint an optimistic value the server does not hold, which is precisely
      // the lie the audit found.
      //
      // `undefined` means nothing contradicts the write and the optimistic value
      // stands: the command has no witness property (the disconnect family), the
      // witness reads the same either way, or the read-back is still the old
      // value because the object cache refreshes a civic write 30-90 s late
      // (OB-28/OB-29). Reverting on those would fail writes that landed.
      if (response.confirmed === false) {
        ClientBridge.failPendingUpdate(pendingKey, value, 'Change could not be confirmed by the server');
        ClientBridge.log('Error', `${propertyName} was sent but could not be confirmed`);
        return false;
      }

      // OB-1: `undefined` is not `true`, and the indicator must not spell it as
      // one. `RDOConnectInput` is the case the audit found — a Pascal
      // `procedure`, so nothing comes back, and its witness (`cnxCount`) is a
      // count that reads the same whether the connection was made or thrown
      // away. The gateway says so honestly; the client used to answer both with
      // the same green tick, and told the player the connection had been made.
      //
      // The optimistic value still stands — reverting it would fail the many
      // writes that do land and simply cannot be witnessed (OB-28/OB-29). What
      // changes is the claim made about it.
      const verdict = response.confirmed === true ? 'confirmed' : 'unconfirmed';
      ClientBridge.confirmPendingUpdate(pendingKey, verdict);
      ClientBridge.log(
        'Building',
        verdict === 'confirmed'
          ? `Property ${propertyName} updated to ${response.newValue}`
          : `Property ${propertyName} was sent; the server could not confirm it`,
      );
      return true;
    } else {
      ClientBridge.failPendingUpdate(pendingKey, value, 'Server rejected the change');
      ClientBridge.log('Error', `Failed to set ${propertyName}`);
      return false;
    }
  } catch (err: unknown) {
    ClientBridge.failPendingUpdate(pendingKey, value, toErrorMessage(err));
    ClientBridge.log('Error', `Failed to set property: ${toErrorMessage(err)}`);
    return false;
  }
}

// ── Upgrade / Rename / Delete ───────────────────────────────────────────────

export async function upgradeBuildingAction(
  ctx: ClientHandlerContext,
  x: number,
  y: number,
  action: 'DOWNGRADE' | 'START_UPGRADE' | 'STOP_UPGRADE',
  count?: number
): Promise<boolean> {
  if (action === 'DOWNGRADE') {
    // A downgrade destroys a paid level with no undo — Dialog first (B5), like
    // demolition. The promise resolves only when the player confirms.
    return new Promise<boolean>((resolve) => {
      useUiStore.getState().requestConfirm(
        'Downgrade Building',
        'This removes one upgrade level. The level and what it cost are not recovered.',
        () => { void performUpgradeAction(ctx, x, y, action, count).then(resolve); },
        { kind: 'destructive', confirmLabel: 'Downgrade', typeToConfirm: null },
      );
    });
  }
  return performUpgradeAction(ctx, x, y, action, count);
}

async function performUpgradeAction(
  ctx: ClientHandlerContext,
  x: number,
  y: number,
  action: 'DOWNGRADE' | 'START_UPGRADE' | 'STOP_UPGRADE',
  count?: number
): Promise<boolean> {
  const actionName = action === 'DOWNGRADE' ? 'Downgrading' :
                     action === 'START_UPGRADE' ? `Starting ${count} upgrade(s)` :
                     'Stopping upgrade';
  ClientBridge.log('Building', `${actionName} at (${x}, ${y})`);

  try {
    const req: WsReqBuildingUpgrade = {
      type: WsMessageType.REQ_BUILDING_UPGRADE,
      x, y, action, count
    };

    const response = await ctx.sendRequest(req) as WsRespBuildingUpgrade;

    if (response.success) {
      ClientBridge.log('Building', response.message || 'Upgrade action completed');
      return true;
    } else {
      ClientBridge.log('Error', response.message || 'Failed to perform upgrade action');
      return false;
    }
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to perform upgrade action: ${toErrorMessage(err)}`);
    return false;
  }
}

/** The SaveIndicator key for a rename — one building, one name, one key. */
export const RENAME_PENDING_KEY = 'RenameFacility';

export async function renameFacility(ctx: ClientHandlerContext, x: number, y: number, newName: string): Promise<boolean> {
  ClientBridge.log('Building', `Renaming building at (${x}, ${y}) to "${newName}"`);

  // Renaming was the one write with no visible state at all: the name changed when the
  // refresh came back, or nothing happened and nothing said why (B6).
  ClientBridge.setPendingUpdate(RENAME_PENDING_KEY, newName);

  try {
    const req: WsReqRenameFacility = {
      type: WsMessageType.REQ_RENAME_FACILITY,
      x, y, newName
    };

    const response = await ctx.sendRequest(req) as WsRespRenameFacility;

    if (response.success) {
      // `unconfirmed` for the same reason as above: the gateway sends
      // `set Name` and never inspects the reply's result code
      // (building-management-handler.ts:272-274), so `success` here means the
      // round-trip did not throw — not that the name changed.
      ClientBridge.confirmPendingUpdate(RENAME_PENDING_KEY, 'unconfirmed');
      ClientBridge.log('Building', `Building renamed to "${response.newName}"`);
      return true;
    } else {
      ClientBridge.failPendingUpdate(RENAME_PENDING_KEY, newName, response.message || 'The server refused the new name');
      ClientBridge.log('Error', response.message || 'Failed to rename building');
      return false;
    }
  } catch (err: unknown) {
    ClientBridge.failPendingUpdate(RENAME_PENDING_KEY, newName, toErrorMessage(err));
    ClientBridge.log('Error', `Failed to rename building: ${toErrorMessage(err)}`);
    return false;
  }
}

export async function deleteFacility(ctx: ClientHandlerContext, x: number, y: number): Promise<boolean> {
  ClientBridge.log('Building', `Deleting building at (${x}, ${y})`);

  try {
    const req: WsReqDeleteFacility = {
      type: WsMessageType.REQ_DELETE_FACILITY,
      x, y
    };

    const response = await ctx.sendRequest(req) as WsRespDeleteFacility;

    if (response.success) {
      ClientBridge.log('Building', 'Building deleted successfully');
      ctx.loadAlignedMapArea(x, y);
      return true;
    } else {
      ClientBridge.log('Error', response.message || 'Failed to delete building');
      return false;
    }
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to delete building: ${toErrorMessage(err)}`);
    return false;
  }
}

// ── Action Button Dispatch ──────────────────────────────────────────────────

export function handleBuildingAction(ctx: ClientHandlerContext, actionId: string, buildingDetails: BuildingDetailsResponse, rowData?: Record<string, string>): void {
  if (actionId === 'launchMovie') {
    launchMovie(ctx, buildingDetails, rowData);
  } else if (actionId === 'cancelMovie') {
    cancelMovie(ctx, buildingDetails);
  } else if (actionId === 'releaseMovie') {
    releaseMovie(ctx, buildingDetails);
  } else if (actionId === 'vote') {
    voteForCandidate(ctx, buildingDetails);
  } else if (actionId === 'voteCandidate' && rowData) {
    voteForCandidateInline(ctx, buildingDetails, rowData);
  } else if (actionId === 'banMinister') {
    banMinister(ctx, buildingDetails);
  } else if (actionId === 'deposeMinister' && rowData) {
    deposeMinisterInline(ctx, buildingDetails, rowData);
  } else if (actionId === 'sitMinister') {
    sitMinister(ctx, buildingDetails);
  } else if (actionId === 'electMinister' && rowData) {
    electMinisterInline(ctx, buildingDetails, rowData);
  } else if (actionId === 'electMayor' && rowData) {
    electMayorInline(ctx, buildingDetails, rowData);
  } else if (actionId.startsWith('tradeConnect:')) {
    const kind = actionId.split(':')[1];
    tradeConnect(ctx, buildingDetails, kind);
  } else if (actionId.startsWith('tradeDisconnect:')) {
    const kind = actionId.split(':')[1];
    tradeDisconnect(ctx, buildingDetails, kind);
  } else if (actionId === 'connectMap') {
    startConnectMode(ctx, buildingDetails, buildingDetails.buildingName);
  } else if (actionId === 'demolish') {
    useUiStore.getState().requestConfirm(
      'Demolish Building',
      'Are you sure you want to demolish this building? This action cannot be undone.',
      () => deleteFacility(ctx, buildingDetails.x, buildingDetails.y).then(success => {
        if (success) ClientBridge.hideBuildingPanel();
      }),
      { kind: 'destructive', confirmLabel: 'Demolish', typeToConfirm: 'CONFIRM' },
    );
  } else if (actionId === 'startRepair') {
    startRepair(ctx, buildingDetails);
  } else if (actionId === 'stopRepair') {
    stopRepair(ctx, buildingDetails);
  } else if (actionId === 'queueResearch') {
    queueResearch(ctx, buildingDetails);
  } else if (actionId === 'cancelResearch') {
    cancelResearch(ctx, buildingDetails);
  } else {
    console.warn(`[Client] Unhandled building action: ${actionId}`);
    ctx.showNotification(`Action "${actionId}" is not yet implemented`, 'error');
  }
}

// ── Connection-change refresh ───────────────────────────────────────────────

/**
 * The two lazy tabs that render connection lists, keyed by their `special` id —
 * the same key `BuildingInspector` uses when it resolves a tab to a lazy fetch.
 */
const CONNECTION_TABS = ['supplies', 'products'] as const;

/**
 * Lightweight re-read of a building's properties, straight into the store.
 *
 * Reuses the Delphi temp object the inspector already holds instead of
 * re-focusing the building, and scopes the read to the tab on screen. This is
 * the shared core of the two refresh paths that follow a mutation — the
 * `onRefreshBuildingProperties` callback, used after a SET the server may have
 * corrected, and {@link refreshAfterConnectionChange} below. They differ only
 * in what they do about the lazy tabs, so only that difference lives apart.
 */
export async function refreshBuildingPropertiesInto(
  ctx: ClientHandlerContext,
  x: number,
  y: number,
): Promise<BuildingDetailsResponse | null> {
  const activeTabId = useBuildingStore.getState().currentTab;
  const details = await requestBuildingRefreshProperties(
    ctx, x, y, ctx.currentFocusedVisualClass || '0', activeTabId,
  );
  if (details) ClientBridge.updateBuildingDetails(details);
  return details;
}

/**
 * Re-read a building after its connections changed.
 *
 * A property refresh alone cannot show the change. It returns every lazy tab as
 * `undefined` on purpose (building-details-handler.ts:575-579) and the store
 * carries the previous values forward (building-store.ts:213-216), so the
 * connection lists keep rendering what they held before the mutation. Passing
 * `activeTabId` does not help either: the tab-scoped path explicitly excludes
 * the lazy specials (building-details-handler.ts:520-525). Only `requestTabData`
 * re-reads them.
 *
 * Both lists are invalidated because a single call can move either side.
 * RDOConnectToTycoon wires the tycoon's facility INPUTS onto this building's
 * OUTPUTS (Kernel/Kernel.pas:4547-4552), so the new row shows up in this
 * building's clients or in its suppliers depending on which end is on screen.
 *
 * The fetch itself is left to the lazy effect in `BuildingInspector`, which
 * already reacts to `tabLoadingStates` and knows how to map a tab to its lazy
 * id: clearing the entry is what makes it fire for the visible tab, and the
 * others re-fetch when the user switches to them.
 */
export async function refreshAfterConnectionChange(
  ctx: ClientHandlerContext,
  x: number,
  y: number,
): Promise<void> {
  await refreshBuildingPropertiesInto(ctx, x, y);

  // Must come after the refresh lands: setDetails re-marks a lazy tab 'loaded'
  // whenever the carried-forward data is non-empty (building-store.ts:197-200),
  // which would undo an earlier invalidation.
  useBuildingStore.getState().invalidateTabs(CONNECTION_TABS);
}

// ── Trade Connect / Disconnect ──────────────────────────────────────────────

async function tradeConnect(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse, kind: string): Promise<void> {
  const actionId = `tradeConnect:${kind}`;
  const kindLabel = kind === '4' ? 'stores' : kind === '2' ? 'factories' : 'warehouses';
  useBuildingStore.getState().addInFlightAction(actionId);
  const pendingToastId = showToast(`Connecting all your ${kindLabel}...`, 'info');
  try {
    const success = await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RDOConnectToTycoon', '0', { kind });
    dismissToast(pendingToastId);
    if (success) {
      // Deliberately not "Connected all your X": the server connects only the
      // facilities whose input accepts a tradeable fluid this building outputs
      // (Kernel/Kernel.pas:4537-4554), and connecting none of them is a normal
      // outcome. Nothing on the wire reports how many were wired, so the
      // notification claims only what we know — that the request went out. The
      // refreshed list below is what actually answers the question.
      ctx.showNotification(`Sent connect request for your ${kindLabel}`, 'success');
      await refreshAfterConnectionChange(ctx, buildingDetails.x, buildingDetails.y);
    } else {
      ctx.showNotification(`Failed to connect ${kindLabel}`, 'error');
    }
  } catch (err: unknown) {
    dismissToast(pendingToastId);
    ctx.showNotification(`Connection failed: ${toErrorMessage(err)}`, 'error');
  } finally {
    useBuildingStore.getState().removeInFlightAction(actionId);
  }
}

async function tradeDisconnect(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse, kind: string): Promise<void> {
  const actionId = `tradeDisconnect:${kind}`;
  const kindLabel = kind === '4' ? 'stores' : kind === '2' ? 'factories' : 'warehouses';
  useBuildingStore.getState().addInFlightAction(actionId);
  const pendingToastId = showToast(`Disconnecting all your ${kindLabel}...`, 'info');
  try {
    const success = await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RDODisconnectFromTycoon', '0', { kind });
    dismissToast(pendingToastId);
    if (success) {
      // Same reservation as tradeConnect: the count is not observable.
      ctx.showNotification(`Sent disconnect request for your ${kindLabel}`, 'success');
      await refreshAfterConnectionChange(ctx, buildingDetails.x, buildingDetails.y);
    } else {
      ctx.showNotification(`Failed to disconnect ${kindLabel}`, 'error');
    }
  } catch (err: unknown) {
    dismissToast(pendingToastId);
    ctx.showNotification(`Disconnection failed: ${toErrorMessage(err)}`, 'error');
  } finally {
    useBuildingStore.getState().removeInFlightAction(actionId);
  }
}

// ── Manual Connect Mode ─────────────────────────────────────────────────────

/**
 * One mode, two origins (N10): the inspector's connectMap and the picker's
 * "Pick on map" both land here. The mode bar (use-mode-descriptor) announces
 * it — no entry toast — and the sheet stack hides itself while it runs, so
 * whatever surface started the pick comes back untouched when it ends.
 */
function startConnectMode(ctx: ClientHandlerContext, source: { x: number; y: number }, subject: string): void {
  ctx.isConnectMode = true;
  ctx.connectSourceBuilding = { x: source.x, y: source.y };
  useUiStore.getState().setConnectMode(true, subject);
  // On a phone the mode lives on the map tab — the sheet is hidden by the store flag
  useUiStore.getState().setMobileTab('map');

  const renderer = ctx.getRenderer();
  if (renderer) {
    renderer.setConnectMode(true);
    renderer.setConnectModeCallback((targetX: number, targetY: number) => {
      executeConnectFacilities(ctx, targetX, targetY);
    });
  }

  ctx.connectKeyboardHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && ctx.isConnectMode) {
      // The mode OWNS this Escape. This document listener runs before the
      // window-level useKeyboardShortcuts one; once the mode is cancelled the
      // store flag is already false, so without stopping the event here the
      // hook would see a free keyboard and pop a surface of the restored
      // stack on the SAME keypress (found by the N10 live QA).
      e.stopPropagation();
      e.preventDefault();
      cancelConnectMode(ctx);
    }
  };
  document.addEventListener('keydown', ctx.connectKeyboardHandler);
}

/** The picker's "Pick on map" — same mode, sourced from the picker's building. */
export function startConnectModeFromPicker(ctx: ClientHandlerContext): void {
  const picker = useBuildingStore.getState().connectionPicker;
  if (!picker) return;
  startConnectMode(ctx, { x: picker.buildingX, y: picker.buildingY }, picker.fluidName);
}

export function cancelConnectMode(ctx: ClientHandlerContext): void {
  ctx.isConnectMode = false;
  ctx.connectSourceBuilding = null;
  useUiStore.getState().setConnectMode(false);

  const renderer = ctx.getRenderer();
  if (renderer) {
    renderer.setConnectMode(false);
    renderer.setConnectModeCallback(null);
  }

  if (ctx.connectKeyboardHandler) {
    document.removeEventListener('keydown', ctx.connectKeyboardHandler);
    ctx.connectKeyboardHandler = null;
  }
}

async function executeConnectFacilities(ctx: ClientHandlerContext, targetX: number, targetY: number): Promise<void> {
  if (!ctx.connectSourceBuilding) return;
  const source = ctx.connectSourceBuilding;

  try {
    const req = {
      type: WsMessageType.REQ_CONNECT_FACILITIES,
      sourceX: source.x,
      sourceY: source.y,
      targetX,
      targetY,
    };
    const resp = await ctx.sendRequest(req) as WsMessage & { success: boolean; resultMessage: string };

    if (resp.resultMessage) {
      const displayMsg = resp.resultMessage.replace(/\n/g, ' | ');
      ctx.showNotification(displayMsg, resp.success ? 'success' : 'error');
    } else {
      ctx.showNotification(
        resp.success ? 'Buildings connected successfully' : 'Connection failed',
        resp.success ? 'success' : 'error',
      );
    }

    refreshBuildingDetails(ctx, source.x, source.y);
  } catch (err: unknown) {
    ctx.showNotification(`Connection failed: ${toErrorMessage(err)}`, 'error');
  } finally {
    cancelConnectMode(ctx);
  }
}

// ── Clone Facility ──────────────────────────────────────────────────────────

export async function cloneFacility(ctx: ClientHandlerContext, x: number, y: number, options: number): Promise<void> {
  ClientBridge.log('Clone', `Cloning settings at (${x}, ${y}) with options=0x${options.toString(16)}`);

  try {
    const req: WsReqCloneFacility = {
      type: WsMessageType.REQ_CLONE_FACILITY,
      x, y, options,
    };

    const response = await ctx.sendRequest(req) as WsRespCloneFacility;

    if (response.success) {
      ctx.showNotification('Clone settings applied successfully', 'success');
    } else {
      ctx.showNotification('Failed to apply clone settings', 'error');
    }
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to clone facility: ${toErrorMessage(err)}`);
    ctx.showNotification('Failed to apply clone settings', 'error');
  }
}

// ── Movie Actions ───────────────────────────────────────────────────────────

/**
 * `params` comes from FilmLaunchForm, already validated there (title, a
 * finite budget, months within FILM_MONTHS_MIN..FILM_MONTHS_MAX). This is the
 * second line of defence for a caller that bypasses the form — never send a
 * budget/months pair that could reach the gateway as `NaN`.
 */
async function launchMovie(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse, params?: Record<string, string>): Promise<void> {
  if (!params || !Number.isFinite(Number(params.budget)) || parseFilmMonths(params.months) === null) {
    ctx.showNotification('Launch refused: invalid budget or months', 'error');
    return;
  }

  try {
    const ok = await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RDOLaunchMovie', '0', params);
    if (ok) {
      ctx.showNotification(`Launching movie: ${params.filmName}`, 'success');
      refreshBuildingDetails(ctx, buildingDetails.x, buildingDetails.y);
    } else {
      ctx.showNotification('Failed to launch movie', 'error');
    }
  } catch (err: unknown) {
    ctx.showNotification(`Failed to launch movie: ${toErrorMessage(err)}`, 'error');
  }
}

async function cancelMovie(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse): Promise<void> {
  if (!confirm('Cancel current movie production?')) return;
  try {
    const ok = await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RDOCancelMovie', '0');
    if (ok) {
      ctx.showNotification('Movie production cancelled', 'success');
      refreshBuildingDetails(ctx, buildingDetails.x, buildingDetails.y);
    } else {
      ctx.showNotification('Failed to cancel movie', 'error');
    }
  } catch (err: unknown) {
    ctx.showNotification(`Failed to cancel movie: ${toErrorMessage(err)}`, 'error');
  }
}

async function releaseMovie(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse): Promise<void> {
  try {
    const ok = await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RDOReleaseMovie', '0');
    if (ok) {
      ctx.showNotification('Movie released', 'success');
      refreshBuildingDetails(ctx, buildingDetails.x, buildingDetails.y);
    } else {
      ctx.showNotification('Failed to release movie', 'error');
    }
  } catch (err: unknown) {
    ctx.showNotification(`Failed to release movie: ${toErrorMessage(err)}`, 'error');
  }
}

// ── Politics Inline Actions ─────────────────────────────────────────────────

async function voteForCandidate(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse): Promise<void> {
  const votesData = buildingDetails.groups['votes'];
  if (!votesData) {
    ctx.showNotification('No voting data available', 'error');
    return;
  }

  const candidateNames: string[] = [];
  for (const prop of votesData) {
    if (prop.name.startsWith('Candidate') && !prop.name.includes('Count')) {
      const match = prop.name.match(/^Candidate(\d+)$/);
      if (match && prop.value) {
        candidateNames.push(prop.value);
      }
    }
  }

  if (candidateNames.length === 0) {
    ctx.showNotification('No candidates available', 'error');
    return;
  }

  const candidateChoice = prompt(
    `Vote for a candidate:\n${candidateNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\nEnter candidate number:`
  );
  if (!candidateChoice) return;

  const idx = parseInt(candidateChoice, 10) - 1;
  if (idx < 0 || idx >= candidateNames.length) {
    ctx.showNotification('Invalid candidate number', 'error');
    return;
  }

  const candidateName = candidateNames[idx];
  const voteReq: WsReqPoliticsVote = {
    type: WsMessageType.REQ_POLITICS_VOTE,
    buildingX: buildingDetails.x,
    buildingY: buildingDetails.y,
    candidateName,
  };
  ctx.rawSend(voteReq);
  ctx.showNotification(`Voted for ${candidateName}`, 'success');
}

async function banMinister(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse): Promise<void> {
  const ministryIdStr = prompt('Ministry ID to depose minister from:');
  if (!ministryIdStr) return;
  try {
    await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RDOBanMinister', '0', {
      ministryId: ministryIdStr,
    });
    ctx.showNotification('Minister deposed', 'success');
    refreshBuildingDetails(ctx, buildingDetails.x, buildingDetails.y);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to depose minister: ${toErrorMessage(err)}`, 'error');
  }
}

async function sitMinister(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse): Promise<void> {
  const ministryIdStr = prompt('Ministry ID to appoint minister for:');
  if (!ministryIdStr) return;
  const ministerName = prompt('Minister name to appoint:');
  if (!ministerName) return;
  try {
    await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RDOSitMinister', '0', {
      ministryId: ministryIdStr,
      ministerName,
    });
    ctx.showNotification(`${ministerName} appointed as minister`, 'success');
    refreshBuildingDetails(ctx, buildingDetails.x, buildingDetails.y);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to appoint minister: ${toErrorMessage(err)}`, 'error');
  }
}

function electMayorInline(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse, rowData: Record<string, string>): void {
  const townName = rowData['Town'];
  if (!townName) {
    ctx.showNotification('No town selected', 'error');
    return;
  }
  useUiStore.getState().requestPrompt(
    `Elect Mayor of ${townName}`,
    `Enter username to elect as mayor of ${townName}:`,
    async (playerName: string) => {
      try {
        const success = await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RDOSitMayor', playerName, {
          townName,
          index: rowData['_index'] ?? '0',
        });
        if (success) {
          ctx.showNotification(`${playerName} elected as mayor of ${townName}`, 'success');
          setTimeout(() => refreshBuildingDetails(ctx, buildingDetails.x, buildingDetails.y), 1000);
        } else {
          ctx.showNotification(`Failed to elect mayor of ${townName}`, 'error');
        }
      } catch (err: unknown) {
        ctx.showNotification(`Failed to elect mayor: ${toErrorMessage(err)}`, 'error');
      }
    },
  );
}

function electMinisterInline(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse, rowData: Record<string, string>): void {
  const ministryId = rowData['MinistryId'];
  if (!ministryId) {
    ctx.showNotification('No ministry selected', 'error');
    return;
  }
  const ministryName = rowData['Ministry'] || `Ministry ${ministryId}`;
  useUiStore.getState().requestPrompt(
    `Appoint ${ministryName}`,
    `Enter username to appoint as ${ministryName}:`,
    async (playerName: string) => {
      try {
        const success = await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RDOSitMinister', '0', {
          ministryId,
          ministerName: playerName,
          index: rowData['_index'] ?? '0',
        });
        if (success) {
          ctx.showNotification(`${playerName} appointed as ${ministryName}`, 'success');
          setTimeout(() => refreshBuildingDetails(ctx, buildingDetails.x, buildingDetails.y), 1000);
        } else {
          ctx.showNotification(`Failed to appoint ${playerName}`, 'error');
        }
      } catch (err: unknown) {
        ctx.showNotification(`Failed to appoint minister: ${toErrorMessage(err)}`, 'error');
      }
    },
  );
}

async function deposeMinisterInline(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse, rowData: Record<string, string>): Promise<void> {
  const ministryId = rowData['MinistryId'];
  if (!ministryId) {
    ctx.showNotification('No ministry selected', 'error');
    return;
  }
  try {
    const success = await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RDOBanMinister', '0', {
      ministryId,
      index: rowData['_index'] ?? '0',
    });
    if (success) {
      ctx.showNotification('Minister deposed', 'success');
      setTimeout(() => refreshBuildingDetails(ctx, buildingDetails.x, buildingDetails.y), 1000);
    } else {
      ctx.showNotification('Failed to depose minister', 'error');
    }
  } catch (err: unknown) {
    ctx.showNotification(`Failed to depose minister: ${toErrorMessage(err)}`, 'error');
  }
}

async function voteForCandidateInline(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse, rowData: Record<string, string>): Promise<void> {
  const candidateName = rowData['Candidate'];
  if (!candidateName) {
    ctx.showNotification('No candidate selected', 'error');
    return;
  }
  const voteReq: WsReqPoliticsVote = {
    type: WsMessageType.REQ_POLITICS_VOTE,
    buildingX: buildingDetails.x,
    buildingY: buildingDetails.y,
    candidateName,
  };

  // This used to `rawSend` and announce success in the same breath, so a vote
  // that never left the gateway — no CurrBlock at those coordinates, no
  // construction socket — was reported to the player as cast.
  try {
    const resp = (await ctx.sendRequest(voteReq)) as WsRespPoliticsVote;
    if (!resp.success) {
      ctx.showNotification(resp.message || 'Vote could not be cast', 'error');
      return;
    }
    // Deliberately "Vote sent", not "Voted": RDOVote is a procedure and answers
    // nothing, and the server drops the ballot in silence unless the voter pays
    // taxes in this town (`Kernel/TownPolitics.pas:405`). Success here means the
    // frame was written, which is all anyone downstream can know.
    ctx.showNotification(`Vote sent for ${candidateName}`, 'success');
  } catch (err: unknown) {
    ctx.showNotification(`Vote failed: ${toErrorMessage(err)}`, 'error');
    return;
  }
  // Delay refresh to allow void push ("*") to be processed by the server
  setTimeout(() => refreshBuildingDetails(ctx, buildingDetails.x, buildingDetails.y), 500);
}

// ── Repair Actions ──────────────────────────────────────────────────────────

async function startRepair(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse): Promise<void> {
  try {
    await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RdoRepair', '0');
    ctx.showNotification('Repair started', 'success');
    refreshBuildingDetails(ctx, buildingDetails.x, buildingDetails.y);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to start repair: ${toErrorMessage(err)}`, 'error');
  }
}

async function stopRepair(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse): Promise<void> {
  try {
    await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RdoStopRepair', '0');
    ctx.showNotification('Repair stopped', 'success');
    refreshBuildingDetails(ctx, buildingDetails.x, buildingDetails.y);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to stop repair: ${toErrorMessage(err)}`, 'error');
  }
}

// ── Research Actions ────────────────────────────────────────────────────────

export function loadResearchInventory(ctx: ClientHandlerContext, buildingX: number, buildingY: number, categoryIndex: number): void {
  useBuildingStore.getState().setResearchLoading('inventory', true);
  ctx.sendMessage({
    type: WsMessageType.REQ_RESEARCH_INVENTORY,
    buildingX,
    buildingY,
    categoryIndex,
  });
}

export function getResearchDetails(ctx: ClientHandlerContext, buildingX: number, buildingY: number, inventionId: string): void {
  useBuildingStore.getState().setResearchSelectedInvention(inventionId);
  useBuildingStore.getState().setResearchLoading('details', true);
  ctx.sendMessage({
    type: WsMessageType.REQ_RESEARCH_DETAILS,
    buildingX,
    buildingY,
    inventionId,
  });
}

async function queueResearch(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse): Promise<void> {
  const inventionId = useBuildingStore.getState().research?.selectedInventionId;
  if (!inventionId) {
    ctx.showNotification('Select an invention to research first', 'info');
    return;
  }
  try {
    await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RDOQueueResearch', '0',
      { inventionId, priority: '10' },
    );
    ctx.showNotification('Research queued', 'success');
    const activeCat = useBuildingStore.getState().research?.activeCategoryIndex ?? 0;
    loadResearchInventory(ctx, buildingDetails.x, buildingDetails.y, activeCat);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to queue research: ${toErrorMessage(err)}`, 'error');
  }
}

async function cancelResearch(ctx: ClientHandlerContext, buildingDetails: BuildingDetailsResponse): Promise<void> {
  const inventionId = useBuildingStore.getState().research?.selectedInventionId;
  if (!inventionId) {
    ctx.showNotification('Select an invention to cancel first', 'info');
    return;
  }
  try {
    await setBuildingProperty(ctx, buildingDetails.x, buildingDetails.y, 'RDOCancelResearch', '0',
      { inventionId },
    );
    ctx.showNotification('Research cancelled', 'success');
    const activeCat = useBuildingStore.getState().research?.activeCategoryIndex ?? 0;
    loadResearchInventory(ctx, buildingDetails.x, buildingDetails.y, activeCat);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to cancel research: ${toErrorMessage(err)}`, 'error');
  }
}

export async function queueResearchDirect(ctx: ClientHandlerContext, buildingX: number, buildingY: number, inventionId: string): Promise<void> {
  try {
    await setBuildingProperty(ctx, buildingX, buildingY, 'RDOQueueResearch', '0', { inventionId, priority: '10' });
    ctx.showNotification('Research queued', 'success');
    const activeCat = useBuildingStore.getState().research?.activeCategoryIndex ?? 0;
    loadResearchInventory(ctx, buildingX, buildingY, activeCat);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to queue research: ${toErrorMessage(err)}`, 'error');
  }
}

export async function cancelResearchDirect(ctx: ClientHandlerContext, buildingX: number, buildingY: number, inventionId: string): Promise<void> {
  try {
    await setBuildingProperty(ctx, buildingX, buildingY, 'RDOCancelResearch', '0', { inventionId });
    ctx.showNotification('Research cancelled', 'success');
    const activeCat = useBuildingStore.getState().research?.activeCategoryIndex ?? 0;
    loadResearchInventory(ctx, buildingX, buildingY, activeCat);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to cancel research: ${toErrorMessage(err)}`, 'error');
  }
}

export async function fetchResearchCategoryTabs(): Promise<void> {
  try {
    const resp = await fetch('/api/research-inventions');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json() as { categoryTabs?: string[] };
    useBuildingStore.getState().setResearchCategoryTabs(data.categoryTabs ?? []);
  } catch (err: unknown) {
    console.warn('[Client] Failed to fetch category tabs:', toErrorMessage(err));
    useBuildingStore.getState().setResearchCategoryTabs(
      ['GENERAL', 'COMMERCE', 'REAL ESTATE', 'INDUSTRY', 'CIVICS'],
    );
  }
}

// ── Connection Picker ───────────────────────────────────────────────────────

export function searchConnections(
  ctx: ClientHandlerContext,
  buildingX: number,
  buildingY: number,
  fluidId: string,
  direction: 'input' | 'output',
  filters?: { company?: string; town?: string; maxResults?: number; roles?: number; sortMode?: number }
): void {
  const req: WsReqSearchConnections = {
    type: WsMessageType.REQ_SEARCH_CONNECTIONS,
    buildingX,
    buildingY,
    fluidId,
    direction,
    filters,
  };
  ctx.rawSend(req);
}

/**
 * Ask the gateway which of the results already on screen share a road circuit
 * with the searching building — the enrichment the ASP pages did through
 * `NearCircuits`/`Intercept` (issue #584). Sent only after the list itself is
 * on screen, so the enrichment never blocks the results from rendering.
 */
export function requestConnectionReachability(
  ctx: ClientHandlerContext,
  picker: { buildingX: number; buildingY: number; fluidId: string; direction: 'input' | 'output'; results: Array<{ x: number; y: number }> },
): void {
  if (picker.results.length === 0) return;
  const req: WsReqConnectionReachability = {
    type: WsMessageType.REQ_CONNECTION_REACHABILITY,
    buildingX: picker.buildingX,
    buildingY: picker.buildingY,
    fluidId: picker.fluidId,
    direction: picker.direction,
    candidates: picker.results.map(r => ({ x: r.x, y: r.y })),
  };
  ctx.rawSend(req);
}

export async function connectFacilities(
  ctx: ClientHandlerContext,
  buildingX: number,
  buildingY: number,
  fluidId: string,
  direction: 'input' | 'output',
  selectedCoords: Array<{ x: number; y: number }>
): Promise<void> {
  if (selectedCoords.length === 0) return;

  // Delphi ParseGateList splits on commas but never adds the token AFTER the last
  // comma — a trailing comma is mandatory so the final Y coordinate is captured.
  // Voyager ref: SupplySheetForm.pas:898-900 — always appends trailing ','
  const connectionList = selectedCoords.map(c => `${c.x},${c.y},`).join('');
  const rdoCommand = direction === 'input' ? 'RDOConnectInput' : 'RDOConnectOutput';

  try {
    await setBuildingProperty(ctx, buildingX, buildingY, rdoCommand, '0', {
      fluidId,
      connectionList,
    }, connectionPendingKey(rdoCommand, fluidId));

    showToast(
      `${selectedCoords.length} ${direction === 'input' ? 'supplier' : 'client'}${selectedCoords.length !== 1 ? 's' : ''} connected.`,
      'success',
      { title: 'Connected' },
    );

    // Lightweight refresh — building is already focused, skip SwitchFocusEx.
    // EVENT_BUILDING_REFRESH (~5s) will refresh lazy tabs naturally.
    const visualClass = ctx.currentFocusedVisualClass || '0';
    const refreshedDetails = await requestBuildingRefreshProperties(ctx, buildingX, buildingY, visualClass);
    if (refreshedDetails) {
      ClientBridge.updateBuildingDetails(refreshedDetails);
    }
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to connect: ${toErrorMessage(err)}`);
    ctx.showNotification('Failed to connect facilities', 'error');
  }
}
