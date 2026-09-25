/**
 * Scenario 4: Select Company
 * HTTP: toolbar.asp (GET, 200 OK, HTML toolbar), map index.midx (404)
 * RDO: EnableEvents, PickEvent, GetTycoonCookie, ServerBusy
 * WS: REQ_SELECT_COMPANY -> RESP triggers RDO commands
 * Push events: InitClient (immediate, modeled as EVENT_TYCOON_UPDATE),
 *   ChatMsg "SPO_test3 has entered Shamba"
 *
 * Per original server (InterfaceServer.pas): RegisterEventsById calls
 * SendClientData() which fires InitClient(Date, Money, FailureLevel, TycoonId)
 * BEFORE returning the response. Modeled as afterMs: 0 scheduled event.
 */

import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage } from '@/shared/types/message-types';
import type { WsCaptureScenario } from '../types/mock-types';
import type { RdoScenario } from '../types/rdo-exchange-types';
import type { HttpScenario } from '../types/http-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** Captured tycoon cookie data from GetTycoonCookie response */
export interface CapturedTycoonCookie {
  lastX: string;
  lastY: string;
  lastTimeOnline: string;
}

const CAPTURED_COOKIE: CapturedTycoonCookie = {
  lastX: '467',
  lastY: '395',
  lastTimeOnline: '2026-02-18',
};

function buildToolbarHtml(vars: ScenarioVariables): string {
  const baseParams = [
    `WorldName=${vars.worldName}`,
    `MailAccount=${vars.mailAccount}`,
    `Company=${encodeURIComponent(vars.companyName)}`,
    `Tycoon=${vars.username}`,
    `Password=${vars.password}`,
    `DAAddr=${vars.daAddr}`,
    `DAPort=${vars.daPort}`,
    `ISAddr=${vars.worldIp}`,
    `ISPort=${vars.worldPort}`,
    `SecurityId=${vars.securityId}`,
    `Visitor=FALSE`,
    `ClientViewId=${vars.clientViewId}`,
  ].join('&');

  return `<html>
<head><title>Toolbar</title></head>
<body>
<div id="toolbar">
  <span id="companyName">${vars.companyName}</span>
  <a id="btnBuild" href="/Five/0/visual/voyager/build/build.asp?${baseParams}">Build</a>
  <a id="btnMail" href="/Five/0/visual/voyager/mail/mail.asp?${baseParams}">Mail</a>
  <a id="btnSearch" href="/Five/0/visual/voyager/search/search.asp?${baseParams}">Search</a>
  <a id="btnMap" href="/Five/0/visual/voyager/map/map.asp?${baseParams}">Map</a>
  <a id="btnProfile" href="/Five/0/visual/voyager/profile/profile.asp?${baseParams}">Profile</a>
  <a id="btnChat" href="/Five/0/visual/voyager/chat/chat.asp?${baseParams}">Chat</a>
  <a id="btnOptions" href="/Five/0/visual/voyager/options/options.asp?${baseParams}">Options</a>
</div>
</body>
</html>`;
}

export function createSelectCompanyScenario(
  overrides?: Partial<ScenarioVariables>
): { ws: WsCaptureScenario; rdo: RdoScenario; http: HttpScenario } {
  const vars = mergeVariables(overrides);

  const cookieFullResponse = [
    `LastX.0=${CAPTURED_COOKIE.lastX}`,
    `LastY.0=${CAPTURED_COOKIE.lastY}`,
    `LastTimeOnline=${CAPTURED_COOKIE.lastTimeOnline}`,
  ].join('\n');

  const rdo: RdoScenario = {
    name: 'select-company',
    description: 'Select company: EnableEvents, PickEvent, GetTycoonCookie, ServerBusy',
    exchanges: [
      {
        id: 'sc-rdo-001',
        request: `C 34 sel ${vars.clientViewId} set EnableEvents="#-1"`,
        response: `A34 ;`,
        matchKeys: { verb: 'sel', action: 'set', member: 'EnableEvents' },
      },
      {
        id: 'sc-rdo-002',
        request: `C 35 sel ${vars.clientViewId} call PickEvent "^" "#22"`,
        response: `A35 res="%"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'PickEvent' },
      },
      {
        // GetTycoonCookie(TycoonId, CookieId): the id first, the cookie name second, as
        // login-handler.ts:729-751 emits it — so each argsPattern pins position 1, not 0.
        id: 'sc-rdo-003',
        request: `C 36 sel ${vars.clientViewId} call GetTycoonCookie "^" "#22","%LastY.0"`,
        response: `A36 res="%${CAPTURED_COOKIE.lastY}"`,
        matchKeys: {
          verb: 'sel',
          action: 'call',
          member: 'GetTycoonCookie',
          argsPattern: ['*', '"%LastY.0"'],
        },
      },
      {
        id: 'sc-rdo-004',
        request: `C 37 sel ${vars.clientViewId} call GetTycoonCookie "^" "#22","%LastX.0"`,
        response: `A37 res="%${CAPTURED_COOKIE.lastX}"`,
        matchKeys: {
          verb: 'sel',
          action: 'call',
          member: 'GetTycoonCookie',
          argsPattern: ['*', '"%LastX.0"'],
        },
      },
      {
        id: 'sc-rdo-005',
        request: `C 38 sel ${vars.clientViewId} call GetTycoonCookie "^" "#22","%"`,
        response: `A38 res="%${cookieFullResponse}\n"`,
        matchKeys: {
          verb: 'sel',
          action: 'call',
          member: 'GetTycoonCookie',
          argsPattern: ['*', '"%"'],
        },
      },
    ],
    variables: vars as unknown as Record<string, string>,
  };

  const http: HttpScenario = {
    name: 'select-company',
    exchanges: [
      {
        id: 'sc-http-001',
        method: 'GET',
        urlPattern: '/Five/0/visual/voyager/toolbar/toolbar.asp',
        queryPatterns: {
          WorldName: vars.worldName,
          Tycoon: vars.username,
        },
        status: 200,
        contentType: 'text/html',
        body: buildToolbarHtml(vars),
      },
      {
        id: 'sc-http-002',
        method: 'GET',
        urlPattern: `/Five/0/visual/voyager/map/index.midx`,
        status: 404,
        contentType: 'text/html',
        body: 'Not Found',
      },
    ],
    variables: {},
  };

  const ws: WsCaptureScenario = {
    name: 'select-company',
    description: 'Select company and enter game world',
    capturedAt: '2026-02-18',
    serverInfo: { world: vars.worldName, zone: 'BETA', date: '2026-02-18' },
    exchanges: [
      {
        id: 'sc-ws-001',
        timestamp: '2026-02-18T21:21:40.000Z',
        request: {
          type: WsMessageType.REQ_SELECT_COMPANY,
          wsRequestId: 'sc-001',
          companyId: vars.companyId,
        } as WsMessage,
        responses: [
          {
            type: WsMessageType.RESP_RDO_RESULT,
            wsRequestId: 'sc-001',
            result: 'OK',
          } as WsMessage,
        ],
        tags: ['company-select'],
      },
    ],
    scheduledEvents: [
      {
        // InitClient push: fires synchronously during RegisterEventsById in original server.
        // Contains initial Date, Money, FailureLevel, TycoonId.
        // Gateway translates to EVENT_TYCOON_UPDATE (no dedicated InitClient WS type).
        afterMs: 0,
        event: {
          type: WsMessageType.EVENT_TYCOON_UPDATE,
          cash: '4666201923',
          incomePerHour: '10359',
          ranking: 2,
          buildingCount: 33,
          maxBuildings: 70,
        } as WsMessage,
      },
      {
        afterMs: 500,
        event: {
          type: WsMessageType.EVENT_CHAT_MSG,
          channel: 'SYSTEM',
          from: 'SYSTEM',
          message: `${vars.username} has entered ${vars.worldName}`,
        } as WsMessage,
      },
    ],
  };

  return { ws, rdo, http };
}

export { CAPTURED_COOKIE };
