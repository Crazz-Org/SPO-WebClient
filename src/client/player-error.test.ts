import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  classifyPlayerError,
  playerErrorMessage,
  playerErrorReason,
  REQUEST_TIMEOUT_MESSAGE,
  NOT_CONNECTED_MESSAGE,
  DISCONNECTED_MESSAGE,
  type PlayerErrorClass,
} from './player-error';
import { getErrorMessage } from '../shared/error-codes';

let warn: jest.SpiedFunction<typeof console.warn>;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

interface Case { name: string; err: Error; cls: PlayerErrorClass; reason: string }

const CASES: Case[] = [
  { name: 'timeout', err: new Error(REQUEST_TIMEOUT_MESSAGE), cls: 'timeout', reason: 'the server did not answer in time' },
  { name: 'not connected', err: new Error(NOT_CONNECTED_MESSAGE), cls: 'not-connected', reason: 'you are not connected to the game right now' },
  { name: 'disconnected', err: new Error(DISCONNECTED_MESSAGE), cls: 'not-connected', reason: 'you are not connected to the game right now' },
  {
    name: 'server error',
    err: Object.assign(new Error('Access denied'), { code: 3, serverMessage: 'Nope' }),
    cls: 'server',
    reason: 'the game server could not do it',
  },
  { name: 'other', err: new Error('Company not found'), cls: 'other', reason: 'something went wrong' },
];

describe('player-error constants', () => {
  it('match the texts client.ts has always rejected with', () => {
    expect(REQUEST_TIMEOUT_MESSAGE).toBe('Request Timeout');
    expect(NOT_CONNECTED_MESSAGE).toBe('WebSocket not connected');
    expect(DISCONNECTED_MESSAGE).toBe('Disconnected');
  });
});

describe.each(CASES)('$name', ({ err, cls, reason }) => {
  it('falls into its class', () => {
    expect(classifyPlayerError(err)).toBe(cls);
  });

  it('gives the class reason, without the raw text', () => {
    const got = playerErrorReason(err);
    expect(got).toBe(reason);
    expect(got).not.toContain(err.message);
  });

  it('gives the full sentence, without the raw text', () => {
    const got = playerErrorMessage('do x', err);
    expect(got).toBe(`Could not do x — ${reason}. Try again.`);
    expect(got).not.toContain(err.message);
  });

  it('writes exactly one console.warn line per call, carrying the raw text', () => {
    playerErrorMessage('do x', err);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(line).toContain(err.message);
    expect(line).toContain(`class=${cls}`);
    expect(line).toContain('action="do x"');

    warn.mockClear();
    playerErrorReason(err);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(err.message);
    expect(String(warn.mock.calls[0][0])).not.toContain('action=');
  });
});

describe('server errors', () => {
  it('log the code and the gateway sentence', () => {
    const err = Object.assign(new Error('Access denied'), { code: 3, serverMessage: 'Nope' });
    playerErrorMessage('do x', err);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('code=3');
    expect(line).toContain('serverMessage="Nope"');
  });

  it('never carry the code label in what the player reads', () => {
    for (const code of [1, 3, 7, 999]) {
      const err = Object.assign(new Error('raw'), { code });
      const label = getErrorMessage(code);
      expect(playerErrorReason(err)).not.toContain(label);
      expect(playerErrorMessage('do x', err)).not.toContain(label);
    }
  });

  it('omit code and serverMessage from the log when absent', () => {
    playerErrorMessage('do x', new Error('Company not found'));
    const line = String(warn.mock.calls[0][0]);
    expect(line).not.toContain('code=');
    expect(line).not.toContain('serverMessage=');
  });

  it('are classed as a timeout when the message says timeout, even with a numeric code', () => {
    const err = Object.assign(new Error('Request Timeout'), { code: 7 });
    expect(classifyPlayerError(err)).toBe('timeout');
    expect(playerErrorReason(err)).toBe('the server did not answer in time');
  });
});

describe('non-Error thrown values', () => {
  it.each([['a string', 'boom'], ['null', null], ['an object with a non-numeric code', { code: 'x' }], ['undefined', undefined]])(
    '%s falls into "other"',
    (_name, value) => {
      expect(classifyPlayerError(value)).toBe('other');
      expect(playerErrorMessage('do x', value)).toBe('Could not do x — something went wrong. Try again.');
    },
  );

  it('the raw string still reaches the log line, never the sentence', () => {
    expect(playerErrorReason('boom')).not.toContain('boom');
    expect(String(warn.mock.calls[0][0])).toContain('message="boom"');
  });

  it('a plain object with a numeric code is a server error', () => {
    expect(classifyPlayerError({ code: 5 })).toBe('server');
  });
});
