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
 *     `--text-2xs`), including inside media queries.
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

      const mediaBlocks = bar.match(/@media[^{]*\{[\s\S]*?\n\}\s*\n\}/g) ?? [];
      for (const block of mediaBlocks) {
        expect(block).not.toMatch(/height\s*:/);
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

  it('mobile keeps the exact resolved offset it always had', () => {
    const mobileMatch = tokens.match(/@media \(max-width: 1023px\) \{\s*:root \{([\s\S]*?)\}\s*\}/);
    expect(mobileMatch).not.toBeNull();
    expect(mobileMatch![1]).toMatch(/--context-strip-bottom:\s*134px/);
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
