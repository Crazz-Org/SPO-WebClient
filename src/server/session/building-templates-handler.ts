/**
 * building-templates-handler.ts — Cluster browsing, building categories/facilities,
 * and building placement (construction).
 *
 * Extracted from StarpeaceSession (spo_session.ts).
 * Each public function takes `ctx: SessionContext` as its first argument.
 */

import type { SessionContext } from './session-context';
import type {
  ClusterInfo,
  ClusterCategory,
  ClusterFacilityPreview,
  BuildingCategory,
  BuildingInfo,
} from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { deriveResidenceClass } from './session-utils';
import { fetchWithTimeout } from '../fetch-with-timeout';
import { withLangId } from '../../shared/language';
import { parseResultCode } from '../rdo-helpers';
import { VISITOR_COMPANY_ID } from '../../shared/visitor-visa';

// ===========================================================================
// SHARED — HTTP oracle
// ===========================================================================

/**
 * Fetch one Voyager page and hand back its body, or `null` when the server did
 * not serve the page at all.
 *
 * None of these four scrapers used to read `response.status`: an IIS 404 or 500
 * body was parsed as if it were data and the caller got a silent empty list —
 * exactly how `tycoonsratings.asp` stayed unnoticed for the whole life of the
 * politics handler (audit A-12).
 *
 * It is the ONLY thing `status` can tell us here: none of the 298 Voyager pages
 * sets `Response.Status`, so an empty folder, an unknown cluster and a company
 * path that will not open all answer 200 with a different body.
 */
async function fetchVoyagerPage(ctx: SessionContext, url: string, what: string): Promise<string | null> {
  const response = await fetchWithTimeout(withLangId(url, ctx.languageId), { redirect: 'follow' });
  if (!response.ok) {
    ctx.log.error(`[ClusterBrowse] ${what} answered HTTP ${response.status} — ${url}`);
    return null;
  }
  return response.text();
}

// ===========================================================================
// CLUSTER BROWSING
// ===========================================================================

/**
 * Fetch cluster info (description + category list) from info.asp.
 */
export async function fetchClusterInfo(ctx: SessionContext, clusterName: string): Promise<ClusterInfo> {
  if (!ctx.currentWorldInfo) {
    throw new Error('Not logged into world - cannot fetch cluster info');
  }

  const url = `http://${ctx.currentWorldInfo.ip}/Five/0/Visual/Voyager/NewLogon/info.asp?ClusterName=${encodeURIComponent(clusterName)}`;
  ctx.log.debug(`[ClusterBrowse] Fetching cluster info: ${clusterName}`);
  const empty: ClusterInfo = { id: clusterName, displayName: clusterName, description: '', categories: [] };

  try {
    const html = await fetchVoyagerPage(ctx, url, `info.asp for ${clusterName}`);
    return html === null ? empty : parseClusterInfo(ctx, clusterName, html);
  } catch (e: unknown) {
    ctx.log.error(`[ClusterBrowse] Failed to fetch cluster info for ${clusterName}:`, e);
    return empty;
  }
}

/**
 * Parse info.asp HTML to extract cluster description and building categories.
 *
 * Real markup — `info.asp:95`, `:101-116`, `:20-23`:
 *   <table id="main" cluster="<%= ClusterName%>" bgcolor="#345950" …>
 *   <div class="sealExpln" style="padding: 20px">description text</div>
 *   <td id="finger0" … folder="<%= FacItr.Current%>" onClick="onFingerClick()">
 *     <div class="hiLabel"><nobr><%=CacheClass.Name(LangId)%></nobr></div>
 *   </td>
 *
 * The description is empty for any cluster outside the five the `select case` of
 * `:103-114` knows (`Dissidents`, `PGI`, `Moab`, `Mariko`, `Magna`). That is the
 * page, not the parser.
 */
function parseClusterInfo(ctx: SessionContext, clusterName: string, html: string): ClusterInfo {
  // Display name from the `cluster` attribute of the main table — `info.asp:95`.
  // ANCHORED ON `<table id="main"` on purpose: an unanchored /cluster\s*=/i hits
  // `info.asp:53` first, in the <head> script, where `onFingerClick()` builds
  // `"facilityList.asp?Cluster=<%= ClusterName%>&Folder=" + td.folder`. With no
  // quote after `Cluster=`, the capture ran to the closing `"` of the JS string
  // and the UI showed `PGI&Folder=` as the cluster name (audit B-10).
  const clusterAttrMatch = /<table\b[^>]*\bid\s*=\s*["']?main["']?[^>]*\bcluster\s*=\s*["']([^"']*)["']/i.exec(html);
  const displayName = clusterAttrMatch?.[1] || clusterName;

  // Extract description from sealExpln div
  const descMatch = /<div[^>]*class\s*=\s*["']?sealExpln["']?[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  let description = '';
  if (descMatch) {
    description = descMatch[1]
      .replace(/<p>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  // Extract categories from finger elements with folder attribute
  const categories: ClusterCategory[] = [];
  const fingerRegex = /<td[^>]*\sfolder\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = fingerRegex.exec(html)) !== null) {
    const folder = match[1];
    const content = match[2];
    const nameMatch = /<nobr>([\s\S]*?)<\/nobr>/i.exec(content);
    const name = nameMatch ? nameMatch[1].trim() : '';
    if (name && folder) {
      categories.push({ name, folder });
    }
  }

  ctx.log.debug(`[ClusterBrowse] Parsed cluster "${clusterName}": ${categories.length} categories`);
  return { id: clusterName, displayName, description, categories };
}

// ===========================================================================
// CLUSTER FACILITY PREVIEWS
// ===========================================================================

/**
 * Fetch facility previews for a cluster/folder from NewLogon/facilityList.asp.
 * This ASP page does not require a company — suitable for pre-creation browsing.
 */
export async function fetchClusterFacilities(ctx: SessionContext, cluster: string, folder: string): Promise<ClusterFacilityPreview[]> {
  if (!ctx.currentWorldInfo) {
    throw new Error('Not logged into world - cannot fetch cluster facilities');
  }

  const params = new URLSearchParams({ Cluster: cluster, Folder: folder });
  const url = `http://${ctx.currentWorldInfo.ip}/Five/0/Visual/Voyager/NewLogon/facilityList.asp?${params.toString().replace(/\+/g, '%20')}`;
  ctx.log.debug(`[ClusterBrowse] Fetching facilities: ${cluster}/${folder}`);

  try {
    const html = await fetchVoyagerPage(ctx, url, `facilityList.asp for ${cluster}/${folder}`);
    return html === null ? [] : parseClusterFacilities(ctx, html);
  } catch (e: unknown) {
    ctx.log.error(`[ClusterBrowse] Failed to fetch facilities for ${cluster}/${folder}:`, e);
    return [];
  }
}

/**
 * Parse facilityList.asp HTML to extract facility previews.
 *
 * Real markup — `NewLogon/FacilityList.asp:181-236`, one `<span>` per facility:
 *   <span style="width:200px; padding: 3px; …">
 *     <div class=comment style="font-size: 11px; …"><%=CacheClass.Name(LangId)%></div>
 *     <table><tr height=80>
 *       <td><img src=<%= GetBlockIcon( CacheClass.TypicalVisualClass ) %> border="0"/></td>
 *       <td valign="top">
 *         <img src="images/zone-commerce.gif" … title="<%= strBlueZone %>.">
 *         <div class=comment style="font-size: 9px; …">
 *           <%=CacheClass.ImportPrice%><br>
 *           <nobr><%=CacheClass.Size%></nobr>
 *         </div>
 *       </td>
 *     </table>
 *     <div class="description" …><%=CacheClass.Desc(LangId)%><br><%=CacheClass.Requires(LangId)%></div>
 *   </span>
 *
 * The `<nobr>` holds `CacheClass.Size` — a SURFACE, and it used to feed a field
 * named `buildTime` (audit B-12). Proof, twice over: the identical expression at
 * `Build/FacilityList.asp:248` is read into `BuildingInfo.area` by
 * `parseBuildingFacilities` below, and the live capture of that twin page renders
 * it `<nobr>3600 m.</nobr>` — metres, next to `$8,000K`.
 * The field is `area` now.
 */
function parseClusterFacilities(ctx: SessionContext, html: string): ClusterFacilityPreview[] {
  const facilities: ClusterFacilityPreview[] = [];

  // Split on <span> blocks — each facility is wrapped in a <span>
  const spanRegex = /<span[^>]*>([\s\S]*?)<\/span>/gi;
  let match;
  while ((match = spanRegex.exec(html)) !== null) {
    const block = match[1];

    // Extract facility name from first comment div
    const nameMatch = /<div[^>]*class\s*=\s*["']?comment["']?[^>]*font-size:\s*11px[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    if (!name) continue;

    // Extract icon URL (first <img src=...> pointing to /five/icons/ or similar)
    const iconMatch = /<img\s+src\s*=\s*["']?([^"'\s>]*icons[^"'\s>]*)["']?/i.exec(block);
    const iconUrl = iconMatch ? ctx.convertToProxyUrl(iconMatch[1]) : '';

    // Extract zone type from zone image title
    const zoneMatch = /<img[^>]*zone[^>]*title\s*=\s*["']([^"']+)["']/i.exec(block);
    const zoneType = zoneMatch?.[1] || '';

    // Extract price and surface from the second comment div (smaller font) —
    // `NewLogon/FacilityList.asp:225-228`, `ImportPrice` then `Size`.
    const metaMatch = /<div[^>]*class\s*=\s*["']?comment["']?[^>]*font-size:\s*9px[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    let cost = '';
    let area = '';
    if (metaMatch) {
      const metaText = metaMatch[1];
      const costMatch = /(\$[\d,]+\.?\d*\s*[KM]?)/i.exec(metaText);
      cost = costMatch?.[1] || '';
      const areaMatch = /<nobr>([\d,]+\s*m\.)<\/nobr>/i.exec(metaText);
      area = areaMatch?.[1] || '';
    }

    // Extract description
    const descMatch = /<div[^>]*class\s*=\s*["']?description["']?[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    let description = '';
    if (descMatch) {
      description = descMatch[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
    }

    facilities.push({ name, iconUrl, cost, area, zoneType, description });
  }

  ctx.log.debug(`[ClusterBrowse] Parsed ${facilities.length} facility previews`);
  return facilities;
}

// ===========================================================================
// BUILD CONSTRUCTION — CATEGORIES
// ===========================================================================

/**
 * Fetch building categories via HTTP (KindList.asp)
 */
export async function fetchBuildingCategories(ctx: SessionContext, companyName: string): Promise<BuildingCategory[]> {
  if (!ctx.currentWorldInfo || !ctx.cachedUsername) {
    throw new Error('Not logged into world - cannot fetch building categories');
  }

  const params = new URLSearchParams({
    Company: companyName,
    WorldName: ctx.currentWorldInfo.name,
    Cluster: '',
    Tycoon: ctx.activeUsername || ctx.cachedUsername
  });

  const url = `http://${ctx.currentWorldInfo.ip}/five/0/visual/voyager/Build/KindList.asp?${params.toString().replace(/\+/g, '%20')}`;
  ctx.log.debug(`[BuildConstruction] Fetching categories from ${url}`);

  try {
    const html = await fetchVoyagerPage(ctx, url, `KindList.asp for ${companyName}`);
    return html === null ? [] : parseBuildingCategories(ctx, html);
  } catch (e: unknown) {
    ctx.log.error('[BuildConstruction] Failed to fetch categories:', e);
    return [];
  }
}

/**
 * Parse HTML response from KindList.asp to extract building categories.
 *
 * Real markup — `KindList.asp:173-187`, one `<td>` per kind:
 *   <td align="center" valign="bottom" style="…" onClick="onKindClick()"
 *       ref="FacilityList.asp?Company=…&WorldName=…&Cluster=<%=ClusterName%>
 *            &Kind=<%=CacheClass.Id%>&KindName=<%=CacheClass.Name%>
 *            &Folder=<%= FacItr.Current%>&TycoonLevel=<%=TycoonLevel%>"
 *       normColor="black" hiColor="#3A5950">
 *     <img title="<%=CacheClass.Name(LangId)%>" src="<%= GetKindIcon(…) %>" …>
 *     <div class=link><%=CacheClass.Name(LangId)%></div>
 *   </td>
 *
 * The two leading cells are NOT kinds and are correctly skipped by the
 * `FacilityList.asp` requirement in the ref: `:104` is `ref="RoadOptions.asp"`
 * and `:127` is `ref="MayorOptions.asp?…"`; their disabled twins (`:113`, `:146`)
 * carry no ref at all.
 *
 * KNOWN, ACCEPTED DIVERGENCE — the label. `:178` puts `KindName=<%=CacheClass.Name%>`
 * (NOT localised) in the ref while `:185` displays `<%=CacheClass.Name(LangId)%>`
 * (localised). We read the displayed one and hand it back as the `KindName`
 * parameter. `Build/FacilityList.asp:364` merely echoes that parameter as a
 * caption, so nothing downstream keys on it, and `Five/0/Includes/language.inc`
 * pins `LangId = 0`, where the two forms coincide. Only a `Five/1..5` tree —
 * which this gateway never requests — would tell them apart (audit field 75).
 */
function parseBuildingCategories(ctx: SessionContext, html: string): BuildingCategory[] {
  const categories: BuildingCategory[] = [];

  // `KindList.asp:211-217` — when the company path will not open, the page
  // renders `Error="Couldn't open the path…"` (`:18`) as bare text instead of a
  // table. Without this the caller sees the same empty list as an empty cluster.
  if (/Couldn't open the path/i.test(html)) {
    ctx.log.error('[BuildConstruction] KindList.asp could not open the company path — no categories will be listed');
  }

  // Match <td> elements with ref attribute containing FacilityList.asp
  // Handle both quoted and unquoted ref attributes
  // If quoted, capture everything until closing quote; if unquoted, capture until space/bracket
  const tdRegex = /<td[^>]*\sref=(["']?)([^"']*FacilityList\.asp[^"']*)\1[^>]*>([\s\S]*?)<\/td>/gi;
  let match;

  while ((match = tdRegex.exec(html)) !== null) {
    const ref = match[2];  // Second capture group contains the ref URL
    const content = match[3];  // Third capture group contains the content

    ctx.log.debug(`[BuildConstruction] Found category ref: ${ref.substring(0, 100)}`);

    // Parse query parameters from ref
    const urlParams = new URLSearchParams(ref.split('?')[1] || '');

    // Category name — `KindList.asp:184-186`, `<div class=link>` holding
    // `CacheClass.Name(LangId)`. Emitted unconditionally in the same branch as
    // the `ref`, so every cell reaching this loop has one.
    //
    // A second pattern used to fall back to the `title` attribute of the icon.
    // It is removed: `:181` interpolates `CacheClass.Name(LangId)` into that
    // title — the SAME expression as `:185`. The fallback could not add a name
    // the div did not already carry, and when the class name is empty both are
    // empty. Dead by construction, not merely untaken.
    const divMatch = /<div[^>]*class\s*=\s*["']?link["']?[^>]*>\s*([^<]+)\s*<\/div>/i.exec(content);
    const kindName = divMatch ? divMatch[1].trim() : '';

    // Extract icon path (handle both quoted and unquoted src)
    const iconMatch = /src\s*=\s*["']?([^"'\s>]+)["']?/i.exec(content);
    const iconPath = iconMatch?.[1] || '';

    const kind = urlParams.get('Kind');
    if (kindName && kind) {
      const category = {
        kindName: kindName,
        kind,
        cluster: urlParams.get('Cluster') || '',
        folder: urlParams.get('Folder') || '',
        tycoonLevel: parseInt(urlParams.get('TycoonLevel') || '0', 10),
        iconPath: ctx.convertToProxyUrl(iconPath)
      };

      ctx.log.debug(`[BuildConstruction] Parsed category: ${category.kindName} (${category.kind})`);
      categories.push(category);
    } else {
      ctx.log.warn(`[BuildConstruction] Skipped category - kindName: "${kindName}", Kind: "${kind}"`);
    }
  }

  ctx.log.debug(`[BuildConstruction] Parsed ${categories.length} categories total`);
  return categories;
}

// ===========================================================================
// BUILD CONSTRUCTION — FACILITIES
// ===========================================================================

/**
 * Fetch facilities (buildings) for a specific category via HTTP (FacilityList.asp)
 */
export async function fetchBuildingFacilities(
  ctx: SessionContext,
  companyName: string,
  cluster: string,
  kind: string,
  kindName: string,
  folder: string,
  tycoonLevel: number
): Promise<BuildingInfo[]> {
  if (!ctx.currentWorldInfo) {
    throw new Error('Not logged into world - cannot fetch facilities');
  }

  const params = new URLSearchParams({
    Company: companyName,
    WorldName: ctx.currentWorldInfo.name,
    Cluster: cluster,
    Kind: kind,
    KindName: kindName,
    Folder: folder,
    TycoonLevel: tycoonLevel.toString()
  });

  const url = `http://${ctx.currentWorldInfo.ip}/five/0/visual/voyager/Build/FacilityList.asp?${params.toString().replace(/\+/g, '%20')}`;
  ctx.log.debug(`[BuildConstruction] Fetching facilities from ${url}`);

  try {
    const html = await fetchVoyagerPage(ctx, url, `FacilityList.asp for ${kind}`);
    return html === null ? [] : parseBuildingFacilities(ctx, html);
  } catch (e: unknown) {
    ctx.log.error('[BuildConstruction] Failed to fetch facilities:', e);
    return [];
  }
}

/**
 * The slice of the document that belongs to one `Cell_<i>`.
 *
 * `Build/FacilityList.asp:224-345` wraps each facility in a `<tr id="Cell_i">`
 * that contains two nested `<tr>`s, so a non-greedy `</tr>` scan stops at
 * `:283` — before the description (`:288`, `:292`) and before the `info`
 * attribute (`:307`). Anything living in the second inner row has to be read
 * from this window instead.
 *
 * `cellIndex` always comes from a `Cell_(\d+)` match on this very document, so
 * the anchor is always found; `span` bounds the window when the cell is the last
 * one and no `Cell_` follows it.
 */
function cellWindow(html: string, cellIndex: string, span: number): string {
  const anchor = html.indexOf(`Cell_${cellIndex}`);
  const nextCell = html.indexOf('Cell_', anchor + 5);
  return html.substring(anchor, nextCell >= 0 ? nextCell : anchor + span);
}

/**
 * Parse HTML response from FacilityList.asp to extract building information.
 *
 * Reference for every offset below: the live capture of this page,
 * which outranks the ASP
 * source, plus `Build/FacilityList.asp:217-345` for the branches the capture
 * does not exercise — it holds a single, AVAILABLE facility.
 */
function parseBuildingFacilities(ctx: SessionContext, html: string): BuildingInfo[] {
  const facilities: BuildingInfo[] = [];

  // Pre-scan: extract ALL FacilityClass->VisualClassId pairs from "info" attribute URLs.
  // The real server HTML has nested <table>/<tr> inside each Cell_N, and VisualClassId
  // lives in the "Build now" button's info attribute deep in the second inner <tr>.
  // The cellRegex below only captures up to the first inner </tr> (non-greedy),
  // so we must extract VisualClassId from the full HTML before cell-level processing.
  const visualClassMap = new Map<string, string>();
  // Strategy 1: FacilityClass before VisualClassId (standard order)
  const infoRegex = /FacilityClass=([A-Za-z0-9_]+)[^"']*VisualClassId=(\d+)/gi;
  let infoMatch;
  while ((infoMatch = infoRegex.exec(html)) !== null) {
    visualClassMap.set(infoMatch[1], infoMatch[2]);
  }
  // Strategy 2: VisualClassId before FacilityClass (reversed order)
  const reverseInfoRegex = /VisualClassId=(\d+)[^"']*FacilityClass=([A-Za-z0-9_]+)/gi;
  while ((infoMatch = reverseInfoRegex.exec(html)) !== null) {
    if (!visualClassMap.has(infoMatch[2])) {
      visualClassMap.set(infoMatch[2], infoMatch[1]);
    }
  }
  if (visualClassMap.size > 0) {
    ctx.log.debug(`[BuildConstruction] Pre-scanned ${visualClassMap.size} FacilityClass->VisualClassId pairs from info attributes`);
  }

  // Match each building's detail cell (Cell_N) - handle both quoted and unquoted id
  const cellRegex = /<tr[^>]*\sid\s*=\s*["']?Cell_(\d+)["']?[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = cellRegex.exec(html)) !== null) {
    const cellIndex = match[1];
    const cellContent = match[2];

    // Find corresponding LinkText div for building name and availability
    // Handle both quoted and unquoted attributes, in any order
    const linkTextRegex = new RegExp(
      `<div[^>]*id\\s*=\\s*["']?LinkText_${cellIndex}["']?[^>]*available\\s*=\\s*["']?(\\d+)["']?[^>]*>([^<]+)<`,
      'i'
    );
    const linkMatch = linkTextRegex.exec(html);

    if (!linkMatch) {
      ctx.log.warn(`[BuildConstruction] No LinkText found for Cell_${cellIndex}`);
      continue;
    }

    const available = linkMatch[1] === '1';
    const name = linkMatch[2].trim();

    // Extract building icon - handle both quoted and unquoted src
    const iconMatch = /src\s*=\s*["']?([^"'\s>]+)["']?/i.exec(cellContent);
    const iconPath = iconMatch?.[1] || '';

    // Extract FacilityClass from info attribute (authoritative RDO class name).
    // Icon filenames use visual asset names that may differ from the kernel class
    // (e.g., icon "MapPGIHQ1.gif" -> "PGIHQ1", but real class is "PGIGeneralHeadquarterSTA").
    // The info attribute on the "Build now" button has the correct FacilityClass.
    let facilityClass = '';
    let visualClassId = '';

    // PRIMARY: Extract FacilityClass from the info attribute of this Cell_N —
    // `FacilityList.asp:307`, confirmed on the live wire.
    const fcMatch = /FacilityClass=([A-Za-z0-9_]+)/i.exec(cellWindow(html, cellIndex, 3000));
    if (fcMatch) {
      facilityClass = fcMatch[1];
      ctx.log.debug(`[BuildConstruction] Extracted facilityClass "${facilityClass}" from info attribute`);
    }

    // FALLBACK — icon filename, and ONLY for a facility the server marked
    // unavailable. `FacilityList.asp:300-314` emits the whole "Build now" cell,
    // hence the only `info=` and the only `CacheClass.Id`, under `if Available`:
    // a locked facility structurally has no kernel class on the page (audit B-15).
    // The icon name is a VISUAL asset name and is provably not the class — the
    // live capture pairs icon `MapPGIHQ1.gif` with class `PGIGeneralHeadquarterSTA`.
    // It is kept as an identity for the greyed-out card, which
    // the client cannot click (`BuildMenu.tsx:68`, `:75`), never as something to
    // hand to `NewFacility`. On an AVAILABLE facility a missing `info=` means the
    // page is not the page: guessing there would put a fabricated class on a
    // buildable card, so the facility is dropped by the guard below instead.
    if (!facilityClass && !available && iconPath) {
      const iconFilenameMatch = /Map([A-Z][a-zA-Z0-9]+?)(?:\d+x\d+(?:x\d+)?)?\.gif/i.exec(iconPath);
      if (iconFilenameMatch) {
        facilityClass = iconFilenameMatch[1];
        ctx.log.warn(`[BuildConstruction] FacilityClass from icon fallback: "${facilityClass}" — visual asset name, not the kernel class; locked facility, not buildable`);
      }
    }

    // Look up VisualClassId from pre-scanned info attributes (handles nested-table HTML),
    // then fall back to searching cellContent directly (handles simplified/mock HTML),
    // then fall back to searching the full HTML near the Cell_N anchor.
    if (facilityClass && visualClassMap.has(facilityClass)) {
      visualClassId = visualClassMap.get(facilityClass)!;
    } else {
      const visualIdMatch = /VisualClassId[=:](\d+)/i.exec(cellContent);
      if (visualIdMatch) {
        visualClassId = visualIdMatch[1];
      } else if (facilityClass) {
        // Last resort: search the full HTML for VisualClassId near this Cell_N.
        // IMPORTANT: scoped to the cell boundary to avoid bleeding into neighbours.
        const windowMatch = /VisualClassId[=:](\d+)/i.exec(cellWindow(html, cellIndex, 2000));
        if (windowMatch) {
          visualClassId = windowMatch[1];
        }
      }
    }

    if (!visualClassId) {
      ctx.log.warn(`[BuildConstruction] No VisualClassId found for "${facilityClass}" — building dimensions will be unavailable`);
    }

    // Extract cost (e.g., "$140K") - handle both quoted and unquoted class
    const costMatch = /<div[^>]*class\s*=\s*["']?comment["']?[^>]*>\s*\$?([\d,]+\.?\d*)\s*([KM]?)/i.exec(cellContent);
    let cost = 0;
    if (costMatch) {
      const value = parseFloat(costMatch[1].replace(/,/g, ''));
      const multiplier = costMatch[2] === 'K' ? 1000 : costMatch[2] === 'M' ? 1000000 : 1;
      cost = value * multiplier;
    }

    // Extract area (e.g., "400 m.")
    const areaMatch = /([\d,]+)\s*m\./i.exec(cellContent);
    const area = areaMatch ? parseInt(areaMatch[1].replace(/,/g, ''), 10) : 0;

    // Extract description — `FacilityList.asp:292`, `<div id=infoBlock_<i>
    // class="description" … display: none>` holding `CacheClass.Desc(LangId)`,
    // confirmed on the live wire.
    //
    // Two reasons this is anchored on `infoBlock_<i>` and read from the cell
    // WINDOW rather than from `cellContent`:
    //  - `cellContent` stops at the first inner `</tr>` (`:283`), and both
    //    description divs sit after it, so this field was ALWAYS empty in
    //    production — not "the prerequisites instead of the description" as
    //    audit B-19 described it;
    //  - a facility the server marked unavailable gets a SECOND, earlier
    //    `class="description"` div (`:288`) carrying `CacheClass.Requires`. An
    //    unanchored match takes that one and shows the prerequisites as the
    //    description. `infoBlock_<i>` is unique and is emitted in both branches.
    const descRegex = new RegExp(
      `<div[^>]*\\bid\\s*=\\s*["']?infoBlock_${cellIndex}["']?[^>]*>([\\s\\S]*?)</div>`,
      'i'
    );
    const descMatch = descRegex.exec(cellWindow(html, cellIndex, 3000));
    const description = descMatch ? descMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';

    // Extract zone image src and title for residential classification
    // Try src-before-title first (standard order), then title-before-src (reversed)
    const zoneSrcFirst = /<img[^>]*src\s*=\s*["']?([^"'\s>]*zone[^"'\s>]*)["']?[^>]*title\s*=\s*["']([^"']+)["']/i.exec(cellContent);
    const zoneTitleFirst = !zoneSrcFirst
      ? /<img[^>]*title\s*=\s*["']([^"']+)["'][^>]*src\s*=\s*["']?([^"'\s>]*zone[^"'\s>]*)["']?/i.exec(cellContent)
      : null;
    const zoneSrc = zoneSrcFirst?.[1] || zoneTitleFirst?.[2] || '';
    const zoneTitle = zoneSrcFirst?.[2] || zoneTitleFirst?.[1] || '';
    const zoneRequirement = zoneTitle;

    // Derive residence class from zone image filename, title text, and facility class
    const residenceClass = deriveResidenceClass(zoneSrc, zoneTitle, facilityClass);
    if (zoneSrc || zoneTitle) {
      ctx.log.debug(`[BuildConstruction] Zone signals for "${name}": src="${zoneSrc}" title="${zoneTitle}" → ${residenceClass ?? 'none'}`);
    }

    if (facilityClass && name) {
      const facility: BuildingInfo = {
        name,
        facilityClass,
        visualClassId,
        cost,
        area,
        description,
        zoneRequirement,
        iconPath: ctx.convertToProxyUrl(iconPath),
        available,
        ...(residenceClass && { residenceClass }),
      };

      ctx.log.debug(`[BuildConstruction] Parsed facility: ${facility.name} (${facility.facilityClass}) - $${facility.cost}, ${facility.area}m², available: ${facility.available}`);
      facilities.push(facility);
    } else {
      ctx.log.warn(`[BuildConstruction] Skipped facility - name: "${name}", facilityClass: "${facilityClass}"`);
    }
  }

  ctx.log.debug(`[BuildConstruction] Parsed ${facilities.length} facilities total`);
  return facilities;
}

// ===========================================================================
// BUILD CONSTRUCTION — PLACEMENT
// ===========================================================================

/**
 * Place a new building via RDO NewFacility command
 */
export async function placeBuilding(
  ctx: SessionContext,
  facilityClass: string,
  x: number,
  y: number
): Promise<{ success: boolean; buildingId: string | null }> {
  if (!ctx.worldContextId) {
    throw new Error('Not logged into world - cannot place building');
  }
  if (!ctx.currentCompany || ctx.currentCompany.id === VISITOR_COMPANY_ID) {
    throw new Error('No company selected - cannot place building');
  }

  const companyId = parseInt(ctx.currentCompany.id, 10);
  if (isNaN(companyId)) {
    throw new Error(`Invalid company ID: ${ctx.currentCompany.id}`);
  }

  ctx.log.debug(`[BuildConstruction] Placing ${facilityClass} at (${x}, ${y}) for company ${companyId}`);

  try {
    const packet = await ctx.sendRdoRequest('world', rdoCall(
      'NewFacility', ctx.worldContextId,
      RdoValue.string(facilityClass), RdoValue.int(companyId), RdoValue.int(x), RdoValue.int(y),
    ).packet, undefined, TimeoutCategory.NORMAL);

    // Parse response for result code
    const resultCode = parseResultCode(packet.payload);

    if (resultCode === 0) {
      // The protocol does not return the new building's id, and never has.
      // TWorld.RDONewFacility discards the created object into a variable the
      // Delphi source literally names `Useless` (World.pas:3562,3566), so the
      // response only ever carries a result code: `A<rid> res="#0";`
      // (observed on the live wire). The legacy
      // client never learns the id either — it repaints the area instead
      // (MapIsoHandler.pas:1022-1047), exactly as our client does.
      // A previous `/sel (\d+)/` match against the RESPONSE lived here: `sel`
      // only ever appears in requests, so it always yielded null. Do not
      // reintroduce it — null is the honest answer, not a parsing failure.
      ctx.log.debug('[BuildConstruction] Building placed successfully (id not returned by protocol)');
      return { success: true, buildingId: null };
    } else {
      ctx.log.warn(`[BuildConstruction] Building placement failed. Result code: ${resultCode}`);
      return { success: false, buildingId: null };
    }
  } catch (e: unknown) {
    ctx.log.error('[BuildConstruction] Failed to place building:', e);
    return { success: false, buildingId: null };
  }
}

/**
 * Place the Capitol building via RDO NewFacility command.
 * Capitol uses facilityClass "Capitol" and companyId 1 (hardcoded).
 * RDO: sel <worldContextId> call NewFacility "^" "%Capitol","#1","#x","#y"
 */
export async function placeCapitol(
  ctx: SessionContext,
  x: number,
  y: number
): Promise<{ success: boolean; buildingId: string | null }> {
  if (!ctx.worldContextId) {
    throw new Error('Not logged into world - cannot place Capitol');
  }

  ctx.log.debug(`[Capitol] Placing Capitol at (${x}, ${y})`);

  try {
    const packet = await ctx.sendRdoRequest('world', rdoCall(
      'NewFacility', ctx.worldContextId,
      RdoValue.string('Capitol'), RdoValue.int(1), RdoValue.int(x), RdoValue.int(y),
    ).packet, undefined, TimeoutCategory.NORMAL);

    const resultCode = parseResultCode(packet.payload);

    if (resultCode === 0) {
      // Same as placeBuilding: NewFacility never returns the created object's
      // id (World.pas:3562,3566). See the comment there before touching this.
      ctx.log.debug('[Capitol] Capitol placed successfully (id not returned by protocol)');
      return { success: true, buildingId: null };
    } else {
      ctx.log.warn(`[Capitol] Capitol placement failed. Result code: ${resultCode}`);
      return { success: false, buildingId: null };
    }
  } catch (e: unknown) {
    ctx.log.error('[Capitol] Failed to place Capitol:', e);
    return { success: false, buildingId: null };
  }
}
