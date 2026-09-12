/**
 * src/server/search-menu-parser.ts
 *
 * HTML Parser for legacy Starpeace ASP pages
 * Extracts structured data from the directory/search menu system
 */

import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type {
  SearchMenuCategory,
  TownInfo,
  NewspaperListing,
  TycoonProfile,
  RankingCategory,
  RankingEntry,
  DirectoryRef,
  DirectoryPage,
  DirectoryTownPage,
  DirectoryFacilityRow,
  DirectoryFacilityCard
} from '../shared/types';
import { parseLocalAspUrl } from '../shared/local-asp-url';

/**
 * Parse DirectoryMain.asp - Home page with category grid
 */
export function parseHomePage(html: string, baseUrl: string): SearchMenuCategory[] {
  const $ = cheerio.load(html);
  const categories: SearchMenuCategory[] = [];

  // Find all clickable category cells
  $('td[onclick="onKindClick()"]').each((_, el) => {
    const $el = $(el);
    const ref = $el.attr('ref');
    const label = $el.find('.link').text().trim();
    const imgSrc = $el.find('img').attr('src');
    const enabled = true;

    if (ref && label) {
      const cat: SearchMenuCategory = {
        id: ref.split('.asp')[0].split('/').pop() || label.toLowerCase(),
        label,
        enabled,
        iconUrl: imgSrc ? `${baseUrl}/${imgSrc}` : undefined
      };

      // Extract map coordinates from ref (used by Capitol)
      const xMatch = ref.match(/[&?]x=(\d+)/);
      const yMatch = ref.match(/[&?]y=(\d+)/);
      if (xMatch) cat.x = parseInt(xMatch[1], 10);
      if (yMatch) cat.y = parseInt(yMatch[1], 10);

      categories.push(cat);
    }
  });

  // Add disabled categories
  $('td[style*="cursor: default"]').each((_, el) => {
    const $el = $(el);
    const label = $el.find('.link, div').last().text().trim();
    const imgSrc = $el.find('img').attr('src');

    if (label && label !== 'Capitol') {
      return; // Skip non-Capitol disabled items
    }

    if (label) {
      categories.push({
        id: label.toLowerCase().replace(/\s+/g, '-'),
        label,
        enabled: false,
        iconUrl: imgSrc ? `${baseUrl}/${imgSrc}` : undefined
      });
    }
  });

  return categories;
}

/**
 * Parse Towns.asp - List of all towns
 */
export function parseTownsPage(html: string, baseUrl: string): TownInfo[] {
  const $ = cheerio.load(html);
  const towns: TownInfo[] = [];

  $('tr[onmouseOver="onItemMouseOver()"]').each((_, el) => {
    const $row = $(el);
    // Cheerio lower-cases attribute names in HTML mode, so the legacy `dirHref`
    // (RenderTown.inc:6) only answers to `dirhref` — reading it the other way round
    // returned undefined and shipped every town with an empty path and classId.
    const dirHref = $row.attr('dirhref') || $row.attr('dirHref');
    const iconUrl = $row.find('img').attr('src');
    const name = $row.find('.ItemHeader').text().trim();
    const $info = $row.next();
    const infoText = $info.find('.ItemInfo').text();

    if (!name) return;

    // Extract mayor — RenderTown.inc:19-35. The first .ItemInfo div holds
    // <center><b>Mayor:</b></center> then either <center>Name<br>(Term N)</center>
    // or <center><font color="red">none</font></center>.
    const $mayorCenters = $info.find('.ItemInfo').first().find('center');
    const mayorText = $mayorCenters.length > 1
      ? $mayorCenters.eq(1).text().replace(/\s+/g, ' ').trim()
      : '';
    const termMatch = mayorText.match(/\(Term (\d+)\)/);
    const mayorName = mayorText.replace(/\(Term \d+\)/, '').trim();
    const mayor: string | null = mayorName && mayorName !== 'none' ? mayorName : null;
    const mayorTerm = termMatch ? parseInt(termMatch[1], 10) : undefined;

    // Extract population
    const popMatch = infoText.match(/(\d{1,3}(?:,\d{3})*)\s*inhabitants/);
    const population = popMatch ? parseInt(popMatch[1].replace(/,/g, ''), 10) : 0;

    // Extract unemployment %
    const ueMatch = infoText.match(/\((\d+)% UE\)/);
    const unemploymentPercent = ueMatch ? parseInt(ueMatch[1], 10) : 0;

    // Extract QoL %
    const qolMatch = infoText.match(/QoL: (\d+)%/);
    const qualityOfLife = qolMatch ? parseInt(qolMatch[1], 10) : 0;

    // Extract coordinates from "Show in map" link
    const mapLink = $info.find('a[href*="frame_Action=SELECT"]').attr('href');
    const xMatch = mapLink?.match(/[&?]x=(\d+)/);
    const yMatch = mapLink?.match(/[&?]y=(\d+)/);
    const x = xMatch ? parseInt(xMatch[1], 10) : 0;
    const y = yMatch ? parseInt(yMatch[1], 10) : 0;

    // Extract path and classId
    const pathMatch = dirHref?.match(/Path=(Towns\\[^&]+)/);
    const classIdMatch = dirHref?.match(/ClassId=(\d+)/);
    const path = pathMatch ? pathMatch[1] : '';
    const classId = classIdMatch ? classIdMatch[1] : '';

    towns.push({
      name,
      // RenderTown.inc:10-14 writes an absolute path (/five/icons/…) — resolve it
      // against the host, not the directory, or the URL comes out doubled.
      iconUrl: iconUrl
        ? (iconUrl.startsWith('/') ? new URL(iconUrl, baseUrl).toString() : `${baseUrl}/${iconUrl}`)
        : '',
      mayor,
      ...(mayorTerm !== undefined && { mayorTerm }),
      population,
      unemploymentPercent,
      qualityOfLife,
      x,
      y,
      path,
      classId
    });
  });

  return towns;
}

/**
 * Parse RenderTycoon.asp - Tycoon profile
 */
export function parseTycoonProfile(html: string, baseUrl: string): TycoonProfile {
  const $ = cheerio.load(html);

  const name = $('.header1').first().text().trim();
  const photoUrl = $('img#picture').attr('src') || '';

  // Extract stats from table
  const stats: { [key: string]: string } = {};
  $('table td.label').each((_, el) => {
    const label = $(el).text().trim().replace(':', '');
    const value = $(el).next('.value').text().trim();
    stats[label] = value;
  });

  // Parse fortune (remove $ and ,)
  const fortune = stats['Fortune'] ? parseFloat(stats['Fortune'].replace(/[$,]/g, '')) : 0;

  // Parse this year profit
  const thisYearProfit = stats['This year'] ? parseFloat(stats['This year'].replace(/[$,]/g, '')) : 0;

  // Get ranking string
  const ntaRanking = stats['NTA Ranking'] || 'N/A';

  // Get level
  const level = stats['Level'] || 'Unknown';

  // Parse prestige
  const prestigeStr = stats['Prestige'] || '0';
  const prestige = parseInt(prestigeStr.replace(/[^\d-]/g, ''), 10) || 0;

  // Extract URLs
  const profileUrl = $('a[href*="tycoon.asp"]').attr('href') || '';
  const companiesUrl = $('a[href*="TycoonCompanies.asp"]').attr('href') || '';

  return {
    name,
    photoUrl: photoUrl.startsWith('http') ? photoUrl : `${baseUrl}/${photoUrl}`,
    fortune,
    thisYearProfit,
    ntaRanking,
    level,
    prestige,
    profileUrl,
    companiesUrl
  };
}

/**
 * Parse Rankings.asp - Ranking categories tree
 */
export function parseRankingsPage(html: string): RankingCategory[] {
  const $ = cheerio.load(html);

  function parseLevel(container: cheerio.Cheerio<AnyNode>, level: number): RankingCategory[] {
    const items: RankingCategory[] = [];

    // Use dirHref attribute selector (case-insensitive and reliable)
    container.find('tr[dirhref]').each((_, el) => {
      const $row = $(el);

      // Only process direct children of current container (prevent processing nested items multiple times)
      if ($row.closest('table')[0] !== container[0]) return;

      const dirHref = $row.attr('dirhref') || $row.attr('dirHref');
      const label = $row.find('.listItem').text().trim();
      const levelClass = $row.find(`td.level${level}`).length > 0;

      if (!dirHref || !label || !levelClass) return;

      const item: RankingCategory = {
        id: dirHref,
        label: label.replace(/\s+/g, ' ').replace(/&nbsp;/g, '').trim(),
        url: dirHref,
        level,
        children: []
      };

      // Check for nested table (children)
      // Structure: <tr> (current) -> <tr> (gradient) -> <tr> (containing nested table)
      const $gradientRow = $row.next(); // Gradient row
      const $tableRow = $gradientRow.next(); // Row containing nested table
      const $childTable = $tableRow.find('> td > table').first();

      if ($childTable.length) {
        item.children = parseLevel($childTable, level + 1);
      }

      items.push(item);
    });

    return items;
  }

  const $mainTable = $('body table').first();
  return parseLevel($mainTable, 0);
}

/**
 * Parse Newspapers.asp - Directory Media page (New Directory/Newspapers.asp:12-24)
 */
export function parseNewspapersPage(html: string): NewspaperListing[] {
  const $ = cheerio.load(html);
  const papers: NewspaperListing[] = [];

  $('tr[dirhref]').each((_, el) => {
    const $row = $(el);
    const dirHref = $row.attr('dirhref') || $row.attr('dirHref');
    const paperName = $row.find('.listItem').text().replace(/\u00A0/g, ' ').trim();

    if (!paperName) return;

    const townMatch = dirHref?.match(/[?&]TownName=([^&]*)/);
    let townName = townMatch ? townMatch[1] : '';
    try {
      townName = townMatch ? decodeURIComponent(townName) : townName;
    } catch {
      // Keep the raw value if it isn't valid percent-encoding
    }

    papers.push({ paperName, townName });
  });

  return papers;
}

/**
 * Parse ranking.asp - Ranking detail page
 */
export function parseRankingDetail(html: string, baseUrl: string): { title: string; entries: RankingEntry[] } {
  const $ = cheerio.load(html);

  const title = $('h2').text().trim() || 'Ranking';
  const entries: RankingEntry[] = [];

  // Podium — ranks 1..3, each its own <td> with a photo (Ranking.asp:78-106).
  // The rank and name live in the <b>, the value in the <div class=label>; the
  // whole-cell text used to be regex-scanned, which chopped "$7,000,000" down to
  // its last digit run.
  $('table img[id^="picture"]').each((_, el) => {
    const $img = $(el);
    const $td = $img.closest('td');

    // <b>1. Name</b> (Ranking.asp:82, :90, :98)
    const headMatch = $td.find('b').first().text().match(/^\s*(\d+)\.\s*(.+?)\s*$/);
    if (!headMatch) return;

    const src = $img.attr('src');

    entries.push({
      rank: parseInt(headMatch[1], 10),
      name: headMatch[2],
      valueText: $td.find('div.label').first().text().trim(),
      // Ranking.asp:81 writes an absolute /fivedata/… path — resolve it against
      // the host, not the directory, or the URL comes out doubled.
      photoUrl: src
        ? (src.startsWith('/') ? new URL(src, baseUrl).toString() : `${baseUrl}/${src}`)
        : undefined
    });
  });

  // Tail — ranks 4..Count (Ranking.asp:107-131). The page never opens a <tr>:
  // its guard reads `i - 3 mod 2 = 0`, which VBScript evaluates as `i - (3 mod 2)`
  // and is never true, while the closer `(i - 2) mod 2 = 0` fires on every other
  // entry — so the HTML parser packs two entries into each implicit row. Anchor
  // on the name cell instead, the only td carrying class=value (:116, :118): one
  // per entry, whatever the row grouping turned out to be.
  $('table[style*="margin-top: 20px"] td.value').each((_, el) => {
    const $name = $(el);
    const rank = parseInt($name.prev('td').text().trim(), 10);
    const name = $name.text().trim();

    if (!isNaN(rank) && name) {
      entries.push({
        rank,
        name,
        valueText: $name.next('td').text().trim()
      });
    }
  });

  return { title, entries };
}

// =============================================================================
// Directory tree below the town list (New Directory/*.asp)
// =============================================================================

/**
 * The icon idiom these pages share: `/five/icons/…` is absolute and resolves against
 * the host, anything else against the directory (same rule as parseTownsPage:133-135).
 */
function resolveIcon(src: string | undefined, baseUrl: string): string {
  if (!src) return '';
  return src.startsWith('/') ? new URL(src, baseUrl).toString() : `${baseUrl}/${src}`;
}

/** The `&nbsp;` every list item is padded with (e.g. InTownFacilities.asp:19) is not part of the name. */
function itemText($el: cheerio.Cheerio<AnyNode>): string {
  return $el.text().replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** `x`/`y` from a "Show in map" link, or null when the page printed none. */
function mapCoords($scope: cheerio.Cheerio<AnyNode>): { x: number; y: number } | null {
  const href = $scope.find('a[href*="frame_Action=SELECT"]').attr('href');
  return href ? parseLocalAspUrl(href) : null;
}

/**
 * Parse RenderTownIn.asp — the town page reached from a town row.
 *
 * The detail block (`:49-67`) sits outside the cache-path guard, so a town whose path
 * failed to resolve still renders it, empty, under the name `"Unknown Town"` (`:30`).
 * Every missing value therefore reads as 0 rather than as an error.
 */
export function parseTownPage(html: string, baseUrl: string): DirectoryTownPage {
  const $ = cheerio.load(html);

  const name = $('.header2').first().text().trim();
  const iconUrl = resolveIcon($('img').first().attr('src'), baseUrl);

  // The three span.value cells in document order: Inhabitants (:54), QoL (:60),
  // Unemployment (:66 — which also prints a stray trailing colon).
  const values = $('span.value').map((_, el) => $(el).text()).get();
  const digits = (text: string | undefined): number => {
    const match = text?.replace(/,/g, '').match(/-?\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };

  const coords = mapCoords($.root());

  return {
    name,
    iconUrl,
    inhabitants: digits(values[0]),
    qualityOfLife: digits(values[1]),
    unemploymentPercent: digits(values[2]),
    x: coords?.x ?? 0,
    y: coords?.y ?? 0
  };
}

/**
 * Parse a folder listing — InTownFacilities.asp, InTownCompanies.asp, InTownCompany.asp,
 * TycoonCompanies.asp, TycoonCompany.asp. All five render one `tr[dirHref]` per entry
 * holding a single `div.listItem`.
 *
 * InTownCompany.asp:63 opens the list with one extra row of its own — a mail-composer
 * link carrying the company header and the `Owned by %1` line (`:69-71`,
 * `New Directory.lng:13`). It names the owner; it is not an entry.
 */
export function parseFolderPage(html: string): { items: string[]; ownedBy: string | null } {
  const $ = cheerio.load(html);
  const items: string[] = [];
  let ownedBy: string | null = null;

  $('tr[dirhref]').each((_, el) => {
    const $row = $(el);
    const dirHref = $row.attr('dirhref') || $row.attr('dirHref') || '';
    const label = itemText($row.find('.listItem'));

    if (dirHref.startsWith('http://local')) {
      const owner = label.match(/^Owned by (.+)$/);
      if (owner) ownedBy = owner[1];
      return;
    }

    if (label) items.push(label);
  });

  return { items, ownedBy };
}

/**
 * Parse a facility folder — the rows BrowseFacFolder.inc:15-49 writes, included by
 * BrowseTownFacFolder.asp, BrowseTownCompFacFolder.asp and TycoonFacilities.asp.
 *
 * Which of the two `div.itemInfo` branches a row took is read off the row itself
 * (`:24-36`), not inferred from the page: the company name when `ShowCompany` was true,
 * `(x, y)` when it was false.
 */
export function parseFacilityListPage(html: string, baseUrl: string): DirectoryFacilityRow[] {
  const $ = cheerio.load(html);
  const rows: DirectoryFacilityRow[] = [];

  $('tr[dirhref*="OpenFacility.asp"]').each((_, el) => {
    const $row = $(el);
    const dirHref = $row.attr('dirhref') || $row.attr('dirHref') || '';
    const name = itemText($row.find('.listItem').first());
    if (!name) return;

    const info = itemText($row.find('.itemInfo').first());
    const printedCoords = info.match(/^\((\d+),\s*(\d+)\)$/);

    // The parameter order at :15 is fixed and the values are written raw, so anchoring
    // on the neighbouring parameter name is what keeps a name containing `&` intact as
    // far as the page itself allows.
    const pathMatch = dirHref.match(/[?&]Path=(.*?)&WorldName=/);
    const nameMatch = dirHref.match(/[?&]Name=(.*?)&RIWS=/);

    // The map link lives in the row that follows (:40-49).
    const coords = mapCoords($row.next());

    rows.push({
      name,
      itemName: nameMatch ? nameMatch[1] : '',
      path: pathMatch ? pathMatch[1] : '',
      iconUrl: resolveIcon($row.find('img').attr('src'), baseUrl),
      company: printedCoords ? null : info,
      x: coords?.x ?? (printedCoords ? parseInt(printedCoords[1], 10) : 0),
      y: coords?.y ?? (printedCoords ? parseInt(printedCoords[2], 10) : 0)
    });
  });

  return rows;
}

/**
 * Parse OpenFacility.asp — the facility card.
 *
 * The entire body sits inside the cache-path guard (`:29-100`), so a path that failed to
 * resolve renders an empty document rather than an error page: no `.header2`, no card.
 */
export function parseFacilityPage(html: string, baseUrl: string): DirectoryFacilityCard | null {
  const $ = cheerio.load(html);

  const $header = $('.header2').first();
  if ($header.length === 0) return null;

  // FormatValue (:17-23) and the ROI branches (:64-72) are printed strings — "$0",
  // "-$1,234", "Already.", "12 years.", "Never." — and are carried as written.
  const stats: Record<string, string> = {};
  $('td.label').each((_, el) => {
    const label = $(el).text().trim().replace(/:$/, '');
    stats[label] = itemText($(el).next('.value'));
  });

  const composerHref = $('a[href*="frame_Id=MsgComposer"]').attr('href');
  let creator = '';
  if (composerHref) {
    try {
      creator = new URL(composerHref).searchParams.get('To') ?? '';
    } catch {
      // A link shape the URL parser rejects names nobody — the card still renders.
    }
  }

  const coords = mapCoords($.root());

  return {
    name: $header.text().trim(),
    company: $('.itemHeader').first().text().trim(),
    iconUrl: resolveIcon($('img').first().attr('src'), baseUrl),
    netProfitText: stats['Net profit'] ?? '',
    costText: stats['Cost'] ?? '',
    roiText: stats['ROI'] ?? '',
    creator,
    x: coords?.x ?? 0,
    y: coords?.y ?? 0
  };
}

/** Which parser a directory page needs follows from the ref that asked for it. */
export function parseDirectoryPage(ref: DirectoryRef, html: string, baseUrl: string): DirectoryPage {
  switch (ref.kind) {
    case 'town':
      return { kind: 'town', town: parseTownPage(html, baseUrl) };
    case 'facility':
      return { kind: 'facility', facility: parseFacilityPage(html, baseUrl) };
    case 'town-facility-kind':
    case 'town-company-facility-kind':
    case 'tycoon-facility-kind':
      return { kind: 'facility-list', facilities: parseFacilityListPage(html, baseUrl) };
    default:
      return { kind: 'folder', ...parseFolderPage(html) };
  }
}
