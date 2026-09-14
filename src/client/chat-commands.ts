/**
 * Chat commands — `/go x,y` and `/afk`, and the coordinate-linkification of a received line.
 *
 * Legacy evidence (`~/SPO-Original`):
 * - `Voyager/URLHandlers/ChatHandler.pas:10-12` declares the tokens: `tidChatCMD_Move = '/go'`,
 *   `tidChatCMD_AFK = '/AFK'`.
 * - `Voyager/URLHandlers/ChatHandler.pas:88-132` (`ExecChatCmdURL`) parses `/go x,y` into a
 *   `MoveTo`; `/AFK` raises `evnChatAFK`.
 * - `Voyager/URLHandlers/ChatHandler.pas:183-189` (`OnMessageComposed`): the line is only spoken
 *   when `ExecChatCmdURL` returned false — an unrecognised `/word` is sent as ordinary text.
 * - `Voyager/URLHandlers/ChatHandler.pas:306-311`: `evnChatAFK` -> `OnMessageCompositionChanged(mstAFK)`.
 * - `Protocol/Protocol.pas:121`: `TMsgCompositionState = (mstIdle, mstComposing, mstAFK)`, so
 *   `mstAFK = 2`.
 *
 * Deliberate divergence: `ExecChatCmdURL` used `pos()`, matching `/go` anywhere in the line — "let's
 * go 5,5 later" would have been swallowed and never spoken. This table matches the trimmed prefix
 * only, so a sentence a player meant to say is never captured as a command.
 *
 * Clickable coordinates have no legacy citation — `Voyager/Components/ChatRenderer.pas` never
 * linkified a received line. This is a modern affordance (`doc/ux/missing-features.md`, row N5).
 */

export type ChatCommandOutcome = 'handled' | 'not-handled';

export interface ChatCommandContext {
  /** Move the camera to a world tile. */
  moveTo(x: number, y: number): void;
  /** Announce the away state (composition state 2) to the server. */
  setAway(): void;
  /** Retract the "typing…" notice — the box is empty again. */
  endComposition(): void;
  /** Say something to this player only; never broadcast. */
  tellPlayer(message: string): void;
}

const GO_ARG_PATTERN = /^(\d{1,4})\s*[,; ]\s*(\d{1,4})$/;

export function runChatCommand(text: string, ctx: ChatCommandContext): ChatCommandOutcome {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  if (upper === '/GO' || upper.startsWith('/GO ')) {
    const arg = trimmed.slice(3).trim();
    const match = GO_ARG_PATTERN.exec(arg);
    if (match) {
      ctx.moveTo(parseInt(match[1], 10), parseInt(match[2], 10));
    } else {
      ctx.tellPlayer('Usage: /go x,y');
    }
    ctx.endComposition();
    return 'handled';
  }

  if (upper === '/AFK' || upper.startsWith('/AFK ')) {
    ctx.setAway();
    return 'handled';
  }

  return 'not-handled';
}

export type ChatSegment =
  | { kind: 'text'; text: string }
  | { kind: 'coord'; text: string; x: number; y: number };

// A coordinate pair, not glued to another digit or a decimal point on either side, so
// "3.14,159" or "x12,3" is never mistaken for a tile.
const COORD_PATTERN = /(?<![.\d])(\d{1,4})\s*,\s*(\d{1,4})(?!\d)(?!\.\d)/g;

/**
 * A group with a leading zero, longer than one digit, is rejected: it means a thousands
 * separator (`1,000`, `12,500`), not a tile coordinate.
 */
function hasSpuriousLeadingZero(group: string): boolean {
  return group.length > 1 && group[0] === '0';
}

/** Split a received line into plain runs and clickable "x,y" coordinates. */
export function splitChatCoordinates(text: string): ChatSegment[] {
  const segments: ChatSegment[] = [];
  let lastIndex = 0;
  COORD_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = COORD_PATTERN.exec(text)) !== null) {
    const [full, xStr, yStr] = match;
    if (hasSpuriousLeadingZero(xStr) || hasSpuriousLeadingZero(yStr)) continue;

    if (match.index > lastIndex) {
      segments.push({ kind: 'text', text: text.slice(lastIndex, match.index) });
    }
    segments.push({ kind: 'coord', text: full, x: parseInt(xStr, 10), y: parseInt(yStr, 10) });
    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length || segments.length === 0) {
    segments.push({ kind: 'text', text: text.slice(lastIndex) });
  }

  return segments;
}
