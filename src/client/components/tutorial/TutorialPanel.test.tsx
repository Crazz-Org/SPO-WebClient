/**
 * `TutorialPanel` — what a player sees, and what they must never see.
 *
 * The scenario test in `src/mock-server/scenarios/tutorial-scenario.test.tsx`
 * drives this panel through the real protocol path. This file pins the parts
 * that are the component's own: the rendered nothing when there is no
 * assignment, the URL that never appears, the three actions and the stage-0
 * guard, and the Get New Assignment block that only the server's done flag
 * reveals.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { TutorialPanel, fillPlaceholders } from './TutorialPanel';
import { ClientContext } from '../../context/ClientContext';
import type { ClientCallbacks } from '../../bridge/client-bridge';
import { useTutorialStore } from '../../store/tutorial-store';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import type { TutorialState } from '@/shared/types';

const WELCOME: TutorialState = {
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

const GOAL_TASK: TutorialState = {
  ...WELCOME,
  kindId: 'GrowMoney',
  name: 'Make Profit',
  stage: 0,
  progress: 50,
  goal: '$5,000,000',
};

function renderPanel(overrides: Partial<ClientCallbacks> = {}) {
  const onTutorialState = jest.fn();
  const onTutorialAction = jest.fn();
  const callbacks = { onTutorialState, onTutorialAction, ...overrides } as unknown as ClientCallbacks;
  const result = render(
    <ClientContext.Provider value={callbacks}>
      <TutorialPanel />
    </ClientContext.Provider>,
  );
  return { ...result, onTutorialState, onTutorialAction };
}

beforeEach(() => {
  useTutorialStore.getState().reset();
  useUiStore.setState({ stack: [] });
  useGameStore.setState({ username: 'SPO_test3', worldName: 'Shamba' });
});

describe('TutorialPanel — no assignment', () => {
  it('renders NOTHING at all, not an empty panel', () => {
    useTutorialStore.setState({ assignment: null, loaded: true });
    const { container } = renderPanel();
    expect(container.innerHTML).toBe('');
  });

  it('asks the gateway once when the state is not yet known', () => {
    const { onTutorialState } = renderPanel();
    expect(onTutorialState).toHaveBeenCalledTimes(1);
  });

  it('does not ask again once the answer has landed', () => {
    useTutorialStore.setState({ assignment: null, loaded: true });
    const { onTutorialState } = renderPanel();
    expect(onTutorialState).not.toHaveBeenCalled();
  });
});

describe('TutorialPanel — a live assignment', () => {
  it('renders the title, the progress and the stage instructions, and never a URL', () => {
    act(() => { useTutorialStore.getState().setAssignment(WELCOME); });
    const { container } = renderPanel();

    expect(screen.getByText('Tutorial Welcome')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
    // A sentence of the Welcome page, with the two placeholders substituted.
    expect(screen.getByText(/Hello SPO_test3, welcome to Shamba/)).toBeTruthy();
    expect(container.textContent).not.toContain('http');
    expect(container.textContent).not.toContain('.asp');
  });

  it('renders the goal only when the server wrote one', () => {
    act(() => { useTutorialStore.getState().setAssignment(WELCOME); });
    const first = renderPanel();
    expect(first.container.textContent).not.toContain('Goal');
    first.unmount();

    act(() => { useTutorialStore.getState().setAssignment(GOAL_TASK); });
    renderPanel();
    expect(screen.getByText('Goal')).toBeTruthy();
    expect(screen.getByText('$5,000,000')).toBeTruthy();
  });

  it('shows no instructions, and does not crash, for a kind it has no page for', () => {
    act(() => {
      useTutorialStore.getState().setAssignment({ ...WELCOME, kindId: 'SomethingNew', name: 'A new task' });
    });
    const { container } = renderPanel();

    expect(screen.getByText('A new task')).toBeTruthy();
    expect(container.textContent).not.toContain('http');
  });

  it('shows no instructions for a stage past the end of the kind', () => {
    act(() => { useTutorialStore.getState().setAssignment({ ...WELCOME, stage: 9 }); });
    const { container } = renderPanel();
    expect(screen.getByText('Tutorial Welcome')).toBeTruthy();
    expect(container.textContent).not.toContain('Hello SPO_test3');
  });
});

describe('TutorialPanel — the footer', () => {
  it('Continue asks for the next step and marks the action in flight', () => {
    act(() => { useTutorialStore.getState().setAssignment(GOAL_TASK); });
    const { onTutorialAction } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(onTutorialAction).toHaveBeenCalledWith('next');
    expect(useTutorialStore.getState().pending).toBe('next');
  });

  it('Back is disabled at stage 0 — the server no-ops RDOPrevStep there', () => {
    act(() => { useTutorialStore.getState().setAssignment(GOAL_TASK); });
    renderPanel();
    expect(screen.getByRole('button', { name: /Back/ })).toHaveProperty('disabled', true);
  });

  it('Back asks for the previous step past stage 0', () => {
    act(() => { useTutorialStore.getState().setAssignment({ ...GOAL_TASK, stage: 2 }); });
    const { onTutorialAction } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Back/ }));

    expect(onTutorialAction).toHaveBeenCalledWith('prev');
  });

  it('Close acts on the task and pops the surface', () => {
    act(() => { useTutorialStore.getState().setAssignment(GOAL_TASK); });
    useUiStore.getState().pushSurface({ kind: 'tutorial' });
    const { onTutorialAction } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Close/ }));

    expect(onTutorialAction).toHaveBeenCalledWith('close');
    expect(useUiStore.getState().stack).toHaveLength(0);
  });

  it('every action is disabled while one is in flight', () => {
    act(() => {
      useTutorialStore.getState().setAssignment({ ...GOAL_TASK, stage: 2 });
      useTutorialStore.getState().setPending('next');
    });
    renderPanel();

    for (const name of [/Back/, /Continue/, /Close/]) {
      expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true);
    }
  });
});

describe('TutorialPanel — the done flag', () => {
  it('offers Get New Assignment only when the server says the task is done', () => {
    act(() => { useTutorialStore.getState().setAssignment(GOAL_TASK); });
    const first = renderPanel();
    expect(first.queryByRole('button', { name: /Get New Assignment/ })).toBeNull();
    first.unmount();

    act(() => { useTutorialStore.getState().setAssignment({ ...GOAL_TASK, done: true }); });
    const { onTutorialAction } = renderPanel();

    // The meaning rides on the words, not only on the colour.
    expect(screen.getByText(/Congratulations, you have completed this Assignment/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Get New Assignment/ }));
    expect(onTutorialAction).toHaveBeenCalledWith('complete');
  });
});

describe('fillPlaceholders', () => {
  it('substitutes the five placeholders, falling back when a field is empty', () => {
    const text = '{tycoon} / {world} / {company} / {town} / {goal}';
    expect(fillPlaceholders(text, GOAL_TASK, 'SPO_test3', 'Shamba'))
      .toBe('SPO_test3 / Shamba / Yellow Inc. / Shamba / $5,000,000');
    expect(fillPlaceholders(text, { ...GOAL_TASK, company: '', town: '', goal: '' }, '', ''))
      .toBe('Tycoon / this world / your company / your town / your goal');
  });
});
