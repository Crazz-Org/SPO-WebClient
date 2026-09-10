/**
 * Newspaper Store — the town paper: its daily issues and its editorial board.
 *
 * Holds which paper is open, which of its two sections is showing, and what the
 * gateway last read off each. Both are remote ASP trees, so nothing here is
 * derived: every navigation is a request and the answer replaces the state
 * wholesale.
 */

import { create } from 'zustand';
import type { NewspaperBoard, NewspaperIssue, NewspaperIssueList, NewspaperIssueRef } from '@/shared/types';

export type NewspaperLoadState = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * Which of the paper's two sections is on screen — the switch `ShowBar.asp:114-160`
 * puts on the bar, where it swaps the main frame without leaving the reader.
 */
export type NewspaperView = 'paper' | 'board';

/** Which building the board was opened from — every board request needs it. */
export interface NewspaperContext {
  paperName: string;
  townName: string;
  isCapitol: boolean;
  buildingX: number;
  buildingY: number;
}

interface NewspaperState {
  context: NewspaperContext | null;
  view: NewspaperView;

  board: NewspaperBoard | null;
  loadState: NewspaperLoadState;
  /** Path being requested, so a stale answer for another column can be ignored. */
  requestedPath: string;
  isPosting: boolean;

  /** The paper's kept issues, newest first as the gateway sorted them. */
  issues: NewspaperIssueRef[];
  issuesState: NewspaperLoadState;
  issuesError: string;
  /** Folder being requested, so a stale answer for another issue can be ignored. */
  selectedFolder: string;
  issue: NewspaperIssue | null;
  issueState: NewspaperLoadState;

  openFor: (context: NewspaperContext, view?: NewspaperView) => void;
  setView: (view: NewspaperView) => void;
  setLoadState: (state: NewspaperLoadState) => void;
  setRequestedPath: (path: string) => void;
  setBoard: (board: NewspaperBoard) => void;
  setPosting: (posting: boolean) => void;
  setIssuesState: (state: NewspaperLoadState) => void;
  setIssues: (list: NewspaperIssueList) => void;
  selectIssue: (folder: string) => void;
  setIssue: (issue: NewspaperIssue) => void;
  refreshIssues: () => void;
  reset: () => void;
}

const EMPTY = {
  context: null,
  view: 'board' as NewspaperView,
  board: null,
  loadState: 'idle' as NewspaperLoadState,
  requestedPath: '',
  isPosting: false,
  issues: [] as NewspaperIssueRef[],
  issuesState: 'idle' as NewspaperLoadState,
  issuesError: '',
  selectedFolder: '',
  issue: null,
  issueState: 'idle' as NewspaperLoadState,
};

export const useNewspaperStore = create<NewspaperState>((set) => ({
  ...EMPTY,

  // A different paper starts from scratch; re-opening the same one keeps what
  // was already read, so closing and re-opening the modal costs no round-trip.
  openFor: (context, view = 'board') => set((state) =>
    state.context
      && state.context.paperName === context.paperName
      && state.context.buildingX === context.buildingX
      && state.context.buildingY === context.buildingY
      ? { context, view }
      : { ...EMPTY, context, view }
  ),

  // The switch moves between the two sections only. Neither side is cleared:
  // the bar swaps the main frame in place, and coming back must not re-read.
  setView: (view) => set({ view }),

  setLoadState: (loadState) => set({ loadState }),
  setRequestedPath: (requestedPath) => set({ requestedPath, loadState: 'loading' }),
  setBoard: (board) => set({
    board,
    loadState: board.error ? 'error' : 'loaded',
    isPosting: false,
  }),
  setPosting: (isPosting) => set({ isPosting }),

  setIssuesState: (issuesState) => set({ issuesState }),
  setIssues: (list) => set({
    issues: list.issues,
    issuesState: list.error ? 'error' : 'loaded',
    issuesError: list.error,
  }),
  selectIssue: (selectedFolder) => set({ selectedFolder, issueState: 'loading' }),
  // An answer for a folder nobody is waiting on is a stale round-trip, not the
  // issue on screen — same rule as `requestedPath` on the board side.
  setIssue: (issue) => set((state) => state.selectedFolder !== issue.folder
    ? {}
    : { issue, issueState: issue.error ? 'error' : 'loaded' }),
  // The re-read signal for the paper view: back to `idle` with nothing selected,
  // so the modal asks for the list again and then for its newest issue.
  refreshIssues: () => set({
    issues: [],
    issuesState: 'idle',
    issuesError: '',
    selectedFolder: '',
    issue: null,
    issueState: 'idle',
  }),

  reset: () => set(EMPTY),
}));
