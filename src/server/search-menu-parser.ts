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
  RankingEntry
} from '../shared/types';

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
    const dirHref = $row.attr('dirHref');
    const iconUrl = $row.find('img').attr('src');
    const name = $row.find('.ItemHeader').text().trim();
    const $info = $row.next();
    const infoText = $info.find('.ItemInfo').text();

    if (!name) return;

    // Extract mayor
    const mayorMatch = infoText.match(/Mayor:.*?<center>(.*?)<\/center>/s);
    let mayor: string | null = mayorMatch ? mayorMatch[1].replace(/<[^>]+>/g, '').trim() : null;
    if (mayor === 'none') mayor = null;

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
      iconUrl: iconUrl ? `${baseUrl}/${iconUrl}` : '',
      mayor,
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

  // Parse top 3 with photos
  $('table img[id^="picture"]').each((idx, el) => {
    const $img = $(el);
    const $td = $img.closest('td');
    const text = $td.text();

    const rankMatch = text.match(/(\d+)\./);
    const nameMatch = text.match(/\d+\.\s+([^\n]+)/);
    const valueMatch = text.match(/(\d+)\s*$/);

    if (rankMatch && nameMatch) {
      entries.push({
        rank: parseInt(rankMatch[1], 10),
        name: nameMatch[1].trim(),
        value: valueMatch ? parseInt(valueMatch[1], 10) : 0,
        photoUrl: $img.attr('src') ? `${baseUrl}/${$img.attr('src')}` : undefined
      });
    }
  });

  // Parse remaining entries
  $('table[style*="margin-top: 20px"] tr').each((_, el) => {
    const $row = $(el);
    const $cells = $row.find('td');

    if ($cells.length >= 3) {
      const rank = parseInt($cells.eq(0).text().trim(), 10);
      const name = $cells.eq(1).text().trim();
      const value = parseInt($cells.eq(2).text().trim().replace(/,/g, ''), 10);

      if (!isNaN(rank) && name) {
        entries.push({
          rank,
          name,
          value: isNaN(value) ? 0 : value
        });
      }
    }
  });

  return { title, entries };
}
