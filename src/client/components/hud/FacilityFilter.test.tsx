/**
 * FacilityFilter — issue #598. Assertions read the store rather than the DOM after mutation,
 * since mockClientCallbacks proxies onSettingsChange to a no-op.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useGameStore } from '../../store/game-store';
import { FacilityFilter } from './FacilityFilter';

const KINDS = [
  { facId: 10, label: 'Farm' },
  { facId: 20, label: 'Mine' },
];

describe('FacilityFilter', () => {
  beforeEach(() => {
    resetStores();
    useGameStore.getState().setFacilityKinds([]);
    useGameStore.getState().updateSettings({ hiddenFacIds: [] });
  });

  it('renders nothing when there are no facility kinds', () => {
    const { container } = renderWithProviders(<FacilityFilter />);
    expect(container.innerHTML).toBe('');
  });

  it('renders one labelled checkbox per kind', () => {
    useGameStore.getState().setFacilityKinds(KINDS);
    renderWithProviders(<FacilityFilter />);
    expect(screen.getByLabelText('Farm')).toBeTruthy();
    expect(screen.getByLabelText('Mine')).toBeTruthy();
  });

  it('the summary line reflects the hidden count', () => {
    useGameStore.getState().setFacilityKinds(KINDS);
    useGameStore.getState().updateSettings({ hiddenFacIds: [10] });
    renderWithProviders(<FacilityFilter />);
    expect(screen.getByText('1 of 2 kinds hidden')).toBeTruthy();
  });

  it('shows "All facilities shown" when nothing is hidden', () => {
    useGameStore.getState().setFacilityKinds(KINDS);
    renderWithProviders(<FacilityFilter />);
    expect(screen.getByText('All facilities shown')).toBeTruthy();
  });

  it('unticking a checkbox writes that facId into settings.hiddenFacIds', () => {
    useGameStore.getState().setFacilityKinds(KINDS);
    renderWithProviders(<FacilityFilter />);
    fireEvent.click(screen.getByLabelText('Farm'));
    expect(useGameStore.getState().settings.hiddenFacIds).toEqual([10]);
  });

  it('ticking a checkbox back on removes it from settings.hiddenFacIds', () => {
    useGameStore.getState().setFacilityKinds(KINDS);
    useGameStore.getState().updateSettings({ hiddenFacIds: [10] });
    renderWithProviders(<FacilityFilter />);
    fireEvent.click(screen.getByLabelText('Farm'));
    expect(useGameStore.getState().settings.hiddenFacIds).toEqual([]);
  });

  it('Hide all fills the array with every kind', () => {
    useGameStore.getState().setFacilityKinds(KINDS);
    renderWithProviders(<FacilityFilter />);
    fireEvent.click(screen.getByText('Hide all'));
    expect(useGameStore.getState().settings.hiddenFacIds).toEqual([10, 20]);
  });

  it('Show all empties the array', () => {
    useGameStore.getState().setFacilityKinds(KINDS);
    useGameStore.getState().updateSettings({ hiddenFacIds: [10, 20] });
    renderWithProviders(<FacilityFilter />);
    fireEvent.click(screen.getByText('Show all'));
    expect(useGameStore.getState().settings.hiddenFacIds).toEqual([]);
  });
});
