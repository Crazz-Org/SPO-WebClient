import { describe, it, expect } from '@jest/globals';
import { homeTileAction } from './home-tiles';

describe('homeTileAction', () => {
  it.each([
    ['local', { kind: 'capitol' }],
    ['capitol', { kind: 'capitol' }],
    ['towns', { kind: 'page', page: 'towns' }],
    ['rendertycoon', { kind: 'you' }],
    ['tycoons', { kind: 'page', page: 'people' }],
    ['rankings', { kind: 'page', page: 'rankings' }],
    ['banks', { kind: 'page', page: 'banks' }],
    ['newspapers', { kind: 'page', page: 'media' }],
  ])('maps id %s to %j', (id, expected) => {
    expect(homeTileAction({ id })).toEqual(expected);
  });

  it('matches case-insensitively', () => {
    expect(homeTileAction({ id: 'Towns' })).toEqual({ kind: 'page', page: 'towns' });
    expect(homeTileAction({ id: 'TOWNS' })).toEqual({ kind: 'page', page: 'towns' });
  });

  it('returns null for an unknown id', () => {
    expect(homeTileAction({ id: 'Facilities' })).toBeNull();
  });
});
