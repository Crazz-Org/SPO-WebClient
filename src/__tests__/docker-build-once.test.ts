/**
 * Both images (gateway + cache-sync sidecar) are cut from one Dockerfile whose
 * single `builder` stage is the only place `npm run build` runs, so
 * `docker compose build` compiles the project once. And `build:server` uses
 * tsconfig.build.json, so no test file is compiled into dist/.
 *
 * No docker binary is available to the suite: the Dockerfile and compose shape
 * are pinned statically; the tsc census runs for real.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');

interface Stage {
  name: string;
  lines: string[];
}

function readStages(): Stage[] {
  const lines = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8').split('\n').map((l) => l.trim());
  const stages: Stage[] = [];
  for (const line of lines) {
    if (/^FROM\s/i.test(line)) {
      const m = /^FROM\s+\S+\s+AS\s+(\S+)/i.exec(line);
      stages.push({ name: m ? m[1] : `stage${stages.length}`, lines: [] });
      continue;
    }
    if (stages.length > 0) stages[stages.length - 1].lines.push(line);
  }
  return stages;
}

function stage(name: string): string[] {
  const s = readStages().find((st) => st.name === name);
  if (!s) throw new Error(`Dockerfile has no stage "${name}"`);
  return s.lines;
}

function composeServices(): Map<string, string[]> {
  const lines = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8').split('\n');
  const services = new Map<string, string[]>();
  let inServices = false;
  let current: string[] | null = null;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inServices = /^services:\s*$/.test(line);
      current = null;
      continue;
    }
    if (!inServices) continue;
    const m = /^ {2}([\w-]+):\s*$/.exec(line);
    if (m) {
      current = [];
      services.set(m[1], current);
      continue;
    }
    if (current) current.push(line.trim());
  }
  return services;
}

function service(name: string): string[] {
  const s = composeServices().get(name);
  if (!s) throw new Error(`docker-compose.yml has no service "${name}"`);
  return s;
}

function buildServerScript(): string {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error('package.json is not an object');
  const scripts: unknown = (parsed as { scripts?: unknown }).scripts;
  if (typeof scripts !== 'object' || scripts === null) throw new Error('package.json has no scripts');
  const script: unknown = (scripts as Record<string, unknown>)['build:server'];
  if (typeof script !== 'string') throw new Error('package.json has no build:server script');
  return script;
}

describe('Dockerfile — one build for both images', () => {
  it('has exactly one RUN npm run build, in the builder stage', () => {
    const hits = readStages().flatMap((s) => s.lines.filter((l) => l === 'RUN npm run build').map(() => s.name));
    expect(hits).toEqual(['builder']);
  });

  it('has no separate sidecar Dockerfile', () => {
    expect(fs.existsSync(path.join(ROOT, 'Dockerfile.cache-sync'))).toBe(false);
  });

  it('has builder, cache-sync and production stages, production last, none but builder building', () => {
    const stages = readStages();
    const names = stages.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['builder', 'cache-sync', 'production']));
    expect(names[names.length - 1]).toBe('production');
    for (const name of ['cache-sync', 'production']) {
      expect(stage(name).some((l) => l.includes('npm run build'))).toBe(false);
    }
  });

  it('cache-sync stage copies dist only, keeps its user, sentinel probe and entrypoint', () => {
    const c = stage('cache-sync');
    expect(c).toContain('COPY --from=builder /app/dist/ ./dist/');
    expect(c.some((l) => l.startsWith('COPY --from=builder /app/public/'))).toBe(false);
    expect(c).toContain('RUN groupadd -r spo && useradd -r -g spo -m spo');
    expect(c.some((l) => l.includes('/app/cache/.cache-sync-status.json'))).toBe(true);
    const cmds = c.filter((l) => l.startsWith('CMD ['));
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds[cmds.length - 1]).toContain('dist/server/cache-sync-service.js');
  });

  it('builder copies the tsconfig that build:server compiles', () => {
    const m = /-p\s+(\S+)/.exec(buildServerScript());
    expect(m).not.toBeNull();
    const file = (m as RegExpExecArray)[1];
    const copies = stage('builder').filter((l) => /^COPY\s/.test(l) && !l.includes('--from='));
    expect(copies.some((l) => l.split(/\s+/).slice(1, -1).includes(file))).toBe(true);
  });
});

describe('docker-compose.yml — both services target the one Dockerfile', () => {
  it.each([
    ['spo-webclient', 'production'],
    ['spo-cache-sync', 'cache-sync'],
  ])('%s builds Dockerfile target %s', (name, target) => {
    const s = service(name);
    expect(s).toContain('dockerfile: Dockerfile');
    expect(s).toContain(`target: ${target}`);
    expect(readStages().map((st) => st.name)).toContain(target);
  });
});

describe('build:server — no test file compiled into dist/', () => {
  it('tsconfig.build.json lists no test, __tests__ or __mocks__ file, and both entrypoints', () => {
    const out = execFileSync(
      process.execPath,
      [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--listFilesOnly'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const srcRoot = `${ROOT.split(path.sep).join('/')}/src/`;
    const files = out
      .split('\n')
      .map((l) => l.trim().split(path.sep).join('/'))
      .filter((l) => l.startsWith(srcRoot));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => /\.test\.tsx?$|\/__tests__\/|\/__mocks__\//.test(f))).toEqual([]);
    expect(files.some((f) => f.endsWith('/src/server/server.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('/src/server/cache-sync-service.ts'))).toBe(true);
  }, 120_000);
});
