import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guard for the chat strip's clearance over the command bar (issue #873): the strip's
 * `bottom` offset must be a composed `calc()` referencing the bar's measured height, not a
 * bare constant — and its fallback must sit above the bar's real (non-visitor) top edge, so an
 * eighth tile that pushes the grid to a third row fails this test until the fallback is raised.
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

function remToPx(css: string, token: string): number {
  const m = css.match(new RegExp(`${token}\\s*:\\s*([\\d.]+)rem`));
  if (!m) throw new Error(`could not find token ${token}`);
  return Number(m[1]) * 16;
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

  it("the fallback offset clears the non-visitor bar's real top edge", () => {
    // 1. row count from the actual tile list, not assumed.
    const tileMatches = commandBarTsx.match(/\{\s*id:\s*'/g) ?? [];
    const tileCount = tileMatches.length;
    expect(tileCount).toBeGreaterThan(0);

    const tilesBlock = block(commandBarCss, '.tiles {');
    const colsMatch = tilesBlock.match(/repeat\((\d+),/);
    expect(colsMatch).not.toBeNull();
    const columns = Number(colsMatch![1]);
    const rows = Math.ceil(tileCount / columns);

    // 2. bar geometry.
    const searchBlock = block(commandBarCss, '.search {');
    const searchHeight = px(searchBlock, 'height');
    const tilesGap = px(tilesBlock, 'gap');
    const tilesPadding = px(tilesBlock, 'padding');
    const tileBlock = block(commandBarCss, '.tile {');
    const tileHeight = px(tileBlock, 'height');

    const space2 = remToPx(tokensCss, '--space-2');
    const space4 = remToPx(tokensCss, '--space-4');
    const space3 = remToPx(tokensCss, '--space-3');

    const tilesGridHeight = tilesPadding + rows * tileHeight + (rows - 1) * tilesGap + tilesPadding;
    const barHeight = searchHeight + space2 + tilesGridHeight;
    const barTopEdge = space4 + barHeight;

    // 3. the strip's fallback offset.
    const stripBlock = block(chatStripCss, '.strip {');
    const m = stripBlock.match(/bottom:\s*calc\(([^;]+)\);/);
    expect(m).not.toBeNull();
    const expr = m![1];
    const fallbackMatch = expr.match(/var\(\s*--command-bar-height\s*,\s*(\d+)px\s*\)/);
    expect(fallbackMatch).not.toBeNull();
    const fallbackHeight = Number(fallbackMatch![1]);

    const stripBottomEdge = space4 + fallbackHeight + space3;

    expect(stripBottomEdge).toBeGreaterThan(barTopEdge);
  });
});
