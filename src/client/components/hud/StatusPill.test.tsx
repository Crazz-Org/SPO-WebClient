/**
 * StatusPill — desktop status line (doc/ux/handoff/00-socle.md §4.1).
 */

import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useGameStore } from '../../store/game-store';
import { useUiStore } from '../../store/ui-store';
import { StatusPill, formatGroupedMoney, formatGroupedIncome } from './StatusPill';
import type { TycoonStats } from '../../store/game-store';

const NNBSP = '\u202F';
/** Testing Library collapses every whitespace (U+202F included) to a plain space in DOM text. */
const shown = (text: string): string => text.replace(/\u202F/g, ' ');

function stats(overrides: Partial<TycoonStats> = {}): TycoonStats {
  return {
    username: 'SPO_test3',
    ranking: 12,
    cash: '12,480,300',
    incomePerHour: '184200',
    buildingCount: 14,
    maxBuildings: 50,
    failureLevel: 0,
    ...overrides,
  };
}

describe('formatGroupedMoney / formatGroupedIncome', () => {
  it('groups digits with narrow no-break spaces after "$ "', () => {
    expect(formatGroupedMoney('12,480,300')).toBe(`$${NNBSP}12${NNBSP}480${NNBSP}300`);
    expect(formatGroupedMoney(950)).toBe(`$${NNBSP}950`);
    expect(formatGroupedMoney(-1200)).toBe(`-$${NNBSP}1${NNBSP}200`);
    expect(formatGroupedMoney('garbage')).toBe(`$${NNBSP}0`);
  });

  it('formats income with sign and "/ h" suffix', () => {
    expect(formatGroupedIncome('184200')).toBe(`+$${NNBSP}184${NNBSP}200${NNBSP}/${NNBSP}h`);
    expect(formatGroupedIncome('-1200')).toBe(`-$${NNBSP}1${NNBSP}200${NNBSP}/${NNBSP}h`);
    expect(formatGroupedIncome('0')).toBe(`$${NNBSP}0${NNBSP}/${NNBSP}h`);
  });
});

describe('StatusPill', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.getState().clearSurfaces();
    useGameStore.setState({
      username: '',
      worldName: '',
      companyName: '',
      ownerRole: '',
      gameDate: null,
      tycoonStats: null,
      cashHistory: [],
      lastStatsUpdate: null,
      watchers: [],
      serverBusy: false,
    });
  });

  it('is a header labelled "Player status", not a live region', () => {
    renderWithProviders(<StatusPill />);
    const header = screen.getByRole('banner', { name: 'Player status' });
    expect(header.getAttribute('role')).toBeNull();
  });

  it('renders OFFLINE and no stats when nothing is known', () => {
    renderWithProviders(<StatusPill />);
    expect(screen.getByText('OFFLINE')).toBeTruthy();
    expect(screen.getByText('...')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders world, date, cash, income, rank, name, role, company and facilities', () => {
    useGameStore.setState({
      username: 'SPO_test3',
      worldName: 'Planitia',
      companyName: 'SPO_test3 - Green',
      ownerRole: 'Mayor',
      gameDate: new Date(2334, 2, 12),
      tycoonStats: stats(),
      cashHistory: [1, 2, 3],
    });
    renderWithProviders(<StatusPill />);
    expect(screen.getByText('PLANITIA')).toBeTruthy();
    expect(screen.getByText('Mar 12, 2334')).toBeTruthy();
    expect(screen.getByText(shown(`$${NNBSP}12${NNBSP}480${NNBSP}300`))).toBeTruthy();
    expect(screen.getByText(shown(`+$${NNBSP}184${NNBSP}200${NNBSP}/${NNBSP}h`))).toBeTruthy();
    expect(screen.getByText('#12')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open profile' }).textContent).toBe('SPO_test3');
    expect(screen.getByText('Mayor')).toBeTruthy();
    expect(screen.getByText('· SPO_test3 - Green')).toBeTruthy();
    expect(screen.getByText('· 14/50')).toBeTruthy();
    expect(screen.queryByText('Debt')).toBeNull();
  });

  it('falls back to "Unknown" for the name and colours negative income', () => {
    useGameStore.setState({ tycoonStats: stats({ incomePerHour: '-1200' }) });
    renderWithProviders(<StatusPill />);
    expect(screen.getByRole('button', { name: 'Open profile' }).textContent).toBe('Unknown');
    const income = screen.getByText(shown(`-$${NNBSP}1${NNBSP}200${NNBSP}/${NNBSP}h`));
    expect(income.className).toContain('incomeNegative');
    expect(screen.queryByText(/SPO_test3 - Green/)).toBeNull();
  });

  it('shows the Debt tag only at failureLevel >= 1, carrying the level', () => {
    useGameStore.setState({ tycoonStats: stats({ failureLevel: 1 }) });
    const { unmount } = renderWithProviders(<StatusPill />);
    const debt = screen.getByText('Debt');
    expect(debt.getAttribute('title')).toContain('Debt — level 1');
    expect(debt.className).not.toContain('alertPulse');
    unmount();

    useGameStore.setState({ tycoonStats: stats({ failureLevel: 2 }) });
    renderWithProviders(<StatusPill />);
    const alert = screen.getByText('Debt');
    expect(alert.getAttribute('title')).toContain('Debt — level 2');
    expect(alert.className).toContain('alertPulse');
  });

  it('the Debt tag is a control now (H6): it opens the grouped facilities list', () => {
    useGameStore.setState({ tycoonStats: stats({ failureLevel: 1 }) });
    renderWithProviders(<StatusPill />);
    const debt = screen.getByRole('button', { name: 'View facilities losing money' });
    fireEvent.click(debt);
    expect(useUiStore.getState().leftPanel).toBe('facilities');
  });

  it('cash button opens the empire surface', () => {
    useGameStore.setState({ tycoonStats: stats() });
    renderWithProviders(<StatusPill />);
    fireEvent.click(screen.getByRole('button', { name: 'Open profile (finances)' }));
    expect(useUiStore.getState().leftPanel).toBe('empire');
  });

  it('name button opens the empire surface', () => {
    useGameStore.setState({ tycoonStats: stats() });
    renderWithProviders(<StatusPill />);
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));
    expect(useUiStore.getState().leftPanel).toBe('empire');
  });

  it('takes the shifted class when a surface is open', () => {
    renderWithProviders(<StatusPill />);
    const header = screen.getByRole('banner');
    expect(header.className).not.toContain('shifted');
    act(() => useUiStore.getState().toggleLeftPanel('empire'));
    expect(header.className).toContain('shifted');
  });

  it('shows the watchers lamp with the count and both names on hover, and nothing for an empty list', () => {
    useGameStore.setState({ watchers: ['Crazz', 'SPO_test3'] });
    const { unmount } = renderWithProviders(<StatusPill />);
    const lamp = screen.getByText('2');
    expect(lamp.getAttribute('title')).toBe('Watching your area: Crazz, SPO_test3');
    expect(lamp.tagName).not.toBe('BUTTON');
    unmount();

    useGameStore.setState({ watchers: [] });
    renderWithProviders(<StatusPill />);
    expect(screen.queryByText('2')).toBeNull();
  });

  it('shows the Backup segment when serverBusy is true, and removes it when false', () => {
    useGameStore.setState({ serverBusy: true });
    const { unmount } = renderWithProviders(<StatusPill />);
    const backup = screen.getByText('Backup');
    expect(backup.tagName).not.toBe('BUTTON');
    unmount();

    useGameStore.setState({ serverBusy: false });
    renderWithProviders(<StatusPill />);
    expect(screen.queryByText('Backup')).toBeNull();
  });

  it('neither lamp is a button', () => {
    useGameStore.setState({ watchers: ['Crazz'], serverBusy: true });
    renderWithProviders(<StatusPill />);
    expect(screen.queryByRole('button', { name: /Watching your area/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Backup in progress/ })).toBeNull();
  });

  it('ticks the freshness label every second', () => {
    jest.useFakeTimers();
    try {
      useGameStore.setState({ lastStatsUpdate: Date.now() });
      renderWithProviders(<StatusPill />);
      expect(screen.getByText('0s ago')).toBeTruthy();
      act(() => { jest.advanceTimersByTime(3000); });
      expect(screen.getByText('3s ago')).toBeTruthy();
      act(() => { jest.advanceTimersByTime(60_000); });
      expect(screen.getByText('1m ago')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
