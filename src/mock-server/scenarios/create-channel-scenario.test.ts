/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * The L1 protocol scenario for creating a chat channel, driven end to end
 * through the real halves: gateway emitter → mock → real push dispatcher →
 * real browser event handler.
 *
 * Two things are being proved that nothing else can. First, **the five
 * arguments**: the two empty OLEStrings in the middle are the trap — drop them
 * and `anUserLimit` lands in `aSessionApp`'s slot, read as a widestring, with
 * no error and no reply difference. Second, **the join outcome**: a taken name
 * is not an error, the server falls through to `JoinChannel`
 * (`InterfaceServer.pas:1519-1525`) and answers `0` exactly as a creation does,
 * so the only wire evidence of which branch ran is the inclusion push
 * `ClientCreatedChannel` broadcasts (`:4588-4595`) — present on one exchange,
 * absent on the other.
 */

jest.mock('@/client/bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    addChatChannel: jest.fn(),
    removeChatChannel: jest.fn(),
  },
}));

import { RdoProtocol } from '@/server/rdo';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import { CHANNEL_USER_LIMIT } from '@/shared/chat-channel';
import { createChatChannel, ChannelCreateError } from '@/server/session/chat-handler';
import { handleChatCreateChannel } from '@/server/ws-handlers/chat-handlers';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import type { WebSocket } from 'ws';
import { ERROR_InvalidPassword, ERROR_NotEnoughRoom } from '@/shared/error-codes';
import { dispatchPush } from '@/server/session/push-dispatcher';
import { makeSessionCtx, makePushCtx } from '@/server/__tests__/session/fake-session-context';
import { dispatchEvent } from '@/client/handlers/event-handler';
import { ClientBridge } from '@/client/bridge/client-bridge';
import { useChatStore } from '@/client/store/chat-store';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import { WsMessageType } from '@/shared/types';
import type { WsMessage, RdoPacket } from '@/shared/types';
import { RdoMock } from '../rdo-mock';
import { mergeVariables } from './scenario-variables';
import {
  createCreateChannelScenario,
  FREE_CHANNEL,
  TAKEN_CHANNEL,
  CHANNEL_PASSWORD,
} from './create-channel-scenario';

const CLIENT_VIEW_ID = mergeVariables().clientViewId;
const { rdo } = createCreateChannelScenario();

/** Parse a raw push frame the way the real socket reader hands it to the dispatcher. */
function parsePush(frame: string): RdoPacket {
  return RdoProtocol.parse(frame) as RdoPacket;
}

/** Drive the gateway against the mock; anything unscripted fails loudly. */
function makeServerDriver(scenario = rdo) {
  const rdoMock = new RdoMock();
  rdoMock.addScenario(scenario);

  const fake = makeSessionCtx();
  fake.respond((packet) => {
    const frame = `${RdoProtocol.format(packet as never)};`;
    const hit = rdoMock.match(frame);
    return hit ? hit.response.replace(/^A\d+\s+/, '') : new Error(`L1: no exchange for ${frame}`);
  });

  const frames = () => fake.sent.map(s => `${RdoProtocol.format(s.packet as never)};`);
  return { fake, rdoMock, frames };
}

const clientCtx = {} as unknown as ClientHandlerContext;

beforeEach(() => {
  jest.clearAllMocks();
  useChatStore.setState({ channels: [] });
  // The bridge is stubbed so this file never drags the whole React bridge into
  // a node-environment suite; its one writer is wired back to the real store,
  // which is what the browser leg below actually asserts on.
  (ClientBridge.addChatChannel as jest.Mock).mockImplementation(
    (channel) => useChatStore.getState().addChannel(channel as string),
  );
});

// ===========================================================================
// 1. The catalogue — a function, so every frame carries "^"
// ===========================================================================

describe('create-channel scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('CreateChannel is a 5-argument function, and both frames carry "^"', () => {
    expect(RDO_MEMBERS.CreateChannel).toEqual({ kind: 'function', arity: 5 });

    for (const ex of rdo.exchanges) {
      expect(ex.request).toContain('"^"');
      expect(ex.request).not.toContain('"*"');
    }
  });

  it('matches each frame back to its own exchange — the arguments discriminate', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });
});

// ===========================================================================
// 2. The five arguments, in order and with the right types
// ===========================================================================

describe('create-channel scenario — the argument list', () => {
  it('sends (name, password, "", "", 100) — the two empties are NOT omitted', () => {
    const free = rdo.exchanges.find(e => e.id === 'create-channel-free')!;
    const args = free.matchKeys!.argsPattern!;

    expect(args).toHaveLength(5);
    expect(args).toEqual(['"%Traders"', '"%s3cret"', '"%"', '"%"', '"#100"']);

    // The matcher reads the value as the socket does — unquoted, prefix kept.
    const unquoted = args.map(a => a.replace(/^"|"$/g, ''));
    expect(unquoted[0]).toHaveRdoTypePrefix('%');  // ChannelName   : widestring
    expect(unquoted[1]).toHaveRdoTypePrefix('%');  // Password      : widestring
    expect(unquoted[2]).toHaveRdoTypePrefix('%');  // aSessionApp   : widestring — EMPTY, not omitted
    expect(unquoted[3]).toHaveRdoTypePrefix('%');  // aSessionAppId : widestring — EMPTY, not omitted
    expect(unquoted[4]).toHaveRdoTypePrefix('#');  // anUserLimit   : integer

    expect(args[4]).toBe(`"#${CHANNEL_USER_LIMIT}"`);
  });

  it('carries the taken name in the same five slots', () => {
    const taken = rdo.exchanges.find(e => e.id === 'create-channel-taken')!;
    expect(taken.matchKeys!.argsPattern).toEqual(
      ['"%Podan Merchants"', '"%s3cret"', '"%"', '"%"', '"#100"'],
    );
  });
});

// ===========================================================================
// 3. A free name: created, and the inclusion push reaches the browser list
// ===========================================================================

describe('create-channel scenario — a free name', () => {
  it('the gateway emits CreateChannel and stands in the new channel', async () => {
    const server = makeServerDriver();

    await expect(createChatChannel(server.fake.ctx, FREE_CHANNEL, CHANNEL_PASSWORD))
      .resolves.toBeUndefined();

    const [frame] = server.frames();
    const hit = server.rdoMock.match(frame)!;
    expect(hit.exchange.id).toBe('create-channel-free');
    // The fixture request is byte-for-byte the frame production emitted.
    expect(frame).toBe(hit.exchange.request);
    expect(server.fake.ctx.setCurrentChannel).toHaveBeenCalledWith(FREE_CHANNEL);
  });

  it('the inclusion push reaches every player\'s channel list', () => {
    const free = rdo.exchanges.find(e => e.id === 'create-channel-free')!;
    expect(free.pushes).toHaveLength(1);

    // Gateway half: the raw broadcast becomes an EVENT_CHANNEL_LIST_CHANGE.
    const push = makePushCtx();
    dispatchPush(push.ctx, 'world', parsePush(free.pushes![0]));

    const listChange = (push.ctx.emit as jest.Mock).mock.calls
      .filter(([channel]) => channel === 'ws_event')
      .map(([, event]) => event as WsMessage)
      .find(e => e.type === WsMessageType.EVENT_CHANNEL_LIST_CHANGE);
    expect(listChange).toEqual({
      type: WsMessageType.EVENT_CHANNEL_LIST_CHANGE,
      name: FREE_CHANNEL,
      password: CHANNEL_PASSWORD,
      change: 0,
    });

    // Browser half: the event inserts the channel into the list.
    dispatchEvent(clientCtx, listChange!);
    expect(useChatStore.getState().channels.map((c) => c.name)).toContain(FREE_CHANNEL);
  });

  it('addresses the push at the same ClientView the calls target', () => {
    const free = rdo.exchanges.find(e => e.id === 'create-channel-free')!;
    expect(free.pushes![0]).toContain(CLIENT_VIEW_ID);
  });
});

// ===========================================================================
// 4. A taken name: joined, not refused — and no push to show for it
// ===========================================================================

describe('create-channel scenario — a taken name', () => {
  it('resolves and stands in the channel: the server joined it (InterfaceServer.pas:1523)', async () => {
    const server = makeServerDriver();

    await expect(createChatChannel(server.fake.ctx, TAKEN_CHANNEL, CHANNEL_PASSWORD))
      .resolves.toBeUndefined();

    const [frame] = server.frames();
    const hit = server.rdoMock.match(frame)!;
    expect(hit.exchange.id).toBe('create-channel-taken');
    // The fixture request is byte-for-byte the frame production emitted.
    expect(frame).toBe(hit.exchange.request);
    expect(server.fake.ctx.setCurrentChannel).toHaveBeenCalledWith(TAKEN_CHANNEL);
  });

  it('carries no inclusion push — ClientCreatedChannel was never reached (:1519-1525, :4588-4595)', () => {
    const taken = rdo.exchanges.find(e => e.id === 'create-channel-taken')!;
    expect(taken.pushes ?? []).toEqual([]);
  });
});

// ===========================================================================
// 5. The two refusals, both reachable only through the JoinChannel fall-through
// ===========================================================================

describe('create-channel scenario — refusals', () => {
  it('ERROR_InvalidPassword rejects and never moves the player', async () => {
    const refused = createCreateChannelScenario(undefined, { takenResult: 13 }).rdo;
    const server = makeServerDriver(refused);

    await expect(createChatChannel(server.fake.ctx, TAKEN_CHANNEL, CHANNEL_PASSWORD))
      .rejects.toThrow(/password/);
    expect(server.fake.ctx.setCurrentChannel).not.toHaveBeenCalled();
  });

  it('ERROR_NotEnoughRoom rejects as a full channel', async () => {
    const full = createCreateChannelScenario(undefined, { takenResult: 32 }).rdo;
    const server = makeServerDriver(full);

    await expect(createChatChannel(server.fake.ctx, TAKEN_CHANNEL, CHANNEL_PASSWORD))
      .rejects.toThrow(/full/);
    expect(server.fake.ctx.setCurrentChannel).not.toHaveBeenCalled();
  });

  it.each([
    [13, ERROR_InvalidPassword],
    [32, ERROR_NotEnoughRoom],
  ])('takenResult %i rejects with a ChannelCreateError carrying that code', async (takenResult, code) => {
    const server = makeServerDriver(createCreateChannelScenario(undefined, { takenResult }).rdo);

    const caught = await createChatChannel(server.fake.ctx, TAKEN_CHANNEL, CHANNEL_PASSWORD)
      .catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ChannelCreateError);
    expect((caught as ChannelCreateError).code).toBe(code);
  });

  it('the ws handler answers the refusal with RESP_ERROR carrying the code and the sentence', async () => {
    const server = makeServerDriver(createCreateChannelScenario(undefined, { takenResult: 13 }).rdo);
    const sent: Array<Record<string, unknown>> = [];
    const ws = {
      send(payload: string): void {
        sent.push(JSON.parse(payload) as Record<string, unknown>);
      },
    } as unknown as WebSocket;
    const ctx = {
      ws,
      session: {
        createChatChannel: (n: string, p: string) => createChatChannel(server.fake.ctx, n, p),
      },
    } as unknown as WsHandlerContext;

    await handleChatCreateChannel(ctx, {
      type: WsMessageType.REQ_CHAT_CREATE_CHANNEL,
      wsRequestId: '7',
      channelName: TAKEN_CHANNEL,
      password: CHANNEL_PASSWORD,
    } as unknown as WsMessage);

    expect(sent).toEqual([{
      type: WsMessageType.RESP_ERROR,
      wsRequestId: '7',
      errorMessage: 'Channel "Podan Merchants" already exists and its password does not match',
      code: 13,
    }]);
  });
});
