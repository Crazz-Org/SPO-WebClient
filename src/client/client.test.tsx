/**
 * StarpeaceClient — the one-line callback wiring in the constructor.
 *
 * `client.ts`'s constructor builds a huge `Partial<ClientCallbacks>` object literal,
 * one arrow function per `onXxx` handler; no test in this codebase has ever
 * instantiated the class, because doing so also opens a real WebSocket and starts
 * polling `/api/startup-status`. This file exists ONLY to prove `onGetChannelInfo`
 * reaches `chatHandler.requestChannelInfo` with the right arguments -- the same
 * shape every other `onXxx` wiring line already has, just never previously exercised.
 *
 * `WebSocket`/`EventSource` are stubbed so the constructor's `init()` does not throw
 * in jsdom (neither exists there); nothing about the stubs is asserted on.
 */

jest.mock('./handlers/chat-handler');
jest.mock('./handlers/building-action-handler', () => ({
  ...(jest.requireActual('./handlers/building-action-handler') as object),
  setBuildingProperty: jest.fn(),
  refreshAfterConnectionChange: jest.fn(),
}));
jest.mock('./handlers/auth-handler', () => {
  const actual = jest.requireActual('./handlers/auth-handler') as typeof import('./handlers/auth-handler');
  return {
    ...actual,
    visitWorld: jest.fn(),
    // Pass-through by default; the issue-1076 block overrides it per test and puts it back.
    login: jest.fn((...args: Parameters<typeof actual.login>) => actual.login(...args)),
  };
});

import { StarpeaceClient } from './client';
import * as chatHandler from './handlers/chat-handler';
import * as authHandler from './handlers/auth-handler';
import * as buildingActionHandler from './handlers/building-action-handler';
import { WsMessageType, SurfaceType, type WsMessage } from '../shared/types';
import { useGameStore } from './store/game-store';
import { useUiStore } from './store/ui-store';
import { ClientBridge } from './bridge/client-bridge';
import { GATEWAY_UNREACHABLE_MESSAGE, getReconnectDelay, MAX_RECONNECT_ATTEMPTS } from './handlers/reconnect-utils';
import { REQUEST_TIMEOUT_MESSAGE, NOT_CONNECTED_MESSAGE } from './player-error';
import { useBuildingStore } from './store/building-store';
import { RESUME_TOKEN_KEY } from './store/resume-token';
import * as ErrorCodes from '../shared/error-codes';
import type { SpoDebugState } from './client';
import { DEBUG_MARKERS } from './debug-markers';
import { config } from '../shared/config';
import { useChatStore, type ChatMessage } from './store/chat-store';
import { useProfileStore } from './store/profile-store';
import { useSearchStore } from './store/search-store';
import { useMailStore } from './store/mail-store';
import { useTutorialStore } from './store/tutorial-store';

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: ((e?: { code: number }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  send(): void { /* no-op */ }
  close(): void { /* no-op */ }
}

class FakeEventSource {
  onerror: (() => void) | null = null;
  addEventListener(): void { /* no-op */ }
  close(): void { /* no-op */ }
}

describe('StarpeaceClient callback wiring', () => {
  let client: StarpeaceClient;

  beforeEach(() => {
    document.body.innerHTML = '<div id="game-panel"></div>';
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    client = new StarpeaceClient();
  });

  it('still exposes window.__spoDebug with its getState reader (E2E instrumentation)', () => {
    const w = window as unknown as Record<string, unknown>;
    expect(w.__spoDebug).toBeDefined();
    expect(typeof (w.__spoDebug as { getState: unknown }).getState).toBe('function');
  });

  it('onGetChannelInfo forwards to chatHandler.requestChannelInfo with the client and the channel name', () => {
    client.callbacks.onGetChannelInfo('Trade');

    expect(chatHandler.requestChannelInfo).toHaveBeenCalledWith(client, 'Trade');
  });

  it('onChaseUser forwards to chatHandler.chaseUser with the client and the followed name', () => {
    client.callbacks.onChaseUser('Mayor of Podan');

    expect(chatHandler.chaseUser).toHaveBeenCalledWith(client, 'Mayor of Podan');
  });

  it('onSetSeason forwards to the renderer\'s setSeason', () => {
    const setSeason = jest.fn();
    (client as unknown as { mapNavigationUI: unknown }).mapNavigationUI = {
      getRenderer: () => ({ setSeason }),
    };

    client.callbacks.onSetSeason(3);

    expect(setSeason).toHaveBeenCalledWith(3);
  });

  it('onSetSeason does not throw when there is no renderer yet', () => {
    (client as unknown as { mapNavigationUI: unknown }).mapNavigationUI = null;

    expect(() => client.callbacks.onSetSeason(1)).not.toThrow();
  });

  it('onStopChase forwards to chatHandler.stopChase with the client alone', () => {
    client.callbacks.onStopChase();

    expect(chatHandler.stopChase).toHaveBeenCalledWith(client);
  });

  it('onJoinChannel forwards to chatHandler.joinChannel with the client, channel name and password', () => {
    client.callbacks.onJoinChannel('Boardroom', 'hunter2');

    expect(chatHandler.joinChannel).toHaveBeenCalledWith(client, 'Boardroom', 'hunter2', undefined);
  });

  it('onJoinChannel forwards an undefined password unchanged when none is given', () => {
    client.callbacks.onJoinChannel('Lobby');

    expect(chatHandler.joinChannel).toHaveBeenCalledWith(client, 'Lobby', undefined, undefined);
  });

  it('onProfileCompanyProfitLoss sends REQ_PROFILE_COMPANY_PROFITLOSS with the company name and cluster', () => {
    const sendSpy = jest.spyOn(client, 'sendMessage' as any);

    client.callbacks.onProfileCompanyProfitLoss('Green Co', 'A');

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REQ_PROFILE_COMPANY_PROFITLOSS',
        companyName: 'Green Co',
        cluster: 'A',
      })
    );
  });

  it('onProfileUploadPicture sends REQ_PROFILE_UPLOAD_PICTURE with the base64 payload', () => {
    const sendSpy = jest.spyOn(client, 'sendMessage' as any);

    client.callbacks.onProfileUploadPicture('ZmFrZS1qcGVn');

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REQ_PROFILE_UPLOAD_PICTURE',
        pictureBase64: 'ZmFrZS1qcGVn',
      })
    );
  });

  it('onVisitWorld forwards to authHandler.visitWorld with the client', () => {
    client.callbacks.onVisitWorld();

    expect(authHandler.visitWorld).toHaveBeenCalledWith(client);
  });

  it('onTutorialState asks for the assignment with no arguments of its own', () => {
    const sendSpy = jest.spyOn(client, 'sendMessage' as any);

    client.callbacks.onTutorialState();

    expect(sendSpy).toHaveBeenCalledWith({ type: WsMessageType.REQ_TUTORIAL_STATE });
  });

  it('onTutorialAction carries the action through untouched', () => {
    const sendSpy = jest.spyOn(client, 'sendMessage' as any);

    client.callbacks.onTutorialAction('complete');

    expect(sendSpy).toHaveBeenCalledWith({
      type: WsMessageType.REQ_TUTORIAL_ACTION, action: 'complete',
    });
  });
});

/**
 * #563 — a selection of any size leaves as ONE frame. The pairs are joined into
 * the single `ParseGateList` string the server splits back apart
 * (`Kernel/Kernel0.pas:4157-4180`), trailing comma included, exactly as the
 * reference client built it (`Voyager/SupplySheetForm.pas:889-908`).
 */
describe('StarpeaceClient onDisconnectConnection', () => {
  let client: StarpeaceClient;
  const setProp = buildingActionHandler.setBuildingProperty as jest.MockedFunction<
    typeof buildingActionHandler.setBuildingProperty
  >;

  beforeEach(() => {
    document.body.innerHTML = '<div id="game-panel"></div>';
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    jest.clearAllMocks();
    setProp.mockResolvedValue(true);
    client = new StarpeaceClient();
  });

  it('joins every selected pair into one connectionList, in one call', async () => {
    const notify = jest.spyOn(client, 'showNotification');

    client.callbacks.onDisconnectConnection(50, 60, 'Plastics', 'input', [
      { x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(setProp).toHaveBeenCalledTimes(1);
    expect(setProp).toHaveBeenCalledWith(
      client, 50, 60, 'RDODisconnectInput', '0',
      { fluidId: 'Plastics', connectionList: '10,20,30,40,50,60,' },
      expect.any(String),
    );
    expect(notify).toHaveBeenCalledWith('3 suppliers disconnected', 'success');
    expect(buildingActionHandler.refreshAfterConnectionChange).toHaveBeenCalledWith(client, 50, 60);
  });

  it('keeps the singular wording, and the output member, for one row', async () => {
    const notify = jest.spyOn(client, 'showNotification');

    client.callbacks.onDisconnectConnection(50, 60, 'Plastics', 'output', [{ x: 7, y: 8 }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(setProp).toHaveBeenCalledWith(
      client, 50, 60, 'RDODisconnectOutput', '0',
      { fluidId: 'Plastics', connectionList: '7,8,' },
      expect.any(String),
    );
    expect(notify).toHaveBeenCalledWith('Client disconnected', 'success');
  });

  it('says so when several buyers go', async () => {
    const notify = jest.spyOn(client, 'showNotification');

    client.callbacks.onDisconnectConnection(50, 60, 'Plastics', 'output', [{ x: 7, y: 8 }, { x: 9, y: 10 }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(notify).toHaveBeenCalledWith('2 clients disconnected', 'success');
  });

  it('sends nothing at all for an empty selection', () => {
    client.callbacks.onDisconnectConnection(50, 60, 'Plastics', 'input', []);

    expect(setProp).not.toHaveBeenCalled();
  });

  it('reports a failure as an error notification', async () => {
    setProp.mockRejectedValue(new Error('socket gone'));
    const notify = jest.spyOn(client, 'showNotification');

    client.callbacks.onDisconnectConnection(50, 60, 'Plastics', 'input', [{ x: 1, y: 2 }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(notify).toHaveBeenCalledWith('Could not disconnect these connections — something went wrong. Try again.', 'error');
  });
});

/**
 * #532 — a RESP_ERROR answering a pending request carries the gateway's own
 * sentence. The rejection keeps the table-derived `message` (every existing flow
 * prints it) and gains `serverMessage`, which only the auth check reads.
 */
describe('RESP_ERROR on a pending request', () => {
  let client: StarpeaceClient;

  beforeEach(() => {
    document.body.innerHTML = '<div id="game-panel"></div>';
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    client = new StarpeaceClient();
  });

  it('rejects with the gateway sentence alongside the code and the table message', async () => {
    (client as unknown as { isConnected: boolean }).isConnected = true;

    const req = { type: WsMessageType.REQ_AUTH_CHECK } as unknown as WsMessage;
    const pending = client.sendRequest(req, 5000);
    const wsRequestId = req.wsRequestId;
    expect(wsRequestId).toBeTruthy();

    (client as unknown as { handleMessage(m: WsMessage): void }).handleMessage({
      type: WsMessageType.RESP_ERROR,
      wsRequestId,
      errorMessage: 'gateway sentence',
      code: 7,
    } as unknown as WsMessage);

    await expect(pending).rejects.toMatchObject({
      code: 7,
      message: 'Unknown tycoon',
      serverMessage: 'gateway sentence',
    });
  });

  it('rejects with the shared constants on a missed deadline and on a closed socket', async () => {
    jest.useFakeTimers();
    try {
      (client as unknown as { isConnected: boolean }).isConnected = true;
      const pending = client.sendRequest({ type: WsMessageType.REQ_AUTH_CHECK } as unknown as WsMessage, 5000);
      jest.advanceTimersByTime(5000);
      await expect(pending).rejects.toThrow(REQUEST_TIMEOUT_MESSAGE);

      (client as unknown as { isConnected: boolean }).isConnected = false;
      await expect(
        client.sendRequest({ type: WsMessageType.REQ_AUTH_CHECK } as unknown as WsMessage),
      ).rejects.toThrow(NOT_CONNECTED_MESSAGE);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Mail body splitting', () => {
  let client: StarpeaceClient;

  beforeEach(() => {
    document.body.innerHTML = '<div id="game-panel"></div>';
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    client = new StarpeaceClient();
  });

  describe('onMailSend', () => {
    it('splits multi-line body on newlines', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSend('recipient@test.com', 'Subject', 'line1\nline2\nline3');

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: ['line1', 'line2', 'line3'],
        })
      );
    });

    it('handles single-line body correctly', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSend('recipient@test.com', 'Subject', 'single line');

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: ['single line'],
        })
      );
    });

    it('preserves empty lines in multi-line body', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSend('recipient@test.com', 'Subject', 'line1\n\nline3');

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: ['line1', '', 'line3'],
        })
      );
    });

    it('handles body with trailing newline', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSend('recipient@test.com', 'Subject', 'line1\nline2\n');

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: ['line1', 'line2', ''],
        })
      );
    });

    // #507 — a reply's threading headers had no way out of the browser.
    it('carries the reply headers when there are any', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSend('recipient@test.com', 'Re: Subject', '> quoted', 'In-Reply-To=msg-1\nIn-Reply-To-From=alice');

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: 'In-Reply-To=msg-1\nIn-Reply-To-From=alice',
        })
      );
    });

    it('omits the key entirely for a letter with nothing to thread', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSend('recipient@test.com', 'Subject', 'plain', '');

      const msg = sendSpy.mock.calls[0][0] as Record<string, unknown>;
      expect('headers' in msg).toBe(false);

      client.callbacks.onMailSend('recipient@test.com', 'Subject', 'plain');
      expect('headers' in (sendSpy.mock.calls[1][0] as Record<string, unknown>)).toBe(false);
    });

    // #510 — sending a letter opened from Drafts must remove the draft copy.
    it('carries the draft id when sending an opened draft', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSend('recipient@test.com', 'Subject', 'plain', undefined, 'draft-456');

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          existingDraftId: 'draft-456',
        })
      );
    });

    it('omits existingDraftId for a fresh letter', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSend('recipient@test.com', 'Subject', 'plain', undefined, '');
      expect('existingDraftId' in (sendSpy.mock.calls[0][0] as Record<string, unknown>)).toBe(false);

      client.callbacks.onMailSend('recipient@test.com', 'Subject', 'plain');
      expect('existingDraftId' in (sendSpy.mock.calls[1][0] as Record<string, unknown>)).toBe(false);
    });
  });

  describe('onMailSaveDraft', () => {
    it('splits multi-line body on newlines', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSaveDraft(
        'recipient@test.com',
        'Subject',
        'line1\nline2\nline3',
        undefined,
        undefined
      );

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: ['line1', 'line2', 'line3'],
        })
      );
    });

    it('handles single-line body correctly', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSaveDraft(
        'recipient@test.com',
        'Subject',
        'single line',
        undefined,
        'draft-123'
      );

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: ['single line'],
        })
      );
    });

    it('preserves empty lines in multi-line body', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSaveDraft(
        'recipient@test.com',
        'Subject',
        'line1\n\nline3',
        undefined,
        undefined
      );

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: ['line1', '', 'line3'],
        })
      );
    });

    it('handles body with multiple consecutive empty lines', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSaveDraft(
        'recipient@test.com',
        'Subject',
        'line1\n\n\nline4',
        undefined,
        undefined
      );

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: ['line1', '', '', 'line4'],
        })
      );
    });

    it('includes optional headers when provided', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      const headers = 'Custom headers';
      client.callbacks.onMailSaveDraft(
        'recipient@test.com',
        'Subject',
        'test body',
        headers,
        undefined
      );

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: ['test body'],
          headers,
        })
      );
    });

    it('includes existing draft ID when provided', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSaveDraft(
        'recipient@test.com',
        'Subject',
        'test body',
        undefined,
        'draft-456'
      );

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: ['test body'],
          existingDraftId: 'draft-456',
        })
      );
    });

    it('omits headers when not provided', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSaveDraft(
        'recipient@test.com',
        'Subject',
        'test body',
        undefined,
        undefined
      );

      const call = sendSpy.mock.calls[0][0] as Record<string, unknown>;
      expect('headers' in call).toBe(false);
    });

    it('omits existing draft ID when not provided', () => {
      const sendSpy = jest.spyOn(client, 'sendMessage' as any);
      client.callbacks.onMailSaveDraft(
        'recipient@test.com',
        'Subject',
        'test body',
        undefined,
        undefined
      );

      const call = sendSpy.mock.calls[0][0] as Record<string, unknown>;
      expect('existingDraftId' in call).toBe(false);
    });
  });
});

describe('close code 1012 — gateway restarting', () => {
  let client: StarpeaceClient;
  type Internals = { ws: FakeSocket; storedUsername: string | null; storedPassword: string | null; currentWorldName: string };
  const internals = () => client as unknown as Internals;

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<div id="game-panel"></div>';
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    client = new StarpeaceClient();
    useGameStore.setState({ status: 'connected', serverRestarting: false, companyId: 'C1' });
    internals().storedUsername = 'u';
    internals().storedPassword = 'p';
    internals().currentWorldName = 'planitia';
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('a close with 1012 sets the restart cause and enters reconnecting', () => {
    internals().ws.onclose?.({ code: 1012 });
    expect(useGameStore.getState().status).toBe('reconnecting');
    expect(useGameStore.getState().serverRestarting).toBe(true);
  });

  it('a later 1006 on a reconnect socket keeps the cause', () => {
    const first = internals().ws;
    first.onclose?.({ code: 1012 });
    jest.advanceTimersByTime(60_000);
    const second = internals().ws;
    expect(second).not.toBe(first);
    second.onclose?.({ code: 1006 });
    expect(useGameStore.getState().status).toBe('reconnecting');
    expect(useGameStore.getState().serverRestarting).toBe(true);
  });

  it('a 1012 on a reconnect socket also sets the cause', () => {
    internals().ws.onclose?.({ code: 1006 });
    jest.advanceTimersByTime(60_000);
    internals().ws.onclose?.({ code: 1012 });
    expect(useGameStore.getState().serverRestarting).toBe(true);
  });

  it('reaching connected clears the cause', () => {
    internals().ws.onclose?.({ code: 1012 });
    ClientBridge.setConnected();
    expect(useGameStore.getState().serverRestarting).toBe(false);
  });

  it.each([1000, 1001, 1006])('a close with %i leaves the cause unset', (code) => {
    internals().ws.onclose?.({ code });
    expect(useGameStore.getState().status).toBe('reconnecting');
    expect(useGameStore.getState().serverRestarting).toBe(false);
  });

  it('a 1012 with no stored credentials does not set the cause', () => {
    internals().storedUsername = null;
    internals().storedPassword = null;
    internals().ws.onclose?.({ code: 1012 });
    expect(useGameStore.getState().status).toBe('disconnected');
    expect(useGameStore.getState().serverRestarting).toBe(false);
  });
});

/**
 * #1042 — a logout must land on a fresh login screen, never on a reconnect. The gateway answers
 * RESP_LOGOUT first and closes the socket 100 ms later (`handleLogout`); the close used to fall
 * through to the dropped-connection branch and replay login + company selection.
 */
describe('logout (issue 1042)', () => {
  const sockets: TrackedSocket[] = [];

  class TrackedSocket extends FakeSocket {
    sent: string[] = [];
    override close = jest.fn();
    constructor() {
      super();
      sockets.push(this);
    }
    override send(payload?: string): void {
      if (payload !== undefined) this.sent.push(payload);
    }
  }

  type Internals = {
    ws: TrackedSocket;
    isConnected: boolean;
    storedUsername: string;
    storedPassword: string;
    currentWorldName: string;
    reconnectAttempt: number;
  };
  let client: StarpeaceClient;
  let reload: jest.Mock;
  const internals = () => client as unknown as Internals;

  const frames = (): Array<{ type: string; wsRequestId?: string }> =>
    sockets.flatMap((s) => s.sent.map((p) => JSON.parse(p) as { type: string; wsRequestId?: string }));
  const framesOf = (type: string) => frames().filter((f) => f.type === type);

  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  const answerLogout = async (success: boolean) => {
    const logoutFrames = framesOf(WsMessageType.REQ_LOGOUT);
    const wsRequestId = logoutFrames[logoutFrames.length - 1].wsRequestId;
    (client as unknown as { handleMessage(m: WsMessage): void }).handleMessage({
      type: WsMessageType.RESP_LOGOUT,
      wsRequestId,
      success,
    } as unknown as WsMessage);
    await flush();
  };

  const expectNoReconnect = () => {
    jest.advanceTimersByTime(60_000);
    expect(framesOf(WsMessageType.REQ_LOGIN_WORLD)).toHaveLength(0);
    expect(framesOf(WsMessageType.REQ_SELECT_COMPANY)).toHaveLength(0);
    expect(internals().reconnectAttempt).toBe(0);
    expect(useGameStore.getState().reconnectAttempt).toBe(0);
    expect(internals().storedUsername).toBe('');
    expect(internals().storedPassword).toBe('');
    expect(useGameStore.getState().status).toBe('disconnected');
  };

  beforeEach(() => {
    jest.useFakeTimers();
    sockets.length = 0;
    document.body.innerHTML = '<div id="game-panel"></div>';
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = TrackedSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    client = new StarpeaceClient();
    reload = jest.fn();
    client.reloadPage = reload;
    internals().ws.onopen?.();
    useGameStore.setState({ status: 'connected', companyId: 'C1', serverRestarting: false, reconnectAttempt: 0 });
    internals().storedUsername = 'u';
    internals().storedPassword = 'p';
    internals().currentWorldName = 'planitia';
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('success: the gateway close after the answer reloads once and never reconnects', async () => {
    const ws = internals().ws;
    client.callbacks.onLogout();
    await answerLogout(true);

    expect(ws.close).toHaveBeenCalledWith(1000, expect.any(String));
    expect(reload).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    ws.onclose?.({ code: 1000 });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
    expectNoReconnect();
    expect(sockets).toHaveLength(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('refusal: the client closes the socket itself and reloads once', async () => {
    const ws = internals().ws;
    client.callbacks.onLogout();
    await answerLogout(false);

    expect(ws.close).toHaveBeenCalledWith(1000, expect.any(String));
    expect(reload).not.toHaveBeenCalled();

    ws.onclose?.({ code: 1000 });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
    expectNoReconnect();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a close before the answer reloads once, and the rejected request adds no second reload', async () => {
    const ws = internals().ws;
    client.callbacks.onLogout();
    await flush();

    ws.onclose?.({ code: 1000 });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);

    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(ws.close).not.toHaveBeenCalled();
    expectNoReconnect();
    expect(sockets).toHaveLength(1);
  });

  it('logging out from a reconnect socket reloads once and opens no third socket', async () => {
    internals().ws.onclose?.({ code: 1006 });
    expect(useGameStore.getState().status).toBe('reconnecting');
    jest.advanceTimersByTime(5_000);
    expect(sockets).toHaveLength(2);

    const second = internals().ws;
    // The reconnect socket opens (resetting the attempt counter) and replays login; drop
    // those replay frames so only what follows the logout is judged.
    second.onopen?.();
    await flush();
    second.sent.length = 0;
    useGameStore.setState({ status: 'connected' });

    client.callbacks.onLogout();
    await answerLogout(true);
    expect(second.close).toHaveBeenCalledWith(1000, expect.any(String));
    expect(reload).not.toHaveBeenCalled();

    second.onclose?.({ code: 1000 });
    expect(reload).toHaveBeenCalledTimes(1);
    expectNoReconnect();
    expect(sockets).toHaveLength(2);
  });

  it('with no socket at all, the refused request reloads directly', async () => {
    internals().isConnected = false;
    const ws = internals().ws;

    client.callbacks.onLogout();
    await flush();

    expect(framesOf(WsMessageType.REQ_LOGOUT)).toHaveLength(0);
    expect(ws.close).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a second onLogout while one is in flight sends a single REQ_LOGOUT', async () => {
    client.callbacks.onLogout();
    client.callbacks.onLogout();
    await flush();
    expect(framesOf(WsMessageType.REQ_LOGOUT)).toHaveLength(1);
  });

  it('no double logout: beforeunload after a completed logout sends nothing, remembered session kept', async () => {
    const remembered = {
      username: 'u', zonePath: '', worldName: 'planitia', companyId: 'C1', companyName: 'Co',
    };
    useGameStore.setState({ rememberedSession: remembered });
    const ws = internals().ws;

    client.callbacks.onLogout();
    await answerLogout(true);
    ws.onclose?.({ code: 1000 });

    window.dispatchEvent(new Event('beforeunload'));

    expect(framesOf(WsMessageType.REQ_LOGOUT)).toHaveLength(1);
    expect(useGameStore.getState().rememberedSession).toEqual(remembered);
  });

  it('an unexpected close with no logout still reconnects, from the first and from a reconnect socket', () => {
    internals().ws.onclose?.({ code: 1006 });
    expect(useGameStore.getState().status).toBe('reconnecting');
    jest.advanceTimersByTime(5_000);
    expect(sockets).toHaveLength(2);

    internals().ws.onclose?.({ code: 1006 });
    expect(useGameStore.getState().status).toBe('reconnecting');
    jest.advanceTimersByTime(60_000);
    expect(sockets.length).toBeGreaterThan(2);
    expect(reload).not.toHaveBeenCalled();
  });
});

/**
 * #1043 — the page-lifecycle listeners are added once, at page start, and survive every dropped
 * socket. Earlier describes leave their own clients' listeners on the shared jsdom document, so
 * every assertion is on THIS client's own socket identity, never on a global count.
 */
describe('page lifecycle listeners (issue 1043)', () => {
  const sockets: LifecycleSocket[] = [];

  class LifecycleSocket extends FakeSocket {
    sent: string[] = [];
    constructor() {
      super();
      sockets.push(this);
    }
    override send(payload?: string): void {
      if (payload !== undefined) this.sent.push(payload);
    }
  }

  type Internals = {
    ws: LifecycleSocket;
    storedUsername: string;
    storedPassword: string;
    currentWorldName: string;
    viewportHeartbeatTimer: unknown;
  };
  let client: StarpeaceClient;
  let hidden = false;
  const internals = () => client as unknown as Internals;

  const logoutFrames = () =>
    sockets
      .flatMap((s) => s.sent.map((p) => JSON.parse(p) as { type: string }))
      .filter((f) => f.type === WsMessageType.REQ_LOGOUT);

  const dropAndWait = () => {
    const before = internals().ws;
    before.onclose?.({ code: 1006 });
    jest.advanceTimersByTime(60_000);
    expect(internals().ws).not.toBe(before);
  };

  /** Three drops; the third leaves the client 'reconnecting' with a backoff pending. */
  const threeDrops = () => {
    dropAndWait();
    dropAndWait();
    internals().ws.onclose?.({ code: 1006 });
    expect(useGameStore.getState().status).toBe('reconnecting');
  };

  const pageshow = (persisted: boolean) => {
    const e = new Event('pageshow');
    Object.defineProperty(e, 'persisted', { value: persisted });
    window.dispatchEvent(e);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    sockets.length = 0;
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.body.innerHTML = '<div id="game-panel"></div>';
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = LifecycleSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    client = new StarpeaceClient();
    client.reloadPage = jest.fn();
    internals().ws.onopen?.();
    useGameStore.setState({ status: 'connected', companyId: 'C1', serverRestarting: false, reconnectAttempt: 0 });
    internals().storedUsername = 'u';
    internals().storedPassword = 'p';
    internals().currentWorldName = 'planitia';
  });

  afterEach(() => {
    delete (document as unknown as { hidden?: boolean }).hidden;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('regression: after three drops, returning to the tab reconnects at once', () => {
    threeDrops();
    const before = internals().ws;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(internals().ws).not.toBe(before);
  });

  it('a persisted pageshow reconnects at once; a fresh one does not', () => {
    threeDrops();
    const before = internals().ws;
    pageshow(false);
    expect(internals().ws).toBe(before);
    pageshow(true);
    expect(internals().ws).not.toBe(before);
  });

  it('a resume reconnects at once', () => {
    threeDrops();
    const before = internals().ws;
    document.dispatchEvent(new Event('resume'));
    expect(internals().ws).not.toBe(before);
  });

  it('no immediate reconnect without stored credentials', () => {
    threeDrops();
    const before = internals().ws;
    internals().storedUsername = '';
    document.dispatchEvent(new Event('resume'));
    expect(internals().ws).toBe(before);
    expect(useGameStore.getState().status).toBe('reconnecting');
  });

  it('after a reconnect, hiding the tab stops the heartbeat and showing it restarts it', () => {
    dropAndWait();
    internals().ws.onopen?.();
    useGameStore.setState({ status: 'connected' });

    document.dispatchEvent(new Event('visibilitychange'));
    expect(internals().viewportHeartbeatTimer).not.toBeNull();

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(internals().viewportHeartbeatTimer).toBeNull();

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(internals().viewportHeartbeatTimer).not.toBeNull();
  });

  it('beforeunload and pagehide send no REQ_LOGOUT; the Logout button still does', async () => {
    window.dispatchEvent(new Event('beforeunload'));
    window.dispatchEvent(new Event('pagehide'));
    expect(logoutFrames()).toHaveLength(0);

    client.callbacks.onLogout();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(logoutFrames()).toHaveLength(1);
  });

  it('while connected, no lifecycle event opens a second socket', () => {
    const before = internals().ws;
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('resume'));
    pageshow(true);
    expect(internals().ws).toBe(before);
  });
});

/**
 * #1048 — the startup status stream is reopened after an error (the old fetch fallback could
 * never parse the SSE body), and 60 s without an open stream shows the unreachable state.
 */
describe('startup status stream (issue 1048)', () => {
  const sources: ControlledEventSource[] = [];

  class ControlledEventSource extends FakeEventSource {
    onopen: (() => void) | null = null;
    private listeners = new Map<string, (e: { data: string }) => void>();
    override close = jest.fn();
    constructor() {
      super();
      sources.push(this);
    }
    override addEventListener(type?: string, fn?: (e: { data: string }) => void): void {
      if (type && fn) this.listeners.set(type, fn);
    }
    open(): void { this.onopen?.(); }
    fail(): void { this.onerror?.(); }
    emit(type: string, data: unknown): void { this.listeners.get(type)?.({ data: JSON.stringify(data) }); }
  }

  const progress = (phase: string, services: Array<{ name: string; status: string; progress: number }> = []) => ({
    phase, progress: 0.5, message: phase, services,
  });
  const startup = () => useGameStore.getState().serverStartup;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    sources.length = 0;
    document.body.innerHTML = '<div id="game-panel"></div>';
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = ControlledEventSource;
    useGameStore.setState({
      serverStartup: { ready: false, progress: 0, message: '', services: [], unreachable: false },
    });
    new StarpeaceClient();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('an SSE error reopens the stream after 2 s, and its ready status ends the wait with no fetch', () => {
    expect(sources).toHaveLength(1);
    sources[0].fail();
    expect(sources[0].close).toHaveBeenCalled();

    jest.advanceTimersByTime(1_999);
    expect(sources).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(sources).toHaveLength(2);

    sources[1].emit('status', { phase: 'ready', progress: 1, message: 'Server ready', services: [] });

    expect(startup().ready).toBe(true);
    expect(startup().unreachable).toBe(false);
    expect(sources[1].close).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(120_000);
    expect(sources).toHaveLength(2);
  });

  it('60 s of failing streams sets unreachable; reopening goes on and a later ready still lands', () => {
    const failLatest = () => sources[sources.length - 1].fail();
    failLatest();
    jest.advanceTimersByTime(58_000);
    failLatest();
    expect(startup().unreachable).toBeFalsy();

    jest.advanceTimersByTime(2_000);
    expect(startup().unreachable).toBe(true);

    const countBefore = sources.length;
    failLatest();
    jest.advanceTimersByTime(2_000);
    expect(sources.length).toBe(countBefore + 1);
    expect(startup().unreachable).toBe(true);

    sources[sources.length - 1].emit('status', { phase: 'ready', progress: 1, message: 'Server ready', services: [] });
    expect(startup().ready).toBe(true);
    expect(startup().unreachable).toBe(false);
  });

  it('a constructor that throws is retried like an error', () => {
    const Throwing = function () { throw new Error('blocked'); };
    (globalThis as unknown as { EventSource: unknown }).EventSource = Throwing;
    sources[0].fail();
    jest.advanceTimersByTime(60_000);
    expect(startup().unreachable).toBe(true);

    (globalThis as unknown as { EventSource: unknown }).EventSource = ControlledEventSource;
    jest.advanceTimersByTime(2_000);
    expect(sources).toHaveLength(2);
  });

  it('an open stream sending progress for 90 s never shows unreachable', () => {
    sources[0].open();
    for (let t = 0; t < 9; t++) {
      jest.advanceTimersByTime(10_000);
      sources[0].emit('status', progress('initializing', [{ name: 'cache', status: 'running', progress: 0.5 }]));
    }
    jest.advanceTimersByTime(10_000);
    expect(startup().unreachable).toBe(false);
    expect(startup().ready).toBe(false);
  });

  it('an open stream that stays silent for 90 s never shows unreachable', () => {
    sources[0].open();
    jest.advanceTimersByTime(90_000);
    expect(startup().unreachable).toBe(false);
  });

  it('opening a stream clears unreachable and stops the clock', () => {
    sources[0].fail();
    jest.advanceTimersByTime(60_000);
    expect(startup().unreachable).toBe(true);

    sources[sources.length - 1].open();
    expect(startup().unreachable).toBe(false);
    jest.advanceTimersByTime(120_000);
    expect(startup().unreachable).toBe(false);
  });

  it('a status listing a failed service sets unreachable at once', () => {
    sources[0].open();
    sources[0].emit('status', progress('initializing', [{ name: 'maps', status: 'failed', progress: 0 }]));
    expect(startup().unreachable).toBe(true);
  });
});

/**
 * #1048 — a socket closed on the login screen is reopened lazily by the next sign-in, and a
 * sign-in that cannot reach the gateway says so instead of "WebSocket not connected".
 */
describe('sign-in reopens a closed gateway socket (issue 1048)', () => {
  const sockets: LoginSocket[] = [];

  class LoginSocket extends FakeSocket {
    sent: string[] = [];
    constructor() {
      super();
      sockets.push(this);
    }
    override send(payload?: string): void {
      if (payload !== undefined) this.sent.push(payload);
    }
    types(): string[] { return this.sent.map((p) => (JSON.parse(p) as { type: string }).type); }
  }

  const remembered = { username: 'u', zonePath: '', worldName: 'planitia', companyId: 'C1', companyName: 'Co' };
  let client: StarpeaceClient;

  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    sockets.length = 0;
    document.body.innerHTML = '<div id="game-panel"></div>';
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = LoginSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    client = new StarpeaceClient();
    useGameStore.setState({
      status: 'disconnected', authError: null, loginLoading: false, rememberedSession: remembered,
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const closeFirst = () => {
    sockets[0].onclose?.({ code: 1006 });
    expect(useGameStore.getState().status).toBe('disconnected');
  };

  it('onAuthCheck opens a new socket and sends REQ_AUTH_CHECK only after it opens', async () => {
    closeFirst();

    client.callbacks.onAuthCheck('u', 'p');
    expect(sockets).toHaveLength(2);
    await flush();
    expect(sockets[1].sent).toHaveLength(0);

    sockets[1].onopen?.();
    await flush();
    expect(sockets[1].types()).toEqual([WsMessageType.REQ_AUTH_CHECK]);
    expect(sockets[0].sent).toHaveLength(0);
  });

  it('onResumeSession opens a new socket and sends REQ_AUTH_CHECK only after it opens', async () => {
    closeFirst();

    client.callbacks.onResumeSession(remembered, 'p');
    expect(sockets).toHaveLength(2);
    await flush();
    expect(sockets[1].sent).toHaveLength(0);

    sockets[1].onopen?.();
    await flush();
    expect(sockets[1].types()).toEqual([WsMessageType.REQ_AUTH_CHECK]);
  });

  it('a new socket that closes before opening shows the shared sentence', async () => {
    closeFirst();
    useGameStore.setState({ loginLoading: true });

    client.callbacks.onAuthCheck('u', 'p');
    sockets[1].onclose?.({ code: 1006 });
    await flush();

    expect(useGameStore.getState().authError?.message).toBe(GATEWAY_UNREACHABLE_MESSAGE);
    expect(useGameStore.getState().loginLoading).toBe(false);
    expect(sockets[1].sent).toHaveLength(0);
  });

  it('on the resume path a socket that never opens keeps the remembered session', async () => {
    closeFirst();

    client.callbacks.onResumeSession(remembered, 'p');
    sockets[1].onclose?.({ code: 1006 });
    await flush();

    expect(useGameStore.getState().authError?.message).toBe(GATEWAY_UNREACHABLE_MESSAGE);
    expect(useGameStore.getState().rememberedSession).toEqual(remembered);
  });

  it('no open within 10 s gives the same sentence', async () => {
    closeFirst();

    client.callbacks.onAuthCheck('u', 'p');
    jest.advanceTimersByTime(9_999);
    await flush();
    expect(useGameStore.getState().authError).toBeNull();

    jest.advanceTimersByTime(1);
    await flush();
    expect(useGameStore.getState().authError?.message).toBe(GATEWAY_UNREACHABLE_MESSAGE);
    expect(sockets[1].sent).toHaveLength(0);
  });

  it('with the socket open, onAuthCheck constructs no socket and sends at once', async () => {
    sockets[0].onopen?.();

    client.callbacks.onAuthCheck('u', 'p');
    await flush();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].types()).toEqual([WsMessageType.REQ_AUTH_CHECK]);
  });

  it('with the first socket still connecting, onAuthCheck waits for it instead of opening another', async () => {
    client.callbacks.onAuthCheck('u', 'p');
    await flush();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toHaveLength(0);

    sockets[0].onopen?.();
    await flush();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].types()).toEqual([WsMessageType.REQ_AUTH_CHECK]);
  });
});

/**
 * #1050 — a reconnect after a deploy checks whether the gateway now serves another bundle,
 * fire and forget beside the login replay, and raises the "New version available" flag.
 */
describe('reconnect checks the served bundle (issue 1050)', () => {
  const sockets: BundleSocket[] = [];

  class BundleSocket extends FakeSocket {
    sent: string[] = [];
    constructor() {
      super();
      sockets.push(this);
    }
    override send(payload?: string): void {
      if (payload !== undefined) this.sent.push(payload);
    }
  }

  type Internals = {
    ws: BundleSocket;
    storedUsername: string;
    storedPassword: string;
    currentWorldName: string;
  };
  const g = globalThis as unknown as { fetch?: unknown };
  const originalFetch = g.fetch;
  let client: StarpeaceClient;
  let fetchMock: jest.Mock;
  const internals = () => client as unknown as Internals;

  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const loginFrames = () =>
    sockets
      .flatMap((s) => s.sent.map((p) => JSON.parse(p) as { type: string }))
      .filter((f) => f.type === WsMessageType.REQ_LOGIN_WORLD);
  const serve = (entry: string) => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => `<script type="module" src="${entry}"></script>`,
    });
    g.fetch = fetchMock;
  };

  /** Drop the first socket, let the reconnect timer run, and open the reconnect socket. */
  const reconnect = async () => {
    internals().ws.onclose?.({ code: 1006 });
    expect(useGameStore.getState().status).toBe('reconnecting');
    jest.advanceTimersByTime(60_000);
    expect(sockets.length).toBeGreaterThan(1);
    internals().ws.onopen?.();
    await flush();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    sockets.length = 0;
    document.head.innerHTML = '<script type="module" src="assets/app.OLD.js"></script>';
    document.body.innerHTML = '<div id="game-panel"></div>';
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = BundleSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    client = new StarpeaceClient();
    internals().ws.onopen?.();
    useGameStore.setState({ status: 'connected', companyId: 'C1', serverRestarting: false, reconnectAttempt: 0 });
    internals().storedUsername = 'u';
    internals().storedPassword = 'p';
    internals().currentWorldName = 'planitia';
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    useUiStore.setState({ newVersionAvailable: false });
    g.fetch = originalFetch;
    document.head.innerHTML = '';
  });

  it('a different served entry sets the flag, and the login replay still starts', async () => {
    serve('assets/app.NEW.js');
    await reconnect();

    expect(fetchMock).toHaveBeenCalledWith('/', { cache: 'no-store' });
    expect(useUiStore.getState().newVersionAvailable).toBe(true);
    expect(loginFrames().length).toBeGreaterThan(0);
  });

  it('the same served entry leaves the flag false', async () => {
    serve('assets/app.OLD.js');
    await reconnect();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().newVersionAvailable).toBe(false);
    expect(loginFrames().length).toBeGreaterThan(0);
  });

  it('once the flag is set, a later reconnect does not fetch again', async () => {
    useUiStore.setState({ newVersionAvailable: true });
    serve('assets/app.NEW.js');
    await reconnect();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(loginFrames().length).toBeGreaterThan(0);
  });
});

/**
 * #1076 — a close with 1013 ("Try Again Later") is the gateway refusing a login at its session
 * cap. Before the game it ends at once in a "server full" card; during a reconnect it keeps the
 * episode going, and the refused socket does not reset the back-off counter.
 */
describe('close code 1013 — server full (issue 1076)', () => {
  const sockets: TrackedSocket[] = [];

  class TrackedSocket extends FakeSocket {
    constructor() {
      super();
      sockets.push(this);
    }
  }

  type Internals = {
    ws: TrackedSocket;
    storedUsername: string | null;
    storedPassword: string | null;
    currentWorldName: string;
    reconnectAttempt: number;
  };
  let client: StarpeaceClient;
  const internals = () => client as unknown as Internals;
  const delay = (k: number) => getReconnectDelay(k, () => 0.5);
  const loginMock = () => authHandler.login as jest.MockedFunction<typeof authHandler.login>;

  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  /** A promise the test settles by hand, handed to the reconnect socket's login replay. */
  const controlledLogin = () => {
    let reject: (e: Error) => void = () => undefined;
    const p = new Promise<never>((_resolve, rej) => { reject = rej; });
    p.catch(() => undefined); // a failing test that never consumed p must not crash the run
    loginMock().mockReturnValueOnce(p);
    return { reject: async () => { reject(new Error('refused')); await flush(); } };
  };

  /** The current reconnect socket opens, then the gateway refuses it with 1013. */
  const refuse = async () => {
    const ws = internals().ws;
    ws.onopen?.();
    await flush();
    ws.onclose?.({ code: 1013 });
    await flush();
  };

  /** Exactly one reconnect timer is live, and it fires at exactly `ms`. */
  const expectOneTimerAt = (ms: number) => {
    const n = sockets.length;
    jest.advanceTimersByTime(ms - 1);
    expect(sockets.length).toBe(n);
    jest.advanceTimersByTime(1);
    expect(sockets.length).toBe(n + 1);
    jest.advanceTimersByTime(60_000);
    expect(sockets.length).toBe(n + 1);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    sockets.length = 0;
    document.body.innerHTML = '<div id="game-panel"></div>';
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = TrackedSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    // A login replay that never answers, unless a test hands one over with controlledLogin().
    loginMock().mockImplementation(() => new Promise<never>(() => undefined));
    useUiStore.setState({ newVersionAvailable: true });
    client = new StarpeaceClient();
    useGameStore.setState({
      status: 'connected', companyId: 'C1', serverRestarting: false, serverFull: false,
      reconnectAttempt: 0, disconnectReason: null,
    });
    internals().storedUsername = 'u';
    internals().storedPassword = 'p';
    internals().currentWorldName = 'planitia';
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    const actual = jest.requireActual('./handlers/auth-handler') as typeof authHandler;
    loginMock().mockReset();
    loginMock().mockImplementation((...args) => actual.login(...args));
    useUiStore.setState({ newVersionAvailable: false });
  });

  describe('fresh login (never reached the game)', () => {
    it.each([
      ['with stored credentials', 'u'],
      ['without stored credentials', null],
    ])('a 1013 ends at once in server_full, %s, with no retry', (_label, creds) => {
      internals().storedUsername = creds;
      internals().storedPassword = creds;
      useGameStore.setState({ companyId: '', status: 'disconnected' });
      internals().ws.onclose?.({ code: 1013 });
      expect(useGameStore.getState().status).toBe('disconnected');
      expect(useGameStore.getState().disconnectReason).toBe('server_full');
      jest.advanceTimersByTime(60_000);
      expect(sockets).toHaveLength(1);
      expect(internals().reconnectAttempt).toBe(0);
      expect(useGameStore.getState().reconnectAttempt).toBe(0);
    });
  });

  it('in game, consecutive refusals back off 2 s, 4 s, 8 s, 16 s — never a repeated (0)', async () => {
    internals().ws.onclose?.({ code: 1013 });
    expect(useGameStore.getState().status).toBe('reconnecting');
    expect(useGameStore.getState().serverFull).toBe(true);
    expectOneTimerAt(delay(0));

    const refusedDelays: number[] = [];
    for (const k of [1, 2, 3]) {
      await refuse();
      expect(internals().reconnectAttempt).toBe(k + 1);
      expect(useGameStore.getState().reconnectAttempt).toBe(k + 1);
      expectOneTimerAt(delay(k));
      refusedDelays.push(delay(k));
    }
    expect(refusedDelays).toEqual([4000, 8000, 16000]);
    expect(refusedDelays).not.toEqual([delay(0), delay(0), delay(0)]);
    expect(useGameStore.getState().status).toBe('reconnecting');
  });

  it('the cause survives a 1006 in the same episode and is cleared on connected', async () => {
    internals().ws.onclose?.({ code: 1013 });
    jest.advanceTimersByTime(delay(0));
    internals().ws.onclose?.({ code: 1006 });
    expect(useGameStore.getState().status).toBe('reconnecting');
    expect(useGameStore.getState().serverFull).toBe(true);
    ClientBridge.setConnected();
    expect(useGameStore.getState().serverFull).toBe(false);
  });

  it('.catch after a 1013 close arms no second timer', async () => {
    internals().ws.onclose?.({ code: 1013 });
    jest.advanceTimersByTime(delay(0));
    const login = controlledLogin();
    await refuse();
    await login.reject();
    expect(internals().reconnectAttempt).toBe(2);
    expectOneTimerAt(delay(1));
  });

  it('.catch before a 1013 close: the close keeps one timer, at the restored counter', async () => {
    internals().ws.onclose?.({ code: 1013 });
    jest.advanceTimersByTime(delay(0));
    await refuse();
    jest.advanceTimersByTime(delay(1));
    const login = controlledLogin();
    const ws = internals().ws;
    ws.onopen?.();
    await flush();
    await login.reject();
    ws.onclose?.({ code: 1013 });
    await flush();
    expect(internals().reconnectAttempt).toBe(3);
    expectOneTimerAt(delay(2));
  });

  describe('.catch path with another close code (unchanged)', () => {
    it('rejection then 1006: the close supersedes the .catch timer', async () => {
      internals().ws.onclose?.({ code: 1006 });
      jest.advanceTimersByTime(delay(0));
      const login = controlledLogin();
      const ws = internals().ws;
      ws.onopen?.();
      await flush();
      await login.reject();
      ws.onclose?.({ code: 1006 });
      await flush();
      expect(internals().reconnectAttempt).toBe(2);
      expectOneTimerAt(delay(1));
    });

    it('1006 then rejection: two timers are armed, as today', async () => {
      internals().ws.onclose?.({ code: 1006 });
      jest.advanceTimersByTime(delay(0));
      const login = controlledLogin();
      const ws = internals().ws;
      ws.onopen?.();
      await flush();
      ws.onclose?.({ code: 1006 });
      await flush();
      await login.reject();
      const n = sockets.length;
      jest.advanceTimersByTime(60_000);
      expect(sockets.length).toBe(n + 2);
      expect(useGameStore.getState().serverFull).toBe(false);
    });
  });

  it('after MAX_RECONNECT_ATTEMPTS refusals the episode ends in server_full', async () => {
    internals().ws.onclose?.({ code: 1013 });
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
      const n = sockets.length;
      jest.advanceTimersByTime(60_000);
      expect(sockets.length).toBe(n + 1);
      await refuse();
    }
    expect(useGameStore.getState().status).toBe('disconnected');
    expect(useGameStore.getState().disconnectReason).toBe('server_full');
    expect(useGameStore.getState().serverFull).toBe(false);
    const n = sockets.length;
    jest.advanceTimersByTime(60_000);
    expect(sockets.length).toBe(n);
  });

  it('an exhausted episode without the cause still ends in connection_lost', async () => {
    internals().ws.onclose?.({ code: 1006 });
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
      jest.advanceTimersByTime(60_000);
      internals().ws.onclose?.({ code: 1006 });
      await flush();
    }
    expect(useGameStore.getState().status).toBe('disconnected');
    expect(useGameStore.getState().disconnectReason).toBe('connection_lost');
  });

  describe.each([1000, 1006, 1012])('a close with %i (unchanged)', (code) => {
    it('in game: reconnecting, no server-full cause', () => {
      internals().ws.onclose?.({ code });
      expect(useGameStore.getState().status).toBe('reconnecting');
      expect(useGameStore.getState().serverFull).toBe(false);
      expect(useGameStore.getState().disconnectReason).not.toBe('server_full');
    });

    it('before the game: reconnecting, then session_expired after the timer', () => {
      useGameStore.setState({ companyId: '', status: 'disconnected' });
      internals().ws.onclose?.({ code });
      expect(useGameStore.getState().status).toBe('reconnecting');
      jest.advanceTimersByTime(delay(0));
      expect(useGameStore.getState().status).toBe('disconnected');
      expect(useGameStore.getState().disconnectReason).toBe('session_expired');
    });
  });

  it('a reconnect socket that opens then closes with 1006 still resets the counter', async () => {
    internals().ws.onclose?.({ code: 1006 });
    expectOneTimerAt(delay(0));
    const ws = internals().ws;
    ws.onopen?.();
    await flush();
    ws.onclose?.({ code: 1006 });
    await flush();
    expect(internals().reconnectAttempt).toBe(1);
    expectOneTimerAt(delay(0));
  });
});

/**
 * #1046 — session resume, client side. A held resume token (sessionStorage) makes the first frame
 * on a new socket a REQ_RESUME_SESSION; a success re-attaches without a login or a rebuilt view,
 * a refusal falls back to the login replay or to session_expired. Earlier describes leave their
 * clients' lifecycle listeners on the shared document and those clients open sockets too, so every
 * assertion reads THIS client's own socket.
 */
describe('session resume (issue 1046)', () => {
  class ResumeSocket extends FakeSocket {
    sent: string[] = [];
    override close = jest.fn();
    override send(payload?: string): void {
      if (payload !== undefined) this.sent.push(payload);
    }
  }

  type Frame = { type: string; wsRequestId?: string; username?: string; token?: string };
  type Internals = {
    ws: ResumeSocket;
    isConnected: boolean;
    isLoggingOut: boolean;
    storedUsername: string;
    storedPassword: string;
    currentWorldName: string;
    mapNavigationUI: unknown;
    handleMessage(m: WsMessage): void;
  };
  let client: StarpeaceClient;
  let hidden = false;
  let fakeNav: { destroy: jest.Mock; getRenderer: () => typeof fakeRenderer };
  let fakeRenderer: Record<string, jest.Mock>;
  const internals = (c: StarpeaceClient = client) => c as unknown as Internals;

  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const framesOn = (ws: ResumeSocket): Frame[] => ws.sent.map((p) => JSON.parse(p) as Frame);
  const typesOn = (ws: ResumeSocket) => framesOn(ws).map((f) => f.type);
  const holdToken = (username = 'u', token = 'tok-1') =>
    sessionStorage.setItem(RESUME_TOKEN_KEY, JSON.stringify({ username, token }));
  const heldToken = () => {
    const raw = sessionStorage.getItem(RESUME_TOKEN_KEY);
    return raw === null ? null : JSON.parse(raw) as { username: string; token: string };
  };

  const snapshot = (over: Record<string, unknown> = {}) => ({
    type: WsMessageType.RESP_RESUME_SESSION,
    username: 'u',
    tycoonId: 'T42',
    worldName: 'planitia',
    worldXSize: 1000,
    worldYSize: 1000,
    worldSeason: 2,
    company: { id: 'C1', name: 'Co' },
    accountMoney: '123456',
    virtualDate: null,
    failureLevel: 0,
    playerX: 400,
    playerY: 500,
    chatChannel: 'Lobby',
    ...over,
  });

  /** Answer the REQ_RESUME_SESSION recorded on `ws` with `msg`. */
  const answerResume = async (ws: ResumeSocket, msg: Record<string, unknown>) => {
    const req = framesOn(ws).find((f) => f.type === WsMessageType.REQ_RESUME_SESSION);
    expect(req).toBeDefined();
    internals().handleMessage({ ...msg, wsRequestId: req?.wsRequestId } as unknown as WsMessage);
    await flush();
  };
  const refusal = {
    type: WsMessageType.RESP_ERROR,
    code: ErrorCodes.ERROR_AccessDenied,
    errorMessage: 'Session cannot be resumed',
  };

  /** In game, then the socket drops and the backoff opens a new one; returns it, not yet open. */
  const dropAndReopen = (): ResumeSocket => {
    const before = internals().ws;
    before.onclose?.({ code: 1006 });
    expect(useGameStore.getState().status).toBe('reconnecting');
    jest.advanceTimersByTime(60_000);
    expect(internals().ws).not.toBe(before);
    return internals().ws;
  };

  const inGame = () => {
    internals().ws.onopen?.();
    useGameStore.setState({ status: 'connected', companyId: 'C1', serverRestarting: false, reconnectAttempt: 0 });
    internals().storedUsername = 'u';
    internals().storedPassword = 'p';
    internals().currentWorldName = 'planitia';
    internals().mapNavigationUI = fakeNav;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    sessionStorage.clear();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.body.innerHTML = '<div id="game-panel"></div>';
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = ResumeSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    useUiStore.setState({ newVersionAvailable: true, rightPanel: null });
    useGameStore.setState({
      status: 'disconnected', companyId: '', worldName: '', tycoonId: '', serverRestarting: false,
      serverFull: false, reconnectAttempt: 0, disconnectReason: null, loginLoading: false,
      rememberedSession: null, tycoonStats: null,
    });
    fakeRenderer = {
      getCameraPosition: jest.fn(() => ({ x: 10, y: 20 })),
      getVisibleTileBounds: jest.fn(() => ({ minI: 0, maxI: 10, minJ: 0, maxJ: 10 })),
      invalidateArea: jest.fn(),
      triggerZoneCheck: jest.fn(),
      getLoadedZoneKeys: jest.fn(() => []),
      centerOn: jest.fn(),
      setSeason: jest.fn(),
      getZoom: jest.fn(() => 2),
      getVisibleChunkCoords: jest.fn(() => []),
      getChunkCache: jest.fn(() => null),
    };
    fakeNav = { destroy: jest.fn(), getRenderer: () => fakeRenderer };
    (chatHandler.initChatChannels as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete (document as unknown as { hidden?: boolean }).hidden;
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    sessionStorage.clear();
    useUiStore.setState({ newVersionAvailable: false });
  });

  describe('with a client already running', () => {
    beforeEach(() => {
      client = new StarpeaceClient();
      client.reloadPage = jest.fn();
    });

    it('the token event writes sessionStorage, a rotation replaces it, a logout in progress writes nothing', () => {
      inGame();
      internals().handleMessage({ type: WsMessageType.EVENT_SESSION_RESUME_TOKEN, token: 't1' } as unknown as WsMessage);
      expect(heldToken()).toEqual({ username: 'u', token: 't1' });

      internals().handleMessage({ type: WsMessageType.EVENT_SESSION_RESUME_TOKEN, token: 't2' } as unknown as WsMessage);
      expect(heldToken()).toEqual({ username: 'u', token: 't2' });

      sessionStorage.clear();
      internals().isLoggingOut = true;
      internals().handleMessage({ type: WsMessageType.EVENT_SESSION_RESUME_TOKEN, token: 't3' } as unknown as WsMessage);
      expect(heldToken()).toBeNull();
    });

    it('Logout deletes the token before the reload, and the reloaded page sends no REQ_RESUME_SESSION', async () => {
      inGame();
      holdToken();
      let tokenAtReload: unknown = 'not reloaded';
      client.reloadPage = jest.fn(() => { tokenAtReload = heldToken(); });
      const ws = internals().ws;

      client.callbacks.onLogout();
      await flush();
      const logoutReq = framesOn(ws).find((f) => f.type === WsMessageType.REQ_LOGOUT);
      internals().handleMessage({ type: WsMessageType.RESP_LOGOUT, wsRequestId: logoutReq?.wsRequestId, success: true } as unknown as WsMessage);
      await flush();
      ws.onclose?.({ code: 1000 });

      expect(client.reloadPage).toHaveBeenCalledTimes(1);
      expect(tokenAtReload).toBeNull();

      const reloaded = new StarpeaceClient();
      const reloadedWs = internals(reloaded).ws;
      reloadedWs.onopen?.();
      await flush();
      expect(typesOn(reloadedWs)).not.toContain(WsMessageType.REQ_RESUME_SESSION);
      expect(useGameStore.getState().loginLoading).toBe(false);
    });

    it('visibilitychange to visible while reconnecting, token only, sends REQ_RESUME_SESSION first', async () => {
      inGame();
      internals().storedPassword = '';
      holdToken('u', 'tok-vis');
      const before = internals().ws;
      before.onclose?.({ code: 1006 });
      expect(useGameStore.getState().status).toBe('reconnecting');

      document.dispatchEvent(new Event('visibilitychange'));
      const ws = internals().ws;
      expect(ws).not.toBe(before);
      ws.onopen?.();
      await flush();

      expect(framesOn(ws)[0]).toEqual(expect.objectContaining({
        type: WsMessageType.REQ_RESUME_SESSION, username: 'u', token: 'tok-vis',
      }));
    });

    it('socket drop with a valid token re-attaches: no login, no company step, no rebuilt view, camera re-sent', async () => {
      inGame();
      holdToken();
      const ws = dropAndReopen();
      ws.onopen?.();
      await flush();
      expect(framesOn(ws)[0].type).toBe(WsMessageType.REQ_RESUME_SESSION);

      await answerResume(ws, snapshot());

      const types = typesOn(ws);
      expect(types).not.toContain(WsMessageType.REQ_LOGIN_WORLD);
      expect(types).not.toContain(WsMessageType.REQ_SELECT_COMPANY);
      expect(types).toContain(WsMessageType.REQ_UPDATE_CAMERA);
      expect(fakeNav.destroy).not.toHaveBeenCalled();
      expect(fakeRenderer.invalidateArea).toHaveBeenCalled();
      expect(useGameStore.getState().status).toBe('connected');
      expect(useGameStore.getState().tycoonStats?.cash).toBe('123456');

      internals().handleMessage({ type: WsMessageType.EVENT_SESSION_RESUME_TOKEN, token: 'tok-2' } as unknown as WsMessage);
      expect(heldToken()).toEqual({ username: 'u', token: 'tok-2' });
    });

    it('a re-attach refreshes the open building inspector', async () => {
      inGame();
      holdToken();
      useUiStore.setState({ rightPanel: 'building' });
      useBuildingStore.setState({ details: { x: 7, y: 9 } as never });
      const ws = dropAndReopen();
      ws.onopen?.();
      await flush();
      await answerResume(ws, snapshot());

      const detailsReq = framesOn(ws).find((f) => f.type === WsMessageType.REQ_BUILDING_DETAILS);
      expect(detailsReq).toEqual(expect.objectContaining({ x: 7, y: 9 }));
      useBuildingStore.setState({ details: null });
      useUiStore.setState({ rightPanel: null });
    });

    it('socket drop and refusal with a password in memory: the token is deleted and the login replays', async () => {
      inGame();
      holdToken();
      const ws = dropAndReopen();
      ws.onopen?.();
      await flush();

      await answerResume(ws, refusal);

      expect(heldToken()).toBeNull();
      const types = typesOn(ws);
      expect(types[0]).toBe(WsMessageType.REQ_RESUME_SESSION);
      expect(types).toContain(WsMessageType.REQ_LOGIN_WORLD);
    });

    it('socket drop and refusal without a password: disconnected with session_expired', async () => {
      inGame();
      internals().storedPassword = '';
      holdToken();
      const ws = dropAndReopen();
      ws.onopen?.();
      await flush();

      await answerResume(ws, refusal);

      expect(heldToken()).toBeNull();
      expect(useGameStore.getState().status).toBe('disconnected');
      expect(useGameStore.getState().disconnectReason).toBe('session_expired');
      expect(typesOn(ws)).not.toContain(WsMessageType.REQ_LOGIN_WORLD);
    });

    it('a token gone by the time the socket opens, and no password: session_expired, nothing sent', async () => {
      inGame();
      internals().storedPassword = '';
      holdToken();
      const ws = dropAndReopen();
      sessionStorage.clear();
      ws.onopen?.();
      await flush();

      expect(ws.sent).toHaveLength(0);
      expect(useGameStore.getState().disconnectReason).toBe('session_expired');
    });

    it('the socket closing while the resume is in flight keeps the token and keeps reconnecting', async () => {
      inGame();
      holdToken();
      const ws = dropAndReopen();
      ws.onopen?.();
      await flush();

      ws.onclose?.({ code: 1006 });
      await flush();

      expect(heldToken()).toEqual({ username: 'u', token: 'tok-1' });
      expect(useGameStore.getState().status).toBe('reconnecting');
      expect(typesOn(ws)).not.toContain(WsMessageType.REQ_LOGIN_WORLD);
    });

    it('with no token held, a drop replays the login exactly as before', async () => {
      inGame();
      const ws = dropAndReopen();
      ws.onopen?.();
      await flush();
      const types = typesOn(ws);
      expect(types).not.toContain(WsMessageType.REQ_RESUME_SESSION);
      expect(types[0]).toBe(WsMessageType.REQ_LOGIN_WORLD);
    });
  });

  describe('start-up with a token (the page was reloaded)', () => {
    it('sends REQ_RESUME_SESSION before any login and enters the game from the snapshot', async () => {
      holdToken();
      client = new StarpeaceClient();
      const switchSpy = jest.spyOn(client, 'switchToGameView').mockImplementation(async () => {
        internals().mapNavigationUI = fakeNav;
      });
      jest.spyOn(client, 'preloadFacilityDimensions').mockResolvedValue(undefined);
      expect(useGameStore.getState().loginLoading).toBe(true);

      const ws = internals().ws;
      ws.onopen?.();
      await flush();
      expect(framesOn(ws)[0]).toEqual(expect.objectContaining({
        type: WsMessageType.REQ_RESUME_SESSION, username: 'u', token: 'tok-1',
      }));

      await answerResume(ws, snapshot());
      await flush();

      const state = useGameStore.getState();
      expect(switchSpy).toHaveBeenCalledTimes(1);
      expect(state.worldName).toBe('planitia');
      expect(state.companyId).toBe('C1');
      expect(state.tycoonId).toBe('T42');
      expect(state.loginLoading).toBe(false);
      expect(fakeRenderer.centerOn).toHaveBeenCalledWith(400, 500);
      const types = typesOn(ws);
      expect(types).not.toContain(WsMessageType.REQ_AUTH_CHECK);
      expect(types).not.toContain(WsMessageType.REQ_LOGIN_WORLD);
      expect(types).not.toContain(WsMessageType.REQ_SELECT_COMPANY);
      expect(heldToken()).toEqual({ username: 'u', token: 'tok-1' });
    });

    it('a refusal deletes the token and leaves the login screen with the remembered session', async () => {
      const remembered = { username: 'u', zonePath: '', worldName: 'planitia', companyId: 'C1', companyName: 'Co' };
      useGameStore.setState({ rememberedSession: remembered });
      holdToken();
      client = new StarpeaceClient();
      const ws = internals().ws;
      ws.onopen?.();
      await flush();

      await answerResume(ws, refusal);

      expect(heldToken()).toBeNull();
      const state = useGameStore.getState();
      expect(state.status).toBe('disconnected');
      expect(state.loginLoading).toBe(false);
      expect(state.rememberedSession).toEqual(remembered);
    });

    it('a snapshot outside a world is not entered and drops the token', async () => {
      holdToken();
      client = new StarpeaceClient();
      const ws = internals().ws;
      ws.onopen?.();
      await flush();

      await answerResume(ws, snapshot({ company: null }));

      expect(heldToken()).toBeNull();
      expect(useGameStore.getState().loginLoading).toBe(false);
      expect(useGameStore.getState().status).toBe('disconnected');
    });

    it('a socket that never opens keeps the token for the next page', async () => {
      holdToken();
      client = new StarpeaceClient();
      internals().ws.onclose?.({ code: 1006 });
      await flush();

      expect(heldToken()).toEqual({ username: 'u', token: 'tok-1' });
      expect(useGameStore.getState().loginLoading).toBe(false);
    });

    it('the socket closing under the resume request keeps the token', async () => {
      holdToken();
      client = new StarpeaceClient();
      const ws = internals().ws;
      ws.onopen?.();
      await flush();
      ws.onclose?.({ code: 1006 });
      await flush();

      expect(heldToken()).toEqual({ username: 'u', token: 'tok-1' });
      expect(useGameStore.getState().loginLoading).toBe(false);
    });
  });

  it('a sessionStorage that throws breaks neither start-up, the token event, nor the sign-in', async () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });

    expect(() => { client = new StarpeaceClient(); }).not.toThrow();
    const ws = internals().ws;
    ws.onopen?.();
    internals().storedUsername = 'u';
    expect(() => internals().handleMessage(
      { type: WsMessageType.EVENT_SESSION_RESUME_TOKEN, token: 't' } as unknown as WsMessage,
    )).not.toThrow();

    expect(() => client.callbacks.onAuthCheck('u', 'p')).not.toThrow();
    await flush();
    expect(typesOn(ws)).toContain(WsMessageType.REQ_AUTH_CHECK);
  });
});

describe('window.__spoDebug.getState() (issue 1133)', () => {
  const initialUi = useUiStore.getState();
  const initialGame = useGameStore.getState();
  const initialChat = useChatStore.getState();
  const initialProfile = useProfileStore.getState();
  const initialSearch = useSearchStore.getState();
  const initialMail = useMailStore.getState();
  const initialTutorial = useTutorialStore.getState();
  const initialBuilding = useBuildingStore.getState();

  const snap = (): SpoDebugState =>
    (window as unknown as { __spoDebug: { getState: () => SpoDebugState } }).__spoDebug.getState();

  beforeEach(() => {
    document.body.innerHTML = '<div id="game-panel"></div>';
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    new StarpeaceClient();
  });

  afterEach(() => {
    useUiStore.setState(initialUi, true);
    useGameStore.setState(initialGame, true);
    useChatStore.setState(initialChat, true);
    useProfileStore.setState(initialProfile, true);
    useSearchStore.setState(initialSearch, true);
    useMailStore.setState(initialMail, true);
    useTutorialStore.setState(initialTutorial, true);
    useBuildingStore.setState(initialBuilding, true);
  });

  it('panels.buildMenu is true only while the build surface is on top of the stack', () => {
    expect(snap().panels.buildMenu).toBe(false);
    useUiStore.getState().pushSurface({ kind: 'build' });
    expect(snap().panels.buildMenu).toBe(true);
    useUiStore.setState({ stack: [{ kind: 'build' }, { kind: 'mail' }] });
    expect(snap().panels.buildMenu).toBe(false);
  });

  it('chat.shown follows chatVisible independently of chat.visible (expanded)', () => {
    useChatStore.setState({ chatVisible: false, isExpanded: true });
    let s = snap();
    expect(s.chat.shown).toBe(false);
    expect(s.chat.visible).toBe(true);
    expect(s.panels.chat).toBe(s.chat.visible);
    useChatStore.setState({ chatVisible: true, isExpanded: false });
    s = snap();
    expect(s.chat.shown).toBe(true);
    expect(s.chat.visible).toBe(false);
    expect(s.panels.chat).toBe(s.chat.visible);
  });

  type Row = [string, () => void, () => void, (s: SpoDebugState) => unknown, unknown, unknown];
  const ui = (p: Parameters<typeof useUiStore.setState>[0]) => () => useUiStore.setState(p);
  const game = (p: Parameters<typeof useGameStore.setState>[0]) => () => useGameStore.setState(p);
  const rows: Row[] = [
    ['ui.stack', ui({ stack: [{ kind: 'mail' }, { kind: 'build' }] }), ui({ stack: [] }), s => s.ui.stack, ['mail', 'build'], []],
    ['ui.modal', ui({ modal: 'settings' }), ui({ modal: null }), s => s.ui.modal, 'settings', null],
    ['ui.modalBeneath', ui({ modalBeneath: 'settings' }), ui({ modalBeneath: null }), s => s.ui.modalBeneath, 'settings', null],
    ['ui.pinned', ui({ pinned: true }), ui({ pinned: false }), s => s.ui.pinned, true, false],
    ['ui.commandPaletteOpen', ui({ commandPaletteOpen: true }), ui({ commandPaletteOpen: false }), s => s.ui.commandPaletteOpen, true, false],
    ['ui.contextMenuOpen', ui({ mapContextMenu: { clientX: 1, clientY: 2, tileX: 3, tileY: 4, layer: 'terrain' } }), ui({ mapContextMenu: null }), s => s.ui.contextMenuOpen, true, false],
    ['ui.hudVisible', ui({ hudVisible: false }), ui({ hudVisible: true }), s => s.ui.hudVisible, false, true],
    ['ui.serverSwitchMode', game({ serverSwitchMode: true }), game({ serverSwitchMode: false }), s => s.ui.serverSwitchMode, true, false],
    ['ui.mobileTab', ui({ mobileTab: 'chat' }), ui({ mobileTab: 'map' }), s => s.ui.mobileTab, 'chat', 'map'],
    ['ui.mobileSheetSnap', ui({ mobileSheetSnap: 'full' }), ui({ mobileSheetSnap: 'half' }), s => s.ui.mobileSheetSnap, 'full', 'half'],
    ['modes.placingBuilding', ui({ isPlacingBuilding: true }), ui({ isPlacingBuilding: false }), s => s.modes.placingBuilding, true, false],
    ['modes.roadBuilding', game({ isRoadBuildingMode: true }), game({ isRoadBuildingMode: false }), s => s.modes.roadBuilding, true, false],
    ['modes.roadDemolish', game({ isRoadDemolishMode: true }), game({ isRoadDemolishMode: false }), s => s.modes.roadDemolish, true, false],
    ['modes.zonePainting', game({ isZonePaintingMode: true }), game({ isZonePaintingMode: false }), s => s.modes.zonePainting, true, false],
    ['modes.connecting', ui({ connectMode: { active: true, subject: 'Water' } }), ui({ connectMode: { active: false, subject: '' } }), s => s.modes.connecting, true, false],
    ['login.stage', game({ loginStage: 'worlds' }), game({ loginStage: 'auth' }), s => s.login.stage, 'worlds', 'auth'],
    ['login.authError', game({ authError: { code: 3, message: 'x' } }), game({ authError: null }), s => s.login.authError, true, false],
    ['login.isVisitor', game({ isVisitor: true }), game({ isVisitor: false }), s => s.login.isVisitor, true, false],
    ['login.isPublicOfficeRole', game({ isPublicOfficeRole: true }), game({ isPublicOfficeRole: false }), s => s.login.isPublicOfficeRole, true, false],
    ['subViews.profileTab', () => useProfileStore.setState({ currentTab: 'bank' }), () => useProfileStore.setState({ currentTab: null }), s => s.subViews.profileTab, 'bank', null],
    ['subViews.searchPage', () => useSearchStore.setState({ currentPage: 'towns' }), () => useSearchStore.setState({ currentPage: 'home' }), s => s.subViews.searchPage, 'towns', 'home'],
    ['subViews.mailFolder', () => useMailStore.setState({ currentFolder: 'Sent' }), () => useMailStore.setState({ currentFolder: 'Inbox' }), s => s.subViews.mailFolder, 'Sent', 'Inbox'],
    ['subViews.mailView', () => useMailStore.setState({ currentView: 'compose' }), () => useMailStore.setState({ currentView: 'list' }), s => s.subViews.mailView, 'compose', 'list'],
    ['subViews.tutorialAssigned',
      () => useTutorialStore.setState({ assignment: {} as unknown as NonNullable<ReturnType<typeof useTutorialStore.getState>['assignment']> }),
      () => useTutorialStore.setState({ assignment: null }), s => s.subViews.tutorialAssigned, true, false],
    ['subViews.buildingPreview', () => useBuildingStore.setState({ isOverlayMode: true }), () => useBuildingStore.setState({ isOverlayMode: false }), s => s.subViews.buildingPreview, true, false],
  ];

  it.each(rows)('%s follows its store field (set, then cleared)', (_name, set, clear, read, setValue, clearedValue) => {
    set();
    expect(read(snap())).toEqual(setValue);
    clear();
    expect(read(snap())).toEqual(clearedValue);
  });

  it('serialises to JSON without the authError text or any chat text beyond lastMessage', () => {
    const msg = (id: string, text: string): ChatMessage =>
      ({ id, from: 'someone', text, timestamp: 1, isSystem: false, isGM: false });
    useGameStore.setState({ authError: { code: 3, message: 'AUTH-SECRET-1133' } });
    useChatStore.setState({
      currentChannel: 'Lobby',
      messages: {
        Lobby: [msg('1', 'OLDER-MSG-1133'), msg('2', 'LAST-MSG-1133')],
        Other: [msg('3', 'OTHER-CHAN-1133')],
      },
    });
    const json = JSON.stringify(snap());
    expect(json).not.toContain('AUTH-SECRET-1133');
    expect(json).not.toContain('OLDER-MSG-1133');
    expect(json).not.toContain('OTHER-CHAN-1133');
    expect(json.split('LAST-MSG-1133').length - 1).toBe(1);
    expect(snap().chat.lastMessage).toBe('LAST-MSG-1133');
  });

  // ---- Issue 1192: fields read from on-screen markers, overlays and the renderer ----

  /** Appends a marker element carrying `data-testid` and optional `data-*` attributes. */
  const mount = (testid: string, data: Record<string, string> = {}, text = ''): HTMLElement => {
    const el = document.createElement('div');
    el.setAttribute('data-testid', testid);
    for (const [k, v] of Object.entries(data)) el.dataset[k] = v;
    el.textContent = text;
    document.body.appendChild(el);
    return el;
  };

  it.each([
    ['ui.moreMenuOpen', DEBUG_MARKERS.moreMenu, (s: SpoDebugState) => s.ui.moreMenuOpen],
    ['chat.channelPickerOpen', DEBUG_MARKERS.chatChannelPicker, (s: SpoDebugState) => s.chat.channelPickerOpen],
    ['chat.usersListShown', DEBUG_MARKERS.chatUsers, (s: SpoDebugState) => s.chat.usersListShown],
    ['mobile.infoBar', DEBUG_MARKERS.mobileInfoBar, (s: SpoDebugState) => s.mobile.infoBar],
    ['mobile.chatBanner', DEBUG_MARKERS.chatBanner, (s: SpoDebugState) => s.mobile.chatBanner],
    ['bugReporter.armed', DEBUG_MARKERS.reportModeOverlay, (s: SpoDebugState) => s.bugReporter.armed],
    ['bugReporter.modalOpen', DEBUG_MARKERS.reportModal, (s: SpoDebugState) => s.bugReporter.modalOpen],
  ])('%s is true only while its marker is on screen', (_name, testid, read) => {
    expect(read(snap())).toBe(false);
    const el = mount(testid);
    expect(read(snap())).toBe(true);
    el.remove();
    expect(read(snap())).toBe(false);
  });

  it('build.* is all-empty when no BuildMenu is on screen', () => {
    expect(snap().build).toEqual({ phase: null, category: null, loading: false, facilityCount: 0, mobileSubTab: null });
  });

  it('build.phase reads the categories screen, with no category and no facility count', () => {
    useUiStore.setState({ buildMenuFacilities: [{} as never, {} as never] });
    mount(DEBUG_MARKERS.buildMenu, { phase: 'categories', loading: 'false' });
    const b = snap().build;
    expect(b.phase).toBe('categories');
    expect(b.category).toBeNull();
    expect(b.loading).toBe(false);
    expect(b.facilityCount).toBe(0);
  });

  it('build.phase reads the facilities screen, its category and the loaded facility count', () => {
    useUiStore.setState({ buildMenuFacilities: [{} as never, {} as never] });
    const el = mount(DEBUG_MARKERS.buildMenu, { phase: 'facilities', loading: 'false', category: 'Commerce' });
    expect(snap().build).toEqual({ phase: 'facilities', category: 'Commerce', loading: false, facilityCount: 2, mobileSubTab: null });
    el.dataset.loading = 'true';
    expect(snap().build.loading).toBe(true);
    expect(snap().build.facilityCount).toBe(0);
  });

  it('build.mobileSubTab reads the mobile Build tab, and panels.buildMenu turns true with an empty stack', () => {
    expect(snap().panels.buildMenu).toBe(false);
    const el = mount(DEBUG_MARKERS.mobileBuildContent, { subtab: 'roads' });
    const s = snap();
    expect(s.ui.stack).toEqual([]);
    expect(s.panels.buildMenu).toBe(true);
    expect(s.build.mobileSubTab).toBe('roads');
    el.remove();
    expect(snap().panels.buildMenu).toBe(false);
    expect(snap().build.mobileSubTab).toBeNull();
  });

  it('bugReporter.available follows config.server.bugReportMode', () => {
    const restore = jest.replaceProperty(config.server, 'bugReportMode', true);
    expect(snap().bugReporter.available).toBe(true);
    config.server.bugReportMode = false;
    expect(snap().bugReporter.available).toBe(false);
    restore.restore();
  });

  it.each<[string, () => void, string | null]>([
    ['an active overlay', game({ activeOverlay: SurfaceType.CRIME }), 'Crime'],
    ['city zones (wins over any overlay)', game({ isCityZonesEnabled: true, activeOverlay: SurfaceType.CRIME }), 'ZONES'],
    ['no overlay', game({ activeOverlay: null, isCityZonesEnabled: false }), null],
  ])('layers.overlay reads %s', (_name, set, expected) => {
    set();
    expect(snap().layers.overlay).toBe(expected);
  });

  it('layers.debugSubLayers and layers.season are null without a renderer', () => {
    const s = snap();
    expect(s.layers.debugSubLayers).toBeNull();
    expect(s.layers.season).toBeNull();
  });

  it('layers.debugSubLayers and layers.season read the renderer', () => {
    const client = new StarpeaceClient();
    const renderer = {
      getAllBuildings: () => [],
      getAllSegments: () => [],
      getZoom: () => 2,
      getCameraPosition: () => ({ x: 0, y: 0 }),
      getMapDimensions: () => ({ width: 10, height: 10 }),
      getSeason: () => 0,
      debugShowTileInfo: true,
      debugShowBuildingInfo: false,
      debugShowConcreteInfo: true,
      debugShowWaterGrid: true,
      debugShowRoadInfo: false,
    };
    (client as unknown as { mapNavigationUI: unknown }).mapNavigationUI = { getRenderer: () => renderer };
    expect(snap().layers).toEqual({
      overlay: null,
      debugSubLayers: { tileInfo: true, buildingInfo: false, concreteInfo: true, waterGrid: true, roadInfo: false },
      season: 'Winter',
    });
    renderer.getSeason = () => 3;
    renderer.debugShowRoadInfo = true;
    expect(snap().layers.season).toBe('Autumn');
    expect(snap().layers.debugSubLayers?.roadInfo).toBe(true);
    (client as unknown as { mapNavigationUI: unknown }).mapNavigationUI = null;
  });

  it('a chat banner carrying message text exposes a boolean only', () => {
    mount(DEBUG_MARKERS.chatBanner, {}, 'someone: BANNER-TEXT-1192');
    const s = snap();
    expect(typeof s.mobile.chatBanner).toBe('boolean');
    expect(JSON.stringify(s)).not.toContain('BANNER-TEXT-1192');
  });

  it('lists every field added by issue 1192', () => {
    const s = snap();
    expect(Object.keys(s)).toEqual(expect.arrayContaining(['build', 'bugReporter', 'layers', 'mobile']));
    expect(Object.keys(s.ui)).toContain('moreMenuOpen');
    expect(Object.keys(s.chat)).toEqual(expect.arrayContaining(['channelPickerOpen', 'usersListShown']));
    expect(Object.keys(s.build).sort()).toEqual(['category', 'facilityCount', 'loading', 'mobileSubTab', 'phase']);
    expect(Object.keys(s.bugReporter).sort()).toEqual(['armed', 'available', 'modalOpen']);
    expect(Object.keys(s.layers).sort()).toEqual(['debugSubLayers', 'overlay', 'season']);
    expect(Object.keys(s.mobile).sort()).toEqual(['chatBanner', 'infoBar']);
  });
});
