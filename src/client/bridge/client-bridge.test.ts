/**
 * Tests for ClientBridge — verifies store-pushing methods write to correct stores.
 */

import { ClientBridge } from './client-bridge';
import { useGameStore } from '../store/game-store';
import { useUiStore } from '../store/ui-store';
import { useBuildingStore } from '../store/building-store';
import { useLogStore } from '../store/log-store';
import { useChatStore } from '../store/chat-store';
import { useProfileStore } from '../store/profile-store';
import { useNewspaperStore } from '../store/newspaper-store';
import { useSearchStore } from '../store/search-store';
import { WsMessageType, type WsMessage } from '../../shared/types';

// Mock showToast to prevent import issues in test environment
jest.mock('../components/common/Toast', () => ({
  showToast: jest.fn(),
}));

describe('ClientBridge login flow (replaces window.__spoLoginHandlers)', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('showWorlds should push worlds to game-store', () => {
    const worlds = [
      { name: 'Shamba', status: 'online', players: 5 },
      { name: 'Movistar', status: 'online', players: 3 },
    ];
    ClientBridge.showWorlds(worlds as never[]);

    const state = useGameStore.getState();
    expect(state.loginWorlds).toEqual(worlds);
    expect(state.loginStage).toBe('worlds');
    expect(state.loginLoading).toBe(false);
  });

  it('showCompanies should push companies to game-store', () => {
    const companies = [
      { id: '1', name: 'TestCorp', cluster: 'General' },
    ];
    ClientBridge.showCompanies(companies as never[]);

    const state = useGameStore.getState();
    expect(state.companies).toEqual(companies);
    expect(state.loginStage).toBe('companies');
    expect(state.loginLoading).toBe(false);
  });

  it('setLoginLoading should update game-store loading', () => {
    ClientBridge.setLoginLoading(true);
    expect(useGameStore.getState().loginLoading).toBe(true);

    ClientBridge.setLoginLoading(false);
    expect(useGameStore.getState().loginLoading).toBe(false);
  });
});

describe('ClientBridge build menu (replaces window.__spoBuildMenuHandlers)', () => {
  beforeEach(() => {
    useUiStore.getState().clearBuildMenuData();
  });

  it('setBuildMenuCategories should push to ui-store', () => {
    const categories = [
      { kind: 1, kindName: 'Residential', cluster: 'General', tycoonLevel: 0 },
    ];
    ClientBridge.setBuildMenuCategories(categories as never[]);
    expect(useUiStore.getState().buildMenuCategories).toEqual(categories);
  });

  it('setBuildMenuFacilities should push to ui-store', () => {
    const facilities = [
      { facilityClass: 'house1', name: 'Small House', cost: 1000, area: 4, available: true },
    ];
    ClientBridge.setBuildMenuFacilities(facilities as never[]);
    expect(useUiStore.getState().buildMenuFacilities).toEqual(facilities);
  });
});

describe('ClientBridge existing methods', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('setConnecting should set status to connecting', () => {
    ClientBridge.setConnecting();
    expect(useGameStore.getState().status).toBe('connecting');
  });

  it('setConnected should set status to connected', () => {
    ClientBridge.setConnected();
    expect(useGameStore.getState().status).toBe('connected');
  });

  it('setDisconnected should set status to disconnected', () => {
    ClientBridge.setConnecting();
    ClientBridge.setDisconnected();
    expect(useGameStore.getState().status).toBe('disconnected');
  });

  it('setCredentials should set username', () => {
    ClientBridge.setCredentials('testUser');
    expect(useGameStore.getState().username).toBe('testUser');
  });

  it('setWorld should set worldName', () => {
    ClientBridge.setWorld('Shamba');
    expect(useGameStore.getState().worldName).toBe('Shamba');
  });

  it('setCompany should set companyName and companyId', () => {
    ClientBridge.setCompany('TestCorp', '42');
    const state = useGameStore.getState();
    expect(state.companyName).toBe('TestCorp');
    expect(state.companyId).toBe('42');
  });

  it('log should add entry to log-store', () => {
    const initialCount = useLogStore.getState().entries.length;
    ClientBridge.log('Test', 'hello world');
    expect(useLogStore.getState().entries.length).toBe(initialCount + 1);
  });

  it('reset should clear all stores', () => {
    ClientBridge.setCredentials('user');
    ClientBridge.setWorld('Shamba');
    ClientBridge.setConnected();

    ClientBridge.reset();

    const state = useGameStore.getState();
    expect(state.status).toBe('disconnected');
    expect(state.username).toBe('');
    expect(state.worldName).toBe('');
  });

  it('setRoadBuildingMode should toggle road building', () => {
    ClientBridge.setRoadBuildingMode(true);
    expect(useGameStore.getState().isRoadBuildingMode).toBe(true);

    ClientBridge.setRoadBuildingMode(false);
    expect(useGameStore.getState().isRoadBuildingMode).toBe(false);
  });

  it('setFocusedBuilding should update building-store', () => {
    const info = { x: 10, y: 20, buildingId: 'B1' };
    ClientBridge.setFocusedBuilding(info as never);
    expect(useBuildingStore.getState().focusedBuilding).toEqual(info);
  });
});

describe('ClientBridge chat (GetChannelInfo)', () => {
  it('setChannelInfo writes the description into chat-store, keyed by channel', () => {
    ClientBridge.setChannelInfo('Lobby', 'Lobby (Creator: Admin). 5 users.');
    expect(useChatStore.getState().channelInfo['Lobby']).toBe('Lobby (Creator: Admin). 5 users.');
  });
});

describe('ClientBridge building overlay (stale data prevention)', () => {
  beforeEach(() => {
    useBuildingStore.getState().clearFocus();
    useUiStore.getState().closeRightPanel();
  });

  it('showBuildingOverlay should clear old details when rightPanel is building', () => {
    // Setup: stale details in store + panel already open
    useBuildingStore.getState().setDetails({
      buildingId: 'OLD', buildingName: 'Old Building', ownerName: 'OldCorp',
      x: 50, y: 60, visualClass: '1000', templateName: 'Building',
      securityId: '', tabs: [], groups: {}, timestamp: Date.now(),
      canGovern: true,
    } as never);
    useUiStore.getState().openRightPanel('building');

    // Act: overlay a new building
    const newInfo = { x: 10, y: 20, buildingId: 'NEW', buildingName: 'New Building' };
    ClientBridge.showBuildingOverlay(newInfo as never);

    // Assert: old details cleared, new focus set
    const state = useBuildingStore.getState();
    expect(state.details).toBeNull();
    expect(state.isLoading).toBe(true);
    expect(state.focusedBuilding).toEqual(newInfo);
    expect(state.isOverlayMode).toBe(true);
  });

  it('showBuildingOverlay should NOT clear details when no panel is open', () => {
    // Setup: details set but no panel open
    useBuildingStore.getState().setDetails({
      buildingId: 'OLD', buildingName: 'Old Building', ownerName: 'OldCorp',
      x: 50, y: 60, visualClass: '1000', templateName: 'Building',
      securityId: '', tabs: [], groups: {}, timestamp: Date.now(),
      canGovern: true,
    } as never);

    // Act: overlay a new building (no panel open)
    const newInfo = { x: 10, y: 20, buildingId: 'NEW' };
    ClientBridge.showBuildingOverlay(newInfo as never);

    // Assert: details still present (overlay doesn't interfere with closed panels)
    const state = useBuildingStore.getState();
    expect(state.details).not.toBeNull();
    expect(state.focusedBuilding).toEqual(newInfo);
    expect(state.isOverlayMode).toBe(true);
  });
});

describe('ClientBridge mail responses (T6)', () => {
  const { useMailStore } = jest.requireActual('../store/mail-store') as typeof import('../store/mail-store');
  const { WsMessageType } = jest.requireActual('../../shared/types') as typeof import('../../shared/types');
  const { showToast } = jest.requireMock('../components/common/Toast') as { showToast: jest.Mock };

  beforeEach(() => {
    useMailStore.setState({ currentFolder: 'Inbox', currentView: 'compose', composeTo: 'bob', composeSubject: 's', composeBody: 'b', isSending: true, isSavingDraft: false, pendingDeleteId: null, messages: [] });
    showToast.mockClear();
  });

  it('RESP_MAIL_MESSAGE in the Draft folder opens the composer with the draft filled', () => {
    useMailStore.setState({ currentFolder: 'Draft', currentView: 'list', isMessageLoading: true });
    const message = {
      messageId: 'draft-4',
      fromAddr: 'me@starworld.net',
      toAddr: 'bob@starworld.net',
      from: 'Me',
      to: 'Bob',
      subject: 'Hi',
      date: '1',
      dateFmt: '1',
      read: true,
      stamp: 0,
      noReply: false,
      body: ['line one', 'line two'],
      attachments: [],
    };
    ClientBridge.handleMailResponse({ type: WsMessageType.RESP_MAIL_MESSAGE, message } as never);
    const s = useMailStore.getState();
    expect(s.currentView).toBe('compose');
    expect(s.composeDraftId).toBe('draft-4');
    expect(s.composeTo).toBe('bob@starworld.net');
    expect(s.composeSubject).toBe('Hi');
    expect(s.composeBody).toBe('line one\nline two');
    expect(s.isMessageLoading).toBe(false);
  });

  it('RESP_MAIL_MESSAGE in the Inbox folder opens the read view', () => {
    useMailStore.setState({ currentFolder: 'Inbox', currentView: 'list', isMessageLoading: true, composeDraftId: null });
    const message = {
      messageId: 'msg-1',
      fromAddr: 'alice@starworld.net',
      toAddr: 'me@starworld.net',
      from: 'Alice',
      to: 'Me',
      subject: 'Hello',
      date: '1',
      dateFmt: '1',
      read: true,
      stamp: 0,
      noReply: false,
      body: ['hi there'],
      attachments: [],
    };
    ClientBridge.handleMailResponse({ type: WsMessageType.RESP_MAIL_MESSAGE, message } as never);
    const s = useMailStore.getState();
    expect(s.currentView).toBe('read');
    expect(s.currentMessage).toEqual(message);
    expect(s.composeDraftId).toBeNull();
  });

  it('a failed send keeps the draft and says so', () => {
    ClientBridge.handleMailResponse({ type: WsMessageType.RESP_MAIL_SENT, success: false } as never);
    const s = useMailStore.getState();
    expect(s.currentView).toBe('compose');
    expect(s.composeTo).toBe('bob');
    expect(s.isSending).toBe(false);
    expect(showToast).toHaveBeenCalledWith(
      'Message not sent. Most likely one of the recipients does not exist — the server does not say which. Your draft is kept.',
      'error',
    );
  });

  it('a successful send clears the draft and asks for the folder to be read again', () => {
    const before = useMailStore.getState().folderRefreshToken;
    ClientBridge.handleMailResponse({ type: WsMessageType.RESP_MAIL_SENT, success: true } as never);
    expect(useMailStore.getState().currentView).toBe('list');
    expect(useMailStore.getState().composeTo).toBe('');
    // OB-11: the listing behind the compose form predates the send.
    expect(useMailStore.getState().folderRefreshToken).toBe(before + 1);
  });

  it('a failed send does not ask for a refresh', () => {
    const before = useMailStore.getState().folderRefreshToken;
    ClientBridge.handleMailResponse({ type: WsMessageType.RESP_MAIL_SENT, success: false } as never);
    expect(useMailStore.getState().folderRefreshToken).toBe(before);
  });

  // #120 / #108 — the Drafts listing must show the draft that was just saved, and the
  // panel re-reads a folder only when one of its effect deps moves.
  it('a saved draft clears the form, opens Drafts and asks for it to be read again', () => {
    useMailStore.setState({ currentFolder: 'Draft', isSavingDraft: true });
    const before = useMailStore.getState().folderRefreshToken;
    ClientBridge.handleMailResponse({ type: WsMessageType.RESP_MAIL_DRAFT_SAVED, success: true } as never);
    const s = useMailStore.getState();
    expect(s.currentView).toBe('list');
    expect(s.composeTo).toBe('');
    expect(s.currentFolder).toBe('Draft');
    expect(s.isSavingDraft).toBe(false);
    // Draft was ALREADY the open folder, so setFolder changed no dep: without this bump
    // the panel sat on the loading skeleton forever (#108).
    expect(s.folderRefreshToken).toBe(before + 1);
    expect(showToast).toHaveBeenCalledWith('Draft saved.', 'info', { title: 'Draft' });
  });

  it('a failed save keeps the text on screen and releases the button', () => {
    useMailStore.setState({ isSavingDraft: true });
    const before = useMailStore.getState().folderRefreshToken;
    ClientBridge.handleMailResponse({ type: WsMessageType.RESP_MAIL_DRAFT_SAVED, success: false } as never);
    const s = useMailStore.getState();
    expect(s.currentView).toBe('compose');
    expect(s.composeTo).toBe('bob');
    expect(s.isSavingDraft).toBe(false);
    expect(s.folderRefreshToken).toBe(before);
    expect(showToast).toHaveBeenCalledWith('Draft not saved. Your text is kept.', 'error');
  });

  it('a confirmed delete removes the pending row locally; a failed one keeps it', () => {
    useMailStore.setState({ messages: [{ messageId: 'a' }, { messageId: 'b' }] as never, pendingDeleteId: 'a', currentView: 'read' });
    ClientBridge.handleMailResponse({ type: WsMessageType.RESP_MAIL_DELETED, success: true } as never);
    expect(useMailStore.getState().messages.map((m) => m.messageId)).toEqual(['b']);
    expect(useMailStore.getState().pendingDeleteId).toBeNull();
    useMailStore.setState({ pendingDeleteId: 'b' });
    ClientBridge.handleMailResponse({ type: WsMessageType.RESP_MAIL_DELETED, success: false } as never);
    expect(useMailStore.getState().messages.map((m) => m.messageId)).toEqual(['b']);
    expect(useMailStore.getState().pendingDeleteId).toBeNull();
  });
});

/**
 * OB-1: the bridge is where the gateway's verdict crosses into the store, and
 * it must carry it rather than flatten it — a write nothing could vouch for
 * used to arrive here indistinguishable from one that was read back and matched.
 */
describe('ClientBridge optimistic write feedback (OB-1)', () => {
  const KEY = 'RDOConnectInput:Cotton';

  beforeEach(() => {
    useBuildingStore.setState({
      pendingUpdates: new Map(),
      confirmedUpdates: new Map(),
      failedUpdates: new Map(),
    });
  });

  it('setPendingUpdate parks the optimistic value under the key', () => {
    ClientBridge.setPendingUpdate(KEY, '0');
    expect(useBuildingStore.getState().pendingUpdates.get(KEY)?.value).toBe('0');
  });

  it('confirmPendingUpdate carries a confirmed verdict through to the store', () => {
    ClientBridge.setPendingUpdate(KEY, '0');
    ClientBridge.confirmPendingUpdate(KEY, 'confirmed');

    expect(useBuildingStore.getState().pendingUpdates.has(KEY)).toBe(false);
    expect(useBuildingStore.getState().confirmedUpdates.get(KEY)?.verdict).toBe('confirmed');
  });

  it('confirmPendingUpdate carries an unconfirmed verdict just as faithfully', () => {
    ClientBridge.setPendingUpdate(KEY, '0');
    ClientBridge.confirmPendingUpdate(KEY, 'unconfirmed');

    expect(useBuildingStore.getState().confirmedUpdates.get(KEY)?.verdict).toBe('unconfirmed');
  });

  it('failPendingUpdate records the reason the server gave', () => {
    ClientBridge.setPendingUpdate(KEY, '0');
    ClientBridge.failPendingUpdate(KEY, '0', 'Server rejected the change');

    expect(useBuildingStore.getState().failedUpdates.get(KEY)?.error)
      .toBe('Server rejected the change');
  });
});

describe('ClientBridge handleProfileResponse — RESP_PROFILE_COMPANY_PROFITLOSS', () => {
  beforeEach(() => {
    useProfileStore.getState().reset();
  });

  it('routes the response into the store, keyed by company name', () => {
    useProfileStore.getState().openCompanyProfitLoss('Green Co', 'A');
    const tree = { root: { label: 'Net', level: 0, amount: '1', children: [] } };

    ClientBridge.handleProfileResponse({
      type: WsMessageType.RESP_PROFILE_COMPANY_PROFITLOSS,
      wsRequestId: 'req-1',
      companyName: 'Green Co',
      data: tree,
    } as unknown as WsMessage);

    expect(useProfileStore.getState().companyProfitLoss).toEqual({
      companyName: 'Green Co', cluster: 'A', status: 'loaded', data: tree, error: null,
    });
  });

  it('a null data + error moves the view to error', () => {
    useProfileStore.getState().openCompanyProfitLoss('Green Co', 'A');

    ClientBridge.handleProfileResponse({
      type: WsMessageType.RESP_PROFILE_COMPANY_PROFITLOSS,
      wsRequestId: 'req-1',
      companyName: 'Green Co',
      data: null,
      error: 'boom',
    } as unknown as WsMessage);

    expect(useProfileStore.getState().companyProfitLoss).toEqual({
      companyName: 'Green Co', cluster: 'A', status: 'error', data: null, error: 'boom',
    });
  });
});

describe('ClientBridge handleNewspaperResponse — the paper view (#516)', () => {
  const LIST = {
    paperName: 'Helartia Herald',
    issues: [{ folder: '002147483640@3-1-2027', date: '3/1/2027' }],
    error: '',
  };

  const ISSUE = {
    paperName: 'Helartia Herald',
    folder: '002147483640@3-1-2027',
    townName: 'Helartia',
    title: 'Helartia Herald',
    date: 'Monday, March 01, 2027',
    stories: [{ headline: 'Domestic Wars!', byline: '', body: 'One person died.' }],
    error: '',
  };

  beforeEach(() => {
    useNewspaperStore.getState().reset();
  });

  it('puts the issue list in the store', () => {
    ClientBridge.handleNewspaperResponse({
      type: WsMessageType.RESP_NEWSPAPER_ISSUES,
      list: LIST,
    } as unknown as WsMessage);

    expect(useNewspaperStore.getState().issues).toEqual(LIST.issues);
    expect(useNewspaperStore.getState().issuesState).toBe('loaded');
  });

  it('puts the issue in the store, under the folder that was asked for', () => {
    useNewspaperStore.getState().selectIssue(ISSUE.folder);

    ClientBridge.handleNewspaperResponse({
      type: WsMessageType.RESP_NEWSPAPER_ISSUE,
      issue: ISSUE,
    } as unknown as WsMessage);

    expect(useNewspaperStore.getState().issue).toEqual(ISSUE);
    expect(useNewspaperStore.getState().issueState).toBe('loaded');
  });
});

describe('ClientBridge handleSearchMenuResponse — RESP_SEARCH_MENU_NEWSPAPERS (#517)', () => {
  beforeEach(() => {
    useSearchStore.getState().reset();
  });

  it('puts the newspaper listings in the search store', () => {
    const newspapers = [
      { paperName: 'Shamba Daily', townName: 'Shamba' },
      { paperName: 'Helartia Herald', townName: 'Helartia' },
    ];

    ClientBridge.handleSearchMenuResponse({
      type: WsMessageType.RESP_SEARCH_MENU_NEWSPAPERS,
      newspapers,
    } as unknown as WsMessage);

    expect(useSearchStore.getState().newspapersData?.newspapers).toEqual(newspapers);
  });
});
