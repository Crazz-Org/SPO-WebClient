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

import { StarpeaceClient } from './client';
import * as chatHandler from './handlers/chat-handler';

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
