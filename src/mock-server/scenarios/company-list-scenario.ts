/**
 * Scenario 3: Server Selection + Company List + CompanyPage.asp
 * HTTP: chooseCompany.asp → company HTML with name, id, ownerRole;
 *       CompanyPage.asp → one company's P&L account tree
 */

import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage } from '@/shared/types/message-types';
import type { ProfitLossData } from '@/shared/types';
import type { WsCaptureScenario } from '../types/mock-types';
import type { HttpScenario } from '../types/http-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** Extracted company data from chooseCompany.asp HTML */
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

function buildChooseCompanyHtml(vars: ScenarioVariables): string {
  return `<html>
<head><title> Company List </title>
<link rel="STYLESHEET" href="../voyager.css" type="text/css">
</head>
<body style="margin-top: 20px; padding-left: 20px" onLoad="onPageLoad()">
<div id=allStuff style="display: none">
<div class=header2>Companies</div>
<div class=value style="margin-left: 20px; margin-top: 10px">
You have registered the following companies in ${vars.worldName}.<br>
Choose one from the list or create a new one.
</div>
<div style="margin-top: 25px; text-align: center">
<table style="padding: 5px">
<tr><tr>
<td align="center" valign="bottom"
style="border-style: solid; border-width: 2px; border-color: black"
companyOwnerRole="${vars.companyOwnerRole}"
companyName="${vars.companyName}"
companyId="${vars.companyId}">
<img src="images/comp-${vars.companyCluster}.gif" style="cursor: hand" border="0">
<div class=header3>${vars.companyName}</div>
<a href="../NewTycoon/CompanyPage.asp?Company=${encodeURIComponent(vars.companyName)}&Tycoon=${vars.username}&WorldName=${vars.worldName}&CompanyCluster=${vars.companyCluster}">more info</a>
<div class=data>
<nobr> ${CAPTURED_COMPANY.status} </nobr><br>
<nobr> ${CAPTURED_COMPANY.facilityCount} Facilities </nobr><br>
</div>
</td>
</tr>
</table>
</div>
</div>
</body>
</html>`;
}

/** LogonNoAccess.asp:68-108 — no companyId cell anywhere. */
function buildLogonNoAccessHtml(expiresOn: string): string {
  return `<html>
<head><title>Portal Travel Denied</title></head>
<body>
<div class=header2>PORTAL TRAVEL REQUESTED DENIED</div>
<div class=value>Could not access the portal to this Planet!</div>
<div class=value>Your portal travel privileges to this planet expired on: ${expiresOn}</div>
<div class=value>Expired: ${expiresOn}</div>
</body>
</html>`;
}

/** logonError.asp:68-72 */
function buildLogonErrorHtml(): string {
  return `<html>
<head><title>Portal Error</title></head>
<body>
<div class=value>Your request was rejected due an error.</div>
<div class=value>Could not access the portal to this Planet!</div>
</body>
</html>`;
}

function buildPleaseWaitHtml(): string {
  return `<html>
<head><title> Company List </title>
<link rel="STYLESHEET" href="logon.css" type="text/css">
</head>
<body style="margin-top: 20px; padding-left: 20px">
<div id=allStuff style="display: none">
<font size=2>PLEASE WAIT</p>If this page doesn't clear please try to join the planet again!</font>
</div>
</body>
</html>`;
}

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

export interface CompanyListScenarioOptions {
  logonResult?: 'companies' | 'noAccess' | 'error';
  expiresOn?: string;
  errorCode?: string;
}

export function createCompanyListScenario(
  overrides?: Partial<ScenarioVariables>,
  options?: CompanyListScenarioOptions,
): { ws: WsCaptureScenario; http: HttpScenario } {
  const vars = mergeVariables(overrides);
  const logonResult = options?.logonResult ?? 'companies';
  const expiresOn = options?.expiresOn ?? '01/01/2020';
  const errorCode = options?.errorCode ?? 'ERROR_CANNOTCREATECLIENTVIEW';

  const logonCompleteLocation = logonResult === 'noAccess'
    ? `logonNoAccess.asp?PA=${expiresOn}&Logon=FALSE&WorldName= ${vars.worldName}&ErrorCode=ERROR_REQUESTDENIED&frame_NoBorder=True&frame_NoScrollBars=true&frame_Id=LogonView&date=01/09/2026`
    : logonResult === 'error'
      ? `logonError.asp?ErrorCode=${errorCode}&Logon=FALSE`
      : `chooseCompany.asp?ClientViewId=${vars.clientViewId}&PA=&Ooopsy=0&WorldName=${vars.worldName}&UserName=${vars.username}&Logon=FALSE&ISAddr=${vars.worldIp}&ISPort=${vars.worldPort}`;

  const exchanges: HttpScenario['exchanges'] = [
    {
      id: 'cl-http-001',
      method: 'GET',
      urlPattern: '/Five/0/Visual/Voyager/NewLogon/pleasewait.asp',
      status: 200,
      contentType: 'text/html',
      body: buildPleaseWaitHtml(),
    },
    {
      id: 'cl-http-002',
      method: 'GET',
      urlPattern: '/Five/0/Visual/Voyager/NewLogon/logonComplete.asp',
      queryPatterns: {
        WorldName: vars.worldName,
        UserName: vars.username,
      },
      status: 302,
      contentType: 'text/html',
      body: '',
      headers: {
        Location: logonCompleteLocation,
      },
    },
  ];

  if (logonResult === 'noAccess') {
    exchanges.push({
      id: 'cl-http-006',
      method: 'GET',
      urlPattern: '/Five/0/Visual/Voyager/NewLogon/logonNoAccess.asp',
      status: 200,
      contentType: 'text/html',
      body: buildLogonNoAccessHtml(expiresOn),
    });
  } else if (logonResult === 'error') {
    exchanges.push({
      id: 'cl-http-006',
      method: 'GET',
      urlPattern: '/Five/0/Visual/Voyager/NewLogon/logonError.asp',
      status: 200,
      contentType: 'text/html',
      body: buildLogonErrorHtml(),
    });
  } else {
    exchanges.push(
      {
        id: 'cl-http-003',
        method: 'GET',
        urlPattern: '/Five/0/Visual/Voyager/NewLogon/chooseCompany.asp',
        queryPatterns: {
          WorldName: vars.worldName,
          UserName: vars.username,
        },
        status: 200,
        contentType: 'text/html',
        body: buildChooseCompanyHtml(vars),
      },
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
    );
  }

  const http: HttpScenario = {
    name: 'company-list',
    exchanges,
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
              },
            ],
          } as WsMessage,
        ],
        tags: ['auth'],
      },
    ],
  };

  return { ws, http };
}

export { CAPTURED_COMPANY };
