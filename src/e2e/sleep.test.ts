import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as ts from 'typescript';
import { sleep } from './sleep';

afterEach(() => jest.restoreAllMocks());

describe('sleep (#1181)', () => {
  it('resolves, on a timer that keeps the process alive', async () => {
    const spy = jest.spyOn(global, 'setTimeout');
    await sleep(1);
    const timer = spy.mock.results[0].value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(true);
  });

  it('keeps Node alive after a flow closed its last socket and then sleeps', () => {
    const src = fs.readFileSync(path.join(__dirname, 'sleep.ts'), 'utf8');
    const js = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-sleep-'));
    const mod = path.join(dir, 'sleep.js');
    fs.writeFileSync(mod, js);
    const snippet = `
      const net = require('net');
      const { sleep } = require(${JSON.stringify(mod)});
      async function main() {
        const server = net.createServer(s => s.end());
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        const client = net.connect(server.address().port, '127.0.0.1');
        await new Promise(r => client.once('connect', r));
        client.destroy();
        await new Promise(r => server.close(r));
        await sleep(50);
        return 0;
      }
      main().then(c => { process.stdout.write('settled'); process.exit(c); });
    `;
    const res = spawnSync(process.execPath, ['-e', snippet], { encoding: 'utf8', timeout: 15_000 });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res.stdout).toContain('settled');
    expect(res.status).toBe(0);
  });
});
