import {
  LOG_MARKERS,
  awaitMarker,
  findCurrentSurvivalLog,
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
  it('records where the log currently ends', async () => {
    fetchMock.mockResolvedValueOnce(response({ headers: { 'content-length': '1024' } }));
    const window = await openLogWindow('http://logs/Survival.log');
    expect(window.offset).toBe(1024);
    expect(fetchMock).toHaveBeenCalledWith('http://logs/Survival.log', { method: 'HEAD' });
  });

  it('refuses a log that reports no length — the window would be meaningless', async () => {
    fetchMock.mockResolvedValueOnce(response({ headers: {} }));
    await expect(openLogWindow('http://logs/Survival.log')).rejects.toThrow(/content-length/);
  });

  it('surfaces an HTTP failure rather than assuming offset zero', async () => {
    fetchMock.mockResolvedValueOnce(response({ ok: false, status: 503 }));
    await expect(openLogWindow('http://logs/Survival.log')).rejects.toThrow(/503/);
  });
});

describe('readSince', () => {
  const window = { url: 'http://logs/Survival.log', offset: 10, openedAt: 'now' };

  it('asks only for the bytes appended since the window opened', async () => {
    fetchMock.mockResolvedValueOnce(response({ status: 206, body: 'tail' }));
    expect(await readSince(window)).toBe('tail');
    expect(fetchMock).toHaveBeenCalledWith(window.url, { headers: { Range: 'bytes=10-' } });
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
