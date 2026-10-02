/**
 * Phase 0 placeholders for the dock. The slot owner replaces this file with real tests when
 * it implements Dock / MapTools / ChatDrawer.
 */
import { describe, it, expect } from '@jest/globals';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import * as barrel from './index';
import { Dock } from './Dock';
import { MapTools } from './MapTools';
import { ChatDrawer } from './ChatDrawer';

describe('v2 dock placeholders', () => {
  it.each([
    ['Dock', Dock],
    ['MapTools', MapTools],
    ['ChatDrawer', ChatDrawer],
  ] as const)('%s is exported from its file and the barrel, and renders with no props', (name, Slot) => {
    expect(barrel[name]).toBe(Slot);
    const { container } = renderWithProviders(<Slot />);
    expect(container.innerHTML).toBe('');
  });
});
