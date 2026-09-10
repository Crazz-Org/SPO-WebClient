/**
 * NewspaperModal — the town paper, in its two sections.
 *
 * Voyager gives the Town Hall sheet two buttons onto the same paper:
 * "Rate the Mayor" opens `boardreader.asp`, the editorial board
 * (`TownHallSheet.pas:337-353`), and "Read News" opens `newsreader.asp`, the
 * daily issue (`:361`). Both are full-screen framesets that close the object
 * inspector behind them (`frame_Close=yes`, `:352`).
 *
 * Here they are one modal with a switch, which is what the reader's own bar
 * does: `ShowBar.asp:114-160` carries READ COLUMNS and READ NEWS side by side
 * and swaps the main frame in place, without ever leaving the paper. So the
 * switch here changes the view and nothing else — neither side is re-read.
 *
 * The board's two frames become one column with a back link. The rating form
 * Voyager bolts onto the board is NOT here — it lives on the Politics tab,
 * where it talks to `RDOSetRatingFrom` directly.
 */

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUp, User, X, RefreshCw } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useNewspaperStore } from '../../store/newspaper-store';
import { useClient } from '../../context';
import { IconButton, SkeletonLines } from '../common';
import styles from './NewspaperModal.module.css';

/**
 * The author's portrait (`boardmsg.asp:244`). Most tycoons have no photo on
 * disk — `:44-45` swaps in a default when the file is missing — so a failed
 * load shows a silhouette, never the browser's broken-image box.
 */
function AuthorPortrait({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (url === '' || failed) {
    return <div className={styles.portraitFallback} aria-hidden="true"><User size={20} /></div>;
  }
  return <img className={styles.portrait} src={url} alt="" onError={() => setFailed(true)} />;
}

export function NewspaperModal() {
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const client = useClient();

  const context = useNewspaperStore((s) => s.context);
  const view = useNewspaperStore((s) => s.view);
  const board = useNewspaperStore((s) => s.board);
  const loadState = useNewspaperStore((s) => s.loadState);
  const isPosting = useNewspaperStore((s) => s.isPosting);

  const issues = useNewspaperStore((s) => s.issues);
  const issuesState = useNewspaperStore((s) => s.issuesState);
  const issuesError = useNewspaperStore((s) => s.issuesError);
  const selectedFolder = useNewspaperStore((s) => s.selectedFolder);
  const issue = useNewspaperStore((s) => s.issue);
  const issueState = useNewspaperStore((s) => s.issueState);

  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const isOpen = modal === 'newspaper';
  const hasPaper = context !== null && context.paperName !== '';

  // Same lazy contract as the Politics tab: nothing is read until the section is
  // on screen, and its load state back at `idle` is the re-read signal.
  useEffect(() => {
    if (isOpen && hasPaper && view === 'board' && loadState === 'idle') {
      client.onRequestNewspaperBoard();
    }
  }, [isOpen, hasPaper, view, loadState, client]);

  useEffect(() => {
    if (isOpen && hasPaper && view === 'paper' && issuesState === 'idle') {
      client.onRequestNewspaperIssues();
    }
  }, [isOpen, hasPaper, view, issuesState, client]);

  // Nothing chosen yet: open the newest issue, which is what `ShowBar.asp:87`
  // selects when `Selected` arrives empty.
  useEffect(() => {
    if (isOpen && view === 'paper' && issuesState === 'loaded'
        && issues.length > 0 && selectedFolder === '') {
      client.onRequestNewspaperIssue(issues[0].folder);
    }
  }, [isOpen, view, issuesState, issues, selectedFolder, client]);

  // A published column clears the form; a refused one keeps what was typed.
  useEffect(() => {
    if (!isPosting && composing && board?.columns.some((c) => c.subject === subject.trim())) {
      setComposing(false);
      setSubject('');
      setBody('');
    }
  }, [isPosting, composing, board, subject]);

  if (!isOpen) return null;

  const article = board?.article ?? null;
  const paperName = context?.paperName ?? 'Newspaper';

  const handleClose = () => closeModal();

  const handleRefresh = () => {
    if (view === 'paper') {
      useNewspaperStore.getState().refreshIssues();
    } else {
      useNewspaperStore.getState().setLoadState('idle');
    }
  };

  const handlePost = () => {
    // A reply goes under the open column; otherwise it is a new top-level column.
    client.onPostNewspaperColumn(subject.trim(), body, article ? board?.path : undefined);
  };

  const noPaper = <p className={styles.empty}>This town has no newspaper.</p>;

  return (
    <>
      <div className={styles.backdrop} onClick={handleClose} aria-hidden="true" />
      <div
        className={styles.modal}
        role="dialog"
        aria-label={`${paperName} — ${view === 'paper' ? 'daily issue' : 'editorial section'}`}
      >
        <div className={styles.header}>
          <div className={styles.headerText}>
            <h2 className={styles.title}>{paperName}</h2>
            <span className={styles.subtitle}>
              {view === 'paper' ? 'Daily issue' : 'Editorial section'}
            </span>
          </div>

          {/* The bar's own two buttons (`ShowBar.asp:124`/`:139`, News.lng:30-31). */}
          <div className={styles.switch} role="group" aria-label="Newspaper section">
            <button
              className={styles.switchBtn}
              aria-pressed={view === 'paper'}
              onClick={() => useNewspaperStore.getState().setView('paper')}
            >
              Read News
            </button>
            <button
              className={styles.switchBtn}
              aria-pressed={view === 'board'}
              onClick={() => useNewspaperStore.getState().setView('board')}
            >
              Read Columns
            </button>
          </div>

          <div className={styles.headerActions}>
            <IconButton
              icon={<RefreshCw size={16} />}
              label="Refresh"
              size="sm"
              variant="ghost"
              onClick={handleRefresh}
            />
            <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className={styles.body}>
          {!hasPaper && noPaper}

          {hasPaper && view === 'paper' && (
            <>
              {issuesState === 'loading' && <SkeletonLines lines={6} />}

              {issuesState === 'error' && (
                <div className={styles.error}>
                  {issuesError || 'The newspaper could not be reached.'}
                </div>
              )}

              {/* `ShowPaper.asp:19-24` — a paper whose News Server has printed
                  nothing shows the connecting page, not a blank frame. */}
              {issuesState === 'loaded' && issues.length === 0 && (
                <>
                  <p className={styles.empty}>
                    No issue of {paperName} has been printed yet.
                  </p>
                  <p className={styles.muted}>Connecting to {paperName} servers...</p>
                </>
              )}

              {issuesState === 'loaded' && issues.length > 0 && (
                <>
                  {/* The issue row of `ShowBar.asp:81-109`, newest first. */}
                  <nav className={styles.rail} aria-label="Issues">
                    {issues.map((ref) => (
                      <button
                        key={ref.folder}
                        className={styles.railBtn}
                        aria-current={ref.folder === selectedFolder ? 'true' : undefined}
                        onClick={() => client.onRequestNewspaperIssue(ref.folder)}
                      >
                        {ref.date}
                      </button>
                    ))}
                  </nav>

                  {issueState === 'loading' && <SkeletonLines lines={8} />}

                  {issueState === 'error' && (
                    <div className={styles.error}>
                      {issue?.error || 'The issue could not be read.'}
                    </div>
                  )}

                  {issueState === 'loaded' && issue && (
                    <>
                      <div className={styles.masthead}>
                        {issue.townName && <span>{issue.townName}</span>}
                        <span className={styles.mastheadTitle}>{issue.title}</span>
                        {issue.date && <span>{issue.date}</span>}
                      </div>
                      {issue.stories.map((story, i) => (
                        <article className={styles.story} key={`${story.headline}-${i}`}>
                          <h3 className={styles.storyHeadline}>{story.headline}</h3>
                          {story.byline && <p className={styles.byline}>{story.byline}</p>}
                          {story.body.split('\n').map((line, j) => (
                            <p className={styles.articleBody} key={j}>{line}</p>
                          ))}
                        </article>
                      ))}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {hasPaper && view === 'board' && (
            <>
              {loadState === 'loading' && <SkeletonLines lines={6} />}

              {loadState === 'error' && (
                <div className={styles.error}>{board?.error || 'The newspaper could not be reached.'}</div>
              )}

              {loadState === 'loaded' && board && (
                article ? (
                  <article className={styles.article}>
                    <div className={styles.articleNav}>
                      <button
                        className={styles.backLink}
                        onClick={() => client.onRequestNewspaperBoard()}
                      >
                        <ArrowLeft size={14} /> All columns
                      </button>
                      {article.parentPath !== '' && (
                        <button
                          className={styles.backLink}
                          onClick={() => client.onRequestNewspaperBoard(article.parentPath)}
                        >
                          <ArrowUp size={14} /> Up
                        </button>
                      )}
                    </div>
                    <h3 className={styles.articleTitle}>{article.subject}</h3>
                    <div className={styles.bylineRow}>
                      <AuthorPortrait key={board.path} url={article.photoUrl} />
                      {article.byline && <p className={styles.byline}>{article.byline}</p>}
                    </div>
                    <p className={styles.articleBody}>{article.body}</p>

                    {article.replies.length > 0 && (
                      <>
                        <h4 className={styles.sectionTitle}>Replies</h4>
                        <ul className={styles.columnList}>
                          {article.replies.map((reply) => (
                            <li key={reply.path}>
                              <button
                                className={styles.columnLink}
                                onClick={() => client.onRequestNewspaperBoard(reply.path)}
                              >
                                <span className={styles.columnAuthor}>{reply.author}</span>
                                <span className={styles.columnSubject}>{reply.subject}</span>
                              </button>
                              {reply.summary && <p className={styles.columnSummary}>{reply.summary}</p>}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </article>
                ) : (
                  <>
                    <p className={styles.lead}>
                      Read the columns published by your fellow investors, or post one
                      of your own.
                    </p>
                    <h4 className={styles.sectionTitle}>Latest columns</h4>
                    {board.columns.length === 0 ? (
                      <p className={styles.empty}>Nobody has written a column yet.</p>
                    ) : (
                      <ul className={styles.columnList}>
                        {board.columns.map((column) => (
                          <li key={column.path}>
                            <button
                              className={styles.columnLink}
                              onClick={() => client.onRequestNewspaperBoard(column.path)}
                            >
                              <span className={styles.columnAuthor}>{column.author}</span>
                              <span className={styles.columnSubject}>{column.subject}</span>
                            </button>
                            {column.summary && <p className={styles.columnSummary}>{column.summary}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )
              )}

              {loadState === 'loaded' && (
                <div className={styles.composer}>
                  {composing ? (
                    <>
                      <h4 className={styles.sectionTitle}>
                        {article ? `Reply to “${article.subject}”` : 'Post a column'}
                      </h4>
                      <label className={styles.field}>
                        <span>Subject</span>
                        <input
                          className={styles.input}
                          value={subject}
                          maxLength={120}
                          onChange={(e) => setSubject(e.target.value)}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Column</span>
                        <textarea
                          className={styles.textarea}
                          rows={8}
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                        />
                      </label>
                      <div className={styles.composerActions}>
                        <button
                          className={styles.primaryBtn}
                          disabled={isPosting || subject.trim() === ''}
                          onClick={handlePost}
                        >
                          {isPosting ? 'Publishing…' : article ? 'Post Reply' : 'Post Column'}
                        </button>
                        <button
                          className={styles.secondaryBtn}
                          disabled={isPosting}
                          onClick={() => { setSubject(''); setBody(''); }}
                        >
                          Reset Form
                        </button>
                        <button
                          className={styles.secondaryBtn}
                          disabled={isPosting}
                          onClick={() => setComposing(false)}
                        >
                          Hide Form
                        </button>
                      </div>
                    </>
                  ) : (
                    <button className={styles.primaryBtn} onClick={() => setComposing(true)}>
                      {article ? 'Reply to this column' : 'Post a column'}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
