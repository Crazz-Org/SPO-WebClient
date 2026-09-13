/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * The L1 protocol scenario for following another player's camera, driven end to
 * end through the real halves: gateway emitter → mock → real push dispatcher →
 * real browser event handler.
 *
 * The reason this is one ordered flow rather than four isolated assertions is
 * that a chase is only real if all four legs line up. `Chase` going out
 * correctly proves nothing if the `MoveTo` the server answers with never
 * reaches `centerOn`; a badge that goes up on a refused chase is worse than no
 * badge at all. So the flow below starts a chase, pushes the server's own first
 * `MoveTo` through the dispatcher into the browser and asserts the camera
 * moved, then stops and asserts the badge cleared — and finally that the
 * server-side abort clears it too, and that a refusal never raises it.
 */

jest.mock('@/client/bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    addChatUser: jest.fn(),
    removeChatUser: jest.fn(),
    setChasedUser: jest.fn(),
  },
}));

import { RdoProtocol } from '@/server/rdo';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import { chaseUser as serverChaseUser, stopChase as serverStopChase } from '@/server/session/chat-handler';
import { dispatchPush } from '@/server/session/push-dispatcher';
import { makeSessionCtx, makePushCtx } from '@/server/__tests__/session/fake-session-context';
import { chaseUser as clientChaseUser, stopChase as clientStopChase } from '@/client/handlers/chat-handler';
import { dispatchEvent } from '@/client/handlers/event-handler';
import { ClientBridge } from '@/client/bridge/client-bridge';
import { useChatStore } from '@/client/store/chat-store';
import { useMapStore } from '@/client/store/map-store';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import type { IsometricMapRenderer } from '@/client/renderer/isometric-map-renderer';
import { WsMessageType } from '@/shared/types';
import type { WsMessage, RdoPacket } from '@/shared/types';
import { RdoMock } from '../rdo-mock';
import { mergeVariables } from './scenario-variables';
import {
  createChaseScenario,
  CHASED_USER,
  CHASE_MOVE_TO,
  chaseLeavePush,
} from './chase-scenario';

const CLIENT_VIEW_ID = mergeVariables().clientViewId;
const { rdo } = createChaseScenario();

/**
 * Parse a raw push frame the way the real socket reader hands it to the
 * dispatcher: quotes stripped, type prefix kept.
 */
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

/** The browser side: a ctx whose requests always succeed, with a spied camera. */
function makeClientDriver(reject?: Error) {
  const centerOn = jest.fn();
  const sendRequest = jest.fn(() =>
    reject ? Promise.reject(reject) : Promise.resolve({ type: WsMessageType.RESP_CHAT_SUCCESS }),
  );
  const ctx = {
    sendRequest,
    showNotification: jest.fn(),
    getRenderer: () => ({ centerOn }) as unknown as IsometricMapRenderer,
  } as unknown as ClientHandlerContext;
  return { ctx, sendRequest, centerOn };
}

beforeEach(() => {
  jest.clearAllMocks();
  useChatStore.setState({ chasedUser: null });
  useMapStore.getState().reset();
});

// ===========================================================================
// 1. The catalogue — both members are functions, so both frames carry "^"
// ===========================================================================

describe('chase scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('Chase takes one argument and StopChase none, both as functions', () => {
    expect(RDO_MEMBERS.Chase).toEqual({ kind: 'function', arity: 1 });
    expect(RDO_MEMBERS.StopChase).toEqual({ kind: 'function', arity: 0 });

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
// 2-4. The flow: start → MoveTo → stop
// ===========================================================================

describe('chase scenario — start, mirror, stop', () => {
  it('starts the chase: the gateway emits Chase, the browser raises the badge', async () => {
    const server = makeServerDriver();

    await expect(serverChaseUser(server.fake.ctx, CHASED_USER)).resolves.toBeUndefined();

    const [frame] = server.frames();
    expect(server.rdoMock.match(frame)!.exchange.id).toBe('chase-start');

    const { ctx } = makeClientDriver();
    await clientChaseUser(ctx, CHASED_USER);
    expect(ClientBridge.setChasedUser).toHaveBeenCalledWith(CHASED_USER);
  });

  it('mirrors the camera: the MoveTo push reaches centerOn with the followed coordinates', () => {
    const start = rdo.exchanges.find(e => e.id === 'chase-start')!;
    expect(start.pushes).toHaveLength(1);

    // Gateway half: the raw push becomes an EVENT_MOVE_TO.
    const push = makePushCtx();
    dispatchPush(push.ctx, 'world', parsePush(start.pushes![0]));

    const emitted = (push.ctx.emit as jest.Mock).mock.calls
      .filter(([channel]) => channel === 'ws_event')
      .map(([, event]) => event as WsMessage);
    const moveTo = emitted.find(e => e.type === WsMessageType.EVENT_MOVE_TO);
    expect(moveTo).toBeDefined();

    // Browser half: the event moves the camera.
    const { ctx, centerOn } = makeClientDriver();
    dispatchEvent(ctx, moveTo!);

    expect(centerOn).toHaveBeenCalledWith(CHASE_MOVE_TO.x, CHASE_MOVE_TO.y);

    const { history, historyIndex } = useMapStore.getState();
    expect(history[historyIndex]).toEqual({ x: CHASE_MOVE_TO.x, y: CHASE_MOVE_TO.y });
  });

  it('stops the chase: the gateway emits StopChase, the browser clears the badge', async () => {
    const server = makeServerDriver();

    await expect(serverStopChase(server.fake.ctx)).resolves.toBeUndefined();

    const [frame] = server.frames();
    expect(server.rdoMock.match(frame)!.exchange.id).toBe('chase-stop');

    const { ctx } = makeClientDriver();
    await clientStopChase(ctx);
    expect(ClientBridge.setChasedUser).toHaveBeenCalledWith(null);
  });
});

// ===========================================================================
// 5. The server-side abort — no frame of its own, only the user-list push
// ===========================================================================

describe('chase scenario — the server-side abort', () => {
  it('clears the badge when the followed player leaves the world', () => {
    useChatStore.setState({ chasedUser: CHASED_USER });

    const push = makePushCtx();
    dispatchPush(push.ctx, 'world', parsePush(chaseLeavePush(CLIENT_VIEW_ID)));

    const listChange = (push.ctx.emit as jest.Mock).mock.calls
      .filter(([channel]) => channel === 'ws_event')
      .map(([, event]) => event as WsMessage)
      .find(e => e.type === WsMessageType.EVENT_CHAT_USER_LIST_CHANGE);
    expect(listChange).toBeDefined();

    const { ctx } = makeClientDriver();
    dispatchEvent(ctx, listChange!);

    expect(ClientBridge.setChasedUser).toHaveBeenCalledWith(null);
  });
});

// ===========================================================================
// 6. A refusal raises no badge
// ===========================================================================

describe('chase scenario — a refused chase', () => {
  it('rejects on ERROR_InvalidUserName and never raises the badge', async () => {
    const refused = createChaseScenario(undefined, { chaseResult: 12 }).rdo;
    const server = makeServerDriver(refused);

    await expect(serverChaseUser(server.fake.ctx, CHASED_USER)).rejects.toThrow(
      `Cannot follow ${CHASED_USER}`,
    );
    expect(refused.exchanges.find(e => e.id === 'chase-start')!.pushes).toEqual([]);

    const { ctx } = makeClientDriver(new Error(`Cannot follow ${CHASED_USER}`));
    await clientChaseUser(ctx, CHASED_USER);
    expect(ClientBridge.setChasedUser).not.toHaveBeenCalled();
  });
});
