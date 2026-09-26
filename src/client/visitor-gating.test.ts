import { describe, it, expect } from '@jest/globals';
import type { SurfaceKind } from './store/ui-store';
import { VISITOR_GATED_PANELS, isPanelOffered } from './visitor-gating';

describe('visitor-gating', () => {
  it('gates exactly build, empire and facilities', () => {
    expect([...VISITOR_GATED_PANELS].sort()).toEqual(['build', 'empire', 'facilities']);
  });

  it('offers every panel to a non-visitor', () => {
    const all: SurfaceKind[] = ['build', 'empire', 'facilities', 'map', 'politics', 'mail', 'overlays', 'search'];
    for (const panel of all) expect(isPanelOffered(panel, false)).toBe(true);
  });

  it('refuses a visitor the gated panels and offers the rest', () => {
    for (const panel of VISITOR_GATED_PANELS) expect(isPanelOffered(panel, true)).toBe(false);
    const open: SurfaceKind[] = ['map', 'politics', 'mail', 'overlays'];
    for (const panel of open) expect(isPanelOffered(panel, true)).toBe(true);
  });
});
