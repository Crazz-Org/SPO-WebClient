/**
 * TopBar — every StatusPill segment, click and lamp, in the v2 top deck; plus what v2 adds
 * (Hide interface, the visitor reading).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { createSpiedCallbacks, renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useChatStore } from '../../store/chat-store';
import { useGameStore, type TycoonStats } from '../../store/game-store';
import { useUiStore } from '../../store/ui-store';
import * as barrel from './index';
import { TopBar } from './TopBar';
import { SignalLine } from './SignalLine';
import { ModeBanner } from './ModeBanner';

const NNBSP = '\u202F';
/** Testing Library collapses U+202F to a plain space in DOM text. */
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

describe('TopBar', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.getState().clearSurfaces();
    useUiStore.setState({ hudVisible: true });
    useGameStore.setState({
      username: '',
      worldName: '',
      companyName: '',
      ownerRole: '',
      isVisitor: false,
      gameDate: null,
      tycoonStats: null,
      cashHistory: [],
      lastStatsUpdate: null,
      watchers: [],
      serverBusy: false,
    });
  });

  it('the barrel exports the three top-deck slots', () => {
    expect(barrel.TopBar).toBe(TopBar);
    expect(barrel.SignalLine).toBe(SignalLine);
    expect(barrel.ModeBanner).toBe(ModeBanner);
  });

  it('is a header labelled "Player status" whose root class is .bar', () => {
    renderWithProviders(<TopBar />);
    const header = screen.getByRole('banner', { name: 'Player status' });
    expect(header.className).toContain('bar');
    expect(header.getAttribute('role')).toBeNull();
  });

  it('renders OFFLINE and "..." with no stats, and only the Hide button', () => {
    renderWithProviders(<TopBar />);
    expect(screen.getByText('OFFLINE')).toBeTruthy();
    expect(screen.getByText('...')).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Hide interface']);
  });

  it('renders world, date, cash, income, trend, rank, name, company, role and facilities', () => {
    useGameStore.setState({
      username: 'SPO_test3',
      worldName: 'Planitia',
      companyName: 'SPO_test3 - Green',
      ownerRole: 'Mayor',
      gameDate: new Date(2334, 2, 12),
      tycoonStats: stats(),
      cashHistory: [1, 2, 3],
    });
    const { container } = renderWithProviders(<TopBar />);
    expect(screen.getByText('PLANITIA')).toBeTruthy();
    expect(screen.getByText('Mar 12, 2334')).toBeTruthy();
    const finances = screen.getByRole('button', { name: 'Open profile (finances)' });
    expect(within(finances).getByText(shown(`$${NNBSP}12${NNBSP}480${NNBSP}300`))).toBeTruthy();
    const income = within(finances).getByText(shown(`+$${NNBSP}184${NNBSP}200${NNBSP}/${NNBSP}h`));
    expect(income.className).toContain('incomePositive');
    expect(container.querySelector('.sparkline')).toBeTruthy();
    expect(screen.getByText('#12')).toBeTruthy();
    const profile = screen.getByRole('button', { name: 'Open profile' });
    expect(within(profile).getByText('SPO_test3')).toBeTruthy();
    expect(within(profile).getByText('SPO_test3 - Green').getAttribute('title')).toBe('SPO_test3 - Green');
    expect(screen.getByText('Mayor')).toBeTruthy();
    expect(screen.getByTitle('Facilities: 14 of 50').textContent).toBe('14/50');
    expect(screen.queryByText('Debt')).toBeNull();
  });

  it('below 1280 px the low-priority segments give way so the name and company stay readable (CSS)', () => {
    const css = readFileSync(join(__dirname, 'TopBar.module.css'), 'utf8');
    const narrow = css.match(/@media \(max-width: 1279px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(narrow).toMatch(/\.bar \{\s*gap: var\(--space-2\);/);
    expect(narrow).toMatch(/\.sparkline,\s*\.freshness \{\s*display: none;/);
    expect(narrow).toMatch(/\.who \{\s*max-width: 220px;/);
  });

  it('falls back to "Unknown", colours negative and zero income, and omits company and role when absent', () => {
    useGameStore.setState({ tycoonStats: stats({ incomePerHour: '-1200' }) });
    const { unmount } = renderWithProviders(<TopBar />);
    expect(screen.getByRole('button', { name: 'Open profile' }).textContent).toBe('Unknown');
    expect(screen.getByText(shown(`-$${NNBSP}1${NNBSP}200${NNBSP}/${NNBSP}h`)).className).toContain('incomeNegative');
    expect(screen.queryByText('Mayor')).toBeNull();
    unmount();

    useGameStore.setState({ tycoonStats: stats({ incomePerHour: '0' }) });
    renderWithProviders(<TopBar />);
    expect(screen.getByText(shown(`$${NNBSP}0${NNBSP}/${NNBSP}h`)).className).toContain('incomeNeutral');
  });

  it('cash and name open the empire surface', () => {
    useGameStore.setState({ tycoonStats: stats() });
    renderWithProviders(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Open profile (finances)' }));
    expect(useUiStore.getState().leftPanel).toBe('empire');
    act(() => useUiStore.getState().clearSurfaces());
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));
    expect(useUiStore.getState().leftPanel).toBe('empire');
  });

  it('the Debt tag appears from failureLevel 1 with its level, pulses at 2, and opens My facilities', () => {
    useGameStore.setState({ tycoonStats: stats({ failureLevel: 1 }) });
    const { unmount } = renderWithProviders(<TopBar />);
    const debt = screen.getByRole('button', { name: 'View facilities losing money' });
    expect(debt.getAttribute('title')).toContain('Debt — level 1');
    expect(debt.className).not.toContain('alertPulse');
    fireEvent.click(debt);
    expect(useUiStore.getState().leftPanel).toBe('facilities');
    unmount();

    useGameStore.setState({ tycoonStats: stats({ failureLevel: 2 }) });
    renderWithProviders(<TopBar />);
    const alert = screen.getByRole('button', { name: 'View facilities losing money' });
    expect(alert.getAttribute('title')).toContain('Debt — level 2');
    expect(alert.className).toContain('alertPulse');
  });

  it('the watchers lamp shows the count, names everyone, and is not a button', () => {
    useGameStore.setState({ watchers: ['Crazz', 'SPO_test3'] });
    const { unmount } = renderWithProviders(<TopBar />);
    const lamp = screen.getByRole('img', { name: 'Watching your area: Crazz, SPO_test3' });
    expect(lamp.textContent).toBe('2');
    expect(lamp.getAttribute('title')).toBe('Watching your area: Crazz, SPO_test3');
    expect(lamp.tagName).not.toBe('BUTTON');
    unmount();

    useGameStore.setState({ watchers: [] });
    renderWithProviders(<TopBar />);
    expect(screen.queryByRole('img', { name: /Watching your area/ })).toBeNull();
  });

  it('the Backup lamp follows serverBusy and is not a button', () => {
    useGameStore.setState({ serverBusy: true });
    renderWithProviders(<TopBar />);
    const lamp = screen.getByRole('img', { name: /Backup in progress/ });
    expect(lamp.textContent).toBe('Backup');
    expect(lamp.getAttribute('title')).toBe('Backup in progress — the world is saving; some actions may be slower');
    expect(screen.queryByRole('button', { name: /Backup in progress/ })).toBeNull();

    act(() => useGameStore.setState({ serverBusy: false }));
    expect(screen.queryByRole('img', { name: /Backup in progress/ })).toBeNull();
  });

  it('never shifts when a surface opens: the side panel docks under it', () => {
    useGameStore.setState({ tycoonStats: stats(), companyName: 'Green' });
    renderWithProviders(<TopBar />);
    act(() => useUiStore.getState().toggleLeftPanel('empire'));
    const header = screen.getByRole('banner');
    expect(header.className).not.toContain('shifted');
    expect(screen.getByText('Green')).toBeTruthy();
  });

  it('a visitor sees the same figures, named Visitor, with no empire or facilities button', () => {
    useGameStore.setState({ isVisitor: true, username: 'guest', tycoonStats: stats({ failureLevel: 2 }) });
    renderWithProviders(<TopBar />);
    expect(screen.getByText('Visitor')).toBeTruthy();
    expect(screen.getByText('guest')).toBeTruthy();
    expect(screen.getByText(shown(`$${NNBSP}12${NNBSP}480${NNBSP}300`))).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open profile/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'View facilities losing money' })).toBeNull();
  });

  it('Hide interface toggles the HUD off', () => {
    renderWithProviders(<TopBar />);
    const hide = screen.getByRole('button', { name: 'Hide interface' });
    expect(hide.getAttribute('title')).toBe('Hide interface (H)');
    fireEvent.click(hide);
    expect(useUiStore.getState().hudVisible).toBe(false);
  });

  it('ticks the freshness label every second, and drops it without a timestamp', () => {
    jest.useFakeTimers();
    try {
      useGameStore.setState({ lastStatsUpdate: Date.now() });
      renderWithProviders(<TopBar />);
      expect(screen.getByText('0s ago')).toBeTruthy();
      act(() => { jest.advanceTimersByTime(3000); });
      expect(screen.getByText('3s ago')).toBeTruthy();
      act(() => { jest.advanceTimersByTime(60_000); });
      expect(screen.getByText('1m ago')).toBeTruthy();
      act(() => useGameStore.setState({ lastStatsUpdate: null }));
      expect(screen.queryByText(/ago$/)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('TopBar — the chase control (v1 ChaseBadge, carried by the bar)', () => {
  beforeEach(() => {
    resetStores();
    useChatStore.setState({ chasedUser: null });
  });
  afterEach(() => {
    useChatStore.setState({ chasedUser: null });
  });

  it('shows nothing while no camera is followed', () => {
    renderWithProviders(<TopBar />);
    expect(screen.queryByRole('button', { name: /Stop following/ })).toBeNull();
  });

  it('shows "Following X" while chasing, and a click stops the chase', () => {
    useChatStore.setState({ chasedUser: 'Alice' });
    const callbacks = createSpiedCallbacks({ onStopChase: jest.fn() });
    renderWithProviders(<TopBar />, { clientCallbacks: callbacks });
    const button = screen.getByRole('button', { name: 'Stop following Alice' });
    expect(button).toHaveTextContent('Following Alice');
    fireEvent.click(button);
    expect(callbacks.onStopChase).toHaveBeenCalledTimes(1);
  });
});
