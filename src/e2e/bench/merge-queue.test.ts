/**
 * Serving the merge queue — src/e2e/bench/merge-queue.ts.
 *
 * Two properties this file exists to pin:
 *
 * 1. **Only GitHub's own queue refs are ever gated.** A ref that merely looks similar must
 *    not pull the bench into driving something nobody asked about.
 * 2. **An entry is gated exactly once.** Gating twice wastes the one serialised resource;
 *    gating zero times leaves a required check unreported until the queue ejects the entry.
 * 3. **The entry is fetched before its tree is read.** The reverse order shipped once and
 *    made the dedup unreachable — every entry read an unknown tree and paid a live drive.
 */

import {
  fetchEntry,
  listQueueEntries,
  mayReuseVerdict,
  parseQueueRefs,
  serveMergeQueue,
  shouldGate,
  treeOf,
  type QueueEntry,
  type ReuseCandidate,
} from './merge-queue';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('parseQueueRefs', () => {
  it('takes the queue refs and their shas', () => {
    const raw = [
      `${SHA_A}\trefs/heads/gh-readonly-queue/main/pr-168-ce151856`,
      `${SHA_B}\trefs/heads/gh-readonly-queue/main/pr-170-ce151856`,
    ].join('\n');
    expect(parseQueueRefs(raw)).toEqual<QueueEntry[]>([
      { ref: 'gh-readonly-queue/main/pr-168-ce151856', sha: SHA_A },
      { ref: 'gh-readonly-queue/main/pr-170-ce151856', sha: SHA_B },
    ]);
  });

  it.each([
    ['an ordinary branch', `${SHA_A}\trefs/heads/main`],
    ['a session branch', `${SHA_A}\trefs/heads/claude-crazz/task-158-stage-d1`],
    ['a tag', `${SHA_A}\trefs/tags/v1.2.3`],
    ['a branch merely NAMED like a queue ref', `${SHA_A}\trefs/heads/my-gh-readonly-queue/main/pr-1`],
    ['a pull ref', `${SHA_A}\trefs/pull/168/head`],
  ])('ignores %s', (_label, line) => {
    expect(parseQueueRefs(line)).toEqual([]);
  });

  it('ignores blank and malformed lines rather than throwing', () => {
    expect(parseQueueRefs('\n\nnot-a-ref-line\n   \n')).toEqual([]);
  });

  it('reads nothing from an empty listing — no queue is the normal state', () => {
    expect(parseQueueRefs('')).toEqual([]);
  });
});

describe('listQueueEntries', () => {
  it('returns what the listing carries', () => {
    const entries = listQueueEntries(
      () => `${SHA_A}\trefs/heads/gh-readonly-queue/main/pr-1-abc`,
      '/repo',
      () => {},
    );
    expect(entries).toEqual([{ ref: 'gh-readonly-queue/main/pr-1-abc', sha: SHA_A }]);
  });

  it('treats an unreachable remote as a tick with nothing to do, not an error', () => {
    // The queue is GitHub's to manage. A listing we could not take must not wedge the
    // worker loop or stop it serving the ordinary spool.
    const logs: string[] = [];
    expect(
      listQueueEntries(
        () => {
          throw new Error('could not resolve host');
        },
        '/repo',
        line => logs.push(line),
      ),
    ).toEqual([]);
    expect(logs.join('\n')).toMatch(/could not list refs/);
  });
});

describe('shouldGate — exactly once', () => {
  const entry: QueueEntry = { ref: 'gh-readonly-queue/main/pr-1-abc', sha: SHA_A };

  it('gates an entry nobody has answered or claimed', () => {
    expect(shouldGate(entry, () => false, () => false)).toEqual({ skip: false });
  });

  it('skips an entry that already carries a bench/gate status', () => {
    const decision = shouldGate(entry, () => true, () => false);
    expect(decision.skip).toBe(true);
    expect(decision.why).toMatch(/already has a bench\/gate status/);
  });

  it('skips an entry whose job is already in the spool', () => {
    const decision = shouldGate(entry, () => false, () => true);
    expect(decision.skip).toBe(true);
    expect(decision.why).toMatch(/already in the spool/);
  });

  it('checks the spool before the status — a running job has not published yet', () => {
    // Order matters: a job that is mid-flight has no status yet, so asking about the
    // status first would deposit a second job for the same entry every tick.
    expect(shouldGate(entry, () => false, () => true).why).toMatch(/spool/);
  });

  it('asks about the entry it was given', () => {
    const asked: string[] = [];
    shouldGate(entry, sha => (asked.push(sha), false), () => false);
    expect(asked).toEqual([SHA_A]);
  });
});

describe('treeOf', () => {
  it('asks for the TREE, not the commit — that distinction IS the dedup', () => {
    const calls: string[][] = [];
    treeOf((args, _cwd) => (calls.push(args), 'tree-sha\n'), 'gh-readonly-queue/main/pr-1-abc', '/co');
    expect(calls[0]).toEqual(['rev-parse', 'gh-readonly-queue/main/pr-1-abc^{tree}']);
  });

  it('reads null for a ref the checkout does not have — a reason to gate, not an error', () => {
    expect(
      treeOf(() => {
        throw new Error('unknown revision');
      }, 'x', '/co'),
    ).toBeNull();
    expect(treeOf(() => '  \n', 'x', '/co')).toBeNull();
  });
});

describe('fetchEntry — the objects have to be local before the tree can be read', () => {
  it('fetches the REF, with no local destination — objects only, nothing left under refs/', () => {
    const calls: string[][] = [];
    const ok = fetchEntry(
      (args, _cwd) => (calls.push(args), ''),
      { ref: 'gh-readonly-queue/main/pr-1-abc', sha: SHA_A },
      '/co',
      () => undefined,
    );
    expect(ok).toBe(true);
    // By ref name, not by sha: a server need not serve a bare sha it did not advertise.
    expect(calls[0]).toEqual([
      'fetch',
      '--no-tags',
      '--quiet',
      'origin',
      'refs/heads/gh-readonly-queue/main/pr-1-abc',
    ]);
  });

  it('logs a failed fetch and returns false — never throws, never fatal', () => {
    const logs: string[] = [];
    const ok = fetchEntry(
      () => {
        throw new Error('could not read from remote');
      },
      { ref: 'gh-readonly-queue/main/pr-1-abc', sha: SHA_A },
      '/co',
      line => void logs.push(line),
    );
    expect(ok).toBe(false);
    expect(logs.join('\n')).toMatch(/could not fetch gh-readonly-queue\/main\/pr-1-abc/);
  });
});

describe('mayReuseVerdict — a live slot only where it proves something', () => {
  const passing = { head: SHA_B, tree: 'T1', verdict: 'PASS' };
  const ran = { status: 'ran' as const, flows: ['login-spine'] };
  const legitSkip = { status: 'skipped' as const, why: 'nothing observable over the wire', required: [] };
  const requiredSkip = { status: 'skipped' as const, why: 'requires --live', required: ['login-spine'] };
  const unknown = { status: 'unknown' as const, why: 'no gate artifact was recorded for this run' };

  it('reuses a PASS that shares the tree — identical code proves nothing twice', () => {
    // The common case with one entry at a time: nothing landed between the PR head's gate
    // and its turn, so the merge commit differs while its tree does not.
    const decision = mayReuseVerdict('T1', [{ ...passing, live: ran }]);
    expect(decision.reuseFrom).toBe(SHA_B);
    expect(decision.why).toMatch(/identical tree/);
  });

  it('drives when the tree differs — that is main having moved, the case worth paying for', () => {
    expect(mayReuseVerdict('T2', [{ ...passing, live: ran }]).reuseFrom).toBeNull();
  });

  // B2.4 — the reuse rule now also asks what the source's OWN gate proved.
  it('reuses a source whose live stage ran and covers this entry', () => {
    expect(mayReuseVerdict('T1', [{ ...passing, live: ran }]).reuseFrom).toBe(SHA_B);
  });

  // The 15-record case the corpus audit found: a source whose own router required live
  // flows but whose own gate skipped them anyway. Reusing it would propagate a
  // static-only PASS forward as if it were live — exactly the bug B2.4 closes.
  it('refuses reuse from a source that is itself a `requires --live` skip', () => {
    const decision = mayReuseVerdict('T1', [{ ...passing, live: requiredSkip }]);
    expect(decision.reuseFrom).toBeNull();
    expect(decision.why).toBe('no passing attestation shares this tree');
  });

  it('reuses a source that legitimately skipped — nothing was owed, nothing is missing', () => {
    expect(mayReuseVerdict('T1', [{ ...passing, live: legitSkip }]).reuseFrom).toBe(SHA_B);
  });

  // Disposition for `'unknown'` and for the legacy shape with no `live` key at all: refuse
  // (#1182, a reversal of the B2.4 carve-out). An `'unknown'` attestation carries no
  // `required` list to judge by, so it proves nothing live — reusing it would publish a PASS
  // no live drive ever stood behind. worker.ts's `attested()` still resolves most legacy
  // verdicts' `live` from their gate artifact first; what even that cannot answer stays
  // readable but is re-gated, taking a live slot instead of borrowing a proof it lacks.
  it("refuses a source whose liveness is 'unknown' — it proves nothing live", () => {
    const decision = mayReuseVerdict('T1', [{ ...passing, live: unknown }]);
    expect(decision.reuseFrom).toBeNull();
    expect(decision.why).toBe('no passing attestation shares this tree');
  });

  it('refuses a source with no `live` key at all — the pre-B2.4 legacy shape reads as unknown', () => {
    expect(mayReuseVerdict('T1', [passing]).reuseFrom).toBeNull();
  });

  it('names a legitimate skip as judged with no live drive required', () => {
    expect(mayReuseVerdict('T1', [{ ...passing, live: legitSkip }]).why).toMatch(
      /already judged \(no live drive was required\)/,
    );
  });

  it.each([
    ['a FAIL', { ...passing, verdict: 'FAIL', live: ran }],
    ['an attestation with no readable tree', { ...passing, tree: null, live: ran }],
  ])('never reuses %s', (_label, attestation) => {
    expect(mayReuseVerdict('T1', [attestation]).reuseFrom).toBeNull();
  });

  it('drives when the entry tree itself could not be read', () => {
    // Fails toward driving. Reusing on an unknown tree would publish a PASS for code
    // nobody has looked at.
    expect(mayReuseVerdict(null, [{ ...passing, live: ran }]).reuseFrom).toBeNull();
  });

  it('drives when there is nothing attested at all', () => {
    expect(mayReuseVerdict('T1', []).reuseFrom).toBeNull();
  });
});

describe('serveMergeQueue — one pass over the queue', () => {
  interface Recorder {
    deposited: QueueEntry[];
    reused: { from: string; to: string }[];
    logs: string[];
    deps: Parameters<typeof serveMergeQueue>[0];
  }

  function recorder(
    refs: string,
    attested: ReuseCandidate[] = [],
    trees: Record<string, string> = {},
    pending: (sha: string) => boolean = () => false,
    fetched: string[] = [],
  ): Recorder {
    const r: Partial<Recorder> = { deposited: [], reused: [], logs: [] };
    r.deps = {
      lsRemote: () => refs,
      // A checkout that only knows a sha once its ref has been fetched — which is the whole
      // point of the ordering. `trees` is what the REMOTE holds; `fetched` is what came down.
      git: args => {
        if (args[0] === 'fetch') {
          fetched.push(args[args.length - 1].replace('refs/heads/', ''));
          return '';
        }
        const sha = args[1].replace('^{tree}', '');
        const local = fetched.some(ref => refs.includes(`${sha}\trefs/heads/${ref}`));
        if (!local || !(sha in trees)) throw new Error('unknown revision');
        return trees[sha];
      },
      attested: () => attested,
      pendingFor: pending,
      reuse: (from, to) => void r.reused!.push({ from, to }),
      deposit: entry => void r.deposited!.push(entry),
      checkoutDir: '/co',
      log: line => void r.logs!.push(line),
    };
    return r as Recorder;
  }

  it('does nothing at all when there is no queue — the normal state', () => {
    const r = recorder('');
    expect(serveMergeQueue(r.deps)).toBe(0);
    expect(r.deposited).toHaveLength(0);
    expect(r.logs).toHaveLength(0);
  });

  it('deposits a gate for an entry nobody has answered', () => {
    const r = recorder(`${SHA_A}\trefs/heads/gh-readonly-queue/main/pr-1-abc`);
    expect(serveMergeQueue(r.deps)).toBe(1);
    expect(r.deposited).toEqual([{ ref: 'gh-readonly-queue/main/pr-1-abc', sha: SHA_A }]);
    expect(r.reused).toHaveLength(0);
  });

  it('reuses a verdict when the entry tree is already driven — no live slot', () => {
    // The common case at one entry a time: the merge commit is new, its tree is not.
    // This is the hit #192 says could never happen: the fake refuses to resolve a sha whose
    // ref was not fetched, exactly as a real checkout does, so this only passes because the
    // fetch now precedes the read.
    const fetched: string[] = [];
    const r = recorder(
      `${SHA_A}\trefs/heads/gh-readonly-queue/main/pr-1-abc`,
      [{ head: SHA_B, tree: 'T1', verdict: 'PASS', live: { status: 'ran', flows: [] } }],
      { [SHA_A]: 'T1' },
      () => false,
      fetched,
    );
    expect(serveMergeQueue(r.deps)).toBe(1);
    expect(fetched).toEqual(['gh-readonly-queue/main/pr-1-abc']);
    expect(r.reused).toEqual([{ from: SHA_B, to: SHA_A }]);
    // The whole cost the dedup exists to avoid: no job is deposited, so no live slot.
    expect(r.deposited).toHaveLength(0);
    expect(r.logs.join('\n')).toMatch(/reuses bbbbbbbb — identical tree/);
  });

  it('gates when the entry cannot be fetched at all — an unread tree is never a match', () => {
    // A checkout that does not exist yet, or an unreachable origin. The failure is logged,
    // nothing is reused, and the entry takes the live drive it would have taken anyway.
    const r = recorder(
      `${SHA_A}\trefs/heads/gh-readonly-queue/main/pr-1-abc`,
      [{ head: SHA_B, tree: 'T1', verdict: 'PASS', live: { status: 'ran', flows: [] } }],
      { [SHA_A]: 'T1' },
    );
    const inner = r.deps.git;
    r.deps.git = (args, cwd) => {
      if (args[0] === 'fetch') throw new Error('not a git repository');
      return inner(args, cwd);
    };
    expect(serveMergeQueue(r.deps)).toBe(1);
    expect(r.reused).toHaveLength(0);
    expect(r.deposited.map(x => x.sha)).toEqual([SHA_A]);
    expect(r.logs.join('\n')).toMatch(/could not fetch gh-readonly-queue\/main\/pr-1-abc/);
    expect(r.logs.join('\n')).toMatch(/the entry tree could not be read/);
  });

  it('gates rather than reuses when the tree differs — main moved', () => {
    const r = recorder(
      `${SHA_A}\trefs/heads/gh-readonly-queue/main/pr-1-abc`,
      [{ head: SHA_B, tree: 'T1', verdict: 'PASS', live: { status: 'ran', flows: [] } }],
      { [SHA_A]: 'T2' },
    );
    serveMergeQueue(r.deps);
    expect(r.deposited).toHaveLength(1);
    expect(r.reused).toHaveLength(0);
  });

  it('skips an entry that already carries a status', () => {
    const r = recorder(`${SHA_A}\trefs/heads/gh-readonly-queue/main/pr-1-abc`, [
      { head: SHA_A, tree: 'T1', verdict: 'PASS', live: { status: 'ran', flows: [] } },
    ]);
    expect(serveMergeQueue(r.deps)).toBe(0);
    expect(r.deposited).toHaveLength(0);
  });

  it('skips an entry whose job is already in the spool — no second deposit per tick', () => {
    const r = recorder(`${SHA_A}\trefs/heads/gh-readonly-queue/main/pr-1-abc`, [], {}, () => true);
    expect(serveMergeQueue(r.deps)).toBe(0);
    expect(r.deposited).toHaveLength(0);
  });

  it('handles several entries independently in one pass', () => {
    const r = recorder(
      [
        `${SHA_A}\trefs/heads/gh-readonly-queue/main/pr-1-abc`,
        `${SHA_B}\trefs/heads/gh-readonly-queue/main/pr-2-abc`,
      ].join('\n'),
      [{ head: 'c'.repeat(40), tree: 'T1', verdict: 'PASS', live: { status: 'ran', flows: [] } }],
      { [SHA_A]: 'T1' },
    );
    expect(serveMergeQueue(r.deps)).toBe(2);
    expect(r.reused.map(x => x.to)).toEqual([SHA_A]);
    expect(r.deposited.map(x => x.sha)).toEqual([SHA_B]);
  });

  it('says what it did, for a human reading the worker log', () => {
    const r = recorder(`${SHA_A}\trefs/heads/gh-readonly-queue/main/pr-1-abc`);
    serveMergeQueue(r.deps);
    expect(r.logs.join('\n')).toMatch(/gating aaaaaaaa \(gh-readonly-queue\/main\/pr-1-abc\)/);
  });
});
