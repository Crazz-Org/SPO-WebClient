/**
 * Building details handler — extracted from StarpeaceSession.
 *
 * Supports lazy tab loading: `getBuildingBasicDetails` fetches lightweight
 * building info (Phase 1+2), while `getBuildingTabData` fetches heavy
 * tab-specific data (supplies, products, compInputs, warehouseWares) on demand.
 *
 * An `ActiveInspector` keeps the Delphi temp object alive between tab requests.
 * An `AsyncMutex` serializes SetPath calls on the same object to prevent
 * state corruption from concurrent tab clicks.
 */

import type { SessionContext } from './session-context';
import { grantAccess } from '../../shared/security-id';
import type {
  BuildingDetailsResponse,
  BuildingPropertyValue,
  BuildingSupplyData,
  BuildingProductData,
  BuildingConnectionData,
  CompInputData,
  WarehouseWareData,
} from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import {
  getTemplateForVisualClass,
  collectTemplatePropertyNamesStructured,
  collectTemplatePropertyNamesForGroups,
  collectHeaderPropertyNames,
  isGateTab,
} from '../../shared/building-details';
import type { CollectedPropertyNames } from '../../shared/building-details';
import { cleanPayload as cleanPayloadHelper, parsePropertyResponse as parsePropertyResponseHelper } from '../rdo-helpers';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall, rdoGet } from '../../shared/rdo-frame';
import { toErrorMessage } from '../../shared/error-utils';

// =========================================================================
// ASYNC MUTEX — serializes SetPath calls on a shared Delphi temp object
// =========================================================================

export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => { resolve(() => this.release()); });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

// =========================================================================
// ACTIVE INSPECTOR — keeps Delphi temp object alive between tab requests
// =========================================================================

export interface ActiveInspector {
  tempObjectId: string;
  x: number;
  y: number;
  visualClass: string;
  mutex: AsyncMutex;
  gateMap: string;
  /** Cached template for tab-to-special mapping. */
  hasSupplies: boolean;
  hasProducts: boolean;
  hasCompInputs: boolean;
  isWarehouse: boolean;
}

/** Per-session active inspector keyed by session context. */
const activeInspectors = new WeakMap<SessionContext, ActiveInspector>();

/**
 * Release the active inspector's Delphi temp object.
 * Called on building deselect, new building select, or session disconnect.
 */
export function releaseInspector(ctx: SessionContext): void {
  const inspector = activeInspectors.get(ctx);
  if (inspector) {
    ctx.log.debug(`[BuildingDetails] Releasing inspector object ${inspector.tempObjectId} at (${inspector.x},${inspector.y})`);
    ctx.cacherCloseObject(inspector.tempObjectId);
    activeInspectors.delete(ctx);
  }
}

/**
 * Get the active inspector's Delphi temp object id (if an inspector is open).
 * Used by the cacher KeepAlive timer — the legacy client keep-alives the
 * TCachedObjectWrap temp object (ObjectInspectorHandleViewer.pas:1172-1180),
 * NOT the TCacheServer root (which publishes no KeepAlive).
 */
export function getActiveInspectorTempObjectId(ctx: SessionContext): string | undefined {
  return activeInspectors.get(ctx)?.tempObjectId;
}

/**
 * Get the active inspector for a session (if any, and if coordinates match).
 */
export function getActiveInspector(ctx: SessionContext, x: number, y: number): ActiveInspector | undefined {
  const inspector = activeInspectors.get(ctx);
  if (inspector && inspector.x === x && inspector.y === y) {
    return inspector;
  }
  return undefined;
}

/**
 * Test-only: insert an ActiveInspector into the WeakMap so tests can
 * exercise releaseInspector / getActiveInspector without going through
 * the full RDO pipeline.
 * @internal Exported for unit tests only — do not use in production code.
 */
export function setActiveInspectorForTest(ctx: SessionContext, inspector: ActiveInspector): void {
  activeInspectors.set(ctx, inspector);
}

/**
 * Create an ActiveInspector on-the-fly for a building.
 * Used as a fallback whenever a lazy request finds no inspector for the
 * building — a released or stale one, or a tab asked for before the basic
 * fetch registered its inspector. Only creates the Delphi temp object +
 * determines tab capabilities — does NOT fetch properties.
 */
async function createInspectorForBuilding(
  ctx: SessionContext,
  x: number,
  y: number,
  visualClass: string,
): Promise<ActiveInspector> {
  // Release any stale inspector
  releaseInspector(ctx);

  await ctx.connectMapService();
  if (!ctx.cacherId) {
    throw new Error('Map service not initialized');
  }

  const template = getTemplateForVisualClass(visualClass);
  const tempObjectId = await ctx.cacherCreateObject();

  try {
    await ctx.cacherSetObject(tempObjectId, x, y);

    // Fetch GateMap (lightweight — single property). The building class disables
    // gates on any facility, not just warehouses (Voyager/SupplySheetForm.pas:382,
    // Voyager/ProdSheetForm.pas:324) — warehouse wares also key off it.
    let gateMap = '';
    const isWarehouse = template.groups.some(g => g.id === 'whGeneral');
    try {
      const vals = await ctx.cacherGetPropertyList(tempObjectId, ['GateMap']);
      gateMap = vals[0] || '';
    } catch {
      // Non-critical — every gate/ware will just show as enabled
    }

    const inspector: ActiveInspector = {
      tempObjectId,
      x,
      y,
      visualClass,
      mutex: new AsyncMutex(),
      gateMap,
      hasSupplies: template.groups.some(g => g.special === 'supplies'),
      hasProducts: template.groups.some(g => g.special === 'products'),
      hasCompInputs: template.groups.some(g => g.special === 'compInputs'),
      isWarehouse,
    };

    activeInspectors.set(ctx, inspector);
    ctx.log.debug(`[BuildingDetails] On-demand inspector created: obj=${tempObjectId} at (${x},${y})`);
    return inspector;
  } catch (e: unknown) {
    // Close temp object to prevent Delphi-side leak
    ctx.cacherCloseObject(tempObjectId);
    throw e;
  }
}

// =========================================================================
// PUBLIC API
// =========================================================================

/**
 * Lazy Phase 1+2: Fetch basic building details (properties, tabs, moneyGraph).
 * Keeps the Delphi temp object alive as an ActiveInspector for subsequent
 * tab-specific requests via `getBuildingTabData`.
 */
export async function getBuildingBasicDetails(
  ctx: SessionContext,
  x: number,
  y: number,
  visualClass: string
): Promise<BuildingDetailsResponse> {
  // ALWAYS release the previous inspector — even for the same building.
  // A new temp object will be created below, so the old one must be closed
  // to prevent Delphi-side resource leaks.
  releaseInspector(ctx);

  ctx.log.debug(`[BuildingDetails] Basic details for (${x},${y}), vc=${visualClass}`);

  const template = getTemplateForVisualClass(visualClass);

  // Focus building
  let buildingName = '';
  let ownerName = '';
  let buildingId = '';
  try {
    const focusInfo = await ctx.focusBuilding(x, y);
    buildingName = focusInfo.buildingName;
    ownerName = focusInfo.ownerName;
    buildingId = focusInfo.buildingId;
  } catch (e: unknown) {
    ctx.log.warn(`[BuildingDetails] Could not focus building:`, e);
  }

  // Connect to map service
  await ctx.connectMapService();
  if (!ctx.cacherId) {
    throw new Error('Map service not initialized');
  }

  // Create temporary object for property queries
  const tempObjectId = await ctx.cacherCreateObject();

  try {
    await ctx.cacherSetObject(tempObjectId, x, y);

    // Phase 1+2: the OPENING read only — the header fields plus the first
    // group, the one the inspector shows before the user picks anything. Every
    // other group is read by `getBuildingTabData` when its menu entry is
    // opened. Reading the whole template here is what made the panel slow: a
    // civic or industry template expands to hundreds of indexed properties in
    // phase 2, paid for on every click on the map.
    const { allValues, groups, moneyGraph } = await fetchPropertiesAndGroups(
      ctx, tempObjectId, template, collectHeaderPropertyNames(template),
    );

    // Enrich votes tab
    await enrichVotesTab(ctx, groups, allValues);

    // Enrich upgrade tab — AcceptCloning is not a cached property
    await enrichUpgradeTab(ctx, groups, allValues);

    // Determine which special tabs exist
    const hasSupplies = template.groups.some(g => g.special === 'supplies');
    const hasProducts = template.groups.some(g => g.special === 'products');
    const hasCompInputs = template.groups.some(g => g.special === 'compInputs');
    const isWarehouse = template.groups.some(g => g.id === 'whGeneral');

    // Eagerly fetch warehouse ware names — lightweight (~2 RDO calls) and needed
    // immediately by the General tab's WARE_CHECKLIST. Without this, the entire
    // General tab was blocked behind a lazy skeleton for ~8 seconds.
    let warehouseWares: WarehouseWareData[] | undefined;
    if (isWarehouse) {
      try {
        warehouseWares = await getWarehouseWareNames(ctx, tempObjectId, allValues.get('GateMap') || '');
      } catch (e: unknown) {
        ctx.log.warn('[BuildingDetails] Failed to fetch warehouse wares eagerly:', toErrorMessage(e));
      }
    }

    // Store as active inspector (keep temp object alive)
    const inspector: ActiveInspector = {
      tempObjectId,
      x,
      y,
      visualClass,
      mutex: new AsyncMutex(),
      gateMap: allValues.get('GateMap') || '',
      hasSupplies,
      hasProducts,
      hasCompInputs,
      isWarehouse,
    };
    activeInspectors.set(ctx, inspector);

    const response: BuildingDetailsResponse = {
      buildingId: buildingId || allValues.get('ObjectId') || allValues.get('CurrBlock') || '',
      x,
      y,
      visualClass,
      templateName: template.name,
      buildingName,
      ownerName,
      securityId: allValues.get('SecurityId') || '',
      // Decided here: only the session holds the requester half, and it is the
      // InitClient proxy id (a pointer), never ctx.tycoonId.
      canGovern: grantAccess(String(ctx.fTycoonProxyId ?? ''), allValues.get('SecurityId') || ''),
      tabs: template.groups.map(g => ({
        id: g.id,
        name: g.name,
        icon: g.icon || '',
        order: g.order,
        special: g.special,
        handlerName: g.handlerName || '',
      })),
      groups,
      // Lazy: supplies/products/compInputs not fetched yet (heavy RDO iteration)
      supplies: undefined,
      products: undefined,
      compInputs: undefined,
      // warehouseWares fetched eagerly above (lightweight, needed by General tab)
      warehouseWares,
      moneyGraph,
      timestamp: Date.now(),
    };

    return response;
  } catch (e: unknown) {
    // On error, clean up the temp object
    ctx.cacherCloseObject(tempObjectId);
    activeInspectors.delete(ctx);
    throw e;
  }
}

/**
 * Lazy Phase 3+4: Fetch tab-specific data using the active inspector's temp object.
 * Serialized via mutex to prevent SetPath race conditions.
 *
 * If no ActiveInspector exists (released, stale, or never registered), one is
 * created on-the-fly so tab data still works.
 */
export async function getBuildingTabData(
  ctx: SessionContext,
  x: number,
  y: number,
  tabId: string,
  visualClass?: string,
  groupIds?: string[],
): Promise<{
  supplies?: BuildingSupplyData[];
  products?: BuildingProductData[];
  compInputs?: CompInputData[];
  warehouseWares?: WarehouseWareData[];
  groups?: { [groupId: string]: BuildingPropertyValue[] };
}> {
  let inspector = getActiveInspector(ctx, x, y);

  // Fallback: create an inspector on-the-fly when none exists
  // (happens when building was loaded via the legacy full-fetch path).
  if (!inspector) {
    ctx.log.debug(`[BuildingDetails] Creating on-demand inspector for (${x},${y}), tab=${tabId}`);
    inspector = await createInspectorForBuilding(ctx, x, y, visualClass || '0');
  }

  const { tempObjectId, mutex, gateMap } = inspector;
  const release = await mutex.acquire();

  try {
    // Reset the temp object back to building root. A previous tab data request
    // (products/supplies) may have called SetPath, leaving the object pointed
    // at a gate sub-path. Without this reset, GetInputNames/GetOutputNames
    // reads from the wrong context and returns empty results.
    await ctx.cacherSetObject(tempObjectId, x, y);

    ctx.log.debug(`[BuildingDetails] Tab data for (${x},${y}), tab=${tabId}`);

    // Template groups the opening read skipped. `collectTemplatePropertyNamesForGroups`
    // always folds the first group back in, so the header refreshes for free on
    // every section the user opens.
    if (groupIds && groupIds.length > 0) {
      const template = getTemplateForVisualClass(visualClass || '0');
      const { allValues, groups } = await fetchPropertiesAndGroups(
        ctx, tempObjectId, template,
        collectTemplatePropertyNamesForGroups(template, groupIds),
      );
      await enrichVotesTab(ctx, groups, allValues);
      await enrichUpgradeTab(ctx, groups, allValues);
      return { groups };
    }

    // Supplies and Products are the same read with a different gate spec: list
    // the gates, and stop. Nothing about a gate — not its header, not its
    // connection rows — is read until the user opens it, and then both arrive
    // together through `getBuildingGateConnections`.
    if (tabId === 'supplies' && inspector.hasSupplies) {
      const supplies = await listGates(
        ctx, tempObjectId, gateMap, inspector.isWarehouse, SUPPLY_GATES,
      );
      // For warehouses, also return warehouseWares so the client can filter
      // supplies by GateMap (only show enabled wares).
      if (inspector.isWarehouse) {
        const warehouseWares = await getWarehouseWareNames(ctx, tempObjectId, gateMap);
        return { supplies, warehouseWares };
      }
      return { supplies };
    }

    if (tabId === 'products' && inspector.hasProducts) {
      const products = await listGates(
        ctx, tempObjectId, gateMap, inspector.isWarehouse, PRODUCT_GATES,
      );
      // For warehouses, also return warehouseWares so the client can filter
      // products by GateMap (only show enabled wares).
      if (inspector.isWarehouse) {
        const warehouseWares = await getWarehouseWareNames(ctx, tempObjectId, gateMap);
        return { products, warehouseWares };
      }
      return { products };
    }

    if (tabId === 'compInputs' && inspector.hasCompInputs) {
      const compInputs = await fetchCompInputData(ctx, tempObjectId);
      return { compInputs };
    }

    // whGeneral warehouseWares is now fetched eagerly in getBuildingBasicDetails.
    // No lazy handler needed — fall through to empty return.

    // Tab doesn't need lazy data (already in basic response)
    return {};
  } finally {
    release();
  }
}

/**
 * Lightweight refresh: re-read building-level properties on the SAME
 * Delphi temp object, without creating a new one (`cacherCreateObject`) and
 * without re-focusing the building.
 *
 * It DOES call `cacherSetObject`, and that call is the whole point — the
 * earlier claim that it did not was wrong and, taken at face value, describes
 * a refresh that can never see new data. `SetObject` is the only door through
 * which a stale cached object is re-pulled from the model server: it lands in
 * `TCachedObjectWrap.SetToObject`, which compares `ppLastMod` against the
 * object's `ppTTL` and calls `UpdateCache` when it has lapsed
 * (`Cache/CachedObjectWrap.pas:305-343`). Drop the call to match the old
 * comment and the panel goes permanently blind: `GetPropertyList` would keep
 * serving whatever snapshot the object was opened on. The reset to building
 * root — a previous tab request may have left the object on a gate sub-path —
 * is the second reason it is there.
 *
 * `TObjectInspectorContainer.Refresh` is the Voyager analogue, but not the same
 * mechanism: it calls `TCachedObjectWrap.Refresh`, which only re-reads the
 * cache file from disk (`:297-303`) and never asks the model server.
 *
 * Falls back to getBuildingBasicDetails() if no ActiveInspector exists
 * (e.g., first load or after session reconnect).
 */
export async function refreshBuildingProperties(
  ctx: SessionContext,
  x: number,
  y: number,
  visualClass: string,
  activeTabId?: string,
): Promise<BuildingDetailsResponse> {
  const inspector = getActiveInspector(ctx, x, y);

  if (!inspector) {
    ctx.log.debug(`[BuildingDetails] No active inspector for (${x},${y}), falling back to full fetch`);
    return getBuildingBasicDetails(ctx, x, y, visualClass);
  }

  ctx.log.debug(`[BuildingDetails] Refreshing properties on existing inspector obj=${inspector.tempObjectId} at (${x},${y})${activeTabId ? ` [tab=${activeTabId}]` : ''}`);

  const template = getTemplateForVisualClass(visualClass);
  const { tempObjectId, mutex } = inspector;

  // Acquire the inspector's mutex to prevent concurrent SetPath calls from
  // getBuildingTabData() corrupting the temp object's path context.
  const release = await mutex.acquire();

  try {
    // Reset the temp object back to building root. A previous tab data request
    // (supplies/products) may have called SetPath, leaving the object pointed
    // at a supply gate sub-path. Without this reset, GetPropertyList reads
    // from the wrong context and returns empty/wrong building properties.
    await ctx.cacherSetObject(tempObjectId, x, y);

    // R1: Tab-scoped refresh — only fetch properties for the active tab + overview.
    // Lazy tabs (supplies, products, compInputs) are excluded: they use SetPath-based
    // fetching which is handled separately by getBuildingTabData().
    const LAZY_SPECIALS = new Set(['supplies', 'products', 'compInputs']);
    const isLazyTab = activeTabId && template.groups.some(
      g => g.id === activeTabId && g.special && LAZY_SPECIALS.has(g.special)
    );
    const useTabScoped = activeTabId && !isLazyTab && template.groups.length > 2;
    const collected = useTabScoped
      ? collectTemplatePropertyNamesForGroups(template, [activeTabId])
      : undefined;

    const { allValues, groups, moneyGraph } = await fetchPropertiesAndGroups(ctx, tempObjectId, template, collected);

    // Enrich votes tab
    await enrichVotesTab(ctx, groups, allValues);

    // Enrich upgrade tab — AcceptCloning is not a cached property
    await enrichUpgradeTab(ctx, groups, allValues);

    // Update GateMap in the inspector (may have changed via RDOSelectWare)
    inspector.gateMap = allValues.get('GateMap') || inspector.gateMap;

    // Re-read building name/owner — skip SwitchFocusEx when already focused
    // (avoids timeout when server is busy with trade route recalculation)
    let buildingName = '';
    let ownerName = '';
    let buildingId = '';
    const alreadyFocused =
      ctx.currentFocusedCoords?.x === x && ctx.currentFocusedCoords?.y === y;
    if (alreadyFocused && ctx.currentFocusedBuildingId) {
      buildingId = ctx.currentFocusedBuildingId;
      buildingName = ctx.currentFocusedBuildingName ?? '';
      ownerName = ctx.currentFocusedOwnerName ?? '';
    } else {
      try {
        const focusInfo = await ctx.focusBuilding(x, y);
        buildingName = focusInfo.buildingName;
        ownerName = focusInfo.ownerName;
        buildingId = focusInfo.buildingId;
      } catch {
        // Use values from allValues as fallback
      }
    }

    const response: BuildingDetailsResponse = {
      buildingId: buildingId || allValues.get('ObjectId') || allValues.get('CurrBlock') || '',
      x,
      y,
      visualClass,
      templateName: template.name,
      buildingName,
      ownerName,
      securityId: allValues.get('SecurityId') || '',
      // Decided here: only the session holds the requester half, and it is the
      // InitClient proxy id (a pointer), never ctx.tycoonId.
      canGovern: grantAccess(String(ctx.fTycoonProxyId ?? ''), allValues.get('SecurityId') || ''),
      tabs: template.groups.map(g => ({
        id: g.id,
        name: g.name,
        icon: g.icon || '',
        order: g.order,
        special: g.special,
        handlerName: g.handlerName || '',
      })),
      groups,
      // Lazy fields: NOT fetched — client carry-forward preserves them
      supplies: undefined,
      products: undefined,
      compInputs: undefined,
      warehouseWares: undefined,
      moneyGraph,
      timestamp: Date.now(),
      // R1: Signal which groups were refreshed so the client can merge
      refreshedGroups: useTabScoped ? Object.keys(groups) : undefined,
    };

    return response;
  } catch (e: unknown) {
    ctx.log.warn(`[BuildingDetails] Refresh failed on existing object, falling back to full create:`, toErrorMessage(e));
    releaseInspector(ctx);
    return getBuildingBasicDetails(ctx, x, y, visualClass);
  } finally {
    release();
  }
}

// =========================================================================
// SHARED HELPERS
// =========================================================================

/**
 * Phase 1+2: Fetch all template properties (regular + indexed) and build
 * grouped response. Returns the raw allValues map, groups dict, and moneyGraph.
 */
async function fetchPropertiesAndGroups(
  ctx: SessionContext,
  tempObjectId: string,
  template: ReturnType<typeof getTemplateForVisualClass>,
  preCollected?: CollectedPropertyNames,
): Promise<{
  allValues: Map<string, string>;
  groups: { [groupId: string]: BuildingPropertyValue[] };
  moneyGraph: number[] | undefined;
}> {
  const collected = preCollected ?? collectTemplatePropertyNamesStructured(template);
  const allValues = new Map<string, string>();
  const BATCH_SIZE = 50;

  // Phase 1: Fetch regular properties and count properties
  const phase1Props = [...collected.regularProperties, ...collected.countProperties];

  for (let i = 0; i < phase1Props.length; i += BATCH_SIZE) {
    const batch = phase1Props.slice(i, i + BATCH_SIZE);
    const values = await ctx.cacherGetPropertyList(tempObjectId, batch);

    for (let j = 0; j < batch.length; j++) {
      const value = j < values.length ? values[j] : '';
      if (value !== 'error') {
        allValues.set(batch[j], value);
      }
    }
  }

  ctx.log.debug(`[BuildingDetails] Phase 1 done (${allValues.size} values, ${collected.countProperties.length} count props, groups=${template.groups.length})`);

  // Phase 2: Fetch indexed properties based on count values
  const indexedProps: string[] = [];
  const countValues = new Map<string, number>();

  for (const countProp of collected.countProperties) {
    const countStr = allValues.get(countProp);
    const count = countStr ? parseInt(countStr, 10) : 0;
    countValues.set(countProp, count);
    ctx.log.debug(`[BuildingDetails] Count: ${countProp} = "${countStr}" (parsed: ${count})`);
    if (count > 50) {
      ctx.log.warn(`[BuildingDetails] Unusually high count: ${countProp} = ${count}`);
    }

    const indexedDefs = collected.indexedByCount.get(countProp) || [];
    for (const def of indexedDefs) {
      const suffix = def.indexSuffix || '';

      if (def.columns) {
        for (const col of def.columns) {
          const colSuffix = col.indexSuffix !== undefined ? col.indexSuffix : suffix;
          for (let idx = 0; idx < count; idx++) {
            indexedProps.push(`${col.rdoSuffix}${idx}${col.columnSuffix || ''}${colSuffix}`);
          }
        }
      } else {
        for (let idx = 0; idx < count; idx++) {
          indexedProps.push(`${def.rdoName}${idx}${suffix}`);
          if (def.maxProperty) {
            indexedProps.push(`${def.maxProperty}${idx}${suffix}`);
          }
        }
      }
    }
  }

  if (indexedProps.length > 0) {
    ctx.log.debug(`[BuildingDetails] Fetching ${indexedProps.length} indexed properties: ${indexedProps.slice(0, 20).join(', ')}${indexedProps.length > 20 ? '...' : ''}`);
    for (let i = 0; i < indexedProps.length; i += BATCH_SIZE) {
      const batch = indexedProps.slice(i, i + BATCH_SIZE);
      const values = await ctx.cacherGetPropertyList(tempObjectId, batch);

      for (let j = 0; j < batch.length; j++) {
        const value = j < values.length ? values[j] : '';
        if (value !== 'error') {
          allValues.set(batch[j], value);
          if (batch[j].startsWith('srv')) {
            ctx.log.debug(`[BuildingDetails] TABLE: ${batch[j]} = "${value}"`);
          }
        }
      }
    }
  }

  // Build response grouped by tabs
  const groups: { [groupId: string]: BuildingPropertyValue[] } = {};

  for (const group of template.groups) {
    // A gate group's values come from the gate read, never from here. Publishing one
    // meant sending the BUILDING's `ObjectId` under the supplies group's "Gate Object"
    // column — a wrong value — and the client read the key's presence as "already
    // loaded", so it never asked for the gates (Supplies said "No supply inputs" on
    // every building).
    if (isGateTab(group.special) || isGateTab(group.id)) continue;

    const groupValues: BuildingPropertyValue[] = [];
    const includedCountProps = new Set<string>();

    for (const prop of group.properties) {
      const suffix = prop.indexSuffix || '';

      if (prop.type === 'WORKFORCE_TABLE') {
        for (let i = 0; i < 3; i++) {
          const workerProps = [
            `Workers${i}`, `WorkersMax${i}`, `WorkersK${i}`,
            `Salaries${i}`, `WorkForcePrice${i}`,
          ];
          for (const propName of workerProps) {
            const value = allValues.get(propName);
            if (value !== undefined) {
              groupValues.push({ name: propName, value, index: i });
            }
          }
        }
        continue;
      }

      if ((prop.type === 'TABLE' || prop.type === 'SERVICE_CARDS') && prop.columns && prop.countProperty) {
        const count = countValues.get(prop.countProperty) || 0;
        const countVal = allValues.get(prop.countProperty);
        if (countVal !== undefined) {
          groupValues.push({ name: prop.countProperty, value: countVal });
        }
        for (let idx = 0; idx < count; idx++) {
          for (const col of prop.columns) {
            const colSuffix = col.indexSuffix !== undefined ? col.indexSuffix : suffix;
            const colName = `${col.rdoSuffix}${idx}${col.columnSuffix || ''}${colSuffix}`;
            const colValue = allValues.get(colName);
            if (colValue !== undefined) {
              groupValues.push({ name: colName, value: colValue, index: idx });
            }
          }
        }
      } else if (prop.indexed && prop.countProperty) {
        const count = countValues.get(prop.countProperty) || 0;

        if (!includedCountProps.has(prop.countProperty)) {
          includedCountProps.add(prop.countProperty);
          const countVal = allValues.get(prop.countProperty);
          if (countVal !== undefined) {
            groupValues.push({ name: prop.countProperty, value: countVal });
          }
        }

        for (let idx = 0; idx < count; idx++) {
          const propName = `${prop.rdoName}${idx}${suffix}`;
          const value = allValues.get(propName);
          if (value !== undefined) {
            groupValues.push({ name: propName, value, index: idx });
          }
          if (prop.maxProperty) {
            const maxPropName = `${prop.maxProperty}${idx}${suffix}`;
            const maxValue = allValues.get(maxPropName);
            if (maxValue !== undefined) {
              groupValues.push({ name: maxPropName, value: maxValue, index: idx });
            }
          }
        }
      } else if (prop.indexed) {
        for (let idx = 0; idx < 10; idx++) {
          const propName = `${prop.rdoName}${idx}${suffix}`;
          const value = allValues.get(propName);
          if (value !== undefined) {
            groupValues.push({ name: propName, value, index: idx });
            if (prop.maxProperty) {
              const maxPropName = `${prop.maxProperty}${idx}${suffix}`;
              const maxValue = allValues.get(maxPropName);
              if (maxValue !== undefined) {
                groupValues.push({ name: maxPropName, value: maxValue, index: idx });
              }
            }
          }
        }
      } else {
        const value = allValues.get(prop.rdoName);
        if (value !== undefined) {
          groupValues.push({ name: prop.rdoName, value });
          if (prop.maxProperty) {
            const maxValue = allValues.get(prop.maxProperty);
            if (maxValue !== undefined) {
              groupValues.push({ name: prop.maxProperty, value: maxValue });
            }
          }
        }
      }
    }

    if (groupValues.length > 0) {
      groups[group.id] = groupValues;
    }
  }

  // Parse money graph
  let moneyGraph: number[] | undefined;
  const moneyGraphInfo = allValues.get('MoneyGraphInfo');
  if (moneyGraphInfo) {
    moneyGraph = parseMoneyGraph(moneyGraphInfo);
  }

  return { allValues, groups, moneyGraph };
}

/**
 * Enrich votes tab with VoteOf (requires separate RDO call on CurrBlock).
 */
async function enrichVotesTab(
  ctx: SessionContext,
  groups: { [groupId: string]: BuildingPropertyValue[] },
  allValues: Map<string, string>,
): Promise<void> {
  if (!groups['votes']) return;

  const currBlock = allValues.get('CurrBlock');
  const username = ctx.activeUsername || ctx.cachedUsername || '';
  if (!currBlock || !username) return;

  try {
    if (!ctx.getSocket('construction')) {
      await ctx.connectConstructionService();
    }
    const voteOfPacket = await ctx.sendRdoRequest('construction', rdoCall(
      'RDOVoteOf', currBlock, RdoValue.string(username),
    ).packet, undefined, TimeoutCategory.NORMAL);
    const votedFor = parsePropertyResponseHelper(voteOfPacket.payload || '', 'res');
    if (votedFor) {
      groups['votes'].push({ name: 'VoteOf', value: votedFor });
    }
  } catch (e: unknown) {
    ctx.log.debug(`[BuildingDetails] VoteOf enrichment failed: ${toErrorMessage(e)}`);
  }
}

/**
 * Enrich upgrade tab with AcceptCloning (requires a live RDO get on CurrBlock).
 *
 * The object cache cannot answer for this one: TBlock.StoreToCache
 * (Kernel/Kernel.pas:5824-5905) never writes `AcceptCloning`, and the cacher
 * returns an empty string for a name it does not hold (spo_session.ts:1416-1417),
 * so the checkbox rendered unchecked for every building while the server default
 * is true (Kernel.pas:5239). Voyager has the same split — the cached property
 * list (Voyager/ManagementSheet.pas:242-250) omits it and the sheet reads it
 * live off CurrBlock instead (:272-273).
 *
 * Read only — no ownership gate. Voyager shows the value to everyone and greys
 * only the editing control (ManagementSheet.pas:128-129); `canEdit` already covers
 * that on our side.
 */
async function enrichUpgradeTab(
  ctx: SessionContext,
  groups: { [groupId: string]: BuildingPropertyValue[] },
  allValues: Map<string, string>,
): Promise<void> {
  if (!groups['upgrade']) return;

  const currBlock = allValues.get('CurrBlock');
  if (!currBlock) return;

  try {
    if (!ctx.getSocket('construction')) {
      await ctx.connectConstructionService();
    }
    const packet = await ctx.sendRdoRequest('construction', rdoGet(
      'RDOAcceptCloning', currBlock,
    ).packet, undefined, TimeoutCategory.NORMAL);
    const value = parsePropertyResponseHelper(packet.payload || '', 'RDOAcceptCloning');
    if (value !== '') {
      groups['upgrade'].push({ name: 'AcceptCloning', value });
    }
  } catch (e: unknown) {
    ctx.log.debug(`[BuildingDetails] AcceptCloning enrichment failed: ${toErrorMessage(e)}`);
  }
}

/**
 * Parse MoneyGraphInfo into an array of decoded money values.
 * Wire format: "count,min,max,b0,b1,...,b(count-1)," (Kernel/Plotter.pas:117-124,
 * KernelCache.pas:437). Each byte decodes as `((max - min) * byte) / 255 + min`
 * (Voyager/Components/PlotterGrid.pas:120); the result is in thousands of dollars
 * (Kernel/Kernel.pas:4182).
 */
function parseMoneyGraph(graphInfo: string): number[] {
  const parts = graphInfo.split(',');
  const count = parseInt(parts[0], 10);
  const min = parseInt(parts[1], 10);
  const max = parseInt(parts[2], 10);
  if (isNaN(count) || isNaN(min) || isNaN(max) || count <= 0 || parts.length < 3 + count) {
    return [];
  }

  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const byte = parseInt(parts[3 + i], 10);
    if (isNaN(byte)) return [];
    values.push(((max - min) * byte) / 255 + min);
  }

  return values;
}

/**
 * Fetch warehouse ware names via InputCount + Input{i}.0 indexed properties.
 * These cached properties contain the MLS fluid name for each warehouse gate.
 * Combined with GateMap binary string to produce WarehouseWareData[].
 *
 * Archaeology: Kernel.pas:5840-5854 — WriteString('Input' + i + '.', MetaFluid.Name_MLS)
 * Cache stores: InputCount (integer), Input0.0, Input1.0, ... (English ware names)
 * WHGeneralSheet.pas — clbNames checklist populated from these properties.
 */
async function getWarehouseWareNames(
  ctx: SessionContext,
  tempObjectId: string,
  gateMap: string
): Promise<WarehouseWareData[]> {
  try {
    // First fetch InputCount to know how many wares exist
    const countValues = await ctx.cacherGetPropertyList(tempObjectId, ['InputCount']);
    const inputCount = parseInt(countValues[0] || '0', 10);

    if (inputCount <= 0 || inputCount > 50) {
      ctx.log.debug(`[BuildingDetails] Warehouse InputCount=${inputCount}, skipping ware names`);
      return [];
    }

    // Fetch Input{i}.0 for each ware (MLS suffix .0 = English)
    const nameProps: string[] = [];
    for (let i = 0; i < inputCount; i++) {
      nameProps.push(`Input${i}.0`);
    }

    const nameValues = await ctx.cacherGetPropertyList(tempObjectId, nameProps);
    const result: WarehouseWareData[] = [];

    for (let i = 0; i < inputCount; i++) {
      const name = nameValues[i] || '';
      result.push({
        name: name || `Ware ${i}`,
        enabled: i < gateMap.length ? gateMap[i] === '1' : false,
        index: i,
      });
    }

    ctx.log.debug(`[BuildingDetails] Warehouse wares: ${result.length} gates, GateMap="${gateMap}"`);
    return result;
  } catch (e: unknown) {
    ctx.log.warn(`[BuildingDetails] Error fetching warehouse ware names:`, toErrorMessage(e));
    return [];
  }
}

// =========================================================================
// GATES — one description per lazy gate tab, one code path for both
// =========================================================================

/**
 * The two tabs whose rows are Delphi *gates*: an input gate per supplied ware
 * (Supplies) and an output gate per produced ware (Products).
 */
export type GateTabId = 'supplies' | 'products';

/** A gate as listed by GetInputNames / GetOutputNames. */
export interface GatePath {
  path: string;
  name: string;
}

/**
 * Everything that differs between the Supplies and the Products tab.
 *
 * Both tabs read the same three things off the same shared temp object — the
 * gate list, one header per gate, then one sub-object row per connection — and
 * used to do it through two near-identical copies of that sequence. The copies
 * drifted: different clamp comments, different warning wording, and a cnxCount
 * index hard-coded separately in each. Here the sequence exists once, in
 * {@link fetchGateDetails}, and a spec supplies the parts that genuinely differ.
 *
 * `headerProps` MUST contain `cnxCount` — {@link gateCnxCountIndex} reads the
 * connection count out of the header by position.
 */
interface GateSpec<T> {
  readonly tabId: GateTabId;
  /** RDO member that lists this kind of gate. Both are catalogued functions. */
  readonly listMember: 'GetInputNames' | 'GetOutputNames';
  /** Properties read on the gate itself, after SetPath. */
  readonly headerProps: readonly string[];
  /**
   * Per-connection property names WITHOUT their index suffix. The sub-index is
   * appended to each name before the GetSubObjectProps query is built, exactly
   * as the reference client does (Voyager/SupplySheetForm.pas:474-491).
   */
  readonly connectionProps: readonly string[];
  /** How one gate is named in a log line ("supply" / "product"). */
  readonly gateLabel: string;
  /** What one unreadable connection row is called in the warning. */
  readonly rowLabel: string;
  /** A gate as the listing knows it: a path and a name, nothing read yet. */
  buildStub(path: string, name: string): T;
  buildGate(
    path: string,
    name: string,
    header: readonly string[],
    connectionCount: number,
    connections: BuildingConnectionData[],
  ): T;
  buildConnection(values: readonly string[]): BuildingConnectionData;
}

/**
 * Upper bound on connection rows read for one gate. Unchanged from the two
 * copies this replaces; a gate reporting more is not truncated silently — the
 * caller reports connectionCount alongside the short list.
 */
const MAX_CONNECTIONS_PER_GATE = 20;

const SUPPLY_GATES: GateSpec<BuildingSupplyData> = {
  tabId: 'supplies',
  listMember: 'GetInputNames',
  // Same list, same order, as Voyager/SupplySheetForm.pas:460.
  headerProps: [
    'MetaFluid', 'FluidValue', 'LastCostPerc', 'minK', 'MaxPrice',
    'QPSorted', 'SortMode', 'cnxCount', 'ObjectId',
  ],
  // Same list, same order, as Voyager/SupplySheetForm.pas:480-490.
  connectionProps: [
    'cnxFacilityName', 'cnxCreatedBy', 'cnxCompanyName', 'cnxNfPrice',
    'OverPriceCnxInfo', 'LastValueCnxInfo', 'tCostCnxInfo', 'cnxQuality',
    'ConnectedCnxInfo', 'cnxXPos', 'cnxYPos',
  ],
  gateLabel: 'supply',
  rowLabel: 'connection',
  buildStub: (path, name) => ({ path, name, connections: [] }),
  buildGate: (path, name, header, connectionCount, connections) => ({
    path,
    name,
    metaFluid: header[0] || '',
    fluidValue: header[1] || '',
    lastCostPerc: header[2] || undefined,
    minK: header[3] || undefined,
    maxPrice: header[4] || undefined,
    qpSorted: header[5] || undefined,
    sortMode: header[6] || undefined,
    connectionCount,
    connections,
  }),
  buildConnection: (v) => ({
    facilityName: v[0] || '',
    createdBy: v[1] || '',
    companyName: v[2] || '',
    price: v[3] || '0',
    overprice: v[4] || '0',
    lastValue: v[5] || '',
    cost: v[6] || '$0',
    quality: v[7] || '0%',
    connected: v[8] === '1',
    x: parseInt(v[9] || '0', 10),
    y: parseInt(v[10] || '0', 10),
  }),
};

const PRODUCT_GATES: GateSpec<BuildingProductData> = {
  tabId: 'products',
  listMember: 'GetOutputNames',
  // Same list, same order, as Voyager/ProdSheetForm.pas:387.
  headerProps: [
    'MetaFluid', 'LastFluid', 'FluidQuality', 'PricePc',
    'AvgPrice', 'MarketPrice', 'cnxCount',
  ],
  connectionProps: [
    'cnxFacilityName', 'cnxCompanyName', 'LastValueCnxInfo',
    'ConnectedCnxInfo', 'tCostCnxInfo', 'cnxXPos', 'cnxYPos',
  ],
  gateLabel: 'product',
  rowLabel: 'client connection',
  buildStub: (path, name) => ({ path, name, connections: [] }),
  buildGate: (path, name, header, connectionCount, connections) => ({
    path,
    name,
    metaFluid: header[0] || '',
    lastFluid: header[1] || '',
    quality: header[2] || '',
    pricePc: header[3] || '',
    avgPrice: header[4] || '',
    marketPrice: header[5] || '',
    connectionCount,
    connections,
  }),
  buildConnection: (v) => ({
    facilityName: v[0] || '',
    companyName: v[1] || '',
    createdBy: '',
    price: '',
    overprice: '',
    lastValue: v[2] || '',
    cost: v[4] || '',
    quality: '',
    connected: v[3] === '1',
    x: parseInt(v[5] || '0', 10),
    y: parseInt(v[6] || '0', 10),
  }),
};

function gateCnxCountIndex(spec: GateSpec<unknown>): number {
  const i = spec.headerProps.indexOf('cnxCount');
  if (i === -1) throw new Error(`GateSpec ${spec.tabId} has no cnxCount in headerProps`);
  return i;
}

/**
 * List a building's gates. Requires the temp object to point at the building
 * root, not at a gate — hence the cacherSetObject reset in the callers.
 *
 * Wire format is identical for inputs and outputs: "path::\nname\r\n" entries.
 */
async function getGatePaths(
  ctx: SessionContext,
  tempObjectId: string,
  spec: GateSpec<unknown>,
): Promise<GatePath[]> {
  // useless: integer, lang: widestring
  const packet = await ctx.sendRdoRequest('map', rdoCall(
    spec.listMember, tempObjectId, RdoValue.int(0), RdoValue.string('0'),
  ).packet, undefined, TimeoutCategory.NORMAL);

  const raw = cleanPayloadHelper(packet.payload || '');
  if (!raw || raw === '0' || raw === '-1') {
    return [];
  }

  // split('\r') then trim() strips leading '\n' from entries 2+ (CRLF separators)
  const entries = raw.split('\r').map(e => e.trim()).filter(Boolean);
  const result: GatePath[] = [];

  for (const entry of entries) {
    const sepIdx = entry.indexOf('::');
    if (sepIdx === -1) continue;

    const path = entry.substring(0, sepIdx);
    // Skip '::' separator (2 chars), trim any residual \n
    let name = entry.substring(sepIdx + 2).replace(/^\n/, '');
    const nullIdx = name.indexOf('\0');
    if (nullIdx !== -1) {
      name = name.substring(0, nullIdx);
    }
    result.push({ path, name });
  }
  return result;
}

/**
 * Read one gate in full: SetPath, its header, then one GetSubObjectProps per
 * connection.
 *
 * This runs for ONE gate — the one the user opened — and never as part of
 * listing a tab. That is `LoadFingerInfo` (Voyager/SupplySheetForm.pas:440-506,
 * Voyager/ProdSheetForm.pas:369-436): the reference client reads a gate's
 * header and rows together, for `CurrentFinger` alone, and remembers the result
 * (`if reload or not Info.Loaded`, Voyager/ProdSheetForm.pas:464).
 *
 * SetPath resolves through the world spool and releases whatever the object
 * held (Cache Server/CachedObjectWrap.pas:156-168), so it needs no reset first,
 * and it leaves the object on the gate afterwards.
 */
async function fetchGateDetails<T>(
  ctx: SessionContext,
  tempObjectId: string,
  path: string,
  name: string,
  spec: GateSpec<T>,
): Promise<T | null> {
  const setPathPacket = await ctx.sendRdoRequest('map', rdoCall(
    'SetPath', tempObjectId, RdoValue.string(path),
  ).packet, undefined, TimeoutCategory.SLOW);
  const setPathResult = cleanPayloadHelper(setPathPacket.payload || '');

  ctx.log.debug(`[BuildingDetails] ${spec.gateLabel} SetPath('${path}') result: "${setPathResult}"`);
  if (setPathResult !== '-1') return null;

  // Successfully navigated (-1 = Delphi WordBool TRUE), now read the gate header
  const header = await ctx.cacherGetPropertyList(tempObjectId, [...spec.headerProps]);
  const connectionCount = parseInt(header[gateCnxCountIndex(spec)] || '0', 10);

  const connections = await fetchGateConnections(ctx, tempObjectId, path, spec, connectionCount);

  return spec.buildGate(path, name, header, connectionCount, connections);
}

/**
 * Read the connection rows of the gate the temp object currently points at.
 *
 * A short row means GetSubObjectProps returned an empty payload, which it only
 * does when OpenSubObject failed server-side (Cache Server/
 * CachedObjectWrap.pas:469,474,477) — the cache never yields a partial row,
 * because GetPropertyList writes one value + #9 per requested name whether or
 * not the property exists (:225-230).
 *
 * Dropping such a row silently is what made a live warehouse report "1
 * supplier" above an empty list: the count comes from cnxCount on the gate, the
 * rows come from here, and the two stopped agreeing with nothing to say so. Say
 * so — the discrepancy travels to the client in connectionCount vs
 * connections.length, and the warning names the sub-index(es) that failed,
 * which is what makes a partial gate read reproducible.
 */
async function fetchGateConnections<T>(
  ctx: SessionContext,
  tempObjectId: string,
  path: string,
  spec: GateSpec<T>,
  connectionCount: number,
): Promise<BuildingConnectionData[]> {
  const clampedCount = Math.min(connectionCount, MAX_CONNECTIONS_PER_GATE);

  // Conservative parallelism: max 3 concurrent
  const cnxResults = await batchedParallel(clampedCount, (i) =>
    fetchSubObjectProperties(ctx, tempObjectId, i, spec.connectionProps.map(n => `${n}${i}`)),
  );

  const connections: BuildingConnectionData[] = [];
  const unreadable: number[] = [];
  for (const [i, cnxProps] of cnxResults.entries()) {
    if (cnxProps.length < spec.connectionProps.length) {
      unreadable.push(i);
      continue;
    }
    connections.push(spec.buildConnection(cnxProps));
  }
  if (unreadable.length > 0) {
    ctx.log.warn(
      `[BuildingDetails] ${path}: cnxCount says ${connectionCount} but ${unreadable.length} ` +
      `${spec.rowLabel}(s) returned an empty GetSubObjectProps payload — the sub-object ` +
      `cache did not resolve. Failing sub-index(es): ${unreadable.join(', ')}. ` +
      `The list will be short by that many rows.`
    );
  }
  return connections;
}

/**
 * List a tab's gates. ONE RDO call, whatever the building.
 *
 * This is the whole tab read. Nothing per-gate happens here — no SetPath, no
 * GetPropertyList — because nothing per-gate is known until the user opens a
 * gate, and the accordion says so rather than inventing a zero.
 *
 * It is what the reference client does on focus: `UpdateFingersToList` calls
 * `GetOutputNames` and fills the finger strip with names
 * (Voyager/ProdSheetForm.pas:274-297), and `LoadFingerInfo` — the SetPath, the
 * header, the rows — waits for a finger to be selected
 * (Voyager/ProdSheetForm.pas:449-480). Voyager can afford that because its
 * gates are tabs, one visible at a time; ours are accordion rows, all visible,
 * all collapsed. Reading 30 headers to decorate 30 collapsed rows cost 60
 * round-trips before a single one was opened.
 *
 * Callers must have pointed `tempObjectId` at the building root already:
 * GetInputNames/GetOutputNames read the current object.
 */
async function listGates<T>(
  ctx: SessionContext,
  tempObjectId: string,
  gateMap: string,
  isWarehouse: boolean,
  spec: GateSpec<T>,
): Promise<T[]> {
  let paths = await getGatePaths(ctx, tempObjectId, spec);
  // Warehouses: a gate needs an explicit '1' bit — a short map closes the rest
  // (pairs with getWarehouseWareNames, which reads the same bits for the ware
  // checklist). Every other facility follows the Voyager finger-strip rule instead:
  // a finger is shown unless the map has an explicit '0' at that position
  // (Voyager/SupplySheetForm.pas:382, Voyager/ProdSheetForm.pas:324) — an empty map,
  // a map shorter than the gate index, or any character other than '0' all leave
  // the gate listed.
  if (isWarehouse) {
    if (gateMap) {
      paths = paths.filter((_, i) => i < gateMap.length && gateMap[i] === '1');
    }
  } else {
    paths = paths.filter((_, i) => gateMap[i] !== '0');
  }

  ctx.log.debug(`[BuildingDetails] Listed ${paths.length} ${spec.tabId} gates, headers deferred`);
  return paths.map(({ path, name }) => spec.buildStub(path, name));
}

/**
 * Read one gate's connections on demand — the click-time half of the split
 * {@link fetchGateDetails} performs.
 *
 * Mirrors `LoadFingerInfo` (Voyager/SupplySheetForm.pas:440-506): SetPath, the
 * header, then the rows, all on one object under the inspector's mutex. The
 * header is re-read rather than trusted from the tab load, exactly as the
 * reference client does (:460), so a gate the user opens shows current numbers.
 */
export async function getBuildingGateConnections(
  ctx: SessionContext,
  x: number,
  y: number,
  tabId: GateTabId,
  path: string,
  name: string,
  visualClass?: string,
): Promise<{ supply?: BuildingSupplyData; product?: BuildingProductData }> {
  let inspector = getActiveInspector(ctx, x, y);

  if (!inspector) {
    ctx.log.debug(`[BuildingDetails] Creating on-demand inspector for (${x},${y}), gate=${path}`);
    inspector = await createInspectorForBuilding(ctx, x, y, visualClass || '0');
  }

  const { tempObjectId, mutex } = inspector;
  const release = await mutex.acquire();

  try {
    ctx.log.debug(`[BuildingDetails] Gate connections for (${x},${y}), ${tabId} '${path}'`);

    // No cacherSetObject reset here: unlike GetInputNames/GetOutputNames, which
    // read whatever the object currently points at, SetPath resolves its
    // argument through the world spool and releases the previous object first
    // (Cache Server/CachedObjectWrap.pas:156-168). One round-trip saved per
    // click, and the next tab load resets the object itself.
    if (tabId === 'supplies') {
      const supply = await fetchGateDetails(ctx, tempObjectId, path, name, SUPPLY_GATES);
      return supply ? { supply } : {};
    }
    const product = await fetchGateDetails(ctx, tempObjectId, path, name, PRODUCT_GATES);
    return product ? { product } : {};
  } finally {
    release();
  }
}

/**
 * Run async tasks with bounded concurrency.
 * Delphi server has a global critical section + MAX_BUFFER_SIZE=5,
 * so we limit to 3 concurrent RDO requests to avoid buffer overflow.
 *
 * ACCEPTED DIVERGENCE (audit 2026-07-02, P3 — developer decision): the legacy
 * client is strictly sequential per socket and gets its parallelism from a
 * connection POOL; we pipeline up to 3 QueryId-correlated READS on the single
 * cacher socket instead. Wire-legal, bounded, read-only; the cacher server
 * runs a 16-thread pool.
 */
const MAX_CONCURRENT_CONNECTIONS = 3;

async function batchedParallel<T>(
  count: number,
  fn: (index: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array(count);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < count) {
      const i = nextIndex++;
      results[i] = await fn(i);
    }
  }

  const workerCount = Math.min(MAX_CONCURRENT_CONNECTIONS, count);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Fetch company input data (compInputs tab).
 * Protocol: GetPropertyList cInputCount -> batch GetPropertyList cInput{i}.* for all inputs.
 * Handler: compInputs (CompanyServicesSheetForm.pas)
 *
 * Wire format:
 *   C sel <id> call GetPropertyList "^" "%...\tcInputCount\t";
 *   C sel <id> call GetPropertyList "^" "%cInput0.0\tcInputSup0\tcInputDem0\tcInputRatio0\tcInputMax0\tcEditable0\tcUnits0.0\t...";
 */
async function fetchCompInputData(ctx: SessionContext, tempObjectId: string): Promise<CompInputData[]> {
  const result: CompInputData[] = [];

  try {
    // Step 1: get count
    const countProps = await ctx.cacherGetPropertyList(tempObjectId, ['cInputCount']);
    const count = parseInt(countProps[0] || '0', 10);
    if (count <= 0) return result;

    // Step 2: batch all 7 indexed properties per input (max 50 props per batch = ~7 inputs)
    const BATCH_SIZE = 49; // keep under 50-prop limit
    const propNames: string[] = [];
    for (let i = 0; i < count; i++) {
      propNames.push(
        `cInput${i}.0`,
        `cInputSup${i}`,
        `cInputDem${i}`,
        `cInputRatio${i}`,
        `cInputMax${i}`,
        `cEditable${i}`,
        `cUnits${i}.0`,
      );
    }

    // Fetch in batches of BATCH_SIZE properties
    const allValues: string[] = [];
    for (let offset = 0; offset < propNames.length; offset += BATCH_SIZE) {
      const batch = propNames.slice(offset, offset + BATCH_SIZE);
      const vals = await ctx.cacherGetPropertyList(tempObjectId, batch);
      allValues.push(...vals);
    }

    // Step 3: parse into CompInputData objects (7 props per input)
    for (let i = 0; i < count; i++) {
      const base = i * 7;
      result.push({
        name:      allValues[base]     ?? '',
        supplied:  parseFloat(allValues[base + 1] || '0'),
        demanded:  parseFloat(allValues[base + 2] || '0'),
        ratio:     parseInt(allValues[base + 3]   || '0', 10),
        maxDemand: parseInt(allValues[base + 4]   || '100', 10),
        editable:  (allValues[base + 5] ?? '').toLowerCase() === 'yes',
        units:     allValues[base + 6] ?? '',
      });
    }
  } catch (e: unknown) {
    ctx.log.warn('[BuildingDetails] Error fetching comp input data:', e);
  }

  return result;
}

/**
 * Fetch sub-object properties (for indexed connections).
 */
async function fetchSubObjectProperties(
  ctx: SessionContext,
  tempObjectId: string,
  subIndex: number,
  propertyNames: string[]
): Promise<string[]> {
  try {
    const query = propertyNames.join('\t') + '\t';
    // index: integer, names: WideString
    const packet = await ctx.sendRdoRequest('map', rdoCall(
      'GetSubObjectProps', tempObjectId, RdoValue.int(subIndex), RdoValue.string(query),
    ).packet, undefined, TimeoutCategory.NORMAL);

    // Parse WITHOUT `cleanPayload`, for the reason `cacherGetPropertyList`
    // already documents (spo_session.ts:1412-1415): cleanPayload ends in
    // `.trim()` (rdo-helpers.ts:106), and a connection row whose columns are all
    // empty is nothing but tabs — `res="%\t\t\t\t\t\t\t"` — so the trim reduced
    // it to `''`, the tab test below failed, the whitespace fallback filtered
    // everything out, and the caller's arity guard dropped the row.
    //
    // That is the live "cnxCount says 1, list empty" contradiction: the cache
    // answered, we destroyed the answer. Positional alignment is the whole
    // contract here — the Delphi server writes one value + TAB per requested
    // name whether or not the property exists (Cache Server/
    // CachedObjectWrap.pas:225-230), so an empty column must survive as an
    // empty string, not disappear.
    const rawPayload = packet.payload || '';
    let raw: string;
    const resMatch = rawPayload.match(/^res="((?:[^"]|"")*)"$/);
    if (resMatch) {
      raw = resMatch[1].replace(/""/g, '"');
      // Strip the type prefix, never the whitespace.
      if (raw.length > 0 && ['#', '%', '@', '$', '^', '!', '*'].includes(raw[0])) {
        raw = raw.substring(1);
      }
    } else {
      raw = cleanPayloadHelper(rawPayload);
    }

    if (raw === '') return [];

    // Trim each value (spaces, not tabs) and drop the trailing empty the final
    // TAB produces — same shape as cacherGetPropertyList.
    const values = raw.split('\t').map(v => v.trim());
    if (values.length > 0 && values[values.length - 1] === '') {
      values.pop();
    }
    return values;
  } catch (e: unknown) {
    ctx.log.warn(`[BuildingDetails] Error fetching sub-object ${subIndex}:`, e);
    return [];
  }
}

/**
 * The two live figures the service sheet polls for the selected service.
 *
 * Voyager/SrvGeneralSheetForm.pas:410-413 — BindTo(fCurrBlock), RDOGetDemand(finger),
 * RDOGetSupply(finger); both are 1-arg published functions on TServiceBlock
 * (StdBlocks/ServiceBlock.pas:309-310). RDOGetDemand feeds the "Local Demand"
 * caption and RDOGetSupply the "Supply" one (:436-437) — the Pascal's two local
 * variable names are swapped against what they hold, the captions are not.
 *
 * Only the selected index is asked for, as the reference client does: the whole
 * point of the poll is that it costs one round-trip pair per tick whatever the
 * service count. The result strings travel unparsed; the client parses.
 */
export async function getBuildingServiceFigures(
  ctx: SessionContext,
  x: number,
  y: number,
  serviceIndex: number,
): Promise<{ supply: string; demand: string }> {
  await ctx.connectMapService();
  const [currBlock] = await ctx.getCacherPropertyListAt(x, y, ['CurrBlock']);
  if (!currBlock) throw new Error(`No building found at (${x}, ${y})`);

  if (!ctx.getSocket('construction')) {
    await ctx.connectConstructionService();
  }

  const demandPacket = await ctx.sendRdoRequest('construction', rdoCall(
    'RDOGetDemand', currBlock, RdoValue.int(serviceIndex),
  ).packet, undefined, TimeoutCategory.NORMAL);
  const supplyPacket = await ctx.sendRdoRequest('construction', rdoCall(
    'RDOGetSupply', currBlock, RdoValue.int(serviceIndex),
  ).packet, undefined, TimeoutCategory.NORMAL);

  return {
    demand: parsePropertyResponseHelper(demandPacket.payload || '', 'res'),
    supply: parsePropertyResponseHelper(supplyPacket.payload || '', 'res'),
  };
}
