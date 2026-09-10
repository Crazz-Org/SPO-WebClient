/**
 * Mail handler — extracted from StarpeaceSession.
 *
 * Every exported function takes `ctx: SessionContext` as first argument.
 * Private helpers are module-private functions.
 *
 * Void procedures (AddHeaders, DeleteMessage) are fire-and-forget:
 * writeRdoFrame() with "*" (VoidId), no RID.
 * AddLine and CloseMessage are synchronous (Delphi sets WaitForAnswer:=true)
 * — use sendRdoRequest() with separator '"^"'.
 * NEVER use sendRdoRequest() with separator '*' — project convention
 * (assertNotVoidPush, one form per intent). Wire-legal (server acks `A<id> ;`,
 * capture-proven: AddLine → A2174 ;) but forbidden here; the real crash risk
 * is "^" WITHOUT a QueryId.
 * Ref: MsgComposerHandler.pas:324-326.
 *
 * There are two HTTP scrapes: `MessageList.asp` (folder listing, `getMailFolder`)
 * and `MessageBody.asp` (Inbox read-touch, `markInboxMessageRead`). RDO has no member
 * that clears the mail server's `Read` flag — `CheckNewMail` counts Inbox headers whose
 * `Read` is not `1` (`~/SPO-Original/Mail Server/MailServer.pas:557`, walk at `:543-560`),
 * and the only writer of that flag is the ASP COM object `TFiveMessage.LoadHeader`
 * (`~/SPO-Original/Mail/MailMessageAuto.pas:165-166`), reached the first time a page asks
 * `Message.Header(...)` (`UpdateHeader`, `:184-188`). `MessageBody.asp` does exactly that
 * (`~/SPO-ASP/Five/0/Visual/Voyager/Mail/MessageBody.asp:28-30`), so after an Inbox
 * `readMailMessage` the gateway issues the same GET to make the flag match the client's
 * re-query of `CheckNewMail`.
 */

import type { SessionContext } from './session-context';
import type { MailMessageHeader, MailMessageFull, MailAttachment } from '../../shared/types';
import type { MailFolder } from '../../shared/types/domain-types';

import { TimeoutCategory } from '../../shared/timeout-categories';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import type { RdoMemberName } from '../../shared/rdo-members';
import { parsePropertyResponse as parsePropertyResponseHelper, writeRdoFrame } from '../rdo-helpers';
import { parseMessageListHtml } from '../mail-list-parser';
import { toErrorMessage } from '../../shared/error-utils';
import { fetchWithTimeout } from '../fetch-with-timeout';

// ── Fire-and-forget helper for void mail procedures ──────────────────────
function mailFireAndForget(ctx: SessionContext, targetId: string, method: RdoMemberName, ...args: RdoValue[]): void {
  const socket = ctx.getSocket('mail');
  if (!socket) throw new Error('Mail socket unavailable');
  const cmd = rdoCall(method, targetId, ...args).toFrame();
  writeRdoFrame(socket, cmd);
  ctx.log.debug(`[Mail] Sent: ${cmd}`);
}

// ── Private Helpers ────────────────────────────────────────────────────────

const MAIL_READ_TOUCH_TIMEOUT_MS = 5000;

/**
 * Touch MessageBody.asp for an Inbox message so the mail server's `Read` header
 * flag is set (MailMessageAuto.pas:165-166), the way MessageBody.asp:28-30 does when
 * a Voyager page opens the message. Never throws — a failed or slow GET only degrades
 * to today's behaviour (the unread flag stays uncleared), it never blocks or fails the read.
 */
async function markInboxMessageRead(ctx: SessionContext, messageId: string): Promise<void> {
  if (!ctx.currentWorldInfo || !ctx.mailAccount) {
    ctx.log.debug('[Mail] Cannot touch header: not logged into world or no mail account');
    return;
  }

  const params = new URLSearchParams({
    WorldName: ctx.currentWorldInfo.name,
    Account: ctx.mailAccount,
    Folder: 'Inbox',
    MsgId: messageId,
  });

  const url = `http://${ctx.currentWorldInfo.ip}/five/0/visual/voyager/mail/MessageBody.asp?${params.toString().replace(/\+/g, '%20')}`;

  try {
    const response = await fetchWithTimeout(url, { redirect: 'follow' }, MAIL_READ_TOUCH_TIMEOUT_MS);
    if (!response.ok) {
      ctx.log.warn(`[Mail] MessageBody.asp returned ${response.status} — unread flag not cleared`);
    }
  } catch (e: unknown) {
    ctx.log.warn('[Mail] Header touch failed — unread flag not cleared:', toErrorMessage(e));
  }
}

/**
 * Parse ini-style mail headers text into MailMessageHeader.
 * Headers format: key=value per line (from TStringList)
 */
function parseMailHeaders(headersText: string): MailMessageHeader {
  const headers: Record<string, string> = {};
  for (const line of headersText.split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.substring(0, eqIdx).trim();
      const value = line.substring(eqIdx + 1).trim();
      headers[key] = value;
    }
  }

  return {
    messageId: headers['MessageId'] || '',
    fromAddr: headers['FromAddr'] || '',
    toAddr: headers['ToAddr'] || '',
    from: headers['From'] || '',
    to: headers['To'] || '',
    subject: headers['Subject'] || '',
    date: headers['Date'] || '',
    dateFmt: headers['DateFmt'] || '',
    read: headers['Read'] === '1',
    stamp: parseInt(headers['Stamp'] || '0', 10),
    noReply: headers['NoReply'] === '1',
  };
}

/**
 * Parse attachment properties text into MailAttachment.
 * Format: key=value per line (from TAttachment properties TStringList)
 */
function parseMailAttachment(attachText: string): MailAttachment {
  const props: Record<string, string> = {};
  for (const line of attachText.split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.substring(0, eqIdx).trim();
      const value = line.substring(eqIdx + 1).trim();
      props[key] = value;
    }
  }

  const cls = props['Class'] || '';
  const executed = props['Executed'] === 'Yes';
  delete props['Class'];
  delete props['Executed'];

  return { class: cls, properties: props, executed };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Compose and send a mail message.
 * Reference: MsgComposerHandler.pas:329-338
 * Flow: NewMail -> AddHeaders? -> AddLine (per line) -> Post -> [DeleteMessage old draft, on
 * success] -> CloseMessage
 */
export async function composeMail(
  ctx: SessionContext,
  to: string,
  subject: string,
  bodyLines: string[],
  headers?: string,
  existingDraftId?: string
): Promise<boolean> {
  await ctx.ensureMailConnection();
  if (!ctx.mailServerId || !ctx.mailAccount) {
    throw new Error('Mail service not connected');
  }

  const worldName = ctx.currentWorldInfo?.name || '';

  // 1. Create in-memory message
  const newMailPacket = await ctx.sendRdoRequest('mail', rdoCall(
    'NewMail', ctx.mailServerId,
    RdoValue.string(ctx.mailAccount),
    RdoValue.string(to),
    RdoValue.string(subject),
  ).packet, undefined, TimeoutCategory.NORMAL);
  const msgId = parsePropertyResponseHelper(newMailPacket.payload!, 'NewMail');
  ctx.log.debug(`[Mail] Created message, msgId: ${msgId}`);

  if (!msgId || msgId === '0') {
    ctx.log.error('[Mail] Failed to create message');
    return false;
  }

  // 2a. Add original headers for reply/forward threading
  if (headers) {
    mailFireAndForget(ctx, msgId, 'AddHeaders', RdoValue.string(headers));
    await new Promise(r => setTimeout(r, 50));
  }

  // 2b. Add body lines (synchronous — Delphi sets WaitForAnswer:=true before AddLine loop)
  for (const line of bodyLines) {
    await ctx.sendRdoRequest('mail', rdoCall(
      'AddLine', msgId,
      RdoValue.string(line),
    ).packet, undefined, TimeoutCategory.NORMAL);
  }

  // 3. Post (send) the message
  const postPacket = await ctx.sendRdoRequest('mail', rdoCall(
    'Post', ctx.mailServerId,
    RdoValue.string(worldName),
    RdoValue.int(parseInt(msgId, 10)),
  ).packet, undefined, TimeoutCategory.SLOW);
  // Post returns wordbool: #-1 = true (success), #0 = false (failure)
  const resultStr = parsePropertyResponseHelper(postPacket.payload!, 'Post');
  const success = resultStr === '-1';
  ctx.log.debug(`[Mail] Post result: ${resultStr} (success=${success})`);

  // 3b. Sent from an opened draft: Voyager deletes the Draft copy only once Post has
  // answered true (MsgComposerHandler.pas:329-333), before CloseMessage (:338). A failed
  // Post leaves the draft where it is.
  if (success && existingDraftId) {
    await deleteMailMessage(ctx, 'Draft', existingDraftId);
  }

  // 4. Close message to release server memory (MsgComposerHandler.pas:338)
  // Synchronous — Delphi WaitForAnswer still true from AddLine setting.
  try {
    await ctx.sendRdoRequest('mail', rdoCall(
      'CloseMessage', ctx.mailServerId,
      RdoValue.int(parseInt(msgId, 10)),
    ).packet, undefined, TimeoutCategory.NORMAL);
  } catch (e: unknown) {
    ctx.log.warn('[Mail] Failed to close message after post:', e);
  }

  return success;
}

/**
 * Save a mail message as draft (not sent).
 * Reference: MsgComposerHandler.pas:346-387
 * Flow: [DeleteMessage old draft?] -> NewMail -> AddHeaders? -> AddLine (per line) -> Save -> CloseMessage
 */
export async function saveDraft(
  ctx: SessionContext,
  to: string,
  subject: string,
  bodyLines: string[],
  headers?: string,
  existingDraftId?: string
): Promise<boolean> {
  await ctx.ensureMailConnection();
  if (!ctx.mailServerId || !ctx.mailAccount) {
    throw new Error('Mail service not connected');
  }

  const worldName = ctx.currentWorldInfo?.name || '';

  // If editing existing draft, delete old one first
  if (existingDraftId) {
    await deleteMailMessage(ctx, 'Draft', existingDraftId);
  }

  // 1. Create in-memory message
  const newMailPacket = await ctx.sendRdoRequest('mail', rdoCall(
    'NewMail', ctx.mailServerId,
    RdoValue.string(ctx.mailAccount),
    RdoValue.string(to),
    RdoValue.string(subject),
  ).packet, undefined, TimeoutCategory.NORMAL);
  const msgId = parsePropertyResponseHelper(newMailPacket.payload!, 'NewMail');

  if (!msgId || msgId === '0') {
    ctx.log.error('[Mail] Failed to create draft message');
    return false;
  }

  // 2. Add original headers for reply/forward threading
  if (headers) {
    mailFireAndForget(ctx, msgId, 'AddHeaders', RdoValue.string(headers));
    await new Promise(r => setTimeout(r, 50));
  }

  // 3. Add body lines (synchronous — Delphi sets WaitForAnswer:=true before AddLine loop)
  for (const line of bodyLines) {
    await ctx.sendRdoRequest('mail', rdoCall(
      'AddLine', msgId,
      RdoValue.string(line),
    ).packet, undefined, TimeoutCategory.NORMAL);
  }

  // 4. Save to Draft folder (not Post/send)
  const savePacket = await ctx.sendRdoRequest('mail', rdoCall(
    'Save', ctx.mailServerId,
    RdoValue.string(worldName),
    RdoValue.int(parseInt(msgId, 10)),
  ).packet, undefined, TimeoutCategory.SLOW);
  // Save returns wordbool: #-1 = true (success), #0 = false (failure)
  const resultStr = parsePropertyResponseHelper(savePacket.payload!, 'Save');
  const success = resultStr === '-1';
  ctx.log.debug(`[Mail] Save draft result: ${resultStr} (success=${success})`);

  // 5. Close message to release server memory
  // Synchronous — Delphi WaitForAnswer still true from AddLine setting.
  try {
    await ctx.sendRdoRequest('mail', rdoCall(
      'CloseMessage', ctx.mailServerId,
      RdoValue.int(parseInt(msgId, 10)),
    ).packet, undefined, TimeoutCategory.NORMAL);
  } catch (e: unknown) {
    ctx.log.warn('[Mail] Failed to close message after save:', e);
  }

  return success;
}

/**
 * Open and read a mail message.
 * Reference: MsgComposerHandler.pas:416-420
 * Flow: OpenMessage -> GetHeaders -> GetLines -> GetAttachmentCount -> GetAttachment -> CloseMessage
 * -> [Inbox only] MessageBody.asp header touch (see the file header for why).
 */
export async function readMailMessage(
  ctx: SessionContext,
  folder: string,
  messageId: string
): Promise<MailMessageFull> {
  await ctx.ensureMailConnection();
  if (!ctx.mailServerId || !ctx.mailAccount) {
    throw new Error('Mail service not connected');
  }

  const worldName = ctx.currentWorldInfo?.name || '';

  // 1. Open message (loads from disk into server memory)
  const openPacket = await ctx.sendRdoRequest('mail', rdoCall(
    'OpenMessage', ctx.mailServerId,
    RdoValue.string(worldName),
    RdoValue.string(ctx.mailAccount),
    RdoValue.string(folder),
    RdoValue.string(messageId),
  ).packet, undefined, TimeoutCategory.NORMAL);
  const msgId = parsePropertyResponseHelper(openPacket.payload!, 'OpenMessage');
  ctx.log.debug(`[Mail] Opened message, msgId: ${msgId}`);

  let message: MailMessageFull;
  try {
    // 2. Get headers (ini-style key=value text)
    const headersPacket = await ctx.sendRdoRequest('mail', rdoCall(
      'GetHeaders', msgId,
      RdoValue.int(0),
    ).packet, undefined, TimeoutCategory.NORMAL);
    const headersText = parsePropertyResponseHelper(headersPacket.payload || '', 'res');

    // 3. Get body lines
    const linesPacket = await ctx.sendRdoRequest('mail', rdoCall(
      'GetLines', msgId,
      RdoValue.int(0),
    ).packet, undefined, TimeoutCategory.NORMAL);
    const bodyText = parsePropertyResponseHelper(linesPacket.payload || '', 'res');

    // 4. Get attachments
    const attachCountPacket = await ctx.sendRdoRequest('mail', rdoCall(
      'GetAttachmentCount', msgId,
      RdoValue.int(0),
    ).packet, undefined, TimeoutCategory.NORMAL);
    const attachCountStr = parsePropertyResponseHelper(attachCountPacket.payload!, 'GetAttachmentCount');
    const attachCount = parseInt(attachCountStr, 10) || 0;

    const attachments: MailAttachment[] = [];
    for (let i = 0; i < attachCount; i++) {
      const attachPacket = await ctx.sendRdoRequest('mail', rdoCall(
        'GetAttachment', msgId,
        RdoValue.int(i),
      ).packet, undefined, TimeoutCategory.NORMAL);
      const attachText = attachPacket.payload || '';
      attachments.push(parseMailAttachment(attachText));
    }

    // Parse headers and body into structured format
    const parsedHeaders = parseMailHeaders(headersText);

    message = {
      ...parsedHeaders,
      messageId,
      body: bodyText.split('\n').filter(l => l.length > 0),
      attachments,
    };
  } finally {
    // 5. Always close message to release server memory
    // Synchronous — Delphi WaitForAnswer still true from AddLine setting.
    try {
      await ctx.sendRdoRequest('mail', rdoCall(
        'CloseMessage', ctx.mailServerId,
        RdoValue.int(parseInt(msgId, 10)),
      ).packet, undefined, TimeoutCategory.NORMAL);
    } catch (e: unknown) {
      ctx.log.warn('[Mail] Failed to close message:', e);
    }
  }

  // 6. Inbox only — Sent/Draft carry no meaningful Read flag (MailServer.pas:544 walks tidInbox).
  if (folder.toLowerCase() === 'inbox') {
    await markInboxMessageRead(ctx, messageId);
  }

  return message;
}

/**
 * Delete a mail message from a folder.
 */
export async function deleteMailMessage(
  ctx: SessionContext,
  folder: string,
  messageId: string
): Promise<void> {
  await ctx.ensureMailConnection();
  if (!ctx.mailServerId || !ctx.mailAccount) {
    throw new Error('Mail service not connected');
  }

  const worldName = ctx.currentWorldInfo?.name || '';

  mailFireAndForget(ctx, ctx.mailServerId!, 'DeleteMessage',
    RdoValue.string(worldName), RdoValue.string(ctx.mailAccount),
    RdoValue.string(folder), RdoValue.string(messageId));
  ctx.log.debug(`[Mail] Deleted message ${messageId} from ${folder}`);
}

/**
 * Get unread mail count for Inbox.
 * Reference: InterfaceServer.pas:4345 -- CountUnreadMessages proxies CheckNewMail
 *
 * CheckNewMail(ServerId: integer; Account: widestring) dereferences ServerId
 * as a TInterfaceServerData POINTER (MailServer.pas:543) — it MUST be the id
 * returned by LogServerOn (obtained in connectMailService). Passing 0 caused
 * a server-side access violation and a constant -1 result.
 */
export async function getMailUnreadCount(ctx: SessionContext): Promise<number> {
  await ctx.ensureMailConnection();
  if (!ctx.mailServerId || !ctx.mailAccount) {
    throw new Error('Mail service not connected');
  }
  if (!ctx.mailIntServerId) {
    ctx.log.debug('[Mail] No LogServerOn session id — skipping CheckNewMail');
    return 0;
  }

  const packet = await ctx.sendRdoRequest('mail', rdoCall(
    'CheckNewMail', ctx.mailServerId,
    RdoValue.int(parseInt(ctx.mailIntServerId, 10)),
    RdoValue.string(ctx.mailAccount),
  ).packet, undefined, TimeoutCategory.NORMAL);
  const countStr = parsePropertyResponseHelper(packet.payload!, 'res');
  const count = parseInt(countStr, 10);
  // The server returns -1 on internal failure — surface that as "no unread"
  return count > 0 ? count : 0;
}

/**
 * Fetch mail folder listing via HTTP (MessageList.asp on World Web Server).
 * The original Voyager used ASP pages backed by a COM MailBrowser DLL
 * to enumerate mail directories -- there is no RDO method for folder listing.
 */
export async function getMailFolder(
  ctx: SessionContext,
  folder: string
): Promise<MailMessageHeader[]> {
  if (!ctx.currentWorldInfo || !ctx.mailAccount) {
    ctx.log.warn('[Mail] Cannot fetch folder: not logged into world or no mail account');
    return [];
  }

  const params = new URLSearchParams({
    Folder: folder,
    WorldName: ctx.currentWorldInfo.name,
    Account: ctx.mailAccount,
    MsgId: '',
    Action: '',
  });

  const url = `http://${ctx.currentWorldInfo.ip}/five/0/visual/voyager/mail/MessageList.asp?${params.toString().replace(/\+/g, '%20')}`;
  ctx.log.debug(`[Mail] Fetching folder listing from ${url}`);

  try {
    const response = await fetchWithTimeout(url, { redirect: 'follow' });
    if (!response.ok) {
      ctx.log.warn(`[Mail] MessageList.asp returned ${response.status}`);
      return [];
    }
    const html = await response.text();
    const folderType = folder as MailFolder;
    return parseMessageListHtml(html, folderType);
  } catch (e: unknown) {
    ctx.log.error('[Mail] Failed to fetch folder listing:', toErrorMessage(e));
    return [];
  }
}
