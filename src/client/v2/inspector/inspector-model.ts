/**
 * inspector-model — the pure decisions behind InspectorV2.
 *
 * Nothing here talks to the server or reads a store. It answers four questions for the
 * component: which tabs to draw, which one is open, what the hero's three figures are, and
 * which actions the hero offers. The lazy-read rule itself is NOT here — InspectorV2 calls
 * v1's `resolveSectionFetch` / `sectionDisplayState` unchanged, so the request pattern
 * stays byte-for-byte the classic one.
 */

import type { BuildingDetailsResponse, BuildingDetailsTab, BuildingFocusInfo } from '@/shared/types';
import { parseConstructionPercent, parseDetailsText } from '../../components/building/QuickStats';

/**
 * Id of the synthetic first tab of a standard facility. Never sent to the server and never
 * stored: selecting it stores `''` (the classic "menu showing" state), which is what keeps
 * it free — `resolveSectionFetch` asks for nothing when no server tab is open.
 */
export const OVERVIEW_TAB_ID = '__v2-overview';

export interface SectionTabItem {
  id: string;
  label: string;
}

/**
 * Tabs of a standard facility: Overview first, then the server tabs in their declared order.
 */
export function buildStandardTabs(tabs: BuildingDetailsTab[]): SectionTabItem[] {
  const sorted = [...tabs].sort((a, b) => a.order - b.order);
  return [{ id: OVERVIEW_TAB_ID, label: 'Overview' }, ...sorted.map((t) => ({ id: t.id, label: t.name }))];
}

/** The open server tab of a standard facility, or null when Overview is showing. */
export function activeStandardTabId(tabs: BuildingDetailsTab[], currentTab: string): string | null {
  return tabs.find((t) => t.id === currentTab)?.id ?? null;
}

/** The open civic tab: the stored one when it exists, otherwise the first offered. */
export function activeCivicTabId(civicTabs: SectionTabItem[], currentTab: string): string | undefined {
  return civicTabs.some((t) => t.id === currentTab) ? currentTab : civicTabs[0]?.id;
}

/** What `setCurrentTab` receives when the player picks a tab. */
export function storeValueForTab(tabId: string): string {
  return tabId === OVERVIEW_TAB_ID ? '' : tabId;
}

/** Index of the tab the arrow keys move to, wrapping at both ends. */
export function nextTabIndex(current: number, count: number, key: string): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export type Tone = 'positive' | 'negative' | 'neutral';

/** Positive revenue reads gold, a loss reads red, anything else stays neutral (as v1's header). */
export function revenueTone(revenue: string | undefined): Tone {
  if (!revenue) return 'neutral';
  if (revenue.includes('-')) return 'negative';
  if (revenue.includes('$') && !revenue.includes('$0')) return 'positive';
  return 'neutral';
}

export interface HeroKpi {
  key: 'revenue' | 'roi' | 'construction' | 'workers';
  label: string;
  value: string;
  tone: Tone;
}

/**
 * The hero's figures: revenue per hour, ROI, then construction progress while the facility
 * is being built, its workforce otherwise. A figure the server has not given is left out
 * rather than drawn as a dash.
 */
export function buildHeroKpis(focus: BuildingFocusInfo, roi: string | undefined): HeroKpi[] {
  const kpis: HeroKpi[] = [];
  if (focus.revenue) {
    kpis.push({ key: 'revenue', label: 'Revenue', value: focus.revenue, tone: revenueTone(focus.revenue) });
  }
  if (roi) kpis.push({ key: 'roi', label: 'ROI', value: roi, tone: 'neutral' });

  const construction = focus.salesInfo ? parseConstructionPercent(focus.salesInfo) : null;
  if (construction !== null) {
    kpis.push({ key: 'construction', label: 'Construction', value: `${construction}%`, tone: 'neutral' });
  } else {
    const workers = parseDetailsText(focus.detailsText).find((e) => e.label === 'Workers');
    if (workers) kpis.push({ key: 'workers', label: 'Workers', value: workers.value, tone: 'neutral' });
  }
  return kpis;
}

/** "Society, Owner", collapsing to whichever half exists — never a dangling comma. */
export function attributionLine(society: string | undefined, owner: string | undefined): string {
  return [society, owner].filter((part): part is string => !!part && part.length > 0).join(', ');
}

/** Matched on coordinates, not on name: a favourite keeps the name it was given. */
export function isFavorited(favorites: ReadonlyArray<{ x: number; y: number }>, x: number, y: number): boolean {
  return favorites.some((f) => f.x === x && f.y === y);
}

/** First value found under `name` across every property group. */
export function findGroupValue(details: BuildingDetailsResponse, name: string): string | undefined {
  for (const group of Object.values(details.groups)) {
    for (const prop of group) {
      if (prop.name === name && prop.value) return prop.value;
    }
  }
  return undefined;
}

export interface HeroActionFlags {
  /** "Write to <owner>": a standard facility whose Creator came back. */
  writeOwner: string | null;
  /** "Write to the Mayor of <town>": a Town Hall (never the Capitol) that names its town. */
  writeMayorTown: string | null;
  /** Add to Empire list + Rename: the player's own standard facility. */
  ownerTools: boolean;
}

/** Which of the identity actions the hero offers — the rules v1 spread over two headers. */
export function heroActionFlags(input: {
  isCivic: boolean;
  isCapitol: boolean;
  isOwner: boolean;
  ownerTycoon: string | undefined;
  townName: string | undefined;
}): HeroActionFlags {
  if (input.isCivic) {
    return {
      writeOwner: null,
      writeMayorTown: !input.isCapitol && input.townName ? input.townName : null,
      ownerTools: false,
    };
  }
  return { writeOwner: input.ownerTycoon ?? null, writeMayorTown: null, ownerTools: input.isOwner };
}
