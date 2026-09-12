import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useSearchStore } from '../../store/search-store';
import { useGameStore } from '../../store/game-store';
import { useMailStore } from '../../store/mail-store';
import { DirectoryPage } from './DirectoryPage';
import type {
  DirectoryRef, DirectoryPage as DirectoryPageData, DirectoryFacilityRow, DirectoryFacilityCard,
} from '@/shared/types';

/** Put one level on the stack, as openDirectory would, and hand back its answer. */
function showLevel(ref: DirectoryRef, page: DirectoryPageData | null): void {
  useSearchStore.setState({
    currentPage: 'directory',
    isLoading: false,
    directoryStack: [{ ref, page }],
  });
}

const TOWN_REF: DirectoryRef = { kind: 'town', path: 'Towns\\Helartia.five', classId: '1234' };

const TOWN_PAGE: DirectoryPageData = {
  kind: 'town',
  town: {
    name: 'Helartia',
    iconUrl: '/proxy-image?url=town',
    inhabitants: 12400,
    qualityOfLife: 71,
    unemploymentPercent: 4,
    x: 120,
    y: 340,
  },
};

const ROW: DirectoryFacilityRow = {
  name: 'Cheap House 1',
  itemName: 'Cheap House 1',
  path: 'Towns\\Helartia.five\\Facilities\\Residentials',
  iconUrl: '/proxy-image?url=house',
  company: 'Crazz Ltd',
  x: 120,
  y: 340,
};

const CARD: DirectoryFacilityCard = {
  name: 'Cheap House 1',
  company: 'Crazz Ltd',
  iconUrl: '',
  netProfitText: '$1,234,567',
  costText: '-$500',
  roiText: 'Already.',
  creator: 'SPO_test3',
  x: 120,
  y: 340,
};

beforeEach(() => {
  resetStores();
  useSearchStore.getState().reset();
  useGameStore.setState({ worldName: 'planitia' });
});

describe('DirectoryPage — town page', () => {
  it('shows the name, the icon and the three figures RenderTownIn.asp prints', () => {
    showLevel(TOWN_REF, TOWN_PAGE);

    const { container } = renderWithProviders(<DirectoryPage />);

    expect(screen.getByText('Helartia')).toBeTruthy();
    expect(screen.getByText('12,400')).toBeTruthy();
    expect(screen.getByText('71%')).toBeTruthy();
    expect(screen.getByText('4%')).toBeTruthy();
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/proxy-image?url=town');
  });

  it('falls back to the building glyph when no icon came through', () => {
    showLevel(TOWN_REF, { kind: 'town', town: { ...TOWN_PAGE.town, iconUrl: '' } } as DirectoryPageData);

    const { container } = renderWithProviders(<DirectoryPage />);

    expect(container.querySelector('img')).toBeNull();
  });

  it('centres the map on the town when "Show on map" is used', () => {
    showLevel(TOWN_REF, TOWN_PAGE);
    const onNavigateToBuilding = jest.fn();
    renderWithProviders(<DirectoryPage />, {
      clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding: onNavigateToBuilding as never }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }));

    expect(onNavigateToBuilding).toHaveBeenCalledWith(120, 340);
  });

  it('opens the Facilities folder, keyed on the displayed town name (RenderTownIn.asp:85)', () => {
    showLevel(TOWN_REF, TOWN_PAGE);
    const onSearchMenuDirectory = jest.fn();
    renderWithProviders(<DirectoryPage />, {
      clientCallbacks: createSpiedCallbacks({ onSearchMenuDirectory: onSearchMenuDirectory as never }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Facilities' }));

    const expected = { kind: 'town-facilities', town: 'Helartia' };
    expect(onSearchMenuDirectory).toHaveBeenCalledWith(expected);
    expect(useSearchStore.getState().directoryStack[1]).toEqual({ ref: expected, page: null });
  });

  it('opens the Companies folder (RenderTownIn.asp:95)', () => {
    showLevel(TOWN_REF, TOWN_PAGE);
    const onSearchMenuDirectory = jest.fn();
    renderWithProviders(<DirectoryPage />, {
      clientCallbacks: createSpiedCallbacks({ onSearchMenuDirectory: onSearchMenuDirectory as never }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Companies' }));

    expect(onSearchMenuDirectory).toHaveBeenCalledWith({ kind: 'town-companies', town: 'Helartia' });
  });

  it('renders the legacy "Unknown Town" fallback when the cache path failed', () => {
    showLevel(TOWN_REF, {
      kind: 'town',
      town: { ...TOWN_PAGE.town, name: 'Unknown Town', iconUrl: '', inhabitants: 0 },
    } as DirectoryPageData);

    renderWithProviders(<DirectoryPage />);

    expect(screen.getByText('Unknown Town')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Facilities' })).toBeNull();
  });

  it('renders the same fallback while no page has arrived at all', () => {
    showLevel(TOWN_REF, null);

    renderWithProviders(<DirectoryPage />);

    expect(screen.getByText('Unknown Town')).toBeTruthy();
  });
});

describe('DirectoryPage — folder', () => {
  const REF: DirectoryRef = { kind: 'town-facilities', town: 'Helartia' };

  it('heads the list with the stack the legacy page printed, and lists the entries', () => {
    showLevel(REF, { kind: 'folder', items: ['Residentials', 'Farms'], ownedBy: null });

    renderWithProviders(<DirectoryPage />);

    expect(screen.getByText('Helartia › Facilities')).toBeTruthy();
    expect(screen.getByText('Residentials')).toBeTruthy();
    expect(screen.getByText('Farms')).toBeTruthy();
  });

  it('opens the kind that was clicked', () => {
    showLevel(REF, { kind: 'folder', items: ['Residentials'], ownedBy: null });
    const onSearchMenuDirectory = jest.fn();
    renderWithProviders(<DirectoryPage />, {
      clientCallbacks: createSpiedCallbacks({ onSearchMenuDirectory: onSearchMenuDirectory as never }),
    });

    fireEvent.click(screen.getByText('Residentials'));

    expect(onSearchMenuDirectory).toHaveBeenCalledWith({
      kind: 'town-facility-kind', town: 'Helartia', facKind: 'Residentials',
    });
  });

  it('names the owner on a company folder (InTownCompany.asp:70)', () => {
    showLevel(
      { kind: 'town-company', town: 'Helartia', company: 'Crazz Ltd' },
      { kind: 'folder', items: ['Farms'], ownedBy: 'Crazz' },
    );

    renderWithProviders(<DirectoryPage />);

    expect(screen.getByText('Owned by Crazz')).toBeTruthy();
    expect(screen.getByText('Helartia › Companies › Crazz Ltd')).toBeTruthy();
  });

  it('says so for a folder the server found empty', () => {
    showLevel(REF, { kind: 'folder', items: [], ownedBy: null });

    renderWithProviders(<DirectoryPage />);

    expect(screen.getByText('Nothing listed here.')).toBeTruthy();
  });

  it('shows the heading with no list while the reply is still in flight', () => {
    showLevel(REF, null);

    renderWithProviders(<DirectoryPage />);

    expect(screen.getByText('Helartia › Facilities')).toBeTruthy();
    expect(screen.getByText('Nothing listed here.')).toBeTruthy();
  });
});

describe('DirectoryPage — facility list', () => {
  const REF: DirectoryRef = { kind: 'town-facility-kind', town: 'Helartia', facKind: 'Residentials' };

  it('names the owning company on a ShowCompany row', () => {
    showLevel(REF, { kind: 'facility-list', facilities: [ROW] });

    renderWithProviders(<DirectoryPage />);

    expect(screen.getByText('Cheap House 1')).toBeTruthy();
    expect(screen.getByText('Crazz Ltd')).toBeTruthy();
    expect(screen.queryByText('(120, 340)')).toBeNull();
  });

  it('prints the coordinates instead on a row the page gave no company', () => {
    showLevel(
      { kind: 'town-company-facility-kind', town: 'Helartia', company: 'Crazz Ltd', facKind: 'Residentials' },
      { kind: 'facility-list', facilities: [{ ...ROW, company: null, iconUrl: '' }] },
    );

    renderWithProviders(<DirectoryPage />);

    expect(screen.getByText('(120, 340)')).toBeTruthy();
  });

  it('opens the facility card when the row is clicked', () => {
    showLevel(REF, { kind: 'facility-list', facilities: [ROW] });
    const onSearchMenuDirectory = jest.fn();
    renderWithProviders(<DirectoryPage />, {
      clientCallbacks: createSpiedCallbacks({ onSearchMenuDirectory: onSearchMenuDirectory as never }),
    });

    fireEvent.click(screen.getByText('Cheap House 1'));

    expect(onSearchMenuDirectory).toHaveBeenCalledWith({
      kind: 'facility',
      path: 'Towns\\Helartia.five\\Facilities\\Residentials',
      name: 'Cheap House 1',
    });
  });

  it('jumps the map from a row without opening that row', () => {
    showLevel(REF, { kind: 'facility-list', facilities: [ROW] });
    const onNavigateToBuilding = jest.fn();
    const onSearchMenuDirectory = jest.fn();
    renderWithProviders(<DirectoryPage />, {
      clientCallbacks: createSpiedCallbacks({
        onNavigateToBuilding: onNavigateToBuilding as never,
        onSearchMenuDirectory: onSearchMenuDirectory as never,
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }));

    expect(onNavigateToBuilding).toHaveBeenCalledWith(120, 340);
    expect(onSearchMenuDirectory).not.toHaveBeenCalled();
  });

  it('says so for a kind the server listed empty', () => {
    showLevel(REF, { kind: 'facility-list', facilities: [] });

    renderWithProviders(<DirectoryPage />);

    expect(screen.getByText('Helartia › Facilities › Residentials')).toBeTruthy();
    expect(screen.getByText('Nothing listed here.')).toBeTruthy();
  });
});

describe('DirectoryPage — facility card', () => {
  const REF: DirectoryRef = { kind: 'facility', path: 'Towns\\Helartia.five', name: 'Cheap House 1' };

  it('shows name, company and the three printed values', () => {
    showLevel(REF, { kind: 'facility', facility: CARD });

    renderWithProviders(<DirectoryPage />);

    expect(screen.getByText('Cheap House 1')).toBeTruthy();
    expect(screen.getByText('Crazz Ltd')).toBeTruthy();
    expect(screen.getByText('$1,234,567')).toBeTruthy();
    expect(screen.getByText('-$500')).toBeTruthy();
    expect(screen.getByText('Already.')).toBeTruthy();
  });

  it('prints the other two ROI forms exactly as the server wrote them', () => {
    showLevel(REF, { kind: 'facility', facility: { ...CARD, roiText: '12 years.' } });
    const first = renderWithProviders(<DirectoryPage />);
    expect(screen.getByText('12 years.')).toBeTruthy();
    first.unmount();

    showLevel(REF, { kind: 'facility', facility: { ...CARD, roiText: 'Never.' } });
    renderWithProviders(<DirectoryPage />);
    expect(screen.getByText('Never.')).toBeTruthy();
  });

  it('renders the icon when one came through', () => {
    showLevel(REF, { kind: 'facility', facility: { ...CARD, iconUrl: '/proxy-image?url=house' } });

    const { container } = renderWithProviders(<DirectoryPage />);

    expect(container.querySelector('img')!.getAttribute('src')).toBe('/proxy-image?url=house');
  });

  it('centres the map on the facility', () => {
    showLevel(REF, { kind: 'facility', facility: CARD });
    const onNavigateToBuilding = jest.fn();
    renderWithProviders(<DirectoryPage />, {
      clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding: onNavigateToBuilding as never }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }));

    expect(onNavigateToBuilding).toHaveBeenCalledWith(120, 340);
  });

  it('opens compose addressed to the creator (OpenFacility.asp:88)', () => {
    showLevel(REF, { kind: 'facility', facility: CARD });

    renderWithProviders(<DirectoryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Send mail' }));

    expect(useMailStore.getState().composeTo).toBe('SPO_test3@planitia.net');
    expect(useMailStore.getState().currentView).toBe('compose');
  });

  it('offers no mail button when the page named no creator', () => {
    showLevel(REF, { kind: 'facility', facility: { ...CARD, creator: '' } });

    renderWithProviders(<DirectoryPage />);

    expect(screen.queryByRole('button', { name: 'Send mail' })).toBeNull();
  });

  it('says so when the cache path no longer resolves', () => {
    showLevel(REF, { kind: 'facility', facility: null });

    renderWithProviders(<DirectoryPage />);

    expect(screen.getByText('This facility is no longer in the directory.')).toBeTruthy();
  });
});

describe('DirectoryPage — no level open', () => {
  it('renders nothing when the descent is empty', () => {
    const { container } = renderWithProviders(<DirectoryPage />);

    expect(container.innerHTML).toBe('');
  });
});
