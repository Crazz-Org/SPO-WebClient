/**
 * ChatHistoryModal — the full scrollback view for the current channel.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useChatStore, type ChatMessage } from '../../store/chat-store';
import { ChatHistoryModal } from './ChatHistoryModal';

function seedMessages(count: number): void {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({ id: `m${i}`, from: i % 2 === 0 ? 'Alice' : 'Bob', text: `line-${i}`, timestamp: i, isSystem: false, isGM: false });
  }
  useChatStore.setState({ currentChannel: 'Lobby', messages: { Lobby: messages } });
}

function openModal() {
  useUiStore.getState().openModal('chatHistory');
}

beforeEach(() => {
  resetStores();
  useChatStore.setState({ currentChannel: '', messages: {} });
});

describe('ChatHistoryModal — visibility', () => {
  it('renders nothing while another modal holds the slot', () => {
    useUiStore.getState().openModal('settings');
    const { container } = renderWithProviders(<ChatHistoryModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog once chatHistory is the active modal', () => {
    openModal();
    renderWithProviders(<ChatHistoryModal />);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('ChatHistoryModal — the full transcript', () => {
  it('shows the empty state when the channel has no traffic yet', () => {
    seedMessages(0);
    openModal();
    renderWithProviders(<ChatHistoryModal />);
    expect(screen.getByText('No messages yet')).toBeTruthy();
  });

  it('renders far more than the 50-line strip window — the first and last of 120 are both present', () => {
    seedMessages(120);
    openModal();
    renderWithProviders(<ChatHistoryModal />);
    expect(screen.getByText('line-0')).toBeTruthy();
    expect(screen.getByText('line-119')).toBeTruthy();
  });
});

describe('ChatHistoryModal — filter', () => {
  it('narrows to matching lines only', () => {
    seedMessages(5); // Alice: line-0,2,4 / Bob: line-1,3
    openModal();
    renderWithProviders(<ChatHistoryModal />);

    fireEvent.change(screen.getByLabelText('Filter chat history'), { target: { value: 'Bob' } });

    expect(screen.queryByText('line-0')).toBeNull();
    expect(screen.getByText('line-1')).toBeTruthy();
    expect(screen.getByText('line-3')).toBeTruthy();
    expect(screen.getByText('2 of 5 lines')).toBeTruthy();
  });
});

describe('ChatHistoryModal — copy all', () => {
  beforeEach(() => {
    seedMessages(3);
    openModal();
  });

  it('copies the currently shown lines as plain "name: text" text and shows a status', async () => {
    const writeText = jest.fn(async (_text: string) => {});
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithProviders(<ChatHistoryModal />);
    fireEvent.click(screen.getByLabelText('Copy chat history'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Alice: line-0\nBob: line-1\nAlice: line-2'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copied'));

    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });

  it('shows a failure status instead of throwing when the clipboard is unavailable', async () => {
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;

    renderWithProviders(<ChatHistoryModal />);
    fireEvent.click(screen.getByLabelText('Copy chat history'));

    await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(''));
    expect(screen.getByRole('status').textContent).not.toBe('Copied');
  });
});

describe('ChatHistoryModal — closing', () => {
  it('closes on Escape', () => {
    seedMessages(1);
    openModal();
    renderWithProviders(<ChatHistoryModal />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(useUiStore.getState().modal).toBeNull();
  });

  it('closes on Close', () => {
    seedMessages(1);
    openModal();
    renderWithProviders(<ChatHistoryModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('closes on the backdrop', () => {
    seedMessages(1);
    openModal();
    const { container } = renderWithProviders(<ChatHistoryModal />);
    fireEvent.click(container.querySelector('[aria-hidden="true"]') as Element);
    expect(useUiStore.getState().modal).toBeNull();
  });
});
