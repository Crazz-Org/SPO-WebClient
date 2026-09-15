import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import * as esbuild from 'esbuild';
import { benchPaths, ensureLayout, readHeartbeat, touchHeartbeat, type HeartbeatContent } from './paths';

const BEATS = 3000;

describe('heartbeat atomicity — the race the non-atomic write used to open', () => {
  it('a concurrent reader only ever sees beats that were actually written', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-hb-race-'));
    try {
      const code = esbuild.transformSync(fs.readFileSync(path.join(__dirname, 'paths.ts'), 'utf8'), {
        loader: 'ts',
        format: 'cjs',
      }).code;
      const modulePath = path.join(dir, 'paths.js');
      fs.writeFileSync(modulePath, code, 'utf8');
      const root = path.join(dir, 'bench');
      const paths = benchPaths(root);
      ensureLayout(paths);

      // Prime the file BEFORE the child starts: the parent would otherwise read an absent file
      // during process spawn and score those (legitimate) nulls as failures.
      touchHeartbeat(paths, { id: 'race', startedAt: 'prime' });

      const writer =
        "const p=require(process.argv[1]);const paths=p.benchPaths(process.argv[2]);" +
        "const n=+process.argv[3];for(let i=0;i<n;i++){p.touchHeartbeat(paths,{id:'race',startedAt:String(i)});}";
      const child = spawn(process.execPath, ['-e', writer, '--', modulePath, root, String(BEATS)]);
      let running = true;
      child.on('exit', () => {
        running = false;
      });

      const observed: (HeartbeatContent | null)[] = [];
      try {
        while (running) {
          for (let k = 0; k < 200; k++) observed.push(readHeartbeat(paths));
          await new Promise(resolve => setImmediate(resolve)); // let the exit event land
        }
      } finally {
        child.kill();
      }

      // The reads must actually have overlapped the writes.
      expect(observed.length).toBeGreaterThan(1_000);
      // Every read is one of the beats the writer actually wrote — never the empty-file artefact.
      const bad = observed.filter(
        beat =>
          beat === null ||
          beat.writtenAt === 0 ||
          !Number.isFinite(beat.writtenAt) ||
          beat.currentJob !== 'race' ||
          !(beat.startedAt === 'prime' || (/^\d+$/.test(beat.startedAt ?? '') && Number(beat.startedAt) < BEATS)),
      );
      expect({ bad: bad.length, first: bad[0] }).toEqual({ bad: 0, first: undefined });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
