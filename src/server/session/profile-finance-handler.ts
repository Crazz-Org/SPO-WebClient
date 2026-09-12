/**
 * Profile & Finance handler — extracted from StarpeaceSession.
 *
 * Handles tycoon profile, curriculum, bank account, profit/loss, and companies.
 * Each public function takes `ctx: SessionContext` as its first argument.
 */

import type { SessionContext } from './session-context';
import type {
  TycoonProfileFull,
  CurriculumData,
  BankAccountData,
  TransferDenial,
  LoanInfo,
  BankActionResult,
  ProfitLossData,
  ProfitLossNode,
  CompaniesData,
  CompanyListItem,
} from '../../shared/types';
import { extractAllActionUrls } from '../asp-url-extractor';
import { toErrorMessage } from '../../shared/error-utils';
import { fetchWithTimeout } from '../fetch-with-timeout';
import { requireDaParams } from './asp-da-params';
import { isCacheUnavailablePage } from './asp-cache-unavailable';

// ═══════════════════════════════════════════════════════════════════════════
// PRIVATE — ASP money format
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every money value on these pages goes through the same server helper:
 *   `FormatValue = FormatCurrency( value, 0, 0, 0, -1 )`
 * — TycoonCurriculum.asp:17-23, TycoonBankAccount.asp:75-81,
 *   TycoonProfitAndLoses.asp:16-22 (identical bodies), and `FormatValue(0)`
 *   short-circuits to the literal `"$0"`.
 *
 * The 4th argument is `0` (vbFalse) = **do not** use parentheses for negatives,
 * so a loss renders `-$1,234` — the sign lands BEFORE the `$`. The locale's
 * NegativeCurrencyFormat can still produce `($1,234)`; both are accepted below.
 *
 * Anchoring on `$` alone (what this file did) let `[\s\S]*?` swallow the sign:
 * every negative amount was reported positive (audit B-7, B-20).
 */
const ASP_MONEY_SOURCE = String.raw`(\()?\s*(-)?\s*\$\s*(\d[\d,]*(?:\.\d+)?)`;
const ASP_MONEY = new RegExp(ASP_MONEY_SOURCE);

/** Normalise one `FormatValue()` rendering to a signed, group-free string. */
function parseAspMoney(text: string): string | null {
  const m = ASP_MONEY.exec(text);
  if (!m) return null;
  const sign = m[1] || m[2] ? '-' : '';
  return sign + m[3].replace(/,/g, '');
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIVATE — which tycoon is being read
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Which tycoon a profile/curriculum read is about, and whether that is the
 * session user.
 *
 * No name at all is the session user — that is the call every own-profile path
 * has always made. A name is compared against BOTH `activeUsername` and
 * `cachedUsername` case-insensitively: the model server's tycoon names are
 * case-insensitive, and `activeUsername` may hold a role ("Mayor of Helartia")
 * while the directory card carries the plain tycoon name.
 */
function resolveTycoon(ctx: SessionContext, tycoonName?: string): { name: string; isOwn: boolean } {
  const own = ctx.activeUsername || ctx.cachedUsername || '';
  const target = (tycoonName ?? '').trim();
  const sameAs = (candidate: string): boolean =>
    candidate !== '' && candidate.toLowerCase() === target.toLowerCase();
  const isOwn = target === ''
    || sameAs(ctx.activeUsername || '')
    || sameAs(ctx.cachedUsername || '');
  return { name: isOwn ? own : target, isOwn };
}

/**
 * The query of TycoonCurriculum.asp for that tycoon.
 *
 * `buildAspUrl` applies extras with `params.set` (`spo_session.ts:934-938`), so
 * `Tycoon` here REPLACES the session's own. The viewer's `Password` still
 * travels — exactly what "Show Profile" sends (`RenderTycoon.asp:119`) — and it
 * is what makes the server leave `FullAccess` false and withhold the owner-only
 * sections (`TycoonCurriculum.asp:25`, `:175-211`, `:250-261`).
 */
function curriculumParams(name: string, isOwn: boolean): Record<string, string> {
  return isOwn ? { RIWS: '' } : { RIWS: '', Tycoon: name };
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC — fetchTycoonProfile
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param tycoonName Another tycoon's name, or omitted for the session user.
 *   For another tycoon the push-derived fields (ranking, budget, facility
 *   counts, failure level) are seeded neutrally: those pushes describe the
 *   session user and would otherwise be reported as the viewed player's.
 */
export async function fetchTycoonProfile(ctx: SessionContext, tycoonName?: string): Promise<TycoonProfileFull> {
  // GetUserName RDO call removed — the Delphi server does not publish this method
  // (errUnexistentMethod code 5). Use cached username instead.
  const { name, isOwn } = resolveTycoon(ctx, tycoonName);

  const profile: TycoonProfileFull = {
    name,
    realName: '',
    ranking: isOwn ? ctx.lastRanking : 0,
    budget: isOwn ? (ctx.accountMoney || '0') : '0',
    prestige: 0,
    facPrestige: 0,
    researchPrestige: 0,
    facCount: isOwn ? ctx.lastBuildingCount : 0,
    facMax: isOwn ? ctx.lastMaxBuildings : 0,
    area: 0,
    nobPoints: 0,
    licenceLevel: 0,
    failureLevel: isOwn ? (ctx.failureLevel || 0) : 0,
    levelName: '',
    levelTier: 0,
  };

  // Try to enrich with curriculum ASP page data
  try {
    const html = await ctx.fetchAspPage('NewTycoon/TycoonCurriculum.asp', curriculumParams(name, isOwn));
    parseCurriculumHtml(html, profile);
  } catch (e: unknown) {
    ctx.log.warn('[Profile] TycoonCurriculum.asp fetch failed, using push data only:', e);
  }

  // Try to fetch avatar photo from RenderTycoon.asp
  try {
    const worldIp = ctx.currentWorldInfo?.ip;
    const worldName = ctx.currentWorldInfo?.name || '';
    if (worldIp && name) {
      const renderUrl = `http://${worldIp}/five/0/visual/voyager/new%20directory/RenderTycoon.asp?WorldName=${encodeURIComponent(worldName)}&Tycoon=${encodeURIComponent(name)}&RIWS=`;
      const renderHtml = await (await fetchWithTimeout(renderUrl, { redirect: 'follow' })).text();
      const photoMatch = /<img[^>]+id=["']?picture["']?[^>]+src=["']([^"']+)["']/i.exec(renderHtml)
        || /<img[^>]+src=["']([^"']+)["'][^>]+id=["']?picture["']?/i.exec(renderHtml);
      if (photoMatch) {
        const rawUrl = photoMatch[1];
        const baseUrl = `http://${worldIp}/five/0/visual/voyager/new%20directory`;
        // RenderTycoon.asp:58 emits
        //   <img id=picture src="/fivedata/userinfo/<World>/<Tycoon>/largephoto.jpg" …>
        // — root-relative, so it resolves against the HOST. Concatenating it to
        // the page directory produced `…/new%20directory//fivedata/…`, i.e. a
        // guaranteed 404: the avatar was never displayed (audit B-11).
        const fullUrl = rawUrl.startsWith('http')
          ? rawUrl
          : rawUrl.startsWith('/')
            ? `http://${worldIp}${rawUrl}`
            : `${baseUrl}/${rawUrl}`;
        profile.photoUrl = `/proxy-image?url=${encodeURIComponent(fullUrl)}`;
      }
    }
  } catch (e: unknown) {
    ctx.log.warn('[Profile] RenderTycoon.asp photo fetch failed:', e);
  }

  ctx.log.debug(`[Profile] Fetched tycoon profile: ${profile.name} (Ranking #${profile.ranking})`);
  return profile;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIVATE — parseCurriculumHtml
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse TycoonCurriculum.asp HTML to extract level/prestige data into a profile.
 * The ASP page renders level images (e.g., levelParadigm.gif) and prestige values.
 *
 * Markup this reads (TycoonCurriculum.asp:128-161), invariant over the page:
 *
 *     <div class=label style="margin-left: 20px; margin-top: 20px">
 *         Total Prestige:
 *         <span class=value>
 *             1234  points
 *         </span>
 *     </div>
 *
 * The label lives in the SAME `<div class=label>` as the `<span class=value>`,
 * and nothing closes between them. The pattern used to require a `</span>` or
 * `</div>` right after the label, so it matched no real page at all and
 * prestige / nobility stayed 0 (audit B-8). Two more defects came with it:
 * the label is `strTotalPrestige = "Total Prestige"` (eNewTycon.lng:124), not
 * `prestige`; and the page carries NO "Facility prestige", "Research prestige",
 * "Buildings" or "Area" label — neither in the ASP nor in eNewTycon.lng — so
 * those four switch arms were unreachable and are gone. `facCount`/`facMax`
 * keep their RDO-push values; `facPrestige`/`researchPrestige`/`area` have no
 * transport-C source at all.
 */
function parseCurriculumHtml(html: string, profile: TycoonProfileFull): void {
  // Level image: src="images/level<Name>.gif" — extract level name (:229, :235)
  const levelMatch = /images\/level(\w+)\.gif/i.exec(html);
  if (levelMatch) {
    profile.levelName = levelMatch[1]; // e.g., "Paradigm"
  }

  // Label / value pairs — the `<span class=value>` opens INSIDE the label div.
  const kvPattern = /class=label[^>]*>\s*([^<:]+):\s*(?:<[^>]*>\s*)*?<[^>]*\bclass=value[^>]*>\s*([^<]+)/gi;
  let kvMatch;
  while ((kvMatch = kvPattern.exec(html)) !== null) {
    const key = kvMatch[1].trim().toLowerCase();
    const val = kvMatch[2].trim().replace(/[$,\s]/g, '');
    switch (key) {
      // :143 `<%= strTotalPrestige %>:` → "Total Prestige" (eNewTycon.lng:124)
      case 'total prestige': profile.prestige = parseFloat(val) || 0; break;
      // :153 `<%= strNobPoints %>:` → "Nobility" (eNewTycon.lng:125)
      case 'nobility': profile.nobPoints = parseFloat(val) || 0; break;
    }
  }

  // Level names → tier mapping. `legendx` is what :235 renders past level 5
  // (`images/levelLegendX.gif`); without it a Legend+ tycoon fell back to tier 0.
  const levelTiers: Record<string, number> = {
    apprentice: 0, entrepreneur: 1, tycoon: 2, master: 3,
    paradigm: 4, legend: 5, beyondlegend: 6, legendx: 6,
  };
  if (profile.levelName) {
    const tier = levelTiers[profile.levelName.toLowerCase()];
    if (tier !== undefined) {
      profile.levelTier = tier;
      profile.licenceLevel = tier;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC — fetchCurriculumData
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch curriculum data — fetches TycoonCurriculum.asp and parses all sections:
 * summary stats, level progression, rankings, and curriculum items.
 */
export async function fetchCurriculumData(ctx: SessionContext, tycoonName?: string): Promise<CurriculumData> {
  const { name, isOwn } = resolveTycoon(ctx, tycoonName);
  const profile = await fetchTycoonProfile(ctx, isOwn ? undefined : name);
  const levelNames = ['Apprentice', 'Entrepreneur', 'Tycoon', 'Master', 'Paradigm', 'Legend', 'BeyondLegend'];
  const level = Math.min(profile.licenceLevel, levelNames.length - 1);

  // Fetch the raw HTML again for detailed curriculum-specific parsing
  const aspPath = 'NewTycoon/TycoonCurriculum.asp';
  const params = curriculumParams(name, isOwn);
  let html = '';
  let baseUrl = '';
  let unavailable = false;
  try {
    baseUrl = ctx.buildAspUrl(aspPath, params);
    html = await ctx.fetchAspPage(aspPath, params);
  } catch {
    ctx.log.warn('[Profile] TycoonCurriculum.asp re-fetch for curriculum details failed');
    unavailable = true;
  }
  if (isCacheUnavailablePage(html)) unavailable = true;

  const data = parseCurriculumDetails(ctx, html, profile, level, levelNames, baseUrl, isOwn);
  if (unavailable) data.cacheUnavailable = true;
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIVATE — parseCurriculumDetails
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse full curriculum details from TycoonCurriculum.asp HTML.
 * Extracts: fortune, average profit, level descriptions, rankings, curriculum items.
 */
function parseCurriculumDetails(
  ctx: SessionContext,
  html: string,
  profile: TycoonProfileFull,
  level: number,
  levelNames: string[],
  baseUrl: string,
  /**
   * Only the session's OWN page may seed the action-URL cache. Another
   * tycoon's page carries HIS reset/abandon/advance links — caching those under
   * `NewTycoon/TycoonCurriculum.asp` would aim the viewer's own curriculum
   * actions at a stranger's account.
   */
  cacheActions: boolean = true
): CurriculumData {
  // Fortune & Average Profit — the value span opens inside the label div
  // (:128-133, :135-140). Both go through FormatValue, so both can be negative:
  // anchoring the old patterns on `$` dropped the leading `-` (audit B-20).
  let fortune = profile.budget;
  let averageProfit = '';
  const fortuneMatch = /Personal\s+Fortune\s*:\s*(?:<[^>]*>\s*)*([^<]+)/i.exec(html);
  if (fortuneMatch) {
    const money = parseAspMoney(fortuneMatch[1]);
    if (money !== null) fortune = money;
  }
  const profitMatch = /Average\s+Profit[^:]*:\s*(?:<[^>]*>\s*)*([^<]+)/i.exec(html);
  if (profitMatch && ASP_MONEY.test(profitMatch[1])) {
    // :138 renders `<%= FormatValue(...) %>/h` — the `/h` is part of what the
    // reference client shows, so it is kept verbatim; only the sign was lost.
    averageProfit = profitMatch[1].trim().replace(/\s+/g, ' ');
  }

  // Current level description — `<div class=label>` holding Obj.LevelDesc
  // (:242-244), the first one inside the current-level `<td>` (:218).
  let currentLevelDescription = '';
  // The pattern used to demand `<div` or end-of-input right after the closing
  // `</div>`. When neither LevelCond (:245), the upgrade box (:250) nor
  // LevelReqStatus (:262) is rendered the next token is `</td>`, so the engine
  // backtracked to a later label div and returned the WRONG description.
  const levelDescMatch = /<td[^>]*valign="top"[^>]*align="left"[^>]*width=190>[\s\S]*?<div\s+class=label>\s*([\s\S]*?)\s*<\/div>/i.exec(html);
  if (levelDescMatch) {
    // Clean HTML: remove tags, normalize whitespace
    currentLevelDescription = levelDescMatch[1]
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Level badge — src="images/level<Name>.gif" (:228-236); the first match on
  // the page is the current level's image (the next-level column emits
  // `level<Name>Disabled.gif`, which appears later). Resolved against the
  // page URL and served through the proxy already used for the avatar (:111).
  let currentLevelBadgeUrl = '';
  const badgeMatch = /images\/level(\w+)\.gif/i.exec(html);
  if (badgeMatch && baseUrl) {
    try {
      currentLevelBadgeUrl = `/proxy-image?url=${encodeURIComponent(new URL(badgeMatch[0], baseUrl).href)}`;
    } catch {
      // unusable page URL — no badge
    }
  }

  // Level condition — Obj.LevelCond (:245-249), the only bare
  // `<div class=label>` that can immediately follow the description's
  // closing `</div>`: the upgrade box (:250-260) and the banner (:262-266)
  // both carry a `style=` attribute. Anchored on the description match so it
  // never competes with it for the same text.
  let currentLevelCondition = '';
  if (levelDescMatch) {
    const afterDesc = html.slice(levelDescMatch.index + levelDescMatch[0].length);
    const condMatch = /^\s*<div\s+class=label>\s*([\s\S]*?)\s*<\/div>/i.exec(afterDesc);
    if (condMatch) {
      currentLevelCondition = condMatch[1]
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  // Missed-requirement banner — Obj.LevelReqStatus (:262-266), rendered white
  // on maroon when non-empty. The ASP appends a literal `.` (:264), kept.
  let levelReqStatus = '';
  const bannerMatch = /<div\s+class=label\s+style="[^"]*background-color:\s*maroon[^"]*">\s*([\s\S]*?)\s*<\/div>/i.exec(html);
  if (bannerMatch) {
    levelReqStatus = bannerMatch[1]
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Next level name — second <div class=header1>
  let nextLevelName = '';
  const headerMatches = html.match(/<div\s+class=header1>\s*([^<]+)/gi);
  if (headerMatches && headerMatches.length >= 2) {
    const nextMatch = /<div\s+class=header1>\s*([^<]+)/i.exec(headerMatches[1]);
    if (nextMatch) nextLevelName = nextMatch[1].trim();
  }

  // Next level description — label div in the second (right) level td
  let nextLevelDescription = '';
  // Split by the header1 divs to find the next level section
  const nextLevelSectionIdx = html.indexOf(nextLevelName, html.indexOf('Next Level'));
  if (nextLevelSectionIdx > -1) {
    const afterNext = html.substring(nextLevelSectionIdx);
    const descMatch = /<div\s+class=label>\s*([\s\S]*?)\s*<\/div>/i.exec(afterNext);
    if (descMatch) {
      nextLevelDescription = descMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }
  }

  // Next level requirements — after "Requires:" heading
  let nextLevelRequirements = '';
  const reqHeaderIdx = html.indexOf('Requires:');
  if (reqHeaderIdx > -1) {
    const afterReq = html.substring(reqHeaderIdx);
    const reqMatch = /<div\s+class=label[^>]*>\s*([\s\S]*?)\s*<\/div>/i.exec(afterReq);
    if (reqMatch) {
      nextLevelRequirements = reqMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }
  }

  // Can upgrade — the checkbox itself, not the handler name.
  // `function onAdvanceClick()` is declared unconditionally in the <head>
  // (:91), so testing for the identifier was ALWAYS true and the "level up"
  // control was offered to players with no next level, without FullAccess, or
  // on a DEMO account (audit B-9). The checkbox at :257 is rendered exactly
  // under `FullAccess and (NextLevelName <> "") and Demo <> 1` (:250-260).
  const advanceBox = /<input[^>]*\btype="checkbox"[^>]*\bonClick="onAdvanceClick\(\)"[^>]*>/i.exec(html);
  const canUpgrade = advanceBox !== null;
  // :257 emits `checked` inside that same input when Obj.AdvanceToNextLevel.
  const isUpgradeRequested = advanceBox !== null && /\bchecked\b/i.test(advanceBox[0]);

  // Rankings — 3-column grid: <td class=label>Category</td><td ... class=value>N</td>
  const rankings: Array<{ category: string; rank: number | null }> = [];
  const rankSectionMatch = /in\s+the\s+rankings[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (rankSectionMatch) {
    const rankTable = rankSectionMatch[1];
    const rankCellRegex = /<td\s+class=label>\s*([^<]+)<\/td>\s*<td[^>]*class=value[^>]*>\s*([^<]*)/gi;
    let rankMatch;
    while ((rankMatch = rankCellRegex.exec(rankTable)) !== null) {
      const category = rankMatch[1].trim();
      const val = rankMatch[2].trim();
      rankings.push({
        category,
        rank: val === '-' || val === '' ? null : parseInt(val, 10) || null,
      });
    }
  }

  // Curriculum Items — table after "Curriculum items" header
  const curriculumItems: Array<{ item: string; prestige: number }> = [];
  const currItemsMatch = /Curriculum\s+items[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (currItemsMatch) {
    const itemTable = currItemsMatch[1];
    // Each item row: <td class=value>Item text</td> <td class=value>+/-N</td>
    const itemRowRegex = /<td[^>]*class=value[^>]*>\s*([\s\S]*?)\s*<\/td>\s*<td[^>]*class=value[^>]*>\s*([^<]+)/gi;
    let itemMatch;
    while ((itemMatch = itemRowRegex.exec(itemTable)) !== null) {
      const item = itemMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      const prestige = parseInt(itemMatch[2].trim().replace(/[+,\s]/g, ''), 10) || 0;
      if (item) {
        curriculumItems.push({ item, prestige });
      }
    }
  }

  // Ability block, rendered only on tournament worlds (TycoonCurriculum.asp:162-174); the three
  // components are coerced from blank to 0 at :37-53. Captions from eNewTycon.lng:126-129,
  // unit "points" from StrTycoonCurriculum_4 (eNewTycon.lng:72).
  const abilityMatch =
    /Ability\s*:\s*(?:<[^>]*>\s*)*(\d+)\s*points[\s\S]*?\(\s*(\d*)(?:&nbsp;?|\s)*from the rankings\s*,\s*(\d*)(?:&nbsp;?|\s)*for being at the highest level\s*,\s*(\d*)(?:&nbsp;?|\s)*for having loans/i.exec(
      html
    );
  const tournamentOn = abilityMatch !== null;
  const abilityTotal = abilityMatch ? parseInt(abilityMatch[1], 10) || 0 : 0;
  const abilityRankingPoints = abilityMatch ? parseInt(abilityMatch[2], 10) || 0 : 0;
  const abilityLevelPoints = abilityMatch ? parseInt(abilityMatch[3], 10) || 0 : 0;
  const abilityLoanPoints = abilityMatch ? parseInt(abilityMatch[4], 10) || 0 : 0;

  // Extract and cache action URLs from ASP HTML (links to resetTycoon.asp, abandonRole.asp, etc.)
  if (cacheActions && baseUrl && html) {
    const actionUrls = extractAllActionUrls(html, baseUrl);
    if (actionUrls.size > 0) {
      ctx.setAspActionCache('NewTycoon/TycoonCurriculum.asp', actionUrls);
      ctx.log.debug(`[Curriculum] Cached ${actionUrls.size} action URL(s) from ASP HTML`);
    }
  }

  return {
    tycoonName: profile.name,
    currentLevel: level,
    currentLevelName: profile.levelName || levelNames[level] || 'Unknown',
    currentLevelDescription,
    currentLevelBadgeUrl,
    currentLevelCondition,
    levelReqStatus,
    nextLevelName,
    nextLevelDescription,
    nextLevelRequirements,
    canUpgrade,
    isUpgradeRequested,
    fortune,
    averageProfit,
    prestige: profile.prestige,
    facPrestige: profile.facPrestige,
    researchPrestige: profile.researchPrestige,
    budget: profile.budget,
    ranking: profile.ranking,
    facCount: profile.facCount,
    facMax: profile.facMax,
    area: profile.area,
    nobPoints: profile.nobPoints,
    tournamentOn,
    abilityTotal,
    abilityRankingPoints,
    abilityLevelPoints,
    abilityLoanPoints,
    rankings,
    curriculumItems,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC — fetchBankAccount
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch bank account data via TycoonBankAccount.asp on IS HTTP server.
 * Parses budget, loan list, interest rates, and terms from the ASP HTML response.
 */
/** The page as the server renders it, or a throw — executeBankAction needs the throw. */
async function readBankAccountPage(ctx: SessionContext): Promise<{ html: string; baseUrl: string }> {
  const aspPath = 'NewTycoon/TycoonBankAccount.asp';
  const baseUrl = ctx.buildAspUrl(aspPath, { RIWS: '' });
  const html = await ctx.fetchAspPage(aspPath, { RIWS: '' });
  return { html, baseUrl };
}

export async function fetchBankAccount(ctx: SessionContext): Promise<BankAccountData> {
  try {
    const { html, baseUrl } = await readBankAccountPage(ctx);
    const data = parseBankAccountHtml(ctx, html, baseUrl);
    if (isCacheUnavailablePage(html)) data.cacheUnavailable = true;
    return data;
  } catch (e: unknown) {
    ctx.log.warn('[Bank] ASP fetch failed:', e);
    return { ...parseBankAccountHtml(ctx, '', ''), cacheUnavailable: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIVATE — parseBankAccountHtml
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse TycoonBankAccount.asp HTML response.
 * Budget: `var budget = <number>;` in script block.
 * MaxLoan: `var maxVal = new Number(NNN)` in script block.
 * TotalLoans: `var loans = new Number(NNN)` in script block.
 * Loan rows: `<tr id="rN" lid="N">` with cells: Bank, Date, Amount, Interest, Term, Next payment.
 */
function parseBankAccountHtml(ctx: SessionContext, html: string, baseUrl: string): BankAccountData {
  // Extract budget from JS variable
  let balance = ctx.accountMoney || '0';
  const budgetMatch = /var\s+budget\s*=\s*(-?\d+)\s*;/i.exec(html);
  if (budgetMatch) {
    balance = budgetMatch[1];
  }

  // Extract max loan from JS: var maxVal = new Number(NNN)
  let maxLoan = '2500000000';
  const maxValMatch = /var\s+maxVal\s*=\s*new\s+Number\((\d+)\)/i.exec(html);
  if (maxValMatch) {
    maxLoan = maxValMatch[1];
  }

  // Extract total loans from JS: var loans = new Number(NNN)
  let totalLoans = '0';
  const totalLoansMatch = /var\s+loans\s*=\s*new\s+Number\((\d+)\)/i.exec(html);
  if (totalLoansMatch) {
    totalLoans = totalLoansMatch[1];
  }

  // Send panel (:424-508). The cap note (:438) exists only under TransferMoney > 0; every
  // other branch prints an explanation instead. StrTyconBank_18 (:499) is dead — :426 is
  // hardcoded `if true`. The Demo note (:467, :488) may sit beside the cap (:466); the pill
  // follows the Demo note, the cap is still reported.
  const maxTransferMatch = /You can transfer up to \$([0-9,]+)/i.exec(html);
  const maxTransfer = maxTransferMatch ? maxTransferMatch[1].replace(/,/g, '') : undefined;
  let transferDenied: TransferDenial | undefined;
  if (/Since this is a <b>DEMO<\/b> account/i.test(html)) transferDenied = 'demo';           // StrTyconBank_27
  else if (/Money transfers are not allowed in Tournament planets/i.test(html)) transferDenied = 'tournament'; // _28
  else if (/You cannot send money/i.test(html)) transferDenied = 'loans';                    // _16
  else if (/You have no money to send/i.test(html)) transferDenied = 'no-money';             // _17

  // Parse loan rows — <tr id="r0" lid="0" onClick="onRowClick()"> (:550).
  // Cells are read by their own id (`r<i>Bank`, `…Date`, `…Amount`, `…Int`,
  // `…Term`, `…Slice`, :551-566) rather than by position: the old positional
  // walk dropped empty cells (`if (val) cellValues.push(val)`), so an empty
  // Obj.LoanBankName(i) shifted all six fields one column left and the loan was
  // shown with the date under "bank", the rate under "amount"… (audit B-16).
  // Those ids are the reference client's own handles — onRowClick() addresses
  // `document.all[rid + "Bank"]` … `+ "Slice"` (:260-265).
  const loans: LoanInfo[] = [];
  const loanRowRegex = /<tr[^>]*\bid\s*=\s*"?r(\d+)"?[^>]*\blid\s*=\s*"?(\d+)"?/gi;
  let loanMatch;
  while ((loanMatch = loanRowRegex.exec(html)) !== null) {
    const loanIndex = parseInt(loanMatch[2], 10);
    const rowStart = loanMatch.index;
    const nextRowIdx = html.indexOf('</tr>', rowStart);
    if (nextRowIdx === -1) continue;
    const rowHtml = html.substring(rowStart, nextRowIdx);

    const cells = new Map<string, string>();
    // Each cell is read between its own `<td …>` and `</td>` — a tag-skipping
    // group would run past an empty cell into the next one, which is the very
    // shift this replaces. :551 has no space before `class`, hence `[^>]*`:
    //   `<td id="r0Bank"class=value style="…">`
    const cellRegex = /<td[^>]*\bid="r\d+(Bank|Date|Amount|Int|Term|Slice)"[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.set(cellMatch[1], cellMatch[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
    }

    const bank = cells.get('Bank');
    const date = cells.get('Date');
    const amount = cells.get('Amount');
    const interest = cells.get('Int');
    const term = cells.get('Term');
    const slice = cells.get('Slice');
    if (bank !== undefined && date !== undefined && amount !== undefined
      && interest !== undefined && term !== undefined && slice !== undefined) {
      loans.push({
        bank,
        date,
        amount: parseAspMoney(amount) ?? '0',           // :558 FormatValue(LoanAmount(i))
        interest: parseFloat(interest.replace('%', '')) || 0, // :561 `<%= LoanInterest(i) %>%`
        term: parseInt(term, 10) || 0,                  // :564 `<%= LoanTerm(i) %> years`
        slice: parseAspMoney(slice) ?? '0',             // :568 FormatValue(Payment)
        loanIndex,
      });
    }
  }

  // Total next payment — the page publishes it (:573-581): five empty cells,
  // then FormatValue(TotalPayment). Reading the server total instead of
  // re-adding the slices removes any rounding divergence from the reference
  // display (audit B-17). The sum stays as the fallback for a page that has no
  // total row at all — LoanCount = 0 skips the whole table (:525, :611-619).
  const publishedTotal = /(?:<td>\s*<\/td>\s*){5}<td[^>]*\bclass=value[^>]*>\s*([^<]*)/i.exec(html);
  const totalNextPayment = (publishedTotal && parseAspMoney(publishedTotal[1]))
    || String(loans.reduce((sum, l) => sum + (parseFloat(l.slice) || 0), 0));

  // Interest / term defaults. These reproduce computeLoanInfo (:216-238), which
  // onLoad() runs with `round(Obj.IFELLoanEstimated)` whenever FullAccess is
  // true (:246-251) — so the numbers the reference client SHOWS are the
  // computed ones, overwriting the server spans of :354-355. The order matters:
  // the ASP clamps the raw term at 5 and rounds AFTERWARDS (:227-232), we
  // rounded first and clamped after — one year apart on every `.5` fraction.
  const existingLoanTotal = parseFloat(totalLoans) || 0;
  const defaultMaxLoan = parseFloat(maxLoan) || 0;
  const defaultInterest = Math.round((existingLoanTotal + defaultMaxLoan) / 100_000_000);
  const rawTerm = 200 - (existingLoanTotal + defaultMaxLoan) / 10_000_000;
  const defaultTerm = Math.round(rawTerm < 5 ? 5 : rawTerm);

  // Extract and cache action URLs from ASP HTML (forms, JS handlers)
  if (baseUrl) {
    const actionUrls = extractAllActionUrls(html, baseUrl);
    if (actionUrls.size > 0) {
      ctx.setAspActionCache('NewTycoon/TycoonBankAccount.asp', actionUrls);
      ctx.log.debug(`[Bank] Cached ${actionUrls.size} action URL(s) from ASP HTML`);
    }
  }

  return {
    balance,
    maxLoan,
    totalLoans,
    ...(maxTransfer !== undefined ? { maxTransfer } : {}),
    ...(transferDenied ? { transferDenied } : {}),
    totalNextPayment,
    loans,
    defaultInterest,
    defaultTerm,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC — executeBankAction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute a bank action (borrow, send, payoff) via TycoonBankAccount.asp.
 * The legacy Voyager client performs these as GET requests with Action params.
 *
 * **The verdict is a state change, not the absence of a refusal.** The 298 ASP
 * pages carry no `Response.Status` at all, so a refused transaction, a failed
 * `BindTo` and a wrong password all answer HTTP 200. Worse, on this page:
 *
 *   - PAYOFF computes `payoff_error` (:111) and **never renders it** — there is
 *     no `select case payoff_error` anywhere, unlike `loan_error` (:330-343) and
 *     `send_error` (:403-423). No error marker exists on that path at all
 *     (audit B-1 / A-11).
 *   - a wrong password leaves `FullAccess` false (:95), so the `select case
 *     Action` (:97-114) skips the transaction AND the whole `errorText` block
 *     (:320) disappears: a completely normal page, no marker.
 *
 * So the response — which IS the page re-rendered from a cache re-read right
 * after the transaction (:102, :107, :112) — is parsed again and compared with
 * the state read just before. That is also what the reference client shows the
 * player: the refreshed list, no confirmation message.
 *
 * Cost: one extra GET of the page before the mutation. If that read fails we
 * refuse the action rather than move money we cannot verify.
 */
export async function executeBankAction(
  ctx: SessionContext,
  action: string,
  amount?: string,
  toTycoon?: string,
  reason?: string,
  loanIndex?: number
): Promise<BankActionResult> {
  try {
    const worldIp = ctx.currentWorldInfo?.ip;
    if (!worldIp) return { success: false, message: 'World IP not available' };

    // Validate inputs before URL construction
    switch (action) {
      case 'borrow':
        if (!amount) return { success: false, message: 'Amount required' };
        break;
      case 'send':
        if (!amount || !toTycoon) return { success: false, message: 'Amount and recipient required' };
        break;
      case 'payoff':
        if (loanIndex === undefined || loanIndex < 0) return { success: false, message: 'Loan index required' };
        break;
      default:
        return { success: false, message: `Unknown action: ${action}` };
    }

    // Action-specific query params (appended to base URL)
    const actionMap: Record<string, string> = { borrow: 'LOAN', send: 'SEND', payoff: 'PAYOFF' };
    const extraParams = new URLSearchParams({ Action: actionMap[action] });
    if (action === 'borrow') extraParams.set('LoanValue', amount!);
    if (action === 'send') {
      extraParams.set('SendValue', amount!);
      extraParams.set('SendDest', toTycoon!);
      extraParams.set('SendReason', reason || '');
    }
    if (action === 'payoff') extraParams.set('LID', String(loanIndex));

    // The state BEFORE the mutation — the only oracle this page allows.
    const beforePage = await readBankAccountPage(ctx);
    const before = parseBankAccountHtml(ctx, beforePage.html, beforePage.baseUrl);
    if (isCacheUnavailablePage(beforePage.html)) {
      return { success: false, message: `${action} refused: the bank page cannot be read before the action` };
    }

    // 1. Try cached form action URL from last fetchBankAccount() ASP parse
    const cached = ctx.getAspActionCache('NewTycoon/TycoonBankAccount.asp');
    const formAction = cached?.get('TycoonBankAccount.asp');

    let url: string;
    if (formAction) {
      // Append action-specific params to cached base URL
      const separator = formAction.url.includes('?') ? '&' : '?';
      url = formAction.url + separator + extraParams.toString().replace(/\+/g, '%20');
      ctx.log.debug(`[Bank] Using cached form action URL for ${action}`);
    } else {
      // Fallback: reconstruct URL from session state
      const baseParams = new URLSearchParams({
        Tycoon: ctx.activeUsername || ctx.cachedUsername || '',
        Password: ctx.cachedPassword || '',
        Company: ctx.currentCompany?.name || '',
        WorldName: ctx.currentWorldInfo?.name || '',
        ...requireDaParams(ctx),
        SecurityId: '',
      });
      for (const [k, v] of extraParams) baseParams.set(k, v);
      url = `http://${worldIp}/Five/0/Visual/Voyager/NewTycoon/TycoonBankAccount.asp?${baseParams.toString().replace(/\+/g, '%20')}`;
      ctx.log.debug(`[Bank] No cached URL for ${action}, reconstructing`);
    }

    ctx.log.debug(`[Bank] Executing ${action}: ${url}`);
    const response = await fetchWithTimeout(url, { redirect: 'follow' });
    const html = await response.text();

    // The HTML markers below are the ONLY evidence this function used to consult.
    // An error page carrying neither `class=errorText` nor `var budget` therefore
    // reported `success: true` — on borrow, send AND payoff — while the balance
    // shown to the player stayed stale, because setAccountMoney only fires on a
    // budget match. A money mutation must never be reported from the body alone.
    // Same guard as executeCurriculumAction (auto-connection-handler.ts:466).
    if (!response.ok) {
      return { success: false, message: `${action} failed: HTTP ${response.status}` };
    }

    // Explicit refusals, when the page does render one (LOAN :330-343, SEND :403-423)
    const errorMatch = /class=errorText[^>]*>\s*([^<]+)/i.exec(html);
    if (errorMatch) {
      return { success: false, message: errorMatch[1].trim() };
    }

    // The answer is the page re-rendered from the post-transaction cache read.
    // `var budget` (:163) sits in the <head> script, outside every `if`: it is
    // there whatever ObjValid and FullAccess say. An answer without it is not
    // this page, so nothing can be concluded from it — and comparing the
    // parser's own defaults against the previous state would read as a change.
    const budgetMatch = /var\s+budget\s*=\s*(-?\d+)\s*;/i.exec(html);
    if (!budgetMatch) {
      return { success: false, message: `${action} could not be confirmed: the answer is not TycoonBankAccount.asp` };
    }
    ctx.setAccountMoney(budgetMatch[1]);
    const after = parseBankAccountHtml(ctx, html, '');

    switch (action) {
      case 'borrow':
        // RDOAskLoan / RDOPayLoan (:21, :23) move the balance and the debt.
        if (after.balance === before.balance && after.totalLoans === before.totalLoans) {
          return { success: false, message: 'borrow was not applied: the server still reports the same balance and the same debt' };
        }
        break;
      case 'send':
        // RDOSendMoney (:45) debits the sender.
        if (after.balance === before.balance) {
          return { success: false, message: 'send was not applied: the server still reports the same balance' };
        }
        break;
      case 'payoff':
        // RDOPayOff (:65) drops the loan; the table is rebuilt over the
        // remaining `Obj.LoanCount` rows (:525, :549-572), so a successful
        // payoff shows exactly one row fewer.
        if (after.loans.length !== before.loans.length - 1) {
          return { success: false, message: 'payoff was not applied: the loan is still listed' };
        }
        break;
    }

    return { success: true, message: `${action} completed successfully` };
  } catch (e: unknown) {
    return { success: false, message: toErrorMessage(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC — fetchProfitLoss
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch profit & loss data via TycoonProfitAndLoses.asp on IS HTTP server.
 * Parses the full hierarchical P&L tree from the ASP HTML response.
 */
export async function fetchProfitLoss(ctx: SessionContext): Promise<ProfitLossData> {
  try {
    const html = await ctx.fetchAspPage('NewTycoon/TycoonProfitAndLoses.asp', { RIWS: '' });
    const data = parseProfitLossHtml(html);
    if (isCacheUnavailablePage(html)) data.cacheUnavailable = true;
    return data;
  } catch (e: unknown) {
    ctx.log.warn('[ProfitLoss] ASP fetch failed:', e);
    return { ...parseProfitLossHtml(''), cacheUnavailable: true };
  }
}

/** CompanyPage.asp:185 — the one div the parser keys on; only rendered under `if ObjValid` (:139). */
const COMPANY_PAGE_ACCOUNT_ROW = /<div\s+class=labelAccountLevel\d\s+style="margin-left:/i;

/**
 * Fetch one company's P&L via NewTycoon/CompanyPage.asp. Same generator as
 * TycoonProfitAndLoses.asp (one differing line, :236 vs :170), so the tree is
 * parsed by parseProfitLossHtml unchanged. `Company` overrides the active
 * company the base params carry; `CompanyCluster` is what the legacy link
 * sent (chooseCompany.asp) and only picks the icon (:105).
 *
 * An ObjValid=false answer (:296-299) has no account row: parsed as-is it
 * would be the empty default root, so it is refused here instead.
 */
export async function fetchCompanyProfitLoss(ctx: SessionContext, companyName: string, cluster: string): Promise<ProfitLossData> {
  const html = await ctx.fetchAspPage('NewTycoon/CompanyPage.asp', {
    Company: companyName,
    CompanyCluster: cluster,
    RIWS: '',
  });
  if (!COMPANY_PAGE_ACCOUNT_ROW.test(html)) {
    throw new Error(`CompanyPage.asp carries no account tree for "${companyName}"`);
  }
  return parseProfitLossHtml(html);
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIVATE — parseProfitLossHtml
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse TycoonProfitAndLoses.asp HTML response.
 *
 * One `<tr>` per account (:109-195). The label div is
 * `<div class=labelAccountLevel<N> style="margin-left: <30·N>px; margin-right: 5px">`
 * (:119) and the value follows in the next `<td>` (:131-146) — except for
 * level 2, whose value is NOT rendered in its own row: it is stashed in
 * `PrevValue` (:159) and flushed later, in a row of its own, as
 * `<div class=labelAccountLevel2 style="color: …">` (:94-105 between blocks,
 * :206-224 after the last one). That `style="margin-left:` is therefore the
 * discriminator between a real account row and a flush row — without it the
 * flush rows were parsed as accounts of their own, labelled with their amount.
 *
 * Three corrections here, all on this markup:
 *   - the sign: `FormatValue` renders a loss as `-$1,234`, and matching on `$`
 *     alone reported every loss as a gain (audit B-7) — the page colours those
 *     lines #ff7700 (:135-136) precisely because they are negative;
 *   - the flushed level-2 total is now attached to its header instead of being
 *     dropped (the node used to read `$0`);
 *   - `ChartInfo` (:151-153) is looked up inside the row, not in a 500-character
 *     window forward, which used to attribute the NEXT row's chart to this one.
 *
 * A tax account (`Obj.AccountIsTax(i)`) renders two extra cells in the same row: on the
 * level-2 header, the `Town` / `IFEL` captions (:167-178, `isTax` on the header); on each
 * row beneath, the split figures (:179-194) — Town = `AccountValue - AccountSecValue`,
 * IFEL = `AccountSecValue`. Only the IFEL half is stored, as `secAmount`; Town is `amount −
 * secAmount` by construction.
 */
function parseProfitLossHtml(html: string): ProfitLossData {
  const root: ProfitLossNode = {
    label: 'Net Profit (losses)',
    level: 0,
    amount: '0',
    children: [],
  };

  /** This row's markup only, from `fromIdx` up to its `</tr>` (or end of page). */
  function rowScope(fromIdx: number): string {
    const rowEnd = html.indexOf('</tr>', fromIdx);
    return html.substring(fromIdx, rowEnd === -1 ? html.length : rowEnd);
  }

  /** `ChartInfo=<count>,<values…>` inside this row only. */
  function chartOf(fromIdx: number): number[] | undefined {
    const chartMatch = /ChartInfo=(\d+),([-\d,]+)/i.exec(rowScope(fromIdx));
    return chartMatch ? chartMatch[2].split(',').map(v => parseInt(v, 10)) : undefined;
  }

  // Account rows. The value alternative also accepts `</nobr>`, which is what
  // closes an unrendered level-2 value cell (:164-165).
  const rowRegex = new RegExp(
    String.raw`<div\s+class=labelAccountLevel(\d)\s+style="margin-left:[^>]*>\s*<nobr>([\s\S]*?)<\/nobr>`
    + String.raw`[\s\S]*?<\/td>\s*<td[^>]*>[\s\S]*?(?:(` + ASP_MONEY_SOURCE + String.raw`)|<\/nobr>)`,
    'gi',
  );
  // Flush rows carrying a level-2 total: `style="color: white"` / `"color: #ff7700"`.
  const flushRegex = new RegExp(
    String.raw`<div\s+class=labelAccountLevel2\s+style="color:[^>]*>\s*(?:<[^>]*>\s*)*?(` + ASP_MONEY_SOURCE + `)`,
    'gi',
  );
  // Tax section markers (TycoonProfitAndLoses.asp — rendered only when Obj.AccountIsTax(i)).
  // Level-2 header caption cells (:167-178): `Town` / `IFEL`.
  const TAX_CAPTION = /<div\s+class=labelAccountLevel2\s+align="right">/i;
  // Level>2 split figure cells (:179-194): Town = AccountValue - AccountSecValue, then IFEL = AccountSecValue.
  const TAX_SPLIT = new RegExp(
    String.raw`<div\s+class=labelAccountLevel\d\s+style="color:\s*white;\s*padding-left:\s*20px"[^>]*>\s*(` + ASP_MONEY_SOURCE + `)`,
    'gi',
  );

  type Token =
    | { kind: 'row'; index: number; level: number; label: string; money: string | undefined }
    | { kind: 'flush'; index: number; money: string };
  const tokens: Token[] = [];

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    tokens.push({
      kind: 'row',
      index: match.index,
      level: parseInt(match[1], 10),
      // Clean label: strip HTML tags and img elements
      label: match[2].replace(/<[^>]*>/g, '').trim(),
      money: match[3],
    });
  }
  while ((match = flushRegex.exec(html)) !== null) {
    tokens.push({ kind: 'flush', index: match.index, money: match[1] });
  }
  tokens.sort((a, b) => a.index - b.index);

  const nodes: ProfitLossNode[] = [];
  // The level-2 header still waiting for the total the page flushes after it.
  let pendingLevel2: ProfitLossNode | null = null;

  for (const token of tokens) {
    if (token.kind === 'flush') {
      if (pendingLevel2) {
        pendingLevel2.amount = parseAspMoney(token.money) ?? '0';
        pendingLevel2.chartData = chartOf(token.index);
        pendingLevel2 = null;
      }
      continue;
    }

    const amount = token.money ? parseAspMoney(token.money) : null;
    const node: ProfitLossNode = {
      label: token.label || 'Unknown',
      level: token.level,
      amount: amount ?? '0',
      chartData: chartOf(token.index),
      // :121-124 renders every level-2 account as an upper-cased section header.
      isHeader: token.level === 2,
      children: [],
    };
    if (token.level === 2) {
      pendingLevel2 = node;
      if (TAX_CAPTION.test(rowScope(token.index))) node.isTax = true;
    } else if (token.level > 2) {
      const splitMatches = Array.from(rowScope(token.index).matchAll(TAX_SPLIT));
      if (splitMatches.length >= 2) {
        node.isTax = true;
        node.secAmount = parseAspMoney(splitMatches[1][1]) ?? '0';
      }
    }

    nodes.push(node);
  }

  // Build tree: level 0 = root, higher levels nest under their parent
  if (nodes.length > 0) {
    // First node is the root (Net Profit)
    root.label = nodes[0].label;
    root.amount = nodes[0].amount;
    root.chartData = nodes[0].chartData;
  }

  // Stack-based nesting: each node is child of nearest lower-level ancestor
  const stack: ProfitLossNode[] = [root];
  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    // Pop stack until we find a parent with lower level
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (!parent.children) parent.children = [];
    parent.children.push(node);
    stack.push(node);
  }

  return { root };
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC — fetchCompanies
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch companies list via chooseCompany.asp on IS HTTP server.
 * This matches the legacy Voyager client and shows cluster, facility count, etc.
 */
export async function fetchCompanies(ctx: SessionContext): Promise<CompaniesData> {
  const currentCompany = ctx.currentCompany?.name || '';

  try {
    const html = await ctx.fetchAspPage('NewLogon/chooseCompany.asp', {
      Logon: 'FALSE',
      UserName: ctx.activeUsername || ctx.cachedUsername || '',
      RIWS: '',
    });
    const companies = parseCompaniesHtml(ctx, html);
    const worldName = ctx.currentWorldInfo?.name || '';
    // chooseCompany.asp never renders the sentence itself, but the guard costs
    // one regex and keeps the six fetches uniform.
    if (isCacheUnavailablePage(html)) {
      return { companies, currentCompany, worldName, cacheUnavailable: true };
    }
    return { companies, currentCompany, worldName };
  } catch (e: unknown) {
    ctx.log.warn('[Companies] ASP fetch failed:', e);
    const worldName = ctx.currentWorldInfo?.name || '';
    return { companies: [], currentCompany, worldName, cacheUnavailable: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIVATE — parseCompaniesHtml
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse chooseCompany.asp HTML response.
 * Companies: `<td ... companyId="N" companyName="..." companyOwnerRole="...">` elements.
 * Cluster: from CompanyCluster= in "more info" link.
 * Facility count: from "<nobr> N Facilities </nobr>" text.
 */
function parseCompaniesHtml(ctx: SessionContext, html: string): CompanyListItem[] {
  const companies: CompanyListItem[] = [];

  // Match company <td> elements with attributes
  const tdRegex = /<td[^>]*companyId="(\d+)"[^>]*>/gi;
  let tdMatch;

  while ((tdMatch = tdRegex.exec(html)) !== null) {
    const companyId = parseInt(tdMatch[1], 10);
    const tdElement = tdMatch[0];

    // Extract company name
    const nameMatch = /companyName="([^"]+)"/i.exec(tdElement);
    const name = nameMatch ? nameMatch[1] : `Company ${companyId}`;

    // Extract owner role
    const roleMatch = /companyOwnerRole="([^"]*)"/i.exec(tdElement);
    const ownerRole = roleMatch ? roleMatch[1] : ctx.cachedUsername || '';

    // Look ahead in the HTML after this td for cluster and facility count
    const nextTdIdx = html.indexOf('<td', tdMatch.index + tdMatch[0].length);
    const sectionEnd = nextTdIdx > 0 ? nextTdIdx : tdMatch.index + 2000;
    const section = html.substring(tdMatch.index, sectionEnd);

    // Extract cluster from "more info" link: CompanyCluster=<cluster>
    const clusterMatch = /CompanyCluster=(\w+)/i.exec(section);
    const cluster = clusterMatch ? clusterMatch[1] : '';

    // Extract facility count: "N Facilities"
    const facMatch = /(\d+)\s+Facilities/i.exec(section);
    const facilityCount = facMatch ? parseInt(facMatch[1], 10) : 0;

    // Company type — the first <nobr> of `<div class=data>` (chooseCompany.asp:193-197):
    //   `if CompanyOwnerRole <> UserName then <nobr> CompanyOwnerRole </nobr>
    //    else <nobr> strPrivate </nobr>`
    // so it holds either "Private" (NewLogon.lng:7) or the FULL owner role —
    // "Mayor of Rome", "Minister of Health". The old alternation demanded a bare
    // keyword immediately followed by `</nobr>`, failed on every real role, and
    // fell back to 'Private': every public or ministerial company was labelled
    // private, an inversion of meaning (audit B-13). The second <nobr> of that
    // div is the facility count (:198), so anchoring on the div matters.
    const typeMatch = /<div\s+class=data[^>]*>\s*<nobr>\s*([^<]*?)\s*<\/nobr>/i.exec(section);
    const companyType = typeMatch && typeMatch[1] ? typeMatch[1] : 'Private';

    companies.push({
      name,
      companyId,
      ownerRole,
      cluster,
      facilityCount,
      companyType,
    });
  }

  return companies;
}
