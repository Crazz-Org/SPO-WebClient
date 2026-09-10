import { describe, it, expect } from '@jest/globals';
import { pageForCategoryId } from './home-tiles';

describe('pageForCategoryId', () => {
  it.each([
    ['towns', 'towns'],
    ['tycoons', 'people'],
    ['rankings', 'rankings'],
    ['banks', 'banks'],
    ['newspapers', 'media'],
    ['rendertycoon', 'tycoon-profile'],
  ] as const)('maps %s -> %s', (id, page) => {
    expect(pageForCategoryId(id)).toBe(page);
  });

  it('is case-insensitive', () => {
    expect(pageForCategoryId('Towns')).toBe('towns');
    expect(pageForCategoryId('RenderTycoon')).toBe('tycoon-profile');
  });

  it('returns null for capitol (a map jump, not a page)', () => {
    expect(pageForCategoryId('capitol')).toBeNull();
  });

  it('returns null for an unknown id', () => {
    expect(pageForCategoryId('weather')).toBeNull();
  });
});
