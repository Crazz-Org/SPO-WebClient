/**
 * ContextStatusStrip — the town under the camera, while nothing is selected.
 */

import { act, screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useGameStore } from '../../store/game-store';
import { useBuildingStore } from '../../store/building-store';
import type { BuildingFocusInfo } from '../../../shared/types';
import { ContextStatusStrip } from './ContextStatusStrip';

const SENTENCE = 'Helartia — population 12 480, ruled by SPO_test3';

function focusInfo(): BuildingFocusInfo {
  return {
    buildingName: 'Town Hall',
    ownerName: 'SPO_test3',
    x: 472,
    y: 392,
    xsize: 1,
    ysize: 1,
    visualClass: '100',
  } as BuildingFocusInfo;
}

describe('ContextStatusStrip', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows the sentence the server sent when nothing is selected', () => {
    act(() => { useGameStore.getState().setContextStatusText(SENTENCE); });

    renderWithProviders(<ContextStatusStrip />);

    expect(screen.getByTestId('context-status-strip')).toHaveTextContent(SENTENCE);
  });

  it('renders nothing at all for an empty answer — no empty bar', () => {
    act(() => { useGameStore.getState().setContextStatusText(''); });

    renderWithProviders(<ContextStatusStrip />);

    expect(screen.queryByTestId('context-status-strip')).toBeNull();
  });

  it('hides while a building is selected, and comes back when the selection is cleared', () => {
    act(() => { useGameStore.getState().setContextStatusText(SENTENCE); });

    renderWithProviders(<ContextStatusStrip />);
    expect(screen.getByTestId('context-status-strip')).toBeInTheDocument();

    act(() => { useBuildingStore.getState().setFocus(focusInfo()); });
    expect(screen.queryByTestId('context-status-strip')).toBeNull();

    act(() => { useBuildingStore.getState().clearFocus(); });
    expect(screen.getByTestId('context-status-strip')).toHaveTextContent(SENTENCE);
  });
});
