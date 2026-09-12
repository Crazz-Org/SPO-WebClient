/**
 * Scenario 15: abandoning a political role, followed by the return trip home.
 *
 * The reference client reads the player's own company list BEFORE resigning
 * (`~/SPO-ASP/Five/0/Visual/Voyager/NewTycoon/rdoAbandonRole.asp:22-26`,
 * `RDOGetCompanyList(RN)`), resigns (`:27`), then navigates to
 * `SetCompany&…&OwnerRole=<RN>` (`:40`). All four legs are ASP pages, so this
 * scenario is HTTP only, exactly like `tycoon-profile`:
 *
 *   1. `NewLogon/logonComplete.asp`   — the read-before-resign company list
 *   2. `NewTycoon/abandonRole.asp`    — the confirmation page (step 1 of the
 *      existing two-step resignation in `auto-connection-handler.ts`)
 *   3. `NewTycoon/rdoAbandonRole.asp` — the commit (step 2); its body is a
 *      `window.navigate()` shim and publishes no outcome of its own
 *   4. `NewTycoon/TycoonCurriculum.asp` — the oracle `commitAbandonRole` reads:
 *      `command="abandon"` while the role is still held, `command="reset"`
 *      once it is gone
 *   5. a trailing 404, so an unserved page fails loudly
 */

import type { HttpScenario, HttpExchange } from '../types/http-exchange-types';
import type { CompanyInfo } from '../../shared/types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables, DEFAULT_VARIABLES } from './scenario-variables';

/** Where the curriculum/resignation pages live. */
export const TYCOON_PATH = '/Five/0/Visual/Voyager/NewTycoon';

/** Where the company list is read from — the gateway's `fetchCompaniesViaHttp`. */
export const LOGON_PATH = '/Five/0/Visual/Voyager/NewLogon/logonComplete.asp';

const T = (n: number): string => '\t'.repeat(n);

/**
 * The player's own first company — what `abandonRole()` should switch back to,
 * as the default scenario variables (`DEFAULT_VARIABLES.username`) resolve it.
 */
export const MOCK_HOME_COMPANY: CompanyInfo = { id: '55', name: 'SPO_test3 - Green', ownerRole: DEFAULT_VARIABLES.username };

/** Template form fed into the markup — `ownerRole` is substituted per-request. */
const DEFAULT_PERSONAL_COMPANIES: CompanyInfo[] = [
  { id: MOCK_HOME_COMPANY.id, name: MOCK_HOME_COMPANY.name, ownerRole: '{{username}}' },
  { id: '56', name: 'Mayor of Kalisz', ownerRole: 'Mayor of Kalisz' },
];

/** `logonComplete.asp` company `<td>` rows — `login-handler.ts:970-985` parses these. */
function companyListPage(companies: CompanyInfo[]): string {
  const rows = companies.map(c =>
    `<td companyId="${c.id}" companyName="${c.name}" companyOwnerRole="${c.ownerRole ?? ''}"></td>`
  ).join('\n');
  return `<html>\n<body>\n<table>\n${rows}\n</table>\n</body>\n</html>`;
}

/** `abandonRole.asp` — the confirmation page (compact form of the fixture in `auto-connection-handler.test.ts`). */
function confirmationPage(): string {
  return `<head>\n${T(1)}<script language="JScript">\n\n`
    + `${T(2)}function onBtnClick()\n${T(2)}{\n`
    + `${T(3)}var URL = "rdoAbandonRole.asp?Tycoon={{username}}&WorldName={{worldName}}&DAAddr={{daAddr}}&DAPort={{daPort}}&TycoonId=&Password={{password}}&RN={{username}}";\n`
    + `${T(3)}window.navigate(URL);\n${T(2)}}\n${T(1)}</script>\n</head>\n`
    + `<body>\n${T(1)}<div class=header2>Resign</div>\n`
    + `${T(1)}<td class=button command="abandon" onClick="onBtnClick()">Resign</td>\n`
    + `${T(1)}<td class=button command="cancel" onClick="onBtnClick()">Cancel</td>\n</body>`;
}

/** `rdoAbandonRole.asp:35-44` — a navigate() shim, no outcome of any kind. */
function commitBody(): string {
  return `<html>\n<head>\n</head>\n<body>\n<script language="JScript">\n`
    + `window.navigate("http://local.asp?frame_Action=SetCompany&frame_Id=CnxHandler&Name={{username}} - Green&OwnerRole={{username}}&Id=55::http://local.asp?frame_Id=TycoonOpt&frame_Close=yes");\n`
    + `</script>\n</body>\n</html>`;
}

/** `TycoonCurriculum.asp:175-211` — the oracle `commitAbandonRole` reads. */
function curriculumPage(roleStillHeld: boolean): string {
  const button = roleStillHeld
    ? `${T(1)}<td class=button command="abandon">Resign</td>`
    : `${T(1)}<td class=button command="reset">Reset Account</td>`;
  return `<html>\n<body>\n${button}\n</body>\n</html>`;
}

function buildHttpExchanges(personalCompanies: CompanyInfo[], roleStillHeld: boolean): HttpExchange[] {
  return [
    {
      id: 'abandon-role-http-companies',
      method: 'GET',
      urlPattern: LOGON_PATH,
      queryPatterns: { UserName: '{{username}}' },
      status: 200,
      contentType: 'text/html',
      body: companyListPage(personalCompanies),
    },
    {
      id: 'abandon-role-http-confirm',
      method: 'GET',
      urlPattern: `${TYCOON_PATH}/abandonRole.asp`,
      queryPatterns: { Tycoon: '*' },
      status: 200,
      contentType: 'text/html',
      body: confirmationPage(),
    },
    {
      id: 'abandon-role-http-commit',
      method: 'GET',
      urlPattern: `${TYCOON_PATH}/rdoAbandonRole.asp`,
      queryPatterns: { RN: '*' },
      status: 200,
      contentType: 'text/html',
      body: commitBody(),
    },
    {
      id: 'abandon-role-http-curriculum',
      method: 'GET',
      urlPattern: `${TYCOON_PATH}/TycoonCurriculum.asp`,
      status: 200,
      contentType: 'text/html',
      body: curriculumPage(roleStillHeld),
    },
    {
      // Last, so it only catches a page none of the exchanges above claimed.
      id: 'abandon-role-http-unknown',
      method: 'GET',
      urlPattern: `${TYCOON_PATH}/*`,
      status: 404,
      contentType: 'text/html',
      body: '<html><body>404 - File not found</body></html>',
    },
  ];
}

export function createAbandonRoleScenario(
  overrides?: Partial<ScenarioVariables>,
  opts?: { personalCompanies?: CompanyInfo[]; roleStillHeld?: boolean },
): { http: HttpScenario } {
  const vars = mergeVariables(overrides);
  const personalCompanies = opts?.personalCompanies ?? DEFAULT_PERSONAL_COMPANIES;
  const roleStillHeld = opts?.roleStillHeld ?? false;
  return {
    http: {
      name: 'abandon-role',
      exchanges: buildHttpExchanges(personalCompanies, roleStillHeld),
      variables: vars as unknown as Record<string, string>,
    },
  };
}
