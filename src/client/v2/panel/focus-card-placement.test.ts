import { describe, it, expect } from '@jest/globals';
import {
  placeFocusCard,
  samePlacement,
  CARET_GAP,
  CARET_INSET,
  EDGE_MARGIN,
  TOP_DECK_BOTTOM,
  type FocusCardPlacementInput,
} from './focus-card-model';

/** 1600×900, a 260×200 card, a 64 px building in the middle of the map. */
const base: FocusCardPlacementInput = {
  anchorX: 800,
  textureTop: 450,
  textureHeight: 64,
  cardWidth: 260,
  cardHeight: 200,
  viewportWidth: 1600,
  viewportHeight: 900,
  topInset: TOP_DECK_BOTTOM,
};
const at = (over: Partial<FocusCardPlacementInput>) => placeFocusCard({ ...base, ...over });

describe('placeFocusCard', () => {
  it('sits centred above the building when there is room', () => {
    expect(at({})).toEqual({ left: 670, top: 450 - CARET_GAP - 200, side: 'above', caretX: 130 });
  });

  it('flips below a building near the top of the view, never under the top deck', () => {
    // The walkthrough case: the card top would have been at y = -120.
    const p = at({ textureTop: 88 });
    expect(p.side).toBe('below');
    expect(p.top).toBe(88 + 64 + CARET_GAP);
    expect(p.top).toBeGreaterThanOrEqual(TOP_DECK_BOTTOM + EDGE_MARGIN);
  });

  it('stays above when it exactly fits under the top deck', () => {
    const textureTop = TOP_DECK_BOTTOM + EDGE_MARGIN + 200 + CARET_GAP;
    expect(at({ textureTop })).toMatchObject({ side: 'above', top: TOP_DECK_BOTTOM + EDGE_MARGIN });
  });

  it('when neither side fits, takes the roomier side and clamps into the visible area', () => {
    // A 600 px tall card on a 700 px viewport: no side fits whole.
    const upper = at({ viewportHeight: 700, cardHeight: 600, textureTop: 200 });
    expect(upper.side).toBe('below');
    expect(upper.top).toBe(700 - EDGE_MARGIN - 600);
    const lower = at({ viewportHeight: 700, cardHeight: 600, textureTop: 560 });
    expect(lower.side).toBe('above');
    expect(lower.top).toBe(TOP_DECK_BOTTOM + EDGE_MARGIN);
  });

  it('a card taller than the whole visible area pins to the top deck', () => {
    expect(at({ viewportHeight: 300, cardHeight: 400, textureTop: 150 }).top).toBe(TOP_DECK_BOTTOM + EDGE_MARGIN);
  });

  it('clamps within the viewport horizontally and keeps the caret on the building', () => {
    const left = at({ anchorX: 40 });
    expect(left.left).toBe(EDGE_MARGIN);
    expect(left.caretX).toBe(40 - EDGE_MARGIN);
    const right = at({ anchorX: 1590 });
    expect(right.left).toBe(1600 - EDGE_MARGIN - 260);
    expect(right.caretX).toBe(260 - CARET_INSET);
    expect(at({ anchorX: 2 }).caretX).toBe(CARET_INSET);
  });

  it('samePlacement compares every field and refuses null', () => {
    const p = at({});
    expect(samePlacement(null, p)).toBe(false);
    expect(samePlacement(p, { ...p })).toBe(true);
    expect(samePlacement(p, { ...p, top: p.top + 1 })).toBe(false);
    expect(samePlacement(p, { ...p, side: 'below' })).toBe(false);
    expect(samePlacement(p, { ...p, caretX: 1 })).toBe(false);
    expect(samePlacement(p, { ...p, left: 1 })).toBe(false);
  });
});
