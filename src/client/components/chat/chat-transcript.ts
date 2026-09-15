/**
 * Pure transcript helpers for the chat history view — no React, no store access.
 */

import type { ChatMessage } from '../../store/chat-store';

/** One transcript line, the form "copy all" yields: `name: text`. */
export function transcriptLine(message: ChatMessage): string {
  return `${message.from}: ${message.text}`;
}

/** Every message as `name: text`, newline-separated, oldest first. */
export function formatTranscript(messages: ChatMessage[]): string {
  return messages.map(transcriptLine).join('\n');
}

/**
 * Case-insensitive substring filter over the rendered `name: text` line. An empty
 * or whitespace-only query returns the input unchanged (same array contents, order kept).
 */
export function filterTranscript(messages: ChatMessage[], query: string): ChatMessage[] {
  const trimmed = query.trim();
  if (!trimmed) return messages;
  const needle = trimmed.toLowerCase();
  return messages.filter((m) => transcriptLine(m).toLowerCase().includes(needle));
}
