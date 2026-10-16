/**
 * LegacyGameChrome — the original client's in-game frame under the legacy theme.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useGameStore, type TycoonStats } from '../../../store/game-store';
import { useUiStore } from '../../../store/ui-store';
import { useMailStore } from '../../../store/mail-store';
import { LegacyGameChrome, formatLegacyMoney, formatLegacyDate } from './LegacyGameChrome';

function stats(overrides: Partial<TycoonStats> = {}): TycoonStats {
  return {
    username: 'danieleder',
    ranking: 15,
    cash: '101806766039892',
    incomePerHour: '0',
    buildingCount: 0,
    maxBuildings: 50,
    failureLevel: 0,
    ...overrides,
  };
}

beforeEach(() => {
  resetStores();
  useUiStore.getState().clearSurfaces();
  useGameStore.setState({
    username: 'danieleder',
    companyName: 'Mari PGI 2',
    tycoonStats: stats(),
    gameDate: new Date(2859, 1, 24),
    isVisitor: false,
    activeOverlay: null,
    isCityZonesEnabled: false,
  });
  useMailStore.setState({ unreadCount: 0 });
});

describe('formatLegacyMoney / formatLegacyDate', () => {
  it('groups every digit of a cash string too long for a number', () => {
    const sep = (1000).toLocaleString().charAt(1);
    expect(formatLegacyMoney('101806766039892')).toBe(`$101${sep}806${sep}766${sep}039${sep}892`);
    expect(formatLegacyMoney('-1200')).toBe(`-$1${sep}200`);
    expect(formatLegacyMoney('0')).toBe('$0');
  });

  it('writes the date as month day, year', () => {
    expect(formatLegacyDate(new Date(2859, 1, 24))).toMatch(/^\S+ 24, 2859$/);
    expect(formatLegacyDate(null)).toBe('');
  });
});

describe('LegacyGameChrome', () => {
  it('shows the tycoon block: rank and name, facilities, company, cash, cash per hour', () => {
    renderWithProviders(<LegacyGameChrome />);
    expect(screen.getByText('15. danieleder')).toBeTruthy();
    expect(screen.getByText('0/50')).toBeTruthy();
    expect(screen.getByText('Mari PGI 2')).toBeTruthy();
    expect(screen.getByText(formatLegacyMoney('101806766039892'))).toBeTruthy();
    expect(screen.getByText('($0/h)')).toBeTruthy();
  });

  it('opens the panels from the toolbar icons', () => {
    renderWithProviders(<LegacyGameChrome />);
    fireEvent.click(screen.getByLabelText('Mail'));
    expect(useUiStore.getState().rightPanel).toBe('mail');
    fireEvent.click(screen.getByLabelText('Map view'));
    expect(useUiStore.getState().stack).toHaveLength(0);
  });

  it('withholds Build, Favorites and User Profile from a visitor', () => {
    useGameStore.setState({ isVisitor: true });
    renderWithProviders(<LegacyGameChrome />);
    expect(screen.queryByLabelText('Display Build menu')).toBeNull();
    expect(screen.queryByLabelText('Favorites')).toBeNull();
    expect(screen.queryByLabelText('User Profile')).toBeNull();
    expect(screen.getByLabelText('Refresh all views')).toBeTruthy();
  });

  it('drives the map controls through the client', () => {
    const onZoomIn = jest.fn();
    const onRotateCW = jest.fn();
    const onToggleCityZones = jest.fn();
    renderWithProviders(<LegacyGameChrome />, {
      clientCallbacks: createSpiedCallbacks({ onZoomIn, onRotateCW, onToggleCityZones }),
    });
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.click(screen.getByLabelText('Rotate CW'));
    fireEvent.click(screen.getByText('CITY ZONES'));
    expect(onZoomIn).toHaveBeenCalled();
    expect(onRotateCW).toHaveBeenCalled();
    expect(onToggleCityZones).toHaveBeenCalled();
  });

  it('OVERLAY shows the overlay picker, which sets the overlay', () => {
    const onSetOverlay = jest.fn();
    renderWithProviders(<LegacyGameChrome />, { clientCallbacks: createSpiedCallbacks({ onSetOverlay }) });
    expect(screen.queryByText('Active Overlay:')).toBeNull();
    fireEvent.click(screen.getByText('OVERLAY'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Beauty' } });
    expect(onSetOverlay).toHaveBeenCalledWith('Beauty');
    expect(screen.getByText('Signal losing facilities')).toBeTruthy();
  });

  it('sends the chat line on Enter and clears it', () => {
    const onSendChatMessage = jest.fn();
    renderWithProviders(<LegacyGameChrome />, { clientCallbacks: createSpiedCallbacks({ onSendChatMessage }) });
    const input = screen.getByPlaceholderText('Enter chat text here...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSendChatMessage).toHaveBeenCalledWith('hello');
    expect(input.value).toBe('');
  });

  it('INSPECT waits for a selected facility; BACK and NEXT for a history', () => {
    renderWithProviders(<LegacyGameChrome />);
    expect((screen.getByText('INSPECT') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('< BACK') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('NEXT >') as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts the status lines on "No facility selected" and the default hint', () => {
    renderWithProviders(<LegacyGameChrome />);
    expect(screen.getByTitle('No facility selected')).toBeTruthy();
    expect(screen.getByTitle(/^Hint: Use a single click/)).toBeTruthy();
  });

  it('lights the mail LED while mail is unread', () => {
    const { container } = renderWithProviders(<LegacyGameChrome />);
    const mailLed = () => container.querySelector('[class*="ledMail"]');
    expect(mailLed()?.className).not.toMatch(/\bon\b|_on_/);
    act(() => { useMailStore.setState({ unreadCount: 2 }); });
    expect(mailLed()?.className).toMatch(/on/);
  });
});
