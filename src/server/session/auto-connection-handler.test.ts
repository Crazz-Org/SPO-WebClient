/**
 * auto-connection-handler — three ASP scrapes, no RDO at all:
 *   TycoonAutoConnections.asp (parse + action URL cache), TycoonPolicy.asp
 *   (parse + form action cache), and the action pages behind them
 *   (DeleteDefaultSupplier, ModifyTradeCenter/WarehouseStatus, the
 *   TycoonPolicy POST, the four curriculum actions).
 *
 * The two page fetches go through `ctx.fetchAspPage`; the actions call the
 * `node-fetch` default export directly, hence the module mock at the top.
 * `extractAllActionUrls` runs for real.
 *
 * ── Fixtures ──────────────────────────────────────────────────────────────
 * Instantiated from the ASP source (`IIS_ROOT/Five/0/Visual/Voyager/…`),
 * language strings resolved from `Five/0/language/eNewTycon.lng`. The lot-4
 * fixtures were written from our parsers instead, which is why they showed
 * green while `AddDefaultSupplier.asp` had never existed and `abandonRole.asp`
 * had never abandoned anything.
 *
 * Two details of the source are reproduced on purpose and must not be
 * "cleaned up": `getBaseURL()` yields a DOUBLE slash after the port
 * (`:169-176` — `PATH_INFO` already starts with `/`), and the action pages
 * answer plain text with no HTTP status of any kind.
 *
 * Branches these fixtures reach for the first time: `Storable=false` (no
 * warehouse checkbox at all), `AlliesPage=false` (the Ally option rendered
 * inside an HTML comment), and the bind / connection / security failures of
 * the four text pages.
 */

jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import {
  fetchAutoConnections,
  executeAutoConnectionAction,
  fetchPolicy,
  setPolicyStatus,
  executeCurriculumAction,
} from './auto-connection-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx, AspActionUrl } from '../__tests__/session/fake-session-context';
import type { SessionContext } from './session-context';
import type { WorldInfo } from '../../shared/types';
import { DEFAULT_LANGUAGE_ID, withLangId } from '../../shared/language';

const mockFetch = fetch as unknown as jest.MockedFunction<
  (url: string, init?: unknown) => Promise<Response>
>;

function htmlResponse(body: string, status = 200): Response {
  return { status, ok: status === 200, text: async () => body } as unknown as Response;
}

const WORLD: WorldInfo = { name: 'Shamba', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 7000 };
const IS_BASE = 'http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/';
const AUTOCONN = 'NewTycoon/TycoonAutoConnections.asp';
const POLICY = 'NewTycoon/TycoonPolicy.asp';
const CURRICULUM = 'NewTycoon/TycoonCurriculum.asp';
/** What getBaseURL() really returns — TycoonAutoConnections.asp:169-176. */
const SCRIPT_BASE = 'http://158.69.153.134:80//Five/0/Visual/Voyager/NewTycoon/';

const T = (n: number) => '\t'.repeat(n);

type FetchAsp = jest.MockedFunction<SessionContext['fetchAspPage']>;
type SetCache = jest.MockedFunction<SessionContext['setAspActionCache']>;
type GetCache = jest.MockedFunction<SessionContext['getAspActionCache']>;

function fetchAsp(fake: FakeSessionCtx): FetchAsp { return fake.ctx.fetchAspPage as FetchAsp; }
function setCache(fake: FakeSessionCtx): SetCache { return fake.ctx.setAspActionCache as SetCache; }
function getCache(fake: FakeSessionCtx): GetCache { return fake.ctx.getAspActionCache as GetCache; }

function makeWebCtx(overrides: Partial<SessionContext> = {}): FakeSessionCtx {
  const fake = makeSessionCtx({
    currentWorldInfo: WORLD, activeUsername: 'SPO_test3', cachedPassword: 'test3',
    daAddr: '10.0.0.5', daPort: 1111, ...overrides,
  });
  // The fake's buildAspUrl is `asp:<path>` — not an http URL, so the extractor
  // would resolve nothing. Give it a real-looking base for these tests.
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
// FIXTURES — TycoonAutoConnections.asp
// ═══════════════════════════════════════════════════════════════════════════

interface Supplier { facilityId: string; facilityName: string; companyName: string }
interface Fluid {
  /** `Obj.Properties("AutoConnection" & i)` — the internal id (:81, :89) */
  id: string;
  /** `Obj.Properties("AutoConnection<Fluid>Name<LangId>")` — localised (:90) */
  name: string;
  suppliers?: Supplier[];
  hireTradeCenter?: boolean;
  /** `…Storable` — false removes the warehouse checkbox entirely (:103) */
  storable?: boolean;
  onlyWarehouses?: boolean;
}

/** :44-55 — one supplier row. */
function supplierRow(fluidId: string, i: number, s: Supplier): string {
  return `${T(3)}<tr id=${fluidId}${i} fluid=${fluidId} onClick="onRowClick()" facilityId="${s.facilityId}">\n`
    + `${T(4)}<td id=${fluidId}${i}Facility style="cursor: hand; background-color: #345950">\n`
    + `${T(5)}<div class=value>\n${T(6)}${s.facilityName}\n${T(5)}</div>\n${T(4)}</td>\n`
    + `${T(4)}<td id=${fluidId}${i}Company style="cursor: hand; background-color: #345950">\n`
    + `${T(5)}<div class=value>\n${T(6)}${s.companyName}\n${T(5)}</div>\n${T(4)}</td>\n`
    + `${T(3)}</tr>`;
}

/** :83-146 — one fluid block. */
function fluidBlock(f: Fluid): string {
  const suppliers = f.suppliers ?? [];
  const rows = suppliers.length > 0
    ? suppliers.map((s, i) => supplierRow(f.id, i, s)).join('\n')
    // :60-66 — the "no supplier" row carries no `fluid=` attribute at all
    : `${T(3)}<tr>\n${T(4)}<td align="center" valign="center" colspan="2" style="cursor: hand; background-color: #345950">\n`
      + `${T(5)}<div class=facilityName style="margin: 20px; color: white; font-weight: normal; color: black">\n`
      + `${T(6)}You have not registered any suppliers for&nbsp;${f.id}.<br> Click on <b>Add</b> to add some.\n`
      + `${T(5)}</div>\n${T(4)}</td>\n${T(3)}</tr>`;

  return `${T(3)}<tr>\n${T(4)}<td height=12>\n${T(4)}</td>\n${T(3)}</tr>\n`
    + `${T(3)}<tr>\n${T(4)}<td colspan=2 style="background-color: #244940">\n`
    + `${T(5)}<div id="${f.id}" class=header3 style="color: #EEEECC">\n${T(6)}${f.name}\n${T(5)}</div>\n`
    + `${T(4)}</td>\n${T(3)}</tr>\n`
    + rows + '\n'
    + `${T(3)}<tr>\n${T(4)}<td colspan=2 style="paddin-top: 2px; background-color: #143930">\n`
    + `${T(5)}<input id=${f.id}HireTC type="checkbox" onClick="onHireTradeCenterClick()" fluidId="${f.id}" ${f.hireTradeCenter ? ' checked ' : ''} >\n`
    + `${T(5)}<span style="font: 9px Tahoma, Verdana, Arial; font-size: 10px; font-weight: bold; color: #EEEECC">\n${T(6)}Also hire a Trade Center\n${T(5)}</span>\n`
    + (f.storable
      ? `${T(5)}<input id=${f.id}HireWH type="checkbox" onClick="onHireOnlyWarehousesClick()" fluidId="${f.id}" ${f.onlyWarehouses ? ' checked ' : ''} >\n`
        + `${T(5)}<span style="font: 9px Tahoma, Verdana, Arial; font-size: 10px; font-weight: bold; color: #EEEECC">\n${T(6)}Auto-include only warehouses\n${T(5)}</span><br>\n`
      : '')
    + `${T(5)}<div style="text-align: right">\n${T(5)}</div>\n${T(4)}</td>\n${T(3)}</tr>`;
}

/** TycoonAutoConnections.asp rendered for Five/0. */
function autoConnectionsPage(fluids: Fluid[], opts: { objValid?: boolean } = {}): string {
  // :165-305 — the <head> script, with the three `var URL` the cache feeds on.
  const head = `<head>
${T(1)}<script>

${T(2)}function getBaseURL()
${T(2)}{
${T(3)}return \t(
${T(3)}\t"http://" +
${T(3)}\t"158.69.153.134:80" + "/" +
${T(3)}\t"/Five/0/Visual/Voyager/NewTycoon/"
${T(3)}\t)
${T(2)}}

${T(2)}function onBtnClick()
${T(2)}{
${T(3)}var td = getCell( event.srcElement );
${T(3)}if (td != null && td.tagName == "TD")
${T(4)}switch (td.command)
${T(4)}{
${T(5)}case "delete" :
${T(6)}if (selectedRow != null)
${T(6)}{
${T(7)}var URL = getBaseURL() +
${T(8)}"DeleteDefaultSupplier.asp" +
${T(8)}"?TycoonId=4666201923" +
${T(8)}"&FluidId=" + td.fluidName +
${T(8)}"&DAAddr=10.0.0.5" +
${T(8)}"&DAPort=1111" +
${T(8)}"&Supplier=" + selectedRow.facilityId;
${T(7)}hiddenFrame.navigate( URL );
${T(6)}}
${T(6)}break;
${T(4)}}
${T(2)}}

${T(2)}function onHireTradeCenterClick()
${T(2)}{
${T(3)}var URL = getBaseURL() +
${T(4)}"ModifyTradeCenterStatus.asp" +
${T(4)}"?TycoonId=4666201923" +
${T(4)}"&FluidId=" + event.srcElement.fluidId +
${T(4)}"&DAAddr=10.0.0.5" +
${T(4)}"&WorldName=Shamba" +
${T(4)}"&Tycoon=SPO_test3" +
${T(4)}"&Password=test3" +
${T(4)}"&DAPort=1111";
${T(3)}if (event.srcElement.checked)
${T(4)}URL = URL + "&Hire=YES"
${T(3)}else
${T(4)}URL = URL + "&Hire=NO"
${T(3)}hiddenFrame.navigate( URL );
${T(2)}}

${T(2)}function onHireOnlyWarehousesClick()
${T(2)}{
${T(3)}var URL = getBaseURL() +
${T(4)}"ModifyWarehouseStatus.asp" +
${T(4)}"?TycoonId=4666201923" +
${T(4)}"&FluidId=" + event.srcElement.fluidId +
${T(4)}"&DAAddr=10.0.0.5" +
${T(4)}"&WorldName=Shamba" +
${T(4)}"&Tycoon=SPO_test3" +
${T(4)}"&Password=test3" +
${T(4)}"&DAPort=1111";
${T(3)}if (event.srcElement.checked)
${T(4)}URL = URL + "&Hire=YES"
${T(3)}else
${T(4)}URL = URL + "&Hire=NO"
${T(3)}hiddenFrame.navigate( URL );
${T(2)}}

${T(1)}</script>

</head>`;

  if (opts.objValid === false) {
    // :325-329 — StrTyconConnection_8
    return `${head}\n<body OnLoad="onPageLoad()">\n${T(3)}<div class=header2 style="padding: 20px">\n`
      + `${T(4)}Sorry, cannot retrieve Tycoon information from server.\n${T(3)}</div>\n</body>`;
  }

  return `${head}\n\n<body OnLoad="onPageLoad()">\n\n${T(1)}<div id=main style="display: none">\n`
    + `${T(1)}<table width="100%" height="100%" cellspacing="0">\n${T(2)}<tr>\n${T(3)}<td valign="top" style="padding: 20px">\n`
    + `${T(3)}<div class=header2>\n${T(4)}Initial Suppliers\n${T(3)}</div>\n`
    + `${T(2)}<table width="90%" style="margin-left: 20px; padding-left: 7px; padding-right: 7px">\n`
    + fluids.map(fluidBlock).join('\n') + '\n'
    + `${T(2)}</table>\n${T(3)}</td>\n${T(2)}</tr>\n${T(1)}</table>\n${T(1)}</div>\n\n</body>`;
}

const PLASTICS: Fluid = {
  id: 'PGIPlastics', name: 'Plastics', hireTradeCenter: true, storable: true, onlyWarehouses: false,
  suppliers: [
    { facilityId: '118,226,', facilityName: 'Chemical Plant', companyName: 'ACME Chemicals' },
    { facilityId: '77,42,', facilityName: 'Second Plant', companyName: '' },
  ],
};
/** A non-storable product: `…HireWH` is not rendered at all (:103). */
const SERVICES: Fluid = { id: 'PGIBusinessServices', name: 'Business Services', storable: false };

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES — the plain-text action pages
// ═══════════════════════════════════════════════════════════════════════════

/** DeleteDefaultSupplier.asp:13-15 / :17 / :21 — verbatim bodies. */
const DELETE_OK = '  Deleting connection...   OK. \n\n';
const DELETE_BIND_FAILED = '  ERROR: Couldn\'t bind to Tycoon. \n\n';
const DELETE_CONNECT_FAILED = '  ERROR: Couldn\'t connect. \n\n';
/** ModifyTradeCenterStatus.asp:26-32 / :35 / :39 / :43 */
const TC_OK = '  Setting Hire = true ...   OK. \n\n';
const TC_OPERATION_FAILED = '  Operation Failed \n\n';
const TC_CONNECTION_FAILED = '  Connection Failed. \n\n';
const TC_SECURITY_FAILED = ' Security Failed. \n\n';
/** ModifyWarehouseStatus.asp:29-31 */
const WH_OK = '  Setting Hire = false ...   OK. \n\n';
/** rdoSetAdvanceLevel.asp:25-31 / :42 (StrTyconBank_6) */
const ADVANCE_OK = '  Setting Value = true ...   OK. \n\n';
const ADVANCE_SECURITY_FAILED = ' ERROR: Cannot perform operation. \n\n';

// ═══════════════════════════════════════════════════════════════════════════
// fetchAutoConnections + parseAutoConnectionsHtml
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchAutoConnections', () => {
  it('fetches TycoonAutoConnections.asp with RIWS="" through ctx.fetchAspPage', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('<html></html>');

    const data = await fetchAutoConnections(fake.ctx);

    expect(fetchAsp(fake)).toHaveBeenCalledWith(AUTOCONN, { RIWS: '' });
    expect(fake.ctx.buildAspUrl).toHaveBeenCalledWith(AUTOCONN, { RIWS: '' });
    expect(data).toEqual({ fluids: [] });
  });

  // Regression guard for B-14. The localised name of :90 was captured and then
  // thrown away — both fields were set to the `<div id=…>`, so the player read
  // `PGIPlastics` where the reference client shows `Plastics`.
  it('keeps the localised product name and the internal id apart', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(autoConnectionsPage([PLASTICS]));

    const data = await fetchAutoConnections(fake.ctx);

    expect(data.fluids).toEqual([{
      fluidName: 'Plastics',
      fluidId: 'PGIPlastics',
      suppliers: [
        { facilityName: 'Chemical Plant', facilityId: '118,226,', companyName: 'ACME Chemicals' },
        // an empty company div: the value regex needs one character, so only
        // the facility name is read
        { facilityName: 'Second Plant', facilityId: '77,42,', companyName: '' },
      ],
      hireTradeCenter: true,
      onlyWarehouses: false,
      storable: true,
    }]);
  });

  it('a header whose localised name is empty falls back to the internal id', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(autoConnectionsPage([{ id: 'PGIPlastics', name: '', storable: false }]));
    const data = await fetchAutoConnections(fake.ctx);
    expect(data.fluids[0]).toMatchObject({ fluidName: 'PGIPlastics', fluidId: 'PGIPlastics' });
  });

  // Audit field 52: `…HireWH` exists only under `Storable` (:103-104), so its
  // absence used to be indistinguishable from an unchecked box and the client
  // offered a toggle that means nothing for this product.
  it('a non-storable product is reported as such, not as an unchecked warehouse toggle', async () => {
    const fake = makeWebCtx();
    const html = autoConnectionsPage([PLASTICS, SERVICES]);
    expect(html).not.toContain('PGIBusinessServicesHireWH');
    fetchAsp(fake).mockResolvedValue(html);

    const parsed = await fetchAutoConnections(fake.ctx);

    expect(parsed.fluids.map(f => [f.fluidId, f.storable, f.onlyWarehouses])).toEqual([
      ['PGIPlastics', true, false],
      ['PGIBusinessServices', false, false],
    ]);
  });

  it('a storable product with the box checked reads onlyWarehouses true', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(autoConnectionsPage([{ ...PLASTICS, onlyWarehouses: true }]));
    expect((await fetchAutoConnections(fake.ctx)).fluids[0]).toMatchObject({ storable: true, onlyWarehouses: true });
  });

  it('a fluid with no supplier gets the invitation row, which carries no fluid= attribute', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(autoConnectionsPage([SERVICES]));
    const data = await fetchAutoConnections(fake.ctx);
    expect(data.fluids[0]).toMatchObject({ fluidId: 'PGIBusinessServices', suppliers: [], hireTradeCenter: false });
  });

  it('names a supplier without any value div "Unknown"', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(
      `<div id="PGIPlastics" class=header3 style="color: #EEEECC">Plastics</div>`
      + `<tr id=PGIPlastics0 fluid=PGIPlastics facilityId="9,9,"><td></td></tr>`,
    );
    const data = await fetchAutoConnections(fake.ctx);
    expect(data.fluids[0].suppliers).toEqual([{ facilityName: 'Unknown', facilityId: '9,9,', companyName: '' }]);
  });

  it('HTML truncated in the middle of a row tag yields the fluid without that row', async () => {
    const fake = makeWebCtx();
    const full = autoConnectionsPage([PLASTICS]);
    fetchAsp(fake).mockResolvedValue(full.substring(0, full.indexOf('facilityId=') + 14));
    const data = await fetchAutoConnections(fake.ctx);
    expect(data.fluids).toEqual([{
      fluidName: 'Plastics', fluidId: 'PGIPlastics', suppliers: [],
      hireTradeCenter: false, onlyWarehouses: false, storable: false,
    }]);
  });

  it('caches the action URLs the page really carries, double slash included', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(autoConnectionsPage([PLASTICS]));

    await fetchAutoConnections(fake.ctx);

    expect(setCache(fake)).toHaveBeenCalledTimes(1);
    const [path, map] = setCache(fake).mock.calls[0];
    expect(path).toBe(AUTOCONN);
    expect([...map.keys()].sort()).toEqual([
      'DeleteDefaultSupplier.asp', 'ModifyTradeCenterStatus.asp', 'ModifyWarehouseStatus.asp',
    ]);
    // getBaseURL() (:169-176) concatenates an origin ending with "/" and a
    // PATH_INFO already starting with "/": the reference client's own URLs
    // carry the double slash. It is not ours to "fix".
    expect(map.get('DeleteDefaultSupplier.asp')?.url).toBe(
      `${SCRIPT_BASE}DeleteDefaultSupplier.asp?TycoonId=4666201923&FluidId=&DAAddr=10.0.0.5&DAPort=1111&Supplier=`,
    );
    // The `Hire=YES`/`NO` suffix is added after the `;` (:280-283), so it is
    // NOT part of the extracted URL — the handler sets it itself.
    expect(map.get('ModifyTradeCenterStatus.asp')?.url).not.toContain('Hire=');
    // And AddDefaultSupplier.asp is nowhere, because the page has no such link.
    expect(map.has('AddDefaultSupplier.asp')).toBe(false);
  });

  it('does not touch the cache when the page carries no action URL', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('<div id="PGIPlastics" class=header3 style="color: #EEEECC">Plastics</div>');
    await fetchAutoConnections(fake.ctx);
    expect(setCache(fake)).not.toHaveBeenCalled();
  });

  it('skips the URL extraction when buildAspUrl yields an empty base', async () => {
    const fake = makeWebCtx();
    (fake.ctx.buildAspUrl as jest.MockedFunction<SessionContext['buildAspUrl']>).mockReturnValue('');
    fetchAsp(fake).mockResolvedValue('<a href="DeleteDefaultSupplier.asp?x=1">d</a>');
    await fetchAutoConnections(fake.ctx);
    expect(setCache(fake)).not.toHaveBeenCalled();
  });

  it('returns no fluids and warns when the ASP fetch rejects', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockRejectedValue(new Error('HTTP 500'));
    expect(await fetchAutoConnections(fake.ctx)).toEqual({ fluids: [], cacheUnavailable: true });
    expect(fake.log.warn).toHaveBeenCalledWith('[AutoConnections] ASP fetch failed:', expect.any(Error));
  });

  it('the "cannot retrieve" sentence flags cacheUnavailable, with an empty list', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(autoConnectionsPage([], { objValid: false }));
    await expect(fetchAutoConnections(fake.ctx)).resolves.toEqual({ fluids: [], cacheUnavailable: true });
  });

  it('a page that parses carries no cacheUnavailable key', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(autoConnectionsPage([]));
    const data = await fetchAutoConnections(fake.ctx);
    expect(data).not.toHaveProperty('cacheUnavailable');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// executeAutoConnectionAction
// ═══════════════════════════════════════════════════════════════════════════

describe('executeAutoConnectionAction', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(htmlResponse(DELETE_OK));
  });

  // ── add: B-3, a page that never existed ──────────────────────────────────

  describe('add', () => {
    const ADDED = autoConnectionsPage([{
      ...PLASTICS,
      suppliers: [{ facilityId: '118,226,', facilityName: 'Chemical Plant', companyName: 'ACME Chemicals' }],
    }]);

    it('re-requests TycoonAutoConnections.asp with Connect=YES, not the AddDefaultSupplier.asp that does not exist', async () => {
      // Regression guard for B-3. `AddDefaultSupplier.asp` is absent from the
      // 2 774 ASP files; the add path is TycoonAutoConnections.asp:18-33, which
      // needs FullAccess (Tycoon + Password + WorldName) and the DA address.
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse(ADDED));

      const result = await executeAutoConnectionAction(fake.ctx, 'add', 'PGIPlastics', '118,226,');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = mockFetch.mock.calls[0][0];
      expect(url.startsWith(`${IS_BASE}TycoonAutoConnections.asp?`)).toBe(true);
      expect(url).not.toContain('AddDefaultSupplier');
      expect(url).not.toContain('+');
      const q = queryOf(0);
      expect(q.get('Connect')).toBe('YES');
      expect(q.get('Fluid')).toBe('PGIPlastics');
      expect(q.get('Suppliers')).toBe('118,226,');
      expect(q.get('Tycoon')).toBe('SPO_test3');
      expect(q.get('Password')).toBe('test3');
      expect(q.get('WorldName')).toBe('Shamba');
      expect(q.get('DAAddr')).toBe('10.0.0.5');
      expect(q.get('DAPort')).toBe('1111');
      expect(result).toEqual({ success: true });
    });

    it('the answer is the page re-rendered: the supplier is there or the add failed', async () => {
      const fake = makeWebCtx();
      // A wrong password forces Count = 0 (:72-76): the list comes back empty
      // and the page is otherwise perfectly normal — no marker of any kind.
      mockFetch.mockResolvedValue(htmlResponse(autoConnectionsPage([{ ...PLASTICS, suppliers: [] }])));
      expect(await executeAutoConnectionAction(fake.ctx, 'add', 'PGIPlastics', '118,226,')).toEqual({
        success: false, message: 'add failed: PGIPlastics does not list 118,226, as a supplier',
      });
    });

    it('an answer listing another fluid only is a failure too', async () => {
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse(autoConnectionsPage([SERVICES])));
      expect((await executeAutoConnectionAction(fake.ctx, 'add', 'PGIPlastics', '118,226,')).success).toBe(false);
    });

    it('add without suppliers is refused before any fetch', async () => {
      const fake = makeWebCtx();
      expect(await executeAutoConnectionAction(fake.ctx, 'add', 'PGIPlastics')).toEqual({ success: false, message: 'Supplier facility coordinates required' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('refuses when the DA lock channel is unset, rather than falling back to the directory host/port', async () => {
      const fake = makeWebCtx({
        activeUsername: null, cachedUsername: 'Cached', cachedPassword: null,
        daAddr: null, daPort: null, currentWorldInfo: { ...WORLD, name: '' },
      });
      mockFetch.mockResolvedValue(htmlResponse(ADDED));
      const result = await executeAutoConnectionAction(fake.ctx, 'add', 'PGIPlastics', '118,226,');
      expect(result).toEqual({
        success: false,
        message: 'ASP call refused: DA lock channel not announced yet (daAddr/daPort unset)',
      });
    });

    it('with no username at all sends an empty Tycoon', async () => {
      const fake = makeWebCtx({ activeUsername: null, cachedUsername: null });
      mockFetch.mockResolvedValue(htmlResponse(ADDED));
      await executeAutoConnectionAction(fake.ctx, 'add', 'PGIPlastics', '118,226,');
      expect(queryOf(0).get('Tycoon')).toBe('');
    });

    it('a cached AddDefaultSupplier.asp entry cannot hijack the add path', async () => {
      const fake = makeWebCtx();
      getCache(fake).mockReturnValue(cacheWith([['AddDefaultSupplier.asp', { key: 'AddDefaultSupplier.asp', url: `${IS_BASE}AddDefaultSupplier.asp?TycoonId=OLD`, method: 'GET' }]]));
      mockFetch.mockResolvedValue(htmlResponse(ADDED));
      await executeAutoConnectionAction(fake.ctx, 'add', 'PGIPlastics', '118,226,');
      expect(mockFetch.mock.calls[0][0]).toContain('TycoonAutoConnections.asp?');
    });
  });

  // ── the text pages: the `OK.` oracle ─────────────────────────────────────

  describe('with a cold cache — URL reconstructed from session state', () => {
    it('delete: DeleteDefaultSupplier.asp with the five reference params (:212-218)', async () => {
      const fake = makeWebCtx();
      const result = await executeAutoConnectionAction(fake.ctx, 'delete', 'PGIPlastics', '118,226,');
      expect(getCache(fake)).toHaveBeenCalledWith(AUTOCONN);
      expect(mockFetch.mock.calls[0][0].startsWith(`${IS_BASE}DeleteDefaultSupplier.asp?`)).toBe(true);
      expect(mockFetch.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'follow' }));
      expect((mockFetch.mock.calls[0][1] as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
      const q = queryOf(0);
      expect(q.get('TycoonId')).toBe(FAKE_CONTEXT_IDS.tycoonId);
      expect(q.get('FluidId')).toBe('PGIPlastics');
      expect(q.get('Supplier')).toBe('118,226,');
      expect(q.get('DAAddr')).toBe('10.0.0.5');
      expect(q.get('DAPort')).toBe('1111');
      expect(result).toEqual({ success: true });
    });

    it('delete without suppliers is refused before any fetch', async () => {
      const fake = makeWebCtx();
      expect(await executeAutoConnectionAction(fake.ctx, 'delete', 'PGIPlastics')).toEqual({ success: false, message: 'Supplier facility ID required' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each([
      ['hireTradeCenter', 'ModifyTradeCenterStatus.asp', 'YES', TC_OK],
      ['dontHireTradeCenter', 'ModifyTradeCenterStatus.asp', 'NO', TC_OK],
      ['onlyWarehouses', 'ModifyWarehouseStatus.asp', 'YES', WH_OK],
      ['dontOnlyWarehouses', 'ModifyWarehouseStatus.asp', 'NO', WH_OK],
    ])('%s: %s with Hire=%s and the tycoon credentials', async (action, asp, hire, body) => {
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse(body));
      const result = await executeAutoConnectionAction(fake.ctx, action, 'PGIFood');
      expect(mockFetch.mock.calls[0][0].startsWith(`${IS_BASE}${asp}?`)).toBe(true);
      const q = queryOf(0);
      expect(q.get('Hire')).toBe(hire);
      expect(q.get('TycoonId')).toBe(FAKE_CONTEXT_IDS.tycoonId);
      expect(q.get('FluidId')).toBe('PGIFood');
      expect(q.get('WorldName')).toBe('Shamba');
      expect(q.get('Tycoon')).toBe('SPO_test3');
      expect(q.get('Password')).toBe('test3');
      expect(q.get('DAAddr')).toBe('10.0.0.5');
      expect(q.get('DAPort')).toBe('1111');
      expect(result).toEqual({ success: true });
    });

    it.each(['hireTradeCenter', 'onlyWarehouses'])('%s refuses when the DA lock channel is unset', async (action) => {
      const fake = makeWebCtx({
        activeUsername: null, cachedUsername: 'Cached', cachedPassword: null, daAddr: null, daPort: null,
        tycoonId: null, currentWorldInfo: { ...WORLD, name: '' },
      });
      mockFetch.mockResolvedValue(htmlResponse(TC_OK));
      const result = await executeAutoConnectionAction(fake.ctx, action, 'PGIFood');
      expect(result).toEqual({
        success: false,
        message: 'ASP call refused: DA lock channel not announced yet (daAddr/daPort unset)',
      });
    });

    it('delete also refuses when the DA lock channel is unset', async () => {
      const fake = makeWebCtx({ activeUsername: null, cachedUsername: null, daAddr: null, daPort: null });
      mockFetch.mockResolvedValue(htmlResponse(DELETE_OK));
      const result = await executeAutoConnectionAction(fake.ctx, 'delete', 'PGIFood', '1,1,');
      expect(result).toEqual({
        success: false,
        message: 'ASP call refused: DA lock channel not announced yet (daAddr/daPort unset)',
      });
    });

    it('an unknown action is refused without a fetch', async () => {
      const fake = makeWebCtx();
      expect(await executeAutoConnectionAction(fake.ctx, 'explode', 'PGIFood')).toEqual({ success: false, message: 'Unknown action: explode' });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('with a warm cache — URL taken from the last page, params overwritten', () => {
    function warmCache(fake: FakeSessionCtx, key: string, url: string): void {
      getCache(fake).mockReturnValue(cacheWith([[key, { key, url, method: 'GET' }]]));
    }

    it('delete: keeps the cached URL and overwrites TycoonId/FluidId/Supplier', async () => {
      const fake = makeWebCtx();
      warmCache(fake, 'DeleteDefaultSupplier.asp', `${SCRIPT_BASE}DeleteDefaultSupplier.asp?TycoonId=OLD&FluidId=OLD&Supplier=OLD&DAAddr=cached.host`);

      const result = await executeAutoConnectionAction(fake.ctx, 'delete', 'PGIPlastics', '118,226,');

      const q = queryOf(0);
      // The cached URL goes through `new URL()`, which drops the default `:80`
      // and keeps the double slash of getBaseURL() — same URL, and the double
      // slash is the reference client's own form (audit §4).
      expect(mockFetch.mock.calls[0][0].startsWith('http://158.69.153.134//Five/0/Visual/Voyager/NewTycoon/DeleteDefaultSupplier.asp?')).toBe(true);
      expect(q.get('TycoonId')).toBe(FAKE_CONTEXT_IDS.tycoonId);
      expect(q.get('FluidId')).toBe('PGIPlastics');
      expect(q.get('Supplier')).toBe('118,226,');
      expect(q.get('DAAddr')).toBe('cached.host');
      expect(q.has('Hire')).toBe(false);
      expect(result).toEqual({ success: true });
      expect(fake.log.debug).toHaveBeenCalledWith('[AutoConnections] Using cached URL for delete');
    });

    it('delete without suppliers still goes out on the cached URL (no guard on that path)', async () => {
      const fake = makeWebCtx();
      warmCache(fake, 'DeleteDefaultSupplier.asp', `${IS_BASE}DeleteDefaultSupplier.asp?Supplier=OLD`);
      expect(await executeAutoConnectionAction(fake.ctx, 'delete', 'PGIPlastics')).toEqual({ success: true });
      expect(queryOf(0).get('Supplier')).toBe('OLD');
    });

    it.each([
      ['hireTradeCenter', 'ModifyTradeCenterStatus.asp', 'YES'],
      ['dontHireTradeCenter', 'ModifyTradeCenterStatus.asp', 'NO'],
      ['onlyWarehouses', 'ModifyWarehouseStatus.asp', 'YES'],
      ['dontOnlyWarehouses', 'ModifyWarehouseStatus.asp', 'NO'],
    ])('%s: sets Hire=%s on the cached URL', async (action, asp, hire) => {
      const fake = makeWebCtx();
      warmCache(fake, asp, `${SCRIPT_BASE}${asp}?TycoonId=OLD`);
      mockFetch.mockResolvedValue(htmlResponse(TC_OK));
      await executeAutoConnectionAction(fake.ctx, action, 'PGIFood');
      expect(queryOf(0).get('Hire')).toBe(hire);
      expect(queryOf(0).get('FluidId')).toBe('PGIFood');
    });

    it('a cache that lacks the key for this action falls back to reconstruction', async () => {
      const fake = makeWebCtx();
      warmCache(fake, 'ModifyWarehouseStatus.asp', `${IS_BASE}ModifyWarehouseStatus.asp?x=1`);
      mockFetch.mockResolvedValue(htmlResponse(TC_OK));
      await executeAutoConnectionAction(fake.ctx, 'hireTradeCenter', 'PGIFood');
      expect(mockFetch.mock.calls[0][0].startsWith(`${IS_BASE}ModifyTradeCenterStatus.asp?`)).toBe(true);
      expect(fake.log.debug).toHaveBeenCalledWith('[AutoConnections] No cached URL for hireTradeCenter, reconstructing');
    });

    it('an empty tycoonId is written as an empty TycoonId param', async () => {
      const fake = makeWebCtx({ tycoonId: null });
      warmCache(fake, 'DeleteDefaultSupplier.asp', `${IS_BASE}DeleteDefaultSupplier.asp?TycoonId=OLD`);
      await executeAutoConnectionAction(fake.ctx, 'delete', 'PGIFood', '1,1,');
      expect(queryOf(0).get('TycoonId')).toBe('');
    });
  });

  // Regression guard: only `resp.ok` was read, so every one of these bodies —
  // all served with HTTP 200 — reported success. A wrong password
  // (`Security Failed.`, ModifyTradeCenterStatus.asp:43) silently did nothing.
  describe('the body is the oracle: these pages never set an HTTP status', () => {
    it.each([
      ['delete', DELETE_BIND_FAILED, "ERROR: Couldn't bind to Tycoon."],
      ['delete', DELETE_CONNECT_FAILED, "ERROR: Couldn't connect."],
      ['hireTradeCenter', TC_OPERATION_FAILED, 'Operation Failed'],
      ['hireTradeCenter', TC_CONNECTION_FAILED, 'Connection Failed.'],
      ['hireTradeCenter', TC_SECURITY_FAILED, 'Security Failed.'],
      ['onlyWarehouses', ADVANCE_SECURITY_FAILED, 'ERROR: Cannot perform operation.'],
    ])('%s answering %j is a failure carrying the server text', async (action, body, message) => {
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse(body));
      expect(await executeAutoConnectionAction(fake.ctx, action, 'PGIFood', '1,1,')).toEqual({ success: false, message });
    });

    it('an empty body is a failure too', async () => {
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse('   \n  '));
      expect(await executeAutoConnectionAction(fake.ctx, 'delete', 'PGIFood', '1,1,')).toEqual({
        success: false, message: 'delete failed: the server returned an empty page',
      });
    });
  });

  it('a 500 response is a failure — the response is no longer discarded', async () => {
    // Regression guard for A-9. This used to return `{ success: true }` whatever the
    // server answered: the response object was dropped on the floor.
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse('<html>500 Internal Server Error</html>', 500));
    expect(await executeAutoConnectionAction(fake.ctx, 'delete', 'PGIFood', '1,1,')).toEqual({ success: false, message: 'delete failed: HTTP 500' });
  });

  it('a rejected fetch is caught and returned as failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await executeAutoConnectionAction(fake.ctx, 'delete', 'PGIFood', '1,1,')).toEqual({ success: false, message: 'ECONNREFUSED' });
  });

  it('a malformed cached URL is caught and returned as failure', async () => {
    const fake = makeWebCtx();
    getCache(fake).mockReturnValue(cacheWith([['DeleteDefaultSupplier.asp', { key: 'DeleteDefaultSupplier.asp', url: 'not a url', method: 'GET' }]]));
    const result = await executeAutoConnectionAction(fake.ctx, 'delete', 'PGIFood', '1,1,');
    expect(result.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('without a world ip: "World IP not available", no fetch', async () => {
    const fake = makeWebCtx({ currentWorldInfo: null });
    expect(await executeAutoConnectionAction(fake.ctx, 'delete', 'PGIFood', '1,1,')).toEqual({ success: false, message: 'World IP not available' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES — TycoonPolicy.asp
// ═══════════════════════════════════════════════════════════════════════════

interface PolicyRow {
  tycoon: string;
  /** `Obj.PolTo(i)` — your policy. `''` renders NOTHING at all (:66). */
  to: string;
  /** `Obj.PolFrom(i)` — theirs. */
  from: string;
}

const LETTERS: Record<string, [string, string]> = {
  '0': ['A', 'greenyellow'], '1': ['N', 'DARKKHAKI'], '2': ['E', 'red'],
};

/** :64-74 — RenderStatus. Emits nothing between the `<b>` when status is "". */
function renderStatus(index: number, spanId: string, status: string): string {
  const letter = LETTERS[status];
  return ` <b> ${letter ? `<span id=${spanId}${index} style="color: ${letter[1]}">${letter[0]}</span> ` : ''}</b> `;
}

/** :76-102 — RenderStatusInput. */
function renderStatusInput(tycoon: string, index: number, status: string, alliesPage: boolean): string {
  const option = (v: string, label: string) =>
    `${T(4)}<option value="${v}" ${status === v ? ' selected ' : ''} >${label}`;
  return `${T(3)}<div class=label id=label${index} style="cursor: hand">\n`
    + `${renderStatus(index, 'labelspan', status)}\n`
    + `${T(3)}</div>\n`
    + `${T(3)}<select style="font-size: 8px; display: none"\n`
    + `${T(4)}id=pol${index}\n${T(4)}name="pol${index}"\n${T(4)}size="0"\n`
    + `${T(4)}index="${index}"\n${T(4)}tycoon="${tycoon}"\n`
    + `${T(4)}OnClick="onSelectClick()"\n${T(4)}OnChange="onSelectChange()">\n`
    + (alliesPage
      ? `${option('0', 'Ally')}\n${option('1', 'Neutral')}\n${option('2', 'Enemy')}\n`
      // :96 — with no allies page the Ally option is rendered INSIDE a comment,
      // `selected` and all.
      : `${T(4)}<!--${option('0', 'Ally').trim()}-->\n${option('1', 'Neutral')}\n${option('2', 'Enemy')}\n`)
    + `${T(3)}</select>`;
}

function policyPage(rows: PolicyRow[], opts: { alliesPage?: boolean; fullAccess?: boolean; objValid?: boolean } = {}): string {
  const o = { alliesPage: true, fullAccess: true, objValid: true, ...opts };
  // :243-245 — the form opens BEFORE the FullAccess test, so it is always there
  const form = `<form id="MainForm" name="MainForm" method="POST" style="margin-left: 20px" `
    + `action="TycoonPolicy.asp?Action=modify&WorldName=Shamba&Tycoon=SPO_test3&TycoonId=4666201923&Password=test3&DAAddr=10.0.0.5&DAPort=1111">\n`
    + `${T(1)}<input name="NextStatus" id="NextStatus" type="hidden" value=>\n`
    + `${T(1)}<input name="SubTycoon" id="SubTycoon" type="hidden" value=>`;

  if (!o.fullAccess || !o.objValid) {
    // :481-485 — StrTycoonPolicy_7
    return `<body style="margin: 20px" OnClick="onPageClick()">\n${form}\n`
      + `${T(2)}<div class=header style="padding: 20px">\n${T(3)}Sorry, cannot retrieve Tycoon information from server.\n${T(2)}</div>\n</body>`;
  }

  const table = rows.map((r, i) =>
    `${T(2)}<td style="border-width : 1; border-left-style : solid; border-bottom-style : solid; border-color : #345950">\n`
    + `${T(3)}<div class=label style="color: #94B9B0">\n${T(4)}${r.tycoon}\n${T(3)}</div>\n${T(2)}</td>\n`
    + `${T(2)}<td\n${T(3)}align="center"\n${T(3)}index = "${i}"\n${T(3)}width = 60\n${T(3)}height = 25\n`
    + `${T(3)}OnClick="onPolBoxClick()">\n`
    + renderStatusInput(r.tycoon, i, r.to, o.alliesPage) + '\n'
    + `${T(2)}</td>\n`
    + `${T(2)}<td align="center" style="border-width : 1; border-bottom-style : solid; border-right-style : solid; border-color : #345950">\n`
    + `${T(3)}<div class=label>\n${renderStatus(i, 'otherspan', r.from)}\n${T(3)}</div>\n${T(2)}</td>`,
  ).join('\n');

  // :325-361 — the "change your policy" form fields, second <select> included
  const tail = `${T(2)}<div class=label style="margin-top: 10px">\n${T(2)}Tycoon Name:\n`
    + `${T(2)}<input style="font-size: 10px" name="Subject" size=30>\n${T(2)}</div>\n`
    + `${T(2)}<select style="font-size: 10px"\n${T(3)}name="Status"\n${T(3)}size="0">\n`
    + `${T(3)}<option value="0">Ally\n${T(3)}<option value="1" selected >Neutral\n${T(3)}<option value="2">Enemy\n`
    + `${T(2)}</select>\n</form>`;

  return `<body style="margin: 20px" OnClick="onPageClick()">\n${form}\n`
    + `${T(1)}<div class=header2>\n${T(2)}Commercial Strategy\n${T(1)}</div>\n`
    + `${T(1)}<table style="margin-left: 10px" width="95%" cellpadding=2 cellspacing=0>\n${T(2)}<tr>\n`
    + table + `\n${T(2)}</tr>\n${T(1)}</table>\n${tail}\n</body>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// fetchPolicy + parsePolicyHtml
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchPolicy', () => {
  it('fetches TycoonPolicy.asp with RIWS="" through ctx.fetchAspPage', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('<html></html>');
    expect(await fetchPolicy(fake.ctx)).toEqual({ policies: [], alliesAllowed: true });
    expect(fetchAsp(fake)).toHaveBeenCalledWith(POLICY, { RIWS: '' });
  });

  it('parses each row: your policy from labelspan<i>, theirs from otherspan<i>', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(policyPage([
      { tycoon: 'Alice', to: '2', from: '0' },
      { tycoon: 'Bob', to: '1', from: '1' },
      { tycoon: 'Carol', to: '0', from: '2' },
    ]));
    expect(await fetchPolicy(fake.ctx)).toEqual({
      policies: [
        { tycoonName: 'Alice', yourPolicy: 2, theirPolicy: 0 },
        { tycoonName: 'Bob', yourPolicy: 1, theirPolicy: 1 },
        { tycoonName: 'Carol', yourPolicy: 0, theirPolicy: 2 },
      ],
      alliesAllowed: true,
    });
  });

  // Audit field 55(b): `id=otherspan1[^>]*>` also matched `otherspan10`, so a
  // world with eleven policies paired row 1 with row 10's letter.
  it('otherspan1 is not otherspan10', async () => {
    const fake = makeWebCtx();
    const rows: PolicyRow[] = Array.from({ length: 11 }, (_, i) => ({
      tycoon: `T${i}`, to: '1', from: i === 1 ? '0' : '2',
    }));
    fetchAsp(fake).mockResolvedValue(policyPage(rows));

    const parsed = await fetchPolicy(fake.ctx);

    expect(parsed.policies).toHaveLength(11);
    expect(parsed.policies[1]).toEqual({ tycoonName: 'T1', yourPolicy: 1, theirPolicy: 0 });
    expect(parsed.policies[10]).toEqual({ tycoonName: 'T10', yourPolicy: 1, theirPolicy: 2 });
  });

  // Audit field 54: with `AlliesPageOn` off, the `value="0"` option — `selected`
  // included — is rendered inside an HTML comment (:96). The letter span of
  // :78-81 is outside it and is read first, so the parser no longer depends on
  // disabled markup.
  it('reads an Ally status even when the option that carries it is commented out', async () => {
    const fake = makeWebCtx();
    const html = policyPage([{ tycoon: 'Alice', to: '0', from: '1' }], { alliesPage: false });
    expect(html).toContain('<!--<option value="0"  selected  >Ally-->');
    fetchAsp(fake).mockResolvedValue(html);
    expect((await fetchPolicy(fake.ctx)).policies).toEqual([{ tycoonName: 'Alice', yourPolicy: 0, theirPolicy: 1 }]);
  });

  // Criterion's L0 test — two fixtures cut from the real TycoonPolicy.asp:88-100
  // markup, one with the live Ally option, one with it commented out (:96).
  it('alliesAllowed follows the Ally option form; yourPolicy is unaffected', async () => {
    const liveHtml = `
      <div class=label id=label0 style="cursor: hand">
       <b> <span id=labelspan0 style="color: greenyellow">A</span> </b>
      </div>
      <select style="font-size: 8px; display: none"
       id=pol0
       name="pol0"
       size="0"
       index="0"
       tycoon="Alice"
       OnClick="onSelectClick()"
       OnChange="onSelectChange()">
       <option value="0"  selected >Ally
       <option value="1" >Neutral
       <option value="2" >Enemy
      </select>
      <div class=label>
       <b> <span id=otherspan0 style="color: DARKKHAKI">N</span> </b>
      </div>`;

    const noAlliesHtml = `
      <div class=label id=label0 style="cursor: hand">
       <b> <span id=labelspan0 style="color: greenyellow">A</span> </b>
      </div>
      <select style="font-size: 8px; display: none"
       id=pol0
       name="pol0"
       size="0"
       index="0"
       tycoon="Alice"
       OnClick="onSelectClick()"
       OnChange="onSelectChange()">
       <!--<option value="0"  selected  >Ally-->
       <option value="1" >Neutral
       <option value="2" >Enemy
      </select>
      <div class=label>
       <b> <span id=otherspan0 style="color: DARKKHAKI">N</span> </b>
      </div>`;

    const fakeLive = makeWebCtx();
    fetchAsp(fakeLive).mockResolvedValue(liveHtml);
    const live = await fetchPolicy(fakeLive.ctx);

    const fakeNoAllies = makeWebCtx();
    fetchAsp(fakeNoAllies).mockResolvedValue(noAlliesHtml);
    const noAllies = await fetchPolicy(fakeNoAllies.ctx);

    expect(live.alliesAllowed).toBe(true);
    expect(noAllies.alliesAllowed).toBe(false);
    expect(live.policies).toEqual([{ tycoonName: 'Alice', yourPolicy: 0, theirPolicy: 1 }]);
    expect(noAllies.policies).toEqual(live.policies);
  });

  it('alliesAllowed is false on a page whose Ally option is commented out for every row', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(policyPage([
      { tycoon: 'Alice', to: '1', from: '1' },
      { tycoon: 'Bob', to: '2', from: '0' },
    ], { alliesPage: false }));
    expect((await fetchPolicy(fake.ctx)).alliesAllowed).toBe(false);
  });

  it('alliesAllowed is true on the default (allies-on) page', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(policyPage([{ tycoon: 'Alice', to: '1', from: '1' }]));
    expect((await fetchPolicy(fake.ctx)).alliesAllowed).toBe(true);
  });

  // RenderStatus emits nothing when the status is "" (:66) — on either side.
  it('an empty status on either side falls back to Neutral', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(policyPage([{ tycoon: 'Alice', to: '', from: '' }]));
    expect((await fetchPolicy(fake.ctx)).policies).toEqual([{ tycoonName: 'Alice', yourPolicy: 1, theirPolicy: 1 }]);
  });

  it('with no letter span at all, the selected option is the fallback', async () => {
    // `RenderStatus` switches on a NUMBER (`case 0`, :68) while the options
    // compare with a STRING (`status = "0"`, :92); in VBScript those never
    // match together, so exactly one of the two is rendered — which one is
    // [INFERRED] until a live capture settles it. Both are read.
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(
      `<select id=pol0 index="0" tycoon="Alice"><option value="2" selected >Enemy</select>`,
    );
    expect((await fetchPolicy(fake.ctx)).policies).toEqual([{ tycoonName: 'Alice', yourPolicy: 2, theirPolicy: 1 }]);
  });

  it('a select without an index attribute falls back to its position', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(
      `<select tycoon="Alice"><option value="0" selected >Ally</select>`
      + `<select tycoon="Bob"><option value="2" selected >Enemy</select>`
      + `<span id=otherspan1 style="color: red">E</span>`,
    );
    expect((await fetchPolicy(fake.ctx)).policies).toEqual([
      { tycoonName: 'Alice', yourPolicy: 0, theirPolicy: 1 },
      { tycoonName: 'Bob', yourPolicy: 2, theirPolicy: 2 },
    ]);
  });

  it('the second select of the page (name="Status") is not a policy row', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(policyPage([{ tycoon: 'Alice', to: '1', from: '1' }]));
    expect((await fetchPolicy(fake.ctx)).policies).toHaveLength(1);
  });

  it('without full access the page carries no row at all', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(policyPage([{ tycoon: 'Alice', to: '1', from: '1' }], { fullAccess: false }));
    expect((await fetchPolicy(fake.ctx)).policies).toEqual([]);
  });

  it('caches the form action URL for setPolicyStatus (real extractAllActionUrls)', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(policyPage([{ tycoon: 'Alice', to: '1', from: '1' }]));

    await fetchPolicy(fake.ctx);

    expect(setCache(fake)).toHaveBeenCalledTimes(1);
    const [path, map] = setCache(fake).mock.calls[0];
    expect(path).toBe(POLICY);
    expect(map.get('TycoonPolicy.asp')).toEqual({
      key: 'TycoonPolicy.asp',
      url: `${IS_BASE}TycoonPolicy.asp?Action=modify&WorldName=Shamba&Tycoon=SPO_test3&TycoonId=4666201923&Password=test3&DAAddr=10.0.0.5&DAPort=1111`,
      method: 'POST',
      hiddenFields: { NextStatus: '', SubTycoon: '' },
    });
  });

  it('does not touch the cache when the page carries no action URL', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue('<select tycoon="Alice"><option value="1" selected >Neutral</select>');
    await fetchPolicy(fake.ctx);
    expect(setCache(fake)).not.toHaveBeenCalled();
  });

  it('skips the extraction when buildAspUrl yields an empty base', async () => {
    const fake = makeWebCtx();
    (fake.ctx.buildAspUrl as jest.MockedFunction<SessionContext['buildAspUrl']>).mockReturnValue('');
    fetchAsp(fake).mockResolvedValue(policyPage([{ tycoon: 'Alice', to: '1', from: '1' }]));
    await fetchPolicy(fake.ctx);
    // Without a base, resolveUrl returns the raw relative string; caching that
    // would poison the next setPolicyStatus with an unusable URL.
    expect(setCache(fake)).not.toHaveBeenCalled();
  });

  it('returns no policies and warns when the ASP fetch rejects', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockRejectedValue(new Error('HTTP 500'));
    expect(await fetchPolicy(fake.ctx)).toEqual({ policies: [], alliesAllowed: true, cacheUnavailable: true });
    expect(fake.log.warn).toHaveBeenCalledWith('[Policy] ASP fetch failed:', expect.any(Error));
  });

  it('the "cannot retrieve" sentence flags cacheUnavailable, with an empty list', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(policyPage([], { objValid: false }));
    await expect(fetchPolicy(fake.ctx)).resolves.toMatchObject({ policies: [], cacheUnavailable: true });
  });

  it('a page that parses carries no cacheUnavailable key', async () => {
    const fake = makeWebCtx();
    fetchAsp(fake).mockResolvedValue(policyPage([]));
    const data = await fetchPolicy(fake.ctx);
    expect(data).not.toHaveProperty('cacheUnavailable');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// setPolicyStatus
// ═══════════════════════════════════════════════════════════════════════════

describe('setPolicyStatus', () => {
  /** The table as it stands after a successful `RDOSetPolicyStatus(Alice, 2)`. */
  const AFTER_ENEMY = policyPage([{ tycoon: 'Alice Smith', to: '2', from: '1' }]);

  beforeEach(() => {
    mockFetch.mockResolvedValue(htmlResponse(AFTER_ENEMY));
  });

  it('POSTs the form body (NextStatus, SubTycoon, Subject, Status) to the cached form action', async () => {
    const fake = makeWebCtx();
    const cachedUrl = `${IS_BASE}TycoonPolicy.asp?Action=modify&WorldName=Shamba`;
    getCache(fake).mockReturnValue(cacheWith([['TycoonPolicy.asp', { key: 'TycoonPolicy.asp', url: cachedUrl, method: 'POST' }]]));

    const result = await setPolicyStatus(fake.ctx, 'Alice Smith', 2);

    expect(getCache(fake)).toHaveBeenCalledWith(POLICY);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(withLangId(cachedUrl, DEFAULT_LANGUAGE_ID));
    expect(init).toEqual(expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ NextStatus: '2', SubTycoon: 'Alice Smith', Subject: 'Alice Smith', Status: '2' }).toString(),
      redirect: 'follow',
    }));
    expect((init as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({ success: true });
    expect(fake.log.debug).toHaveBeenCalledWith('[Policy] Using cached form action URL');
  });

  // Regression guard: `RDOSetPolicyStatus` is called with `call` and its result
  // is never captured (:27, :38); a failed Connect/BindTo skips the block in
  // silence and the page renders the unchanged table. `{ success: true }` was
  // returned in every one of those cases. The POST target is the page itself
  // (:243) and the cache is re-read afterwards (:49-50), so the answer carries
  // the new status — or proves nothing happened.
  it('a table still showing the old status is a failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(policyPage([{ tycoon: 'Alice Smith', to: '1', from: '1' }])));
    expect(await setPolicyStatus(fake.ctx, 'Alice Smith', 2)).toEqual({
      success: false, message: 'Set policy was not applied: Alice Smith is still at 1',
    });
  });

  it('an answer that does not list the tycoon at all is a failure', async () => {
    const fake = makeWebCtx();
    // FullAccess false renders StrTycoonPolicy_7 and no row whatsoever (:246).
    mockFetch.mockResolvedValue(htmlResponse(policyPage([{ tycoon: 'Alice Smith', to: '2', from: '1' }], { fullAccess: false })));
    expect(await setPolicyStatus(fake.ctx, 'Alice Smith', 2)).toEqual({
      success: false, message: 'Set policy failed: Alice Smith is not listed in the returned page',
    });
  });

  it('with a cold cache, reconstructs TycoonPolicy.asp?Action=modify from the session', async () => {
    const fake = makeWebCtx();

    await setPolicyStatus(fake.ctx, 'Alice Smith', 2);

    const url = mockFetch.mock.calls[0][0];
    expect(url.startsWith(`${IS_BASE}TycoonPolicy.asp?`)).toBe(true);
    const q = queryOf(0);
    expect(q.get('Action')).toBe('modify');
    expect(q.get('WorldName')).toBe('Shamba');
    expect(q.get('Tycoon')).toBe('SPO_test3');
    expect(q.get('TycoonId')).toBe(FAKE_CONTEXT_IDS.tycoonId);
    expect(q.get('Password')).toBe('test3');
    expect(q.get('DAAddr')).toBe('10.0.0.5');
    expect(q.get('DAPort')).toBe('1111');
    expect(fake.log.debug).toHaveBeenCalledWith('[Policy] No cached URL, reconstructing');
  });

  it('a cache without the TycoonPolicy.asp key is a cold cache', async () => {
    const fake = makeWebCtx();
    getCache(fake).mockReturnValue(cacheWith([['Other.asp', { key: 'Other.asp', url: 'http://x/Other.asp', method: 'GET' }]]));
    await setPolicyStatus(fake.ctx, 'Alice Smith', 2);
    expect(mockFetch.mock.calls[0][0].startsWith(`${IS_BASE}TycoonPolicy.asp?`)).toBe(true);
  });

  it('refuses when the DA lock channel is unset, rather than falling back to the directory host/port', async () => {
    const fake = makeWebCtx({ activeUsername: null, cachedUsername: 'Cached', cachedPassword: null, tycoonId: null, daAddr: null, daPort: null, currentWorldInfo: { ...WORLD, name: '' } });
    const result = await setPolicyStatus(fake.ctx, 'Alice Smith', 2);
    expect(result).toEqual({
      success: false,
      message: 'ASP call refused: DA lock channel not announced yet (daAddr/daPort unset)',
    });
  });

  it('with no username at all sends an empty Tycoon', async () => {
    const fake = makeWebCtx({ activeUsername: null, cachedUsername: null });
    await setPolicyStatus(fake.ctx, 'Alice Smith', 2);
    expect(queryOf(0).get('Tycoon')).toBe('');
  });

  it('a 500 response is a failure — the POST result is no longer discarded', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse('<html>500 Internal Server Error</html>', 500));
    expect(await setPolicyStatus(fake.ctx, 'Bob', 0)).toEqual({ success: false, message: 'Set policy failed: HTTP 500' });
  });

  it('a rejected fetch is caught and returned as failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await setPolicyStatus(fake.ctx, 'Bob', 0)).toEqual({ success: false, message: 'ECONNREFUSED' });
  });

  it('without a world ip: "World IP not available", no fetch', async () => {
    const fake = makeWebCtx({ currentWorldInfo: null });
    expect(await setPolicyStatus(fake.ctx, 'Bob', 0)).toEqual({ success: false, message: 'World IP not available' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES — abandonRole.asp and the curriculum state oracle
// ═══════════════════════════════════════════════════════════════════════════

/**
 * abandonRole.asp in full — a CONFIRMATION page (:71-137). `RN` is
 * `Obj.RealName`, read at :15 and published nowhere but in this script (:47).
 * The `break;7` of :51 is the source's own typo and is reproduced.
 */
function abandonRolePage(opts: { objValid?: boolean; realName?: string } = {}): string {
  const o = { objValid: true, realName: 'Robin Aleman', ...opts };
  const head = `<head>
${T(1)}<title>\tTycoon Options </title>
${T(1)}<script language="JScript">

${T(2)}var mClick = true;

${T(2)}function onBtnClick()
${T(2)}{
${T(3)}var td = getCell( event.srcElement );
${T(3)}if( (td != null) && (td.tagName == "TD") )
${T(4)}switch (td.command)
${T(4)}{
${T(5)}case "abandon" :
${T(6)}if( mClick )
${T(6)}{
${T(7)}mClick = false;
${T(7)}var URL = "rdoAbandonRole.asp?Tycoon=SPO_test3&WorldName=Shamba&DAAddr=10.0.0.5&DAPort=1111&TycoonId=&Password=test3&RN=${o.realName}";
${T(7)}window.navigate(URL);
${T(6)}}
${T(6)}break;7
${T(5)}case "cancel" :
${T(6)}if( mClick )
${T(6)}{
${T(7)}mClick = false;
${T(7)}window.navigate( "TycoonCurriculum.asp?Tycoon=SPO_test3&WorldName=Shamba&DAAddr=10.0.0.5&DAPort=1111&TycoonId=&Password=test3" );
${T(6)}}
${T(6)}break;
${T(4)}}
${T(2)}}

${T(1)}</script>

</head>`;
  if (!o.objValid) {
    return `${head}\n<body>\n${T(3)}<div class=header2 style="padding: 20px"> Sorry, cannot retrieve Tycoon information from server.\t<br>\n</div>\n</body>`;
  }
  return `${head}\n\n<body>\n${T(1)}<div id=main">\n`
    + `${T(3)}<div class=header2>\n${T(4)}Resign\n${T(3)}</div>\n`
    + `${T(3)}<div style="margin: 40px; text-align: center">\n`
    + `${T(4)}<div style="font: 30px Tahoma, Verdana, Arial; font-weight: bold; color: red">\n${T(5)}WARNING!\n${T(4)}</div>\n`
    + `${T(4)}<div class=header2 style="color: white; margin-top: 20px"> Are you sure you want to renounce your present political duties?</div>\n`
    + `${T(5)}<td class=button align="left" width="100"\n${T(6)}onClick="onBtnClick()"\n${T(6)}command="abandon"\n${T(6)}hiColor="white">\n\n${T(7)}Resign\n${T(5)}</td>\n`
    + `${T(5)}<td class=button align="left" width="100"\n${T(6)}onClick="onBtnClick()"\n${T(6)}command="cancel"\n${T(6)}hiColor="white">\n\n${T(7)}Cancel\n${T(5)}</td>\n`
    + `${T(3)}</div>\n${T(1)}</div>\n</body>`;
}

/** rdoAbandonRole.asp:35-44 — a navigate() shim, no outcome of any kind. */
const RDO_ABANDON_BODY = `<html>
<head>
</head>
<body style="margin-top: 20px; padding-left: 20px">
<script language="JScript">\t\t
\twindow.navigate ("http://local.asp?frame_Action=SetCompany&frame_Id=CnxHandler&Name=SPO_test3 - Green&OwnerRole=Robin Aleman&Id=77::http://local.asp?frame_Id=TycoonOpt&frame_Close=yes");
</script>

</body>
</html>`;

/**
 * TycoonCurriculum.asp:175-211 — the button that says whether the role is
 * still held. `command="abandon"` while SuperRole <> 0, `command="reset"` once
 * it is gone; neither without FullAccess.
 */
function curriculumWithButton(command: 'abandon' | 'reset' | 'none'): string {
  const label = command === 'reset' ? 'Reset Account' : 'Resign';
  return `<body>\n${T(3)}<div class=header2>\n${T(4)}Curriculum\n${T(3)}</div>\n`
    + (command === 'none' ? '' : `${T(4)}<table style="margin-left: 20px; margin-bottom: 20px">\n${T(5)}<tr>\n`
      + `${T(6)}<td class=button align="left" width="100"\n${T(7)}onClick="onBtnClick()"\n`
      + `${T(7)}command="${command}"\n${T(7)}hiColor="white">\n\n${T(8)}${label}\n${T(6)}</td>\n${T(5)}</tr>\n${T(4)}</table>\n`)
    + `</body>`;
}

/** rdoResetTycoon.asp:18 redirects here, so `redirect: 'follow'` lands on it. */
const CURRICULUM_AFTER_RESET = curriculumWithButton('reset');
const CURRICULUM_OBJ_INVALID = `<body>\n${T(3)}<div class=header2 style="padding: 20px">\n`
  + `${T(4)}Sorry, cannot retrieve Tycoon information from server.\n${T(3)}</div>\n</body>`;

// ═══════════════════════════════════════════════════════════════════════════
// executeCurriculumAction
// ═══════════════════════════════════════════════════════════════════════════

describe('executeCurriculumAction', () => {
  describe('with a cold cache — URL reconstructed', () => {
    it('resetAccount: rdoResetTycoon.asp with Tycoon/WorldName/DA/TycoonId=""/Password', async () => {
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse(CURRICULUM_AFTER_RESET));

      const result = await executeCurriculumAction(fake.ctx, 'resetAccount');

      expect(getCache(fake)).toHaveBeenCalledWith(CURRICULUM);
      expect(mockFetch.mock.calls[0][0].startsWith(`${IS_BASE}rdoResetTycoon.asp?`)).toBe(true);
      expect(mockFetch.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'follow' }));
      expect((mockFetch.mock.calls[0][1] as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
      const q = queryOf(0);
      expect(q.get('Tycoon')).toBe('SPO_test3');
      expect(q.get('WorldName')).toBe('Shamba');
      expect(q.get('DAAddr')).toBe('10.0.0.5');
      expect(q.get('DAPort')).toBe('1111');
      expect(q.get('TycoonId')).toBe('');
      expect(q.get('Password')).toBe('test3');
      expect(result).toEqual({ success: true, message: 'resetAccount completed successfully' });
    });

    it('resetAccount: a curriculum page the server cannot read back is a failure', async () => {
      // rdoResetTycoon.asp:13-14 assigns `res` and drops it, so a REFUSED reset
      // is [UNKNOWN]. What the redirect target does show is whether the tycoon
      // can be read at all (TycoonCurriculum.asp:417-420).
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse(CURRICULUM_OBJ_INVALID));
      expect(await executeCurriculumAction(fake.ctx, 'resetAccount')).toEqual({
        success: false, message: 'resetAccount failed: the server cannot read the tycoon back',
      });
    });

    // Regression guard for B-2. `abandonRole.asp` is a confirmation screen, not
    // an action: it renders "WARNING! Are you sure…" and two buttons. This used
    // to fetch it, see HTTP 200 and report `abandonRole completed successfully`
    // — the role was never given up. The real action is `rdoAbandonRole.asp`,
    // and it needs an `RN` parameter (Obj.RealName) that only this page carries.
    it('abandonRole: fetches the confirmation page, then the rdoAbandonRole.asp URL it carries, RN included', async () => {
      const fake = makeWebCtx();
      mockFetch
        .mockResolvedValueOnce(htmlResponse(abandonRolePage()))
        .mockResolvedValueOnce(htmlResponse(RDO_ABANDON_BODY));
      fetchAsp(fake).mockResolvedValue(curriculumWithButton('reset'));

      const result = await executeCurriculumAction(fake.ctx, 'abandonRole');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0].startsWith(`${IS_BASE}abandonRole.asp?`)).toBe(true);
      expect(mockFetch.mock.calls[1][0]).toBe(
        withLangId(`${IS_BASE}rdoAbandonRole.asp?Tycoon=SPO_test3&WorldName=Shamba&DAAddr=10.0.0.5&DAPort=1111&TycoonId=&Password=test3&RN=Robin Aleman`, DEFAULT_LANGUAGE_ID),
      );
      // The state oracle: the curriculum now offers "Reset Account", not "Resign".
      expect(fetchAsp(fake)).toHaveBeenCalledWith(CURRICULUM, { RIWS: '' });
      expect(result).toEqual({ success: true, message: 'abandonRole completed successfully' });
    });

    it('abandonRole: a curriculum still offering "Resign" means the role is still held', async () => {
      const fake = makeWebCtx();
      mockFetch
        .mockResolvedValueOnce(htmlResponse(abandonRolePage()))
        .mockResolvedValueOnce(htmlResponse(RDO_ABANDON_BODY));
      fetchAsp(fake).mockResolvedValue(curriculumWithButton('abandon'));
      expect(await executeCurriculumAction(fake.ctx, 'abandonRole')).toEqual({
        success: false, message: 'abandonRole was not applied: the role is still held',
      });
    });

    it('abandonRole: neither button means nothing can be confirmed', async () => {
      // No FullAccess → :175 hides both buttons.
      const fake = makeWebCtx();
      mockFetch
        .mockResolvedValueOnce(htmlResponse(abandonRolePage()))
        .mockResolvedValueOnce(htmlResponse(RDO_ABANDON_BODY));
      fetchAsp(fake).mockResolvedValue(curriculumWithButton('none'));
      expect(await executeCurriculumAction(fake.ctx, 'abandonRole')).toEqual({
        success: false, message: 'abandonRole could not be confirmed: the curriculum page offers neither button',
      });
    });

    it('abandonRole: a confirmation page without the rdoAbandonRole.asp URL stops there', async () => {
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse('<html><body>nothing here</body></html>'));
      expect(await executeCurriculumAction(fake.ctx, 'abandonRole')).toEqual({
        success: false, message: 'abandonRole failed: the confirmation page carries no rdoAbandonRole.asp URL',
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('abandonRole: a non-OK answer on the second leg is a failure', async () => {
      const fake = makeWebCtx();
      mockFetch
        .mockResolvedValueOnce(htmlResponse(abandonRolePage()))
        .mockResolvedValueOnce(htmlResponse('not found', 404));
      expect(await executeCurriculumAction(fake.ctx, 'abandonRole')).toEqual({
        success: false, message: 'abandonRole failed: HTTP 404',
      });
    });

    it('upgradeLevel: rdoSetAdvanceLevel.asp with Value=<bool>, defaulting to true', async () => {
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse(ADVANCE_OK));
      await executeCurriculumAction(fake.ctx, 'upgradeLevel', false);
      expect(mockFetch.mock.calls[0][0].startsWith(`${IS_BASE}rdoSetAdvanceLevel.asp?`)).toBe(true);
      let q = queryOf(0);
      expect(q.get('Value')).toBe('false');
      expect(q.get('TycoonId')).toBe(FAKE_CONTEXT_IDS.tycoonId);
      expect(q.get('Password')).toBe('test3');
      expect(q.get('Tycoon')).toBe('SPO_test3');

      await executeCurriculumAction(fake.ctx, 'upgradeLevel');
      q = queryOf(1);
      expect(q.get('Value')).toBe('true');
    });

    it('upgradeLevel: the page answers in plain text and a wrong password says so', async () => {
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse(ADVANCE_SECURITY_FAILED));
      expect(await executeCurriculumAction(fake.ctx, 'upgradeLevel', true)).toEqual({
        success: false, message: 'ERROR: Cannot perform operation.',
      });
    });

    it('rebuildLinks: util/links.asp with Company, ISAddr=world ip, ISPort 8000, ClientViewId=interfaceServerId', async () => {
      // [UNKNOWN] — links.asp exists in no directory of this IIS root, `util`
      // included. The root is a snapshot, so the call stays; a 404 fails cleanly.
      const fake = makeWebCtx({ currentCompany: { id: '77', name: 'SPO_test3 - Green' } });
      mockFetch.mockResolvedValue(htmlResponse('ok'));
      await executeCurriculumAction(fake.ctx, 'rebuildLinks');
      const url = mockFetch.mock.calls[0][0];
      expect(url.startsWith('http://158.69.153.134/Five/0/visual/voyager/util/links.asp?')).toBe(true);
      expect(url).toContain('Company=SPO_test3%20-%20Green');
      const q = queryOf(0);
      expect(q.get('Tycoon')).toBe('SPO_test3');
      expect(q.get('Password')).toBe('test3');
      expect(q.get('WorldName')).toBe('Shamba');
      expect(q.get('ISAddr')).toBe('158.69.153.134');
      expect(q.get('ISPort')).toBe('8000');
      expect(q.get('ClientViewId')).toBe(FAKE_CONTEXT_IDS.interfaceServerId);
      expect(q.get('RIWS')).toBe('');
    });

    it('rebuildLinks: the 404 of a page that does not exist is a clean failure', async () => {
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse('<html>404</html>', 404));
      expect(await executeCurriculumAction(fake.ctx, 'rebuildLinks')).toEqual({
        success: false, message: 'rebuildLinks failed: HTTP 404',
      });
    });

    it.each(['resetAccount', 'abandonRole', 'upgradeLevel', 'rebuildLinks'])(
      '%s refuses when the DA lock channel is unset, rather than falling back to the directory host/port',
      async (action) => {
        const fake = makeWebCtx({
          activeUsername: null, cachedUsername: 'Cached', cachedPassword: null, daAddr: null, daPort: null,
          tycoonId: null, interfaceServerId: null, currentCompany: null, currentWorldInfo: { ...WORLD, name: '' },
        });
        fetchAsp(fake).mockResolvedValue(curriculumWithButton('reset'));
        const result = await executeCurriculumAction(fake.ctx, action);
        expect(result).toEqual({
          success: false,
          message: 'ASP call refused: DA lock channel not announced yet (daAddr/daPort unset)',
        });
      },
    );

    it('with no username at all sends an empty Tycoon on every action', async () => {
      const fake = makeWebCtx({ activeUsername: null, cachedUsername: null });
      fetchAsp(fake).mockResolvedValue(curriculumWithButton('reset'));
      mockFetch
        .mockResolvedValueOnce(htmlResponse(CURRICULUM_AFTER_RESET))
        .mockResolvedValueOnce(htmlResponse(abandonRolePage()))
        .mockResolvedValueOnce(htmlResponse(RDO_ABANDON_BODY))
        .mockResolvedValueOnce(htmlResponse(ADVANCE_OK))
        .mockResolvedValueOnce(htmlResponse('ok'));
      for (const action of ['resetAccount', 'abandonRole', 'upgradeLevel', 'rebuildLinks']) {
        await executeCurriculumAction(fake.ctx, action);
      }
      for (const i of [0, 1, 3, 4]) expect(queryOf(i).get('Tycoon')).toBe('');
    });

    it('an unknown action is refused without a fetch', async () => {
      const fake = makeWebCtx();
      expect(await executeCurriculumAction(fake.ctx, 'selfDestruct')).toEqual({ success: false, message: 'Unknown curriculum action: selfDestruct' });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('with a warm cache', () => {
    function warmCache(fake: FakeSessionCtx, key: string, url: string): void {
      getCache(fake).mockReturnValue(cacheWith([[key, { key, url, method: 'GET' }]]));
    }

    it('uses the cached URL as-is for resetAccount', async () => {
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse(CURRICULUM_AFTER_RESET));
      warmCache(fake, 'rdoResetTycoon.asp', `${IS_BASE}rdoResetTycoon.asp?Tycoon=X&Password=Y`);
      await executeCurriculumAction(fake.ctx, 'resetAccount');
      expect(mockFetch.mock.calls[0][0]).toBe(withLangId(`${IS_BASE}rdoResetTycoon.asp?Tycoon=X&Password=Y`, DEFAULT_LANGUAGE_ID));
      expect(fake.log.debug).toHaveBeenCalledWith('[Curriculum] Using cached URL for resetAccount');
    });

    it('abandonRole takes the cached confirmation URL — TycoonCurriculum.asp:76 puts it there', async () => {
      const fake = makeWebCtx();
      warmCache(fake, 'abandonRole.asp', `${IS_BASE}abandonRole.asp?Tycoon=SPO_test3&Password=test3`);
      mockFetch
        .mockResolvedValueOnce(htmlResponse(abandonRolePage()))
        .mockResolvedValueOnce(htmlResponse(RDO_ABANDON_BODY));
      fetchAsp(fake).mockResolvedValue(curriculumWithButton('reset'));
      const result = await executeCurriculumAction(fake.ctx, 'abandonRole');
      expect(mockFetch.mock.calls[0][0]).toBe(withLangId(`${IS_BASE}abandonRole.asp?Tycoon=SPO_test3&Password=test3`, DEFAULT_LANGUAGE_ID));
      expect(result.success).toBe(true);
    });

    it('upgradeLevel substitutes the empty Value= of the cached URL with the given boolean', async () => {
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse(ADVANCE_OK));
      warmCache(fake, 'rdoSetAdvanceLevel.asp', `${SCRIPT_BASE}rdoSetAdvanceLevel.asp?TycoonId=1&Value=&WorldName=Shamba`);
      await executeCurriculumAction(fake.ctx, 'upgradeLevel', false);
      expect(mockFetch.mock.calls[0][0]).toBe(withLangId(`${SCRIPT_BASE}rdoSetAdvanceLevel.asp?TycoonId=1&Value=false&WorldName=Shamba`, DEFAULT_LANGUAGE_ID));
    });

    it('upgradeLevel without a value leaves the cached URL untouched', async () => {
      const fake = makeWebCtx();
      mockFetch.mockResolvedValue(htmlResponse(ADVANCE_OK));
      warmCache(fake, 'rdoSetAdvanceLevel.asp', `${IS_BASE}rdoSetAdvanceLevel.asp?Value=`);
      await executeCurriculumAction(fake.ctx, 'upgradeLevel');
      expect(mockFetch.mock.calls[0][0]).toBe(withLangId(`${IS_BASE}rdoSetAdvanceLevel.asp?Value=`, DEFAULT_LANGUAGE_ID));
    });

    it('a cache lacking the key for this action falls back to reconstruction', async () => {
      const fake = makeWebCtx();
      warmCache(fake, 'links.asp', 'http://x/links.asp');
      mockFetch
        .mockResolvedValueOnce(htmlResponse(abandonRolePage()))
        .mockResolvedValueOnce(htmlResponse(RDO_ABANDON_BODY));
      fetchAsp(fake).mockResolvedValue(curriculumWithButton('reset'));
      await executeCurriculumAction(fake.ctx, 'abandonRole');
      expect(mockFetch.mock.calls[0][0].startsWith(`${IS_BASE}abandonRole.asp?`)).toBe(true);
      expect(fake.log.debug).toHaveBeenCalledWith('[Curriculum] No cached URL for abandonRole, reconstructing');
    });
  });

  it('a non-OK status IS checked here: 500 → failure with the code', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse('boom', 500));
    expect(await executeCurriculumAction(fake.ctx, 'resetAccount')).toEqual({ success: false, message: 'resetAccount failed: HTTP 500' });
  });

  it('a rejected fetch is caught and returned as failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await executeCurriculumAction(fake.ctx, 'resetAccount')).toEqual({ success: false, message: 'ECONNREFUSED' });
  });

  it('without a world ip: "World IP not available", no fetch', async () => {
    const fake = makeWebCtx({ currentWorldInfo: null });
    expect(await executeCurriculumAction(fake.ctx, 'resetAccount')).toEqual({ success: false, message: 'World IP not available' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
