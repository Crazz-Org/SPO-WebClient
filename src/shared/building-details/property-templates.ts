/**
 * Building Details Property Templates
 *
 * Data-driven template system: CLASSES.BIN [InspectorInfo] sections define
 * which tabs each building class displays. Templates are registered at startup
 * by BuildingDataService via registerInspectorTabs().
 */

import { BuildingTemplate, PropertyGroup, PropertyType } from './property-definitions';
import {
  GENERIC_GROUP,
  WORKFORCE_GROUP,
  UPGRADE_GROUP,
  HQ_INVENTIONS_GROUP,
  VOTES_GROUP,
  HANDLER_TO_GROUP,
} from './template-groups';
import { CIVIC_HANDLER_NAMES, registerCivicVisualClass } from './civic-buildings';

// =============================================================================
// GENERIC FALLBACK TEMPLATE
// =============================================================================

/**
 * Fallback template for building classes not yet registered via CLASSES.BIN.
 * In practice this should rarely be hit since all 863 classes are registered.
 */
const GENERIC_TEMPLATE: BuildingTemplate = {
  visualClassIds: ['*'],
  name: 'Building',
  groups: [
    GENERIC_GROUP,
    WORKFORCE_GROUP,
    UPGRADE_GROUP,
  ],
};

// =============================================================================
// DATA-DRIVEN TEMPLATE CACHE
// =============================================================================

/**
 * Template cache from CLASSES.BIN [InspectorInfo] sections.
 * Populated by registerInspectorTabs() during BuildingDataService initialization.
 */
const dataDrivenTemplateCache: Map<string, BuildingTemplate> = new Map();

/**
 * Register inspectorTabs from CLASSES.BIN for a visualClass.
 * Converts [InspectorInfo] tab handler names into PropertyGroup arrays
 * using the HANDLER_TO_GROUP mapping.
 *
 * Called during BuildingDataService initialization for every building class.
 */
export function registerInspectorTabs(
  visualClassId: string,
  inspectorTabs: { tabName: string; tabHandler: string }[],
  buildingClassName?: string
): void {
  if (!inspectorTabs.length) return;

  const groups: PropertyGroup[] = [];
  const usedIds = new Set<string>();

  for (let i = 0; i < inspectorTabs.length; i++) {
    const tab = inspectorTabs[i];
    const baseGroup = HANDLER_TO_GROUP[tab.tabHandler];
    if (!baseGroup) continue;

    // Create a unique group ID per tab position.
    // Well-known handlers (Supplies, Workforce, etc.) keep their original ID
    // unless it's already taken. Duplicate IDs (e.g., multiple handlers → GENERIC_GROUP)
    // get a handler-suffixed ID so every tab is preserved.
    let groupId = baseGroup.id;
    if (usedIds.has(groupId)) {
      groupId = `${baseGroup.id}_${tab.tabHandler}`;
    }
    usedIds.add(groupId);

    // The label is the TabName{i} read from CLASSES.BIN, as Voyager shows it;
    // only the label moves, the id and the handler still come from the group.
    groups.push({
      ...baseGroup,
      id: groupId,
      name: tab.tabName.trim() || baseGroup.name,
      order: i * 10,
      handlerName: tab.tabHandler,
    });
  }

  // Runtime-inject hdqInventions for HQ buildings (not in CLASSES.BIN [InspectorInfo])
  const hasHqGeneral = inspectorTabs.some(t => t.tabHandler === 'HqGeneral');
  const hasInventions = usedIds.has('hqInventions');
  if (hasHqGeneral && !hasInventions) {
    groups.push({
      ...HQ_INVENTIONS_GROUP,
      order: groups.length * 10,
      handlerName: 'hdqInventions',
    });
  }

  // Runtime-inject Votes for Town Hall buildings (Delphi VotesSheet serves both
  // Capitol and Town Hall, but CLASSES.BIN may not list it for Town Hall)
  const hasTownGeneral = inspectorTabs.some(t => t.tabHandler === 'townGeneral');
  const hasVotes = usedIds.has('votes');
  if (hasTownGeneral && !hasVotes) {
    groups.push({
      ...VOTES_GROUP,
      order: groups.length * 10,
      handlerName: 'Votes',
    });
  }

  if (groups.length > 0) {
    dataDrivenTemplateCache.set(visualClassId, {
      visualClassIds: [visualClassId],
      name: buildingClassName || 'Building',
      groups,
    });

    // Auto-register civic visual class IDs so isCivicBuilding works immediately
    // on subsequent encounters (before template cache is lazily populated per-building).
    if (groups.some(g => CIVIC_HANDLER_NAMES.has(g.handlerName ?? ''))) {
      registerCivicVisualClass(visualClassId);
    }
  }
}

/**
 * Clear the data-driven template cache (for testing)
 */
export function clearInspectorTabsCache(): void {
  dataDrivenTemplateCache.clear();
}

/**
 * Get template for a visualClassId.
 * Returns data-driven template from CLASSES.BIN, or GENERIC_TEMPLATE fallback.
 */
export function getTemplateForVisualClass(visualClassId: string): BuildingTemplate {
  return dataDrivenTemplateCache.get(visualClassId) || GENERIC_TEMPLATE;
}

// =============================================================================
// PROPERTY NAME COLLECTION
// =============================================================================

/**
 * Result of collecting property names, separating count properties from regular/indexed ones
 */
export interface CollectedPropertyNames {
  /** Regular (non-indexed) property names to fetch */
  regularProperties: string[];
  /** Count property names that need to be fetched first */
  countProperties: string[];
  /** Map of countProperty -> list of indexed property definitions that depend on it */
  indexedByCount: Map<string, IndexedPropertyInfo[]>;
}

/**
 * Info about an indexed property for dynamic fetching
 */
export interface IndexedPropertyInfo {
  rdoName: string;
  maxProperty?: string;
  columns?: { rdoSuffix: string; columnSuffix?: string; indexSuffix?: string }[];
  indexSuffix?: string;
}

/**
 * Collect property names with structured output for two-phase fetching
 */
export function collectTemplatePropertyNamesStructured(template: BuildingTemplate): CollectedPropertyNames {
  const regularProperties: Set<string> = new Set();
  const countProperties: Set<string> = new Set();
  const indexedByCount: Map<string, IndexedPropertyInfo[]> = new Map();

  for (const group of template.groups) {
    collectGroupPropertyNamesStructured(group, regularProperties, countProperties, indexedByCount);
  }

  return {
    regularProperties: Array.from(regularProperties),
    countProperties: Array.from(countProperties),
    indexedByCount,
  };
}

/**
 * Collect property names for specific group IDs only (R1: tab-scoped refresh).
 * Always includes the first group ("overview") to keep header data fresh.
 */
export function collectTemplatePropertyNamesForGroups(
  template: BuildingTemplate,
  groupIds: string[],
): CollectedPropertyNames {
  const regularProperties: Set<string> = new Set();
  const countProperties: Set<string> = new Set();
  const indexedByCount: Map<string, IndexedPropertyInfo[]> = new Map();

  const targetIds = new Set(groupIds);
  // Always include the first group (overview/general) for header data
  if (template.groups.length > 0) {
    targetIds.add(template.groups[0].id);
  }

  for (const group of template.groups) {
    if (targetIds.has(group.id)) {
      collectGroupPropertyNamesStructured(group, regularProperties, countProperties, indexedByCount);
    }
  }

  return {
    regularProperties: Array.from(regularProperties),
    countProperties: Array.from(countProperties),
    indexedByCount,
  };
}

/**
 * Properties the inspector header needs regardless of which group declares them.
 *
 * `SecurityId` is the odd one out: it is never rendered — the hide list drops it
 * — but `canGovern` is computed from it server-side, so the opening read must
 * still carry it. The rest are the header's own fields (owner, value, ROI), the
 * id the response falls back on for `buildingId`, and `GateMap`, which the
 * active inspector keeps to address supply/product gates later.
 *
 * `CurrBlock` is deliberately NOT here. It is the second `buildingId` fallback,
 * but asking for it on every open would hand `enrichVotesTab` the block id of
 * every town hall and turn a `RDOVoteOf` round-trip per candidate into part of
 * the opening cost — the exact traffic this read exists to avoid. No shipped
 * template requests it either.
 */
export const HEADER_PROPERTY_NAMES: readonly string[] = [
  'Name',
  'Creator',
  'SecurityId',
  'ObjectId',
  'Cost',
  'ROI',
  'GateMap',
];

/**
 * Collect the opening read: the first group ("general"/"overview") plus the
 * header fields above. Everything else waits for its menu entry to be opened,
 * which is what makes the inspector open in one small batch instead of the
 * whole template — an industry or civic template expands to hundreds of indexed
 * properties in phase 2, and almost none of them are on screen at open.
 */
export function collectHeaderPropertyNames(template: BuildingTemplate): CollectedPropertyNames {
  const collected = collectTemplatePropertyNamesForGroups(template, []);
  const regular = new Set(collected.regularProperties);
  for (const name of HEADER_PROPERTY_NAMES) regular.add(name);
  return { ...collected, regularProperties: Array.from(regular) };
}

/**
 * Helper to collect property names from a group with structured output
 */
function collectGroupPropertyNamesStructured(
  group: PropertyGroup,
  regularProperties: Set<string>,
  countProperties: Set<string>,
  indexedByCount: Map<string, IndexedPropertyInfo[]>
): void {
  for (const prop of group.properties) {
    // Not in the object cache — asking for it would add an empty-valued entry
    // alongside the real one the live enrichment pushes. Skip it here.
    if (prop.notCached) continue;

    const suffix = prop.indexSuffix || '';

    // Handle WORKFORCE_TABLE type specially
    if (prop.type === 'WORKFORCE_TABLE') {
      // Add all workforce properties for 3 worker classes (0, 1, 2)
      // WorkCenterBlock.StoreToCache: Workers, WorkersMax, WorkersK, Salaries,
      // WorkForcePrice, WorkersCap, MinSalaries, SalaryValues per class
      for (let i = 0; i < 3; i++) {
        regularProperties.add(`Workers${i}`);
        regularProperties.add(`WorkersMax${i}`);
        regularProperties.add(`WorkersK${i}`);
        regularProperties.add(`Salaries${i}`);
        regularProperties.add(`WorkForcePrice${i}`);
        regularProperties.add(`WorkersCap${i}`);
        regularProperties.add(`MinSalaries${i}`);
        regularProperties.add(`SalaryValues${i}`);
      }
      continue;
    }

    if (prop.indexed && prop.countProperty) {
      // Indexed property with count - add to structured map
      countProperties.add(prop.countProperty);
      if (!indexedByCount.has(prop.countProperty)) {
        indexedByCount.set(prop.countProperty, []);
      }

      indexedByCount.get(prop.countProperty)!.push({
        rdoName: prop.rdoName,
        maxProperty: prop.maxProperty,
        columns: prop.columns
          ?.filter(c => c.type !== PropertyType.ACTION_BUTTON)
          .map(c => ({ rdoSuffix: c.rdoSuffix, columnSuffix: c.columnSuffix, indexSuffix: c.indexSuffix })),
        indexSuffix: suffix,
      });
    } else if (prop.indexed && prop.indexMax !== undefined) {
      // Indexed property with fixed max - add all indices as regular
      for (let i = 0; i <= prop.indexMax; i++) {
        regularProperties.add(`${prop.rdoName}${i}${suffix}`);
        if (prop.maxProperty) {
          regularProperties.add(`${prop.maxProperty}${i}${suffix}`);
        }
      }
    } else {
      // Regular property
      regularProperties.add(prop.rdoName);
      if (prop.maxProperty) {
        regularProperties.add(prop.maxProperty);
      }
    }

    // For table columns without count property, add indices 0-9
    if (prop.columns && !prop.countProperty) {
      for (let i = 0; i < 10; i++) {
        for (const col of prop.columns) {
          if (col.type === PropertyType.ACTION_BUTTON) continue;
          const colSuffix = col.indexSuffix !== undefined ? col.indexSuffix : suffix;
          regularProperties.add(`${col.rdoSuffix}${i}${col.columnSuffix || ''}${colSuffix}`);
        }
      }
    }
  }

  // Recurse into subgroups
  if (group.subGroups) {
    for (const subGroup of group.subGroups) {
      collectGroupPropertyNamesStructured(subGroup, regularProperties, countProperties, indexedByCount);
    }
  }
}
