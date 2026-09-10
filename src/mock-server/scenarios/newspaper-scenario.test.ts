jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

/**
 * The daily paper, driven across both of its pages by the real gateway handler.
 *
 * What this suite is for, and what `newspaper-handler.test.ts` cannot say: the
 * two pages have to agree. The bar names the folders; the folder name builds
 * the URL of the issue page. A folder read off the wrong cell, sorted the wrong
 * way, or escaped the wrong way still parses fine on its own page and then
 * fetches nothing — so the fixture serves the bar and the issue pages together
 * and the handler is asked to walk from one to the other, exactly as the client
 * does.
 */

import http from 'http';
import { EventEmitter } from 'events';
import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import { getNewspaperIssues, getNewspaperIssue } from '@/server/session/newspaper-handler';
import type { NewspaperTarget } from '@/server/session/newspaper-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { SearchMenuService } from '@/server/search-menu-service';
import { parseNewspapersPage } from '@/server/search-menu-parser';
import { HttpMock } from '../http-mock';
import {
  createNewspaperScenario,
  MOCK_ISSUES,
  MOCK_ISSUE_FOLDERS,
  MOCK_PAPER_NAME,
  MOCK_DIRECTORY_PAPERS,
  NEWS_PATH,
  DIRECTORY_PATH,
} from './newspaper-scenario';

const mockFetch = fetch as unknown as jest.MockedFunction<
  (url: string, init?: unknown) => Promise<Response>
>;

const TARGET: NewspaperTarget = {
  paperName: MOCK_PAPER_NAME,
  townName: 'Shamba',
  isCapitol: false,
  buildingX: 100,
  buildingY: 200,
};

/** Point the gateway's fetch at the scenario's HTTP mock. */
function serve(opts: { issues?: string[] } = {}): FakeSessionCtx {
  const { http } = createNewspaperScenario(undefined, opts);
  const httpMock = new HttpMock();
  httpMock.addScenario(http);

  mockFetch.mockImplementation(async (url: string) => {
    const result = httpMock.match('GET', url, { worldName: 'Shamba' });
    if (!result) {
      return { ok: false, status: 404, text: async () => '' } as unknown as Response;
    }
    return {
      ok: result.status === 200,
      status: result.status,
      text: async () => result.body,
    } as unknown as Response;
  });

  return makeSessionCtx({
    currentWorldInfo: { name: 'Shamba', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 7000 },
    activeUsername: 'SPO_test3', cachedPassword: 'test3',
    daAddr: '158.69.153.134', daPort: 7001,
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('newspaper scenario — the matcher serves both pages', () => {
  it('answers the bar and every issue, and 404s a folder nobody printed', async () => {
    const { http } = createNewspaperScenario();
    const httpMock = new HttpMock();
    httpMock.addScenario(http);

    const bar = httpMock.match(
      'GET',
      `${NEWS_PATH}/showbar.asp?WorldName=Shamba&PaperName=${encodeURIComponent(MOCK_PAPER_NAME)}`,
    );
    expect(bar?.status).toBe(200);

    for (const folder of MOCK_ISSUE_FOLDERS) {
      const path = `${NEWS_PATH}/Newspapers/Shamba/Shamba%20Daily/${encodeURIComponent(folder)}/home.asp`;
      expect(httpMock.match('GET', `${path}?Tycoon=SPO_test3`)?.status).toBe(200);
    }

    const unknown = httpMock.match(
      'GET',
      `${NEWS_PATH}/Newspapers/Shamba/Shamba%20Daily/000000000001%401-1-2020/home.asp?Tycoon=SPO_test3`,
    );
    expect(unknown?.status).toBe(404);
  });
});

describe('newspaper scenario — the gateway reads it', () => {
  it('decodes the folder names to dates, newest first — not in page order', async () => {
    const fake = serve();
    const list = await getNewspaperIssues(fake.ctx, TARGET);

    expect(list.error).toBe('');
    // `ShowBar.asp:14-31` semantics: the date is what follows the `@`, with
    // every `-` turned into a `/`.
    expect(list.issues).toEqual(MOCK_ISSUES);
    expect(list.issues.map(i => i.date)).toEqual(['3/1/2027', '2/28/2027', '2/27/2027']);
  });

  it('opens the newest issue: its masthead, its stories, and no markup', async () => {
    const fake = serve();
    const issue = await getNewspaperIssue(fake.ctx, TARGET, MOCK_ISSUE_FOLDERS[0]);

    expect(issue.error).toBe('');
    expect(issue.folder).toBe(MOCK_ISSUE_FOLDERS[0]);
    expect(issue.townName).toBe('Shamba');
    expect(issue.title).toBe(MOCK_PAPER_NAME);
    expect(issue.date).toBe('Monday, March 01, 2027');
    expect(issue.stories.length).toBeGreaterThan(0);
    expect(issue.stories[0].headline).toBe('Domestic Wars!');
    expect(issue.stories[0].body).not.toContain('<');
    expect(issue.stories[0].body).toContain('One person died');
    // `michelangelo.story:15-17` — the byline only some stories carry.
    expect(issue.stories.some(s => s.byline !== '')).toBe(true);
  });

  it('a second folder opens its own issue, not the newest one again', async () => {
    const fake = serve();
    const issue = await getNewspaperIssue(fake.ctx, TARGET, MOCK_ISSUE_FOLDERS[1]);
    expect(issue.error).toBe('');
    expect(issue.date).toBe('Sunday, February 28, 2027');
    expect(issue.stories[0].headline).toBe('Health system awarded');
  });

  // The whole point of driving both pages: the URL the handler builds from a
  // folder name has to be the one the fixture serves, escapes and all.
  it('builds the issue URL the redirect of ShowPaper.asp:30 names', async () => {
    const fake = serve();
    await getNewspaperIssue(fake.ctx, TARGET, MOCK_ISSUE_FOLDERS[0]);
    expect(mockFetch.mock.calls[0][0]).toBe(
      'http://158.69.153.134/Five/0/Visual/News/Newspapers/Shamba/Shamba%20Daily'
      + '/002147483640%403-1-2027/home.asp?Tycoon=SPO_test3',
    );
  });

  it('a folder the paper does not keep fails loudly', async () => {
    const fake = serve();
    const issue = await getNewspaperIssue(fake.ctx, TARGET, '000000000001@1-1-2020');
    expect(issue.error).toBe('The newspaper answered HTTP 404.');
  });

  // The paper that has printed nothing yet: an empty bar, and NOT an error —
  // `ShowPaper.asp:10-24` answers it with the connecting page.
  it('a paper with no issue yields an empty list and no error', async () => {
    const fake = serve({ issues: [] });
    const list = await getNewspaperIssues(fake.ctx, TARGET);
    expect(list).toEqual({ paperName: MOCK_PAPER_NAME, issues: [], error: '' });
  });
});

/** Point Node's `http.request` (what `SearchMenuService.fetchPage` calls) at the scenario's HttpMock. */
function mockHttpRequest(httpMock: HttpMock): jest.SpyInstance {
  return jest.spyOn(http, 'request').mockImplementation(((
    options: http.RequestOptions,
    callback?: (res: EventEmitter & { statusCode?: number }) => void,
  ) => {
    const req = new EventEmitter() as unknown as http.ClientRequest;
    Object.assign(req, {
      end: () => {
        const result = httpMock.match('GET', String(options.path), { worldName: 'Shamba' });
        const res = new EventEmitter() as EventEmitter & { statusCode?: number };
        res.statusCode = result?.status ?? 404;
        callback?.(res);
        res.emit('data', result?.body ?? '');
        res.emit('end');
      },
      setTimeout: () => req,
      destroy: () => {},
    });
    return req;
  }) as unknown as typeof http.request);
}

describe('newspaper scenario — the directory Media listing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('serves one entry per paper with its town name', () => {
    const { http: httpScenario } = createNewspaperScenario();
    const httpMock = new HttpMock();
    httpMock.addScenario(httpScenario);

    const result = httpMock.match('GET', `${DIRECTORY_PATH}/Newspapers.asp?WorldName=Shamba&RIWS=`);
    expect(result?.status).toBe(200);
    expect(parseNewspapersPage(result!.body)).toEqual(MOCK_DIRECTORY_PAPERS);
  });

  it('the real SearchMenuService.getNewspapers() resolves one entry per paper with its town name', async () => {
    const { http: httpScenario } = createNewspaperScenario();
    const httpMock = new HttpMock();
    httpMock.addScenario(httpScenario);
    mockHttpRequest(httpMock);

    const service = new SearchMenuService('158.69.153.134', 8000, 'Shamba', 'SPO_test3', 'Co', '158.69.153.134', 7001);
    const result = await service.getNewspapers();
    expect(result).toEqual(MOCK_DIRECTORY_PAPERS);
  });

  it('a world with no newspapers resolves to []', async () => {
    const { http: httpScenario } = createNewspaperScenario(undefined, { papers: [] });
    const httpMock = new HttpMock();
    httpMock.addScenario(httpScenario);
    mockHttpRequest(httpMock);

    const service = new SearchMenuService('158.69.153.134', 8000, 'Shamba', 'SPO_test3', 'Co', '158.69.153.134', 7001);
    const result = await service.getNewspapers();
    expect(result).toEqual([]);
  });
});
