import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore, type TycoonStats } from '../../store/game-store';
import { CLUSTER_IDS } from '@/shared/cluster-data';
import { CompanyCreationModal, magnaSealUnlocked, MAGNA_REFUSAL } from './CompanyCreationModal';

function statsFixture(levelTier: number, nobPoints: number): TycoonStats {
  return {
    username: 't',
    cash: '0',
    incomePerHour: '0',
    ranking: 1,
    buildingCount: 0,
    maxBuildings: 10,
    levelTier,
    nobPoints,
  };
}

function setup(tycoonStats: TycoonStats | null, clusters: readonly string[] = [...CLUSTER_IDS]) {
  useUiStore.getState().openModal('createCompany');
  useGameStore.setState({ companyCreationClusters: [...clusters], tycoonStats });
  return renderWithProviders(<CompanyCreationModal />);
}

describe('CompanyCreationModal — Magna seal gating', () => {
  afterEach(() => {
    resetStores();
  });

  it.each([
    ['tier 4, 0 nobility', statsFixture(4, 0)],
    ['tier 2, 100 nobility', statsFixture(2, 100)],
  ])('%s: Magna is enabled and selectable', (_label, stats) => {
    setup(stats);

    const magnaTab = screen.getByRole('button', { name: 'Magna Corp' });
    expect(magnaTab).not.toBeDisabled();

    fireEvent.click(magnaTab);

    expect(screen.getByPlaceholderText('Enter company name...')).toBeInTheDocument();
    expect(screen.queryByText(MAGNA_REFUSAL)).not.toBeInTheDocument();
  });

  it.each([
    ['tier 2, 0 nobility', statsFixture(2, 0)],
    ['profile unknown', null],
  ])('%s: Magna is disabled and shows the refusal title', (_label, stats) => {
    setup(stats);

    const magnaTab = screen.getByRole('button', { name: 'Magna Corp' });
    expect(magnaTab).toBeDisabled();
    expect(magnaTab).toHaveAttribute('title', MAGNA_REFUSAL);
  });

  it.each([
    ['tier 2, 0 nobility', statsFixture(2, 0)],
    ['profile unknown', null],
  ])('%s: clicking the disabled Magna tab is ignored', (_label, stats) => {
    setup(stats);

    const magnaTab = screen.getByRole('button', { name: 'Magna Corp' });
    fireEvent.click(magnaTab);

    expect(screen.getByPlaceholderText('Enter company name...')).toBeInTheDocument();
  });

  it('shows the refusal instead of the name field when Magna is auto-selected as the first cluster', () => {
    setup(statsFixture(2, 0), ['Magna']);

    expect(screen.getByText(MAGNA_REFUSAL)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter company name...')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Company' })).not.toBeInTheDocument();
  });

  it('refuses submission (e.g. via Enter) when the selected cluster is a locked Magna', () => {
    setup(statsFixture(2, 0), ['Magna']);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

    expect(screen.getAllByText(MAGNA_REFUSAL).length).toBeGreaterThan(0);
  });

  it('updates the company name field as the tycoon types', () => {
    setup(statsFixture(4, 0));

    const nameInput = screen.getByPlaceholderText('Enter company name...') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Acme Corp' } });

    expect(nameInput.value).toBe('Acme Corp');
  });

  it.each([null, statsFixture(2, 0)])('the other four seals are never disabled', (stats) => {
    setup(stats);

    for (const name of ['Dissidents', 'PGI', 'Mariko Enterprises', 'The Moab']) {
      expect(screen.getByRole('button', { name })).not.toBeDisabled();
    }
  });
});

describe('magnaSealUnlocked', () => {
  it.each([
    [{ levelTier: 3, nobPoints: 99 }, false],
    [{ levelTier: 4, nobPoints: 0 }, true],
    [{ levelTier: 0, nobPoints: 100 }, true],
    [{ levelTier: undefined, nobPoints: undefined }, false],
    [null, false],
  ] as const)('%j -> %s', (stats, expected) => {
    expect(magnaSealUnlocked(stats)).toBe(expected);
  });
});
