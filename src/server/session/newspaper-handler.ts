/**
 * Newspaper handler — the town paper: its editorial board, and its daily issues.
 *
 * Two halves, both scraped from `Visual/News/`:
 *   - the **board** (`boardmsg.asp`), what "Rate the Mayor" opens;
 *   - the **paper** (`ShowBar.asp` + an issue's own `home.asp`), what "Read
 *     News" opens — see the second section header below.
 *
 * This is what Voyager's "Rate the Mayor" button opens: `TownHallSheet.pas:343`
 * navigates to `Visual/News/boardreader.asp` with the town's `PaperName`, not to
 * anything under `Politics/`. The board is a `NewsBoard.NewsObject` COM tree
 * rooted at `boards\<World>\<Paper>\`, reachable only through the ASP pages —
 * there is no RDO member for it.
 *
 * Two operations, both on `boardmsg.asp`:
 *   - read   `?top=TRUE&root=…&path=…`      -> the index, or one column
 *   - post   `?action=post&…` + a form body -> `NewsObj.NewMessage` (`:146`)
 *
 * A column page also carries the Up link (`:236-237`, the parent's `path`) and
 * the author's portrait (`:244`), both read here alongside the title/byline/body.
 *
 * **Bodies come back as TEXT, never as HTML.** `NewsObj.BodyHTML` (`:255`) is
 * markup typed by other players and stored verbatim; this client has no
 * sanitiser and no `dangerouslySetInnerHTML` anywhere, and adding both to render
 * a column would open an XSS hole for a feature that needs none. The tags are
 * dropped here, at the edge, so nothing downstream has to be trusted.
 */

import type { SessionContext } from './session-context';
import type {
  NewspaperArticle,
  NewspaperBoard,
  NewspaperColumn,
  NewspaperIssue,
  NewspaperIssueList,
  NewspaperIssueRef,
  NewspaperStory,
} from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { toProxyUrl } from '../../shared/proxy-utils';
import { fetchWithTimeout } from '../fetch-with-timeout';
import { redactUrlCredentials } from '../url-redact';
import { requireDaParams } from './asp-da-params';

// =========================================================================
// PARSING
// =========================================================================

/** Drop every tag and collapse whitespace — see the file header on why. */
function toText(fragment: string): string {
  return fragment
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** The `path` query parameter of a board link — the id of a column. */
const LINK_PATH = /[?&]path=([^"'&]*)/i;

/**
 * One index entry of `RenderGlobal` (`boardmsg.asp:198-219`): an author cell,
 * a spacer cell, then the subject as a link whose `path` identifies the column,
 * followed by a second row holding the summary.
 */
const INDEX_ENTRY =
  /<div\s+class=author><b>([\s\S]*?)<\/b><\/div>[\s\S]*?<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td\s+class=comment>([\s\S]*?)<\/td>/gi;

/**
 * One reply of `RenderLevel` (`boardmsg.asp:170-176`).
 *
 * Rendered recursively into nested `<div>`s; we read them FLAT. Recovering the
 * nesting would mean matching `</div>` depth through markup the server does not
 * indent reliably, and the reply list is a navigation aid — every entry is
 * reachable by its own `path` whatever level it sits at.
 */
const REPLY_ENTRY =
  /<b>([\s\S]*?)<\/b>\s*-\s*<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div\s+class=comment[^>]*>([\s\S]*?)<\/div>/gi;

/** `boardmsg.asp:250-256` — the open column: title, byline, body. */
const ARTICLE_TITLE = /<div\s+class=title>([\s\S]*?)<\/div>/i;
const ARTICLE_AUTHOR = /<div\s+class=author>([\s\S]*?)<\/div>/i;
const ARTICLE_MESSAGE = /<div\s+class=message>([\s\S]*?)<\/div>\s*<\/td>/i;

/** `boardmsg.asp:236-237` — the Up link: an anchor wrapping `images\up.gif`. */
const ARTICLE_UP_LINK = /<a\b[^>]*href="([^"]*)"[^>]*>\s*<img\b[^>]*\bup\.gif/i;
/** `boardmsg.asp:244` — the author's portrait. The index page's `<img id=picture>` (`:263`) has no `src`. */
const ARTICLE_PICTURE = /<img\b[^>]*\bid=picture\b[^>]*\bsrc="([^"]*)"/i;

function pathOf(href: string): string {
  const match = LINK_PATH.exec(href);
  return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
}

/** The "Latest 10 columns" index. Empty for a page showing one column. */
export function parseNewspaperIndex(html: string): NewspaperColumn[] {
  const columns: NewspaperColumn[] = [];
  INDEX_ENTRY.lastIndex = 0;
  let entry: RegExpExecArray | null;
  while ((entry = INDEX_ENTRY.exec(html)) !== null) {
    const path = pathOf(entry[2]);
    if (!path) continue;
    columns.push({
      author: toText(entry[1]),
      path,
      subject: toText(entry[3]),
      summary: toText(entry[4]).replace(/\.{3}$/, ''),
    });
  }
  return columns;
}

/**
 * The open column, or `null` when the page rendered the index instead.
 *
 * `boardmsg.asp:231` is the discriminator: the article block exists only when
 * `NewsObj.Open(path) = 0` AND the node is not `FolderOnly`, which is exactly
 * the case where a `<div class=message>` is emitted.
 */
export function parseNewspaperArticle(html: string): NewspaperArticle | null {
  const message = ARTICLE_MESSAGE.exec(html);
  if (!message) return null;

  const title = ARTICLE_TITLE.exec(message[1]);
  const author = ARTICLE_AUTHOR.exec(message[1]);

  // The body is whatever follows the byline inside the message div (`:253-255`).
  const afterByline = author
    ? message[1].slice(author.index + author[0].length)
    : message[1];

  const replies: NewspaperColumn[] = [];
  REPLY_ENTRY.lastIndex = 0;
  let reply: RegExpExecArray | null;
  while ((reply = REPLY_ENTRY.exec(html)) !== null) {
    const path = pathOf(reply[2]);
    if (!path) continue;
    replies.push({
      author: toText(reply[1]),
      path,
      subject: toText(reply[3]),
      summary: toText(reply[4]).replace(/\.{3}$/, ''),
    });
  }

  const up = ARTICLE_UP_LINK.exec(html);
  const picture = ARTICLE_PICTURE.exec(html);

  return {
    subject: title ? toText(title[1]) : '',
    // `:258` prints "By <author> <authorDesc>" — one line, kept as one line.
    byline: author ? toText(author[1]) : '',
    body: toText(afterByline),
    replies,
    parentPath: up ? pathOf(up[1]) : '',
    photoUrl: picture ? picture[1].trim() : '',
  };
}

// =========================================================================
// TRANSPORT
// =========================================================================

/** Everything the board pages need to identify the paper and the reader. */
export interface NewspaperTarget {
  paperName: string;
  townName: string;
  isCapitol: boolean;
  buildingX: number;
  buildingY: number;
}

function boardRoot(worldName: string, paperName: string): string {
  // `boardreader.asp:5` — the tree the NewsBoard COM object is rooted at.
  return `boards\\${worldName}\\${paperName}\\`;
}

function boardParams(ctx: SessionContext, target: NewspaperTarget, root: string, path: string): URLSearchParams {
  return new URLSearchParams({
    root,
    path,
    // `boardmsg.asp:10` reads `Tycoon`, NOT `TycoonName` — the Politics pages
    // read the other one. Sending the wrong name posts as an empty author,
    // which `:93` rejects outright.
    Tycoon: ctx.activeUsername || ctx.cachedUsername || '',
    WorldName: ctx.currentWorldInfo?.name || '',
    TownName: target.isCapitol ? '' : target.townName,
    PaperName: target.paperName,
    Capitol: target.isCapitol ? 'YES' : '',
    x: target.isCapitol ? String(target.buildingX) : '',
    y: target.isCapitol ? String(target.buildingY) : '',
    ...requireDaParams(ctx),
  });
}

/** Paper names and town names carry spaces; `+` is not decoded by these pages. */
function encodeParams(params: URLSearchParams): string {
  return params.toString().replace(/\+/g, '%20');
}

/**
 * `NewsObject.pas:487-490` returns the parent GLOBALIZED — the registry `Path`
 * prefixed to the relative root — so a top-level column's parent is an absolute
 * disk path that ENDS with `boards\<World>\<Paper>\`. Compared without case and
 * without the trailing backslash `CanonicalizePath` (`:86-91`) appends.
 */
export function isBoardRoot(parentPath: string, root: string): boolean {
  const norm = (p: string) => p.replace(/\\+$/, '').toLowerCase();
  const parent = norm(parentPath);
  const base = norm(root);
  return parent === '' || parent === base || parent.endsWith('\\' + base);
}

/** The article as the client needs it: no Up onto the index, portrait resolved through the proxy. */
function resolveArticle(article: NewspaperArticle | null, worldIp: string, root: string): NewspaperArticle | null {
  if (!article) return null;
  return {
    ...article,
    parentPath: isBoardRoot(article.parentPath, root) ? '' : article.parentPath,
    // `:244` is root-relative and the browser's CSP (`img-src 'self' data: blob:`,
    // server.ts setSecurityHeaders) blocks a raw cross-origin `http://<worldIp>/…`
    // image — route it through the same `/proxy-image` mechanism mail-handlers.ts:54
    // and search-menu-service.ts:111 use for the same kind of world-hosted picture.
    photoUrl: article.photoUrl === '' ? '' : toProxyUrl(article.photoUrl, worldIp),
  };
}

function emptyBoard(target: NewspaperTarget, error: string): NewspaperBoard {
  return {
    paperName: target.paperName,
    root: '',
    path: '',
    columns: [],
    article: null,
    error,
  };
}

/**
 * Read the board index, or one column when `path` names one.
 *
 * `top=TRUE` is what makes `boardmsg.asp` render the standalone page rather than
 * the frame body (`:44-48` reloads the sibling frame without it, which we have
 * no frameset for).
 */
export async function getNewspaperBoard(
  ctx: SessionContext, target: NewspaperTarget, path?: string
): Promise<NewspaperBoard> {
  const worldIp = ctx.currentWorldInfo?.ip;
  const worldName = ctx.currentWorldInfo?.name || '';
  if (!worldIp) return emptyBoard(target, 'Not connected to a world.');
  if (!target.paperName) return emptyBoard(target, 'This town has no newspaper.');

  const root = boardRoot(worldName, target.paperName);
  const wanted = path || root;

  try {
    const params = boardParams(ctx, target, root, wanted);
    params.set('top', 'TRUE');
    const url = `http://${worldIp}/Five/0/Visual/News/boardmsg.asp?${encodeParams(params)}`;
    ctx.log.debug(`[Newspaper] Reading ${redactUrlCredentials(url)}`);

    const resp = await fetchWithTimeout(url, { redirect: 'follow' });
    if (!resp.ok) {
      ctx.log.warn(`[Newspaper] board answered HTTP ${resp.status} — ${redactUrlCredentials(url)}`);
      return emptyBoard(target, `The newspaper answered HTTP ${resp.status}.`);
    }
    const html = await resp.text();

    return {
      paperName: target.paperName,
      root,
      path: wanted,
      // The index is only rendered on the folder page (`:266-272`), so on a
      // column page this is legitimately empty and `article` carries the content.
      columns: parseNewspaperIndex(html),
      article: resolveArticle(parseNewspaperArticle(html), worldIp, root),
      error: '',
    };
  } catch (e: unknown) {
    ctx.log.warn(`[Newspaper] Board read failed: ${toErrorMessage(e)}`);
    return emptyBoard(target, toErrorMessage(e));
  }
}

/**
 * Publish a column, or a reply to one.
 *
 * `boardmsg.asp:83-153` posts through `NewsObj.NewMessage( parentPath, Tycoon,
 * AuthorDesc, "", Subject, Body )`. `parentPath` is the open `path` when
 * `Reply=YES` and the board `root` otherwise (`:87-91`), so a new top-level
 * column is `Reply=NO`.
 *
 * The page validates exactly two things — a non-empty `parentPath` and a
 * non-empty `Tycoon` (`:93`), then a non-empty `Subject` (`:94`) — and answers
 * 200 either way, so the response body is the only oracle. A post that took
 * effect re-renders the index with the new column in it (`:47` also reloads the
 * list frame), which is what we read back.
 */
export async function postNewspaperColumn(
  ctx: SessionContext,
  target: NewspaperTarget,
  subject: string,
  body: string,
  replyToPath?: string,
): Promise<{ success: boolean; message: string; board: NewspaperBoard | null }> {
  const worldIp = ctx.currentWorldInfo?.ip;
  const worldName = ctx.currentWorldInfo?.name || '';
  if (!worldIp) return { success: false, message: 'Not connected to a world.', board: null };
  if (!target.paperName) return { success: false, message: 'This town has no newspaper.', board: null };
  // `:94` drops a subject-less post silently. Refusing here says why.
  if (subject.trim() === '') {
    return { success: false, message: 'A column needs a subject.', board: null };
  }
  const author = ctx.activeUsername || ctx.cachedUsername || '';
  if (author === '') {
    return { success: false, message: 'Not signed in.', board: null };
  }

  const root = boardRoot(worldName, target.paperName);
  const isReply = replyToPath !== undefined && replyToPath !== '' && replyToPath !== root;

  try {
    const params = boardParams(ctx, target, root, isReply ? replyToPath : root);
    params.set('action', 'post');
    const url = `http://${worldIp}/Five/0/Visual/News/boardmsg.asp?${encodeParams(params)}`;

    // `Reply` is a radio on the page's own form (`:298-300`); the ASP compares
    // it to the literal "YES" (`:87`), so anything else means "post at root".
    const form = new URLSearchParams({
      Subject: subject,
      Body: body,
      Reply: isReply ? 'YES' : 'NO',
    });

    ctx.log.debug(`[Newspaper] Posting "${subject}" to ${target.paperName}`);
    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!resp.ok) {
      return { success: false, message: `The newspaper answered HTTP ${resp.status}.`, board: null };
    }
    const html = await resp.text();

    // The state after is the oracle: the response IS the board re-rendered.
    const columns = parseNewspaperIndex(html);
    const published = columns.some(c => c.author.toLowerCase() === author.toLowerCase()
      && c.subject.trim() === subject.trim());

    return {
      success: published,
      message: published
        ? 'Column published'
        : 'The newspaper did not publish the column.',
      board: {
        paperName: target.paperName,
        root,
        path: root,
        columns,
        article: resolveArticle(parseNewspaperArticle(html), worldIp, root),
        error: '',
      },
    };
  } catch (e: unknown) {
    ctx.log.warn(`[Newspaper] Post failed: ${toErrorMessage(e)}`);
    return { success: false, message: toErrorMessage(e), board: null };
  }
}

// =========================================================================
// THE DAILY PAPER — `Newsreader.asp`
// =========================================================================

/**
 * Voyager's third Town Hall button, `ReadNews` (`TownHallSheet.pas:361`), opens
 * `newsreader.asp`: a frameset (`Newsreader.asp:2-5`) whose bar frame is
 * `ShowBar.asp` — the row of kept issues — and whose main frame is
 * `ShowPaper.asp`, which does nothing but redirect to the selected issue's own
 * `home.asp` (`ShowPaper.asp:30-31`).
 *
 * We read both pages directly: the bar for the issue list, the issue page for
 * the stories. The issue page is IIS-processed HTML written by the News Server
 * (`News.pas:750-802`), so it is markup we did not author — the same rule as
 * the board applies and every string leaves here as TEXT.
 */

/**
 * `ShowBar.asp:14-31` — `DecodeDate`, character for character.
 *
 * A folder is `<issueId>@<date>` (`News.pas:986`), where the date part is
 * `DateToStr` with `/` swapped for `-`. The page walks the whole string: a `-`
 * always becomes `/`, an `@` opens the gate, and every other character is kept
 * only once the gate is open. That is not the same as splitting on `@` — a
 * hyphen BEFORE the `@` still emits a slash — so it is ported literally rather
 * than "cleaned up". Nothing is parsed into a `Date`: the server's `DateToStr`
 * locale is unknown, and the bar's own text is what a player recognises.
 */
export function decodeIssueDate(folder: string): string {
  let decoded = '';
  let dotFound = false;
  for (const char of folder) {
    if (char === '-') {
      decoded += '/';
    } else if (char === '@') {
      dotFound = true;
    } else if (dotFound) {
      decoded += char;
    }
  }
  return decoded;
}

/** `ShowBar.asp:89-94` — the selected cell, and the script that names its folder. */
const SELECTED_ISSUE =
  /<td\s+class=selectedDate>[\s\S]*?<script\b[^>]*>[\s\S]*?selected\s*=\s*"([^"]*)"/gi;

/** `ShowBar.asp:98-102` — every other cell, a link carrying `Selected=<folder>`. */
const NORMAL_ISSUE =
  /<td\s+class=normalDate>[\s\S]*?<a\b[^>]*href="[^"]*[?&]Selected=([^"&]*)/gi;

/**
 * The paper's kept issues, newest first.
 *
 * The page order is the filesystem's (`FindFirst`/`FindNext`, `:83`/`:107`) and
 * says nothing about age. The folder name does: the id is `IssueMax - Issue`
 * zero-padded to 12 digits (`News.pas:956-961`), so ascending string order IS
 * newest first — the same order `ManageSite` deletes from when it trims the site
 * to `MaxIssues` (`:869-919`).
 */
export function parseNewspaperIssueList(html: string): NewspaperIssueRef[] {
  const folders = new Set<string>();
  for (const pattern of [SELECTED_ISSUE, NORMAL_ISSUE]) {
    pattern.lastIndex = 0;
    let cell: RegExpExecArray | null;
    while ((cell = pattern.exec(html)) !== null) {
      if (cell[1]) folders.add(cell[1]);
    }
  }
  return [...folders]
    .sort()
    .map(folder => ({ folder, date: decodeIssueDate(folder) }));
}

/** The paper's masthead — `standard.header:7-19`, `PGI.header:7-19`. */
const ISSUE_TOWN = /<div\s+class=townName(?=[\s>])[^>]*>([\s\S]*?)<\/div>/i;
const ISSUE_TITLE = /<div\s+class=title(?=[\s>])[^>]*>([\s\S]*?)<\/div>/i;
const ISSUE_DATE = /<div\s+class=date(?=[\s>])[^>]*>([\s\S]*?)<\/div>/i;

/**
 * One story: the headline in an `<h<LayoutImp>>` (`News.pas:783` sets
 * `LayoutImp` to the layout frame's name, a digit), an optional `<div
 * class=author>` byline, then the body (`domesticwars.story:5-9`,
 * `michelangelo.story:15-17`).
 */
const ISSUE_STORY =
  /<h(\d)\b[^>]*>([\s\S]*?)<\/h\1>\s*(?:<div\s+class=author(?=[\s>])[^>]*>([\s\S]*?)<\/div>\s*)?<div\s+class=articleBody(?=[\s>])[^>]*>([\s\S]*?)<\/div>/gi;

/** Read the masthead and the stories off an issue's `home.asp`. */
export function parseNewspaperIssue(
  html: string,
): Pick<NewspaperIssue, 'townName' | 'title' | 'date' | 'stories'> {
  const town = ISSUE_TOWN.exec(html);
  const title = ISSUE_TITLE.exec(html);
  const date = ISSUE_DATE.exec(html);

  const stories: NewspaperStory[] = [];
  ISSUE_STORY.lastIndex = 0;
  let story: RegExpExecArray | null;
  while ((story = ISSUE_STORY.exec(html)) !== null) {
    stories.push({
      headline: toText(story[2]),
      byline: story[3] ? toText(story[3]) : '',
      body: toText(story[4]),
    });
  }

  return {
    townName: town ? toText(town[1]) : '',
    // PGI puts an `<img>` inside the title (`PGI.header:13`); `toText` drops it.
    title: title ? toText(title[1]) : '',
    date: date ? toText(date[1]) : '',
    stories,
  };
}

function emptyIssueList(target: NewspaperTarget, error: string): NewspaperIssueList {
  return { paperName: target.paperName, issues: [], error };
}

function emptyIssue(target: NewspaperTarget, folder: string, error: string): NewspaperIssue {
  return {
    paperName: target.paperName,
    folder,
    townName: '',
    title: '',
    date: '',
    stories: [],
    error,
  };
}

/**
 * The issue bar — every issue this paper still keeps.
 *
 * `Selected` is sent empty on purpose: `:87` then marks the FIRST folder as
 * selected, which costs nothing here (we sort ourselves) and is exactly what
 * the frameset does on its first load.
 *
 * An empty list with an empty error is a legitimate answer, not a failure: a
 * paper whose News Server has printed nothing yet has no folder to iterate, and
 * `ShowPaper.asp:10-24` shows the "connecting" page for it forever.
 */
export async function getNewspaperIssues(
  ctx: SessionContext, target: NewspaperTarget,
): Promise<NewspaperIssueList> {
  const worldIp = ctx.currentWorldInfo?.ip;
  const worldName = ctx.currentWorldInfo?.name || '';
  if (!worldIp) return emptyIssueList(target, 'Not connected to a world.');
  if (!target.paperName) return emptyIssueList(target, 'This town has no newspaper.');

  try {
    // The parameters `Newsreader.asp:4` forwards to the bar frame. `Tycoon`,
    // not `TycoonName` — same trap as the board pages.
    const params = new URLSearchParams({
      WorldName: worldName,
      TownName: target.isCapitol ? '' : target.townName,
      Selected: '',
      PaperName: target.paperName,
      Tycoon: ctx.activeUsername || ctx.cachedUsername || '',
      ...requireDaParams(ctx),
    });
    const url = `http://${worldIp}/Five/0/Visual/News/showbar.asp?${encodeParams(params)}`;
    ctx.log.debug(`[Newspaper] Reading the issue bar ${redactUrlCredentials(url)}`);

    const resp = await fetchWithTimeout(url, { redirect: 'follow' });
    if (!resp.ok) {
      ctx.log.warn(`[Newspaper] issue bar answered HTTP ${resp.status} — ${redactUrlCredentials(url)}`);
      return emptyIssueList(target, `The newspaper answered HTTP ${resp.status}.`);
    }

    return {
      paperName: target.paperName,
      issues: parseNewspaperIssueList(await resp.text()),
      error: '',
    };
  } catch (e: unknown) {
    ctx.log.warn(`[Newspaper] Issue list read failed: ${toErrorMessage(e)}`);
    return emptyIssueList(target, toErrorMessage(e));
  }
}

/**
 * One issue, read from the page `ShowPaper.asp:30-31` redirects to.
 *
 * That URL is relative to `Visual/News/`, which is where the News Server writes
 * the folders (`News.pas:986`) and what the issue's own stylesheet links climb
 * out of (`News.pas:359-361`). `Server.URLPathEncode` there and
 * `encodeURIComponent` here agree on what matters — a space becomes `%20` —
 * and IIS decodes `%40` back to `@` like any other escape. [INFERRED]
 */
export async function getNewspaperIssue(
  ctx: SessionContext, target: NewspaperTarget, folder: string,
): Promise<NewspaperIssue> {
  const worldIp = ctx.currentWorldInfo?.ip;
  const worldName = ctx.currentWorldInfo?.name || '';
  if (!worldIp) return emptyIssue(target, folder, 'Not connected to a world.');
  if (!target.paperName) return emptyIssue(target, folder, 'This town has no newspaper.');
  if (folder === '') return emptyIssue(target, folder, 'This paper has not printed an issue yet.');

  try {
    const enc = encodeURIComponent;
    const tycoon = enc(ctx.activeUsername || ctx.cachedUsername || '');
    const path = `Newspapers/${enc(worldName)}/${enc(target.paperName)}/${enc(folder)}/home.asp`;
    const url = `http://${worldIp}/Five/0/Visual/News/${path}?Tycoon=${tycoon}`;
    ctx.log.debug(`[Newspaper] Reading issue ${redactUrlCredentials(url)}`);

    const resp = await fetchWithTimeout(url, { redirect: 'follow' });
    if (!resp.ok) {
      ctx.log.warn(`[Newspaper] issue answered HTTP ${resp.status} — ${redactUrlCredentials(url)}`);
      return emptyIssue(target, folder, `The newspaper answered HTTP ${resp.status}.`);
    }

    const parsed = parseNewspaperIssue(await resp.text());
    // A page with neither a masthead title nor a single story is not an issue —
    // IIS answers 200 for a directory listing too, and reading one as an empty
    // paper would show a blank frame rather than say what went wrong.
    if (parsed.title === '' && parsed.stories.length === 0) {
      return emptyIssue(target, folder, 'The issue could not be read.');
    }

    return { paperName: target.paperName, folder, ...parsed, error: '' };
  } catch (e: unknown) {
    ctx.log.warn(`[Newspaper] Issue read failed: ${toErrorMessage(e)}`);
    return emptyIssue(target, folder, toErrorMessage(e));
  }
}
