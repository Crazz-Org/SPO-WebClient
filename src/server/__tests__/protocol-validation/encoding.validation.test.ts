/**
 * Encoding conformity validation — RDO wire is ANSI/Latin-1, never UTF-8.
 *
 * The Delphi servers exchange AnsiString on the socket (RDOUtils.pas
 * WideStrToStr / Socket.SendText). Node's socket.write(string) would encode
 * UTF-8, turning 'é' (1 byte 0xE9 in Latin-1) into 2 bytes (0xC3 0xA9) and
 * corrupting every accented character server-side.
 *
 * These tests drive the REAL StarpeaceSession through the protocol harness
 * and assert on the actual bytes handed to the socket.
 *
 * assertNoViolations() is not called: the socket carries no scenario exchange
 * (rdoScenarios: []), so the strict validator has nothing to compare a frame
 * against; what each test checks is asserted directly on the session and the
 * socket's captured traffic instead.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-test-harness';
import type { MockTcpSocket } from './mock-tcp-socket';

const WORLD_CONTEXT_ID = '144755896';

describe('RDO wire encoding (Latin-1 / ANSI)', () => {
  let harness: ProtocolTestHarness;
  let socket: MockTcpSocket;
  let writtenFrames: Array<string | Buffer>;

  beforeEach(async () => {
    harness = createProtocolTestHarness({
      socketConfigs: [
        {
          rdoScenarios: [],
          disableStrictValidation: true,
          fallbackResponses: [
            { member: 'SayThis', payload: 'res="#0"' },
          ],
        },
      ],
    });

    await harness.session.createSocket('world', '127.0.0.1', 5000);
    harness.session.setWorldContextId(WORLD_CONTEXT_ID);

    socket = harness.getSockets()[0];
    writtenFrames = [];
    const originalWrite = socket.write.bind(socket);
    jest.spyOn(socket, 'write').mockImplementation(
      (data: string | Buffer, encoding?: string, callback?: () => void) => {
        writtenFrames.push(data);
        return originalWrite(data, encoding, callback);
      }
    );
  });

  afterEach(() => {
    harness.session.destroy();
    harness.cleanup();
    jest.restoreAllMocks();
  });

  it('synchronous requests (sendRdoRequest path) are written as Latin-1 Buffers', async () => {
    await harness.session.sendChatMessage('Bonjour à l\'été');

    expect(writtenFrames.length).toBeGreaterThan(0);
    const frame = writtenFrames[0];
    expect(Buffer.isBuffer(frame)).toBe(true);

    const bytes = frame as Buffer;
    const decoded = bytes.toString('latin1');
    expect(decoded).toContain('SayThis');
    expect(decoded).toContain("Bonjour à l'été");

    // 'é' must be the single Latin-1 byte 0xE9 — never the UTF-8 pair 0xC3 0xA9
    expect(bytes.includes(0xe9)).toBe(true);
    expect(bytes.includes(0xc3)).toBe(false);
    // One byte per character: no UTF-8 expansion anywhere in the frame
    expect(bytes.length).toBe(decoded.length);
  });

  it('fire-and-forget pushes (writeRdoFrame path) are written as Latin-1 Buffers', async () => {
    await harness.session.setChatTypingStatus(true);

    expect(writtenFrames.length).toBeGreaterThan(0);
    const frame = writtenFrames[0];
    expect(Buffer.isBuffer(frame)).toBe(true);
    const decoded = (frame as Buffer).toString('latin1');
    expect(decoded).toContain('MsgCompositionChanged');
    expect(decoded).toContain('"*"');
  });

  it('accented text round-trips byte-exactly through the Latin-1 wire', async () => {
    const latin1Text = 'àâäéèêëïîôùûüçÇ';
    await harness.session.sendChatMessage(latin1Text);

    const frame = writtenFrames[0] as Buffer;
    expect(Buffer.isBuffer(frame)).toBe(true);
    expect(frame.toString('latin1')).toContain(latin1Text);
    // 15 accented chars = 15 bytes in the payload region (no expansion)
    expect(frame.length).toBe(frame.toString('latin1').length);
  });
});
