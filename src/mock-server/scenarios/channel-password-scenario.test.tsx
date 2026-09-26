/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * The L1 protocol scenario for password-protected chat channels (issue 618),
 * driven through the real halves end to end: gateway emitter → mock → real
 * browser handler → real store → real ChatStrip.
 *
 * The regression this closes: `GetChannelList` answers name/password pairs
 * where an OPEN channel's password line is EMPTY. The old parse dropped every
 * empty line before pairing, so `Boardroom`'s password shifted into the name
 * column and its own name vanished. The list assertion below is the proof
 * that no longer happens; the padlock, the prompt and the two distinct
 * refusal messages are the rest of the criterion.
 */

import { RdoProtocol } from '@/server/rdo';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import {
  getChatChannelList,
  joinChatChannel,
  ChannelJoinError,
} from '@/server/session/chat-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { ERROR_InvalidPassword, ERROR_NotEnoughRoom } from '@/shared/error-codes';
import { joinChannel as clientJoinChannel } from '@/client/handlers/chat-handler';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import { useChatStore } from '@/client/store/chat-store';
import { useUiStore } from '@/client/store/ui-store';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '@/client/__tests__/setup/render-helpers';
import { ChatStrip } from '@/client/components/chat/ChatStrip';
import { RdoMock } from '../rdo-mock';
import {
  createChannelPasswordScenario,
  OPEN_CHANNEL,
  PROTECTED_CHANNEL,
  CHANNEL_PASSWORD,
} from './channel-password-scenario';

const { rdo } = createChannelPasswordScenario();

/** Drive the gateway against the mock; anything unscripted fails loudly. */
function makeServerDriver() {
  const rdoMock = new RdoMock();
  rdoMock.addScenario(rdo);

  const fake = makeSessionCtx();
  /** Every frame production emitted that a fixture answered, beside that fixture's literal. */
  const matched: { id: string; frame: string; request: string }[] = [];
  fake.respond((packet) => {
    const frame = `${RdoProtocol.format(packet as never)};`;
    const hit = rdoMock.match(frame);
    if (hit) matched.push({ id: hit.exchange.id, frame, request: hit.exchange.request });
    return hit ? hit.response.replace(/^A\d+\s+/, '') : new Error(`L1: no exchange for ${frame}`);
  });

  return { fake, rdoMock, matched };
}

/** Each fixture request is byte-for-byte the frame production emitted for it. */
function expectLiteralFrames(matched: { id: string; frame: string; request: string }[], ids: string[]) {
  expect(matched.map(m => m.id)).toEqual(ids);
  expect(matched.map(m => m.frame)).toEqual(matched.map(m => m.request));
}

/** The browser side: a ctx whose requests can be made to resolve or reject. */
function makeClientDriver(rejection?: { code: number; serverMessage: string }) {
  const showNotification = jest.fn();
  const sendRequest = jest.fn(() => {
    if (!rejection) return Promise.resolve({});
    const err = new Error(rejection.serverMessage) as Error & { code: number; serverMessage: string };
    err.code = rejection.code;
    err.serverMessage = rejection.serverMessage;
    return Promise.reject(err);
  });
  const ctx = {
    sendRequest,
    showNotification,
    isJoiningChannel: false,
  } as unknown as ClientHandlerContext;
  return { ctx, sendRequest, showNotification };
}

beforeEach(() => {
  resetStores();
  useChatStore.setState({ channels: [], currentChannel: '' });
});

// ===========================================================================
// 1. The catalogue — JoinChannel is a 2-arg function, every frame carries "^"
// ===========================================================================

describe('channel-password scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('JoinChannel is catalogued as a 2-arg function; every frame carries "^", none carries "*"', () => {
    expect(RDO_MEMBERS.JoinChannel).toEqual({ kind: 'function', arity: 2 });
    for (const ex of rdo.exchanges) {
      expect(ex.request).toContain('"^"');
      expect(ex.request).not.toContain('"*"');
    }
  });

  it('matches each frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });
});

// ===========================================================================
// 2. The regression — the open channel no longer shifts the protected one away
// ===========================================================================

describe('channel-password scenario — the channel list', () => {
  it('reports the open channel open and the protected channel protected', async () => {
    const { fake, matched } = makeServerDriver();

    await expect(getChatChannelList(fake.ctx)).resolves.toEqual([
      { name: 'Lobby', isProtected: false },
      { name: OPEN_CHANNEL, isProtected: false },
      { name: PROTECTED_CHANNEL, isProtected: true },
    ]);
    expectLiteralFrames(matched, ['channel-list']);
  });
});

// ===========================================================================
// 3-4. The UI — the padlock and the password prompt
//
// The protected-channel password is asked through the shared `requestPrompt`
// (issue #827), not a bespoke inline form: the dropdown closes immediately
// and the password itself lives in the ui-store's `promptPayload`.
// ===========================================================================

describe('channel-password scenario — the UI', () => {
  const channels = [
    { name: 'Lobby', isProtected: false },
    { name: OPEN_CHANNEL, isProtected: false },
    { name: PROTECTED_CHANNEL, isProtected: true },
  ];

  function setup() {
    useChatStore.getState().setChannels(channels);
    const onJoinChannel = jest.fn();
    const onGetChannelInfo = jest.fn();
    const callbacks = createSpiedCallbacks({
      onJoinChannel: onJoinChannel as (...a: unknown[]) => unknown,
      onGetChannelInfo: onGetChannelInfo as (...a: unknown[]) => unknown,
    });
    renderWithProviders(<ChatStrip />, { clientCallbacks: callbacks });
    fireEvent.click(screen.getByText('Lobby'));
    return { onJoinChannel, onGetChannelInfo };
  }

  it('shows exactly one padlock, on the protected channel', () => {
    setup();
    const locks = screen.getAllByLabelText('Password protected');
    expect(locks).toHaveLength(1);
    expect(locks[0].closest('button')).toHaveTextContent(PROTECTED_CHANNEL);
  });

  it('prompts for a password on the protected channel and does not join immediately', () => {
    const { onJoinChannel } = setup();
    fireEvent.click(screen.getByText(PROTECTED_CHANNEL));

    expect(useUiStore.getState().modal).toBe('prompt');
    expect(useUiStore.getState().promptPayload?.type).toBe('password');
    expect(screen.queryByLabelText('Channel password')).toBeNull();
    expect(onJoinChannel).not.toHaveBeenCalled();
  });

  it('sends the typed password on submit', () => {
    const { onJoinChannel } = setup();
    fireEvent.click(screen.getByText(PROTECTED_CHANNEL));
    useUiStore.getState().promptPayload?.onSubmit(CHANNEL_PASSWORD);

    expect(onJoinChannel).toHaveBeenCalledWith(PROTECTED_CHANNEL, CHANNEL_PASSWORD, 'Lobby');
  });

  it('joins an open channel with no prompt, unchanged', () => {
    const { onJoinChannel } = setup();
    fireEvent.click(screen.getByText(OPEN_CHANNEL));

    expect(useUiStore.getState().modal).toBeNull();
    expect(onJoinChannel).toHaveBeenCalledWith(OPEN_CHANNEL, undefined, 'Lobby');
  });

  it('keeps the Lobby -> "" mapping', () => {
    const { onJoinChannel } = setup();
    fireEvent.click(screen.getAllByText('Lobby')[1]);

    expect(onJoinChannel).toHaveBeenCalledWith('', undefined, 'Lobby');
  });

  it('a fresh prompt starts blank, leaving no stale password behind', () => {
    const { onJoinChannel } = setup();
    fireEvent.click(screen.getByText(PROTECTED_CHANNEL));
    expect(useUiStore.getState().promptPayload?.defaultValue).toBeUndefined();

    useUiStore.getState().closeModal();
    expect(onJoinChannel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Lobby'));
    fireEvent.click(screen.getByText(PROTECTED_CHANNEL));
    expect(useUiStore.getState().promptPayload?.defaultValue).toBeUndefined();
  });
});

// ===========================================================================
// 5-6. The gateway — the right password joins, the two refusals differ
// ===========================================================================

describe('channel-password scenario — join outcomes', () => {
  it('the right password joins the protected channel', async () => {
    const { fake, matched } = makeServerDriver();

    await expect(joinChatChannel(fake.ctx, PROTECTED_CHANNEL, CHANNEL_PASSWORD)).resolves.toBeUndefined();
    expect(fake.ctx.setCurrentChannel).toHaveBeenCalledWith(PROTECTED_CHANNEL);
    expectLiteralFrames(matched, ['join-protected-right-password']);
  });

  it('gives the wrong password and the full channel two different, player-readable messages', async () => {
    const wrongPasswordDriver = makeServerDriver();
    const wrongPassword = await joinChatChannel(wrongPasswordDriver.fake.ctx, PROTECTED_CHANNEL, '')
      .catch((e: ChannelJoinError) => e);

    const fullChannelDriver = makeServerDriver();
    const fullChannel = await joinChatChannel(fullChannelDriver.fake.ctx, OPEN_CHANNEL, '')
      .catch((e: ChannelJoinError) => e);

    expect(wrongPassword).toBeInstanceOf(ChannelJoinError);
    expect(fullChannel).toBeInstanceOf(ChannelJoinError);
    expect((wrongPassword as ChannelJoinError).code).toBe(ERROR_InvalidPassword);
    expect((fullChannel as ChannelJoinError).code).toBe(ERROR_NotEnoughRoom);
    expect((wrongPassword as ChannelJoinError).message).not.toBe((fullChannel as ChannelJoinError).message);
    expect((wrongPassword as ChannelJoinError).message).not.toBe(`Failed to join channel: ${ERROR_InvalidPassword}`);
    expect((fullChannel as ChannelJoinError).message).not.toBe(`Failed to join channel: ${ERROR_NotEnoughRoom}`);
    expectLiteralFrames(wrongPasswordDriver.matched, ['join-protected-wrong-password']);
    expectLiteralFrames(fullChannelDriver.matched, ['join-open-full']);
  });
});

// ===========================================================================
// 7. The browser leg — the sentence reaches the player, the channel rolls back
// ===========================================================================

describe('channel-password scenario — the browser leg', () => {
  it('shows the wrong-password sentence and restores the previous channel', async () => {
    useChatStore.setState({ currentChannel: 'Lobby' });
    const message = `Wrong password for "${PROTECTED_CHANNEL}".`;
    const { ctx, showNotification } = makeClientDriver({ code: ERROR_InvalidPassword, serverMessage: message });

    await clientJoinChannel(ctx, PROTECTED_CHANNEL, 'wrong');

    expect(showNotification).toHaveBeenCalledWith(message, 'error');
    expect(useChatStore.getState().currentChannel).toBe('Lobby');
  });

  it('shows the full-channel sentence and restores the previous channel', async () => {
    useChatStore.setState({ currentChannel: 'Lobby' });
    const message = `"${OPEN_CHANNEL}" is full — there is no room for another player right now.`;
    const { ctx, showNotification } = makeClientDriver({ code: ERROR_NotEnoughRoom, serverMessage: message });

    await clientJoinChannel(ctx, OPEN_CHANNEL);

    expect(showNotification).toHaveBeenCalledWith(message, 'error');
    expect(useChatStore.getState().currentChannel).toBe('Lobby');
  });
});
