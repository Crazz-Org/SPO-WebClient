/**
 * Tests for search-menu-parser — parseHomePage, parseTycoonProfile.
 */

import {
  parseHomePage,
  parseTycoonProfile,
  parseNewspapersPage,
  parseTownsPage,
  parseBanksPage,
  parseRankingDetail,
  parseTownPage,
  parseFolderPage,
  parseFacilityListPage,
  parseFacilityPage,
  parseDirectoryPage,
} from '../search-menu-parser';
import type { DirectoryRef } from '../../shared/types';

const BASE_URL = 'http://142.4.193.58/five/0/visual/voyager/new%20directory';

/** Wrap td cells in valid HTML table structure so Cheerio doesn't strip them. */
function wrapInTable(...cells: string[]): string {
  return `<html><body><table><tr>${cells.join('')}</tr></table></body></html>`;
}

describe('parseHomePage', () => {
  it('should extract Capitol coordinates from enabled Capitol cell', () => {
    const html = wrapInTable(`
      <td align="center" valign="bottom"
        style="border-style: solid; border-width: 2px; border-color: black; cursor: hand"
        onmouseover="onMouseOverFrame()"
        onmouseout="onMouseOutFrame()"
        onclick="onKindClick()"
        ref="http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=220&y=41"
        normcolor="black"
        hicolor="#3A5950">
        <div style="margin-top: 12px">
          <img src="images/smallCapitol.jpg" border="0">
        </div>
        <div class="link">
          Capitol
        </div>
      </td>
    `);

    const categories = parseHomePage(html, BASE_URL);
    const capitol = categories.find(c => c.label === 'Capitol');

    expect(capitol).toBeDefined();
    expect(capitol!.enabled).toBe(true);
    expect(capitol!.x).toBe(220);
    expect(capitol!.y).toBe(41);
  });

  it('should parse disabled Capitol cell without coordinates', () => {
    const html = wrapInTable(`
      <td align="center" valign="bottom"
        style="border-style: solid; border-width: 2px; border-color: black; cursor: default"
        normcolor="black">
        <div style="margin-top: 12px">
          <img src="images/smallCapitol.jpg" border="0">
        </div>
        <div class="link">
          Capitol
        </div>
      </td>
    `);

    const categories = parseHomePage(html, BASE_URL);
    const capitol = categories.find(c => c.label === 'Capitol');

    expect(capitol).toBeDefined();
    expect(capitol!.enabled).toBe(false);
    expect(capitol!.x).toBeUndefined();
    expect(capitol!.y).toBeUndefined();
  });

  it('should not extract coordinates from refs without x/y params', () => {
    const html = wrapInTable(`
      <td align="center" valign="bottom"
        onclick="onKindClick()"
        ref="Towns.asp?WorldName=Zorcon"
        style="cursor: hand">
        <div class="link">Towns</div>
      </td>
    `);

    const categories = parseHomePage(html, BASE_URL);
    const towns = categories.find(c => c.label === 'Towns');

    expect(towns).toBeDefined();
    expect(towns!.x).toBeUndefined();
    expect(towns!.y).toBeUndefined();
  });

  it('should handle multiple categories including Capitol with coords', () => {
    const html = wrapInTable(
      `<td onclick="onKindClick()" ref="Towns.asp?WorldName=Zorcon" style="cursor: hand">
        <div class="link">Towns</div>
      </td>`,
      `<td onclick="onKindClick()"
        ref="http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=150&y=300"
        style="cursor: hand">
        <div class="link">Capitol</div>
      </td>`
    );

    const categories = parseHomePage(html, BASE_URL);
    expect(categories).toHaveLength(2);

    const capitol = categories.find(c => c.label === 'Capitol');
    expect(capitol!.x).toBe(150);
    expect(capitol!.y).toBe(300);
    expect(capitol!.enabled).toBe(true);

    const towns = categories.find(c => c.label === 'Towns');
    expect(towns!.x).toBeUndefined();
  });
});

describe('parseTycoonProfile', () => {
  const BASE = 'http://158.69.153.134/five/0/visual/voyager/new%20directory';

  it('should extract all profile fields from RenderTycoon.asp HTML', () => {
    const html = `<html><body>
      <div class="header1">SPO_test3</div>
      <img id="picture" src="/fivedata/userinfo/Shamba/SPO_test3/largephoto.jpg" width="150" height="200">
      <table cellspacing="0" cellpadding="2">
        <tr><td class="label">Fortune:</td><td class="value">$8,198,554,338</td></tr>
        <tr><td class="label">This year:</td><td class="value">-$1,454,808</td></tr>
        <tr><td class="label">NTA Ranking:</td><td class="value">3rd place.</td></tr>
        <tr><td class="label">Level:</td><td class="value">Apprentice.</td></tr>
        <tr><td class="label">Prestige:</td><td class="value">29 points.</td></tr>
      </table>
      <a href="/five/0/visual/voyager/newtycoon/tycoon.asp?Tycoon=SPO_test3">Show Profile</a>
      <a href="TycoonCompanies.asp?WorldName=Shamba&Tycoon=SPO_test3&RIWS=">Companies</a>
    </body></html>`;

    const profile = parseTycoonProfile(html, BASE);

    expect(profile.name).toBe('SPO_test3');
    expect(profile.fortune).toBe(8198554338);
    expect(profile.thisYearProfit).toBe(-1454808);
    expect(profile.ntaRanking).toBe('3rd place.');
    expect(profile.level).toBe('Apprentice.');
    expect(profile.prestige).toBe(29);
    expect(profile.photoUrl).toContain('largephoto.jpg');
  });

  it('should handle missing stats gracefully', () => {
    const html = `<html><body>
      <div class="header1">EmptyTycoon</div>
    </body></html>`;

    const profile = parseTycoonProfile(html, BASE);

    expect(profile.name).toBe('EmptyTycoon');
    expect(profile.fortune).toBe(0);
    expect(profile.thisYearProfit).toBe(0);
    expect(profile.ntaRanking).toBe('N/A');
    expect(profile.level).toBe('Unknown');
    expect(profile.prestige).toBe(0);
  });
});

describe('parseTownsPage', () => {
  const BASE = 'http://158.69.153.134/five/0/visual/voyager/new%20directory';

  /**
   * One town, laid out exactly as RenderTown.inc:6-60 writes it: the header row
   * (icon + .ItemHeader), the info row (two .ItemInfo tds), the gradient row.
   */
  function townRows(opts: {
    name: string;
    mayorCell: string;
    inhabitants: string;
    uePercent: number;
    qol: number;
    x: number;
    y: number;
    icon?: string;
  }): string {
    const icon = opts.icon === undefined ? '/five/icons/TownHall64.gif' : opts.icon;
    return `
      <tr onMouseOver="onItemMouseOver()" onMouseOut="onItemMouseOut()" onClick="onItemMouseClick()" dirHref="RenderTownIn.asp?Path=Towns\\${opts.name}&WorldName=Shamba&ClassId=1234&RIWS=" textId="text_1">
        ${icon ? `<td width="60"><div class=FacIcon><img src="${icon}" width="60" border="0"></div></td>` : ''}
        <td width="*" style="padding-left: 7px"><div id=text_1 class=ItemHeader>${opts.name}</div></td>
      </tr>
      <tr>
        <td><div class=ItemInfo><center><b>Mayor:</b></center>
          ${opts.mayorCell}
        </div></td>
        <td style="padding-left: 7px;padding-bottom: 7px">
          <div class=ItemInfo>${opts.inhabitants}
            &nbsp;inhabitants
            <br>(${opts.uePercent}% UE)
            <br>
            QoL: ${opts.qol}%
            <br>
            <a href="http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=${opts.x}&y=${opts.y}">Show in map</a>
          </div>
        </td>
      </tr>
      <tr><td colspan="2" height="2" background="images/itemgradient.jpg"></td></tr>`;
  }

  const html = `<html><body><table>
    ${townRows({ name: 'Helartia', mayorCell: '<center>SPO_test3<br>(Term 3)</center>', inhabitants: '12,400', uePercent: 4, qol: 71, x: 120, y: 340 })}
    ${townRows({ name: 'NovaRoma', mayorCell: '<center>Crazz</center>', inhabitants: '3,120', uePercent: 9, qol: 55, x: 10, y: 20 })}
    ${townRows({ name: 'Dunmore', mayorCell: '<center><font color="red">none</font></center>', inhabitants: '0', uePercent: 0, qol: 0, x: 5, y: 6 })}
  </table></body></html>`;

  it('reads the ruler and the term from the second <center> (RenderTown.inc:19-35)', () => {
    const towns = parseTownsPage(html, BASE);

    expect(towns).toHaveLength(3);
    expect(towns[0].name).toBe('Helartia');
    expect(towns[0].mayor).toBe('SPO_test3');
    expect(towns[0].mayorTerm).toBe(3);
    expect(towns[0].unemploymentPercent).toBe(4);
    expect(towns[0].population).toBe(12400);
    expect(towns[0].qualityOfLife).toBe(71);
    expect(towns[0].x).toBe(120);
    expect(towns[0].y).toBe(340);
  });

  it('parses a ruler with no term — the world with no elections (RenderTown.inc:23-27)', () => {
    const towns = parseTownsPage(html, BASE);

    expect(towns[1].mayor).toBe('Crazz');
    expect(towns[1].mayorTerm).toBeUndefined();
    expect(towns[1].unemploymentPercent).toBe(9);
  });

  it('maps the red "none" cell to a null mayor with no term', () => {
    const towns = parseTownsPage(html, BASE);

    expect(towns[2].mayor).toBeNull();
    expect(towns[2].mayorTerm).toBeUndefined();
    expect(towns[2].unemploymentPercent).toBe(0);
  });

  it('resolves the absolute /five/icons/ path against the host, not the directory', () => {
    const towns = parseTownsPage(html, BASE);

    expect(towns[0].iconUrl).toBe('http://158.69.153.134/five/icons/TownHall64.gif');
  });

  it('joins a relative icon path onto the directory base', () => {
    const relative = `<html><body><table>${townRows({
      name: 'Relative', mayorCell: '<center>Crazz</center>', inhabitants: '1', uePercent: 0, qol: 1, x: 1, y: 1,
      icon: 'images/town.gif',
    })}</table></body></html>`;

    expect(parseTownsPage(relative, BASE)[0].iconUrl).toBe(`${BASE}/images/town.gif`);
  });

  it('leaves iconUrl empty when the row has no image', () => {
    const noIcon = `<html><body><table>${townRows({
      name: 'NoIcon', mayorCell: '<center>Crazz</center>', inhabitants: '1', uePercent: 0, qol: 1, x: 1, y: 1,
      icon: '',
    })}</table></body></html>`;

    expect(parseTownsPage(noIcon, BASE)[0].iconUrl).toBe('');
  });

  it('skips a row whose .ItemHeader is empty', () => {
    const nameless = `<html><body><table>
      <tr onMouseOver="onItemMouseOver()" dirHref="RenderTownIn.asp?Path=Towns\\Ghost&ClassId=9">
        <td><div class=ItemHeader></div></td>
      </tr>
      <tr><td><div class=ItemInfo><center><b>Mayor:</b></center><center>Crazz</center></div></td></tr>
    </table></body></html>`;

    expect(parseTownsPage(nameless, BASE)).toEqual([]);
  });

  it('reads the cache path and the visual class off the row link (RenderTown.inc:6)', () => {
    const towns = parseTownsPage(html, BASE);

    expect(towns[0].path).toBe('Towns\\Helartia');
    expect(towns[0].classId).toBe('1234');
  });

  it('falls back to zeros and a null mayor when the info row is missing entirely', () => {
    const bare = `<html><body><table>
      <tr onMouseOver="onItemMouseOver()"><td><div class=ItemHeader>Orphan</div></td></tr>
    </table></body></html>`;

    const towns = parseTownsPage(bare, BASE);

    expect(towns).toHaveLength(1);
    expect(towns[0].mayor).toBeNull();
    expect(towns[0].mayorTerm).toBeUndefined();
    expect(towns[0].population).toBe(0);
    expect(towns[0].unemploymentPercent).toBe(0);
    expect(towns[0].qualityOfLife).toBe(0);
    expect(towns[0].x).toBe(0);
    expect(towns[0].y).toBe(0);
    expect(towns[0].path).toBe('');
    expect(towns[0].classId).toBe('');
  });
});

describe('parseNewspapersPage', () => {
  it('extracts paper and town in page order, dropping the &nbsp;', () => {
    const html = `<html><body>
      <div class=header2>Media</div>
      <table>
        <tr dirHref="../../news/newsreader.asp?RIWS=&Tycoon=SPO_test3&WorldName=Shamba&TownName=Shamba&PaperName=Shamba%20Daily&DAAddr=127.0.0.1&DAPort=7001">
          <td><div class=listItem>Shamba Daily\u00A0</div></td>
        </tr>
        <tr><td class=gradient></td></tr>
        <tr dirHref="../../news/newsreader.asp?RIWS=&Tycoon=SPO_test3&WorldName=Shamba&TownName=Helartia&PaperName=Helartia%20Herald&DAAddr=127.0.0.1&DAPort=7001">
          <td><div class=listItem>Helartia Herald\u00A0</div></td>
        </tr>
        <tr><td class=gradient></td></tr>
      </table>
    </body></html>`;

    const papers = parseNewspapersPage(html);

    expect(papers).toEqual([
      { paperName: 'Shamba Daily', townName: 'Shamba' },
      { paperName: 'Helartia Herald', townName: 'Helartia' },
    ]);
  });

  it('skips a row with no .listItem text', () => {
    const html = `<html><body>
      <table>
        <tr dirHref="../../news/newsreader.asp?TownName=Shamba&PaperName=">
          <td><div class=listItem></div></td>
        </tr>
      </table>
    </body></html>`;

    expect(parseNewspapersPage(html)).toEqual([]);
  });

  it('returns [] for the heading with an empty table', () => {
    const html = `<html><body>
      <div class=header2>Media</div>
      <table></table>
    </body></html>`;

    expect(parseNewspapersPage(html)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Banks.asp — BrowseFolder.inc calls RenderItem (BrowseFacFolder.inc:15-52) once
// per folder entry, so one bank is a pair of <tr>s: the dirHref row (icon, name,
// company — Banks.asp:40 sets ShowCompany = true) then a row holding the
// "Show in map" anchor, emitted because getBanks sends RIWS= empty.
// ---------------------------------------------------------------------------

/** Reproduce one RenderItem row pair (BrowseFacFolder.inc:15-52). */
function bankRows(
  { id, name, company, x, y }: { id: number; name: string; company: string; x: number; y: number },
): string {
  return `
    <tr onMouseOver="onItemMouseOver()" onMouseOut="onItemMouseOut()" onClick="onItemMouseClick()"
        dirHref="OpenFacility.asp?Path=\\Banks&WorldName=Shamba&Name=${name}&RIWS=" textId="text_${id}">
      <td align="center" valign="top">
        <img width="30" src="/five/icons/Bank64.gif">
      </td>
      <td style="padding-left: 7px" valign="top">
        <div id=text_${id} class=listItem>
          ${name}
        </div>
        <div class=itemInfo>
          ${company}
        </div>
      </td>
    </tr>
    <tr>
      <td></td>
      <td width="*" style="padding-left: 7px" valign="top">
        <div class=itemInfo style="margin-bottom: 10px">
          <a href="http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=${x}&y=${y}">
            Show in map
          </a>
        </div>
      </td>
    </tr>`;
}

/** Wrap rows in the Banks.asp body (Banks.asp:24-45). */
function banksPage(rows: string): string {
  return `<html><body style="margin-left: 12px">
    <div class=header2>Shamba</div>
    <div style="padding-left: 2px">
      <table><tr><td><div class=MainAnchor>Banks</div></td></tr></table>
    </div>
    <table cellspacing="0" style="padding-left: 2px; margin-top: 12px">${rows}</table>
  </body></html>`;
}

describe('parseBanksPage', () => {
  it('extracts name, owning company and map coordinates for each bank, in page order', () => {
    const html = banksPage(
      bankRows({ id: 101, name: 'Helartia Central Bank', company: 'Moneyworks Inc', x: 220, y: 41 })
      + bankRows({ id: 102, name: 'Shamba Savings', company: 'Crazz Holdings', x: 87, y: 133 }),
    );

    expect(parseBanksPage(html)).toEqual([
      { name: 'Helartia Central Bank', company: 'Moneyworks Inc', x: 220, y: 41 },
      { name: 'Shamba Savings', company: 'Crazz Holdings', x: 87, y: 133 },
    ]);
  });

  it('returns [] when the \\Banks folder holds no entries', () => {
    expect(parseBanksPage(banksPage(''))).toEqual([]);
  });

  it('skips a row whose .listItem carries no name', () => {
    const html = banksPage(`
      <tr dirHref="OpenFacility.asp?Path=\\Banks&Name=&RIWS=">
        <td><div class=listItem>\u00A0</div><div class=itemInfo>Ghost Corp</div></td>
      </tr>`);

    expect(parseBanksPage(html)).toEqual([]);
  });

  it('falls back to 0,0 when the follow-up row carries no "Show in map" link (RIWS non-empty)', () => {
    const html = banksPage(`
      <tr dirHref="OpenFacility.asp?Path=\\Banks&Name=Offshore&RIWS=1">
        <td><div class=listItem>Offshore\u00A0</div><div class=itemInfo>Hidden Ltd</div></td>
      </tr>
      <tr><td></td><td width="*"></td></tr>`);

    expect(parseBanksPage(html)).toEqual([{ name: 'Offshore', company: 'Hidden Ltd', x: 0, y: 0 }]);
  });
});

describe('parseRankingDetail', () => {
  const NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'];
  // FormatMoney-shaped values — the server writes the formatted string, not a number.
  const VALUES = ['$7,000,000', '$6,000,000', '$5,000,000', '$4,000', '$3,000', '$2,000', '$7,000'];

  /**
   * Reproduce Ranking.asp:77-131 for `count` entries, including the broken row
   * grouping: the `<tr>` opener at :109 is guarded by `i - 3 mod 2 = 0`, which
   * VBScript reads as `i - (3 mod 2)` and never fires, while the `</tr>` closer
   * at :127 fires whenever `(i - 2) mod 2 = 0`.
   */
  function rankingPage(count: number): string {
    let podium = '';
    for (let i = 0; i < Math.min(count, 3); i++) {
      podium += `<td align="center">
        <img id="picture${i + 1}" src="/fivedata/userinfo/planitia/${NAMES[i]}/largephoto.jpg" border="0" width=150 height=200><br>
        <b>${i + 1}. ${NAMES[i]}</b>
        <div class=label>
        ${VALUES[i]}
        </div>
      </td>`;
    }

    let tail = '';
    for (let i = 3; i < count; i++) {
      tail += `<td align="right" style="font-weight: bold">
          ${i + 1}
        </td>
        <td class=value style="font-weight: bold">
          ${NAMES[i]}
        </td>
        <td align="right" style="color: #EEEEEE">
          ${VALUES[i]}
        </td>
        <td width=30>
        </td>`;
      if ((i - 2) % 2 === 0) tail += '</tr>';
    }

    return `<html><body>
      <h2>Wealth Ranking</h2>
      <center>
        <table><tr>${podium}</tr></table>
        <table style="margin-top: 20px">${tail}</table>
      </center>
    </body></html>`;
  }

  it('yields one entry per rank, with no rank lost to the page\'s broken row grouping', () => {
    const { title, entries } = parseRankingDetail(rankingPage(7), BASE_URL);

    expect(title).toBe('Wealth Ranking');
    expect(entries).toHaveLength(7);
    expect(entries.map(e => e.rank).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(entries.map(e => e.name).sort()).toEqual([...NAMES].sort());
  });

  it('carries the server\'s own formatted money string for a tail entry', () => {
    const { entries } = parseRankingDetail(rankingPage(7), BASE_URL);
    const eta = entries.find(e => e.rank === 7);

    expect(eta).toBeDefined();
    expect(eta!.name).toBe('Eta');
    expect(eta!.valueText).toBe('$7,000');
  });

  it('carries the full podium value, not its trailing digit run', () => {
    const { entries } = parseRankingDetail(rankingPage(7), BASE_URL);

    expect(entries[0]).toMatchObject({ rank: 1, name: 'Alpha', valueText: '$7,000,000' });
    expect(entries[1]).toMatchObject({ rank: 2, name: 'Beta', valueText: '$6,000,000' });
    expect(entries[2]).toMatchObject({ rank: 3, name: 'Gamma', valueText: '$5,000,000' });
  });

  it('resolves the absolute podium photo path against the host, not the directory', () => {
    const { entries } = parseRankingDetail(rankingPage(3), BASE_URL);

    expect(entries[0].photoUrl).toBe('http://142.4.193.58/fivedata/userinfo/planitia/Alpha/largephoto.jpg');
  });

  it('joins a relative podium photo path onto the directory', () => {
    const html = `<html><body><table><tr><td align="center">
      <img id="picture1" src="images/nopicture.jpg"><br>
      <b>1. Alpha</b>
      <div class=label>$1</div>
    </td></tr></table></body></html>`;

    const { entries } = parseRankingDetail(html, BASE_URL);

    expect(entries[0].photoUrl).toBe(`${BASE_URL}/images/nopicture.jpg`);
  });

  it('leaves photoUrl undefined when the podium cell carries no src', () => {
    const html = `<html><body><table><tr><td align="center">
      <img id="picture1"><br>
      <b>1. Alpha</b>
      <div class=label>$1</div>
    </td></tr></table></body></html>`;

    expect(parseRankingDetail(html, BASE_URL).entries[0].photoUrl).toBeUndefined();
  });

  it('returns no entries for a ranking the server reports empty', () => {
    const html = `<html><body>
      <h2>Wealth Ranking</h2>
      <center>
        <h4 style="margin-top: 100px">
          <div>There is no relevant performance to highlight in this area.</div>
        </h4>
      </center>
    </body></html>`;

    const { title, entries } = parseRankingDetail(html, BASE_URL);

    expect(entries).toEqual([]);
    expect(title).toBe('Wealth Ranking');
  });

  it('falls back to the generic title on a page with no heading', () => {
    expect(parseRankingDetail('', BASE_URL)).toEqual({ title: 'Ranking', entries: [] });
  });

  it('skips a podium cell whose caption has no rank prefix and a tail cell with a non-numeric rank', () => {
    const html = `<html><body>
      <table><tr><td align="center">
        <img id="picture1" src="/fivedata/x.jpg"><br>
        <b>Alpha</b>
        <div class=label>$1</div>
      </td></tr></table>
      <table style="margin-top: 20px">
        <td align="right">n/a</td><td class=value>Delta</td><td align="right">$4,000</td>
        <td align="right">5</td><td class=value></td><td align="right">$3,000</td>
      </table>
    </body></html>`;

    expect(parseRankingDetail(html, BASE_URL).entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The directory tree below the town list (New Directory/*.asp)
// ---------------------------------------------------------------------------

const DIR_BASE = 'http://158.69.153.134/five/0/visual/voyager/new%20directory';

describe('parseTownPage', () => {
  /** RenderTownIn.asp:42-101 for a town whose cache path resolved. */
  function townPage(opts: {
    name: string;
    icon?: string;
    inhabitants: string;
    qol: string;
    unemployment: string;
    mapLink?: string;
  }): string {
    const map = opts.mapLink === undefined
      ? '<a href="http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=120&y=340">Show in map</a><br>'
      : opts.mapLink;
    return `<html><head></head><body style="margin-left: 12px">
      <div><img src="${opts.icon ?? '/five/icons/TownHall64.gif'}" width=120></div>
      <div class=header2>
        ${opts.name}
      </div>
      <div style="margin-left: 12px">
        <span class=label>Inhabitants:</span>
        <span class=value>${opts.inhabitants} <br></span>
        <span class=label>Quality of life:</span>
        <span class=value>${opts.qol}% <br></span>
        <span class=label>Unemployment:</span>
        <span class=value>${opts.unemployment}:</span><br>
        ${map}
        <div style="margin-top: 7px"><table>
          <tr><td><img width="12" height="12" src="images/bullet1.gif"></td>
          <td><a class=mainAnchor href="InTownFacilities.asp?WorldName=planitia&Town=${opts.name}&ClassId=1234&RIWS=">Facilities</a></td></tr>
          <tr><td><img width="12" height="12" src="images/bullet1.gif"></td>
          <td><a class=mainAnchor href="InTownCompanies.asp?WorldName=planitia&Town=${opts.name}&ClassId=1234&RIWS=">Companies</a></td></tr>
        </table></div>
      </div>
    </body></html>`;
  }

  it('reads the name, icon and the three span.value cells in document order', () => {
    const page = parseTownPage(
      townPage({ name: 'Helartia', inhabitants: '12400', qol: '71', unemployment: '4' }),
      DIR_BASE,
    );

    expect(page).toEqual({
      name: 'Helartia',
      iconUrl: 'http://158.69.153.134/five/icons/TownHall64.gif',
      inhabitants: 12400,
      qualityOfLife: 71,
      unemploymentPercent: 4,
      x: 120,
      y: 340,
    });
  });

  it('strips the thousands separators out of the inhabitant count', () => {
    const page = parseTownPage(
      townPage({ name: 'Helartia', inhabitants: '1,204,000', qol: '71', unemployment: '4' }),
      DIR_BASE,
    );

    expect(page.inhabitants).toBe(1204000);
  });

  it('joins a relative town icon onto the directory base', () => {
    const page = parseTownPage(
      townPage({ name: 'Helartia', icon: 'images/town.gif', inhabitants: '1', qol: '1', unemployment: '1' }),
      DIR_BASE,
    );

    expect(page.iconUrl).toBe(`${DIR_BASE}/images/town.gif`);
  });

  it('carries "Unknown Town" and zeros when the cache path failed (RenderTownIn.asp:30)', () => {
    // The detail block sits outside the guard, so it still renders — empty, and with an
    // x=&y= map link the translator refuses.
    const page = parseTownPage(
      townPage({
        name: 'Unknown Town',
        icon: '',
        inhabitants: '',
        qol: '',
        unemployment: '',
        mapLink: '<a href="http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=&y=">Show in map</a>',
      }),
      DIR_BASE,
    );

    expect(page).toEqual({
      name: 'Unknown Town',
      iconUrl: '',
      inhabitants: 0,
      qualityOfLife: 0,
      unemploymentPercent: 0,
      x: 0,
      y: 0,
    });
  });

  it('falls back to 0,0 when the page printed no map link at all', () => {
    const page = parseTownPage(
      townPage({ name: 'Helartia', inhabitants: '5', qol: '6', unemployment: '7', mapLink: '' }),
      DIR_BASE,
    );

    expect(page).toMatchObject({ x: 0, y: 0, inhabitants: 5, qualityOfLife: 6, unemploymentPercent: 7 });
  });
});

describe('parseFolderPage', () => {
  /** InTownFacilities.asp:16-26 — one row per folder entry, each padded with &nbsp;. */
  function folderRows(items: string[]): string {
    return items.map(item => `
      <tr onMouseOver="onItemMouseOver()" onClick="onItemMouseClick()" dirHref="BrowseTownFacFolder.asp?Town=Helartia&WorldName=planitia&Company=&FacKind=${item}&RIWS=" textId="text_${item}">
        <td width="*" style="padding-left: 7px">
          <div id=text_${item} class=listItem>
          ${item}&nbsp;
          </div>
        </td>
      </tr>
      <tr><td height="2" background="images/itemgradient.jpg"></td></tr>`).join('');
  }

  it('returns the entries in page order with the &nbsp; dropped', () => {
    const html = `<html><body><div class=header2>Helartia</div>
      <table cellspacing="0">${folderRows(['Residentials', 'Heavy Industry', 'Public Facilities'])}</table>
    </body></html>`;

    expect(parseFolderPage(html)).toEqual({
      items: ['Residentials', 'Heavy Industry', 'Public Facilities'],
      ownedBy: null,
    });
  });

  it('names the owner from the composer row and does not count it as an entry (InTownCompany.asp:63-72)', () => {
    const html = `<html><body>
      <div style="margin-left: 24px"><table>
        <tr onClick="onItemMouseClick()" dirHref="http://local?frame_Id=MsgComposer&frame_Class=MsgComposer&frame_Align=client&frame_Height=50%&frame_Action=new">
          <td>
            <div class=header1>Crazz Ltd.</div>
            <div class="listItem">Owned by Crazz</div>
          </td>
        </tr>
      </table></div>
      <table cellspacing="0">${folderRows(['Residentials', 'Farms'])}</table>
    </body></html>`;

    expect(parseFolderPage(html)).toEqual({
      items: ['Residentials', 'Farms'],
      ownedBy: 'Crazz',
    });
  });

  it('leaves ownedBy null when the composer row carries no "Owned by" line (Tycoon <> "" is false)', () => {
    const html = `<html><body><table>
      <tr dirHref="http://local?frame_Id=MsgComposer&frame_Action=new">
        <td><div class=header1>Orphan Ltd.</div></td>
      </tr>
      ${folderRows(['Farms'])}
    </table></body></html>`;

    expect(parseFolderPage(html)).toEqual({ items: ['Farms'], ownedBy: null });
  });

  it('returns an empty list for a folder the iterator found empty (BrowseFolder.inc:5)', () => {
    const html = '<html><body><div class=header2>Helartia</div><table cellspacing="0"></table></body></html>';

    expect(parseFolderPage(html)).toEqual({ items: [], ownedBy: null });
  });

  it('skips a row whose listItem is empty', () => {
    const html = `<html><body><table>
      <tr dirHref="InTownCompany.asp?Company="><td><div class=listItem>&nbsp;</div></td></tr>
    </table></body></html>`;

    expect(parseFolderPage(html)).toEqual({ items: [], ownedBy: null });
  });
});

describe('parseFacilityListPage', () => {
  /** BrowseFacFolder.inc:15-52, both branches of the ShowCompany test at :24. */
  function facilityRows(opts: {
    showCompany: boolean;
    rows: { name: string; company: string; x: number; y: number; icon?: string }[];
    withMapLink?: boolean;
  }): string {
    const path = 'Towns\\Helartia.five\\Facilities\\Residentials';
    return opts.rows.map((row, i) => `
      <tr onMouseOver="onItemMouseOver()" onClick="onItemMouseClick()" dirHref="OpenFacility.asp?Path=${path}&WorldName=planitia&Name=${row.name}&RIWS=" textId="text_${i}">
        <td align="center" valign="top">
          <img width="30" src="${row.icon ?? '/five/icons/House64.gif'}">
        </td>
        <td style="padding-left: 7px" valign="top">
          <div id=text_${i} class=listItem>
            ${row.name}&nbsp;
          </div>
          <div class=itemInfo>
            ${opts.showCompany ? row.company : `(${row.x}, ${row.y})`}
          </div>
        </td>
      </tr>
      <tr>
        <td></td>
        <td width="*" style="padding-left: 7px" valign="top">
          ${opts.withMapLink === false ? '' : `<div class=itemInfo style="margin-bottom: 10px">
            <a href="http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=${row.x}&y=${row.y}">Show in map</a>
          </div>`}
        </td>
      </tr>`).join('');
  }

  const ROWS = [
    { name: 'Cheap House 1', company: 'Crazz Ltd.', x: 120, y: 340 },
    { name: 'Cheap House 2', company: 'Other Ltd.', x: 121, y: 341 },
  ];

  it('names the owning company on the ShowCompany branch (BrowseTownFacFolder.asp:53)', () => {
    const html = `<html><body><table cellspacing="0">${facilityRows({ showCompany: true, rows: ROWS })}</table></body></html>`;

    const rows = parseFacilityListPage(html, DIR_BASE);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      name: 'Cheap House 1',
      itemName: 'Cheap House 1',
      path: 'Towns\\Helartia.five\\Facilities\\Residentials',
      iconUrl: 'http://158.69.153.134/five/icons/House64.gif',
      company: 'Crazz Ltd.',
      x: 120,
      y: 340,
    });
    expect(rows[1].company).toBe('Other Ltd.');
  });

  it('reports no company and the printed pair on the coordinates branch (BrowseTownCompFacFolder.asp:65)', () => {
    const html = `<html><body><table cellspacing="0">${facilityRows({ showCompany: false, rows: ROWS })}</table></body></html>`;

    const rows = parseFacilityListPage(html, DIR_BASE);

    expect(rows[0].company).toBeNull();
    expect(rows[0]).toMatchObject({ x: 120, y: 340 });
    expect(rows[1].company).toBeNull();
  });

  it('falls back to the printed pair when the row that follows carries no map link', () => {
    const html = `<html><body><table cellspacing="0">${facilityRows({
      showCompany: false, rows: [ROWS[0]], withMapLink: false,
    })}</table></body></html>`;

    expect(parseFacilityListPage(html, DIR_BASE)[0]).toMatchObject({ company: null, x: 120, y: 340 });
  });

  it('falls back to 0,0 when neither the link nor a printed pair is there', () => {
    const html = `<html><body><table cellspacing="0">${facilityRows({
      showCompany: true, rows: [ROWS[0]], withMapLink: false,
    })}</table></body></html>`;

    expect(parseFacilityListPage(html, DIR_BASE)[0]).toMatchObject({ company: 'Crazz Ltd.', x: 0, y: 0 });
  });

  it('joins a relative facility icon onto the directory base', () => {
    const html = `<html><body><table cellspacing="0">${facilityRows({
      showCompany: true, rows: [{ ...ROWS[0], icon: 'images/fac.gif' }],
    })}</table></body></html>`;

    expect(parseFacilityListPage(html, DIR_BASE)[0].iconUrl).toBe(`${DIR_BASE}/images/fac.gif`);
  });

  it('leaves iconUrl empty when the visual class gave no image', () => {
    const html = `<html><body><table cellspacing="0">${facilityRows({
      showCompany: true, rows: [{ ...ROWS[0], icon: '' }],
    })}</table></body></html>`;

    expect(parseFacilityListPage(html, DIR_BASE)[0].iconUrl).toBe('');
  });

  it('skips a row with no name, and leaves path/itemName empty on a link it cannot read', () => {
    const html = `<html><body><table cellspacing="0">
      <tr dirHref="OpenFacility.asp?Path=X&WorldName=planitia&Name=Y&RIWS=">
        <td><div class=listItem>&nbsp;</div></td>
      </tr>
      <tr dirHref="OpenFacility.asp?Broken">
        <td><div class=listItem>Nameless Link</div><div class=itemInfo>Crazz Ltd.</div></td>
      </tr>
    </table></body></html>`;

    const rows = parseFacilityListPage(html, DIR_BASE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Nameless Link', path: '', itemName: '' });
  });
});

describe('parseFacilityPage', () => {
  /** OpenFacility.asp:32-97, with the ROI branch the page took at :64-72. */
  function facilityPage(opts: {
    roi: number;
    netProfit?: string;
    cost?: string;
    creator?: string;
    icon?: string;
    composerHref?: string;
  }): string {
    const roiText = opts.roi === 0 ? 'Already.' : opts.roi > 0 ? `${opts.roi} years.` : 'Never.';
    const composer = opts.composerHref
      ?? `http://local.asp?frame_Id=MsgComposer&frame_Class=MsgComposer&frame_Align=client&frame_Height=50%&frame_Action=new&To=${opts.creator ?? 'SPO_test3'}`;
    return `<html><head></head><body style="margin-left: 12px">
      <div style="text-align: center">
        <div><img src="${opts.icon ?? '/five/icons/House64.gif'}"></div>
        <div class=header2>Cheap House 1</div>
        <div class=itemHeader>Crazz Ltd.</div>
        <table cellspacing=0 cellpadding=2 style="margin: 5px">
          <tr><td class=label>Net profit:</td><td class=value>${opts.netProfit ?? '$1,234,567'}</td></tr>
          <tr><td class=label>Cost:</td><td class=value>${opts.cost ?? '-$500'}</td></tr>
          <tr><td class=label>ROI:</td><td class=value>
            ${roiText}
          </td></tr>
        </table>
        <div><a href="${composer}">Send mail</a></div>
        <div><a href="http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=120&y=340">Show in map</a></div>
      </div>
    </body></html>`;
  }

  it('reads the whole card, with ROI "Already." when the facility has paid for itself', () => {
    const card = parseFacilityPage(facilityPage({ roi: 0 }), DIR_BASE);

    expect(card).toEqual({
      name: 'Cheap House 1',
      company: 'Crazz Ltd.',
      iconUrl: 'http://158.69.153.134/five/icons/House64.gif',
      netProfitText: '$1,234,567',
      costText: '-$500',
      roiText: 'Already.',
      creator: 'SPO_test3',
      x: 120,
      y: 340,
    });
  });

  it('carries "<N> years." for a positive ROI', () => {
    expect(parseFacilityPage(facilityPage({ roi: 12 }), DIR_BASE)!.roiText).toBe('12 years.');
  });

  it('carries "Never." for a negative ROI', () => {
    expect(parseFacilityPage(facilityPage({ roi: -1 }), DIR_BASE)!.roiText).toBe('Never.');
  });

  it('carries the "$0" FormatValue writes for a zero amount, verbatim', () => {
    const card = parseFacilityPage(facilityPage({ roi: 0, netProfit: '$0', cost: '$0' }), DIR_BASE);

    expect(card).toMatchObject({ netProfitText: '$0', costText: '$0' });
  });

  it('reads a creator name that carries a raw space, past the unescaped frame_Height=50%', () => {
    expect(parseFacilityPage(facilityPage({ roi: 0, creator: 'SPO test3' }), DIR_BASE)!.creator).toBe('SPO test3');
  });

  it('names nobody when the composer link is not a URL the parser can read', () => {
    const card = parseFacilityPage(facilityPage({ roi: 0, composerHref: 'frame_Id=MsgComposer&To=Crazz' }), DIR_BASE);

    expect(card!.creator).toBe('');
  });

  it('returns null for the empty body a failed cache path renders (OpenFacility.asp:29)', () => {
    const html = '<html><head></head><body style="margin-left: 12px"></body></html>';

    expect(parseFacilityPage(html, DIR_BASE)).toBeNull();
  });
});

describe('parseDirectoryPage', () => {
  const TOWN_HTML = '<html><body><div class=header2>Helartia</div></body></html>';
  const FOLDER_HTML = '<html><body><table><tr dirHref="X.asp?A=1"><td><div class=listItem>Farms</div></td></tr></table></body></html>';
  const LIST_HTML = `<html><body><table>
    <tr dirHref="OpenFacility.asp?Path=P&WorldName=planitia&Name=N&RIWS=">
      <td><div class=listItem>Cheap House 1</div><div class=itemInfo>Crazz Ltd.</div></td>
    </tr>
  </table></body></html>`;
  const CARD_HTML = '<html><body><div class=header2>Cheap House 1</div><div class=itemHeader>Crazz Ltd.</div></body></html>';

  const FOLDER_REFS: DirectoryRef[] = [
    { kind: 'town-facilities', town: 'Helartia' },
    { kind: 'town-companies', town: 'Helartia' },
    { kind: 'town-company', town: 'Helartia', company: 'Crazz Ltd.' },
    { kind: 'tycoon-companies', tycoon: 'Crazz' },
    { kind: 'tycoon-company', tycoon: 'Crazz', company: 'Crazz Ltd.' },
  ];

  const LIST_REFS: DirectoryRef[] = [
    { kind: 'town-facility-kind', town: 'Helartia', facKind: 'Residentials' },
    { kind: 'town-company-facility-kind', town: 'Helartia', company: 'Crazz Ltd.', facKind: 'Residentials' },
    { kind: 'tycoon-facility-kind', tycoon: 'Crazz', company: 'Crazz Ltd.', facKind: 'Residentials' },
  ];

  it('sends a town ref to the town parser', () => {
    const page = parseDirectoryPage({ kind: 'town', path: 'Towns\\Helartia', classId: '1234' }, TOWN_HTML, DIR_BASE);

    expect(page).toEqual({ kind: 'town', town: expect.objectContaining({ name: 'Helartia' }) });
  });

  it('sends every folder ref to the folder parser', () => {
    for (const ref of FOLDER_REFS) {
      expect(parseDirectoryPage(ref, FOLDER_HTML, DIR_BASE)).toEqual({
        kind: 'folder', items: ['Farms'], ownedBy: null,
      });
    }
  });

  it('sends every facility-kind ref to the facility list parser', () => {
    for (const ref of LIST_REFS) {
      const page = parseDirectoryPage(ref, LIST_HTML, DIR_BASE);
      expect(page.kind).toBe('facility-list');
      expect(page).toMatchObject({ facilities: [expect.objectContaining({ name: 'Cheap House 1' })] });
    }
  });

  it('sends a facility ref to the card parser', () => {
    const page = parseDirectoryPage({ kind: 'facility', path: 'P', name: 'N' }, CARD_HTML, DIR_BASE);

    expect(page).toEqual({ kind: 'facility', facility: expect.objectContaining({ name: 'Cheap House 1' }) });
  });
});
