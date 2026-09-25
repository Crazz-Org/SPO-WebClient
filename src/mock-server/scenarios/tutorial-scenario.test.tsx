/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `tutorial` — the onboarding curriculum, driven end to end through the real
 * code: the scenario's kind-1 frame through the real gateway push dispatcher,
 * into the real browser event handler; then the real `fetchTutorialState`
 * against the scenario's own cache answers; then the real `TutorialPanel`
 * rendering what came back.
 *
 * The criterion this file carries is the one nothing else can: a kind-1
 * notification followed by a tutorial-state read produces a RENDERED
 * ASSIGNMENT and no toast containing a URL.
 */

jest.mock('@/client/bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    addChatMessage: jest.fn(),
    setBuildMenuCategories: jest.fn(),
  },
}));

import { render, screen } from '@testing-library/react';
import { RdoProtocol } from '@/server/rdo';
import { rdoCall, rdoSet, RdoFrameError } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoPacket, WsMessage } from '@/shared/types';
import { WsMessageType, type WsEventShowNotification } from '@/shared/types';
import { makePushCtx, makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { dispatchPush } from '@/server/session/push-dispatcher';
import { fetchTutorialState } from '@/server/session/tutorial-handler';
import { dispatchEvent } from '@/client/handlers/event-handler';
import { useTutorialStore } from '@/client/store/tutorial-store';
import { useUiStore } from '@/client/store/ui-store';
import { useGameStore } from '@/client/store/game-store';
import { ClientContext } from '@/client/context/ClientContext';
import type { ClientCallbacks } from '@/client/bridge/client-bridge';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import { TutorialPanel } from '@/client/components/tutorial';
import { RdoMock } from '../rdo-mock';
import {
  createTutorialScenario, tutorialStateFor, TUTORIAL_TARGETS,
  type TutorialAssignmentVariant,
} from './tutorial-scenario';

const { rdo } = createTutorialScenario();

function parsePush(frame: string): RdoPacket {
  return RdoProtocol.parse(frame) as RdoPacket;
}

/** The exact frame the scenario ships, never a copy. */
function exchange(id: string) {
  const found = rdo.exchanges.find((e) => e.id === id);
  expect(found).toBeDefined();
  return found!;
}

/** Drives a raw push frame through the real gateway dispatcher. */
function pushToEvent(frame: string): WsEventShowNotification {
  const push = makePushCtx();
  dispatchPush(push.ctx, 'world', parsePush(frame));
  const emitted = (push.ctx.emit as jest.Mock).mock.calls
    .filter(([channel]) => channel === 'ws_event')
    .map(([, event]) => event as WsMessage)
    .find((e) => e.type === WsMessageType.EVENT_SHOW_NOTIFICATION);
  expect(emitted).toBeDefined();
  return emitted as WsEventShowNotification;
}

function makeClientDriver() {
  const showNotification = jest.fn();
  const sendMessage = jest.fn();
  const ctx = { showNotification, sendMessage } as unknown as ClientHandlerContext;
  return { ctx, showNotification, sendMessage };
}

/**
 * The real `fetchTutorialState`, answered by `RdoMock` through the scenario's
 * own exchanges — the same wiring `civic-mutations-scenario.test.ts` uses, so
 * the decode is proved against the fixture and not against a hand-written stub.
 */
async function readStateThroughMock(variant: TutorialAssignmentVariant) {
  const { rdo: scenario } = createTutorialScenario(undefined, { assignment: variant });
  const mock = new RdoMock();
  mock.addScenario(scenario);

  const fake = makeSessionCtx({ cachedUsername: 'SPO_test3', sockets: ['construction'] });
  fake.cacher.createObject.mockResolvedValue(TUTORIAL_TARGETS.tempObject); // substrate-exception: the fake's cacher emits no frame, so no RdoMock scenario can answer it
  fake.cacher.setPath.mockImplementation(async (id, path) => { // substrate-exception: the fake's cacher emits no frame, so no RdoMock scenario can answer it
    const result = mock.match(rdoCall('SetPath', id, RdoValue.string(path)).toFrame());
    if (!result) throw new Error(`L1: no exchange for SetPath ${path}`);
  });
  fake.cacher.getPropertyList.mockImplementation(async (id, props) => { // substrate-exception: the fake's cacher emits no frame, so no RdoMock scenario can answer it
    const frame = rdoCall('GetPropertyList', id, RdoValue.string(props.join('\t') + '\t')).toFrame();
    const result = mock.match(frame);
    if (!result) throw new Error(`L1: no exchange for GetPropertyList ${props.join(',')}`);
    const m = /res="%([^"]*)"/.exec(result.response);
    return m ? m[1].split('\t') : [];
  });

  return fetchTutorialState(fake.ctx);
}

function renderPanel() {
  const onTutorialState = jest.fn();
  const onTutorialAction = jest.fn();
  const callbacks = { onTutorialState, onTutorialAction } as unknown as ClientCallbacks;
  return render(
    <ClientContext.Provider value={callbacks}>
      <TutorialPanel />
    </ClientContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useTutorialStore.getState().reset();
  useUiStore.setState({ stack: [], modal: null });
  useGameStore.setState({ username: 'SPO_test3', worldName: 'Shamba' });
});

describe('tutorial scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('the three navigation actions are procedures: "*", never "^"', () => {
    for (const slug of ['next', 'prev', 'close']) {
      const ex = exchange(`tutorial-rdo-${slug}`);
      expect(ex.request).toContain('"*"');
      expect(ex.request).not.toContain('"^"');
      expect(ex.request).toContain(`sel ${TUTORIAL_TARGETS.taskObjId} call`);
      // A procedure answers nothing — the frame is the only evidence there is.
      expect(ex.response).toBe('');
    }
  });

  it('Completed is emitted as a set, never as a call', () => {
    const ex = exchange('tutorial-rdo-complete');
    expect(ex.request).toContain(`sel ${TUTORIAL_TARGETS.taskObjId} set Completed=`);
    expect(ex.request).not.toContain('call Completed');
    expect(ex.matchKeys?.action).toBe('set');
  });

  it('both pushes are kind 1 and differ only in Options — 4 shows, 0 hides', () => {
    expect(exchange('tutorial-push-show').response).toContain('"#4";');
    expect(exchange('tutorial-push-hide').response).toContain('"#0";');
    for (const id of ['tutorial-push-show', 'tutorial-push-hide']) {
      const ex = exchange(id);
      expect(ex.pushOnly).toBe(true);
      expect(ex.request).toBe('');
      expect(ex.response).toContain('call ShowNotification "*" "#1"');
    }
  });
});

describe('tutorial scenario — the push, through the real dispatchers', () => {
  it('a kind-1 push raises no toast and asks for the tutorial state', () => {
    const event = pushToEvent(exchange('tutorial-push-show').response);
    expect(event.kind).toBe(1);
    expect(event.options).toBe(4);
    expect(event.body).toContain('/Tasks/Welcome/0/default.asp');

    const { ctx, showNotification, sendMessage } = makeClientDriver();
    dispatchEvent(ctx, event);

    // No toast at all — so, in particular, none carrying the URL or the body.
    expect(showNotification).not.toHaveBeenCalled();
    for (const call of showNotification.mock.calls) {
      expect(String(call[0])).not.toContain('http');
      expect(String(call[0])).not.toContain('.asp');
    }
    expect(sendMessage).toHaveBeenCalledWith({ type: WsMessageType.REQ_TUTORIAL_STATE });
    expect(useTutorialStore.getState().autoOpen).toBe(true);
  });

  it('the hide push clears the store and pops the surface', () => {
    useTutorialStore.getState().setAssignment(tutorialStateFor('welcome'));
    useUiStore.getState().pushSurface({ kind: 'tutorial' });

    const event = pushToEvent(exchange('tutorial-push-hide').response);
    const { ctx, sendMessage } = makeClientDriver();
    dispatchEvent(ctx, event);

    expect(useTutorialStore.getState().assignment).toBeNull();
    expect(useUiStore.getState().stack).toHaveLength(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('tutorial scenario — the state read, through the real gateway', () => {
  it('decodes the Welcome assignment off the tycoon folder', async () => {
    expect(await readStateThroughMock('welcome')).toEqual(tutorialStateFor('welcome'));
  });

  it('decodes the money-goal assignment, goal included', async () => {
    expect(await readStateThroughMock('goal')).toEqual(tutorialStateFor('goal'));
  });

  it('decodes the finished assignment with its done flag set', async () => {
    const state = await readStateThroughMock('done');
    expect(state).toEqual(tutorialStateFor('done'));
    expect(state?.done).toBe(true);
  });

  it('the tycoon with no assignment decodes to null', async () => {
    expect(await readStateThroughMock('none')).toBeNull();
  });
});

describe('tutorial scenario — push then read then render', () => {
  it('renders the assignment, with no URL anywhere on screen', async () => {
    // 1. the push
    const event = pushToEvent(exchange('tutorial-push-show').response);
    const { ctx } = makeClientDriver();
    dispatchEvent(ctx, event);

    // 2. the read the push asked for
    const state = await readStateThroughMock('welcome');
    dispatchEvent(ctx, { type: WsMessageType.RESP_TUTORIAL_STATE, state } as WsMessage);

    // The panel opened itself, exactly as the URL frame used to.
    expect(useUiStore.getState().stack.at(-1)?.kind).toBe('tutorial');

    // 3. the render
    const { container } = renderPanel();
    expect(screen.getByText('Tutorial Welcome')).toBeTruthy();
    expect(screen.getByText(/Hello SPO_test3, welcome to Shamba/)).toBeTruthy();
    expect(container.textContent).not.toContain('http');
    expect(container.textContent).not.toContain('.asp');
    // The URL the push carried is nowhere on screen.
    expect(container.textContent).not.toContain(event.body);
  });

  it('renders the goal and the Get New Assignment block for a finished money task', async () => {
    const state = await readStateThroughMock('done');
    const { ctx } = makeClientDriver();
    dispatchEvent(ctx, { type: WsMessageType.RESP_TUTORIAL_STATE, state } as WsMessage);

    renderPanel();
    expect(screen.getByText('Make Profit')).toBeTruthy();
    expect(screen.getByText('$5,000,000')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Get New Assignment/ })).toBeTruthy();
  });

  it('the tycoon with no assignment renders nothing at all', async () => {
    const state = await readStateThroughMock('none');
    const { ctx } = makeClientDriver();
    dispatchEvent(ctx, { type: WsMessageType.RESP_TUTORIAL_STATE, state } as WsMessage);

    // No assignment, so no surface was pushed either.
    expect(useUiStore.getState().stack).toHaveLength(0);
    const { container } = renderPanel();
    expect(container.innerHTML).toBe('');
  });
});

describe('tutorial scenario — the action answer', () => {
  it('a successful action clears the in-flight flag, stores the new stage and says nothing', async () => {
    const state = await readStateThroughMock('goal');
    useTutorialStore.getState().setPending('next');

    const { ctx, showNotification } = makeClientDriver();
    dispatchEvent(ctx, {
      type: WsMessageType.RESP_TUTORIAL_ACTION, success: true, message: '', state,
    } as WsMessage);

    expect(useTutorialStore.getState().pending).toBeNull();
    expect(useTutorialStore.getState().assignment).toEqual(state);
    // The stage arrives with the push that follows; a success is not news.
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('a refusal is the one thing the player is told about', () => {
    useTutorialStore.getState().setPending('complete');

    const { ctx, showNotification } = makeClientDriver();
    dispatchEvent(ctx, {
      type: WsMessageType.RESP_TUTORIAL_ACTION,
      success: false, message: 'No active assignment', state: null,
    } as WsMessage);

    expect(useTutorialStore.getState().pending).toBeNull();
    expect(useTutorialStore.getState().assignment).toBeNull();
    expect(showNotification).toHaveBeenCalledWith('No active assignment', 'error');
  });

  it('a refusal with no message still says something legible', () => {
    const { ctx, showNotification } = makeClientDriver();
    dispatchEvent(ctx, {
      type: WsMessageType.RESP_TUTORIAL_ACTION, success: false, message: '', state: null,
    } as WsMessage);

    expect(showNotification).toHaveBeenCalledWith('The assignment could not be updated', 'error');
  });
});

describe('tutorial scenario — degenerate emission forms throw', () => {
  it('a zero-argument RDONextStep is refused by the arity guard', () => {
    expect(() => rdoCall('RDONextStep', TUTORIAL_TARGETS.taskObjId))
      .toThrow(RdoFrameError);
  });

  it('calling the Completed accessor is refused', () => {
    expect(() => rdoCall('Completed' as never, TUTORIAL_TARGETS.taskObjId, RdoValue.int(-1)))
      .toThrow(RdoFrameError);
  });

  it('setting a procedure is refused — RDOClose is not a property', () => {
    expect(() => rdoSet('RDOClose' as never, TUTORIAL_TARGETS.taskObjId, RdoValue.int(0)))
      .toThrow(RdoFrameError);
  });
});
