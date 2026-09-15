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

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
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
