/**
 * L1 — "Show Profile" over the wire it actually travels: HTTP to
 * `NewTycoon/TycoonCurriculum.asp`, with a `Tycoon` query parameter that names
 * somebody else.
 *
 * What `profile-finance-handler.test.ts` cannot say, and this can: the URL the
 * gateway builds and the page the server picks have to agree. The handler's own
 * suite mocks `fetchAspPage`, so it asserts the extra-params OBJECT, not the
 * query string that object becomes — and the object is merged into the session's
 * base params by `buildAspUrl` (`spo_session.ts:912-955`), which already carries
 * a `Tycoon` of its own. A merge that appended instead of replacing, or a
 * parameter spelled differently, would still satisfy the unit test and still
 * fetch the viewer's own page.
 *
 * So here the merge is reproduced faithfully, the URL goes through the real
 * `HttpMock`, and the scenario decides which page comes back purely from the
 * `Tycoon` parameter it finds.
 */

jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import { fetchCurriculumData } from '@/server/session/profile-finance-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import type { SessionContext } from '@/server/session/session-context';
import { HttpMock } from '../http-mock';
import { createTycoonProfileScenario, MOCK_RIVAL, MOCK_RIVAL_NAME } from './tycoon-profile-scenario';

const mockFetch = fetch as unknown as jest.MockedFunction<
  (url: string, init?: unknown) => Promise<Response>
>;

const WORLD_NAME = 'Shamba';
const WORLD_IP = '158.69.153.134';
const USERNAME = 'SPO_test3';

/** Every URL the gateway asked the mock for, in order. */
let requested: string[] = [];

/**
 * The base query of every ASP page (`spo_session.ts:912-923`), then
 * `params.set(k, v)` per extra (`:934-938`) — so an extra `Tycoon` REPLACES the
 * session's own rather than being appended beside it.
 */
function buildUrl(aspPath: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({
    Tycoon: USERNAME,
    Password: 'test3',
    Company: 'Yellow Inc.',
    WorldName: WORLD_NAME,
    DAAddr: WORLD_IP,
    DAPort: '7001',
    ISAddr: WORLD_IP,
    ISPort: '8000',
    ClientViewId: '0',
  });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
  }
  return `http://${WORLD_IP}/Five/0/Visual/Voyager/${aspPath}?${params.toString().replace(/\+/g, '%20')}`;
}

/** Point the gateway's ASP fetches and its avatar GET at the scenario. */
function serve(): FakeSessionCtx {
  const { http } = createTycoonProfileScenario();
  const httpMock = new HttpMock();
  httpMock.addScenario(http);
  requested = [];

  const answer = (url: string): Response => {
    const result = httpMock.match('GET', url, { worldName: WORLD_NAME, username: USERNAME });
    if (!result) {
      return { ok: false, status: 404, text: async () => '' } as unknown as Response;
    }
    return {
      ok: result.status === 200,
      status: result.status,
      text: async () => result.body,
    } as unknown as Response;
  };

  // The avatar GET goes straight through node-fetch (`:96-97`).
  mockFetch.mockImplementation(async (url: string) => answer(url));

  const fake = makeSessionCtx({
    currentWorldInfo: { name: WORLD_NAME, url: `http://${WORLD_IP}`, ip: WORLD_IP, port: 7000 },
    activeUsername: USERNAME, cachedPassword: 'test3',
    daAddr: WORLD_IP, daPort: 7001,
    currentCompany: { id: '28', name: 'Yellow Inc.' },
    accountMoney: '123456789', lastRanking: 42, lastBuildingCount: 13, lastMaxBuildings: 100,
  });

  (fake.ctx.buildAspUrl as jest.MockedFunction<SessionContext['buildAspUrl']>)
    .mockImplementation((aspPath, extraParams) => buildUrl(aspPath, extraParams));

  (fake.ctx.fetchAspPage as jest.MockedFunction<SessionContext['fetchAspPage']>)
    .mockImplementation(async (aspPath, extraParams) => {
      const url = buildUrl(aspPath, extraParams);
      requested.push(url);
      const response = answer(url);
      // `spo_session.ts:951-953` — a non-2xx is a throw, never parsed as data.
      if (!response.ok) throw new Error(`ASP request failed: ${response.status}`);
      return response.text();
    });

  return fake;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('tycoon-profile scenario — the Tycoon parameter picks the page', () => {
  it('a request for Rival fetches Tycoon=Rival and parses that page back', async () => {
    const fake = serve();

    const data = await fetchCurriculumData(fake.ctx, MOCK_RIVAL_NAME);

    // Both curriculum fetches — the profile's and the detail re-fetch.
    expect(requested).toHaveLength(2);
    for (const url of requested) {
      expect(new URL(url).searchParams.get('Tycoon')).toBe(MOCK_RIVAL_NAME);
    }

    expect(data).toMatchObject({
      tycoonName: MOCK_RIVAL_NAME,
      fortune: MOCK_RIVAL.fortune,
      averageProfit: MOCK_RIVAL.averageProfit,
      prestige: MOCK_RIVAL.prestige,
      nobPoints: MOCK_RIVAL.nobPoints,
      currentLevelName: MOCK_RIVAL.currentLevelName,
      currentLevelDescription: MOCK_RIVAL.currentLevelDescription,
      nextLevelName: MOCK_RIVAL.nextLevelName,
      nextLevelDescription: MOCK_RIVAL.nextLevelDescription,
      nextLevelRequirements: MOCK_RIVAL.nextLevelRequirements,
      rankings: MOCK_RIVAL.rankings,
      curriculumItems: MOCK_RIVAL.curriculumItems,
    });
    expect(data.cacheUnavailable).toBeUndefined();
  });

  it('withholds what the server withholds, and seeds nothing from the viewer', async () => {
    const fake = serve();

    const data = await fetchCurriculumData(fake.ctx, MOCK_RIVAL_NAME);

    // FullAccess=false: no upgrade checkbox on that page (`:250-261`).
    expect(data.canUpgrade).toBe(false);
    expect(data.isUpgradeRequested).toBe(false);
    // The pushes describe the session user, not Rival.
    expect(data).toMatchObject({ ranking: 0, facCount: 0, facMax: 0, budget: '0' });
    // Rival's reset/abandon links must not become the viewer's cached actions.
    expect(fake.ctx.setAspActionCache).not.toHaveBeenCalled();
  });

  it('proxies Rival\'s avatar from RenderTycoon.asp', async () => {
    const fake = serve();

    const data = await fetchCurriculumData(fake.ctx, MOCK_RIVAL_NAME);

    const renderUrl = mockFetch.mock.calls
      .map(c => c[0])
      .find(u => u.toLowerCase().includes('rendertycoon.asp'));
    expect(renderUrl).toBeDefined();
    expect(new URL(renderUrl!).searchParams.get('Tycoon')).toBe(MOCK_RIVAL_NAME);
    // The card is served, so the level badge of Rival's OWN page is what the
    // curriculum resolves — not a badge borrowed from the viewer's page.
    expect(data.currentLevelBadgeUrl).toContain(
      encodeURIComponent(`images/level${MOCK_RIVAL.currentLevelName}.gif`),
    );
  });

  it('the own request — no name, and the session\'s own name — reaches the owner page', async () => {
    const fake = serve();

    const noName = await fetchCurriculumData(fake.ctx);

    expect(requested).toHaveLength(2);
    for (const url of requested) {
      expect(new URL(url).searchParams.get('Tycoon')).toBe(USERNAME);
    }
    // The owner page carries the checkbox — the page the Curriculum tab reads today.
    expect(noName.canUpgrade).toBe(true);
    expect(noName.tycoonName).toBe(USERNAME);

    requested = [];
    const named = await fetchCurriculumData(fake.ctx, 'spo_TEST3');
    expect(named).toEqual(noName);
    expect(new URL(requested[0]).searchParams.get('Tycoon')).toBe(USERNAME);
  });

  it('a tycoon nobody serves reaches the 404 and resolves as unavailable', async () => {
    const fake = serve();

    const data = await fetchCurriculumData(fake.ctx, 'Nobody');

    expect(new URL(requested[0]).searchParams.get('Tycoon')).toBe('Nobody');
    expect(data).toMatchObject({ tycoonName: 'Nobody', cacheUnavailable: true });
  });
});
