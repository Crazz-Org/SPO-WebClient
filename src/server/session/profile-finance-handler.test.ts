/**
 * profile-finance-handler — the tycoon profile / curriculum / bank / P&L /
 * companies scrapes. No RDO on this file at all: five ASP pages through
 * `ctx.fetchAspPage`, plus two direct `node-fetch` calls — RenderTycoon.asp
 * for the avatar (:66) and, the one that moves REAL MONEY, the bank action GET
 * (:499). Hence the module mock at the top.
 *
 * ── Fixtures ──────────────────────────────────────────────────────────────
 * Every fixture below is instantiated from the ASP source
 * (`IIS_ROOT/Five/0/Visual/Voyager/…`), language strings resolved from
 * `Five/0/language/eNewTycon.lng` and `NewLogon.lng`, tabs, unquoted
 * attributes and the source's own typos preserved — `<td id="r0Bank"class=value`
 * with no space (TycoonBankAccount.asp:551) is real markup, not a slip here.
 *
 * The lot-4 fixtures were written from our parsers, so they proved that the
 * parsers read their own assumptions: the curriculum pairs, for instance, only
 * matched a `</span>class=value>` shape no ASP page can produce. Re-derived
 * here from the pages, they revive the audit's 18 NE MATCHE PAS and pin the
 * correction of each.
 *
 * Branches these fixtures reach for the first time: `FullAccess=false`
 * (bank + curriculum), `SuperRole<>0` (no level block at all), `CurrLevel>5`
 * (levelLegendX.gif), a loan with an empty `LoanBankName`, a negative
 * `FormatValue`, and a P&L level-2 total flushed in its own row.
 */

jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import {
  fetchTycoonProfile,
  fetchCurriculumData,
  fetchBankAccount,
  executeBankAction,
  fetchProfitLoss,
  fetchCompanyProfitLoss,
  fetchCompanies,
} from './profile-finance-handler';
import { makeSessionCtx } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx, AspActionUrl } from '../__tests__/session/fake-session-context';
import type { SessionContext } from './session-context';
import type { WorldInfo, ProfitLossNode } from '../../shared/types';

const mockFetch = fetch as unknown as jest.MockedFunction<
  (url: string, init?: unknown) => Promise<Response>
>;

function htmlResponse(body: string, status = 200): Response {
  return { status, ok: status === 200, text: async () => body } as unknown as Response;
}

const WORLD: WorldInfo = { name: 'Shamba', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 7000 };
const IS_BASE = 'http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/';
const CURRICULUM = 'NewTycoon/TycoonCurriculum.asp';
const BANK = 'NewTycoon/TycoonBankAccount.asp';

type FetchAsp = jest.MockedFunction<SessionContext['fetchAspPage']>;
type SetCache = jest.MockedFunction<SessionContext['setAspActionCache']>;
type GetCache = jest.MockedFunction<SessionContext['getAspActionCache']>;
type SetMoney = jest.MockedFunction<SessionContext['setAccountMoney']>;

function fetchAsp(fake: FakeSessionCtx): FetchAsp { return fake.ctx.fetchAspPage as FetchAsp; }
function setCache(fake: FakeSessionCtx): SetCache { return fake.ctx.setAspActionCache as SetCache; }
function getCache(fake: FakeSessionCtx): GetCache { return fake.ctx.getAspActionCache as GetCache; }
function setMoney(fake: FakeSessionCtx): SetMoney { return fake.ctx.setAccountMoney as SetMoney; }

function makeWebCtx(overrides: Partial<SessionContext> = {}): FakeSessionCtx {
  const fake = makeSessionCtx({
    currentWorldInfo: WORLD, activeUsername: 'SPO_test3', cachedPassword: 'test3',
    daAddr: '10.0.0.5', daPort: 1111, accountMoney: '123456789',
    lastRanking: 42, lastBuildingCount: 13, lastMaxBuildings: 100, failureLevel: 2,
    currentCompany: { id: '77', name: 'SPO_test3 - Green' },
    ...overrides,
  });
  (fake.ctx.buildAspUrl as jest.MockedFunction<SessionContext['buildAspUrl']>)
    .mockImplementation((aspPath: string) => `http://158.69.153.134/Five/0/Visual/Voyager/${aspPath}?RIWS=`);
  return fake;
}

/** Query string of the n-th fetch call, decoded. */
function queryOf(n: number): URLSearchParams {
  const url = mockFetch.mock.calls[n][0];
  return new URLSearchParams(url.substring(url.indexOf('?') + 1));
}

function cacheWith(entries: Array<[string, AspActionUrl]>): Map<string, AspActionUrl> {
  return new Map(entries);
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES — TycoonCurriculum.asp
// ═══════════════════════════════════════════════════════════════════════════

const T = (n: number) => '\t'.repeat(n);

/** One `<div class=label>…<span class=value>` stat block — :128-147. */
function currStat(label: string, value: string, style: string): string {
  return `${T(5)}<div class=label style="${style}">\n`
    + `${T(6)}${label}:\n`
    + `${T(6)}<span class=value>\n`
    + `${T(7)}${value}\n`
    + `${T(6)}</span>\n`
    + `${T(5)}</div>`;
}

interface CurriculumOpts {
  objValid?: boolean;
  fullAccess?: boolean;
  /** `Obj.SuperRole` — non-zero hides the WHOLE level + rankings block (:215). */
  superRole?: number;
  demo?: boolean;
  currLevel?: number;
  levelName?: string;
  levelDesc?: string;
  levelCond?: string;
  levelReqStatus?: string;
  nextLevelName?: string;
  nextLevelDesc?: string;
  nextLevelCond?: string;
  advanceToNextLevel?: boolean;
  /** `FormatValue(Obj.Budget)` — `-$1,234` when negative (:17-23, :131). */
  fortune?: string;
  /** `''` drops the whole Average Profit block (:134). */
  profitAverage?: string;
  prestige?: number;
  nobility?: number;
  ranks?: Array<[string, string]>;
  items?: Array<[string, string]>;
  /** `Obj.TournamentOn = "1"` — renders the Ability block (:162-174). */
  tournamentOn?: boolean;
  /** Rendered verbatim, so a component can be blank (`:37-53` coerces blank to 0). */
  abilityPoints?: [string, string, string];
}

/** :162-174 — the Ability block, rendered only on tournament worlds. Literal `&nbsp` with no
 * trailing semicolon, matching the ASP's own markup. */
function abilityStat(total: string, [rank, level, loan]: [string, string, string]): string {
  return `${T(5)}<div class=label style="margin-left: 20px; margin-top: 5px; margin-bottom: 20px">\n`
    + `${T(6)}Ability:\n`
    + `${T(6)}<span class=value>\n`
    + `${T(7)}${total}  points\n`
    + `${T(8)}&nbsp(\n`
    + `${T(9)}${rank}&nbspfrom the rankings,\n`
    + `${T(9)}${level}&nbspfor being at the highest level,\n`
    + `${T(9)}${loan}&nbspfor having loans\n`
    + `${T(8)})\n`
    + `${T(6)}</span>\n`
    + `${T(5)}</div>`;
}

/** TycoonCurriculum.asp rendered for Five/0 (LangId = 0). */
function curriculumPage(opts: CurriculumOpts = {}): string {
  const o = {
    objValid: true, fullAccess: true, superRole: 0, demo: false,
    currLevel: 4, levelName: 'Paradigm',
    levelDesc: 'You are a <b>paradigm</b>   of industry.',
    levelCond: '', levelReqStatus: '',
    nextLevelName: 'Legend', nextLevelDesc: 'Legends <i>shape</i> worlds.',
    nextLevelCond: 'Prestige 5000 and <b>50</b> facilities',
    advanceToNextLevel: true,
    fortune: '$1,234,567', profitAverage: '$88,000',
    prestige: 1234, nobility: 2500,
    ranks: [['Fortune', '7'], ['Prestige', '-'], ['Population', ''], ['Weird', 'abc']] as Array<[string, string]>,
    items: [['Built a <b>Farm</b>', '+120'], ['Bankruptcy', '-1,000'], ['', '+5']] as Array<[string, string]>,
    tournamentOn: false,
    abilityPoints: ['0', '0', '0'] as [string, string, string],
    ...opts,
  };

  // :63-109 — the <head> script. `onAdvanceClick` is declared here
  // UNCONDITIONALLY: that is what made `canUpgrade` always true (B-9).
  const head = `<head>
${T(1)}<title>\tTycoon Options </title>
${T(1)}<link rel="STYLESHEET" href="../voyager.css" type="text/css">

${T(1)}<script language="JScript">

${T(2)}function onBtnClick()
${T(2)}{
${T(3)}var td = getCell( event.srcElement );
${T(3)}if (td != null && td.tagName == "TD")
${T(4)}switch (td.command)
${T(4)}{
${T(5)}case "reset" :
${T(6)}var URL = "resetTycoon.asp?Tycoon=SPO_test3&WorldName=Shamba&DAAddr=10.0.0.5&DAPort=1111&TycoonId=&Password=test3";
${T(6)}window.navigate(URL);
${T(6)}break;
${T(5)}case "abandon" :
${T(6)}var URL = "abandonRole.asp?Tycoon=SPO_test3&WorldName=Shamba&DAAddr=10.0.0.5&DAPort=1111&TycoonId=&Password=test3";
${T(6)}window.navigate(URL);
${T(6)}break;
${T(4)}}
${T(2)}}

${T(2)}function onAdvanceClick()
${T(2)}{
${T(3)}var URL = getBaseURL() +
${T(4)}"rdoSetAdvanceLevel.asp" +
${T(4)}"?TycoonId=4666201923" +
${T(4)}"&Password=test3" +
${T(4)}"&Value=" + event.srcElement.checked +
${T(4)}"&WorldName=Shamba" +
${T(4)}"&DAAddr=10.0.0.5" +
${T(4)}"&DAPort=1111" +
${T(4)}"&Tycoon=SPO_test3";
${T(3)}hiddenFrame.navigate( URL );
${T(2)}}

${T(1)}</script>

</head>`;

  if (!o.objValid) {
    // :417-420 — StrTycoonCurriculum_14
    return `${head}\n<body>\n${T(4)}<div class=header2 style="padding: 20px">\n`
      + `${T(5)}Sorry, cannot retrieve Tycoon information from server.\n${T(4)}</div>\n</body>`;
  }

  const stats = [
    `${T(4)}<div class=header2>\n${T(5)}Curriculum\n${T(4)}</div>`,
    currStat('Personal Fortune', o.fortune, 'margin-left: 20px; margin-top: 20px'),
    ...(o.profitAverage === ''
      ? []
      : [currStat('Average Profit (this year)', `${o.profitAverage}/h`, 'margin-left: 20px; margin-top: 5px')]),
    currStat('Total Prestige', `${o.prestige}  points`, 'margin-left: 20px; margin-top: 5px'),
    currStat('Nobility', o.nobility > 5 ? `${o.nobility}  points` : ' 0 points',
      'margin-left: 20px; margin-top: 5px; margin-bottom: 20px'),
    ...(o.tournamentOn
      ? [abilityStat(
          String(
            (parseInt(o.abilityPoints[0], 10) || 0)
            + (parseInt(o.abilityPoints[1], 10) || 0)
            + (parseInt(o.abilityPoints[2], 10) || 0)
          ),
          o.abilityPoints
        )]
      : []),
  ];

  // :175-211 — reset (SuperRole = 0) or abandon (SuperRole <> 0), FullAccess only
  const button = (command: string, label: string) =>
    `${T(4)}<table style="margin-left: 20px; margin-bottom: 20px">\n`
    + `${T(5)}<tr>\n`
    + `${T(6)}<td class=button align="left" width="100"\n`
    + `${T(7)}onClick="onBtnClick()"\n`
    + `${T(7)}command="${command}"\n`
    + `${T(7)}normColor="#345950"\n`
    + `${T(7)}hiColor="white">\n\n`
    + `${T(8)}${label}\n`
    + `${T(6)}</td>\n${T(5)}</tr>\n${T(4)}</table>`;
  if (o.fullAccess) {
    stats.push(o.superRole === 0 ? button('reset', 'Reset Account') : button('abandon', 'Resign'));
  }

  const body: string[] = [...stats];

  if (o.superRole === 0) {
    // :215-317 — level block
    const advanceBox = o.fullAccess && o.nextLevelName !== ''
      ? (o.demo
        ? `${T(9)}<div class=label style="margin-top: 10px; color: white">\n${T(10)}<b>NOTE:</b> since this is a <b>DEMO</b> account, you cannot level.\n${T(9)}</div>`
        : `${T(9)}<div class=label style="margin-top: 10px; color: white">\n`
          + `${T(10)}<input type="checkbox" ${o.advanceToNextLevel ? 'checked' : ''} onClick="onAdvanceClick()">\n`
          + `${T(10)}Upgrade to next level\n${T(9)}</div>`)
      : '';
    const levelImg = o.currLevel <= 5
      ? `images/level${o.levelName}.gif`
      : 'images/levelLegendX.gif';

    const currentTd = `${T(6)}<td valign="top" align="left" width=190>\n`
      + `${T(7)}<div class=header2>\n${T(8)}Current Level\n${T(7)}</div>\n`
      + `${T(7)}<div class=header1>\n${T(8)}${o.levelName}\n${T(7)}</div>\n`
      + `${T(7)}<table>\n${T(8)}<tr>\n`
      + `${T(9)}<td valign="top" align="left" width=90>\n`
      + `${T(10)}<img src="${levelImg}" width=80 height=80>\n${T(9)}</td>\n`
      + `${T(9)}<td class=label>\n${T(9)}</td>\n`
      + `${T(8)}</tr>\n${T(7)}</table>\n`
      + `${T(7)}<div class=label>\n${T(8)}${o.levelDesc}\n${T(7)}</div>\n`
      + (o.levelCond ? `${T(8)}<div class=label>\n${T(9)}${o.levelCond}\n${T(8)}</div>\n` : '')
      + (advanceBox ? `${advanceBox}\n` : '')
      + (o.levelReqStatus
        ? `${T(8)}<div class=label style="color: white; margin-top: 7px; text-align: center; padding: 7px; background-color: maroon; font-weight: bold">\n${T(9)}${o.levelReqStatus}.\n${T(8)}</div>\n`
        : '')
      + `${T(6)}</td>`;

    // :268-315 — the next-level column exists only when NextLevelName <> ""
    const nextTd = o.nextLevelName === '' ? '' : `${T(6)}<td background="images/vertline.gif" width=120 align="center" valign="center">\n`
      + `${T(7)}<div id=arrow style="visibility: ${o.advanceToNextLevel ? 'visible' : 'hidden'}">\n`
      + `${T(8)}<img src="images/levelsarrow.gif" width=114 height=19>\n${T(8)}<br>\n${T(8)}<br>\n`
      + `${T(8)}<img src="images/reqframe.gif" width=92 height=73>\n${T(7)}</div>\n${T(6)}</td>\n`
      + `${T(6)}<td>\n`
      + `${T(6)}<td valign="top" align="left" width=190>\n`
      + `${T(7)}<div class=header2>\n${T(8)}Next Level \n${T(7)}</div>\n`
      + `${T(7)}<div class=header1>\n${T(8)}${o.nextLevelName}\n${T(7)}</div>\n`
      + `${T(7)}<table>\n${T(8)}<tr>\n`
      + `${T(9)}<td valign="top" align="left" width=90>\n`
      + `${T(10)}<img src="images/level${o.nextLevelName}Disabled.gif" width=80 height=80>\n${T(9)}</td>\n`
      + `${T(9)}<td>\n${T(10)}<td class>\n${T(9)}</td>\n`
      + `${T(8)}</tr>\n${T(7)}</table>\n`
      + `${T(7)}<div class=label>\n${T(8)}${o.nextLevelDesc}\n${T(7)}</div>\n`
      + `${T(7)}<div class=label style="margin-top: 10px; color: white; font-weight: bold">\n${T(8)}Requires:\n${T(7)}</div>\n`
      + `${T(7)}<div class=label style="margin-top: 10px; color: white">\n${T(8)}${o.nextLevelCond}\n${T(7)}</div>\n`
      + `${T(6)}</td>\n${T(6)}</td>`;

    body.push(`${T(4)}<table cellspacing=0 width=500>\n${T(5)}<tr>\n${currentTd}\n${nextTd}\n${T(5)}</tr>\n${T(4)}</table>\n${T(4)}<br>`);

    // :320-344 — rankings, three per row
    const rankCells = o.ranks.map(([name, pos], i) =>
      (i % 3 === 0 ? `${T(5)}<tr>\n` : '')
      + `${T(6)}<td class=label>\n${T(7)}${name}\n${T(6)}</td>\n`
      + `${T(6)}<td align=right class=value>\n${T(7)}${pos}\n${T(6)}</td>\n`
      + `${T(6)}<td width=20px>\n${T(6)}</td>`
      + ((i + 1) % 3 === 0 ? `\n${T(5)}</tr>` : '')).join('\n');
    body.push(`${T(4)}<div class=header2>\n${T(5)}SPO_test3  in the rankings\n${T(4)}</div>\n`
      + `${T(4)}<table style="margin-top: 10px; margin-left: 20px; margin-bottom: 20px">\n${rankCells}\n${T(4)}</table>`);
  }

  // :369-416 — curriculum items
  const itemRows = o.items.map(([desc, prestige]) =>
    `${T(5)}<tr>\n${T(6)}<td>\n${T(6)}</td>\n`
    + `${T(6)}<td class=value>\n${T(7)}${desc}\n${T(6)}</td>\n`
    + `${T(6)}<td class=value>\n${T(7)}${prestige}\n${T(6)}</td>\n${T(5)}</tr>`).join('\n');
  body.push(`${T(4)}<div class=header2>\n${T(5)}Curriculum items\n${T(4)}</div>\n`
    + `${T(4)}<table width=100% style="margin-top: 10px">\n`
    + `${T(5)}<tr>\n${T(6)}<td width=20>\n${T(6)}</td>\n`
    + `${T(6)}<td class=label>\n${T(7)}Item \n${T(6)}</td>\n`
    + `${T(6)}<td class=label>\n${T(7)}Prestige\n${T(6)}</td>\n${T(5)}</tr>\n`
    + `${T(5)}<tr>\n${T(6)}<td colspan=3 height=1 style="background-color: #345950">\n${T(6)}</td>\n${T(5)}</tr>\n`
    + `${itemRows}\n${T(4)}</table>`);

  return `${head}\n\n<body>\n\n${T(1)}<div id=main">\n${T(1)}<table width="100%" height="100%" cellspacing="0">\n`
    + `${T(2)}<tr>\n${T(3)}<td valign="top" style="padding: 20px">\n`
    + body.join('\n') + `\n${T(3)}</td>\n${T(2)}</tr>\n${T(1)}</table>\n${T(1)}</div>\n`
    + `${T(1)}<iframe id=hiddenFrame style="display: none">\n\n</body>`;
}

const CURRICULUM_HTML = curriculumPage();

// ═══════════════════════════════════════════════════════════════════════════
// fetchTycoonProfile
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchTycoonProfile', () => {
  it('seeds the profile from the session pushes, then enriches it from TycoonCurriculum.asp', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(CURRICULUM_HTML);
    mockFetch.mockResolvedValue(htmlResponse(''));

    const profile = await fetchTycoonProfile(fake.ctx);

    expect(fetchAsp(fake)).toHaveBeenCalledWith(CURRICULUM, { RIWS: '' });
    expect(profile).toEqual({
      name: 'SPO_test3',
      realName: '',
      ranking: 42,
      budget: '123456789',
      // From the page: `Total Prestige` (:143) and `Nobility` (:153).
      prestige: 1234,
      nobPoints: 2500,
      // NOT on the page — no such label in TycoonCurriculum.asp nor in
      // eNewTycon.lng. facCount/facMax keep their RDO-push values, the other
      // three have no transport-C source at all.
      facPrestige: 0,
      researchPrestige: 0,
      area: 0,
      facCount: 13,
      facMax: 100,
      licenceLevel: 4,
      failureLevel: 2,
      levelName: 'Paradigm',
      levelTier: 4,
    });
  });

  it('with a photo: GETs RenderTycoon.asp with encoded world/tycoon and proxies the img#picture src', async () => {
    const fake = makeWebCtx({ activeUsername: 'SPO test3', currentWorldInfo: { ...WORLD, name: 'New World' } });
    fetchAsp(fake).mockResolvedValue('');
    // RenderTycoon.asp:58 — the src is root-relative, served from the host root.
    mockFetch.mockResolvedValue(htmlResponse(
      `${T(2)}<img id=picture src="/fivedata/userinfo/New World/SPO test3/largephoto.jpg" width=150 height=200><br>`,
    ));

    const profile = await fetchTycoonProfile(fake.ctx);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://158.69.153.134/five/0/visual/voyager/new%20directory/RenderTycoon.asp?WorldName=New%20World&Tycoon=SPO%20test3&RIWS=',
      expect.objectContaining({ redirect: 'follow', signal: expect.any(AbortSignal) }),
    );
    // Regression guard for B-11. This used to resolve against the page
    // DIRECTORY, producing `…/new%20directory//fivedata/…` — a guaranteed 404,
    // so the avatar was never displayed.
    expect(profile.photoUrl).toBe(
      `/proxy-image?url=${encodeURIComponent('http://158.69.153.134/fivedata/userinfo/New World/SPO test3/largephoto.jpg')}`,
    );
  });

  it('a directory-relative src still resolves against the page directory', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('');
    mockFetch.mockResolvedValue(htmlResponse('<img id="picture" src="photos/spo.jpg" width=64>'));
    const profile = await fetchTycoonProfile(fake.ctx);
    expect(profile.photoUrl).toBe(`/proxy-image?url=${encodeURIComponent('http://158.69.153.134/five/0/visual/voyager/new%20directory/photos/spo.jpg')}`);
  });

  it('accepts src before id, and keeps an absolute src as-is', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('');
    mockFetch.mockResolvedValue(htmlResponse(`<img src='http://cdn/x.png' id=picture>`));
    const profile = await fetchTycoonProfile(fake.ctx);
    expect(profile.photoUrl).toBe(`/proxy-image?url=${encodeURIComponent('http://cdn/x.png')}`);
  });

  it('without a photo: no photoUrl', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('');
    mockFetch.mockResolvedValue(htmlResponse('<html><body>no picture here</body></html>'));
    const profile = await fetchTycoonProfile(fake.ctx);
    expect(profile.photoUrl).toBeUndefined();
  });

  it('a failing curriculum fetch is warned about; the push data is still returned', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockRejectedValue(new Error('ASP request failed: 500 Internal Server Error'));
    mockFetch.mockResolvedValue(htmlResponse(''));

    const profile = await fetchTycoonProfile(fake.ctx);

    expect(profile).toMatchObject({ name: 'SPO_test3', ranking: 42, budget: '123456789', facCount: 13, facMax: 100, failureLevel: 2, levelName: '', prestige: 0 });
    expect(fake.log.warn).toHaveBeenCalledWith('[Profile] TycoonCurriculum.asp fetch failed, using push data only:', expect.any(Error));
  });

  it('a failing photo fetch is warned about; the profile is still returned', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('');
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));
    const profile = await fetchTycoonProfile(fake.ctx);
    expect(profile.name).toBe('SPO_test3');
    expect(profile.photoUrl).toBeUndefined();
    expect(fake.log.warn).toHaveBeenCalledWith('[Profile] RenderTycoon.asp photo fetch failed:', expect.any(Error));
  });

  it('skips the photo fetch without a world ip, and without a name', async () => {
    const a = makeWebCtx({ currentWorldInfo: null });
    fetchAsp(a).mockResolvedValue('');
    await fetchTycoonProfile(a.ctx);
    expect(mockFetch).not.toHaveBeenCalled();

    const b = makeWebCtx({ activeUsername: null, cachedUsername: null });
    fetchAsp(b).mockResolvedValue('');
    const profile = await fetchTycoonProfile(b.ctx);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(profile.name).toBe('');
  });

  it('falls back to cachedUsername, budget "0" and failureLevel 0 when the session has none', async () => {
    const fake = makeWebCtx({ activeUsername: null, cachedUsername: 'Cached', accountMoney: null, failureLevel: null, currentWorldInfo: { ...WORLD, name: '' } });
    fetchAsp(fake).mockResolvedValue('');
    mockFetch.mockResolvedValue(htmlResponse(''));
    const profile = await fetchTycoonProfile(fake.ctx);
    expect(profile).toMatchObject({ name: 'Cached', budget: '0', failureLevel: 0 });
    expect(mockFetch.mock.calls[0][0]).toContain('WorldName=&Tycoon=Cached');
  });

  describe('parseCurriculumHtml against the real markup', () => {
    async function parse(html: string, overrides: Partial<SessionContext> = {}) {
      const fake = makeWebCtx({ currentWorldInfo: null, ...overrides });
      fetchAsp(fake).mockResolvedValue(html);
      return fetchTycoonProfile(fake.ctx);
    }

    // Regression guard for B-8. The pattern demanded a `</span>` or `</div>`
    // between the label and `class=value`; the page closes nothing there
    // (:142-147), so NO pair was ever extracted and prestige/nobility stayed 0
    // on every real page while the lot-4 fixture — shaped like the regex —
    // reported them fine.
    it('reads Total Prestige and Nobility out of the page markup', async () => {
      const profile = await parse(curriculumPage({ prestige: 4210, nobility: 987 }));
      expect(profile).toMatchObject({ prestige: 4210, nobPoints: 987 });
    });

    // Second half of B-8: the label is `strTotalPrestige` = "Total Prestige"
    // (eNewTycon.lng:124), so a switch keyed on `prestige` never fired even
    // with the regex repaired.
    it('the bare key "Prestige" is not what the page emits — the rankings row carries it and must not be read as a stat', async () => {
      const profile = await parse(curriculumPage({ prestige: 4210 }));
      // `Prestige` appears twice more on the page: as a ranking category
      // (:329) and as the curriculum items column header (:380).
      expect(profile.prestige).toBe(4210);
    });

    it('a Nobility of 5 or less renders a literal 0 (:155-159)', async () => {
      const profile = await parse(curriculumPage({ nobility: 3 }));
      expect(profile.nobPoints).toBe(0);
    });

    it('the page carries no Buildings / Area / Facility prestige / Research prestige label at all', async () => {
      const html = curriculumPage();
      expect(html).not.toMatch(/Buildings\s*:/i);
      expect(html).not.toMatch(/\bArea\s*:/i);
      expect(html).not.toMatch(/Facility\s+prestige/i);
      expect(html).not.toMatch(/Research\s+prestige/i);
      const profile = await parse(html);
      // facCount / facMax keep the values the RDO pushes seeded.
      expect(profile).toMatchObject({ facCount: 13, facMax: 100, area: 0, facPrestige: 0, researchPrestige: 0 });
    });

    it('past level 5 the page renders levelLegendX.gif, which now maps to the top tier', async () => {
      // :233-236 — `images/levelLegendX.gif`. `LegendX` was absent from the
      // tier table, so a Legend+ tycoon silently fell back to tier 0.
      const profile = await parse(curriculumPage({ currLevel: 6, levelName: 'Legend' }));
      expect(profile).toMatchObject({ levelName: 'LegendX', levelTier: 6, licenceLevel: 6 });
    });

    it('an unknown level name is kept but maps to no tier', async () => {
      const profile = await parse('<img src="images/levelDemiGod.gif">');
      expect(profile).toMatchObject({ levelName: 'DemiGod', levelTier: 0, licenceLevel: 0 });
    });

    it('a mayor (SuperRole <> 0) gets no level image and no tier — the whole block is gone (:215)', async () => {
      const html = curriculumPage({ superRole: 1 });
      expect(html).not.toContain('images/level');
      expect(html).toContain('command="abandon"');
      const profile = await parse(html);
      expect(profile).toMatchObject({ levelName: '', levelTier: 0, prestige: 1234, nobPoints: 2500 });
    });

    it('an invalid tycoon (ObjValid false) yields the push data untouched', async () => {
      const profile = await parse(curriculumPage({ objValid: false }));
      expect(profile).toMatchObject({ prestige: 0, nobPoints: 0, levelName: '' });
    });

    it('a non-numeric prestige reads 0 and unknown labels are ignored', async () => {
      const html = currStat('Total Prestige', 'n/a  points', 'x')
        + currStat('Ability', '42  points', 'x')
        + currStat('Shoe size', '42', 'x');
      const profile = await parse(html);
      expect(profile).toMatchObject({ prestige: 0, nobPoints: 0 });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fetchCurriculumData + parseCurriculumDetails
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchCurriculumData', () => {
  it('re-fetches TycoonCurriculum.asp and parses every section', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(CURRICULUM_HTML);
    mockFetch.mockResolvedValue(htmlResponse(''));

    const data = await fetchCurriculumData(fake.ctx);

    // profile fetch + detail fetch
    expect(fetchAsp(fake)).toHaveBeenCalledTimes(2);
    expect(fake.ctx.buildAspUrl).toHaveBeenCalledWith(CURRICULUM, { RIWS: '' });
    expect(data).toEqual({
      tycoonName: 'SPO_test3',
      currentLevel: 4,
      currentLevelName: 'Paradigm',
      currentLevelDescription: 'You are a paradigm of industry.',
      currentLevelBadgeUrl: '/proxy-image?url=' + encodeURIComponent('http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/images/levelParadigm.gif'),
      currentLevelCondition: '',
      levelReqStatus: '',
      nextLevelName: 'Legend',
      nextLevelDescription: 'Legends shape worlds.',
      nextLevelRequirements: 'Prestige 5000 and 50 facilities',
      canUpgrade: true,
      isUpgradeRequested: true,
      fortune: '1234567',
      averageProfit: '$88,000/h',
      prestige: 1234,
      facPrestige: 0,
      researchPrestige: 0,
      budget: '123456789',
      ranking: 42,
      facCount: 13,
      facMax: 100,
      area: 0,
      nobPoints: 2500,
      tournamentOn: false,
      abilityTotal: 0,
      abilityRankingPoints: 0,
      abilityLevelPoints: 0,
      abilityLoanPoints: 0,
      rankings: [
        { category: 'Fortune', rank: 7 },
        { category: 'Prestige', rank: null },
        { category: 'Population', rank: null },
        { category: 'Weird', rank: null },
      ],
      curriculumItems: [
        { item: 'Built a Farm', prestige: 120 },
        { item: 'Bankruptcy', prestige: -1000 },
      ],
    });
    expect(data.tournamentOn).toBe(false);
  });

  it('a tournament world (Ability block present) parses the total and blank-tolerant components', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(
      curriculumPage({ tournamentOn: true, abilityPoints: ['10', '', '5'] })
    );
    mockFetch.mockResolvedValue(htmlResponse(''));

    const data = await fetchCurriculumData(fake.ctx);

    expect(data.tournamentOn).toBe(true);
    expect(data.abilityTotal).toBe(15);
    expect(data.abilityRankingPoints).toBe(10);
    expect(data.abilityLevelPoints).toBe(0);
    expect(data.abilityLoanPoints).toBe(5);
  });

  it('the "cannot retrieve" sentence flags cacheUnavailable', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(curriculumPage({ objValid: false }));
    mockFetch.mockResolvedValue(htmlResponse(''));
    const data = await fetchCurriculumData(fake.ctx);
    expect(data.cacheUnavailable).toBe(true);
    expect(data.curriculumItems).toEqual([]);
  });

  it('never throws when the re-fetch fails: flags cacheUnavailable instead', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockRejectedValue(new Error('ASP request failed: 500'));
    mockFetch.mockResolvedValue(htmlResponse(''));
    const data = await fetchCurriculumData(fake.ctx);
    expect(data.cacheUnavailable).toBe(true);
  });

  // Regression guard for B-20. `FormatValue` (:17-23) is
  // `FormatCurrency(v,0,0,0,-1)`: the 4th argument turns parentheses OFF, so a
  // negative balance renders `-$1,234,567` with the sign BEFORE the `$`. The
  // old pattern anchored on `$`, `[\s\S]*?` ate the `-`, and a ruined tycoon
  // was shown as a rich one.
  it('a negative Personal Fortune keeps its sign', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(curriculumPage({ fortune: '-$1,234,567', profitAverage: '-$88,000' }));
    mockFetch.mockResolvedValue(htmlResponse(''));
    const data = await fetchCurriculumData(fake.ctx);
    expect(data.fortune).toBe('-1234567');
    expect(data.averageProfit).toBe('-$88,000/h');
  });

  it('the parenthesised negative form of FormatCurrency is read too', async () => {
    // The server locale decides between `-$1,234` and `($1,234)`; the page
    // cannot tell us which, so both are accepted (audit §7.3, [INFERRED]).
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(curriculumPage({ fortune: '($1,234,567)' }));
    mockFetch.mockResolvedValue(htmlResponse(''));
    expect((await fetchCurriculumData(fake.ctx)).fortune).toBe('-1234567');
  });

  it('a Personal Fortune label whose value is not money leaves the session budget in place', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(currStat('Personal Fortune', 'n/a', 'margin-left: 20px'));
    mockFetch.mockResolvedValue(htmlResponse(''));
    expect((await fetchCurriculumData(fake.ctx)).fortune).toBe('123456789');
  });

  it('with no Average Profit block the field stays empty (:134)', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(curriculumPage({ profitAverage: '' }));
    mockFetch.mockResolvedValue(htmlResponse(''));
    expect((await fetchCurriculumData(fake.ctx)).averageProfit).toBe('');
  });

  // Regression guard for the current-level description (audit field 11). The
  // pattern demanded `<div` or end-of-input right after the closing `</div>`;
  // with no LevelCond, no upgrade box and no LevelReqStatus the next token is
  // `</td>`, the engine backtracked, and the NEXT level's description was
  // returned as the current one.
  it('reads the current level description even when nothing follows it in the td', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(curriculumPage({
      fullAccess: false, levelDesc: 'The current one.', nextLevelDesc: 'The next one.',
    }));
    mockFetch.mockResolvedValue(htmlResponse(''));
    const data = await fetchCurriculumData(fake.ctx);
    expect(data.currentLevelDescription).toBe('The current one.');
    expect(data.nextLevelDescription).toBe('The next one.');
  });

  it('renders LevelCond past level 5 without disturbing the description', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(curriculumPage({ currLevel: 6, levelCond: 'Keep 10 wonders.', levelReqStatus: 'Prestige is falling' }));
    mockFetch.mockResolvedValue(htmlResponse(''));
    expect((await fetchCurriculumData(fake.ctx)).currentLevelDescription).toBe('You are a paradigm of industry.');
  });

  it.each([
    ['', ''],
    ['Keep 10 wonders.', ''],
    ['', 'Prestige is falling'],
    ['Keep 10 wonders.', 'Prestige is falling'],
  ])('badge, condition and banner combine without disturbing the description (cond=%j status=%j)', async (levelCond, levelReqStatus) => {
    const fake = makeWebCtx();
    const currLevel = levelCond ? 6 : 4;
    fetchAsp(fake).mockResolvedValue(curriculumPage({ currLevel, levelCond, levelReqStatus }));
    mockFetch.mockResolvedValue(htmlResponse(''));

    const data = await fetchCurriculumData(fake.ctx);

    expect(data.currentLevelDescription).toBe('You are a paradigm of industry.');
    expect(data.currentLevelCondition).toBe(levelCond ? 'Keep 10 wonders.' : '');
    expect(data.levelReqStatus).toBe(levelReqStatus ? 'Prestige is falling.' : '');
    const badgeImg = currLevel <= 5 ? 'levelParadigm.gif' : 'levelLegendX.gif';
    expect(data.currentLevelBadgeUrl).toBe(
      '/proxy-image?url=' + encodeURIComponent(`http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/images/${badgeImg}`)
    );
  });

  // Regression guard for B-9. `function onAdvanceClick()` is declared
  // unconditionally in the <head> (:91), so `/onAdvanceClick/i.test(html)` was
  // ALWAYS true: the "level up" control was offered to players with no next
  // level, without FullAccess, and to DEMO accounts. The checkbox at :257 is
  // rendered exactly under `FullAccess and NextLevelName <> "" and Demo <> 1`.
  it.each([
    ['no next level', { nextLevelName: '' }],
    ['no full access', { fullAccess: false }],
    ['a DEMO account', { demo: true }],
  ])('canUpgrade is false with %s, even though the page declares onAdvanceClick', async (_label, opts) => {
    const fake = makeWebCtx();
    const html = curriculumPage(opts as CurriculumOpts);
    expect(html).toContain('function onAdvanceClick()');
    fetchAsp(fake).mockResolvedValue(html);
    mockFetch.mockResolvedValue(htmlResponse(''));
    const data = await fetchCurriculumData(fake.ctx);
    expect(data).toMatchObject({ canUpgrade: false, isUpgradeRequested: false });
  });

  it('canUpgrade with the box unchecked means isUpgradeRequested false', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(curriculumPage({ advanceToNextLevel: false }));
    mockFetch.mockResolvedValue(htmlResponse(''));
    const data = await fetchCurriculumData(fake.ctx);
    expect(data).toMatchObject({ canUpgrade: true, isUpgradeRequested: false });
  });

  it('a mayor gets no level section and no rankings', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(curriculumPage({ superRole: 1 }));
    mockFetch.mockResolvedValue(htmlResponse(''));
    const data = await fetchCurriculumData(fake.ctx);
    expect(data).toMatchObject({
      currentLevelName: 'Apprentice', currentLevelDescription: '',
      nextLevelName: '', canUpgrade: false, rankings: [],
    });
    expect(data.curriculumItems).toHaveLength(2);
  });

  it('caches the action URLs of the page under TycoonCurriculum.asp (real extractAllActionUrls)', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(CURRICULUM_HTML);
    mockFetch.mockResolvedValue(htmlResponse(''));

    await fetchCurriculumData(fake.ctx);

    expect(setCache(fake)).toHaveBeenCalledTimes(1);
    const [path, map] = setCache(fake).mock.calls[0];
    expect(path).toBe(CURRICULUM);
    // What the page really publishes (audit §4): `resetTycoon.asp` — NOT
    // `rdoResetTycoon.asp` (:72), `abandonRole.asp` (:76) and
    // `rdoSetAdvanceLevel.asp` (:93-101), the last one with an EMPTY `Value=`
    // because `event.srcElement.checked` is dynamic.
    expect([...map.keys()].sort()).toEqual(['abandonRole.asp', 'rdoSetAdvanceLevel.asp', 'resetTycoon.asp']);
    expect(map.get('rdoSetAdvanceLevel.asp')?.url).toContain('&Value=&WorldName=Shamba');
    expect(map.has('rdoResetTycoon.asp')).toBe(false);
  });

  it('with sections absent: empty strings, no upgrade, no rankings, level name from the tier table', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('<html><body>nothing useful</body></html>');
    mockFetch.mockResolvedValue(htmlResponse(''));

    const data = await fetchCurriculumData(fake.ctx);

    expect(data).toMatchObject({
      currentLevel: 0,
      currentLevelName: 'Apprentice',
      currentLevelDescription: '',
      currentLevelBadgeUrl: '',
      currentLevelCondition: '',
      levelReqStatus: '',
      nextLevelName: '',
      nextLevelDescription: '',
      nextLevelRequirements: '',
      canUpgrade: false,
      isUpgradeRequested: false,
      fortune: '123456789',
      averageProfit: '',
      rankings: [],
      curriculumItems: [],
    });
    expect(setCache(fake)).not.toHaveBeenCalled();
  });

  it('with only one header1 there is no next level name; a "Next Level" marker without a label div yields no description', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('<div class=header1>Paradigm</div>Next Level<span>none</span>Requires:<p>no label div</p>');
    mockFetch.mockResolvedValue(htmlResponse(''));
    const data = await fetchCurriculumData(fake.ctx);
    expect(data.nextLevelName).toBe('');
    // nextLevelName '' → indexOf('', idx) is idx itself → the section is scanned but has no label div
    expect(data.nextLevelDescription).toBe('');
    expect(data.nextLevelRequirements).toBe('');
  });

  it('a next-level header that only appears BEFORE the "Next Level" marker yields no next-level description', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('<div class=header1>Paradigm</div><div class=header1>Zenith</div><div class=label>early</div>Next Level<div class=label>late</div>');
    mockFetch.mockResolvedValue(htmlResponse(''));
    const data = await fetchCurriculumData(fake.ctx);
    expect(data.nextLevelName).toBe('Zenith');
    // indexOf('Zenith', <after "Next Level">) is -1 → the section is never scanned
    expect(data.nextLevelDescription).toBe('');
  });

  it('a curriculum item whose prestige is not numeric reads 0', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('Curriculum items<table><tr><td class=value>Odd</td><td class=value>n/a</td></tr></table>');
    mockFetch.mockResolvedValue(htmlResponse(''));
    const data = await fetchCurriculumData(fake.ctx);
    expect(data.curriculumItems).toEqual([{ item: 'Odd', prestige: 0 }]);
  });

  it('a level image the tier table does not know falls back to the tier index for currentLevelName only when levelName is empty', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('<img src="images/levelDemiGod.gif">');
    mockFetch.mockResolvedValue(htmlResponse(''));
    const data = await fetchCurriculumData(fake.ctx);
    // levelName is set (DemiGod), so it wins over levelNames[0]
    expect(data.currentLevelName).toBe('DemiGod');
    expect(data.currentLevel).toBe(0);
  });

  it('when the detail re-fetch fails, warns and returns the profile-only data with the tier name', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake)
      .mockResolvedValueOnce(CURRICULUM_HTML)
      .mockRejectedValueOnce(new Error('ASP request failed: 500'));
    mockFetch.mockResolvedValue(htmlResponse(''));

    const data = await fetchCurriculumData(fake.ctx);

    expect(fake.log.warn).toHaveBeenCalledWith('[Profile] TycoonCurriculum.asp re-fetch for curriculum details failed');
    expect(data).toMatchObject({ currentLevel: 4, currentLevelName: 'Paradigm', prestige: 1234, rankings: [], curriculumItems: [], fortune: '123456789', currentLevelBadgeUrl: '' });
    expect(setCache(fake)).not.toHaveBeenCalled();
  });

  it('when buildAspUrl throws, the same warning path is taken and html stays empty', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(CURRICULUM_HTML);
    (fake.ctx.buildAspUrl as jest.MockedFunction<SessionContext['buildAspUrl']>).mockImplementation(() => { throw new Error('no world'); });
    mockFetch.mockResolvedValue(htmlResponse(''));
    const data = await fetchCurriculumData(fake.ctx);
    expect(data.rankings).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith('[Profile] TycoonCurriculum.asp re-fetch for curriculum details failed');
  });

  it('a page with no action URL leaves the cache untouched', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('<div class=header1>A</div>');
    mockFetch.mockResolvedValue(htmlResponse(''));
    await fetchCurriculumData(fake.ctx);
    expect(setCache(fake)).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES — TycoonBankAccount.asp
// ═══════════════════════════════════════════════════════════════════════════

interface Loan {
  bank: string;
  date: string;
  /** `FormatValue(Obj.LoanAmount(i))` — :558 */
  amount: string;
  interest: string;
  term: string;
  /** `FormatValue(LoanSlice + LoanInterest*LoanAmount/100)` — :567-568 */
  payment: string;
}

/** TycoonBankAccount.asp:550-571 — one loan row, ids and all. */
function loanRow(i: number, l: Loan): string {
  const cell = (suffix: string, extra: string, value: string) =>
    `${T(9)}<td id="r${i}${suffix}"${suffix === 'Bank' ? '' : ' '}class=value style="cursor: hand; background-color: #143930; padding-left: 5px; padding-right: 5px"${extra}>\n`
    + `${T(10)}${value}\n${T(9)}</td>`;
  return `${T(8)}<tr id="r${i}" lid="${i}" onClick="onRowClick()">\n`
    + cell('Bank', '', l.bank) + '\n'
    + cell('Date', '', l.date) + '\n'
    + cell('Amount', ' align=right', l.amount) + '\n'
    + cell('Int', ' align=right', `${l.interest}%`) + '\n'
    + cell('Term', '', `${l.term} years`) + '\n'
    + cell('Slice', ' align="right"', l.payment) + '\n'
    + `${T(8)}</tr>`;
}

interface BankOpts {
  objValid?: boolean;
  fullAccess?: boolean;
  budget?: number;
  ifelLoanEstimated?: number;
  loanAmount?: number;
  /** `FormatValue(TransferMoney)`; 0 drops the whole "send" panel (:427). */
  transferMoney?: number;
  sendingMoneyOn?: boolean;
  /** `:124 Demo = Obj.Demo` — adds StrTyconBank_27 beside whichever send branch renders. */
  demo?: boolean;
  loans?: Loan[];
  /** `FormatValue(TotalPayment)` — :580 */
  totalPayment?: string;
  /** Rendered `errorText` block — LOAN (:330-343) or SEND (:403-423). */
  errorText?: string;
}

/**
 * The send half of the FullAccess panel (:424-508), branch for branch:
 * `if SendingMoneyOn` (:424) else StrTyconBank_28 (:506); inside it,
 * `if TransferMoney > 0` (:427) renders the inputs + the cap note (:438), else the
 * `Obj.Budget > 0` split of :474-478 (StrTyconBank_16 / _17). Either way the Demo note
 * StrTyconBank_27 follows in its own row when `Demo = 1` (:466-467, :487-488).
 * The StrTyconBank_18 branch (:499) is unreachable — :426 is `if true`.
 */
function sendPanel(o: Required<Pick<BankOpts, 'transferMoney' | 'sendingMoneyOn' | 'demo' | 'budget'>>): string {
  const box = (body: string, pt = 10) =>
    `${T(6)}<div style="font-size: ${pt}pt; margin-top: 4px">\n${T(7)}${body}\n${T(6)}</div>\n`;
  if (!o.sendingMoneyOn) return box('Money transfers are not allowed in Tournament planets');
  const demoNote = o.demo
    ? box('<b>NOTE:</b> Since this is a <b>DEMO</b> account,<br>you cannot transfer money <br>to other players or political figures')
    : '';
  if (o.transferMoney > 0) {
    return box(`<b>Note:</b> You can transfer up to $${o.transferMoney.toLocaleString('en-US')}.`, 8) + demoNote;
  }
  return box(o.budget > 0
    ? 'You cannot send money <br> that you received with loans <br> or as part of your Investor Visa'
    : 'You have no money to send') + demoNote;
}

function bankPage(opts: BankOpts = {}): string {
  const o = {
    objValid: true, fullAccess: true,
    budget: 123456789, ifelLoanEstimated: 2000000000, loanAmount: 500000000,
    transferMoney: 12345678, sendingMoneyOn: true, demo: false,
    loans: [] as Loan[], totalPayment: '$0', errorText: '',
    ...opts,
  };

  // :159-292 — the <head> script. `budget`, `oldVal`, `maxVal` and `loans` are
  // emitted whatever FullAccess says: they sit in plain function bodies.
  const head = `<head>
${T(1)}<script language="JScript">

${T(2)}var toLoan = 0;

${T(2)}var budget = ${o.budget};

${T(2)}var selectedRow = null;

${T(2)}var curLoanIdx = -1;

${T(2)}function onBtnClick()
${T(2)}{
${T(3)}var td = getCell( event.srcElement );
${T(3)}if (td != null && td.tagName == "TD")
${T(4)}switch (td.command)
${T(4)}{
${T(5)}case "borrow" :
${T(6)}window.navigate( "TycoonBankAccount.asp?Tycoon=SPO_test3&Password=test3&Company=SPO_test3 - Green&WorldName=Shamba&DAAddr=10.0.0.5&DAPort=1111&SecurityId=&Action=LOAN&LoanValue=" + document.all.loanAmount.value.replace( new RegExp(",", "g"), "" ) )
${T(5)}break;
${T(4)}}
${T(2)}}

${T(2)}var oldVal = ${o.ifelLoanEstimated};

${T(2)}function computeLoanInfo( value )
${T(2)}{
${T(3)}var maxVal = new Number(${o.ifelLoanEstimated});
${T(3)}var loans = new Number(${o.loanAmount});
${T(3)}var interest = (loans + value)/100000000;
${T(3)}var term = 200 - (loans + value)/10000000;
${T(3)}if (term < 5)
${T(3)}  term = 5;
${T(2)}}

${T(2)}function onLoad()
${T(2)}{
${o.fullAccess ? `${T(3)}computeLoanInfo( "${o.ifelLoanEstimated}" );\n` : ''}${T(2)}}

${T(1)}</script>

</head>`;

  if (!o.objValid) {
    // :621-625 — StrTyconBank_24
    return `${head}\n<body>\n${T(3)}<div class=header2 style="padding: 20px">\n`
      + `${T(4)}Sorry, cannot retrieve Tycoon information from server\n${T(3)}</div>\n</body>`;
  }

  const body: string[] = [
    `${T(3)}<div class=header2>\n${T(4)}Bank Account\n${T(3)}</div>`,
    `${T(3)}<div style="margin-left: 20px">\n${T(4)}<span class=label>\n${T(5)}Current Balance:\n${T(4)}</span>\n`
    + `${T(4)}<span id=budgetValue class=Value style="font-size: 14px">\n${T(5)}$${o.budget.toLocaleString('en-US')}\n${T(4)}</span>\n${T(3)}</div>`,
  ];

  // :320-516 — the ENTIRE borrow + send panel, including the errorText blocks
  // and the server-side interest/term spans, lives under `if FullAccess`.
  if (o.fullAccess) {
    body.push(`${T(3)}<table width="100%">\n${T(4)}<tr>\n${T(5)}<td valign="top" width="50%>\n`
      + `${T(6)}<table width="100%" style="padding-left: 10px; margin-top: 7px">\n`
      + `${T(7)}<tr><td background="../images/itemgradient.jpg">\n${T(8)}<div class=header3 style="color: white">\n${T(9)}Borrow: Amount\n${T(8)}</div>\n${T(7)}</td></tr>\n`
      + (o.errorText
        ? `${T(7)}<tr><td style="background-color: #770000">\n${T(8)}<div class=errorText>\n${T(9)}${o.errorText}\n${T(8)}</div>\n${T(7)}</td></tr>\n`
        : '')
      + `${T(7)}<tr><td>\n`
      + `${T(8)}<span class="label">Interest Rate:&nbsp;</span><span id=interest class="value">7%</span><br>\n`
      + `${T(8)}<span class="label">Term:&nbsp;</span><span id=term class="value">23</span> years\n`
      + `${T(7)}</td></tr>\n${T(6)}</table>\n${T(5)}</td>\n`
      + `${T(5)}<td valign="top" width="50%">\n`
      + sendPanel(o)
      + `${T(5)}</td>\n${T(4)}</tr>\n${T(3)}</table>`);
  }

  // :517-620 — the loan table is OUTSIDE the FullAccess guard
  const loanTable = o.loans.length > 0
    ? `${T(6)}<table style="padding-left: 10px; padding-right: 10px">\n`
      + `${T(7)}<tr>\n${T(8)}<td class=value style="font-weight: bold; background-color: #345950; padding-left: 5px; padding-right: 5px">\n${T(9)}Bank Name\n${T(8)}</td>\n${T(7)}</tr>\n`
      + o.loans.map((l, i) => loanRow(i, l)).join('\n') + '\n'
      + `${T(8)}<tr>\n${T(9)}<td></td>\n${T(9)}<td></td>\n${T(9)}<td></td>\n${T(9)}<td></td>\n${T(9)}<td></td>\n`
      + `${T(9)}<td class=value style="cursor: hand; background-color: #143930; padding-left: 5px; padding-right: 5px" align="right">\n`
      + `${T(10)}${o.totalPayment}\n${T(9)}</td>\n${T(8)}</tr>\n${T(6)}</table>`
    : `${T(6)}<div class=label style="font-size: 10pt; margin-top: 4px">\n${T(7)}You don't owe money to any bank.\n${T(6)}</div>`;

  body.push(`${T(3)}<table width="600" style="margin-left: 5px; padding-left: 10px; margin-top: 7px">\n`
    + `${T(4)}<tr>\n${T(5)}<td background="../images/itemgradient.jpg">\n${T(6)}<div class=header3 style="color: white">\n${T(7)}Loans\n${T(6)}</div>\n${T(5)}</td>\n${T(4)}</tr>\n`
    + `${T(4)}<tr>\n${T(5)}<td>\n${loanTable}\n${T(5)}</td>\n${T(4)}</tr>\n${T(3)}</table>`);

  return `${head}\n\n<body onLoad="onLoad()">\n${T(1)}<div id=main>\n${T(1)}<table width="100%" cellspacing="0">\n`
    + `${T(2)}<tr>\n${T(3)}<td valign="top" style="padding: 20px">\n`
    + body.join('\n') + `\n${T(3)}</td>\n${T(2)}</tr>\n${T(1)}</table>\n${T(1)}</div>\n\n</body>`;
}

const LOAN_A: Loan = { bank: 'IFEL Bank', date: '3/9/2244', amount: '$100,000,000', interest: '5', term: '23', payment: '$6,500,000' };
const LOAN_B: Loan = { bank: 'World Bank', date: '1/1/2240', amount: '$400,000,000', interest: '7.5', term: '80', payment: '$31,000,000' };

// ═══════════════════════════════════════════════════════════════════════════
// fetchBankAccount + parseBankAccountHtml
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchBankAccount', () => {
  const BANK_HTML = bankPage({ loans: [LOAN_A, LOAN_B], totalPayment: '$37,500,000' });

  it('fetches TycoonBankAccount.asp and parses budget, limits, loans, defaults', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(BANK_HTML);

    const data = await fetchBankAccount(fake.ctx);

    expect(fetchAsp(fake)).toHaveBeenCalledWith(BANK, { RIWS: '' });
    expect(data).toEqual({
      balance: '123456789',        // :163 var budget
      maxLoan: '2000000000',       // :222 var maxVal
      totalLoans: '500000000',     // :223 var loans
      maxTransfer: '12345678',     // :438 strYouCanTransferX
      totalNextPayment: '37500000', // :580, the total the SERVER publishes
      loans: [
        { bank: 'IFEL Bank', date: '3/9/2244', amount: '100000000', interest: 5, term: 23, slice: '6500000', loanIndex: 0 },
        { bank: 'World Bank', date: '1/1/2240', amount: '400000000', interest: 7.5, term: 80, slice: '31000000', loanIndex: 1 },
      ],
      // computeLoanInfo (:226-232): (500M + 2000M)/100M = 25 ;
      // 200 - 2500M/10M = -50, clamped to 5 BEFORE rounding.
      defaultInterest: 25,
      defaultTerm: 5,
    });
    // The page offers the Send form, so there is no reason to report. (:427)
    expect(data.transferDenied).toBeUndefined();
  });

  it('a zero cap with a positive budget reports the loans/Investor Visa reason, no allowance', async () => {
    // :474-476 — StrTyconBank_16 when Obj.Budget > 0.
    const html = bankPage({ transferMoney: 0 });
    expect(html).not.toContain('transfer up to $0');
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(html);
    const data = await fetchBankAccount(fake.ctx);
    expect(data.transferDenied).toBe('loans');
    expect(data.maxTransfer).toBeUndefined();
  });

  it('a zero cap with a zero budget reports the no-money reason, no allowance', async () => {
    // :477-478 — StrTyconBank_17 when Obj.Budget = 0.
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(bankPage({ transferMoney: 0, budget: 0 }));
    const data = await fetchBankAccount(fake.ctx);
    expect(data.transferDenied).toBe('no-money');
    expect(data.maxTransfer).toBeUndefined();
  });

  it('a Demo account reports the Demo reason even though the cap note is on the page', async () => {
    // :466-467 — StrTyconBank_27 sits beside the inputs and the :438 cap note.
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(bankPage({ demo: true }));
    const data = await fetchBankAccount(fake.ctx);
    expect(data.transferDenied).toBe('demo');
    expect(data.maxTransfer).toBe('12345678');
  });

  it('a Demo account with a zero cap reports Demo, not the loans reason', async () => {
    // :487-488 — the Demo note also follows the StrTyconBank_16 branch.
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(bankPage({ demo: true, transferMoney: 0 }));
    expect((await fetchBankAccount(fake.ctx)).transferDenied).toBe('demo');
  });

  it('caches the action URLs the page carries — for this page, none at all', async () => {
    // Audit §4: TycoonBankAccount.asp has no <form>, no <a href> to itself, and
    // builds its URLs with `window.navigate("…")` inside a switch (:189-200),
    // which no extractor reaches. The cached-URL branch of executeBankAction is
    // therefore dead in production; this pins that fact on the real markup.
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(BANK_HTML);
    await fetchBankAccount(fake.ctx);
    expect(setCache(fake)).not.toHaveBeenCalled();
  });

  // Regression guard for B-16. The cells used to be read positionally with
  // empty ones dropped, so an empty `Obj.LoanBankName(i)` shifted the six
  // fields one column left — the date landed under "bank", the rate under
  // "amount" — with no error anywhere. They are read by their own id now
  // (:551-566), the same handles onRowClick() uses (:260-265).
  it('a loan whose bank name is empty keeps every other column in place', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(bankPage({ loans: [{ ...LOAN_A, bank: '' }], totalPayment: '$6,500,000' }));
    const data = await fetchBankAccount(fake.ctx);
    expect(data.loans).toEqual([
      { bank: '', date: '3/9/2244', amount: '100000000', interest: 5, term: 23, slice: '6500000', loanIndex: 0 },
    ]);
  });

  it('without full access the loan table is still rendered, the borrow panel is not', async () => {
    // :320 gates the whole borrow/send panel; :517 does not gate the loans.
    const html = bankPage({ fullAccess: false, loans: [LOAN_A], totalPayment: '$6,500,000' });
    expect(html).not.toContain('id=interest');
    expect(html).toContain('id="r0Bank"');
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(html);
    const data = await fetchBankAccount(fake.ctx);
    expect(data.loans).toHaveLength(1);
    // No send panel at all without FullAccess (:320) — nothing to report either way.
    expect(data.maxTransfer).toBeUndefined();
    expect(data.transferDenied).toBeUndefined();
    expect(data).toMatchObject({ balance: '123456789', maxLoan: '2000000000' });
  });

  it('with no loan at all the page has no table and the total falls back to the sum', async () => {
    // :525 / :611-619 — `Obj.LoanCount = 0` renders StrTyconBank_23 instead.
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(bankPage());
    const data = await fetchBankAccount(fake.ctx);
    expect(data.loans).toEqual([]);
    expect(data.totalNextPayment).toBe('0');
  });

  it('a tournament world (StrTyconBank_28) reports no allowance and the tournament reason', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(bankPage({ sendingMoneyOn: false }));
    const data = await fetchBankAccount(fake.ctx);
    expect(data.maxTransfer).toBeUndefined();
    expect(data.transferDenied).toBe('tournament');
  });

  it('with an empty page: balance from the session, default max loan, no loans, defaults 25 / 5', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('');

    const data = await fetchBankAccount(fake.ctx);

    expect(data).toEqual({
      balance: '123456789', maxLoan: '2500000000', totalLoans: '0', totalNextPayment: '0', loans: [],
      defaultInterest: 25, defaultTerm: 5,
    });
    expect(setCache(fake)).not.toHaveBeenCalled();
  });

  it('with no session money the balance is "0"; a small maxVal yields a term above the floor', async () => {
    const fake = makeWebCtx({ accountMoney: null });
    fetchAsp(fake).mockResolvedValue('<script>var maxVal = new Number(100000000); var loans = new Number(0);</script>');
    const data = await fetchBankAccount(fake.ctx);
    // (0 + 100M)/100M = 1 ; 200 - 100M/10M = 190
    expect(data).toMatchObject({ balance: '0', maxLoan: '100000000', defaultInterest: 1, defaultTerm: 190 });
  });

  it('a maxVal of 0 yields defaultInterest 0 and the top term', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('<script>var maxVal = new Number(0); var loans = new Number(0);</script>');
    const data = await fetchBankAccount(fake.ctx);
    expect(data).toMatchObject({ maxLoan: '0', defaultInterest: 0, defaultTerm: 200 });
  });

  // Regression guard for the term rounding (audit B-17). computeLoanInfo
  // (:227-232) clamps the RAW term at 5 and rounds afterwards; we rounded first
  // and clamped after, which is one year apart on every `.5` fraction.
  it('the term is clamped before rounding, as computeLoanInfo does', async () => {
    const fake = makeWebCtx();
    // 200 - 1,955,000,000/10,000,000 = 4.5 → clamped to 5, not rounded to 5 then… 5.
    fetchAsp(fake).mockResolvedValue('<script>var maxVal = new Number(1955000000); var loans = new Number(0);</script>');
    expect((await fetchBankAccount(fake.ctx)).defaultTerm).toBe(5);
    // 200 - 25,000,000/10,000,000 = 197.5 → Math.round → 198 (we used to
    // compute 200 - Math.round(2.5) = 200 - 3 = 197).
    fetchAsp(fake).mockResolvedValue('<script>var maxVal = new Number(25000000); var loans = new Number(0);</script>');
    expect((await fetchBankAccount(fake.ctx)).defaultTerm).toBe(198);
  });

  it('a negative budget is parsed', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(bankPage({ budget: -5000 }));
    expect((await fetchBankAccount(fake.ctx)).balance).toBe('-5000');
  });

  it('a loan row without a closing </tr> is skipped; a non-numeric interest/term reads 0', async () => {
    const fake = makeWebCtx();
    const truncated = loanRow(1, LOAN_B);
    fetchAsp(fake).mockResolvedValue(
      loanRow(0, { ...LOAN_A, amount: 'n/a', interest: 'x', term: 'y', payment: 'n/a' })
      + truncated.substring(0, truncated.indexOf('</tr>')),
    );
    const data = await fetchBankAccount(fake.ctx);
    expect(data.loans).toEqual([
      { bank: 'IFEL Bank', date: '3/9/2244', amount: '0', interest: 0, term: 0, slice: '0', loanIndex: 0 },
    ]);
    expect(data.totalNextPayment).toBe('0');
  });

  it('a loan row missing one of its six cells is dropped rather than shifted', async () => {
    const fake = makeWebCtx();
    const row = loanRow(0, LOAN_A);
    fetchAsp(fake).mockResolvedValue(row.replace(/<td id="r0Slice"[\s\S]*?<\/td>\n/, ''));
    expect((await fetchBankAccount(fake.ctx)).loans).toEqual([]);
  });

  it('caches the action URLs when the page carries one', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(
      `<form action="TycoonBankAccount.asp?Tycoon=SPO_test3&Password=test3&SecurityId=abc" method=GET>`
      + `<input type=hidden name=SecurityId value="abc"></form>`,
    );
    await fetchBankAccount(fake.ctx);
    const [path, map] = setCache(fake).mock.calls[0];
    expect(path).toBe(BANK);
    expect(map.get('TycoonBankAccount.asp')).toEqual({
      key: 'TycoonBankAccount.asp',
      url: `${IS_BASE}TycoonBankAccount.asp?Tycoon=SPO_test3&Password=test3&SecurityId=abc`,
      method: 'GET',
      hiddenFields: { SecurityId: 'abc' },
    });
  });

  it('skips URL extraction when buildAspUrl yields an empty base', async () => {
    const fake = makeWebCtx();
    (fake.ctx.buildAspUrl as jest.MockedFunction<SessionContext['buildAspUrl']>).mockReturnValue('');
    fetchAsp(fake).mockResolvedValue('<form action="TycoonBankAccount.asp?x=1"></form>');
    await fetchBankAccount(fake.ctx);
    expect(setCache(fake)).not.toHaveBeenCalled();
  });

  it('never throws when the ASP fetch fails: returns the neutral default with cacheUnavailable', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockRejectedValue(new Error('ASP request failed: 500 Internal Server Error'));
    await expect(fetchBankAccount(fake.ctx)).resolves.toMatchObject({
      loans: [], cacheUnavailable: true,
    });
  });

  it('the "cannot retrieve" sentence flags cacheUnavailable instead of the parsed page', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(bankPage({ objValid: false }));
    await expect(fetchBankAccount(fake.ctx)).resolves.toMatchObject({
      loans: [], cacheUnavailable: true,
    });
  });

  it('a page that parses carries no cacheUnavailable key', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(bankPage());
    const data = await fetchBankAccount(fake.ctx);
    expect(data).not.toHaveProperty('cacheUnavailable');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// executeBankAction — REAL MONEY: every branch
// ═══════════════════════════════════════════════════════════════════════════

describe('executeBankAction', () => {
  const CACHED_URL = `${IS_BASE}TycoonBankAccount.asp?Tycoon=SPO_test3&Password=test3&SecurityId=abc`;

  /** The page as it stands BEFORE the action: two loans, balance 123456789. */
  const BEFORE = bankPage({ loans: [LOAN_A, LOAN_B], totalPayment: '$37,500,000' });

  function warmCache(fake: FakeSessionCtx, url = CACHED_URL): void {
    getCache(fake).mockReturnValue(cacheWith([['TycoonBankAccount.asp', { key: 'TycoonBankAccount.asp', url, method: 'GET' }]]));
  }

  /** Seed the pre-action snapshot; return the fake. */
  function withSnapshot(fake: FakeSessionCtx, html = BEFORE): FakeSessionCtx {
    fetchAsp(fake).mockResolvedValue(html);
    return fake;
  }

  beforeEach(() => {
    // Default answer to the mutation: the page re-rendered with a moved balance.
    mockFetch.mockResolvedValue(htmlResponse(bankPage({ budget: 99999, loans: [LOAN_A, LOAN_B], totalPayment: '$37,500,000' })));
  });

  // ── input validation, before any URL, any snapshot, any fetch ────────────

  it.each([
    ['borrow without amount', 'borrow', undefined, undefined, undefined, undefined, 'Amount required'],
    ['borrow with empty amount', 'borrow', '', undefined, undefined, undefined, 'Amount required'],
    ['send without amount', 'send', undefined, 'Bob', undefined, undefined, 'Amount and recipient required'],
    ['send without recipient', 'send', '100', undefined, undefined, undefined, 'Amount and recipient required'],
    ['payoff without loan index', 'payoff', undefined, undefined, undefined, undefined, 'Loan index required'],
    ['payoff with negative loan index', 'payoff', undefined, undefined, undefined, -1, 'Loan index required'],
    ['unknown action', 'steal', '100', undefined, undefined, undefined, 'Unknown action: steal'],
  ])('%s is refused before any fetch', async (_label, action, amount, to, reason, lid, message) => {
    const fake = withSnapshot(makeWebCtx());
    warmCache(fake);
    expect(await executeBankAction(fake.ctx, action, amount, to, reason, lid)).toEqual({ success: false, message });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(fetchAsp(fake)).not.toHaveBeenCalled();
    expect(getCache(fake)).not.toHaveBeenCalled();
  });

  it('without a world ip: "World IP not available", no fetch', async () => {
    const fake = makeWebCtx({ currentWorldInfo: null });
    expect(await executeBankAction(fake.ctx, 'borrow', '100')).toEqual({ success: false, message: 'World IP not available' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses to move money when the state before the action cannot be read', async () => {
    // fetchBankAccount throws on `!response.ok` (spo_session.ts:960). Without a
    // "before" there is no oracle at all on this page, so the action is not sent.
    const fake = makeWebCtx();
    fetchAsp(fake).mockRejectedValue(new Error('ASP request failed: 503 Service Unavailable'));
    expect(await executeBankAction(fake.ctx, 'borrow', '1')).toEqual({
      success: false, message: 'ASP request failed: 503 Service Unavailable',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses to move money when the "before" page carries the "cannot retrieve" sentence', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(bankPage({ objValid: false }));
    expect(await executeBankAction(fake.ctx, 'borrow', '1')).toEqual({
      success: false, message: 'borrow refused: the bank page cannot be read before the action',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── cached form action present ───────────────────────────────────────────

  describe('with the TycoonBankAccount.asp form action cached', () => {
    it('borrow: appends Action=LOAN&LoanValue to the cached URL with & (URL already has ?)', async () => {
      const fake = withSnapshot(makeWebCtx());
      warmCache(fake);

      const result = await executeBankAction(fake.ctx, 'borrow', '250000000');

      expect(getCache(fake)).toHaveBeenCalledWith(BANK);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(`${CACHED_URL}&Action=LOAN&LoanValue=250000000`);
      expect(mockFetch.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'follow' }));
      expect((mockFetch.mock.calls[0][1] as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
      expect(result).toEqual({ success: true, message: 'borrow completed successfully' });
      expect(fake.log.debug).toHaveBeenCalledWith('[Bank] Using cached form action URL for borrow');
    });

    it('appends with ? when the cached URL has no query string', async () => {
      const fake = withSnapshot(makeWebCtx());
      warmCache(fake, `${IS_BASE}TycoonBankAccount.asp`);
      await executeBankAction(fake.ctx, 'borrow', '1');
      expect(mockFetch.mock.calls[0][0]).toBe(`${IS_BASE}TycoonBankAccount.asp?Action=LOAN&LoanValue=1`);
    });

    it('send: Action=SEND, SendValue, SendDest, SendReason — spaces %20-encoded, never +', async () => {
      const fake = withSnapshot(makeWebCtx());
      warmCache(fake);

      const result = await executeBankAction(fake.ctx, 'send', '5000', 'Bob Smith', 'for the farm');

      expect(mockFetch.mock.calls[0][0]).toBe(`${CACHED_URL}&Action=SEND&SendValue=5000&SendDest=Bob%20Smith&SendReason=for%20the%20farm`);
      expect(result).toEqual({ success: true, message: 'send completed successfully' });
    });

    it('send without a reason sends an empty SendReason', async () => {
      const fake = withSnapshot(makeWebCtx());
      warmCache(fake);
      await executeBankAction(fake.ctx, 'send', '5000', 'Bob');
      expect(mockFetch.mock.calls[0][0]).toBe(`${CACHED_URL}&Action=SEND&SendValue=5000&SendDest=Bob&SendReason=`);
    });

    it('payoff: Action=PAYOFF&LID=<index>, index 0 accepted', async () => {
      const fake = withSnapshot(makeWebCtx());
      warmCache(fake);
      // The answer: one loan fewer — the table is rebuilt over Obj.LoanCount.
      mockFetch.mockResolvedValue(htmlResponse(bankPage({ budget: 23456789, loans: [LOAN_B], totalPayment: '$31,000,000' })));

      const result = await executeBankAction(fake.ctx, 'payoff', undefined, undefined, undefined, 0);

      expect(mockFetch.mock.calls[0][0]).toBe(`${CACHED_URL}&Action=PAYOFF&LID=0`);
      expect(result).toEqual({ success: true, message: 'payoff completed successfully' });
    });

    it('a cache without the TycoonBankAccount.asp key is a cold cache', async () => {
      const fake = withSnapshot(makeWebCtx());
      getCache(fake).mockReturnValue(cacheWith([['Other.asp', { key: 'Other.asp', url: 'http://x/Other.asp', method: 'GET' }]]));
      await executeBankAction(fake.ctx, 'borrow', '1');
      expect(mockFetch.mock.calls[0][0].startsWith(`${IS_BASE}TycoonBankAccount.asp?Tycoon=`)).toBe(true);
    });
  });

  // ── cached form action absent ────────────────────────────────────────────

  describe('with a cold cache — URL reconstructed from session state', () => {
    it('borrow: base params (Tycoon, Password, Company, WorldName, DA, SecurityId="") + Action=LOAN + LoanValue', async () => {
      // The reference form, TycoonBankAccount.asp:189.
      const fake = withSnapshot(makeWebCtx());

      const result = await executeBankAction(fake.ctx, 'borrow', '250000000');

      const url = mockFetch.mock.calls[0][0];
      expect(url.startsWith(`${IS_BASE}TycoonBankAccount.asp?`)).toBe(true);
      expect(url).toContain('Company=SPO_test3%20-%20Green');
      expect(url).not.toContain('+');
      const q = queryOf(0);
      expect(q.get('Tycoon')).toBe('SPO_test3');
      expect(q.get('Password')).toBe('test3');
      expect(q.get('Company')).toBe('SPO_test3 - Green');
      expect(q.get('WorldName')).toBe('Shamba');
      expect(q.get('DAAddr')).toBe('10.0.0.5');
      expect(q.get('DAPort')).toBe('1111');
      expect(q.get('SecurityId')).toBe('');
      expect(q.get('Action')).toBe('LOAN');
      expect(q.get('LoanValue')).toBe('250000000');
      expect(result).toEqual({ success: true, message: 'borrow completed successfully' });
      expect(fake.log.debug).toHaveBeenCalledWith('[Bank] No cached URL for borrow, reconstructing');
    });

    it('send: Action=SEND with SendValue/SendDest/SendReason', async () => {
      const fake = withSnapshot(makeWebCtx());
      await executeBankAction(fake.ctx, 'send', '5000', 'Bob', 'gift');
      const q = queryOf(0);
      expect(q.get('Action')).toBe('SEND');
      expect(q.get('SendValue')).toBe('5000');
      expect(q.get('SendDest')).toBe('Bob');
      expect(q.get('SendReason')).toBe('gift');
      expect(q.has('LoanValue')).toBe(false);
    });

    it('payoff: Action=PAYOFF with LID', async () => {
      const fake = withSnapshot(makeWebCtx());
      mockFetch.mockResolvedValue(htmlResponse(bankPage({ budget: 1, loans: [LOAN_A], totalPayment: '$6,500,000' })));
      await executeBankAction(fake.ctx, 'payoff', undefined, undefined, undefined, 1);
      const q = queryOf(0);
      expect(q.get('Action')).toBe('PAYOFF');
      expect(q.get('LID')).toBe('1');
    });

    it('refuses when the DA lock channel is unset, rather than falling back to the directory host/port', async () => {
      const fake = withSnapshot(makeWebCtx({
        activeUsername: null, cachedUsername: 'Cached', cachedPassword: null, currentCompany: null,
        currentWorldInfo: { ...WORLD, name: '' }, daAddr: null, daPort: null,
      }));
      const result = await executeBankAction(fake.ctx, 'borrow', '1');
      expect(result).toEqual({
        success: false,
        message: 'ASP call refused: DA lock channel not announced yet (daAddr/daPort unset)',
      });
    });

    it('with no username at all sends an empty Tycoon', async () => {
      const fake = withSnapshot(makeWebCtx({ activeUsername: null, cachedUsername: null }));
      await executeBankAction(fake.ctx, 'borrow', '1');
      expect(queryOf(0).get('Tycoon')).toBe('');
    });
  });

  // ── the answer: a state change, never the absence of a refusal ───────────

  describe('response handling', () => {
    it('borrow: a moved balance is the proof, and the new balance is pushed to the session', async () => {
      const fake = withSnapshot(makeWebCtx());
      warmCache(fake);
      mockFetch.mockResolvedValue(htmlResponse(bankPage({ budget: 987654321, loans: [LOAN_A, LOAN_B], totalPayment: '$37,500,000' })));
      expect(await executeBankAction(fake.ctx, 'borrow', '1')).toEqual({ success: true, message: 'borrow completed successfully' });
      expect(setMoney(fake)).toHaveBeenCalledWith('987654321');
    });

    it('borrow: an unchanged debt with an unchanged balance is a failure, not a success', async () => {
      // The wrong-password case (:95): `FullAccess` false skips the whole
      // `select case Action` (:97-114) AND the errorText block (:320). The page
      // comes back completely normal and used to read as
      // `borrow completed successfully`.
      const fake = withSnapshot(makeWebCtx());
      mockFetch.mockResolvedValue(htmlResponse(bankPage({ fullAccess: false, loans: [LOAN_A, LOAN_B], totalPayment: '$37,500,000' })));
      expect(await executeBankAction(fake.ctx, 'borrow', '250000000')).toEqual({
        success: false, message: 'borrow was not applied: the server still reports the same balance and the same debt',
      });
    });

    it('borrow: a debt that moved while the balance did not is still a success', async () => {
      const fake = withSnapshot(makeWebCtx());
      mockFetch.mockResolvedValue(htmlResponse(bankPage({ loanAmount: 900000000, loans: [LOAN_A, LOAN_B], totalPayment: '$37,500,000' })));
      expect(await executeBankAction(fake.ctx, 'borrow', '1')).toEqual({ success: true, message: 'borrow completed successfully' });
    });

    it('send: an unchanged balance is a failure', async () => {
      const fake = withSnapshot(makeWebCtx());
      mockFetch.mockResolvedValue(htmlResponse(bankPage({ loans: [LOAN_A, LOAN_B], totalPayment: '$37,500,000' })));
      expect(await executeBankAction(fake.ctx, 'send', '1', 'Bob')).toEqual({
        success: false, message: 'send was not applied: the server still reports the same balance',
      });
    });

    // Regression guard for B-1 / A-11. `payoff_error` is computed at :111 and
    // NEVER rendered — the page has no `select case payoff_error`, unlike
    // loan_error (:330) and send_error (:403). A refused payoff therefore
    // answers 200 with no marker of any kind, and this used to return
    // `{ success: true, message: 'payoff completed successfully' }`: the player
    // believed the loan was repaid. The loan count is the only proof available.
    it('payoff: the loan list must be one shorter', async () => {
      const fake = withSnapshot(makeWebCtx());
      mockFetch.mockResolvedValue(htmlResponse(bankPage({ budget: 23456789, loans: [LOAN_B], totalPayment: '$31,000,000' })));
      expect(await executeBankAction(fake.ctx, 'payoff', undefined, undefined, undefined, 0))
        .toEqual({ success: true, message: 'payoff completed successfully' });
    });

    it('payoff: a page still listing both loans is a failure, with no error marker anywhere', async () => {
      const fake = withSnapshot(makeWebCtx());
      const refused = bankPage({ loans: [LOAN_A, LOAN_B], totalPayment: '$37,500,000' });
      expect(refused).not.toContain('errorText');
      mockFetch.mockResolvedValue(htmlResponse(refused));
      expect(await executeBankAction(fake.ctx, 'payoff', undefined, undefined, undefined, 0)).toEqual({
        success: false, message: 'payoff was not applied: the loan is still listed',
      });
    });

    it('page carrying class=errorText: failure with the server message, balance untouched', async () => {
      // LOAN: `select case loan_error` → ERROR_LoanNotGranted (:331-336).
      const fake = withSnapshot(makeWebCtx());
      warmCache(fake);
      mockFetch.mockResolvedValue(htmlResponse(bankPage({
        budget: 99999,
        errorText: 'The bank rejected your request. You already have borrowed the maximum you can..',
      })));
      expect(await executeBankAction(fake.ctx, 'borrow', '1')).toEqual({
        success: false, message: 'The bank rejected your request. You already have borrowed the maximum you can..',
      });
      expect(setMoney(fake)).not.toHaveBeenCalled();
    });

    it('fetch rejects: failure with the error message, balance untouched', async () => {
      const fake = withSnapshot(makeWebCtx());
      warmCache(fake);
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      expect(await executeBankAction(fake.ctx, 'payoff', undefined, undefined, undefined, 0)).toEqual({ success: false, message: 'ECONNREFUSED' });
      expect(setMoney(fake)).not.toHaveBeenCalled();
    });

    it('response.text() rejects: failure with the error message', async () => {
      const fake = withSnapshot(makeWebCtx());
      warmCache(fake);
      mockFetch.mockResolvedValue({ status: 200, ok: true, text: async () => { throw new Error('body stream aborted'); } } as unknown as Response);
      expect(await executeBankAction(fake.ctx, 'borrow', '1')).toEqual({ success: false, message: 'body stream aborted' });
    });

    it('HTTP 500 is a failure, not a silent success — the money path reads the status', async () => {
      // Regression guard for A-9.
      // This used to return `{ success: true }`: the function decided from the
      // body alone. A-9 covers exactly two classes — the missing page and the
      // IIS fault; everything else on this page answers 200 and is settled by
      // the state comparison above.
      const fake = withSnapshot(makeWebCtx());
      warmCache(fake);
      mockFetch.mockResolvedValue(htmlResponse('<html><body><h1>500 Internal Server Error</h1></body></html>', 500));
      expect(await executeBankAction(fake.ctx, 'borrow', '250000000')).toEqual({ success: false, message: 'borrow failed: HTTP 500' });
      expect(setMoney(fake)).not.toHaveBeenCalled();
    });

    it('HTTP 500 on send and payoff fails too — all three money actions are guarded', async () => {
      const fake = withSnapshot(makeWebCtx());
      warmCache(fake);
      mockFetch.mockResolvedValue(htmlResponse('Server error', 500));
      expect(await executeBankAction(fake.ctx, 'send', '1', 'Bob')).toEqual({ success: false, message: 'send failed: HTTP 500' });
      expect(await executeBankAction(fake.ctx, 'payoff', undefined, undefined, undefined, 1)).toEqual({ success: false, message: 'payoff failed: HTTP 500' });
      expect(setMoney(fake)).not.toHaveBeenCalled();
    });

    it('an answer that is not the bank page at all is a failure, and the balance is untouched', async () => {
      // `var budget` (:163) is emitted unconditionally, so its absence means we
      // are not looking at TycoonBankAccount.asp. Concluding from the parser's
      // fallbacks would compare `totalLoans: '0'` against the real debt and
      // read as a change — a false success on a money path.
      const fake = withSnapshot(makeWebCtx());
      warmCache(fake);
      mockFetch.mockResolvedValue(htmlResponse('<html><body>done</body></html>'));
      expect(await executeBankAction(fake.ctx, 'borrow', '1')).toEqual({
        success: false, message: 'borrow could not be confirmed: the answer is not TycoonBankAccount.asp',
      });
      expect(setMoney(fake)).not.toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES — TycoonProfitAndLoses.asp
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One account row, TycoonProfitAndLoses.asp:109-195. A level-2 account renders
 * its name upper-cased (:121-124) and NO value: the value is stashed in
 * `PrevValue` (:159) and flushed later by plFlush().
 */
function plRow(
  level: number,
  label: string,
  money: string,
  chart = '',
  tax?: { town: string; ifel: string } | true,
): string {
  const nameCell = level === 2
    ? `${T(6)}<div style="margin-top: 5px">\n${T(6)}${label.toUpperCase()}\n${T(6)}</div>`
    : `${T(5)}    ${level === 1 ? '<img style="margin-left: -30px" src="images/corner.gif" width=20 height=20>' : ''}${label}`;
  const valueCell = level === 2 ? '' :
    `${T(5)}<div class=labelAccountLevel${level} style="color: white">\n`
    + `${T(6)}<div style="margin-left: 0px">\n`
    + `${T(7)}${money}\n`
    + (chart
      ? `${T(7)}<a href="http://local.asp?frame_Id=AppHandler&frame_Action=ShowChart&ChartTitle=${label}&ChartInfo=${chart}">\n`
        + `${T(8)}<img src="images/chart.jpg" width=17 height=10 border=0></a>\n`
      : '')
    + `${T(6)}</div>`;
  // TycoonProfitAndLoses.asp:167-194 — rendered only when Obj.AccountIsTax(i).
  if (tax !== undefined) {
    const taxCells = level === 2
      ? `${T(3)}<td>\n${T(4)}<div class=labelAccountLevel2 align="right">\n${T(5)}Town\n${T(4)}</div>\n${T(3)}</td>\n`
        + `${T(3)}<td align="right">\n${T(4)}<div class=labelAccountLevel2>\n${T(5)}IFEL\n${T(4)}</div>\n${T(3)}</td>`
      : `${T(3)}<td align="right">\n${T(4)}<nobr>\n`
        + `${T(4)}<div class=labelAccountLevel${level} style="color: white; padding-left: 20px">\n${T(5)}${(tax as { town: string; ifel: string }).town}\n${T(4)}</div>\n`
        + `${T(4)}</nobr>\n${T(3)}</td>\n`
        + `${T(3)}<td style="padding-left: 20px" align="right">\n${T(4)}<nobr>\n`
        + `${T(4)}<div class=labelAccountLevel${level} style="color: white; padding-left: 20px">\n${T(5)}${(tax as { town: string; ifel: string }).ifel}\n${T(4)}</div>\n`
        + `${T(4)}</nobr>\n${T(3)}</td>`;
    return `${T(2)}<tr>\n${T(3)}<td>\n`
      + `${T(4)}<div class=labelAccountLevel${level} style="margin-left: ${30 * level}px; margin-right: 5px">\n`
      + `${T(5)}<nobr>\n${nameCell}\n${T(5)}</nobr>\n${T(4)}</div>\n${T(3)}</td>\n`
      + `${T(3)}<td align="right">\n${T(4)}<nobr>\n${valueCell}\n${T(4)}</div>\n${T(4)}</nobr>\n${T(3)}</td>\n`
      + `${taxCells}\n${T(2)}</tr>`;
  }
  return `${T(2)}<tr>\n${T(3)}<td>\n`
    + `${T(4)}<div class=labelAccountLevel${level} style="margin-left: ${30 * level}px; margin-right: 5px">\n`
    + `${T(5)}<nobr>\n${nameCell}\n${T(5)}</nobr>\n${T(4)}</div>\n${T(3)}</td>\n`
    + `${T(3)}<td align="right">\n${T(4)}<nobr>\n${valueCell}\n${T(4)}</div>\n${T(4)}</nobr>\n${T(3)}</td>\n${T(2)}</tr>`;
}

/** The level-2 total flushed in a row of its own — :82-107 and :199-224. */
function plFlush(money: string, title: string, chart = ''): string {
  return `${T(3)}<tr>\n${T(4)}<td>\n${T(4)}</td>\n`
    + `${T(4)}<td height="1" background="../images/itemgradient.jpg" colspan="2">\n${T(4)}</td>\n${T(3)}</tr>\n`
    + `${T(3)}<tr>\n${T(4)}<td>\n${T(4)}</td>\n${T(4)}<td align="right">\n`
    + `${T(5)}<div class=labelAccountLevel2 style="color: ${money.startsWith('-') || money.startsWith('(') ? '#ff7700' : 'white'}">\n`
    + `${T(5)}<nobr>${money}\n`
    + (chart
      ? `${T(5)}<a href="http://local.asp?frame_Id=AppHandler&frame_Action=ShowChart&ChartTitle=${title}&ChartInfo=${chart}">\n`
        + `${T(6)}<img src="images/chart.jpg" width=17 height=10 border=0></a>\n`
      : '')
    + `${T(5)}</nobr>\n${T(5)}</div>\n${T(4)}</td>\n${T(3)}</tr>`;
}

describe('fetchProfitLoss', () => {
  it('fetches TycoonProfitAndLoses.asp and builds the tree from the level numbers', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue([
      plRow(0, 'Net Profit (losses)', '$1,000,000', '3,10,-20,30'),
      plRow(1, 'Income', '$2,000,000'),
      plRow(2, 'Residentials', ''),
      plRow(3, 'Houses', '$500,000'),
      plRow(3, 'Flats', '$1,500,000'),
      plFlush('$2,000,000', 'Residentials', '2,4,5'),
      plRow(1, 'Expenses', '-$1,000,000'),
      plRow(2, 'Salaries', ''),
      plFlush('-$1,000,000', 'Salaries'),
    ].join('\n'));

    const data = await fetchProfitLoss(fake.ctx);

    expect(fetchAsp(fake)).toHaveBeenCalledWith('NewTycoon/TycoonProfitAndLoses.asp', { RIWS: '' });
    const root = data.root;
    expect(root).toMatchObject({ label: 'Net Profit (losses)', level: 0, amount: '1000000', chartData: [10, -20, 30] });
    expect(root.children).toHaveLength(2);
    const [income, expenses] = root.children as ProfitLossNode[];
    expect(income).toMatchObject({ label: 'Income', level: 1, amount: '2000000', isHeader: false });
    expect(income.children).toHaveLength(1);
    const residentials = income.children![0];
    // The level-2 total the page flushes at :99 is now attached to its header
    // instead of being dropped: this node used to read `$0`.
    expect(residentials).toMatchObject({ label: 'RESIDENTIALS', level: 2, amount: '2000000', isHeader: true, chartData: [4, 5] });
    expect(residentials.children!.map(c => c.label)).toEqual(['Houses', 'Flats']);
    expect(residentials.children![0]).toMatchObject({ amount: '500000', chartData: undefined });
    expect(expenses).toMatchObject({ label: 'Expenses', level: 1, amount: '-1000000' });
    expect(expenses.children![0]).toMatchObject({ label: 'SALARIES', level: 2, amount: '-1000000', isHeader: true });
  });

  // TycoonProfitAndLoses.asp:167-194 — a tax section carries the Town / IFEL split on
  // each row beneath its header, and the header's own flushed total (:82-107) still reads.
  it('a tax section carries the Town / IFEL split, and the level-2 flush total is still read on a page that contains it', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue([
      plRow(0, 'Net Profit (losses)', '$1,000,000', '3,10,-20,30'),
      plRow(1, 'Income', '$2,000,000'),
      plRow(2, 'Residentials', ''),
      plRow(3, 'Houses', '$500,000'),
      plRow(3, 'Flats', '$1,500,000'),
      plFlush('$2,000,000', 'Residentials', '2,4,5'),
      plRow(1, 'Expenses', '-$1,000,000'),
      plRow(2, 'Salaries', ''),
      plFlush('-$1,000,000', 'Salaries'),
      plRow(2, 'Taxes', '', '', true),
      plRow(3, 'Income tax', '-$300,000', '', { town: '-$200,000', ifel: '-$100,000' }),
      plRow(3, 'Sales tax', '-$120,000', '', { town: '-$90,000', ifel: '-$30,000' }),
      plFlush('-$420,000', 'Taxes'),
    ].join('\n'));

    const data = await fetchProfitLoss(fake.ctx);
    const root = data.root;
    expect(root.isTax).toBeUndefined();
    expect(root.secAmount).toBeUndefined();

    const [income, expenses] = root.children as ProfitLossNode[];
    expect(income.isTax).toBeUndefined();

    // The non-tax subtree is byte-identical to the first test's expectations — no new key
    // was added to a non-tax node.
    const expectedIncome: ProfitLossNode = {
      label: 'Income',
      level: 1,
      amount: '2000000',
      chartData: undefined,
      isHeader: false,
      children: [
        {
          label: 'RESIDENTIALS',
          level: 2,
          amount: '2000000',
          chartData: [4, 5],
          isHeader: true,
          children: [
            { label: 'Houses', level: 3, amount: '500000', chartData: undefined, isHeader: false, children: [] },
            { label: 'Flats', level: 3, amount: '1500000', chartData: undefined, isHeader: false, children: [] },
          ],
        },
      ],
    };
    expect(income).toEqual(expectedIncome);
    expect(income).toMatchObject({ label: 'Income', level: 1, amount: '2000000', isHeader: false });
    const residentials = income.children![0];
    expect(residentials).toMatchObject({ label: 'RESIDENTIALS', level: 2, amount: '2000000', isHeader: true, chartData: [4, 5] });
    expect(residentials.isTax).toBeUndefined();
    expect(residentials.secAmount).toBeUndefined();

    expect(expenses).toMatchObject({ label: 'Expenses', level: 1, amount: '-1000000' });
    expect(expenses.isTax).toBeUndefined();
    expect(expenses.children!.map(c => c.label)).toEqual(['SALARIES', 'TAXES']);
    const salaries = expenses.children![0];
    expect(salaries).toMatchObject({ label: 'SALARIES', level: 2, amount: '-1000000', isHeader: true });
    expect(salaries.isTax).toBeUndefined();
    expect(salaries.secAmount).toBeUndefined();

    const taxes = expenses.children![1];
    expect(taxes).toMatchObject({ label: 'TAXES', level: 2, isHeader: true, isTax: true, amount: '-420000' });
    expect(taxes.secAmount).toBeUndefined();
    expect(taxes.children!.map(c => c.label)).toEqual(['Income tax', 'Sales tax']);

    const [incomeTax, salesTax] = taxes.children!;
    expect(incomeTax).toMatchObject({ isTax: true, amount: '-300000', secAmount: '-100000' });
    expect(Number(incomeTax.amount) - Number(incomeTax.secAmount)).toBe(-200000);
    expect(salesTax).toMatchObject({ isTax: true, amount: '-120000', secAmount: '-30000' });
    expect(Number(salesTax.amount) - Number(salesTax.secAmount)).toBe(-90000);
  });

  // Covers the `< 2 matches` branch: a tax row whose page lost its second split figure
  // cell (only one `padding-left: 20px` div) is parsed as a plain row.
  it('a tax row missing its second split figure is parsed as a plain row', async () => {
    const fake = makeWebCtx();
    const fullRow = plRow(3, 'Only one', '$100', '', { town: '$60', ifel: '$40' });
    const secondCellStart = fullRow.indexOf(`${T(3)}<td style="padding-left: 20px" align="right">`);
    const rowMissingSecondCell = fullRow.slice(0, secondCellStart) + `\n${T(2)}</tr>`;

    fetchAsp(fake).mockResolvedValue(plRow(0, 'Net', '$1') + '\n' + rowMissingSecondCell);
    const data = await fetchProfitLoss(fake.ctx);
    const node = data.root.children![0];
    expect(node.amount).toBe('100');
    expect(node.isTax).toBeUndefined();
    expect(node.secAmount).toBeUndefined();
  });

  // Regression guard for B-7. `FormatValue` = `FormatCurrency(v,0,0,0,-1)`
  // (:16-22): the 4th argument turns parentheses off, so a loss renders
  // `-$2,400,000`. The pattern captured `\$([0-9,.-]+)` and `[\s\S]*?` had
  // already eaten the `-`: EVERY loss was reported as a gain, on the one page
  // where the sign is the whole point. The page colours those lines #ff7700
  // (:135-136) for that exact reason.
  it('a loss keeps its sign, in both FormatCurrency renderings', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(
      plRow(0, 'Net Profit (losses)', '-$2,400,000') + '\n' + plRow(1, 'Fines', '($75,000)'),
    );
    const data = await fetchProfitLoss(fake.ctx);
    expect(data.root.amount).toBe('-2400000');
    expect(data.root.children![0].amount).toBe('-75000');
  });

  // Regression guard for the chart window (audit field 37). The lookup was a
  // 500-character window FORWARD from the row start, so a row with no chart of
  // its own borrowed the next row's — including across the flush rows, whose
  // link belongs to the previous level-2 block (:101, :218).
  it('a ChartInfo belonging to the next row is not attributed to this one', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(plRow(0, 'Net', '$1') + '\n' + plRow(1, 'Rent', '$2', '2,7,8'));
    const data = await fetchProfitLoss(fake.ctx);
    expect(data.root.chartData).toBeUndefined();
    expect(data.root.children![0].chartData).toEqual([7, 8]);
  });

  it('a row truncated before its </tr> still has its chart looked up, to the end of the page', async () => {
    const fake = makeWebCtx();
    const row = plRow(0, 'Net', '$1', '2,7,8');
    fetchAsp(fake).mockResolvedValue(row.substring(0, row.lastIndexOf('</tr>')));
    expect((await fetchProfitLoss(fake.ctx)).root.chartData).toEqual([7, 8]);
  });

  it('a flush row is not an account of its own', async () => {
    // Its div carries `style="color: …"`, not `style="margin-left: …"` (:95 vs
    // :119) — without that discriminator the flush was parsed as a row whose
    // label was its own amount.
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(
      plRow(0, 'Net', '$1') + '\n' + plRow(2, 'Residentials', '') + '\n' + plFlush('$9,000', 'Residentials'),
    );
    const data = await fetchProfitLoss(fake.ctx);
    expect(data.root.children).toHaveLength(1);
    expect(data.root.children![0]).toMatchObject({ label: 'RESIDENTIALS', amount: '9000' });
  });

  it('a level-2 header the page never flushes keeps amount 0', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(plRow(0, 'Net', '$1') + '\n' + plRow(2, 'Residentials', ''));
    const data = await fetchProfitLoss(fake.ctx);
    expect(data.root.children![0]).toMatchObject({ label: 'RESIDENTIALS', amount: '0', isHeader: true });
  });

  it('a flush with no pending header is ignored', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(plFlush('$9,000', 'Orphan') + '\n' + plRow(0, 'Net', '$1'));
    const data = await fetchProfitLoss(fake.ctx);
    expect(data.root).toMatchObject({ label: 'Net', amount: '1' });
    expect(data.root.children).toEqual([]);
  });

  it('with no rows: the default root, no children', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('<html></html>');
    expect(await fetchProfitLoss(fake.ctx)).toEqual({ root: { label: 'Net Profit (losses)', level: 0, amount: '0', children: [] } });
  });

  it('a row whose label is only tags becomes "Unknown"; a level-1 row without amount is not a header', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(plRow(0, '<img src=a.gif>', '$5') + '\n' + plRow(1, 'Rent', ''));
    const data = await fetchProfitLoss(fake.ctx);
    expect(data.root.label).toBe('Unknown');
    expect(data.root.children![0]).toMatchObject({ label: 'Rent', amount: '0', isHeader: false });
  });

  it('a first row deeper than 0 still becomes the root; siblings at the same level pop the stack', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue([
      plRow(1, 'A', '$1'), plRow(3, 'B', '$2'), plRow(3, 'C', '$3'), plRow(1, 'D', '$4'),
    ].join('\n'));
    const data = await fetchProfitLoss(fake.ctx);
    expect(data.root.label).toBe('A');
    expect(data.root.children!.map(c => c.label)).toEqual(['B', 'C', 'D']);
    expect(data.root.children![0].children).toEqual([]);
  });

  it('never throws when the ASP fetch fails: returns the default root with cacheUnavailable', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockRejectedValue(new Error('ASP request failed: 500'));
    await expect(fetchProfitLoss(fake.ctx)).resolves.toEqual({
      root: { label: 'Net Profit (losses)', level: 0, amount: '0', children: [] },
      cacheUnavailable: true,
    });
  });

  it('the "cannot retrieve" sentence flags cacheUnavailable instead of the default root', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(
      '<div class=header2 style="padding: 20px">\n\t\t\t\t    Sorry, cannot retrieve Tycoon information from server.\n\t\t\t\t</div>',
    );
    await expect(fetchProfitLoss(fake.ctx)).resolves.toMatchObject({ cacheUnavailable: true });
  });

  it('a page that parses carries no cacheUnavailable key', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(plRow(0, 'Net', '$1'));
    const data = await fetchProfitLoss(fake.ctx);
    expect(data).not.toHaveProperty('cacheUnavailable');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fetchCompanyProfitLoss — CompanyPage.asp
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchCompanyProfitLoss', () => {
  it('fetches CompanyPage.asp with the requested company and cluster, and parses the same tree fetchProfitLoss would', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue([
      plRow(0, 'Net Profit (losses)', '$1,000,000', '3,10,-20,30'),
      plRow(1, 'Income', '$2,000,000'),
      plRow(2, 'Residentials', ''),
      plRow(3, 'Houses', '$500,000'),
      plFlush('$2,000,000', 'Residentials'),
    ].join('\n'));

    const data = await fetchCompanyProfitLoss(fake.ctx, 'Yellow Inc.', 'PGI');

    expect(fetchAsp(fake)).toHaveBeenCalledWith('NewTycoon/CompanyPage.asp', { Company: 'Yellow Inc.', CompanyCluster: 'PGI', RIWS: '' });
    expect(data.root).toMatchObject({ label: 'Net Profit (losses)', level: 0, amount: '1000000', chartData: [10, -20, 30] });
    expect(data.root.children![0]).toMatchObject({ label: 'Income', level: 1, amount: '2000000' });
  });

  it('an ObjValid=false page — no account row — rejects, naming the company', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(
      '<html><body><div class=header2 style="padding: 20px">Sorry, cannot retrieve Tycoon information from server.</div></body></html>',
    );
    await expect(fetchCompanyProfitLoss(fake.ctx, 'Red Corp.', 'PGI')).rejects.toThrow(
      'CompanyPage.asp carries no account tree for "Red Corp."',
    );
  });

  it('propagates a rejected fetch', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockRejectedValue(new Error('ASP request failed: 500'));
    await expect(fetchCompanyProfitLoss(fake.ctx, 'Yellow Inc.', 'PGI')).rejects.toThrow('ASP request failed: 500');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fetchCompanies + parseCompaniesHtml
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchCompanies', () => {
  /**
   * chooseCompany.asp:176-201 — one company cell. The first `<nobr>` of
   * `<div class=data>` holds `CompanyOwnerRole` when it differs from the logged
   * user, `strPrivate` otherwise (:193-197).
   */
  function companyCell(id: number, name: string | null, role: string | null, cluster: string, nobr: string, facilities: number): string {
    return `${T(4)}<td align="center" valign="bottom"\n`
      + `${T(5)}style="border-style: solid; border-width: 2px; border-color: black"\n`
      + `${T(5)}onClick="onCompClick()"\n`
      + (role === null ? '' : `${T(5)}companyOwnerRole="${role}"\n`)
      + (name === null ? '' : `${T(5)}companyName="${name}"\n`)
      + `${T(5)}companyId="${id}"\n`
      + `${T(5)}normColor="black"\n${T(5)}hiColor="#3A5950">\n\n`
      + `${T(5)}<img src="images/comp-${cluster}.gif" style="cursor: hand" border="0">\n\n`
      + `${T(5)}<div class=header3>\n${T(6)}${name ?? ''}\n${T(5)}</div>\n`
      + `${T(5)}<a href="../NewTycoon/CompanyPage.asp?Company=${name ?? ''}&Tycoon=SPO_test3&WorldName=Shamba&CompanyCluster=${cluster}">more info</a>\n`
      + `${T(5)}<div class=data>\n`
      + `${T(6)}<nobr> ${nobr} </nobr><br>\n`
      + `${T(6)}<nobr> ${facilities} Facilities </nobr><br>\n`
      + `${T(5)}</div>\n${T(4)}</td>`;
  }

  it('fetches chooseCompany.asp with Logon=FALSE and the username, and parses the company cells', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(
      companyCell(77, 'SPO_test3 - Green', 'SPO_test3', 'Dissidents', 'Private', 13) + '\n'
      + companyCell(78, 'Roman Works', 'Mayor of Rome', 'PGI', 'Mayor of Rome', 4) + '\n'
      + `${T(4)}<td>trailer</td>`,
    );

    const data = await fetchCompanies(fake.ctx);

    expect(fetchAsp(fake)).toHaveBeenCalledWith('NewLogon/chooseCompany.asp', { Logon: 'FALSE', UserName: 'SPO_test3', RIWS: '' });
    expect(data).toEqual({
      currentCompany: 'SPO_test3 - Green',
      worldName: 'Shamba',
      companies: [
        { name: 'SPO_test3 - Green', companyId: 77, ownerRole: 'SPO_test3', cluster: 'Dissidents', facilityCount: 13, companyType: 'Private' },
        // Regression guard for B-13. The old alternation wanted a bare keyword
        // right before `</nobr>`; on the real "Mayor of Rome" it failed and fell
        // back to 'Private' — a public company labelled private, an inversion.
        { name: 'Roman Works', companyId: 78, ownerRole: 'Mayor of Rome', cluster: 'PGI', facilityCount: 4, companyType: 'Mayor of Rome' },
      ],
    });
  });

  it('a company without a role attribute takes cachedUsername as owner; a cell without a data div stays Private', async () => {
    const fake = makeWebCtx({ cachedUsername: 'Cached' });
    fetchAsp(fake).mockResolvedValue(`${T(4)}<td companyId="1" companyName="X">\n${T(5)}<div class=header3>X</div>\n${T(4)}</td>`);
    const data = await fetchCompanies(fake.ctx);
    expect(data.companies[0]).toMatchObject({ ownerRole: 'Cached', companyType: 'Private', cluster: '', facilityCount: 0 });
  });

  it('a company with no name is numbered, and an empty nobr falls back to Private', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(companyCell(78, null, null, 'PGI', '', 0));
    const data = await fetchCompanies(fake.ctx);
    expect(data.companies[0]).toMatchObject({ name: 'Company 78', ownerRole: '', companyType: 'Private' });
  });

  it('the last company (no following <td>) is scanned up to 2000 chars', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(`<td companyId="5" companyName="Last" companyOwnerRole="r">`
      + '<div>' + 'x'.repeat(50) + '<div class=data><nobr> Private </nobr><nobr> 4 Facilities </nobr></div>');
    const data = await fetchCompanies(fake.ctx);
    expect(data.companies[0]).toMatchObject({ facilityCount: 4, companyType: 'Private', cluster: '' });
  });

  it('falls back to cachedUsername for the UserName param and to empty company / world names', async () => {
    const fake = makeWebCtx({ activeUsername: null, cachedUsername: 'Cached', currentCompany: null, currentWorldInfo: null });
    fetchAsp(fake).mockResolvedValue('');
    const data = await fetchCompanies(fake.ctx);
    expect(fetchAsp(fake)).toHaveBeenCalledWith('NewLogon/chooseCompany.asp', { Logon: 'FALSE', UserName: 'Cached', RIWS: '' });
    expect(data).toEqual({ companies: [], currentCompany: '', worldName: '' });
  });

  it('with no username at all sends an empty UserName', async () => {
    const fake = makeWebCtx({ activeUsername: null, cachedUsername: null });
    fetchAsp(fake).mockResolvedValue('');
    await fetchCompanies(fake.ctx);
    expect(fetchAsp(fake)).toHaveBeenCalledWith('NewLogon/chooseCompany.asp', { Logon: 'FALSE', UserName: '', RIWS: '' });
  });

  it('a failing ASP fetch is warned about and yields no companies, keeping current company and world', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockRejectedValue(new Error('ASP request failed: 500'));
    expect(await fetchCompanies(fake.ctx)).toEqual({
      companies: [], currentCompany: 'SPO_test3 - Green', worldName: 'Shamba', cacheUnavailable: true,
    });
    expect(fake.log.warn).toHaveBeenCalledWith('[Companies] ASP fetch failed:', expect.any(Error));

    const noWorld = makeWebCtx({ currentWorldInfo: null });
    fetchAsp(noWorld).mockRejectedValue(new Error('x'));
    expect((await fetchCompanies(noWorld.ctx)).worldName).toBe('');
  });

  it('the "cannot retrieve" sentence flags cacheUnavailable, with an empty list', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(
      '<body>Sorry, cannot retrieve Tycoon information from server.</body>',
    );
    await expect(fetchCompanies(fake.ctx)).resolves.toMatchObject({ companies: [], cacheUnavailable: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Another tycoon — "Show Profile" on a directory card (#528)
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchTycoonProfile — another tycoon', () => {
  it('overrides the Tycoon parameter and seeds nothing from the viewer\'s pushes', async () => {
    const fake = makeWebCtx();
    // What the server answers a viewer who is not the account holder (:25).
    fetchAsp(fake).mockResolvedValue(curriculumPage({ fullAccess: false }));
    mockFetch.mockResolvedValue(htmlResponse(''));

    const profile = await fetchTycoonProfile(fake.ctx, 'Rival');

    expect(fetchAsp(fake)).toHaveBeenCalledWith(CURRICULUM, { RIWS: '', Tycoon: 'Rival' });
    expect(queryOf(0).get('Tycoon')).toBe('Rival');
    expect(profile).toEqual({
      name: 'Rival',
      realName: '',
      // The pushes describe the SESSION user, so they must not be reported as
      // the viewed tycoon's.
      ranking: 0,
      budget: '0',
      facCount: 0,
      facMax: 0,
      failureLevel: 0,
      // From the page, which is rendered for any viewer.
      prestige: 1234,
      nobPoints: 2500,
      facPrestige: 0,
      researchPrestige: 0,
      area: 0,
      licenceLevel: 4,
      levelName: 'Paradigm',
      levelTier: 4,
    });
  });

  it('with no name argument it still resolves to the session user', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(CURRICULUM_HTML);
    mockFetch.mockResolvedValue(htmlResponse(''));

    const profile = await fetchTycoonProfile(fake.ctx);

    expect(fetchAsp(fake)).toHaveBeenCalledWith(CURRICULUM, { RIWS: '' });
    expect(profile).toMatchObject({
      name: 'SPO_test3', ranking: 42, budget: '123456789', facCount: 13, facMax: 100, failureLevel: 2,
    });
  });

  it('the session user\'s own name, in any case, collapses to the no-argument call', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(CURRICULUM_HTML);
    mockFetch.mockResolvedValue(htmlResponse(''));
    const own = await fetchTycoonProfile(fake.ctx);

    fetchAsp(fake).mockClear();
    const named = await fetchTycoonProfile(fake.ctx, '  spo_TEST3 ');

    expect(named).toEqual(own);
    expect(fetchAsp(fake)).toHaveBeenCalledWith(CURRICULUM, { RIWS: '' });
  });

  it('a role in activeUsername still recognises the cached tycoon name as own', async () => {
    // The card carries the tycoon name; activeUsername may hold the role.
    const fake = makeWebCtx({ activeUsername: 'Mayor of Helartia', cachedUsername: 'SPO_test3' });
    fetchAsp(fake).mockResolvedValue(CURRICULUM_HTML);
    mockFetch.mockResolvedValue(htmlResponse(''));

    const profile = await fetchTycoonProfile(fake.ctx, 'SPO_test3');

    expect(fetchAsp(fake)).toHaveBeenCalledWith(CURRICULUM, { RIWS: '' });
    // `name` is what the session calls itself, exactly as the no-argument path.
    expect(profile).toMatchObject({ name: 'Mayor of Helartia', ranking: 42 });
  });

  it('an empty session name leaves the profile nameless rather than guessing', async () => {
    const fake = makeWebCtx({ activeUsername: '', cachedUsername: '' });
    fetchAsp(fake).mockResolvedValue('');
    mockFetch.mockResolvedValue(htmlResponse(''));
    const profile = await fetchTycoonProfile(fake.ctx);
    expect(profile.name).toBe('');
    // No name: RenderTycoon.asp is not even asked (:95).
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('fetchCurriculumData — another tycoon', () => {
  it('carries Tycoon on both fetches and on buildAspUrl, and caches no action URL', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(curriculumPage({ fullAccess: false }));
    mockFetch.mockResolvedValue(htmlResponse(''));

    const data = await fetchCurriculumData(fake.ctx, 'Rival');

    expect(fetchAsp(fake)).toHaveBeenCalledTimes(2);
    expect(fetchAsp(fake)).toHaveBeenNthCalledWith(1, CURRICULUM, { RIWS: '', Tycoon: 'Rival' });
    expect(fetchAsp(fake)).toHaveBeenNthCalledWith(2, CURRICULUM, { RIWS: '', Tycoon: 'Rival' });
    expect(fake.ctx.buildAspUrl).toHaveBeenCalledWith(CURRICULUM, { RIWS: '', Tycoon: 'Rival' });
    // Another tycoon's reset/abandon/advance links must never become the
    // viewer's own cached curriculum actions.
    expect(setCache(fake)).not.toHaveBeenCalled();
    expect(data).toMatchObject({
      tycoonName: 'Rival',
      // FullAccess=false withholds the checkbox, so no upgrade is offered.
      canUpgrade: false,
      isUpgradeRequested: false,
      ranking: 0,
      facCount: 0,
      facMax: 0,
      budget: '0',
      prestige: 1234,
      nobPoints: 2500,
      currentLevelName: 'Paradigm',
      nextLevelName: 'Legend',
    });
  });

  it('the session user\'s own name yields exactly the no-argument result', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(CURRICULUM_HTML);
    mockFetch.mockResolvedValue(htmlResponse(''));
    const own = await fetchCurriculumData(fake.ctx);

    setCache(fake).mockClear();
    const named = await fetchCurriculumData(fake.ctx, 'SPO_test3');

    expect(named).toEqual(own);
    expect(fake.ctx.buildAspUrl).toHaveBeenCalledWith(CURRICULUM, { RIWS: '' });
    // The own path still caches its own action URLs.
    expect(setCache(fake)).toHaveBeenCalledTimes(1);
  });

  it('a page the server refuses surfaces as cacheUnavailable, not a throw', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockRejectedValue(new Error('ASP request failed: 404'));
    mockFetch.mockResolvedValue(htmlResponse(''));

    const data = await fetchCurriculumData(fake.ctx, 'Nobody');

    expect(data).toMatchObject({ tycoonName: 'Nobody', cacheUnavailable: true, rankings: [] });
  });
});
