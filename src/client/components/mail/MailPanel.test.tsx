/**
 * MailPanel — list-row delete (#512).
 *
 * A row's own delete control must run the same confirm-then-delete flow as the
 * read view, and must never call onMailReadMessage.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import {
  renderWithProviders,
  resetStores,
  createSpiedCallbacks,
} from '../../__tests__/setup/render-helpers';
import { useMailStore } from '../../store/mail-store';
import { useUiStore } from '../../store/ui-store';
import { MailPanel, EMPTY_FOLDER_TEXT } from './MailPanel';
import type { MailMessageFull } from '@/shared/types';

const LIST_MESSAGES = [
  { messageId: 'msg-1', from: 'Alice', fromAddr: 'alice', to: 'Me', toAddr: 'me', subject: 'First', date: '', dateFmt: 'Jan 1', read: true, stamp: 1, noReply: false },
  { messageId: 'msg-2', from: 'Bob', fromAddr: 'bob', to: 'Me', toAddr: 'me', subject: 'Second', date: '', dateFmt: 'Jan 2', read: true, stamp: 2, noReply: false },
] as never;

describe('MailPanel — list-row delete', () => {
  beforeEach(() => {
    resetStores();
    useMailStore.setState({
      currentFolder: 'Inbox',
      currentView: 'list',
      messages: [],
      currentMessage: null,
      isLoading: false,
      isMessageLoading: false,
      pendingDeleteId: null,
      folderRefreshToken: 0,
    });
  });

  it('row delete asks first, then calls onMailDelete with that row id and never onMailRead', () => {
    const deleteSpy = jest.fn();
    const readSpy = jest.fn();
    renderWithProviders(<MailPanel />, {
      clientCallbacks: createSpiedCallbacks({ onMailDelete: deleteSpy, onMailReadMessage: readSpy }),
    });
    act(() => useMailStore.getState().setMessages(LIST_MESSAGES));

    fireEvent.click(screen.getByRole('button', { name: /Delete “Second”/ }));

    expect(readSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(useUiStore.getState().modal).toBe('confirm');
    expect(useUiStore.getState().confirmPayload?.options?.kind).toBe('destructive');

    act(() => useUiStore.getState().confirmPayload?.onConfirm());

    expect(deleteSpy).toHaveBeenCalledWith('msg-2');
    expect(useMailStore.getState().pendingDeleteId).toBe('msg-2');
    expect(readSpy).not.toHaveBeenCalled();

    act(() => useMailStore.getState().removeMessage('msg-2'));

    expect(useMailStore.getState().messages).toHaveLength(1);
    expect(useMailStore.getState().currentView).toBe('list');
  });

  it('clicking the row body still opens the message and does not delete', () => {
    const deleteSpy = jest.fn();
    const readSpy = jest.fn();
    renderWithProviders(<MailPanel />, {
      clientCallbacks: createSpiedCallbacks({ onMailDelete: deleteSpy, onMailReadMessage: readSpy }),
    });
    act(() => useMailStore.getState().setMessages(LIST_MESSAGES));

    fireEvent.click(screen.getByText('First'));

    expect(readSpy).toHaveBeenCalledWith('msg-1');
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(useUiStore.getState().modal).not.toBe('confirm');
  });

  it('read-view Delete still works (regression guard)', () => {
    const deleteSpy = jest.fn();
    const full: MailMessageFull = {
      messageId: 'msg-1', from: 'Alice', fromAddr: 'alice', to: 'Me', toAddr: 'me', subject: 'First',
      date: '', dateFmt: 'Jan 1', body: ['hi'], read: true, stamp: 1, noReply: false, attachments: [],
    };
    renderWithProviders(<MailPanel />, { clientCallbacks: createSpiedCallbacks({ onMailDelete: deleteSpy }) });
    act(() => useMailStore.getState().setCurrentMessage(full));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useUiStore.getState().modal).toBe('confirm');
    act(() => useUiStore.getState().confirmPayload?.onConfirm());

    expect(deleteSpy).toHaveBeenCalledWith('msg-1');
  });
});

describe('MailPanel — folder empty state', () => {
  beforeEach(() => {
    resetStores();
    useMailStore.setState({
      currentFolder: 'Inbox',
      currentView: 'list',
      messages: [],
      currentMessage: null,
      isLoading: false,
      isMessageLoading: false,
      pendingDeleteId: null,
      folderRefreshToken: 0,
    });
  });

  it('Draft empty text differs from Inbox empty text', () => {
    const { unmount } = renderWithProviders(<MailPanel />);
    act(() => useMailStore.setState({ isLoading: false }));
    expect(screen.getByText(EMPTY_FOLDER_TEXT.Inbox.title)).toBeTruthy();
    expect(screen.queryByText(EMPTY_FOLDER_TEXT.Draft.title)).toBeNull();
    unmount();

    useMailStore.setState({ currentFolder: 'Draft', isLoading: false });
    renderWithProviders(<MailPanel />);
    act(() => useMailStore.setState({ isLoading: false }));
    expect(screen.getByText(EMPTY_FOLDER_TEXT.Draft.title)).toBeTruthy();
    expect(screen.queryByText(EMPTY_FOLDER_TEXT.Inbox.title)).toBeNull();
  });

  it('Sent has its own empty text, distinct from Inbox and Draft', () => {
    useMailStore.setState({ currentFolder: 'Sent', isLoading: false });
    renderWithProviders(<MailPanel />);
    act(() => useMailStore.setState({ isLoading: false }));

    expect(screen.getByText(EMPTY_FOLDER_TEXT.Sent.title)).toBeTruthy();
    expect(screen.queryByText(EMPTY_FOLDER_TEXT.Inbox.title)).toBeNull();
    expect(screen.queryByText(EMPTY_FOLDER_TEXT.Draft.title)).toBeNull();
  });

  it('shows none of the empty-folder texts while loading', () => {
    useMailStore.setState({ currentFolder: 'Inbox', isLoading: true });
    renderWithProviders(<MailPanel />);

    expect(screen.queryByText(EMPTY_FOLDER_TEXT.Inbox.title)).toBeNull();
    expect(screen.queryByText(EMPTY_FOLDER_TEXT.Sent.title)).toBeNull();
    expect(screen.queryByText(EMPTY_FOLDER_TEXT.Draft.title)).toBeNull();
  });
});

describe('MailPanel — message stamp', () => {
  const withStamp: MailMessageFull = {
    messageId: 'msg-1', from: 'Alice', fromAddr: 'alice', to: 'Me', toAddr: 'me', subject: 'First',
    date: '', dateFmt: 'Jan 1', body: ['hi'], read: true, stamp: 17, noReply: false, attachments: [],
    stampUrl: '/proxy-image?url=http%3A%2F%2Fworld%2Fstamp2.jpg',
  };
  const secondWithStamp: MailMessageFull = {
    ...withStamp, messageId: 'msg-2', subject: 'Second',
    stampUrl: '/proxy-image?url=http%3A%2F%2Fworld%2Fstamp5.jpg',
  };

  beforeEach(() => {
    resetStores();
    useMailStore.setState({
      currentFolder: 'Inbox',
      currentView: 'list',
      messages: [],
      currentMessage: null,
      isLoading: false,
      isMessageLoading: false,
      pendingDeleteId: null,
      folderRefreshToken: 0,
    });
  });

  it('shows the stamp image alongside the header fields when stampUrl is present', () => {
    const { container } = renderWithProviders(<MailPanel />);
    act(() => useMailStore.getState().setCurrentMessage(withStamp));

    const img = container.querySelector('img[src*="stamp2.jpg"]');
    expect(img).toBeTruthy();
    expect(screen.getByText('From: Alice')).toBeTruthy();
    expect(screen.getByText('To: Me')).toBeTruthy();
  });

  it('renders no stamp image when stampUrl is absent', () => {
    const noStamp: MailMessageFull = { ...withStamp, stampUrl: undefined };
    const { container } = renderWithProviders(<MailPanel />);
    act(() => useMailStore.getState().setCurrentMessage(noStamp));

    expect(container.querySelector('img')).toBeNull();
  });

  it('removes the stamp on image error', () => {
    const { container } = renderWithProviders(<MailPanel />);
    act(() => useMailStore.getState().setCurrentMessage(withStamp));

    const img = container.querySelector('img[src*="stamp2.jpg"]') as HTMLImageElement;
    fireEvent.error(img);

    expect(container.querySelector('img')).toBeNull();
  });

  it('removes the stamp when the proxy answers its 1x1 placeholder, keeps a real picture', () => {
    const { container } = renderWithProviders(<MailPanel />);
    act(() => useMailStore.getState().setCurrentMessage(withStamp));

    const img = container.querySelector('img[src*="stamp2.jpg"]') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 1, configurable: true });
    fireEvent.load(img);
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps a real picture on load', () => {
    const { container } = renderWithProviders(<MailPanel />);
    act(() => useMailStore.getState().setCurrentMessage(withStamp));

    const img = container.querySelector('img[src*="stamp2.jpg"]') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 70, configurable: true });
    fireEvent.load(img);
    expect(container.querySelector('img[src*="stamp2.jpg"]')).toBeTruthy();
  });

  it('resets the hidden flag per message: an error on one message does not hide the next', () => {
    const { container } = renderWithProviders(<MailPanel />);
    act(() => useMailStore.getState().setCurrentMessage(withStamp));

    const firstImg = container.querySelector('img[src*="stamp2.jpg"]') as HTMLImageElement;
    fireEvent.error(firstImg);
    expect(container.querySelector('img')).toBeNull();

    act(() => useMailStore.getState().setCurrentMessage(secondWithStamp));
    expect(container.querySelector('img[src*="stamp5.jpg"]')).toBeTruthy();
  });
});
