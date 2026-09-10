import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useSearchStore } from '../../store/search-store';
import { useNewspaperStore } from '../../store/newspaper-store';
import { useUiStore } from '../../store/ui-store';
import { MediaPage } from './MediaPage';
import { WsMessageType } from '@/shared/types';
import type { WsRespSearchMenuNewspapers } from '@/shared/types';

describe('MediaPage', () => {
  beforeEach(() => {
    resetStores();
    useNewspaperStore.getState().reset();
    useSearchStore.setState({ newspapersData: null });
  });

  it('shows one row per paper, naming the paper and its town', () => {
    const data: WsRespSearchMenuNewspapers = {
      type: WsMessageType.RESP_SEARCH_MENU_NEWSPAPERS,
      newspapers: [
        { paperName: 'Shamba Daily', townName: 'Shamba' },
        { paperName: 'Helartia Herald', townName: 'Helartia' },
      ],
    };
    useSearchStore.setState({ newspapersData: data });

    renderWithProviders(<MediaPage />);

    expect(screen.getByText('Shamba Daily')).toBeTruthy();
    expect(screen.getByText('Shamba')).toBeTruthy();
    expect(screen.getByText('Helartia Herald')).toBeTruthy();
    expect(screen.getByText('Helartia')).toBeTruthy();
  });

  it('opens the paper board with the right NewspaperTarget when a row is clicked', () => {
    const data: WsRespSearchMenuNewspapers = {
      type: WsMessageType.RESP_SEARCH_MENU_NEWSPAPERS,
      newspapers: [
        { paperName: 'Shamba Daily', townName: 'Shamba' },
        { paperName: 'Helartia Herald', townName: 'Helartia' },
      ],
    };
    useSearchStore.setState({ newspapersData: data });

    renderWithProviders(<MediaPage />);

    fireEvent.click(screen.getByText('Helartia Herald'));

    expect(useNewspaperStore.getState().context).toEqual({
      paperName: 'Helartia Herald',
      townName: 'Helartia',
      isCapitol: false,
      buildingX: 0,
      buildingY: 0,
    });
    expect(useNewspaperStore.getState().view).toBe('paper');
    expect(useUiStore.getState().modal).toBe('newspaper');
  });

  it('shows the empty state, not a blank section, for a world with no newspapers', () => {
    useSearchStore.setState({ newspapersData: { type: WsMessageType.RESP_SEARCH_MENU_NEWSPAPERS, newspapers: [] } });

    renderWithProviders(<MediaPage />);

    expect(screen.getByText('No newspapers in this world yet.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
