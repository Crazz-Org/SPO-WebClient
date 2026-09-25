/**
 * CreateChannelModal — the client-side gate on Create.
 *
 * The disabled button is the hard gate, the direct analogue of Voyager's
 * `btnCreate.Enabled` (`NewChannelForm.pas:57-60`): a non-empty name and two
 * passwords that agree, compared case-INSENSITIVELY like the server does.
 * A refusal from the server leaves the modal mounted so the player can read
 * why and correct the form — and shows the gateway's own sentence, which
 * `client.ts` carries on `serverMessage` (the Error's message is only the
 * generic text for the code, "Unknown error" for most of them).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { CreateChannelModal } from './CreateChannelModal';
import type { WebSocket } from 'ws';
import { RdoProtocol } from '@/server/rdo';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { createChatChannel } from '@/server/session/chat-handler';
import { handleChatCreateChannel } from '@/server/ws-handlers/chat-handlers';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { getErrorMessage } from '@/shared/error-codes';
import { WsMessageType, type WsMessage } from '@/shared/types';
import { RdoMock } from '@/mock-server/rdo-mock';
import {
  createCreateChannelScenario,
  TAKEN_CHANNEL,
  CHANNEL_PASSWORD,
} from '@/mock-server/scenarios/create-channel-scenario';

function openModal() {
  useUiStore.getState().openModal('createChannel');
}

function fill(name: string, password = '', confirm = '') {
  fireEvent.change(screen.getByLabelText('Channel name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Password (optional)'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
}

function createBtn(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
}

function spiedCreate(reject?: Error) {
  const onCreateChannel = jest.fn(async (_name: unknown, _password: unknown) => {
    if (reject) throw reject;
  });
  return {
    onCreateChannel,
    callbacks: createSpiedCallbacks({ onCreateChannel: onCreateChannel as (...a: unknown[]) => unknown }),
  };
}

beforeEach(() => {
  resetStores();
  jest.clearAllMocks();
});

describe('CreateChannelModal — visibility', () => {
  it('renders nothing while another modal holds the slot', () => {
    useUiStore.getState().openModal('settings');
    const { container } = renderWithProviders(<CreateChannelModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog once createChannel is the active modal', () => {
    openModal();
    renderWithProviders(<CreateChannelModal />);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('CreateChannelModal — the Create gate', () => {
  beforeEach(openModal);

  it('is disabled on an empty name and enabled once one is typed', () => {
    renderWithProviders(<CreateChannelModal />);

    expect(createBtn().disabled).toBe(true);
    fill('Traders');
    expect(createBtn().disabled).toBe(false);
  });

  it('is disabled while the two passwords differ, and enabled once they agree', () => {
    renderWithProviders(<CreateChannelModal />);

    fill('Traders', 'a', 'b');
    expect(createBtn().disabled).toBe(true);

    fill('Traders', 'a', 'a');
    expect(createBtn().disabled).toBe(false);
  });

  it('accepts passwords that differ only in case — the server compares uppercased too', () => {
    renderWithProviders(<CreateChannelModal />);

    fill('Traders', 'SECRET', 'secret');
    expect(createBtn().disabled).toBe(false);
  });

  it('refuses the reserved name "Lobby"', () => {
    renderWithProviders(<CreateChannelModal />);

    fill('Lobby');
    expect(createBtn().disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Lobby');
  });

  it('says nothing on a freshly opened, untouched form', () => {
    renderWithProviders(<CreateChannelModal />);
    expect(screen.getByRole('alert').textContent).toBe('');
  });
});

describe('CreateChannelModal — submitting', () => {
  beforeEach(openModal);

  it('calls onCreateChannel with the trimmed name and the password, then closes', async () => {
    const { onCreateChannel, callbacks } = spiedCreate();
    renderWithProviders(<CreateChannelModal />, { clientCallbacks: callbacks });

    fill('  Traders  ', 's3cret', 's3cret');
    fireEvent.click(createBtn());

    await waitFor(() => expect(onCreateChannel).toHaveBeenCalledWith('Traders', 's3cret'));
    await waitFor(() => expect(useUiStore.getState().modal).toBeNull());
  });

  it('stays mounted and shows the server reason when the call is refused', async () => {
    const { callbacks } = spiedCreate(new Error('Channel "Traders" already exists and its password does not match'));
    renderWithProviders(<CreateChannelModal />, { clientCallbacks: callbacks });

    fill('Traders', 'wrong', 'wrong');
    fireEvent.click(createBtn());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('password does not match'));
    expect(useUiStore.getState().modal).toBe('createChannel');
  });

  it('shows the gateway sentence carried on serverMessage, not the generic "Unknown error"', async () => {
    const sentence = 'Channel "Traders" already exists and its password does not match';
    // The shape `handleMessage` in client.ts builds for a RESP_ERROR.
    const rejection = Object.assign(new Error('Unknown error'), { code: 1, serverMessage: sentence });
    const { callbacks } = spiedCreate(rejection);
    renderWithProviders(<CreateChannelModal />, { clientCallbacks: callbacks });

    fill('Traders', 'wrong', 'wrong');
    fireEvent.click(createBtn());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(sentence));
    expect(screen.getByRole('alert').textContent).not.toContain('Unknown error');
    expect(useUiStore.getState().modal).toBe('createChannel');
  });

  it('sends nothing when an invalid form is submitted anyway', () => {
    const { onCreateChannel, callbacks } = spiedCreate();
    renderWithProviders(<CreateChannelModal />, { clientCallbacks: callbacks });

    // The disabled button is the visible gate; this drives `handleSubmit`
    // itself through the Enter path, which is deliberately not gated, so the
    // early return inside it is what refuses.
    fill('', 'a', 'b');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

    expect(onCreateChannel).not.toHaveBeenCalled();
    expect(useUiStore.getState().modal).toBe('createChannel');
    expect(screen.getByRole('alert').textContent).toContain('cannot be empty');
  });

  it('submits on Enter when the form is valid', async () => {
    const { onCreateChannel, callbacks } = spiedCreate();
    renderWithProviders(<CreateChannelModal />, { clientCallbacks: callbacks });

    fill('Traders', '', '');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

    await waitFor(() => expect(onCreateChannel).toHaveBeenCalledWith('Traders', ''));
  });

  it('does not submit on Enter while the form is invalid', () => {
    const { onCreateChannel, callbacks } = spiedCreate();
    renderWithProviders(<CreateChannelModal />, { clientCallbacks: callbacks });

    fill('Traders', 'a', 'b');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

    expect(onCreateChannel).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    renderWithProviders(<CreateChannelModal />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(useUiStore.getState().modal).toBeNull();
  });

  it('closes on Cancel and on the backdrop', () => {
    const { unmount } = renderWithProviders(<CreateChannelModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useUiStore.getState().modal).toBeNull();
    unmount();

    openModal();
    renderWithProviders(<CreateChannelModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useUiStore.getState().modal).toBeNull();
  });
});

// ===========================================================================
// L1 — the refusal travels mock → gateway → ws handler → browser → modal
// ===========================================================================

describe('CreateChannelModal — a taken name refused by the server (L1)', () => {
  beforeEach(openModal);

  it('shows the server-side sentence for res="#13"', async () => {
    const rdoMock = new RdoMock();
    rdoMock.addScenario(createCreateChannelScenario(undefined, { takenResult: 13 }).rdo);
    const fake = makeSessionCtx();
    fake.respond((packet) => {
      const frame = `${RdoProtocol.format(packet as never)};`;
      const hit = rdoMock.match(frame);
      return hit ? hit.response.replace(/^A\d+\s+/, '') : new Error(`L1: no exchange for ${frame}`);
    });

    const onCreateChannel = jest.fn(async (name: unknown, password: unknown) => {
      const sent: Array<Record<string, unknown>> = [];
      const ws = {
        send(payload: string): void {
          sent.push(JSON.parse(payload) as Record<string, unknown>);
        },
      } as unknown as WebSocket;
      const wsCtx = {
        ws,
        session: {
          createChatChannel: (n: string, p: string) => createChatChannel(fake.ctx, n, p),
        },
      } as unknown as WsHandlerContext;

      await handleChatCreateChannel(wsCtx, {
        type: WsMessageType.REQ_CHAT_CREATE_CHANNEL,
        wsRequestId: '1',
        channelName: name,
        password,
      } as unknown as WsMessage);

      const [frame] = sent;
      if (frame.type === WsMessageType.RESP_ERROR) {
        // Exactly what `handleMessage` in client.ts builds from a RESP_ERROR.
        const code = frame.code as number;
        const err = new Error(getErrorMessage(code)) as Error & { code: number; serverMessage: string };
        err.code = code;
        err.serverMessage = frame.errorMessage as string;
        throw err;
      }
    });
    const callbacks = createSpiedCallbacks({ onCreateChannel: onCreateChannel as (...a: unknown[]) => unknown });
    renderWithProviders(<CreateChannelModal />, { clientCallbacks: callbacks });

    fill(TAKEN_CHANNEL, CHANNEL_PASSWORD, CHANNEL_PASSWORD);
    fireEvent.click(createBtn());

    await waitFor(() => expect(screen.getByRole('alert').textContent)
      .toBe('Channel "Podan Merchants" already exists and its password does not match'));
    expect(onCreateChannel).toHaveBeenCalledWith(TAKEN_CHANNEL, CHANNEL_PASSWORD);
    expect(useUiStore.getState().modal).toBe('createChannel');
  });
});
