/**
 * The page "Show Profile" opens (#528). The assertions that matter are the
 * NEGATIVE ones: this is a viewer, so the controls the server withholds from a
 * viewer who is not the account holder must leave nothing behind — no heading,
 * no empty card, no error.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useSearchStore } from '../../store/search-store';
import { TycoonFullProfileView } from './TycoonFullProfileView';
import type { CurriculumData } from '@/shared/types';

const RIVAL: CurriculumData = {
  tycoonName: 'Rival',
  currentLevel: 3,
  currentLevelName: 'Master',
  currentLevelDescription: 'You are a master of industry.',
  currentLevelBadgeUrl: '/proxy-image?url=levelMaster.gif',
  currentLevelCondition: 'Keep your prestige above 3000.',
  levelReqStatus: 'You are missing 2 facilities.',
  nextLevelName: 'Paradigm',
  nextLevelDescription: 'Paradigms set the pace.',
  nextLevelRequirements: 'Prestige 4000 and 30 facilities',
  // FullAccess=false: the server withheld the checkbox (TycoonCurriculum.asp:250-261).
  canUpgrade: false,
  isUpgradeRequested: false,
  fortune: '987654321',
  averageProfit: '$42,000/h',
  prestige: 4321,
  facPrestige: 0,
  researchPrestige: 0,
  budget: '0',
  ranking: 0,
  facCount: 0,
  facMax: 0,
  area: 0,
  nobPoints: 900,
  tournamentOn: false,
  abilityTotal: 0,
  abilityRankingPoints: 0,
  abilityLevelPoints: 0,
  abilityLoanPoints: 0,
  rankings: [
    { category: 'Fortune', rank: 3 },
    { category: 'Population', rank: null },
  ],
  curriculumItems: [
    { item: 'Built a Farm', prestige: 120 },
    { item: 'Bankruptcy', prestige: -1000 },
  ],
};

function show(data: CurriculumData | null): void {
  useSearchStore.setState({
    tycoonFullProfileData: data === null
      ? null
      : ({ tycoonName: data.tycoonName, data } as never),
  });
  renderWithProviders(<TycoonFullProfileView />);
}

describe('TycoonFullProfileView', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the sections the server serves to any viewer', () => {
    show(RIVAL);

    expect(screen.getByText('Rival')).toBeTruthy();
    expect(screen.getByText('$987,654,321')).toBeTruthy();
    expect(screen.getByText('$42,000/h')).toBeTruthy();
    expect(screen.getByText('4321 points')).toBeTruthy();
    expect(screen.getByText('900 points')).toBeTruthy();
    expect(screen.getByText('You are a master of industry.')).toBeTruthy();
    expect(screen.getByText('Keep your prestige above 3000.')).toBeTruthy();
    expect(screen.getByText('You are missing 2 facilities.')).toBeTruthy();
    expect(screen.getByText('Next level: Paradigm')).toBeTruthy();
    expect(screen.getByText('Requires: Prestige 4000 and 30 facilities')).toBeTruthy();
    expect(screen.getByText('In the rankings')).toBeTruthy();
    expect(screen.getByText('#3')).toBeTruthy();
    expect(screen.getByText('-')).toBeTruthy();
    expect(screen.getByText('Curriculum items')).toBeTruthy();
    expect(screen.getByText('+120')).toBeTruthy();
    expect(screen.getByText('-1000')).toBeTruthy();
    expect(screen.getByText('Master')).toBeTruthy();
  });

  it('renders no owner-only control, and no stat that describes the viewer', () => {
    show(RIVAL);

    // TycoonCurriculum.asp:175-211 and :250-261 — withheld, so absent.
    expect(screen.queryByRole('button', { name: /Reset Account/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Abandon Role/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Rebuild Links/i })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    // The session-only Stats block describes the viewer, not the viewed tycoon:
    // no "Ranking", "Facilities" or "Area" stat row (the rankings SECTION, which
    // the page serves to any viewer, is a different thing and is present).
    expect(screen.queryByText('Ranking')).toBeNull();
    expect(screen.queryByText('Facilities')).toBeNull();
    expect(screen.queryByText('Area')).toBeNull();
  });

  it('omits every optional section the page did not carry', () => {
    show({
      ...RIVAL,
      averageProfit: '',
      currentLevelDescription: '',
      currentLevelCondition: '',
      levelReqStatus: '',
      currentLevelBadgeUrl: '',
      nextLevelName: '',
      rankings: [],
      curriculumItems: [],
    });

    expect(screen.queryByText('Avg. Profit')).toBeNull();
    expect(screen.queryByText(/Next level/)).toBeNull();
    expect(screen.queryByText('In the rankings')).toBeNull();
    expect(screen.queryByText('Curriculum items')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    // The tycoon and the level are still there — an absent section is absent,
    // not a blank page.
    expect(screen.getByText('Rival')).toBeTruthy();
    expect(screen.getByText('Master')).toBeTruthy();
  });

  it('hides a level badge the proxy cannot serve', () => {
    show(RIVAL);

    const badge = screen.getByRole('img') as HTMLImageElement;
    fireEvent.error(badge);

    expect(badge.style.display).toBe('none');
  });

  it('shows the Ability block only on a tournament world', () => {
    show({
      ...RIVAL,
      tournamentOn: true,
      abilityTotal: 15,
      abilityRankingPoints: 10,
      abilityLevelPoints: 0,
      abilityLoanPoints: 5,
    });

    expect(screen.getByText('Ability')).toBeTruthy();
    expect(screen.getByText('15 points (10 rankings, 0 level, 5 loans)')).toBeTruthy();
  });

  it('a page the server refuses is one plain line, not a blank card', () => {
    show({ ...RIVAL, cacheUnavailable: true });

    expect(screen.getByText("The server could not read this tycoon's profile.")).toBeTruthy();
    expect(screen.queryByText('Rival')).toBeNull();
  });

  it('with nothing fetched yet it says so', () => {
    show(null);

    expect(screen.getByText('No profile data available.')).toBeTruthy();
  });
});
