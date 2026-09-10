/**
 * Scenario 17: the daily paper — `Newsreader.asp`'s two pages, plus the
 * directory's Media listing (`New Directory/Newspapers.asp`).
 *
 * The board half of the town paper already had no L1 fixture and no need for
 * one: `boardmsg.asp` is a single page and its parsers are unit-tested against
 * it. The *paper* half is different, because it is two pages that have to agree
 * with each other — the bar names the folders, and the folder name is what
 * builds the URL of the issue page. A mistake in between (a folder sorted the
 * wrong way, an `@` left unescaped, a `Selected=` read off the wrong cell)
 * cannot be caught by testing either page alone.
 *
 * So this scenario serves all three, and its suites drive the real handlers
 * across them:
 *
 *  - `showbar.asp` — the issue row of `ShowBar.asp:81-109`, with the cells in
 *    an order that is NOT the order they must come back in. The page order is
 *    the filesystem's (`FindFirst`/`FindNext`) and carries no age; the folder
 *    name does (`News.pas:956-961`). A fixture already sorted would prove
 *    nothing.
 *  - one `home.asp` per folder — the IIS-processed issue page, as
 *    `News.pas:750-802` assembles it: the style's header (`standard.header`),
 *    a layout of stories (`Layouts/1.layout`, each `<h<LayoutImp>>` +
 *    `<div class=articleBody>`), then the footer.
 *  - a trailing 404 for any other folder, so an issue nobody printed fails
 *    loudly instead of matching a neighbour's page.
 *  - `New Directory/Newspapers.asp` — the directory's Media listing, one row
 *    per paper in the world (`Newspapers.asp:12-24`); `papers: []` is the
 *    world with no newspapers.
 *
 * There is no RDO half: the paper is reachable only through the ASP pages,
 * exactly like the board.
 */

import type { HttpScenario, HttpExchange } from '../types/http-exchange-types';
import type { NewspaperIssueRef, NewspaperListing } from '../../shared/types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** Where `Newsreader.asp` and everything it frames live. */
export const NEWS_PATH = '/Five/0/Visual/News';

/** The paper the Town Hall of the building-details scenario names (`:503`). */
export const MOCK_PAPER_NAME = 'Shamba Daily';

/** Where the directory's Media listing lives (`Newspapers.asp`). */
export const DIRECTORY_PATH = '/Five/0/Visual/Voyager/New%20Directory';

/** The directory's Media listing — every paper in the world, one row each. */
export const MOCK_DIRECTORY_PAPERS: NewspaperListing[] = [
  { paperName: MOCK_PAPER_NAME, townName: 'Shamba' },
  { paperName: 'Helartia Herald', townName: 'Helartia' },
];

/**
 * Three kept issues, newest first.
 *
 * The id is `IssueMax - Issue` zero-padded to 12 (`News.pas:956-961`), so a
 * LOWER id is a NEWER issue and plain ascending string order is newest first.
 * The date half is `DateToStr` with `/` swapped for `-` (`:963-971`).
 */
export const MOCK_ISSUE_FOLDERS = [
  '002147483640@3-1-2027',
  '002147483641@2-28-2027',
  '002147483642@2-27-2027',
];

/** What `parseNewspaperIssueList` must return for those folders, in that order. */
export const MOCK_ISSUES: NewspaperIssueRef[] = [
  { folder: '002147483640@3-1-2027', date: '3/1/2027' },
  { folder: '002147483641@2-28-2027', date: '2/28/2027' },
  { folder: '002147483642@2-27-2027', date: '2/27/2027' },
];

/** The long date each issue's masthead prints (`FormatDateTime(..., vbLongDate)`). */
const LONG_DATES: Record<string, string> = {
  '002147483640@3-1-2027': 'Monday, March 01, 2027',
  '002147483641@2-28-2027': 'Sunday, February 28, 2027',
  '002147483642@2-27-2027': 'Saturday, February 27, 2027',
};

/** The lead story of each issue, so a test can tell one page from another. */
const HEADLINES: Record<string, string> = {
  '002147483640@3-1-2027': 'Domestic Wars!',
  '002147483641@2-28-2027': 'Health system awarded',
  '002147483642@2-27-2027': 'Black market remains gray',
};

/** `ShowBar.asp:89-94` — the selected cell, and the script naming its folder. */
function selectedCell(folder: string, date: string): string {
  return [
    '\t\t\t\t\t<td class=selectedDate>',
    `\t\t\t\t\t\t${date}`,
    '\t\t\t\t\t</td>',
    '\t\t\t\t\t<script language="JScript">',
    `\t\t\t\t\t\tselected = "${folder}";`,
    '\t\t\t\t\t</script>',
  ].join('\n');
}

/** `ShowBar.asp:98-102` — every other cell, a link carrying `Selected=<folder>`. */
function normalCell(folder: string, date: string): string {
  const href =
    `showbar.asp?WorldName={{worldName}}&TownName=Shamba&Selected=${folder}`
    + `&PaperName=${MOCK_PAPER_NAME}&Tycoon={{username}}&DAAddr=127.0.0.1&DAPort=7001`;
  return [
    '\t\t\t\t\t<td class=normalDate>',
    `\t\t\t\t\t\t<a href="${href}">`,
    `\t\t\t\t\t\t\t${date}`,
    '\t\t\t\t\t\t</a>',
    '\t\t\t\t\t</td>',
  ].join('\n');
}

/**
 * The bar as IIS renders it (`ShowBar.asp:74-162`).
 *
 * `pageOrder` is deliberately not the answer order: the loop at `:85-108` walks
 * the folders as the filesystem hands them over, and `:87` marks whichever one
 * comes first when `Selected` is empty — which is how the real page behaves and
 * why the gateway sorts rather than trusting the page.
 */
function barPage(pageOrder: string[]): string {
  const cells = pageOrder.map((folder, i) => {
    const date = MOCK_ISSUES.find(iss => iss.folder === folder)?.date ?? folder;
    return i === 0 ? selectedCell(folder, date) : normalCell(folder, date);
  });

  return [
    '<html>',
    '\t<head>',
    '\t\t<link rel="stylesheet" type="text/css" href="NewsBar.css">',
    '\t\t<script language="JavaScript">',
    '\t\t\tvar selected = "";',                                  // :48 — no folder
    '\t\t</script>',
    '\t</head>',
    '\t<body onLoad="onPageLoad()">',
    '\t\t<table width="100%">',
    '\t\t\t<tr>',
    '\t\t\t\t<td width="100%" align="center">',
    '\t\t\t\t<table>',
    '\t\t\t\t<tr>',
    ...cells,
    '\t\t\t\t</tr>',
    '\t\t\t\t</table>',
    '\t\t\t\t</td>',
    '\t\t\t\t<td class=button onClick="onBoardBtnClick()">',     // :117-125
    '\t\t\t\t\t<nobr>&nbsp;READ COLUMNS&nbsp;</nobr>',
    '\t\t\t\t</td>',
    '\t\t\t\t<td class=button onClick="onNewsBtnClick()">',      // :132-140
    '\t\t\t\t\t<nobr>&nbsp;READ NEWS&nbsp;</nobr>',
    '\t\t\t\t</td>',
    '\t\t\t\t<td class=button onClick="onBtnClick()">CLOSE</td>',
    '\t\t\t</tr>',
    '\t\t</table>',
    '\t</body>',
    '</html>',
  ].join('\n');
}

/** One story of a layout frame — `domesticwars.story:5-9`, byline as `:15-17`. */
function story(headline: string, byline: string, body: string): string {
  return [
    '\t\t\t\t\t\t\t<h2>',                                        // `LayoutImp` = frame name
    `\t\t\t\t\t\t\t\t${headline}`,
    '\t\t\t\t\t\t\t</h2>',
    ...(byline === '' ? [] : [
      '\t\t\t\t\t\t\t<div class=author>',
      `\t\t\t\t\t\t\t\tby ${byline}`,
      '\t\t\t\t\t\t\t</div>',
    ]),
    '\t\t\t\t\t\t\t<div class=articleBody>',
    `\t\t\t\t\t\t\t\t${body}`,
    '\t\t\t\t\t\t\t</div>',
  ].join('\n');
}

/**
 * One issue's `home.asp`, after IIS has run it: `News.pas:750-759` wraps the
 * style header and the layout, `:797-802` closes the document.
 */
function issuePage(folder: string): string {
  const headline = HEADLINES[folder];
  return [
    '<html>',
    '\t<head>',
    '\t\t<link rel="stylesheet" type="text/css" href="../../../../styles/standard/standard.css">',
    '\t</head>',
    '\t<body>',
    // `standard.header:7-19` — town, paper, date.
    '\t\t<table width=100%>',
    '\t\t\t<tr>',
    '\t\t\t\t<td valign="bottom">',
    '\t\t\t\t\t<table width="100%" cellpadding=3>',
    '\t\t\t\t\t\t<tr>',
    '\t\t\t\t\t\t\t<td width=150>',
    '\t\t\t\t\t\t\t\t<div class=townName>',
    '\t\t\t\t\t\t\t\t\tShamba',
    '\t\t\t\t\t\t\t\t</div>',
    '\t\t\t\t\t\t\t</td>',
    '\t\t\t\t\t\t\t<td>',
    '\t\t\t\t\t\t\t\t<div class=title>',
    `\t\t\t\t\t\t\t\t\t${MOCK_PAPER_NAME}`,
    '\t\t\t\t\t\t\t\t</div>',
    '\t\t\t\t\t\t\t</td>',
    '\t\t\t\t\t\t\t<td width=150>',
    '\t\t\t\t\t\t\t\t<div class=date align="right" valign="bottom">',
    `\t\t\t\t\t\t\t\t\t${LONG_DATES[folder]}`,
    '\t\t\t\t\t\t\t\t</div>',
    '\t\t\t\t\t\t\t</td>',
    '\t\t\t\t\t\t</tr>',
    '\t\t\t\t\t</table>',
    '\t\t\t\t</td>',
    '\t\t\t</tr>',
    '\t\t</table>',
    // `Layouts/1.layout` — one story per frame.
    '\t\t<table cellpadding=3>',
    '\t\t\t<tr>',
    '\t\t\t\t<td valign="top">',
    story(headline, '', 'One person died and two were severely wounded last night.<br>The police are investigating.'),
    '\t\t\t\t</td>',
    '\t\t\t\t<td valign="top">',
    story('Renaissance art in Shamba', 'Marco Ferrari', 'The movable collection of the IFEL museum was presented last weekend.'),
    '\t\t\t\t</td>',
    '\t\t\t</tr>',
    '\t\t</table>',
    '\t\t<div class=footer>Starpeace Online</div>',              // standard.footer
    '\t</body>',
    '</html>',
  ].join('\n');
}

/** One `<tr>` of the Media listing (`Newspapers.asp:12-24`). */
function newspaperRow(paper: NewspaperListing, idx: number): string {
  const dirHref =
    `../../news/newsreader.asp?RIWS=&Tycoon={{username}}&WorldName={{worldName}}`
    + `&TownName=${paper.townName}&PaperName=${encodeURIComponent(paper.paperName)}`
    + `&DAAddr=127.0.0.1&DAPort=7001&frame_Id=NewsView&frame_Class=HTMLView`
    + `&frame_Align=client&frame_NoBorder=yes::local.asp?frame_Id=DirectoryView&frame_Close=yes`;
  return [
    `\t\t\t\t<tr onMouseOver="onItemMouseOver()" onMouseOut="onItemMouseOut()"`,
    `\t\t\t\t\tonClick="onItemMouseClick()" dirHref="${dirHref}" textId="text_${idx}">`,
    `\t\t\t\t\t<td width="*" style="padding-left: 15px">`,
    `\t\t\t\t\t\t<div id=text_${idx} class=listItem>${paper.paperName}&nbsp;</div>`,
    '\t\t\t\t\t</td>',
    '\t\t\t\t</tr>',
    '\t\t\t\t<tr><td class=gradient></td></tr>',
  ].join('\n');
}

/** `New Directory/Newspapers.asp:40-64` as IIS emits it. `papers: []` is the world with no papers. */
function newspapersPage(papers: NewspaperListing[]): string {
  return [
    '<html>',
    '\t<body>',
    '\t\t<div class=header2>Media</div>',                        // strMedia, New Directory.lng:14
    '\t\t<table>',
    ...papers.map((paper, idx) => newspaperRow(paper, idx)),
    '\t\t</table>',
    '\t</body>',
    '</html>',
  ].join('\n');
}

/**
 * Put the SECOND folder first, so the page never arrives in the order the
 * gateway must answer in — and the selected cell (`:87`, the first one) is not
 * the newest issue either, which is the case a test would otherwise miss.
 */
function pageOrderOf(folders: string[]): string[] {
  if (folders.length < 2) return [...folders];
  return [folders[1], folders[0], ...folders.slice(2)];
}

function buildHttpExchanges(folders: string[], papers: NewspaperListing[]): HttpExchange[] {
  const exchanges: HttpExchange[] = [
    {
      id: 'newspaper-http-bar',
      method: 'GET',
      urlPattern: `${NEWS_PATH}/showbar.asp`,
      queryPatterns: { WorldName: '{{worldName}}', PaperName: MOCK_PAPER_NAME },
      status: 200,
      contentType: 'text/html',
      body: barPage(pageOrderOf(folders)),
    },
    {
      id: 'newspaper-http-directory',
      method: 'GET',
      urlPattern: `${DIRECTORY_PATH}/Newspapers.asp`,
      queryPatterns: { WorldName: '{{worldName}}' },
      status: 200,
      contentType: 'text/html',
      body: newspapersPage(papers),
    },
  ];

  for (const folder of folders) {
    // `ShowPaper.asp:30-31` percent-encodes the path, so `@` arrives as `%40`
    // and the space of "Shamba Daily" as `%20`. `HttpMock.pathMatches`
    // lowercases both sides and does not decode, so the pattern carries the
    // escapes too.
    const path = `Newspapers/{{worldName}}/${encodeURIComponent(MOCK_PAPER_NAME)}`
      + `/${encodeURIComponent(folder)}/home.asp`;
    exchanges.push({
      id: `newspaper-http-issue-${folder}`,
      method: 'GET',
      urlPattern: `${NEWS_PATH}/${path}`,
      status: 200,
      contentType: 'text/html',
      body: issuePage(folder),
    });
  }

  // Last, so it only catches a folder none of the exchanges above claimed.
  exchanges.push({
    id: 'newspaper-http-issue-unknown',
    method: 'GET',
    urlPattern: `${NEWS_PATH}/Newspapers/*/*/*/home.asp`,
    status: 404,
    contentType: 'text/html',
    body: '<html><body>404 - File not found</body></html>',
  });

  return exchanges;
}

/**
 * @param opts.issues Which folders the paper keeps. `[]` is the legitimate
 *   "no issue printed yet" paper — an empty bar, which `ShowPaper.asp:10-24`
 *   answers with the connecting page rather than an empty frame.
 * @param opts.papers Which papers the directory's Media listing carries.
 *   `[]` is a world with no newspapers.
 */
export function createNewspaperScenario(
  overrides?: Partial<ScenarioVariables>,
  opts: { issues?: string[]; papers?: NewspaperListing[] } = {},
): { http: HttpScenario } {
  const vars = mergeVariables(overrides);
  const folders = opts.issues ?? MOCK_ISSUE_FOLDERS;
  const papers = opts.papers ?? MOCK_DIRECTORY_PAPERS;

  return {
    http: {
      name: 'newspaper',
      exchanges: buildHttpExchanges(folders, papers),
      variables: vars as unknown as Record<string, string>,
    },
  };
}
