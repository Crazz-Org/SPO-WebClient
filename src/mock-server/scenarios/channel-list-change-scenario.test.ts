/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * The L1 protocol scenario for a channel-list push reaching the dropdown live,
 * driven end to end through the real halves: real push dispatcher -> real
 * browser event handler -> real `useChatStore`.
 *
 * `NotifyChannelListChange` is a pure unsolicited push (`Protocol/Protocol.pas`,
 * `procedure` — every frame carries `"*"`, no QueryId, no reply), so there is
 * no gateway emitter leg: the only thing to prove is that the dropdown
 * contents change after each push, that `'Lobby'` never leaves the list, and
 * that nothing here ever asks the server to re-fetch the whole list.
 */

jest.mock('@/client/bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    addChatChannel: jest.fn(),
    removeChatChannel: jest.fn(),
    setCurrentChannel: jest.fn(),
    addChatMessage: jest.fn(),
  },
}));

import { RdoProtocol } from '@/server/rdo';
import { dispatchPush } from '@/server/session/push-dispatcher';
import { makePushCtx } from '@/server/__tests__/session/fake-session-context';
import { dispatchEvent } from '@/client/handlers/event-handler';
import { ClientBridge } from '@/client/bridge/client-bridge';
import { useChatStore } from '@/client/store/chat-store';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import { WsMessageType } from '@/shared/types';
import type { WsMessage, RdoPacket } from '@/shared/types';
import { RdoMock } from '../rdo-mock';
import { mergeVariables } from './scenario-variables';
import { createChannelListChangeScenario, CHANGED_CHANNEL, CHANGED_PASSWORD } from './channel-list-change-scenario';

const { rdo } = createChannelListChangeScenario();
const clientCtx = {} as unknown as ClientHandlerContext;

/** Parse a raw push frame the way the real socket reader hands it to the dispatcher. */
function parsePush(frame: string): RdoPacket {
  return RdoProtocol.parse(frame) as RdoPacket;
}

/** Drive one exchange's push frame through both real halves. */
function drivePush(exchangeId: string): void {
  const exchange = rdo.exchanges.find(e => e.id === exchangeId)!;
  const push = makePushCtx();
  dispatchPush(push.ctx, 'world', parsePush(exchange.response));

  const listChange = (push.ctx.emit as jest.Mock).mock.calls
    .filter(([channel]) => channel === 'ws_event')
    .map(([, event]) => event as WsMessage)
    .find(e => e.type === WsMessageType.EVENT_CHANNEL_LIST_CHANGE);
  expect(listChange).toBeDefined();

  dispatchEvent(clientCtx, listChange!);
}

function channelNames(): string[] {
  return useChatStore.getState().channels.map(c => c.name);
}

beforeEach(() => {
  jest.clearAllMocks();
  (ClientBridge.addChatChannel as jest.Mock).mockImplementation(
    (channel) => useChatStore.getState().addChannel(channel as string),
  );
  (ClientBridge.removeChatChannel as jest.Mock).mockImplementation(
    (channel) => useChatStore.getState().removeChannel(channel as string),
  );
  (ClientBridge.setCurrentChannel as jest.Mock).mockImplementation(
    (channel) => useChatStore.getState().setCurrentChannel(channel as string),
  );
  (ClientBridge.addChatMessage as jest.Mock).mockImplementation(
    (channel, message) => useChatStore.getState().addMessage(channel as string, message as never),
  );
});

describe('channel-list-change scenario', () => {
  it('the inclusion push adds the channel to the dropdown', () => {
    useChatStore.setState({ channels: [{ name: 'Lobby', isProtected: false }], currentChannel: 'Lobby', messages: {} });

    drivePush('channel-list-change-inclusion');

    expect(channelNames()).toEqual(['Lobby', CHANGED_CHANNEL]);
  });

  it('the exclusion push drops the channel; the current channel is untouched when it is not the one removed', () => {
    useChatStore.setState({
      channels: [{ name: 'Lobby', isProtected: false }, { name: CHANGED_CHANNEL, isProtected: false }],
      currentChannel: 'Lobby',
      messages: {},
    });

    drivePush('channel-list-change-exclusion');

    expect(channelNames()).toEqual(['Lobby']);
    expect(useChatStore.getState().currentChannel).toBe('Lobby');
  });

  it('an exclusion of the current channel drops it and returns the player to Lobby with a system message', () => {
    useChatStore.setState({
      channels: [{ name: 'Lobby', isProtected: false }, { name: CHANGED_CHANNEL, isProtected: false }],
      currentChannel: CHANGED_CHANNEL,
      messages: {},
    });

    drivePush('channel-list-change-inclusion');
    drivePush('channel-list-change-exclusion');

    expect(channelNames()).toEqual(['Lobby']);
    expect(useChatStore.getState().currentChannel).toBe('Lobby');
    expect(useChatStore.getState().messages['Lobby']?.some(m => m.isSystem)).toBe(true);
  });

  it('an exclusion naming Lobby never removes it, whatever the server sends', () => {
    useChatStore.setState({ channels: [{ name: 'Lobby', isProtected: false }], currentChannel: 'Lobby', messages: {} });

    drivePush('channel-list-change-lobby-exclusion');

    expect(channelNames()).toContain('Lobby');
  });

  it('no exchange in the scenario is a GetChannelList frame, and dispatching every push sends nothing back', () => {
    for (const exchange of rdo.exchanges) {
      expect(exchange.request).not.toContain('GetChannelList');
      expect(exchange.response).not.toContain('GetChannelList');
    }

    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const exchange of rdo.exchanges) {
      const push = makePushCtx();
      dispatchPush(push.ctx, 'world', parsePush(exchange.response));
      // PushContext carries no send capability at all — `emit` is the only
      // channel a push handler can act through, and it only ever fires 'ws_event'.
      const channels = (push.ctx.emit as jest.Mock).mock.calls.map(([channel]) => channel as string);
      expect(channels.every(c => c === 'ws_event')).toBe(true);
    }
  });

  it('addresses every push at the client view id, carrying the changed channel and password', () => {
    const CLIENT_VIEW_ID = mergeVariables().clientViewId;
    for (const exchange of rdo.exchanges) {
      expect(exchange.response).toContain(CLIENT_VIEW_ID);
    }
    const inclusion = rdo.exchanges.find(e => e.id === 'channel-list-change-inclusion')!;
    expect(inclusion.response).toContain(CHANGED_CHANNEL);
    expect(inclusion.response).toContain(CHANGED_PASSWORD);
  });
});
