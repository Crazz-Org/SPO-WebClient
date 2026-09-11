/**
 * Tests for mail-store: folder navigation and loading state.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { useMailStore, buildReplyBody, buildReplyHeaders, REPLY_SEPARATOR } from './mail-store';
import type { MailMessageHeader, MailMessageFull } from '@/shared/types';

const mockMessages: MailMessageHeader[] = [
  { messageId: 'msg-1', fromAddr: 'alice@test.com', toAddr: 'me@test.com', from: 'Alice', to: 'Me', subject: 'Hello', date: '1.0', dateFmt: 'Jan 1', read: false, stamp: 42, noReply: false },
  { messageId: 'msg-2', fromAddr: 'bob@test.com', toAddr: 'me@test.com', from: 'Bob', to: 'Me', subject: 'World', date: '2.0', dateFmt: 'Jan 2', read: true, stamp: 7, noReply: false },
];

const mockFullMessage: MailMessageFull = {
  messageId: 'msg-1', fromAddr: 'alice@test.com', toAddr: 'me@test.com',
  from: 'Alice', to: 'Me', subject: 'Hello', date: '1.0', dateFmt: 'Jan 1',
  read: true, stamp: 42, noReply: false,
  body: ['Test body'], attachments: [],
};

function resetStore() {
  useMailStore.setState({
    currentFolder: 'Inbox',
    currentView: 'list',
    messages: [],
    currentMessage: null,
    unreadCount: 0,
    isLoading: false,
    composeTo: '',
    composeSubject: '',
    composeBody: '',
    composeHeaders: '',
    composeDraftId: null,
    isSavingDraft: false,
  });
}

describe('Mail Store — Folder switching', () => {
  beforeEach(resetStore);

  it('setFolder clears messages and sets isLoading to true', () => {
    // Pre-populate with messages from Inbox
    useMailStore.getState().setMessages(mockMessages);
    expect(useMailStore.getState().messages).toHaveLength(2);
    expect(useMailStore.getState().isLoading).toBe(false);

    // Switch folder
    useMailStore.getState().setFolder('Sent');

    const state = useMailStore.getState();
    expect(state.currentFolder).toBe('Sent');
    expect(state.messages).toHaveLength(0);
    expect(state.isLoading).toBe(true);
    expect(state.currentMessage).toBeNull();
    expect(state.currentView).toBe('list');
  });

  it('setMessages clears isLoading', () => {
    useMailStore.getState().setFolder('Draft');
    expect(useMailStore.getState().isLoading).toBe(true);

    useMailStore.getState().setMessages(mockMessages);
    expect(useMailStore.getState().isLoading).toBe(false);
    expect(useMailStore.getState().messages).toHaveLength(2);
  });

  it('setFolder resets currentMessage', () => {
    useMailStore.getState().setCurrentMessage(mockFullMessage);
    expect(useMailStore.getState().currentMessage).not.toBeNull();

    useMailStore.getState().setFolder('Sent');
    expect(useMailStore.getState().currentMessage).toBeNull();
  });
});

describe('Mail Store — Compose', () => {
  beforeEach(resetStore);

  it('startCompose sets compose fields and view', () => {
    useMailStore.getState().startCompose('test@test.com', 'Subject', 'Body');
    const state = useMailStore.getState();
    expect(state.currentView).toBe('compose');
    expect(state.composeTo).toBe('test@test.com');
    expect(state.composeSubject).toBe('Subject');
    expect(state.composeBody).toBe('Body');
  });

  it('clearCompose resets compose fields and returns to list', () => {
    useMailStore.getState().startCompose('test@test.com', 'Subject', 'Body');
    useMailStore.getState().clearCompose();
    const state = useMailStore.getState();
    expect(state.currentView).toBe('list');
    expect(state.composeTo).toBe('');
    expect(state.composeSubject).toBe('');
    expect(state.composeBody).toBe('');
  });

  it('startReply pre-fills to and subject from message', () => {
    useMailStore.getState().startReply(mockFullMessage);
    const state = useMailStore.getState();
    expect(state.currentView).toBe('compose');
    expect(state.composeTo).toBe('alice@test.com');
    expect(state.composeSubject).toBe('Re: Hello');
  });

  it('refreshFolder bumps the token and shows the listing as loading', () => {
    const before = useMailStore.getState().folderRefreshToken;
    useMailStore.setState({ isLoading: false });
    useMailStore.getState().refreshFolder();
    const state = useMailStore.getState();
    expect(state.folderRefreshToken).toBe(before + 1);
    expect(state.isLoading).toBe(true);
  });

  it('startReply does not double-prefix Re:', () => {
    useMailStore.getState().startReply({
      ...mockFullMessage,
      subject: 'Re: Already replied',
    });
    expect(useMailStore.getState().composeSubject).toBe('Re: Already replied');
  });

  it('startReply does not double-prefix a lower-case re:', () => {
    useMailStore.getState().startReply({ ...mockFullMessage, subject: 're: shouting quietly' });
    expect(useMailStore.getState().composeSubject).toBe('re: shouting quietly');
  });
});

// #507 — Reply opened an empty letter: nothing quoted, and no header saying
// which message it answered.
describe('Mail Store — Reply quoting', () => {
  beforeEach(resetStore);

  it('startReply opens the body with the separator, the attribution and the quoted lines', () => {
    useMailStore.getState().startReply(mockFullMessage);
    expect(useMailStore.getState().composeBody).toBe(
      [REPLY_SEPARATOR, 'Alice wrote, on "Hello":', '> Test body'].join('\n'),
    );
  });

  it('prefixes every source line, blank ones included', () => {
    const body = buildReplyBody({ ...mockFullMessage, body: ['first', '', 'third'] });
    expect(body.split('\n')).toEqual([
      REPLY_SEPARATOR,
      'Alice wrote, on "Hello":',
      '> first',
      '> ',
      '> third',
    ]);
  });

  it('the separator is the 39 underscores of the original client', () => {
    expect(REPLY_SEPARATOR).toBe('_'.repeat(39));
    expect(buildReplyBody(mockFullMessage).startsWith(REPLY_SEPARATOR)).toBe(true);
  });

  it('names the address when the message carries no display name', () => {
    const body = buildReplyBody({ ...mockFullMessage, from: '' });
    expect(body.split('\n')[1]).toBe('alice@test.com wrote, on "Hello":');
  });

  it('an empty source message still quotes nothing more than the separator and the attribution', () => {
    expect(buildReplyBody({ ...mockFullMessage, body: [] }).split('\n')).toHaveLength(2);
  });

  it('startReply carries the source message under the four threading keys', () => {
    useMailStore.getState().startReply(mockFullMessage);
    expect(useMailStore.getState().composeHeaders).toBe(
      [
        'In-Reply-To=msg-1',
        'In-Reply-To-From=alice@test.com',
        'In-Reply-To-Subject=Hello',
        'In-Reply-To-Date=1.0',
      ].join('\n'),
    );
  });

  it('the header block names no key the mail server sets on the new message', () => {
    const keys = buildReplyHeaders(mockFullMessage).split('\n').map((l) => l.split('=')[0]);
    expect(keys).not.toContain('MessageId');
    expect(keys).not.toContain('FromAddr');
    expect(keys).not.toContain('Subject');
    expect(keys).not.toContain('Date');
  });

  it('a fresh compose and a re-opened draft carry no reply body or headers', () => {
    useMailStore.getState().startReply(mockFullMessage);
    useMailStore.getState().startCompose();
    expect(useMailStore.getState().composeBody).toBe('');
    expect(useMailStore.getState().composeHeaders).toBe('');

    useMailStore.getState().startReply(mockFullMessage);
    useMailStore.getState().startEditDraft({ ...mockFullMessage, messageId: 'draft-4' });
    expect(useMailStore.getState().composeHeaders).toBe('');
  });
});

// #509 — Forward opens the composer with an empty To, a `Fw: `-prefixed subject and
// the source body quoted, the same shape as Reply's quoting.
describe('Mail Store — Forward', () => {
  beforeEach(resetStore);

  it('startForward opens compose with an empty To, a Fw: subject and the quoted body', () => {
    useMailStore.getState().startForward(mockFullMessage);
    const state = useMailStore.getState();
    expect(state.currentView).toBe('compose');
    expect(state.composeTo).toBe('');
    expect(state.composeSubject).toBe('Fw: Hello');
    expect(state.composeBody).toBe(buildReplyBody(mockFullMessage));
    expect(state.composeBody).toBe(
      [REPLY_SEPARATOR, 'Alice wrote, on "Hello":', '> Test body'].join('\n'),
    );
    expect(state.composeHeaders).toBe('');
    expect(state.composeDraftId).toBeNull();
  });

  it('startForward does not double-prefix Fw:', () => {
    useMailStore.getState().startForward({ ...mockFullMessage, subject: 'Fw: Already sent' });
    expect(useMailStore.getState().composeSubject).toBe('Fw: Already sent');
  });

  it('startForward does not double-prefix a lower-case fw:', () => {
    useMailStore.getState().startForward({ ...mockFullMessage, subject: 'fw: lower case' });
    expect(useMailStore.getState().composeSubject).toBe('fw: lower case');
  });

  it('a noReply message still forwards', () => {
    useMailStore.getState().startForward({ ...mockFullMessage, noReply: true });
    expect(useMailStore.getState().currentView).toBe('compose');
    expect(useMailStore.getState().composeSubject).toBe('Fw: Hello');
  });
});

// #120 — the compose form has to say WHICH draft it came from, or saving an edited
// draft leaves the old copy beside the new one.
describe('Mail Store — Drafts', () => {
  beforeEach(resetStore);

  it('startEditDraft re-opens the draft with its recipient, subject, body and id', () => {
    useMailStore.getState().startEditDraft({
      ...mockFullMessage,
      messageId: 'draft-4',
      toAddr: 'bob@test.com',
      subject: 'Half written',
      body: ['line one', 'line two'],
    });
    const state = useMailStore.getState();
    expect(state.currentView).toBe('compose');
    expect(state.composeTo).toBe('bob@test.com');
    expect(state.composeSubject).toBe('Half written');
    expect(state.composeBody).toBe('line one\nline two');
    expect(state.composeDraftId).toBe('draft-4');
  });

  it('startEditDraft falls back to the display name when there is no address', () => {
    useMailStore.getState().startEditDraft({ ...mockFullMessage, toAddr: '', to: 'Me' });
    expect(useMailStore.getState().composeTo).toBe('Me');
  });

  it('a fresh compose and a reply carry no draft id — saving them must create a new draft', () => {
    useMailStore.getState().startEditDraft({ ...mockFullMessage, messageId: 'draft-4' });
    useMailStore.getState().startCompose();
    expect(useMailStore.getState().composeDraftId).toBeNull();

    useMailStore.getState().startEditDraft({ ...mockFullMessage, messageId: 'draft-4' });
    useMailStore.getState().startReply(mockFullMessage);
    expect(useMailStore.getState().composeDraftId).toBeNull();
  });

  it('clearCompose forgets the draft id and releases the save lock', () => {
    useMailStore.getState().startEditDraft({ ...mockFullMessage, messageId: 'draft-4' });
    useMailStore.getState().setSavingDraft(true);
    useMailStore.getState().clearCompose();
    const state = useMailStore.getState();
    expect(state.composeDraftId).toBeNull();
    expect(state.isSavingDraft).toBe(false);
    expect(state.currentView).toBe('list');
  });

  it('setSavingDraft toggles the in-flight flag', () => {
    useMailStore.getState().setSavingDraft(true);
    expect(useMailStore.getState().isSavingDraft).toBe(true);
    useMailStore.getState().setSavingDraft(false);
    expect(useMailStore.getState().isSavingDraft).toBe(false);
  });
});
