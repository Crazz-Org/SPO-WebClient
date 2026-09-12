import { buildMonotonePath, computeYTicks, formatThousands, xAxisYears } from './RevenueGraph';

// =============================================================================
// buildMonotonePath
// =============================================================================

describe('buildMonotonePath', () => {
  it('returns empty string for empty points', () => {
    expect(buildMonotonePath([])).toBe('');
  });

  it('returns M command for single point', () => {
    expect(buildMonotonePath([{ x: 10, y: 20 }])).toBe('M10,20');
  });

  it('returns L (line) for two points', () => {
    const result = buildMonotonePath([{ x: 0, y: 0 }, { x: 100, y: 50 }]);
    expect(result).toBe('M0,0L100,50');
  });

  it('returns cubic bezier (C commands) for three or more points', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 50, y: 50 },
      { x: 100, y: 80 },
    ];
    const result = buildMonotonePath(points);
    expect(result).toMatch(/^M0,100C/);
    // Should have exactly 2 C commands (3 points = 2 segments)
    const cCount = (result.match(/C/g) || []).length;
    expect(cCount).toBe(2);
  });

  it('generates smooth path for typical revenue data', () => {
    const data = [-29, -25, -18, -10, 5, 15, 22, 30, 28, 35, 42, 38];
    const points = data.map((v, i) => ({ x: i * 30, y: 100 - v }));
    const result = buildMonotonePath(points);

    // Should start at first point
    expect(result).toMatch(/^M0,129/);
    // Should have 11 C commands (12 points = 11 segments)
    const cCount = (result.match(/C/g) || []).length;
    expect(cCount).toBe(11);
    // Path should end at last point
    expect(result).toMatch(/,62$/);
  });

  it('handles flat line (all same y)', () => {
    const points = [
      { x: 0, y: 50 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ];
    const result = buildMonotonePath(points);
    expect(result).toMatch(/^M0,50C/);
    // Control points should have y close to 50 (flat tangents)
    // The path should contain values near 50 for all y coordinates
    expect(result).toContain(',50');
  });

  it('handles monotonically increasing data', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 50, y: 75 },
      { x: 100, y: 50 },
      { x: 150, y: 25 },
    ];
    const result = buildMonotonePath(points);
    // Should have 3 C commands
    const cCount = (result.match(/C/g) || []).length;
    expect(cCount).toBe(3);
  });

  it('handles sign changes (positive/negative crossover)', () => {
    const points = [
      { x: 0, y: 120 },   // negative value (y > baseline)
      { x: 50, y: 100 },  // zero crossing
      { x: 100, y: 80 },  // positive value (y < baseline)
    ];
    const result = buildMonotonePath(points);
    expect(result).toMatch(/^M0,120C/);
    const cCount = (result.match(/C/g) || []).length;
    expect(cCount).toBe(2);
  });
});

// =============================================================================
// computeYTicks
// =============================================================================

describe('computeYTicks', () => {
  it('returns nice ticks for typical positive range', () => {
    const ticks = computeYTicks(0, 42, 4);
    // Should include 0 and span above 42
    expect(ticks[0]).toBeLessThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(42);
    // Should be evenly spaced
    const step = ticks[1] - ticks[0];
    for (let i = 2; i < ticks.length; i++) {
      expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step);
    }
  });

  it('returns nice ticks for mixed positive/negative range', () => {
    const ticks = computeYTicks(-29, 42, 4);
    expect(ticks[0]).toBeLessThanOrEqual(-29);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(42);
    // Should include 0 in the ticks (or between ticks)
    expect(ticks.some(t => t <= 0)).toBe(true);
    expect(ticks.some(t => t >= 0)).toBe(true);
  });

  it('returns nice ticks for all-negative range', () => {
    const ticks = computeYTicks(-36, -8, 4);
    expect(ticks[0]).toBeLessThanOrEqual(-36);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(-8);
  });

  it('handles min === max (flat data)', () => {
    const ticks = computeYTicks(10, 10, 4);
    // Should return a small spread around the value
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks).toContain(10);
  });

  it('handles min === max === 0', () => {
    const ticks = computeYTicks(0, 0, 4);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks).toContain(0);
  });

  it('returns evenly spaced ticks', () => {
    const ticks = computeYTicks(0, 100, 4);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    const step = ticks[1] - ticks[0];
    expect(step).toBeGreaterThan(0);
    for (let i = 2; i < ticks.length; i++) {
      expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step);
    }
  });

  it('picks nice round step values', () => {
    const ticks = computeYTicks(0, 97, 4);
    const step = ticks[1] - ticks[0];
    // Step should be a "nice" number (multiple of 1, 2, 5, 10, 20, 50, etc.)
    const normalized = step / Math.pow(10, Math.floor(Math.log10(step)));
    expect([1, 2, 5, 10]).toContain(Math.round(normalized));
  });

  it('handles large values', () => {
    const ticks = computeYTicks(-500000, 1200000, 4);
    expect(ticks[0]).toBeLessThanOrEqual(-500000);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(1200000);
    const step = ticks[1] - ticks[0];
    expect(step).toBeGreaterThan(0);
  });

  it('handles small fractional values', () => {
    const ticks = computeYTicks(-0.5, 1.2, 4);
    expect(ticks[0]).toBeLessThanOrEqual(-0.5);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(1.2);
  });
});

// =============================================================================
// formatThousands
// =============================================================================

describe('formatThousands', () => {
  it('formats a positive value in thousands', () => {
    expect(formatThousands(42)).toBe('$42.00K');
  });

  it('formats a negative value in thousands', () => {
    expect(formatThousands(-29)).toBe('-$29.00K');
  });

  it('formats zero', () => {
    expect(formatThousands(0)).toBe('$0.00');
  });

  it('picks the million suffix once the thousands value crosses 1e6', () => {
    expect(formatThousands(1500)).toBe('$1.50M');
  });
});

// =============================================================================
// xAxisYears
// =============================================================================

describe('xAxisYears', () => {
  it('ends at endYear and counts back for each preceding point', () => {
    expect(xAxisYears(12, 2333)).toEqual([
      2322, 2323, 2324, 2325, 2326, 2327, 2328, 2329, 2330, 2331, 2332, 2333,
    ]);
  });

  it('returns just endYear for a single point', () => {
    expect(xAxisYears(1, 2333)).toEqual([2333]);
  });

  it('falls back to a 1-based index when endYear is undefined', () => {
    expect(xAxisYears(3, undefined)).toEqual([1, 2, 3]);
  });
});
