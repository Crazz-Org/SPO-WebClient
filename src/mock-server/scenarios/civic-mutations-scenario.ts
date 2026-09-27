/**
 * Scenario 16: Civic mutations — the write half of the Politics surface.
 *
 * `building-details-scenario.ts` serves the civic groups read-only: it answers
 * every `GetPropertyList` a Town Hall or a Capitol tab asks for, and stops
 * there. Nothing in the L1 substrate ever saw the frames a player's civic
 * *write* puts on the wire, so the one class of mistake the substrate exists to
 * catch — a wrong separator, a wrong argument count, a wrong bind target — had
 * no test to fail on the whole Politics path.
 *
 * This scenario supplies that half, in two pieces:
 *
 *  - **RDO** — one exchange per civic mutation the gateway emits, its request
 *    the literal frame production emits, written out here and never rebuilt
 *    with the emitter. Every one of them is a Pascal `procedure`: the separator is
 *    `"*"`, and **the response is empty on purpose**. A procedure answers
 *    nothing, so "the write landed" is never something the reply can say
 *    (`OB-28`); the client re-reads to find out. It also serves the two cache
 *    reads by path `getPoliticsData` makes before any of that — the town
 *    folder's ruler block and `world.five`'s `ElectionsOn`, `1` by default,
 *    `0` via `createCivicMutationsScenario(vars, { electionsOn: false })`.
 *  - **HTTP** — the five Politics ASP pages `getPoliticsData` fetches. Their
 *    bodies are cut to the markup the parsers actually key on, from
 *    `Five/0/Visual/Voyager/Politics/*.asp`, and the suite feeds each one
 *    through the real parser rather than asserting on the HTML.
 *
 * The two mutation pages of the reference client (`rdoModifyRating.asp`,
 * `rdoModifyPub.asp`, `rdoModifyProject.asp`) have no exchange here, and that is
 * not an omission: the WebClient does not fetch them. Voyager posted into a
 * hidden iframe because a browser had no socket; the gateway emits the same
 * procedures directly (`politics-handler.ts:940-1035`).
 */

import { RdoValue } from '@/shared/rdo-types';
import type { RdoMemberName } from '@/shared/rdo-members';
import { RULER_PROPS } from '@/server/session/politics-handler';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { HttpScenario, HttpExchange } from '../types/http-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

// =============================================================================
// BIND TARGETS
// =============================================================================

/**
 * The three ids a civic write can be addressed to, and they are not
 * interchangeable.
 *
 * `CurrBlock` is what the property path binds to — the gateway reads it off the
 * map cache before every write (`building-property-handler.ts:126-133`).
 * `TownHallId` is what the three politics procedures bind to, falling back to
 * `CurrBlock` when the cache has no `TownHallId` (`politics-handler.ts:933-938`).
 * They differ on a Capitol, where the political entity is not the facility.
 */
export const CIVIC_TARGETS = {
  /** Town Hall facility block — `MOCK_TOWN_HALL.id` + 1, as a block id is. */
  townHallBlock: '130500401',
  /** Capitol facility block — `MOCK_CAPITOL.id` + 1. */
  capitolBlock: '130400301',
  /** The political entity the three politics procedures bind to. */
  townHallId: '130500777',
  /** The cacher temp object id — distinct from every block id and coordinate. */
  tempObject: '7734',
} as const;

// =============================================================================
// THE MUTATIONS
// =============================================================================

/** One civic write, stated the way the gateway states it. */
interface CivicMutation {
  /** Exchange id suffix. */
  slug: string;
  member: RdoMemberName;
  targetId: string;
  args: RdoValue[];
  /** The frame production emits for this write, spelled out as a literal. */
  request: string;
  /** Where the gateway builds this frame, and what the arguments mean. */
  note: string;
}

/**
 * Every civic mutation the client can emit, with the arguments in the order the
 * emitter puts them.
 *
 * Order and types are not invented here — each entry mirrors one `case` of
 * `buildRdoCommandArgs` (`building-property-handler.ts:488-770`) or one of the
 * three politics emitters. `request` is that frame written out by hand — the
 * strict validator checks its separator and arity against `RDO_MEMBERS`, so it
 * must never be rebuilt from the same catalogue it is checked against.
 */
const CIVIC_MUTATIONS: CivicMutation[] = [
  {
    slug: 'set-tax-value',
    member: 'RDOSetTaxValue',
    targetId: CIVIC_TARGETS.townHallBlock,
    // TaxId, not the row index: the gateway resolves `Tax0Id` first, and 100 is
    // what MOCK_TOWN_HALL serves there. The rate is a widestring.
    args: [RdoValue.int(100), RdoValue.string('15')],
    request: `C sel ${CIVIC_TARGETS.townHallBlock} call RDOSetTaxValue "*" "#100","%15";`,
    note: 'Town Hall TAXES — set the Farms rate to 15 %',
  },
  {
    slug: 'set-tax-value-subsidy',
    member: 'RDOSetTaxValue',
    targetId: CIVIC_TARGETS.townHallBlock,
    // A subsidy is the literal '-10', not a negative rate the player dials in
    // (TownTaxesSheet.pas:336-338). The wire carries the sign.
    args: [RdoValue.int(110), RdoValue.string('-10')],
    request: `C sel ${CIVIC_TARGETS.townHallBlock} call RDOSetTaxValue "*" "#110","%-10";`,
    note: 'Town Hall TAXES — subsidise Business Machines',
  },
  {
    slug: 'set-min-salary',
    member: 'RDOSetMinSalaryValue',
    targetId: CIVIC_TARGETS.townHallBlock,
    // levelIndex 0 = executives, 1 = professionals, 2 = workers.
    args: [RdoValue.int(0), RdoValue.int(150)],
    request: `C sel ${CIVIC_TARGETS.townHallBlock} call RDOSetMinSalaryValue "*" "#0","#150";`,
    note: 'Town Hall JOBS — executive minimum wage to 150 %',
  },
  {
    slug: 'set-town-taxes',
    member: 'RDOSetTownTaxes',
    targetId: CIVIC_TARGETS.capitolBlock,
    // Here the index IS the argument — CapitolTownsSheet.pas passes the row.
    args: [RdoValue.int(0), RdoValue.int(15)],
    request: `C sel ${CIVIC_TARGETS.capitolBlock} call RDOSetTownTaxes "*" "#0","#15";`,
    note: 'Capitol TOWNS — town 0 tax to 15 %',
  },
  {
    slug: 'sit-mayor',
    member: 'RDOSitMayor',
    targetId: CIVIC_TARGETS.capitolBlock,
    args: [RdoValue.string('Shamba'), RdoValue.string('SPO_test3')],
    request: `C sel ${CIVIC_TARGETS.capitolBlock} call RDOSitMayor "*" "%Shamba","%SPO_test3";`,
    note: 'Capitol TOWNS — appoint a mayor to a vacant seat',
  },
  {
    slug: 'sit-minister',
    member: 'RDOSitMinister',
    targetId: CIVIC_TARGETS.capitolBlock,
    // MinId, not the row index: resolved from `MinistryId1`.
    args: [RdoValue.int(1), RdoValue.string('SPO_test3')],
    request: `C sel ${CIVIC_TARGETS.capitolBlock} call RDOSitMinister "*" "#1","%SPO_test3";`,
    note: 'Capitol MINISTRIES — appoint a minister to Education',
  },
  {
    slug: 'ban-minister',
    member: 'RDOBanMinister',
    targetId: CIVIC_TARGETS.capitolBlock,
    args: [RdoValue.int(0)],
    request: `C sel ${CIVIC_TARGETS.capitolBlock} call RDOBanMinister "*" "#0";`,
    note: 'Capitol MINISTRIES — depose the Health minister',
  },
  {
    slug: 'set-ministry-budget',
    member: 'RDOSetMinistryBudget',
    targetId: CIVIC_TARGETS.capitolBlock,
    // The budget is a widestring — the server evaluates the currency text.
    args: [RdoValue.int(0), RdoValue.string('2500000')],
    request: `C sel ${CIVIC_TARGETS.capitolBlock} call RDOSetMinistryBudget "*" "#0","%2500000";`,
    note: 'Capitol MINISTRIES — raise the Health budget',
  },
  {
    slug: 'vote',
    member: 'RDOVote',
    targetId: CIVIC_TARGETS.capitolBlock,
    args: [RdoValue.string('SPO_test3'), RdoValue.string('Senator Adams')],
    request: `C sel ${CIVIC_TARGETS.capitolBlock} call RDOVote "*" "%SPO_test3","%Senator Adams";`,
    note: 'Capitol VOTES — cast a vote for a candidate',
  },
  {
    slug: 'set-rating-from',
    member: 'RDOSetRatingFrom',
    targetId: CIVIC_TARGETS.townHallId,
    // RatingId, the rater, the percentage — the order rdoModifyRating.asp:24-27
    // demonstrates, and the reason the bind target is the political entity.
    args: [RdoValue.string('41123456'), RdoValue.string('SPO_test3'), RdoValue.int(75)],
    request: `C sel ${CIVIC_TARGETS.townHallId} call RDOSetRatingFrom "*" "%41123456","%SPO_test3","#75";`,
    note: "TYCOONS' RATINGS — rate the politician in office",
  },
  {
    slug: 'set-publicity',
    member: 'RDOSetPublicity',
    targetId: CIVIC_TARGETS.townHallId,
    // The level is one of the five buckets mayorpub.asp:187-191 offers.
    args: [RdoValue.string('41123456'), RdoValue.int(75)],
    request: `C sel ${CIVIC_TARGETS.townHallId} call RDOSetPublicity "*" "%41123456","#75";`,
    note: 'PUBLICITY — buy publicity on one criterion',
  },
  {
    slug: 'set-project-data',
    member: 'RDOSetProjectData',
    targetId: CIVIC_TARGETS.townHallId,
    // `data` is a widestring for both row shapes — a minister name here.
    args: [RdoValue.string('SPO_test3'), RdoValue.string('42007700'), RdoValue.string('SPO_test3')],
    request: `C sel ${CIVIC_TARGETS.townHallId} call RDOSetProjectData "*" "%SPO_test3","%42007700","%SPO_test3";`,
    note: 'YOUR CAMPAIGN — name a minister on a campaign project',
  },
];

/**
 * The two reads a civic write cannot skip.
 *
 * A row index is not an id, and the gateway knows it: before `RDOSetTaxValue`
 * it reads `Tax{i}Id`, before `RDOSetMinistryBudget` it reads `MinistryId{i}`
 * (`building-property-handler.ts:139-170`). Both are single-property
 * `GetPropertyList` calls, and both carry an `argsPattern` so they win the
 * match ahead of the tab-sized reads `building-details` registers.
 */
const CIVIC_ID_LOOKUPS: { slug: string; property: string; value: string; note: string }[] = [
  {
    slug: 'lookup-tax-id',
    property: 'Tax0Id',
    value: '100',
    note: 'Row 0 of the TAXES table is account 100 — the id RDOSetTaxValue takes',
  },
  {
    slug: 'lookup-ministry-id',
    property: 'MinistryId1',
    value: '1',
    note: 'Row 1 of the MINISTRIES table is ministry 1',
  },
];

// =============================================================================
// WORLD AND TOWN CACHE OBJECTS — the two reads by path
// =============================================================================

/**
 * The ruler-block read (`Towns\Shamba.five\`, `header.asp:20-23`) and the
 * `world.five` `ElectionsOn` read `getPoliticsData` makes before the campaign
 * page is ever fetched. Both go through the same temp object id, same as the
 * real gateway (`readCacheObjectAtPath`).
 */
function buildPathReadExchanges(electionsOn: boolean): RdoExchange[] {
  const rulerQuery = `${RULER_PROPS.join('\t')}\t`;
  const electionsQuery = 'ElectionsOn\t';

  return [
    {
      id: 'civic-rdo-town-set-path',
      request: `C sel ${CIVIC_TARGETS.tempObject} call SetPath "^" "%Towns\\Shamba.five\\";`,
      // Delphi WordBool TRUE — the only success value (fetchGateDetails in building-details-handler.ts).
      response: 'A0 res="#-1"',
      matchKeys: {
        verb: 'sel', action: 'call', member: 'SetPath',
        argsPattern: ['"%Towns\\Shamba.five\\"'],
      },
    },
    {
      // Keeps the ruler read from falling through `RdoMock`'s member-only match
      // onto the tax-id lookup — both are `GetPropertyList` calls.
      id: 'civic-rdo-town-ruler-block',
      request: `C sel ${CIVIC_TARGETS.tempObject} call GetPropertyList "^" "%${rulerQuery}";`,
      // Ten values in RULER_PROPS order: TownHallId = CIVIC_TARGETS.townHallId,
      // CampaignCount 0, HasRuler -1.
      response: 'A0 res="%Rio\t55\t70\t60\t45\t2\t3\t0\t130500777\t-1"',
      matchKeys: {
        verb: 'sel', action: 'call', member: 'GetPropertyList',
        argsPattern: [`"%${rulerQuery}"`],
      },
    },
    {
      // header.asp:22, Kernel/WorldPolitics.pas:2069.
      id: 'civic-rdo-world-set-path',
      request: `C sel ${CIVIC_TARGETS.tempObject} call SetPath "^" "%world.five";`,
      response: 'A0 res="#-1"',
      matchKeys: {
        verb: 'sel', action: 'call', member: 'SetPath',
        argsPattern: ['"%world.five"'],
      },
    },
    {
      // Kernel/WorldPolitics.pas:2078, Cache/CacheAgent.pas:150-151.
      id: 'civic-rdo-world-elections-on',
      request: `C sel ${CIVIC_TARGETS.tempObject} call GetPropertyList "^" "%${electionsQuery}";`,
      response: electionsOn ? 'A0 res="%1"' : 'A0 res="%0"',
      matchKeys: {
        verb: 'sel', action: 'call', member: 'GetPropertyList',
        argsPattern: [`"%${electionsQuery}"`],
      },
    },
  ];
}

// =============================================================================
// POLITICS ASP PAGES
// =============================================================================

/** The folder every Politics page is served from (`politics-handler.ts:753`). */
const POLITICS_PATH = '/Five/0/Visual/Voyager/Politics';

/**
 * A two-cell ratings row (`popularratings.asp:65-72`, `ifelratings.asp:63-70`).
 * No `id`: only `tycoonratings.asp` carries one, and only its rows are ratable.
 */
function ratingsRow(name: string, value: string): string {
  return [
    '\t\t<tr style="margin-top: 2px">',
    '\t\t\t<td class=label>',
    `\t\t\t\t${name}`,
    '\t\t\t</td>',
    '\t\t\t<td class=value align="right">',
    `\t\t\t\t${value}%`,
    '\t\t\t</td>',
    '\t\t</tr>',
    // The 1-pixel separator the loop emits after every row. It has no label and
    // no value cell, which is exactly why the parser must skip it.
    '\t\t<tr>',
    '\t\t\t<td height="1" colspan=2 bgcolor=#244843>',
    '\t\t\t</td>',
    '\t\t</tr>',
  ].join('\n');
}

/**
 * A ratable row (`tycoonratings.asp:135-162`): the cache id lives unquoted on
 * the `<tr>`, the label cell carries three event handlers, and the number sits
 * two levels deep beside an opinion `<select>` whose options are percentages
 * too — the trap that made a naive value read return 100 for every row.
 */
function tycoonRatingRow(id: string, name: string, value: number): string {
  const bucket = 25 * Math.floor(value / 25);
  const option = (v: number): string =>
    `\t\t\t\t\t\t<option value="${v}" ${v === bucket ? 'selected' : ''}>${v}%`;
  return [
    `\t\t<tr style="margin-top: 2px" id=${id}>`,
    '\t\t\t<td class=label',
    '\t\t\t\tOnMouseOver="onRowMouseOver()"',
    '\t\t\t\tOnMouseOut="onRowMouseOut()"',
    '\t\t\t\tonClick="onRowMouseClick()">',
    `\t\t\t\t${name}`,
    '\t\t\t</td>',
    '\t\t\t<td class=value align="right"',
    '\t\t\t\tOnMouseOver="onRowMouseOver()">',
    `\t\t\t\t<div id=LabelDiv_${id} class=value>`,
    `\t\t\t\t\t<span id=Value_${id}>${value}%</span>`,
    '\t\t\t\t</div>',
    `\t\t\t\t<div id=OpinionDiv_${id} class=value style="display: none">`,
    `\t\t\t\t\t<select name=Opinion_${id} ratingId="${id}">`,
    [100, 75, 50, 25, 0].map(option).join('\n'),
    '\t\t\t\t\t</select>',
    '\t\t\t\t</div>',
    '\t\t\t</td>',
    '\t\t</tr>',
  ].join('\n');
}

/**
 * A publicity row (`mayorpub.asp:155-200`). The visible text is a localised
 * word out of `ePolitics.lng`, so the level is legible only from the option the
 * server marked `selected`.
 */
function publicityRow(id: string, name: string, level: number): string {
  const LABELS: Record<number, string> = {
    100: 'Massive', 75: 'High', 50: 'Medium', 25: 'Low', 0: 'None',
  };
  const option = (v: number): string =>
    `\t\t\t\t\t\t<option value="${v}" ${v === level ? 'selected' : ''}>${LABELS[v]}`;
  return [
    `\t\t<tr style="margin-top: 2px" id=${id}>`,
    '\t\t\t<td class=label',
    '\t\t\t\tonClick="onRowMouseClick()">',
    `\t\t\t\t${name}`,
    '\t\t\t</td>',
    '\t\t\t<td class=value align="right">',
    `\t\t\t\t<div id=LabelDiv_${id} class=value>`,
    `\t\t\t\t\t<span id=Value_${id}>${LABELS[level]}</span>`,
    '\t\t\t\t</div>',
    `\t\t\t\t<div id=OpinionDiv_${id} class=value style="display: none">`,
    `\t\t\t\t\t<select name=Opinion_${id} ratingId="${id}">`,
    [100, 75, 50, 25, 0].map(option).join('\n'),
    '\t\t\t\t\t</select>',
    '\t\t\t\t</div>',
    '\t\t\t</td>',
    '\t\t</tr>',
  ].join('\n');
}

/** A ratings page: the table, and nothing the parsers do not read. */
function ratingsPage(rows: string[]): string {
  return [
    '<body style="background-color: #143833">',
    '\t<table cellpadding=0 cellspacing=0 width="100%">',
    ...rows,
    '\t</table>',
    '</body>',
  ].join('\n');
}

/** `mayorpub.asp:130-143` — the hits/hour sentence, then the table. */
function publicityPage(ads: string, rows: string[]): string {
  return [
    '<body style="background-color: #143833">',
    '\t<div class=label style="margin: 10px">',
    `\t\t${ads}`,
    '\t</div>',
    '\t<table cellpadding=0 cellspacing=0 width="100%" style="margin-top: 10px">',
    ...rows,
    '\t</table>',
    '</body>',
  ].join('\n');
}

/**
 * A campaign project row (`tycooncampaign.asp:253-315`), in both shapes.
 *
 * The `Minister` shape carries the name in the `<input>` the row edits and the
 * proposal state as one of three icons; the goal shape prints a localised
 * comparator and the exact value in `<span id=Value_…>`, next to a `<select>`
 * quantised to steps of 10 that must NOT be read instead.
 */
function ministerProjectRow(id: string, name: string, minister: string, state: 1 | 2 | 3): string {
  const ICONS: Record<number, string> = { 1: 'unknown', 2: 'invalid', 3: 'ok' };
  return [
    `\t\t<tr style="margin-top: 2px" id=${id}>`,
    '\t\t\t<td class=label onClick="onRowMouseClick()">',
    `\t\t\t\t${name}`,
    '\t\t\t</td>',
    '\t\t\t<td class=value align="right" TypeId="Minister">',
    `\t\t\t\t<div id=LabelDiv_${id} class=value>`,
    `\t\t\t\t\t<span id=Value_${id}>`,
    `\t\t\t\t\t\t${minister}`,
    `\t\t\t\t\t\t<img src="images/${ICONS[state]}.jpg" width=14 height=14>`,
    '\t\t\t\t\t</span>',
    '\t\t\t\t</div>',
    `\t\t\t\t<div id=OpinionDiv_${id} class=value style="display: none">`,
    `\t\t\t\t\t<input size=15 name=Opinion_${id} projectId="${id}" value="${minister}">`,
    '\t\t\t\t</div>',
    '\t\t\t</td>',
    '\t\t</tr>',
  ].join('\n');
}

function goalProjectRow(id: string, name: string, comparator: string, value: number): string {
  const bucket = 10 * Math.floor(value / 10);
  const option = (v: number): string =>
    `\t\t\t\t\t\t<option value="${v}" ${v === bucket ? 'selected' : ''}>${v}%`;
  return [
    `\t\t<tr style="margin-top: 2px" id=${id}>`,
    '\t\t\t<td class=label onClick="onRowMouseClick()">',
    `\t\t\t\t${name}`,
    '\t\t\t</td>',
    '\t\t\t<td class=value align="right" TypeId="Goal">',
    `\t\t\t\t<div id=LabelDiv_${id} class=value>`,
    `\t\t\t\t${comparator}`,
    `\t\t\t\t\t<span id=Value_${id}>${value}</span>%`,
    '\t\t\t\t</div>',
    `\t\t\t\t<div id=OpinionDiv_${id} class=value style="display: none">`,
    `\t\t\t\t\t<select name=Opinion_${id} projectId="${id}">`,
    [100, 50, 0].map(option).join('\n'),
    '\t\t\t\t\t</select>',
    '\t\t\t\t</div>',
    '\t\t\t</td>',
    '\t\t</tr>',
  ].join('\n');
}

/**
 * `tycooncampaign.asp` in its running state (`:222-350`): the Withdraw button —
 * the page's only `Cancel=TRUE` link, and therefore the whole of the evidence
 * that a campaign exists — then the project table and the promise textarea.
 */
function campaignPage(): string {
  return [
    '<body style="background-color: #143833">',
    '\t<table style="margin-bottom: 10px">',
    '\t\t<tr>',
    '\t\t\t<td class=button align="left" width="100"',
    '\t\t\t\tonClick="onBtnClick()"',
    `\t\t\t\tinfo="tycooncampaign.asp?WorldName={{worldName}}&Cancel=TRUE"`,
    '\t\t\t\tnormColor="#345950">',
    '\t\t\t\t<nobr>Withdraw Campaign</nobr>',
    '\t\t\t</td>',
    '\t\t</tr>',
    '\t</table>',
    '\t<table cellpadding=0 cellspacing=0 width="100%">',
    ministerProjectRow('42007700', 'Minister of Health', 'SPO_test3', 3),
    ministerProjectRow('42007701', 'Minister of Education', 'None', 1),
    goalProjectRow('42007702', 'Unemployment', 'less than', 12),
    '\t</table>',
    '\t<div>',
    '\t\t<textarea cols=49 rows=7 ID=Textarea1>Lower the taxes, raise the schools.</textarea>',
    '\t</div>',
    '</body>',
  ].join('\n');
}

// =============================================================================
// SCENARIO FACTORY
// =============================================================================

function buildRdoExchanges(electionsOn: boolean): RdoExchange[] {
  const mutations: RdoExchange[] = CIVIC_MUTATIONS.map(m => {
    return {
      id: `civic-rdo-${m.slug}`,
      request: m.request,
      // A `procedure` answers nothing. Not "we did not capture it" — there is
      // no reply to capture, which is the whole of OB-28.
      response: '',
      matchKeys: {
        verb: 'sel',
        targetId: m.targetId,
        action: 'call',
        member: m.member,
        argsPattern: m.args.map(a => a.format()),
      },
    };
  });

  const lookups: RdoExchange[] = CIVIC_ID_LOOKUPS.map(l => {
    const query = `${l.property}\t`;
    return {
      id: `civic-rdo-${l.slug}`,
      request: `C sel ${CIVIC_TARGETS.townHallBlock} call GetPropertyList "^" "%${query}";`,
      response: `A0 res="%${l.value}"`,
      matchKeys: {
        verb: 'sel',
        action: 'call',
        member: 'GetPropertyList',
        argsPattern: [`"%${query}"`],
      },
    };
  });

  const pathReads = buildPathReadExchanges(electionsOn);

  return [...lookups, ...pathReads, ...mutations];
}

function buildHttpExchanges(): HttpExchange[] {
  const page = (id: string, name: string, body: string): HttpExchange => ({
    id: `civic-http-${id}`,
    method: 'GET',
    urlPattern: `${POLITICS_PATH}/${name}`,
    status: 200,
    contentType: 'text/html',
    body,
  });

  return [
    page('popular-ratings', 'popularratings.asp', ratingsPage([
      ratingsRow('Unemployment', '85'),
      ratingsRow('Public Services', '62'),
      ratingsRow('Housing', '47'),
    ])),
    page('ifel-ratings', 'ifelratings.asp', ratingsPage([
      ratingsRow('IFEL Rating', '40'),
      ratingsRow('Commerce', '58'),
    ])),
    page('tycoon-ratings', 'tycoonratings.asp', ratingsPage([
      tycoonRatingRow('41123456', 'Taxation', 75),
      tycoonRatingRow('41123457', 'Public Works', 30),
    ])),
    page('publicity', 'mayorpub.asp', publicityPage(
      'Your publicity reaches 12500 hits per hour.',
      [
        publicityRow('41123456', 'Taxation', 75),
        publicityRow('41123457', 'Public Works', 0),
      ],
    )),
    page('campaign', 'tycooncampaign.asp', campaignPage()),
  ];
}

export function createCivicMutationsScenario(
  overrides?: Partial<ScenarioVariables>,
  opts: { electionsOn?: boolean } = {},
): { rdo: RdoScenario; http: HttpScenario } {
  const vars = mergeVariables(overrides);
  const electionsOn = opts.electionsOn ?? true;

  const rdo: RdoScenario = {
    name: 'civic-mutations',
    description: 'The civic write path: every Politics procedure, and the two id lookups that precede one',
    exchanges: buildRdoExchanges(electionsOn),
    variables: vars as unknown as Record<string, string>,
  };

  const http: HttpScenario = {
    name: 'civic-mutations',
    exchanges: buildHttpExchanges(),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo, http };
}

/**
 * The members this scenario emits, for a parity check against the templates.
 * Derived from the table rather than restated, so adding a mutation above is
 * the only place a member is named.
 */
export const CIVIC_MUTATION_MEMBERS: readonly RdoMemberName[] =
  Array.from(new Set(CIVIC_MUTATIONS.map(m => m.member)));

export { CIVIC_MUTATIONS, CIVIC_ID_LOOKUPS, POLITICS_PATH };
export type { CivicMutation };
