import {
  LOG_MARKERS,
  awaitMarker,
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
  const dated = 'http://logs/Survival%2026-10-02.log';
  const listing = () => response({ body: 'Survival 26-10-02.log' });

  it('records where the log currently ends', async () => {
    fetchMock
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(response({ headers: { 'content-length': '1024' } }));
    const window = await openLogWindow(dated);
    expect(window.offset).toBe(1024);
    expect(fetchMock).toHaveBeenCalledWith(dated, {
      method: 'HEAD',
      headers: { 'Accept-Encoding': 'identity' },
    });
  });

  it('refuses a log that reports no length — the window would be meaningless', async () => {
    fetchMock.mockResolvedValueOnce(listing()).mockResolvedValueOnce(response({ headers: {} }));
    await expect(openLogWindow(dated)).rejects.toThrow(/content-length/);
  });

  it('asks for the uncompressed length — a gzip HEAD reports the compressed size (#1228)', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method !== 'HEAD') return listing();
      const enc = new Headers(init?.headers).get('accept-encoding') ?? 'gzip, deflate';
      return enc === 'identity'
        ? response({ headers: { 'content-length': '3525784' } })
        : response({ headers: { 'content-length': '505265', 'content-encoding': 'gzip' } });
    });
    const window = await openLogWindow(dated);
    expect(window.offset).toBe(3525784);
  });

  it('refuses a compressed answer, naming the Content-Encoding', async () => {
    fetchMock
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(response({ headers: { 'content-length': '505265', 'content-encoding': 'gzip' } }));
    await expect(openLogWindow(dated)).rejects.toThrow(/Content-Encoding: gzip/);
  });

  it('accepts an explicit content-encoding: identity', async () => {
    fetchMock
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(response({ headers: { 'content-length': '42', 'content-encoding': 'Identity ' } }));
    expect((await openLogWindow(dated)).offset).toBe(42);
  });

  it('stamps the window with a valid ISO date', async () => {
    fetchMock.mockResolvedValueOnce(listing()).mockResolvedValueOnce(response({ headers: { 'content-length': '1' } }));
    const window = await openLogWindow(dated);
    expect(Number.isNaN(Date.parse(window.openedAt))).toBe(false);
  });

  it('surfaces an HTTP failure rather than assuming offset zero', async () => {
    fetchMock.mockResolvedValueOnce(listing()).mockResolvedValueOnce(response({ ok: false, status: 503 }));
    await expect(openLogWindow(dated)).rejects.toThrow(/503/);
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
});

describe('day rollover (#1269)', () => {
  const base = 'http://logs/';
  const day02 = `${base}Survival%2026-10-02.log`;
  const day03 = `${base}Survival%2026-10-03.log`;
  const minWage = { marker: LOG_MARKERS.RDOSetMinSalaryValue, match: (l: string) => l.includes('Helartia') };
  let files: Record<string, string>;

  /** A log host: the listing at `base`, HEAD lengths, ranged and whole-file GETs. */
  function serveLogs(): void {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === base) {
        const anchors = Object.keys(files).map(u => {
          const name = u.slice(base.length);
          return `<a href="${name}">${name.replace('%20', ' ')}</a>`;
        });
        return response({ body: anchors.join('\n') });
      }
      const text = files[url];
      if (text === undefined) return response({ ok: false, status: 404 });
      if (init?.method === 'HEAD') return response({ headers: { 'content-length': String(text.length) } });
      const range = new Headers(init?.headers).get('range');
      if (range === null) return response({ body: text });
      const from = Number(/bytes=(\d+)-/.exec(range)?.[1]);
      return from >= text.length
        ? response({ ok: false, status: 416 })
        : response({ status: 206, body: text.slice(from) });
    });
  }

  beforeEach(() => {
    files = {};
    serveLogs();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('finds a line logged in the next day file by a window opened just before midnight', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-02T23:59:50Z') });
    files[day02] = '11:59:40 PM chatter\n';
    const window = await openLogWindow(day02);
    expect(window.url).toBe(day02);

    jest.setSystemTime(new Date('2026-10-03T00:00:35Z'));
    files[day03] = '12:00:30 AM Setting Min Wage: Helartia, 0, 95\n';
    const line = await awaitMarker(window, minWage, 1_000, 0, mockClock([0, 1]), noSleep);
    expect(line).toBe('12:00:30 AM Setting Min Wage: Helartia, 0, 95');
  });

  it('opens on the current day file even when handed the one preflight resolved before midnight', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-03T00:05:00Z') });
    files[day02] = '11:58:00 PM chatter\n';
    files[day03] = '12:04:00 AM chatter\n';
    const window = await openLogWindow(day02);
    expect(window.url).toBe(day03);
    expect(window.offset).toBe(files[day03].length);

    files[day03] += '12:05:10 AM Setting Min Wage: Helartia, 0, 95\n';
    const line = await awaitMarker(window, minWage, 1_000, 0, mockClock([0, 1]), noSleep);
    expect(line).toBe('12:05:10 AM Setting Min Wage: Helartia, 0, 95');
  });

  it('still refuses a matching line the old day file holds from before the window opened', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-02T23:59:50Z') });
    files[day02] = '11:59:40 PM chatter\n';
    const window = await openLogWindow(day02);
    files[day02] += '11:30:00 PM Setting Min Wage: Helartia, 0, 95\n';

    jest.setSystemTime(new Date('2026-10-03T00:00:35Z'));
    files[day03] = '12:00:30 AM unrelated chatter\n';
    const line = await awaitMarker(window, minWage, 5, 0, mockClock([0, 100]), noSleep);
    expect(line).toBeNull();
  });

  it('reads exactly as before when the day has not changed — one ranged GET, no listing', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-02T12:00:00Z') });
    files[day02] = '11:59:00 AM chatter\n';
    const window = await openLogWindow(day02);
    files[day02] += '12:00:05 PM Setting Min Wage: Helartia, 0, 95\n';
    fetchMock.mockClear();

    expect(await readSince(window)).toBe('12:00:05 PM Setting Min Wage: Helartia, 0, 95\n');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(day02, {
      headers: { Range: `bytes=${window.offset}-`, 'Accept-Encoding': 'identity' },
    });
  });

  it('returns the tail alone past midnight while the listing holds no newer file', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-02T23:59:50Z') });
    files[day02] = '11:59:40 PM chatter\n';
    const window = await openLogWindow(day02);
    files[day02] += '11:59:58 PM tail\n';
    jest.setSystemTime(new Date('2026-10-03T00:00:35Z'));
    expect(await readSince(window)).toBe('11:59:58 PM tail\n');
  });

  it('never merges the old file last line into the new file first line', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-03T00:00:35Z') });
    files[day02] = '11:59:40 PM chatter\n11:59:59 PM partial';
    files[day03] = '12:00:30 AM next\n';
    const window = { url: day02, offset: '11:59:40 PM chatter\n'.length, openedAt: '2026-10-02T23:59:50.000Z' };
    expect(await readSince(window)).toBe('11:59:59 PM partial\n12:00:30 AM next\n');
  });

  it('raises a failed read of the newer file', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-03T00:00:35Z') });
    files[day02] = 'x\n';
    files[day03] = 'y\n';
    const window = { url: day02, offset: 2, openedAt: '2026-10-02T23:59:50.000Z' };
    const route = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation(async (input, init) =>
      String(input) === day03 && init?.method !== 'HEAD' ? response({ ok: false, status: 500 }) : route(input, init),
    );
    await expect(readSince(window)).rejects.toThrow(/Log read failed \(500\)/);
  });

  it('counts a line from a file dated after the window day as later than the window', () => {
    const window = { url: day02, offset: 0, openedAt: '2026-10-02T23:58:00.000Z' };
    expect(loggedInWindow('12:00:30 AM Setting Min Wage: Helartia, 0, 95', window, day03)).toBe(true);
    expect(loggedInWindow('12:00:30 AM Setting Min Wage: Helartia, 0, 95', window, day02)).toBe(false);
    expect(loggedInWindow('12:00:30 AM Setting Min Wage: Helartia, 0, 95', window)).toBe(false);
  });
});
