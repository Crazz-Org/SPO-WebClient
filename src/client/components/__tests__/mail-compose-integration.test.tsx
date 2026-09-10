/**
 * Integration test: Mail compose flow.
 *
 * Tests the full user journey:
 * 1. MailPanel renders with folder tabs and compose button
 * 2. Clicking compose switches to compose view with empty fields
 * 3. User types recipient, subject, body
 * 4. Send button calls client.onMailSend with correct values
 * 5. Store resets compose state after send
 * 6. Reply flow pre-fills recipient and subject
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import {
  renderWithProviders,
  resetStores,
  createSpiedCallbacks,
} from '../../__tests__/setup/render-helpers';
import { useMailStore } from '../../store/mail-store';
import { MailPanel, MAIL_BODY_MAX_CHARS } from '../mail/MailPanel';
import { ClientBridge } from '../../bridge/client-bridge';
import { WsMessageType } from '@/shared/types';
import type { MailMessageFull } from '@/shared/types';

jest.mock('../common/Toast', () => ({ showToast: jest.fn() }));

jest.mock('../common', () => ({
  ...(jest.requireActual('../common') as object),
  showToast: jest.fn(),
}));

describe('Mail compose — integration flow', () => {
  beforeEach(() => {
    resetStores();
    // Reset mail store to default (Inbox, list view, not loading)
    useMailStore.setState({
      currentFolder: 'Inbox',
      currentView: 'list',
      messages: [],
      currentMessage: null,
      isLoading: false,
      composeTo: '',
      composeSubject: '',
      composeBody: '',
      composeHeaders: '',
      composeDraftId: null,
      composeFocusTo: false,
      isSending: false,
      isSavingDraft: false,
      isMessageLoading: false,
      pendingDeleteId: null,
      folderRefreshToken: 0,
    });
  });

  it('renders folder tabs and compose button in list view', () => {
    renderWithProviders(<MailPanel />);

    expect(screen.getByText('Inbox')).toBeTruthy();
    expect(screen.getByText('Sent')).toBeTruthy();
    expect(screen.getByText('Drafts')).toBeTruthy();
    expect(screen.getByText('Compose')).toBeTruthy();
  });

  it('switches to compose view when compose button clicked', () => {
    renderWithProviders(<MailPanel />);

    fireEvent.click(screen.getByText('Compose'));

    // Store should be in compose view
    expect(useMailStore.getState().currentView).toBe('compose');

    // Compose fields should be visible
    expect(screen.getByPlaceholderText('To')).toBeTruthy();
    expect(screen.getByPlaceholderText('Subject')).toBeTruthy();
    expect(screen.getByPlaceholderText('Message...')).toBeTruthy();
  });

  it('fills compose fields and sends mail', () => {
    const sendSpy = jest.fn();
    const mockCallbacks = createSpiedCallbacks({ onMailSend: sendSpy });

    renderWithProviders(<MailPanel />, { clientCallbacks: mockCallbacks });

    // Open compose
    fireEvent.click(screen.getByText('Compose'));

    // Fill fields
    fireEvent.change(screen.getByPlaceholderText('To'), {
      target: { value: 'player42' },
    });
    fireEvent.change(screen.getByPlaceholderText('Subject'), {
      target: { value: 'Trade Offer' },
    });
    fireEvent.change(screen.getByPlaceholderText('Message...'), {
      target: { value: 'I have wheat for sale.' },
    });

    // Click send
    fireEvent.click(screen.getByText('Send'));

    // Verify client callback was invoked with the right args — a fresh letter
    // has nothing to thread, so it carries no header block.
    expect(sendSpy).toHaveBeenCalledWith('player42', 'Trade Offer', 'I have wheat for sale.', undefined, undefined);

    // Criterion changed (T6, audit P2): the draft is KEPT until the server answers —
    // a failed send must not lose the letter. The form is locked meanwhile.
    expect(useMailStore.getState().currentView).toBe('compose');
    expect(useMailStore.getState().isSending).toBe(true);
    expect((screen.getByText('Sending…').closest('button') as HTMLButtonElement).disabled).toBe(true);

    // RESP_MAIL_SENT success → the bridge clears the compose
    act(() => useMailStore.getState().clearCompose());
    expect(useMailStore.getState().currentView).toBe('list');
    expect(useMailStore.getState().composeTo).toBe('');
  });

  it('Send is disabled without a recipient', () => {
    const sendSpy = jest.fn();
    renderWithProviders(<MailPanel />, { clientCallbacks: createSpiedCallbacks({ onMailSend: sendSpy }) });
    fireEvent.click(screen.getByText('Compose'));
    fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'no recipient' } });
    const send = screen.getByText('Send').closest('button') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('cancel button returns to list view without sending', () => {
    const sendSpy = jest.fn();
    const mockCallbacks = createSpiedCallbacks({ onMailSend: sendSpy });

    renderWithProviders(<MailPanel />, { clientCallbacks: mockCallbacks });

    // Open compose, fill something
    fireEvent.click(screen.getByText('Compose'));
    fireEvent.change(screen.getByPlaceholderText('Subject'), {
      target: { value: 'Draft subject' },
    });

    // Cancel
    fireEvent.click(screen.getByText('Cancel'));

    // Should NOT have sent
    expect(sendSpy).not.toHaveBeenCalled();

    // Should return to list view
    expect(useMailStore.getState().currentView).toBe('list');
  });

  it('reply pre-fills recipient and subject', () => {
    const replyMessage: MailMessageFull = {
      messageId: 'msg-99',
      from: 'Alice',
      fromAddr: 'alice',
      to: 'Me',
      toAddr: 'me',
      subject: 'Hello there',
      date: '2025-01-15',
      dateFmt: 'Jan 15',
      body: ['Hi, how are you?'],
      read: true,
      stamp: 42,
      noReply: false,
      attachments: [],
    };

    // Simulate having read a message, then clicking reply
    useMailStore.getState().startReply(replyMessage);

    renderWithProviders(<MailPanel />);

    // Compose view should be active with pre-filled fields
    const toField = screen.getByPlaceholderText('To') as HTMLInputElement;
    const subjectField = screen.getByPlaceholderText('Subject') as HTMLInputElement;

    expect(toField.value).toBe('alice');
    expect(subjectField.value).toBe('Re: Hello there');
  });

  it('Reply clicked from the read view sends to the sender (the historical bug sent to nobody)', () => {
    const replyMessage: MailMessageFull = {
      messageId: 'msg-99', from: 'Alice', fromAddr: 'alice', to: 'Me', toAddr: 'me', subject: 'Hello there',
      date: '2025-01-15', dateFmt: 'Jan 15', body: ['Hi'], read: true, stamp: 42, noReply: false, attachments: [],
    };
    const sendSpy = jest.fn();
    renderWithProviders(<MailPanel />, { clientCallbacks: createSpiedCallbacks({ onMailSend: sendSpy }) });
    // the panel was mounted on the list; the message arrives, then Reply is clicked in the read view
    act(() => useMailStore.getState().setCurrentMessage(replyMessage));
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect((screen.getByPlaceholderText('To') as HTMLInputElement).value).toBe('alice');
    // #507 — the letter opens on the quoted original, before anything is typed over it.
    const body = screen.getByPlaceholderText('Message...') as HTMLTextAreaElement;
    expect(body.value.split('\n')[0]).toBe('_'.repeat(39));
    expect(body.value).toContain('Alice wrote, on "Hello there":');
    expect(body.value).toContain('> Hi');
    fireEvent.change(body, { target: { value: 'Fine, thanks.' } });
    fireEvent.click(screen.getByText('Send'));
    expect(sendSpy).toHaveBeenCalledWith(
      'alice', 'Re: Hello there', 'Fine, thanks.', expect.stringContaining('In-Reply-To=msg-99'), undefined,
    );
  });

  it('Delete asks first, then the confirmed delete is sent and the row leaves the list on the server answer', () => {
    const { useUiStore } = jest.requireActual('../../store/ui-store') as typeof import('../../store/ui-store');
    const deleteSpy = jest.fn();
    const msg: MailMessageFull = {
      messageId: 'msg-7', from: 'Bob', fromAddr: 'bob', to: 'Me', toAddr: 'me', subject: 'Old news',
      date: '2025-01-15', dateFmt: 'Jan 15', body: ['…'], read: true, stamp: 1, noReply: false, attachments: [],
    };
    useMailStore.setState({ messages: [{ messageId: 'msg-7', from: 'Bob', fromAddr: 'bob', to: 'Me', toAddr: 'me', subject: 'Old news', date: '', dateFmt: 'Jan 15', read: true, stamp: 1, noReply: false }] as never });
    renderWithProviders(<MailPanel />, { clientCallbacks: createSpiedCallbacks({ onMailDelete: deleteSpy }) });
    act(() => useMailStore.getState().setCurrentMessage(msg));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteSpy).not.toHaveBeenCalled();
    const s = useUiStore.getState();
    expect(s.modal).toBe('confirm');
    expect(s.confirmPayload?.options?.kind).toBe('destructive');
    act(() => { s.confirmPayload?.onConfirm(); s.closeModal(); });
    expect(deleteSpy).toHaveBeenCalledWith('msg-7');
    expect(useMailStore.getState().pendingDeleteId).toBe('msg-7');
    // the bridge, on RESP_MAIL_DELETED success, removes the pending id
    act(() => useMailStore.getState().removeMessage('msg-7'));
    expect(useMailStore.getState().messages).toHaveLength(0);
    expect(useMailStore.getState().currentView).toBe('list');
    expect(useMailStore.getState().pendingDeleteId).toBeNull();
  });

  // #509 — a message cannot be forwarded: no Forward action exists in the mail panel.
  describe('Forward', () => {
    const inboxMsg: MailMessageFull = {
      messageId: 'msg-509', from: 'Alice', fromAddr: 'alice', to: 'Me', toAddr: 'me',
      subject: 'Hello', date: '2025-01-15', dateFmt: 'Jan 15',
      body: ['hi'], read: true, stamp: 3, noReply: false, attachments: [],
    };

    it('offers both Reply and Forward on an ordinary Inbox message, and forwarding opens an empty To, prefixed subject, quoted body, with the caret in To', () => {
      renderWithProviders(<MailPanel />);
      act(() => useMailStore.getState().setCurrentMessage(inboxMsg));
      expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Forward' })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Forward' }));

      expect(useMailStore.getState().currentView).toBe('compose');
      const to = screen.getByPlaceholderText('To') as HTMLInputElement;
      const subject = screen.getByPlaceholderText('Subject') as HTMLInputElement;
      const body = screen.getByPlaceholderText('Message...') as HTMLTextAreaElement;
      expect(to.value).toBe('');
      expect(subject.value).toBe('Fw: Hello');
      expect(body.value.split('\n')[0]).toBe('_'.repeat(39));
      expect(body.value).toContain('Alice wrote, on "Hello":');
      expect(body.value).toContain('> hi');
      expect(document.activeElement).toBe(to);
    });

    it('is offered in the Sent folder', () => {
      useMailStore.setState({ currentFolder: 'Sent' });
      renderWithProviders(<MailPanel />);
      act(() => useMailStore.getState().setCurrentMessage(inboxMsg));
      expect(screen.getByRole('button', { name: 'Forward' })).toBeTruthy();
    });

    it('is offered, and Reply is not, on noReply mail', () => {
      renderWithProviders(<MailPanel />);
      act(() => useMailStore.getState().setCurrentMessage({ ...inboxMsg, noReply: true }));
      expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Forward' })).toBeTruthy();
    });
  });

  // #511 — one click on a Draft row lands in the composer, not the read view.
  describe('One click on a Draft row', () => {
    it('opens the composer with To, Subject and body filled, and composeDraftId set', () => {
      useMailStore.setState({ currentFolder: 'Draft' });
      renderWithProviders(<MailPanel />);

      const draft: MailMessageFull = {
        messageId: 'draft-4', from: 'Me', fromAddr: 'me', to: 'Bob', toAddr: 'bob',
        subject: 'Half written', date: '2025-01-15', dateFmt: 'Jan 15',
        body: ['first line', 'second line'], read: true, stamp: 3, noReply: false, attachments: [],
      };
      act(() => ClientBridge.handleMailResponse({ type: WsMessageType.RESP_MAIL_MESSAGE, message: draft } as never));

      expect(useMailStore.getState().currentView).toBe('compose');
      expect(useMailStore.getState().composeDraftId).toBe('draft-4');
      expect((screen.getByPlaceholderText('To') as HTMLInputElement).value).toBe('bob');
      expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('Half written');
      expect((screen.getByPlaceholderText('Message...') as HTMLTextAreaElement).value).toBe('first line\nsecond line');
    });

    // #510 — sending a letter opened from Drafts must carry the draft's id, so
    // the server removes that copy once the send succeeds.
    it('sending an opened draft carries its id as the fifth argument', () => {
      const sendSpy = jest.fn();
      renderWithProviders(<MailPanel />, { clientCallbacks: createSpiedCallbacks({ onMailSend: sendSpy }) });

      const draft: MailMessageFull = {
        messageId: 'draft-4', from: 'Me', fromAddr: 'me', to: 'Bob', toAddr: 'bob',
        subject: 'Half written', date: '2025-01-15', dateFmt: 'Jan 15',
        body: ['first line', 'second line'], read: true, stamp: 3, noReply: false, attachments: [],
      };
      act(() => useMailStore.getState().startEditDraft(draft));

      fireEvent.click(screen.getByText('Send'));

      expect(sendSpy).toHaveBeenCalledWith('bob', 'Half written', 'first line\nsecond line', undefined, 'draft-4');
    });

    it('an Inbox row still opens the read view', () => {
      useMailStore.setState({ currentFolder: 'Inbox' });
      renderWithProviders(<MailPanel />);

      const msg: MailMessageFull = {
        messageId: 'msg-1', from: 'Alice', fromAddr: 'alice', to: 'Me', toAddr: 'me',
        subject: 'Hello', date: '2025-01-15', dateFmt: 'Jan 15',
        body: ['hi'], read: true, stamp: 3, noReply: false, attachments: [],
      };
      act(() => ClientBridge.handleMailResponse({ type: WsMessageType.RESP_MAIL_MESSAGE, message: msg } as never));

      expect(useMailStore.getState().currentView).toBe('read');
      expect(useMailStore.getState().composeDraftId).toBeNull();
      expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
      expect(screen.queryByPlaceholderText('To')).toBeNull();
    });
  });

  // #120 — REQ_MAIL_SAVE_DRAFT had a gateway handler, a bridge response and a Drafts tab,
  // and no control anywhere that emitted it.
  describe('Save draft', () => {
    it('saves what is typed, with no recipient required and no draft id for a new letter', () => {
      const saveSpy = jest.fn();
      renderWithProviders(<MailPanel />, { clientCallbacks: createSpiedCallbacks({ onMailSaveDraft: saveSpy }) });

      fireEvent.click(screen.getByText('Compose'));
      fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'Half a thought' } });
      fireEvent.change(screen.getByPlaceholderText('Message...'), { target: { value: 'to be continued' } });

      // Send still refuses — a letter needs an address, a draft does not.
      expect((screen.getByText('Send').closest('button') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByText('Save draft'));

      expect(saveSpy).toHaveBeenCalledWith('', 'Half a thought', 'to be continued', undefined, undefined);
      // The form is locked and stays on screen until the server answers, as a send does.
      expect(useMailStore.getState().isSavingDraft).toBe(true);
      expect(useMailStore.getState().currentView).toBe('compose');
      expect((screen.getByText('Saving…').closest('button') as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).disabled).toBe(true);
    });

    it('an empty form has nothing to save', () => {
      const saveSpy = jest.fn();
      renderWithProviders(<MailPanel />, { clientCallbacks: createSpiedCallbacks({ onMailSaveDraft: saveSpy }) });
      fireEvent.click(screen.getByText('Compose'));
      const save = screen.getByText('Save draft').closest('button') as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      fireEvent.click(save);
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('editing a saved draft sends its id back, so the server replaces the copy', () => {
      const draft: MailMessageFull = {
        messageId: 'draft-4', from: 'Me', fromAddr: 'me', to: 'Bob', toAddr: 'bob',
        subject: 'Half written', date: '2025-01-15', dateFmt: 'Jan 15',
        body: ['first line', 'second line'], read: true, stamp: 3, noReply: false, attachments: [],
      };
      const saveSpy = jest.fn();
      useMailStore.setState({ currentFolder: 'Draft' });
      renderWithProviders(<MailPanel />, { clientCallbacks: createSpiedCallbacks({ onMailSaveDraft: saveSpy }) });

      // One click on the Draft row (#511) lands straight in the composer — a Draft never
      // reaches the read view, so neither Reply nor Forward is reachable for one (#509).
      act(() => ClientBridge.handleMailResponse({ type: WsMessageType.RESP_MAIL_MESSAGE, message: draft } as never));
      expect(screen.queryByRole('button', { name: 'Forward' })).toBeNull();

      expect((screen.getByPlaceholderText('To') as HTMLInputElement).value).toBe('bob');
      expect((screen.getByPlaceholderText('Message...') as HTMLTextAreaElement).value).toBe('first line\nsecond line');

      fireEvent.change(screen.getByPlaceholderText('Message...'), { target: { value: 'finished now' } });
      fireEvent.click(screen.getByText('Save draft'));

      expect(saveSpy).toHaveBeenCalledWith('bob', 'Half written', 'finished now', undefined, 'draft-4');
    });

    it('a message outside Drafts still offers Reply', () => {
      const msg: MailMessageFull = {
        messageId: 'msg-1', from: 'Alice', fromAddr: 'alice', to: 'Me', toAddr: 'me',
        subject: 'Hello', date: '2025-01-15', dateFmt: 'Jan 15',
        body: ['hi'], read: true, stamp: 3, noReply: false, attachments: [],
      };
      renderWithProviders(<MailPanel />);
      act(() => useMailStore.getState().setCurrentMessage(msg));
      expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Edit draft' })).toBeNull();
    });

    it('a noReply message offers no Reply control', () => {
      const msg: MailMessageFull = {
        messageId: 'msg-2', from: 'System', fromAddr: 'system', to: 'Me', toAddr: 'me',
        subject: 'Notice', date: '2025-01-15', dateFmt: 'Jan 15',
        body: ['this is a broadcast'], read: true, stamp: 3, noReply: true, attachments: [],
      };
      renderWithProviders(<MailPanel />);
      act(() => useMailStore.getState().setCurrentMessage(msg));
      expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Edit draft' })).toBeNull();
    });

    it('a message with noReply false still offers Reply alongside Delete', () => {
      const msg: MailMessageFull = {
        messageId: 'msg-3', from: 'Alice', fromAddr: 'alice', to: 'Me', toAddr: 'me',
        subject: 'Hello again', date: '2025-01-15', dateFmt: 'Jan 15',
        body: ['hi'], read: true, stamp: 3, noReply: false, attachments: [],
      };
      renderWithProviders(<MailPanel />);
      act(() => useMailStore.getState().setCurrentMessage(msg));
      expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });

    it('a send in flight locks the draft button too — one letter, one gesture', () => {
      const saveSpy = jest.fn();
      renderWithProviders(<MailPanel />, { clientCallbacks: createSpiedCallbacks({ onMailSaveDraft: saveSpy }) });
      fireEvent.click(screen.getByText('Compose'));
      fireEvent.change(screen.getByPlaceholderText('To'), { target: { value: 'player42' } });
      fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'ping' } });
      fireEvent.click(screen.getByText('Send'));

      const save = screen.getByText('Save draft').closest('button') as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      fireEvent.click(save);
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('the compose headers of a reply ride along with the draft', () => {
      const saveSpy = jest.fn();
      renderWithProviders(<MailPanel />, { clientCallbacks: createSpiedCallbacks({ onMailSaveDraft: saveSpy }) });
      act(() => useMailStore.getState().startCompose('bob', 'Re: Trade', 'yes', 'X-Thread: 42'));
      fireEvent.click(screen.getByText('Save draft'));
      expect(saveSpy).toHaveBeenCalledWith('bob', 'Re: Trade', 'yes', 'X-Thread: 42', undefined);
    });
  });

  it('switching folders triggers client.onMailGetFolder', () => {
    const getFolderSpy = jest.fn();
    const mockCallbacks = createSpiedCallbacks({ onMailGetFolder: getFolderSpy });

    renderWithProviders(<MailPanel />, { clientCallbacks: mockCallbacks });

    // Initial mount calls onMailGetFolder('Inbox')
    expect(getFolderSpy).toHaveBeenCalledWith('Inbox');

    // Click Sent tab
    fireEvent.click(screen.getByText('Sent'));

    expect(useMailStore.getState().currentFolder).toBe('Sent');
    expect(getFolderSpy).toHaveBeenCalledWith('Sent');
  });

  // #503 — the read view never showed who a message was addressed to.
  describe('Read view — To: line', () => {
    const baseMsg: MailMessageFull = {
      messageId: 'msg-503', from: 'Alice', fromAddr: 'alice', to: '', toAddr: '',
      subject: 'Recipients', date: '2025-01-15', dateFmt: 'Jan 15',
      body: ['hi'], read: true, stamp: 3, noReply: false, attachments: [],
    };

    it('falls back to toAddr when to is empty', () => {
      renderWithProviders(<MailPanel />);
      act(() => useMailStore.getState().setCurrentMessage({ ...baseMsg, to: '', toAddr: 'bob@shamba.net' }));
      expect(screen.getByText('To: bob@shamba.net')).toBeTruthy();
    });

    it('prefers to over toAddr when both are set', () => {
      renderWithProviders(<MailPanel />);
      act(() => useMailStore.getState().setCurrentMessage({ ...baseMsg, to: 'Bob', toAddr: 'bob@shamba.net' }));
      expect(screen.getByText('To: Bob')).toBeTruthy();
      expect(screen.queryByText('To: bob@shamba.net')).toBeNull();
    });

    it('shows several recipients as the server joined them', () => {
      renderWithProviders(<MailPanel />);
      act(() => useMailStore.getState().setCurrentMessage({ ...baseMsg, to: 'Bob; Carol', toAddr: '' }));
      expect(screen.getByText('To: Bob; Carol')).toBeTruthy();
    });

    it('appears in the Sent folder', () => {
      useMailStore.setState({ currentFolder: 'Sent' });
      renderWithProviders(<MailPanel />);
      act(() => useMailStore.getState().setCurrentMessage({ ...baseMsg, to: 'Bob', toAddr: 'bob' }));
      expect(screen.getByText('To: Bob')).toBeTruthy();
    });

    it('a draft opens the composer with the To field filled, not a read view', () => {
      useMailStore.setState({ currentFolder: 'Draft' });
      renderWithProviders(<MailPanel />);
      act(() => ClientBridge.handleMailResponse({
        type: WsMessageType.RESP_MAIL_MESSAGE,
        message: { ...baseMsg, to: 'Bob', toAddr: 'bob' },
      } as never));
      expect((screen.getByPlaceholderText('To') as HTMLInputElement).value).toBe('bob');
      expect(screen.queryByText('To: Bob')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Edit draft' })).toBeNull();
    });
  });

  // OB-11: a confirmed send used to leave the listing as it was before the send.
  it('a refresh asked for by the store re-reads the open folder', () => {
    const getFolderSpy = jest.fn();
    renderWithProviders(<MailPanel />, { clientCallbacks: createSpiedCallbacks({ onMailGetFolder: getFolderSpy }) });

    expect(getFolderSpy).toHaveBeenCalledTimes(1);

    // What the bridge does on RESP_MAIL_SENT success.
    act(() => { useMailStore.getState().clearCompose(); useMailStore.getState().refreshFolder(); });

    expect(getFolderSpy).toHaveBeenCalledTimes(2);
    expect(getFolderSpy).toHaveBeenLastCalledWith('Inbox');
  });

  // #505 — Send accepted a subject-less letter, the body had no cap, and a refused
  // send gave no clue why.
  describe('#505 — compose guards', () => {
    const { showToast } = jest.requireMock('../common') as { showToast: jest.Mock };

    beforeEach(() => {
      showToast.mockClear();
    });

    it('Send disabled with an empty subject', () => {
      const sendSpy = jest.fn();
      renderWithProviders(<MailPanel />, { clientCallbacks: createSpiedCallbacks({ onMailSend: sendSpy }) });
      fireEvent.click(screen.getByText('Compose'));
      fireEvent.change(screen.getByPlaceholderText('To'), { target: { value: 'player42' } });
      fireEvent.change(screen.getByPlaceholderText('Message...'), { target: { value: 'hello' } });

      const send = screen.getByText('Send').closest('button') as HTMLButtonElement;
      expect(send.disabled).toBe(true);
      expect(send.title).toBe('Add a subject');
      fireEvent.click(send);
      expect(sendSpy).not.toHaveBeenCalled();

      const save = screen.getByText('Save draft').closest('button') as HTMLButtonElement;
      expect(save.disabled).toBe(false);

      fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'Trade' } });
      expect(send.disabled).toBe(false);
    });

    it('Send disabled with a whitespace-only subject', () => {
      renderWithProviders(<MailPanel />);
      fireEvent.click(screen.getByText('Compose'));
      fireEvent.change(screen.getByPlaceholderText('To'), { target: { value: 'player42' } });
      fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: '   ' } });

      const send = screen.getByText('Send').closest('button') as HTMLButtonElement;
      expect(send.disabled).toBe(true);
    });

    it('a 20000-character paste leaves 10240 in the field', () => {
      renderWithProviders(<MailPanel />);
      fireEvent.click(screen.getByText('Compose'));
      const textarea = screen.getByPlaceholderText('Message...') as HTMLTextAreaElement;

      fireEvent.change(textarea, { target: { value: 'x'.repeat(20000) } });

      expect(useMailStore.getState().composeBody.length).toBe(MAIL_BODY_MAX_CHARS);
      expect(textarea.value.length).toBe(10240);
      expect(screen.getByText('0 characters left')).toBeTruthy();
    });

    it('warns once across two oversized pastes, and not at all for an in-budget paste', () => {
      renderWithProviders(<MailPanel />);
      fireEvent.click(screen.getByText('Compose'));
      const textarea = screen.getByPlaceholderText('Message...') as HTMLTextAreaElement;

      fireEvent.change(textarea, { target: { value: 'a short message' } });
      expect(showToast).not.toHaveBeenCalled();

      fireEvent.change(textarea, { target: { value: 'x'.repeat(20000) } });
      fireEvent.change(textarea, { target: { value: 'y'.repeat(15000) } });

      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('10240'), 'warning');
    });

    it('the counter tracks the remaining budget', () => {
      renderWithProviders(<MailPanel />);
      fireEvent.click(screen.getByText('Compose'));
      const textarea = screen.getByPlaceholderText('Message...') as HTMLTextAreaElement;

      fireEvent.change(textarea, { target: { value: 'abcde' } });

      expect(screen.getByText('10235 characters left')).toBeTruthy();
    });

    it('the To field hints that several recipients can be separated by ;', () => {
      renderWithProviders(<MailPanel />);
      fireEvent.click(screen.getByText('Compose'));

      expect(screen.getByText(/Separate the addresses with ;/)).toBeTruthy();
      const to = screen.getByPlaceholderText('To') as HTMLInputElement;
      expect(to.getAttribute('aria-describedby')).toBe('mail-to-hint');
    });
  });
});
