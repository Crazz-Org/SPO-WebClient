/**
 * NewspaperModal — the town paper Voyager opens from "Rate the Mayor" (the
 * board) and "Read News" (the daily issue).
 *
 * Covers the board's two navigations (index -> column -> back), the composer's
 * two modes (new column / reply), the lazy read that fills each section, the
 * issue rail, and the switch between the two.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import {
  renderWithProviders,
  resetStores,
  createSpiedCallbacks,
} from '../../__tests__/setup/render-helpers';
import { useNewspaperStore } from '../../store/newspaper-store';
import { useUiStore } from '../../store/ui-store';
import { NewspaperModal } from './NewspaperModal';
import type { NewspaperBoard, NewspaperIssue, NewspaperIssueRef } from '@/shared/types';

const CONTEXT = {
  paperName: 'Helartia Herald',
  townName: 'Helartia',
  isCapitol: false,
  buildingX: 118,
  buildingY: 226,
};

const ROOT = 'boards\\Planitia\\Helartia Herald\\';

const INDEX: NewspaperBoard = {
  paperName: 'Helartia Herald',
  root: ROOT,
  path: ROOT,
  columns: [
    { author: 'SPO_test3', subject: 'VERY NICE GUY', summary: 'VOTE FOR HIM', path: 'm1.five' },
  ],
  article: null,
  error: '',
};

const ARTICLE: NewspaperBoard = {
  ...INDEX,
  path: 'm1.five',
  columns: [],
  article: {
    subject: 'VERY NICE GUY',
    byline: 'By SPO_test3 of Yellow Inc.',
    body: 'VOTE FOR HIM',
    replies: [{ author: 'Innos', subject: 'Agreed', summary: 'Well said', path: 'r1.five' }],
    parentPath: '',
    photoUrl: 'http://host/fivedata/userinfo/Planitia/SPO_test3/largephoto.jpg',
  },
};

function openWith(
  board: NewspaperBoard | null,
  loadState: 'idle' | 'loading' | 'loaded' | 'error' = 'loaded',
  view: 'paper' | 'board' = 'board',
): void {
  useUiStore.getState().openModal('newspaper');
  useNewspaperStore.setState({ context: CONTEXT, view, board, loadState, isPosting: false, requestedPath: '' });
}

beforeEach(() => {
  resetStores();
  useNewspaperStore.getState().reset();
});

describe('NewspaperModal', () => {
  it('renders nothing when another modal holds the slot', () => {
    useUiStore.getState().openModal('settings');
    const { container } = renderWithProviders(<NewspaperModal />);
    expect(container.firstChild).toBeNull();
  });

  // Same lazy contract as the Politics tab: nothing is read until it is on screen.
  it('reads the board on open when nothing has been read', () => {
    const spy = jest.fn();
    openWith(null, 'idle');
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onRequestNewspaperBoard: spy }) },
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not read again while a read is in flight', () => {
    const spy = jest.fn();
    openWith(null, 'loading');
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onRequestNewspaperBoard: spy }) },
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('lists the latest columns with their author and summary', () => {
    openWith(INDEX);
    renderWithProviders(<NewspaperModal />);
    expect(screen.getByText('Helartia Herald')).toBeTruthy();
    expect(screen.getByText('SPO_test3')).toBeTruthy();
    expect(screen.getByText('VERY NICE GUY')).toBeTruthy();
    expect(screen.getByText('VOTE FOR HIM')).toBeTruthy();
  });

  it('says so when nobody has written yet', () => {
    openWith({ ...INDEX, columns: [] });
    renderWithProviders(<NewspaperModal />);
    expect(screen.getByText('Nobody has written a column yet.')).toBeTruthy();
  });

  it('opens a column by its board path', () => {
    const spy = jest.fn();
    openWith(INDEX);
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onRequestNewspaperBoard: spy }) },
    );
    fireEvent.click(screen.getByText('VERY NICE GUY'));
    expect(spy).toHaveBeenCalledWith('m1.five');
  });

  it('shows an open column with its byline, body and replies', () => {
    openWith(ARTICLE);
    renderWithProviders(<NewspaperModal />);
    expect(screen.getByText('By SPO_test3 of Yellow Inc.')).toBeTruthy();
    expect(screen.getByText('VOTE FOR HIM')).toBeTruthy();
    expect(screen.getByText('Replies')).toBeTruthy();
    expect(screen.getByText('Agreed')).toBeTruthy();
  });

  // A top-level column's parent is the board root — the index "All columns"
  // already opens — so the Up control is absent, not disabled.
  it('shows no Up control at the root of the tree', () => {
    openWith(ARTICLE);
    renderWithProviders(<NewspaperModal />);
    expect(screen.queryByText('Up')).toBeNull();
  });

  it('opens the parent column through the Up control', () => {
    const spy = jest.fn();
    openWith({ ...ARTICLE, article: { ...ARTICLE.article!, parentPath: 'C:\\news\\boards\\Planitia\\Helartia Herald\\m1.five\\' } });
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onRequestNewspaperBoard: spy }) },
    );
    fireEvent.click(screen.getByText('Up'));
    expect(spy).toHaveBeenCalledWith('C:\\news\\boards\\Planitia\\Helartia Herald\\m1.five\\');
  });

  it('shows the author portrait beside the byline', () => {
    openWith(ARTICLE);
    const { container } = renderWithProviders(<NewspaperModal />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe(ARTICLE.article!.photoUrl);
  });

  it('falls back to a silhouette when the portrait fails to load, never a broken image', () => {
    openWith(ARTICLE);
    const { container } = renderWithProviders(<NewspaperModal />);
    const img = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the silhouette outright when the page printed no picture', () => {
    openWith({ ...ARTICLE, article: { ...ARTICLE.article!, photoUrl: '' } });
    const { container } = renderWithProviders(<NewspaperModal />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('goes back to the index with no path', () => {
    const spy = jest.fn();
    openWith(ARTICLE);
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onRequestNewspaperBoard: spy }) },
    );
    fireEvent.click(screen.getByText('All columns'));
    expect(spy).toHaveBeenCalledWith();
  });

  it('reports a board that could not be read', () => {
    openWith({ ...INDEX, error: 'This town has no newspaper.' }, 'error');
    renderWithProviders(<NewspaperModal />);
    expect(screen.getByText('This town has no newspaper.')).toBeTruthy();
  });

  // ---- The composer ----

  it('posts a new column at the board root', () => {
    const spy = jest.fn();
    openWith(INDEX);
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onPostNewspaperColumn: spy }) },
    );
    fireEvent.click(screen.getByText('Post a column'));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Roads' } });
    fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'We need more' } });
    fireEvent.click(screen.getByText('Post Column'));
    // No reply path — `boardmsg.asp:90` then posts at the root.
    expect(spy).toHaveBeenCalledWith('Roads', 'We need more', undefined);
  });

  it('posts a reply under the open column', () => {
    const spy = jest.fn();
    openWith(ARTICLE);
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onPostNewspaperColumn: spy }) },
    );
    fireEvent.click(screen.getByText('Reply to this column'));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Agreed' } });
    fireEvent.click(screen.getByText('Post Reply'));
    expect(spy).toHaveBeenCalledWith('Agreed', '', 'm1.five');
  });

  // `boardmsg.asp:94` drops a subject-less post silently.
  it('will not post without a subject', () => {
    openWith(INDEX);
    renderWithProviders(<NewspaperModal />);
    fireEvent.click(screen.getByText('Post a column'));
    expect((screen.getByText('Post Column') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables the form while the post is in flight', () => {
    openWith(INDEX);
    renderWithProviders(<NewspaperModal />);
    fireEvent.click(screen.getByText('Post a column'));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Roads' } });
    act(() => { useNewspaperStore.getState().setPosting(true); });
    expect(screen.getByText('Publishing…')).toBeTruthy();
  });

  it('resets the form without closing it', () => {
    openWith(INDEX);
    renderWithProviders(<NewspaperModal />);
    fireEvent.click(screen.getByText('Post a column'));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Roads' } });
    fireEvent.click(screen.getByText('Reset Form'));
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('');
  });

  it('hides the form on request', () => {
    openWith(INDEX);
    renderWithProviders(<NewspaperModal />);
    fireEvent.click(screen.getByText('Post a column'));
    fireEvent.click(screen.getByText('Hide Form'));
    expect(screen.queryByLabelText('Subject')).toBeNull();
  });

  it('the refresh control puts the board back in the read path', () => {
    openWith(INDEX);
    renderWithProviders(<NewspaperModal />);
    fireEvent.click(screen.getByLabelText('Refresh'));
    expect(useNewspaperStore.getState().loadState).toBe('idle');
  });

  it('closes the modal', () => {
    openWith(INDEX);
    renderWithProviders(<NewspaperModal />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(useUiStore.getState().modal).toBeNull();
  });
});

// =============================================================================
// The paper view — `newsreader.asp` (#516)
// =============================================================================

const NEWEST = '002147483640@3-1-2027';
const OLDER = '002147483641@2-28-2027';

const ISSUE_REFS: NewspaperIssueRef[] = [
  { folder: NEWEST, date: '3/1/2027' },
  { folder: OLDER, date: '2/28/2027' },
];

const ISSUE: NewspaperIssue = {
  paperName: 'Helartia Herald',
  folder: NEWEST,
  townName: 'Helartia',
  title: 'Helartia Herald',
  date: 'Monday, March 01, 2027',
  stories: [
    { headline: 'Domestic Wars!', byline: '', body: 'One person died last night.' },
    { headline: 'Renaissance art', byline: 'by Marco Ferrari', body: 'The IFEL collection arrived.' },
  ],
  error: '',
};

/** Open the modal on the paper view, in whatever read state the case needs. */
function openPaper(over: Partial<{
  issues: NewspaperIssueRef[];
  issuesState: 'idle' | 'loading' | 'loaded' | 'error';
  issuesError: string;
  selectedFolder: string;
  issue: NewspaperIssue | null;
  issueState: 'idle' | 'loading' | 'loaded' | 'error';
  paperName: string;
}> = {}): void {
  const { paperName = CONTEXT.paperName, ...rest } = over;
  useUiStore.getState().openModal('newspaper');
  useNewspaperStore.setState({
    context: { ...CONTEXT, paperName },
    view: 'paper',
    board: null,
    loadState: 'idle',
    issues: [],
    issuesState: 'idle',
    issuesError: '',
    selectedFolder: '',
    issue: null,
    issueState: 'idle',
    ...rest,
  });
}

describe('NewspaperModal — the paper view', () => {
  it('reads the issue bar on open when nothing has been read', () => {
    const spy = jest.fn();
    openPaper();
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onRequestNewspaperIssues: spy }) },
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not read the bar again while a read is in flight', () => {
    const spy = jest.fn();
    openPaper({ issuesState: 'loading' });
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onRequestNewspaperIssues: spy }) },
    );
    expect(spy).not.toHaveBeenCalled();
  });

  // The board is the other section: opening the paper must not fetch it too.
  it('the board view does not read the issue bar', () => {
    const spy = jest.fn();
    openWith(INDEX, 'loaded', 'board');
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onRequestNewspaperIssues: spy }) },
    );
    expect(spy).not.toHaveBeenCalled();
  });

  // `ShowBar.asp:87` selects the first folder when `Selected` arrives empty —
  // which, sorted, is the newest issue.
  it('opens the newest issue once the bar lands', () => {
    const spy = jest.fn();
    openPaper({ issues: ISSUE_REFS, issuesState: 'loaded' });
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onRequestNewspaperIssue: spy }) },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(NEWEST);
  });

  it('does not re-open an issue once one is selected', () => {
    const spy = jest.fn();
    openPaper({
      issues: ISSUE_REFS, issuesState: 'loaded',
      selectedFolder: NEWEST, issue: ISSUE, issueState: 'loaded',
    });
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onRequestNewspaperIssue: spy }) },
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('lists the kept issues by date, newest first, marking the open one', () => {
    openPaper({
      issues: ISSUE_REFS, issuesState: 'loaded',
      selectedFolder: NEWEST, issue: ISSUE, issueState: 'loaded',
    });
    renderWithProviders(<NewspaperModal />);

    const rail = screen.getByLabelText('Issues');
    const dates = Array.from(rail.querySelectorAll('button')).map((b) => b.textContent);
    expect(dates).toEqual(['3/1/2027', '2/28/2027']);
    expect(screen.getByText('3/1/2027').getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('2/28/2027').getAttribute('aria-current')).toBeNull();
  });

  it('picking a date loads that issue', () => {
    const spy = jest.fn();
    openPaper({
      issues: ISSUE_REFS, issuesState: 'loaded',
      selectedFolder: NEWEST, issue: ISSUE, issueState: 'loaded',
    });
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({ onRequestNewspaperIssue: spy }) },
    );
    fireEvent.click(screen.getByText('2/28/2027'));
    expect(spy).toHaveBeenCalledWith(OLDER);
  });

  it('shows the masthead and every story of the open issue', () => {
    openPaper({
      issues: ISSUE_REFS, issuesState: 'loaded',
      selectedFolder: NEWEST, issue: ISSUE, issueState: 'loaded',
    });
    renderWithProviders(<NewspaperModal />);
    expect(screen.getByText('Helartia')).toBeTruthy();
    expect(screen.getByText('Monday, March 01, 2027')).toBeTruthy();
    expect(screen.getByText('Domestic Wars!')).toBeTruthy();
    expect(screen.getByText('One person died last night.')).toBeTruthy();
    expect(screen.getByText('Renaissance art')).toBeTruthy();
    expect(screen.getByText('by Marco Ferrari')).toBeTruthy();
  });

  it('reports an issue that could not be read', () => {
    openPaper({
      issues: ISSUE_REFS, issuesState: 'loaded',
      selectedFolder: NEWEST,
      issue: { ...ISSUE, stories: [], error: 'The issue could not be read.' },
      issueState: 'error',
    });
    renderWithProviders(<NewspaperModal />);
    expect(screen.getByText('The issue could not be read.')).toBeTruthy();
  });

  it('reports a bar that could not be read', () => {
    openPaper({ issuesState: 'error', issuesError: 'The newspaper answered HTTP 500.' });
    renderWithProviders(<NewspaperModal />);
    expect(screen.getByText('The newspaper answered HTTP 500.')).toBeTruthy();
  });

  // `ShowPaper.asp:19-24` — the state a paper with no issue shows forever.
  // Never an empty frame.
  it('says so when the paper has printed nothing yet', () => {
    openPaper({ issues: [], issuesState: 'loaded' });
    renderWithProviders(<NewspaperModal />);
    expect(screen.getByText('No issue of Helartia Herald has been printed yet.')).toBeTruthy();
    expect(screen.getByText('Connecting to Helartia Herald servers...')).toBeTruthy();
  });

  it('a town with no paper is told so, and nothing is requested', () => {
    const issues = jest.fn();
    const board = jest.fn();
    openPaper({ paperName: '' });
    renderWithProviders(
      <NewspaperModal />,
      { clientCallbacks: createSpiedCallbacks({
        onRequestNewspaperIssues: issues,
        onRequestNewspaperBoard: board,
      }) },
    );
    expect(screen.getByText('This town has no newspaper.')).toBeTruthy();
    expect(issues).not.toHaveBeenCalled();
    expect(board).not.toHaveBeenCalled();
  });

  it('the refresh control puts the paper back in the read path', () => {
    openPaper({
      issues: ISSUE_REFS, issuesState: 'loaded',
      selectedFolder: NEWEST, issue: ISSUE, issueState: 'loaded',
    });
    renderWithProviders(<NewspaperModal />);
    fireEvent.click(screen.getByLabelText('Refresh'));
    expect(useNewspaperStore.getState().issuesState).toBe('idle');
    expect(useNewspaperStore.getState().selectedFolder).toBe('');
    expect(useNewspaperStore.getState().issue).toBeNull();
  });
});

// ---- The switch (`ShowBar.asp:114-160`) ----

describe('NewspaperModal — the section switch', () => {
  it('moves to the board and back without closing the modal or losing either side', () => {
    openPaper({
      issues: ISSUE_REFS, issuesState: 'loaded',
      selectedFolder: NEWEST, issue: ISSUE, issueState: 'loaded',
    });
    act(() => { useNewspaperStore.setState({ board: INDEX, loadState: 'loaded' }); });
    renderWithProviders(<NewspaperModal />);

    fireEvent.click(screen.getByText('Read Columns'));
    expect(useUiStore.getState().modal).toBe('newspaper');
    expect(useNewspaperStore.getState().view).toBe('board');
    expect(screen.getByText('VERY NICE GUY')).toBeTruthy();

    fireEvent.click(screen.getByText('Read News'));
    expect(useUiStore.getState().modal).toBe('newspaper');
    expect(useNewspaperStore.getState().view).toBe('paper');
    // The issue was never dropped: no re-read, the same page is back.
    expect(useNewspaperStore.getState().issues).toEqual(ISSUE_REFS);
    expect(screen.getByText('Domestic Wars!')).toBeTruthy();
  });

  it('marks which section is showing', () => {
    openWith(INDEX, 'loaded', 'board');
    renderWithProviders(<NewspaperModal />);
    expect(screen.getByText('Read Columns').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Read News').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Editorial section')).toBeTruthy();

    fireEvent.click(screen.getByText('Read News'));
    expect(screen.getByText('Read News').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Daily issue')).toBeTruthy();
  });
});
