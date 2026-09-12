/**
 * Scenario 13: another player's curriculum page — what "Show Profile" opens
 * from a directory card (`RenderTycoon.asp:119-124`).
 *
 * What makes this worth a fixture and not just a unit test: the SAME page is
 * served twice, under two different `Tycoon` parameters, and the two renderings
 * differ exactly by what the server withholds. `Tycoon.asp:14-17` frames
 * `TycoonCurriculum.asp` with the VIEWER's password, so for a tycoon who is not
 * the viewer `FullAccess` is false (`TycoonCurriculum.asp:25`) and the page
 * drops the Reset / Abandon table (`:175-211`) and the "advance to next level"
 * checkbox (`:250-261`). Everything else — fortune, average profit, prestige,
 * nobility, the level block, the rankings, the curriculum items — is rendered
 * for any viewer.
 *
 * So the only thing that decides which page comes back is the `Tycoon` query
 * parameter the gateway put on the URL. A fixture that served one page could
 * not catch a gateway that sent the viewer's own name; two pages keyed on that
 * parameter can, and that is the L1 assertion this scenario exists for.
 *
 * It also serves `New Directory/RenderTycoon.asp`, because `fetchTycoonProfile`
 * always goes looking for the avatar there, and a trailing 404 for a tycoon
 * nobody serves — so an unknown name fails loudly instead of matching a
 * neighbour's page.
 *
 * There is no RDO half: the curriculum page is reachable through ASP alone,
 * exactly like the newspaper.
 */

import type { HttpScenario, HttpExchange } from '../types/http-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** Where `TycoonCurriculum.asp` lives. */
export const TYCOON_PATH = '/Five/0/Visual/Voyager/NewTycoon';

/** Where `RenderTycoon.asp` lives — the card the avatar is read from. */
export const DIRECTORY_PATH = '/five/0/visual/voyager/new%20directory';

/** The other player this scenario serves a page for. */
export const MOCK_RIVAL_NAME = 'Rival';

/** What the rival's page publishes, as the gateway must parse it back. */
export const MOCK_RIVAL = {
  fortune: '987654321',
  averageProfit: '$42,000/h',
  prestige: 4321,
  nobPoints: 900,
  currentLevelName: 'Master',
  currentLevelDescription: 'You are a master of industry.',
  nextLevelName: 'Paradigm',
  nextLevelDescription: 'Paradigms set the pace.',
  nextLevelRequirements: 'Prestige 4000 and 30 facilities',
  rankings: [
    { category: 'Fortune', rank: 3 },
    { category: 'Prestige', rank: 11 },
    { category: 'Population', rank: null },
  ],
  curriculumItems: [
    { item: 'Built a Farm', prestige: 120 },
    { item: 'Bankruptcy', prestige: -1000 },
  ],
} as const;

const T = (n: number): string => '\t'.repeat(n);

/** One `<div class=label>…<span class=value>` stat block — `:128-161`. */
function stat(label: string, value: string, style: string): string {
  return `${T(5)}<div class=label style="${style}">\n`
    + `${T(6)}${label}:\n`
    + `${T(6)}<span class=value>\n`
    + `${T(7)}${value}\n`
    + `${T(6)}</span>\n`
    + `${T(5)}</div>`;
}

/** `:175-211` — rendered under `FullAccess` only. */
function resetTable(): string {
  return `${T(4)}<table style="margin-left: 20px; margin-bottom: 20px">\n`
    + `${T(5)}<tr>\n`
    + `${T(6)}<td class=button align="left" width="100"\n`
    + `${T(7)}onClick="onBtnClick()"\n`
    + `${T(7)}command="reset"\n`
    + `${T(7)}normColor="#345950"\n`
    + `${T(7)}hiColor="white">\n\n`
    + `${T(8)}Reset Account\n`
    + `${T(6)}</td>\n${T(5)}</tr>\n${T(4)}</table>`;
}

/** `:250-260` — the checkbox, under `FullAccess and NextLevelName <> "" and Demo <> 1`. */
function advanceBox(): string {
  return `${T(9)}<div class=label style="margin-top: 10px; color: white">\n`
    + `${T(10)}<input type="checkbox" checked onClick="onAdvanceClick()">\n`
    + `${T(10)}Upgrade to next level\n${T(9)}</div>`;
}

/**
 * `TycoonCurriculum.asp` as IIS renders it for `who`.
 *
 * `fullAccess` is NOT a parameter of the page: it is what the server computes
 * from the password the frame carried (`:25`). Both callers below pass what the
 * real server would answer, which is the whole point of the pair.
 */
function curriculumPage(who: string, fullAccess: boolean): string {
  // `:63-109` — the head script, declared unconditionally. `onAdvanceClick`
  // being present here is why the checkbox itself, not the handler name, is
  // what tells the gateway an upgrade is offered.
  const head = `<head>\n`
    + `${T(1)}<title>\tTycoon Options </title>\n`
    + `${T(1)}<link rel="STYLESHEET" href="../voyager.css" type="text/css">\n`
    + `${T(1)}<script language="JScript">\n`
    + `${T(2)}function onAdvanceClick()\n${T(2)}{\n`
    + `${T(3)}var URL = getBaseURL() + "rdoSetAdvanceLevel.asp?TycoonId=4666201923&Tycoon=${who}";\n`
    + `${T(3)}hiddenFrame.navigate( URL );\n${T(2)}}\n`
    + `${T(1)}</script>\n</head>`;

  const blocks: string[] = [
    `${T(4)}<div class=header2>\n${T(5)}Curriculum\n${T(4)}</div>`,
    stat('Personal Fortune', '$987,654,321', 'margin-left: 20px; margin-top: 20px'),
    stat('Average Profit (this year)', '$42,000/h', 'margin-left: 20px; margin-top: 5px'),
    stat('Total Prestige', '4321  points', 'margin-left: 20px; margin-top: 5px'),
    stat('Nobility', '900  points', 'margin-left: 20px; margin-top: 5px; margin-bottom: 20px'),
  ];
  if (fullAccess) blocks.push(resetTable());

  // `:215-317` — the level block.
  const currentTd = `${T(6)}<td valign="top" align="left" width=190>\n`
    + `${T(7)}<div class=header2>\n${T(8)}Current Level\n${T(7)}</div>\n`
    + `${T(7)}<div class=header1>\n${T(8)}${MOCK_RIVAL.currentLevelName}\n${T(7)}</div>\n`
    + `${T(7)}<table>\n${T(8)}<tr>\n`
    + `${T(9)}<td valign="top" align="left" width=90>\n`
    + `${T(10)}<img src="images/level${MOCK_RIVAL.currentLevelName}.gif" width=80 height=80>\n${T(9)}</td>\n`
    + `${T(9)}<td class=label>\n${T(9)}</td>\n`
    + `${T(8)}</tr>\n${T(7)}</table>\n`
    + `${T(7)}<div class=label>\n${T(8)}${MOCK_RIVAL.currentLevelDescription}\n${T(7)}</div>\n`
    + (fullAccess ? `${advanceBox()}\n` : '')
    + `${T(6)}</td>`;

  const nextTd = `${T(6)}<td background="images/vertline.gif" width=120 align="center" valign="center">\n`
    + `${T(7)}<div id=arrow style="visibility: hidden">\n`
    + `${T(8)}<img src="images/levelsarrow.gif" width=114 height=19>\n${T(7)}</div>\n${T(6)}</td>\n`
    + `${T(6)}<td valign="top" align="left" width=190>\n`
    + `${T(7)}<div class=header2>\n${T(8)}Next Level \n${T(7)}</div>\n`
    + `${T(7)}<div class=header1>\n${T(8)}${MOCK_RIVAL.nextLevelName}\n${T(7)}</div>\n`
    + `${T(7)}<table>\n${T(8)}<tr>\n`
    + `${T(9)}<td valign="top" align="left" width=90>\n`
    + `${T(10)}<img src="images/level${MOCK_RIVAL.nextLevelName}Disabled.gif" width=80 height=80>\n${T(9)}</td>\n`
    + `${T(8)}</tr>\n${T(7)}</table>\n`
    + `${T(7)}<div class=label>\n${T(8)}${MOCK_RIVAL.nextLevelDescription}\n${T(7)}</div>\n`
    + `${T(7)}<div class=label style="margin-top: 10px; color: white; font-weight: bold">\n${T(8)}Requires:\n${T(7)}</div>\n`
    + `${T(7)}<div class=label style="margin-top: 10px; color: white">\n${T(8)}${MOCK_RIVAL.nextLevelRequirements}\n${T(7)}</div>\n`
    + `${T(6)}</td>`;

  blocks.push(`${T(4)}<table cellspacing=0 width=500>\n${T(5)}<tr>\n${currentTd}\n${nextTd}\n${T(5)}</tr>\n${T(4)}</table>`);

  // `:320-344` — the rankings, three columns per row.
  const rankCells = MOCK_RIVAL.rankings.map((r, i) =>
    (i % 3 === 0 ? `${T(5)}<tr>\n` : '')
    + `${T(6)}<td class=label>\n${T(7)}${r.category}\n${T(6)}</td>\n`
    + `${T(6)}<td align=right class=value>\n${T(7)}${r.rank === null ? '-' : r.rank}\n${T(6)}</td>\n`
    + `${T(6)}<td width=20px>\n${T(6)}</td>`
    + ((i + 1) % 3 === 0 ? `\n${T(5)}</tr>` : '')).join('\n');
  blocks.push(`${T(4)}<div class=header2>\n${T(5)}${who}  in the rankings\n${T(4)}</div>\n`
    + `${T(4)}<table style="margin-top: 10px; margin-left: 20px; margin-bottom: 20px">\n${rankCells}\n${T(4)}</table>`);

  // `:369-416` — curriculum items.
  const itemRows = MOCK_RIVAL.curriculumItems.map((item) =>
    `${T(5)}<tr>\n${T(6)}<td>\n${T(6)}</td>\n`
    + `${T(6)}<td class=value>\n${T(7)}${item.item}\n${T(6)}</td>\n`
    + `${T(6)}<td class=value>\n${T(7)}${item.prestige > 0 ? `+${item.prestige}` : item.prestige.toLocaleString('en-US')}\n${T(6)}</td>\n${T(5)}</tr>`).join('\n');
  blocks.push(`${T(4)}<div class=header2>\n${T(5)}Curriculum items\n${T(4)}</div>\n`
    + `${T(4)}<table width=100% style="margin-top: 10px">\n`
    + `${T(5)}<tr>\n${T(6)}<td width=20>\n${T(6)}</td>\n`
    + `${T(6)}<td class=label>\n${T(7)}Item \n${T(6)}</td>\n`
    + `${T(6)}<td class=label>\n${T(7)}Prestige\n${T(6)}</td>\n${T(5)}</tr>\n`
    + `${itemRows}\n${T(4)}</table>`);

  return `${head}\n\n<body>\n\n${T(1)}<div id=main">\n${T(1)}<table width="100%" height="100%" cellspacing="0">\n`
    + `${T(2)}<tr>\n${T(3)}<td valign="top" style="padding: 20px">\n`
    + blocks.join('\n') + `\n${T(3)}</td>\n${T(2)}</tr>\n${T(1)}</table>\n${T(1)}</div>\n`
    + `${T(1)}<iframe id=hiddenFrame style="display: none">\n\n</body>`;
}

/** `RenderTycoon.asp:58` — the avatar, root-relative against the host. */
function renderTycoonPage(): string {
  return '<html>\n\t<body>\n'
    + `\t\t<img id=picture src="/fivedata/userinfo/{{worldName}}/${MOCK_RIVAL_NAME}/largephoto.jpg" width=150 height=200><br>\n`
    + '\t</body>\n</html>';
}

function buildHttpExchanges(): HttpExchange[] {
  return [
    {
      // The other player's page — `FullAccess` false, so no reset table and no
      // upgrade checkbox.
      id: 'tycoon-profile-http-rival',
      method: 'GET',
      urlPattern: `${TYCOON_PATH}/TycoonCurriculum.asp`,
      queryPatterns: { Tycoon: MOCK_RIVAL_NAME, WorldName: '{{worldName}}' },
      status: 200,
      contentType: 'text/html',
      body: curriculumPage(MOCK_RIVAL_NAME, false),
    },
    {
      // The session user's own page — the one the Curriculum tab reads today.
      id: 'tycoon-profile-http-own',
      method: 'GET',
      urlPattern: `${TYCOON_PATH}/TycoonCurriculum.asp`,
      queryPatterns: { Tycoon: '{{username}}', WorldName: '{{worldName}}' },
      status: 200,
      contentType: 'text/html',
      body: curriculumPage('{{username}}', true),
    },
    {
      // `HttpMock.pathMatches` lowercases the request path only against a
      // lowercased pattern, hence the literal lowercase path here.
      id: 'tycoon-profile-http-render',
      method: 'GET',
      urlPattern: `${DIRECTORY_PATH}/rendertycoon.asp`,
      queryPatterns: { Tycoon: '*' },
      status: 200,
      contentType: 'text/html',
      body: renderTycoonPage(),
    },
    {
      // Last, so it only catches a tycoon none of the exchanges above claimed.
      id: 'tycoon-profile-http-unknown',
      method: 'GET',
      urlPattern: `${TYCOON_PATH}/TycoonCurriculum.asp`,
      status: 404,
      contentType: 'text/html',
      body: '<html><body>404 - File not found</body></html>',
    },
  ];
}

export function createTycoonProfileScenario(
  overrides?: Partial<ScenarioVariables>,
): { http: HttpScenario } {
  const vars = mergeVariables(overrides);
  return {
    http: {
      name: 'tycoon-profile',
      exchanges: buildHttpExchanges(),
      variables: vars as unknown as Record<string, string>,
    },
  };
}
