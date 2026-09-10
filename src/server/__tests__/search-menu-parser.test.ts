/**
 * Tests for search-menu-parser — parseHomePage, parseTycoonProfile.
 */

import { parseHomePage, parseTycoonProfile, parseNewspapersPage } from '../search-menu-parser';

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
