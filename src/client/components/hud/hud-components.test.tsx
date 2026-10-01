/**
 * Smoke tests for HUD components (RightRail, OverlayMenu).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { RightRail } from './RightRail';
import { OverlayMenu } from './OverlayMenu';

describe('RightRail', () => {
  beforeEach(resetStores);

  it('renders nav with map controls label', () => {
    renderWithProviders(<RightRail />);
    expect(screen.getByLabelText('Map controls')).toBeTruthy();
  });

  it('renders zoom buttons', () => {
    renderWithProviders(<RightRail />);
    expect(screen.getByLabelText('Zoom In (+)')).toBeTruthy();
    expect(screen.getByLabelText('Zoom Out (-)')).toBeTruthy();
  });

  it('renders debug and refresh buttons', () => {
    renderWithProviders(<RightRail />);
    expect(screen.getByLabelText('Debug (D)')).toBeTruthy();
    expect(screen.getByLabelText('Refresh (R)')).toBeTruthy();
  });
});

describe('OverlayMenu', () => {
  beforeEach(resetStores);

  it('renders overlay menu with categories', () => {
    renderWithProviders(<OverlayMenu />);
    expect(screen.getByLabelText('Map Overlays')).toBeTruthy();
  });

  it('renders category headers', () => {
    renderWithProviders(<OverlayMenu />);
    expect(screen.getByText('Special')).toBeTruthy();
    expect(screen.getByText('Environment')).toBeTruthy();
  });
});
