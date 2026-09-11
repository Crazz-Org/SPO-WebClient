/**
 * MailPanel — Full mail client in the right panel.
 *
 * Three views: list (inbox/sent/drafts), read, compose.
 * Folder tabs at top, message list scrollable, compose form.
 */

import { useCallback, useEffect, useRef, useState, memo } from 'react';
import { Send, Trash2, Reply, Forward, PenSquare, Save } from 'lucide-react';
import { useMailStore } from '../../store/mail-store';
import { useUiStore } from '../../store/ui-store';
import { useClient } from '../../context';
import { TabBar, Skeleton, showToast, EmptyState } from '../common';
import type { MailFolder, MailMessageHeader } from '@/shared/types';
import { isHtmlContent } from '@/shared/mail-html-utils';
import { HtmlMailBody } from './HtmlMailBody';
import styles from './MailPanel.module.css';

const FOLDERS: { id: MailFolder; label: string; badge?: boolean }[] = [
  { id: 'Inbox', label: 'Inbox', badge: true },
  { id: 'Sent', label: 'Sent' },
  { id: 'Draft', label: 'Drafts' },
];

// What each folder holds, in the WebClient's own voice — carries the sense of
// Voyager.lng:81-83 (strClickInbox / strClickSent / strInDraft) without the "click the tab"
// framing, since the player is already on it.
export const EMPTY_FOLDER_TEXT: Record<MailFolder, { title: string; description: string }> = {
  Inbox: { title: 'Nothing received yet', description: 'Messages other tycoons send you land here.' },
  Sent: { title: 'Nothing sent yet', description: 'Every message you send is kept here.' },
  Draft: {
    title: 'No drafts',
    description: 'A draft is a message you saved before finishing it. Save one from Compose and it waits here.',
  },
};

// Client-side budget on a letter body — the server has no documented limit, so this is
// a sane cap chosen to keep a paste from silently becoming an unusable wall of text.
export const MAIL_BODY_MAX_CHARS = 10240;

interface MailMessageRowProps {
  msg: MailMessageHeader;
  isSentFolder: boolean;
  onClick: (msg: MailMessageHeader) => void;
  onDelete: (msg: MailMessageHeader) => void;
}

const MailMessageRow = memo(function MailMessageRow({ msg, isSentFolder, onClick, onDelete }: MailMessageRowProps) {
  const person = isSentFolder
    ? (msg.to || msg.toAddr || '')
    : (msg.from || msg.fromAddr || '');
  return (
    <div className={`${styles.messageRow} ${!msg.read ? styles.unread : ''}`}>
      <button className={styles.messageOpen} onClick={() => onClick(msg)}>
        <div className={styles.msgAvatar}>
          {(person || '?')[0].toUpperCase()}
        </div>
        <div className={styles.msgContent}>
          <div className={styles.msgHeader}>
            <span className={styles.msgSender}>{isSentFolder ? `To: ${person}` : person}</span>
            <span className={styles.msgDate}>{msg.dateFmt || msg.date}</span>
          </div>
          <span className={styles.msgSubject}>{msg.subject}</span>
        </div>
      </button>
      <button
        className={styles.rowDeleteBtn}
        onClick={() => onDelete(msg)}
        aria-label={`Delete “${msg.subject || '(no subject)'}”`}
        title="Delete"
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  );
});

export function MailPanel() {
  const currentFolder = useMailStore((s) => s.currentFolder);
  const currentView = useMailStore((s) => s.currentView);
  const messages = useMailStore((s) => s.messages);
  const currentMessage = useMailStore((s) => s.currentMessage);
  const unreadCount = useMailStore((s) => s.unreadCount);
  const isLoading = useMailStore((s) => s.isLoading);
  const folderRefreshToken = useMailStore((s) => s.folderRefreshToken);
  const setFolder = useMailStore((s) => s.setFolder);
  const setView = useMailStore((s) => s.setView);
  const startCompose = useMailStore((s) => s.startCompose);
  const startReply = useMailStore((s) => s.startReply);
  const startForward = useMailStore((s) => s.startForward);
  const clearCompose = useMailStore((s) => s.clearCompose);

  const composeTo = useMailStore((s) => s.composeTo);
  const composeSubject = useMailStore((s) => s.composeSubject);
  const composeBody = useMailStore((s) => s.composeBody);
  const setComposeField = useMailStore((s) => s.setComposeField);
  const composeHeaders = useMailStore((s) => s.composeHeaders);
  const composeDraftId = useMailStore((s) => s.composeDraftId);
  const isSending = useMailStore((s) => s.isSending);
  const setSending = useMailStore((s) => s.setSending);
  const isSavingDraft = useMailStore((s) => s.isSavingDraft);
  const setSavingDraft = useMailStore((s) => s.setSavingDraft);
  const isMessageLoading = useMailStore((s) => s.isMessageLoading);
  const setMessageLoading = useMailStore((s) => s.setMessageLoading);
  const requestConfirm = useUiStore((s) => s.requestConfirm);

  // The stamp picture can fail (missing on the world's IIS, or the proxy's 1x1
  // placeholder for a missing upstream) — hidden per message so one broken stamp
  // never hides the next message's.
  const [stampHidden, setStampHidden] = useState(false);
  useEffect(() => {
    setStampHidden(false);
  }, [currentMessage?.messageId]);

  const client = useClient();
  const setLoading = useMailStore((s) => s.setLoading);

  // Fetch folder contents on mount, when the folder changes, and whenever an
  // action asked for a re-read (a confirmed send bumps the token — OB-11).
  useEffect(() => {
    setLoading(true);
    client.onMailGetFolder(currentFolder);
  }, [currentFolder, folderRefreshToken, client, setLoading]);

  const handleReadMessage = useCallback(
    (msg: MailMessageHeader) => {
      setMessageLoading(true);
      client.onMailReadMessage(msg.messageId);
    },
    [client, setMessageLoading],
  );

  // The draft is kept until the server answers: RESP_MAIL_SENT clears it on success and a
  // failure leaves it in place with a toast (audit P2). Sending twice is blocked meanwhile.
  const isBusy = isSending || isSavingDraft;
  const canSend = composeTo.trim().length > 0 && composeSubject.trim().length > 0 && !isBusy;
  const handleSend = useCallback(() => {
    if (!canSend) return;
    setSending(true);
    // Sending a letter that was opened from Drafts carries its id so the server removes
    // that copy once the send succeeds.
    client.onMailSend(composeTo.trim(), composeSubject, composeBody, composeHeaders || undefined, composeDraftId ?? undefined);
  }, [canSend, setSending, client, composeTo, composeSubject, composeBody, composeHeaders, composeDraftId]);

  // Warn once per compose session — a pasted-in wall of text should not toast on every
  // keystroke once it is already clipped to the cap.
  const bodyWarnedRef = useRef(false);
  useEffect(() => {
    if (currentView === 'compose') bodyWarnedRef.current = false;
  }, [currentView]);

  const toInputRef = useRef<HTMLInputElement>(null);
  // Forward opens with nobody addressed, so the caret goes to To (Compose too — same
  // emptiness). Reply and a re-opened draft arrive addressed and keep the caret where it is.
  useEffect(() => {
    if (currentView === 'compose' && useMailStore.getState().composeTo === '') toInputRef.current?.focus();
  }, [currentView]);
  const handleBodyChange = useCallback(
    (value: string) => {
      if (value.length > MAIL_BODY_MAX_CHARS) {
        if (!bodyWarnedRef.current) {
          bodyWarnedRef.current = true;
          showToast(
            `The message was cut to ${MAIL_BODY_MAX_CHARS} characters — that is the most a letter can hold.`,
            'warning',
          );
        }
        setComposeField('body', value.slice(0, MAIL_BODY_MAX_CHARS));
        return;
      }
      setComposeField('body', value);
    },
    [setComposeField],
  );

  // A draft is what you keep BEFORE you have a recipient, so — unlike Send — it asks
  // for no address: anything typed is enough. Editing an existing draft carries its id,
  // which makes the server replace that copy instead of leaving two (#120).
  const canSaveDraft =
    !isBusy && (composeTo.trim() + composeSubject.trim() + composeBody.trim()).length > 0;
  const handleSaveDraft = useCallback(() => {
    if (!canSaveDraft) return;
    setSavingDraft(true);
    client.onMailSaveDraft(
      composeTo.trim(),
      composeSubject,
      composeBody,
      composeHeaders || undefined,
      composeDraftId ?? undefined,
    );
  }, [canSaveDraft, setSavingDraft, client, composeTo, composeSubject, composeBody, composeHeaders, composeDraftId]);

  // Deleting asks first (B5); the row is removed locally when the server confirms.
  // Shared by the read-view Delete button and each list row's own delete control (#512) —
  // neither path issues OpenMessage.
  const requestDelete = useCallback(
    (msg: Pick<MailMessageHeader, 'messageId' | 'subject'>) => {
      const id = msg.messageId;
      requestConfirm(
        'Delete this message?',
        `“${msg.subject || '(no subject)'}” will be removed from ${currentFolder}.`,
        () => {
          useMailStore.getState().setPendingDeleteId(id);
          client.onMailDelete(id);
        },
        { kind: 'destructive', confirmLabel: 'Delete', typeToConfirm: null },
      );
    },
    [currentFolder, client, requestConfirm],
  );
  const handleDelete = useCallback(() => {
    if (currentMessage) requestDelete(currentMessage);
  }, [currentMessage, requestDelete]);

  const folderTabs = FOLDERS.map((f) => ({
    id: f.id,
    label: f.label,
    badge: f.badge && f.id === 'Inbox' ? unreadCount : undefined,
  }));

  return (
    <div className={styles.panel}>
      {/* Folder tabs */}
      <TabBar
        tabs={folderTabs}
        activeTab={currentFolder}
        onTabChange={(id) => setFolder(id as MailFolder)}
      />

      {/* Compose button */}
      {currentView === 'list' && (
        <button className={styles.composeBtn} onClick={() => startCompose()}>
          <PenSquare size={14} />
          <span>Compose</span>
        </button>
      )}

      {/* Loading */}
      {isLoading && (
        <div className={styles.loading}>
          <Skeleton width="100%" height="48px" />
          <Skeleton width="100%" height="48px" />
          <Skeleton width="100%" height="48px" />
        </div>
      )}

      {/* Message list */}
      {!isLoading && currentView === 'list' && (
        <div className={styles.messageList}>
          {messages.length === 0 && (
            <EmptyState
              title={EMPTY_FOLDER_TEXT[currentFolder].title}
              description={EMPTY_FOLDER_TEXT[currentFolder].description}
              className={styles.empty}
            />
          )}
          {messages.map((msg) => (
            <MailMessageRow
              key={msg.messageId}
              msg={msg}
              isSentFolder={currentFolder === 'Sent' || currentFolder === 'Draft'}
              onClick={handleReadMessage}
              onDelete={requestDelete}
            />
          ))}
        </div>
      )}

      {/* Message loading — the row was clicked, the body is on its way */}
      {!isLoading && isMessageLoading && currentView === 'list' && (
        <div className={styles.loading} role="status" aria-live="polite">
          <Skeleton width="100%" height="48px" />
          <span className={styles.srOnly}>Loading message</span>
        </div>
      )}

      {/* Reading view */}
      {!isLoading && currentView === 'read' && currentMessage && (
        <div className={styles.readView}>
          <div className={styles.readHeader}>
            <button className={styles.backBtn} onClick={() => setView('list')}>
              ← Back
            </button>
            <div className={styles.readActions}>
              {/* Reply-only guard, matching MessageHeader.asp:197 — Forward stays outside it, as :217-221 does. */}
              {currentMessage.noReply ? null : (
                <button className={styles.actionBtn} onClick={() => startReply(currentMessage)} aria-label="Reply" title="Reply">
                  <Reply size={14} aria-hidden="true" />
                </button>
              )}
              {currentFolder !== 'Draft' && (
                <button className={styles.actionBtn} onClick={() => startForward(currentMessage)} aria-label="Forward" title="Forward">
                  <Forward size={14} aria-hidden="true" />
                </button>
              )}
              <button className={styles.actionBtn} onClick={handleDelete} aria-label="Delete" title="Delete">
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
          <h3 className={styles.readSubject}>{currentMessage.subject}</h3>
          <div className={styles.readMetaRowWithStamp}>
            <div className={styles.readMeta}>
              <div className={styles.readMetaRow}>
                <span>From: {currentMessage.from || currentMessage.fromAddr}</span>
                <span>{currentMessage.dateFmt || currentMessage.date}</span>
              </div>
              <span>To: {currentMessage.to || currentMessage.toAddr}</span>
            </div>
            {currentMessage.stampUrl && !stampHidden && (
              <img
                className={styles.readStamp}
                src={currentMessage.stampUrl}
                alt=""
                aria-hidden="true"
                onError={() => setStampHidden(true)}
                onLoad={(e) => {
                  if (e.currentTarget.naturalWidth <= 1) setStampHidden(true);
                }}
              />
            )}
          </div>
          {isHtmlContent(currentMessage.body) ? (
            <HtmlMailBody body={currentMessage.body} htmlBody={currentMessage.htmlBody} />
          ) : (
            <div className={styles.readBody}>{currentMessage.body.join('\n')}</div>
          )}
        </div>
      )}

      {/* Compose view */}
      {currentView === 'compose' && (
        <div className={styles.composeView}>
          <input
            ref={toInputRef}
            className={styles.composeInput}
            placeholder="To"
            aria-label="To"
            aria-describedby="mail-to-hint"
            value={composeTo}
            onChange={(e) => setComposeField('to', e.target.value)}
            disabled={isBusy}
          />
          <span className={styles.composeHint} id="mail-to-hint">
            Several recipients? Separate the addresses with ;
          </span>
          <input
            className={styles.composeInput}
            placeholder="Subject"
            aria-label="Subject"
            value={composeSubject}
            onChange={(e) => setComposeField('subject', e.target.value)}
            disabled={isBusy}
          />
          <textarea
            className={styles.composeBody}
            placeholder="Message..."
            aria-label="Message"
            aria-describedby="mail-body-counter"
            value={composeBody}
            onChange={(e) => handleBodyChange(e.target.value)}
            rows={8}
            disabled={isBusy}
          />
          <span className={styles.composeCounter} role="status" aria-live="polite" id="mail-body-counter">
            {MAIL_BODY_MAX_CHARS - composeBody.length} characters left
          </span>
          <div className={styles.composeActions}>
            <button
              className={styles.sendBtn}
              onClick={handleSend}
              disabled={!canSend}
              aria-busy={isSending || undefined}
              title={!composeTo.trim() ? 'Add a recipient' : !composeSubject.trim() ? 'Add a subject' : undefined}
            >
              <Send size={14} aria-hidden="true" />
              <span>{isSending ? 'Sending…' : 'Send'}</span>
            </button>
            <button className={styles.draftBtn} onClick={handleSaveDraft} disabled={!canSaveDraft} aria-busy={isSavingDraft || undefined} title={canSaveDraft || isBusy ? undefined : 'Write something first'}>
              <Save size={14} aria-hidden="true" />
              <span>{isSavingDraft ? 'Saving…' : 'Save draft'}</span>
            </button>
            <button className={styles.cancelBtn} onClick={clearCompose} disabled={isBusy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
