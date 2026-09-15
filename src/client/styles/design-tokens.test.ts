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
  '--command-bar-height', // measured height, set by CommandBar.tsx
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
