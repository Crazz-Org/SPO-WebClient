/**
 * Phase 0 placeholders for the side panel and focus card: until implemented they render the
 * classic Sheet and StatusOverlay so v2 stays playable. The slot owner replaces this file.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';

jest.mock('../../components/sheet', () => ({ Sheet: () => <aside>V1_SHEET</aside> }));
jest.mock('../../components/building', () => ({ StatusOverlay: () => <div>V1_STATUSOVERLAY</div> }));

import * as barrel from './index';
import { SidePanel } from './SidePanel';
import { FocusCard } from './FocusCard';

describe('v2 panel placeholders', () => {
  it('both are exported from their file and the barrel', () => {
    expect(barrel.SidePanel).toBe(SidePanel);
    expect(barrel.FocusCard).toBe(FocusCard);
  });

  it('SidePanel renders the classic Sheet', () => {
    renderWithProviders(<SidePanel />);
    expect(screen.getByText('V1_SHEET')).toBeTruthy();
  });

  it('FocusCard renders the classic StatusOverlay', () => {
    renderWithProviders(<FocusCard />);
    expect(screen.getByText('V1_STATUSOVERLAY')).toBeTruthy();
  });
});
