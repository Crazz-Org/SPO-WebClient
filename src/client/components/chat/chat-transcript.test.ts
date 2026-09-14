/**
 * Tests for chat-transcript: pure formatting/filtering helpers behind the
 * chat history modal — no React, no store.
 */

import { describe, it, expect } from '@jest/globals';
import { transcriptLine, formatTranscript, filterTranscript } from './chat-transcript';
import type { ChatMessage } from '../../store/chat-store';

function msg(from: string, text: string, isSystem = false): ChatMessage {
  return { id: `${from}-${text}`, from, text, timestamp: 0, isSystem, isGM: false };
}

describe('transcriptLine', () => {
  it('formats a message as "name: text"', () => {
    expect(transcriptLine(msg('Alice', 'Hello there'))).toBe('Alice: Hello there');
  });

  it('formats a system line the same way', () => {
    expect(transcriptLine(msg('SYSTEM', 'You are now away', true))).toBe('SYSTEM: You are now away');
  });
});

describe('formatTranscript', () => {
  it('joins every message as "name: text", newline-separated, oldest first', () => {
    const messages = [msg('Alice', 'Hi'), msg('Bob', 'Hey'), msg('SYSTEM', 'Bob left', true)];
    expect(formatTranscript(messages)).toBe('Alice: Hi\nBob: Hey\nSYSTEM: Bob left');
  });

  it('returns an empty string for an empty transcript', () => {
    expect(formatTranscript([])).toBe('');
  });
});

describe('filterTranscript', () => {
  const messages = [
    msg('Alice', 'Selling steel'),
    msg('Bob', 'Anyone buying ore?'),
    msg('Carol', 'Hi Alice'),
  ];

  it('returns everything for an empty query', () => {
    expect(filterTranscript(messages, '')).toEqual(messages);
  });

  it('returns everything for a whitespace-only query', () => {
    expect(filterTranscript(messages, '   ')).toEqual(messages);
  });

  it('matches the sender name', () => {
    expect(filterTranscript(messages, 'Alice')).toEqual([messages[0], messages[2]]);
  });

  it('matches a word in the body', () => {
    expect(filterTranscript(messages, 'steel')).toEqual([messages[0]]);
  });

  it('is case-insensitive', () => {
    expect(filterTranscript(messages, 'ALICE')).toEqual([messages[0], messages[2]]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterTranscript(messages, 'nonexistent')).toEqual([]);
  });
});
