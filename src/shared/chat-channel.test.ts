/**
 * The New Channel form rules.
 *
 * Rules 1 and 3 are Voyager's `btnCreate.Enabled`
 * (`Voyager.1/URLHandlers/NewChannelForm.pas:57-60`) transcribed, including the
 * case-INSENSITIVE password comparison — the server compares uppercased too
 * (`InterfaceServer.pas:1543`), so a case-sensitive check here would refuse a
 * form the server would have accepted.
 *
 * Rule 2 has no Delphi counterpart: `'Lobby'` is the WebClient's own display
 * name for the wire name `''`.
 */

import { describe, it, expect } from '@jest/globals';
import { CHANNEL_USER_LIMIT, channelFormProblem } from './chat-channel';

describe('CHANNEL_USER_LIMIT', () => {
  it('is the 100 the reference client sent (ChatHandlerViewer.pas:221)', () => {
    expect(CHANNEL_USER_LIMIT).toBe(100);
  });
});

describe('channelFormProblem', () => {
  const cases: Array<[string, string, string, string | null]> = [
    ['', '', '', 'Channel name cannot be empty'],
    ['   ', '', '', 'Channel name cannot be empty'],
    ['Lobby', '', '', '"Lobby" is the default channel — choose another name'],
    ['  lobby ', '', '', '"Lobby" is the default channel — choose another name'],
    ['x', 'a', 'b', 'The two passwords do not match'],
    ['x', 'SECRET', 'secret', null],
    ['x', 'secret', 'secret', null],
    ['Traders', '', '', null],
  ];

  it.each(cases)('(%p, %p, %p) -> %p', (name, password, confirm, expected) => {
    expect(channelFormProblem(name, password, confirm)).toBe(expected);
  });

  it('refuses the empty name before it looks at the passwords', () => {
    expect(channelFormProblem('', 'a', 'b')).toBe('Channel name cannot be empty');
  });

  it('does not cap the length — TChannel.Create stores the name raw (InterfaceServer.pas:4591)', () => {
    expect(channelFormProblem('x'.repeat(500), '', '')).toBeNull();
  });
});
