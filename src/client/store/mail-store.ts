/**
 * Mail Store — Folder navigation, message list, compose state.
 */

import { create } from 'zustand';
import type {
  MailFolder,
  MailMessageHeader,
  MailMessageFull,
} from '@/shared/types';

type MailView = 'list' | 'read' | 'compose';

/**
 * The rule above the quoted text of a reply — 39 underscores, exactly the
 * `tidMessageSeparator` the original client inserted
 * (Voyager/URLHandlers/MsgComposerHandler.pas:32).
 */
export const REPLY_SEPARATOR = '_______________________________________';

/**
 * The quoted body of a reply: the separator, who wrote what, then every source
 * line prefixed `> ` — the shape of `CopyLines('> ')` and the three inserts
 * above it (MsgComposerHandler.pas:200-205). The sender is the display name
 * when the message carries one, the address otherwise (`:193-195`).
 */
export function buildReplyBody(message: MailMessageFull): string {
  const sender = message.from || message.fromAddr;
  return [
    REPLY_SEPARATOR,
    `${sender} wrote, on "${message.subject}":`,
    ...message.body.map((line) => `> ${line}`),
  ].join('\n');
}

/**
 * What the reply carries about the message it answers, one `key=value` per
 * line — the same block form the mail server's own `GetHeaders` answers with.
 *
 * Only keys no server code writes: `NewMail` sets `MessageId`, `FromAddr`,
 * `Subject` and `Date` on the new message itself (Mail Server/MailServer.pas:946-951)
 * and `Post` uses `Header[MessageId]` as the folder name (`:1062`), so re-sending
 * any of those would at best duplicate them and at worst redirect the delivery.
 */
export function buildReplyHeaders(message: MailMessageFull): string {
  return [
    `In-Reply-To=${message.messageId}`,
    `In-Reply-To-From=${message.fromAddr}`,
    `In-Reply-To-Subject=${message.subject}`,
    `In-Reply-To-Date=${message.date}`,
  ].join('\n');
}

interface MailState {
  // State
  currentFolder: MailFolder;
  currentView: MailView;
  messages: MailMessageHeader[];
  currentMessage: MailMessageFull | null;
  unreadCount: number;
  isLoading: boolean;

  // Compose
  composeTo: string;
  composeSubject: string;
  composeBody: string;
  composeHeaders: string;
  /**
   * The draft this compose form was opened from, or null for a fresh letter.
   *
   * Saving **or sending** sends it as `existingDraftId` so the server deletes the
   * old copy instead of leaving two (`saveDraft`, and `composeMail` once Post succeeds).
   */
  composeDraftId: string | null;
  /**
   * The compose form opened with an empty To that the player must fill (Forward), so the
   * caret starts there — `MsgComposerHandlerViewer.pas:155`.
   */
  composeFocusTo: boolean;
  /** A send is in flight — the compose form is kept until the server answers (T6). */
  isSending: boolean;
  /** A draft save is in flight — the form is locked so one click cannot make two drafts. */
  isSavingDraft: boolean;
  /** A message is being fetched after a click on its row. */
  isMessageLoading: boolean;
  /** The id a delete was requested for — removed from the list when the server confirms. */
  pendingDeleteId: string | null;
  /**
   * Bumped whenever the open folder must be read again.
   *
   * The bridge is the inbound half of the client and holds no socket, so it
   * cannot re-issue REQ_MAIL_GET_FOLDER itself. The panel's fetch effect
   * watches this counter alongside the folder, which is the same path that
   * loaded the folder in the first place (OB-11).
   */
  folderRefreshToken: number;

  // Actions
  setFolder: (folder: MailFolder) => void;
  setView: (view: MailView) => void;
  setMessages: (messages: MailMessageHeader[]) => void;
  setCurrentMessage: (message: MailMessageFull | null) => void;
  setUnreadCount: (count: number) => void;
  setLoading: (loading: boolean) => void;
  startCompose: (to?: string, subject?: string, body?: string, headers?: string) => void;
  startReply: (message: MailMessageFull) => void;
  /**
   * Open the compose form with an empty To, a `Fw: ` subject and the source message
   * quoted — `MsgComposerHandler.pas:216-243`.
   */
  startForward: (message: MailMessageFull) => void;
  /** Re-open a saved draft in the compose form, remembering the copy to replace. */
  startEditDraft: (message: MailMessageFull) => void;
  clearCompose: () => void;
  /** Edit one compose field — the form is store-driven so Reply's prefill reaches it. */
  setComposeField: (field: 'to' | 'subject' | 'body', value: string) => void;
  setSending: (sending: boolean) => void;
  setSavingDraft: (saving: boolean) => void;
  setMessageLoading: (loading: boolean) => void;
  setPendingDeleteId: (id: string | null) => void;
  /** Drop a message from the current list (after a confirmed delete) — no refetch needed. */
  removeMessage: (messageId: string) => void;
  /** Ask the open folder to be read again — the panel's fetch effect answers. */
  refreshFolder: () => void;
}

export const useMailStore = create<MailState>((set) => ({
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
  composeFocusTo: false,
  isSending: false,
  isSavingDraft: false,
  isMessageLoading: false,
  pendingDeleteId: null,
  folderRefreshToken: 0,

  setFolder: (folder) => set({ currentFolder: folder, currentView: 'list', currentMessage: null, messages: [], isLoading: true }),
  setView: (view) => set({ currentView: view }),
  setMessages: (messages) => set({ messages, isLoading: false }),
  setCurrentMessage: (message) => set({ currentMessage: message, currentView: message ? 'read' : 'list', isLoading: false, isMessageLoading: false }),
  setUnreadCount: (count) => set({ unreadCount: count }),
  setLoading: (loading) => set({ isLoading: loading }),

  startCompose: (to = '', subject = '', body = '', headers = '') =>
    set({
      currentView: 'compose',
      composeTo: to,
      composeSubject: subject,
      composeBody: body,
      composeHeaders: headers,
      composeDraftId: null,
      composeFocusTo: false,
    }),

  startReply: (message) =>
    set({
      currentView: 'compose',
      composeTo: message.fromAddr,
      // Case-insensitive, as the Pascal's `pos(…, UpperCase(Subj))` test is —
      // a subject already answered once must not collect a second prefix.
      composeSubject: /^re:/i.test(message.subject.trim()) ? message.subject : `Re: ${message.subject}`,
      composeBody: buildReplyBody(message),
      composeHeaders: buildReplyHeaders(message),
      composeDraftId: null,
      composeFocusTo: false,
    }),

  startForward: (message) =>
    set({
      currentView: 'compose',
      composeTo: '',
      // Same case-insensitive test as Reply (MsgComposerHandler.pas:227-229).
      composeSubject: /^fw:/i.test(message.subject.trim()) ? message.subject : `Fw: ${message.subject}`,
      composeBody: buildReplyBody(message),
      composeHeaders: '',
      composeDraftId: null,
      composeFocusTo: true,
    }),

  startEditDraft: (message) =>
    set({
      currentView: 'compose',
      composeTo: message.toAddr || message.to,
      composeSubject: message.subject,
      composeBody: message.body.join('\n'),
      composeHeaders: '',
      composeDraftId: message.messageId,
      isMessageLoading: false,
      composeFocusTo: false,
    }),

  clearCompose: () =>
    set({
      composeTo: '',
      composeSubject: '',
      composeBody: '',
      composeHeaders: '',
      composeDraftId: null,
      currentView: 'list',
      isSending: false,
      isSavingDraft: false,
      composeFocusTo: false,
    }),

  setComposeField: (field, value) =>
    set(field === 'to' ? { composeTo: value } : field === 'subject' ? { composeSubject: value } : { composeBody: value }),
  setSending: (sending) => set({ isSending: sending }),
  setSavingDraft: (saving) => set({ isSavingDraft: saving }),
  setMessageLoading: (loading) => set({ isMessageLoading: loading }),
  setPendingDeleteId: (id) => set({ pendingDeleteId: id }),
  removeMessage: (messageId) =>
    set((s) => ({
      pendingDeleteId: s.pendingDeleteId === messageId ? null : s.pendingDeleteId,
      messages: s.messages.filter((m) => m.messageId !== messageId),
      currentMessage: s.currentMessage?.messageId === messageId ? null : s.currentMessage,
      currentView: s.currentMessage?.messageId === messageId ? 'list' : s.currentView,
    })),
  refreshFolder: () => set((s) => ({ folderRefreshToken: s.folderRefreshToken + 1, isLoading: true })),

}));
