/// <reference path="../__tests__/matchers/rdo-matchers.d.ts" />

/**
 * politics-handler — three ASP scrapes (popular / IFEL / tycoons ratings,
 * tycoonCampaign.asp) around a handful of RDO members:
 *   - `procedure RDOVote(voterTycoon, choiceTycoon : widestring)` —
 *     Kernel/TownPolitics.pas:46 — a PROCEDURE, so fire-and-forget `"*"` on the
 *     construction socket with NO QueryId is the safe form (the mission notes
 *     name `RDOVoteOf`, :47, which is the getter; the handler emits `RDOVote`);
 *   - `FindSuppliers` / `FindClients` on the cacher (map socket), function.
 *
 * The three pure parsers were already covered here; the sections after them
 * drive every exported entry point through `makeSessionCtx` and a mocked
 * `node-fetch`. `searchConnections` argument bytes are pinned by
 * `__tests__/rdo/rdo-callsite-wire-format.test.ts:112+`; only the branches it
 * leaves open are added.
 */

jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import {
  parsePoliticsRatings,
  parsePublicityRows,
  parsePublicityAds,
  parseCampaignProjects,
  parseCampaignPromise,
  parseCampaignState,
  parseCampaignResponse,
  getDefaultPoliticsData,
  getPoliticsData,
  politicsVote,
  politicsLaunchCampaign,
  politicsCancelCampaign,
  politicsSetRating,
  politicsSetPublicity,
  politicsSetProjectData,
  searchConnections,
  holdsOffice,
} from './politics-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '../__tests__/session/fake-session-context';
import type { SessionContext } from './session-context';
import type { RdoPacket, WorldInfo } from '../../shared/types';
import { RdoValue, RdoCommand } from '../../shared/rdo-types';
import { RdoVerb, RdoAction } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';

const mockFetch = fetch as unknown as jest.MockedFunction<
  (url: string, init?: unknown) => Promise<Response>
>;

function htmlResponse(body: string, status = 200): Response {
  return { status, ok: status === 200, text: async () => body } as unknown as Response;
}

const WORLD: WorldInfo = { name: 'Shamba', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 7000 };
// §4bis: distinct from every context id and every coordinate.
const TEMP_OBJ = '7734';
const CURR_BLOCK = '40133601';

type CacherListAt = jest.MockedFunction<SessionContext['getCacherPropertyListAt']>;
function propsAt(fake: FakeSessionCtx): CacherListAt {
  return fake.ctx.getCacherPropertyListAt as CacherListAt;
}

function makeWebCtx(overrides: Partial<SessionContext> = {}): FakeSessionCtx {
  return makeSessionCtx({
    currentWorldInfo: WORLD, activeUsername: 'SPO_test3', cachedPassword: 'test3',
    daAddr: '10.0.0.5', daPort: 1111, ...overrides,
  });
}

/** Query string of the n-th fetch call, decoded. */
function queryOf(n: number): URLSearchParams {
  const url = mockFetch.mock.calls[n][0];
  return new URLSearchParams(url.substring(url.indexOf('?') + 1));
}

beforeEach(() => {
  mockFetch.mockReset();
});

// =============================================================================
// ASP FIXTURES — instantiated from the pages in
// C:\Users\Robin Aleman\Documents\SPO\IIS_ROOT\Five\0\Visual\Voyager\Politics,
// NOT from the parsers. Tabs, unquoted attributes and blank conditional lines
// are the source's own: a `<% … %>` line emits only the literal text that
// surrounds it, which is why so many lines are a lone tab.
//
// The four language strings come from `Five/0/language/ePolitics.lng` (cited
// per use), resolved through the `#include` at `tycooncampaign.asp:1`.
// =============================================================================

/**
 * `popularratings.asp:54-86` with N rows.
 *
 * `ifelratings.asp:52-84` is byte-identical but for the property it interpolates
 * (`CacheObj.IFELRating` at `:69` instead of `CacheObj.PeopleRating` at `:71`),
 * so one builder covers both. `rating` is the raw text the page interpolates —
 * pass `''` to model a property that renders empty.
 */
function ratingsPage(rows: Array<[name: string, rating: string]>): string {
  const body = rows.map(([name, rating]) => [
    '\t\t<tr style="margin-top: 2px">',           // :66
    '\t\t\t<td class=label>',                     // :67
    `\t\t\t\t${name}`,                            // :68
    '\t\t\t</td>',                                // :69
    '\t\t\t<td class=value align="right">',       // :70
    `\t\t\t\t${rating}%`,                         // :71
    '\t\t\t</td>',                                // :72
    '\t\t</tr>',                                  // :73
    '\t\t<tr>',                                   // :74 — 1px separator row
    '\t\t\t<td height="1" colspan=2 bgcolor=#244843>',
    '\t\t\t</td>',
    '\t\t</tr>',                                  // :77
  ].join('\n')).join('\n');

  return [
    '<body style="background-color: #143833; margin: 10px; padding: 0px">',  // :54
    '',
    '\t<table cellpadding=0 cellspacing=0 width="100%">',                    // :56
    '\t',
    body,
    '\t',
    '\t</table>',                                                            // :84
    '',
    '<body>',                                                                // :86 — the source really does re-open it
  ].join('\n');
}

/**
 * `tycoonratings.asp:123-194` with N rows, `IsMayor` = true (hardcoded at `:25`,
 * the real test is commented out at `:24`).
 *
 * The shape the old parser could not read: `class=label` is followed by three
 * event handlers on separate lines instead of an immediate `>` (`:136-139`), and
 * the value is `<span id=Value_<Id>>` nested two levels deep inside the value
 * cell (`:146-148`), next to an opinion `<select>` whose options are percentages
 * as well (`:153-159`).
 */
function tycoonRatingsPage(rows: Array<{ id: string; name: string; rating: string }>): string {
  const body = rows.map(({ id, name, rating }) => {
    const bucket = 25 * Math.floor((parseInt(rating, 10) || 0) / 25);   // :152
    const options = [100, 75, 50, 25, 0].map(v =>
      `\t\t\t\t\t\t<option value="${v}" ${v === bucket ? 'selected' : ''}>${v}%`).join('\n');
    return [
      `\t\t<tr style="margin-top: 2px" id=${id}>`,                      // :135
      '\t\t\t<td class=label',                                          // :136
      '\t\t\t\tOnMouseOver="onRowMouseOver()"',
      '\t\t\t\tOnMouseOut="onRowMouseOut()"',
      '\t\t\t\tonClick="onRowMouseClick()">',                           // :139
      `\t\t\t\t${name}`,                                                // :140
      '\t\t\t</td>',
      '\t\t\t<td class=value align="right"',                            // :142
      '\t\t\t\tOnMouseOver="onRowMouseOver()"',
      '\t\t\t\tOnMouseOut="onRowMouseOut()"',
      '\t\t\t\tOnClick="onRowMouseClick()">',                           // :145
      `\t\t\t\t<div id=LabelDiv_${id} class=value>`,                    // :146
      `\t\t\t\t\t<span id=Value_${id}>${rating}%</span>`,               // :147
      '\t\t\t\t</div>',
      `\t\t\t\t<div id=OpinionDiv_${id} `,                              // :149
      '\t\t\t\t\tclass=value ',
      '\t\t\t\t\tstyle="text-align: right; margin: 0px; display: none; font-size: 10px">',
      '\t\t\t\t\t',
      `\t\t\t\t\t<select name=Opinion_${id} OnChange="onOpinionChange()" ratingId="${id}">`,
      options,
      '\t\t\t\t\t</select>',                                            // :159
      '\t\t\t\t</div>',
      '\t\t\t</td>',
      '\t\t</tr>',                                                      // :162
      '\t\t<tr>',                                                       // :163
      '\t\t\t<td height="1" colspan=2 bgcolor=#244843>',
      '\t\t\t</td>',
      '\t\t</tr>',
    ].join('\n');
  }).join('\n');

  return [
    '<body style="background-color: #143833; margin-left: 10px; margin-top: 10px; padding: 0px">',
    '',
    '\t<table cellpadding=0 cellspacing=0 width="100%">',               // :125
    '\t',
    body,
    '\t',
    '\t',
    '\t\t<tr>',                                                         // :181 — the IsMayor note
    '\t\t\t<td colspan=2 class=label align="left" style="font-size: 10px; padding-top: 5px">',
    '\t\t\t\t<span id=comment>',
    // StrTycoonRatings_3 — ePolitics.lng:52
    "\t\t\t\t  Note: Visit the local newspaper's forum to set your ratings for this politician.",
    '\t\t\t\t</span>',
    '\t\t\t</td>',
    '\t\t</tr>',                                                        // :187
    '\t',
    '\t</table>',
    '\t',
    '<iframe id=hiddenFrame style="display: none">',
    '</iframe>',
    '',
    '<body>',
  ].join('\n');
}

/**
 * `mayorpub.asp:139-205` with N rows.
 *
 * Same two-cell row as the ratings tables, but the visible text is a localised
 * label (`:180-190`, `StrMayorPub_5..9`) and only the `<select>`'s selected
 * option carries the 0/25/50/75/100 the server accepts back (`:187-191`).
 * `ads` is `Obj.Ads`, interpolated into `StrMayorPub_4` at `:143`.
 */
const PUBLICITY_LABELS: Record<number, string> = {
  100: 'Highest', 75: 'High', 50: 'Normal', 25: 'Low', 0: 'Lowest',   // ePolitics.lng:8-12
};

function publicityPage(
  rows: Array<{ id: string; name: string; publicity: number }>, ads = '0'
): string {
  const body = rows.map(({ id, name, publicity }) => {
    const bucket = 25 * Math.floor(publicity / 25);                   // :180
    const options = [100, 75, 50, 25, 0].map(v =>
      `\t\t\t\t\t\t<option value="${v}" ${v === bucket ? 'selected' : ''}>${PUBLICITY_LABELS[v]}`).join('\n');
    return [
      `\t\t<tr style="margin-top: 2px" id=${id}>`,                    // :158
      '\t\t\t<td class=label',                                        // :159
      '\t\t\t\tOnMouseOver="onRowMouseOver()"',
      '\t\t\t\tOnMouseOut="onRowMouseOut()"',
      '\t\t\t\tonClick="onRowMouseClick()">',
      `\t\t\t\t${name}`,                                              // :163
      '\t\t\t</td>',
      '\t\t\t<td class=value align="right"',                          // :165
      '\t\t\t\tOnMouseOver="onRowMouseOver()"',
      '\t\t\t\tOnMouseOut="onRowMouseOut()"',
      '\t\t\t\tOnClick="onRowMouseClick()">',
      `\t\t\t\t<div id=LabelDiv_${id} class=value>`,                  // :169
      `\t\t\t\t\t<span id=Value_${id}>`,
      `\t\t\t\t ${PUBLICITY_LABELS[bucket]} `,                        // :182-186
      '\t\t\t\t\t</span>',
      '\t\t\t\t</div>',
      `\t\t\t\t<div id=OpinionDiv_${id} class=value style="text-align: right; margin: 0px; display: none; font-size: 10px">`,
      `\t\t\t\t\t<select name=Opinion_${id} OnChange="onOpinionChange()" ratingId="${id}">`,
      options,
      '\t\t\t\t\t</select>',
      '\t\t\t\t</div>',
      '\t\t\t</td>',
      '\t\t</tr>',
      '\t\t<tr>',                                                     // :195 — 1px separator
      '\t\t\t<td height="1" colspan=2 bgcolor=#244843>',
      '\t\t\t</td>',
      '\t\t</tr>',
    ].join('\n');
  }).join('\n');

  return [
    '<body style="background-color: #143833; margin-left: 10px; margin-right: 10px; margin-top: 10px; padding: 0px">',
    '',
    '',
    '\t<div class=label style="margin-top: 10px">',                   // :142
    // StrMayorPub_4 — ePolitics.lng:7, %1 replaced at :143
    `\t\tCurrently purchasing <span class=value>${ads}</span> hits/hour of publicity.`,
    '\t</div>',
    '',
    '\t<table cellpadding=0 cellspacing=0 width="100%" style="margin-top: 10px">',
    '\t',
    body,
    '\t',
    '\t</table>',
    '',
    '<iframe id=hiddenFrame style="display: none">',
    '</iframe>',
    '',
    '<body>',
  ].join('\n');
}

/** One project row of `tycooncampaign.asp:252-315`, either shape. */
type ProjectFixture =
  | { id: string; name: string; type: 'Minister'; minister?: string; state?: 1 | 2 | 3 }
  | { id: string; name: string; type: string; comparator: string; value: number };

const PROPOSAL_IMG: Record<number, string> = { 1: 'unknown', 2: 'invalid', 3: 'ok' };  // :275-281

function projectRows(projects: ProjectFixture[]): string {
  return projects.map((p) => {
    const cell = p.type === 'Minister'
      ? [
        `\t\t\t\t\t\t\t<div id=LabelDiv_${p.id} class=value>`,        // :270
        `\t\t\t\t\t\t\t\t<span id=Value_${p.id}>`,
        // :272-274 — the name, or `strNone` when none is proposed
        `\t\t\t\t\t\t\t\t${'minister' in p && p.minister ? p.minister : 'None'}`,
        ...('state' in p && p.state
          // :276-281 — the icon the server picks from ProposalState
          ? [`\t\t\t\t\t\t\t\t\t<img src="images/${PROPOSAL_IMG[p.state]}.jpg" width=14 height=14 title="…">`]
          : ['\t\t\t\t\t\t\t\t\t<!-- Player: -->']),
        '\t\t\t\t\t\t\t\t</span>',
        '\t\t\t\t\t\t\t</div>',
        `\t\t\t\t\t\t\t<div id=OpinionDiv_${p.id} class=value style="text-align: right; margin: 0px; display: none; font-size: 10px">`,
        `\t\t\t\t\t\t\t\t<input size=15 name=Opinion_${p.id} OnChange="onOpinionChange()" projectId="${p.id}" value="${'minister' in p && p.minister ? p.minister : ''}">`,   // :287
        '\t\t\t\t\t\t\t</div>',
      ]
      : [
        `\t\t\t\t\t\t\t<div id=LabelDiv_${p.id} class=value>`,        // :293
        // :295-299 — strMoreThan / strLessThan, then the exact value
        `\t\t\t\t\t\t\t${'comparator' in p ? p.comparator : ''}`,
        `\t\t\t\t\t\t\t\t<span id=Value_${p.id}>${'value' in p ? p.value : ''}</span>%`,   // :300
        '\t\t\t\t\t\t\t</div>',
        `\t\t\t\t\t\t\t<div id=OpinionDiv_${p.id} class=value style="text-align: right; margin: 0px; display: none; font-size: 10px">`,
        // :302 quantises the SELECT to steps of 10 — the span above does not.
        `\t\t\t\t\t\t\t\t<select name=Opinion_${p.id} OnChange="onOpinionChange()" projectId="${p.id}">`,
        ...[100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0].map(v =>
          `\t\t\t\t\t\t\t\t\t<option value="${v}" ${'value' in p && v === 10 * Math.floor(p.value / 10) ? 'selected' : ''}>${v}%`),
        '\t\t\t\t\t\t\t\t</select>',
        '\t\t\t\t\t\t\t</div>',
      ];
    return [
      `\t\t\t<tr style="margin-top: 2px" id=${p.id}>`,                // :252
      '\t\t\t\t\t<td class=label',                                   // :253
      '\t\t\t\t\t\tOnMouseOver="onRowMouseOver()"',
      '\t\t\t\t\t\tOnMouseOut="onRowMouseOut()"',
      '\t\t\t\t\t\tonClick="onRowMouseClick()">',
      `\t\t\t\t\t\t${p.name}`,                                       // :257
      '\t\t\t\t\t</td>',
      '\t\t\t\t\t<td class=value align="right"',                     // :259
      `\t\t\t\t\t\tTypeId="${p.type}"`,                              // :260
      '\t\t\t\t\t\tOnMouseOver="onRowMouseOver()"',
      '\t\t\t\t\t\tOnMouseOut="onRowMouseOut()"',
      '\t\t\t\t\t\tOnClick="onRowMouseClick()">',
      ...cell,
      '\t\t\t\t\t</td>',
      '\t\t\t\t</tr>',
      '\t\t\t\t<tr>',                                                // :318 — 1px separator
      '\t\t\t\t\t<td height="1" colspan=2 bgcolor=#244843>',
      '\t\t\t\t\t</td>',
      '\t\t\t\t</tr>',
    ].join('\n');
  }).join('\n');
}

/**
 * `tycooncampaign.asp:220-419`. `view` selects which of the four mutually
 * exclusive render branches the server took:
 *
 *   'running' — `:224` `CacheObjectValid`: the campaign exists. Only this branch
 *               emits the `Cancel=TRUE` button (`:233`).
 *   'invite'  — `:362`: no campaign. Only this branch emits `Launch=TRUE` (`:380`).
 *   'ruler'   — `:390`: `IsMayor`, computed at `:98`.
 *   'silent'  — `:399`: `not FullAccess` OR `LaunchError <> 0`. The inner
 *               `if FullAccess` (`:401`) plus a `select case` with no `case else`
 *               (`:402-411`) is what makes this div empty for a wrong password
 *               and for any code outside {100, 101, 102}.
 */
function campaignPage(opts: {
  view: 'running' | 'invite' | 'ruler' | 'silent';
  capitol?: boolean;
  launchError?: 100 | 101 | 102;
  town?: string;
  /** `:241-350` — rendered only on the `running` branch, like the real page. */
  projects?: ProjectFixture[];
  /** `:365-371` — the campaign promise textarea, same branch. */
  promise?: string;
}): string {
  const { view, capitol = false, launchError, town = 'New Town', projects = [], promise } = opts;
  const q = (extra: string) =>
    `tycooncampaign.asp?WorldName=Shamba&TownName=${town}&TycoonName=SPO_test3&Password=test3` +
    `&DAAddr=10.0.0.5&DAPort=1111${extra}&x=${capitol ? '118' : ''}&y=${capitol ? '226' : ''}` +
    `&Capitol=${capitol ? 'YES' : ''}&Recache=YES`;
  const threshold = capitol ? '1000' : '200';

  let block: string[];
  if (view === 'running') {
    block = [
      '\t', '\t\t',
      '\t\t<table style="margin-bottom: 10px">',                       // :225
      '\t\t\t<tr>',
      '\t\t\t\t<td class=button align="left" width="100" style="padding-left: 5px; padding-right: 5px"',
      '\t\t\t\t\tonMouseOver="onMouseOverFrame()"',
      '\t\t\t\t\tonMouseOut="onMouseOutFrame()"',
      '\t\t\t\t\tonMouseUp="onMouseUp()"',
      '\t\t\t\t\tonMouseDown="onMouseDown()"',
      '\t\t\t\t\tonClick="onBtnClick()"',
      `\t\t\t\t\tinfo="${q('&Cancel=TRUE')}"`,                         // :233
      '\t\t\t\t\tnormColor="#345950"',
      '\t\t\t\t\thiColor="white">',
      '',
      '\t\t\t\t\t<nobr>Withdraw Campaign</nobr>',                      // :237, StrCo0nCampaign_1
      '\t\t\t\t</td>',
      '\t\t\t</tr>',
      '\t\t</table>',
      '\t\t<table cellpadding=0 cellspacing=0 width="100%">',          // :241
      '\t\t',
      ...(projects.length > 0 ? [projectRows(projects)] : []),
      '\t\t',
      '\t\t</table>',                                                  // :350
      '\t\t',
      ...(promise === undefined ? [] : [
        '\t\t\t<div>',                                                 // :365
        `\t\t\t\t<textarea cols=49 rows=7 ID=Textarea1>${promise}</textarea>`,   // :366
        '\t\t\t</div>',
      ]),
    ];
  } else if (view === 'invite') {
    block = [
      '\t', '\t\t', '',
      '\t\t\t<div class=label style="margin: 30px; text-align: center">',   // :364
      '',
      '\t\t\t\t',
      // StrCo0nCampaign_6 — ePolitics.lng:43, %1 replaced at :367 / :369
      '\t\t\t\tYou are not participating in the coming elections. Click on the button below to launch ' +
        `your political campaign. To be accepted, your prestige should be higher than ${threshold} points.`,
      '\t\t\t\t',
      '',
      '\t\t\t\t<table style="margin-top: 20px">',                      // :372
      '\t\t\t\t\t<tr>',
      '\t\t\t\t\t\t<td class=button align="left" width="100"',
      '\t\t\t\t\t\t\tonMouseOver="onMouseOverFrame()"',
      '\t\t\t\t\t\t\tonMouseOut="onMouseOutFrame()"',
      '\t\t\t\t\t\t\tonMouseUp="onMouseUp()"',
      '\t\t\t\t\t\t\tonMouseDown="onMouseDown()"',
      '\t\t\t\t\t\t\tonClick="onBtnClick()"',
      `\t\t\t\t\t\t\tinfo="${q('&Launch=TRUE')}"`,                     // :380
      '\t\t\t\t\t\t\tnormColor="#345950"',
      '\t\t\t\t\t\t\thiColor="white">',
      '',
      '\t\t\t\t\t\t\tLaunch Campaign',                                 // :384, StrCo0nCampaign_7
      '\t\t\t\t\t\t</td>',
      '\t\t\t\t\t</tr>',
      '\t\t\t\t</table>',
      '\t\t\t</div>',                                                  // :388
      '\t\t',
    ];
  } else if (view === 'ruler') {
    block = [
      '\t',
      '\t\t<div class=label style="margin: 30px; text-align: center">',     // :391
      '\t\t  ',
      // StrCo0nCampaign_8 — ePolitics.lng:45; %1 = strMayorOfThisCity / strPresident (:66-67)
      `\t\t  You are the ${capitol ? 'President' : 'Mayor'}. You cannot have a campaign.`,
      '\t\t  ',
      '\t\t</div>',                                                    // :397
      '\t',
    ];
  } else {
    // ePolitics.lng:46-48, rendered at :403 / :406 / :408 / :410.
    const reason = launchError === 100
      ? '\t\t\t Your application has been denied. Our records show that you already have a public commitment.'
      : launchError === 101
        ? `   \t\t\tSorry, you don't fulfill the requisites for having your own campaign. Your prestige should be higher than ${threshold} points.`
        : launchError === 102
          ? '\t\t\t It is too late to launch a campaign. Campaigns can only be started during the first half of the political period..'
          : null;
    block = [
      '\t<div class=label style="margin: 30px; text-align: center">',   // :400
      '\t\t',
      ...(reason === null ? [] : ['\t\t\t', reason]),
      '\t\t',
      '\t</div>',                                                      // :413
    ];
  }

  return [
    '<body style="background-color: #143833; margin: 10px; padding: 0px">',  // :220
    '',
    ...block,
    '',
    '<iframe id=hiddenFrame style="display:none;">',                   // :416
    '</iframe>',
    '',
    '<body>',
  ].join('\n');
}

// =============================================================================
// parsePoliticsRatings
// =============================================================================
describe('parsePoliticsRatings', () => {
  it('reads the two-cell rows of popularratings.asp and ignores the 1px separators', () => {
    expect(parsePoliticsRatings(ratingsPage([['Unemployment', '85'], ['Public Services', '62']]))).toEqual([
      { name: 'Unemployment', value: 85 },
      { name: 'Public Services', value: 62 },
    ]);
  });

  it('reads ifelratings.asp, whose rows differ only by the interpolated property', () => {
    // ifelratings.asp:64-71 vs popularratings.asp:66-73 — same markup.
    expect(parsePoliticsRatings(ratingsPage([['IFEL Rating', '40']]))).toEqual([
      { name: 'IFEL Rating', value: 40 },
    ]);
  });

  // B-4, second half. Regression guard: the old pattern demanded
  // `<td\s+class=label>` with an IMMEDIATE `>`, and tycoonratings.asp:136-139
  // hangs three event handlers off that cell. Not one row ever matched, so the
  // tab was structurally empty even once the 404 on the page name was fixed.
  it('reads tycoonratings.asp rows, whose label cell carries three event handlers', () => {
    const html = tycoonRatingsPage([
      { id: '1', name: 'Salary', rating: '42' },
      { id: '2', name: 'Taxes', rating: '75' },
    ]);
    expect(parsePoliticsRatings(html)).toEqual([
      { name: 'Salary', value: 42, id: '1' },
      { name: 'Taxes', value: 75, id: '2' },
    ]);
  });

  // tycoonratings.asp:153-159 puts an opinion dropdown in the SAME value cell,
  // and every one of its five options is a percentage.
  it('does not mistake an option of the opinion dropdown for the rating', () => {
    const [entry] = parsePoliticsRatings(tycoonRatingsPage([{ id: '9', name: 'Health', rating: '25' }]));
    expect(entry).toEqual({ name: 'Health', value: 25, id: '9' });
  });

  // tycoonratings.asp:181-187 — a `class=label` cell with no value cell beside it.
  it('does not turn the trailing note of tycoonratings.asp into a rating', () => {
    const names = parsePoliticsRatings(tycoonRatingsPage([{ id: '1', name: 'Salary', rating: '10' }]))
      .map(r => r.name);
    expect(names).toEqual(['Salary']);
  });

  // B-18. Regression guard: `[\s\S]*?` used to run across row boundaries, so a
  // value the server rendered empty paired label N with the value of row N+1 and
  // shifted every remaining row. Matching is row-scoped now.
  it('an empty value cell reads 0 and leaves the following rows on their own values', () => {
    const html = ratingsPage([['Crime', ''], ['Pollution', '31'], ['Health', '77']]);
    expect(parsePoliticsRatings(html)).toEqual([
      { name: 'Crime', value: 0 },
      { name: 'Pollution', value: 31 },
      { name: 'Health', value: 77 },
    ]);
  });

  it('an empty ratings folder yields an empty list — the table has no row at all', () => {
    // popularratings.asp:60 `if not Itr.Empty` — a missing Ratings\ folder is a
    // 200 with an empty table, not an error.
    expect(parsePoliticsRatings(ratingsPage([]))).toEqual([]);
  });

  it('returns an empty list for a page carrying no table', () => {
    expect(parsePoliticsRatings('<body>No data</body>')).toEqual([]);
  });

  it('keeps the decimals of a fractional rating', () => {
    expect(parsePoliticsRatings(ratingsPage([['Growth', '73.5']]))).toEqual([{ name: 'Growth', value: 73.5 }]);
  });

  it('keeps the sign of a negative rating', () => {
    expect(parsePoliticsRatings(ratingsPage([['Deficit', '-12']]))).toEqual([{ name: 'Deficit', value: -12 }]);
  });

  it('skips a row whose label cell renders empty', () => {
    expect(parsePoliticsRatings(ratingsPage([['', '50'], ['Real', '20']]))).toEqual([{ name: 'Real', value: 20 }]);
  });

  it('reads a value cell with no percent sign', () => {
    expect(parsePoliticsRatings('<tr><td class=label>Wealth</td><td class=value>90</td></tr>')).toEqual([
      { name: 'Wealth', value: 90 },
    ]);
  });

  it('a value cell holding only a dot is not a number and reads 0', () => {
    expect(parsePoliticsRatings('<tr><td class=label>Broken</td><td class=value>.%</td></tr>')).toEqual([
      { name: 'Broken', value: 0 },
    ]);
  });

  it('reads the last row of a response truncated before its closing </tr>', () => {
    const html = '<tr><td class=label>A</td><td class=value>1%</td></tr><tr><td class=label>B</td><td class=value>2%</td>';
    expect(parsePoliticsRatings(html)).toEqual([{ name: 'A', value: 1 }, { name: 'B', value: 2 }]);
  });

  it('ignores a cell whose class merely starts with label or value', () => {
    // The `(?![\w-])` boundary — `labelAccountLevel2` is a real class name on the
    // profit & loss page and must not be read as a rating label.
    const html = '<tr><td class=labelAccountLevel2>Flush</td><td class=valueBig>9%</td></tr>';
    expect(parsePoliticsRatings(html)).toEqual([]);
  });
});

// =============================================================================
// parseCampaignResponse — the state after is the oracle (audit B-5)
// =============================================================================
describe('parseCampaignResponse', () => {
  describe('Launch', () => {
    it('succeeds when the answer carries the Withdraw button — the campaign now exists', () => {
      // tycooncampaign.asp:224-233: only `CacheObjectValid` renders `Cancel=TRUE`,
      // and `:90` honours the `Recache=YES` we always send, so this response is
      // the state AFTER RDOLaunchCampaign, not a stale cache.
      expect(parseCampaignResponse(campaignPage({ view: 'running' }), 'Launch'))
        .toEqual({ success: true, message: 'Campaign launched' });
    });

    it('fails when the answer still invites the player to launch, quoting the page', () => {
      const r = parseCampaignResponse(campaignPage({ view: 'invite' }), 'Launch');
      expect(r.success).toBe(false);
      expect(r.message).toBe(
        'You are not participating in the coming elections. Click on the button below to launch ' +
        'your political campaign. To be accepted, your prestige should be higher than 200 points.'
      );
      // The button label lives in a <table> nested inside the same label div and
      // is not part of the sentence (:372).
      expect(r.message).not.toContain('Launch Campaign');
    });

    it('fails with the capitol threshold when Capitol=YES', () => {
      const r = parseCampaignResponse(campaignPage({ view: 'invite', capitol: true }), 'Launch');
      expect(r.message).toContain('higher than 1000 points');
    });

    it.each([
      [100, 'Your application has been denied. Our records show that you already have a public commitment.'],
      [101, "Sorry, you don't fulfill the requisites for having your own campaign. Your prestige should be higher than 200 points."],
      [102, 'It is too late to launch a campaign. Campaigns can only be started during the first half of the political period..'],
    ] as const)('reports the RDOLaunchCampaign code %i with the page\'s own wording', (code, text) => {
      // tycooncampaign.asp:402-411, ePolitics.lng:46-48. The codes are established
      // by source: `LaunchError = pxy_townHall.RDOLaunchCampaign(...)` at :59.
      expect(parseCampaignResponse(campaignPage({ view: 'silent', launchError: code }), 'Launch'))
        .toEqual({ success: false, message: text });
    });

    // Case ① of the audit: a wrong password makes FullAccess false (:48), the RDO
    // call is never issued (:50) and the inner `if FullAccess` (:401) leaves the
    // div empty. The old parser read "no denial div" as success.
    it('fails on the empty label div a wrong password produces', () => {
      expect(parseCampaignResponse(campaignPage({ view: 'silent' }), 'Launch')).toEqual({
        success: false,
        message: 'Campaign launch refused — the page published no reason',
      });
    });

    // Case ② — `select case LaunchError` has no `case else` (:402-411).
    it('fails on a LaunchError outside {100, 101, 102}, which renders nothing', () => {
      expect(parseCampaignResponse(campaignPage({ view: 'silent' }), 'Launch').success).toBe(false);
    });

    it('fails when the player already rules the town, quoting the page', () => {
      expect(parseCampaignResponse(campaignPage({ view: 'ruler' }), 'Launch')).toEqual({
        success: false,
        message: 'You are the Mayor. You cannot have a campaign.',
      });
    });

    it('names the president rather than the mayor on the capitol', () => {
      expect(parseCampaignResponse(campaignPage({ view: 'ruler', capitol: true }), 'Launch').message)
        .toBe('You are the President. You cannot have a campaign.');
    });
  });

  describe('Cancel', () => {
    // Case ③, the one that mattered: a SUCCESSFUL withdrawal invalidates the
    // campaign cache object (:91-96), so the page falls to :362 and shows the
    // launch invitation — a non-empty `<div class=label>`. The old parser called
    // the nominal path a failure. RDOCancelCampaign's own result is unusable:
    // `:76` calls it without assigning, unlike `:59`.
    it('succeeds when the answer carries the Launch button — the campaign is gone', () => {
      expect(parseCampaignResponse(campaignPage({ view: 'invite' }), 'Cancel'))
        .toEqual({ success: true, message: 'Campaign withdrawn' });
    });

    it('fails when the Withdraw button is still there — the campaign survived', () => {
      expect(parseCampaignResponse(campaignPage({ view: 'running' }), 'Cancel')).toEqual({
        success: false,
        message: 'Campaign withdrawal refused — the campaign is still running',
      });
    });

    it('fails on the empty label div a wrong password produces', () => {
      expect(parseCampaignResponse(campaignPage({ view: 'silent' }), 'Cancel')).toEqual({
        success: false,
        message: 'Campaign withdrawal refused — the page published no reason',
      });
    });

    it('fails with the page wording when the player already rules the town', () => {
      expect(parseCampaignResponse(campaignPage({ view: 'ruler' }), 'Cancel')).toEqual({
        success: false,
        message: 'You are the Mayor. You cannot have a campaign.',
      });
    });
  });

  it('a body with no label div and no button is a failure, not a success', () => {
    expect(parseCampaignResponse('<body></body>', 'Launch').success).toBe(false);
    expect(parseCampaignResponse('<body></body>', 'Cancel').success).toBe(false);
  });
});

// =============================================================================
// parsePublicityRows / parsePublicityAds — mayorpub.asp
// =============================================================================
describe('parsePublicityRows', () => {
  // `mayorpub.asp:180` quantises to 25 and `:182-190` prints a LOCALISED label,
  // so the visible text is unusable as a value. The selected option is not.
  it('reads the level off the selected option, not off the localised label', () => {
    expect(parsePublicityRows(publicityPage([
      { id: '10', name: 'Health', publicity: 75 },
      { id: '11', name: 'Taxes', publicity: 0 },
    ]))).toEqual([
      { id: '10', name: 'Health', level: 75 },
      { id: '11', name: 'Taxes', level: 0 },
    ]);
  });

  it('quantises the way the page does — an off-step value snaps down to its bucket', () => {
    // :180 `Value = 25*(CacheObj.RulerPublicity \ 25)` — 60 selects the 50 option.
    expect(parsePublicityRows(publicityPage([{ id: '1', name: 'Jails', publicity: 60 }])))
      .toEqual([{ id: '1', name: 'Jails', level: 50 }]);
  });

  // Without an id there is no `RatingId` to send back, so the row is a control
  // that cannot act. Shipping it would be a dead select.
  it('drops a row carrying no id', () => {
    const html = publicityPage([{ id: '5', name: 'Keep', publicity: 25 }])
      .replace('id=5', 'data-none=5');
    expect(parsePublicityRows(html)).toEqual([]);
  });

  it('reads no row from a page with no table', () => {
    expect(parsePublicityRows('<body>No data</body>')).toEqual([]);
  });

  it('an empty publicity folder yields an empty list', () => {
    expect(parsePublicityRows(publicityPage([]))).toEqual([]);
  });

  it('a row whose select carries no selected option reads 0', () => {
    const html = publicityPage([{ id: '3', name: 'Fire', publicity: 50 }]).replace(' selected', '');
    expect(parsePublicityRows(html)).toEqual([{ id: '3', name: 'Fire', level: 0 }]);
  });

  it('skips a row with an id but no label cell', () => {
    const html = publicityPage([{ id: '3', name: 'Fire', publicity: 50 }])
      .replace('<td class=label', '<td class=other');
    expect(parsePublicityRows(html)).toEqual([]);
  });

  it('skips a row whose label cell is empty', () => {
    expect(parsePublicityRows(publicityPage([{ id: '3', name: '', publicity: 50 }]))).toEqual([]);
  });
});

describe('parsePublicityAds', () => {
  it('reads the hits/hour sentence with its tags stripped', () => {
    expect(parsePublicityAds(publicityPage([], '4 500')))
      .toBe('Currently purchasing 4 500 hits/hour of publicity.');
  });

  it('returns an empty string when the page carries no label div', () => {
    expect(parsePublicityAds('<body><table></table></body>')).toBe('');
  });
});

// =============================================================================
// parseCampaignProjects / parseCampaignPromise — tycooncampaign.asp
// =============================================================================
describe('parseCampaignProjects', () => {
  const running = (projects: ProjectFixture[]) => campaignPage({ view: 'running', projects });

  it('reads a Minister row as a name plus its proposal state', () => {
    expect(parseCampaignProjects(running([
      { id: '11', name: 'Minister of Health', type: 'Minister', minister: 'Bob', state: 3 },
    ]))).toEqual([
      { id: '11', name: 'Minister of Health', kind: 'minister', ministerName: 'Bob', proposalState: 3 },
    ]);
  });

  // :275-281 — one icon per state, and none at all while the slot is a Player.
  it.each([
    [1 as const, 'unknown'],
    [2 as const, 'invalid'],
    [3 as const, 'ok'],
  ])('maps the %s.jpg icon to proposalState %s', (state, _img) => {
    const [row] = parseCampaignProjects(running([
      { id: '4', name: 'M', type: 'Minister', minister: 'X', state },
    ]));
    expect(row.proposalState).toBe(state);
  });

  it('a Minister slot with no proposal has neither a name nor a state', () => {
    expect(parseCampaignProjects(running([{ id: '4', name: 'M', type: 'Minister' }])))
      .toEqual([{ id: '4', name: 'M', kind: 'minister', ministerName: '' }]);
  });

  // The comparator is `strMoreThan` / `strLessThan` out of ePolitics.lng, so it
  // is localised and carried through verbatim rather than mapped to a boolean.
  it('reads a goal row as its comparator and its exact value', () => {
    expect(parseCampaignProjects(running([
      { id: '12', name: 'Unemployment', type: 'Goal', comparator: 'More than', value: 65 },
    ]))).toEqual([
      { id: '12', name: 'Unemployment', kind: 'goal', comparator: 'More than', value: 65 },
    ]);
  });

  // :302 quantises the SELECT to steps of 10; :300 prints the exact value. A
  // goal of 67 % must not be shown back to its own author as 60 %.
  it('takes the value from the span, not from the quantised select', () => {
    const [row] = parseCampaignProjects(running([
      { id: '12', name: 'Crime', type: 'Goal', comparator: 'Less than', value: 67 },
    ]));
    expect(row.value).toBe(67);
  });

  it('reads both row shapes from the same table, in page order', () => {
    expect(parseCampaignProjects(running([
      { id: '1', name: 'A', type: 'Goal', comparator: 'Less than', value: 10 },
      { id: '2', name: 'B', type: 'Minister', minister: 'Zoe', state: 1 },
    ])).map(p => p.id)).toEqual(['1', '2']);
  });

  // The projects table only exists on the `running` branch (:222-224), so every
  // other branch legitimately parses to none.
  it('finds no project on the launch invitation', () => {
    expect(parseCampaignProjects(campaignPage({ view: 'invite' }))).toEqual([]);
  });

  it('skips a row with no TypeId — the 1px separators and the note', () => {
    expect(parseCampaignProjects(running([]))).toEqual([]);
  });

  it('skips a row with a TypeId but no id attribute', () => {
    const html = running([{ id: '7', name: 'A', type: 'Goal', comparator: 'Less than', value: 1 }])
      .replace('id=7>', '>');
    expect(parseCampaignProjects(html)).toEqual([]);
  });

  it('skips a row whose label cell is empty', () => {
    expect(parseCampaignProjects(running([
      { id: '7', name: '', type: 'Goal', comparator: 'Less than', value: 1 },
    ]))).toEqual([]);
  });

  it('a goal row with no LabelDiv keeps its identity and reports no value', () => {
    const html = running([{ id: '7', name: 'A', type: 'Goal', comparator: 'Less than', value: 1 }])
      .replace('id=LabelDiv_7', 'id=Other_7');
    expect(parseCampaignProjects(html)).toEqual([{ id: '7', name: 'A', kind: 'goal' }]);
  });
});

describe('parseCampaignPromise', () => {
  it('reads the promise out of the textarea', () => {
    expect(parseCampaignPromise(campaignPage({ view: 'running', promise: 'Lower taxes.' })))
      .toBe('Lower taxes.');
  });

  it('returns an empty string when the page renders no textarea', () => {
    expect(parseCampaignPromise(campaignPage({ view: 'invite' }))).toBe('');
  });

  it('returns an empty string for an empty textarea', () => {
    expect(parseCampaignPromise(campaignPage({ view: 'running', promise: '' }))).toBe('');
  });
});

// =============================================================================
// parseCampaignState
// =============================================================================
describe('parseCampaignState', () => {
  it('the Cancel button — and only it — means the campaign is running', () => {
    expect(parseCampaignState(campaignPage({ view: 'running' }), false))
      .toEqual({ state: 'running', message: '' });
  });

  it('a running campaign stays `running` even for the office holder', () => {
    // `:222-224` cannot render this branch for a ruler, but the button is the
    // stronger signal either way and must not be overridden by the name check.
    expect(parseCampaignState(campaignPage({ view: 'running' }), true).state).toBe('running');
  });

  it('the Launch button means a campaign is available', () => {
    expect(parseCampaignState(campaignPage({ view: 'invite' }), false))
      .toEqual({ state: 'available', message: '' });
  });

  it('no button plus the office holder means `ruler`', () => {
    const { state, message } = parseCampaignState(campaignPage({ view: 'ruler' }), true);
    expect(state).toBe('ruler');
    expect(message).toContain('You cannot have a campaign');
  });

  it('no button and not the office holder means `refused`, with the published reason', () => {
    const { state, message } = parseCampaignState(campaignPage({ view: 'silent', launchError: 101 }), false);
    expect(state).toBe('refused');
    expect(message).toContain('Your prestige should be higher than 200 points');
  });

  // The two cases `tycooncampaign.asp` renders as an EMPTY label div: a wrong
  // password (`:48` `FullAccess` false, inner `if` at `:401` never fires) and a
  // `LaunchError` outside {100,101,102} (`:402-411` has no `case else`).
  it('a refusal the page gave no reason for still reports a reason', () => {
    const { state, message } = parseCampaignState(campaignPage({ view: 'silent' }), false);
    expect(state).toBe('refused');
    expect(message).toBe('The campaign page published no reason.');
  });
});

// =============================================================================
// politicsSetRating / politicsSetPublicity / politicsSetProjectData
//
// Three PROCEDUREs on the political entity — Kernel/TownPolitics.pas:40,41,45,
// Kernel/WorldPolitics.pas:256,257,260 — so all three go out fire-and-forget
// `"*"` with NO QueryId, bound to `TownHallId`.
// =============================================================================
describe('the three politics mutations', () => {
  const TOWN_HALL_ID = '90210';

  function makeMutationCtx(overrides: Partial<SessionContext> = {}): FakeSessionCtx {
    const fake = makeSessionCtx({ sockets: ['construction'], activeUsername: 'SPO_test3', ...overrides });
    propsAt(fake).mockResolvedValue([TOWN_HALL_ID, '']);
    return fake;
  }

  it('politicsSetRating writes RDOSetRatingFrom(ratingId, tycoon, value) on TownHallId', async () => {
    const fake = makeMutationCtx();

    const result = await politicsSetRating(fake.ctx, 118, 226, '4711', 70);

    expect(fake.ctx.connectConstructionService).toHaveBeenCalled();
    expect(propsAt(fake)).toHaveBeenCalledWith(118, 226, ['TownHallId', 'CurrBlock']);
    expect(fake.sent).toHaveLength(0);
    expect(fake.frames.construction).toEqual([
      RdoCommand.sel(TOWN_HALL_ID).call('RDOSetRatingFrom').push()
        .args(RdoValue.string('4711'), RdoValue.string('SPO_test3'), RdoValue.int(70)).build(),
    ]);
    expect(fake.frames.construction[0]).not.toContain('"^"');
    expect(result).toEqual({ success: true, message: '' });
  });

  it('politicsSetPublicity writes RDOSetPublicity(ratingId, value) on TownHallId', async () => {
    const fake = makeMutationCtx();

    const result = await politicsSetPublicity(fake.ctx, 1, 2, '4711', 25);

    expect(fake.frames.construction).toEqual([
      RdoCommand.sel(TOWN_HALL_ID).call('RDOSetPublicity').push()
        .args(RdoValue.string('4711'), RdoValue.int(25)).build(),
    ]);
    expect(result.success).toBe(true);
  });

  // `rdoModifyProject.asp:28` passes the control's value through as `CStr`
  // whichever control it was, so the minister name and the percentage share one
  // widestring parameter.
  it('politicsSetProjectData writes RDOSetProjectData(tycoon, projectId, data) on TownHallId', async () => {
    const fake = makeMutationCtx();

    const result = await politicsSetProjectData(fake.ctx, 1, 2, '88', 'Bob');

    expect(fake.frames.construction).toEqual([
      RdoCommand.sel(TOWN_HALL_ID).call('RDOSetProjectData').push()
        .args(RdoValue.string('SPO_test3'), RdoValue.string('88'), RdoValue.string('Bob')).build(),
    ]);
    expect(result.success).toBe(true);
  });

  it('a numeric project goal travels as a widestring, like the minister name', async () => {
    const fake = makeMutationCtx();
    await politicsSetProjectData(fake.ctx, 1, 2, '88', '70');
    expect(fake.frames.construction[0]).toContain(RdoValue.string('70').format());
  });

  it('falls back to cachedUsername for the rating author', async () => {
    const fake = makeMutationCtx({ activeUsername: null, cachedUsername: 'Cached' });
    await politicsSetRating(fake.ctx, 1, 2, '1', 50);
    expect(fake.frames.construction[0]).toContain(RdoValue.string('Cached').format());
  });

  it('with no username at all the author is empty rather than absent', async () => {
    const fake = makeMutationCtx({ activeUsername: null, cachedUsername: null });
    await politicsSetRating(fake.ctx, 1, 2, '1', 50);
    expect(fake.frames.construction[0]).toBe(
      RdoCommand.sel(TOWN_HALL_ID).call('RDOSetRatingFrom').push()
        .args(RdoValue.string('1'), RdoValue.string(''), RdoValue.int(50)).build(),
    );
  });

  // Binding to object 0 builds a request with no destination. Refusing to emit
  // is the whole point of reading TownHallId first.
  // A Town Hall facility publishes no `TownHallId` at all — that one is on the
  // TOWN FOLDER object (Kernel/PoliticsCache.pas:156). `CurrBlock` is the same
  // number by construction, and the facility does carry it.
  it('falls back to CurrBlock when the facility publishes no TownHallId', async () => {
    const fake = makeMutationCtx();
    propsAt(fake).mockResolvedValue(['', CURR_BLOCK]);

    await politicsSetRating(fake.ctx, 1, 2, '1', 50);

    expect(fake.frames.construction[0]).toContain(`sel ${CURR_BLOCK}`);
  });

  it('prefers TownHallId when the facility publishes both', async () => {
    const fake = makeMutationCtx();
    propsAt(fake).mockResolvedValue([TOWN_HALL_ID, CURR_BLOCK]);

    await politicsSetRating(fake.ctx, 1, 2, '1', 50);

    expect(fake.frames.construction[0]).toContain(`sel ${TOWN_HALL_ID}`);
  });

  it.each([
    ['both absent', []],
    ['both empty', ['', '']],
    ['both non-numeric', ['n/a', 'n/a']],
    ['both zero', ['0', '0']],
  ])('emits nothing when the political entity id is %s', async (_label, values) => {
    const fake = makeMutationCtx();
    propsAt(fake).mockResolvedValue(values as string[]);

    const result = await politicsSetRating(fake.ctx, 3, 4, '1', 50);

    expect(fake.frames.construction).toHaveLength(0);
    expect(result).toEqual({ success: false, message: 'No political entity at (3, 4)' });
  });

  it('reports the failure and emits nothing when the construction socket is absent', async () => {
    const fake = makeSessionCtx({ sockets: [], activeUsername: 'SPO_test3' });
    propsAt(fake).mockResolvedValue([TOWN_HALL_ID, '']);

    const result = await politicsSetPublicity(fake.ctx, 1, 2, '1', 0);

    expect(result).toEqual({ success: false, message: 'Construction socket unavailable' });
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('SetPublicity 1=0 failed: Construction socket unavailable')
    );
  });

  it('reports a failing cache read without emitting', async () => {
    const fake = makeMutationCtx();
    propsAt(fake).mockRejectedValue(new Error('Request timeout: GetPropertyList'));

    const result = await politicsSetProjectData(fake.ctx, 1, 2, '88', 'Bob');

    expect(fake.frames.construction).toHaveLength(0);
    expect(result).toEqual({ success: false, message: 'Request timeout: GetPropertyList' });
  });
});

// =============================================================================
// getDefaultPoliticsData
// =============================================================================
describe('getDefaultPoliticsData', () => {
  it('returns default structure with given town name', () => {
    const data = getDefaultPoliticsData('Paraiso');
    expect(data.townName).toBe('Paraiso');
    expect(data.campaigns).toEqual([]);
    expect(data.popularRatings).toEqual([]);
    expect(data.canLaunchCampaign).toBe(false);
    expect(data.campaignMessage).toBeTruthy();
    // Unreachable server means unknown, and unknown must not read as "yes":
    // this field opens a control downstream.
    expect(data.isRuler).toBe(false);
  });

  it('returns zero for all numeric fields', () => {
    const data = getDefaultPoliticsData('TestTown');
    expect(data.yearsToElections).toBe(0);
    expect(data.mayorPrestige).toBe(0);
    expect(data.mayorRating).toBe(0);
    expect(data.campaignCount).toBe(0);
  });
});

// =============================================================================
// getPoliticsData — three ASP pages then the town hall cache
// =============================================================================
describe('getPoliticsData', () => {
  const RATINGS = (name: string, v: string) => ratingsPage([[name, v]]);

  /**
   * The five pages `getPoliticsData` fetches, in order. Anything not supplied
   * answers with an empty body, which every parser reads as "no rows".
   */
  function stubPages(opts: {
    popular?: string; ifel?: string; tycoons?: string; publicity?: string; campaign?: string;
  } = {}): void {
    mockFetch
      .mockResolvedValueOnce(htmlResponse(opts.popular ?? ''))
      .mockResolvedValueOnce(htmlResponse(opts.ifel ?? ''))
      .mockResolvedValueOnce(htmlResponse(opts.tycoons ?? ''))
      .mockResolvedValueOnce(htmlResponse(opts.publicity ?? ''))
      .mockResolvedValueOnce(htmlResponse(opts.campaign ?? ''));
  }

  /**
   * A TOWN reads its ruler block off the town FOLDER object, not off the
   * facility — see `readCacheObjectAtPath`. Each `reads` entry answers one
   * create/SetPath/GetPropertyList/CloseObject cycle, in call order. The
   * ruler block is always the first cycle; a third entry, when supplied,
   * answers the `world.five` `ElectionsOn` read that follows it.
   */
  function stubTownRead(fake: FakeSessionCtx, ...reads: string[][]): void {
    fake.cacher.createObject.mockResolvedValue(TEMP_OBJ);
    for (const values of reads) fake.cacher.getPropertyList.mockResolvedValueOnce(values);
  }

  /** The ten properties the ruler block reads, in emission order. */
  const RULER_PROPS_ORDER = [
    'ActualRuler', 'RulerActualPrestige', 'RulerRating', 'TycoonsRating',
    'IFELRating', 'RulerPeriods', 'YearsToElections', 'CampaignCount',
    'TownHallId', 'HasRuler',
  ];

  /** Ten values, in `RULER_PROPS_ORDER`, for a town with a sitting mayor. */
  const RULER_ROW = ['Rio', '55', '70', '60', '45', '2', '3', '0', '90210', '-1'];

  it('fetches the five Politics pages with the session credentials, %20-encoded', async () => {
    const fake = makeWebCtx();
    stubPages({
      popular: RATINGS('Unemployment', '85'),
      ifel: RATINGS('IFEL A', '40'),
      tycoons: tycoonRatingsPage([{ id: '3', name: 'Tycoon B', rating: '12' }]),
      publicity: publicityPage([{ id: '3', name: 'Tycoon B', publicity: 50 }], '1 200'),
      campaign: campaignPage({ view: 'invite' }),
    });
    stubTownRead(fake, RULER_ROW);

    const data = await getPoliticsData(fake.ctx, 'New Town', 118, 226);

    expect(mockFetch).toHaveBeenCalledTimes(5);
    const urls = mockFetch.mock.calls.map(c => c[0]);
    expect(urls[0]).toMatch(/^http:\/\/158\.69\.153\.134\/Five\/0\/Visual\/Voyager\/Politics\/popularratings\.asp\?/);
    expect(urls[1]).toContain('/ifelratings.asp?');
    // A-12 / B-4, first half. The file is `tycoonratings.asp` — SINGULAR. The
    // plural form does not exist among the 2 774 Voyager pages, so this call
    // 404'd for the whole life of the handler; the 404 body is HTML, so the
    // surrounding try/catch never fired and nothing was ever logged.
    expect(urls[2]).toContain('/tycoonratings.asp?');
    expect(urls[2]).not.toContain('tycoonsratings');
    expect(urls[3]).toContain('/mayorpub.asp?');
    expect(urls[4]).toContain('/tycooncampaign.asp?');
    expect(urls[0]).toContain('TownName=New%20Town');
    expect(urls[0]).not.toContain('+');
    expect(mockFetch.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'follow' }));
    expect((mockFetch.mock.calls[0][1] as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
    const q = queryOf(0);
    expect(q.get('WorldName')).toBe('Shamba');
    expect(q.get('TycoonName')).toBe('SPO_test3');
    expect(q.get('Password')).toBe('test3');
    expect(q.get('DAAddr')).toBe('10.0.0.5');
    expect(q.get('DAPort')).toBe('1111');

    expect(data).toEqual({
      townName: 'New Town',
      isCapitol: false,
      hasRuler: true,
      yearsToElections: 3,
      mayorName: 'Rio',
      mayorPrestige: 55,
      mayorRating: 70,
      tycoonsRating: 60,
      ifelRating: 45,
      mandateNo: 2,
      // `mayordata.asp:39` composes the same path; only the gateway knows the
      // world's IP, so the URL is built here rather than in the browser.
      rulerPhotoUrl: 'http://158.69.153.134/fivedata/userinfo/Shamba/Rio/largephoto.jpg',
      popularRatings: [{ name: 'Unemployment', value: 85 }],
      ifelRatings: [{ name: 'IFEL A', value: 40 }],
      tycoonsRatings: [{ name: 'Tycoon B', value: 12, id: '3' }],
      publicity: [{ id: '3', name: 'Tycoon B', level: 50 }],
      publicityAds: 'Currently purchasing 1 200 hits/hour of publicity.',
      campaignCount: 0,
      campaigns: [],
      campaignState: 'available',
      campaignMessage: '',
      canLaunchCampaign: true,
      prestigeThreshold: 200,
      projects: [],
      promise: '',
      townHallId: 90210,
      // The session is `SPO_test3` and the mayor is `Rio` — no office.
      isRuler: false,
    });
  });

  // OB-31. The answer used to be computed inside the campaign branch and thrown
  // away with it. It is now part of the payload, because the browser has no way
  // to recompute it: `activeUsername` is the ROLE name after a company switch,
  // and `ActualRuler` is the human one.
  it('publishes isRuler, and finds the office through the role-company name', async () => {
    const fake = makeWebCtx({ activeUsername: 'Mayor of New Town', cachedUsername: 'Rio' });
    stubPages({ campaign: campaignPage({ view: 'invite' }) });
    stubTownRead(fake, RULER_ROW);

    const data = await getPoliticsData(fake.ctx, 'New Town', 118, 226);

    expect(data.isRuler).toBe(true);
  });

  // The same read, one page short: a campaign panel that cannot be reached must
  // not take the office with it. The rail downstream refuses the rating control
  // on this field alone, so losing it would hand the mayor a dead control.
  it('still publishes isRuler when the campaign page fails', async () => {
    const fake = makeWebCtx({ activeUsername: 'Mayor of New Town', cachedUsername: 'Rio' });
    mockFetch
      .mockResolvedValueOnce(htmlResponse(''))
      .mockResolvedValueOnce(htmlResponse(''))
      .mockResolvedValueOnce(htmlResponse(''))
      .mockResolvedValueOnce(htmlResponse(''))
      .mockRejectedValueOnce(new Error('campaign page unreachable'));
    stubTownRead(fake, RULER_ROW);

    const data = await getPoliticsData(fake.ctx, 'New Town', 118, 226);

    expect(data.isRuler).toBe(true);
    expect(data.campaignMessage).toBe('The campaign page could not be reached.');
  });

  // The whole point of the `isCapitol` flag: `popularratings.asp:9-17` resolves
  // `Towns\<TownName>.five\Ratings\` unless `Capitol=YES` is present, so the
  // presidential page used to read an empty folder and render an empty table.
  it('a Capitol request carries Capitol=YES with x/y and an empty TownName', async () => {
    const fake = makeWebCtx();
    stubPages({ campaign: campaignPage({ view: 'invite', capitol: true }) });
    propsAt(fake).mockResolvedValue(['Innos', '399077', '75', '75', '75', '4', '16', '0', '5150', '-1']);

    const data = await getPoliticsData(fake.ctx, 'ignored', 118, 226, true);

    const q = queryOf(0);
    expect(q.get('Capitol')).toBe('YES');
    expect(q.get('x')).toBe('118');
    expect(q.get('y')).toBe('226');
    expect(q.get('TownName')).toBe('');
    // …and the ruler block comes off the MAP object, not off a town folder.
    // The Capitol still reads `world.five` by path, same as `header.asp:20-23`.
    expect(propsAt(fake)).toHaveBeenCalledWith(118, 226, RULER_PROPS_ORDER);
    expect(fake.cacher.setPath.mock.calls.map(c => c[1])).toEqual(['world.five']);
    expect(data.isCapitol).toBe(true);
    expect(data.mayorName).toBe('Innos');
    expect(data.mandateNo).toBe(4);
    expect(data.prestigeThreshold).toBe(1000);
  });

  it('a town request carries no Capitol marker and reads the town folder object', async () => {
    const fake = makeWebCtx();
    stubPages();
    stubTownRead(fake, RULER_ROW);

    await getPoliticsData(fake.ctx, 'New Town', 118, 226);

    const q = queryOf(0);
    expect(q.get('Capitol')).toBe('');
    expect(q.get('x')).toBe('');
    expect(q.get('y')).toBe('');
    expect(fake.cacher.setPath).toHaveBeenCalledWith(TEMP_OBJ, 'Towns\\New Town.five\\');
    expect(fake.cacher.getPropertyList).toHaveBeenCalledWith(TEMP_OBJ, RULER_PROPS_ORDER);
    expect(fake.cacher.closeObject).toHaveBeenCalledWith(TEMP_OBJ);
    expect(propsAt(fake)).not.toHaveBeenCalled();
  });

  it('ElectionsOn = 0 on world.five names the state noElections and never fetches the campaign page', async () => {
    const fake = makeWebCtx();
    stubPages({ campaign: campaignPage({ view: 'invite' }) });
    stubTownRead(fake, RULER_ROW, ['0']);

    const data = await getPoliticsData(fake.ctx, 'New Town', 118, 226);

    expect(data.campaignState).toBe('noElections');
    expect(data.canLaunchCampaign).toBe(false);
    expect(data.campaignMessage).toBe('');
    expect(data.projects).toEqual([]);
    expect(data.promise).toBe('');
    expect(mockFetch).toHaveBeenCalledTimes(4);
    const urls = mockFetch.mock.calls.map(c => c[0] as string);
    expect(urls.some(u => u.includes('/tycooncampaign.asp?'))).toBe(false);
    expect(fake.cacher.setPath).toHaveBeenCalledWith(TEMP_OBJ, 'world.five');
    expect(fake.cacher.getPropertyList).toHaveBeenNthCalledWith(2, TEMP_OBJ, ['ElectionsOn']);
    // The ruler block is untouched by the elections flag.
    expect(data.mayorName).toBe('Rio');
    expect(data.yearsToElections).toBe(3);
  });

  it('ElectionsOn = 1 leaves the campaign page to decide, as before', async () => {
    const fake = makeWebCtx();
    stubPages({ campaign: campaignPage({ view: 'invite' }) });
    stubTownRead(fake, RULER_ROW, ['1']);

    const data = await getPoliticsData(fake.ctx, 'New Town', 118, 226);

    expect(data.campaignState).toBe('available');
    expect(data.canLaunchCampaign).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(5);
    const urls = mockFetch.mock.calls.map(c => c[0] as string);
    expect(urls[4]).toContain('/tycooncampaign.asp?');
  });

  it.each([
    ['empty', ['']],
    ['absent', []],
  ])('an %s ElectionsOn value keeps elections on', async (_label, electionsValues) => {
    const fake = makeWebCtx();
    stubPages({ campaign: campaignPage({ view: 'invite' }) });
    stubTownRead(fake, RULER_ROW, electionsValues);

    const data = await getPoliticsData(fake.ctx, 'New Town', 118, 226);

    expect(data.campaignState).toBe('available');
  });

  it('a failed ElectionsOn read keeps elections on and is logged at debug', async () => {
    const fake = makeWebCtx();
    stubPages({ campaign: campaignPage({ view: 'invite' }) });
    fake.cacher.createObject.mockResolvedValue(TEMP_OBJ);
    fake.cacher.getPropertyList
      .mockResolvedValueOnce(RULER_ROW)
      .mockRejectedValueOnce(new Error('Request timeout: GetPropertyList'));

    const data = await getPoliticsData(fake.ctx, 'New Town', 118, 226);

    expect(data.campaignState).toBe('available');
    expect(fake.log.debug).toHaveBeenCalledWith(
      '[Politics] Could not read ElectionsOn: Request timeout: GetPropertyList'
    );
  });

  it('refuses when the DA lock channel is unset, rather than falling back to the directory host/port', async () => {
    const fake = makeWebCtx({ activeUsername: null, cachedUsername: 'Cached', cachedPassword: null, daAddr: null, daPort: null });
    mockFetch.mockResolvedValue(htmlResponse(''));
    stubTownRead(fake, []);

    // getPoliticsData's outer try/catch turns the refusal into the same default
    // payload any other transport failure produces — it never lets a caller crash.
    await expect(getPoliticsData(fake.ctx, 'T', 1, 2)).resolves.toEqual(getDefaultPoliticsData('T', false));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('with no username at all sends an empty TycoonName, and an empty WorldName when the world has none', async () => {
    const fake = makeWebCtx({ activeUsername: null, cachedUsername: null, currentWorldInfo: { ...WORLD, name: '' } });
    mockFetch.mockResolvedValue(htmlResponse(''));
    stubTownRead(fake, []);
    await getPoliticsData(fake.ctx, 'T', 1, 2);
    expect(queryOf(0).get('TycoonName')).toBe('');
    expect(queryOf(0).get('WorldName')).toBe('');
  });

  // `Tycoon{i}` / `Rating{i}` / `Prestige{i}` — Kernel/PoliticsCache.pas:160-162.
  // NOT `Candidate{i}` / `CmpRat{i}`: that series lives on the FACILITY and has
  // no prestige column, which is what the opposition panel needs.
  it('reads the campaign series in a second cache call when CampaignCount > 0, skipping unnamed ones', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(''));
    stubTownRead(
      fake,
      ['Rio', '1', '2', '3', '4', '5', '6', '3', '77', '-1'],
      ['Alice', '61', '2000', '', '10', '30', 'Carol', 'x', 'y'],
    );

    const data = await getPoliticsData(fake.ctx, 'T', 1, 2);

    expect(fake.cacher.getPropertyList).toHaveBeenNthCalledWith(
      2, TEMP_OBJ,
      ['Tycoon0', 'Rating0', 'Prestige0', 'Tycoon1', 'Rating1', 'Prestige1', 'Tycoon2', 'Rating2', 'Prestige2'],
    );
    expect(data.campaignCount).toBe(3);
    expect(data.campaigns).toEqual([
      { candidateName: 'Alice', rating: 61, prestige: 2000, photoUrl: 'http://158.69.153.134/fivedata/userinfo/Shamba/Alice/largephoto.jpg' },
      { candidateName: 'Carol', rating: 0, prestige: 0, photoUrl: 'http://158.69.153.134/fivedata/userinfo/Shamba/Carol/largephoto.jpg' },
    ]);
  });

  it('encodes a candidate name with a space in the portrait URL', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(''));
    stubTownRead(
      fake,
      ['Rio', '1', '2', '3', '4', '5', '6', '1', '77', '-1'],
      ['Ann Lee', '61', '2000'],
    );

    const data = await getPoliticsData(fake.ctx, 'T', 1, 2);

    expect(data.campaigns[0].photoUrl).toBe(
      'http://158.69.153.134/fivedata/userinfo/Shamba/Ann%20Lee/largephoto.jpg',
    );
  });

  it('keeps the ruler data when the candidate read fails', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(''));
    fake.cacher.createObject.mockResolvedValue(TEMP_OBJ);
    fake.cacher.getPropertyList
      .mockResolvedValueOnce(['Rio', '1', '2', '3', '4', '5', '6', '2', '77', '-1'])
      .mockRejectedValueOnce(new Error('Request timeout: GetPropertyList'));

    const data = await getPoliticsData(fake.ctx, 'T', 1, 2);

    expect(data.mayorName).toBe('Rio');
    expect(data.campaignCount).toBe(2);
    expect(data.campaigns).toEqual([]);
    expect(fake.log.debug).toHaveBeenCalledWith('[Politics] Could not fetch campaign candidates: Request timeout: GetPropertyList');
  });

  it('when the ruler cache read fails, returns zeros for the ruler block but keeps the ratings', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(RATINGS('X', '5')));
    fake.cacher.createObject.mockResolvedValue(TEMP_OBJ);
    fake.cacher.getPropertyList.mockRejectedValue(new Error('Request timeout: GetPropertyList'));

    const data = await getPoliticsData(fake.ctx, 'T', 1, 2);

    expect(data).toMatchObject({
      mayorName: '', mayorPrestige: 0, campaignCount: 0, campaigns: [], townHallId: 0,
      hasRuler: false, popularRatings: [{ name: 'X', value: 5 }],
    });
    expect(fake.log.debug).toHaveBeenCalledWith('[Politics] Could not fetch ruler data: Request timeout: GetPropertyList');
  });

  it('an empty property list — the path did not resolve — yields the empty ruler block', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(''));
    stubTownRead(fake, []);
    const data = await getPoliticsData(fake.ctx, 'Nowhere', 1, 2);
    expect(data).toMatchObject({ mayorName: '', hasRuler: false, townHallId: 0, campaigns: [] });
  });

  it('non-numeric ruler values become 0 and an empty ruler becomes ""', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(''));
    stubTownRead(fake, ['', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', '0']);
    const data = await getPoliticsData(fake.ctx, 'T', 1, 2);
    expect(data).toMatchObject({
      mayorName: '', mayorPrestige: 0, mayorRating: 0, tycoonsRating: 0, ifelRating: 0,
      mandateNo: 0, yearsToElections: 0, campaignCount: 0, townHallId: 0, hasRuler: false,
    });
  });

  it('a failing tycoon ratings fetch leaves tycoonsRatings empty and the rest intact', async () => {
    const fake = makeWebCtx();
    mockFetch
      .mockResolvedValueOnce(htmlResponse(RATINGS('P', '1')))
      .mockResolvedValueOnce(htmlResponse(RATINGS('I', '2')))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(htmlResponse(''));
    stubTownRead(fake, []);

    const data = await getPoliticsData(fake.ctx, 'T', 1, 2);

    expect(data.popularRatings).toEqual([{ name: 'P', value: 1 }]);
    expect(data.ifelRatings).toEqual([{ name: 'I', value: 2 }]);
    expect(data.tycoonsRatings).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith('[Politics] Tycoons ratings fetch failed: ECONNRESET');
  });

  it('a failing publicity fetch leaves the publicity tab empty and the rest intact', async () => {
    const fake = makeWebCtx();
    mockFetch
      .mockResolvedValueOnce(htmlResponse(RATINGS('P', '1')))
      .mockResolvedValueOnce(htmlResponse(''))
      .mockResolvedValueOnce(htmlResponse(''))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(htmlResponse(''));
    stubTownRead(fake, []);

    const data = await getPoliticsData(fake.ctx, 'T', 1, 2);

    expect(data.publicity).toEqual([]);
    expect(data.publicityAds).toBe('');
    expect(data.popularRatings).toEqual([{ name: 'P', value: 1 }]);
    expect(fake.log.warn).toHaveBeenCalledWith('[Politics] Publicity fetch failed: ECONNRESET');
  });

  it('a failing campaign fetch says so and leaves the ratings intact', async () => {
    const fake = makeWebCtx();
    mockFetch
      .mockResolvedValueOnce(htmlResponse(RATINGS('P', '1')))
      .mockResolvedValueOnce(htmlResponse(''))
      .mockResolvedValueOnce(htmlResponse(''))
      .mockResolvedValueOnce(htmlResponse(''))
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    stubTownRead(fake, []);

    const data = await getPoliticsData(fake.ctx, 'T', 1, 2);

    expect(data.popularRatings).toEqual([{ name: 'P', value: 1 }]);
    expect(data.campaignState).toBe('refused');
    expect(data.campaignMessage).toBe('The campaign page could not be reached.');
    expect(data.canLaunchCampaign).toBe(false);
    expect(fake.log.warn).toHaveBeenCalledWith('[Politics] Campaign panel fetch failed: ECONNRESET');
  });

  // `buildCampaignParams('Read', …)`: `tycooncampaign.asp:49` and `:66` fire the
  // RDO call only when `Launch` / `Cancel` is non-empty, so reading the panel
  // must send neither — otherwise opening the tab would launch a campaign.
  it('reads the campaign panel with neither Launch nor Cancel', async () => {
    const fake = makeWebCtx();
    stubPages({ campaign: campaignPage({ view: 'invite' }) });
    stubTownRead(fake, RULER_ROW);

    await getPoliticsData(fake.ctx, 'New Town', 118, 226);

    const q = queryOf(4);
    expect(q.get('Launch')).toBeNull();
    expect(q.get('Cancel')).toBeNull();
    expect(q.get('Recache')).toBe('YES');
  });

  it('carries the projects and the promise of a running campaign', async () => {
    const fake = makeWebCtx();
    stubPages({
      campaign: campaignPage({
        view: 'running',
        projects: [
          { id: '11', name: 'Minister of Health', type: 'Minister', minister: 'Bob', state: 3 },
          { id: '12', name: 'Unemployment', type: 'Goal', comparator: 'Less than', value: 7 },
        ],
        promise: 'Roads for everyone.',
      }),
    });
    stubTownRead(fake, RULER_ROW);

    const data = await getPoliticsData(fake.ctx, 'New Town', 118, 226);

    expect(data.campaignState).toBe('running');
    expect(data.canLaunchCampaign).toBe(false);
    expect(data.projects).toEqual([
      { id: '11', name: 'Minister of Health', kind: 'minister', ministerName: 'Bob', proposalState: 3 },
      { id: '12', name: 'Unemployment', kind: 'goal', comparator: 'Less than', value: 7 },
    ]);
    expect(data.promise).toBe('Roads for everyone.');
  });

  // `:391` and `:400-413` render the SAME bare `<div class=label>`, so the page
  // cannot tell "you are the ruler" from "you were refused". The ruler's own
  // name settles it without reading a word of localised text.
  it('names the state `ruler` when the office holder is the logged-in player', async () => {
    const fake = makeWebCtx({ activeUsername: 'Rio' });
    stubPages({ campaign: campaignPage({ view: 'ruler' }) });
    stubTownRead(fake, RULER_ROW);

    const data = await getPoliticsData(fake.ctx, 'New Town', 118, 226);

    expect(data.campaignState).toBe('ruler');
    expect(data.canLaunchCampaign).toBe(false);
  });

  it('names the state `refused` and keeps the published reason for anyone else', async () => {
    const fake = makeWebCtx();
    stubPages({ campaign: campaignPage({ view: 'silent', launchError: 102 }) });
    stubTownRead(fake, RULER_ROW);

    const data = await getPoliticsData(fake.ctx, 'New Town', 118, 226);

    expect(data.campaignState).toBe('refused');
    expect(data.campaignMessage).toContain('It is too late to launch a campaign');
  });

  it('a failing popularratings fetch returns the default data with the warning', async () => {
    const fake = makeWebCtx();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const data = await getPoliticsData(fake.ctx, 'T', 1, 2);

    expect(data).toEqual(getDefaultPoliticsData('T'));
    expect(fake.log.warn).toHaveBeenCalledWith('[Politics] Failed to fetch politics data: ECONNREFUSED');
    expect(propsAt(fake)).not.toHaveBeenCalled();
  });

  // Regression guard for A-12. The three pages used to be fetched without ever
  // reading `response.status`: the 404 answered to `tycoonsratings.asp` was
  // parsed as ratings, produced `[]`, and left no trace at all.
  it('reports a page the server did not serve, instead of parsing its error body', async () => {
    const fake = makeWebCtx();
    mockFetch
      .mockResolvedValueOnce(htmlResponse(RATINGS('P', '1')))
      .mockResolvedValueOnce(htmlResponse(RATINGS('I', '2')))
      .mockResolvedValueOnce(htmlResponse('<html><head><title>404 - File or directory not found.</title></head></html>', 404))
      .mockResolvedValue(htmlResponse(''));
    stubTownRead(fake, []);

    const data = await getPoliticsData(fake.ctx, 'T', 1, 2);

    expect(data.tycoonsRatings).toEqual([]);
    expect(data.popularRatings).toEqual([{ name: 'P', value: 1 }]);
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('[Politics] tycoon ratings page answered HTTP 404')
    );
  });

  it('a 500 on the popular ratings page empties that list and says so', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse('<html><body>500 Internal Server Error</body></html>', 500));
    stubTownRead(fake, []);

    const data = await getPoliticsData(fake.ctx, 'T', 1, 2);

    expect(data.popularRatings).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('[Politics] popular ratings page answered HTTP 500')
    );
  });

  it('returns the default data without fetching when the world ip is unknown', async () => {
    const fake = makeWebCtx({ currentWorldInfo: null });
    expect(await getPoliticsData(fake.ctx, 'T', 1, 2)).toEqual(getDefaultPoliticsData('T'));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('the Capitol default carries the presidential threshold', () => {
    expect(getDefaultPoliticsData('X', true)).toMatchObject({ isCapitol: true, prestigeThreshold: 1000 });
  });
});

// =============================================================================
// politicsVote — fire-and-forget RDOVote on CurrBlock (TownPolitics.pas:46, procedure)
// =============================================================================
describe('politicsVote', () => {
  function makeVoteCtx(overrides: Partial<SessionContext> = {}): FakeSessionCtx {
    const fake = makeSessionCtx({ sockets: ['construction'], activeUsername: 'SPO_test3', ...overrides });
    fake.cacher.createObject.mockResolvedValue(TEMP_OBJ);
    fake.cacher.getPropertyList.mockResolvedValue([CURR_BLOCK]);
    return fake;
  }

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('reads CurrBlock through a temp object it closes, then writes RDOVote "*" (voter, candidate) on that block — no QueryId', async () => {
    const fake = makeVoteCtx();

    const pending = politicsVote(fake.ctx, 118, 226, 'Alice');
    await jest.advanceTimersByTimeAsync(200);
    const result = await pending;

    expect(fake.ctx.connectConstructionService).toHaveBeenCalled();
    expect(fake.ctx.connectMapService).toHaveBeenCalled();
    expect(fake.cacher.setObject).toHaveBeenCalledWith(TEMP_OBJ, 118, 226);
    expect(fake.cacher.getPropertyList).toHaveBeenCalledWith(TEMP_OBJ, ['CurrBlock']);
    expect(fake.cacher.closeObject).toHaveBeenCalledWith(TEMP_OBJ);

    expect(fake.sent).toHaveLength(0);
    expect(fake.frames.construction).toEqual([
      RdoCommand.sel(CURR_BLOCK).call('RDOVote').push().args(RdoValue.string('SPO_test3'), RdoValue.string('Alice')).build(),
    ]);
    expect(fake.frames.construction[0]).toMatchRdoCallFormat('RDOVote');
    expect(fake.frames.construction[0]).not.toContain('"^"');
    expect(result).toEqual({ success: true, message: 'Voted for Alice' });
  });

  it('parks 200 ms after the frame before resolving', async () => {
    const fake = makeVoteCtx();
    let settled = false;
    const pending = politicsVote(fake.ctx, 1, 2, 'A').then(r => { settled = true; return r; });
    await jest.advanceTimersByTimeAsync(199);
    expect(fake.frames.construction).toHaveLength(1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it('falls back to cachedUsername, then to an empty voter', async () => {
    const a = makeVoteCtx({ activeUsername: null, cachedUsername: 'Cached' });
    const pa = politicsVote(a.ctx, 1, 2, 'A');
    await jest.advanceTimersByTimeAsync(200);
    await pa;
    expect(a.frames.construction[0]).toBe(RdoCommand.sel(CURR_BLOCK).call('RDOVote').push().args(RdoValue.string('Cached'), RdoValue.string('A')).build());

    const b = makeVoteCtx({ activeUsername: null, cachedUsername: null });
    const pb = politicsVote(b.ctx, 1, 2, 'A');
    await jest.advanceTimersByTimeAsync(200);
    await pb;
    expect(b.frames.construction[0]).toBe(RdoCommand.sel(CURR_BLOCK).call('RDOVote').push().args(RdoValue.string(''), RdoValue.string('A')).build());
  });

  it('with no worldId: failure, nothing read, nothing written', async () => {
    const fake = makeVoteCtx({ worldId: null });
    expect(await politicsVote(fake.ctx, 1, 2, 'A')).toEqual({ success: false, message: 'Construction service not initialized' });
    expect(fake.cacher.createObject).not.toHaveBeenCalled();
    expect(fake.frames.construction).toHaveLength(0);
  });

  it('with an empty CurrBlock: failure, temp object closed, nothing written', async () => {
    const fake = makeVoteCtx();
    fake.cacher.getPropertyList.mockResolvedValue(['']);
    expect(await politicsVote(fake.ctx, 5, 6, 'A')).toEqual({ success: false, message: 'No CurrBlock at (5, 6)' });
    expect(fake.cacher.closeObject).toHaveBeenCalledWith(TEMP_OBJ);
    expect(fake.frames.construction).toHaveLength(0);
  });

  it('with no construction socket: failure after the cache read', async () => {
    const fake = makeSessionCtx({ activeUsername: 'X' });
    fake.cacher.createObject.mockResolvedValue(TEMP_OBJ);
    fake.cacher.getPropertyList.mockResolvedValue([CURR_BLOCK]);
    expect(await politicsVote(fake.ctx, 1, 2, 'A')).toEqual({ success: false, message: 'Construction socket unavailable' });
    expect(fake.log.warn).toHaveBeenCalledWith('[Politics] Vote failed: Construction socket unavailable');
  });

  it('a cache timeout is caught and reported', async () => {
    const fake = makeVoteCtx();
    fake.cacher.getPropertyList.mockRejectedValue(new Error('Request timeout: GetPropertyList'));
    expect(await politicsVote(fake.ctx, 1, 2, 'A')).toEqual({ success: false, message: 'Request timeout: GetPropertyList' });
    expect(fake.frames.construction).toHaveLength(0);
  });
});

// =============================================================================
// politicsLaunchCampaign / politicsCancelCampaign — tycooncampaign.asp
// =============================================================================
describe.each([
  // The 5th and 6th columns are the state the page must show for the mutation to
  // count as done: after a launch the Withdraw button (`tycooncampaign.asp:233`),
  // after a withdrawal the Launch invitation (`:364-388`).
  ['politicsLaunchCampaign', politicsLaunchCampaign, 'Launch', 'LaunchCampaign', 'running', 'Campaign launched'],
  ['politicsCancelCampaign', politicsCancelCampaign, 'Cancel', 'CancelCampaign', 'invite', 'Campaign withdrawn'],
] as const)('%s', (_name, fn, action, logTag, doneView, doneMessage) => {
  const donePage = (capitol = false) => campaignPage({ view: doneView, capitol });

  it(`GETs tycooncampaign.asp with ${action}=TRUE, TownName set and Capitol/x/y empty for a town hall`, async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(donePage()));

    const result = await fn(fake.ctx, 118, 226, 'New Town');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0];
    expect(url).toMatch(/^http:\/\/158\.69\.153\.134\/Five\/0\/Visual\/Voyager\/Politics\/tycooncampaign\.asp\?/);
    expect(url).toContain('TownName=New%20Town');
    expect(url).not.toContain('+');
    expect(mockFetch.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'follow' }));
    expect((mockFetch.mock.calls[0][1] as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
    const q = queryOf(0);
    expect(q.get(action)).toBe('TRUE');
    expect(q.get('Capitol')).toBe('');
    expect(q.get('x')).toBe('');
    expect(q.get('y')).toBe('');
    expect(q.get('Recache')).toBe('YES');
    expect(q.get('WorldName')).toBe('Shamba');
    expect(q.get('TycoonName')).toBe('SPO_test3');
    expect(q.get('Password')).toBe('test3');
    expect(q.get('DAAddr')).toBe('10.0.0.5');
    expect(q.get('DAPort')).toBe('1111');
    expect(result).toEqual({ success: true, message: doneMessage });
  });

  it('for the capitol (no town name) sets Capitol=YES with x/y and an empty TownName', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(donePage(true)));

    await fn(fake.ctx, 118, 226);

    const q = queryOf(0);
    expect(q.get('Capitol')).toBe('YES');
    expect(q.get('x')).toBe('118');
    expect(q.get('y')).toBe('226');
    expect(q.get('TownName')).toBe('');
  });

  it('refuses when the DA lock channel is unset, rather than falling back to the directory host/port', async () => {
    const fake = makeWebCtx({ activeUsername: null, cachedUsername: 'Cached', cachedPassword: null, daAddr: null, daPort: null });
    mockFetch.mockResolvedValue(htmlResponse(donePage()));
    // The function's own try/catch turns the refusal into the same failure
    // shape any other transport error produces — it never lets a caller crash.
    expect(await fn(fake.ctx, 1, 2, 'T')).toEqual({
      success: false,
      message: 'ASP call refused: DA lock channel not announced yet (daAddr/daPort unset)',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('with no username at all sends an empty TycoonName and empty WorldName when the world has none', async () => {
    const fake = makeWebCtx({ activeUsername: null, cachedUsername: null, currentWorldInfo: { ...WORLD, name: '' } });
    mockFetch.mockResolvedValue(htmlResponse(donePage()));
    await fn(fake.ctx, 1, 2, 'T');
    expect(queryOf(0).get('TycoonName')).toBe('');
    expect(queryOf(0).get('WorldName')).toBe('');
  });

  it('returns the refusal the ASP page carries when the player already rules the town', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(campaignPage({ view: 'ruler' })));
    expect(await fn(fake.ctx, 1, 2, 'T')).toEqual({
      success: false, message: 'You are the Mayor. You cannot have a campaign.',
    });
  });

  // B-5. Regression guard, and the reason the whole oracle was rewritten: this
  // body carries no `<div class=label>` at all, so the old "success = no denial
  // div" rule called it a success — for a launch that never happened and for a
  // withdrawal the server never acknowledged. Neither button is present, so
  // neither end state is proven.
  it('a body proving neither end state is a failure, not a success', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse('<body>\n<table><tr><td>Campaign projects</td></tr></table>\n</body>'));
    expect((await fn(fake.ctx, 1, 2, 'T')).success).toBe(false);
  });

  // Wrong password: `tycooncampaign.asp:48` leaves FullAccess false, `:50`/`:67`
  // skip the RDO call entirely and `:401` leaves the div empty. Reported as
  // success until now.
  it('an empty label div — the wrong-password rendering — is a failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(campaignPage({ view: 'silent' })));
    const r = await fn(fake.ctx, 1, 2, 'T');
    expect(r.success).toBe(false);
    expect(r.message).toContain('the page published no reason');
  });

  it('a 500 status is a failure — absence of a denial div is not evidence of success', async () => {
    // Regression guard for A-9. parseCampaignResponse reads success as "the page carries
    // no denial div", so a server error page used to read as a launched/cancelled
    // campaign. The status is now checked before the body is trusted.
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse('<html><body>500 Internal Server Error</body></html>', 500));
    expect(await fn(fake.ctx, 1, 2, 'T')).toEqual({ success: false, message: `${action} campaign failed: HTTP 500` });
  });

  it('a rejected fetch is caught, warned and returned as failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await fn(fake.ctx, 1, 2, 'T')).toEqual({ success: false, message: 'ECONNREFUSED' });
    expect(fake.log.warn).toHaveBeenCalledWith(`[Politics] ${logTag} failed: ECONNREFUSED`);
  });

  it('without a world ip: "Not connected to world", no fetch', async () => {
    const fake = makeWebCtx({ currentWorldInfo: null });
    expect(await fn(fake.ctx, 1, 2, 'T')).toEqual({ success: false, message: 'Not connected to world' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// searchConnections — the branches rdo-callsite-wire-format.test.ts leaves open
// =============================================================================
describe('searchConnections', () => {
  function makeSearchCtx(overrides: Partial<SessionContext> = {}): FakeSessionCtx {
    return makeSessionCtx({ currentWorldInfo: WORLD, ...overrides });
  }

  it('FindSuppliers on the cacher (map socket), SLOW, with the nine args in Delphi order', async () => {
    const fake = makeSearchCtx();
    fake.respond(() => 'res="%"');

    await searchConnections(fake.ctx, 706, 436, 'Plastics', 'input', { company: 'ACME', town: 'Rio', maxResults: 5, roles: 3 });

    expect(fake.ctx.connectMapService).toHaveBeenCalled();
    expect(fake.sent[0].socketName).toBe('map');
    expect(fake.sent[0].category).toBe(TimeoutCategory.SLOW);
    expect(fake.sent[0].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: FAKE_CONTEXT_IDS.cacherId,
      action: RdoAction.CALL,
      member: 'FindSuppliers',
      separator: '"^"',
      args: [
        RdoValue.string('Plastics').format(), RdoValue.string('Shamba').format(),
        RdoValue.string('Rio').format(), RdoValue.string('ACME').format(),
        RdoValue.int(5).format(), RdoValue.int(706).format(), RdoValue.int(436).format(),
        RdoValue.int(1).format(), RdoValue.int(3).format(),
      ],
    });
  });

  it('FindClients for the output direction, defaulting count 20 and roles 78', async () => {
    const fake = makeSearchCtx();
    fake.respond(() => 'res="%"');
    await searchConnections(fake.ctx, 1, 2, 'Food', 'output');
    expect(fake.sent[0].packet.member).toBe('FindClients');
    expect(fake.sent[0].packet.args?.slice(4)).toEqual([
      RdoValue.int(20).format(), RdoValue.int(1).format(), RdoValue.int(2).format(), RdoValue.int(1).format(), RdoValue.int(78).format(),
    ]);
  });

  it('FindSuppliers with no filters defaults the role set to the all-checked 54', async () => {
    // The value of the captured trace (connection-search.test.ts:9): the supplier form's four
    // boxes are rolCompExport 32 | rolImporter 16 | rolDistributer 4 | rolProducer 2.
    const fake = makeSearchCtx();
    fake.respond(() => 'res="%"');
    await searchConnections(fake.ctx, 459, 389, 'Drugs', 'input');
    expect(fake.sent[0].packet.member).toBe('FindSuppliers');
    expect(fake.sent[0].packet.args?.[8]).toBe(RdoValue.int(54).format());
  });

  it('a role set of 0 travels as 0 — every box unticked is not an absent filter', async () => {
    const fake = makeSearchCtx();
    fake.respond(() => 'res="%"');
    await searchConnections(fake.ctx, 1, 2, 'Food', 'input', { roles: 0 });
    expect(fake.sent[0].packet.args?.[8]).toBe(RdoValue.int(0).format());
  });

  it('parses 7-field supplier rows with price and quality, 5-field client rows without', async () => {
    const fake = makeSearchCtx();
    fake.respond(p => (p.member === 'FindSuppliers'
      ? 'res="%10}20}Farm A}ACME}Rio}$12.5}88\r\n30}40}Farm B}}"'
      : 'res="%50}60}Store}Mega}Town}$1}9"'));

    const suppliers = await searchConnections(fake.ctx, 1, 2, 'F', 'input');
    expect(suppliers).toEqual([
      { x: 10, y: 20, facilityName: 'Farm A', companyName: 'ACME', town: 'Rio', price: '$12.5', quality: '88' },
      { x: 30, y: 40, facilityName: 'Farm B', companyName: '', town: undefined },
    ]);

    const clients = await searchConnections(fake.ctx, 1, 2, 'F', 'output');
    // 7 fields on an output row: price/quality are NOT read
    expect(clients).toEqual([{ x: 50, y: 60, facilityName: 'Store', companyName: 'Mega', town: 'Town' }]);
  });

  it('drops rows whose coordinates are not numeric, names an unnamed facility "Unknown", and empties price/quality slots', async () => {
    const fake = makeSearchCtx();
    fake.respond(() => 'res="%a}b}Bad\r\n1}2}}}}}"');
    expect(await searchConnections(fake.ctx, 1, 2, 'F', 'input')).toEqual([
      { x: 1, y: 2, facilityName: 'Unknown', companyName: '', town: undefined, price: undefined, quality: undefined },
    ]);
  });

  it('returns [] for an empty payload and for a packet without payload', async () => {
    const fake = makeSearchCtx();
    fake.respond((_p, i) => (i === 0 ? '' : { raw: '', type: 'RESPONSE', rid: i } as RdoPacket));
    expect(await searchConnections(fake.ctx, 1, 2, 'F', 'input')).toEqual([]);
    expect(await searchConnections(fake.ctx, 1, 2, 'F', 'input')).toEqual([]);
  });

  it('returns [] and warns without a world name, sending nothing', async () => {
    const fake = makeSearchCtx({ currentWorldInfo: null });
    expect(await searchConnections(fake.ctx, 1, 2, 'F', 'input')).toEqual([]);
    expect(fake.sent).toHaveLength(0);
    expect(fake.log.warn).toHaveBeenCalledWith('[Connections] No world name available for search');
  });

  it('returns [] and warns without a cacherId after connecting the map service', async () => {
    const fake = makeSearchCtx({ cacherId: null });
    expect(await searchConnections(fake.ctx, 1, 2, 'F', 'input')).toEqual([]);
    expect(fake.ctx.connectMapService).toHaveBeenCalled();
    expect(fake.sent).toHaveLength(0);
    expect(fake.log.warn).toHaveBeenCalledWith('[Connections] No cacherId available for search');
  });

  it('a timeout is caught and reported as []', async () => {
    const fake = makeSearchCtx();
    fake.respond(() => new Error('Request timeout: FindSuppliers'));
    expect(await searchConnections(fake.ctx, 1, 2, 'F', 'input')).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith('[Connections] input search failed: Request timeout: FindSuppliers');
  });
});

// =============================================================================
// holdsOffice — the reference's two-pronged IsMayor, plus one prong of our own
// =============================================================================

describe('holdsOffice', () => {
  const RULER = 'SPO_test3';
  const TOWN = 'Helartia';

  /** Only the two identity fields matter here. */
  function ctxAs(activeUsername: string | null, cachedUsername: string) {
    return makeSessionCtx({ activeUsername, cachedUsername }).ctx;
  }

  it('recognises the ruler playing an ordinary company', () => {
    expect(holdsOffice(ctxAs('SPO_test3', 'SPO_test3'), RULER, TOWN)).toBe(true);
  });

  it('recognises the ruler playing their ROLE company', () => {
    // `switchCompany` sets activeUsername to the ownerRole; ActualRuler stays
    // the human name. Prong one alone answered false here — the bug this fixes.
    expect(holdsOffice(ctxAs('Mayor of Helartia', 'SPO_test3'), RULER, TOWN)).toBe(true);
  });

  it('recognises the role name even when the human name is unknown', () => {
    // The reference's second prong standing on its own — `tycooncampaign.asp:98`.
    expect(holdsOffice(ctxAs('Mayor of Helartia', ''), RULER, TOWN)).toBe(true);
  });

  it('matches case-insensitively, as Ucase() does on both sides', () => {
    expect(holdsOffice(ctxAs('mayor of HELARTIA', ''), RULER, TOWN)).toBe(true);
    expect(holdsOffice(ctxAs('spo_TEST3', ''), RULER, TOWN)).toBe(true);
  });

  it('does not mistake another tycoon for the ruler', () => {
    expect(holdsOffice(ctxAs('gatorlor', 'gatorlor'), RULER, TOWN)).toBe(false);
  });

  it("does not mistake another town's mayor for this one's", () => {
    expect(holdsOffice(ctxAs('Mayor of Flumenia', 'innos'), RULER, TOWN)).toBe(false);
  });

  it('answers false on a vacant seat rather than matching an empty name', () => {
    expect(holdsOffice(ctxAs('', ''), '', TOWN)).toBe(false);
    expect(holdsOffice(ctxAs('gatorlor', 'gatorlor'), '', TOWN)).toBe(false);
  });
});

