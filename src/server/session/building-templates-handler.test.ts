// node-fetch must be mocked before the handler module is imported — the four
// ASP scrapers call the default export directly, not through `ctx.fetchAspPage`.
// Same form as auth.validation.test.ts:16-19.
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import {
  fetchClusterInfo,
  fetchClusterFacilities,
  fetchBuildingCategories,
  fetchBuildingFacilities,
  placeBuilding,
  placeCapitol,
} from './building-templates-handler';
import { makeSessionCtx } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '../__tests__/session/fake-session-context';
import type { SessionContext } from './session-context';
import type { RdoPacket, WorldInfo } from '../../shared/types';
import { RdoValue } from '../../shared/rdo-types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RdoVerb, RdoAction } from '../../shared/types';

// =============================================================================
// placeBuilding / placeCapitol — M-A regression
//
// These call the REAL handler against a mocked RDO transport, unlike the
// synthetic-packet suites in __tests__/protocol-validation/, which assert
// hand-built command strings and therefore never observe the return value.
// =============================================================================

/** Minimal SessionContext satisfying what the two placement handlers touch. */
function makeCtx(payload: string): { ctx: SessionContext; sendRdoRequest: jest.Mock } {
  const sendRdoRequest = jest.fn().mockResolvedValue({ payload } as RdoPacket);
  const ctx = {
    worldContextId: 8161308,
    currentCompany: { id: '618' },
    log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    sendRdoRequest,
  } as unknown as SessionContext;
  return { ctx, sendRdoRequest };
}

describe('placeBuilding', () => {
  // The captured live response for a successful placement is `A147 res="#0";`
  // — observed on the live wire. It carries no building id.
  it('reports success with a null id — the protocol never returns one', async () => {
    const { ctx } = makeCtx('res="#0"');

    const result = await placeBuilding(ctx, 'PGISupermarketC', 28, 618);

    expect(result).toEqual({ success: true, buildingId: null });
  });

  // Guards the exact defect: a `/sel (\d+)/` match against the RESPONSE. `sel`
  // only ever appears in REQUESTS, so any payload echoing one must still yield
  // null rather than a plausible-looking id scraped out of the wrong frame.
  it('does not scrape an id out of a payload that happens to contain "sel"', async () => {
    const { ctx } = makeCtx('res="#0" sel 30430748');

    const result = await placeBuilding(ctx, 'PGISupermarketC', 28, 618);

    expect(result.buildingId).toBeNull();
  });

  // res="#33" is ERROR_TooManyFacilities (Protocol/Protocol.pas:62) — NOT
  // "duplicate building", as some scenario fixtures still claim.
  it('reports failure on a non-zero result code', async () => {
    const { ctx } = makeCtx('res="#33"');

    const result = await placeBuilding(ctx, 'PGISupermarketC', 28, 618);

    expect(result).toEqual({ success: false, buildingId: null });
  });

  it('reports failure when the payload carries no result code at all', async () => {
    const { ctx } = makeCtx('');

    const result = await placeBuilding(ctx, 'PGISupermarketC', 28, 618);

    expect(result).toEqual({ success: false, buildingId: null });
  });

  it('reports failure when the transport rejects', async () => {
    const { ctx, sendRdoRequest } = makeCtx('res="#0"');
    sendRdoRequest.mockRejectedValue(new Error('socket closed'));

    const result = await placeBuilding(ctx, 'PGISupermarketC', 28, 618);

    expect(result).toEqual({ success: false, buildingId: null });
  });

  it('refuses to build without a world context', async () => {
    const { ctx } = makeCtx('res="#0"');
    (ctx as { worldContextId: number | null }).worldContextId = null;

    await expect(placeBuilding(ctx, 'PGISupermarketC', 28, 618)).rejects.toThrow(
      'Not logged into world'
    );
  });

  it('refuses to build without a selected company', async () => {
    const { ctx } = makeCtx('res="#0"');
    (ctx as { currentCompany: unknown }).currentCompany = null;

    await expect(placeBuilding(ctx, 'PGISupermarketC', 28, 618)).rejects.toThrow(
      'No company selected'
    );
  });

  it('refuses to build as a visitor (company id 0)', async () => {
    const { ctx } = makeCtx('res="#0"');
    (ctx as { currentCompany: { id: string; name: string } }).currentCompany = {
      id: '0',
      name: '[VISITOR VISA]',
    };

    await expect(placeBuilding(ctx, 'PGISupermarketC', 28, 618)).rejects.toThrow(
      'No company selected'
    );
  });

  it('refuses to build when the company id is not a number', async () => {
    const { ctx } = makeCtx('res="#0"');
    (ctx as { currentCompany: { id: string } }).currentCompany = { id: 'Yellow Inc.' };

    await expect(placeBuilding(ctx, 'PGISupermarketC', 28, 618)).rejects.toThrow(
      'Invalid company ID: Yellow Inc.'
    );
  });

  // The captured request is
  //   C 147 sel 8184316 call NewFacility "^" "%PGISupermarketC","#618","#28","#618"
  // (live capture, build-menu scenario).
  it('targets the world context and types the four arguments as %,#,#,#', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');
    Object.assign(fake.ctx, { currentCompany: { id: '618', name: 'Yellow Inc.' } });

    await placeBuilding(fake.ctx, 'PGISupermarketC', 28, 618);

    const [{ packet, socketName, category }] = fake.sent;
    expect(socketName).toBe('world');
    expect(packet.verb).toBe(RdoVerb.SEL);
    expect(packet.targetId).toBe(fake.ctx.worldContextId);
    expect(packet.action).toBe(RdoAction.CALL);
    expect(packet.member).toBe('NewFacility');
    // TWorld.RDONewFacility is a function returning TErrorCode → `"^"`.
    expect(packet.separator).toBe('"^"');
    expect(packet.args).toEqual([
      RdoValue.string('PGISupermarketC').format(),
      RdoValue.int(618).format(),
      RdoValue.int(28).format(),
      RdoValue.int(618).format(),
    ]);
    expect(category).toBe(TimeoutCategory.NORMAL);
  });
});

describe('placeCapitol', () => {
  // The twin defect the audit did not mention: placeCapitol carried the same
  // dead regex at building-templates-handler.ts:590.
  it('reports success with a null id, exactly as placeBuilding does', async () => {
    const { ctx } = makeCtx('res="#0"');

    const result = await placeCapitol(ctx, 100, 200);

    expect(result).toEqual({ success: true, buildingId: null });
  });

  it('does not scrape an id out of a payload that happens to contain "sel"', async () => {
    const { ctx } = makeCtx('res="#0" sel 30430748');

    const result = await placeCapitol(ctx, 100, 200);

    expect(result.buildingId).toBeNull();
  });

  it('reports failure on a non-zero result code', async () => {
    const { ctx } = makeCtx('res="#33"');

    const result = await placeCapitol(ctx, 100, 200);

    expect(result).toEqual({ success: false, buildingId: null });
  });

  it('refuses to place without a world context', async () => {
    const { ctx } = makeCtx('res="#0"');
    (ctx as { worldContextId: number | null }).worldContextId = null;

    await expect(placeCapitol(ctx, 100, 200)).rejects.toThrow('Not logged into world');
  });

  it('reports failure when the transport rejects', async () => {
    const { ctx, sendRdoRequest } = makeCtx('res="#0"');
    sendRdoRequest.mockRejectedValue(new Error('Request timeout: NewFacility'));

    const result = await placeCapitol(ctx, 100, 200);

    expect(result).toEqual({ success: false, buildingId: null });
  });

  // Capitol hardcodes class "Capitol" and company 1 — the government company.
  it('sends the hardcoded Capitol class and company id 1', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');

    await placeCapitol(fake.ctx, 100, 200);

    expect(fake.sent[0].packet.args).toEqual([
      RdoValue.string('Capitol').format(),
      RdoValue.int(1).format(),
      RdoValue.int(100).format(),
      RdoValue.int(200).format(),
    ]);
    expect(fake.sent[0].packet.targetId).toBe(fake.ctx.worldContextId);
  });
});

// =============================================================================
// ASP SCRAPERS
//
// The four parsers (parseClusterInfo, parseClusterFacilities,
// parseBuildingCategories, parseBuildingFacilities) are module-private, so they
// are driven through their fetchers. Every fixture below reproduces the real
// page structure; where it comes from a live capture that is noted.
// =============================================================================

const mockFetch = fetch as unknown as jest.MockedFunction<
  (url: string, init?: unknown) => Promise<Response>
>;

/** A node-fetch Response stub carrying `body`. */
function htmlResponse(body: string, status = 200): Response {
  return { status, ok: status === 200, text: async () => body } as unknown as Response;
}

const WORLD: WorldInfo = {
  name: 'Shamba',
  url: 'http://158.69.153.134',
  ip: '158.69.153.134',
  port: 7000,
};

function makeWebCtx(overrides: Partial<SessionContext> = {}): FakeSessionCtx {
  return makeSessionCtx({ currentWorldInfo: WORLD, cachedUsername: 'SPO_test3', ...overrides });
}

/** The single URL string handed to node-fetch by the call under test. */
function fetchedUrl(): string {
  return mockFetch.mock.calls[0][0];
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// fetchClusterInfo — NewLogon/info.asp
//
// Instantiated from the page, NOT from the parser: the previous fixture had no
// <head> at all, and the <head> is precisely where the defect lived (B-10).
// ---------------------------------------------------------------------------

/**
 * `info.asp:37-177`. `description` is what the `select case ClusterName` of
 * `:103-114` writes — empty for any cluster outside the five it knows.
 *
 * THE POINT OF THE `<script>` BLOCK: `:53` and `:60` build
 * `"facilityList.asp?Cluster=<%= ClusterName%>&Folder=" + td.folder`, and both
 * come BEFORE the `<table id="main" cluster="…">` of `:95`. There is no quote
 * after `Cluster=` there, so an unanchored `/cluster\s*=/i` captured up to the
 * closing `"` of the JS string.
 */
function infoPage(opts: { cluster: string; description?: string; tabs?: Array<[folder: string, label: string]> }): string {
  const { cluster, description = '', tabs = [] } = opts;
  const fingers = tabs.map(([folder, label], i) => [
    '\t\t\t<tr>',                                                       // :19
    `\t\t\t\t<td id="finger${i}" ${i === 0 ? 'bgcolor="#143930"' : ''} align="right" valign="top" folder="${folder}" onClick="onFingerClick()">`,
    '\t\t\t\t\t\t<div class="hiLabel">',
    `\t\t\t\t\t\t\t<nobr>${label}</nobr>`,                              // :22
    '\t\t\t\t\t\t</div>',
    '\t\t\t\t</td>',
    '\t\t\t</tr>',
  ].join('\n')).join('\n');

  return [
    '<html>',                                                           // :37
    '\t<head>',
    '\t\t<link rel="STYLESHEET" href="logon.css" type="text/css">',
    '\t\t<script language="JScript" src="../includes/FrameButtons.js"></script>',
    '\t\t<script language="JScript">',
    '',
    '\t\t\tvar oldSelFinger = null;',
    '',
    '\t\t\tfunction onFingerClick()',
    '\t\t\t{',
    '\t\t\t\tvar td = getCell( event.srcElement );',
    '\t\t\t\tif (td != null && td.tagName == "TD")',
    '\t\t\t\t{',
    '\t\t\t\t\toldSelFinger.bgColor = "";',
    '\t\t\t\t\ttd.bgColor = "#143930";',
    '\t\t\t\t\toldSelFinger = td;',
    `\t\t\t\t\twindow.parent.frames["facList"].navigate( "facilityList.asp?Cluster=${cluster}&Folder=" + td.folder );`, // :53
    '\t\t\t\t}',
    '\t\t\t}',
    '',
    '\t\t\tfunction onLoad()',
    '\t\t\t{',
    '\t\t\t\tvar td = document.all["finger0"];',
    `\t\t\t\twindow.parent.frames["facList"].navigate( "facilityList.asp?Cluster=${cluster}&Folder=" + td.folder );`,  // :60
    '\t\t\t}',
    '',
    '\t\t</script>',
    '\t\t<style>',
    '\t\t\t.hiLabel',
    '\t\t\t{',
    '\t\t\t\tcolor: #94B9B0;',
    '\t\t\t}',
    '\t\t\t.sealExpln',
    '\t\t\t{',
    '\t\t\t\tcolor: white;',
    '\t\t\t}',
    '\t\t</style>',
    '\t</head>',
    '',
    '\t<body style="background-color: black; margin: 0px" onLoad="onLoad()">',
    `\t\t<table id="main" cluster="${cluster}" bgcolor="#345950" cellpadding="0" cellspacing="0" height="1500" width="100%" background="images/watermark.jpg">`, // :95
    '\t\t\t<tr>',
    '\t\t\t\t<td valign="top">',
    '\t\t\t\t\t<table cellpadding="0" cellspacing="0" width="100%">',
    '\t\t\t\t\t\t<tr>',
    '\t\t\t\t\t\t\t<td width="100%" valign="top">',
    '\t\t\t\t\t\t\t\t<div class="sealExpln" style="padding: 20px">',    // :101
    `\t\t\t\t\t\t\t\t\t${description}`,
    '\t\t\t\t\t\t\t\t</div>',
    '\t\t\t\t\t\t\t</td>',
    '\t\t\t\t\t\t\t<td width="250" valign="top" align="right">',
    '\t\t\t\t\t\t\t\t<table cellpadding="5" cellspacing="0" width="100%" style="margin-top: 20px">',
    '\t\t\t\t\t\t\t\t\t<tr>',
    fingers,
    '\t\t\t\t\t\t\t\t\t</tr>',
    '\t\t\t\t\t\t\t\t</table>',
    '\t\t\t\t\t\t\t</td>',
    '\t\t\t\t\t\t</tr>',
    '\t\t\t\t\t</table>',
    '\t\t\t\t</td>',
    '\t\t\t</tr>',
    '\t\t</table>',
    '\t</body>',
    '</html>',
  ].join('\n');
}

// PGI, whose `strFoundedBy` blurb `info.asp:107` writes — truncated after the
// first two sentences (NewLogon.lng:35). `<p>` and `<br>` are the page's.
const INFO_ASP_HTML = infoPage({
  cluster: 'PGI',
  description:
    'Founded by the wealthiest organizations in Europe, PGI provides some of the best technologies available today.<p>' +
    'PGI industries are efficient and showcase the best production quality available,<br>but its facilities are very expensive.',
  tabs: [
    ['00000024.PGIDirectionFacilities.five', 'Headquarters'],
    ['00000025.PGIFarms.five', 'Farms'],
    ['00000026.PGIFactories.five', 'Factories'],
  ],
});

describe('fetchClusterInfo', () => {
  it('builds the info.asp URL on the world ip and url-encodes the cluster name', async () => {
    mockFetch.mockResolvedValue(htmlResponse(INFO_ASP_HTML));
    const fake = makeWebCtx();

    await fetchClusterInfo(fake.ctx, 'Magna Corp');

    expect(fetchedUrl()).toBe(
      'http://158.69.153.134/Five/0/Visual/Voyager/NewLogon/info.asp?ClusterName=Magna%20Corp'
    );
    expect(mockFetch.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'follow' }));
    expect((mockFetch.mock.calls[0][1] as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
  });

  // B-10. Regression guard: the display name used to read `PGI&Folder=` and that
  // string reached the UI. The unanchored /cluster\s*=/i hit `info.asp:53` — the
  // <head> script — where `"…?Cluster=" + ClusterName + "&Folder=" + td.folder`
  // leaves no quote after `Cluster=`, so the capture ran to the JS string's
  // closing `"`. The name is now read off `<table id="main" cluster="…">` (:95).
  it('reads the display name off the main table, not off the navigate() call in the head', async () => {
    mockFetch.mockResolvedValue(htmlResponse(INFO_ASP_HTML));
    const fake = makeWebCtx();

    const info = await fetchClusterInfo(fake.ctx, 'PGI');

    expect(info.id).toBe('PGI');
    expect(info.displayName).toBe('PGI');
    expect(info.displayName).not.toContain('&Folder=');
  });

  it('reads the blurb off the sealExpln div', async () => {
    mockFetch.mockResolvedValue(htmlResponse(INFO_ASP_HTML));
    const fake = makeWebCtx();

    const info = await fetchClusterInfo(fake.ctx, 'PGI');

    expect(info.description).toContain('Founded by the wealthiest organizations in Europe');
    // <p> and <br> become newlines, every other tag is stripped.
    expect(info.description).toContain('\n');
    expect(info.description).not.toContain('<');
  });

  // `info.asp:103-114` knows five clusters; every other one gets an empty div.
  // That is the page, not the parser — recorded so it is not "fixed" later.
  it('returns an empty blurb for a cluster the select case does not cover', async () => {
    mockFetch.mockResolvedValue(htmlResponse(infoPage({ cluster: 'IFEL', tabs: [['00000001.X.five', 'HQ']] })));
    const fake = makeWebCtx();

    const info = await fetchClusterInfo(fake.ctx, 'IFEL');

    expect(info.displayName).toBe('IFEL');
    expect(info.description).toBe('');
    expect(info.categories).toEqual([{ name: 'HQ', folder: '00000001.X.five' }]);
  });

  it('lists the finger tabs in document order, name and folder together', async () => {
    mockFetch.mockResolvedValue(htmlResponse(INFO_ASP_HTML));
    const fake = makeWebCtx();

    const info = await fetchClusterInfo(fake.ctx, 'PGI');

    expect(info.categories).toEqual([
      { name: 'Headquarters', folder: '00000024.PGIDirectionFacilities.five' },
      { name: 'Farms', folder: '00000025.PGIFarms.five' },
      { name: 'Factories', folder: '00000026.PGIFactories.five' },
    ]);
  });

  it('falls back to the requested name and an empty blurb on a page with neither', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<html><body><div>nothing here</div></body></html>'));
    const fake = makeWebCtx();

    const info = await fetchClusterInfo(fake.ctx, 'PGI');

    expect(info).toEqual({ id: 'PGI', displayName: 'PGI', description: '', categories: [] });
  });

  it('skips a folder tab whose label is missing', async () => {
    mockFetch.mockResolvedValue(
      htmlResponse('<td folder="00000009.Empty.five"><div class="hiLabel"></div></td>')
    );
    const fake = makeWebCtx();

    const info = await fetchClusterInfo(fake.ctx, 'PGI');

    expect(info.categories).toEqual([]);
  });

  it('returns an empty cluster and logs when the page cannot be fetched', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const fake = makeWebCtx();

    const info = await fetchClusterInfo(fake.ctx, 'PGI');

    expect(info).toEqual({ id: 'PGI', displayName: 'PGI', description: '', categories: [] });
    expect(fake.log.error).toHaveBeenCalled();
  });

  it('refuses to fetch before the world login has produced a world info', async () => {
    const fake = makeSessionCtx(); // currentWorldInfo defaults to null

    await expect(fetchClusterInfo(fake.ctx, 'PGI')).rejects.toThrow(
      'Not logged into world - cannot fetch cluster info'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Regression guard (was pinned as the accepted behaviour in lot 3): none of
  // the four scrapers looked at `response.status`, so an IIS error page was
  // parsed as if it were data and the caller got an empty result with no error.
  // That is exactly how a wrong page NAME stayed invisible for years on the
  // politics side (audit A-12).
  it('reports a 500 instead of parsing the error page as an empty cluster', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<html><body>500 - Internal server error</body></html>', 500));
    const fake = makeWebCtx();

    const info = await fetchClusterInfo(fake.ctx, 'PGI');

    expect(info).toEqual({ id: 'PGI', displayName: 'PGI', description: '', categories: [] });
    expect(fake.log.error).toHaveBeenCalledWith(expect.stringContaining('info.asp for PGI answered HTTP 500'));
  });
});

// ---------------------------------------------------------------------------
// fetchClusterFacilities — NewLogon/facilityList.asp
// ---------------------------------------------------------------------------

/**
 * `NewLogon/FacilityList.asp:181-236`, one `<span>` per facility.
 *
 * Reproduced from the page, unquoted `src` (`:188`), stray `</td>` (`:191`) and
 * all. `zoneTitle` is what the `select case CacheClass.ZoneType` of `:194-223`
 * writes, from Voyager.lng. `desc` and `requires` share one div (`:232-234`).
 */
function clusterFacilityPage(
  facilities: Array<{ name: string; icon: string; zoneImg?: string; zoneTitle?: string; price?: string; size?: string; desc?: string; requires?: string }>
): string {
  const spans = facilities.map(f => {
    const zone = f.zoneImg
      ? `\t\t\t\t<img src="images/${f.zoneImg}" style="filter: alpha(opacity=100)" title="${f.zoneTitle}.">`
      : '\t\t\t\t';
    return [
      '\t<span style="width:200px; padding: 3px; border-color: #345950; border-bottom-style: solid; border-width: 1px">',
      '\t\t<div class=comment style="font-size: 11px; font-name: Arial; font-weight: normal; color: #fff8dc">',
      `\t\t${f.name}`,                                                  // :183
      '\t\t</div>',
      '\t\t<table>',
      '\t\t\t<tr height=80>',
      '\t\t\t\t<td>',
      `\t\t\t\t\t<img src=${f.icon} border="0"/>`,                      // :188 — src unquoted
      '',
      '\t\t\t\t</td>',
      '\t\t\t</td>',                                                    // :191 — the source's own stray close
      '\t\t\t<td valign="top">',
      '\t\t\t\t',
      zone,
      '\t\t\t\t',
      '\t\t\t\t<div class=comment style="font-size: 9px; font-name: Arial; font-weight: normal">',  // :225
      `\t\t\t\t\t${f.price ?? ''}<br>`,                                 // :226 — CacheClass.ImportPrice
      `\t\t\t\t\t<nobr>${f.size ?? ''}</nobr>`,                         // :227 — CacheClass.Size, a SURFACE
      '\t\t\t\t</div>',
      '\t\t\t</td>',
      '\t\t</table>',
      '      \t',
      '\t\t<div class="description" style="font-size: 10px; padding-left: 0px; color: #94B9B0; height: 100px">',
      `\t\t\t${f.desc ?? ''}<br>${f.requires ?? ''}`,                    // :233
      '\t\t</div>',
      '',
      '\t</span>',
      '',
    ].join('\n');
  }).join('\n');

  return [
    '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">',
    '<html>',
    '<head>',
    '\t<title>Facility List</title>',
    '\t<link rel="STYLESHEET" href="../voyager.css" type="text/css">',
    '</head>',
    '',
    '<body style="background-color: #143930; margin: 10px">',           // :249
    '',
    spans,
    '</body>',
    '',
    '<script for="Document" language="JavaScript">',
    `  var CellCount = ${facilities.length};`,                          // :258
    '</script>',
    '',
    '</html>',
  ].join('\n');
}

// Voyager.lng:14 (`strBlueZone`) and :13 (`strYellowZone`) — the page appends
// the full stop itself (`:213`, `:209`). The second span carries no zone image
// (`ZoneType` outside 3..9 renders nothing) and no description text.
const CLUSTER_FACILITIES_HTML = clusterFacilityPage([
  {
    name: 'Company Headquarters', icon: '/five/icons/MapDisHQ1.gif',
    zoneImg: 'zone-commerce.gif', zoneTitle: 'Building must be located in blue zone or no zone at all',
    price: '$8,000K', size: '3600 m.',
    desc: 'The nerve center of your business empire.', requires: '',
  },
  {
    name: 'Trade Center', icon: '/five/icons/MapDisTrade1.gif',
    zoneImg: 'zone-industry.gif', zoneTitle: 'Building must be located in yellow zone or no zone at all',
    price: '$12,500K', size: '4800 m.',
  },
]);

describe('fetchClusterFacilities', () => {
  it('escapes spaces as %20 rather than + in the query string', async () => {
    mockFetch.mockResolvedValue(htmlResponse(CLUSTER_FACILITIES_HTML));
    const fake = makeWebCtx();

    await fetchClusterFacilities(fake.ctx, 'Magna Corp', '00000002.Direction Facilities.five');

    // The legacy ASP pages do not decode `+` as a space — hence the explicit
    // replace in building-templates-handler.ts:106.
    expect(fetchedUrl()).toContain('Cluster=Magna%20Corp');
    expect(fetchedUrl()).toContain('Folder=00000002.Direction%20Facilities.five');
    expect(fetchedUrl()).not.toContain('+');
  });

  // B-12. Regression guard: the `<nobr>` holds `CacheClass.Size`
  // (NewLogon/FacilityList.asp:227) and used to fill a field called `buildTime`,
  // so the UI announced "3600 m." as a construction delay. The very same
  // expression at Build/FacilityList.asp:248 has always been read into
  // `BuildingInfo.area` by the sibling parser in this file.
  it('reads name, icon, zone, price and SURFACE off each span', async () => {
    mockFetch.mockResolvedValue(htmlResponse(CLUSTER_FACILITIES_HTML));
    const fake = makeWebCtx();

    const previews = await fetchClusterFacilities(fake.ctx, 'Dissidents', 'hq');

    expect(previews).toHaveLength(2);
    expect(previews[0]).toEqual({
      name: 'Company Headquarters',
      // Icons are rewritten through the gateway proxy, never served direct.
      iconUrl: 'proxy:/five/icons/MapDisHQ1.gif',
      cost: '$8,000K',
      area: '3600 m.',
      zoneType: 'Building must be located in blue zone or no zone at all.',
      description: 'The nerve center of your business empire.',
    });
    expect(previews[0]).not.toHaveProperty('buildTime');
    expect(previews[1].cost).toBe('$12,500K');
    expect(previews[1].area).toBe('4800 m.');
  });

  // `:233` puts Desc and Requires in ONE div separated by `<br>`; the parser
  // turns that `<br>` into a space. An empty Requires leaves nothing behind.
  it('joins the description and its requirements, which share one div', async () => {
    const html = clusterFacilityPage([
      { name: 'Ore Mine', icon: '/five/icons/MapDisOre1.gif', desc: 'Digs ore.', requires: 'Requires level 3.' },
    ]);
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const previews = await fetchClusterFacilities(fake.ctx, 'PGI', 'x');

    expect(previews[0].description).toBe('Digs ore. Requires level 3.');
  });

  it('leaves the zone empty when ZoneType falls outside the select case', async () => {
    // NewLogon/FacilityList.asp:194-223 covers ZoneType 3..9 only.
    const html = clusterFacilityPage([{ name: 'Anywhere', icon: '/five/icons/MapX.gif', price: '$1K', size: '10 m.' }]);
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    expect((await fetchClusterFacilities(fake.ctx, 'PGI', 'x'))[0].zoneType).toBe('');
  });

  it('skips a span without a name and defaults every missing field', async () => {
    const html = `
      <span><div>no comment class here</div></span>
      <span>
        <div class=comment style="font-size: 11px">Bare Facility</div>
      </span>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const previews = await fetchClusterFacilities(fake.ctx, 'PGI', 'x');

    expect(previews).toEqual([
      { name: 'Bare Facility', iconUrl: '', cost: '', area: '', zoneType: '', description: '' },
    ]);
  });

  it('leaves price and surface empty when the meta div holds neither', async () => {
    const html = `
      <span>
        <div class=comment style="font-size: 11px">Odd Facility</div>
        <div class=comment style="font-size: 9px">price on request</div>
      </span>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const previews = await fetchClusterFacilities(fake.ctx, 'PGI', 'x');

    expect(previews[0].cost).toBe('');
    expect(previews[0].area).toBe('');
  });

  it('returns nothing and logs when the page cannot be fetched', async () => {
    mockFetch.mockRejectedValue(new Error('socket hang up'));
    const fake = makeWebCtx();

    expect(await fetchClusterFacilities(fake.ctx, 'PGI', 'x')).toEqual([]);
    expect(fake.log.error).toHaveBeenCalled();
  });

  it('reports a 404 rather than parsing the error page as an empty folder', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<html><head><title>404 - File or directory not found.</title></head></html>', 404));
    const fake = makeWebCtx();

    expect(await fetchClusterFacilities(fake.ctx, 'PGI', 'x')).toEqual([]);
    expect(fake.log.error).toHaveBeenCalledWith(
      expect.stringContaining('facilityList.asp for PGI/x answered HTTP 404')
    );
  });

  it('refuses to fetch before the world login has produced a world info', async () => {
    const fake = makeSessionCtx();

    await expect(fetchClusterFacilities(fake.ctx, 'PGI', 'x')).rejects.toThrow(
      'Not logged into world - cannot fetch cluster facilities'
    );
  });
});

// ---------------------------------------------------------------------------
// fetchBuildingCategories — Build/KindList.asp
// ---------------------------------------------------------------------------

/**
 * `Build/KindList.asp:96-218` — no longer `[INFERRED]`.
 *
 * The response body of this page appears in NO capture: only its URL and the
 * `FacilityList.asp` URL it navigates to were seen on the live wire. That URL is
 * reproduced parameter for parameter by the `ref` of `:178`, which is what makes
 * the two agree. The rest of the markup —
 * the two leading non-kind cells, the `<div class=link>`, the icon path built by
 * `GetKindIcon` (`:88`) and the source's own nested-`<td>` typo at `:113-114` —
 * is now established by the page instead of guessed from our parser.
 *
 * `roads` / `mayor` select which of the paired branches `:98-120` and `:121-152`
 * rendered; neither cell is a building kind and neither must ever be listed.
 */
function kindListPage(opts: {
  cluster?: string;
  tycoonLevel?: number;
  roads?: boolean;
  mayor?: boolean;
  kinds?: Array<{ id: string; name: string; localisedName?: string; folder: string; enabled?: boolean }>;
  error?: string;
}): string {
  const { cluster = 'PGI', tycoonLevel = 0, roads = true, mayor = false, kinds = [], error } = opts;
  const icon = (id: string, state: string) => `/Five/Visual/Clusters/${cluster}/images/FacKind_${id}${state}.jpg`;

  const roadCell = roads
    ? [                                                                 // :99-111
      '\t\t<td align="center" valign="bottom"',
      '\t\t\tstyle="border-style: solid; border-width: 2px; border-color: black; cursor: hand"',
      '\t\t\tonMouseOver="onMouseOverFrame()"',
      '\t\t\tonMouseOut="onMouseOutFrame()"',
      '\t\t\tonClick="onKindClick()"',
      '\t\t\tref="RoadOptions.asp"',                                    // :104 — NOT a kind
      '\t\t\tnormColor="black"',
      '\t\t\thiColor="#3A5950">',
      '\t\t\t<img id="itemImg_0" order=0 src="images/BuildRoad.jpg" title="Build roads" border="0" style="cursor: hand">',
      '\t\t\t<div class=link>',
      '\t\t\t\tRoads',                                                  // Voyager.lng:18
      '\t\t\t</div>',
      '\t\t</td>',
    ]
    : [                                                                 // :113-119, typo included
      '\t\t<td align="center" valign="bottom"',
      '\t\t\t<td align="center" valign="bottom">',                      // :114 — the source's nested <td>
      '\t\t\t<img id="itemImg_0" order=0 src="images/BuildRoadDisabled.jpg" title="Apprentices cannot build road" border="0" style="cursor: hand">',
      '\t\t\t<div class=disabledLink>',
      '\t\t\t\tRoads',
      '\t\t\t</div>',
      '\t\t</td>',
    ];

  const mayorCell = mayor
    ? [                                                                 // :122-144
      '\t\t<td align="center" valign="bottom"',
      '\t\t\tstyle="border-style: solid; border-width: 2px; border-color: black; cursor: hand"',
      '\t\t\tonMouseOver="onMouseOverFrame()"',
      '\t\t\tonMouseOut="onMouseOutFrame()"',
      '\t\t\tonClick="onKindClick()"',
      `\t\t\tref="MayorOptions.asp?Tycoon=SPO_test3&Company=Yellow Inc.&WorldName=Shamba&Cluster=${cluster}"`, // :127
      '\t\t\tnormColor="black"',
      '\t\t\thiColor="#3A5950">',
      '\t\t\t<img id="itemImg_0" order=0 src="images/Mayor.jpg" title="Mayor options" border="0" style="cursor: hand">',
      '\t\t\t<div class=link>',
      '\t\t\t\tMayor',                                                  // Voyager.lng:19
      '\t\t\t</div>',
      '\t\t</td>',
    ]
    : [                                                                 // :146-151
      '\t\t<td align="center" valign="bottom">',
      '\t\t\t<img id="itemImg_0" order=0 src="images/MayorDisabled.jpg" title="You are not the mayor!" border="0" style="cursor: hand">',
      '\t\t\t<div class=disabledLink>',
      '\t\t\t\tMayor',
      '\t\t\t</div>',
      '\t\t</td>',
    ];

  // `:160-210` — two kinds per row, `loop while (j < 2)`.
  const kindRows: string[] = [];
  for (let i = 0; i < kinds.length; i += 2) {
    kindRows.push('\t<tr>');                                            // :162
    for (const k of kinds.slice(i, i + 2)) {
      if (k.enabled === false) {
        kindRows.push(                                                  // :193-199
          '\t\t<td align="center" valign="bottom">',
          `\t\t\t\t<img id="itemImg_${i}" src="${icon(k.id, 'Disabled')}" title="${icon(k.id, '')}" style="filter: alpha(opacity=40)"  border="0"><br>`,
          '\t\t\t\t<div class=disabledLink>',
          `\t\t\t\t\t${k.localisedName ?? k.name}`,
          '\t\t\t\t</div>',
          '\t\t</td>',
        );
      } else {
        kindRows.push(                                                  // :173-187
          '\t\t<td align="center" valign="bottom"',
          '\t\t\tstyle="border-style: solid; border-width: 2px; border-color: black; cursor: hand"',
          '\t\t\tonMouseOver="onMouseOverFrame()"',
          '\t\t\tonMouseOut="onMouseOutFrame()"',
          '\t\t\tonClick="onKindClick()"',
          // :178 — KindName carries CacheClass.Name, NOT the localised one
          `\t\t\tref="FacilityList.asp?Company=Yellow Inc.&WorldName=Shamba&Cluster=${cluster}&Kind=${k.id}&KindName=${k.name}&Folder=${k.folder}&TycoonLevel=${tycoonLevel}"`,
          '\t\t\tnormColor="black"',
          '\t\t\thiColor="#3A5950">',
          `\t\t\t<img title="${k.localisedName ?? k.name}" src="${icon(k.id, '')}" border="0" style="cursor: hand" width=60 height=60>`, // :181
          `\t\t\t<!--<br>${icon(k.id, '')}<br>-->`,                      // :182
          '',
          '\t\t\t<div class=link>',                                     // :184
          `\t\t\t\t${k.localisedName ?? k.name}`,
          '\t\t\t</div>',
          '\t\t</td>',
        );
      }
    }
    kindRows.push('\t</tr>');                                           // :208
  }

  return [
    '<html>',
    '',
    '<script language="JScript" src="../includes/FrameButtons.js">',
    '</script>',
    '',
    '<script for="Document" languaje="JavaScript">',
    '\tfunction onKindClick()',
    '\t{',
    '\t\tvar td = getCell( event.srcElement );',
    '\t\tif (td != null && td.tagName == "TD")',
    '\t\t\twindow.navigate( td.ref );',
    '\t}',
    '</script>',
    '',
    '<head>',
    `\t<title>${cluster}</title>`,                                      // :80
    '\t<link rel="STYLESHEET" href="../voyager.css" type="text/css">',
    '</head>',
    '',
    '<body>',
    '',
    '\t<div style="margin-left: 3px">',
    '\t',
    '\t<table width="90%" cellpadding=2 cellspacing=0>',                // :96
    '\t<tr>',
    '\t',
    ...roadCell,
    '\t',
    ...mayorCell,
    '\t',
    '\t</tr>',                                                          // :153
    ...kindRows,
    // :211-217 — no facilities at all: the page prints the cluster, PATH_INFO
    // and `Error` as bare text where the rows would have been.
    ...(error === undefined ? [] : [
      cluster,
      '/five/0/visual/voyager/Build/KindList.asp',
      error,
    ]),
    '\t</table>',                                                       // :218
    '\t</div>',
    '',
    '',
    '</body>',
    '</html>',
  ].join('\n');
}

// The `ref` this produces matches the captured FacilityList.asp request
// parameter for parameter (observed on the live wire).
const KIND_LIST_HTML = kindListPage({
  cluster: 'PGI',
  tycoonLevel: 0,
  kinds: [
    { id: 'PGIDirectionFacilities', name: 'Headquarters', folder: '00000024.PGIDirectionFacilities.five' },
    { id: 'PGIFarms', name: 'Farms', folder: '00000025.PGIFarms.five' },
  ],
});

describe('fetchBuildingCategories', () => {
  it('sends company, world, empty cluster and the active tycoon', async () => {
    mockFetch.mockResolvedValue(htmlResponse(KIND_LIST_HTML));
    const fake = makeWebCtx({ activeUsername: 'SPO_test3' });

    await fetchBuildingCategories(fake.ctx, 'Yellow Inc.');

    const url = fetchedUrl();
    expect(url).toContain('/five/0/visual/voyager/Build/KindList.asp?');
    expect(url).toContain('Company=Yellow%20Inc.');
    expect(url).toContain('WorldName=Shamba');
    expect(url).toContain('Cluster=&');
    expect(url).toContain('Tycoon=SPO_test3');
    expect(url).not.toContain('+');
  });

  it('falls back to the cached username when no active username is set', async () => {
    mockFetch.mockResolvedValue(htmlResponse(KIND_LIST_HTML));
    const fake = makeWebCtx({ activeUsername: null, cachedUsername: 'CachedGuy' });

    await fetchBuildingCategories(fake.ctx, 'Yellow Inc.');

    expect(fetchedUrl()).toContain('Tycoon=CachedGuy');
  });

  it('reads the kind, cluster, folder and tycoon level out of the ref query string', async () => {
    mockFetch.mockResolvedValue(htmlResponse(KIND_LIST_HTML));
    const fake = makeWebCtx();

    const categories = await fetchBuildingCategories(fake.ctx, 'Yellow Inc.');

    expect(categories).toEqual([
      {
        kindName: 'Headquarters',
        kind: 'PGIDirectionFacilities',
        cluster: 'PGI',
        folder: '00000024.PGIDirectionFacilities.five',
        tycoonLevel: 0,
        iconPath: 'proxy:/Five/Visual/Clusters/PGI/images/FacKind_PGIDirectionFacilities.jpg',
      },
      {
        kindName: 'Farms',
        kind: 'PGIFarms',
        cluster: 'PGI',
        folder: '00000025.PGIFarms.five',
        tycoonLevel: 0,
        iconPath: 'proxy:/Five/Visual/Clusters/PGI/images/FacKind_PGIFarms.jpg',
      },
    ]);
  });

  // The first two cells of the table are not building kinds: `KindList.asp:104`
  // points at `RoadOptions.asp` and `:127` at `MayorOptions.asp`. Only the
  // `FacilityList.asp` requirement in the ref keeps them out.
  it('lists no category for the Roads and Mayor cells, whichever branch they took', async () => {
    for (const [roads, mayor] of [[true, true], [false, false]] as const) {
      mockFetch.mockResolvedValue(htmlResponse(kindListPage({ roads, mayor, kinds: [] })));
      const fake = makeWebCtx();
      expect(await fetchBuildingCategories(fake.ctx, 'Yellow Inc.')).toEqual([]);
    }
  });

  // `:189-199` — a kind the mayor rule of `:170` excludes is rendered with
  // `class=disabledLink` and NO ref, so it is unreachable in Voyager too.
  it('drops a kind the server rendered without a ref', async () => {
    mockFetch.mockResolvedValue(htmlResponse(kindListPage({
      kinds: [
        { id: 'PGIFarms', name: 'Farms', folder: '00000025.PGIFarms.five' },
        { id: 'PGIResidentials', name: 'Residentials', folder: '00000027.PGIResidentials.five', enabled: false },
      ],
    })));
    const fake = makeWebCtx();

    expect((await fetchBuildingCategories(fake.ctx, 'Yellow Inc.')).map(c => c.kind)).toEqual(['PGIFarms']);
  });

  // `KindList.asp:12-19` — the company path failed to open, so `ClusterName` is
  // empty, no facility folder is walked, and `:211-214` prints `Error` as bare
  // text. Without this marker the caller cannot tell it from an empty cluster.
  it('reports the "Couldn\'t open the path" marker instead of an anonymous empty list', async () => {
    mockFetch.mockResolvedValue(htmlResponse(kindListPage({
      cluster: '', kinds: [], error: "Couldn't open the pathCompanies\\Ghost Inc..five\\",
    })));
    const fake = makeWebCtx();

    expect(await fetchBuildingCategories(fake.ctx, 'Ghost Inc.')).toEqual([]);
    expect(fake.log.error).toHaveBeenCalledWith(
      expect.stringContaining('could not open the company path')
    );
  });

  it('skips a row that carries a ref but no label at all', async () => {
    const html = `<td ref="FacilityList.asp?Kind=PGIFarms&Cluster=PGI"><span>&nbsp;</span></td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const categories = await fetchBuildingCategories(fake.ctx, 'Yellow Inc.');

    expect(categories).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('Skipped category'));
  });

  // OBSERVATION (lot 3) — the `ref=(["']?)…\1` construction at
  // building-templates-handler.ts:225 claims to accept an unquoted ref, but
  // `[^"']*` then runs past the closing `>` into the row's markup: the captured
  // "ref" is polluted, the label falls outside the content group, and the row is
  // dropped without an error. The quoted form is the only one that works.
  it('silently drops a row whose ref attribute is not quoted', async () => {
    const html =
      `<td ref=FacilityList.asp?Kind=PGIMines&Cluster=PGI&TycoonLevel=3><div class="link">Mines</div></td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    expect(await fetchBuildingCategories(fake.ctx, 'Yellow Inc.')).toEqual([]);
  });

  it('skips a labelled row whose ref carries no Kind parameter', async () => {
    const html = `<td ref="FacilityList.asp?Cluster=PGI"><div class=link>Orphan</div></td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    expect(await fetchBuildingCategories(fake.ctx, 'Yellow Inc.')).toEqual([]);
  });

  it('skips a labelled row whose ref has no query string at all', async () => {
    const html = `<td ref="FacilityList.asp"><div class=link>Everything</div></td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    expect(await fetchBuildingCategories(fake.ctx, 'Yellow Inc.')).toEqual([]);
  });

  it('accepts a row with no icon, leaving the proxied path empty', async () => {
    const html = `<td ref="FacilityList.asp?Kind=PGIFarms"><div class=link>Farms</div></td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const categories = await fetchBuildingCategories(fake.ctx, 'Yellow Inc.');

    expect(categories[0].iconPath).toBe('proxy:');
    expect(categories[0].tycoonLevel).toBe(0);
  });

  it('returns nothing and logs when the page cannot be fetched', async () => {
    mockFetch.mockRejectedValue(new Error('ETIMEDOUT'));
    const fake = makeWebCtx();

    expect(await fetchBuildingCategories(fake.ctx, 'Yellow Inc.')).toEqual([]);
    expect(fake.log.error).toHaveBeenCalled();
  });

  it('reports a 500 instead of parsing the error page as an empty category list', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<html><body>500 - Internal server error</body></html>', 500));
    const fake = makeWebCtx();

    expect(await fetchBuildingCategories(fake.ctx, 'Yellow Inc.')).toEqual([]);
    expect(fake.log.error).toHaveBeenCalledWith(
      expect.stringContaining('KindList.asp for Yellow Inc. answered HTTP 500')
    );
  });

  it('refuses to fetch without a world info', async () => {
    const fake = makeSessionCtx({ cachedUsername: 'SPO_test3' });

    await expect(fetchBuildingCategories(fake.ctx, 'Yellow Inc.')).rejects.toThrow(
      'Not logged into world - cannot fetch building categories'
    );
  });

  it('refuses to fetch without a cached username', async () => {
    const fake = makeSessionCtx({ currentWorldInfo: WORLD, cachedUsername: null });

    await expect(fetchBuildingCategories(fake.ctx, 'Yellow Inc.')).rejects.toThrow(
      'Not logged into world - cannot fetch building categories'
    );
  });
});

// ---------------------------------------------------------------------------
// fetchBuildingFacilities — Build/FacilityList.asp
// ---------------------------------------------------------------------------

/**
 * THE ONE CAPTURED PAGE OF THIS HANDLER — verbatim body of the live response of
 * 2026-02-18, byte for byte including its mixed tabs and spaces and its blank
 * conditional lines. A capture outranks the ASP source, so this is the
 * reference; the ASP is used below only for the branches the capture does not
 * exercise (it holds one facility, and an AVAILABLE one).
 *
 * Two things it establishes that the source alone could not: `CacheClass.ImportPrice`
 * renders `$8,000K` and `CacheClass.Size` renders `3600 m.` — both were
 * `[INFERRED]` formats until this capture.
 *
 * Structure that matters: `LinkText_0` holds the name and the `available` flag;
 * `Cell_0`'s FIRST inner <tr> holds icon, price and zone; the `info` attribute
 * with FacilityClass + VisualClassId sits in the SECOND inner <tr>, past
 * the `</tr>` where the non-greedy cellRegex stops — which is why the
 * parser pre-scans, and why the description is read from the cell window too.
 * The `document.all["Cell_" + i]` of the head script is kept in: it must not be
 * mistaken for a cell anchor.
 */
const CAPTURED_FACILITY_LIST_HTML = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">
<html>

<script for="Document" languaje="JavaScript">

  function ShowCell( CellIdx )
    {
      if (CellCount > 0)
        {
      	  if (Selection != CellIdx)
            {
          	  Selection = CellIdx;
      	  	  var i;
              for (i = 0; i < CellCount; i++)
                if (i == CellIdx)
                  {
                    document.all["Cell_" + i].style.display = "inline";
                    document.all["LinkFrame_" + i].background = "images/sel-itemgradient.jpg";
					if (document.all["LinkText_" + event.srcElement.altid].available == "1")
          				document.all["LinkText_" + event.srcElement.altid].style.color = 0xFFF8DC;
                  }
                else
                  {
                    document.all["Cell_" + i].style.display = "none";
                    document.all["LinkFrame_" + i].background = "images/itemgradient.jpg";
                  }
            }
        }
    }

</script>

<head>
	<title>Facility List</title>
	<link rel="STYLESHEET" href="../voyager.css" type="text/css">
</head>




<body>

<!--<img src="/Five/Visual/Clusters/PGI/images/FacKind_PGIDirectionFacilitiesDisabled.jpg" width="60" height="60" style="position: absolute; z-index: -10">-->
<table cellspacing="7" width="100%">
<tr><td>
	<div class=header2 style="color: #FF9900">
		Headquarters
	</div>
</td></tr>
<tr><td>

<table cellspacing="0" cellpadding="0" border="0" width="100%">

    <tr>
      <td width="100%" id="LinkFrame_0" background="images/itemgradient.jpg" onMouseOver="doItemMouseOver()" onMouseOut="doItemMouseOut()" onClick="doItemMouseClick()" altid="0">
        <div id="LinkText_0" class=listItem available="1" style="margin-left: 5px" altid="0">
        Company Headquarters
        </div>
      </td>
    </tr>
    <tr id="Cell_0" style="display:none">
      <td width="100%" background="images/vertgradient.jpg">
      <table cellpadding="3" cellspacing="0" width="100%">
      <tr>
      <td align="center" valign="middle" width="64">
		<img src=/five/icons/MapPGIHQ1.gif border="0"

			title=""

		width="120" height="80"
		>
      </td>
      <td align="left" valign="middle">
      	<!--/five/icons/MapPGIHQ1.gif-->

      	<div class=comment style="font-size: 9px; font-name: Arial; font-weight: normal">
			$8,000K<br>
			<nobr>3600 m.</nobr>
		</div>

		<img src="images/zone-commerce.gif" style="filter: alpha(opacity=100)" title="Building must be located in blue zone or no zone at all.">

      </td>
      </tr>
      <tr>
      	<td colspan="2">


        <div id=infoBlock_0 class="description" style="font-size: 10px; padding-left: 0px; display: none; color: #749990">

		</div>
		<table style="text-align: center">
			<tr>
				<td>
					<table>
						<tr>

							<td class=button align="center" width="100"
								onMouseOver="onMouseOverFrame()"
								onMouseOut="onMouseOutFrame()"
								onMouseUp="onMouseUp()"
								onMouseDown="onMouseDown()"
								onClick="onBtnClick()"
								info="http://local.asp?frame_Id=MapIsoView&frame_Action=Build&FacilityClass=PGIGeneralHeadquarterSTA&VisualClassId=602"
								command="build"
								normColor="#345950"
								hiColor="white">

								Build now
							</td>

						</tr>
					</table>
				</td>
				<td>
					<table>
						<tr>
							<td id=infoBtn_0 class=button align="center" width="100"
								onMouseOver="onMouseOverFrame()"
								onMouseOut="onMouseOutFrame()"
								onMouseUp="onMouseUp()"
								onMouseDown="onMouseDown()"
								onClick="onBtnClick()"
								infoBlock="infoBlock_0"
								infoBtnLabel="infoBtnLabel_0"
								command="moreinfo"
								normColor="#345950"
								hiColor="white">

								<div id=infoBtnLabel_0 >
									More info
								</div>
							</td>
						</tr>
					</table>
				</td>
		</table>
      </td>
      </tr>
      </table>
      </td>
    </tr>


</td></tr>
</table>
</table>

</body>

<script for="Document" languaje="JavaScript">
  var CellCount = 1;
</script>

</html>`;

/**
 * `Build/FacilityList.asp:217-345`, for the branches the capture cannot show.
 *
 * The decisive one is `available: false`: `:300-314` puts the entire "Build now"
 * cell — hence the ONLY `info=`, hence the only `CacheClass.Id` and
 * `TypicalVisualClass` on the page — under `if Available`. `:242-244` adds the
 * red `strNotAvailable` block and `:287-291` a SECOND `class="description"` div
 * carrying `CacheClass.Requires`, ahead of the real one at `:292`.
 *
 * Whitespace follows the capture, which is this same template rendered.
 */
function buildFacilityListPage(
  facilities: Array<{
    name: string; icon: string; available: boolean;
    facilityClass?: string; visualClassId?: string;
    price?: string; size?: string; zoneImg?: string; zoneTitle?: string;
    desc?: string; requires?: string;
  }>
): string {
  const cells = facilities.map((f, i) => [
    '    <tr>',                                                         // :217
    `      <td width="100%" id="LinkFrame_${i}" background="images/itemgradient.jpg" onMouseOver="doItemMouseOver()" onMouseOut="doItemMouseOut()" onClick="doItemMouseClick()" altid="${i}">`,
    // :219 — `class=<listItem|disabledItem> available="<1|0>"`, unquoted class
    `        <div id="LinkText_${i}" class=${f.available ? 'listItem available="1"' : 'disabledItem available="0"'} style="margin-left: 5px" altid="${i}">`,
    `        ${f.name}`,
    '        </div>',
    '      </td>',
    '    </tr>',
    `    <tr id="Cell_${i}" style="display:none">`,                     // :224
    '      <td width="100%" background="images/vertgradient.jpg">',
    '      <table cellpadding="3" cellspacing="0" width="100%">',
    '      <tr>',
    '      <td align="center" valign="middle" width="64">',
    `\t\t<img src=${f.icon} border="0"`,                                // :229 — src unquoted
    '\t\t',
    ...(f.available                                                     // :230-235
      ? [`\t\t\ttitle="${f.desc ?? ''}"`]
      : ['\t\t\tstyle="filter: gray() alpha(opacity=70)"', `\t\t\ttitle="${f.requires ?? ''}"`]),
    '\t\t',
    '\t\twidth="120" height="80"',
    '\t\t>',
    '      </td>',
    '      <td align="left" valign="middle">',
    `      \t<!--${f.icon}-->`,                                         // :240
    '\t',
    ...(f.available ? [] : [                                            // :241-245
      '\t\t<div style="color: red; font-size: 8px; font-name: Arial; font-weight: bold">',
      '\t\tNOT AVAILABLE',                                              // Voyager.lng:9
      '\t\t</div>',
    ]),
    '      \t<div class=comment style="font-size: 9px; font-name: Arial; font-weight: normal">',  // :246
    `\t\t\t${f.price ?? ''}<br>`,                                       // :247
    `\t\t\t<nobr>${f.size ?? ''}</nobr>`,                               // :248
    '\t\t</div>',
    '\t\t',
    ...(f.zoneImg
      ? [`\t\t<img src="images/${f.zoneImg}" style="filter: alpha(opacity=100)" title="${f.zoneTitle}.">`]
      : []),
    '\t\t',
    '      </td>',
    '      </tr>',                                                      // :283 — cellRegex stops HERE
    '      <tr>',
    '      \t<td colspan="2">',
    '',
    '\t\t',
    ...(f.available ? [] : [                                            // :287-291
      '\t\t<div class="description" style="font-size: 10px; padding-left: 0px; color: #749990">',
      `\t\t\t${f.requires ?? ''}`,
      '\t\t</div>',
    ]),
    `        <div id=infoBlock_${i} class="description" style="font-size: 10px; padding-left: 0px; display: none; color: #749990">`,  // :292
    `\t\t\t${f.desc ?? ''}`,
    '\t\t</div>',
    '\t\t<table style="text-align: center">',
    '\t\t\t<tr>',
    '\t\t\t\t<td>',
    '\t\t\t\t\t<table>',
    '\t\t\t\t\t\t<tr>',
    '\t\t\t\t\t\t\t',
    ...(f.available ? [                                                 // :300-314
      '\t\t\t\t\t\t\t<td class=button align="center" width="100"',
      '\t\t\t\t\t\t\t\tonClick="onBtnClick()"',
      `\t\t\t\t\t\t\t\tinfo="http://local.asp?frame_Id=MapIsoView&frame_Action=Build&FacilityClass=${f.facilityClass}&VisualClassId=${f.visualClassId}"`,
      '\t\t\t\t\t\t\t\tcommand="build"',
      '\t\t\t\t\t\t\t\tnormColor="#345950"',
      '\t\t\t\t\t\t\t\thiColor="white">',
      '',
      '\t\t\t\t\t\t\t\tBuild now',
      '\t\t\t\t\t\t\t</td>',
    ] : []),
    '\t\t\t\t\t\t\t',
    '\t\t\t\t\t\t</tr>',
    '\t\t\t\t\t</table>',
    '\t\t\t\t</td>',
    '\t\t\t\t<td>',
    '\t\t\t\t\t<table>',
    '\t\t\t\t\t\t<tr>',
    `\t\t\t\t\t\t\t<td id=infoBtn_${i} class=button align="center" width="100"`,  // :321
    `\t\t\t\t\t\t\t\tinfoBlock="infoBlock_${i}"`,
    `\t\t\t\t\t\t\t\tinfoBtnLabel="infoBtnLabel_${i}"`,
    '\t\t\t\t\t\t\t\tcommand="moreinfo"',
    '\t\t\t\t\t\t\t\tnormColor="#345950"',
    '\t\t\t\t\t\t\t\thiColor="white">',
    '',
    `\t\t\t\t\t\t\t\t<div id=infoBtnLabel_${i} >`,
    '\t\t\t\t\t\t\t\t\tMore info',
    '\t\t\t\t\t\t\t\t</div>',
    '\t\t\t\t\t\t\t</td>',
    '\t\t\t\t\t\t</tr>',
    '\t\t\t\t\t</table>',
    '\t\t\t\t</td>',
    '\t\t</table>',
    '      </td>',
    '      </tr>',
    '      </table>',
    '      </td>',
    '    </tr>',                                                        // :345
    '',
  ].join('\n')).join('\n');

  return [
    '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">',
    '<html>',
    '<head>',
    '\t<title>Facility List</title>',
    '</head>',
    '<body>',
    '<table cellspacing="7" width="100%">',
    '<tr><td>',
    '',
    '<table cellspacing="0" cellpadding="0" border="0" width="100%">',
    '',
    cells,
    '</td></tr>',
    '</table>',
    '</table>',
    '</body>',
    '',
    '<script for="Document" languaje="JavaScript">',
    `  var CellCount = ${facilities.length};`,
    '</script>',
    '',
    '</html>',
  ].join('\n');
}

describe('fetchBuildingFacilities', () => {
  it('sends the seven parameters the captured request carries', async () => {
    mockFetch.mockResolvedValue(htmlResponse(CAPTURED_FACILITY_LIST_HTML));
    const fake = makeWebCtx();

    await fetchBuildingFacilities(
      fake.ctx, 'Yellow Inc.', 'PGI', 'PGIDirectionFacilities', 'Headquarters',
      '00000024.PGIDirectionFacilities.five', 0,
    );

    // Captured verbatim on the live wire.
    expect(fetchedUrl()).toBe(
      'http://158.69.153.134/five/0/visual/voyager/Build/FacilityList.asp?' +
      'Company=Yellow%20Inc.&WorldName=Shamba&Cluster=PGI&Kind=PGIDirectionFacilities' +
      '&KindName=Headquarters&Folder=00000024.PGIDirectionFacilities.five&TycoonLevel=0'
    );
  });

  it('parses the captured Headquarters page into one facility', async () => {
    mockFetch.mockResolvedValue(htmlResponse(CAPTURED_FACILITY_LIST_HTML));
    const fake = makeWebCtx();

    const facilities = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    expect(facilities).toEqual([{
      name: 'Company Headquarters',
      // The class handed to NewFacility comes from the info attribute, NOT the
      // icon filename: the icon says "PGIHQ1", the kernel class is this one.
      facilityClass: 'PGIGeneralHeadquarterSTA',
      visualClassId: '602',
      cost: 8000000,
      // `$8,000K` and `3600 m.` — two formats that were only `[INFERRED]` until
      // this capture established them.
      area: 3600,
      // `infoBlock_0` really is empty in the capture: this facility
      // has no Desc, so an empty description is the truth here, not a miss.
      description: '',
      zoneRequirement: 'Building must be located in blue zone or no zone at all.',
      iconPath: 'proxy:/five/icons/MapPGIHQ1.gif',
      available: true,
    }]);
    // A commerce zone carries no residential signal — no residenceClass key.
    expect(facilities[0]).not.toHaveProperty('residenceClass');
  });

  // B-19, with its mechanism corrected. The description was NOT "the
  // prerequisites instead of the description": it was ALWAYS EMPTY. Both
  // description divs (`FacilityList.asp:288` and `:292`) sit past the inner
  // `</tr>` of `:283` where the non-greedy cellRegex stops, so the field could
  // never be filled from `cellContent`. It is read from the cell window now,
  // anchored on `infoBlock_<i>`.
  it('reads the description out of infoBlock_N, past the inner </tr> the cell regex stops at', async () => {
    const html = buildFacilityListPage([{
      name: 'Company Headquarters', icon: '/five/icons/MapPGIHQ1.gif', available: true,
      facilityClass: 'PGIGeneralHeadquarterSTA', visualClassId: '602',
      price: '$8,000K', size: '3600 m.',
      zoneImg: 'zone-commerce.gif', zoneTitle: 'Building must be located in blue zone or no zone at all',
      desc: 'The nerve center of your business empire.',
    }]);
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const [facility] = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    expect(facility.description).toBe('The nerve center of your business empire.');
  });

  // B-15 + B-19 on the branch the capture cannot show. `:287-291` inserts a
  // SECOND `class="description"` div holding `CacheClass.Requires` BEFORE the
  // real one, and `:300-314` withholds the whole `info=` — so the kernel class
  // and the visual class simply do not exist on the page for a locked facility.
  it('for an unavailable facility: prerequisites are not the description, and the class is not invented from the info attribute', async () => {
    const html = buildFacilityListPage([{
      name: 'Ore Mine', icon: '/five/icons/MapPGIOreMineB.gif', available: false,
      price: '$2,500K', size: '1200 m.',
      zoneImg: 'zone-industry.gif', zoneTitle: 'Building must be located in yellow zone or no zone at all',
      desc: 'Digs ore out of the ground.', requires: 'Requires tycoon level 3',
    }]);
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const [facility] = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    expect(facility.available).toBe(false);
    expect(facility.description).toBe('Digs ore out of the ground.');
    expect(facility.description).not.toContain('Requires');
    expect(facility.cost).toBe(2500000);
    expect(facility.area).toBe(1200);
    // No `info=` on the page → no VisualClassId at all, and the class is only
    // the visual asset name, logged as such. It never reaches NewFacility: the
    // client cannot click a card whose `available` is false.
    expect(facility.visualClassId).toBe('');
    expect(facility.facilityClass).toBe('PGIOreMineB');
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('visual asset name, not the kernel class')
    );
  });

  it('strips the WxHxL suffix an icon filename may carry', async () => {
    const html = buildFacilityListPage([
      { name: 'Ore Mine', icon: '/five/icons/MapPGIOreMineB64x32x0.gif', available: false, price: '$140K' },
    ]);
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const [facility] = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    expect(facility.facilityClass).toBe('PGIOreMineB');
    expect(facility.cost).toBe(140000);
  });

  // The dangerous half of B-15: an AVAILABLE facility always carries its
  // `info=` (`:300-307`). If it does not, the page is not the page — and
  // guessing a class from the icon would put a fabricated class on a card the
  // player CAN click, i.e. hand `NewFacility` the wrong building. Dropped, loudly.
  it('drops an available facility whose info attribute is missing rather than guessing its class from the icon', async () => {
    const html = `
      <div id="LinkText_0" class=listItem available="1">Ghost Tower</div>
      <tr id="Cell_0"><td><img src="/five/icons/MapPGITowerA.gif"></td></tr>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    expect(await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0)).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('Skipped facility'));
    expect(fake.log.warn).not.toHaveBeenCalledWith(expect.stringContaining('icon fallback'));
  });

  it('finds the VisualClassId inside the cell when the page carries it there', async () => {
    const html = `
      <div id="LinkText_0" available="0">Ore Mine</div>
      <tr id="Cell_0"><td>
        <img src="/five/icons/MapPGIOreMineB.gif">
        VisualClassId:4711
      </td></tr>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const [facility] = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    expect(facility.visualClassId).toBe('4711');
  });

  it('skips a cell whose icon filename does not follow the Map<Class>.gif convention', async () => {
    const html = `
      <div id="LinkText_0" available="0">Odd Icon</div>
      <tr id="Cell_0"><td><img src="/five/icons/placeholder.png"></td></tr>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    expect(await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0)).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('Skipped facility'));
  });

  it('accepts the reversed VisualClassId/FacilityClass order in the info attribute', async () => {
    const html = `
      <div id="LinkText_0" available="1">Reversed</div>
      <tr id="Cell_0"><td><img src="/five/icons/MapX.gif"></td></tr>
      <td info="?VisualClassId=888&FacilityClass=PGIReversedSTA" command="build">Build now</td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const [facility] = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    expect(facility.facilityClass).toBe('PGIReversedSTA');
    expect(facility.visualClassId).toBe('888');
  });

  it('keeps the first pairing when a class appears in both attribute orders', async () => {
    const html = `
      <div id="LinkText_0" available="1">Dup</div>
      <tr id="Cell_0"><td><img src="/five/icons/MapX.gif"></td></tr>
      <td info="?FacilityClass=PGIDupSTA&VisualClassId=10"></td>
      <td info="?VisualClassId=20&FacilityClass=PGIDupSTA"></td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const [facility] = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    // Standard order wins; the reversed pass must not overwrite it.
    expect(facility.visualClassId).toBe('10');
  });

  it('finds a VisualClassId that the pre-scan could not pair, by scanning the cell window', async () => {
    // FacilityClass and VisualClassId live in two SEPARATE quoted attributes, so
    // the pre-scan regexes (which cannot cross a quote) both miss the pair.
    const html = `
      <div id="LinkText_0" available="1">Split Attrs</div>
      <tr id="Cell_0"><td><img src="/five/icons/MapX.gif"></td></tr>
      <td build="?FacilityClass=PGISplitSTA" visual="?VisualClassId=1234"></td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const [facility] = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    expect(facility.facilityClass).toBe('PGISplitSTA');
    expect(facility.visualClassId).toBe('1234');
  });

  it('warns and leaves the dimensions unavailable when no VisualClassId exists', async () => {
    const html = `
      <div id="LinkText_0" available="1">No Visual</div>
      <tr id="Cell_0"><td><img src="/five/icons/MapX.gif"></td></tr>
      <td build="?FacilityClass=PGINoVisualSTA"></td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const [facility] = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    expect(facility.visualClassId).toBe('');
    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('No VisualClassId found'));
  });

  it('scopes the VisualClassId search to the cell so neighbours do not bleed in', async () => {
    // Two cells; the second carries the only VisualClassId. Cell_0 must not
    // steal it, and the window for Cell_1 must run to the end of the document.
    const html = `
      <div id="LinkText_0" available="1">First</div>
      <tr id="Cell_0"><td><img src="/five/icons/MapA.gif"></td></tr>
      <td build="?FacilityClass=PGIFirstSTA"></td>
      <div id="LinkText_1" available="1">Second</div>
      <tr id="Cell_1"><td><img src="/five/icons/MapB.gif"></td></tr>
      <td build="?FacilityClass=PGISecondSTA" visual="?VisualClassId=555"></td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const facilities = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    expect(facilities.map(f => [f.facilityClass, f.visualClassId])).toEqual([
      ['PGIFirstSTA', ''],
      ['PGISecondSTA', '555'],
    ]);
  });

  it('skips a detail cell whose LinkText row is missing', async () => {
    const html = `<tr id="Cell_7"><td><img src="/five/icons/MapX.gif"></td></tr>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    expect(await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0)).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No LinkText found for Cell_7')
    );
  });

  it('skips a named cell that yields no facility class', async () => {
    const html = `
      <div id="LinkText_0" available="1">Nameless Class</div>
      <tr id="Cell_0"><td><span>no image, no info</span></td></tr>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    expect(await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0)).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('Skipped facility'));
  });

  // `ImportPrice` and `Size` are COM properties rendered raw (`:247-248`); the
  // capture pins the usual shapes but the cell can hold neither.
  it('leaves cost and area at zero when the cell shows neither', async () => {
    const html = `
      <div id="LinkText_0" available="1">Priceless</div>
      <tr id="Cell_0"><td><img src="/five/icons/MapPGIFreeA.gif"></td></tr>
      <td info="?FacilityClass=PGIFreeA&VisualClassId=1" command="build"></td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const [facility] = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    expect(facility.cost).toBe(0);
    expect(facility.area).toBe(0);
    expect(facility.description).toBe('');
  });

  it('scales a cost given in millions', async () => {
    const html = `
      <div id="LinkText_0" available="1">Refinery</div>
      <tr id="Cell_0"><td>
        <img src="/five/icons/MapPGIRefineryA.gif">
        <div class=comment>$2.5M</div>
      </td></tr>
      <td info="?FacilityClass=PGIRefineryA&VisualClassId=7" command="build"></td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const [facility] = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    expect(facility.cost).toBe(2500000);
  });

  it('reads a bare cost with no K or M multiplier', async () => {
    const html = `
      <div id="LinkText_0" available="1">Cheap</div>
      <tr id="Cell_0"><td>
        <img src="/five/icons/MapPGIShedA.gif">
        <div class=comment>$750</div>
      </td></tr>
      <td info="?FacilityClass=PGIShedA&VisualClassId=2" command="build"></td>`;
    mockFetch.mockResolvedValue(htmlResponse(html));
    const fake = makeWebCtx();

    const [facility] = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);

    expect(facility.cost).toBe(750);
  });

  describe('residential classification', () => {
    async function classOf(zoneImg: string): Promise<string | undefined> {
      // Available, so it carries its `info=` — a residential the player can
      // build is the case that matters for the zone overlay.
      const html = `
        <div id="LinkText_0" class=listItem available="1">Housing</div>
        <tr id="Cell_0"><td>
          <img src="/five/icons/MapPGIHouseA.gif">
          ${zoneImg}
        </td></tr>
        <td info="?FacilityClass=PGIHouseA&VisualClassId=3" command="build"></td>`;
      mockFetch.mockResolvedValue(htmlResponse(html));
      const fake = makeWebCtx();
      const [facility] = await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0);
      return facility.residenceClass;
    }

    it('derives "high" from the zone-hires image name (src before title)', async () => {
      expect(await classOf('<img src="images/zone-hires.gif" title="High class zone">')).toBe('high');
    });

    it('derives "low" from a title that precedes the src', async () => {
      // Both attribute orders occur in the wild — the parser tries src-first,
      // then title-first (building-templates-handler.ts:460-465).
      expect(
        await classOf('<img title="Must be in a dark green zone" src="images/zone-lores.gif">')
      ).toBe('low');
    });

    it('derives "middle" from the title when the src filename carries no signal', async () => {
      // The src must contain "zone" for the regex to bind at all; the wording
      // "mid res" / "middle res" is then what decides (session-utils.ts:79).
      expect(
        await classOf('<img src="images/zone-plot.gif" title="Middle res area">')
      ).toBe('middle');
    });

    it('leaves the class undefined when neither src nor title names a class', async () => {
      expect(
        await classOf('<img src="images/zone-commerce.gif" title="Commerce zone only">')
      ).toBeUndefined();
    });

    it('leaves the class undefined when the cell carries no zone image', async () => {
      expect(await classOf('')).toBeUndefined();
    });
  });

  it('returns nothing and logs when the page cannot be fetched', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));
    const fake = makeWebCtx();

    expect(await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0)).toEqual([]);
    expect(fake.log.error).toHaveBeenCalled();
  });

  it('reports a 500 instead of parsing the error page as an empty facility list', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<html><body>500 - Internal server error</body></html>', 500));
    const fake = makeWebCtx();

    expect(await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'PGIFarms', 'KN', 'F', 0)).toEqual([]);
    expect(fake.log.error).toHaveBeenCalledWith(
      expect.stringContaining('FacilityList.asp for PGIFarms answered HTTP 500')
    );
  });

  it('handles an HTML document truncated in the middle of a tag', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<div id="LinkText_0" available="1">Cut<tr id="Cell_0"><td><img src'));
    const fake = makeWebCtx();

    expect(await fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0)).toEqual([]);
  });

  it('refuses to fetch without a world info', async () => {
    const fake = makeSessionCtx();

    await expect(
      fetchBuildingFacilities(fake.ctx, 'C', 'PGI', 'K', 'KN', 'F', 0)
    ).rejects.toThrow('Not logged into world - cannot fetch facilities');
  });
});
