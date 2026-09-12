/**
 * CompanyCreationModal — the client-side name guard.
 *
 * The modal refuses exactly what the server's ValidName refuses
 * (Cache/CacheCommon.pas:110-125) and nothing more: a name carrying '&' or '+' is
 * sent, a name carrying '{', '}', '%' or '..' is refused with its reason before
 * any round-trip.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import {
  renderWithProviders,
  resetStores,
  createSpiedCallbacks,
} from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore, type TycoonStats } from '../../store/game-store';
import { useProfileStore } from '../../store/profile-store';
import type { TycoonProfileFull } from '@/shared/types';
import { MAGNA_REFUSAL } from '@/shared/cluster-data';
import { CompanyCreationModal } from './CompanyCreationModal';

function open(): void {
  useGameStore.setState({ companyCreationClusters: ['PGI'] });
  useUiStore.getState().openModal('createCompany');
}

/** Type `name` into the input and press "Create Company". */
async function submit(name: string): Promise<void> {
  const input = screen.getByPlaceholderText('Enter company name...');
  fireEvent.change(input, { target: { value: name } });
  await act(async () => {
    fireEvent.click(screen.getByText('Create Company'));
  });
}

beforeEach(() => {
  resetStores();
  useGameStore.setState({ companyCreationClusters: [], tycoonStats: null });
  useProfileStore.setState({ profile: null });
});

describe('CompanyCreationModal name guard', () => {
  it('renders nothing when another modal holds the slot', () => {
    useUiStore.getState().openModal('settings');
    const { container } = renderWithProviders(<CompanyCreationModal />);
    expect(container.firstChild).toBeNull();
  });

  it.each([['Star & Moon Co.'], ['A+B Holdings']])(
    'sends %s — the server never refused & or +',
    async (name) => {
      const onCreateCompanySubmit = jest.fn(async (..._args: unknown[]) => undefined);
      open();
      renderWithProviders(
        <CompanyCreationModal />,
        { clientCallbacks: createSpiedCallbacks({ onCreateCompanySubmit }) },
      );

      await submit(name);

      expect(onCreateCompanySubmit).toHaveBeenCalledWith(name, 'PGI');
    },
  );

  it.each([
    ['My..Corp', 'Company name cannot contain ".."'],
    ['My{Corp', 'Company name cannot contain: \\ / : * ? " < > | { } %'],
    ['My}Corp', 'Company name cannot contain: \\ / : * ? " < > | { } %'],
    ['50% Off', 'Company name cannot contain: \\ / : * ? " < > | { } %'],
  ])('refuses %s with its reason and sends nothing', async (name, reason) => {
    const onCreateCompanySubmit = jest.fn(async (..._args: unknown[]) => undefined);
    open();
    renderWithProviders(
      <CompanyCreationModal />,
      { clientCallbacks: createSpiedCallbacks({ onCreateCompanySubmit }) },
    );

    await submit(name);

    expect(screen.getByText(reason)).toBeTruthy();
    expect(onCreateCompanySubmit).not.toHaveBeenCalled();
  });

  it('refuses a blank name before any round-trip', async () => {
    const onCreateCompanySubmit = jest.fn(async (..._args: unknown[]) => undefined);
    open();
    renderWithProviders(
      <CompanyCreationModal />,
      { clientCallbacks: createSpiedCallbacks({ onCreateCompanySubmit }) },
    );

    await submit('   ');

    expect(screen.getByText('Company name cannot be empty')).toBeTruthy();
    expect(onCreateCompanySubmit).not.toHaveBeenCalled();
  });
});

const BASE_PROFILE: TycoonProfileFull = {
  name: 'T',
  realName: 'T',
  ranking: 1,
  budget: '0',
  prestige: 0,
  facPrestige: 0,
  researchPrestige: 0,
  facCount: 0,
  facMax: 10,
  area: 0,
  nobPoints: 0,
  licenceLevel: 0,
  failureLevel: 0,
  levelName: 'Tycoon',
  levelTier: 2,
};

/** The periodic EVENT_TYCOON_UPDATE push — no level/nobility fields of its own. */
const TYCOON_UPDATE_STATS: TycoonStats = {
  username: 'T',
  cash: '0',
  incomePerHour: '0',
  ranking: 1,
  buildingCount: 0,
  maxBuildings: 10,
};

function openWith(profile: TycoonProfileFull | null): void {
  useGameStore.setState({
    companyCreationClusters: ['Dissidents', 'PGI', 'Mariko', 'Moab', 'Magna'],
  });
  useProfileStore.setState({ profile });
  useUiStore.getState().openModal('createCompany');
}

describe('CompanyCreationModal Magna gate', () => {
  it.each([
    ['Paradigm, no nobility', { ...BASE_PROFILE, levelTier: 4, nobPoints: 0 }, true],
    ['Tycoon, 100 nobility', { ...BASE_PROFILE, levelTier: 2, nobPoints: 100 }, true],
    ['Tycoon, no nobility', { ...BASE_PROFILE, levelTier: 2, nobPoints: 0 }, false],
    ['profile unknown', null, false],
  ] as const)('%s', (_label, profile, selectable) => {
    openWith(profile);
    renderWithProviders(<CompanyCreationModal />);

    fireEvent.click(screen.getByText('Magna Corp'));
    const magnaTab = screen.getByText('Magna Corp').closest('button');

    if (selectable) {
      expect(magnaTab?.getAttribute('aria-disabled')).toBeNull();
      expect(screen.getByPlaceholderText('Enter company name...')).toBeTruthy();
      expect(screen.queryByText(MAGNA_REFUSAL)).toBeNull();
    } else {
      expect(magnaTab?.getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByText(MAGNA_REFUSAL)).toBeTruthy();
      expect(screen.queryByPlaceholderText('Enter company name...')).toBeNull();
      expect(screen.queryByText('Create Company')).toBeNull();
    }
  });

  it('never gates the other four seals', () => {
    openWith({ ...BASE_PROFILE, levelTier: 2, nobPoints: 0 });
    renderWithProviders(<CompanyCreationModal />);

    for (const name of ['Dissidents', 'PGI', 'Mariko Enterprises', 'The Moab']) {
      fireEvent.click(screen.getByText(name));
      const tab = screen.getByText(name).closest('button');
      expect(tab?.getAttribute('aria-disabled')).toBeNull();
      expect(screen.getByPlaceholderText('Enter company name...')).toBeTruthy();
    }
  });

  it('refuses Enter on a locked Magna tab', () => {
    const onCreateCompanySubmit = jest.fn(async (..._args: unknown[]) => undefined);
    openWith({ ...BASE_PROFILE, levelTier: 2, nobPoints: 0 });
    renderWithProviders(
      <CompanyCreationModal />,
      { clientCallbacks: createSpiedCallbacks({ onCreateCompanySubmit }) },
    );

    fireEvent.click(screen.getByText('Magna Corp'));
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Enter' });

    expect(onCreateCompanySubmit).not.toHaveBeenCalled();
  });

  it('stays unlocked after a periodic tycoon-stats push follows the profile load', () => {
    // event-handler.ts:189-205 replaces tycoonStats wholesale on every
    // EVENT_TYCOON_UPDATE, carrying no levelTier/nobPoints of its own — the gate
    // must not regress once it reads the profile store instead (see plan diagnosis).
    openWith({ ...BASE_PROFILE, levelTier: 4, nobPoints: 0 });
    useGameStore.getState().setTycoonStats(TYCOON_UPDATE_STATS);
    renderWithProviders(<CompanyCreationModal />);

    fireEvent.click(screen.getByText('Magna Corp'));
    const magnaTab = screen.getByText('Magna Corp').closest('button');

    expect(magnaTab?.getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByPlaceholderText('Enter company name...')).toBeTruthy();
    expect(screen.queryByText(MAGNA_REFUSAL)).toBeNull();
  });
});
