/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `chat-flags` — driven through the real gateway push dispatcher, the real
 * browser event handler, the real chat store and the rendered `ChatStrip`.
 * `ChatMsg` is a `procedure` push (`Protocol/Protocol.pas:206`), so there is
 * no request/response half to prove — the two frames plus the browser
 * behaviour they produce are the only evidence that a speaker's badge comes
 * from the AccDesc it carries, not from the local user list.
 */

import { RdoProtocol } from '@/server/rdo';
import type { RdoPacket, WsMessage } from '@/shared/types';
import { WsMessageType, type WsEventChatMsg } from '@/shared/types';
import { makePushCtx } from '@/server/__tests__/session/fake-session-context';
import { dispatchPush } from '@/server/session/push-dispatcher';
import { dispatchEvent } from '@/client/handlers/event-handler';
import { useChatStore } from '@/client/store/chat-store';
import { ChatStrip } from '@/client/components/chat/ChatStrip';
import { renderWithProviders } from '@/client/__tests__/setup/render-helpers';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import { createChatFlagsScenario } from './chat-flags-scenario';

const { rdo } = createChatFlagsScenario();

function parsePush(frame: string): RdoPacket {
  return RdoProtocol.parse(frame) as RdoPacket;
}

/** The exact frame the scenario ships for an exchange — never a copy. */
function frameFor(id: string): string {
  return rdo.exchanges.find((e) => e.id === id)!.response;
}

/** Drives a raw push frame through the real gateway dispatcher and returns the emitted event. */
function pushToEvent(frame: string): WsEventChatMsg {
  const push = makePushCtx();
  dispatchPush(push.ctx, 'world', parsePush(frame));
  const emitted = (push.ctx.emit as jest.Mock).mock.calls
    .filter(([channel]) => channel === 'ws_event')
    .map(([, event]) => event as WsMessage)
    .find((e) => e.type === WsMessageType.EVENT_CHAT_MSG);
  expect(emitted).toBeDefined();
  return emitted as WsEventChatMsg;
}

function makeClientDriver(): ClientHandlerContext {
  return {
    soundManager: { play: jest.fn() },
  } as unknown as ClientHandlerContext;
}

beforeEach(() => {
  useChatStore.setState({
    currentChannel: 'Lobby',
    channels: [{ name: 'Lobby', isProtected: false }],
    messages: {},
    users: {},
    unreadChatCount: 0,
  });
});

describe('chat-flags scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('every exchange is a push with no request and a "*" separator', () => {
    for (const ex of rdo.exchanges) {
      expect(ex.pushOnly).toBe(true);
      expect(ex.request).toBe('');
      expect(ex.response).toContain('"*"');
      expect(ex.response).not.toContain('"^"');
    }
  });
});

describe('chat-flags scenario — a speaker absent from the user list', () => {
  it('renders the badge from the message alone, with the body coloured and emoticon substituted', () => {
    const event = pushToEvent(frameFor('chat-flags-stranger'));
    expect(event.from).toBe('Zorg');
    expect(event.nobilityTier).toBe('Duke');
    expect(event.modifiers).toBe(16);

    expect(useChatStore.getState().users['Zorg']).toBeUndefined();

    dispatchEvent(makeClientDriver(), event);

    expect(useChatStore.getState().users['Zorg']).toBeUndefined();
    const stored = useChatStore.getState().messages['Lobby'][0];
    expect(stored.nobilityTier).toBe('Duke');
    expect(stored.modifiers).toBe(16);
    expect(stored.text).toBe('hi from outside the list \u{1F642}');

    const { container } = renderWithProviders(<ChatStrip mode="embedded" />);
    const badge = container.querySelector('[title]');
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute('title')).toBe('Duke • GM');

    const body = container.querySelector('span[class*="text"]');
    expect(body).not.toBeNull();
    expect(body!.className).toMatch(/roleGameMaster/);
    expect(body!.textContent).toBe('hi from outside the list \u{1F642}');
  });
});

describe('chat-flags scenario — a speaker present in the user list', () => {
  it('renders the same badge whether or not the message itself carries the AccDesc', () => {
    useChatStore.getState().addUser({
      name: 'SPO_test3',
      id: '8389108',
      isAway: false,
      nobilityPoints: 500,
      nobilityTier: 'Baron',
      modifiers: 128,
    });

    const event = pushToEvent(frameFor('chat-flags-known'));
    expect(event.from).toBe('SPO_test3');
    expect(event.nobilityTier).toBe('Baron');
    expect(event.modifiers).toBe(128);

    dispatchEvent(makeClientDriver(), event);

    const { container: withFields } = renderWithProviders(<ChatStrip mode="embedded" />);
    const badgeWithFields = withFields.querySelector('[title]');
    expect(badgeWithFields).not.toBeNull();
    expect(badgeWithFields!.getAttribute('title')).toBe('Baron • Veteran');

    // Now the "nothing regresses" half: strip the event's own AccDesc fields —
    // the fallback to the user map must produce the identical badge.
    useChatStore.setState({ messages: {} });
    const strippedEvent: WsEventChatMsg = { ...event };
    delete strippedEvent.nobilityTier;
    delete strippedEvent.modifiers;
    dispatchEvent(makeClientDriver(), strippedEvent);

    const { container: withoutFields } = renderWithProviders(<ChatStrip mode="embedded" />);
    const badgeWithoutFields = withoutFields.querySelector('[title]');
    expect(badgeWithoutFields).not.toBeNull();
    expect(badgeWithoutFields!.getAttribute('title')).toBe(badgeWithFields!.getAttribute('title'));
    expect(badgeWithoutFields!.outerHTML).toBe(badgeWithFields!.outerHTML);
  });
});

