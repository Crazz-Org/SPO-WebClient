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
 * The board's two frames become one column with a back link. The root view
 * lists the list frame's tree (`boardlist.asp`, every column and reply — not
 * the ten-entry index `boardmsg.asp` alone would give).
 *
 * The rating block Voyager bolts onto the board (`boardmsg.asp:306-382`) is
 * here too, inside the composer: the criteria the reader fills in ride along
 * with the post, and the gateway sends each one to the same `RDOSetRatingFrom`
 * the Politics tab uses — before publishing the column, as `:96-146` orders it.
 * It is hidden from the incumbent (`:283-285`). Left untouched it changes
 * nothing about what is posted.
 */

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUp, User, X, RefreshCw } from 'lucide-react';
import type { NewspaperRatingEntry, PoliticsRatingEntry } from '@/shared/types';
import { useUiStore } from '../../store/ui-store';
import { useNewspaperStore } from '../../store/newspaper-store';
import { usePoliticsStore } from '../../store/politics-store';
import { useClient } from '../../context';
import { IconButton, SkeletonLines } from '../common';
import { RATING_CHOICES } from '../politics/RatingsRail';
import styles from './NewspaperModal.module.css';

/** `boardlist.asp:25` indents each nesting level 20px; the modal uses its own scale. */
const TREE_INDENT_PX = 16;

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

  const politicsData = usePoliticsStore((s) => s.data);
  const politicsLoadState = usePoliticsStore((s) => s.loadState);
  const politicsLoadedFor = usePoliticsStore((s) => s.loadedFor);

  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [choices, setChoices] = useState<Map<string, number>>(new Map());

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
      setChoices(new Map());
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

  // The criteria this reader may rate while posting.
  //
  // The Capitol branch of `boardmsg.asp:11-16` sets no `TownPath`, so the page
  // iterates no rating there. The politics data on hand must describe THIS
  // building — a paper opened from the Media page carries (0,0) and gets no
  // block. `!isRuler` is the incumbent guard of `:283-285`, the same one
  // `RatingsRail.tsx:185-186` applies; a row with no cache id has no `RatingId`
  // to send back.
  const ratesThisBuilding = context !== null && !context.isCapitol
    && politicsLoadState === 'loaded'
    && politicsLoadedFor === `${context.buildingX}:${context.buildingY}`;
  const ratable: PoliticsRatingEntry[] =
    ratesThisBuilding && politicsData && !politicsData.isRuler
      ? politicsData.tycoonsRatings.filter((r) => r.id !== undefined)
      : [];

  const chooseRating = (id: string, value: string) => {
    setChoices((prev) => {
      const next = new Map(prev);
      if (value === '') next.delete(id); else next.set(id, parseInt(value, 10));
      return next;
    });
  };

  const handlePost = () => {
    // A reply goes under the open column; otherwise it is a new top-level column.
    const replyPath = article ? board?.path : undefined;
    const ratings: NewspaperRatingEntry[] = ratable
      .filter((r) => r.id !== undefined && choices.has(r.id))
      .map((r) => ({ id: r.id as string, name: r.name, value: choices.get(r.id as string) as number }));
    client.onPostNewspaperColumn(
      subject.trim(), body, replyPath, ratings.length > 0 ? ratings : undefined,
    );
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
                    <h4 className={styles.sectionTitle}>All columns</h4>
                    {board.tree.length === 0 ? (
                      <p className={styles.empty}>Nobody has written a column yet.</p>
                    ) : (
                      <ul className={styles.columnList}>
                        {board.tree.map((entry) => (
                          <li key={entry.path} style={{ marginLeft: `${entry.depth * TREE_INDENT_PX}px` }}>
                            <button
                              className={styles.columnLink}
                              onClick={() => client.onRequestNewspaperBoard(entry.path)}
                            >
                              {entry.author !== '' && <span className={styles.columnAuthor}>{entry.author}</span>}
                              <span className={styles.columnSubject}>{entry.subject || 'Untitled column'}</span>
                            </button>
                            {entry.summary && <p className={styles.columnSummary}>{entry.summary}</p>}
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

                      {/* `boardmsg.asp:306-382` — the ratings the column carries.
                          Hidden for the incumbent, who cannot rate their own
                          term (`:283-285`). */}
                      {ratable.length > 0 && (
                        <fieldset className={styles.ratingBlock}>
                          {/* `:309` — strRateThe + strMayor. */}
                          <legend className={styles.sectionTitle}>Rate the Mayor</legend>
                          <p className={styles.muted}>
                            Leave a criterion on “—” to publish the column without
                            changing it.
                          </p>
                          {ratable.map((rating) => (
                            <div className={styles.ratingRow} key={rating.id}>
                              <span>{rating.name}</span>
                              <span className={styles.ratingCurrent}>{rating.value}%</span>
                              <select
                                className={styles.input}
                                aria-label={`Rate ${rating.name}`}
                                value={choices.get(rating.id as string) ?? ''}
                                onChange={(e) => chooseRating(rating.id as string, e.target.value)}
                              >
                                {/* The `-` placeholder of `:338` — no change. */}
                                <option value="">—</option>
                                {RATING_CHOICES.map((v) => (
                                  <option key={v} value={v}>{v}%</option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </fieldset>
                      )}

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
                          onClick={() => { setSubject(''); setBody(''); setChoices(new Map()); }}
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
