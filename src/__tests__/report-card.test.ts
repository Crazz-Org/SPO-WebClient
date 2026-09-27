/**
 * scripts/report-card.js — the render contract `parseCardOutput` reads, and the
 * `--check-public` leak check that stands before a drafted card reaches the public board.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '../../scripts/report-card.js');

jest.setTimeout(30000);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { stdio: 'pipe', encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (err: unknown) {
    const e = err as { status: number | null; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const ON_SCREEN = 'Tax rate shows zero percent for all districts';
const EXPECTED_TEXT = 'I expected the tax rate to match the value I set yesterday';
const NESTED_PAYLOAD = 'secret nested payload string from the server';

function baseReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: 'r-1',
    profile: 'desktop',
    kind: 'wrong-data',
    createdAtUtc: '2026-09-27T10:00:00.000Z',
    anchorKey: 'abc123',
    username: 'Zorblax',
    world: 'planitia',
    userAgent: 'jest',
    viewport: { width: 1280, height: 720 },
    anchor: {
      kind: 'dom',
      componentChain: ['GameScreen', 'PoliticsPanel', 'TaxRow'],
      cssChain: 'div > span',
      text: ON_SCREEN,
    },
    observed: 'the number looked completely wrong after reload',
    expected: EXPECTED_TEXT,
    journal: [
      { t: 'ws-in', ts: 1, msgType: 'RESP_TAX_INFO', payload: { outer: { inner: NESTED_PAYLOAD } } },
      { t: 'console', ts: 2, level: 'warn', message: 'short' },
    ],
    ...overrides,
  };
}

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-card-test-'));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function write(content: string): string {
  counter++;
  const file = path.join(dir, `f${counter}`);
  fs.writeFileSync(file, content);
  return file;
}

function check(report: Record<string, unknown>, candidate: string): RunResult {
  return run(['--check-public', write(JSON.stringify(report)), write(candidate)]);
}

describe('report-card.js --check-public', () => {
  it('flags the username in another case inside a sentence, without printing it', () => {
    const r = check(baseReport(), 'The player ZORBLAX saw a wrong tax rate.');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('leak: username');
    expect(r.stdout.toLowerCase()).not.toContain('zorblax');
  });

  it('flags a quote of expected', () => {
    const r = check(baseReport(), 'Summary: "the tax rate to match the value" was expected.');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('leak: free-text');
  });

  it('flags a quote of freeText with different whitespace and case', () => {
    const report = baseReport({
      profile: 'mobile',
      quickPicks: ['covered'],
      observed: undefined,
      expected: undefined,
      freeText: 'The build button disappears behind the bottom bar',
    });
    const r = check(report, 'Player says: THE BUILD\n  button   DISAPPEARS behind it.');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('leak: free-text');
  });

  it('allows quoting observed when it is the on-screen anchor text', () => {
    const r = check(baseReport({ observed: ON_SCREEN }), `The panel reads "${ON_SCREEN}".`);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('flags a ws-in payload string nested two levels deep', () => {
    const r = check(baseReport(), `Server sent ${NESTED_PAYLOAD} back.`);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('leak: journal');
  });

  it('flags a console message of 24+ characters', () => {
    const report = baseReport({
      journal: [{ t: 'console', ts: 2, level: 'error', message: 'Uncaught TypeError in tax panel render' }],
    });
    const r = check(report, 'Log: uncaught typeerror in tax panel render.');
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('leak: journal\n');
  });

  it('passes a clean summary naming world, msgType, component chain and anchorKey marker', () => {
    const candidate = [
      'On planitia the tax panel shows a wrong value after RESP_TAX_INFO.',
      'Component: GameScreen > PoliticsPanel > TaxRow',
      '<!-- anchorKey: abc123 -->',
    ].join('\n');
    const r = check(baseReport(), candidate);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('does not flag a username found only inside a longer word', () => {
    const r = check(baseReport({ username: 'Zorb' }), 'Zorblax is a word here.');
    expect(r.code).toBe(0);
  });

  it('exits 2 on a missing candidate file', () => {
    const r = run(['--check-public', write(JSON.stringify(baseReport())), path.join(dir, 'nope.md')]);
    expect(r.code).toBe(2);
  });

  it('exits 2 when only one path is given', () => {
    const r = run(['--check-public', write(JSON.stringify(baseReport()))]);
    expect(r.code).toBe(2);
  });

  it('exits 3 with found/expected on a version mismatch', () => {
    const r = check(baseReport({ version: 2 }), 'clean');
    expect(r.code).toBe(3);
    expect(r.stdout).toContain('found: 2');
    expect(r.stdout).toContain('expected: 1');
  });
});

describe('report-card.js render mode', () => {
  it('keeps the header contract parseCardOutput reads', () => {
    const r = run([write(JSON.stringify(baseReport()))]);
    expect(r.code).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toMatch(/^anchorKey: abc123$/);
    expect(lines[1]).toMatch(/^profile: desktop$/);
    expect(lines[2]).toMatch(/^kind: wrong-data$/);
    expect(lines[3]).toMatch(/^title: /);
    expect(lines[4]).toMatch(/^---$/);
  });
});
