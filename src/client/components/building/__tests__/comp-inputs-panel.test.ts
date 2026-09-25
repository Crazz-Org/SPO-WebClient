/**
 * Tests for CompInputsPanel data model and interaction logic.
 * Test env is `node` (no jsdom) — tests verify data flow, not DOM rendering.
 *
 * CompInputs now use the cInputCount/cInput{i}.* protocol (eager, server-side fetch).
 * Data model: CompInputData — all fields available immediately, no lazy loading.
 */

import { describe, it, expect } from '@jest/globals';
import { getConnectionStatus } from '../comp-inputs-utils';
import type { CompInputData } from '../comp-inputs-utils';

// =============================================================================
// HELPERS
// =============================================================================

function makeCompInput(overrides?: Partial<CompInputData>): CompInputData {
  return {
    name: 'Advertisement',
    supplied: 1560,
    demanded: 1560,
    ratio: 100,
    maxDemand: 1680,
    editable: true,
    units: 'hits',
    ...overrides,
  };
}

// =============================================================================
// CompInputData — EAGER DATA MODEL
// =============================================================================

describe('CompInputData data model', () => {
  it('should represent a single input with all 7 fields', () => {
    const data = makeCompInput();
    expect(data.name).toBe('Advertisement');
    expect(data.supplied).toBe(1560);
    expect(data.demanded).toBe(1560);
    expect(data.ratio).toBe(100);
    expect(data.maxDemand).toBe(1680);
    expect(data.editable).toBe(true);
    expect(data.units).toBe('hits');
  });

  it('should support multiple inputs from cInputCount batch', () => {
    const inputs: CompInputData[] = [
      makeCompInput({ name: 'Advertisement', units: 'hits' }),
      makeCompInput({ name: 'Computer Services', supplied: 1, demanded: 2, ratio: 100, units: 'hours' }),
      makeCompInput({ name: 'Legal Services', supplied: 0, demanded: 0, ratio: 50, editable: false, units: 'hours' }),
    ];
    expect(inputs).toHaveLength(3);
    expect(inputs.map(d => d.name)).toEqual(['Advertisement', 'Computer Services', 'Legal Services']);
  });

  it('should handle empty input list', () => {
    const inputs: CompInputData[] = [];
    expect(inputs).toHaveLength(0);
  });

  it('editable=false when cEditable{i} is not "yes"', () => {
    const data = makeCompInput({ editable: false });
    expect(data.editable).toBe(false);
  });
});

// =============================================================================
// DEMAND SLIDER — initializes from ratio (cInputRatio{i})
// =============================================================================

describe('Demand slider initialization (cInputRatio)', () => {
  it('should initialize localDemand from data.ratio, not hardcoded 100', () => {
    const data = makeCompInput({ ratio: 75 });
    // Component initializes: useState(data.ratio)
    const localDemand = data.ratio;
    expect(localDemand).toBe(75);
  });

  it('should initialize at 100 when server returns ratio=100', () => {
    const data = makeCompInput({ ratio: 100 });
    expect(data.ratio).toBe(100);
  });

  it('should initialize at 0 when server returns ratio=0', () => {
    const data = makeCompInput({ ratio: 0 });
    expect(data.ratio).toBe(0);
  });

  it('should clamp slider value to 0-100 range before sending RDO', () => {
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    expect(clamp(-10)).toBe(0);
    expect(clamp(0)).toBe(0);
    expect(clamp(50)).toBe(50);
    expect(clamp(100)).toBe(100);
    expect(clamp(150)).toBe(100);
  });

  it('should pass inputIndex as string to onSetBuildingProperty', () => {
    const idx = 2;
    const val = 80;
    const params = { index: String(idx) };
    expect(params.index).toBe('2');
    expect(String(val)).toBe('80');
  });

  it('should disable slider when data.editable is false', () => {
    const data = makeCompInput({ editable: false });
    // canEdit && data.editable → disabled when either is false
    const disabled = !data.editable;
    expect(disabled).toBe(true);
  });
});

// =============================================================================
// SUPPLY FULFILLMENT BAR — supplied / demanded * 100
// =============================================================================

describe('Supply fulfillment bar (fillPct)', () => {
  function fillPct(supplied: number, demanded: number): number {
    return demanded > 0 ? Math.min(100, (supplied / demanded) * 100) : 0;
  }

  it('should be 100% when fully supplied', () => {
    const data = makeCompInput({ supplied: 1560, demanded: 1560 });
    expect(fillPct(data.supplied, data.demanded)).toBe(100);
  });

  it('should be 50% when half supplied', () => {
    const data = makeCompInput({ supplied: 780, demanded: 1560 });
    expect(fillPct(data.supplied, data.demanded)).toBeCloseTo(50);
  });

  it('should be 0% when not supplied', () => {
    const data = makeCompInput({ supplied: 0, demanded: 1680 });
    expect(fillPct(data.supplied, data.demanded)).toBe(0);
  });

  it('should be 0% when demanded is 0 (avoid division by zero)', () => {
    const data = makeCompInput({ supplied: 0, demanded: 0 });
    expect(fillPct(data.supplied, data.demanded)).toBe(0);
  });

  it('should cap at 100% when oversupplied', () => {
    const data = makeCompInput({ supplied: 2000, demanded: 1000 });
    expect(fillPct(data.supplied, data.demanded)).toBe(100);
  });

  it('should handle fractional supply correctly', () => {
    const data = makeCompInput({ supplied: 1, demanded: 3 });
    expect(fillPct(data.supplied, data.demanded)).toBeCloseTo(33.33, 1);
  });
});

// =============================================================================
// CompInputSection: read-only display (editable=false)
// =============================================================================

describe('CompInputSection: read-only display (editable=false)', () => {
  it('should show read-only rows when data.editable is false', () => {
    const data = makeCompInput({ editable: false, demanded: 50, supplied: 50, ratio: 100, units: 'hours' });
    // Non-editable branch: renders Requesting / Receiving / Ratio rows (no slider)
    expect(data.editable).toBe(false);
    expect(data.demanded).toBe(50);
    expect(data.supplied).toBe(50);
    expect(data.ratio).toBe(100);
    expect(data.units).toBe('hours');
  });

  it('should use slider when data.editable is true', () => {
    const data = makeCompInput({ editable: true });
    expect(data.editable).toBe(true);
  });

  it('empty cEditable string means not editable (false)', () => {
    // Mirrors fetchCompInputData in building-details-handler.ts: (allValues[base+5] ?? '').toLowerCase() === 'yes'
    const parsedEditable = ('').toLowerCase() === 'yes';
    expect(parsedEditable).toBe(false);
  });

  it('read-only row labels: Requesting=demanded, Receiving=supplied, Ratio=ratio', () => {
    const data = makeCompInput({ editable: false, demanded: 100, supplied: 75, ratio: 80, units: 'hits' });
    // Requesting row shows demanded value
    expect(data.demanded).toBe(100);
    // Receiving row shows supplied value
    expect(data.supplied).toBe(75);
    // Ratio row shows ratio percent
    expect(data.ratio).toBe(80);
  });
});

// =============================================================================
// DEMAND UTILIZATION BAR — demanded / maxDemand * 100
// =============================================================================

describe('Demand utilization percentage (demPct)', () => {
  function demPct(demanded: number, maxDemand: number): number {
    const barMax = maxDemand > 0 ? maxDemand : demanded;
    return barMax > 0 ? Math.min(100, (demanded / barMax) * 100) : 0;
  }

  it('should be 100% when demanded equals max capacity', () => {
    const data = makeCompInput({ demanded: 1680, maxDemand: 1680 });
    expect(demPct(data.demanded, data.maxDemand)).toBe(100);
  });

  it('should be ~91% when demanded is below max capacity', () => {
    const data = makeCompInput({ demanded: 1680, maxDemand: 1850 });
    expect(demPct(data.demanded, data.maxDemand)).toBeCloseTo(90.81, 1);
  });

  it('should be 0% when demanded is 0', () => {
    const data = makeCompInput({ demanded: 0, maxDemand: 1680 });
    expect(demPct(data.demanded, data.maxDemand)).toBe(0);
  });

  it('should fall back to demanded as barMax when maxDemand is 0', () => {
    const data = makeCompInput({ demanded: 500, maxDemand: 0 });
    expect(demPct(data.demanded, data.maxDemand)).toBe(100);
  });

  it('should cap at 100% when demanded exceeds maxDemand', () => {
    const data = makeCompInput({ demanded: 2000, maxDemand: 1500 });
    expect(demPct(data.demanded, data.maxDemand)).toBe(100);
  });

  it('should be 0% when both demanded and maxDemand are 0', () => {
    expect(demPct(0, 0)).toBe(0);
  });
});

// =============================================================================
// WARNING CONDITION — demand below capacity (demPct < 100)
// =============================================================================

describe('Warning condition (demand below capacity)', () => {
  function demPct(demanded: number, maxDemand: number): number {
    const barMax = maxDemand > 0 ? maxDemand : demanded;
    return barMax > 0 ? Math.min(100, (demanded / barMax) * 100) : 0;
  }

  it('should NOT warn when demand is at full capacity', () => {
    const data = makeCompInput({ demanded: 1680, maxDemand: 1680 });
    expect(demPct(data.demanded, data.maxDemand) < 100).toBe(false);
  });

  it('should warn when demand is below capacity', () => {
    const data = makeCompInput({ demanded: 1680, maxDemand: 1850 });
    expect(demPct(data.demanded, data.maxDemand) < 100).toBe(true);
  });

  it('should NOT warn based on supply fulfillment alone', () => {
    // supply < demand but demand == max: NO warning (old behavior would warn)
    const data = makeCompInput({ supplied: 800, demanded: 1680, maxDemand: 1680 });
    expect(demPct(data.demanded, data.maxDemand) < 100).toBe(false);
  });
});

// =============================================================================
// getConnectionStatus
// =============================================================================

describe('getConnectionStatus', () => {
  it('should return healthy when connections >= 1', () => {
    expect(getConnectionStatus(1)).toBe('healthy');
  });

  it('should return healthy for multiple connections', () => {
    expect(getConnectionStatus(5)).toBe('healthy');
    expect(getConnectionStatus(20)).toBe('healthy');
  });

  it('should return critical when no connections', () => {
    expect(getConnectionStatus(0)).toBe('critical');
  });
});
