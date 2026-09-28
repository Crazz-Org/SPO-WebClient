import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useGameStore } from '../../store/game-store';
import { GATEWAY_UNREACHABLE_MESSAGE, MAX_RECONNECT_ATTEMPTS } from '../../handlers/reconnect-utils';
import { ReconnectingOverlay } from './ReconnectingOverlay';

beforeEach(() => {
  useGameStore.setState({ status: 'disconnected', reconnectAttempt: 0, serverRestarting: false });
});

describe('ReconnectingOverlay', () => {
  it('renders nothing when status is connected', () => {
    useGameStore.setState({ status: 'connected' });
    const { container } = renderWithProviders(<ReconnectingOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when status is disconnected', () => {
    useGameStore.setState({ status: 'disconnected' });
    const { container } = renderWithProviders(<ReconnectingOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when status is connecting', () => {
    useGameStore.setState({ status: 'connecting' });
    const { container } = renderWithProviders(<ReconnectingOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the overlay when status is reconnecting', () => {
    useGameStore.setState({ status: 'reconnecting', reconnectAttempt: 1 });
    renderWithProviders(<ReconnectingOverlay />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Connection lost')).toBeTruthy();
  });

  it('shows attempt counter with correct max', () => {
    useGameStore.setState({ status: 'reconnecting', reconnectAttempt: 1 });
    renderWithProviders(<ReconnectingOverlay />);
    expect(screen.getByText(new RegExp(`attempt 1 of ${MAX_RECONNECT_ATTEMPTS}`, 'i'))).toBeTruthy();
  });

  it('shows attempt counter at mid-range', () => {
    useGameStore.setState({ status: 'reconnecting', reconnectAttempt: 3 });
    renderWithProviders(<ReconnectingOverlay />);
    expect(screen.getByText(new RegExp(`attempt 3 of ${MAX_RECONNECT_ATTEMPTS}`, 'i'))).toBeTruthy();
  });

  it('shows slow poll message for attempts past fast phase', () => {
    useGameStore.setState({ status: 'reconnecting', reconnectAttempt: 7 });
    renderWithProviders(<ReconnectingOverlay />);
    expect(screen.getByText(/slow poll/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(`attempt 7 of ${MAX_RECONNECT_ATTEMPTS}`, 'i'))).toBeTruthy();
  });

  it('has aria-live="polite" for accessibility', () => {
    useGameStore.setState({ status: 'reconnecting', reconnectAttempt: 1 });
    renderWithProviders(<ReconnectingOverlay />);
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('"Try now" button calls onTriggerReconnect', () => {
    useGameStore.setState({ status: 'reconnecting', reconnectAttempt: 2 });
    const onTriggerReconnect = jest.fn();
    const callbacks = createSpiedCallbacks({ onTriggerReconnect });
    renderWithProviders(<ReconnectingOverlay />, { clientCallbacks: callbacks });

    fireEvent.click(screen.getByRole('button', { name: /try now/i }));
    expect(onTriggerReconnect).toHaveBeenCalledTimes(1);
  });
});

describe('ReconnectingOverlay — gateway restarting', () => {
  it('titles the spinner card "Server restarting" with the automatic-reconnect line', () => {
    useGameStore.setState({ status: 'reconnecting', reconnectAttempt: 2, serverRestarting: true });
    renderWithProviders(<ReconnectingOverlay />);
    expect(screen.getByText('Server restarting')).toBeTruthy();
    expect(screen.getByText(/reconnect automatically/i)).toBeTruthy();
    expect(screen.queryByText('Connection lost')).toBeNull();
    expect(screen.getByText(new RegExp(`attempt 2 of ${MAX_RECONNECT_ATTEMPTS}`, 'i'))).toBeTruthy();
    expect(screen.getByText('Try now')).toBeTruthy();
  });

  it('falls back to the "Connection lost" error card once attempts are exhausted', () => {
    useGameStore.setState({ status: 'disconnected', disconnectReason: 'connection_lost', serverRestarting: false });
    renderWithProviders(<ReconnectingOverlay />);
    expect(screen.getByText('Connection lost')).toBeTruthy();
    expect(screen.queryByText('Server restarting')).toBeNull();
  });
});

describe('ReconnectingOverlay — connection lost text (issue 1048)', () => {
  it('blames the server, not the player\'s internet connection', () => {
    useGameStore.setState({ status: 'disconnected', disconnectReason: 'connection_lost' });
    renderWithProviders(<ReconnectingOverlay />);

    expect(screen.getByText('Connection lost')).toBeTruthy();
    expect(screen.getByText(GATEWAY_UNREACHABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(/internet connection/i)).toBeNull();
  });
});
