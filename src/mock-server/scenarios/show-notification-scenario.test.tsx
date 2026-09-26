/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `show-notification` — driven through the real gateway push dispatcher and the
 * real browser event handler, per kind. `ShowNotification` is a `procedure` push
 * (`Protocol/Protocol.pas:219`), so there is no request/response half to prove —
 * the four frames plus the browser behaviour they produce are the only evidence
 * that the kind dispatch this scenario pins (`Voyager/VoyagerWindow.pas:506-563`)
 * is what the browser actually does.
 *
 * Kind 1 is the onboarding curriculum and it routes on `Options`, not on the
 * body: `nopTutorial_SHOW`/`_ON` means "there is an assignment, go read it",
 * `nopTutorial_OFF` means "take it away" (`Tasks/Tasks.pas:29-32`, `:636-644`;
 * `Voyager/URLNotification.pas:77`). Neither raises a toast — the panel is the
 * notification. What the assignment then looks like is the `tutorial` scenario's
 * half; this one proves only that the push is routed and never rendered.
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
import type { RdoPacket, WsMessage } from '@/shared/types';
import { WsMessageType, type WsEventShowNotification } from '@/shared/types';
import { makePushCtx } from '@/server/__tests__/session/fake-session-context';
import { dispatchPush } from '@/server/session/push-dispatcher';
import { dispatchEvent } from '@/client/handlers/event-handler';
import { ClientBridge } from '@/client/bridge/client-bridge';
import { useUiStore } from '@/client/store/ui-store';
import { useChatStore } from '@/client/store/chat-store';
import { useTutorialStore } from '@/client/store/tutorial-store';
import { ConfirmDialog } from '@/client/components/common/ConfirmDialog';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import { createShowNotificationScenario } from './show-notification-scenario';
import { tutorialStateFor } from './tutorial-scenario';

/** A live assignment, taken from the tutorial scenario rather than invented here. */
const WELCOME_ASSIGNMENT = tutorialStateFor('welcome')!;

const { rdo } = createShowNotificationScenario();

function parsePush(frame: string): RdoPacket {
  return RdoProtocol.parse(frame) as RdoPacket;
}

/** The exact frame the scenario ships for a kind — never a copy. */
function frameForKind(kind: number): string {
  return rdo.exchanges.find((e) => e.id === `notif-kind${kind}`)!.response;
}

/** Drives a raw push frame through the real gateway dispatcher and returns the emitted event. */
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
  const ctx = {
    showNotification,
    sendMessage,
    buildingCategories: [{ id: 'existing' }],
  } as unknown as ClientHandlerContext;
  return { ctx, showNotification, sendMessage };
}

beforeEach(() => {
  jest.clearAllMocks();
  useUiStore.setState({ modal: null, confirmPayload: null, stack: [] });
  useChatStore.setState({ currentChannel: 'Lobby', unreadChatCount: 0, messages: {} });
  useTutorialStore.getState().reset();
});

describe('show-notification scenario — the catalogue', () => {
  it('every exchange is a push with no request and a "*" separator', () => {
    for (const ex of rdo.exchanges) {
      expect(ex.pushOnly).toBe(true);
      expect(ex.request).toBe('');
      expect(ex.response).toContain('"*"');
      expect(ex.response).not.toContain('"^"');
    }
  });
});

describe('show-notification scenario — kind 0, message box', () => {
  it('opens the confirm dialog with title and body, and raises no toast', () => {
    const event = pushToEvent(frameForKind(0));
    expect(event.kind).toBe(0);
    expect(event.title).toBe('Server maintenance');
    expect(event.body).toBe('The world restarts in 10 minutes.');

    const { ctx, showNotification } = makeClientDriver();
    dispatchEvent(ctx, event);

    const { modal, confirmPayload } = useUiStore.getState();
    expect(modal).toBe('confirm');
    expect(confirmPayload).toMatchObject({ title: 'Server maintenance', message: 'The world restarts in 10 minutes.' });
    expect(showNotification).not.toHaveBeenCalled();

    render(
      <ConfirmDialog
        title={confirmPayload!.title}
        message={confirmPayload!.message}
        confirmText={confirmPayload!.options?.typeToConfirm}
        kind={confirmPayload!.options?.kind}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Server maintenance')).toBeTruthy();
    expect(screen.getByText('The world restarts in 10 minutes.')).toBeTruthy();
  });
});

describe('show-notification scenario — kind 1, the onboarding curriculum', () => {
  it('raises no toast at all and asks the gateway for the tutorial state', () => {
    const event = pushToEvent(frameForKind(1));
    expect(event.kind).toBe(1);
    expect(event.body).toContain('default.asp');
    // nopTutorial_SHOW — "there is an assignment" (Tasks/Tasks.pas:285).
    expect(event.options).toBe(4);

    const { ctx, showNotification, sendMessage } = makeClientDriver();
    dispatchEvent(ctx, event);

    // The panel IS the notification, exactly as the URL frame was: neither the
    // URL nor the title reaches a toast.
    expect(showNotification).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({ type: WsMessageType.REQ_TUTORIAL_STATE });
    expect(useTutorialStore.getState().autoOpen).toBe(true);

    // The URL still reaches the diagnostics log, and only it.
    const logged = (ClientBridge.log as jest.Mock).mock.calls
      .some(([, message]) => typeof message === 'string' && message.includes('default.asp'));
    expect(logged).toBe(true);
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('the same push with nopTutorial_OFF clears the assignment and asks for nothing', () => {
    const hideFrame = frameForKind(1).replace('"#4";', '"#0";');
    const event = pushToEvent(hideFrame);
    expect(event.options).toBe(0);

    useTutorialStore.setState({ assignment: WELCOME_ASSIGNMENT, loaded: true });

    const { ctx, showNotification, sendMessage } = makeClientDriver();
    dispatchEvent(ctx, event);

    expect(useTutorialStore.getState().assignment).toBeNull();
    expect(showNotification).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('show-notification scenario — kinds 2 and 3, chat system line', () => {
  it('kind 2 adds an uppercase-title chat system line, scrollable and not counted unread', () => {
    const event = pushToEvent(frameForKind(2));
    expect(event.kind).toBe(2);

    const { ctx, showNotification } = makeClientDriver();
    dispatchEvent(ctx, event);

    expect(showNotification).not.toHaveBeenCalled();
    expect(ClientBridge.addChatMessage).toHaveBeenCalledTimes(1);
    const [channel, message] = (ClientBridge.addChatMessage as jest.Mock).mock.calls[0];
    expect(channel).toBe('Lobby');
    expect(message).toMatchObject({ text: 'MAYOR has raised the sales tax.', from: 'SYSTEM', isSystem: true });

    // Feed the captured message into the real store — the isSystem rule (chat-store.ts) applies.
    useChatStore.getState().addMessage(channel, message);
    const state = useChatStore.getState();
    expect(state.unreadChatCount).toBe(0);
    expect(state.messages[channel]).toContainEqual(message);
  });

  it('kind 3 shares the kind-2 branch, built from the kind-2 frame with #3 substituted', () => {
    const kind3Frame = frameForKind(2).replace('"#2"', '"#3"');
    const event = pushToEvent(kind3Frame);
    expect(event.kind).toBe(3);

    const { ctx, showNotification } = makeClientDriver();
    dispatchEvent(ctx, event);

    expect(showNotification).not.toHaveBeenCalled();
    expect(ClientBridge.addChatMessage).toHaveBeenCalledTimes(1);
    const [, message] = (ClientBridge.addChatMessage as jest.Mock).mock.calls[0];
    expect(message).toMatchObject({ text: 'MAYOR has raised the sales tax.', isSystem: true });
  });
});

describe('show-notification scenario — kind 4, unchanged', () => {
  it('toasts and invalidates the build catalogue on option 1', () => {
    const event = pushToEvent(frameForKind(4));
    expect(event.kind).toBe(4);
    expect(event.options).toBe(1);
    expect(event.body).toBe('Research "Water Quest Licenses" completed. Check for new items in your Build page.');

    const { ctx, showNotification } = makeClientDriver();
    dispatchEvent(ctx, event);

    expect(showNotification).toHaveBeenCalledWith(event.body, 'success');
    expect(ctx.buildingCategories).toEqual([]);
    expect(ClientBridge.setBuildMenuCategories).toHaveBeenCalledWith([]);
  });
});
