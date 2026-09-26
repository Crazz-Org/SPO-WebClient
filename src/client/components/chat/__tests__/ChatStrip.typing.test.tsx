/**
 * ChatStrip — the composition notice.
 *
 * The receiving half was complete: the gateway pushes EVENT_CHAT_USER_TYPING and
 * the strip renders "… typing…". Nothing ever sent our own, so the indicator
 * only ever showed other clients. These tests pin the sending half: raised when
 * there is something in the box, retracted when the box empties, when the
 * message goes, and after a pause.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { fireEvent, screen, act } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { ChatStrip } from '../ChatStrip';
import { useChatStore } from '../../../store/chat-store';

function setup() {
  const onChatTypingChange = jest.fn();
  const onSendChatMessage = jest.fn();
  const callbacks = createSpiedCallbacks({
    onChatTypingChange: onChatTypingChange as (...a: unknown[]) => unknown,
    onSendChatMessage: onSendChatMessage as (...a: unknown[]) => unknown,
  });
  const view = renderWithProviders(<ChatStrip />, { clientCallbacks: callbacks });
  const input = screen.getByPlaceholderText('Type a message...');
  return { ...view, input, onChatTypingChange, onSendChatMessage };
}

describe('ChatStrip typing notice', () => {
  beforeEach(() => {
    resetStores();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('raises the notice as soon as there is something in the box', () => {
    const { input, onChatTypingChange } = setup();

    fireEvent.change(input, { target: { value: 'h' } });

    expect(onChatTypingChange).toHaveBeenCalledWith(true);
  });

  it('retracts it when the box is emptied again', () => {
    const { input, onChatTypingChange } = setup();

    fireEvent.change(input, { target: { value: 'hello' } });
    onChatTypingChange.mockClear();
    fireEvent.change(input, { target: { value: '' } });

    expect(onChatTypingChange).toHaveBeenCalledWith(false);
  });

  it('retracts it after a pause, without another keystroke', () => {
    const { input, onChatTypingChange } = setup();

    fireEvent.change(input, { target: { value: 'hello' } });
    onChatTypingChange.mockClear();

    act(() => { jest.advanceTimersByTime(4000); });

    expect(onChatTypingChange).toHaveBeenCalledWith(false);
  });

  it('does not retract while the typing continues', () => {
    const { input, onChatTypingChange } = setup();

    fireEvent.change(input, { target: { value: 'hel' } });
    act(() => { jest.advanceTimersByTime(3000); });
    fireEvent.change(input, { target: { value: 'hello' } });
    onChatTypingChange.mockClear();
    act(() => { jest.advanceTimersByTime(3000); });

    expect(onChatTypingChange).not.toHaveBeenCalled();
  });

  it('retracts it when the message goes out', () => {
    const { input, onChatTypingChange, onSendChatMessage } = setup();

    fireEvent.change(input, { target: { value: 'hello' } });
    onChatTypingChange.mockClear();
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSendChatMessage).toHaveBeenCalledWith('hello');
    expect(onChatTypingChange).toHaveBeenCalledWith(false);
  });

  it('retracts it exactly once when the strip unmounts mid-sentence', () => {
    const { input, onChatTypingChange, unmount } = setup();

    fireEvent.change(input, { target: { value: 'hel' } });
    onChatTypingChange.mockClear();
    unmount();

    expect(onChatTypingChange).toHaveBeenCalledTimes(1);
    expect(onChatTypingChange).toHaveBeenCalledWith(false);

    act(() => { jest.advanceTimersByTime(4000); });
    expect(onChatTypingChange).toHaveBeenCalledTimes(1);
  });

  it('sends nothing on unmount when nothing is pending', () => {
    const { input, onChatTypingChange, unmount } = setup();

    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    onChatTypingChange.mockClear();
    unmount();

    expect(onChatTypingChange).not.toHaveBeenCalled();
  });
});

describe('ChatStrip away marker', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows away and typing as independent markers that can both be on', () => {
    useChatStore.getState().setUsers([
      { name: 'Crazz', id: '3', isAway: true, nobilityPoints: 0, nobilityTier: 'Commoner', modifiers: 0 },
    ]);
    renderWithProviders(<ChatStrip />);

    const dot = screen.getByLabelText('away');
    expect(dot.className).toMatch(/statusDotAway/);
    expect(dot.className).not.toMatch(/statusDotTyping/);

    act(() => {
      useChatStore.getState().setUserTyping('Crazz', true);
    });

    const updatedDot = screen.getByLabelText('away, typing');
    expect(updatedDot.className).toMatch(/statusDotAway/);
    expect(updatedDot.className).toMatch(/statusDotTyping/);
    expect(useChatStore.getState().users['Crazz'].isAway).toBe(true);
  });
});
