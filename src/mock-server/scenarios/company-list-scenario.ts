/**
 * Scenario 3: Server Selection + Company List + CompanyPage.asp
 * RDO:  get GetCompanyCount, then the five indexed CALLs the login path emits
 *       per company — GetCompanyOwnerRole, GetCompanyName, GetCompanyId,
 *       GetCompanyCluster, GetCompanyFacilityCount, in the order
 *       `chooseCompany.asp:166-170` emits them, each with an integer index.
 * HTTP: CompanyPage.asp → one company's P&L account tree
 */

import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage } from '@/shared/types/message-types';
import type { ProfitLossData } from '@/shared/types';
import type { WsCaptureScenario } from '../types/mock-types';
import type { HttpScenario } from '../types/http-exchange-types';
import type { RdoScenario } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The company the capture shows, field by field, as the five CALLs answer them */
export interface CapturedCompanyData {
  name: string;
  id: string;
  ownerRole: string;
  cluster: string;
  status: string;
  facilityCount: number;
}

const CAPTURED_COMPANY: CapturedCompanyData = {
  name: 'Yellow Inc.',
  id: '28',
  ownerRole: 'SPO_test3',
  cluster: 'PGI',
  status: 'Private',
  facilityCount: 38,
};

/**
 * One account row, CompanyPage.asp:175-232 — same generator as
 * TycoonProfitAndLoses.asp, one differing line (:236 vs :170). A level-2
 * account renders its name upper-cased (:189) and no inline value: the value
 * is stashed and flushed later by a row of its own (buildCompanyPageFlush).
 */
function buildCompanyPageRow(level: number, label: string, money: string, chart = ''): string {
  const nameCell = level === 2
    ? `<div style="margin-top: 5px">${label.toUpperCase()}</div>`
    : `${level === 1 ? '<img style="margin-left: -30px" src="images/corner.gif" width=20 height=20>' : ''}${label}`;
  const valueCell = level === 2 ? '' :
    `<div class=labelAccountLevel${level} style="color: white">`
    + `<div style="margin-left: 0px">${money}`
    + (chart
      ? `<a href="http://local.asp?frame_Id=AppHandler&frame_Action=ShowChart&ChartTitle=${label}&ChartInfo=${chart}"><img src="images/chart.jpg" width=17 height=10 border=0></a>`
      : '')
    + `</div></div>`;
  return `<tr><td>`
    + `<div class=labelAccountLevel${level} style="margin-left: ${30 * level}px; margin-right: 5px">`
    + `<nobr>${nameCell}</nobr></div></td>`
    + `<td align="right"><nobr>${valueCell}</nobr></td></tr>`;
}

/** The level-2 total flushed in a row of its own — CompanyPage.asp:156-173 / :272-290. */
function buildCompanyPageFlush(money: string, title: string, chart = ''): string {
  const color = money.startsWith('-') ? '#ff7700' : 'white';
  return `<tr><td></td><td height="1" background="../images/itemgradient.jpg" colspan="2"></td></tr>`
    + `<tr><td></td><td align="right">`
    + `<div class=labelAccountLevel2 style="color: ${color}">`
    + `<nobr>${money}`
    + (chart
      ? `<a href="http://local.asp?frame_Id=AppHandler&frame_Action=ShowChart&ChartTitle=${title}&ChartInfo=${chart}"><img src="images/chart.jpg" width=17 height=10 border=0></a>`
      : '')
    + `</nobr></div></td></tr>`;
}

function companyPageHeader(vars: ScenarioVariables): string {
  return `<table style="margin-top: 30px"><tr>`
    + `<td><img src="../NewLogon/images/comp-${vars.companyCluster}.gif" style="cursor: hand" border="0"></td>`
    + `<td><h2>${vars.companyName}</h2></td>`
    + `</tr></table>`;
}

/** CompanyPage.asp:139-295 — the `if ObjValid` branch: the account tree. */
function buildCompanyPageHtml(vars: ScenarioVariables): string {
  return `<html><body>
${companyPageHeader(vars)}
<div id=main><table width="100%" height="100%" cellspacing="0"><tr><td valign="top" style="padding: 20px">
<div class=header2>Profit &amp; Loss</div>
<table style="margin-left: 40px" cellpadding=0 cellspacing=0>
${buildCompanyPageRow(0, 'Net Profit (losses)', '$1,250,000', '3,1000000,1100000,1250000')}
${buildCompanyPageRow(1, 'Income', '$2,000,000')}
${buildCompanyPageRow(2, 'Residentials', '')}
${buildCompanyPageRow(3, 'Houses', '$500,000')}
${buildCompanyPageRow(3, 'Flats', '$1,500,000')}
${buildCompanyPageFlush('$2,000,000', 'Residentials')}
${buildCompanyPageRow(1, 'Expenses', '-$750,000')}
${buildCompanyPageRow(2, 'Salaries', '')}
${buildCompanyPageRow(3, 'Workers', '-$750,000')}
${buildCompanyPageFlush('-$750,000', 'Salaries')}
</table>
</td></tr></table></div>
</body></html>`;
}

/** CompanyPage.asp:296-299 — the `else` branch: no account row at all. */
function buildCompanyPageUnavailableHtml(vars: ScenarioVariables): string {
  return `<html><body>
${companyPageHeader(vars)}
<div id=main><table width="100%" height="100%" cellspacing="0"><tr><td valign="top" style="padding: 20px">
<div class=header2 style="padding: 20px">Sorry, cannot retrieve Tycoon information from server.</div>
</td></tr></table></div>
</body></html>`;
}

/** The tree buildCompanyPageHtml's markup describes, written by hand — not by running the parser. */
export const COMPANY_PAGE_TREE: ProfitLossData = {
  root: {
    label: 'Net Profit (losses)',
    level: 0,
    amount: '1250000',
    chartData: [1000000, 1100000, 1250000],
    children: [
      {
        label: 'Income',
        level: 1,
        amount: '2000000',
        isHeader: false,
        children: [
          {
            label: 'RESIDENTIALS',
            level: 2,
            amount: '2000000',
            isHeader: true,
            children: [
              { label: 'Houses', level: 3, amount: '500000', isHeader: false, children: [] },
              { label: 'Flats', level: 3, amount: '1500000', isHeader: false, children: [] },
            ],
          },
        ],
      },
      {
        label: 'Expenses',
        level: 1,
        amount: '-750000',
        isHeader: false,
        children: [
          {
            label: 'SALARIES',
            level: 2,
            amount: '-750000',
            isHeader: true,
            children: [
              { label: 'Workers', level: 3, amount: '-750000', isHeader: false, children: [] },
            ],
          },
        ],
      },
    ],
  },
};

/**
 * One indexed company read: `C <rid> sel <clientView> call GetCompanyX "^" "#0"`.
 * The index is an INTEGER — `chooseCompany.asp:166-170` passes `CInt(i)`, and a
 * widestring index would reach the Delphi `index : integer` parameter as garbage.
 */
function companyFieldExchange(
  ordinal: number,
  member: string,
  clientViewId: string,
  answer: string,
) {
  return {
    id: `cl-rdo-00${ordinal + 1}`,
    request: `C ${ordinal} sel ${clientViewId} call ${member} "^" "#0"`,
    response: `A${ordinal} res="${answer}"`,
    matchKeys: { verb: 'sel', action: 'call', member, argsPattern: ['"#0"'] },
  };
}

export function createCompanyListScenario(
  overrides?: Partial<ScenarioVariables>
): { ws: WsCaptureScenario; rdo: RdoScenario; http: HttpScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'company-list',
    description: 'GetCompanyCount + the five indexed company reads of the login path',
    exchanges: [
      {
        id: 'cl-rdo-count',
        request: `C 0 sel ${vars.clientViewId} get GetCompanyCount`,
        response: `A0 GetCompanyCount="#1"`,
        matchKeys: { verb: 'sel', action: 'get', member: 'GetCompanyCount' },
      },
      // The ASP's own order (chooseCompany.asp:166-170).
      companyFieldExchange(1, 'GetCompanyOwnerRole', vars.clientViewId, `%${vars.companyOwnerRole}`),
      companyFieldExchange(2, 'GetCompanyName', vars.clientViewId, `%${vars.companyName}`),
      companyFieldExchange(3, 'GetCompanyId', vars.clientViewId, `#${vars.companyId}`),
      companyFieldExchange(4, 'GetCompanyCluster', vars.clientViewId, `%${vars.companyCluster}`),
      companyFieldExchange(5, 'GetCompanyFacilityCount', vars.clientViewId, `#${CAPTURED_COMPANY.facilityCount}`),
    ],
    variables: {},
  };

  const http: HttpScenario = {
    name: 'company-list',
    exchanges: [
      {
        id: 'cl-http-004',
        method: 'GET',
        urlPattern: '/Five/0/Visual/Voyager/NewTycoon/CompanyPage.asp',
        // The page reads Request("Company") (CompanyPage.asp:10): a request that
        // does not name THIS company must not be served this tree.
        queryPatterns: { Company: vars.companyName, WorldName: vars.worldName, Tycoon: vars.username },
        status: 200,
        contentType: 'text/html',
        body: buildCompanyPageHtml(vars),
      },
      {
        id: 'cl-http-005',
        method: 'GET',
        urlPattern: '/Five/0/Visual/Voyager/NewTycoon/CompanyPage.asp',
        // Any other company: the ObjValid=false page (:296-299), no account row.
        queryPatterns: { Company: '*' },
        status: 200,
        contentType: 'text/html',
        body: buildCompanyPageUnavailableHtml(vars),
      },
    ],
    variables: {},
  };

  const ws: WsCaptureScenario = {
    name: 'company-list',
    description: 'Login to world and receive company list',
    capturedAt: '2026-02-18',
    serverInfo: { world: vars.worldName, zone: 'BETA', date: '2026-02-18' },
    exchanges: [
      {
        id: 'cl-ws-001',
        timestamp: '2026-02-18T21:21:27.000Z',
        request: {
          type: WsMessageType.REQ_LOGIN_WORLD,
          wsRequestId: 'cl-001',
          username: vars.username,
          password: vars.password,
          worldName: vars.worldName,
        } as WsMessage,
        responses: [
          {
            type: WsMessageType.RESP_LOGIN_SUCCESS,
            wsRequestId: 'cl-001',
            tycoonId: '22',
            contextId: vars.clientViewId,
            companyCount: 1,
            companies: [
              {
                id: vars.companyId,
                name: vars.companyName,
                ownerRole: vars.companyOwnerRole,
                cluster: vars.companyCluster,
                facilityCount: CAPTURED_COMPANY.facilityCount,
              },
            ],
          } as WsMessage,
        ],
        tags: ['auth'],
      },
    ],
  };

  return { ws, rdo, http };
}

export { CAPTURED_COMPANY };
