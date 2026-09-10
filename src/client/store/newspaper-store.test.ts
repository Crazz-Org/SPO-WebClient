/**
 * newspaper-store — which paper is open, which of its two sections is showing,
 * and what the gateway last read off each.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { useNewspaperStore, type NewspaperContext } from './newspaper-store';
import type { NewspaperBoard, NewspaperIssue, NewspaperIssueList } from '@/shared/types';

const CONTEXT: NewspaperContext = {
  paperName: 'Helartia Herald',
  townName: 'Helartia',
  isCapitol: false,
  buildingX: 118,
  buildingY: 226,
};

const BOARD: NewspaperBoard = {
  paperName: 'Helartia Herald',
  root: 'boards\\Planitia\\Helartia Herald\\',
  path: 'boards\\Planitia\\Helartia Herald\\',
  columns: [{ author: 'A', subject: 'S', summary: 'x', path: 'm1.five' }],
  article: null,
  error: '',
};

beforeEach(() => {
  useNewspaperStore.getState().reset();
});

describe('newspaper-store', () => {
  it('starts empty', () => {
    const s = useNewspaperStore.getState();
    expect(s.context).toBeNull();
    expect(s.board).toBeNull();
    expect(s.loadState).toBe('idle');
    expect(s.isPosting).toBe(false);
  });

  it('opening a paper leaves it in the read path', () => {
    useNewspaperStore.getState().openFor(CONTEXT);
    expect(useNewspaperStore.getState().context).toEqual(CONTEXT);
    expect(useNewspaperStore.getState().loadState).toBe('idle');
  });

  // Closing and re-opening the same board must not cost a round-trip.
  it('re-opening the same paper keeps what was already read', () => {
    useNewspaperStore.getState().openFor(CONTEXT);
    useNewspaperStore.getState().setBoard(BOARD);
    useNewspaperStore.getState().openFor(CONTEXT);
    expect(useNewspaperStore.getState().board).toEqual(BOARD);
    expect(useNewspaperStore.getState().loadState).toBe('loaded');
  });

  it('opening a different paper starts from scratch', () => {
    useNewspaperStore.getState().openFor(CONTEXT);
    useNewspaperStore.getState().setBoard(BOARD);
    useNewspaperStore.getState().openFor({ ...CONTEXT, paperName: 'Other Times' });
    expect(useNewspaperStore.getState().board).toBeNull();
    expect(useNewspaperStore.getState().loadState).toBe('idle');
  });

  it('the same paper at another building starts from scratch', () => {
    useNewspaperStore.getState().openFor(CONTEXT);
    useNewspaperStore.getState().setBoard(BOARD);
    useNewspaperStore.getState().openFor({ ...CONTEXT, buildingX: 999 });
    expect(useNewspaperStore.getState().board).toBeNull();
  });

  it('requesting a path marks the read as in flight', () => {
    useNewspaperStore.getState().setRequestedPath('m1.five');
    expect(useNewspaperStore.getState().requestedPath).toBe('m1.five');
    expect(useNewspaperStore.getState().loadState).toBe('loading');
  });

  it('a board carrying an error lands in the error state', () => {
    useNewspaperStore.getState().setBoard({ ...BOARD, error: 'HTTP 404' });
    expect(useNewspaperStore.getState().loadState).toBe('error');
  });

  it('a board clears the posting flag — the answer ends the round-trip', () => {
    useNewspaperStore.getState().setPosting(true);
    useNewspaperStore.getState().setBoard(BOARD);
    expect(useNewspaperStore.getState().isPosting).toBe(false);
  });

  it('reset clears everything', () => {
    useNewspaperStore.getState().openFor(CONTEXT);
    useNewspaperStore.getState().setBoard(BOARD);
    useNewspaperStore.getState().reset();
    expect(useNewspaperStore.getState().context).toBeNull();
    expect(useNewspaperStore.getState().board).toBeNull();
  });
});

// =============================================================================
// The paper view — the issue bar and one issue
// =============================================================================

const NEWEST = '002147483640@3-1-2027';
const OLDER = '002147483641@2-28-2027';

const LIST: NewspaperIssueList = {
  paperName: 'Helartia Herald',
  issues: [
    { folder: NEWEST, date: '3/1/2027' },
    { folder: OLDER, date: '2/28/2027' },
  ],
  error: '',
};

const ISSUE: NewspaperIssue = {
  paperName: 'Helartia Herald',
  folder: NEWEST,
  townName: 'Helartia',
  title: 'Helartia Herald',
  date: 'Monday, March 01, 2027',
  stories: [{ headline: 'Domestic Wars!', byline: '', body: 'One person died.' }],
  error: '',
};

describe('newspaper-store — the paper view', () => {
  it('starts on the board, with no issue read', () => {
    const s = useNewspaperStore.getState();
    expect(s.view).toBe('board');
    expect(s.issues).toEqual([]);
    expect(s.issuesState).toBe('idle');
    expect(s.selectedFolder).toBe('');
    expect(s.issue).toBeNull();
    expect(s.issueState).toBe('idle');
  });

  it('opens on the view it was asked for', () => {
    useNewspaperStore.getState().openFor(CONTEXT, 'paper');
    expect(useNewspaperStore.getState().view).toBe('paper');
  });

  // "Read News" then "Rate the Mayor" on the same town hall: the paper is the
  // same, so what was already read is kept — only the section moves.
  it('re-opening the same paper on the other view keeps what was read', () => {
    useNewspaperStore.getState().openFor(CONTEXT, 'paper');
    useNewspaperStore.getState().setIssues(LIST);
    useNewspaperStore.getState().openFor(CONTEXT, 'board');
    expect(useNewspaperStore.getState().view).toBe('board');
    expect(useNewspaperStore.getState().issues).toEqual(LIST.issues);
  });

  it('opening a different paper clears the issues too', () => {
    useNewspaperStore.getState().openFor(CONTEXT, 'paper');
    useNewspaperStore.getState().setIssues(LIST);
    useNewspaperStore.getState().openFor({ ...CONTEXT, paperName: 'Other Times' }, 'paper');
    expect(useNewspaperStore.getState().issues).toEqual([]);
    expect(useNewspaperStore.getState().issuesState).toBe('idle');
  });

  // `ShowBar.asp:114-160` swaps the main frame in place — neither side is lost.
  it('the switch changes the view and nothing else', () => {
    useNewspaperStore.getState().openFor(CONTEXT, 'paper');
    useNewspaperStore.getState().setIssues(LIST);
    useNewspaperStore.getState().setBoard(BOARD);
    useNewspaperStore.getState().setView('board');
    expect(useNewspaperStore.getState().view).toBe('board');
    expect(useNewspaperStore.getState().issues).toEqual(LIST.issues);
    expect(useNewspaperStore.getState().board).toEqual(BOARD);
  });

  it('a list lands loaded, and its error lands in the error state', () => {
    useNewspaperStore.getState().setIssues(LIST);
    expect(useNewspaperStore.getState().issuesState).toBe('loaded');
    expect(useNewspaperStore.getState().issuesError).toBe('');

    useNewspaperStore.getState().setIssues({ ...LIST, issues: [], error: 'HTTP 500' });
    expect(useNewspaperStore.getState().issuesState).toBe('error');
    expect(useNewspaperStore.getState().issuesError).toBe('HTTP 500');
  });

  it('marks the read as in flight while an issue is being fetched', () => {
    useNewspaperStore.getState().setIssuesState('loading');
    expect(useNewspaperStore.getState().issuesState).toBe('loading');
    useNewspaperStore.getState().selectIssue(NEWEST);
    expect(useNewspaperStore.getState().selectedFolder).toBe(NEWEST);
    expect(useNewspaperStore.getState().issueState).toBe('loading');
  });

  it('accepts the issue that was asked for', () => {
    useNewspaperStore.getState().selectIssue(NEWEST);
    useNewspaperStore.getState().setIssue(ISSUE);
    expect(useNewspaperStore.getState().issue).toEqual(ISSUE);
    expect(useNewspaperStore.getState().issueState).toBe('loaded');
  });

  it('an issue carrying an error lands in the error state', () => {
    useNewspaperStore.getState().selectIssue(NEWEST);
    useNewspaperStore.getState().setIssue({ ...ISSUE, error: 'The issue could not be read.' });
    expect(useNewspaperStore.getState().issueState).toBe('error');
  });

  // Clicking a second date before the first answer lands: the late answer is
  // for a folder nobody is waiting on any more.
  it('ignores a stale answer for a folder that is no longer selected', () => {
    useNewspaperStore.getState().selectIssue(NEWEST);
    useNewspaperStore.getState().setIssue(ISSUE);
    useNewspaperStore.getState().selectIssue(OLDER);
    useNewspaperStore.getState().setIssue(ISSUE);
    expect(useNewspaperStore.getState().issue).toEqual(ISSUE);
    expect(useNewspaperStore.getState().issueState).toBe('loading');
  });

  it('refreshIssues puts the paper back in the read path', () => {
    useNewspaperStore.getState().setIssues(LIST);
    useNewspaperStore.getState().selectIssue(NEWEST);
    useNewspaperStore.getState().setIssue(ISSUE);

    useNewspaperStore.getState().refreshIssues();

    const s = useNewspaperStore.getState();
    expect(s.issues).toEqual([]);
    expect(s.issuesState).toBe('idle');
    expect(s.issuesError).toBe('');
    expect(s.selectedFolder).toBe('');
    expect(s.issue).toBeNull();
    expect(s.issueState).toBe('idle');
  });

  it('reset clears the paper as well as the board', () => {
    useNewspaperStore.getState().openFor(CONTEXT, 'paper');
    useNewspaperStore.getState().setIssues(LIST);
    useNewspaperStore.getState().selectIssue(NEWEST);
    useNewspaperStore.getState().setIssue(ISSUE);

    useNewspaperStore.getState().reset();

    const s = useNewspaperStore.getState();
    expect(s.view).toBe('board');
    expect(s.issues).toEqual([]);
    expect(s.issue).toBeNull();
    expect(s.selectedFolder).toBe('');
  });
});
