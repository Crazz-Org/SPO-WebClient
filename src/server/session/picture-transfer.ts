/**
 * Picture-transfer client — tycoon portrait upload to the cache server's
 * dedicated picture socket. Not RDO: no framer, no query id, no separator.
 *
 * Wire contract, verified against `~/SPO-Original`:
 *   client -> TCP connect <cacheHost>:6010            PicShopForm.pas:11, :666
 *   client -> "User=<u>\r\nWorld=<w>\r\nSize=<n>"     PicShopForm.pas:578-579 (ONE write, no trailing CRLF)
 *   server -> "SEND"                                 CacheServerReportForm.pas:533
 *        or -> "ERROR"  (Size= unparseable)           CacheServerReportForm.pas:535
 *   client -> <n bytes of JPEG, 1024-byte chunks>     PicShopForm.pas:604, :610-614
 *   server -> "OK"      (all n bytes stored)          CacheServerReportForm.pas:549
 *        or -> "ERROR"  (save failed)                 CacheServerReportForm.pas:550
 *   client -> close                                   PicShopForm.pas:645 / :652
 *
 * The legacy client treats every unrecognised reply as success
 * (PicShopForm.pas:599, commented "// >> This should never happen..."). This
 * client does not copy that: an unrecognised answer is a failure here.
 */

import * as net from 'net';
import type { SessionContext } from './session-context';
import type { PictureUploadFailure } from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';

/** PicShopForm.pas:11 */
export const PICTURE_TRANSFER_PORT = 6010;
/** PicShopForm.pas:12 (BufferSize) */
export const PICTURE_CHUNK_BYTES = 1024;
/** PicShopForm.pas:13 */
export const PICTURE_WIDTH = 150;
/** PicShopForm.pas:14 */
export const PICTURE_HEIGHT = 200;
/**
 * The stated byte ceiling. The request carries the JPEG as base64 over the
 * WebSocket, and a WS frame is capped at 64 KiB (`server.ts` WS_MAX_PAYLOAD_BYTES,
 * policy SEC-W-2). Base64 inflates by 4/3, so 32 KiB of JPEG is 43,692 base64
 * characters; with the JSON envelope that is under 44 KiB, leaving ~21 KiB of
 * headroom under the cap. A 150x200 JPEG at any sane quality is 5-20 KiB, so
 * the ceiling never binds in practice and never collides with the frame cap.
 */
export const PICTURE_MAX_BYTES = 32 * 1024;
export const PICTURE_TRANSFER_TIMEOUT_MS = 30_000;

export interface PictureUploadResult {
  success: boolean;
  reason?: PictureUploadFailure;
  message?: string;
}

export interface SendPictureParams {
  host: string;
  port?: number;
  userName: string;
  worldName: string;
  jpeg: Buffer;
  timeoutMs?: number;
  socketFactory?: () => net.Socket;
  log?: SessionContext['log'];
}

function failure(reason: PictureUploadFailure, message: string): PictureUploadResult {
  return { success: false, reason, message };
}

/**
 * Walk JPEG markers from offset 2 to find the start-of-frame segment and read
 * its dimensions. `FF` fill bytes are skipped; `0x01` and `0xD0`-`0xD9` are
 * standalone markers (no length); every other marker carries a big-endian
 * 2-byte segment length. A marker in `0xC0`-`0xCF` except `0xC4` (DHT),
 * `0xC8` (JPG) and `0xCC` (DAC) is a start-of-frame: height is the
 * big-endian uint16 at `offset+5`, width at `offset+7`. Stops at `0xDA` (SOS)
 * or end of buffer.
 */
export function readJpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    offset++;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset++;
    if (marker === 0xda) return null; // SOS — scan data follows, no frame header seen
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue; // standalone

    if (offset + 1 >= bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset);

    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 7 >= bytes.length) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return { width, height };
    }

    offset += segmentLength;
  }
  return null;
}

/** `null` means valid; otherwise the rejection to return to the caller. */
export function validatePicture(jpeg: Buffer): PictureUploadResult | null {
  if (jpeg.length === 0) {
    return failure('NOT_A_JPEG', 'Not a JPEG: the payload has no JPEG start-of-image marker.');
  }
  if (jpeg.length > PICTURE_MAX_BYTES) {
    return failure('TOO_LARGE', `Picture is ${jpeg.length} bytes; the limit is ${PICTURE_MAX_BYTES}.`);
  }
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    return failure('NOT_A_JPEG', 'Not a JPEG: the payload has no JPEG start-of-image marker.');
  }
  const dimensions = readJpegDimensions(jpeg);
  if (!dimensions) {
    return failure('NOT_A_JPEG', 'Not a JPEG: the payload has no JPEG start-of-image marker.');
  }
  if (dimensions.width !== PICTURE_WIDTH || dimensions.height !== PICTURE_HEIGHT) {
    return failure('WRONG_DIMENSIONS', `Picture must be ${PICTURE_WIDTH}x${PICTURE_HEIGHT}; this one is ${dimensions.width}x${dimensions.height}.`);
  }
  return null;
}

const IDENTITY_FORBIDDEN = /[\r\n/\\]|\.\./;

function validateIdentity(userName: string, worldName: string): PictureUploadResult | null {
  if (IDENTITY_FORBIDDEN.test(userName) || IDENTITY_FORBIDDEN.test(worldName)) {
    return failure('INVALID_IDENTITY', 'Cannot announce this tycoon or world name on the picture-transfer greeting.');
  }
  return null;
}

type Phase = 'greeting' | 'send' | 'verdict';

/**
 * Speaks the four-step protocol over a real `net.Socket`. Never rejects — it
 * always resolves a `PictureUploadResult`, so no caller can mistake a thrown
 * error for a silent success.
 */
export function sendPictureToCacheServer(params: SendPictureParams): Promise<PictureUploadResult> {
  const identityError = validateIdentity(params.userName, params.worldName);
  if (identityError) return Promise.resolve(identityError);

  const port = params.port ?? PICTURE_TRANSFER_PORT;
  const timeoutMs = params.timeoutMs ?? PICTURE_TRANSFER_TIMEOUT_MS;
  const total = params.jpeg.length;
  const log = params.log;

  return new Promise((resolve) => {
    let settled = false;
    let phase: Phase = 'greeting';
    let connected = false;
    let sentBytes = 0;
    let replyBuffer = '';

    // Named distinctly from "socket": this is the plain TCP picture-transfer
    // connection, not an RDO socket — no-raw-rdo-writes.test.ts sweeps every
    // write call site by variable name and would otherwise mistake this one.
    const pictureSocket = params.socketFactory ? params.socketFactory() : new net.Socket();
    pictureSocket.setNoDelay(true);

    const timer = setTimeout(() => {
      settle(failure('TIMEOUT', `The picture transfer timed out after ${timeoutMs} ms at step "${phase}".`));
    }, timeoutMs);

    function settle(result: PictureUploadResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pictureSocket.removeAllListeners();
      pictureSocket.destroy();
      if (log) {
        if (result.success) log.info(`[Picture] Upload succeeded (${total} bytes)`);
        else log.warn(`[Picture] Upload failed: ${result.reason} — ${result.message}`);
      }
      resolve(result);
    }

    function sendGreeting(): void {
      const greeting = `User=${params.userName}\r\nWorld=${params.worldName}\r\nSize=${total}`;
      pictureSocket.write(Buffer.from(greeting, 'latin1'));
    }

    function streamPicture(): void {
      phase = 'send';
      for (let offset = 0; offset < total; offset += PICTURE_CHUNK_BYTES) {
        const end = Math.min(offset + PICTURE_CHUNK_BYTES, total);
        const chunk = params.jpeg.subarray(offset, end);
        pictureSocket.write(chunk);
        sentBytes += chunk.length;
      }
      phase = 'verdict';
    }

    pictureSocket.on('connect', () => {
      connected = true;
      sendGreeting();
    });

    pictureSocket.on('data', (chunk: Buffer) => {
      replyBuffer += chunk.toString('latin1');

      if (phase === 'greeting') {
        if (replyBuffer === 'SEND') {
          replyBuffer = '';
          streamPicture();
        } else if (replyBuffer === 'ERROR') {
          settle(failure('GREETING_REFUSED', 'The picture server rejected the greeting (ERROR after User=/World=/Size=).'));
        } else if ('SEND'.startsWith(replyBuffer) || 'ERROR'.startsWith(replyBuffer)) {
          // partial reply — keep accumulating
        } else {
          settle(failure('UNEXPECTED_REPLY', `Unrecognised answer from the picture server: "${replyBuffer}". Treating it as a failure (Voyager's PicShopForm.pas:599 treated it as success; we do not).`));
        }
        return;
      }

      if (phase === 'verdict') {
        if (replyBuffer === 'OK') {
          settle({ success: true });
        } else if (replyBuffer === 'ERROR') {
          settle(failure('SERVER_ERROR', 'The picture server could not store the picture (ERROR after the transfer).'));
        } else if ('OK'.startsWith(replyBuffer) || 'ERROR'.startsWith(replyBuffer)) {
          // partial reply — keep accumulating
        } else {
          settle(failure('UNEXPECTED_REPLY', `Unrecognised answer from the picture server: "${replyBuffer}". Treating it as a failure (Voyager's PicShopForm.pas:599 treated it as success; we do not).`));
        }
      }
    });

    pictureSocket.on('error', (err: unknown) => {
      if (!connected) {
        settle(failure('CONNECT_FAILED', `Could not reach the picture-transfer service at ${params.host}:${port} (${toErrorMessage(err)}).`));
      } else {
        settle(failure('DISCONNECTED', `The picture server closed the connection after ${sentBytes} of ${total} bytes, with no verdict.`));
      }
    });

    pictureSocket.on('close', () => {
      if (!connected) {
        settle(failure('CONNECT_FAILED', `Could not reach the picture-transfer service at ${params.host}:${port}.`));
      } else {
        settle(failure('DISCONNECTED', `The picture server closed the connection after ${sentBytes} of ${total} bytes, with no verdict.`));
      }
    });

    pictureSocket.connect(port, params.host);
  });
}

/** `pictureBase64.length` ceiling so a hostile string never allocates a large buffer before decoding. */
const MAX_BASE64_LENGTH = Math.ceil(PICTURE_MAX_BYTES / 3) * 4 + 4;

/**
 * Tycoon portrait upload over the cache server's picture-transfer port
 * (PicShopForm.pas:658-672).
 */
export async function uploadTycoonPicture(ctx: SessionContext, pictureBase64: string): Promise<PictureUploadResult> {
  if (pictureBase64.length > MAX_BASE64_LENGTH) {
    const result = failure('TOO_LARGE', `Picture is too large to decode; the limit is ${PICTURE_MAX_BYTES} bytes.`);
    ctx.log.warn(`[Picture] Upload failed: ${result.reason} — ${result.message}`);
    return result;
  }

  const jpeg = Buffer.from(pictureBase64, 'base64');
  const validationError = validatePicture(jpeg);
  if (validationError) {
    ctx.log.warn(`[Picture] Upload failed: ${validationError.reason} — ${validationError.message}`);
    return validationError;
  }

  const host = ctx.currentWorldInfo?.ip;
  const worldName = ctx.currentWorldInfo?.name;
  const userName = ctx.cachedUsername;
  if (!host || !worldName || !userName) {
    const result = failure('NO_SESSION', 'Not connected to a world — no picture destination.');
    ctx.log.warn(`[Picture] Upload failed: ${result.reason} — ${result.message}`);
    return result;
  }

  return sendPictureToCacheServer({ host, userName, worldName, jpeg, log: ctx.log });
}
