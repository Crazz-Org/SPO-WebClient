/**
 * The Docker build stamps the release version into package.json when an
 * APP_VERSION build argument is supplied, so vite's __APP_VERSION__ and the
 * server's runtime manifest carry the real version instead of 0.0.0-dev.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');

function readStages(): Map<string, string[]> {
  const lines = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8').split('\n').map((l) => l.trim());
  const stages = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of lines) {
    const m = /^FROM\s+\S+\s+AS\s+(\S+)/i.exec(line);
    if (/^FROM\s/.test(line)) {
      current = [];
      stages.set(m ? m[1] : `stage${stages.size}`, current);
      continue;
    }
    if (current) current.push(line);
  }
  return stages;
}

function stage(name: string): string[] {
  const s = readStages().get(name);
  if (!s) throw new Error(`Dockerfile has no stage "${name}"`);
  return s;
}

function stampLine(): string {
  const line = stage('builder').find((l) => l.startsWith('RUN ') && l.includes('npm version'));
  if (!line) throw new Error('builder stage has no npm version stamp line');
  return line;
}

function readVersion(file: string): string {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { version?: unknown }).version !== 'string') {
    throw new Error(`${file} has no string version`);
  }
  return (parsed as { version: string }).version;
}

describe('Dockerfile version stamp — static', () => {
  it('declares ARG APP_VERSION after npm ci, stamps before npm run build', () => {
    const b = stage('builder');
    const ci = b.indexOf('RUN npm ci');
    const arg = b.findIndex((l) => /^ARG APP_VERSION(=.*)?$/.test(l));
    const stamp = b.indexOf(stampLine());
    const build = b.indexOf('RUN npm run build');
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(arg).toBeGreaterThanOrEqual(0);
    expect(stamp).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThanOrEqual(0);
    expect(ci).toBeLessThan(arg);
    expect(arg).toBeLessThan(stamp);
    expect(stamp).toBeLessThan(build);
  });

  it('stamp line strips the v prefix and never tags', () => {
    const line = stampLine();
    expect(line).toContain('--no-git-tag-version');
    expect(line).toContain('--allow-same-version');
    expect(line).toContain('${APP_VERSION#v}');
  });

  it('production stage copies the stamped package.json after npm ci --omit=dev', () => {
    const p = stage('production');
    const ci = p.indexOf('RUN npm ci --omit=dev');
    const copy = p.findIndex((l) => /^COPY --from=builder \/app\/package\.json /.test(l));
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(copy).toBeGreaterThan(ci);
  });

  it('vite still defines __APP_VERSION__ from package.json version', () => {
    const vite = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
    expect(vite).toMatch(/import\s+pkg\s+from\s+['"]\.\/package\.json['"]/);
    expect(vite).toMatch(/__APP_VERSION__\s*:\s*JSON\.stringify\(\s*pkg\.version\s*\)/);
  });
});

describe('Dockerfile version stamp — behaviour of the exact line', () => {
  const repoPkg = path.join(ROOT, 'package.json');
  const before = fs.readFileSync(repoPkg, 'utf8');
  const repoVersion = readVersion(repoPkg);
  let tmp = '';

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-dockerfile-version-'));
    fs.copyFileSync(repoPkg, path.join(tmp, 'package.json'));
    fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(tmp, 'package-lock.json'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  afterAll(() => {
    expect(fs.readFileSync(repoPkg, 'utf8')).toBe(before);
  });

  function run(value: string | undefined): void {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.APP_VERSION;
    if (value !== undefined) env.APP_VERSION = value;
    execFileSync('sh', ['-c', stampLine().replace(/^RUN /, '')], { cwd: tmp, env, stdio: 'pipe' });
  }

  it('v1.2.3 → 1.2.3 in package.json and package-lock.json', () => {
    run('v1.2.3');
    expect(readVersion(path.join(tmp, 'package.json'))).toBe('1.2.3');
    expect(readVersion(path.join(tmp, 'package-lock.json'))).toBe('1.2.3');
  }, 30_000);

  it('1.2.3 → 1.2.3', () => {
    run('1.2.3');
    expect(readVersion(path.join(tmp, 'package.json'))).toBe('1.2.3');
  }, 30_000);

  it('empty → unchanged', () => {
    run('');
    expect(readVersion(path.join(tmp, 'package.json'))).toBe(repoVersion);
  }, 30_000);

  it('unset → unchanged', () => {
    run(undefined);
    expect(readVersion(path.join(tmp, 'package.json'))).toBe(repoVersion);
  }, 30_000);
});
