/**
 * REQ_SEARCH_MENU_PEOPLE_SEARCH at the WebSocket frontier.
 *
 * The handler forwards the search string straight to the session (which now
 * owns the RDO lookup, rather than the search menu service) and echoes the
 * results back as RESP_SEARCH_MENU_PEOPLE_SEARCH.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { handleSearchMenuPeopleSearch, handleSearchMenuNewspapers, handleSearchMenuDirectory } from '../search-handlers';
import * as ErrorCodes from '../../../shared/error-codes';
import type { WsHandlerContext } from '../types';

interface Recorded {
  ctx: WsHandlerContext;
  sent: Array<Record<string, unknown>>;
  searchPeople: jest.Mock;
}

function createCtx(results: string[] = []): Recorded {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send(payload: string): void {
      sent.push(JSON.parse(payload) as Record<string, unknown>);
    },
  } as unknown as WebSocket;

  const searchPeople = jest.fn(async () => results);

  const ctx = { ws, session: { searchPeople } } as unknown as WsHandlerContext;
  return { ctx, sent, searchPeople };
}

const request = (over: Partial<Record<string, unknown>> = {}): WsMessage => ({
  type: WsMessageType.REQ_SEARCH_MENU_PEOPLE_SEARCH,
  wsRequestId: '123',
  searchStr: 'mayor',
  ...over,
}) as unknown as WsMessage;

describe('handleSearchMenuPeopleSearch', () => {
  it('calls session.searchPeople and returns results', async () => {
    const { ctx, sent, searchPeople } = createCtx(['Tycoon1', 'Tycoon2']);

    await handleSearchMenuPeopleSearch(ctx, request());

    expect(searchPeople).toHaveBeenCalledWith('mayor');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: WsMessageType.RESP_SEARCH_MENU_PEOPLE_SEARCH,
      wsRequestId: '123',
      results: ['Tycoon1', 'Tycoon2'],
    });
  });
});

describe('handleSearchMenuNewspapers', () => {
  const newspaperRequest: WsMessage = {
    type: WsMessageType.REQ_SEARCH_MENU_NEWSPAPERS,
    wsRequestId: '456',
  } as unknown as WsMessage;

  it('answers RESP_SEARCH_MENU_NEWSPAPERS with the listings and the wsRequestId', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const ws = {
      send(payload: string): void {
        sent.push(JSON.parse(payload) as Record<string, unknown>);
      },
    } as unknown as WebSocket;
    const newspapers = [
      { paperName: 'Shamba Daily', townName: 'Shamba' },
      { paperName: 'Helartia Herald', townName: 'Helartia' },
    ];
    const getNewspapers = jest.fn(async () => newspapers);
    const ctx = { ws, searchMenuService: { getNewspapers } } as unknown as WsHandlerContext;

    await handleSearchMenuNewspapers(ctx, newspaperRequest);

    expect(getNewspapers).toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: WsMessageType.RESP_SEARCH_MENU_NEWSPAPERS,
      wsRequestId: '456',
      newspapers,
    });
  });

  it('sends an error frame when the search menu service is unavailable', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const ws = {
      send(payload: string): void {
        sent.push(JSON.parse(payload) as Record<string, unknown>);
      },
    } as unknown as WebSocket;
    const ctx = { ws, searchMenuService: null } as unknown as WsHandlerContext;

    await handleSearchMenuNewspapers(ctx, newspaperRequest);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: WsMessageType.RESP_ERROR,
      wsRequestId: '456',
      code: ErrorCodes.ERROR_AccessDenied,
    });
  });
});

describe('handleSearchMenuDirectory', () => {
  const ref = { kind: 'town-facilities', town: 'Helartia' };
  const directoryRequest: WsMessage = {
    type: WsMessageType.REQ_SEARCH_MENU_DIRECTORY,
    wsRequestId: '789',
    ref,
  } as unknown as WsMessage;

  function recorder(): { ws: WebSocket; sent: Array<Record<string, unknown>> } {
    const sent: Array<Record<string, unknown>> = [];
    const ws = {
      send(payload: string): void {
        sent.push(JSON.parse(payload) as Record<string, unknown>);
      },
    } as unknown as WebSocket;
    return { ws, sent };
  }

  it('forwards the ref and echoes it back beside the page', async () => {
    const { ws, sent } = recorder();
    const page = { kind: 'folder', items: ['Residentials'], ownedBy: null };
    const getDirectoryPage = jest.fn(async (_ref: unknown) => page);
    const ctx = { ws, searchMenuService: { getDirectoryPage } } as unknown as WsHandlerContext;

    await handleSearchMenuDirectory(ctx, directoryRequest);

    expect(getDirectoryPage).toHaveBeenCalledWith(ref);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: WsMessageType.RESP_SEARCH_MENU_DIRECTORY,
      wsRequestId: '789',
      ref,
      page,
    });
  });

  it('sends an error frame when the search menu service is unavailable', async () => {
    const { ws, sent } = recorder();
    const ctx = { ws, searchMenuService: null } as unknown as WsHandlerContext;

    await handleSearchMenuDirectory(ctx, directoryRequest);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: WsMessageType.RESP_ERROR,
      wsRequestId: '789',
      code: ErrorCodes.ERROR_AccessDenied,
    });
  });
});
