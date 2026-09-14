/**
 * ChatStrip — `/go`, `/afk`, and clicking a coordinate inside a received line.
 *
 * `/go` and `/afk` are handled locally by `runChatCommand` and must never reach
 * `onSendChatMessage`; an unrecognised `/word` is still ordinary text, exactly as
 * the legacy `ExecChatCmdURL` / `OnMessageComposed` pair worked
 * (`ChatHandler.pas:88-132`, `:183-189`).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useChatStore } from '../../../store/chat-store';
import { useMapStore } from '../../../store/map-store';
import { ChatStrip } from '../ChatStrip';

function setup() {
  const onChatAway = jest.fn();
  const onSendChatMessage = jest.fn();
  const centerOn = jest.fn();
  const recordPosition = jest.fn();
  useMapStore.setState({ source: { centerOn } as never, recordPosition });

  const callbacks = createSpiedCallbacks({
    onChatAway: onChatAway as (...a: unknown[]) => unknown,
    onSendChatMessage: onSendChatMessage as (...a: unknown[]) => unknown,
  });
  const view = renderWithProviders(<ChatStrip mode="embedded" />, { clientCallbacks: callbacks });
  const input = screen.getByPlaceholderText('Type a message...');
  return { ...view, input, onChatAway, onSendChatMessage, centerOn, recordPosition };
}

function send(input: HTMLElement, text: string): void {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('ChatStrip commands', () => {
  beforeEach(() => {
    resetStores();
    useChatStore.setState({
      currentChannel: 'Lobby',
      channels: [{ name: 'Lobby', isProtected: false }],
      messages: {},
      users: {},
      isExpanded: true,
    });
  });

  it('/go x,y moves the camera and is not sent to the channel', () => {
    const { input, centerOn, recordPosition, onSendChatMessage } = setup();

    send(input, '/go 5,6');

    expect(centerOn).toHaveBeenCalledWith(5, 6);
    expect(recordPosition).toHaveBeenCalledWith(5, 6);
    expect(onSendChatMessage).not.toHaveBeenCalled();
  });

  it('/go with a malformed argument tells the player and sends nothing', () => {
    const { input, centerOn, onSendChatMessage } = setup();

    send(input, '/go oops');

    expect(centerOn).not.toHaveBeenCalled();
    expect(onSendChatMessage).not.toHaveBeenCalled();
    const systemLine = useChatStore.getState().messages['Lobby']?.find((m) => m.isSystem);
    expect(systemLine).toBeDefined();
    expect(systemLine!.text).toBe('Usage: /go x,y');
  });

  it('/afk announces the away state and sends nothing', () => {
    const { input, onChatAway, onSendChatMessage } = setup();

    send(input, '/afk');

    expect(onChatAway).toHaveBeenCalled();
    expect(onSendChatMessage).not.toHaveBeenCalled();
  });

  it('an unrecognised /word is still sent as ordinary text', () => {
    const { input, onSendChatMessage } = setup();

    send(input, '/hello');

    expect(onSendChatMessage).toHaveBeenCalledWith('/hello');
  });

  it('a coordinate inside a received message is clickable and moves the camera', () => {
    useChatStore.setState({
      messages: {
        Lobby: [{
          id: 'm1', from: 'Someone', text: 'meet me at 12,34', timestamp: 0, isSystem: false, isGM: false,
        }],
      },
    });
    const { centerOn } = setup();

    const link = screen.getByRole('button', { name: '12,34' });
    fireEvent.click(link);

    expect(centerOn).toHaveBeenCalledWith(12, 34);
  });
});
