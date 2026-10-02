import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { MobileBuildContent } from './MobileBuildContent';

describe('MobileBuildContent debug marker (issue 1192)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('data-subtab follows the chosen sub-tab', () => {
    renderWithProviders(<MobileBuildContent />);
    const root = screen.getByTestId('mobile-build-content');
    expect(root.dataset.subtab).toBe('buildings');
    fireEvent.click(screen.getByRole('tab', { name: 'Roads' }));
    expect(root.dataset.subtab).toBe('roads');
    fireEvent.click(screen.getByRole('tab', { name: 'Demolish' }));
    expect(root.dataset.subtab).toBe('demolish');
    fireEvent.click(screen.getByRole('tab', { name: 'Buildings' }));
    expect(root.dataset.subtab).toBe('buildings');
  });
});
