/**
 * Turns a caught error into a sentence for the player.
 *
 * The raw error text ("Request Timeout", a gateway default code's label such as
 * "Access denied") is written for a developer, and the code label is often wrong: gateway
 * handlers answer every failure with a fixed default code. So the player only ever reads the
 * failure's class; the raw detail goes to one console.warn line, which the bug-report journal
 * records.
 */
import { toErrorMessage } from '../shared/error-utils';

/** The texts client.ts itself rejects with — client.ts throws with these constants. */
export const REQUEST_TIMEOUT_MESSAGE = 'Request Timeout';
export const NOT_CONNECTED_MESSAGE = 'WebSocket not connected';
export const DISCONNECTED_MESSAGE = 'Disconnected';

export type PlayerErrorClass = 'timeout' | 'not-connected' | 'server' | 'other';

const REASONS: Record<PlayerErrorClass, string> = {
  timeout: 'the server did not answer in time',
  'not-connected': 'you are not connected to the game right now',
  server: 'the game server could not do it',
  other: 'something went wrong',
};

/** Which class a caught value falls into. The message is checked before the code. */
export function classifyPlayerError(err: unknown): PlayerErrorClass {
  if (err instanceof Error) {
    if (err.message === REQUEST_TIMEOUT_MESSAGE) return 'timeout';
    if (err.message === NOT_CONNECTED_MESSAGE || err.message === DISCONNECTED_MESSAGE) return 'not-connected';
  }
  if (typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'number') {
    return 'server';
  }
  return 'other';
}

/** Classifies and writes one console.warn line (one string argument) with the raw detail. */
function record(err: unknown, action?: string): PlayerErrorClass {
  const cls = classifyPlayerError(err);
  const parts = ['[player-error]'];
  if (action) parts.push(`action="${action}"`);
  parts.push(`class=${cls}`, `message="${toErrorMessage(err)}"`);
  if (typeof err === 'object' && err !== null) {
    const { code, serverMessage } = err as { code?: unknown; serverMessage?: unknown };
    if (typeof code === 'number') parts.push(`code=${code}`);
    if (typeof serverMessage === 'string' && serverMessage) parts.push(`serverMessage="${serverMessage}"`);
  }
  console.warn(parts.join(' '));
  return cls;
}

/** A short clause naming the class of the failure — never its raw text. */
export function playerErrorReason(err: unknown): string {
  return REASONS[record(err)];
}

/** The full sentence: "Could not <action> — <reason>. Try again." */
export function playerErrorMessage(action: string, err: unknown): string {
  return `Could not ${action} — ${REASONS[record(err, action)]}. Try again.`;
}
