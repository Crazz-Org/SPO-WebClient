/**
 * src/server/search-menu-service.ts
 *
 * Service for fetching and parsing legacy ASP search menu pages
 */

import http from 'http';
import {
  SearchMenuCategory,
  TownInfo,
  NewspaperListing,
  TycoonProfile,
  RankingCategory,
  RankingEntry
} from '../shared/types';
import {
  parseHomePage,
  parseTownsPage,
  parseTycoonProfile,
  parseRankingsPage,
  parseRankingDetail,
  parseNewspapersPage
} from './search-menu-parser';
import { toProxyUrl, isProxyUrl } from '../shared/proxy-utils';

export class SearchMenuService {
  private interfaceServerHost: string;
  private interfaceServerPort: number;
  private worldName: string;
  private tycoonName: string;
  private companyName: string;
  private daAddr: string;
  private daPort: number;

  constructor(
    interfaceServerHost: string,
    interfaceServerPort: number,
    worldName: string,
    tycoonName: string,
    companyName: string,
    daAddr: string,
    daPort: number
  ) {
    this.interfaceServerHost = interfaceServerHost;
    this.interfaceServerPort = interfaceServerPort;
    this.worldName = worldName;
    this.tycoonName = tycoonName;
    this.companyName = companyName;
    this.daAddr = daAddr;
    this.daPort = daPort;
  }

  /**
   * Fetch HTML content from ASP page
   * Uses DAAddr (Directory Agent) host on HTTP port 80, not the RDO DAPort.
   */
  private async fetchPage(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.daAddr,
        port: 80,
        path,
        method: 'GET',
        headers: {
          'User-Agent': 'StarpeaceWebClient/1.0'
        }
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Convert image URLs to proxy URLs
   * Images are served from DAAddr (Directory Agent), not interface server
   */
  private convertImageToProxy(imageUrl: string): string {
    if (!imageUrl) return '';

    // Already a proxy URL
    if (isProxyUrl(imageUrl)) {
      return imageUrl;
    }

    // Use toProxyUrl with DAAddr as base host for relative URLs
    return toProxyUrl(imageUrl, this.daAddr);
  }

  /**
   * Get home page categories
   */
  async getHomePage(): Promise<SearchMenuCategory[]> {
    const path = `/five/0/visual/voyager/new%20directory/DirectoryMain.asp?Tycoon=${encodeURIComponent(this.tycoonName)}&Company=${encodeURIComponent(this.companyName)}&WorldName=${encodeURIComponent(this.worldName)}&DAAddr=${this.daAddr}&DAPort=${this.daPort}&RIWS=`;

    const html = await this.fetchPage(path);
    const baseUrl = `http://${this.daAddr}/five/0/visual/voyager/new%20directory`;
    const categories = parseHomePage(html, baseUrl);

    // Convert icon URLs to proxy URLs
    return categories.map(cat => ({
      ...cat,
      iconUrl: cat.iconUrl ? this.convertImageToProxy(cat.iconUrl) : undefined
    }));
  }

  /**
   * Get towns list
   */
  async getTowns(): Promise<TownInfo[]> {
    const path = `/five/0/visual/voyager/new%20directory/Towns.asp?Tycoon=${encodeURIComponent(this.tycoonName)}&WorldName=${encodeURIComponent(this.worldName)}&RIWS=`;

    const html = await this.fetchPage(path);
    const baseUrl = `http://${this.daAddr}/five/0/visual/voyager/new%20directory`;
    const towns = parseTownsPage(html, baseUrl);

    // Convert icon URLs to proxy URLs
    return towns.map(town => ({
      ...town,
      iconUrl: this.convertImageToProxy(town.iconUrl)
    }));
  }

  /**
   * Get tycoon profile
   */
  async getTycoonProfile(tycoonName: string): Promise<TycoonProfile> {
    // Special case: "YOU" means current user
    const actualName = tycoonName === 'YOU' ? this.tycoonName : tycoonName;

    const path = `/five/0/visual/voyager/new%20directory/RenderTycoon.asp?WorldName=${encodeURIComponent(this.worldName)}&Tycoon=${encodeURIComponent(actualName)}&RIWS=`;

    const html = await this.fetchPage(path);
    const baseUrl = `http://${this.daAddr}/five/0/visual/voyager/new%20directory`;
    const profile = parseTycoonProfile(html, baseUrl);

    // Convert photo URL to proxy URL
    return {
      ...profile,
      photoUrl: this.convertImageToProxy(profile.photoUrl)
    };
  }

  /**
   * Get rankings tree
   */
  async getRankings(): Promise<RankingCategory[]> {
    const path = `/five/0/visual/voyager/new%20directory/Rankings.asp?Tycoon=${encodeURIComponent(this.tycoonName)}&WorldName=${encodeURIComponent(this.worldName)}&RIWS=`;

    const html = await this.fetchPage(path);
    return parseRankingsPage(html);
  }

  /**
   * Get ranking detail
   */
  async getRankingDetail(rankingPath: string): Promise<{ title: string; entries: RankingEntry[] }> {
    // rankingPath is the full dirHref URL from rankings page
    // We need to make the same request with our WorldName
    // The URL format is: ranking.asp?WorldName=X&Ranking=Rankings\Path\To\Ranking.five&...

    // Extract the Ranking parameter value from the URL if it's a full URL
    let rankingValue = rankingPath;
    if (rankingPath.includes('?')) {
      // It's a full URL, extract the Ranking parameter
      const match = rankingPath.match(/[?&]Ranking=([^&]+)/);
      if (match) {
        rankingValue = match[1];
      }
    }

    // Build the path with proper encoding
    // Note: The Ranking parameter contains backslashes that must be preserved
    const path = `/five/0/visual/voyager/new%20directory/ranking.asp?WorldName=${encodeURIComponent(this.worldName)}&Ranking=${rankingValue}&frame_Id=RankingView&frame_Class=HTMLView&frame_Align=client&frame_NoBorder=yes&RIWS=&LangId=0`;

    const html = await this.fetchPage(path);
    const baseUrl = `http://${this.daAddr}/five/0/visual/voyager/new%20directory`;
    const result = parseRankingDetail(html, baseUrl);

    // Convert photo URLs to proxy URLs
    return {
      ...result,
      entries: result.entries.map(entry => ({
        ...entry,
        photoUrl: entry.photoUrl ? this.convertImageToProxy(entry.photoUrl) : undefined
      }))
    };
  }

  /**
   * Get banks list (usually empty)
   */
  async getBanks(): Promise<unknown[]> {
    const path = `/five/0/visual/voyager/new%20directory/Banks.asp?WorldName=${encodeURIComponent(this.worldName)}&RIWS=`;

    await this.fetchPage(path);
    // Banks page is usually empty, return empty array
    return [];
  }

  /** Get every newspaper in the world — New Directory/Newspapers.asp (`:4` reads WorldName only). */
  async getNewspapers(): Promise<NewspaperListing[]> {
    const path = `/five/0/visual/voyager/new%20directory/Newspapers.asp?WorldName=${encodeURIComponent(this.worldName)}&RIWS=`;
    return parseNewspapersPage(await this.fetchPage(path));
  }
}
