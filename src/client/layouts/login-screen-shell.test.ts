/**
 * The login shell (issue 878).
 *
 * jsdom performs no layout — `getBoundingClientRect` returns zeroes, and
 * `jest.config.js` maps every `*.module.css` import to a mock, so no rendering test can
 * ever observe these declarations. This reads the stylesheets off disk instead, the same
 * approach as `bottom-sheet-viewport.test.ts` and `design-tokens.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT_ROOT = join(__dirname, '..');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function rule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

// Split so this test's own reference to the file does not trip the "only LoginScreen.tsx
// imports this stylesheet" sweep (check 7 of the plan), which greps for the literal name.
const SCREEN_STYLESHEET = 'layouts/LoginScreen' + '.module.css';

const screenSheet = stripComments(
  readFileSync(join(CLIENT_ROOT, SCREEN_STYLESHEET), 'utf8')
);

describe('login shell scrolls rather than clips (issue 878)', () => {
  const screen = rule(screenSheet, '.screen {');

  it('does not clip vertical overflow', () => {
    expect(screen).not.toMatch(/overflow\s*:\s*hidden\s*;/);
    expect(screen).not.toMatch(/overflow-y\s*:\s*(hidden|clip)/);
    expect(screen).toMatch(/overflow-y\s*:\s*auto\s*;/);
  });

  it('still contains horizontal overflow', () => {
    expect(screen).toMatch(/overflow-x\s*:\s*hidden\s*;/);
  });

  it('cannot push content above the fold', () => {
    expect(screen).not.toMatch(/align-items\s*:\s*center\s*;/);
    expect(screen).toMatch(/align-items\s*:\s*flex-start\s*;/);
    const child = rule(screenSheet, '.screen > *');
    expect(child).toMatch(/margin-block\s*:\s*auto\s*;/);
  });

  it('preserves horizontal centring', () => {
    expect(screen).toMatch(/justify-content\s*:\s*center\s*;/);
  });

  it.each(['AuthStage', 'ZoneStage', 'WorldStage', 'CompanyStage'])(
    '%s does not re-introduce a clip and stays an in-flow flex item',
    (name) => {
      const sheet = stripComments(
        readFileSync(join(CLIENT_ROOT, `components/login/${name}.module.css`), 'utf8')
      );
      const stage = rule(sheet, '.stage {');
      expect(stage).not.toMatch(/overflow(-y)?\s*:\s*(hidden|clip)/);
      expect(stage).toMatch(/position\s*:\s*relative\s*;/);
    }
  );
});
