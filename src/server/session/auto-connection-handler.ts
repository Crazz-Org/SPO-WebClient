/**
 * Auto-connection, policy, and curriculum-action handler functions.
 *
 * Extracted from `StarpeaceSession` — each public function takes a
 * `SessionContext` as its first argument so it can be tested in isolation.
 */

import type { SessionContext } from './session-context';
import type {
  AutoConnectionsData,
  AutoConnectionFluid,
  SupplierEntry,
  PolicyData,
  PolicyEntry,
} from '../../shared/types';
import { extractAllActionUrls } from '../asp-url-extractor';
import { toErrorMessage } from '../../shared/error-utils';
import { fetchWithTimeout } from '../fetch-with-timeout';
import { withLangId } from '../../shared/language';
import { requireDaParams } from './asp-da-params';
import { isCacheUnavailablePage } from './asp-cache-unavailable';

// ===========================================================================
// ACTION-PAGE OUTCOME
// ===========================================================================

/**
 * Read the outcome of the four plain-text action pages.
 *
 * None of them sets an HTTP status — the 298 ASP pages contain no
 * `Response.Status` at all — but each writes its result as literal text, and
 * every success path ends with `OK.`:
 *
 *   DeleteDefaultSupplier.asp:13-15  `Deleting connection... OK.`
 *   ModifyTradeCenterStatus.asp:26-32 `Setting Hire = true ... OK.`
 *   ModifyWarehouseStatus.asp:25-31   idem
 *   rdoSetAdvanceLevel.asp:25-31      `Setting Value = true ... OK.`
 *
 * The failures are equally literal, and are handed back verbatim as the
 * message: `ERROR: Couldn't bind to Tycoon.` (StrDefaultDupplier_1),
 * `ERROR: Couldn't connect` (StrDefaultDupplier_2), `Operation Failed`,
 * `Connection Failed.`, `Security Failed.` and `ERROR: Cannot perform
 * operation` (StrTyconBank_6) — the last one being what a **wrong password**
 * produces, since every page guards its RDO call with `FullAccess`
 * (ModifyTradeCenterStatus.asp:13-15, ModifyWarehouseStatus.asp:12-14,
 * rdoSetAdvanceLevel.asp:12-14). Only `resp.ok` was read before, so all of
 * those reported success.
 */
function readActionOutcome(action: string, body: string): { success: boolean; message?: string } {
  const text = body.replace(/\s+/g, ' ').trim();
  if (text.endsWith('OK.')) return { success: true };
  return { success: false, message: text || `${action} failed: the server returned an empty page` };
}

// ===========================================================================
// AUTO-CONNECTIONS
// ===========================================================================

/**
 * Fetch the auto-connections page and return parsed fluid/supplier data.
 */
export async function fetchAutoConnections(ctx: SessionContext): Promise<AutoConnectionsData> {
  try {
    const aspPath = 'NewTycoon/TycoonAutoConnections.asp';
    const baseUrl = ctx.buildAspUrl(aspPath, { RIWS: '' });
    const html = await ctx.fetchAspPage(aspPath, { RIWS: '' });
    const data = parseAutoConnectionsHtml(ctx, html, baseUrl);
    if (isCacheUnavailablePage(html)) data.cacheUnavailable = true;
    return data;
  } catch (e: unknown) {
    ctx.log.warn('[AutoConnections] ASP fetch failed:', e);
    return { fluids: [], cacheUnavailable: true };
  }
}

/**
 * Parse TycoonAutoConnections.asp HTML response.
 *
 * Fluid header (:89-91) — the `id` is the internal fluid id, the body is the
 * localised product name `Obj.Properties("AutoConnection<Fluid>Name<LangId>")`:
 *
 *     <div id="PGIPlastics" class=header3 style="color: #EEEECC">
 *         Plastics
 *     </div>
 *
 * That display name used to be captured and then thrown away — both
 * `fluidName` and `fluidId` were set to the id, so the player read
 * `PGIPlastics` instead of `Plastics` (audit B-14).
 *
 * Supplier rows: `<tr id=FluidN fluid=Fluid facilityId="x,y,">` (:44) with the
 * facility and company names in `<div class=value>` (:46-53).
 * Checkboxes: `…HireTC` (:99, always rendered) and `…HireWH` (:103-104, only
 * when the product is storable → `storable`).
 */
function parseAutoConnectionsHtml(ctx: SessionContext, html: string, baseUrl: string): AutoConnectionsData {
  const fluids: AutoConnectionFluid[] = [];

  // Find all fluid header divs: <div id="FluidName" class=header3 style="color: #EEEECC">
  const headerRegex = /<div\s+id="([^"]+)"\s+class=header3[^>]*>\s*([^<]*)/gi;
  let headerMatch;
  const fluidPositions: Array<{ fluidId: string; displayName: string; startIdx: number }> = [];

  while ((headerMatch = headerRegex.exec(html)) !== null) {
    fluidPositions.push({
      fluidId: headerMatch[1],
      displayName: headerMatch[2].trim().replace(/\s+/g, ' '),
      startIdx: headerMatch.index,
    });
  }

  // Process each fluid section
  for (let fi = 0; fi < fluidPositions.length; fi++) {
    const { fluidId, displayName, startIdx } = fluidPositions[fi];
    const fluidName = fluidId; // regex names below are built on the internal id
    const endIdx = fi + 1 < fluidPositions.length ? fluidPositions[fi + 1].startIdx : html.length;
    const section = html.substring(startIdx, endIdx);

    const suppliers: SupplierEntry[] = [];

    // Parse supplier rows: <tr id=FluidN fluid=Fluid onClick="onRowClick()" facilityId="x,y,">
    const rowRegex = /<tr[^>]*\bfluid=(\w+)[^>]*\bfacilityId="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(section)) !== null) {
      const facilityId = rowMatch[2].trim();
      const rowContent = rowMatch[3];

      // Extract facility name and company name from <div class=value> elements
      const valueRegex = /<div\s+class=value[^>]*>\s*([^<]+)/gi;
      const values: string[] = [];
      let valMatch;
      while ((valMatch = valueRegex.exec(rowContent)) !== null) {
        values.push(valMatch[1].trim());
      }

      suppliers.push({
        facilityName: values[0] || 'Unknown',
        facilityId,
        companyName: values[1] || '',
      });
    }

    // Parse trade center checkbox: <input id=FluidHireTC ... fluidId="Fluid" checked>
    const tcRegex = new RegExp(`<input[^>]*id=${fluidName}HireTC[^>]*\\bchecked\\b`, 'i');
    const hireTradeCenter = tcRegex.test(section);

    // Parse warehouse checkbox: <input id=FluidHireWH ... checked>. Its mere
    // presence is the `Storable` flag of :103 — absent means the product cannot
    // be warehoused at all, which is NOT the same as an unchecked box.
    const storable = new RegExp(`<input[^>]*id=${fluidName}HireWH\\b`, 'i').test(section);
    const whRegex = new RegExp(`<input[^>]*id=${fluidName}HireWH[^>]*\\bchecked\\b`, 'i');
    const onlyWarehouses = whRegex.test(section);

    fluids.push({
      fluidName: displayName || fluidId,
      fluidId,
      suppliers,
      hireTradeCenter,
      onlyWarehouses,
      storable,
    });
  }

  // Extract and cache action URLs from ASP HTML (onclick handlers, href links)
  if (baseUrl) {
    const actionUrls = extractAllActionUrls(html, baseUrl);
    if (actionUrls.size > 0) {
      ctx.setAspActionCache('NewTycoon/TycoonAutoConnections.asp', actionUrls);
      ctx.log.debug(`[AutoConnections] Cached ${actionUrls.size} action URL(s) from ASP HTML`);
    }
  }

  return { fluids };
}

/**
 * Execute an auto-connection action via IS HTTP ASP pages.
 * Delete: DeleteDefaultSupplier.asp, Toggle TC: ModifyTradeCenterStatus.asp,
 * Toggle WH: ModifyWarehouseStatus.asp. These match the legacy Voyager pattern.
 *
 * `add` is NOT a page of its own: `AddDefaultSupplier.asp` does not exist in
 * the 2 774 ASP files (audit B-3). Adding a supplier is a **re-request of
 * TycoonAutoConnections.asp** with `Connect=YES&Fluid=&Suppliers=`, which is
 * what drives `RDOAddAutoConnection` (:18-33). The old target 404'd, so the
 * feature never worked once.
 */
export async function executeAutoConnectionAction(
  ctx: SessionContext,
  action: string,
  fluidId: string,
  suppliers?: string
): Promise<{ success: boolean; message?: string }> {
  const worldIp = ctx.currentWorldInfo?.ip;
  if (!worldIp) return { success: false, message: 'World IP not available' };

  // Map action names to ASP filenames for cache lookup. `add` is absent on
  // purpose: its URL carries `Connect=YES` and is always rebuilt (see above).
  const actionToAsp: Record<string, string> = {
    delete: 'DeleteDefaultSupplier.asp',
    hireTradeCenter: 'ModifyTradeCenterStatus.asp',
    dontHireTradeCenter: 'ModifyTradeCenterStatus.asp',
    onlyWarehouses: 'ModifyWarehouseStatus.asp',
    dontOnlyWarehouses: 'ModifyWarehouseStatus.asp',
  };

  const basePath = `http://${worldIp}/Five/0/Visual/Voyager/NewTycoon/`;
  const tycoonId = ctx.tycoonId || '';

  try {
    // 1. Try cached URL from last fetchAutoConnections() ASP parse
    const cached = ctx.getAspActionCache('NewTycoon/TycoonAutoConnections.asp');
    const aspKey = actionToAsp[action];
    const cachedAction = aspKey ? cached?.get(aspKey) : undefined;

    let url: string;

    if (cachedAction) {
      // Use cached base URL, replace dynamic per-action query params
      const cachedUrl = new URL(cachedAction.url);
      cachedUrl.searchParams.set('TycoonId', tycoonId);
      cachedUrl.searchParams.set('FluidId', fluidId);
      if (suppliers) cachedUrl.searchParams.set('Supplier', suppliers);
      if (action === 'hireTradeCenter' || action === 'dontHireTradeCenter') {
        cachedUrl.searchParams.set('Hire', action === 'hireTradeCenter' ? 'YES' : 'NO');
      }
      if (action === 'onlyWarehouses' || action === 'dontOnlyWarehouses') {
        cachedUrl.searchParams.set('Hire', action === 'onlyWarehouses' ? 'YES' : 'NO');
      }
      url = cachedUrl.toString();
      ctx.log.debug(`[AutoConnections] Using cached URL for ${action}`);
    } else {
      // Fallback: reconstruct URL from session state
      switch (action) {
        case 'add': {
          if (!suppliers) return { success: false, message: 'Supplier facility coordinates required' };
          // TycoonAutoConnections.asp:16-33 — the add branch needs FullAccess
          // (Tycoon + Password + WorldName feed `Obj.Password` at :16) and the
          // directory address for the RDO proxy; the target object is
          // `Obj.ObjectId`, resolved server-side (:26), never a TycoonId param.
          const params = new URLSearchParams({
            Tycoon: ctx.activeUsername || ctx.cachedUsername || '',
            Password: ctx.cachedPassword || '',
            WorldName: ctx.currentWorldInfo?.name || '',
            ...requireDaParams(ctx),
            Connect: 'YES',
            Fluid: fluidId,
            Suppliers: suppliers,
            RIWS: '',
          });
          url = `${basePath}TycoonAutoConnections.asp?${params.toString().replace(/\+/g, '%20')}`;
          break;
        }
        case 'delete': {
          if (!suppliers) return { success: false, message: 'Supplier facility ID required' };
          const params = new URLSearchParams({
            TycoonId: tycoonId,
            FluidId: fluidId,
            ...requireDaParams(ctx),
            Supplier: suppliers,
          });
          url = `${basePath}DeleteDefaultSupplier.asp?${params.toString().replace(/\+/g, '%20')}`;
          break;
        }
        case 'hireTradeCenter':
        case 'dontHireTradeCenter': {
          const params = new URLSearchParams({
            TycoonId: tycoonId,
            FluidId: fluidId,
            WorldName: ctx.currentWorldInfo?.name || '',
            Tycoon: ctx.activeUsername || ctx.cachedUsername || '',
            Password: ctx.cachedPassword || '',
            ...requireDaParams(ctx),
            Hire: action === 'hireTradeCenter' ? 'YES' : 'NO',
          });
          url = `${basePath}ModifyTradeCenterStatus.asp?${params.toString().replace(/\+/g, '%20')}`;
          break;
        }
        case 'onlyWarehouses':
        case 'dontOnlyWarehouses': {
          const params = new URLSearchParams({
            TycoonId: tycoonId,
            FluidId: fluidId,
            WorldName: ctx.currentWorldInfo?.name || '',
            Tycoon: ctx.activeUsername || ctx.cachedUsername || '',
            Password: ctx.cachedPassword || '',
            ...requireDaParams(ctx),
            Hire: action === 'onlyWarehouses' ? 'YES' : 'NO',
          });
          url = `${basePath}ModifyWarehouseStatus.asp?${params.toString().replace(/\+/g, '%20')}`;
          break;
        }
        default:
          return { success: false, message: `Unknown action: ${action}` };
      }
      ctx.log.debug(`[AutoConnections] No cached URL for ${action}, reconstructing`);
    }

    ctx.log.debug(`[AutoConnections] Executing ${action}: ${url}`);
    const resp = await fetchWithTimeout(withLangId(url, ctx.languageId), { redirect: 'follow' });
    // `resp.ok` catches the missing page and the IIS fault, nothing else: a
    // refused RDO bind and a wrong password both answer 200 with a different
    // body. The body is the oracle.
    if (!resp.ok) {
      return { success: false, message: `${action} failed: HTTP ${resp.status}` };
    }
    const body = await resp.text();

    if (action === 'add') {
      // The answer IS the auto-connections page re-rendered from a cache
      // re-read performed right after RDOAddAutoConnection (:29). The supplier
      // is there or the add did not happen — and with a wrong password
      // `Count` is forced to 0 (:72-76), so the list comes back empty.
      const after = parseAutoConnectionsHtml(ctx, body, '');
      const fluid = after.fluids.find(f => f.fluidId === fluidId);
      const added = fluid?.suppliers.some(s => s.facilityId !== '' && suppliers!.includes(s.facilityId));
      if (!added) {
        return { success: false, message: `add failed: ${fluidId} does not list ${suppliers} as a supplier` };
      }
      return { success: true };
    }

    return readActionOutcome(action, body);
  } catch (e: unknown) {
    return { success: false, message: toErrorMessage(e) };
  }
}

// ===========================================================================
// POLICY
// ===========================================================================

/**
 * Fetch policy data (diplomatic relationships) via TycoonPolicy.asp on IS HTTP server.
 */
export async function fetchPolicy(ctx: SessionContext): Promise<PolicyData> {
  try {
    const aspPath = 'NewTycoon/TycoonPolicy.asp';
    const baseUrl = ctx.buildAspUrl(aspPath, { RIWS: '' });
    const html = await ctx.fetchAspPage(aspPath, { RIWS: '' });
    const data = parsePolicyHtml(ctx, html, baseUrl);
    // TycoonPolicy.asp:246 guards on `FullAccess and ObjValid`, so a wrong
    // password shows the same sentence — the page gives nothing to tell them
    // apart, and "the server could not read your profile" is the honest
    // rendering of both.
    if (isCacheUnavailablePage(html)) data.cacheUnavailable = true;
    return data;
  } catch (e: unknown) {
    ctx.log.warn('[Policy] ASP fetch failed:', e);
    return { policies: [], alliesAllowed: true, cacheUnavailable: true };
  }
}

/**
 * Parse TycoonPolicy.asp HTML response.
 *
 * One row per policy (`:288-314`, mirrored at `:403-429` when the world has no
 * allies page). `RenderStatusInput` (`:76-102`) emits, for row `i`:
 *
 *     <div class=label id=label0 style="cursor: hand">
 *      <b> <span id=labelspan0 style="color: greenyellow">A</span> </b>
 *     </div>
 *     <select … id=pol0 name="pol0" size="0" index="0" tycoon="Alice" …>
 *
 * and `RenderStatus` (`:64-74`) emits the same shape as `otherspan<i>` for
 * their side (`:311`).
 *
 * `yourPolicy` is read from `labelspan<i>` first, from the selected `<option>`
 * second. Reason: `RenderStatus` switches on the NUMBER (`case 0 :`, :68) while
 * the options compare against a STRING (`if status = "0"`, :92). In VBScript a
 * numeric-vs-string comparison never matches, so exactly one of the two
 * mechanisms fires for a given `Obj.PolTo(i)` type — and which one is
 * `[INFERRED]` until a live capture says. Reading both makes the parser
 * indifferent. It also stops the parser from depending on the `value="0"`
 * option that `:96` renders **inside an HTML comment** when the world's
 * `AlliesPageOn` is off.
 *
 * `RenderStatus` emits nothing at all when the status is `""` (`:66`), on either
 * side: the neutral default below is that case, not a parse failure.
 *
 * `alliesAllowed` reports whether the world's `AlliesPageOn` flag (`:56`) offers the Ally
 * stance at all: when it is off, the Ally `<option value="0">` is rendered inside an HTML
 * comment on every select (`:96`, `:451`).
 */
function parsePolicyHtml(ctx: SessionContext, html: string, baseUrl: string): PolicyData {
  const policies: PolicyEntry[] = [];
  const policyLetterMap: Record<string, number> = { A: 0, N: 1, E: 2 };

  // :96 / :451 — with AlliesPageOn off the Ally option is rendered inside an HTML
  // comment, on the row selects and on the set-by-name select alike. Its presence
  // in a comment is the only signal the page gives; a page carrying no such
  // comment (allies on, or no table at all) leaves Ally offered as before.
  const alliesAllowed = !/<!--\s*<option\s+value="0"/i.test(html);

  // Match select elements with tycoon attribute (:83-90). The second select of
  // the page (`name="Status"`, :333 / :448) carries no `tycoon` and is skipped.
  const selectRegex = /<select[^>]*\btycoon="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi;
  let selectMatch;
  let seq = 0;

  while ((selectMatch = selectRegex.exec(html)) !== null) {
    const tycoonName = selectMatch[1];
    const selectTag = selectMatch[0].substring(0, selectMatch[0].indexOf('>') + 1);
    const selectContent = selectMatch[2];

    // Row index — the page's own pairing key (`index="<%= i %>"`, :87). The
    // running counter is the fallback for a page that omits it.
    const indexMatch = /\bindex\s*=\s*"(\d+)"/i.exec(selectTag);
    const idx = indexMatch ? parseInt(indexMatch[1], 10) : seq;

    // Your policy — the letter span first (:78-81), then the selected option.
    const yourLetter = spanLetter(html, `labelspan${idx}`);
    let yourPolicy: number;
    if (yourLetter !== null) {
      yourPolicy = policyLetterMap[yourLetter];
    } else {
      const selectedMatch = /<option\s+value="(\d)"[^>]*\bselected\b/i.exec(selectContent);
      yourPolicy = selectedMatch ? parseInt(selectedMatch[1], 10) : 1;
    }

    // Their policy — <span id=otherspan{idx}> (:311)
    const theirLetter = spanLetter(html, `otherspan${idx}`);
    const theirPolicy = theirLetter !== null ? policyLetterMap[theirLetter] : 1;

    policies.push({ tycoonName, yourPolicy, theirPolicy });
    seq++;
  }

  // Extract and cache action URLs from ASP HTML (forms, links, onclick handlers)
  if (baseUrl) {
    const actionUrls = extractAllActionUrls(html, baseUrl);
    if (actionUrls.size > 0) {
      ctx.setAspActionCache('NewTycoon/TycoonPolicy.asp', actionUrls);
      ctx.log.debug(`[Policy] Cached ${actionUrls.size} action URL(s) from ASP HTML`);
    }
  }

  return { policies, alliesAllowed };
}

/**
 * The `A` / `N` / `E` carried by one `RenderStatus` span (`TycoonPolicy.asp:64-74`),
 * or `null` when the span is absent — which is what an empty status renders.
 *
 * The id must not be a prefix of a longer one: `otherspan1` used to match
 * `otherspan10` as well, pairing row 1 with row 10's letter as soon as a world
 * held eleven policies.
 */
function spanLetter(html: string, spanId: string): string | null {
  const match = new RegExp(`<span\\s+id=${spanId}(?![0-9])[^>]*>\\s*([ANE])`, 'i').exec(html);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Set diplomatic policy towards another tycoon via TycoonPolicy.asp POST.
 * Uses the form action URL extracted from the last fetchPolicy() ASP response
 * when available, falling back to URL reconstruction if the cache is cold.
 *
 * The page publishes **no** result: `RDOSetPolicyStatus` is invoked with `call`
 * and its return value is never captured (`:27`, `:38`), and a failed
 * `Connect`/`BindTo` skips the block in silence. But the POST target is the page
 * itself (`action="TycoonPolicy.asp?Action=modify&…"`, `:243`) and the cache is
 * re-read after the modify block (`:49-50`), so the response body is the table
 * as it now stands — the only oracle available is to read the new status back
 * out of it. That is also what the reference client shows: the refreshed table,
 * no confirmation message.
 */
export async function setPolicyStatus(
  ctx: SessionContext,
  tycoonName: string,
  status: number
): Promise<{ success: boolean; message?: string }> {
  const worldIp = ctx.currentWorldInfo?.ip;
  if (!worldIp) return { success: false, message: 'World IP not available' };

  try {
    // 1. Try cached form action URL from last ASP HTML parse
    const cached = ctx.getAspActionCache('NewTycoon/TycoonPolicy.asp');
    const formAction = cached?.get('TycoonPolicy.asp');

    let url: string;
    if (formAction) {
      url = formAction.url;
      ctx.log.debug('[Policy] Using cached form action URL');
    } else {
      // Fallback: reconstruct URL from session state
      const queryParams = new URLSearchParams({
        Action: 'modify',
        WorldName: ctx.currentWorldInfo?.name || '',
        Tycoon: ctx.activeUsername || ctx.cachedUsername || '',
        TycoonId: ctx.tycoonId || '',
        Password: ctx.cachedPassword || '',
        ...requireDaParams(ctx),
      });
      url = `http://${worldIp}/Five/0/Visual/Voyager/NewTycoon/TycoonPolicy.asp?${queryParams.toString().replace(/\+/g, '%20')}`;
      ctx.log.debug('[Policy] No cached URL, reconstructing');
    }

    // 2. POST body matches the form: NextStatus + SubTycoon + Subject + Status
    const body = new URLSearchParams({
      NextStatus: String(status),
      SubTycoon: tycoonName,
      Subject: tycoonName,
      Status: String(status),
    });

    ctx.log.debug(`[Policy] Setting policy for ${tycoonName} to ${status}`);
    const resp = await fetchWithTimeout(withLangId(url, ctx.languageId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'follow',
    });
    if (!resp.ok) {
      return { success: false, message: `Set policy failed: HTTP ${resp.status}` };
    }

    // Read the new state back out of the re-rendered table.
    const after = parsePolicyHtml(ctx, await resp.text(), '');
    const entry = after.policies.find(p => p.tycoonName === tycoonName);
    if (!entry) {
      return { success: false, message: `Set policy failed: ${tycoonName} is not listed in the returned page` };
    }
    if (entry.yourPolicy !== status) {
      return { success: false, message: `Set policy was not applied: ${tycoonName} is still at ${entry.yourPolicy}` };
    }

    return { success: true };
  } catch (e: unknown) {
    return { success: false, message: toErrorMessage(e) };
  }
}

// ===========================================================================
// PROFILE CURRICULUM ACTIONS
// ===========================================================================

/**
 * `abandonRole.asp` is a **confirmation screen**, not an action (audit B-2):
 * `strWarning` + `strDefaultDupplier_4` ("Are you sure you want to renounce your
 * present political duties?") and two buttons (`:85-125`). The real action is
 * `rdoAbandonRole.asp`, which additionally requires `RN` — `Obj.RealName`, read
 * from the cache at `:15` and published nowhere else: the confirmation page's
 * own JS is the only source (`:47`). So the resignation is a two-step, exactly
 * as the reference client performs it.
 *
 * `rdoAbandonRole.asp` publishes no outcome either — `res` (`:27`) is assigned
 * and dropped, and the body is a `window.navigate()` shim (`:39-41`). The state
 * is the oracle: `TycoonCurriculum.asp:175-211` renders `command="abandon"`
 * while `Obj.SuperRole <> 0` and `command="reset"` once the role is gone, both
 * under `FullAccess`.
 */
async function commitAbandonRole(
  ctx: SessionContext,
  confirmationHtml: string,
  confirmationUrl: string,
): Promise<{ success: boolean; message?: string }> {
  const target = extractAllActionUrls(confirmationHtml, confirmationUrl).get('rdoAbandonRole.asp');
  if (!target) {
    return { success: false, message: 'abandonRole failed: the confirmation page carries no rdoAbandonRole.asp URL' };
  }

  ctx.log.debug(`[Curriculum] Confirming abandonRole: ${target.url}`);
  const commit = await fetchWithTimeout(withLangId(target.url, ctx.languageId), { redirect: 'follow' });
  await commit.text();
  if (!commit.ok) {
    return { success: false, message: `abandonRole failed: HTTP ${commit.status}` };
  }

  const curriculum = await ctx.fetchAspPage('NewTycoon/TycoonCurriculum.asp', { RIWS: '' });
  if (/command="abandon"/i.test(curriculum)) {
    return { success: false, message: 'abandonRole was not applied: the role is still held' };
  }
  if (!/command="reset"/i.test(curriculum)) {
    return { success: false, message: 'abandonRole could not be confirmed: the curriculum page offers neither button' };
  }
  return { success: true, message: 'abandonRole completed successfully' };
}

/**
 * Execute a curriculum action: reset account, abandon role, upgrade level, or rebuild links.
 */
export async function executeCurriculumAction(
  ctx: SessionContext,
  action: string,
  value?: boolean
): Promise<{ success: boolean; message?: string }> {
  const worldIp = ctx.currentWorldInfo?.ip;
  if (!worldIp) return { success: false, message: 'World IP not available' };

  // Map action names to ASP filenames for cache lookup.
  // `abandonRole.asp` is the confirmation page — step 1 of two, see
  // commitAbandonRole(). TycoonCurriculum.asp:76 does put it in the cache.
  // `links.asp` is [UNKNOWN]: it exists in no directory of this IIS root, `util`
  // included (audit B-6). The call is left in place — the root is a snapshot,
  // the page may exist on the operated server — and `!resp.ok` turns the 404
  // into a clean failure instead of a silent success.
  const actionToAsp: Record<string, string> = {
    resetAccount: 'rdoResetTycoon.asp',
    abandonRole: 'abandonRole.asp',
    upgradeLevel: 'rdoSetAdvanceLevel.asp',
    rebuildLinks: 'links.asp',
  };

  try {
    // 1. Try cached URL from last fetchCurriculumData() ASP parse
    const cached = ctx.getAspActionCache('NewTycoon/TycoonCurriculum.asp');
    const aspKey = actionToAsp[action];
    const cachedAction = aspKey ? cached?.get(aspKey) : undefined;

    let url: string;
    if (cachedAction) {
      url = cachedAction.url;
      // For upgradeLevel, the cached URL has an empty Value= (dynamic in ASP JS).
      // Substitute with the actual boolean value.
      if (action === 'upgradeLevel' && value !== undefined) {
        url = url.replace(/Value=[^&]*/, `Value=${value}`);
      }
      ctx.log.debug(`[Curriculum] Using cached URL for ${action}`);
    } else {
      // Fallback: reconstruct URL from session state
      switch (action) {
        case 'resetAccount': {
          const params = new URLSearchParams({
            Tycoon: ctx.activeUsername || ctx.cachedUsername || '',
            WorldName: ctx.currentWorldInfo?.name || '',
            ...requireDaParams(ctx),
            TycoonId: '',
            Password: ctx.cachedPassword || '',
          });
          url = `http://${worldIp}/Five/0/Visual/Voyager/NewTycoon/rdoResetTycoon.asp?${params.toString().replace(/\+/g, '%20')}`;
          break;
        }
        case 'abandonRole': {
          const params = new URLSearchParams({
            Tycoon: ctx.activeUsername || ctx.cachedUsername || '',
            WorldName: ctx.currentWorldInfo?.name || '',
            ...requireDaParams(ctx),
            TycoonId: '',
            Password: ctx.cachedPassword || '',
          });
          url = `http://${worldIp}/Five/0/Visual/Voyager/NewTycoon/abandonRole.asp?${params.toString().replace(/\+/g, '%20')}`;
          break;
        }
        case 'upgradeLevel': {
          const params = new URLSearchParams({
            TycoonId: ctx.tycoonId || '',
            Password: ctx.cachedPassword || '',
            Value: String(value ?? true),
            WorldName: ctx.currentWorldInfo?.name || '',
            ...requireDaParams(ctx),
            Tycoon: ctx.activeUsername || ctx.cachedUsername || '',
          });
          url = `http://${worldIp}/Five/0/Visual/Voyager/NewTycoon/rdoSetAdvanceLevel.asp?${params.toString().replace(/\+/g, '%20')}`;
          break;
        }
        case 'rebuildLinks': {
          const params = new URLSearchParams({
            Tycoon: ctx.activeUsername || ctx.cachedUsername || '',
            Password: ctx.cachedPassword || '',
            Company: ctx.currentCompany?.name || '',
            WorldName: ctx.currentWorldInfo?.name || '',
            ...requireDaParams(ctx),
            ISAddr: worldIp,
            ISPort: '8000',
            ClientViewId: String(ctx.interfaceServerId || ''),
            RIWS: '',
          });
          url = `http://${worldIp}/Five/0/visual/voyager/util/links.asp?${params.toString().replace(/\+/g, '%20')}`;
          break;
        }
        default:
          return { success: false, message: `Unknown curriculum action: ${action}` };
      }
      ctx.log.debug(`[Curriculum] No cached URL for ${action}, reconstructing`);
    }

    ctx.log.debug(`[Curriculum] Executing ${action}: ${url}`);
    const resp = await fetchWithTimeout(withLangId(url, ctx.languageId), { redirect: 'follow' });
    const body = await resp.text();
    ctx.log.debug(`[Curriculum] ${action} response: ${resp.status} (${body.length} bytes)`);
    if (!resp.ok) {
      return { success: false, message: `${action} failed: HTTP ${resp.status}` };
    }

    switch (action) {
      case 'abandonRole':
        return commitAbandonRole(ctx, body, url);
      case 'upgradeLevel':
        // rdoSetAdvanceLevel.asp:25-31 — `Setting Value = … OK.`
        return readActionOutcome(action, body);
      case 'resetAccount':
        // rdoResetTycoon.asp:18 redirects to TycoonCurriculum.asp, so with
        // `redirect: 'follow'` the body IS the curriculum page. That page is the
        // only signal available: `res = RDOResetTycoonEx(…)` (:13) is assigned
        // and dropped, so a REFUSED reset is [UNKNOWN] — indistinguishable from
        // a granted one. What is detectable is a tycoon the server cannot read
        // back (StrTycoonCurriculum_14, TycoonCurriculum.asp:417-420).
        if (/cannot retrieve Tycoon information from server/i.test(body)) {
          return { success: false, message: 'resetAccount failed: the server cannot read the tycoon back' };
        }
        return { success: true, message: 'resetAccount completed successfully' };
      default:
        // rebuildLinks — target page [UNKNOWN], nothing to read from the body.
        return { success: true, message: `${action} completed successfully` };
    }
  } catch (e: unknown) {
    return { success: false, message: toErrorMessage(e) };
  }
}
