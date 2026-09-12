import { parseRoadCircuits, sharesRoadCircuit } from './road-circuits';

describe('parseRoadCircuits', () => {
  it('splits a trailing-comma list', () => {
    expect(parseRoadCircuits('17,42,')).toEqual(['17', '42']);
  });

  it('returns empty for an empty string', () => {
    expect(parseRoadCircuits('')).toEqual([]);
  });

  it('trims stray spaces', () => {
    expect(parseRoadCircuits(' 17 , 42 ,')).toEqual(['17', '42']);
  });

  it('tolerates a list with no trailing comma', () => {
    expect(parseRoadCircuits('17')).toEqual(['17']);
  });
});

describe('sharesRoadCircuit', () => {
  it('is true when both sides share one id', () => {
    expect(sharesRoadCircuit('17,42,', '17,')).toBe(true);
  });

  it('is false when the ids are disjoint', () => {
    expect(sharesRoadCircuit('17,42,', '99,')).toBe(false);
  });

  // FluidLinks.pas:121 — either side empty makes Intercept false, never true.
  it('is false when the own side is empty', () => {
    expect(sharesRoadCircuit('', '17,')).toBe(false);
  });

  it('is false when the other side is empty', () => {
    expect(sharesRoadCircuit('17,', '')).toBe(false);
  });

  it('is false when both sides are empty', () => {
    expect(sharesRoadCircuit('', '')).toBe(false);
  });

  it('treats "17," and "17" as equal', () => {
    expect(sharesRoadCircuit('17,', '17')).toBe(true);
  });
});
