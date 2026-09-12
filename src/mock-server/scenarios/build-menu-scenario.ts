/**
 * Scenario 12: Build Menu + NewFacility
 * HTTP: Build.asp (frameset), FacilityList.asp (facility items with Build now buttons)
 * RDO: NewFacility call (success res=#0, duplicate error res=#33, zone mismatch res=#28)
 * WS: REQ_PLACE_BUILDING -> RESP_BUILDING_PLACED
 *
 * Captured RDO:
 *   C 147 sel 8184316 call NewFacility "^" "%PGISupermarketC","#28","#618","#117"; A147 res="#0";
 *   C 98 sel 8161308 call NewFacility "^" "%PGIGeneralHeadquarterSTA","#28","#465","#388"; A98 res="#33";
 *
 * `createBuildMenuScenario(undefined, { refusal: 'zone-mismatch' })` swaps the first
 * exchange for a commerce-zoned class placed on an industrial zone (res=#28) instead
 * of the success case, for the L1 drive that proves the notification names the zone.
 */

import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage } from '@/shared/types/message-types';
import type { WsCaptureScenario } from '../types/mock-types';
import type { RdoScenario } from '../types/rdo-exchange-types';
import type { HttpScenario } from '../types/http-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** Captured data for a successful NewFacility build */
export interface CapturedBuildData {
  facilityClass: string;
  companyId: string;
  x: number;
  y: number;
  result: number;
}

export const CAPTURED_BUILD_SUCCESS: CapturedBuildData = {
  facilityClass: 'PGISupermarketC',
  companyId: '28',
  x: 618,
  y: 117,
  result: 0,
};

export const CAPTURED_BUILD_DUPLICATE: CapturedBuildData = {
  facilityClass: 'PGIGeneralHeadquarterSTA',
  companyId: '28',
  x: 465,
  y: 388,
  result: 33,
};

/** A commerce-zoned class placed on an industrial zone — ERROR_ZoneMissmatch (28). */
export const CAPTURED_BUILD_ZONE_MISMATCH: CapturedBuildData = {
  facilityClass: 'PGISupermarketC',
  companyId: '28',
  x: 200,
  y: 300,
  result: 28,
};

function buildBuildAspHtml(vars: ScenarioVariables): string {
  return `<html>
<head><title>Build</title></head>
<frameset framespacing="0" rows="95,*">
  <frame name="Top" src="BuildTop.asp?Company=${encodeURIComponent(vars.companyName)}&WorldName=${vars.worldName}&Cluster=&Tycoon=${vars.username}" scrolling="no" noresize frameborder="No">
  <frame name="Main" src="KindList.asp?Company=${encodeURIComponent(vars.companyName)}&WorldName=${vars.worldName}&Cluster=&Tycoon=${vars.username}" noresize frameborder="No">
</frameset>
</html>`;
}

function buildFacilityListHtml(): string {
  // Matches real server FacilityList.asp HTML structure (based on live captures).
  // Key structural elements: LinkFrame_N/LinkText_N rows + nested Cell_N detail rows
  // with the info attribute (FacilityClass + VisualClassId) deep in a "Build now" button.
  return `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">
<html>
<head><title>Facility List</title>
<link rel="STYLESHEET" href="../voyager.css" type="text/css">
</head>
<body>
<table cellspacing="7" width="100%">
<tr><td><div class=header2 style="color: #FF9900">Headquarters</div></td></tr>
<tr><td>
<table cellspacing="0" cellpadding="0" border="0" width="100%">

    <tr>
      <td width="100%" id="LinkFrame_0" background="images/itemgradient.jpg" altid="0">
        <div id="LinkText_0" class=listItem available="1" style="margin-left: 5px" altid="0">
        General Headquarter
        </div>
      </td>
    </tr>
    <tr id="Cell_0" style="display:none">
      <td width="100%"><table cellpadding="3" cellspacing="0" width="100%">
      <tr>
      <td align="center" valign="middle" width="64">
        <img src=/five/icons/MapPGIHQ1.gif border="0" title="" width="120" height="80">
      </td>
      <td align="left" valign="middle">
        <div class=comment style="font-size: 9px">$8,000K<br><nobr>3600 m.</nobr></div>
        <img src="images/zone-commerce.gif" title="Building must be located in blue zone or no zone at all.">
      </td>
      </tr>
      <tr><td colspan="2"><table style="text-align: center"><tr>
              <td class=button align="center" width="100"
                  info="http://local.asp?frame_Id=MapIsoView&frame_Action=Build&FacilityClass=PGIGeneralHeadquarterSTA&VisualClassId=602"
                  command="build">Build now</td>
      </tr></table></td></tr>
      </table></td>
    </tr>

    <tr>
      <td width="100%" id="LinkFrame_1" background="images/itemgradient.jpg" altid="1">
        <div id="LinkText_1" class=listItem available="1" style="margin-left: 5px" altid="1">
        Supermarket
        </div>
      </td>
    </tr>
    <tr id="Cell_1" style="display:none">
      <td width="100%"><table cellpadding="3" cellspacing="0" width="100%">
      <tr>
      <td align="center" valign="middle" width="64">
        <img src=/five/icons/MapPGISupermarketC64x32x0.gif border="0" title="" width="120" height="80">
      </td>
      <td align="left" valign="middle">
        <div class=comment style="font-size: 9px">$500K<br><nobr>400 m.</nobr></div>
      </td>
      </tr>
      <tr><td colspan="2"><table style="text-align: center"><tr>
              <td class=button align="center" width="100"
                  info="http://local.asp?frame_Id=MapIsoView&frame_Action=Build&FacilityClass=PGISupermarketC&VisualClassId=610"
                  command="build">Build now</td>
      </tr></table></td></tr>
      </table></td>
    </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export function createBuildMenuScenario(
  overrides?: Partial<ScenarioVariables>,
  opts?: { refusal?: 'zone-mismatch' }
): { ws: WsCaptureScenario; rdo: RdoScenario; http: HttpScenario } {
  const vars = mergeVariables(overrides);
  const firstExchange = opts?.refusal === 'zone-mismatch' ? CAPTURED_BUILD_ZONE_MISMATCH : CAPTURED_BUILD_SUCCESS;

  const rdo: RdoScenario = {
    name: 'build-menu',
    description: 'Build menu: NewFacility success and duplicate error',
    exchanges: [
      {
        id: 'bm-rdo-001',
        request: `C 147 sel 8184316 call NewFacility "^" "%${firstExchange.facilityClass}","#${firstExchange.companyId}","#${firstExchange.x}","#${firstExchange.y}"`,
        response: `A147 res="#${firstExchange.result}"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'NewFacility' },
      },
      {
        id: 'bm-rdo-002',
        request: `C 98 sel ${vars.clientViewId} call NewFacility "^" "%${CAPTURED_BUILD_DUPLICATE.facilityClass}","#${CAPTURED_BUILD_DUPLICATE.companyId}","#${CAPTURED_BUILD_DUPLICATE.x}","#${CAPTURED_BUILD_DUPLICATE.y}"`,
        response: `A98 res="#${CAPTURED_BUILD_DUPLICATE.result}"`,
        matchKeys: {
          verb: 'sel',
          action: 'call',
          member: 'NewFacility',
          argsPattern: [`"%${CAPTURED_BUILD_DUPLICATE.facilityClass}"`],
        },
      },
    ],
    variables: vars as unknown as Record<string, string>,
  };

  const http: HttpScenario = {
    name: 'build-menu',
    exchanges: [
      {
        id: 'bm-http-001',
        method: 'GET',
        urlPattern: '/five/0/visual/voyager/Build/Build.asp',
        queryPatterns: {
          Tycoon: vars.username,
          Company: vars.companyName,
          WorldName: vars.worldName,
        },
        status: 200,
        contentType: 'text/html',
        body: buildBuildAspHtml(vars),
      },
      {
        id: 'bm-http-002',
        method: 'GET',
        urlPattern: '/five/0/visual/voyager/Build/FacilityList.asp',
        queryPatterns: {
          Company: vars.companyName,
          WorldName: vars.worldName,
        },
        status: 200,
        contentType: 'text/html',
        body: buildFacilityListHtml(),
      },
    ],
    variables: {},
  };

  const ws: WsCaptureScenario = {
    name: 'build-menu',
    description: 'Build menu: place building via NewFacility',
    capturedAt: '2026-02-18',
    serverInfo: { world: vars.worldName, zone: 'BETA', date: '2026-02-18' },
    exchanges: [
      {
        id: 'bm-ws-001',
        timestamp: '2026-02-18T21:30:00.000Z',
        request: {
          type: WsMessageType.REQ_PLACE_BUILDING,
          wsRequestId: 'bm-001',
          facilityClass: CAPTURED_BUILD_SUCCESS.facilityClass,
          x: CAPTURED_BUILD_SUCCESS.x,
          y: CAPTURED_BUILD_SUCCESS.y,
        } as WsMessage,
        responses: [
          {
            type: WsMessageType.RESP_BUILDING_PLACED,
            wsRequestId: 'bm-001',
            x: CAPTURED_BUILD_SUCCESS.x,
            y: CAPTURED_BUILD_SUCCESS.y,
            // No buildingId: the protocol does not return one (M-A). The mock
            // used to answer '0', which is what let the gateway's dead
            // `/sel (\d+)/` parse look plausible for as long as it did.
          } as WsMessage,
        ],
        tags: ['build'],
      },
    ],
  };

  return { ws, rdo, http };
}
