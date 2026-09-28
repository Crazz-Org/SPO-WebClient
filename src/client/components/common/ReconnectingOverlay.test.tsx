import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
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

describe('ReconnectingOverlay — server full (issue 1076)', () => {
  beforeEach(() => {
    useGameStore.setState({ disconnectReason: null, serverFull: false, serverRestarting: false });
  });
  afterEach(() => {
    useGameStore.setState({ disconnectReason: null, serverFull: false, serverRestarting: false });
  });

  it('a disconnect for server_full reads "Server full" and the try-later line', () => {
    useGameStore.setState({ status: 'disconnected', disconnectReason: 'server_full' });
    renderWithProviders(<ReconnectingOverlay />);
    expect(screen.getByText('Server full')).toBeTruthy();
    expect(screen.getByText('The server is full right now. Please try again in a few minutes.')).toBeTruthy();
    expect(screen.queryByText('Connection lost')).toBeNull();
    expect(screen.queryByText(/session has expired/i)).toBeNull();
    expect(screen.getByText('Return to home page')).toBeTruthy();
  });

  it('while reconnecting with the cause, the spinner card reads "Server full"', () => {
    useGameStore.setState({ status: 'reconnecting', reconnectAttempt: 2, serverFull: true });
    renderWithProviders(<ReconnectingOverlay />);
    expect(screen.getByText('Server full')).toBeTruthy();
    expect(screen.getByText(/keeps retrying automatically/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(`attempt 2 of ${MAX_RECONNECT_ATTEMPTS}`, 'i'))).toBeTruthy();
    expect(screen.getByText('Try now')).toBeTruthy();
    expect(screen.queryByText('Connection lost')).toBeNull();
  });

  it('the full cause wins over the restart cause', () => {
    useGameStore.setState({ status: 'reconnecting', reconnectAttempt: 1, serverFull: true, serverRestarting: true });
    renderWithProviders(<ReconnectingOverlay />);
    expect(screen.getByText('Server full')).toBeTruthy();
    expect(screen.queryByText('Server restarting')).toBeNull();
    expect(screen.queryByText('The game will reconnect automatically.')).toBeNull();
  });
});
