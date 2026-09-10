/**
 * OverviewSection component tests.
 *
 * Verifies the civic action buttons: "Visit Politics Page" always, "Rate the
 * Mayor" and "Read News" only for a Town Hall with a newspaper, neither for
 * a Capitol (`CapitolSheet.pas:25-45`).
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { OverviewSection } from './OverviewSection';
import { usePoliticsStore } from '../../store/politics-store';
import { useNewspaperStore } from '../../store/newspaper-store';
import { useUiStore } from '../../store/ui-store';
import type { BuildingPropertyValue, BuildingDetailsTab, PoliticsData } from '@/shared/types';

const POLITICS: PoliticsData = {
  townName: 'Helartia',
  isCapitol: false,
  hasRuler: true,
  yearsToElections: 16,
  mayorName: 'SPO_test3',
  mayorPrestige: 588,
  mayorRating: 83,
  tycoonsRating: 83,
  ifelRating: 83,
  mandateNo: 1,
  rulerPhotoUrl: '',
  popularRatings: [],
  ifelRatings: [],
  tycoonsRatings: [],
  publicity: [],
  publicityAds: '',
  campaignCount: 0,
  campaigns: [],
  campaignState: 'available',
  campaignMessage: '',
  canLaunchCampaign: true,
  prestigeThreshold: 200,
  projects: [],
  promise: '',
  townHallId: 90210,
  isRuler: false,
};

function makeTab(id: string, name: string, order: number): BuildingDetailsTab {
  return { id, name, icon: name.charAt(0), order, handlerName: id };
}

const TOWN_HALL_TABS: BuildingDetailsTab[] = [
  makeTab('townGeneral', 'General', 0),
  makeTab('votes', 'Votes', 10),
];

const CAPITOL_TABS: BuildingDetailsTab[] = [
  makeTab('capitolGeneral', 'General', 0),
  makeTab('capitolTowns', 'Towns', 10),
  makeTab('ministeries', 'Ministries', 20),
  makeTab('votes', 'Votes', 30),
];

const TOWN_HALL_WITH_PAPER: BuildingPropertyValue[] = [
  { name: 'Town', value: 'Helartia' },
  { name: 'NewspaperName', value: 'Helartia Herald' },
];

beforeEach(() => {
  resetStores();
  usePoliticsStore.getState().reset();
  useNewspaperStore.getState().reset();
});

describe('OverviewSection', () => {
  it('shows three buttons for a Town Hall with a paper', () => {
    renderWithProviders(
      <OverviewSection
        generalProperties={TOWN_HALL_WITH_PAPER}
        votesProperties={[]}
        buildingX={510}
        buildingY={420}
        serverTabs={TOWN_HALL_TABS}
      />
    );
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText('Visit Politics Page')).toBeTruthy();
    expect(screen.getByText('Rate the Mayor')).toBeTruthy();
    expect(screen.getByText('Read News')).toBeTruthy();
  });

  it('a Capitol offers no Read News button', () => {
    renderWithProviders(
      <OverviewSection
        generalProperties={[{ name: 'ActualRuler', value: 'President SPO_test3' }]}
        votesProperties={[]}
        buildingX={510}
        buildingY={420}
        serverTabs={CAPITOL_TABS}
      />
    );
    expect(screen.getByText('Visit President Politics Page')).toBeTruthy();
    expect(screen.queryByText('Read News')).toBeNull();
    expect(screen.queryByText('Rate the Mayor')).toBeNull();
  });

  describe('clicking Read News', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('calls openFor in read mode with that paper and town', () => {
      const openFor = jest.spyOn(useNewspaperStore.getState(), 'openFor');
      renderWithProviders(
        <OverviewSection
          generalProperties={TOWN_HALL_WITH_PAPER}
          votesProperties={[]}
          buildingX={510}
          buildingY={420}
          serverTabs={TOWN_HALL_TABS}
        />
      );
      fireEvent.click(screen.getByText('Read News'));
      // `TownHallSheet.pas:361` opens `newsreader.asp` — the daily paper, not
      // the editorial board `RateMayor` opens.
      expect(openFor).toHaveBeenCalledWith({
        paperName: 'Helartia Herald',
        townName: 'Helartia',
        isCapitol: false,
        buildingX: 510,
        buildingY: 420,
      }, 'paper');
      expect(useNewspaperStore.getState().view).toBe('paper');
      expect(useNewspaperStore.getState().issuesState).toBe('idle');
      expect(useUiStore.getState().modal).toBe('newspaper');
    });

    it('"Rate the Mayor" opens the same paper on its editorial board', () => {
      const openFor = jest.spyOn(useNewspaperStore.getState(), 'openFor');
      renderWithProviders(
        <OverviewSection
          generalProperties={TOWN_HALL_WITH_PAPER}
          votesProperties={[]}
          buildingX={510}
          buildingY={420}
          serverTabs={TOWN_HALL_TABS}
        />
      );
      fireEvent.click(screen.getByText('Rate the Mayor'));
      expect(openFor).toHaveBeenCalledWith(expect.objectContaining({
        paperName: 'Helartia Herald',
      }), 'board');
      expect(useNewspaperStore.getState().view).toBe('board');
      expect(useNewspaperStore.getState().loadState).toBe('idle');
      expect(useUiStore.getState().modal).toBe('newspaper');
    });
  });

  it('prints the election countdown when elections are on', () => {
    usePoliticsStore.setState({ data: POLITICS });
    renderWithProviders(
      <OverviewSection
        generalProperties={TOWN_HALL_WITH_PAPER}
        votesProperties={[]}
        buildingX={510}
        buildingY={420}
        serverTabs={TOWN_HALL_TABS}
      />
    );
    expect(screen.getByText('16')).toBeTruthy();
    expect(screen.getByText(/years until next mayoral election/)).toBeTruthy();
  });

  it('replaces the countdown on a tournament planet', () => {
    usePoliticsStore.setState({ data: { ...POLITICS, campaignState: 'noElections' } });
    renderWithProviders(
      <OverviewSection
        generalProperties={TOWN_HALL_WITH_PAPER}
        votesProperties={[]}
        buildingX={510}
        buildingY={420}
        serverTabs={TOWN_HALL_TABS}
      />
    );
    expect(screen.getByText('No elections on Tournament planets')).toBeTruthy();
    expect(screen.queryByText(/until next/)).toBeNull();
  });

  it('shows no buttons and the "no newspaper" message when the town has no paper', () => {
    renderWithProviders(
      <OverviewSection
        generalProperties={[{ name: 'Town', value: 'Helartia' }]}
        votesProperties={[]}
        buildingX={510}
        buildingY={420}
        serverTabs={TOWN_HALL_TABS}
      />
    );
    expect(screen.queryByText('Read News')).toBeNull();
    expect(screen.queryByText('Rate the Mayor')).toBeNull();
    expect(screen.getByText('This town has no newspaper.')).toBeTruthy();
  });
});
