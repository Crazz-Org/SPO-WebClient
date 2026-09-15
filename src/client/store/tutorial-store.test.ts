/**
 * `tutorial-store` — the assignment the panel draws, and nothing more.
 *
 * The one rule worth a test: `loaded` rises on ANY answer from the server,
 * including `null`. "Unknown" and "none" render differently (the panel asks
 * once when the state is unknown), so collapsing them would make the panel
 * re-ask forever for a tycoon who has no assignment.
 */

import { useTutorialStore } from './tutorial-store';
import type { TutorialState } from '@/shared/types';

const ASSIGNMENT: TutorialState = {
  taskObjId: '130600501',
  kindId: 'Welcome',
  name: 'Tutorial Welcome',
  stage: 0,
  progress: 0,
  goal: '',
  done: false,
  company: 'Yellow Inc.',
  town: 'Shamba',
};

beforeEach(() => {
  useTutorialStore.getState().reset();
});

describe('tutorial-store', () => {
  it('starts with no assignment, unloaded, closed and idle', () => {
    expect(useTutorialStore.getState()).toMatchObject({
      assignment: null, loaded: false, autoOpen: false, pending: null,
    });
  });

  it('setAssignment stores the assignment and marks the state known', () => {
    useTutorialStore.getState().setAssignment(ASSIGNMENT);
    expect(useTutorialStore.getState().assignment).toEqual(ASSIGNMENT);
    expect(useTutorialStore.getState().loaded).toBe(true);
  });

  it('a null answer is still an answer — loaded rises on it too', () => {
    useTutorialStore.getState().setAssignment(null);
    expect(useTutorialStore.getState().assignment).toBeNull();
    expect(useTutorialStore.getState().loaded).toBe(true);
  });

  it('carries the auto-open flag and the action in flight', () => {
    useTutorialStore.getState().setAutoOpen(true);
    useTutorialStore.getState().setPending('next');
    expect(useTutorialStore.getState().autoOpen).toBe(true);
    expect(useTutorialStore.getState().pending).toBe('next');

    useTutorialStore.getState().setAutoOpen(false);
    useTutorialStore.getState().setPending(null);
    expect(useTutorialStore.getState().autoOpen).toBe(false);
    expect(useTutorialStore.getState().pending).toBeNull();
  });

  it('reset returns every field to its initial value', () => {
    useTutorialStore.getState().setAssignment(ASSIGNMENT);
    useTutorialStore.getState().setAutoOpen(true);
    useTutorialStore.getState().setPending('complete');

    useTutorialStore.getState().reset();

    expect(useTutorialStore.getState()).toMatchObject({
      assignment: null, loaded: false, autoOpen: false, pending: null,
    });
  });
});
