/**
 * Politics handler — extracted from StarpeaceSession.
 *
 * Every public function takes `ctx: SessionContext` as its first argument.
 * Private helpers (`parsePoliticsRatings`, `fetchMayorDataFromBuilding`,
 * `buildCampaignParams`, `parseCampaignResponse`, `parseRdoConnectionResults`,
 * `getDefaultPoliticsData`) are module-private functions.
 */

import type { SessionContext } from './session-context';
import type {
  PoliticsData,
  PoliticsCampaignEntry,
  PoliticsRatingEntry,
  PoliticsPublicityEntry,
  PoliticsProjectEntry,
  CampaignState,
  ConnectionSearchResult,
} from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { ALL_CONNECTION_ROLES, rolesToMask } from '../../shared/connection-roles';
import { writeRdoFrame } from '../rdo-helpers';
import { splitMultilinePayload as splitMultilinePayloadHelper, isTrueOrdinal } from '../rdo-helpers';
import { toErrorMessage } from '../../shared/error-utils';
import { fetchWithTimeout } from '../fetch-with-timeout';
import { redactUrlCredentials } from '../url-redact';
import { requireDaParams } from './asp-da-params';

// =========================================================================
// PRIVATE HELPERS
// =========================================================================

/** Drop every tag and collapse the ASP source's tabs/newlines to single spaces. */
function stripTags(fragment: string): string {
  return fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * `<td>` whose `class` is exactly `className`, quoted or not, with any number of
 * further attributes before the closing `>`.
 *
 * The `(?![\w-])` boundary is what keeps `class=label` from matching
 * `class=labelAccountLevel2`; the trailing `[^>]*>` is what lets it match the
 * four event handlers `tycoonratings.asp:136-139` hangs off the same cell.
 */
function cellPattern(className: string): RegExp {
  return new RegExp(
    `<td\\b[^>]*\\bclass\\s*=\\s*["']?${className}(?![\\w-])["']?[^>]*>([\\s\\S]*?)</td>`,
    'i',
  );
}

const RATING_LABEL_CELL = cellPattern('label');
const RATING_VALUE_CELL = cellPattern('value');

/**
 * One table row, attributes and body captured separately. The trailing
 * alternation accepts a row the server never closed (a truncated response)
 * without letting the body run into the next row.
 *
 * Group 1 is everything between `<tr` and `>` — that is where `tycoonratings.asp:135`
 * and `mayorpub.asp` hang the rating's cache `Id`. Group 2 is the row body.
 */
const TABLE_ROW = /<tr\b([^>]*)>([\s\S]*?)(?:<\/tr>|(?=<tr\b)|$)/gi;

/**
 * An `id` attribute, quoted or not.
 *
 * Unquoted is the case that matters: the ASP writes `id=<%= CacheObj.Id %>`
 * with no quotes at all (`tycoonratings.asp:135`), so a pattern demanding them
 * would find nothing on the one page whose ids we need.
 */
const ID_ATTR = /\bid\s*=\s*["']?([^"'\s>]+)/i;

/**
 * The option the server marked `selected` inside a row.
 *
 * This is the only trustworthy read of a publicity level: the visible label is
 * `StrMayorPub_5..9` out of `ePolitics.lng` and therefore localised, while the
 * `value` attribute is always the raw 0/25/50/75/100 (`mayorpub.asp:187-191`).
 * `[^>]*?` before `selected` keeps it from jumping past the option's own `>`
 * into the next one.
 */
const SELECTED_OPTION = /<option\s+[^>]*?value\s*=\s*["']?(\d+)["']?[^>]*?\bselected\b/i;

/**
 * A `<div class=label>` — the one-sentence banner both the Politics pages use
 * for their free text.
 *
 * `mayorpub.asp:143` prints the publicity total in one; `tycooncampaign.asp:364`,
 * `:391` and `:400` print the three campaign messages in the only three on that
 * page. The `(?![\w-])` boundary is what stops `class=label` from matching
 * `class=labelAccountLevel2`.
 */
const LABEL_CLASS_DIV = /<div\s+class\s*=\s*["']?label(?![\w-])["']?[^>]*>([\s\S]*?)<\/div>/i;

/** `tycoonratings.asp:153-159` — the opinion dropdown, whose options are percentages too. */
const OPINION_SELECT = /<select\b[\s\S]*?<\/select>/gi;

/**
 * Parse one ratings table. The three Politics pages render the same two-cell row.
 *
 * `popularratings.asp:66-73` (and `ifelratings.asp:64-71`, identical but for the
 * property read):
 *
 *     <tr style="margin-top: 2px">
 *         <td class=label>
 *             <%= CacheObj.Name( LangId ) %>
 *         </td>
 *         <td class=value align="right">
 *             <%= CacheObj.PeopleRating %>%
 *         </td>
 *     </tr>
 *
 * `tycoonratings.asp:135-162` renders the same pair, but hangs four event
 * handlers off each cell and wraps the number two levels deep:
 *
 *     <td class=label
 *         OnMouseOver="onRowMouseOver()" … onClick="onRowMouseClick()">
 *     <td class=value align="right" OnMouseOver=… >
 *         <div id=LabelDiv_<Id> class=value>
 *             <span id=Value_<Id>><%= CacheObj.TycoonsRating %>%</span>
 *
 * Two defects this row-scoped form kills:
 *
 *  - the old pattern demanded `<td class=label>` with an IMMEDIATE `>`, so it
 *    never matched one single `tycoonratings.asp` row — the tab was structurally
 *    empty (audit B-4, second half);
 *  - it also let `[\s\S]*?` run across row boundaries: a value the server
 *    rendered empty paired label N with the value of row N+1 and shifted the
 *    whole table, silently (audit B-18). A row now stands or falls alone.
 *
 * Rows without both cells are skipped by construction: the 1-pixel separator
 * (`popularratings.asp:74-77`) and the trailing note (`tycoonratings.asp:174-187`,
 * a `class=label` cell with no value cell) never reach the output.
 */
export function parsePoliticsRatings(html: string): PoliticsRatingEntry[] {
  const ratings: PoliticsRatingEntry[] = [];
  TABLE_ROW.lastIndex = 0;
  let row: RegExpExecArray | null;
  while ((row = TABLE_ROW.exec(html)) !== null) {
    const labelCell = RATING_LABEL_CELL.exec(row[2]);
    const valueCell = RATING_VALUE_CELL.exec(row[2]);
    if (!labelCell || !valueCell) continue;

    const name = stripTags(labelCell[1]);
    if (!name) continue;

    const text = stripTags(valueCell[1].replace(OPINION_SELECT, ' '));
    const numeric = /-?\d+(?:\.\d+)?/.exec(text);
    const entry: PoliticsRatingEntry = { name, value: numeric ? parseFloat(numeric[0]) : 0 };

    // Only `tycoonratings.asp` carries one, and only its entries can be rated.
    const id = ID_ATTR.exec(row[1]);
    if (id) entry.id = id[1];

    ratings.push(entry);
  }
  return ratings;
}

/**
 * Parse the PUBLICITY tab (`mayorpub.asp:155-200`).
 *
 * Structurally the same two-cell row as the ratings tables, so it reuses their
 * cell patterns, but the value is NOT the text: the cell prints a localised
 * label (`mayorpub.asp:180-190`) and only the `<select>`'s selected option
 * carries the 0/25/50/75/100 the server will accept back.
 *
 * A row with no `id` cannot be sent to `RDOSetPublicity` and is dropped rather
 * than shipped as an unusable control.
 */
export function parsePublicityRows(html: string): PoliticsPublicityEntry[] {
  const rows: PoliticsPublicityEntry[] = [];
  TABLE_ROW.lastIndex = 0;
  let row: RegExpExecArray | null;
  while ((row = TABLE_ROW.exec(html)) !== null) {
    const id = ID_ATTR.exec(row[1]);
    if (!id) continue;

    const labelCell = RATING_LABEL_CELL.exec(row[2]);
    if (!labelCell) continue;
    const name = stripTags(labelCell[1]);
    if (!name) continue;

    const selected = SELECTED_OPTION.exec(row[2]);
    rows.push({ id: id[1], name, level: selected ? parseInt(selected[1], 10) : 0 });
  }
  return rows;
}

/** The sentence above the publicity table, tags stripped. Empty when absent. */
export function parsePublicityAds(html: string): string {
  const match = LABEL_CLASS_DIV.exec(html);
  return match ? stripTags(match[1]) : '';
}

/**
 * Is the session operating as the ruler of this entity?
 *
 * `tycooncampaign.asp:98` — the reference test, and it has two prongs:
 *
 *     IsMayor = (Ucase(TycoonName) = Ucase(Town.ActualRuler))
 *            or (Ucase(TycoonName) = Ucase("Mayor of " + Town.Name))
 *
 * The second prong is not decoration. `TycoonName` is whatever identity the
 * page is fetched with, and ours becomes the ROLE name the moment the player
 * selects their role company (`switchCompany` sets `activeUsername` to
 * `company.ownerRole`, login-handler.ts:660). `ActualRuler` stays the human
 * name, so prong one alone reports the mayor as a stranger to their own
 * campaign page for exactly the session in which they are most likely to be
 * reading it.
 *
 * We add a third comparison the ASP had no need of: the human login name
 * against `ActualRuler`. The gateway keeps both identities, so it can answer
 * the question directly instead of inferring it from a name prefix.
 *
 * On the Capitol the prefix prong is inert — the reference hardcodes
 * `"Mayor of "` there too, and a Capitol's ruler is a president — so the first
 * and third prongs carry it, as they do in the reference.
 *
 * @internal Exported for unit tests.
 */
export function holdsOffice(ctx: SessionContext, rulerName: string, townName: string): boolean {
  const ruler = rulerName.toLowerCase();
  if (ruler === '') return false;
  const active = (ctx.activeUsername || '').toLowerCase();
  const human = (ctx.cachedUsername || '').toLowerCase();
  return (active !== '' && active === ruler)
    || (human !== '' && human === ruler)
    || (active !== '' && active === `mayor of ${townName.toLowerCase()}`);
}

/**
 * Fetch one Politics ratings page.
 *
 * `resp.ok` is the only signal these pages give for "page missing", and it went
 * unread for the whole life of this code: `tycoonratings.asp` was requested as
 * `tycoonsratings.asp`, IIS answered 404 with an HTML error body, the
 * surrounding `try/catch` therefore never fired, and the tab stayed empty
 * without a single log line (audit A-12 / B-4, first half).
 *
 * An absent ratings FOLDER is a different case and is NOT an error: it is a 200
 * with an empty table (`popularratings.asp:60` `if not Itr.Empty`), which
 * legitimately parses to `[]`.
 */
async function fetchPoliticsPage(
  ctx: SessionContext, url: string, label: string
): Promise<string> {
  ctx.log.debug(`[Politics] Fetching ${label} from ${redactUrlCredentials(url)}`);
  const resp = await fetchWithTimeout(url, { redirect: 'follow' });
  if (!resp.ok) {
    ctx.log.warn(`[Politics] ${label} page answered HTTP ${resp.status} — ${redactUrlCredentials(url)}`);
    return '';
  }
  return resp.text();
}

async function fetchRatingsPage(
  ctx: SessionContext, url: string, label: string
): Promise<PoliticsRatingEntry[]> {
  return parsePoliticsRatings(await fetchPoliticsPage(ctx, url, label));
}

/**
 * Read a cache object addressed by PATH rather than by map coordinates.
 *
 * Needed because the ruler's figures do not live on the Town Hall facility.
 * `ActualRuler`, `IFELRating`, `RulerActualPrestige`, `RulerPeriods`,
 * `TownHallId` and the `Prestige{i}` series are written by
 * `TPoliticalTownCacheAgent` onto the TOWN folder object
 * (Kernel/PoliticsCache.pas:134-170) and by `TPresidentialHall.StoreToCache`
 * onto the Capitol's own object (Kernel/WorldPolitics.pas:1393-1420). The
 * facility at (x, y) gets only what `TPoliticalTownHall.StoreToCache` writes —
 * `Capital`, the `Candidate{i}` vote series and the four `Ruler*Cmp*` values
 * (Kernel/TownPolitics.pas:476-491).
 *
 * This is exactly the split `mayordata.asp:10-19` makes: `InitCacheObject(
 * "Towns\<name>.five\" )` for a town, `InitMapCacheObject(x, y)` for the Capitol.
 *
 * A path that does not resolve is not an error and is not special-cased: the
 * Delphi cache server answers `GetPropertyList` with one empty value per
 * requested name whichever object the handle points at, so an unbuilt town
 * arrives as empty strings and {@link fetchRulerData} turns those into zeros —
 * the same shape as a town with no mayor. This mirrors `queryTycoonPoliticalRole`
 * (building-management-handler.ts:41-63), which reads `Tycoons\<name>.five\`
 * the same way.
 */
async function readCacheObjectAtPath(
  ctx: SessionContext, path: string, propertyNames: string[]
): Promise<string[]> {
  await ctx.connectMapService();
  const tempObjectId = await ctx.cacherCreateObject();
  try {
    await ctx.cacherSetPath(tempObjectId, path);
    return await ctx.cacherGetPropertyList(tempObjectId, propertyNames);
  } finally {
    await ctx.cacherCloseObject(tempObjectId);
  }
}

/** The properties `mayordata.asp` and `opositiondata.asp` read, in one list. */
export const RULER_PROPS = [
  'ActualRuler', 'RulerActualPrestige', 'RulerRating', 'TycoonsRating',
  'IFELRating', 'RulerPeriods', 'YearsToElections', 'CampaignCount',
  'TownHallId', 'HasRuler',
] as const;

/**
 * Is this a tournament planet? `header.asp:20-28`, `opositiondata.asp:19-27` and
 * `politics.asp:7-15` all open `world.five` and test `ElectionsOn = "1"` before
 * rendering anything election-related. The flag is written by
 * `TPoliticalWorldCacheAgent` (Kernel/WorldPolitics.pas:2069, :2078) as `1` / `0`
 * (Cache/CacheAgent.pas:150-151), from the `ElectionsOn` config parameter
 * (Kernel/World.pas:7172, default `'1'`).
 *
 * Only the literal `'0'` turns elections off. An empty value or a failed read
 * keeps them on: an unanswered question must never take the campaign panel
 * away from the player — the page then decides, exactly as before.
 */
async function readElectionsOff(ctx: SessionContext): Promise<boolean> {
  try {
    const [electionsOn] = await readCacheObjectAtPath(ctx, 'world.five', ['ElectionsOn']);
    return electionsOn === '0';
  } catch (e: unknown) {
    ctx.log.debug(`[Politics] Could not read ElectionsOn: ${toErrorMessage(e)}`);
    return false;
  }
}

/**
 * `mayordata.asp:39` / `opositiondata.asp:53` — the same portrait path for a
 * ruler and for a candidate. Only the gateway knows the world IP, so it is
 * built here. Empty name → empty string, never a URL to nobody.
 */
function portraitUrl(ctx: SessionContext, worldIp: string, tycoonName: string): string {
  if (!tycoonName) return '';
  return `http://${worldIp}/fivedata/userinfo/${encodeURIComponent(ctx.currentWorldInfo?.name || '')}/${encodeURIComponent(tycoonName)}/largephoto.jpg`;
}

interface RulerData {
  mayorName: string;
  mayorPrestige: number;
  mayorRating: number;
  tycoonsRating: number;
  ifelRating: number;
  mandateNo: number;
  yearsToElections: number;
  campaignCount: number;
  townHallId: number;
  hasRuler: boolean;
  campaigns: PoliticsCampaignEntry[];
}

const EMPTY_RULER_DATA: RulerData = {
  mayorName: '', mayorPrestige: 0, mayorRating: 0, tycoonsRating: 0, ifelRating: 0,
  mandateNo: 0, yearsToElections: 0, campaignCount: 0, townHallId: 0, hasRuler: false,
  campaigns: [],
};

/**
 * The ruler block and the candidate list, off the one cache object that holds
 * both. See {@link readCacheObjectAtPath} for why the address differs between
 * the two building kinds.
 */
async function fetchRulerData(
  ctx: SessionContext, isCapitol: boolean, townName: string, x: number, y: number, worldIp: string
): Promise<RulerData> {
  const read = (props: string[]): Promise<string[]> => isCapitol
    ? ctx.getCacherPropertyListAt(x, y, props)
    : readCacheObjectAtPath(ctx, `Towns\\${townName}.five\\`, props);

  try {
    const values = await read([...RULER_PROPS]);
    if (values.length === 0) return EMPTY_RULER_DATA;

    const campaignCount = parseInt(values[7]) || 0;

    // `Tycoon{i}` / `Rating{i}` / `Prestige{i}` — the campaign series this same
    // object carries (Kernel/PoliticsCache.pas:160-162, WorldPolitics.pas:1396-1398).
    // NOT `Candidate{i}` / `CmpRat{i}`: those belong to the votes series on the
    // FACILITY, which the Votes tab reads and which has no prestige column.
    const campaigns: PoliticsCampaignEntry[] = [];
    if (campaignCount > 0) {
      const candidateProps: string[] = [];
      for (let i = 0; i < campaignCount; i++) {
        candidateProps.push(`Tycoon${i}`, `Rating${i}`, `Prestige${i}`);
      }
      try {
        const candidateValues = await read(candidateProps);
        for (let i = 0; i < campaignCount; i++) {
          const name = candidateValues[i * 3] || '';
          if (!name) continue;
          campaigns.push({
            candidateName: name,
            rating: parseInt(candidateValues[i * 3 + 1]) || 0,
            prestige: parseInt(candidateValues[i * 3 + 2]) || 0,
            photoUrl: portraitUrl(ctx, worldIp, name),
          });
        }
      } catch (e: unknown) {
        ctx.log.debug(`[Politics] Could not fetch campaign candidates: ${toErrorMessage(e)}`);
      }
    }

    return {
      mayorName: values[0] || '',
      mayorPrestige: parseInt(values[1]) || 0,
      mayorRating: parseInt(values[2]) || 0,
      tycoonsRating: parseInt(values[3]) || 0,
      ifelRating: parseInt(values[4]) || 0,
      mandateNo: parseInt(values[5]) || 0,
      yearsToElections: parseInt(values[6]) || 0,
      campaignCount,
      townHallId: parseInt(values[8]) || 0,
      hasRuler: isTrueOrdinal(values[9] ?? ''),
      campaigns,
    };
  } catch (e: unknown) {
    ctx.log.debug(`[Politics] Could not fetch ruler data: ${toErrorMessage(e)}`);
  }
  return EMPTY_RULER_DATA;
}

/**
 * Build URL params for tycooncampaign.asp — parameter for parameter the form the
 * page's own buttons carry (`tycooncampaign.asp:233`, `:380`).
 *
 * Capitol (president): Capitol=YES, x/y = building coords, TownName empty.
 * Town Hall (mayor): TownName=<name>, Capitol/x/y empty.
 *
 * `Recache=YES` is not decoration: `:12` reads it, `:29` and `:90` push it into
 * `Town.Recache` and `CacheObject.Recache`, so the response is re-rendered from
 * a FRESH read of the campaign cache. That is what makes the state-after oracle
 * of `parseCampaignResponse` sound on this page.
 */
function buildCampaignParams(
  ctx: SessionContext,
  action: 'Launch' | 'Cancel' | 'Read', buildingX: number, buildingY: number, townName?: string
): URLSearchParams {
  const isCapitol = !townName;
  const params = new URLSearchParams({
    WorldName: ctx.currentWorldInfo?.name || '',
    TycoonName: ctx.activeUsername || ctx.cachedUsername || '',
    Password: ctx.cachedPassword || '',
    TownName: townName || '',
    ...requireDaParams(ctx),
    Capitol: isCapitol ? 'YES' : '',
    Recache: 'YES',
    x: isCapitol ? String(buildingX) : '',
    y: isCapitol ? String(buildingY) : '',
  });
  // `Read` sends neither marker: `:49` and `:66` fire the RDO call only when
  // `Request("Launch")` / `Request("Cancel")` is non-empty, so the same URL
  // without them renders the panel and mutates nothing.
  if (action !== 'Read') params.set(action, 'TRUE');
  return params;
}

/** Every Politics page takes the same five parameters, plus `Password`. */
function buildPoliticsParams(
  ctx: SessionContext, townName: string, x: number, y: number, isCapitol: boolean
): string {
  const params = new URLSearchParams({
    WorldName: ctx.currentWorldInfo?.name || '',
    TycoonName: ctx.activeUsername || ctx.cachedUsername || '',
    Password: ctx.cachedPassword || '',
    TownName: isCapitol ? '' : townName,
    ...requireDaParams(ctx),
    Capitol: isCapitol ? 'YES' : '',
    x: isCapitol ? String(x) : '',
    y: isCapitol ? String(y) : '',
  });
  // The pages parse their own query string; `+` for a space is a form encoding
  // they do not decode, and town names contain spaces.
  return params.toString().replace(/\+/g, '%20');
}

/**
 * The two mutually exclusive state markers `tycooncampaign.asp` publishes.
 *
 * `:233` renders the "Withdraw Campaign" button — and only that button carries
 * `Cancel=TRUE` — when the campaign exists (`:222` `FullAccess and LaunchError = 0`,
 * `:223` not the ruler, `:224` `CacheObjectValid`).
 * `:380` renders the "Launch Campaign" button — the only `Launch=TRUE` — on the
 * same page when the campaign does NOT exist (`:362`).
 *
 * The third button (`:339`, "Check Minister Names") carries neither, so the two
 * patterns cannot both be true.
 */
const CAMPAIGN_CANCEL_BUTTON = /info\s*=\s*["'][^"']*tycooncampaign\.asp\?[^"']*[?&]Cancel=TRUE/i;
const CAMPAIGN_LAUNCH_BUTTON = /info\s*=\s*["'][^"']*tycooncampaign\.asp\?[^"']*[?&]Launch=TRUE/i;

/** The sentence the page shows, without the button table `:364`/`:372` nests inside it. */
function campaignLabelText(html: string): string {
  const match = LABEL_CLASS_DIV.exec(html);
  return match ? stripTags(match[1].split(/<table\b/i)[0]) : '';
}

export type CampaignAction = 'Launch' | 'Cancel';

/**
 * Read the outcome of a campaign mutation off `tycooncampaign.asp`.
 *
 * **The state after is the oracle.** The page this returns IS the campaign page
 * re-rendered: `:89-96` re-reads the campaign cache object after the RDO call,
 * and `:90` honours `Recache` — which `buildCampaignParams` always sends as
 * `Recache=YES` (`:233`, `:380`, our `:12`). So a launch that took effect is
 * visible in this very response, and the usual COM-cache-freshness reservation
 * does NOT apply to this page.
 *
 * What the previous heuristic — "success = the page carries no `<div class=label>`" —
 * got wrong, in both directions (audit B-5):
 *
 *  ① a **wrong password** makes `FullAccess` false (`:48`), the RDO call is never
 *    issued (`:50`, `:67`), and `:400-413` renders a label div that is EMPTY
 *    because its inner `if FullAccess` is false → reported as success;
 *  ② a `LaunchError` outside {100, 101, 102} falls through a `select case` with
 *    no `case else` (`:402-411`) → same empty div → reported as success;
 *  ③ a **successful withdrawal** makes `CacheObjectValid` false (`:91-96`), so
 *    `:364` renders the "you are not participating" invitation — a non-empty
 *    label div → reported as failure. The nominal path was the failing one.
 *
 * `RDOCancelCampaign`'s own result is not usable: `:76` calls it without
 * assigning (unlike `:59`), so the code never reaches the page.
 */
export function parseCampaignResponse(
  html: string, action: CampaignAction
): { success: boolean; message: string } {
  const campaignRuns = CAMPAIGN_CANCEL_BUTTON.test(html);
  const campaignAbsent = CAMPAIGN_LAUNCH_BUTTON.test(html);
  const published = campaignLabelText(html);

  if (action === 'Launch') {
    if (campaignRuns) {
      return { success: true, message: 'Campaign launched' };
    }
    // Still no campaign: either the page published a reason (`:403` code 100,
    // `:406`/`:408` code 101, `:410` code 102, `:391` already the ruler, `:364`
    // the launch invitation) or it published nothing at all — cases ① and ②.
    return {
      success: false,
      message: published || 'Campaign launch refused — the page published no reason',
    };
  }

  if (campaignAbsent) {
    return { success: true, message: 'Campaign withdrawn' };
  }
  if (campaignRuns) {
    return { success: false, message: 'Campaign withdrawal refused — the campaign is still running' };
  }
  return {
    success: false,
    message: published || 'Campaign withdrawal refused — the page published no reason',
  };
}

// -------------------------------------------------------------------------
// YOUR CAMPAIGN — the project list, the promise, the state
// -------------------------------------------------------------------------

/** `tycooncampaign.asp:263` — `TypeId="Minister"` tells the two row shapes apart. */
const PROJECT_TYPE_ID = /<td\b[^>]*\bTypeId\s*=\s*["']?([^"'\s>]+)/i;

/** `tycooncampaign.asp:287` — the minister name, in the input the row edits. */
const PROJECT_INPUT_VALUE = /<input\b[^>]*\bvalue\s*=\s*"([^"]*)"/i;

/** `tycooncampaign.asp:275-281` — the three proposal-state icons, in state order. */
const PROPOSAL_STATE_IMG = /images\/(unknown|invalid|ok)\.jpg/i;
const PROPOSAL_STATES: Record<string, 1 | 2 | 3> = { unknown: 1, invalid: 2, ok: 3 };

/** The `<div id=LabelDiv_…>` that holds a project row's rendered value. */
const PROJECT_LABEL_DIV = /<div\b[^>]*\bid\s*=\s*["']?LabelDiv_[^\s>"']*["']?[^>]*>([\s\S]*?)<\/div>/i;

/** `<span id=Value_…>` — the exact number, unquantised, unlike the select. */
const PROJECT_VALUE_SPAN = /<span\b[^>]*\bid\s*=\s*["']?Value_[^\s>"']*["']?[^>]*>([\s\S]*?)<\/span>/i;

/** `tycooncampaign.asp:369` — the campaign promise, in the page's only textarea. */
const PROMISE_TEXTAREA = /<textarea\b[^>]*>([\s\S]*?)<\/textarea>/i;

/**
 * Parse the campaign project rows of `tycooncampaign.asp:250-315`.
 *
 * The page renders projects only when a campaign exists (`:222-224`), so an
 * empty result is the normal answer for everyone who is not a candidate — it is
 * not an error and is not logged as one.
 *
 * Two row shapes, told apart by the value cell's `TypeId`:
 *
 *  - `Minister` — a tycoon name, editable as free text (`:287`), with a
 *    validation icon the server picks from `ProposalState` (`:275-281`);
 *  - anything else — a numeric promise, rendered as a localised comparator plus
 *    `<span id=Value_…>N</span>%` (`:295-301`).
 *
 * The number comes from the span, not from the `<select>`: `:302` quantises the
 * select to steps of 10 (`10*(CacheObj.Value \ 10)`) while the span prints
 * `CacheObj.Value` exactly, and showing the player a rounded copy of their own
 * promise is a lie the page itself does not tell.
 */
export function parseCampaignProjects(html: string): PoliticsProjectEntry[] {
  const projects: PoliticsProjectEntry[] = [];
  TABLE_ROW.lastIndex = 0;
  let row: RegExpExecArray | null;
  while ((row = TABLE_ROW.exec(html)) !== null) {
    const id = ID_ATTR.exec(row[1]);
    if (!id) continue;

    const labelCell = RATING_LABEL_CELL.exec(row[2]);
    if (!labelCell) continue;
    const name = stripTags(labelCell[1]);
    if (!name) continue;

    const typeId = PROJECT_TYPE_ID.exec(row[2]);
    if (!typeId) continue;

    if (typeId[1].toLowerCase() === 'minister') {
      const input = PROJECT_INPUT_VALUE.exec(row[2]);
      const state = PROPOSAL_STATE_IMG.exec(row[2]);
      const entry: PoliticsProjectEntry = { id: id[1], name, kind: 'minister' };
      if (input) entry.ministerName = input[1];
      if (state) entry.proposalState = PROPOSAL_STATES[state[1].toLowerCase()];
      projects.push(entry);
      continue;
    }

    const labelDiv = PROJECT_LABEL_DIV.exec(row[2]);
    const entry: PoliticsProjectEntry = { id: id[1], name, kind: 'goal' };
    if (labelDiv) {
      // Everything the page printed before the value span IS the comparator.
      const comparator = stripTags(labelDiv[1].split(/<span\b/i)[0]);
      if (comparator) entry.comparator = comparator;
      const span = PROJECT_VALUE_SPAN.exec(labelDiv[1]);
      const numeric = span ? /-?\d+(?:\.\d+)?/.exec(stripTags(span[1])) : null;
      if (numeric) entry.value = parseFloat(numeric[0]);
    }
    projects.push(entry);
  }
  return projects;
}

/** The campaign promise, or `''` when the page rendered no textarea. */
export function parseCampaignPromise(html: string): string {
  const match = PROMISE_TEXTAREA.exec(html);
  return match ? match[1].trim() : '';
}

/**
 * Read which of the five YOUR CAMPAIGN states `tycooncampaign.asp` is showing.
 *
 * Only two of the five are legible from the markup — the two that carry a
 * button, which is exactly what {@link parseCampaignResponse} already relies on.
 * The remaining three all render the same bare `<div class=label>`
 * (`:391` "you are the ruler", `:400-413` a refusal, and a message with no
 * `case else` when `LaunchError` is outside {100,101,102}), so the page cannot
 * tell them apart and neither can a regex.
 *
 * `isRuler` resolves it without reading a word of localised text: the caller
 * already knows the office holder's name and the player's own, and holding the
 * office is precisely the condition `:223` tests (`not IsMayor`). Everything
 * else that reaches this branch was refused.
 *
 * `noElections` never reaches this parser: it is decided from the cache flag
 * before the page is fetched.
 */
export function parseCampaignState(
  html: string, isRuler: boolean
): { state: CampaignState; message: string } {
  if (CAMPAIGN_CANCEL_BUTTON.test(html)) return { state: 'running', message: '' };
  if (CAMPAIGN_LAUNCH_BUTTON.test(html)) return { state: 'available', message: '' };

  const published = campaignLabelText(html);
  if (isRuler) return { state: 'ruler', message: published };
  return {
    state: 'refused',
    message: published || 'The campaign page published no reason.',
  };
}

/**
 * Parse RDO FindSuppliers/FindClients response.
 * Format: newline-separated rows, each with } delimiters.
 *   FindSuppliers: x}y}FacName}Company}Town}$Price}Quality (7 fields)
 *   FindClients:   x}y}FacName}Company}Town (5 fields)
 */
function parseRdoConnectionResults(
  payload: string, direction: 'input' | 'output'
): ConnectionSearchResult[] {
  const lines = splitMultilinePayloadHelper(payload);
  if (lines.length === 0) return [];

  return lines.map(line => {
    const fields = line.split('}');
    const x = parseInt(fields[0], 10);
    const y = parseInt(fields[1], 10);
    if (isNaN(x) || isNaN(y)) return null;

    const result: ConnectionSearchResult = {
      x, y,
      facilityName: fields[2] || 'Unknown',
      companyName: fields[3] || '',
      town: fields[4] || undefined,
    };

    if (direction === 'input' && fields.length >= 7) {
      result.price = fields[5] || undefined;
      result.quality = fields[6] || undefined;
    }

    return result;
  }).filter((r): r is ConnectionSearchResult => r !== null);
}

/**
 * Prestige a campaign application must clear to be accepted.
 * `tycooncampaign.asp:364-368` prints 200 for a town, 1000 for the Capitol, and
 * `:404-408` repeats the same pair when the server refuses with code 101.
 */
const PRESTIGE_THRESHOLD_TOWN = 200;
const PRESTIGE_THRESHOLD_CAPITOL = 1000;

/** Default politics data returned when the server is unreachable. */
export function getDefaultPoliticsData(townName: string, isCapitol = false): PoliticsData {
  return {
    townName,
    isCapitol,
    hasRuler: false,
    yearsToElections: 0,
    mayorName: '',
    mayorPrestige: 0,
    mayorRating: 0,
    tycoonsRating: 0,
    ifelRating: 0,
    mandateNo: 0,
    rulerPhotoUrl: '',
    // Unknown is not "yes": the offline default must never hand the player a
    // power the server never confirmed.
    isRuler: false,
    popularRatings: [],
    ifelRatings: [],
    tycoonsRatings: [],
    publicity: [],
    publicityAds: '',
    campaignCount: 0,
    campaigns: [],
    campaignState: 'refused',
    campaignMessage: 'Politics data is not available.',
    canLaunchCampaign: false,
    prestigeThreshold: isCapitol ? PRESTIGE_THRESHOLD_CAPITOL : PRESTIGE_THRESHOLD_TOWN,
    projects: [],
    promise: '',
    townHallId: 0,
  };
}

// =========================================================================
// PUBLIC FUNCTIONS
// =========================================================================

/**
 * Fetch politics data for a Town Hall building.
 * Fetches mayor info and ratings from the game server's politics ASP pages.
 *
 * On a tournament planet (`world.five` `ElectionsOn = 0`) the campaign page is
 * not fetched and `campaignState` is `noElections`.
 */
export async function getPoliticsData(
  ctx: SessionContext, townName: string, buildingX: number, buildingY: number,
  isCapitol = false,
): Promise<PoliticsData> {
  const worldIp = ctx.currentWorldInfo?.ip;
  if (!worldIp) {
    return getDefaultPoliticsData(townName, isCapitol);
  }

  try {
    const baseUrl = `http://${worldIp}/Five/0/Visual/Voyager/Politics`;
    const query = buildPoliticsParams(ctx, townName, buildingX, buildingY, isCapitol);

    const popularRatings = await fetchRatingsPage(ctx, `${baseUrl}/popularratings.asp?${query}`, 'popular ratings');
    const ifelRatings = await fetchRatingsPage(ctx, `${baseUrl}/ifelratings.asp?${query}`, 'IFEL ratings');

    // `tycoonratings.asp` — SINGULAR. This call asked for `tycoonsratings.asp`
    // for the whole life of the file; no such page exists among the 2 774 `.asp`
    // of the Voyager tree, so every request 404'd and the tab was permanently
    // empty (audit A-12 / B-4). The page reads the same five parameters as its
    // two siblings (`tycoonratings.asp:6-22`), plus `Password` (`:103`), which
    // `query` already carries.
    let tycoonsRatings: PoliticsRatingEntry[] = [];
    try {
      tycoonsRatings = await fetchRatingsPage(ctx, `${baseUrl}/tycoonratings.asp?${query}`, 'tycoon ratings');
    } catch (e: unknown) {
      // Kept narrower than the outer catch on purpose: a transport failure on
      // this optional tab must not empty the two ratings lists already read.
      ctx.log.warn(`[Politics] Tycoons ratings fetch failed: ${toErrorMessage(e)}`);
    }

    // PUBLICITY — same folder, different property, and the level lives in the
    // `<select>` rather than in the text (`mayorpub.asp:180-191`).
    let publicity: PoliticsPublicityEntry[] = [];
    let publicityAds = '';
    try {
      const pubHtml = await fetchPoliticsPage(ctx, `${baseUrl}/mayorpub.asp?${query}`, 'publicity');
      publicity = parsePublicityRows(pubHtml);
      publicityAds = parsePublicityAds(pubHtml);
    } catch (e: unknown) {
      ctx.log.warn(`[Politics] Publicity fetch failed: ${toErrorMessage(e)}`);
    }

    const rulerData = await fetchRulerData(ctx, isCapitol, townName, buildingX, buildingY, worldIp);

    // Asked ONCE, here, and carried to every consumer in the payload. The
    // campaign panel below needs it, and so does the ratings rail in the
    // browser — which used to re-derive it from the single identity the client
    // happens to keep. One question, one answer (OB-31).
    const isRuler = holdsOffice(ctx, rulerData.mayorName, townName);

    const electionsOff = await readElectionsOff(ctx);

    // YOUR CAMPAIGN — the same page the Launch/Cancel buttons post to, fetched
    // with neither marker so it reports without mutating (`buildCampaignParams`).
    let campaignState: CampaignState = 'refused';
    let campaignMessage = '';
    let projects: PoliticsProjectEntry[] = [];
    let promise = '';
    // On a tournament planet `politics.asp:40-44` loads
    // `tycoonCampaignNoElections.asp` instead — one banner, no button, nothing
    // to parse.
    if (electionsOff) {
      campaignState = 'noElections';
    } else {
      try {
        const params = buildCampaignParams(ctx, 'Read', buildingX, buildingY, isCapitol ? undefined : townName);
        const campaignHtml = await fetchPoliticsPage(
          ctx,
          `${baseUrl}/tycooncampaign.asp?${params.toString().replace(/\+/g, '%20')}`,
          'campaign panel',
        );
        ({ state: campaignState, message: campaignMessage } = parseCampaignState(campaignHtml, isRuler));
        projects = parseCampaignProjects(campaignHtml);
        promise = parseCampaignPromise(campaignHtml);
      } catch (e: unknown) {
        ctx.log.warn(`[Politics] Campaign panel fetch failed: ${toErrorMessage(e)}`);
        campaignMessage = 'The campaign page could not be reached.';
      }
    }

    return {
      townName,
      isCapitol,
      hasRuler: rulerData.hasRuler,
      yearsToElections: rulerData.yearsToElections,
      mayorName: rulerData.mayorName,
      mayorPrestige: rulerData.mayorPrestige,
      mayorRating: rulerData.mayorRating,
      tycoonsRating: rulerData.tycoonsRating,
      ifelRating: rulerData.ifelRating,
      mandateNo: rulerData.mandateNo,
      rulerPhotoUrl: portraitUrl(ctx, worldIp, rulerData.mayorName),
      isRuler,
      popularRatings,
      ifelRatings,
      tycoonsRatings,
      publicity,
      publicityAds,
      campaignCount: rulerData.campaignCount,
      campaigns: rulerData.campaigns,
      campaignState,
      campaignMessage,
      // The page itself is the gate: `tycooncampaign.asp` re-checks prestige,
      // timing and eligibility server-side and answers with a specific denial
      // (`:400-413`). Enabling the button only when the page has already told us
      // there is one to press is the whole check.
      canLaunchCampaign: campaignState === 'available',
      prestigeThreshold: isCapitol ? PRESTIGE_THRESHOLD_CAPITOL : PRESTIGE_THRESHOLD_TOWN,
      projects,
      promise,
      townHallId: rulerData.townHallId,
    };
  } catch (e: unknown) {
    ctx.log.warn(`[Politics] Failed to fetch politics data: ${toErrorMessage(e)}`);
    return getDefaultPoliticsData(townName, isCapitol);
  }
}

/**
 * Cast a vote for a candidate in a Town Hall election.
 * Voyager: VotesSheet.pas — RDOVote(voter, votee) on CurrBlock
 */
export async function politicsVote(
  ctx: SessionContext, buildingX: number, buildingY: number, candidateName: string
): Promise<{ success: boolean; message: string }> {
  try {
    await ctx.connectConstructionService();
    if (!ctx.worldId) throw new Error('Construction service not initialized');

    await ctx.connectMapService();
    const tempObjectId = await ctx.cacherCreateObject();
    let currBlock: string;

    try {
      await ctx.cacherSetObject(tempObjectId, buildingX, buildingY);
      const values = await ctx.cacherGetPropertyList(tempObjectId, ['CurrBlock']);
      currBlock = values[0];
      if (!currBlock) throw new Error(`No CurrBlock at (${buildingX}, ${buildingY})`);
    } finally {
      await ctx.cacherCloseObject(tempObjectId);
    }

    const socket = ctx.getSocket('construction');
    if (!socket) throw new Error('Construction socket unavailable');

    const voterName = ctx.activeUsername || ctx.cachedUsername || '';
    const cmd = rdoCall(
      'RDOVote', parseInt(currBlock),
      RdoValue.string(voterName), RdoValue.string(candidateName),
    ).toFrame();

    ctx.log.debug(`[Politics] Voting: ${voterName} → ${candidateName}`);
    writeRdoFrame(socket, cmd);
    await new Promise(resolve => setTimeout(resolve, 200));

    return { success: true, message: `Voted for ${candidateName}` };
  } catch (e: unknown) {
    ctx.log.warn(`[Politics] Vote failed: ${toErrorMessage(e)}`);
    return { success: false, message: toErrorMessage(e) };
  }
}

// =========================================================================
// THE THREE POLITICS MUTATIONS
//
// All three are declared on the political entity — `TPoliticalTownHall`
// (Kernel/TownPolitics.pas:40,41,45) and, identically, `TPresidentialHall`
// (Kernel/WorldPolitics.pas:256,257,260) — so one code path serves the Town
// Hall and the Capitol, and the bind target is always `TownHallId`.
//
// All three are Pascal `procedure`s. The catalogue says so, which is what makes
// `.toFrame()` emit `"*"` with no QueryId: a `"^"` on a procedure leaves a
// result pointer nobody pops and freezes the shared server. Nothing here writes
// a separator, and nothing here can.
// =========================================================================

/**
 * Resolve the political entity's RDO id for the building at (x, y).
 *
 * Two properties, because the two civic buildings publish it differently and
 * neither publishes both:
 *
 *  - **Capitol.** `TPresidentialHall.StoreToCache` writes `TownHallId` =
 *    `integer(self)` onto its own cache object (Kernel/WorldPolitics.pas:1288,
 *    :1413), which is what `SetObject(x, y)` resolves to. `CurrBlock` is not
 *    written there.
 *  - **Town Hall.** `TPoliticalTownHall.StoreToCache` writes the votes series
 *    and the `Ruler*` values but NO `TownHallId` (Kernel/TownPolitics.pas:476-491);
 *    that one lives on the TOWN FOLDER object (Kernel/PoliticsCache.pas:156).
 *    The facility does carry `CurrBlock` (Kernel/KernelCache.pas:426) — and
 *    `PoliticsCache.pas:156` defines `TownHallId` AS `TownHall.CurrBlock`, so
 *    the two are the same number by construction.
 *
 * Reading both and preferring `TownHallId` therefore lands on the right object
 * for either building without needing to know which one it is. This is also the
 * id `politicsVote` already binds (`CurrBlock`, VotesSheet.pas:258), so all
 * four politics mutations address one object.
 *
 * Returns 0 when neither property is readable. Callers MUST refuse to emit on 0:
 * binding an RDO proxy to object 0 is a request with no destination.
 */
async function resolveTownHallId(
  ctx: SessionContext, buildingX: number, buildingY: number
): Promise<number> {
  const values = await ctx.getCacherPropertyListAt(buildingX, buildingY, ['TownHallId', 'CurrBlock']);
  return (parseInt(values[0] || '', 10) || 0) || (parseInt(values[1] || '', 10) || 0);
}

/**
 * Emit one fire-and-forget politics procedure on the construction socket.
 *
 * Fire-and-forget is not a shortcut: a Pascal `procedure` produces no reply, so
 * there is nothing to await. What comes back to the caller is "the frame went
 * out", and the UI re-reads the page to learn whether it took — the same
 * contract the reference client works under, where `rdoModifyRating.asp` posts
 * into a hidden iframe nobody reads (`tycoonratings.asp:109`).
 */
async function emitPoliticsProcedure(
  ctx: SessionContext,
  buildingX: number, buildingY: number,
  label: string,
  build: (townHallId: number) => string,
): Promise<{ success: boolean; message: string }> {
  try {
    await ctx.connectConstructionService();
    const townHallId = await resolveTownHallId(ctx, buildingX, buildingY);
    if (townHallId === 0) {
      return { success: false, message: `No political entity at (${buildingX}, ${buildingY})` };
    }

    const socket = ctx.getSocket('construction');
    if (!socket) throw new Error('Construction socket unavailable');

    ctx.log.debug(`[Politics] ${label} on TownHallId ${townHallId}`);
    writeRdoFrame(socket, build(townHallId));
    return { success: true, message: '' };
  } catch (e: unknown) {
    ctx.log.warn(`[Politics] ${label} failed: ${toErrorMessage(e)}`);
    return { success: false, message: toErrorMessage(e) };
  }
}

/**
 * Rate the politician in office on one criterion.
 *
 * Voyager reaches this through two different doors — the Tycoons' ratings tab
 * (`tycoonratings.asp:93-115` -> `rdoModifyRating.asp:27`) and the newspaper's
 * rating form (`boardmsg.asp:120`, one call per criterion) — and both end on the
 * same three-argument procedure. The value is a percentage; the newspaper form
 * offers 0..100 in steps of 10 (`boardmsg.asp:344-355`), which is the wider of
 * the two ranges and the one we expose.
 */
export async function politicsSetRating(
  ctx: SessionContext, buildingX: number, buildingY: number, ratingId: string, value: number
): Promise<{ success: boolean; message: string }> {
  const tycoonName = ctx.activeUsername || ctx.cachedUsername || '';
  return emitPoliticsProcedure(
    ctx, buildingX, buildingY, `SetRating ${ratingId}=${value}%`,
    (townHallId) => rdoCall(
      'RDOSetRatingFrom', townHallId,
      RdoValue.string(ratingId), RdoValue.string(tycoonName), RdoValue.int(value),
    ).toFrame(),
  );
}

/**
 * Set how much publicity the ruler buys on one criterion.
 *
 * Ruler-only by design, not by check: `mayorpub.asp:52` disables the control for
 * everyone else, and `rdoModifyPub.asp:15` gates the RDO call on the password.
 * The server-side `RDOSetPublicity` is the real authority — we send what the
 * player asked for and let it decide.
 */
export async function politicsSetPublicity(
  ctx: SessionContext, buildingX: number, buildingY: number, ratingId: string, value: number
): Promise<{ success: boolean; message: string }> {
  return emitPoliticsProcedure(
    ctx, buildingX, buildingY, `SetPublicity ${ratingId}=${value}`,
    (townHallId) => rdoCall(
      'RDOSetPublicity', townHallId,
      RdoValue.string(ratingId), RdoValue.int(value),
    ).toFrame(),
  );
}

/**
 * Set one campaign project — a minister's name or a numeric promise.
 *
 * `data` is a widestring in both cases: `tycooncampaign.asp:195` puts
 * `control.value` into the URL unchanged whether the control was the minister
 * `<input>` or the percentage `<select>`, and `rdoModifyProject.asp:28` passes
 * it through as `CStr`.
 */
export async function politicsSetProjectData(
  ctx: SessionContext, buildingX: number, buildingY: number, projectId: string, data: string
): Promise<{ success: boolean; message: string }> {
  const tycoonName = ctx.activeUsername || ctx.cachedUsername || '';
  return emitPoliticsProcedure(
    ctx, buildingX, buildingY, `SetProjectData ${projectId}`,
    (townHallId) => rdoCall(
      'RDOSetProjectData', townHallId,
      RdoValue.string(tycoonName), RdoValue.string(projectId), RdoValue.string(data),
    ).toFrame(),
  );
}

/**
 * Launch a political campaign via ASP proxy.
 * Fetches tycoonCampaign.asp?Launch=TRUE which calls RDOLaunchCampaign
 * and returns HTML with success or denial message.
 * townName: non-empty for Town Hall (mayor), empty for Capitol (president).
 */
export async function politicsLaunchCampaign(
  ctx: SessionContext, buildingX: number, buildingY: number, townName?: string
): Promise<{ success: boolean; message: string }> {
  const worldIp = ctx.currentWorldInfo?.ip;
  if (!worldIp) {
    return { success: false, message: 'Not connected to world' };
  }

  try {
    const queryParams = buildCampaignParams(ctx, 'Launch', buildingX, buildingY, townName);
    const url = `http://${worldIp}/Five/0/Visual/Voyager/Politics/tycooncampaign.asp?${queryParams.toString().replace(/\+/g, '%20')}`;
    ctx.log.debug(`[Politics] Launching campaign via ASP: ${redactUrlCredentials(url)}`);
    const resp = await fetchWithTimeout(url, { redirect: 'follow' });
    const html = await resp.text();
    // `resp.ok` catches the absent page and the IIS fault, nothing more: the 298
    // Voyager pages carry no `Response.Status`, so a refused launch and a wrong
    // password both answer 200. The body is the oracle — see parseCampaignResponse.
    if (!resp.ok) {
      return { success: false, message: `Launch campaign failed: HTTP ${resp.status}` };
    }
    return parseCampaignResponse(html, 'Launch');
  } catch (e: unknown) {
    ctx.log.warn(`[Politics] LaunchCampaign failed: ${toErrorMessage(e)}`);
    return { success: false, message: toErrorMessage(e) };
  }
}

/**
 * Cancel a political campaign via ASP proxy.
 * Fetches tycoonCampaign.asp?Cancel=TRUE which calls RDOCancelCampaign.
 * townName: non-empty for Town Hall (mayor), empty for Capitol (president).
 */
export async function politicsCancelCampaign(
  ctx: SessionContext, buildingX: number, buildingY: number, townName?: string
): Promise<{ success: boolean; message: string }> {
  const worldIp = ctx.currentWorldInfo?.ip;
  if (!worldIp) {
    return { success: false, message: 'Not connected to world' };
  }

  try {
    const queryParams = buildCampaignParams(ctx, 'Cancel', buildingX, buildingY, townName);
    const url = `http://${worldIp}/Five/0/Visual/Voyager/Politics/tycooncampaign.asp?${queryParams.toString().replace(/\+/g, '%20')}`;
    ctx.log.debug(`[Politics] Cancelling campaign via ASP: ${redactUrlCredentials(url)}`);
    const resp = await fetchWithTimeout(url, { redirect: 'follow' });
    const html = await resp.text();
    // Same reasoning as politicsLaunchCampaign above.
    if (!resp.ok) {
      return { success: false, message: `Cancel campaign failed: HTTP ${resp.status}` };
    }
    return parseCampaignResponse(html, 'Cancel');
  } catch (e: unknown) {
    ctx.log.warn(`[Politics] CancelCampaign failed: ${toErrorMessage(e)}`);
    return { success: false, message: toErrorMessage(e) };
  }
}

/**
 * Search for available suppliers or clients to connect to.
 * Uses RDO FindSuppliers/FindClients on the Cache Server (port 6000, WSObjectCacher).
 *
 * FindSuppliers response: x}y}FacName}Company}Town}$Price}Quality (7 fields)
 * FindClients response:   x}y}FacName}Company}Town (5 fields)
 */
export async function searchConnections(
  ctx: SessionContext,
  buildingX: number, buildingY: number,
  fluidId: string, direction: 'input' | 'output',
  filters?: { company?: string; town?: string; maxResults?: number; roles?: number }
): Promise<ConnectionSearchResult[]> {
  const worldName = ctx.currentWorldInfo?.name || '';
  if (!worldName) {
    ctx.log.warn('[Connections] No world name available for search');
    return [];
  }

  try {
    // Ensure map service is connected (port 6000)
    await ctx.connectMapService();
    if (!ctx.cacherId) {
      ctx.log.warn('[Connections] No cacherId available for search');
      return [];
    }

    const method = direction === 'input' ? 'FindSuppliers' : 'FindClients';
    ctx.log.debug(`[Connections] ${method} for ${fluidId} at (${buildingX}, ${buildingY})`);

    // Delphi: FindSuppliers/FindClients(Output, World, Town, Name: widestring;
    //         Count, X, Y, SortMode, Role: integer) — CacheServerReportForm.pas:108-109
    // Explicit OLEString on every widestring parameter (P-M2): the town and
    // company filters are free text typed by the player.
    const packet = await ctx.sendRdoRequest('map', rdoCall(
      method, ctx.cacherId,
      RdoValue.string(fluidId),                  // Output (widestring)
      RdoValue.string(worldName),                // World (widestring)
      RdoValue.string(filters?.town || ''),      // Town filter (empty = all)
      RdoValue.string(filters?.company || ''),   // Name/company filter (empty = all)
      RdoValue.int(filters?.maxResults || 20),   // Count
      RdoValue.int(buildingX),                   // X
      RdoValue.int(buildingY),                   // Y
      RdoValue.int(1),                           // SortMode (1=quality)
      // TFacilityRoleSet as a byte (CacheCommon.pas:53). `??`, not `||`: no box ticked is a
      // genuine 0 on the wire, as Voyager's byte([]) is; only an absent filter takes the
      // all-checked default — 54 for a supplier search, 78 for a customer one.
      RdoValue.int(filters?.roles ?? rolesToMask(direction, ALL_CONNECTION_ROLES)), // Role bitmask
    ).packet, undefined, TimeoutCategory.SLOW);

    const results = parseRdoConnectionResults(packet.payload || '', direction);
    ctx.log.debug(`[Connections] ${method} returned ${results.length} results`);
    return results;
  } catch (e: unknown) {
    ctx.log.warn(`[Connections] ${direction} search failed: ${toErrorMessage(e)}`);
    return [];
  }
}
