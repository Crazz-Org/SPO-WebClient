/**
 * Chat handler — extracted from StarpeaceSession.
 *
 * Every public function takes `ctx: SessionContext` as its first argument.
 * Private helpers (`parseChatUserList`, `parseChatChannelList`) are
 * module-private functions (not exported).
 */

import type { SessionContext } from './session-context';
import type { ChatUser } from '../../shared/types';
import { parseAccDesc } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { parsePropertyResponse as parsePropertyResponseHelper, writeRdoFrame } from '../rdo-helpers';

// =========================================================================
// PRIVATE HELPERS
// =========================================================================

/**
 * Parse user list format: "name/id/status\n..."
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
        status: parseInt(parts[2], 10) || 0,
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
 * Returns channel names only, with "Lobby" prepended as the default main channel.
 */
function parseChatChannelList(ctx: SessionContext, rawData: string): string[] {
  const lines = rawData
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // Extract only channel names (even-indexed lines: 0, 2, 4, ...)
  const channelNames: string[] = ['Lobby'];
  for (let i = 0; i < lines.length; i += 2) {
    channelNames.push(lines[i]);
  }

  ctx.log.debug(`[Chat] Parsed ${channelNames.length} channels (including Lobby)`);
  return channelNames;
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

export async function getChatChannelList(ctx: SessionContext): Promise<string[]> {
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

export async function joinChatChannel(ctx: SessionContext, channelName: string): Promise<void> {
  if (!ctx.worldContextId) throw new Error('Not logged into world');

  const displayName = channelName || 'Lobby';
  ctx.log.debug(`[Chat] Joining channel: ${displayName}`);

  // Explicit OLEString (P-M2) — see getChatChannelInfo. Same note on the
  // formerly unquoted separator.
  const packet = await ctx.sendRdoRequest('world', rdoCall(
    'JoinChannel', ctx.worldContextId,
    RdoValue.string(channelName), RdoValue.string(''),
  ).packet, undefined, TimeoutCategory.NORMAL);

  const result = parsePropertyResponseHelper(packet.payload || '', 'res');
  if (result !== '0') {
    throw new Error(`Failed to join channel: ${result}`);
  }

  ctx.setCurrentChannel(channelName);
  ctx.log.debug(`[Chat] Successfully joined: ${displayName}`);
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
  if (result === '12') {
    throw new Error(`Cannot follow ${userName}: unknown, offline, or already following you`);
  }
  throw new Error(`Chase failed: ${result}`);
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
