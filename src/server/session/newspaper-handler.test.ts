/**
 * newspaper-handler — the town paper's two halves, scraped.
 *
 * The board: two reads of `Visual/News/boardmsg.asp` and one form POST. The
 * paper: one read of `ShowBar.asp` for the issue list, one of an issue's own
 * `home.asp` for its stories.
 *
 * There is no RDO in either: the board is a `NewsBoard.NewsObject` COM tree and
 * the paper is a folder of generated pages, both reachable only through IIS —
 * which is why "Rate the Mayor" navigates to `boardreader.asp`
 * (`Voyager/TownHallSheet.pas:343`) and "Read News" to `newsreader.asp` (`:361`)
 * rather than calling anything.
 *
 * The fixtures below are instantiated from the pages under
 * `IIS_ROOT/Five/0/Visual/News/`, not from the parsers.
 */

jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import {
  parseNewspaperIndex,
  parseNewspaperArticle,
  getNewspaperBoard,
  postNewspaperColumn,
  decodeIssueDate,
  parseNewspaperIssueList,
  parseNewspaperIssue,
  getNewspaperIssues,
  getNewspaperIssue,
  isBoardRoot,
  type NewspaperTarget,
} from './newspaper-handler';
import { makeSessionCtx } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '../__tests__/session/fake-session-context';
import type { SessionContext } from './session-context';
import type { WorldInfo } from '../../shared/types';

const mockFetch = fetch as unknown as jest.MockedFunction<
  (url: string, init?: unknown) => Promise<Response>
>;

function htmlResponse(body: string, status = 200): Response {
  return { status, ok: status === 200, text: async () => body } as unknown as Response;
}

const WORLD: WorldInfo = { name: 'Planitia', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 7000 };

const TARGET: NewspaperTarget = {
  paperName: 'Helartia Herald',
  townName: 'Helartia',
  isCapitol: false,
  buildingX: 118,
  buildingY: 226,
};

const ROOT = 'boards\\Planitia\\Helartia Herald\\';

function makeWebCtx(overrides: Partial<SessionContext> = {}): FakeSessionCtx {
  return makeSessionCtx({
    currentWorldInfo: WORLD, activeUsername: 'SPO_test3', cachedPassword: 'test3',
    daAddr: '10.0.0.5', daPort: 1111, ...overrides,
  });
}

function queryOf(n: number): URLSearchParams {
  const url = mockFetch.mock.calls[n][0];
  return new URLSearchParams(url.substring(url.indexOf('?') + 1));
}

beforeEach(() => {
  mockFetch.mockReset();
});

// =============================================================================
// ASP FIXTURES
// =============================================================================

/**
 * `boardmsg.asp:186-225` — `RenderGlobal`, the "Latest 10 columns" index, plus
 * the welcome block `:262-272` that surrounds it on the folder page.
 */
function indexPage(entries: Array<{ author: string; subject: string; summary: string; path: string }>): string {
  const rows = entries.map(({ author, subject, summary, path }) => [
    '\t\t\t\t\t<tr>',                                                   // :203
    '\t\t\t\t\t\t<td valign="bottom">',
    `\t\t\t\t\t\t\t<div class=author><b>${author}</b></div>`,           // :205
    '\t\t\t\t\t\t</td>',
    '\t\t\t\t\t\t<td width=10>',
    '\t\t\t\t\t\t</td>',
    '\t\t\t\t\t\t<td valign="top">',
    `\t\t\t\t\t\t\t<a target="BoardMain" href="BoardMsg.asp?root=${ROOT}&path=${encodeURIComponent(path)}&TownName=Helartia&WorldName=Planitia&tycoon=SPO_test3&PaperName=Helartia%20Herald&DAAddr=10.0.0.5&DAPort=1111">${subject}</a>`,
    '\t\t\t\t\t\t</td>',
    '\t\t\t\t\t</tr>',
    '\t\t\t\t\t<tr>',                                                   // :214
    '\t\t\t\t\t\t<td colspan=2>',
    '\t\t\t\t\t\t</td>',
    `\t\t\t\t\t\t<td class=comment>${summary}</td>`,                    // :217
    '\t\t\t\t\t</tr>',
  ].join('\n')).join('\n');

  return [
    '\t<img id=picture style="display: none">',                         // :263
    "\t<h1>Welcome to the Helartia Herald's editorial section</h1>",     // :264
    '\t<div class=message style="width: 400">',
    '\t  Click on the links at the left to read the columns published by your fellow investors.',
    '\t</div>',
    '\t<h2>"Latest 10 columns:"</h2>',                                  // :269
    '\t\t<div style="margin-left: 20px">',                              // :194
    '\t\t\t<table cellspacing=0 cellpading=0>',
    rows,
    '\t\t\t</table>',
    '\t\t</div>',
    '<div style="margin-top: 20px">',                                   // :280 — the form block
    '\t<input id=showForm type=button value="Post a column" onClick="showForm()">',
    '</div>',
  ].join('\n');
}

/**
 * `boardmsg.asp:231-259` — one open column, with `RenderLevel` replies
 * (`:167-182`) below it.
 */
function articlePage(opts: {
  subject: string;
  author: string;
  authorDesc?: string;
  body: string;
  replies?: Array<{ author: string; subject: string; summary: string; path: string }>;
  parentPath?: string;
}): string {
  const { subject, author, authorDesc = '', body, replies = [], parentPath = '' } = opts;
  const replyBlock = replies.map((r) => [
    '\t\t\t\t<div style="margin-top: 5px">',                            // :169
    `\t\t\t\t\t<b>${r.author}</b> - <a href="boardmsg.asp?root=${ROOT}&path=${encodeURIComponent(r.path)}&TownName=Helartia&WorldName=Planitia&tycoon=SPO_test3&DAAddr=10.0.0.5&DAPort=1111"> ${r.subject}</a><br>`,
    '\t\t\t\t</div>',
    '\t\t\t\t<div class=comment style="margin-left: 20px">',            // :172
    `\t\t\t\t\t${r.summary}...`,
    '\t\t\t\t</div>',
    '\t\t\t\t<div style="margin-left: 20px">',
    '\t\t\t\t</div>',
  ].join('\n')).join('\n');

  return [
    '\t\t<div style="text-align: right; border-style-bottom: solid; border-style-size: 1;">',
    '\t\t\t<a href="boardmsg.asp?root=' + ROOT + '&path=' + encodeURIComponent(parentPath) + '&tycoon=SPO_test3">',
    '\t\t\t\t<img src="images\\up.gif" width=36 height=30 border=0></a>',
    '\t\t</div>',
    '\t\t<table>',                                                      // :242
    '\t\t\t<tr>',
    '\t\t\t\t<td valign="top">',
    `\t\t\t\t\t<img id=picture src="/fivedata/userinfo/Planitia/${author}/largephoto.jpg" width=75 height=100>`,
    '\t\t\t\t</td>',
    '\t\t\t\t<td valign="top">',
    '\t\t\t\t\t<div class=message>',                                    // :249
    '\t\t\t\t\t\t<div class=title>',
    `\t\t\t\t\t\t\t${subject}`,
    '\t\t\t\t\t\t</div>',
    '\t\t\t\t\t\t<div class=author>',
    `\t\t\t\t\t\t\tBy ${author}</b> ${authorDesc}`,                     // :258
    '\t\t\t\t\t\t</div>',
    '\t\t\t\t\t\t<br>',
    `\t\t\t\t\t${body}`,                                                // :255 — NewsObj.BodyHTML
    '\t\t\t\t\t</div>',
    '\t\t\t\t</td>',
    '\t\t\t</tr>',
    '\t\t</table>',
    ...(replies.length > 0 ? ['\t\t<h2>Replies:</h2>', replyBlock] : []),
  ].join('\n');
}

// =============================================================================
// parseNewspaperIndex
// =============================================================================
describe('parseNewspaperIndex', () => {
  it('reads author, subject, summary and path from each index entry', () => {
    expect(parseNewspaperIndex(indexPage([
      { author: 'SPO_test3', subject: 'VERY NICE GUY', summary: 'VOTE FOR HIM', path: 'msg1.five' },
      { author: 'Innos', subject: 'Roads', summary: 'We need more', path: 'msg2.five' },
    ]))).toEqual([
      { author: 'SPO_test3', subject: 'VERY NICE GUY', summary: 'VOTE FOR HIM', path: 'msg1.five' },
      { author: 'Innos', subject: 'Roads', summary: 'We need more', path: 'msg2.five' },
    ]);
  });

  it('decodes a path carrying an escaped space', () => {
    const [entry] = parseNewspaperIndex(indexPage([
      { author: 'A', subject: 'S', summary: 'x', path: 'sub folder\\m.five' },
    ]));
    expect(entry.path).toBe('sub folder\\m.five');
  });

  it('drops an entry whose link carries no path — it opens nothing', () => {
    const html = indexPage([{ author: 'A', subject: 'S', summary: 'x', path: 'm.five' }])
      .replace('path=m.five', 'other=m.five');
    expect(parseNewspaperIndex(html)).toEqual([]);
  });

  it('an empty board yields an empty list', () => {
    expect(parseNewspaperIndex(indexPage([]))).toEqual([]);
  });

  it('returns nothing for a page carrying no index', () => {
    expect(parseNewspaperIndex('<html><body>Nothing here</body></html>')).toEqual([]);
  });

  it('strips the ellipsis the summary is printed with', () => {
    const [entry] = parseNewspaperIndex(indexPage([
      { author: 'A', subject: 'S', summary: 'A long column...', path: 'm.five' },
    ]));
    expect(entry.summary).toBe('A long column');
  });
});

// =============================================================================
// parseNewspaperArticle
// =============================================================================
describe('parseNewspaperArticle', () => {
  it('reads the subject, the byline and the body of an open column', () => {
    const article = parseNewspaperArticle(articlePage({
      subject: 'VERY NICE GUY',
      author: 'SPO_test3',
      authorDesc: 'of Yellow Inc.',
      body: 'VOTE FOR HIM',
    }));
    expect(article).toEqual({
      subject: 'VERY NICE GUY',
      byline: 'By SPO_test3 of Yellow Inc.',
      body: 'VOTE FOR HIM',
      replies: [],
      parentPath: '',
      photoUrl: '/fivedata/userinfo/Planitia/SPO_test3/largephoto.jpg',
    });
  });

  // `boardmsg.asp:236-237` — the Up link carries the parent column's own path
  // for a reply, and the board root for a top-level column.
  it('reads the parent path of the Up link for a reply', () => {
    const parentPath = 'C:\\news\\boards\\Planitia\\Helartia Herald\\m1.five\\';
    const article = parseNewspaperArticle(articlePage({
      subject: 'S', author: 'A', body: 'B', parentPath,
    }));
    expect(article?.parentPath).toBe(parentPath);
  });

  // The root-page half of the criterion: no article at all, so no parent path.
  it('yields no parent path for the index (root) page', () => {
    const article = parseNewspaperArticle(indexPage([
      { author: 'A', subject: 'S', summary: 'x', path: 'm.five' },
    ]));
    expect(article?.parentPath).toBeUndefined();
  });

  // `:263` — the index page's own `<img id=picture>` has no `src`; a column
  // page that somehow carries none either should not crash the parser.
  it('yields an empty photo URL when the picture tag has no src', () => {
    const html = articlePage({ subject: 'S', author: 'A', body: 'B' })
      .replace(/<img id=picture src="[^"]*"[^>]*>/, '<img id=picture style="display: none">');
    const article = parseNewspaperArticle(html);
    expect(article?.photoUrl).toBe('');
  });

  // `NewsObj.BodyHTML` (`:255`) is markup other players typed. This client has no
  // sanitiser, so nothing may leave the gateway as markup.
  it('strips the markup of a body — the client is never handed HTML', () => {
    const article = parseNewspaperArticle(articlePage({
      subject: 'S', author: 'A',
      body: '<b>Bold</b><script>alert(1)</script><br>Second line',
    }));
    expect(article?.body).not.toContain('<');
    expect(article?.body).not.toContain('script');
    expect(article?.body).toContain('Bold');
    expect(article?.body).toContain('Second line');
  });

  it('decodes the entities the board escapes', () => {
    const article = parseNewspaperArticle(articlePage({
      subject: 'S', author: 'A', body: 'Taxes &amp; jobs &lt;now&gt;',
    }));
    expect(article?.body).toBe('Taxes & jobs <now>');
  });

  it('reads the replies of an open column', () => {
    const article = parseNewspaperArticle(articlePage({
      subject: 'S', author: 'A', body: 'B',
      replies: [
        { author: 'Bob', subject: 'Agreed', summary: 'Well said', path: 'r1.five' },
        { author: 'Eve', subject: 'Nonsense', summary: 'I disagree', path: 'r2.five' },
      ],
    }));
    expect(article?.replies).toEqual([
      { author: 'Bob', subject: 'Agreed', summary: 'Well said', path: 'r1.five' },
      { author: 'Eve', subject: 'Nonsense', summary: 'I disagree', path: 'r2.five' },
    ]);
  });

  // `:231` renders the article block only when `NewsObj.Open(path) = 0` AND the
  // node is not `FolderOnly` — the index page is the other branch.
  it('returns null for the index page', () => {
    expect(parseNewspaperArticle(indexPage([
      { author: 'A', subject: 'S', summary: 'x', path: 'm.five' },
    ]))).toBeNull();
  });

  it('a column with no byline still reads its subject and body', () => {
    const html = articlePage({ subject: 'S', author: 'A', body: 'B' })
      .replace('<div class=author>', '<div class=other>');
    const article = parseNewspaperArticle(html);
    expect(article?.subject).toBe('S');
    expect(article?.byline).toBe('');
    expect(article?.body).toContain('B');
  });
});

// =============================================================================
// isBoardRoot
// =============================================================================
describe('isBoardRoot', () => {
  const root = 'boards\\Planitia\\Helartia Herald\\';

  it('treats an empty parent path as the root', () => {
    expect(isBoardRoot('', root)).toBe(true);
  });

  it('treats the relative root, with or without a trailing backslash, as the root', () => {
    expect(isBoardRoot(root, root)).toBe(true);
    expect(isBoardRoot(root.replace(/\\$/, ''), root)).toBe(true);
  });

  it('treats the globalized root, case-insensitively, as the root', () => {
    const globalized = 'C:\\news\\BOARDS\\Planitia\\Helartia Herald\\';
    expect(isBoardRoot(globalized, root)).toBe(true);
  });

  it('does not treat a column under the root as the root', () => {
    expect(isBoardRoot(root + 'm1.five\\', root)).toBe(false);
  });
});

// =============================================================================
// getNewspaperBoard
// =============================================================================
describe('getNewspaperBoard', () => {
  it('reads the index with top=TRUE and the board root, %20-encoded', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(indexPage([
      { author: 'SPO_test3', subject: 'VERY NICE GUY', summary: 'VOTE FOR HIM', path: 'm1.five' },
    ])));

    const board = await getNewspaperBoard(fake.ctx, TARGET);

    const url = mockFetch.mock.calls[0][0];
    expect(url).toMatch(/^http:\/\/158\.69\.153\.134\/Five\/0\/Visual\/News\/boardmsg\.asp\?/);
    expect(url).not.toContain('+');
    const q = queryOf(0);
    expect(q.get('top')).toBe('TRUE');
    expect(q.get('root')).toBe(ROOT);
    expect(q.get('path')).toBe(ROOT);
    expect(q.get('PaperName')).toBe('Helartia Herald');
    expect(q.get('TownName')).toBe('Helartia');
    expect(q.get('WorldName')).toBe('Planitia');
    expect(q.get('DAAddr')).toBe('10.0.0.5');
    expect(q.get('DAPort')).toBe('1111');

    expect(board.root).toBe(ROOT);
    expect(board.path).toBe(ROOT);
    expect(board.columns).toHaveLength(1);
    expect(board.article).toBeNull();
    expect(board.error).toBe('');
  });

  // `boardmsg.asp:10` reads `Tycoon`; the Politics pages read `TycoonName`.
  // Sending the wrong one posts as an empty author, which `:93` rejects.
  it('names the reader `Tycoon`, not `TycoonName`', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(''));
    await getNewspaperBoard(fake.ctx, TARGET);
    expect(queryOf(0).get('Tycoon')).toBe('SPO_test3');
    expect(queryOf(0).get('TycoonName')).toBeNull();
  });

  it('opens one column when a path is given', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(articlePage({
      subject: 'Roads', author: 'Innos', body: 'More of them',
    })));

    const board = await getNewspaperBoard(fake.ctx, TARGET, 'm1.five');

    expect(queryOf(0).get('path')).toBe('m1.five');
    expect(board.path).toBe('m1.five');
    expect(board.article?.subject).toBe('Roads');
    // `RenderGlobal` is not called on a column page (`:266-272`), so the index
    // is legitimately empty here rather than missing.
    expect(board.columns).toEqual([]);
  });

  // The parser reads the parent path exactly as printed; the transport is
  // what decides a top-level column's parent (the board root) means "none".
  // The portrait must come back through the image proxy — a raw cross-origin
  // `http://<worldIp>/…` URL is blocked by the gateway's own CSP (`img-src
  // 'self' data: blob:`), same as the mail stamp (`mail-handlers.ts:54`).
  it('keeps the parent path of a reply and resolves the photo through the proxy', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(articlePage({
      subject: 'Agreed', author: 'Bob', body: 'Well said', parentPath: 'm1.five',
    })));

    const board = await getNewspaperBoard(fake.ctx, TARGET, 'm1.five\\r1.five');

    expect(board.article?.parentPath).toBe('m1.five');
    expect(board.article?.photoUrl).toBe(
      '/proxy-image?url=' + encodeURIComponent('http://158.69.153.134/fivedata/userinfo/Planitia/Bob/largephoto.jpg'),
    );
  });

  it('clears the parent path of a top-level column whose Up link points at the board root', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(articlePage({
      subject: 'Roads', author: 'Innos', body: 'More of them', parentPath: ROOT,
    })));

    const board = await getNewspaperBoard(fake.ctx, TARGET, 'm1.five');

    expect(board.article?.parentPath).toBe('');
  });

  it('a Capitol board carries Capitol=YES with x/y and an empty TownName', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(''));
    await getNewspaperBoard(fake.ctx, { ...TARGET, isCapitol: true });
    const q = queryOf(0);
    expect(q.get('Capitol')).toBe('YES');
    expect(q.get('x')).toBe('118');
    expect(q.get('y')).toBe('226');
    expect(q.get('TownName')).toBe('');
  });

  it('refuses when the DA lock channel is unset, rather than falling back to the directory host/port', async () => {
    const fake = makeWebCtx({ activeUsername: null, cachedUsername: 'Cached', daAddr: null, daPort: null });
    mockFetch.mockResolvedValue(htmlResponse(''));
    const result = await getNewspaperBoard(fake.ctx, TARGET);
    expect(result.error).toBe('ASP call refused: DA lock channel not announced yet (daAddr/daPort unset)');
  });

  it('reports an HTTP failure instead of parsing the error body', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse('<html><title>404</title></html>', 404));

    const board = await getNewspaperBoard(fake.ctx, TARGET);

    expect(board.error).toBe('The newspaper answered HTTP 404.');
    expect(board.columns).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('board answered HTTP 404'));
  });

  it('reports a transport failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const board = await getNewspaperBoard(fake.ctx, TARGET);
    expect(board.error).toBe('ECONNREFUSED');
    expect(fake.log.warn).toHaveBeenCalledWith('[Newspaper] Board read failed: ECONNREFUSED');
  });

  it('does not fetch when the world is unknown', async () => {
    const fake = makeWebCtx({ currentWorldInfo: null });
    const board = await getNewspaperBoard(fake.ctx, TARGET);
    expect(board.error).toBe('Not connected to a world.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // A town with no paper has no board tree: `boards\<World>\\` would be the
  // world's own folder, and reading it is meaningless rather than empty.
  it('does not fetch when the town has no newspaper', async () => {
    const fake = makeWebCtx();
    const board = await getNewspaperBoard(fake.ctx, { ...TARGET, paperName: '' });
    expect(board.error).toBe('This town has no newspaper.');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// postNewspaperColumn
// =============================================================================
describe('postNewspaperColumn', () => {
  const POSTED = indexPage([
    { author: 'SPO_test3', subject: 'VERY NICE GUY', summary: 'VOTE FOR HIM', path: 'm1.five' },
  ]);

  it('posts a form body with action=post and Reply=NO for a new column', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(POSTED));

    const result = await postNewspaperColumn(fake.ctx, TARGET, 'VERY NICE GUY', 'VOTE FOR HIM');

    const [, init] = mockFetch.mock.calls[0];
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const form = new URLSearchParams((init as { body: string }).body);
    expect(form.get('Subject')).toBe('VERY NICE GUY');
    expect(form.get('Body')).toBe('VOTE FOR HIM');
    // `:87` compares to the literal "YES"; anything else posts at the root.
    expect(form.get('Reply')).toBe('NO');

    const q = queryOf(0);
    expect(q.get('action')).toBe('post');
    expect(q.get('path')).toBe(ROOT);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Column published');
    expect(result.board?.columns).toHaveLength(1);
  });

  it('posts a reply under the open column with Reply=YES', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(POSTED));

    await postNewspaperColumn(fake.ctx, TARGET, 'VERY NICE GUY', 'me too', 'm1.five');

    const form = new URLSearchParams((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(form.get('Reply')).toBe('YES');
    expect(queryOf(0).get('path')).toBe('m1.five');
  });

  // `:87-91` — `parentPath` is the root when `Reply` is not YES, so a reply
  // whose path IS the root is a top-level post, not a reply to the folder.
  it('treats a reply to the board root as a new column', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(POSTED));
    await postNewspaperColumn(fake.ctx, TARGET, 'VERY NICE GUY', 'x', ROOT);
    const form = new URLSearchParams((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(form.get('Reply')).toBe('NO');
  });

  // The page answers 200 whether or not it posted (`:94` drops a subject-less
  // post silently), so the re-rendered index is the only oracle.
  it('reports failure when the column is absent from the re-rendered index', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(indexPage([])));

    const result = await postNewspaperColumn(fake.ctx, TARGET, 'VERY NICE GUY', 'x');

    expect(result.success).toBe(false);
    expect(result.message).toBe('The newspaper did not publish the column.');
    // The board still travels: it is the current state of the page.
    expect(result.board).not.toBeNull();
  });

  it('matches the published column on author AND subject', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(indexPage([
      { author: 'SomeoneElse', subject: 'VERY NICE GUY', summary: 'x', path: 'm1.five' },
    ])));
    const result = await postNewspaperColumn(fake.ctx, TARGET, 'VERY NICE GUY', 'x');
    expect(result.success).toBe(false);
  });

  it('refuses a subject-less post without reaching the server', async () => {
    const fake = makeWebCtx();
    const result = await postNewspaperColumn(fake.ctx, TARGET, '   ', 'body');
    expect(result).toEqual({ success: false, message: 'A column needs a subject.', board: null });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses to post with no signed-in author — `:93` would drop it silently', async () => {
    const fake = makeWebCtx({ activeUsername: null, cachedUsername: null });
    const result = await postNewspaperColumn(fake.ctx, TARGET, 'S', 'B');
    expect(result).toEqual({ success: false, message: 'Not signed in.', board: null });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not post when the world is unknown', async () => {
    const fake = makeWebCtx({ currentWorldInfo: null });
    const result = await postNewspaperColumn(fake.ctx, TARGET, 'S', 'B');
    expect(result.message).toBe('Not connected to a world.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not post when the town has no newspaper', async () => {
    const fake = makeWebCtx();
    const result = await postNewspaperColumn(fake.ctx, { ...TARGET, paperName: '' }, 'S', 'B');
    expect(result.message).toBe('This town has no newspaper.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports an HTTP failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse('', 500));
    const result = await postNewspaperColumn(fake.ctx, TARGET, 'S', 'B');
    expect(result).toEqual({ success: false, message: 'The newspaper answered HTTP 500.', board: null });
  });

  it('reports a transport failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));
    const result = await postNewspaperColumn(fake.ctx, TARGET, 'S', 'B');
    expect(result).toEqual({ success: false, message: 'ECONNRESET', board: null });
    expect(fake.log.warn).toHaveBeenCalledWith('[Newspaper] Post failed: ECONNRESET');
  });
});

// =============================================================================
// THE DAILY PAPER — `ShowBar.asp` and an issue's `home.asp`
// =============================================================================

const NEWEST = '002147483640@3-1-2027';
const MIDDLE = '002147483641@2-28-2027';
const OLDEST = '002147483642@2-27-2027';

/**
 * `ShowBar.asp:74-162` — the issue row. `selectedIdx` picks which cell gets the
 * `selectedDate` treatment (`:89-94`); every other cell is a link (`:98-102`).
 */
function barPage(folders: string[], selectedIdx = 0): string {
  const cells = folders.map((folder, i) => i === selectedIdx
    ? [
      '\t\t\t\t\t<td class=selectedDate>',
      `\t\t\t\t\t\t${decodeIssueDate(folder)}`,
      '\t\t\t\t\t</td>',
      '\t\t\t\t\t<script language="JScript">',
      `\t\t\t\t\t\tselected = "${folder}";`,
      '\t\t\t\t\t</script>',
    ].join('\n')
    : [
      '\t\t\t\t\t<td class=normalDate>',
      `\t\t\t\t\t\t<a href="showbar.asp?WorldName=Planitia&TownName=Helartia&Selected=${folder}&PaperName=Helartia%20Herald&Tycoon=SPO_test3&DAAddr=10.0.0.5&DAPort=1111">`,
      `\t\t\t\t\t\t\t${decodeIssueDate(folder)}`,
      '\t\t\t\t\t\t</a>',
      '\t\t\t\t\t</td>',
    ].join('\n'));

  return [
    '<html>',
    '\t<head>',
    '\t\t<script language="JavaScript">',
    '\t\t\tvar selected = "";',                                 // `:48` — names no folder
    '\t\t</script>',
    '\t</head>',
    '\t<body onLoad="onPageLoad()">',
    '\t\t<table><tr>',
    ...cells,
    '\t\t</tr></table>',
    '\t\t<td class=button onClick="onBoardBtnClick()">READ COLUMNS</td>',
    '\t\t<td class=button onClick="onNewsBtnClick()">READ NEWS</td>',
    '\t</body>',
    '</html>',
  ].join('\n');
}

/** One story block — `domesticwars.story:5-9`, byline as `michelangelo.story:15-17`. */
function storyBlock(headline: string, byline: string, body: string): string {
  return [
    '\t\t\t<h2>',
    `\t\t\t\t${headline}`,
    '\t\t\t</h2>',
    ...(byline === '' ? [] : [
      '\t\t\t<div class=author>',
      `\t\t\t\t${byline}`,
      '\t\t\t</div>',
    ]),
    '\t\t\t<div class=articleBody>',
    `\t\t\t\t${body}`,
    '\t\t\t</div>',
  ].join('\n');
}

/**
 * An issue's `home.asp`, IIS-processed: `News.pas:750-759` wraps the style's
 * header (`standard.header:7-19`) and a layout of stories.
 */
function issuePage(opts: {
  town?: string;
  title?: string;
  date?: string;
  stories?: string[];
  pgi?: boolean;
} = {}): string {
  const {
    town = 'Helartia',
    title = 'Helartia Herald',
    date = 'Monday, March 01, 2027',
    stories = [storyBlock('Domestic Wars!', '', 'One person died last night.')],
    pgi = false,
  } = opts;

  return [
    '<html>',
    '\t<head><link rel="stylesheet" href="../../../../styles/standard/standard.css"></head>',
    '\t<body>',
    '\t\t<table width=100%><tr><td valign="bottom"><table><tr>',
    '\t\t\t<td width=150>',
    `\t\t\t\t<div class=townName>${town}</div>`,
    '\t\t\t</td>',
    '\t\t\t<td>',
    // `PGI.header:13` puts an `<img>` inside the title; `standard.header:14` does not.
    pgi
      ? `\t\t\t\t<div class=title><nobr><img src="../../../../styles/pgi/images/pgisun.gif"> ${title}</nobr></div>`
      : `\t\t\t\t<div class=title>${title}</div>`,
    '\t\t\t</td>',
    '\t\t\t<td width=150>',
    `\t\t\t\t<div class=date align="right" valign="bottom">${date}</div>`,
    '\t\t\t</td>',
    '\t\t</tr></table></td></tr></table>',
    '\t\t<table cellpadding=3><tr><td valign="top">',
    ...stories,
    '\t\t</td></tr></table>',
    '\t\t<div class=footer>Starpeace Online</div>',
    '\t</body>',
    '</html>',
  ].join('\n');
}

// =============================================================================
// decodeIssueDate
// =============================================================================
describe('decodeIssueDate', () => {
  it('keeps what follows the @ and turns every hyphen into a slash', () => {
    expect(decodeIssueDate(NEWEST)).toBe('3/1/2027');
    expect(decodeIssueDate(MIDDLE)).toBe('2/28/2027');
  });

  // `:19-29` tests the hyphen BEFORE the `@` test, so a hyphen in the id half
  // still emits a slash. The port is literal because the page is.
  it('emits a slash for a hyphen sitting before the @, as the page does', () => {
    expect(decodeIssueDate('00-21@3-1-2027')).toBe('/3/1/2027');
  });

  it('a folder with no @ yields only the slashes of its hyphens', () => {
    expect(decodeIssueDate('002147483640')).toBe('');
    expect(decodeIssueDate('0021-4764')).toBe('/');
  });

  it('an empty folder decodes to nothing', () => {
    expect(decodeIssueDate('')).toBe('');
  });
});

// =============================================================================
// parseNewspaperIssueList
// =============================================================================
describe('parseNewspaperIssueList', () => {
  // The folder id is `IssueMax - Issue` (`News.pas:956-961`), so ascending
  // string order is newest first — whatever order the page listed them in.
  it('sorts the folders newest first, whatever order the page listed them', () => {
    expect(parseNewspaperIssueList(barPage([MIDDLE, NEWEST, OLDEST]))).toEqual([
      { folder: NEWEST, date: '3/1/2027' },
      { folder: MIDDLE, date: '2/28/2027' },
      { folder: OLDEST, date: '2/27/2027' },
    ]);
  });

  it('reads the selected cell as well as the links', () => {
    const issues = parseNewspaperIssueList(barPage([NEWEST, MIDDLE], 0));
    expect(issues.map(i => i.folder)).toEqual([NEWEST, MIDDLE]);
  });

  it('reads a selected cell that is not the first one', () => {
    const issues = parseNewspaperIssueList(barPage([NEWEST, MIDDLE, OLDEST], 2));
    expect(issues.map(i => i.folder)).toEqual([NEWEST, MIDDLE, OLDEST]);
  });

  // `:48` declares `var selected = ""` before any cell exists. It names no
  // folder and must not become an issue.
  it('ignores the empty `selected` the page declares before the loop', () => {
    expect(parseNewspaperIssueList(barPage([]))).toEqual([]);
  });

  it('de-duplicates a folder that appears twice', () => {
    const html = barPage([NEWEST, MIDDLE]) + barPage([MIDDLE, NEWEST]);
    expect(parseNewspaperIssueList(html).map(i => i.folder)).toEqual([NEWEST, MIDDLE]);
  });

  it('finds nothing in a page carrying no issue row', () => {
    expect(parseNewspaperIssueList('<html><body>Connecting...</body></html>')).toEqual([]);
  });
});

// =============================================================================
// parseNewspaperIssue
// =============================================================================
describe('parseNewspaperIssue', () => {
  it('reads the masthead and every story of an issue', () => {
    const issue = parseNewspaperIssue(issuePage({
      stories: [
        storyBlock('Domestic Wars!', '', 'One person died last night.'),
        storyBlock('Renaissance art in Helartia', 'by Marco Ferrari', 'The IFEL collection arrived.'),
      ],
    }));
    expect(issue.townName).toBe('Helartia');
    expect(issue.title).toBe('Helartia Herald');
    expect(issue.date).toBe('Monday, March 01, 2027');
    expect(issue.stories).toEqual([
      { headline: 'Domestic Wars!', byline: '', body: 'One person died last night.' },
      { headline: 'Renaissance art in Helartia', byline: 'by Marco Ferrari', body: 'The IFEL collection arrived.' },
    ]);
  });

  // `PGI.header:13` wraps the name in a `<nobr>` beside an `<img>`.
  it('reads the title of the PGI style, image and all', () => {
    const issue = parseNewspaperIssue(issuePage({ pgi: true, title: 'The PGI Sun' }));
    expect(issue.title).toBe('The PGI Sun');
  });

  // The stories are markup the News Server assembled from templates; nothing
  // leaves the gateway as HTML, same rule as the board's bodies.
  it('strips the markup of a story body', () => {
    const issue = parseNewspaperIssue(issuePage({
      stories: [storyBlock('S', '', 'First line<br>Second <b>line</b>')],
    }));
    expect(issue.stories[0].body).not.toContain('<');
    expect(issue.stories[0].body).toBe('First line\nSecond line');
  });

  it('reads a headline at any layout level — `LayoutImp` is the frame name', () => {
    const html = issuePage({ stories: [storyBlock('Top of the page', '', 'Body')] })
      .replace(/<h2>/g, '<h1>').replace(/<\/h2>/g, '</h1>');
    expect(parseNewspaperIssue(html).stories[0].headline).toBe('Top of the page');
  });

  it('yields an empty issue for a page that is not one', () => {
    expect(parseNewspaperIssue('<html><body>404 - File not found</body></html>')).toEqual({
      townName: '', title: '', date: '', stories: [],
    });
  });
});

// =============================================================================
// getNewspaperIssues
// =============================================================================
describe('getNewspaperIssues', () => {
  it('reads showbar.asp with an empty Selected and the paper named as the bar names it', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(barPage([MIDDLE, NEWEST, OLDEST])));

    const list = await getNewspaperIssues(fake.ctx, TARGET);

    const url = mockFetch.mock.calls[0][0];
    expect(url).toMatch(/^http:\/\/158\.69\.153\.134\/Five\/0\/Visual\/News\/showbar\.asp\?/);
    expect(url).not.toContain('+');
    const q = queryOf(0);
    // `:87` selects the first folder when `Selected` is empty — which is what
    // the frameset's own first load sends.
    expect(q.get('Selected')).toBe('');
    expect(q.get('PaperName')).toBe('Helartia Herald');
    expect(q.get('TownName')).toBe('Helartia');
    expect(q.get('WorldName')).toBe('Planitia');
    expect(q.get('Tycoon')).toBe('SPO_test3');
    expect(q.get('TycoonName')).toBeNull();
    expect(q.get('DAAddr')).toBe('10.0.0.5');
    expect(q.get('DAPort')).toBe('1111');

    expect(list).toEqual({
      paperName: 'Helartia Herald',
      issues: [
        { folder: NEWEST, date: '3/1/2027' },
        { folder: MIDDLE, date: '2/28/2027' },
        { folder: OLDEST, date: '2/27/2027' },
      ],
      error: '',
    });
  });

  it('a Capitol bar carries an empty TownName', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(barPage([])));
    await getNewspaperIssues(fake.ctx, { ...TARGET, isCapitol: true });
    expect(queryOf(0).get('TownName')).toBe('');
  });

  // A paper that has printed nothing yet is not an error: `ShowPaper.asp:10-24`
  // shows the connecting page for it, and so does the client.
  it('an empty bar is an empty list, not a failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(barPage([])));
    const list = await getNewspaperIssues(fake.ctx, TARGET);
    expect(list.issues).toEqual([]);
    expect(list.error).toBe('');
  });

  it('does not fetch when the world is unknown', async () => {
    const fake = makeWebCtx({ currentWorldInfo: null });
    const list = await getNewspaperIssues(fake.ctx, TARGET);
    expect(list.error).toBe('Not connected to a world.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch when the town has no newspaper', async () => {
    const fake = makeWebCtx();
    const list = await getNewspaperIssues(fake.ctx, { ...TARGET, paperName: '' });
    expect(list.error).toBe('This town has no newspaper.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses when the DA lock channel is unset', async () => {
    const fake = makeWebCtx({ daAddr: null, daPort: null });
    const list = await getNewspaperIssues(fake.ctx, TARGET);
    expect(list.error).toBe('ASP call refused: DA lock channel not announced yet (daAddr/daPort unset)');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports an HTTP failure instead of parsing the error body', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse('<html><title>500</title></html>', 500));
    const list = await getNewspaperIssues(fake.ctx, TARGET);
    expect(list.error).toBe('The newspaper answered HTTP 500.');
    expect(list.issues).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('issue bar answered HTTP 500'));
  });

  it('reports a transport failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockRejectedValue(new Error('ETIMEDOUT'));
    const list = await getNewspaperIssues(fake.ctx, TARGET);
    expect(list.error).toBe('ETIMEDOUT');
    expect(fake.log.warn).toHaveBeenCalledWith('[Newspaper] Issue list read failed: ETIMEDOUT');
  });
});

// =============================================================================
// getNewspaperIssue
// =============================================================================
describe('getNewspaperIssue', () => {
  it('fetches the folder`s own home.asp, each path segment escaped', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(issuePage()));

    const issue = await getNewspaperIssue(fake.ctx, TARGET, NEWEST);

    // The path `ShowPaper.asp:30-31` redirects to, relative to `Visual/News/`.
    expect(mockFetch.mock.calls[0][0]).toBe(
      'http://158.69.153.134/Five/0/Visual/News/Newspapers/Planitia/Helartia%20Herald'
      + '/002147483640%403-1-2027/home.asp?Tycoon=SPO_test3',
    );
    expect(issue).toEqual({
      paperName: 'Helartia Herald',
      folder: NEWEST,
      townName: 'Helartia',
      title: 'Helartia Herald',
      date: 'Monday, March 01, 2027',
      stories: [{ headline: 'Domestic Wars!', byline: '', body: 'One person died last night.' }],
      error: '',
    });
  });

  // `home.asp` takes only `Tycoon` (`ShowPaper.asp:30`) — no DA channel, no
  // paper name: the folder path already identifies the issue.
  it('sends the reader and nothing else', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(issuePage()));
    await getNewspaperIssue(fake.ctx, TARGET, NEWEST);
    const q = queryOf(0);
    expect([...q.keys()]).toEqual(['Tycoon']);
  });

  it('does not fetch for an empty folder — there is no issue to open', async () => {
    const fake = makeWebCtx();
    const issue = await getNewspaperIssue(fake.ctx, TARGET, '');
    expect(issue.error).toBe('This paper has not printed an issue yet.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch when the world is unknown', async () => {
    const fake = makeWebCtx({ currentWorldInfo: null });
    const issue = await getNewspaperIssue(fake.ctx, TARGET, NEWEST);
    expect(issue.error).toBe('Not connected to a world.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch when the town has no newspaper', async () => {
    const fake = makeWebCtx();
    const issue = await getNewspaperIssue(fake.ctx, { ...TARGET, paperName: '' }, NEWEST);
    expect(issue.error).toBe('This town has no newspaper.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports an HTTP failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse('', 404));
    const issue = await getNewspaperIssue(fake.ctx, TARGET, NEWEST);
    expect(issue.error).toBe('The newspaper answered HTTP 404.');
    expect(issue.stories).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('issue answered HTTP 404'));
  });

  // IIS answers 200 for a directory listing too. Reading one as an empty paper
  // would show a blank frame instead of saying what went wrong.
  it('refuses a 200 that carries neither a title nor a story', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse('<html><body><h1>Index of /</h1></body></html>'));
    const issue = await getNewspaperIssue(fake.ctx, TARGET, NEWEST);
    expect(issue.error).toBe('The issue could not be read.');
  });

  it('accepts a masthead-less page that still carries a story', async () => {
    const fake = makeWebCtx();
    mockFetch.mockResolvedValue(htmlResponse(
      `<html><body>${storyBlock('Late edition', '', 'Body')}</body></html>`,
    ));
    const issue = await getNewspaperIssue(fake.ctx, TARGET, NEWEST);
    expect(issue.error).toBe('');
    expect(issue.stories[0].headline).toBe('Late edition');
  });

  it('reports a transport failure', async () => {
    const fake = makeWebCtx();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const issue = await getNewspaperIssue(fake.ctx, TARGET, NEWEST);
    expect(issue.error).toBe('ECONNREFUSED');
    expect(fake.log.warn).toHaveBeenCalledWith('[Newspaper] Issue read failed: ECONNREFUSED');
  });
});
