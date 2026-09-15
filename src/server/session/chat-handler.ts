/**
 * Chat handler — extracted from StarpeaceSession.
 *
 * Every public function takes `ctx: SessionContext` as its first argument.
 * Private helpers (`parseChatUserList`, `parseChatChannelList`) are
 * module-private functions (not exported).
 */

import type { SessionContext } from './session-context';
import type { ChatUser, ChatChannel } from '../../shared/types';
import { parseAccDesc } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { CHANNEL_USER_LIMIT } from '../../shared/chat-channel';
import { parsePropertyResponse as parsePropertyResponseHelper, writeRdoFrame } from '../rdo-helpers';
import { ERROR_InvalidPassword, ERROR_NotEnoughRoom, ERROR_Unknown, ERROR_InvalidUserName } from '../../shared/error-codes';

// =========================================================================
// PRIVATE HELPERS
// =========================================================================

/**
 * Parse user list format: "name/accDesc/afk\n..."
 */
function parseChatUserList(ctx: SessionContext, rawData: string): ChatUser[] {
  const users: ChatUser[] = [];
  const lines = rawData.split(/\r?\n/).filter(l => l.trim().length > 0);

  for (const line of lines) {
    const parts = line.split('/');
    if (parts[0]?.trim()) {
      const accDescStr = parts[1]?.trim() ?? '0';
      const { nobilityPoints, modifiers, nobilityTier } = parseAccDesc(accDescStr);
      users.push({
        name: parts[0].trim(),
        id: accDescStr,
        isAway: parts[2]?.trim() === '1',
        nobilityPoints,
        nobilityTier,
        modifiers,
      });
    }
  }

  ctx.log.debug(`[Chat] Parsed ${users.length} users`);
  return users;
}

/**
 * Parse channel list format: "channelName\npassword\n..." (alternating name/password pairs).
 * Server returns pairs: line 0=name, line 1=password, line 2=name, line 3=password, etc.
 * "Lobby" is prepended as the default main channel, always open.
 */
function parseChatChannelList(ctx: SessionContext, rawData: string): ChatChannel[] {
  // Do NOT drop empty lines before pairing: an OPEN channel's password line is
  // empty, and removing it shifts every following pair by one (issue 618).
  const lines = rawData.split(/\r?\n/);
  // The server closes the list with a trailing LineBreak — drop only that.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const channels: ChatChannel[] = [{ name: 'Lobby', isProtected: false }];
  for (let i = 0; i < lines.length; i += 2) {
    const name = lines[i].trim();
    if (!name) continue;
    channels.push({ name, isProtected: (lines[i + 1] ?? '').trim().length > 0 });
  }

  ctx.log.debug(`[Chat] Parsed ${channels.length} channels (including Lobby)`);
  return channels;
}

// =========================================================================
// PUBLIC API
// =========================================================================

export async function getChatUserList(ctx: SessionContext): Promise<ChatUser[]> {
  if (!ctx.worldContextId) throw new Error('Not logged into world');

  ctx.log.debug('[Chat] Getting user list...');

  const packet = await ctx.sendRdoRequest('world', rdoCall(
    'GetUserList', ctx.worldContextId,
  ).packet, undefined, TimeoutCategory.NORMAL);

  const rawUsers = parsePropertyResponseHelper(packet.payload || '', 'res');
  return parseChatUserList(ctx, rawUsers);
}

export async function getChatChannelList(ctx: SessionContext): Promise<ChatChannel[]> {
  if (!ctx.worldContextId) throw new Error('Not logged into world');

  ctx.log.debug('[Chat] Getting channel list...');

  const packet = await ctx.sendRdoRequest('world', rdoCall(
    'GetChannelList', ctx.worldContextId, RdoValue.string('ROOT'),
  ).packet, undefined, TimeoutCategory.NORMAL);

  const rawChannels = parsePropertyResponseHelper(packet.payload || '', 'res');
  return parseChatChannelList(ctx, rawChannels);
}

export async function getChatChannelInfo(ctx: SessionContext, channelName: string): Promise<string> {
  if (!ctx.worldContextId) throw new Error('Not logged into world');

  ctx.log.debug(`[Chat] Getting info for channel: ${channelName}`);

  // Explicit OLEString (P-M2): channelName is browser-supplied. Raw, a name
  // starting with an RDO prefix was re-read as a typed literal, and one
  // containing a `"` escaped its own literal into a second sub-command of the
  // same `sel` (RDOQueryServer.pas:133-160). Bytes unchanged for real names.
  //
  // This site used to write `separator: '^'` unquoted, with a note about the
  // inconsistency. The separator is now derived and the spelling question is
  // gone; format() quoted all three spellings identically anyway
  // (src/server/rdo.test.ts).
  const packet = await ctx.sendRdoRequest('world', rdoCall(
    'GetChannelInfo', ctx.worldContextId, RdoValue.string(channelName),
  ).packet, undefined, TimeoutCategory.NORMAL);

  return parsePropertyResponseHelper(packet.payload || '', 'res');
}

/** A JoinChannel refusal the player can act on. Carries the server's own code. */
export class ChannelJoinError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'ChannelJoinError';
  }
}

/** A Chase refusal the player can act on. Carries the server's own code. */
export class ChaseError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'ChaseError';
  }
}

/**
 * The two refusals a player can actually do something about
 * (`InterfaceServer.pas:1542-1552`): a wrong password, and a channel already at
 * its `fUserLimit`. Anything else keeps the raw code — it is a bug, not a choice.
 */
function channelJoinMessage(code: number, result: string, displayName: string): string {
  switch (code) {
    case ERROR_InvalidPassword:
      return `Wrong password for "${displayName}".`;
    case ERROR_NotEnoughRoom:
      return `"${displayName}" is full — there is no room for another player right now.`;
    default:
      return `Failed to join channel: ${result}`;
  }
}

export async function joinChatChannel(ctx: SessionContext, channelName: string, password: string = ''): Promise<void> {
  if (!ctx.worldContextId) throw new Error('Not logged into world');

  const displayName = channelName || 'Lobby';
  ctx.log.debug(`[Chat] Joining channel: ${displayName}`);

  // Explicit OLEString (P-M2) — see getChatChannelInfo. Same note on the
  // formerly unquoted separator.
  const packet = await ctx.sendRdoRequest('world', rdoCall(
    'JoinChannel', ctx.worldContextId,
    RdoValue.string(channelName), RdoValue.string(password),
  ).packet, undefined, TimeoutCategory.NORMAL);

  const result = parsePropertyResponseHelper(packet.payload || '', 'res');
  if (result !== '0') {
    const code = Number.parseInt(result, 10);
    throw new ChannelJoinError(
      Number.isNaN(code) ? ERROR_Unknown : code,
      channelJoinMessage(code, result, displayName),
    );
  }

  ctx.setCurrentChannel(channelName);
  ctx.log.debug(`[Chat] Successfully joined: ${displayName}`);
}

/**
 * Create a named channel, optionally password-protected, and stand in it.
 *
 * `function CreateChannel( ChannelName, Password, aSessionApp, aSessionAppId :
 * widestring; anUserLimit : integer ) : OleVariant` — InterfaceServer.pas:186.
 * A function, so "^" and a QueryId are derived from the catalogue.
 *
 * The body (`:1512-1533`) looks the name up first: unknown → it creates the
 * channel and answers NOERROR; **taken → it falls through to `JoinChannel`**.
 * Both branches run `ClientEnteredChannel`, so a `0` reply carries exactly one
 * guarantee — you are now in the channel you named — and this handler
 * deliberately does not try to tell "created" from "joined": the reply cannot,
 * and nothing downstream needs to.
 *
 * `13` (ERROR_InvalidPassword) and `32` (ERROR_NotEnoughRoom,
 * `Protocol/Protocol.pas:42,61`) are reachable only through that fall-through,
 * so reaching one is itself proof the name was already taken — hence the named
 * messages rather than the generic code.
 *
 * `aSessionApp` / `aSessionAppId` go out as EMPTY strings, not omitted, and
 * `anUserLimit` as 100: that is what the reference client's New Channel dialog
 * sent (`Voyager.1/URLHandlers/ChatHandlerViewer.pas:221`), which forces the
 * channel-session tab closed before calling (`:219`).
 */
export async function createChatChannel(
  ctx: SessionContext,
  channelName: string,
  password: string,
): Promise<void> {
  if (!ctx.worldContextId) throw new Error('Not logged into world');

  ctx.log.debug(`[Chat] Creating channel: ${channelName}`);

  const packet = await ctx.sendRdoRequest('world', rdoCall(
    'CreateChannel', ctx.worldContextId,
    RdoValue.string(channelName),
    RdoValue.string(password),
    RdoValue.string(''),               // aSessionApp   — empty, not omitted: ChatHandlerViewer.pas:221
    RdoValue.string(''),               // aSessionAppId — idem
    RdoValue.int(CHANNEL_USER_LIMIT),  // anUserLimit = 100 — same line
  ).packet, undefined, TimeoutCategory.NORMAL);

  const result = parsePropertyResponseHelper(packet.payload || '', 'res');
  if (result === '0') {
    ctx.setCurrentChannel(channelName);
    ctx.log.debug(`[Chat] Now in channel: ${channelName}`);
    return;
  }
  if (result === '13') {
    throw new Error(`Channel "${channelName}" already exists and its password does not match`);
  }
  if (result === '32') {
    throw new Error(`Channel "${channelName}" already exists and is full`);
  }
  throw new Error(`Failed to create channel: ${result}`);
}

export async function sendChatMessage(ctx: SessionContext, message: string): Promise<void> {
  if (!ctx.worldContextId) throw new Error('Not logged into world');
  if (!message.trim()) return;

  ctx.log.debug(`[Chat] Sending message: ${message}`);

  // `procedure SayThis( Dest, Msg : widestring )` — InterfaceServer.pas:179. A
  // procedure: no return value. So the separator is "*" (VoidId) WITH a QueryId,
  // which the server acks `A<id> ;` — the reference client's form.
  //
  // This previously emitted "^", justified by a comment claiming SayThis had an
  // out ErrorCode param. That signature exists only in a TEST unit
  // (Tests/3D Viewer/ClientView.pas:60); the production server declares a bare
  // 2-argument procedure. "^" made the server push a hidden result pointer the
  // procedure never pops (RDOQueryServer.pas:422-424 → RDOObjectServer.pas:292),
  // and a SINGLE such frame froze the shared Interface Server (live probe,
  // 2026-08-15). Every chat message a player sent carried this form.
  //
  // The separator is no longer written here at all: SayThis is catalogued as a
  // `procedure`, so "*" is derived. Reintroducing "^" would mean editing the
  // catalogue, which is not something a chat change touches.
  await ctx.sendRdoRequest('world', rdoCall(
    'SayThis', ctx.worldContextId,
    RdoValue.string(''), RdoValue.string(message),
  ).packet, undefined, TimeoutCategory.NORMAL);
}

/** `TMsgCompositionState = (mstIdle, mstComposing, mstAFK)` — Protocol.pas:121, a Delphi enum, so mstAFK = 2. */
const COMPOSITION_AWAY = 2;

function pushCompositionState(ctx: SessionContext, state: number): void {
  if (!ctx.worldContextId) throw new Error('Not logged into world');

  // Send as push command (no await needed)
  const socket = ctx.getSocket('world');
  if (socket) {
    writeRdoFrame(socket, rdoCall(
      'MsgCompositionChanged', ctx.worldContextId!, RdoValue.int(state),
    ).toFrame());
  }
}

export async function setChatTypingStatus(ctx: SessionContext, isTyping: boolean): Promise<void> {
  pushCompositionState(ctx, isTyping ? 1 : 0);
}

/**
 * Announce the away state (`/afk`) — mstAFK, Protocol.pas:121. Chat-command handling
 * (client `chat-commands.ts`) is what decides a message means "go away"; this only
 * pushes the state the same way `setChatTypingStatus` does.
 */
export async function setChatAwayStatus(ctx: SessionContext): Promise<void> {
  pushCompositionState(ctx, COMPOSITION_AWAY);
}

/**
 * Start following another player's camera.
 *
 * `function Chase( UserName : widestring ) : OleVariant` — InterfaceServer.pas:189.
 * A function: "^" and a QueryId are derived from the catalogue, and the server
 * answers `res="#<code>"`. The body (InterfaceServer.pas:1579-1607) looks the
 * target up by name, refuses self / an unknown name / a user already chasing
 * us with ERROR_InvalidUserName = 12 (Protocol.pas:41), otherwise inserts us
 * into the target's chaser list and immediately pushes a MoveTo onto their
 * viewport centre. NOERROR = 0 (Protocol.pas:29).
 */
export async function chaseUser(ctx: SessionContext, userName: string): Promise<void> {
  if (!ctx.worldContextId) throw new Error('Not logged into world');

  ctx.log.debug(`[Chat] Chasing user: ${userName}`);

  const packet = await ctx.sendRdoRequest('world', rdoCall(
    'Chase', ctx.worldContextId, RdoValue.string(userName),
  ).packet, undefined, TimeoutCategory.NORMAL);

  const result = parsePropertyResponseHelper(packet.payload || '', 'res');
  if (result === '0') {
    ctx.log.debug(`[Chat] Now chasing: ${userName}`);
    return;
  }
  const code = Number.parseInt(result, 10);
  if (code === ERROR_InvalidUserName) {
    throw new ChaseError(
      ERROR_InvalidUserName,
      `Cannot follow ${userName}: unknown, offline, or already following you`,
    );
  }
  throw new ChaseError(Number.isNaN(code) ? ERROR_Unknown : code, `Chase failed: ${result}`);
}

/**
 * Stop following.
 *
 * `function StopChase : OleVariant` — InterfaceServer.pas:190. A 0-arg
 * function, the same emitted form as GetUserList above. The body
 * (InterfaceServer.pas:1610-1632) removes us from the target's chaser list and
 * answers ERROR_Unknown = 1 (Protocol.pas:30) when we were not chasing anyone.
 * That is not a failure for us: the reference client clears its own chase
 * state in a `finally`, regardless of the answer
 * (Voyager.1/URLHandlers/ServerCnxHandler.pas:1916-1919), so we resolve either
 * way and only log the non-zero code.
 */
export async function stopChase(ctx: SessionContext): Promise<void> {
  if (!ctx.worldContextId) throw new Error('Not logged into world');

  ctx.log.debug('[Chat] Stopping chase...');

  const packet = await ctx.sendRdoRequest('world', rdoCall(
    'StopChase', ctx.worldContextId,
  ).packet, undefined, TimeoutCategory.NORMAL);

  const result = parsePropertyResponseHelper(packet.payload || '', 'res');
  if (result !== '0') {
    ctx.log.debug(`[Chat] StopChase returned ${result} (was not chasing) — clearing anyway`);
  }
}

/**
 * Get current channel name.
 *
 * NOTE: Requires `readonly currentChannel: string | null` on SessionContext.
 * Add it to session-context.ts if not already present.
 */
export function getCurrentChannel(ctx: SessionContext): string {
  return (ctx as SessionContext & { currentChannel: string | null }).currentChannel || 'Lobby';
}
