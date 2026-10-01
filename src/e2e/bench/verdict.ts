/**
 * Per-HEAD attestations — the only thing that unblocks a `git push`, and the bridge to
 * GitHub's merge gate.
 *
 * Locally: `.claude/hooks/pre-push-gate.sh` no longer reads this directory — #158 stage C
 * removed the pre-push attestation check (the gate tests a commit the worker FETCHES, so
 * a commit must be pushed before it can be gated; see that hook's own comment for why the
 * two rules were mutually exclusive). Only the worker writes these files — a session
 * running `npm run gate:local` produces evidence for reading, not an attestation.
 *
 * On GitHub: the worker publishes each attestation as a commit status (context
 * `bench/gate`). A status can only attach to a sha GitHub knows, and the gate runs
 * BEFORE the push — so publishing retries on a cycle until the push has happened, then
 * sticks. With branch protection requiring `bench/gate`, a PR cannot merge on CI alone:
 * the live evidence has to exist even if someone sidesteps the local hook.
 */

import * as fs from 'fs';
import * as path from 'path';
import { toErrorMessage } from '../../shared/error-utils';
import type { BenchPaths } from './paths';
import type { JobVerdict } from './job';

/**
 * What the gate's live stage did — copied verbatim from the artifact's own `live` block
 * (`report/e2e/gate-<sha>.json`), never recomputed. This is the fix for the class this
 * action exists to close: 17 artifacts recorded `live.skipped: true` with the flows the
 * router required, in the same run that wrote a `PASS` nothing downstream could tell
 * apart from a live one.
 *
 * `status` is the discriminant, and every member spells out its own case in full — a
 * reader (or the type checker) can never mistake `'skipped'` or `'unknown'` for `'ran'`.
 *
 * - `'ran'` — the live stage actually drove the world; `flows` names what it drove.
 * - `'skipped'` — the gate never asked the live world anything, and says why. `required`
 *   carries `routing.required` from the artifact: the flows the router determined were
 *   necessary, whether or not any of them ran. An empty array here is a materially
 *   different fact from a non-empty one — nothing was owed, versus something was skipped.
 * - `'unknown'` — the question could not be answered at all: the artifact is missing,
 *   unreadable, or (a readable artifact, but no `live` block — the gate failed before it
 *   got that far, e.g. a static/build/routing failure). Also covers a `live` block that
 *   is not a skip but is not a completed run either — `runLive()`'s own `status` came
 *   back `BLOCKED` with no SKIPPED flow on file (the lock refusal: rate limit / dirty
 *   world / world held by another run) or `ENVIRONMENT` (preflight abort), or a
 *   value this code has never seen: the gate did try to ask the live world something, but
 *   never got an answer, so it is exactly as unanswered as a missing artifact. This must
 *   never collapse into `'skipped'`: skipped states a known reason, unknown admits there
 *   isn't one on file — and never into `'ran'`: nothing here proves the live stage drove
 *   the world.
 * - `'blocked-skip'` — `runLive()` returned `BLOCKED` because one or more flows ended
 *   `SKIPPED` (and none FAILed). `skipped` names only those SKIPPED flows, not the flows
 *   that passed beside them. This is a known, non-transient outcome: retrying the gate
 *   does not clear it. It must never be read as `'ran'` — a flow that did not run is not
 *   a pass — nor as `'unknown'`, since its reason is on file.
 */
export type LiveAttestation =
  | { status: 'ran'; flows: string[] }
  | { status: 'skipped'; why: string; required: string[] }
  | { status: 'blocked-skip'; skipped: string[] }
  | { status: 'unknown'; why: string };

/**
 * Whether the static stage (typecheck, lint, the Jest suite) was proven by CI or
 * replayed on the bench — copied verbatim from `JobReport.staticProof`, which `runJob`
 * sets from `ci-proof.ts`'s verdict before it ever invokes verify-gate.
 *
 * `'unknown'` covers both a verdict written before this field existed and a `ref` job
 * that never reached the question — a merge conflict, a build failure, or anything else
 * that returned before the static stage was ever asked about.
 */
export type StaticProofAttestation =
  | { status: 'ci' }
  | { status: 'bench'; why: string }
  | { status: 'unknown' };

export interface BenchVerdict {
  /**
   * The DEPOSITED sha — what the submitter (a push, a merge-queue entry) asked to gate.
   * Also this file's own name (`verdicts/<head>.json`) and what
   * `.claude/hooks/pre-push-gate.sh` and the GitHub commit status look this record up by.
   *
   * This is NOT always the sha `scripts/verify-gate.js` actually ran against: a `ref` job
   * whose checkout got merged with `origin/main` before gating (see {@link merged}) checks
   * out a fresh merge commit, and the gate artifact is filed under THAT sha
   * (`report/e2e/gate-<sha>.json`), never this one. {@link gatedSha} names it explicitly,
   * so a reader never has to guess which sha `head` means in which file
   * (SPO-Pipeline/doc/bench-audit-2026-09-02.md, D6). `merged`/`mergedBase` answer WHETHER a merge
   * happened and AGAINST WHAT; `gatedSha` answers WHAT ACTUALLY GOT TESTED — distinct
   * questions, and none of the three substitutes for another.
   */
  head: string;
  branch: string;
  /** The worktree the attestation was produced for — the hook matches it to the pusher. */
  worktree: string;
  verdict: JobVerdict;
  /**
   * The `origin/main` sha this run was judged against.
   *
   * The ruleset no longer requires the branch to be up to date with `main` (that rule
   * cost every parallel session a full re-gate on every merge). What replaces it is this
   * field: the attestation says WHICH `main` it stood on, so a reader — the pre-push
   * hook, the commit status, a human at merge time — can see that `main` has moved past
   * it. Staleness became visible instead of enforced; that is the whole trade.
   */
  baseMain?: string;
  /**
   * True when the checkout this attestation drove was merged with `baseMain` before the
   * gate ran — `ref` was not already an ancestor of it. Absent (or false) means the gate
   * ran on the branch's own tree, unchanged: the common case, taken whenever the branch
   * already contains everything on `main`. See doc/bench-worker.md § The gate base.
   *
   * This is the field that answers "is the tree judged the tree that gets pushed" — the
   * question a since-removed `fingerprintStable` boolean claimed to answer but could not:
   * it was `!report.targetMoved` on the WORKER's own checkout, which `prepareRef` resets
   * and cleans immediately before every `ref` job runs and which nothing else writes to
   * except gitignored paths (`dist/`, `report/e2e/`) — so it was `true` in the whole
   * corpus (518 verdicts on file as of 2026-09-03; it only grows) and could only ever go
   * `false` if fingerprinting itself threw.
   * `merged`/`mergedBase` were already the honest, non-tautological version of that
   * question (B2.5): `merged: true` says outright that the judged tree is NOT the tree on
   * the branch alone, i.e. not what a plain `git log` of the PR shows as pushed.
   */
  merged?: boolean;
  /** The `origin/main` sha that was merged in, when {@link merged} is true. */
  mergedBase?: string;
  /**
   * The TREE this attestation drove, when it is known.
   *
   * A merge-queue entry is a fresh merge commit even when nothing landed since the pull
   * request head was gated, so no two shas ever match — but their trees do, and the tree
   * is what a live drive actually exercises. Without this recorded, the queue would pay a
   * live slot to re-prove byte-identical code. See ./merge-queue.
   */
  tree?: string;
  /**
   * The sha this record's `head` was actually checked out and tested as — identical to
   * `head` for a plain (non-merged) gate, and equal to the merge commit's sha when
   * {@link merged} is true. This is the sha `scripts/verify-gate.js` named its artifact
   * after (`report/e2e/gate-<gatedSha>.json`), so a reader holding only this verdict can
   * find that artifact directly — no git lookup required (B4.1,
   * SPO-Pipeline/doc/bench-audit-2026-09-02.md D6). Always recorded, even when it equals `head`, so a
   * reader never has to infer which case this is. Absent on a verdict written before this
   * field existed.
   *
   * ALWAYS ABSENT on a reuse copy ({@link reusedFrom} set). `head` was never checked out
   * for a reuse copy at all — there is no sha to name here, and copying the source's
   * `gatedSha` onto a different `head` would describe evidence for a commit this record
   * did not gate while looking exactly like this record's own. See
   * {@link reusedGatedSha} for the (distinctly named) equivalent fact about the source.
   */
  gatedSha?: string;
  /**
   * `head`, spelled out under the name the gate artifact's matching field uses
   * (`depositedSha`) — so a reader who arrived here FROM the artifact (via `gatedSha`,
   * above) can confirm the pair without remembering that this file calls the same fact
   * `head` and the artifact calls it `depositedSha`. Always equal to `head`; present for
   * symmetry with the artifact, not because it can ever differ from it. Absent on a
   * verdict written before this field existed.
   */
  depositedSha?: string;
  /**
   * Present ONLY on a reuse copy ({@link reusedFrom} set): the source verdict's own
   * {@link gatedSha} at the moment it was copied — i.e. the gate artifact that holds the
   * REAL evidence backing this reuse (`report/e2e/gate-<reusedGatedSha>.json`), filed
   * under a commit this record's `head` never was.
   *
   * Deliberately NOT named `gatedSha`: this record's `head` (the queue entry's own sha)
   * was never checked out or tested, so a field named `gatedSha` here would read as this
   * record's own evidence when it instead describes a different commit entirely — the
   * exact defect this field's introduction fixes (F1,
   * SPO-Pipeline/doc/bench-audit-2026-09-02.md). A reader who wants the underlying
   * artifact for a reuse copy must come here, not to `gatedSha`, which this record never
   * sets.
   */
  reusedGatedSha?: string;
  jobId: string;
  /**
   * The sha whose live drive this attestation copies; absent = not a reuse.
   *
   * This is the CURRENT encoding, and every writer (`mergeQueueDeps.reuse` in
   * ./worker) has used it since 19490070 (2026-08-26). 27 reuse records on the real
   * corpus predate that change and instead append prose to `jobId` — e.g.
   * `job-01787672998877-1a15c1 (reused: identical tree to cf537547, already driven
   * live)`. Nothing in this codebase writes that shape any more; {@link reuseSourceOf}
   * reads both because a check that only recognised the current encoding would silently
   * miss a third of the corpus's reuse history.
   */
  reusedFrom?: string;
  createdAt: string;
  /** Capability exceptions the gate recorded (doc/E2E-POLICY.md §7) — shown on GitHub. */
  exceptions?: number;
  /**
   * UNPROVEN flows the gate artifact recorded (doc/E2E-POLICY.md §7) — a required one
   * already made the gate's exit code FAIL; shown on GitHub. Absent on a verdict written
   * before this field existed (read as 0).
   */
  unproven?: number;
  /**
   * What the live stage did. See {@link LiveAttestation}. Absent on a verdict written
   * before this field existed — a reader MUST treat that absence exactly like the
   * `'unknown'` member, never as "the live stage ran": that conflation is the bug this
   * field exists to close (11 PRs merged behind a PASS that never said which it was).
   */
  live?: LiveAttestation;
  /**
   * Whether the static stage was proven by CI or replayed on the bench. See
   * {@link StaticProofAttestation}. Absent on a verdict written before this field
   * existed — treat exactly like `{ status: 'unknown' }`.
   */
  staticProof?: StaticProofAttestation;
  /** Set once the commit status landed on GitHub. */
  published?: boolean;
}

/** The old, pre-19490070 encoding: prose appended to `jobId` rather than `reusedFrom`. */
const LEGACY_REUSE_PROSE = /reused: identical tree to ([0-9a-f]{7,40})/;

/**
 * The sha a verdict was reused from, in whichever of the two encodings it was written
 * with — the structured {@link BenchVerdict.reusedFrom} field, or the legacy prose
 * appended inside `jobId` before 19490070 (2026-08-26). Returns `null` when the verdict
 * is not a reuse at all.
 *
 * The legacy prose form always carries an 8-character short sha (`cf537547`, not the
 * full 40), because that is all the log line it was lifted from ever printed. The
 * STRUCTURED field is not guaranteed to be the full 40, though it always has been until
 * today: `mergeQueueDeps.reuse` (./worker) writes it byte-identical to `source.verdict.head`,
 * and every writer of `head` itself is expected to hold a full sha — except a session can
 * submit `spo bench --ref <short>` (cli.ts), which stores exactly what it was given. One
 * real record does this (`083e7a1c…json`, 2026-09-03, `reusedFrom: "95158cf2"`), and the
 * corpus now holds a verdict whose OWN head is that same short string (`95158cf2.json`)
 * alongside the 40-character one it was actually meant to reuse from
 * (`95158cf237d3610c7cb06b06e8202d7fcd0f5675`). A bare `head === reusedFrom` lookup against
 * either is not safe in general for a short value in either encoding — see
 * {@link resolveReuseSource}, which is.
 */
export function reuseSourceOf(verdict: Pick<BenchVerdict, 'reusedFrom' | 'jobId'>): string | null {
  if (verdict.reusedFrom) return verdict.reusedFrom;
  const match = LEGACY_REUSE_PROSE.exec(verdict.jobId);
  return match ? match[1] : null;
}

/**
 * Resolve what {@link reuseSourceOf} returns to the verdict it actually names, against a
 * real corpus where that value can be short — deliberately (the legacy prose encoding) or
 * accidentally (a `--ref` submitted short; see {@link reuseSourceOf}'s own comment). A
 * short value is resolved as a PREFIX of a full head, which is what the legacy encoding
 * always needs and the accidental case usually doesn't.
 *
 * Refuses to guess rather than silently pick one: if the value matches more than one
 * distinct head — a short reference that is simultaneously some verdict's own full head
 * AND a genuine prefix of a different, longer one, which is exactly what the corpus holds
 * today for `95158cf2` — this returns `null`. An exact 40-character match is unambiguous
 * by construction (at most one verdict can hold any given head) and always resolves.
 */
export function resolveReuseSource(
  reusedFrom: string,
  verdicts: Pick<BenchVerdict, 'head'>[],
): string | null {
  const candidates = new Set(
    verdicts.map(v => v.head).filter(head => head === reusedFrom || head.startsWith(reusedFrom)),
  );
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function writeVerdict(paths: BenchPaths, verdict: BenchVerdict): string {
  return writeVerdictIn(paths.verdicts, verdict);
}

/**
 * The same write, into a named directory.
 *
 * It exists because #158 stage B runs two gate paths at once — a session's worktree and a
 * ref the worker fetched — and both answer for the SAME sha. Writing both into
 * `verdicts/` would leave whichever finished last, which is precisely the comparison
 * being destroyed.
 */
export function writeVerdictIn(dir: string, verdict: BenchVerdict): string {
  const target = path.join(dir, `${verdict.head}.json`);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, target);
  return target;
}

export function listVerdicts(paths: BenchPaths): { file: string; verdict: BenchVerdict }[] {
  return listVerdictsIn(paths.verdicts);
}

export function listVerdictsIn(dir: string): { file: string; verdict: BenchVerdict }[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: { file: string; verdict: BenchVerdict }[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      out.push({ file, verdict: JSON.parse(fs.readFileSync(file, 'utf8')) as BenchVerdict });
    } catch {
      // Unreadable attestation: leave it; the hook will refuse it on its own.
    }
  }
  return out;
}

/** GitHub commit-status state for a verdict. */
export function statusState(verdict: JobVerdict): 'success' | 'failure' | 'error' {
  if (verdict === 'PASS') return 'success';
  if (verdict === 'ENVIRONMENT' || verdict === 'INTERRUPTED') return 'error';
  return 'failure';
}

export type StatusPublisher = (worktree: string, head: string, state: string, description: string) => void;

/** Publish via `gh api` — resolves owner/repo from the worktree's origin remote. */
export function ghStatusPublisher(
  execFile: (cmd: string, args: string[], cwd: string) => void,
  context: string = 'bench/gate',
): StatusPublisher {
  return (worktree, head, state, description) => {
    execFile(
      'gh',
      [
        'api',
        `repos/{owner}/{repo}/statuses/${head}`,
        '-f', `state=${state}`,
        '-f', `context=${context}`,
        '-f', `description=${description}`,
      ],
      worktree,
    );
  };
}

/** Don't retry a sha forever — after this age the commit was evidently never pushed. */
const PUBLISH_WINDOW_MS = 24 * 60 * 60 * 1000;

/** GitHub's commit-status `description` field is truncated/rejected past this many characters. */
export const STATUS_DESCRIPTION_MAX = 140;

/**
 * Build the GitHub commit-status description for a verdict, never exceeding
 * {@link STATUS_DESCRIPTION_MAX} characters.
 *
 * The verdict word, the liveness marker, the exception count, the unproven-flow count
 * (rendered only when > 0) and the base sha form a protected tail — always included in full. The job id is appended last, into whatever
 * budget remains; when a long `reusedFrom`/`jobId`/`baseMain` chain would blow the
 * budget, the job id is truncated, or dropped entirely if there is no room for it at all.
 *
 * There used to be a "(tree moved)" marker here too, driven by a `fingerprintStable`
 * field removed in B2.5: it was `true` in the whole corpus (518 verdicts on file as of
 * 2026-09-03; it only grows) and could not go `false` for the only job type that ever
 * wrote one (`ref`) short of the fingerprinter
 * itself throwing — see {@link BenchVerdict.merged} for what actually answers "is the
 * judged tree the pushed tree" now.
 *
 * `merged` renders as "merged base <sha8>" in place of the plain "base <sha8>" — the
 * distinction a reader needs is not just which `main` the gate stood on, but whether the
 * tree it judged was the branch alone or a merge with that `main`.
 *
 * The liveness marker is the fix for the 3.5-day class this action closes: a static-only
 * PASS used to render byte-identical to a live one. `verdict.live` present renders
 * "— live" (ran), "— static-only" (skipped), "— live blocked-skip" (BLOCKED by SKIPPED
 * flows) or "— live unknown" (unreadable/absent artifact) immediately after the verdict word; `verdict.live` absent — a verdict written
 * before this field existed — renders nothing, same as before this fix.
 */
export function statusDescription(verdict: BenchVerdict): string {
  const base =
    verdict.merged && verdict.mergedBase
      ? ` — merged base ${verdict.mergedBase.slice(0, 8)}`
      : verdict.baseMain
        ? ` — base ${verdict.baseMain.slice(0, 8)}`
        : '';
  const live =
    verdict.live === undefined
      ? ''
      : verdict.live.status === 'ran'
        ? ' — live'
        : verdict.live.status === 'skipped'
          ? ' — static-only'
          : verdict.live.status === 'blocked-skip'
            ? ' — live blocked-skip'
            : ' — live unknown';
  const tail =
    verdict.verdict +
    live +
    `${verdict.exceptions ? ` — ${verdict.exceptions} capability exception(s)` : ''}` +
    `${verdict.unproven ? ` — ${verdict.unproven} unproven flow(s)` : ''}` +
    base +
    `${verdict.reusedFrom ? ` — reused ${verdict.reusedFrom.slice(0, 8)}` : ''}`;

  const jobSuffix = ` — job ${verdict.jobId}`;
  if (tail.length + jobSuffix.length <= STATUS_DESCRIPTION_MAX) return tail + jobSuffix;

  // Not enough room for the full job id — truncate it to whatever fits.
  const prefix = ' — job ';
  const budget = STATUS_DESCRIPTION_MAX - tail.length - prefix.length;
  if (budget <= 0) return tail.slice(0, STATUS_DESCRIPTION_MAX);
  return tail + prefix + verdict.jobId.slice(0, budget);
}

/**
 * One publishing pass: try every fresh, unpublished attestation. A failure (typically
 * 422 — the sha is not on GitHub yet because the session has not pushed) leaves the
 * file untouched for the next pass; success stamps `published: true`. `failures` counts
 * consecutive publish failures per sha across passes — logged once, on the third — and
 * defaults to a fresh map so callers that don't care about the streak see prior behaviour.
 */
export function publishPendingStatuses(
  paths: BenchPaths,
  publish: StatusPublisher,
  log: (line: string) => void,
  nowMs: number = Date.now(),
  dir: string = paths.verdicts,
  failures: Map<string, number> = new Map(),
): void {
  for (const { verdict } of listVerdictsIn(dir)) {
    if (verdict.published) continue;
    if (nowMs - Date.parse(verdict.createdAt) > PUBLISH_WINDOW_MS) continue;
    try {
      publish(verdict.worktree, verdict.head, statusState(verdict.verdict), statusDescription(verdict));
      writeVerdictIn(dir, { ...verdict, published: true });
      log(`published ${statusState(verdict.verdict)} for ${verdict.head.slice(0, 8)}`);
      failures.delete(verdict.head);
    } catch (err: unknown) {
      const count = (failures.get(verdict.head) ?? 0) + 1;
      failures.set(verdict.head, count);
      if (count === 3) {
        log(`publish failed 3x for ${verdict.head.slice(0, 8)}: ${toErrorMessage(err)}`);
      }
    }
  }
}
