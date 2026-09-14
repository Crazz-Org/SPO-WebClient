/**
 * The rules a "New Channel" form is held to, shared by the modal, the gateway
 * tests and the L1 scenario so there is one copy of each rather than four.
 */

/** `anUserLimit` as the reference client's New Channel dialog sends it — ChatHandlerViewer.pas:221. */
export const CHANNEL_USER_LIMIT = 100;

/**
 * The reason Create must stay refused, or null when the form may be submitted.
 *
 * Rules 1 and 3 are `btnCreate.Enabled` transcribed from the reference client
 * (`Voyager.1/URLHandlers/NewChannelForm.pas:57-60`), case-insensitivity
 * included — the server compares uppercased too (`InterfaceServer.pas:1543`).
 *
 * Rule 2 has no Delphi counterpart, and it is ours. `'Lobby'` is a WebClient
 * invention: the gateway synthesises it as the display name for the wire name
 * `''` (`chat-handler.ts:59-63`) and the dropdown maps it back
 * (`ChatStrip.tsx:254`). Voyager had no alias, so it had no collision; without
 * the guard, a channel genuinely named "Lobby" would put two identical rows in
 * the dropdown and clicking either would join the *default* channel.
 *
 * There is deliberately NO maximum length: `TChannel.Create` stores the name raw
 * (`InterfaceServer.pas:4591`) and the server caps nothing.
 */
export function channelFormProblem(name: string, password: string, confirm: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Channel name cannot be empty';
  if (trimmed.toLowerCase() === 'lobby') return '"Lobby" is the default channel — choose another name';
  if (password.toUpperCase() !== confirm.toUpperCase()) return 'The two passwords do not match';
  return null;
}
