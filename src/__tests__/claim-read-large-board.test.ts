/**
 * #1201 — board:claim must survive a board whose JSON exceeds the kernel's 128 KiB cap on a
 * single argv string. Runs the real scripts/claim-read.sh against a stub `gh`.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '../../scripts/claim-read.sh');

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-read-large-'));
  fs.writeFileSync(path.join(tmp, 'gh'), '#!/usr/bin/env bash\ncat "$CLAIM_FIXTURE"\n', { mode: 0o755 });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function fixture(doneCount: number): string {
  const nodes: unknown[] = [];
  for (let i = 0; i < doneCount; i++) {
    nodes.push({
      id: `PVTI_done_${String(i).padStart(8, '0')}`,
      content: { number: 10000 + i, title: `a long enough title for a finished card number ${i} on the board` },
      fieldValues: { nodes: [{ name: 'Done', field: { name: 'Status' } }] },
    });
  }
  nodes.push({
    id: 'PVTI_todo_1',
    content: { number: 42, title: 'the todo card' },
    fieldValues: {
      nodes: [
        { name: 'Todo', field: { name: 'Status' } },
        { text: 'infra', field: { name: 'Area' } },
      ],
    },
  });
  const page = {
    data: {
      rateLimit: { cost: 2, remaining: 4990, resetAt: '2026-09-30T00:00:00Z' },
      organization: {
        projectV2: {
          id: 'PVT_fixture',
          fields: {
            nodes: [
              { id: 'F_status', name: 'Status', options: [{ id: 'o_todo', name: 'Todo' }, { id: 'o_done', name: 'Done' }] },
              { id: 'F_session', name: 'Session' },
              { id: 'F_area', name: 'Area' },
            ],
          },
          items: { totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes },
        },
      },
      repository: { issues: { nodes: [] } },
    },
  };
  return JSON.stringify(page);
}

function run(doneCount: number): { out: string; size: number } {
  const file = path.join(tmp, `fixture-${doneCount}.json`);
  const json = fixture(doneCount);
  fs.writeFileSync(file, json);
  const out = execFileSync('bash', [SCRIPT], {
    env: { ...process.env, PATH: `${tmp}:${process.env.PATH ?? ''}`, CLAIM_FIXTURE: file },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { out, size: json.length };
}

describe('claim-read.sh on a board larger than one argv string', () => {
  it('reads a >128 KiB board to completion', () => {
    const { out, size } = run(2000);
    expect(size).toBeGreaterThan(200 * 1024);
    expect(out).toContain('items: 2001/2001');
    expect(out).toContain('candidates: 1');
    expect(out).toContain('  1 #42 area=infra the todo card');
    expect(out).toContain('projectId: PVT_fixture');
  });

  it('still reads a small board the same way', () => {
    const { out } = run(3);
    expect(out).toContain('items: 4/4');
    expect(out).toContain('candidates: 1');
    expect(out).toContain('  1 #42 area=infra the todo card');
    expect(out).toContain('projectId: PVT_fixture');
    expect(out).toContain('field Status: F_status Todo=o_todo Done=o_done');
  });
});
