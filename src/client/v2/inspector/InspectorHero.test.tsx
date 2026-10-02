import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useBuildingStore, REFRESH_BUILDING_ACTION } from '../../store/building-store';
import { useEmpireStore } from '../../store/empire-store';
import { useGameStore } from '../../store/game-store';
import { useMailStore } from '../../store/mail-store';
import { usePoliticsStore } from '../../store/politics-store';
import { RENAME_PENDING_KEY } from '../../handlers/building-action-handler';
import type { BuildingDetailsResponse, BuildingFocusInfo } from '@/shared/types';
import { InspectorHero } from './InspectorHero';

const focus: BuildingFocusInfo = {
  buildingId: 'bld-7', buildingName: 'Small Farm', ownerName: 'SPO_test3 - Green',
  salesInfo: 'Wheat sales at 80%', revenue: '$1,200/h',
  detailsText: 'Upgrade Level: 4  Producing: Wheat', hintsText: '',
  x: 150, y: 300, xsize: 3, ysize: 3, visualClass: '200',
};

const details: BuildingDetailsResponse = {
  buildingId: 'bld-7', x: 150, y: 300, visualClass: '200', templateName: 'Farm',
  buildingName: 'Small Farm', ownerName: 'SPO_test3 - Green', securityId: 's', canGovern: false,
  tabs: [{ id: 'indGeneral', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'IndGeneral' }],
  groups: { indGeneral: [{ name: 'Creator', value: 'SPO_test3' }, { name: 'ROI', value: '14%' }] },
  timestamp: 1,
};

const townHall: BuildingDetailsResponse = {
  ...details, buildingName: 'Helartia Town Hall', visualClass: '9999',
  tabs: [{ id: 'townGeneral', name: 'GENERAL', order: 0, icon: '', handlerName: 'TownGeneral' }],
  groups: { townGeneral: [{ name: 'Town', value: 'Helartia' }, { name: 'Creator', value: 'Someone' }] },
};

function spies() {
  const onNavigateToBuilding = jest.fn();
  const onRefreshBuilding = jest.fn();
  const onAddFavorite = jest.fn();
  const onRenameBuilding = jest.fn();
  const clientCallbacks = createSpiedCallbacks({ onNavigateToBuilding, onRefreshBuilding, onAddFavorite, onRenameBuilding });
  return { onNavigateToBuilding, onRefreshBuilding, onAddFavorite, onRenameBuilding, clientCallbacks };
}

describe('InspectorHero — standard facility', () => {
  beforeEach(() => {
    resetStores();
    useEmpireStore.setState({ facilities: [] });
    useGameStore.setState({ worldName: 'Planitia' });
    useBuildingStore.setState({ isOwner: true, inFlightActions: new Set() });
  });

  it('states name, level, society and owner, coordinates and the three figures', () => {
    renderWithProviders(<InspectorHero details={details} focus={focus} isCivic={false} />);
    expect(screen.getByRole('heading', { name: 'Small Farm' })).toBeTruthy();
    expect(screen.getByText('Lvl 4')).toBeTruthy();
    expect(screen.getByText('SPO_test3 - Green, SPO_test3')).toBeTruthy();
    expect(screen.getByText('150, 300')).toBeTruthy();
    expect(screen.getByText('$1,200/h')).toBeTruthy();
    expect(screen.getByText('14%')).toBeTruthy();
  });

  it('wires View on map, Refresh and Add to Empire to the client', () => {
    const s = spies();
    renderWithProviders(<InspectorHero details={details} focus={focus} isCivic={false} />, { clientCallbacks: s.clientCallbacks });

    fireEvent.click(screen.getByRole('button', { name: 'View on map' }));
    expect(s.onNavigateToBuilding).toHaveBeenCalledWith(150, 300);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(s.onRefreshBuilding).toHaveBeenCalledWith(150, 300, { userInitiated: true });

    fireEvent.click(screen.getByRole('button', { name: 'Add to Empire' }));
    expect(s.onAddFavorite).toHaveBeenCalledWith('Small Farm', 150, 300);
  });

  it('opens compose to the owner', () => {
    renderWithProviders(<InspectorHero details={details} focus={focus} isCivic={false} />);
    const write = screen.getByRole('button', { name: 'Write to owner' });
    expect(write.getAttribute('title')).toBe('Write to SPO_test3');
    fireEvent.click(write);
    expect(useMailStore.getState().composeTo).toBe('SPO_test3@Planitia.net');
  });

  it('renames on Enter and on the confirm button, trims, and cancels on Escape', () => {
    const s = spies();
    renderWithProviders(<InspectorHero details={details} focus={focus} isCivic={false} />, { clientCallbacks: s.clientCallbacks });

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'New building name' }) as HTMLInputElement;
    expect(input.value).toBe('Small Farm');
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.change(input, { target: { value: '  Big Farm ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(s.onRenameBuilding).toHaveBeenCalledWith(150, 300, 'Big Farm');
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rename' }));
    expect(s.onRenameBuilding).toHaveBeenLastCalledWith(150, 300, 'Other');

    s.onRenameBuilding.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Nope' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'a' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rename' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel rename' }));
    expect(s.onRenameBuilding).not.toHaveBeenCalled();
  });

  it('shows the rename save state', () => {
    useBuildingStore.setState({ pendingUpdates: new Map([[RENAME_PENDING_KEY, { value: 'x' } as never]]) });
    renderWithProviders(<InspectorHero details={details} focus={focus} isCivic={false} />);
    expect(screen.getByText('Saving…')).toBeTruthy();
  });

  it('disables Add to Empire once the facility is in the list', () => {
    useEmpireStore.setState({ facilities: [{ x: 150, y: 300 } as never] });
    renderWithProviders(<InspectorHero details={details} focus={focus} isCivic={false} />);
    expect((screen.getByRole('button', { name: 'In Empire list' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Refresh while a refresh is in flight', () => {
    useBuildingStore.setState({ inFlightActions: new Set([REFRESH_BUILDING_ACTION]) });
    renderWithProviders(<InspectorHero details={details} focus={focus} isCivic={false} />);
    expect((screen.getByRole('button', { name: 'Refreshing…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides owner tools from a visitor, and write-to-owner while the Creator is unknown', () => {
    useBuildingStore.setState({ isOwner: false });
    renderWithProviders(<InspectorHero details={{ ...details, groups: {} }} focus={focus} isCivic={false} />);
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to Empire' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Write to owner' })).toBeNull();
    expect(screen.getByText('SPO_test3 - Green')).toBeTruthy();
  });

  it('shows the facility picture once loaded and drops it on error', () => {
    const { container } = renderWithProviders(
      <InspectorHero details={{ ...details, iconUrl: '/img/farm.gif' }} focus={{ ...focus, detailsText: '' }} isCivic={false} />,
    );
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.className).toBe('iconPending');
    fireEvent.load(img);
    expect((container.querySelector('img') as HTMLImageElement).className).toBe('icon');
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(/Lvl/)).toBeNull();
  });
});

describe('InspectorHero — civic building', () => {
  beforeEach(() => {
    resetStores();
    useBuildingStore.setState({ isOwner: true, inFlightActions: new Set() });
    usePoliticsStore.setState({ data: { mayorName: 'SPO_test3', townName: 'Helartia', isCapitol: false, hasRuler: true } as never });
  });

  it('names the mayor, offers write-to-mayor, refresh and map, and no figures or owner tools', () => {
    const s = spies();
    renderWithProviders(<InspectorHero details={townHall} focus={focus} isCivic />, { clientCallbacks: s.clientCallbacks });

    expect(screen.getByText('Mayor: SPO_test3')).toBeTruthy();
    expect(screen.queryByText('$1,200/h')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Write to owner' })).toBeNull();

    const mayor = screen.getByRole('button', { name: 'Write to Mayor' });
    expect(mayor.getAttribute('title')).toBe('Write to the Mayor of Helartia');
    fireEvent.click(mayor);
    expect(useMailStore.getState().composeTo).toBe('mayor@Helartia.gov');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(s.onRefreshBuilding).toHaveBeenCalledWith(150, 300, { userInitiated: true });
  });

  it('never prints the town as the mayor: no known ruler, no line', () => {
    usePoliticsStore.setState({ data: null });
    renderWithProviders(<InspectorHero details={{ ...townHall, ownerName: 'Helartia' }} focus={focus} isCivic />);
    expect(screen.queryByText(/Mayor:/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Write to Mayor' })).toBeTruthy();
  });

  it('offers no mayor mail on the Capitol', () => {
    const capitol = {
      ...townHall, buildingName: 'Capitol',
      tabs: [{ id: 'capitolTowns', name: 'TOWNS', order: 0, icon: '', handlerName: 'X' }],
      groups: { capitolGeneral: [{ name: 'ActualRuler', value: 'Crazz' }, { name: 'Town', value: 'Helartia' }] },
    };
    renderWithProviders(<InspectorHero details={capitol} focus={focus} isCivic />);
    expect(screen.getByText('President: Crazz')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Write to Mayor' })).toBeNull();
  });
});
