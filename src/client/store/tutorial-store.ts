/**
 * Tutorial Store — the tycoon's one live assignment, and what the panel is doing to it.
 *
 * The assignment itself is entirely the server's: this store never invents one,
 * never derives one, and holds exactly what the last RESP_TUTORIAL_STATE said.
 * `null` means "the server says there is none", which is a rendered nothing.
 */

import { create } from 'zustand';
import type { TutorialState, TutorialActionType } from '@/shared/types';

interface TutorialStoreState {
  /** The live assignment, or null for "no assignment". */
  assignment: TutorialState | null;
  /**
   * false until the first RESP_TUTORIAL_STATE. "Unknown" is not "none": the
   * panel asks once on mount when this is still false, so opening it from the
   * profile works even if no push ever arrived.
   */
  loaded: boolean;
  /** Set before a push-driven read, so the panel opens itself when the state lands. */
  autoOpen: boolean;
  /** The action in flight, so the footer can disable itself. */
  pending: TutorialActionType | null;

  setAssignment(a: TutorialState | null): void;
  setAutoOpen(v: boolean): void;
  setPending(a: TutorialActionType | null): void;
  reset(): void;
}

const INITIAL = {
  assignment: null as TutorialState | null,
  loaded: false,
  autoOpen: false,
  pending: null as TutorialActionType | null,
};

export const useTutorialStore = create<TutorialStoreState>((set) => ({
  ...INITIAL,

  // Any answer from the server is proof the state is known, so `loaded` rises
  // here and nowhere else.
  setAssignment: (assignment) => set({ assignment, loaded: true }),
  setAutoOpen: (autoOpen) => set({ autoOpen }),
  setPending: (pending) => set({ pending }),
  reset: () => set({ ...INITIAL }),
}));
