import {
  LOG_MARKERS,
  awaitMarker,
  describeLogMiss,
  findCurrentSurvivalLog,
  loggedInWindow,
  openLogWindow,
  readSince,
} from './live-log';

type FetchLike = jest.MockedFunction<typeof fetch>;

function response(init: {
  ok?: boolean;
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}): Response {
  const { ok = true, status = 200, body = '', headers = {} } = init;
  return {
    ok,
    status,
    headers: new Headers(headers),
    text: async () => body,
  } as unknown as Response;
}

let fetchMock: FetchLike;

beforeEach(() => {
  fetchMock = jest.fn() as FetchLike;
  global.fetch = fetchMock;
});

describe('LOG_MARKERS', () => {
  // Each prefix is cited beside its entry in live-log.ts (declaration, then the Logs.Log line).
  it('carries every marker verified in the Pascal', () => {
    expect(LOG_MARKERS).toEqual({
      RDOSetTaxValue: 'Setting Tax value:',
      RDOSetMinSalaryValue: 'Setting Min Wage:',
      RDOSetPublicity: 'Setting town politics publicity:',
      RDOSetRatingFrom: 'Setting town politics Tycoon rating:',
      RDOVote: 'Voting:',
      RDOSetPrice: 'Service SetPrice:',
      RDOSetSalaries: 'Setting salaries:',
      RDOSetOutputPrice: 'Output price set:',
      RDOSetInputOverPrice: 'Input overprice set:',
      RDOSetInputMaxPrice: 'Input max price set:',
      RDOSetInputMinK: 'Input min K set:',
      RDOSetInputSortMode: 'Changing Sort Mode..',
      RDOSetInputFluidPerc: 'Setting Input fluid perc:',
      RDOConnectInput: 'Input connected:',
      RDOConnectOutput: 'Output connected:',
      RDODisconnectInput: 'Input disconnect:',
      RDODisconnectOutput: 'Output disconnect:',
      RDOConnectToTycoon: 'Connect to Tycoon:',
      RDOSetCompanyInputDemand: 'SetCompanyInputDemand',
      RDOSetTradeLevel: 'SetTradeLevel',
      Stopped: 'Stopping Facility.',
      RDOStartUpgrades: 'Facility Start Upgrade count:',
      RDOStopUpgrade: 'Facility Stop Upgrade..',
      RDOQueueResearch: 'Queue Research:',
      RDOCancelResearch: 'Cancel Research:',
      RdoRepair: 'Repairing:',
      RDONewFacility: 'New Facility:',
      RDODelFacility: 'Del Facility, x:',
      RDOCreateCircuitSeg: 'CreateCircuitSeg:',
      RDOBreakCircuitAt: 'BreakCircuit:',
      RDOWipeCircuit: 'WipingCircuit:',
      RDODefineZone: 'Defining Zone:',
      RDOAskLoan: 'AskLoan:',
      RDOSetPolicyStatus: 'Setting policy status:',
      RDOAddAutoConnection: 'Adding initial suppliers:',
      RDODelAutoConnection: 'Deleting initial suppliers:',
      RDOHireTradeCenter: 'Initial suppliers, include Trade Center:',
      RDODontHireTradeCenter: 'Initial suppliers, excluding Trade Center:',
      RDOHireOnlyFromWarehouse: 'Initial suppliers, hire only warehouses:',
      RDODontHireOnlyFromWarehouse: 'Initial suppliers, hire all:',
      // #1189: the bank block's own line (StdBlocks/Banks.pas:162), keyed apart from the tycoon's
      // "AskLoan:", and the clone's receipt line (Kernel/World.pas:4801).
      'TBankBlock.RDOAskLoan': 'AskLoan',
      CloneFacility: 'CloneFacility:',
      CacheTown: 'Caching Town..',
    });
  });
});

describe('findCurrentSurvivalLog', () => {
  it('picks the newest day from the directory listing', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        body: `<a href="Survival%2026-08-19.log">Survival 26-08-19.log</a>
               <a href="Survival%2026-08-21.log">Survival 26-08-21.log</a>
               <a href="Survival%2026-08-20.log">Survival 26-08-20.log</a>`,
      }),
    );
    const url = await findCurrentSurvivalLog('http://logs/');
    expect(url).toBe('http://logs/Survival%2026-08-21.log');
  });

  it('encodes the space in the file name', async () => {
    fetchMock.mockResolvedValueOnce(response({ body: 'Survival 26-08-21.log' }));
    expect(await findCurrentSurvivalLog('http://logs/')).toBe('http://logs/Survival%2026-08-21.log');
  });

  it('fails loudly when the listing holds no Survival log', async () => {
    fetchMock.mockResolvedValueOnce(response({ body: '<html>nothing here</html>' }));
    await expect(findCurrentSurvivalLog('http://logs/')).rejects.toThrow(/No Survival log/);
  });

  it('explains itself when the log host is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(findCurrentSurvivalLog('http://logs/')).rejects.toThrow(/Cannot reach/);
  });
});

describe('openLogWindow', () => {
  // #1269: the window re-resolves the newest Survival file in the URL's directory first.
  const listing = () => response({ body: '<a href="Survival%2026-10-02.log">Survival 26-10-02.log</a>' });

  it('records where the log currently ends', async () => {
    fetchMock
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(response({ headers: { 'content-length': '1024' } }));
    const window = await openLogWindow('http://logs/Survival.log');
    expect(window.offset).toBe(1024);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://logs/');
    expect(fetchMock).toHaveBeenCalledWith('http://logs/Survival%2026-10-02.log', {
      method: 'HEAD',
      headers: { 'Accept-Encoding': 'identity' },
    });
  });

  it('refuses a log that reports no length — the window would be meaningless', async () => {
    fetchMock.mockResolvedValueOnce(listing()).mockResolvedValueOnce(response({ headers: {} }));
    await expect(openLogWindow('http://logs/Survival.log')).rejects.toThrow(/content-length/);
  });

  it('asks for the uncompressed length — a gzip HEAD reports the compressed size (#1228)', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (url === 'http://logs/') return listing();
      const enc = new Headers(init?.headers).get('accept-encoding') ?? 'gzip, deflate';
      return enc === 'identity'
        ? response({ headers: { 'content-length': '3525784' } })
        : response({ headers: { 'content-length': '505265', 'content-encoding': 'gzip' } });
    });
    const window = await openLogWindow('http://logs/Survival.log');
    expect(window.offset).toBe(3525784);
  });

  it('refuses a compressed answer, naming the Content-Encoding', async () => {
    fetchMock
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(response({ headers: { 'content-length': '505265', 'content-encoding': 'gzip' } }));
    await expect(openLogWindow('http://logs/Survival.log')).rejects.toThrow(/Content-Encoding: gzip/);
  });

  it('accepts an explicit content-encoding: identity', async () => {
    fetchMock
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(response({ headers: { 'content-length': '42', 'content-encoding': 'Identity ' } }));
    expect((await openLogWindow('http://logs/Survival.log')).offset).toBe(42);
  });

  it('stamps the window with a valid ISO date', async () => {
    fetchMock.mockResolvedValueOnce(listing()).mockResolvedValueOnce(response({ headers: { 'content-length': '1' } }));
    const window = await openLogWindow('http://logs/Survival.log');
    expect(Number.isNaN(Date.parse(window.openedAt))).toBe(false);
  });

  it('surfaces an HTTP failure rather than assuming offset zero', async () => {
    fetchMock.mockResolvedValueOnce(listing()).mockResolvedValueOnce(response({ ok: false, status: 503 }));
    await expect(openLogWindow('http://logs/Survival.log')).rejects.toThrow(/503/);
  });

  it('refuses a directory whose listing holds no Survival log', async () => {
    fetchMock.mockResolvedValueOnce(response({ body: '<html>nothing here</html>' }));
    await expect(openLogWindow('http://logs/Survival.log')).rejects.toThrow(/No Survival log/);
  });
});

describe('readSince', () => {
  const window = { url: 'http://logs/Survival.log', offset: 10, openedAt: 'now' };

  it('asks only for the bytes appended since the window opened', async () => {
    fetchMock.mockResolvedValueOnce(response({ status: 206, body: 'tail' }));
    expect(await readSince(window)).toBe('tail');
    expect(fetchMock).toHaveBeenCalledWith(window.url, {
      headers: { Range: 'bytes=10-', 'Accept-Encoding': 'identity' },
    });
  });

  it('slices the response itself when the server ignores Range', async () => {
    fetchMock.mockResolvedValueOnce(response({ status: 200, body: '0123456789TAIL' }));
    expect(await readSince(window)).toBe('TAIL');
  });

  it('treats 416 as "nothing appended yet"', async () => {
    fetchMock.mockResolvedValueOnce(response({ ok: false, status: 416 }));
    expect(await readSince(window)).toBe('');
  });

  it('raises anything else', async () => {
    fetchMock.mockResolvedValueOnce(response({ ok: false, status: 500 }));
    await expect(readSince(window)).rejects.toThrow(/Log read failed \(500\)/);
  });
});

describe('awaitMarker', () => {
  const window = { url: 'http://logs/Survival.log', offset: 0, openedAt: 'now' };

  it('returns the proving line as soon as it appears', async () => {
    fetchMock.mockResolvedValueOnce(
      response({ status: 206, body: 'noise\r\n  Setting Tax value: 12  \r\nmore' }),
    );
    const line = await awaitMarker(window, 'Setting Tax value:', 1_000);
    expect(line).toBe('Setting Tax value: 12');
  });

  it('polls until the line arrives', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ status: 206, body: '' }))
      .mockResolvedValueOnce(response({ status: 206, body: 'Setting Min Wage: 300' }));
    const line = await awaitMarker(window, 'Setting Min Wage:', 10_000, 0, mockClock([0, 1]), noSleep);
    expect(line).toBe('Setting Min Wage: 300');
  });

  it('skips a prefixed line that fails match and returns the one that satisfies it', async () => {
    fetchMock.mockResolvedValueOnce(
      response({ status: 206, body: 'Setting Tax value: Other, 0, 8\nSetting Tax value: Helartia, 0, 8' }),
    );
    const line = await awaitMarker(
      window,
      { marker: 'Setting Tax value:', match: l => l.includes('Helartia') },
      1_000,
    );
    expect(line).toBe('Setting Tax value: Helartia, 0, 8');
  });

  it('returns null when the only prefixed line fails match', async () => {
    fetchMock.mockResolvedValue(response({ status: 206, body: 'Setting Tax value: Other, 0, 8' }));
    const line = await awaitMarker(
      window,
      { marker: 'Setting Tax value:', match: l => l.includes('Helartia') },
      5,
      0,
      mockClock([0, 100]),
      noSleep,
    );
    expect(line).toBeNull();
  });

  describe('timestamp rule', () => {
    const opened = { url: 'http://logs/Survival.log', offset: 0, openedAt: '2026-09-30T20:06:00.000Z' };

    it('never counts a matching line stamped before the window opened', async () => {
      fetchMock.mockResolvedValue(response({ status: 206, body: '10:22:12 AM Facility Stop Upgrade..' }));
      const line = await awaitMarker(opened, LOG_MARKERS.RDOStopUpgrade, 5, 0, mockClock([0, 100]), noSleep);
      expect(line).toBeNull();
    });

    it('counts a matching line stamped after the window opened', async () => {
      fetchMock.mockResolvedValueOnce(
        response({ status: 206, body: '10:22:12 AM Facility Stop Upgrade..\n8:06:05 PM Facility Stop Upgrade..' }),
      );
      const line = await awaitMarker(opened, LOG_MARKERS.RDOStopUpgrade, 1_000);
      expect(line).toBe('8:06:05 PM Facility Stop Upgrade..');
    });

    it('counts a matching line stamped exactly when the window opened', async () => {
      fetchMock.mockResolvedValueOnce(response({ status: 206, body: '8:06:00 PM Facility Stop Upgrade..' }));
      const line = await awaitMarker(opened, LOG_MARKERS.RDOStopUpgrade, 1_000);
      expect(line).toBe('8:06:00 PM Facility Stop Upgrade..');
    });
  });

  it('returns null when the write never reaches the object', async () => {
    fetchMock.mockResolvedValue(response({ status: 206, body: 'unrelated chatter' }));
    const line = await awaitMarker(window, 'Setting Tax value:', 5, 0, mockClock([0, 100]), noSleep);
    expect(line).toBeNull();
  });
});

function mockClock(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function noSleep(): Promise<void> {
  return Promise.resolve();
}

describe('loggedInWindow', () => {
  const at = (openedAt: string) => ({ url: 'u', offset: 0, openedAt });

  it('reads 12 AM as hour 0 and 12 PM as hour 12', () => {
    expect(loggedInWindow('12:00:01 AM x', at('2026-10-01T00:00:00.000Z'))).toBe(true);
    expect(loggedInWindow('12:00:01 AM x', at('2026-10-01T12:00:00.000Z'))).toBe(false);
    expect(loggedInWindow('12:30:00 PM x', at('2026-10-01T12:29:59.000Z'))).toBe(true);
  });

  it('parses the interface-server form', () => {
    expect(loggedInWindow('8:06:05 PM - Start Disconnecting SPO_test3', at('2026-10-01T20:06:30.000Z'))).toBe(false);
  });

  it('allows a server clock trailing the bench by up to CLOCK_SKEW_SECONDS', () => {
    // A line logged right after the window opened, stamped 2 s early by a lagging server clock.
    expect(loggedInWindow('8:05:58 PM Cancel Research: HappyHour', at('2026-10-01T20:06:00.000Z'))).toBe(true);
    expect(loggedInWindow('8:05:50 PM x', at('2026-10-01T20:06:00.000Z'))).toBe(true);
    expect(loggedInWindow('8:05:49 PM x', at('2026-10-01T20:06:00.000Z'))).toBe(false);
  });

  it('falls back to the byte offset for a stamp-less line or an invalid openedAt', () => {
    expect(loggedInWindow('Setting Tax value: 1', at('2026-10-01T23:59:59.000Z'))).toBe(true);
    expect(loggedInWindow('1:00:00 AM x', at('now'))).toBe(true);
  });

  it('compares a DateTimeToStr-stamped line as a full date-time', () => {
    const w = at('2026-09-30T20:06:00.000Z');
    expect(loggedInWindow('2026-09-30 10:22:12 AM Voting: a by b', w)).toBe(false);
    expect(loggedInWindow('2026-09-30 8:06:05 PM Voting: a by b', w)).toBe(true);
    expect(loggedInWindow('2026-09-29 9:00:00 PM Voting: a by b', w)).toBe(false);
    expect(loggedInWindow('2026-09-30 8:05:50 PM Service SetPrice: 0, 290', w)).toBe(true);
    expect(loggedInWindow('2026-09-30 8:05:49 PM Setting salaries: 128, 100, 100', w)).toBe(false);
    expect(loggedInWindow('2026-10-01 1:00:00 AM x', w)).toBe(true);
  });

  it('dates a TimeToStr line by the file it was read from (#1269)', () => {
    const lateEvening = at('2026-10-02T23:59:50.000Z');
    expect(loggedInWindow('12:00:30 AM x', lateEvening, '26-10-03')).toBe(true);
    expect(loggedInWindow('12:00:30 AM x', lateEvening)).toBe(false);
    expect(loggedInWindow('11:59:55 PM x', at('2026-10-03T00:00:02.000Z'), '26-10-02')).toBe(true);
    expect(loggedInWindow('10:00:00 PM x', at('2026-10-03T00:05:00.000Z'), '26-10-02')).toBe(false);
  });
});

describe('UTC-midnight rollover (#1269)', () => {
  const DIR = 'http://logs/';
  const DAY2 = 'http://logs/Survival%2026-10-02.log';
  const DAY3 = 'http://logs/Survival%2026-10-03.log';
  const MIN_WAGE = 'Setting Min Wage: Helartia, 0, 95';

  interface LogFile {
    length: number;
    /** Range body answered with 206, or undefined for 416. */
    tail?: string;
    full: string;
    status?: number;
  }

  let files: Record<string, LogFile>;

  function serve(): void {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === DIR) {
        const names = Object.keys(files).map(u => `<a href="${u.slice(DIR.length)}">x</a>`);
        return response({ body: names.join('\n') });
      }
      const file = files[url];
      if (!file) return response({ ok: false, status: 404 });
      if (file.status !== undefined) return response({ ok: false, status: file.status });
      if (init?.method === 'HEAD') return response({ headers: { 'content-length': String(file.length) } });
      const range = new Headers(init?.headers).get('range');
      if (range === null) return response({ body: file.full });
      return file.tail === undefined
        ? response({ ok: false, status: 416 })
        : response({ status: 206, body: file.tail });
    });
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('finds a line logged in the new day\'s file after a window opened before midnight', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-02T23:59:50.000Z') });
    files = { [DAY2]: { length: 500, full: '' } };
    serve();
    const window = await openLogWindow(DAY2);
    expect(window.url).toBe(DAY2);
    files[DAY3] = { length: 60, full: `12:00:30 AM ${MIN_WAGE}` };
    const line = await awaitMarker(window, LOG_MARKERS.RDOSetMinSalaryValue, 5, 0, mockClock([0, 100]), noSleep);
    expect(line).toBe(`12:00:30 AM ${MIN_WAGE}`);
  });

  it('opens on the new day\'s file when handed the URL preflight resolved before midnight', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-03T00:05:00.000Z') });
    files = { [DAY2]: { length: 500, full: '' }, [DAY3]: { length: 40, full: '' } };
    serve();
    const window = await openLogWindow(DAY2);
    expect(window.url).toBe(DAY3);
    expect(window.offset).toBe(40);
    expect(fetchMock).toHaveBeenCalledWith(DAY3, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });
    files[DAY3].tail = `12:05:30 AM ${MIN_WAGE}`;
    const line = await awaitMarker(window, LOG_MARKERS.RDOSetMinSalaryValue, 5, 0, mockClock([0, 100]), noSleep);
    expect(line).toBe(`12:05:30 AM ${MIN_WAGE}`);
  });

  it('reads the new day\'s file when it appears only after a window opened past midnight', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-03T00:05:00.000Z') });
    files = { [DAY2]: { length: 500, full: '' } };
    serve();
    const window = await openLogWindow(DAY2);
    expect(window.url).toBe(DAY2);
    files[DAY3] = { length: 60, full: `12:05:30 AM ${MIN_WAGE}` };
    const line = await awaitMarker(window, LOG_MARKERS.RDOSetMinSalaryValue, 5, 0, mockClock([0, 100]), noSleep);
    expect(line).toBe(`12:05:30 AM ${MIN_WAGE}`);
  });

  it('still refuses a matching line written to the old file before the window opened', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-02T23:59:50.000Z') });
    files = { [DAY2]: { length: 500, full: '' } };
    serve();
    const window = await openLogWindow(DAY2);
    files[DAY2].tail = `11:58:00 PM ${MIN_WAGE}`;
    files[DAY3] = { length: 30, full: '12:00:10 AM Caching Town..' };
    const line = await awaitMarker(window, LOG_MARKERS.RDOSetMinSalaryValue, 5, 0, mockClock([0, 100]), noSleep);
    expect(line).toBeNull();
  });

  it('reads exactly as before when no newer file exists', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-02T23:59:50.000Z') });
    files = { [DAY2]: { length: 500, full: 'never read', tail: 'appended' } };
    serve();
    const window = await openLogWindow(DAY2);
    fetchMock.mockClear();
    expect(await readSince(window)).toBe('appended');
    expect(fetchMock).toHaveBeenCalledWith(DAY2, { headers: { Range: 'bytes=500-', 'Accept-Encoding': 'identity' } });
    const survivalReads = fetchMock.mock.calls.filter(([u]) => String(u) !== DIR);
    expect(survivalReads).toHaveLength(1);
  });

  it('joins the window\'s tail and the newer file', async () => {
    files = { [DAY2]: { length: 500, full: '', tail: 'old tail' }, [DAY3]: { length: 9, full: 'new file' } };
    serve();
    expect(await readSince({ url: DAY2, offset: 500, openedAt: '2026-10-02T23:59:50.000Z' })).toBe(
      'old tail\nnew file',
    );
  });

  it('raises a newer file that cannot be read', async () => {
    files = { [DAY2]: { length: 500, full: '' }, [DAY3]: { length: 9, full: '', status: 500 } };
    serve();
    await expect(readSince({ url: DAY2, offset: 500, openedAt: '2026-10-02T23:59:50.000Z' })).rejects.toThrow(
      /Log read failed \(500\) for http:\/\/logs\/Survival%2026-10-03\.log/,
    );
  });
});

describe('full read at the deadline (#1318)', () => {
  const DIR = 'http://logs/';
  const DAY4 = 'http://logs/Survival%2026-10-04.log';
  const DAY5 = 'http://logs/Survival%2026-10-05.log';
  const RATING = 'Setting town politics Tycoon rating: SPO_test, CampaignAccuracy, 100';
  const LINE = `8:38:02 PM ${RATING}`;
  const proof = { marker: LOG_MARKERS.RDOSetRatingFrom, match: (l: string) => l.includes('CampaignAccuracy, 100') };
  const PAD = 'x'.repeat(10);
  const window = () => ({ url: DAY4, offset: 10, openedAt: '2026-10-04T20:38:03.530Z' });

  interface Serve {
    /** Range answer: undefined for 416, else a 206 body. */
    tail?: string;
    /** No-Range answer: a body, a non-ok status, or a rejection. */
    full: string | { status: number } | Error;
    newer?: Record<string, string>;
  }

  function serve(opts: Serve): void {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === DIR) {
        const names = [DAY4, ...Object.keys(opts.newer ?? {})].map(u => `<a href="${u.slice(DIR.length)}">x</a>`);
        return response({ body: names.join('\n') });
      }
      if (url !== DAY4) return response({ body: opts.newer?.[url] ?? '' });
      if (new Headers(init?.headers).get('range') !== null) {
        return opts.tail === undefined ? response({ ok: false, status: 416 }) : response({ status: 206, body: opts.tail });
      }
      if (opts.full instanceof Error) throw opts.full;
      if (typeof opts.full !== 'string') return response({ ok: false, status: opts.full.status });
      return response({ body: opts.full });
    });
  }

  const fullReads = () =>
    fetchMock.mock.calls.filter(([u, init]) => String(u) === DAY4 && new Headers(init?.headers).get('range') === null);

  const wait = (w: ReturnType<typeof window>) => awaitMarker(w, proof, 5, 0, mockClock([0, 1, 100]), noSleep);

  it('(a) returns the line the full read holds after the offset when every tail poll answers 416', async () => {
    serve({ full: `${PAD}noise\r\n  ${LINE}  \r\n` });
    const w = window();
    expect(await wait(w)).toBe(LINE);
    expect(fullReads()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(DAY4, {
      headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' },
    });
    const tailPolls = fetchMock.mock.calls.filter(([, init]) => new Headers(init?.headers).get('range') !== null);
    expect(tailPolls.length).toBeGreaterThan(1);
  });

  it('(a) returns the full read\'s line when every tail poll answers an unchanged tail', async () => {
    serve({ tail: 'unrelated chatter', full: `${PAD}${LINE}` });
    const w = window();
    expect(await wait(w)).toBe(LINE);
    expect(describeLogMiss(w)).toBe(`(no line) — offset 10, last tail 206 / 17 B, full read 200 / ${10 + LINE.length} B`);
  });

  it('(b) refuses a marker that sits only before the offset', async () => {
    const before = `${LINE}\n`;
    serve({ full: `${before}${'y'.repeat(5)}` });
    expect(await wait({ ...window(), offset: before.length })).toBeNull();
  });

  it('(b) refuses a line after the offset stamped earlier than the window less CLOCK_SKEW_SECONDS', async () => {
    serve({ full: `${PAD}8:37:52 PM ${RATING}` });
    expect(await wait(window())).toBeNull();
  });

  it('(b) refuses a line that fails the proof\'s match', async () => {
    serve({ full: `${PAD}8:38:02 PM Setting town politics Tycoon rating: SPO_test, CampaignAccuracy, 0` });
    expect(await wait(window())).toBeNull();
  });

  it('(c) returns null on a full read with no match, and the helper names what each read saw', async () => {
    const full = `${PAD}unrelated chatter`;
    serve({ full });
    const w = window();
    expect(await wait(w)).toBeNull();
    expect(describeLogMiss(w)).toBe(`(no line) — offset 10, last tail 416 / 0 B, full read 200 / ${full.length} B`);
  });

  it('(d) returns a matching tail at once, with no full read', async () => {
    serve({ tail: LINE, full: `${PAD}${LINE}` });
    const w = window();
    expect(await wait(w)).toBe(LINE);
    expect(fullReads()).toHaveLength(0);
    expect(describeLogMiss(w)).toBe(`(no line) — offset 10, last tail 206 / ${LINE.length} B, no full read`);
  });

  it('returns null and records the error when the full read rejects', async () => {
    serve({ full: new Error('socket hang up') });
    const w = window();
    expect(await wait(w)).toBeNull();
    expect(describeLogMiss(w)).toBe('(no line) — offset 10, last tail 416 / 0 B, full read failed: socket hang up');
  });

  it('returns null and records the status when the full read is refused', async () => {
    serve({ full: { status: 500 } });
    const w = window();
    expect(await wait(w)).toBeNull();
    expect(describeLogMiss(w)).toBe('(no line) — offset 10, last tail 416 / 0 B, full read 500 / 0 B');
  });

  it('reads a newer-dated file in the full read too', async () => {
    serve({ tail: '', full: PAD, newer: {} });
    let calls = 0;
    const base = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input, init) => {
      // The newer file appears only once the polls are over: only the full read can see it.
      if (String(input) === DIR && ++calls > 1) {
        return response({ body: [DAY4, DAY5].map(u => `<a href="${u.slice(DIR.length)}">x</a>`).join('\n') });
      }
      if (String(input) === DAY5) return response({ body: `12:00:10 AM ${RATING}` });
      return base!(input, init);
    });
    expect(await awaitMarker(window(), proof, 5, 0, mockClock([0, 100]), noSleep)).toBe(`12:00:10 AM ${RATING}`);
    expect(fullReads()).toHaveLength(1);
  });

  it('records the status of a tail read that fails', async () => {
    fetchMock.mockResolvedValue(response({ ok: false, status: 503 }));
    const w = window();
    await expect(wait(w)).rejects.toThrow(/Log read failed \(503\)/);
    expect(describeLogMiss(w)).toBe('(no line) — offset 10, last tail 503 / 0 B, no full read');
  });

  it('describes a missing window, an unread window and a custom label', () => {
    expect(describeLogMiss(null)).toBe('(no line) — no log window');
    expect(describeLogMiss(undefined, 'no X line')).toBe('(no X line) — no log window');
    expect(describeLogMiss(window(), 'no X line')).toBe('(no X line) — offset 10, no tail read, no full read');
  });
});
