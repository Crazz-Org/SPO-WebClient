/**
 * Tests for search-menu-parser — parseHomePage, parseTycoonProfile.
 */

import { parseHomePage, parseTycoonProfile, parseNewspapersPage, parseTownsPage, parseRankingDetail } from '../search-menu-parser';

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
