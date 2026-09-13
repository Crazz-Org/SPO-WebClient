/**
 * Tests for the minimap-source accessors (getConcreteTiles / getFacilityZone) added for the
 * Map surface class/zone colouring (issue 601). Same prototype-`.call()` harness as
 * `renderer-e2e-probe.test.ts` — the monolith is too heavy to instantiate in jsdom.
 */

import { describe, it, expect } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import type { FacilityDimensions } from '@/shared/types';

type Host = {
  concreteTilesSet: Set<string>;
  facilityDimensionsCache: Map<string, FacilityDimensions>;
  getConcreteTiles: () => ReadonlySet<string>;
  getFacilityZone: (visualClass: string) => number | undefined;
};

const proto = IsometricMapRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

function makeHost(opts: { concrete?: Array<[number, number]>; dims?: Record<string, FacilityDimensions> }): Host {
  const host: Host = {
    concreteTilesSet: new Set((opts.concrete ?? []).map(([x, y]) => `${x},${y}`)),
    facilityDimensionsCache: new Map(Object.entries(opts.dims ?? {})),
    getConcreteTiles: null as unknown as Host['getConcreteTiles'],
    getFacilityZone: null as unknown as Host['getFacilityZone'],
  };
  host.getConcreteTiles = () => (proto.getConcreteTiles as (this: Host) => ReadonlySet<string>).call(host);
  host.getFacilityZone = (visualClass) =>
    (proto.getFacilityZone as (this: Host, visualClass: string) => number | undefined).call(host, visualClass);
  return host;
}

describe('minimap-source accessors', () => {
  it('getConcreteTiles returns the host set of "x,y" keys', () => {
    const host = makeHost({ concrete: [[6, 6], [7, 6]] });
    expect(host.getConcreteTiles()).toEqual(new Set(['6,6', '7,6']));
  });

  it('getFacilityZone returns the cached zoneType, undefined for an unknown class', () => {
    const host = makeHost({
      dims: {
        '1': { visualClass: '1', name: 'A', facid: '', xsize: 1, ysize: 1, level: 0, zoneType: 2 },
      },
    });
    expect(host.getFacilityZone('1')).toBe(2);
    expect(host.getFacilityZone('999')).toBeUndefined();
  });
});
