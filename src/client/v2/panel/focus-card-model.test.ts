import { describe, it, expect, afterEach } from '@jest/globals';
import type { BuildingFocusInfo } from '@/shared/types';
import { registerCivicVisualClass, clearCivicVisualClassIds } from '@/shared/building-details/civic-buildings';
import { allFacts, buildFocusCard, salesTone, toneOf, MAX_FACTS, MAX_SALES_ROWS } from './focus-card-model';
import type { RichDetails } from '../../components/building/RichDetails';

const base: BuildingFocusInfo = {
  buildingId: '1',
  buildingName: 'Drug Store',
  ownerName: 'SPO_test3 - Green',
  salesInfo: '',
  revenue: '',
  detailsText: '',
  hintsText: '',
  x: 10, y: 20, xsize: 2, ysize: 2,
  visualClass: '300',
};

const focus = (over: Partial<BuildingFocusInfo>): BuildingFocusInfo => ({ ...base, ...over });

describe('toneOf / salesTone', () => {
  it('maps every metric colour to a tone', () => {
    expect(toneOf('success')).toBe('positive');
    expect(toneOf('warning')).toBe('warning');
    expect(toneOf('error')).toBe('negative');
    expect(toneOf('gold')).toBe('gold');
    expect(toneOf('default')).toBe('neutral');
    expect(toneOf(undefined)).toBe('neutral');
  });

  it('uses the classic sales thresholds', () => {
    expect(salesTone(25)).toBe('negative');
    expect(salesTone(26)).toBe('warning');
    expect(salesTone(60)).toBe('warning');
    expect(salesTone(61)).toBe('positive');
  });
});

describe('buildFocusCard — identity', () => {
  afterEach(() => clearCivicVisualClassIds());

  it('names, levels and owns the building; Inspect for a private facility', () => {
    const m = buildFocusCard(focus({ detailsText: 'Upgrade Level: 4  Items Sold: 900', revenue: '$1,200/h' }));
    expect(m.name).toBe('Drug Store');
    expect(m.level).toBe(4);
    expect(m.owner).toBe('SPO_test3 - Green');
    expect(m.revenue).toEqual({ text: '$1,200/h', direction: 'up' });
    expect(m.isCivic).toBe(false);
    expect(m.actionLabel).toBe('Inspect');
  });

  it('Visit for a civic building', () => {
    registerCivicVisualClass('9999');
    const m = buildFocusCard(focus({ visualClass: '9999' }));
    expect(m.isCivic).toBe(true);
    expect(m.actionLabel).toBe('Visit');
  });

  it('treats a missing visual class as non-civic', () => {
    expect(buildFocusCard(focus({ visualClass: '' })).isCivic).toBe(false);
  });

  it('no revenue, no level, no details → empty optional parts', () => {
    const m = buildFocusCard(focus({}));
    expect(m.revenue).toBeNull();
    expect(m.level).toBeNull();
    expect(m.facts).toEqual([]);
    expect(m.factsOmitted).toBe(0);
    expect(m.note).toBeNull();
    expect(m.sales).toBeNull();
    expect(m.salesText).toBeNull();
    expect(m.hint).toBeNull();
  });

  it('revenue direction follows the classic rule', () => {
    expect(buildFocusCard(focus({ revenue: '(-$36/h)' })).revenue?.direction).toBe('down');
    expect(buildFocusCard(focus({ revenue: '$0/h' })).revenue?.direction).toBe('neutral');
  });
});

describe('buildFocusCard — diagnosis and hint', () => {
  it('a recognised hint becomes the diagnosis, not a raw line', () => {
    const m = buildFocusCard(focus({ hintsText: 'Warning: This facility needs more qualified work force.' }));
    expect(m.diagnosis.severity).not.toBe('none');
    expect(m.hint).toBeNull();
  });

  it('the placeholder hint is never shown', () => {
    expect(buildFocusCard(focus({ hintsText: 'No hints for this facility.' })).hint).toBeNull();
  });

  it('a hint the diagnosis stays silent on is shown raw', () => {
    const text = 'This facility belongs to Someone. There are no hints for you.';
    const m = buildFocusCard(focus({ hintsText: text }));
    expect(m.diagnosis.severity).toBe('none');
    expect(m.hint).toBe(text);
  });
});

describe('buildFocusCard — facts per building type', () => {
  it('store: efficiency first, then customers, then the rest — two shown, the rest counted', () => {
    const m = buildFocusCard(focus({
      detailsText: 'Upgrade Level: 3  Items Sold: 40/h  Potential customers (per day): 1 hi, 6 mid, 2083 low. Actual customers: 1 hi, 3 mid, 949 low.  Efficiency: 89%  Desirability: 51',
    }));
    expect(m.facts).toHaveLength(MAX_FACTS);
    expect(m.facts[0]).toEqual({ label: 'Efficiency', value: '89%', tone: 'positive' });
    expect(m.facts[1].label).toBe('Customers');
    expect(m.facts[1].value).toBe('1 hi, 3 mid, 949 low');
    expect(m.facts[1].sub).toBe('of 1 hi, 6 mid, 2083 low /day');
    expect(m.factsOmitted).toBe(2);
  });

  it('store without customers: the metrics alone', () => {
    const m = buildFocusCard(focus({ detailsText: 'Upgrade Level: 1  Items Sold: 18/h  Efficiency: 92%  Desirability: 53' }));
    expect(m.facts.map((f) => f.label)).toEqual(['Efficiency', 'Items Sold']);
  });

  it('farm: each product with its quality and efficiency, then the workforce', () => {
    const m = buildFocusCard(focus({
      detailsText: 'Upgrade Level: 8  Producing: 1970 kg/day of Fresh Food at 51% quality index, 100% efficiency.. 329 kg/day of Organic Materials at 51% quality index, 100% efficiency..',
    }));
    expect(m.level).toBe(8);
    expect(m.facts[0]).toEqual({ label: 'Fresh Food', value: '1,970 kg/day', tone: 'positive', sub: '51% quality · 100% eff.' });
    expect(m.facts[1].label).toBe('Organic Materials');
  });

  it('farm product with neither quality nor efficiency has no qualifier', () => {
    const rich: RichDetails = { category: 'farm', producing: [{ name: 'Wheat', volume: '10 t' }], metrics: [{ label: 'Workers', value: '3 of 4' }] };
    expect(allFacts(rich)).toEqual([
      { label: 'Wheat', value: '10 t', tone: 'neutral' },
      { label: 'Workers', value: '3 of 4', tone: 'neutral' },
    ]);
  });

  it('storage: what it holds, with quality', () => {
    const m = buildFocusCard(focus({
      detailsText: 'Upgrade Level: 1  Storing: 684375 kg of Fresh Food at 51% qualiy index.  114065 kg of Organic Materials at 51% qualiy index.',
    }));
    expect(m.facts[0]).toEqual({ label: 'Fresh Food', value: '684,375 kg', tone: 'warning', sub: '51% quality' });
    expect(allFacts({ category: 'storage', storing: [{ name: 'Ore', amount: '5 t' }] })).toEqual([{ label: 'Ore', value: '5 t', tone: 'neutral' }]);
    expect(allFacts({ category: 'storage' })).toEqual([]);
  });

  it('residential: inhabitants, then quality of life', () => {
    const m = buildFocusCard(focus({
      detailsText: 'Upgrade Level: 3  4982 inhabitants. 15 desirability. QOL: 14% Neighborhood Quality: 104% Beauty: 1% Crime: 0% Pollution: 36%.',
    }));
    expect(m.facts[0]).toEqual({ label: 'Inhabitants', value: '4,982', tone: 'neutral' });
    expect(m.facts[1]).toEqual({ label: 'QOL', value: '14%', tone: 'negative' });
    expect(m.factsOmitted).toBeGreaterThan(0);
    expect(allFacts({ category: 'residential', desirability: '20' })).toEqual([{ label: 'Desirability', value: '20', tone: 'neutral' }]);
  });

  it('public: coverages', () => {
    const m = buildFocusCard(focus({
      detailsText: 'Upgrade Level: 1   Police Coverage coverage accross the city reported at 91%. Fire Coverage coverage accross the city reported at 100%.',
    }));
    expect(m.facts.map((f) => f.label)).toEqual(['Police Coverage', 'Fire Coverage']);
  });

  it('town hall: total population first, then the classes', () => {
    const m = buildFocusCard(focus({ detailsText: '143 High class (0% unemp), 385 Middle class (15% unemp), 4,981 Low class (57% unemp).' }));
    expect(m.facts[0]).toEqual({ label: 'Population', value: '5,509', tone: 'neutral' });
    expect(m.facts[1]).toEqual({ label: 'High class', value: '143', tone: 'positive' });
    expect(m.factsOmitted).toBe(2);
    expect(allFacts({ category: 'townhall' })).toEqual([]);
    expect(allFacts({ category: 'townhall', classes: [{ label: 'Low class', value: 'n/a' }] })[0].value).toBe('0');
  });

  it('headquarters: research figure, status as the note', () => {
    const m = buildFocusCard(focus({ detailsText: 'Company supported at 200%. Research Implementation: $0.' }));
    expect(m.facts).toEqual([{ label: 'Research', value: '$0', tone: 'neutral' }]);
    expect(m.note).toBe('Company supported at 200%');
    expect(allFacts({ category: 'hq' })).toEqual([]);
  });

  it('generic: the parsed key/value entries', () => {
    expect(allFacts({ category: 'generic', entries: [{ label: 'A', value: '1' }] })).toEqual([{ label: 'A', value: '1', tone: 'neutral' }]);
    expect(allFacts({ category: 'generic' })).toEqual([]);
  });

  it('unparseable details are kept as the note', () => {
    const m = buildFocusCard(focus({ detailsText: '???' }));
    expect(m.facts).toEqual([]);
    expect(m.note).toBe('???');
  });
});

describe('buildFocusCard — sales', () => {
  it('parsed lines, capped, the rest counted', () => {
    const m = buildFocusCard(focus({
      salesInfo: 'A sales at 10%\nB sales at 50%\nC sales at 90%\nD sales at 70%\nE sales at 20%',
    }));
    expect(m.sales?.lines).toHaveLength(MAX_SALES_ROWS);
    expect(m.sales?.lines[0]).toEqual({ category: 'A', percent: 10 });
    expect(m.sales?.more).toBe(2);
    expect(m.salesText).toBeNull();
  });

  it('unparseable sales text is kept as is', () => {
    const m = buildFocusCard(focus({ salesInfo: 'Nothing for sale yet' }));
    expect(m.sales).toBeNull();
    expect(m.salesText).toBe('Nothing for sale yet');
  });
});
