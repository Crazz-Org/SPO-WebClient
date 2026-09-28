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
jest.mock('./handlers/auth-handler', () => ({
  ...(jest.requireActual('./handlers/auth-handler') as object),
  visitWorld: jest.fn(),
}));

import { StarpeaceClient } from './client';
import * as chatHandler from './handlers/chat-handler';
import * as authHandler from './handlers/auth-handler';
import * as buildingActionHandler from './handlers/building-action-handler';
import { WsMessageType, type WsMessage } from '../shared/types';
import { useGameStore } from './store/game-store';
import { ClientBridge } from './bridge/client-bridge';

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

    expect(notify).toHaveBeenCalledWith('Failed to disconnect: socket gone', 'error');
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
