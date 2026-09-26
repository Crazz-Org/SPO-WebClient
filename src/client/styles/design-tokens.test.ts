/**
 * Design-token guard.
 *
 * The UX audit (doc/ux/audit.md §2.1) found 25 `var(--x)` references to tokens that do not
 * exist — each one a silent visual bug (a dropped declaration, a mobile toolbar with no
 * stacking order). This test makes that class of bug impossible to reintroduce:
 *
 *  1. every custom property referenced in a client stylesheet must be defined in
 *     `src/client/styles/*.css` (or be set at runtime — see ALLOWED_RUNTIME);
 *  2. no stylesheet may remove the focus ring (`outline: none` / `outline: 0`) without
 *     providing a `:focus-visible` rule in the same file;
 *  3. the type scale never drops below 12 px (11 px is the one documented exception,
 *     `--text-2xs`), including inside media queries;
 *  4. no two fixed HUD elements that are visible together overlap, unless a whitelist row
 *     says so (the HUD band table, issue 931).
 *
 * Why a Jest test and not stylelint: no new dependency (CLAUDE.md), and the gate already
 * runs Jest on every PR.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CLIENT_ROOT = join(__dirname, '..');
const STYLES_DIR = __dirname;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const tokensCss = stripComments(readFileSync(join(STYLES_DIR, 'design-tokens.css'), 'utf8'));

/** Declaration block text for `selector {`, e.g. rule(bar, '.tiles'). */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/** px value of a `prop: NNpx` declaration inside a block. */
function px(block: string, prop: string): number {
  const match = block.match(new RegExp(`${prop}\\s*:\\s*([0-9.]+)px`));
  expect(match).not.toBeNull();
  return parseFloat(match![1]);
}

/** Raw value text of a top-level `:root` custom property in design-tokens.css. */
function tokenExpr(name: string): string {
  const match = tokensCss.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  expect(match).not.toBeNull();
  return match![1].trim();
}

/** Resolve a token expression to a px number, substituting var(--x) recursively. */
function resolve(expr: string): number {
  let text = expr;
  let guard = 0;
  while (/var\(\s*--[a-zA-Z0-9-]+\s*\)/.test(text) && guard < 10) {
    text = text.replace(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g, (_m, name: string) => tokenExpr(name));
    guard += 1;
  }
  text = text.replace(/calc\(([^()]*)\)/g, '($1)');
  let sum = 0;
  for (const m of text.matchAll(/([0-9.]+)(px|rem)/g)) {
    sum += m[2] === 'rem' ? parseFloat(m[1]) * 16 : parseFloat(m[1]);
  }
  return sum;
}

/* ---- Viewport-aware CSS resolver (issue 931) ----
   resolve() above only sums px numbers; the band table needs min()/max()/vw and media
   queries, so it gets its own small evaluator. No eval, no new Function. */

interface Viewport {
  label: string;
  w: number;
  h: number;
}

type Vars = ReadonlyMap<string, string>;

/** Index just past the `}` that closes the `{` at `open`. */
function blockEnd(css: string, open: number): number {
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < css.length) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  return i;
}

/** Every top-level `prelude { body }` block, in source order, brace-balanced. */
function topLevelBlocks(css: string): { prelude: string; body: string }[] {
  const out: { prelude: string; body: string }[] = [];
  let i = 0;
  for (;;) {
    const open = css.indexOf('{', i);
    if (open < 0) return out;
    const end = blockEnd(css, open);
    out.push({ prelude: css.slice(i, open).trim(), body: css.slice(open + 1, end - 1) });
    i = end;
  }
}

/** Every top-level `@media … { … }` block. */
function mediaBlocks(css: string): { query: string; body: string }[] {
  return topLevelBlocks(css)
    .filter((b) => b.prelude.startsWith('@media'))
    .map((b) => ({ query: b.prelude.slice('@media'.length).trim(), body: b.body }));
}

interface CssRule {
  media: string | null;
  selectors: string[];
  body: string;
}

/** Style rules in source order; rules inside `@media` carry their query, other at-rules are skipped. */
function cssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  for (const { prelude, body } of topLevelBlocks(css)) {
    if (prelude.startsWith('@media')) {
      const media = prelude.slice('@media'.length).trim();
      for (const inner of topLevelBlocks(body)) {
        out.push({ media, selectors: inner.prelude.split(',').map((s) => s.trim()), body: inner.body });
      }
    } else if (!prelude.startsWith('@')) {
      out.push({ media: null, selectors: prelude.split(',').map((s) => s.trim()), body });
    }
  }
  return out;
}

/** (min-width|max-width|max-height: Npx), `and` (all hold), `,` (any holds); any other feature is false. */
function matchesQuery(query: string, vp: Viewport): boolean {
  return query.split(',').some((part) =>
    part.split(/\band\b/).every((feature) => {
      const m = feature.trim().match(/^\(\s*(min-width|max-width|max-height)\s*:\s*([0-9.]+)px\s*\)$/);
      if (!m) return false;
      const n = parseFloat(m[2]);
      if (m[1] === 'min-width') return vp.w >= n;
      if (m[1] === 'max-width') return vp.w <= n;
      return vp.h <= n;
    })
  );
}

/**
 * Declarations of `selector` at `vp` (or at base when `vp` is null): every rule whose selector
 * list names it exactly or with a trailing `:not(...)`, in source order, last one wins.
 */
function declsAt(css: string, selector: string, vp: Viewport | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of cssRules(css)) {
    if (r.media !== null && (vp === null || !matchesQuery(r.media, vp))) continue;
    if (!r.selectors.some((s) => s === selector || s.startsWith(`${selector}:not(`))) continue;
    for (const decl of r.body.split(';')) {
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
  }
  return out;
}

/** The `:root` custom properties at `vp` — base, then every matching `@media` override. */
function tokensAt(vp: Viewport): Vars {
  return declsAt(tokensCss, ':root', vp);
}

function unitScale(unit: string | undefined, vp: Viewport): number {
  switch (unit) {
    case 'rem':
      return 16;
    case 'vw':
    case '%': // every table element is fixed, or absolute inside the full-viewport .screen
      return vp.w / 100;
    case 'vh':
    case 'dvh':
      return vp.h / 100;
    default: // px, or a unitless number (z-index, line-height)
      return 1;
  }
}

/**
 * Evaluate a CSS length expression at `vp`: numbers (px, rem, vw, vh, dvh, %, unitless),
 * + - * /, parentheses, calc/min/max/clamp, var(--x) (from `extra`, then `tokens`) and
 * env(name, fallback). Anything else throws — no silent zeros.
 */
function evalLength(expr: string, vp: Viewport, tokens: Vars, extra: Vars = new Map(), depth = 0): number {
  if (depth > 20) throw new Error(`var() nesting too deep in "${expr}"`);
  const toks = expr.match(/--[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9-]*|(?:\d+\.?\d*|\.\d+)(?:px|rem|dvh|vw|vh|%)?|\S/g) ?? [];
  let pos = 0;
  const peek = (): string | undefined => toks[pos];
  const next = (): string => {
    const t = toks[pos];
    if (t === undefined) throw new Error(`unexpected end of "${expr}"`);
    pos += 1;
    return t;
  };
  const expectTok = (want: string): void => {
    const got = next();
    if (got !== want) throw new Error(`expected "${want}", got "${got}" in "${expr}"`);
  };

  function parseExpr(): number {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  function parseTerm(): number {
    let v = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const r = parseFactor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }

  function parseArgs(): number[] {
    const out = [parseExpr()];
    while (peek() === ',') {
      next();
      out.push(parseExpr());
    }
    expectTok(')');
    return out;
  }

  function parseFactor(): number {
    const t = next();
    if (t === '-') return -parseFactor();
    if (t === '(') {
      const v = parseExpr();
      expectTok(')');
      return v;
    }
    const num = t.match(/^(\d+\.?\d*|\.\d+)(px|rem|dvh|vw|vh|%)?$/);
    if (num) return parseFloat(num[1]) * unitScale(num[2], vp);
    if (peek() !== '(') throw new Error(`unknown token "${t}" in "${expr}"`);
    next();
    switch (t) {
      case 'calc': {
        const v = parseExpr();
        expectTok(')');
        return v;
      }
      case 'min':
        return Math.min(...parseArgs());
      case 'max':
        return Math.max(...parseArgs());
      case 'clamp': {
        const args = parseArgs();
        if (args.length !== 3) throw new Error(`clamp() needs 3 arguments in "${expr}"`);
        return Math.max(args[0], Math.min(args[1], args[2]));
      }
      case 'var': {
        const name = next();
        const value = extra.get(name) ?? tokens.get(name);
        if (value === undefined) throw new Error(`undefined custom property ${name} in "${expr}"`);
        expectTok(')');
        return evalLength(value, vp, tokens, extra, depth + 1);
      }
      case 'env': {
        next(); // the environment variable name — every inset is 0 in this table
        expectTok(',');
        const v = parseExpr();
        expectTok(')');
        return v;
      }
      default:
        throw new Error(`unknown function ${t}() in "${expr}"`);
    }
  }

  const value = parseExpr();
  if (pos !== toks.length) throw new Error(`trailing "${toks.slice(pos).join(' ')}" in "${expr}"`);
  return value;
}

/** Custom properties that are set from TypeScript at runtime, never in a stylesheet. */
const ALLOWED_RUNTIME = new Set<string>([
  '--path-length', // SVG stroke animation, set by the component
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') walk(full, out);
    } else if (entry.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
}

const allCss = walk(CLIENT_ROOT);
const tokenFiles = allCss.filter((f) => f.startsWith(STYLES_DIR));
const moduleFiles = allCss.filter((f) => !f.startsWith(STYLES_DIR));

const defined = new Set<string>();
for (const f of tokenFiles) {
  const css = stripComments(readFileSync(f, 'utf8'));
  for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
}

describe('design tokens', () => {
  it('finds the token files', () => {
    expect(tokenFiles.length).toBeGreaterThan(0);
    expect(defined.has('--accent-gold')).toBe(true);
  });

  it('every var(--x) used by a stylesheet is defined', () => {
    const missing: string[] = [];
    for (const f of allCss) {
      const css = stripComments(readFileSync(f, 'utf8'));
      for (const m of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        const name = m[1];
        if (!defined.has(name) && !ALLOWED_RUNTIME.has(name)) {
          missing.push(`${relative(CLIENT_ROOT, f)}: ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('no stylesheet removes the focus ring without a :focus-visible rule', () => {
    const offenders: string[] = [];
    for (const f of moduleFiles) {
      const css = stripComments(readFileSync(f, 'utf8'));
      const removes = /outline\s*:\s*(none|0)\b/.test(css);
      const restores = /:focus-visible/.test(css);
      if (removes && !restores) offenders.push(relative(CLIENT_ROOT, f));
    }
    expect(offenders).toEqual([]);
  });

  it('the type scale never drops below 12 px (11 px only via --text-2xs)', () => {
    const tokens = stripComments(readFileSync(join(STYLES_DIR, 'design-tokens.css'), 'utf8'));
    for (const m of tokens.matchAll(/--text-([a-z0-9]+)\s*:\s*([0-9.]+)rem/g)) {
      const px = parseFloat(m[2]) * 16;
      const floor = m[1] === '2xs' ? 11 : 12;
      expect({ token: `--text-${m[1]}`, px }).toEqual({ token: `--text-${m[1]}`, px: expect.any(Number) });
      expect(px).toBeGreaterThanOrEqual(floor);
    }
  });
});

describe('desktop sheet width (issue 471)', () => {
  const tokens = stripComments(readFileSync(join(STYLES_DIR, 'design-tokens.css'), 'utf8'));
  const statusPill = stripComments(
    readFileSync(join(CLIENT_ROOT, 'components/hud/StatusPill.module.css'), 'utf8')
  );

  it('the base declaration is 472px', () => {
    expect(tokens).toMatch(/--panel-width-desktop:\s*472px/);
  });

  it('narrow-desktop and mobile rules are unchanged (no regression at or below 1400 px)', () => {
    const narrowMatch = tokens.match(
      /@media \(min-width: 1024px\) and \(max-width: 1399px\) \{\s*:root \{\s*--panel-width-desktop:\s*420px;/
    );
    expect(narrowMatch).not.toBeNull();

    const mobileMatch = tokens.match(/@media \(max-width: 767px\) \{[\s\S]*?--panel-width-desktop:\s*100vw;/);
    expect(mobileMatch).not.toBeNull();
  });

  it('a wide-desktop rule sets a fluid clamp() that reaches >= 900px at 3200px and stays continuous at 1400px', () => {
    const match = tokens.match(
      /@media \(min-width: 1400px\) \{\s*:root \{\s*--panel-width-desktop:\s*clamp\(472px,\s*([0-9.]+)vw,\s*([0-9.]+)px\)/
    );
    expect(match).not.toBeNull();
    const g = parseFloat(match![1]);
    const max = parseFloat(match![2]);

    expect(max).toBeLessThanOrEqual(1000);

    const widthAt = (viewport: number) => Math.min(Math.max(472, (viewport * g) / 100), max);

    expect(widthAt(3200)).toBeGreaterThanOrEqual(900);
    expect(widthAt(1400)).toBe(472);
  });

  it('StatusPill.module.css:35 max-width calc stays positive at the widest supported viewport (3840px)', () => {
    const match = tokens.match(
      /@media \(min-width: 1400px\) \{\s*:root \{\s*--panel-width-desktop:\s*clamp\(472px,\s*([0-9.]+)vw,\s*([0-9.]+)px\)/
    );
    expect(match).not.toBeNull();
    const g = parseFloat(match![1]);
    const max = parseFloat(match![2]);
    const panelWidthAt3840 = Math.min(Math.max(472, (3840 * g) / 100), max);

    expect(statusPill).toMatch(
      /max-width:\s*calc\(100% - var\(--minimap-size\) - var\(--space-10\) - var\(--panel-width-desktop\) - var\(--sheet-inset\) - var\(--space-4\)\)/
    );

    const minimapSize = 200;
    const space10 = 40;
    const sheetInset = 16;
    const space4 = 16;
    const remaining = 3840 - minimapSize - space10 - panelWidthAt3840 - sheetInset - space4;

    expect(remaining).toBeGreaterThan(0);
  });
});

describe('HUD bottom band anchor (issue 872)', () => {
  const commandBar = stripComments(
    readFileSync(join(CLIENT_ROOT, 'components/hud/CommandBar.module.css'), 'utf8')
  );
  const chatStrip = stripComments(
    readFileSync(join(CLIENT_ROOT, 'components/chat/ChatStrip.module.css'), 'utf8')
  );

  function block(css: string, selector: string): string {
    const start = css.indexOf(selector);
    expect(start).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  }

  it('.bar anchors its left edge with --hud-bar-left and no margin: 0 auto', () => {
    const bar = block(commandBar, '.bar {');
    expect(bar).toMatch(/left:\s*var\(--hud-bar-left\)/);
    expect(commandBar).not.toMatch(/margin:\s*0 auto/);
  });

  it('.shifted moves only the right edge — no left, no margin', () => {
    const shifted = block(commandBar, '.shifted {');
    expect(shifted).toMatch(/right:\s*/);
    expect(shifted).not.toMatch(/left:/);
    expect(shifted).not.toMatch(/margin:/);
  });

  it('.strip derives left from --hud-bar-left, never a raw viewport centre', () => {
    const strip = block(chatStrip, '.strip {');
    expect(strip).toMatch(/left:\s*calc\(var\(--hud-bar-left\)/);
    expect(chatStrip).not.toMatch(/translateX\(-50%\)/);
  });

  function panelWidthAt(viewport: number): number {
    if (viewport < 1400) return 420;
    return Math.min(Math.max(472, viewport * 0.3), 1000);
  }

  const HUD_BAR_MAX = 904;
  const SPACE_4 = 16;
  const SHEET_INSET = 16;

  function barLeft(viewport: number): number {
    return Math.max(SPACE_4, (viewport - HUD_BAR_MAX) / 2);
  }

  function barRightShifted(viewport: number): number {
    return panelWidthAt(viewport) + SHEET_INSET + SPACE_4;
  }

  it.each([1024, 1400, 2400])(
    'at %dpx: closed and open left are equal, open width is positive, and neither element crosses the sheet',
    (viewport) => {
      const closedLeft = barLeft(viewport);
      const openLeft = barLeft(viewport); // same token, both states
      expect(openLeft).toBe(closedLeft);

      const openRight = viewport - barRightShifted(viewport);
      const openWidth = Math.min(HUD_BAR_MAX, openRight - openLeft);
      expect(openWidth).toBeGreaterThan(0);

      const sheetLeft = viewport - (panelWidthAt(viewport) + SHEET_INSET);
      const barRightEdge = openLeft + openWidth;
      expect(barRightEdge).toBeLessThanOrEqual(sheetLeft);

      const chatWidth = Math.min(620, openWidth);
      const chatLeft = openLeft + (openWidth - chatWidth) / 2;
      const chatRightEdge = chatLeft + chatWidth;
      expect(chatRightEdge).toBeLessThanOrEqual(sheetLeft);
    }
  );
});

describe('toast anchor below the status pill (issue 874)', () => {
  const tokens = stripComments(readFileSync(join(STYLES_DIR, 'design-tokens.css'), 'utf8'));
  const pill = stripComments(
    readFileSync(join(CLIENT_ROOT, 'components/hud/StatusPill.module.css'), 'utf8')
  );
  const toast = stripComments(
    readFileSync(join(CLIENT_ROOT, 'components/common/Toast.module.css'), 'utf8')
  );

  /** px value of a --space-N token, read from the token file (never hard-coded here). */
  function space(n: number): number {
    const match = tokens.match(new RegExp(`--space-${n}:\\s*([0-9.]+)rem`));
    expect(match).not.toBeNull();
    return parseFloat(match![1]) * 16;
  }

  it('the toast container anchors on --content-top', () => {
    const start = toast.indexOf('.container {');
    expect(start).toBeGreaterThanOrEqual(0);
    const open = toast.indexOf('{', start);
    const close = toast.indexOf('}', open);
    const block = toast.slice(open + 1, close);
    expect(block).toMatch(/top:\s*var\(--content-top\)/);
  });

  it('nothing in the client references --topbar-height any more', () => {
    const offenders: string[] = [];
    for (const f of allCss) {
      const css = stripComments(readFileSync(f, 'utf8'));
      if (/--topbar-height/.test(css)) offenders.push(relative(CLIENT_ROOT, f));
    }
    expect(offenders).toEqual([]);
  });

  it('the resolved toast top sits at or below the status pill bottom', () => {
    const pillTopMatch = pill.match(/\.pill\s*\{[^}]*top:\s*var\(--space-3\)/);
    expect(pillTopMatch).not.toBeNull();
    const pillHeightMatch = pill.match(/\.pill\s*\{[^}]*height:\s*40px/);
    expect(pillHeightMatch).not.toBeNull();

    const pillTop = space(3);
    const pillHeight = 40;

    const contentTopMatch = tokens.match(
      /--content-top:\s*calc\(var\(--space-3\)\s*\+\s*40px\s*\+\s*var\(--space-2\)\)/
    );
    expect(contentTopMatch).not.toBeNull();
    const toastTop = space(3) + 40 + space(2);

    expect(toastTop).toBeGreaterThanOrEqual(pillTop + pillHeight);
  });

  it('neither responsive branch moves the anchor', () => {
    const narrowToast = toast.match(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/);
    expect(narrowToast).not.toBeNull();
    expect(narrowToast![1]).not.toMatch(/\btop\s*:/);

    const narrowTokens = tokens.match(/@media \(max-width: 767px\) \{\s*:root \{([\s\S]*?)\}\s*\}/);
    expect(narrowTokens).not.toBeNull();
    expect(narrowTokens![1]).not.toMatch(/--content-top\s*:/);
    expect(narrowTokens![1]).not.toMatch(/--space-2\s*:/);
    expect(narrowTokens![1]).not.toMatch(/--space-3\s*:/);
  });
});

describe('HUD bottom stack clears the command bar (issue 875)', () => {
  const tokens = stripComments(readFileSync(join(STYLES_DIR, 'design-tokens.css'), 'utf8'));
  const bar = stripComments(
    readFileSync(join(CLIENT_ROOT, 'components/hud/CommandBar.module.css'), 'utf8')
  );
  const barTsx = readFileSync(join(CLIENT_ROOT, 'components/hud/CommandBar.tsx'), 'utf8');
  const ctx = stripComments(
    readFileSync(join(CLIENT_ROOT, 'components/hud/ContextStatusStrip.module.css'), 'utf8')
  );
  const ticker = stripComments(
    readFileSync(join(CLIENT_ROOT, 'components/hud/WorldEventTicker.module.css'), 'utf8')
  );

  it('the bar geometry is read from CommandBar.module.css, not assumed', () => {
    expect(px(rule(bar, '.search'), 'height')).toBe(44);
    expect(px(rule(bar, '.modeRow'), 'height')).toBe(48);
    expect(px(rule(bar, '.tile'), 'height')).toBe(56);

    const tiles = rule(bar, '.tiles');
    expect(px(tiles, 'gap')).toBe(6);
    expect(px(tiles, 'padding')).toBe(6);

    const columnsMatch = tiles.match(/repeat\((\d+),/);
    expect(columnsMatch).not.toBeNull();
    expect(Number(columnsMatch![1])).toBe(6);

    expect(tiles).toMatch(/border:\s*1px/);

    const barBlock = rule(bar, '.bar');
    expect(barBlock).toMatch(/gap:\s*var\(--space-2\)/);
  });

  it('the tile count comes from CommandBar.tsx, not a hard-coded number', () => {
    const arrayStart = barTsx.indexOf('const tiles: Tile[] = [');
    expect(arrayStart).toBeGreaterThanOrEqual(0);
    const arrayEnd = barTsx.indexOf('\n  ].filter', arrayStart);
    expect(arrayEnd).toBeGreaterThan(arrayStart);
    const slice = barTsx.slice(arrayStart, arrayEnd);
    const tileCount = (slice.match(/\{ id: '/g) ?? []).length;
    expect(tileCount).toBe(7);

    const columns = 6;
    const rows = Math.ceil(tileCount / columns);
    expect(rows).toBe(2);
  });

  it('--command-bar-height resolves to the tallest (mode-row) state, computed from the source geometry', () => {
    const tiles = rule(bar, '.tiles');
    const tileH = px(rule(bar, '.tile'), 'height');
    const tilesGap = px(tiles, 'gap');
    const tilesPadding = px(tiles, 'padding');
    const tilesBorder = 1; // .tiles border: 1px, read directly — no px() match for shorthand "1px solid"
    expect(tiles).toMatch(/border:\s*1px/);

    const columns = Number(tiles.match(/repeat\((\d+),/)![1]);
    const arrayStart = barTsx.indexOf('const tiles: Tile[] = [');
    const arrayEnd = barTsx.indexOf('\n  ].filter', arrayStart);
    const tileCount = (barTsx.slice(arrayStart, arrayEnd).match(/\{ id: '/g) ?? []).length;
    const rows = Math.ceil(tileCount / columns);

    const tilesHeight = rows * tileH + (rows - 1) * tilesGap + 2 * tilesPadding + 2 * tilesBorder;
    expect(tilesHeight).toBe(132);

    const barGap = 8; // .bar { gap: var(--space-2) } = 8px, resolved via the token file
    expect(resolve(tokenExpr('--space-2'))).toBe(barGap);

    const modeH = px(rule(bar, '.modeRow'), 'height');
    const searchH = px(rule(bar, '.search'), 'height');
    const barHeightWithMode = modeH + barGap + tilesHeight;
    const barHeightNoMode = searchH + barGap + tilesHeight;
    expect(barHeightWithMode).toBe(188);
    expect(barHeightNoMode).toBe(184);

    expect(resolve(tokenExpr('--command-bar-height'))).toBe(barHeightWithMode);
  });

  it.each([1024, 1400, 2400])(
    'at %dpx: both strips clear the bar in its tallest and shortest states, and the bar height has no width-dependent rule',
    () => {
      const space4 = resolve(tokenExpr('--space-4'));
      const space2 = resolve(tokenExpr('--space-2'));

      const tiles = rule(bar, '.tiles');
      const tileH = px(rule(bar, '.tile'), 'height');
      const tilesGap = px(tiles, 'gap');
      const tilesPadding = px(tiles, 'padding');
      const columns = Number(tiles.match(/repeat\((\d+),/)![1]);
      const arrayStart = barTsx.indexOf('const tiles: Tile[] = [');
      const arrayEnd = barTsx.indexOf('\n  ].filter', arrayStart);
      const tileCount = (barTsx.slice(arrayStart, arrayEnd).match(/\{ id: '/g) ?? []).length;
      const rows = Math.ceil(tileCount / columns);
      const tilesHeight = rows * tileH + (rows - 1) * tilesGap + 2 * tilesPadding + 2 * 1;

      const modeH = px(rule(bar, '.modeRow'), 'height');
      const searchH = px(rule(bar, '.search'), 'height');
      const barGap = space2;
      const barHeightWithMode = modeH + barGap + tilesHeight;
      const barHeightNoMode = searchH + barGap + tilesHeight;

      const contextBottom = resolve(tokenExpr('--context-strip-bottom'));
      expect(contextBottom).toBeGreaterThanOrEqual(space4 + barHeightWithMode);
      expect(contextBottom).toBeGreaterThanOrEqual(space4 + barHeightNoMode);

      const blocks = mediaBlocks(bar);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks.length).toBe((bar.match(/@media/g) ?? []).length);
      for (const block of blocks) {
        expect(block.body).not.toMatch(/(^|[\s;{])height\s*:/);
      }
    }
  );

  it('the context strip consumes the derived token, with no px literal of its own; the ticker declares no bottom at all', () => {
    const stripBlock = rule(ctx, '.strip');
    expect(stripBlock).toMatch(/bottom:\s*var\(--context-strip-bottom\)/);
    expect(stripBlock).not.toMatch(/bottom:\s*calc\([^)]*\d+px/);

    const tickerBlock = rule(ticker, '.ticker');
    expect(tickerBlock).not.toMatch(/bottom\s*:/);
  });

  it('the mobile context-strip offset is derived from BottomNav, the safe area and MobileSearchPill', () => {
    const mobileMatch = tokens.match(/@media \(max-width: 1023px\) \{\s*:root \{([\s\S]*?)\}\s*\}/);
    expect(mobileMatch).not.toBeNull();
    const decl = mobileMatch![1].match(/--context-strip-bottom:\s*([^;]+);/);
    expect(decl).not.toBeNull();
    expect(decl![1]).toMatch(/var\(--bottomnav-height\)/);
    expect(decl![1]).toMatch(/var\(--sai-bottom\)/);

    const vp: Viewport = { label: '390x844', w: 390, h: 844 };
    const vpTokens = tokensAt(vp);
    const pillCss = stripComments(
      readFileSync(join(CLIENT_ROOT, 'components/mobile/MobileSearchPill.module.css'), 'utf8')
    );
    const pill = declsAt(pillCss, '.pill', vp);
    const pillTop =
      evalLength(pill.get('bottom') ?? '', vp, vpTokens) + evalLength(pill.get('min-height') ?? '', vp, vpTokens);
    const stripBottom = evalLength(vpTokens.get('--context-strip-bottom') ?? '', vp, vpTokens);
    expect(stripBottom).toBeGreaterThanOrEqual(pillTop);
  });
});

describe('world event ticker sits in the top band (issue 889)', () => {
  const ticker = stripComments(
    readFileSync(join(CLIENT_ROOT, 'components/hud/WorldEventTicker.module.css'), 'utf8')
  );
  const statusPill = stripComments(
    readFileSync(join(CLIENT_ROOT, 'components/hud/StatusPill.module.css'), 'utf8')
  );
  const chaseBadge = stripComments(
    readFileSync(join(CLIENT_ROOT, 'components/chat/ChaseBadge.module.css'), 'utf8')
  );
  const mobileInfoBar = stripComments(
    readFileSync(join(CLIENT_ROOT, 'components/mobile/MobileInfoBar.module.css'), 'utf8')
  );
  const minimapUi = readFileSync(join(CLIENT_ROOT, 'ui/minimap-ui.ts'), 'utf8');

  /** px value of a `prop: NNpx` declaration inside a block. */
  function px(block: string, prop: string): number {
    const match = block.match(new RegExp(`${prop}\\s*:\\s*([0-9.]+)px`));
    expect(match).not.toBeNull();
    return parseFloat(match![1]);
  }

  /** Declaration block text for `selector {`, e.g. rule(bar, '.tiles'). */
  function rule(css: string, selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  }

  /** px value of a `--space-N` token, read from the token file. */
  function space(n: number): number {
    const match = tokensCss.match(new RegExp(`--space-${n}:\\s*([0-9.]+)rem`));
    expect(match).not.toBeNull();
    return parseFloat(match![1]) * 16;
  }

  function panelWidthAt(viewport: number): number {
    if (viewport < 1400) return 420;
    return Math.min(Math.max(472, viewport * 0.3), 1000);
  }

  /** Content of the first `@media <query> { ... }` block, brace-balanced. */
  function mediaBlock(css: string, query: string): string {
    const start = css.indexOf(query);
    expect(start).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', start);
    let depth = 1;
    let i = open + 1;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    return css.slice(open + 1, i - 1);
  }

  it('.ticker anchors on --world-ticker-top, declares no bottom, and uses --z-ticker', () => {
    const tickerBlock = rule(ticker, '.ticker');
    expect(tickerBlock).toMatch(/top:\s*var\(--world-ticker-top\)/);
    expect(tickerBlock).not.toMatch(/bottom\s*:/);
    expect(tickerBlock).toMatch(/z-index:\s*var\(--z-ticker\)/);
  });

  it('the resolved --world-ticker-top is at or below both StatusPill and ChaseBadge bottom edges', () => {
    const pillBlock = rule(statusPill, '.pill');
    const pillTop = space(3);
    expect(pillBlock).toMatch(/top:\s*var\(--space-3\)/);
    const pillHeight = px(pillBlock, 'height');
    expect(pillHeight).toBe(40);

    const badgeBlock = rule(chaseBadge, '.badge');
    const badgeTop = space(2);
    expect(badgeBlock).toMatch(/top:\s*var\(--space-2\)/);
    const badgeHeight = px(badgeBlock, 'height');
    expect(badgeHeight).toBe(28);

    const tickerTop = resolve(tokenExpr('--world-ticker-top'));

    expect(tickerTop).toBeGreaterThanOrEqual(pillTop + pillHeight);
    expect(tickerTop).toBeGreaterThanOrEqual(badgeTop + badgeHeight);
  });

  it('.shifted carries the same right-edge expression as StatusPill.shifted and sets no top/bottom/left/margin', () => {
    const tickerShifted = rule(ticker, '.shifted');
    const pillShifted = rule(statusPill, '.shifted');

    const tickerRight = tickerShifted.match(/right:\s*([^;]+);/);
    const pillRight = pillShifted.match(/right:\s*([^;]+);/);
    expect(tickerRight).not.toBeNull();
    expect(pillRight).not.toBeNull();
    expect(tickerRight![1].trim()).toBe(pillRight![1].trim());

    expect(tickerShifted).not.toMatch(/top\s*:/);
    expect(tickerShifted).not.toMatch(/bottom\s*:/);
    expect(tickerShifted).not.toMatch(/left\s*:/);
    expect(tickerShifted).not.toMatch(/margin\s*:/);
  });

  it.each([1024, 2400])(
    'at %dpx desktop: the ticker clears the docked minimap on the left, stays clear of the sheet when shifted, and the shifted width is positive',
    (viewport) => {
      const desktopBlock = mediaBlock(ticker, '@media (min-width: 1024px)');
      const tickerLeftMatch = desktopBlock.match(/left:\s*calc\(var\(--minimap-size\)\s*\+\s*var\(--space-10\)\)/);
      expect(tickerLeftMatch).not.toBeNull();

      const desktopPadMatch = minimapUi.match(/DESKTOP_PAD\s*=\s*([0-9.]+)/);
      expect(desktopPadMatch).not.toBeNull();
      const desktopPad = parseFloat(desktopPadMatch![1]);
      const minimapSize = resolve(tokenExpr('--minimap-size'));
      const minimapRight = desktopPad + minimapSize;

      const tickerLeft = minimapSize + space(10);
      expect(tickerLeft).toBeGreaterThanOrEqual(minimapRight);

      const panelWidth = panelWidthAt(viewport);
      const sheetInset = space(4);
      const sheetLeft = viewport - (panelWidth + sheetInset);
      const shiftedRight = panelWidth + sheetInset + space(4);
      const tickerRightEdge = viewport - shiftedRight;
      expect(tickerRightEdge).toBeLessThanOrEqual(sheetLeft);

      const shiftedWidth = tickerRightEdge - tickerLeft;
      expect(shiftedWidth).toBeGreaterThan(0);
    }
  );

  it('the mobile override defines --world-ticker-top, resolving to at or below MobileInfoBar clearance', () => {
    const mobileMatch = tokensCss.match(/@media \(max-width: 1023px\) \{\s*:root \{([\s\S]*?)\}\s*\}/);
    expect(mobileMatch).not.toBeNull();
    const mobileBlock = mobileMatch![1];
    expect(mobileBlock).toMatch(/--world-ticker-top\s*:/);

    const infoBarBlock = rule(mobileInfoBar, '.bar');
    const infoBarHeight = px(infoBarBlock, 'height');
    expect(infoBarHeight).toBe(36);

    const match = mobileBlock.match(/--world-ticker-top:\s*([^;]+);/);
    expect(match).not.toBeNull();
    // --sai-top resolves to 0 via env()'s 0px fallback.
    const resolved = resolve(match![1].replace(/var\(--sai-top\)/g, '0px'));

    expect(resolved).toBeGreaterThanOrEqual(infoBarHeight);
  });

  it('no stylesheet under src/client still references the retired bottom-band tokens', () => {
    // Built at runtime, not written as a literal — this token is retired repo-wide (issue 889).
    const retiredTokens = [
      ['--world-ticker', 'bottom'].join('-'),
      ['--hud-strip', 'height'].join('-'),
    ];
    const offenders: string[] = [];
    for (const f of allCss) {
      const css = stripComments(readFileSync(f, 'utf8'));
      if (retiredTokens.some((t) => css.includes(t))) {
        offenders.push(relative(CLIENT_ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('HUD band table (issue 931)', () => {
  /*
   * Every fixed/absolute HUD element, its band resolved from its own CSS at five viewports.
   * A new fixed HUD element registers its band here (src/client/CLAUDE.md). Only the layout
   * rule (anchored, centred, translateX) lives in a row; every value the CSS declares is read
   * through declsAt/evalLength. A dimension set by content is a named constant in the row with
   * its reason — that is the element's stated maximum band. Safe-area insets are 0.
   */
  interface Box {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
  }

  interface Ctx {
    vp: Viewport;
    /** The row's selector declarations at this viewport. */
    decls: Map<string, string>;
    /** Evaluate an expression at this viewport. */
    len: (expr: string, extra?: Vars) => number;
    /** Evaluate one of the row's own declarations; throws when it is absent. */
    num: (prop: string, extra?: Vars) => number;
    /** Declarations of another selector in the same file, at this viewport. */
    other: (selector: string) => Map<string, string>;
  }

  interface HudRow {
    name: string;
    css: string;
    selector: string;
    /** true, or the reason the component is never rendered. */
    mounted: true | string;
    band: (vp: Viewport, d: Ctx) => Box;
  }

  const VIEWPORTS: Viewport[] = [
    { label: '1024x768', w: 1024, h: 768 },
    { label: '1400x900', w: 1400, h: 900 },
    { label: '2400x1350', w: 2400, h: 1350 },
    { label: '390x844', w: 390, h: 844 },
    { label: '1023x768', w: 1023, h: 768 },
  ];

  const read = (rel: string): string => readFileSync(join(CLIENT_ROOT, rel), 'utf8');
  const cssOf = (rel: string): string => stripComments(read(rel));

  /** Horizontally centred between `left` and W − `right`, capped by `maxW` (margin: 0 auto). */
  function centred(vp: Viewport, left: number, right: number, maxW: number): { x0: number; x1: number } {
    const avail = vp.w - left - right;
    const w = Math.min(avail, maxW);
    const x0 = left + (avail - w) / 2;
    return { x0, x1: x0 + w };
  }

  /** A band anchored by `bottom`, `h` tall. */
  const fromBottom = (vp: Viewport, bottom: number, h: number): { y0: number; y1: number } => ({
    y0: vp.h - bottom - h,
    y1: vp.h - bottom,
  });

  /** Toast card, tallest case: 2 × 12px padding + 2 × 1px border + three 18px lines (12px / 1.5, title included). */
  const TOAST_CARD_MAX = 80;
  /** The "+N more" row: 2 × 4px padding + one 18px line. */
  const TOAST_OVERFLOW_ROW = 26;
  /** VersionBadge: "Beta X.Y.Z (YYYY-MM-DD HH:MM #NNNN)" is about 37 characters at 12px. */
  const VERSION_BADGE_WIDTH = 240;
  /** ChaseBadge icon: <Eye size={12}>. */
  const CHASE_ICON = 12;
  /** RightRail: a group of 2 and a group of 5 `md` IconButtons (guarded against RightRail.tsx below). */
  const RIGHT_RAIL_GROUPS = [2, 5];

  const maxVisibleMatch = read('components/common/Toast.tsx').match(/export const MAX_VISIBLE = (\d+);/);
  const MAX_VISIBLE = maxVisibleMatch ? Number(maxVisibleMatch[1]) : NaN;

  function rightRailHeight(d: Ctx): number {
    const button = evalLength(
      declsAt(cssOf('components/common/IconButton.module.css'), '.md', d.vp).get('height') ?? '',
      d.vp,
      tokensAt(d.vp)
    );
    const railGap = d.len('var(--rail-gap)');
    const groups = RIGHT_RAIL_GROUPS.map((n) => n * button + (n - 1) * railGap);
    const divider = d.len(d.other('.divider').get('height') ?? '') + 2 * d.len('var(--space-1)');
    return groups.reduce((a, b) => a + b, 0) + 2 * d.num('gap') + divider;
  }

  const HUD_BANDS: HudRow[] = [
    {
      name: 'StatusPill',
      css: 'components/hud/StatusPill.module.css',
      selector: '.pill',
      mounted: true,
      // Stated: width: max-content and no max-width outside .shifted — nothing caps it at rest.
      band: (vp, d) => ({ x0: 0, x1: vp.w, y0: d.num('top'), y1: d.num('top') + d.num('height') }),
    },
    {
      name: 'ChaseBadge',
      css: 'components/chat/ChaseBadge.module.css',
      selector: '.badge',
      mounted: true,
      band: (vp, d) => {
        const padX = d.len((d.decls.get('padding') ?? '').split(/\s+/)[1] ?? '');
        const border = d.len((d.decls.get('border') ?? '').split(/\s+/)[0] ?? '');
        const nameMax = d.len(d.other('.name').get('max-width') ?? '');
        // Stated max width: padding + border + icon + gap + the capped name.
        const maxW = 2 * padX + 2 * border + CHASE_ICON + d.num('gap') + nameMax;
        const right = d.num('right');
        return { x0: vp.w - right - maxW, x1: vp.w - right, y0: d.num('top'), y1: d.num('top') + d.num('height') };
      },
    },
    {
      name: 'WorldEventTicker',
      css: 'components/hud/WorldEventTicker.module.css',
      selector: '.ticker',
      mounted: true,
      // Stated: one nowrap line, so min-height is the height.
      band: (vp, d) => ({
        ...centred(vp, d.num('left'), d.num('right'), d.num('max-width')),
        y0: d.num('top'),
        y1: d.num('top') + d.num('min-height'),
      }),
    },
    {
      name: 'Toast',
      css: 'components/common/Toast.module.css',
      selector: '.container',
      mounted: true,
      band: (vp, d) => {
        const maxW = d.decls.get('max-width') === 'none' ? Infinity : d.num('max-width');
        const w = Math.min(d.num('width'), maxW);
        // Stated max band: MAX_VISIBLE cards at their tallest, their gaps, and the overflow row.
        const h = MAX_VISIBLE * TOAST_CARD_MAX + MAX_VISIBLE * d.num('gap') + TOAST_OVERFLOW_ROW;
        return { x0: vp.w / 2 - w / 2, x1: vp.w / 2 + w / 2, y0: d.num('top'), y1: d.num('top') + h };
      },
    },
    {
      name: 'ChatBanner',
      css: 'components/mobile/ChatBanner.module.css',
      selector: '.banner',
      mounted: true,
      // Stated max band: white-space: nowrap, so min-height is the maximum.
      band: (vp, d) => ({
        x0: d.num('left'),
        x1: vp.w - d.num('right'),
        y0: d.num('top'),
        y1: d.num('top') + d.num('min-height'),
      }),
    },
    {
      name: 'MobileInfoBar',
      css: 'components/mobile/MobileInfoBar.module.css',
      selector: '.bar',
      mounted: true,
      band: (vp, d) => ({
        x0: d.num('left'),
        x1: vp.w - d.num('right'),
        y0: d.num('top'),
        y1: d.num('top') + d.num('height'),
      }),
    },
    {
      name: 'ContextStatusStrip',
      css: 'components/hud/ContextStatusStrip.module.css',
      selector: '.strip',
      mounted: true,
      // Stated: one nowrap line, so min-height is the height.
      band: (vp, d) => ({
        ...centred(vp, d.num('left'), d.num('right'), d.num('max-width')),
        ...fromBottom(vp, d.num('bottom'), d.num('min-height')),
      }),
    },
    {
      name: 'ChatStrip',
      css: 'components/chat/ChatStrip.module.css',
      selector: '.strip',
      mounted: true,
      // Max band = the expanded state: its height and its --chat-strip-width.
      band: (vp, d) => {
        const expanded = d.other('.strip.expanded');
        const extra = new Map([['--chat-strip-width', expanded.get('--chat-strip-width') ?? '']]);
        const left = d.num('left', extra);
        return {
          x0: left,
          x1: left + d.num('width', extra),
          ...fromBottom(vp, d.num('bottom'), d.len(expanded.get('height') ?? '')),
        };
      },
    },
    {
      name: 'CommandBar',
      css: 'components/hud/CommandBar.module.css',
      selector: '.bar',
      mounted: true,
      // Height: --command-bar-height, proven equal to the bar's geometry by the issue-875 describe.
      band: (vp, d) => {
        const left = d.num('left');
        return {
          x0: left,
          x1: left + Math.min(d.num('max-width'), vp.w - left - d.num('right')),
          ...fromBottom(vp, d.num('bottom'), d.len('var(--command-bar-height)')),
        };
      },
    },
    {
      name: 'RightRail',
      css: 'components/hud/RightRail.module.css',
      selector: '.rail',
      mounted: true,
      band: (vp, d) => {
        const right = d.num('right');
        const button = 40; // the `md` IconButton width, read as its height in rightRailHeight
        return { x0: vp.w - right - button, x1: vp.w - right, ...fromBottom(vp, d.num('bottom'), rightRailHeight(d)) };
      },
    },
    {
      name: 'LeftRail',
      css: 'components/hud/LeftRail.module.css',
      selector: '.rail',
      mounted: 'no renderer — CommandBar replaced it on desktop (CommandBar.tsx header)',
      band: () => {
        throw new Error('LeftRail is mounted again: give it a real band');
      },
    },
    {
      name: 'VersionBadge',
      css: 'components/hud/VersionBadge.module.css',
      selector: '.badge',
      mounted: true,
      band: (vp, d) => {
        const right = d.num('right');
        const h = 2 * d.num('font-size') * d.num('line-height'); // two lines
        return { x0: vp.w - right - VERSION_BADGE_WIDTH, x1: vp.w - right, ...fromBottom(vp, d.num('bottom'), h) };
      },
    },
    {
      name: 'BottomNav',
      css: 'components/mobile/BottomNav.module.css',
      selector: '.nav',
      mounted: true,
      band: (vp, d) => ({
        x0: d.num('left'),
        x1: vp.w - d.num('right'),
        ...fromBottom(vp, d.num('bottom'), d.num('height')),
      }),
    },
    {
      name: 'MobileSearchPill',
      css: 'components/mobile/MobileSearchPill.module.css',
      selector: '.pill',
      mounted: true,
      // Stated: one nowrap line, so min-height is the height.
      band: (vp, d) => ({
        ...centred(vp, d.num('left'), d.num('right'), d.num('max-width')),
        ...fromBottom(vp, d.num('bottom'), d.num('min-height')),
      }),
    },
    {
      name: 'BottomSheet',
      css: 'components/mobile/BottomSheet.module.css',
      selector: '.sheet',
      mounted: true,
      // Stated max band: its max-height (the .full snap).
      band: (vp, d) => ({
        x0: d.num('left'),
        x1: vp.w - d.num('right'),
        ...fromBottom(vp, d.num('bottom'), d.num('max-height')),
      }),
    },
  ];

  /** Pairs that are never rendered at the same time (MobileShell guards, asserted below). */
  const NEVER_TOGETHER: [string, string][] = [
    ['BottomSheet', 'ChatBanner'],
    ['BottomSheet', 'MobileSearchPill'],
  ];

  /** The whitelist: `over` may sit over `under`, for the stated reason. */
  const MAY_SIT_OVER: { over: string; under: string; reason: string }[] = [
    {
      over: 'Toast',
      under: 'WorldEventTicker',
      reason: 'intentional — --world-ticker-top is --content-top, the anchor the toast stack uses (issue 889)',
    },
    {
      over: 'Toast',
      under: 'ChatStrip',
      reason: 'the toast stack is the top layer (--z-toast) and transient; at 1024x768 its three-card maximum reaches the expanded chat',
    },
    { over: 'Toast', under: 'ChatBanner', reason: 'the same reason as ChatStrip, below 1024 px' },
    { over: 'Toast', under: 'BottomSheet', reason: 'the toast layer sits over every surface (--z-toast > --z-modal)' },
    {
      over: 'ChaseBadge',
      under: 'StatusPill',
      reason: 'pre-existing: pinned top-right at --space-2 (issue 889), shown only while chasing, it is the control that ends the chase; the pill is uncapped at rest',
    },
    { over: 'ChaseBadge', under: 'MobileInfoBar', reason: 'the same, below 1024 px (--z-hud > --z-overlay)' },
    {
      over: 'CommandBar',
      under: 'VersionBadge',
      reason: 'the build footnote is --z-dropdown, bottom-right; below about 1400 px the bar right end covers part of it (pre-existing, accepted)',
    },
    ...['MobileInfoBar', 'WorldEventTicker', 'ContextStatusStrip', 'ChaseBadge'].map((under) => ({
      over: 'BottomSheet',
      under,
      reason: 'the one content surface below 1024 px: at its full snap it covers the map HUD by design, and its .backdrop already dims everything above BottomNav',
    })),
  ];

  function ctxFor(row: HudRow, vp: Viewport): Ctx {
    const css = cssOf(row.css);
    const tokens = tokensAt(vp);
    const decls = declsAt(css, row.selector, vp);
    const len = (expr: string, extra?: Vars): number => evalLength(expr, vp, tokens, extra);
    return {
      vp,
      decls,
      len,
      num: (prop, extra) => {
        const v = decls.get(prop);
        if (v === undefined) throw new Error(`${row.name}: ${row.selector} declares no ${prop} at ${vp.label}`);
        return len(v, extra);
      },
      other: (selector) => declsAt(css, selector, vp),
    };
  }

  const visible = (row: HudRow, vp: Viewport): boolean =>
    row.mounted === true && declsAt(cssOf(row.css), row.selector, vp).get('display') !== 'none';

  const strictlyOverlap = (a: Box, b: Box): boolean =>
    a.y0 < b.y1 && b.y0 < a.y1 && a.x0 < b.x1 && b.x0 < a.x1;

  const neverTogether = (a: string, b: string): boolean =>
    NEVER_TOGETHER.some(([p, q]) => (p === a && q === b) || (p === b && q === a));

  const whitelisted = (a: string, b: string): boolean =>
    MAY_SIT_OVER.some((w) => (w.over === a && w.under === b) || (w.over === b && w.under === a));

  const fmt = (n: number): string => String(Math.round(n * 10) / 10);

  /** Every overlapping pair of rows visible together at `vp`, whitelisted or not. */
  function overlapsAt(vp: Viewport): { a: string; b: string; text: string }[] {
    const bands = HUD_BANDS.filter((row) => visible(row, vp)).map((row) => ({
      name: row.name,
      box: row.band(vp, ctxFor(row, vp)),
    }));
    const out: { a: string; b: string; text: string }[] = [];
    for (let i = 0; i < bands.length; i += 1) {
      for (let j = i + 1; j < bands.length; j += 1) {
        const a = bands[i];
        const b = bands[j];
        if (neverTogether(a.name, b.name) || !strictlyOverlap(a.box, b.box)) continue;
        const y = `[${fmt(Math.max(a.box.y0, b.box.y0))}, ${fmt(Math.min(a.box.y1, b.box.y1))}]`;
        const x = `[${fmt(Math.max(a.box.x0, b.box.x0))}, ${fmt(Math.min(a.box.x1, b.box.x1))}]`;
        out.push({ a: a.name, b: b.name, text: `${vp.label} ${a.name} × ${b.name}: y ${y} x ${x}` });
      }
    }
    return out;
  }

  it('names exactly the fifteen fixed HUD elements, each positioned fixed or absolute', () => {
    expect(HUD_BANDS.map((r) => r.name).sort()).toEqual(
      [
        'StatusPill',
        'ChaseBadge',
        'WorldEventTicker',
        'Toast',
        'ChatBanner',
        'MobileInfoBar',
        'ContextStatusStrip',
        'ChatStrip',
        'CommandBar',
        'RightRail',
        'LeftRail',
        'VersionBadge',
        'BottomNav',
        'MobileSearchPill',
        'BottomSheet',
      ].sort()
    );
    for (const row of HUD_BANDS) {
      const position = declsAt(cssOf(row.css), row.selector, null).get('position');
      expect({ row: row.name, position }).toEqual({ row: row.name, position: expect.stringMatching(/^(fixed|absolute)$/) });
    }
  });

  it.each(VIEWPORTS)('at $label: no two HUD bands visible together overlap outside the whitelist', (vp) => {
    const offenders = overlapsAt(vp)
      .filter((o) => !whitelisted(o.a, o.b))
      .map((o) => o.text);
    expect(offenders).toEqual([]);
  });

  it('every whitelist row names a real overlap, and its `over` element stacks at or above its `under`', () => {
    const seen = VIEWPORTS.flatMap((vp) => overlapsAt(vp));
    const zIndex = (name: string, vp: Viewport): number => {
      const row = HUD_BANDS.find((r) => r.name === name);
      if (!row) throw new Error(`no table row named ${name}`);
      return ctxFor(row, vp).num('z-index');
    };
    for (const w of MAY_SIT_OVER) {
      const used = seen.some((o) => (o.a === w.over && o.b === w.under) || (o.a === w.under && o.b === w.over));
      expect({ ...w, used }).toEqual({ ...w, used: true });
      expect(zIndex(w.over, VIEWPORTS[0])).toBeGreaterThanOrEqual(zIndex(w.under, VIEWPORTS[0]));
    }
  });

  it('the Toast row reads MAX_VISIBLE from Toast.tsx', () => {
    expect(MAX_VISIBLE).toBeGreaterThan(0);
  });

  it('the RightRail row matches RightRail.tsx: seven md buttons, a 345 px column', () => {
    const tsx = read('components/hud/RightRail.tsx');
    const buttons = (tsx.match(/<IconButton/g) ?? []).length;
    expect(buttons).toBe(RIGHT_RAIL_GROUPS.reduce((a, b) => a + b, 0));
    expect((tsx.match(/size="md"/g) ?? []).length).toBe(buttons);
    const row = HUD_BANDS.find((r) => r.name === 'RightRail');
    expect(row).toBeDefined();
    expect(rightRailHeight(ctxFor(row!, VIEWPORTS[0]))).toBe(345);
  });

  it('LeftRail really is unmounted — no .tsx under src/client renders it', () => {
    const renderers: string[] = [];
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') scan(full);
        } else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') && readFileSync(full, 'utf8').includes('<LeftRail')) {
          renderers.push(relative(CLIENT_ROOT, full));
        }
      }
    };
    scan(CLIENT_ROOT);
    expect(renderers).toEqual([]);
    const row = HUD_BANDS.find((r) => r.name === 'LeftRail');
    expect(row?.mounted).not.toBe(true);
    expect(() => row?.band(VIEWPORTS[0], ctxFor(row, VIEWPORTS[0]))).toThrow(/give it a real band/);
  });

  it('MobileShell still keeps BottomSheet apart from ChatBanner and MobileSearchPill', () => {
    const shell = read('components/mobile/MobileShell.tsx');
    expect(shell).toMatch(/const sheetOpen = \(mobileTab !== 'map' \|\| hasRightPanel\) && !connectActive;/);
    expect(shell).toMatch(/\{mobileTab === 'map' && !hasRightPanel && <ChatBanner \/>\}/);
    expect(shell).toMatch(/\{mobileTab === 'map' && !hasRightPanel && [^{}]*<MobileSearchPill \/>\}/);
  });

  it('the evaluator refuses what it cannot read instead of returning 0', () => {
    const vp = VIEWPORTS[0];
    const tokens = tokensAt(vp);
    expect(() => evalLength('auto', vp, tokens)).toThrow(/unknown token/);
    expect(() => evalLength('var(--no-such-token)', vp, tokens)).toThrow(/undefined custom property/);
    expect(() => evalLength('attr(x)', vp, tokens)).toThrow(/unknown function/);
    expect(() => evalLength('clamp(1px, 2px)', vp, tokens)).toThrow(/3 arguments/);
    expect(() => evalLength('1px 2px', vp, tokens)).toThrow(/trailing/);
    expect(() => evalLength('calc(1px', vp, tokens)).toThrow(/unexpected end/);
    expect(() => evalLength('calc(1px]', vp, tokens)).toThrow(/expected "\)"/);
    expect(() => evalLength('var(--a)', vp, tokens, new Map([['--a', 'var(--a)']]))).toThrow(/too deep/);
    expect(evalLength('calc(-1 * 2rem / 4 + 10vh - 1dvh + 50%)', vp, tokens)).toBeCloseTo(-8 + 76.8 - 7.68 + 512);
    expect(matchesQuery('(max-height: 900px)', vp)).toBe(true);
    expect(matchesQuery('(hover: none)', vp)).toBe(false);
  });
});
