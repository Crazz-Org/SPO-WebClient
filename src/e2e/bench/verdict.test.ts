import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { benchPaths, ensureLayout, type BenchPaths } from './paths';
import {
  ghStatusPublisher,
  listVerdicts,
  publishPendingStatuses,
  resolveReuseSource,
  reuseSourceOf,
  STATUS_DESCRIPTION_MAX,
  statusDescription,
  statusState,
  writeVerdict,
  type BenchVerdict,
} from './verdict';

function tempBench(): BenchPaths {
  const paths = benchPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-bench-verdict-')));
  ensureLayout(paths);
  return paths;
}

function verdictFor(head: string, overrides: Partial<BenchVerdict> = {}): BenchVerdict {
  return {
    head,
    branch: 'fix/x',
    worktree: '/wt/a',
    verdict: 'PASS',
    jobId: 'job-1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('attestation files', () => {
  it('writes verdicts/<head>.json and lists it back', () => {
    const paths = tempBench();
    const file = writeVerdict(paths, verdictFor('abc123'));
    expect(path.basename(file)).toBe('abc123.json');
    expect(listVerdicts(paths).map(v => v.verdict.head)).toEqual(['abc123']);
  });

  it('lists nothing on a bench with no verdicts directory', () => {
    expect(listVerdicts(benchPaths(path.join(os.tmpdir(), 'spo-bench-verdict-never')))).toEqual([]);
  });

  it('skips unreadable attestations instead of failing the pass', () => {
    const paths = tempBench();
    fs.writeFileSync(path.join(paths.verdicts, 'bad.json'), '{oops', 'utf8');
    writeVerdict(paths, verdictFor('good'));
    expect(listVerdicts(paths).map(v => v.verdict.head)).toEqual(['good']);
  });
});

describe('statusState', () => {
  it('maps verdicts onto the three GitHub states', () => {
    expect(statusState('PASS')).toBe('success');
    expect(statusState('FAIL')).toBe('failure');
    expect(statusState('STALE')).toBe('failure');
    expect(statusState('BLOCKED')).toBe('failure');
    expect(statusState('DIRTY')).toBe('failure');
    expect(statusState('ENVIRONMENT')).toBe('error');
    expect(statusState('INTERRUPTED')).toBe('error');
  });
});

describe('ghStatusPublisher', () => {
  it('shapes the gh api call, run from the attested worktree', () => {
    const calls: { cmd: string; args: string[]; cwd: string }[] = [];
    const publish = ghStatusPublisher((cmd, args, cwd) => calls.push({ cmd, args, cwd }));
    publish('/wt/a', 'abc123', 'success', 'PASS — job job-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('gh');
    expect(calls[0].cwd).toBe('/wt/a');
    expect(calls[0].args).toEqual(
      expect.arrayContaining([
        'repos/{owner}/{repo}/statuses/abc123',
        'state=success',
        'context=bench/gate',
        'description=PASS — job job-1',
      ]),
    );
  });
});

describe('publishPendingStatuses — the retry-until-pushed loop', () => {
  it('publishes a fresh attestation and stamps it published', () => {
    const paths = tempBench();
    writeVerdict(paths, verdictFor('abc123'));
    const published: string[] = [];
    publishPendingStatuses(paths, (_wt, head) => published.push(head), () => {});
    expect(published).toEqual(['abc123']);
    expect(listVerdicts(paths)[0].verdict.published).toBe(true);
  });

  it('names the capability exceptions in the GitHub description', () => {
    const paths = tempBench();
    writeVerdict(paths, verdictFor('abc123', { exceptions: 2 }));
    const descriptions: string[] = [];
    publishPendingStatuses(paths, (_wt, _head, _state, description) => descriptions.push(description), () => {});
    expect(descriptions[0]).toMatch(/PASS — 2 capability exception\(s\) — job/);
  });

  it('names the gate base in the GitHub description — the merge-time staleness signal', () => {
    const paths = tempBench();
    writeVerdict(paths, verdictFor('c1', { baseMain: 'abcdef1234567890' }));
    const descriptions: string[] = [];
    publishPendingStatuses(paths, (_wt, _head, _state, description) => descriptions.push(description), () => {});
    expect(descriptions[0]).toBe('PASS — base abcdef12 — job job-1');
  });

  it('omits the base when the attestation carries none', () => {
    const paths = tempBench();
    writeVerdict(paths, verdictFor('c2'));
    const descriptions: string[] = [];
    publishPendingStatuses(paths, (_wt, _head, _state, description) => descriptions.push(description), () => {});
    expect(descriptions[0]).toBe('PASS — job job-1');
  });

  it('renders "merged base" instead of the plain base — the gate merged origin/main in', () => {
    const paths = tempBench();
    writeVerdict(
      paths,
      verdictFor('c3', { baseMain: 'abcdef1234567890', merged: true, mergedBase: 'abcdef1234567890' }),
    );
    const descriptions: string[] = [];
    publishPendingStatuses(paths, (_wt, _head, _state, description) => descriptions.push(description), () => {});
    expect(descriptions[0]).toBe('PASS — merged base abcdef12 — job job-1');
  });

  it('does not republish', () => {
    const paths = tempBench();
    writeVerdict(paths, verdictFor('abc123', { published: true }));
    const published: string[] = [];
    publishPendingStatuses(paths, (_wt, head) => published.push(head), () => {});
    expect(published).toEqual([]);
  });

  it('leaves the attestation untouched when publishing fails (sha not pushed yet)', () => {
    const paths = tempBench();
    writeVerdict(paths, verdictFor('abc123'));
    publishPendingStatuses(
      paths,
      () => {
        throw new Error('HTTP 422: no commit found for SHA');
      },
      () => {},
    );
    expect(listVerdicts(paths)[0].verdict.published).toBeUndefined();
  });

  it('gives up on attestations older than the publish window', () => {
    const paths = tempBench();
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    writeVerdict(paths, verdictFor('abc123', { createdAt: old }));
    const published: string[] = [];
    publishPendingStatuses(paths, (_wt, head) => published.push(head), () => {});
    expect(published).toEqual([]);
  });

  it('carries the STALE verdict word itself into the status description', () => {
    // B2.5 removed the separate `fingerprintStable` boolean and its "(tree moved)"
    // marker: it was `true` in the whole corpus (518 verdicts on file as of 2026-09-03)
    // for the only job type that ever wrote one, and the STALE verdict word already says
    // everything it claimed to.
    const paths = tempBench();
    writeVerdict(paths, verdictFor('abc123', { verdict: 'STALE' }));
    const descriptions: string[] = [];
    publishPendingStatuses(paths, (_wt, _head, _state, description) => descriptions.push(description), () => {});
    expect(descriptions[0]).toBe('STALE — job job-1');
    expect(descriptions[0]).not.toMatch(/tree moved/);
  });

  it('never publishes a description over the 140-char limit even with a very long jobId', () => {
    const paths = tempBench();
    writeVerdict(
      paths,
      verdictFor('abc123', {
        baseMain: 'f'.repeat(40),
        reusedFrom: 'e'.repeat(40),
        exceptions: 3,
        jobId: 'job-'.repeat(60),
      }),
    );
    const descriptions: string[] = [];
    publishPendingStatuses(paths, (_wt, _head, _state, description) => descriptions.push(description), () => {});
    expect(descriptions[0].length).toBeLessThanOrEqual(STATUS_DESCRIPTION_MAX);
    expect(descriptions[0]).toContain('PASS');
    expect(descriptions[0]).toContain('base ffffffff');
  });
});

describe('statusDescription', () => {
  it('reproduces the short-input format byte-for-byte', () => {
    expect(statusDescription(verdictFor('c1', { baseMain: 'abcdef1234567890' }))).toBe(
      'PASS — base abcdef12 — job job-1',
    );
  });

  it('renders merged base instead of base when merged is true', () => {
    expect(statusDescription(verdictFor('c1', { merged: true, mergedBase: 'f'.repeat(40) }))).toBe(
      'PASS — merged base ffffffff — job job-1',
    );
  });

  it('falls back to the plain base when merged is true but mergedBase is missing', () => {
    expect(statusDescription(verdictFor('c1', { merged: true, baseMain: 'a'.repeat(40) }))).toBe(
      'PASS — base aaaaaaaa — job job-1',
    );
  });

  it('appends the reused-from sha8 when the verdict is a reuse', () => {
    const description = statusDescription(verdictFor('c1', { reusedFrom: 'e'.repeat(40) }));
    expect(description).toBe('PASS — reused eeeeeeee — job job-1');
  });

  it('composes the verdict word, exceptions, base and reused together, always within the limit', () => {
    const description = statusDescription(
      verdictFor('c1', {
        verdict: 'STALE',
        exceptions: 5,
        baseMain: 'b'.repeat(40),
        reusedFrom: 'e'.repeat(40),
      }),
    );
    expect(description).toBe(
      'STALE — 5 capability exception(s) — base bbbbbbbb — reused eeeeeeee — job job-1',
    );
    expect(description.length).toBeLessThanOrEqual(STATUS_DESCRIPTION_MAX);
  });

  it('truncates the jobId when the protected tail leaves little room', () => {
    const description = statusDescription(
      verdictFor('c1', {
        exceptions: 9,
        baseMain: 'b'.repeat(40),
        reusedFrom: 'e'.repeat(40),
        jobId: 'x'.repeat(200),
      }),
    );
    expect(description.length).toBe(STATUS_DESCRIPTION_MAX);
    expect(description.startsWith('PASS — 9 capability exception(s) — base bbbbbbbb — reused eeeeeeee — job x')).toBe(
      true,
    );
  });

  // B2.2 — the whole reason this section exists: 17 gate artifacts recorded a skipped
  // live stage in the same run that wrote PASS, and statusDescription rendered them
  // identically to a real live PASS. These are the tests that would have caught it.
  describe('liveness — a static-only PASS must never read like a live one', () => {
    it('marks a live PASS distinctly from a static-only PASS', () => {
      const liveDescription = statusDescription(
        verdictFor('c1', { live: { status: 'ran', flows: ['login-spine', 'send-message'] } }),
      );
      const staticDescription = statusDescription(
        verdictFor('c1', { live: { status: 'skipped', why: 'requires --live', required: ['login-spine'] } }),
      );
      expect(liveDescription).toBe('PASS — live — job job-1');
      expect(staticDescription).toBe('PASS — static-only — job job-1');
      expect(liveDescription).not.toBe(staticDescription);
    });

    it('marks an unreadable/absent artifact as unknown — never as live, never as plain static-only', () => {
      const description = statusDescription(verdictFor('c1', { live: { status: 'unknown', why: 'no artifact' } }));
      expect(description).toBe('PASS — live unknown — job job-1');
    });

    it('marks a skip-BLOCKED run with its own marker, distinct from unknown', () => {
      const description = statusDescription(
        verdictFor('c1', { verdict: 'BLOCKED', live: { status: 'blocked-skip', skipped: ['permission-negative'] } }),
      );
      expect(description).toBe('BLOCKED — live blocked-skip — job job-1');
    });

    it('omits the marker entirely for a verdict written before the field existed', () => {
      // No `live` key at all — verdictFor's default. Must render exactly as it always did,
      // never inferring "ran" or "static-only" from silence.
      expect(statusDescription(verdictFor('c1'))).toBe('PASS — job job-1');
    });

    it('keeps the liveness marker within the 140-char limit alongside every other field', () => {
      const description = statusDescription(
        verdictFor('c1', {
          live: { status: 'skipped', why: 'requires --live', required: ['login-spine'] },
          exceptions: 3,
          baseMain: 'b'.repeat(40),
          reusedFrom: 'e'.repeat(40),
          jobId: 'x'.repeat(200),
        }),
      );
      expect(description.length).toBeLessThanOrEqual(STATUS_DESCRIPTION_MAX);
      expect(description).toContain('static-only');
    });
  });

  // #1010 — a required flow that ended UNTESTABLE fails the gate; the status says how many.
  describe('untestable flows (doc/E2E-POLICY.md §7)', () => {
    it('renders the untestable count in the protected tail', () => {
      const description = statusDescription(
        verdictFor('c1', {
          verdict: 'FAIL',
          live: { status: 'ran', flows: ['zoning-alert-read'] },
          untestable: 1,
          baseMain: 'b'.repeat(40),
        }),
      );
      expect(description).toBe('FAIL — live — 1 untestable flow(s) — base bbbbbbbb — job job-1');
    });

    it('keeps both counts within the limit next to a long job id', () => {
      const description = statusDescription(
        verdictFor('c1', {
          verdict: 'FAIL',
          live: { status: 'ran', flows: ['zoning-alert-read'] },
          exceptions: 3,
          untestable: 2,
          baseMain: 'b'.repeat(40),
          reusedFrom: 'e'.repeat(40),
          jobId: 'x'.repeat(200),
        }),
      );
      expect(description.length).toBeLessThanOrEqual(STATUS_DESCRIPTION_MAX);
      expect(description).toContain('3 capability exception(s) — 2 untestable flow(s)');
      expect(description).toContain('base bbbbbbbb');
    });

    it('renders a count of 0 byte-for-byte as the line of today', () => {
      const shapes: BenchVerdict[] = [
        verdictFor('c1'),
        verdictFor('c1', { live: { status: 'ran', flows: ['login-spine'] }, baseMain: 'b'.repeat(40) }),
        verdictFor('c1', { exceptions: 2, baseMain: 'b'.repeat(40), reusedFrom: 'e'.repeat(40) }),
      ];
      for (const v of shapes) {
        expect(statusDescription({ ...v, untestable: 0 })).toBe(statusDescription(v));
      }
      expect(
        statusDescription(
          verdictFor('c1', {
            live: { status: 'ran', flows: ['login-spine'] },
            baseMain: 'b'.repeat(40),
            untestable: 0,
          }),
        ),
      ).toBe('PASS — live — base bbbbbbbb — job job-1');
    });
  });
});

describe('publishPendingStatuses — failure-streak logging', () => {
  it('stays quiet for the first two consecutive failures, logs once on the third, quiet again after', () => {
    const paths = tempBench();
    writeVerdict(paths, verdictFor('abc123'));
    const logs: string[] = [];
    const failures = new Map<string, number>();
    const alwaysThrows = () => {
      throw new Error('HTTP 422: no commit found for SHA');
    };

    publishPendingStatuses(paths, alwaysThrows, line => logs.push(line), Date.now(), paths.verdicts, failures);
    expect(logs).toEqual([]);

    publishPendingStatuses(paths, alwaysThrows, line => logs.push(line), Date.now(), paths.verdicts, failures);
    expect(logs).toEqual([]);

    publishPendingStatuses(paths, alwaysThrows, line => logs.push(line), Date.now(), paths.verdicts, failures);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('HTTP 422: no commit found for SHA');
    expect(logs[0]).toContain('abc123'.slice(0, 8));

    publishPendingStatuses(paths, alwaysThrows, line => logs.push(line), Date.now(), paths.verdicts, failures);
    expect(logs).toHaveLength(1);
  });

  it('clears the streak on a success, so a later failure run starts counting from zero', () => {
    const paths = tempBench();
    writeVerdict(paths, verdictFor('abc123'));
    const logs: string[] = [];
    const failures = new Map<string, number>();
    const alwaysThrows = () => {
      throw new Error('boom');
    };

    publishPendingStatuses(paths, alwaysThrows, line => logs.push(line), Date.now(), paths.verdicts, failures);
    publishPendingStatuses(paths, alwaysThrows, line => logs.push(line), Date.now(), paths.verdicts, failures);
    expect(failures.get('abc123')).toBe(2);

    // A success in between (e.g. the sha finally landed) clears the counter.
    writeVerdict(paths, verdictFor('def456'));
    publishPendingStatuses(paths, () => {}, () => {}, Date.now(), paths.verdicts, failures);
    expect(failures.has('def456')).toBe(false);
  });
});

// B2.4 — 27 of the 91 real reuse records on the corpus (measured 2026-09-03; 64
// `reusedFrom` + 27 legacy prose) predate `reusedFrom` (19490070, 2026-08-26) and instead
// carry their provenance as prose inside `jobId`. Both shapes must be recognised, or any
// check built on this reads most of the corpus's reuse history and calls it complete.
describe('reuseSourceOf — both reuse encodings the real corpus carries', () => {
  it('reads the current, structured encoding', () => {
    expect(reuseSourceOf({ reusedFrom: 'e'.repeat(40), jobId: 'job-1' })).toBe('e'.repeat(40));
  });

  it('reads the legacy prose encoding, pre-19490070', () => {
    // Lifted verbatim from the real corpus (bc5e2335…json).
    expect(
      reuseSourceOf({
        reusedFrom: undefined,
        jobId: 'job-01787672998877-1a15c1 (reused: identical tree to cf537547, already driven live)',
      }),
    ).toBe('cf537547');
  });

  it('returns null for a verdict that is not a reuse at all', () => {
    expect(reuseSourceOf({ reusedFrom: undefined, jobId: 'job-01787672998877-1a15c1' })).toBeNull();
  });

  it('prefers the structured field when (hypothetically) both are present', () => {
    expect(
      reuseSourceOf({
        reusedFrom: 'a'.repeat(40),
        jobId: 'job-1 (reused: identical tree to bbbbbbbb, already driven live)',
      }),
    ).toBe('a'.repeat(40));
  });
});

// Y5 — verdict.ts's own comment on `reuseSourceOf` used to claim only the legacy prose
// encoding is ever short. It isn't the only one: `083e7a1c…json` (2026-09-03) carries a
// STRUCTURED `reusedFrom: "95158cf2"`, because a session submitted `--ref 95158cf2` and
// the short value was stored verbatim. The corpus now holds both a verdict whose own head
// IS that 8-character string and the 40-character one the short ref actually meant
// (`95158cf237d3610c7cb06b06e8202d7fcd0f5675`) — real records, not a constructed fixture.
describe('resolveReuseSource — a short reusedFrom, in either encoding, against the real corpus', () => {
  const LONG = '95158cf237d3610c7cb06b06e8202d7fcd0f5675';
  const SHORT = '95158cf2';

  it('resolves a full 40-character reusedFrom to the one verdict with that exact head', () => {
    expect(resolveReuseSource(LONG, [{ head: LONG }, { head: 'a'.repeat(40) }])).toBe(LONG);
  });

  it('resolves a short reusedFrom as a prefix when exactly one head could be meant', () => {
    // The ordinary legacy-prose case: nothing on file carries the short string as its own
    // literal head, so the only candidate is the full one it is a prefix of.
    expect(resolveReuseSource('cf537547', [{ head: LONG }, { head: `cf537547${'0'.repeat(32)}` }])).toBe(
      `cf537547${'0'.repeat(32)}`,
    );
  });

  it('refuses to guess when a short reusedFrom is simultaneously a literal head AND a prefix of a different one', () => {
    // Today's actual corpus state: SHORT is its own verdict's real head (the submit bug)
    // AND a genuine prefix of LONG (what the short --ref was meant to name). Picking
    // either silently would be a guess dressed up as a resolution.
    expect(resolveReuseSource(SHORT, [{ head: SHORT }, { head: LONG }])).toBeNull();
  });

  it('resolves cleanly when only the literal short head exists — no prefix collision', () => {
    expect(resolveReuseSource(SHORT, [{ head: SHORT }, { head: 'a'.repeat(40) }])).toBe(SHORT);
  });

  it('returns null when nothing on file matches at all', () => {
    expect(resolveReuseSource('deadbeef', [{ head: 'a'.repeat(40) }])).toBeNull();
  });
});

// B2.5 — fingerprintStable was removed: it was `true` in the whole corpus (518 verdicts
// on file as of 2026-09-03) for the only job type that ever wrote it (`ref`), and could
// only go `false` if the
// fingerprinter itself threw. See ./merge-queue's mayReuseVerdict for what replaced it
// as a reuse precondition (the source's own `live` status), and BenchVerdict.merged for
// what now answers "is the judged tree the pushed tree".
describe('fingerprintStable is gone (B2.5)', () => {
  it('a verdict with none of the fields fingerprintStable used to gate off still round-trips cleanly', () => {
    const paths = tempBench();
    writeVerdict(paths, verdictFor('abc123'));
    expect(listVerdicts(paths)[0].verdict).not.toHaveProperty('fingerprintStable');
  });

  it('never renders a "(tree moved)" marker in the status description, for any verdict', () => {
    expect(statusDescription(verdictFor('c1', { verdict: 'STALE' }))).not.toMatch(/tree moved/);
    expect(statusDescription(verdictFor('c1'))).not.toMatch(/tree moved/);
  });
});
