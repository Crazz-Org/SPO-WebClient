/**
 * LegacyChatWindow and the original chat icons (ChatList.dat).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useChatStore } from '../../../store/chat-store';
import { useGameStore } from '../../../store/game-store';
import { useUiStore } from '../../../store/ui-store';
import { useMapStore } from '../../../store/map-store';
import { LegacyChatWindow } from './LegacyChatWindow';
import { chatUserIcons, nobilityRank } from './legacy-chat-icons';
import { LegacyGameChrome } from './LegacyGameChrome';

describe('chat icons (ChatList.dat)', () => {
  it('ranks nobility from 500 points up', () => {
    expect(nobilityRank(499)).toBeNull();
    expect(nobilityRank(500)).toBe('baron');
    expect(nobilityRank(1500)).toBe('viscount');
    expect(nobilityRank(20000)).toBe('srduke');
  });

  it('gives each modifier bit its icon unless a later bit cancels it', () => {
    expect(chatUserIcons(0x80, 1500)).toEqual(['veteran', 'viscount']);
    // IFEL ($100) cancels the veteran star ($80)
    expect(chatUserIcons(0x180, 0)).toEqual(['ifel']);
    // GM ($10) cancels OC ($02) and publisher ($04)
    expect(chatUserIcons(0x16, 0)).toEqual(['gm']);
    expect(chatUserIcons(0, 0)).toEqual([]);
  });
});

describe('LegacyChatWindow', () => {
  beforeEach(() => {
    resetStores();
    useGameStore.setState({ username: 'danieleder' });
    useChatStore.setState({
      currentChannel: 'Lobby',
      channels: [
        { name: 'Lobby', isProtected: false },
        { name: 'Gundia', isProtected: false },
        { name: 'Olympus', isProtected: true },
      ],
      messages: {
        Lobby: [
          { id: '1', from: 'SYSTEM', text: 'danieleder has entered Shamba', timestamp: Date.UTC(2026, 0, 1, 10, 24, 42), isSystem: true, isGM: false },
          { id: '2', from: 'Crazz', text: 'hello', timestamp: 0, isSystem: false, isGM: false },
        ],
      },
      users: {
        danieleder: { name: 'danieleder', id: '1', isAway: false, nobilityPoints: 1500, nobilityTier: 'Viscount', modifiers: 0x80 },
        Crazz: { name: 'Crazz', id: '2', isAway: false, nobilityPoints: 0, nobilityTier: '', modifiers: 0 },
      },
      ignored: [],
      typingUsers: new Set(),
    });
  });

  it('lists the channels but the lobby, and the conversation in the original formats', () => {
    renderWithProviders(<LegacyChatWindow chatOverMap onToggleChatOverMap={() => {}} />);
    expect(screen.getByText('Gundia')).toBeTruthy();
    expect(screen.getByText('Olympus')).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Lobby/ })).toBeNull();
    expect(screen.getByText(/ - SYSTEM: danieleder has entered Shamba$/)).toBeTruthy();
    expect(screen.getByText('Crazz:', { exact: false })).toBeTruthy();
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('joins the selected channel', () => {
    const onJoinChannel = jest.fn();
    renderWithProviders(<LegacyChatWindow chatOverMap onToggleChatOverMap={() => {}} />, {
      clientCallbacks: createSpiedCallbacks({ onJoinChannel }),
    });
    const join = screen.getByText('Join Channel') as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    fireEvent.click(screen.getByText('Gundia'));
    fireEvent.click(join);
    expect(onJoinChannel).toHaveBeenCalledWith('Gundia', undefined, 'Lobby');
    expect(useChatStore.getState().currentChannel).toBe('Gundia');
  });

  it('asks a protected channel for its password', () => {
    renderWithProviders(<LegacyChatWindow chatOverMap onToggleChatOverMap={() => {}} />);
    fireEvent.click(screen.getByText('Olympus'));
    fireEvent.click(screen.getByText('Join Channel'));
    expect(useUiStore.getState().modal).toBe('prompt');
  });

  it('sends a line on Enter', () => {
    const onSendChatMessage = jest.fn();
    renderWithProviders(<LegacyChatWindow chatOverMap onToggleChatOverMap={() => {}} />, {
      clientCallbacks: createSpiedCallbacks({ onSendChatMessage }),
    });
    const input = screen.getByPlaceholderText('Enter chat text here...');
    fireEvent.change(input, { target: { value: 'hi all' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSendChatMessage).toHaveBeenCalledWith('hi all');
  });

  it('ignores and follows the selected user, never oneself', () => {
    const onChaseUser = jest.fn();
    renderWithProviders(<LegacyChatWindow chatOverMap onToggleChatOverMap={() => {}} />, {
      clientCallbacks: createSpiedCallbacks({ onChaseUser }),
    });
    fireEvent.click(screen.getByRole('option', { name: /danieleder/ }));
    expect((screen.getByText('Follow User') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('option', { name: /Crazz/ }));
    fireEvent.click(screen.getByText('Follow User'));
    expect(onChaseUser).toHaveBeenCalledWith('Crazz');
    fireEvent.click(screen.getByText('Ignore User'));
    expect(useChatStore.getState().ignored).toContain('Crazz');
  });

  it('opens the log', () => {
    renderWithProviders(<LegacyChatWindow chatOverMap onToggleChatOverMap={() => {}} />);
    fireEvent.click(screen.getByText('Log'));
    expect(useUiStore.getState().modal).toBe('chatHistory');
  });

  it('joins on a double click, leaves back to the lobby, and opens Create Channel', () => {
    const onJoinChannel = jest.fn();
    renderWithProviders(<LegacyChatWindow chatOverMap onToggleChatOverMap={() => {}} />, {
      clientCallbacks: createSpiedCallbacks({ onJoinChannel }),
    });
    expect((screen.getByText('Leave Channel') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.doubleClick(screen.getByText('Gundia'));
    expect(useChatStore.getState().currentChannel).toBe('Gundia');
    fireEvent.click(screen.getByText('Leave Channel'));
    expect(onJoinChannel).toHaveBeenLastCalledWith('', undefined, 'Gundia');
    expect(useChatStore.getState().currentChannel).toBe('Lobby');
    fireEvent.click(screen.getByText('Create Channel'));
    expect(useUiStore.getState().modal).toBe('createChannel');
  });

  it('the marquee announces a channel created while the window is open', () => {
    renderWithProviders(<LegacyChatWindow chatOverMap onToggleChatOverMap={() => {}} />);
    act(() => {
      useChatStore.setState({ channels: [...useChatStore.getState().channels, { name: 'Trade', isProtected: false }] });
    });
    expect(screen.getByTitle('A NEW CHANNEL (TRADE) WAS CREATED.')).toBeTruthy();
  });

  it('keeps the / commands local', () => {
    const onSendChatMessage = jest.fn();
    const onChatAway = jest.fn();
    const centerOn = jest.fn();
    useMapStore.getState().setSource({ centerOn, getCameraPosition: () => ({ x: 0, y: 0 }) } as never);
    renderWithProviders(<LegacyChatWindow chatOverMap onToggleChatOverMap={() => {}} />, {
      clientCallbacks: createSpiedCallbacks({ onSendChatMessage, onChatAway }),
    });
    const input = screen.getByPlaceholderText('Enter chat text here...');
    const say = (value: string) => {
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: 'Enter' });
    };
    say('/go 30,40');
    expect(centerOn).toHaveBeenCalledWith(30, 40);
    say('/go');
    expect(useChatStore.getState().messages.Lobby?.at(-1)?.text).toBe('Usage: /go x,y');
    say('/afk');
    expect(onChatAway).toHaveBeenCalled();
    expect(onSendChatMessage).not.toHaveBeenCalled();
  });
});

describe('LegacyGameChrome chat', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.getState().clearSurfaces();
  });

  it('the chat icon opens the window, which hides the chat line; Chat over Map brings the line back', () => {
    renderWithProviders(<LegacyGameChrome />);
    expect(screen.getAllByPlaceholderText('Enter chat text here...')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(screen.getByRole('region', { name: 'Chat' })).toBeTruthy();
    // only the window's own composer now
    expect(screen.getAllByPlaceholderText('Enter chat text here...')).toHaveLength(1);
    act(() => { fireEvent.click(screen.getByText('Chat over Map')); });
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    // the line stays closed: Chat over Map was switched off
    expect(screen.queryByPlaceholderText('Enter chat text here...')).toBeNull();
  });

  it('the x of the chat line closes it', () => {
    renderWithProviders(<LegacyGameChrome />);
    fireEvent.click(screen.getByTitle('Close chat box'));
    expect(screen.queryByPlaceholderText('Enter chat text here...')).toBeNull();
  });
});
