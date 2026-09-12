import { describe, it, expect } from '@jest/globals';
import { homeTileAction } from './home-tiles';
import type { SearchMenuCategory } from '@/shared/types';

function cat(id: string): SearchMenuCategory {
  return { id, label: id, enabled: true };
}

describe('homeTileAction', () => {
  it.each([
    ['Towns', 'towns'],
    ['Tycoons', 'people'],
    ['Rankings', 'rankings'],
    ['Banks', 'banks'],
    ['Newspapers', 'media'],
  ])('maps %s to the %s page', (id, page) => {
    expect(homeTileAction(cat(id))).toEqual({ kind: 'page', page });
  });

  it('maps id "local" to capitol', () => {
    expect(homeTileAction(cat('local'))).toEqual({ kind: 'capitol' });
  });

  it('maps id "capitol" to capitol', () => {
    expect(homeTileAction(cat('capitol'))).toEqual({ kind: 'capitol' });
  });

  it('maps RenderTycoon to you', () => {
    expect(homeTileAction(cat('RenderTycoon'))).toEqual({ kind: 'you' });
  });

  it('returns null for an unknown id', () => {
    expect(homeTileAction(cat('Weather'))).toBeNull();
  });

  it('returns null for the empty id', () => {
    expect(homeTileAction(cat(''))).toBeNull();
  });

  it('is case-sensitive: a lowercase "towns" does not match', () => {
    expect(homeTileAction(cat('towns'))).toBeNull();
  });
});
