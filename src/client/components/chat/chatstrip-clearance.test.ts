import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guard for the chat strip's clearance over the command bar (issue #873): the strip's
 * `bottom` offset must be a composed `calc()` referencing `--command-bar-height`, not a bare
 * constant — and the offset that expression resolves to must sit above the bar's real
 * (non-visitor) top edge, so an eighth tile that pushes the grid to a third row fails this test
 * until `--command-bar-height` is raised with it.
 *
 * At runtime CommandBar.tsx overwrites `--command-bar-height` on the document root with the bar's
 * measured height, which is what makes the shorter five-tile visitor bar track too; the declared
 * token checked here is the value before that first measurement.
 */

const CLIENT_ROOT = join(__dirname, '..', '..');
const COMMAND_BAR_TSX = join(CLIENT_ROOT, 'components', 'hud', 'CommandBar.tsx');
const COMMAND_BAR_CSS = join(CLIENT_ROOT, 'components', 'hud', 'CommandBar.module.css');
const CHAT_STRIP_CSS = join(CLIENT_ROOT, 'components', 'chat', 'ChatStrip.module.css');
const TOKENS_CSS = join(CLIENT_ROOT, 'styles', 'design-tokens.css');

function px(cssBlock: string, prop: string): number {
  const m = cssBlock.match(new RegExp(`${prop}\\s*:\\s*(\\d+)px`));
  if (!m) throw new Error(`could not find "${prop}: <n>px" in block`);
  return Number(m[1]);
}

/** Resolve an additive `calc()` of `<n>px` terms and `var(--token)` references to a number. */
function resolve(expr: string, tokens: Map<string, string>): number {
  const inner = expr.trim().startsWith('calc(')
    ? expr.trim().slice('calc('.length, -1)
    : expr.trim();
  return inner
    .split('+')
    .reduce((sum, rawTerm) => {
      const term = rawTerm.trim();
      const varMatch = term.match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/);
      if (varMatch) {
        const value = tokens.get(varMatch[1]);
        if (value === undefined) throw new Error(`token ${varMatch[1]} is not declared`);
        return sum + resolve(value, tokens);
      }
      const remMatch = term.match(/^([\d.]+)rem$/);
      if (remMatch) return sum + Number(remMatch[1]) * 16;
      const pxMatch = term.match(/^([\d.]+)px$/);
      if (pxMatch) return sum + Number(pxMatch[1]);
      throw new Error(`unsupported term in calc(): "${term}"`);
    }, 0);
}

/** Every `--token: value;` declared in the token sheet, so `resolve` can follow references. */
function readTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (!tokens.has(m[1])) tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

function block(css: string, selector: string): string {
  const idx = css.indexOf(selector);
  if (idx === -1) throw new Error(`selector ${selector} not found`);
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  return css.slice(open, close);
}

describe('the chat strip clears the command bar', () => {
  const commandBarTsx = readFileSync(COMMAND_BAR_TSX, 'utf8');
  const commandBarCss = readFileSync(COMMAND_BAR_CSS, 'utf8');
  const chatStripCss = readFileSync(CHAT_STRIP_CSS, 'utf8');
  const tokensCss = readFileSync(TOKENS_CSS, 'utf8');

  it('references the measured --command-bar-height, not a bare constant', () => {
    const stripBlock = block(chatStripCss, '.strip {');
    const m = stripBlock.match(/bottom:\s*(calc\([^;]+\));/);
    expect(m).not.toBeNull();
    const boundsDecl = m![1];
    expect(boundsDecl).toContain('var(--command-bar-height');
  });

  it("the resolved offset clears the non-visitor bar's real top edge", () => {
    const tokens = readTokens(tokensCss);

    // 1. row count from the actual tile list, not assumed — seven tiles in six columns wrap.
    const tileMatches = commandBarTsx.match(/\{\s*id:\s*'/g) ?? [];
    const tileCount = tileMatches.length;
    expect(tileCount).toBeGreaterThan(0);

    const tilesBlock = block(commandBarCss, '.tiles {');
    const colsMatch = tilesBlock.match(/repeat\((\d+),/);
    expect(colsMatch).not.toBeNull();
    const columns = Number(colsMatch![1]);
    const rows = Math.ceil(tileCount / columns);

    // 2. the bar's real height, in its tallest row state.
    const tilesGap = px(tilesBlock, 'gap');
    const tilesPadding = px(tilesBlock, 'padding');
    expect(tilesBlock).toMatch(/border:\s*1px/);
    const tilesBorder = 1;
    const tileHeight = px(block(commandBarCss, '.tile {'), 'height');
    const topRowHeight = Math.max(
      px(block(commandBarCss, '.search {'), 'height'),
      px(block(commandBarCss, '.modeRow {'), 'height'),
    );

    const tilesGridHeight =
      rows * tileHeight + (rows - 1) * tilesGap + 2 * tilesPadding + 2 * tilesBorder;
    const barHeight = topRowHeight + resolve('var(--space-2)', tokens) + tilesGridHeight;
    const barTopEdge = resolve('var(--space-4)', tokens) + barHeight;

    // The token the strip leans on must itself describe that bar — not one tile row.
    expect(resolve('var(--command-bar-height)', tokens)).toBe(barHeight);

    // 3. the strip's own bottom edge, resolved from its declaration.
    const m = block(chatStripCss, '.strip {').match(/bottom:\s*(calc\([^;]+\));/);
    expect(m).not.toBeNull();
    const stripBottomEdge = resolve(m![1], tokens);

    expect(stripBottomEdge).toBeGreaterThan(barTopEdge);
  });
});
