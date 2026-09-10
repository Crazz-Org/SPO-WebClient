/**
 * The town paper at the WebSocket frontier.
 *
 * The handlers own one decision each: which five fields of the request make the
 * `NewspaperTarget` the session facade takes, and — for one issue — that the
 * folder travels alongside it rather than inside it. Everything else is the
 * facade's, and is tested against the ASP pages in
 * `session/newspaper-handler.test.ts`.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { handleNewspaperIssues, handleNewspaperIssue } from '../newspaper-handlers';
import type { NewspaperTarget } from '../../session/newspaper-handler';
import type { WsHandlerContext } from '../types';

const TARGET: NewspaperTarget = {
  paperName: 'Helartia Herald',
  townName: 'Helartia',
  isCapitol: false,
  buildingX: 118,
  buildingY: 226,
};

const LIST = { paperName: 'Helartia Herald', issues: [{ folder: 'f1', date: '3/1/2027' }], error: '' };
const ISSUE = {
  paperName: 'Helartia Herald',
  folder: 'f1',
  townName: 'Helartia',
  title: 'Helartia Herald',
  date: 'Monday, March 01, 2027',
  stories: [{ headline: 'H', byline: '', body: 'B' }],
  error: '',
};

function createCtx() {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send(payload: string): void {
      sent.push(JSON.parse(payload) as Record<string, unknown>);
    },
  } as unknown as WebSocket;

  const getNewspaperIssues = jest.fn(async (_target: NewspaperTarget) => LIST);
  const getNewspaperIssue = jest.fn(async (_target: NewspaperTarget, _folder: string) => ISSUE);

  const ctx = {
    ws,
    session: { getNewspaperIssues, getNewspaperIssue },
  } as unknown as WsHandlerContext;

  return { ctx, sent, getNewspaperIssues, getNewspaperIssue };
}

describe('handleNewspaperIssues', () => {
  it('asks the session for that building`s paper and echoes the list back', async () => {
    const { ctx, sent, getNewspaperIssues } = createCtx();

    await handleNewspaperIssues(ctx, {
      type: WsMessageType.REQ_NEWSPAPER_ISSUES,
      wsRequestId: '42',
      ...TARGET,
    } as unknown as WsMessage);

    expect(getNewspaperIssues).toHaveBeenCalledWith(TARGET);
    expect(sent).toEqual([{
      type: WsMessageType.RESP_NEWSPAPER_ISSUES,
      wsRequestId: '42',
      list: LIST,
    }]);
  });
});

describe('handleNewspaperIssue', () => {
  // The folder is not part of the target: the target names the paper, the
  // folder names one of its issues.
  it('passes the folder beside the target and echoes the issue back', async () => {
    const { ctx, sent, getNewspaperIssue } = createCtx();

    await handleNewspaperIssue(ctx, {
      type: WsMessageType.REQ_NEWSPAPER_ISSUE,
      wsRequestId: '43',
      ...TARGET,
      folder: '002147483640@3-1-2027',
    } as unknown as WsMessage);

    expect(getNewspaperIssue).toHaveBeenCalledWith(TARGET, '002147483640@3-1-2027');
    expect(sent).toEqual([{
      type: WsMessageType.RESP_NEWSPAPER_ISSUE,
      wsRequestId: '43',
      issue: ISSUE,
    }]);
  });
});
