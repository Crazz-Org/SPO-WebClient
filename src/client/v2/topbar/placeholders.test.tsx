/**
 * Phase 0 placeholders for the top deck. The slot owner replaces this file with real tests
 * when it implements TopBar / SignalLine / ModeBanner.
 */
import { describe, it, expect } from '@jest/globals';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import * as barrel from './index';
import { TopBar } from './TopBar';
import { SignalLine } from './SignalLine';
import { ModeBanner } from './ModeBanner';

describe('v2 top deck placeholders', () => {
  it.each([
    ['TopBar', TopBar],
    ['SignalLine', SignalLine],
    ['ModeBanner', ModeBanner],
  ] as const)('%s is exported from its file and the barrel, and renders with no props', (name, Slot) => {
    expect(barrel[name]).toBe(Slot);
    const { container } = renderWithProviders(<Slot />);
    expect(container.innerHTML).toBe('');
  });
});
