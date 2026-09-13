/**
 * Smoke tests for HUD components (LeftRail, RightRail, InfoWidget, OverlayMenu).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useGameStore } from '../../store/game-store';
import { useUiStore } from '../../store/ui-store';
import { LeftRail } from './LeftRail';
import { RightRail } from './RightRail';
import { InfoWidget } from './InfoWidget';
import { OverlayMenu } from './OverlayMenu';
import { FacilityFilterMenu } from './FacilityFilterMenu';

describe('LeftRail', () => {
  beforeEach(resetStores);

  it('renders nav with game actions label', () => {
    renderWithProviders(<LeftRail />);
    expect(screen.getByLabelText('Game actions')).toBeTruthy();
  });

  it('renders Build button', () => {
    renderWithProviders(<LeftRail />);
    expect(screen.getByLabelText('Build (B)')).toBeTruthy();
  });

  it('renders Search button', () => {
    renderWithProviders(<LeftRail />);
    expect(screen.getByLabelText('Search')).toBeTruthy();
  });

  it('renders Mail and Settings buttons', () => {
    renderWithProviders(<LeftRail />);
    expect(screen.getByLabelText('Mail (L)')).toBeTruthy(); // M is the map now (socle-4a)
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });
});

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

describe('InfoWidget', () => {
  beforeEach(resetStores);

  it('renders without crashing when no data', () => {
    const { container } = renderWithProviders(<InfoWidget />);
    expect(container).toBeTruthy();
    expect(screen.getByText(/No Company/)).toBeTruthy();
  });

  it('renders OFFLINE when no worldName', () => {
    useGameStore.setState({ worldName: '' });
    renderWithProviders(<InfoWidget />);
    expect(screen.getByText('OFFLINE')).toBeTruthy();
  });

  it('renders server name from worldName', () => {
    useGameStore.setState({ worldName: 'Shamba' });
    renderWithProviders(<InfoWidget />);
    expect(screen.getByText('SHAMBA')).toBeTruthy();
  });

  it('renders company name when set', () => {
    useGameStore.setState({ companyName: 'TestCo Industries' });
    renderWithProviders(<InfoWidget />);
    expect(screen.getByText(/TestCo Industries/)).toBeTruthy();
  });

  it('renders tycoon stats', () => {
    useGameStore.setState({
      username: 'TestPlayer',
      tycoonStats: {
        username: 'TestPlayer',
        ranking: 5,
        cash: '1,234,567',
        incomePerHour: '500',
        buildingCount: 12,
        maxBuildings: 50,
        failureLevel: 0,
      },
    });
    renderWithProviders(<InfoWidget />);
    expect(screen.getByText('#5')).toBeTruthy();
    expect(screen.getByText('TestPlayer')).toBeTruthy();
    expect(screen.getByText('$1,234,567')).toBeTruthy();
    expect(screen.getByText('12/50')).toBeTruthy();
  });

  it('renders tycoon level badge when levelName is set', () => {
    useGameStore.setState({
      username: 'TestPlayer',
      tycoonStats: {
        username: 'TestPlayer',
        ranking: 5,
        cash: '1,000',
        incomePerHour: '100',
        buildingCount: 3,
        maxBuildings: 10,
        failureLevel: 0,
        levelName: 'Entrepreneur',
        levelTier: 1,
      },
    });
    renderWithProviders(<InfoWidget />);
    expect(screen.getByText('Entrepreneur')).toBeTruthy();
  });

  it('renders nobility badge when nobPoints >= 500 (Baron)', () => {
    useGameStore.setState({
      username: 'TestPlayer',
      tycoonStats: {
        username: 'TestPlayer',
        ranking: 5,
        cash: '1,000',
        incomePerHour: '100',
        buildingCount: 3,
        maxBuildings: 10,
        failureLevel: 0,
        nobPoints: 1000,
      },
    });
    renderWithProviders(<InfoWidget />);
    // NobilityBadge renders a span with title containing the tier name
    expect(screen.getByTitle('Viscount')).toBeTruthy();
  });

  it('hides badges row when levelName absent and nobPoints < 500', () => {
    useGameStore.setState({
      username: 'TestPlayer',
      tycoonStats: {
        username: 'TestPlayer',
        ranking: 5,
        cash: '1,000',
        incomePerHour: '100',
        buildingCount: 3,
        maxBuildings: 10,
        failureLevel: 0,
        nobPoints: 100,
      },
    });
    renderWithProviders(<InfoWidget />);
    expect(screen.queryByText('Apprentice')).toBeNull();
    expect(screen.queryByTitle('Commoner')).toBeNull();
  });

  it('renders both level and nobility when both available', () => {
    useGameStore.setState({
      username: 'TestPlayer',
      tycoonStats: {
        username: 'TestPlayer',
        ranking: 1,
        cash: '50,000,000',
        incomePerHour: '5000',
        buildingCount: 20,
        maxBuildings: 50,
        failureLevel: 0,
        levelName: 'Paradigm',
        levelTier: 4,
        nobPoints: 8000,
      },
    });
    renderWithProviders(<InfoWidget />);
    expect(screen.getByText('Paradigm')).toBeTruthy();
    expect(screen.getByTitle('Duke')).toBeTruthy();
  });

  it('renders positive income with sign', () => {
    useGameStore.setState({
      tycoonStats: {
        username: 'P', ranking: 1, cash: '100',
        incomePerHour: '500', buildingCount: 1, maxBuildings: 10, failureLevel: 0,
      },
    });
    renderWithProviders(<InfoWidget />);
    expect(screen.getByText('+$500/h')).toBeTruthy();
  });

  it('renders "Xs ago" when lastStatsUpdate is set', () => {
    useGameStore.setState({
      tycoonStats: {
        username: 'P', ranking: 1, cash: '100',
        incomePerHour: '100', buildingCount: 1, maxBuildings: 10, failureLevel: 0,
      },
      lastStatsUpdate: Date.now(),
    });
    renderWithProviders(<InfoWidget />);
    expect(screen.getByText('0s ago')).toBeTruthy();
  });

  it('does not render timestamp when lastStatsUpdate is null', () => {
    useGameStore.setState({ lastStatsUpdate: null });
    renderWithProviders(<InfoWidget />);
    expect(screen.queryByText(/ago$/)).toBeNull();
  });

  it('renders negative income with sign', () => {
    useGameStore.setState({
      tycoonStats: {
        username: 'P', ranking: 1, cash: '100',
        incomePerHour: '-200', buildingCount: 1, maxBuildings: 10, failureLevel: 0,
      },
    });
    renderWithProviders(<InfoWidget />);
    expect(screen.getByText('-$200/h')).toBeTruthy();
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

describe('FacilityFilterMenu', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.setState({ facilityKinds: [] });
    useGameStore.getState().updateSettings({ hiddenFacIds: [] });
  });

  const kinds = [
    { facId: 40, label: 'Farm' },
    { facId: 75, label: 'Supermarket' },
  ];

  it('renders a "Loading facility kinds…" line when the world roster has not landed yet', () => {
    renderWithProviders(<FacilityFilterMenu />);
    expect(screen.getByText('Loading facility kinds…')).toBeTruthy();
  });

  it('renders one row per kind once the roster lands', () => {
    useUiStore.setState({ facilityKinds: kinds });
    renderWithProviders(<FacilityFilterMenu />);
    expect(screen.getByText('Farm')).toBeTruthy();
    expect(screen.getByText('Supermarket')).toBeTruthy();
  });

  it('Hide all commits the full id list in one onSettingsChange call', () => {
    useUiStore.setState({ facilityKinds: kinds });
    const onSettingsChange = jest.fn();
    renderWithProviders(<FacilityFilterMenu />, { clientCallbacks: createSpiedCallbacks({ onSettingsChange }) });

    fireEvent.click(screen.getByText('Hide all'));

    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ hiddenFacIds: [40, 75] }));
    expect(useGameStore.getState().settings.hiddenFacIds).toEqual([40, 75]);
  });

  it('Show all commits an empty list in one onSettingsChange call', () => {
    useUiStore.setState({ facilityKinds: kinds });
    useGameStore.getState().updateSettings({ hiddenFacIds: [40, 75] });
    const onSettingsChange = jest.fn();
    renderWithProviders(<FacilityFilterMenu />, { clientCallbacks: createSpiedCallbacks({ onSettingsChange }) });

    fireEvent.click(screen.getByText('Show all'));

    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ hiddenFacIds: [] }));
    expect(useGameStore.getState().settings.hiddenFacIds).toEqual([]);
  });

  it('unchecking one row hides only that kind, leaving the other visible', () => {
    useUiStore.setState({ facilityKinds: kinds });
    const onSettingsChange = jest.fn();
    renderWithProviders(<FacilityFilterMenu />, { clientCallbacks: createSpiedCallbacks({ onSettingsChange }) });

    fireEvent.click(screen.getByLabelText('Farm'));

    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ hiddenFacIds: [40] }));
    expect(useGameStore.getState().settings.hiddenFacIds).toEqual([40]);
  });
});
