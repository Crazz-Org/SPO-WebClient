import { describe, it, expect } from '@jest/globals';
import type { BuildingDetailsResponse, BuildingDetailsTab, BuildingFocusInfo } from '@/shared/types';
import {
  OVERVIEW_TAB_ID,
  activeCivicTabId,
  activeStandardTabId,
  attributionLine,
  buildHeroKpis,
  buildStandardTabs,
  findGroupValue,
  heroActionFlags,
  isFavorited,
  nextTabIndex,
  revenueTone,
  storeValueForTab,
} from './inspector-model';

const tabs: BuildingDetailsTab[] = [
  { id: 'workforce', name: 'WORKFORCE', order: 2, icon: 'W', handlerName: 'Workforce' },
  { id: 'indGeneral', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'IndGeneral' },
  { id: 'supplies', name: 'SUPPLIES', order: 1, icon: 'S', handlerName: 'Supplies' },
];

function focus(over: Partial<BuildingFocusInfo> = {}): BuildingFocusInfo {
  return {
    buildingId: 'b', buildingName: 'Farm', ownerName: 'Co', salesInfo: '', revenue: '',
    detailsText: '', hintsText: '', x: 1, y: 2, xsize: 1, ysize: 1, visualClass: '1',
    ...over,
  };
}

describe('section tabs', () => {
  it('puts Overview first, then the server tabs by their order', () => {
    expect(buildStandardTabs(tabs)).toEqual([
      { id: OVERVIEW_TAB_ID, label: 'Overview' },
      { id: 'indGeneral', label: 'GENERAL' },
      { id: 'supplies', label: 'SUPPLIES' },
      { id: 'workforce', label: 'WORKFORCE' },
    ]);
  });

  it('does not reorder the input array', () => {
    const input = [...tabs];
    buildStandardTabs(input);
    expect(input[0].id).toBe('workforce');
  });

  it('finds the open server tab, or null for Overview', () => {
    expect(activeStandardTabId(tabs, 'supplies')).toBe('supplies');
    expect(activeStandardTabId(tabs, '')).toBeNull();
    expect(activeStandardTabId(tabs, 'overview')).toBeNull();
  });

  it('keeps a valid civic tab and falls back to the first one', () => {
    const civic = [{ id: 'overview', label: 'Overview' }, { id: 'elections', label: 'Elections' }];
    expect(activeCivicTabId(civic, 'elections')).toBe('elections');
    expect(activeCivicTabId(civic, 'workforce')).toBe('overview');
    expect(activeCivicTabId([], 'x')).toBeUndefined();
  });

  it('stores Overview as the empty section and anything else as itself', () => {
    expect(storeValueForTab(OVERVIEW_TAB_ID)).toBe('');
    expect(storeValueForTab('supplies')).toBe('supplies');
  });

  it('moves with arrows, Home and End, wrapping', () => {
    expect(nextTabIndex(0, 3, 'ArrowRight')).toBe(1);
    expect(nextTabIndex(2, 3, 'ArrowRight')).toBe(0);
    expect(nextTabIndex(0, 3, 'ArrowLeft')).toBe(2);
    expect(nextTabIndex(1, 3, 'Home')).toBe(0);
    expect(nextTabIndex(1, 3, 'End')).toBe(2);
    expect(nextTabIndex(1, 3, 'a')).toBeNull();
    expect(nextTabIndex(0, 0, 'ArrowRight')).toBeNull();
  });
});

describe('hero figures', () => {
  it('tones revenue like v1', () => {
    expect(revenueTone(undefined)).toBe('neutral');
    expect(revenueTone('-$5/h')).toBe('negative');
    expect(revenueTone('$1,200/h')).toBe('positive');
    expect(revenueTone('$0/h')).toBe('neutral');
    expect(revenueTone('12')).toBe('neutral');
  });

  it('gives revenue, ROI and construction progress while building', () => {
    expect(buildHeroKpis(focus({ revenue: '$5/h', salesInfo: '40% completed.' }), '12%')).toEqual([
      { key: 'revenue', label: 'Revenue', value: '$5/h', tone: 'positive' },
      { key: 'roi', label: 'ROI', value: '12%', tone: 'neutral' },
      { key: 'construction', label: 'Construction', value: '40%', tone: 'neutral' },
    ]);
  });

  it('gives the workforce of a running facility', () => {
    const kpis = buildHeroKpis(focus({ detailsText: 'Drug Store.  Upgrade Level: 1  Items Sold: 40  Workers: 9 of 27.', salesInfo: 'Wheat sales at 80%' }), undefined);
    expect(kpis).toEqual([{ key: 'workers', label: 'Workers', value: '9 of 27', tone: 'neutral' }]);
  });

  it('leaves out what the server did not give', () => {
    expect(buildHeroKpis(focus(), undefined)).toEqual([]);
  });

  it('joins society and owner without a dangling comma', () => {
    expect(attributionLine('Co', 'Bob')).toBe('Co, Bob');
    expect(attributionLine('Co', undefined)).toBe('Co');
    expect(attributionLine('', 'Bob')).toBe('Bob');
    expect(attributionLine(undefined, undefined)).toBe('');
  });

  it('matches favourites on coordinates', () => {
    expect(isFavorited([{ x: 1, y: 2 }], 1, 2)).toBe(true);
    expect(isFavorited([{ x: 1, y: 3 }], 1, 2)).toBe(false);
  });

  it('finds a property value across groups, skipping empty ones', () => {
    const d = { groups: { a: [{ name: 'ROI', value: '' }], b: [{ name: 'ROI', value: '9%' }] } } as unknown as BuildingDetailsResponse;
    expect(findGroupValue(d, 'ROI')).toBe('9%');
    expect(findGroupValue(d, 'Creator')).toBeUndefined();
  });
});

describe('hero actions', () => {
  const base = { isCivic: false, isCapitol: false, isOwner: false, ownerTycoon: undefined, townName: undefined };

  it('offers write-to-owner when the Creator is known, owner tools to the owner', () => {
    expect(heroActionFlags({ ...base, ownerTycoon: 'Bob', isOwner: true })).toEqual({ writeOwner: 'Bob', writeMayorTown: null, ownerTools: true });
    expect(heroActionFlags(base)).toEqual({ writeOwner: null, writeMayorTown: null, ownerTools: false });
  });

  it('offers write-to-mayor on a Town Hall only, never owner tools on a civic building', () => {
    expect(heroActionFlags({ ...base, isCivic: true, townName: 'Helartia', isOwner: true, ownerTycoon: 'X' })).toEqual({ writeOwner: null, writeMayorTown: 'Helartia', ownerTools: false });
    expect(heroActionFlags({ ...base, isCivic: true, isCapitol: true, townName: 'Helartia' }).writeMayorTown).toBeNull();
    expect(heroActionFlags({ ...base, isCivic: true }).writeMayorTown).toBeNull();
  });
});
