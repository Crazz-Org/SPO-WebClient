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

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
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

  it('onVisitWorld forwards to authHandler.visitWorld with the client', () => {
    client.callbacks.onVisitWorld();

    expect(authHandler.visitWorld).toHaveBeenCalledWith(client);
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
