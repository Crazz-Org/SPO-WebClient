/**
 * ProfilePanel — section list / drawer behaviour.
 *
 * The panel opens on the list alone: no section is selected, so no profile
 * request goes out until the user picks one.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useProfileStore } from '../../../store/profile-store';
import { ProfilePanel } from '../ProfilePanel';
import type { BankAccountData, CurriculumData } from '@/shared/types';

/** The neutral bank page — no loans, nothing owed — plus whatever the case is about. */
function bankData(overrides: Partial<BankAccountData> = {}): BankAccountData {
  return {
    balance: '0', maxLoan: '0', totalLoans: '0',
    totalNextPayment: '0', loans: [], defaultInterest: 0, defaultTerm: 5,
    ...overrides,
  };
}

const CURRICULUM_BASE: CurriculumData = {
  tycoonName: 'SPO_test3',
  currentLevel: 4,
  currentLevelName: 'Paradigm',
  currentLevelDescription: 'You are a paradigm of industry.',
  currentLevelBadgeUrl: '/proxy-image?url=x',
  currentLevelCondition: '',
  levelReqStatus: '',
  nextLevelName: 'Legend',
  nextLevelDescription: 'Legends shape worlds.',
  nextLevelRequirements: 'Prestige 5000 and 50 facilities',
  canUpgrade: true,
  isUpgradeRequested: false,
  fortune: '$1,234,567',
  averageProfit: '$88,000/h',
  prestige: 1234,
  facPrestige: 0,
  researchPrestige: 0,
  budget: '1234567',
  ranking: 42,
  facCount: 13,
  facMax: 100,
  area: 0,
  nobPoints: 2500,
  tournamentOn: false,
  abilityTotal: 0,
  abilityRankingPoints: 0,
  abilityLevelPoints: 0,
  abilityLoanPoints: 0,
  rankings: [],
  curriculumItems: [],
};

const SECTION_LABELS = [
  'Curriculum',
  'Bank Account',
  'Profit & Loss',
  'Companies',
  'Initial Suppliers',
  'Strategy',
];

/** The drawer header repeats the section label, so always click the list entry. */
function clickSection(label: string): void {
  fireEvent.click(within(screen.getByLabelText('Profile sections')).getByText(label));
}

describe('ProfilePanel — sections', () => {
  beforeEach(() => {
    useProfileStore.getState().reset();
  });

  it('lists every section and opens none by default', () => {
    const onProfileCurriculum = jest.fn();
    renderWithProviders(<ProfilePanel />, {
      clientCallbacks: createSpiedCallbacks({ onProfileCurriculum }),
    });

    for (const label of SECTION_LABELS) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(useProfileStore.getState().currentTab).toBeNull();
    expect(onProfileCurriculum).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Close section')).toBeNull();
  });

  it('requests a section only when it is clicked', () => {
    const onProfileBank = jest.fn();
    renderWithProviders(<ProfilePanel />, {
      clientCallbacks: createSpiedCallbacks({ onProfileBank }),
    });

    clickSection('Bank Account');

    expect(useProfileStore.getState().currentTab).toBe('bank');
    expect(onProfileBank).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Close section')).toBeTruthy();
  });

  it('collapses the drawer when the open section is clicked again', () => {
    renderWithProviders(<ProfilePanel />);

    clickSection('Strategy');
    expect(useProfileStore.getState().currentTab).toBe('policy');

    clickSection('Strategy');
    expect(useProfileStore.getState().currentTab).toBeNull();
    expect(screen.queryByLabelText('Close section')).toBeNull();
  });

  it('switches sections without closing the drawer', () => {
    const onProfileCompanies = jest.fn();
    renderWithProviders(<ProfilePanel />, {
      clientCallbacks: createSpiedCallbacks({ onProfileCompanies }),
    });

    clickSection('Curriculum');
    clickSection('Companies');

    expect(useProfileStore.getState().currentTab).toBe('companies');
    expect(onProfileCompanies).toHaveBeenCalledTimes(1);
  });

  it('closes the drawer from the header buttons', () => {
    renderWithProviders(<ProfilePanel />);

    clickSection('Profit & Loss');
    fireEvent.click(screen.getByLabelText('Close section'));
    expect(useProfileStore.getState().currentTab).toBeNull();

    clickSection('Profit & Loss');
    fireEvent.click(screen.getByLabelText('Back to sections'));
    expect(useProfileStore.getState().currentTab).toBeNull();
  });

  it('shows the loading skeleton while a section is in flight', () => {
    const { container } = renderWithProviders(<ProfilePanel />);

    clickSection('Initial Suppliers');

    // requestTabData() flips isLoading before the response lands
    expect(useProfileStore.getState().isLoading).toBe(true);
    expect(container.querySelector('[class*="loading"]')).toBeTruthy();
  });

  it('renders the section body once its data lands', () => {
    renderWithProviders(<ProfilePanel />);

    clickSection('Companies');
    act(() => {
      useProfileStore.getState().setCompanies({
        companies: [
          { name: 'Green Co', companyId: 7, ownerRole: 'Tycoon', cluster: 'A', facilityCount: 3, companyType: 'Industry' },
        ],
        currentCompany: 'Green Co',
        worldName: 'planitia',
      });
    });

    expect(useProfileStore.getState().isLoading).toBe(false);
    expect(screen.getByText('Green Co')).toBeTruthy();
  });

  it('forgets the open section when the panel unmounts', () => {
    const { unmount } = renderWithProviders(<ProfilePanel />);

    clickSection('Curriculum');
    expect(useProfileStore.getState().currentTab).toBe('curriculum');

    unmount();
    expect(useProfileStore.getState().currentTab).toBeNull();
  });

  it('shows the Ability card and its components on a tournament world', () => {
    renderWithProviders(<ProfilePanel />);

    clickSection('Curriculum');
    act(() => {
      useProfileStore.getState().setCurriculum({
        ...CURRICULUM_BASE,
        tournamentOn: true,
        abilityTotal: 15,
        abilityRankingPoints: 10,
        abilityLevelPoints: 0,
        abilityLoanPoints: 5,
      });
    });

    expect(screen.getByText('Ability')).toBeTruthy();
    expect(screen.getByText('15 points')).toBeTruthy();
    expect(screen.getByText(/from the rankings/)).toBeTruthy();
  });

  it('shows no Ability card on a non-tournament world', () => {
    renderWithProviders(<ProfilePanel />);

    clickSection('Curriculum');
    act(() => {
      useProfileStore.getState().setCurriculum({ ...CURRICULUM_BASE });
    });

    expect(screen.queryByText('Ability')).toBeNull();
    expect(screen.queryByText(/from the rankings/)).toBeNull();
  });

  it('shows the level badge when the page carries one, and none otherwise', () => {
    renderWithProviders(<ProfilePanel />);

    clickSection('Curriculum');
    act(() => {
      useProfileStore.getState().setCurriculum({ ...CURRICULUM_BASE });
    });
    expect(screen.getByAltText(/level badge/)).toBeTruthy();

    act(() => {
      useProfileStore.getState().setCurriculum({ ...CURRICULUM_BASE, currentLevelBadgeUrl: '' });
    });
    expect(screen.queryByAltText(/level badge/)).toBeNull();
  });

  it('shows the level condition past tier 5, and hides it otherwise', () => {
    renderWithProviders(<ProfilePanel />);

    clickSection('Curriculum');
    act(() => {
      useProfileStore.getState().setCurriculum({ ...CURRICULUM_BASE });
    });
    expect(screen.queryByText('Keep 10 wonders.')).toBeNull();

    act(() => {
      useProfileStore.getState().setCurriculum({ ...CURRICULUM_BASE, currentLevelCondition: 'Keep 10 wonders.' });
    });
    expect(screen.getByText('Keep 10 wonders.')).toBeTruthy();
  });

  it('shows the missed-requirement banner when LevelReqStatus is present, and no banner otherwise', () => {
    renderWithProviders(<ProfilePanel />);

    clickSection('Curriculum');
    act(() => {
      useProfileStore.getState().setCurriculum({ ...CURRICULUM_BASE });
    });
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => {
      useProfileStore.getState().setCurriculum({ ...CURRICULUM_BASE, levelReqStatus: 'Prestige is falling.' });
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Prestige is falling.');
  });

  it('offers Reset Account and Abandon Role, and no Rebuild Links button', () => {
    renderWithProviders(<ProfilePanel />);

    clickSection('Curriculum');
    act(() => {
      useProfileStore.getState().setCurriculum({ ...CURRICULUM_BASE });
    });

    expect(screen.getByRole('button', { name: /Reset Account/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Abandon Role/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Rebuild Links/i })).toBeNull();
    expect(screen.queryByText(/Rebuild Links/i)).toBeNull();
  });

  it('shows the unavailable state, not the skeleton, when the bank page could not be read', () => {
    const { container } = renderWithProviders(<ProfilePanel />);

    clickSection('Bank Account');
    act(() => {
      useProfileStore.getState().setBankAccount({
        balance: '0', maxLoan: '0', totalLoans: '0',
        totalNextPayment: '0', loans: [], defaultInterest: 0, defaultTerm: 5,
        cacheUnavailable: true,
      });
    });

    expect(useProfileStore.getState().isLoading).toBe(false);
    expect(container.querySelector('[class*="loading"]')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('The server could not read your profile');
    expect(screen.queryByText('No active loans')).toBeNull();
  });

  it('a genuinely empty bank account keeps the neutral text', () => {
    renderWithProviders(<ProfilePanel />);

    clickSection('Bank Account');
    act(() => {
      useProfileStore.getState().setBankAccount({
        balance: '0', maxLoan: '0', totalLoans: '0',
        totalNextPayment: '0', loans: [], defaultInterest: 0, defaultTerm: 5,
      });
    });

    expect(screen.getByText('No active loans')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  /** Open the Bank drawer on a given page. */
  function openBank(data: Partial<BankAccountData>): void {
    renderWithProviders(<ProfilePanel />);
    clickSection('Bank Account');
    act(() => {
      useProfileStore.getState().setBankAccount(bankData(data));
    });
  }

  it('offers Send Money on a page that carries a cap, and shows the cap in the form', () => {
    openBank({ maxTransfer: '12345678' });

    fireEvent.click(screen.getByText('Send Money'));
    expect(screen.getByText('You can transfer up to $12345678')).toBeTruthy();
  });

  it('offers Send Money with no cap line when the page carries no cap note', () => {
    openBank({});

    fireEvent.click(screen.getByText('Send Money'));
    expect(screen.queryByText(/transfer up to/)).toBeNull();
  });

  it('a tournament world offers no Send pill and states the reason, Request Loan untouched', () => {
    openBank({ transferDenied: 'tournament' });

    expect(screen.queryByText('Send Money')).toBeNull();
    expect(screen.getByText('Money transfers are not allowed in Tournament planets')).toBeTruthy();
    expect(screen.getByText('Request Loan')).toBeTruthy();
  });

  it('a zero cap with money still owed states the loans / Investor Visa reason', () => {
    openBank({ transferDenied: 'loans' });

    expect(screen.queryByText('Send Money')).toBeNull();
    expect(screen.getByText('You cannot send money that you received with loans or as part of your Investor Visa')).toBeTruthy();
  });

  it('a zero cap with nothing to send states the no-money reason', () => {
    openBank({ transferDenied: 'no-money' });

    expect(screen.queryByText('Send Money')).toBeNull();
    expect(screen.getByText('You have no money to send')).toBeTruthy();
  });

  it('a Demo account states the Demo notice and never shows the cap it carries', () => {
    openBank({ transferDenied: 'demo', maxTransfer: '12345678' });

    expect(screen.queryByText('Send Money')).toBeNull();
    expect(screen.getByText('This is a Demo account: you cannot transfer money to other players or political figures')).toBeTruthy();
    expect(screen.queryByText(/transfer up to/)).toBeNull();
  });

  it('Retry re-requests the section', () => {
    const onProfileBank = jest.fn();
    renderWithProviders(<ProfilePanel />, {
      clientCallbacks: createSpiedCallbacks({ onProfileBank }),
    });

    clickSection('Bank Account');
    act(() => {
      useProfileStore.getState().setBankAccount({
        balance: '0', maxLoan: '0', totalLoans: '0',
        totalNextPayment: '0', loans: [], defaultInterest: 0, defaultTerm: 5,
        cacheUnavailable: true,
      });
    });

    fireEvent.click(screen.getByText('Retry'));

    expect(onProfileBank).toHaveBeenCalledTimes(2);
  });

  it('shows the unavailable state for Profit & Loss when the page could not be read', () => {
    const { container } = renderWithProviders(<ProfilePanel />);

    clickSection('Profit & Loss');
    act(() => {
      useProfileStore.getState().setProfitLoss({
        root: { label: 'Net Profit (losses)', level: 0, amount: '0', children: [] },
        cacheUnavailable: true,
      });
    });

    expect(useProfileStore.getState().isLoading).toBe(false);
    expect(container.querySelector('[class*="loading"]')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('The server could not read your profile');
  });
});
