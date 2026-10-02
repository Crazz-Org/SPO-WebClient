import { describe, it, expect } from '@jest/globals';
import type { BuildingDetailsResponse, BuildingDetailsTab, BuildingFocusInfo, PoliticsData } from '@/shared/types';
import { parseFacilityDiagnosis } from '@/shared/building-details/facility-diagnosis';
import {
  OVERVIEW_TAB_ID,
  activeCivicTabId,
  activeStandardTabId,
  attributionLine,
  buildHeroKpis,
  buildStandardTabs,
  civicRulerLine,
  detailsMatchFocus,
  findGroupValue,
  inspectorDiagnosis,
  scrollEdges,
  sectionBodyState,
  sectionLabel,
  sectionReadTab,
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
      { id: 'indGeneral', label: 'General' },
      { id: 'supplies', label: 'Supplies' },
      { id: 'workforce', label: 'Workforce' },
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

describe('section labels', () => {
  it('title-cases an all-capitals server name and keeps any authored casing', () => {
    expect(sectionLabel('HISTORY')).toBe('History');
    expect(sectionLabel('R&D LAB')).toBe('R&D Lab');
    expect(sectionLabel('TOWN-HALL/JOBS')).toBe('Town-Hall/Jobs');
    expect(sectionLabel('Overview')).toBe('Overview');
    expect(sectionLabel('Research')).toBe('Research');
    expect(sectionLabel('ÉLECTIONS')).toBe('Élections');
    expect(sectionLabel('')).toBe('');
  });
});

describe('switching facilities', () => {
  it('draws details only when they describe the focused facility', () => {
    expect(detailsMatchFocus({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(detailsMatchFocus({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
    expect(detailsMatchFocus({ x: 4, y: 2 }, { x: 1, y: 2 })).toBe(false);
    expect(detailsMatchFocus(null, { x: 1, y: 2 })).toBe(false);
    expect(detailsMatchFocus({ x: 1, y: 2 }, null)).toBe(false);
  });

  it('reads the tab the strip shows open, never a stale one', () => {
    expect(sectionReadTab(false, 'workforce', undefined)).toBe('workforce');
    expect(sectionReadTab(false, null, undefined)).toBe('');
    expect(sectionReadTab(true, null, 'elections')).toBe('elections');
    expect(sectionReadTab(true, null, undefined)).toBe('');
  });
});

describe('section body state', () => {
  const base = { base: 'ready' as const, loadState: undefined, readPending: false, hasRows: true };

  it('passes error and loading straight through', () => {
    expect(sectionBodyState({ ...base, base: 'error' })).toBe('error');
    expect(sectionBodyState({ ...base, base: 'loading' })).toBe('loading');
  });

  it('is loading while a section with no rows is read, or owed a read', () => {
    expect(sectionBodyState({ ...base, hasRows: false, loadState: 'loading' })).toBe('loading');
    expect(sectionBodyState({ ...base, hasRows: false, loadState: 'idle', readPending: true })).toBe('loading');
    expect(sectionBodyState({ ...base, hasRows: false, readPending: true })).toBe('loading');
  });

  it('keeps rows on screen while they are re-read, and an empty loaded section is ready', () => {
    expect(sectionBodyState({ ...base, loadState: 'loading', readPending: true })).toBe('ready');
    expect(sectionBodyState({ ...base, hasRows: false, loadState: 'loaded' })).toBe('ready');
  });
});

describe('civic ruler line', () => {
  const townTabs: BuildingDetailsTab[] = [{ id: 'townGeneral', name: 'GENERAL', order: 0, icon: '', handlerName: 'townGeneral' }];
  const capitolTabs: BuildingDetailsTab[] = [{ id: 'capitolTowns', name: 'TOWNS', order: 0, icon: '', handlerName: 'X' }];
  const hall = (groups: BuildingDetailsResponse['groups'], tabs = townTabs): BuildingDetailsResponse => ({
    buildingId: 'b', x: 1, y: 2, visualClass: '9999', templateName: 'T', buildingName: 'Helartia Town Hall',
    ownerName: 'Helartia', securityId: '', canGovern: false, tabs, groups, timestamp: 0,
  });
  const politics = (over: Partial<PoliticsData>): PoliticsData =>
    ({ townName: 'Helartia', isCapitol: false, hasRuler: true, mayorName: 'SPO_test3', ...over }) as PoliticsData;
  const town = { townGeneral: [{ name: 'Town', value: 'Helartia' }] };

  it('names the mayor from the politics page of this town', () => {
    expect(civicRulerLine(hall(town), politics({}))).toBe('Mayor: SPO_test3');
  });

  it('ignores a politics page about another town, another office, or with no ruler', () => {
    expect(civicRulerLine(hall(town), politics({ townName: 'Elsewhere' }))).toBe('');
    expect(civicRulerLine(hall(town), politics({ isCapitol: true }))).toBe('');
    expect(civicRulerLine(hall(town), politics({ hasRuler: false }))).toBe('');
    expect(civicRulerLine(hall({}), politics({}))).toBe('');
  });

  it('falls back to the ruler properties, and never to the owner (the town itself)', () => {
    expect(civicRulerLine(hall({ townGeneral: [{ name: 'ActualRuler', value: 'Crazz' }] }), null)).toBe('Mayor: Crazz');
    expect(civicRulerLine(hall({ townGeneral: [{ name: 'RulerName', value: 'Bob' }] }), null)).toBe('Mayor: Bob');
    expect(civicRulerLine(hall(town), null)).toBe('');
  });

  it('names the president on the Capitol, whatever town the politics page names', () => {
    expect(civicRulerLine(hall({}, capitolTabs), politics({ isCapitol: true, townName: '', mayorName: 'Prez' }))).toBe('President: Prez');
    expect(civicRulerLine(hall({ g: [{ name: 'ActualRuler', value: 'Crazz' }] }, capitolTabs), null)).toBe('President: Crazz');
  });
});

describe('inspector diagnosis', () => {
  it('drops a hint that sends the player to the inspector they are already in', () => {
    const d = inspectorDiagnosis(parseFacilityDiagnosis('', 'Hint: Go to INSPECT to carry out new researchs.'));
    expect(d.severity).toBe('none');
    expect(d.message).toBe('');
  });

  it('keeps every other diagnosis, including one rewritten from an INSPECT sentence', () => {
    const rewritten = parseFacilityDiagnosis('', 'Warning: This facility is lacking services. Check the Services Tab on the INSPECT panel.');
    expect(inspectorDiagnosis(rewritten)).toBe(rewritten);
    const other = parseFacilityDiagnosis('', 'Warning: Not enough company support.');
    expect(inspectorDiagnosis(other)).toBe(other);
    expect(inspectorDiagnosis(parseFacilityDiagnosis('', 'Hint: inspector-free sentence.')).severity).toBe('hint');
  });
});

describe('scroll edges', () => {
  it('offers an arrow only towards hidden tabs', () => {
    expect(scrollEdges(0, 478, 478)).toEqual({ left: false, right: false });
    expect(scrollEdges(0, 478, 672)).toEqual({ left: false, right: true });
    expect(scrollEdges(100, 478, 672)).toEqual({ left: true, right: true });
    expect(scrollEdges(194, 478, 672)).toEqual({ left: true, right: false });
    expect(scrollEdges(193.5, 478, 672)).toEqual({ left: true, right: false });
  });
});
