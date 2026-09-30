/**
 * Serving GitHub's merge queue.
 *
 * A queue entry is a **speculative commit** — `gh-readonly-queue/main/pr-N-<base>` — that
 * GitHub builds by merging the pull request onto the current queue head. It exists on
 * GitHub and in nobody's worktree, which is exactly why the bench had to learn to gate a
 * commit it fetches (#158 stage B) before any of this was possible.
 *
 * It is also the thing that makes `baseMain` obsolete. Until now a gate proved
 * `merge(branch, the main it was based on)` and *announced* that `main` had since moved;
 * a queue entry IS `merge(branch, main-now)`, so what gets driven live is precisely what
 * will land.
 *
 * ## Why the worker polls instead of being told
 *
 * Required checks in a merge queue must report on the speculative commit, and the worker
 * takes no inbound connection — it pulls its work. `git ls-remote` names every queue ref
 * and its sha in one round trip, which is cheap enough to do on an idle tick.
 *
 * ## Why an entry jumps the bench queue
 *
 * GitHub ejects an entry whose required checks exceed the queue's response timeout. The
 * bench is serialised machine-wide and a `lease` can hold it for a long time — measured
 * median 11 min, **max 33 min**. Without priority, a lease would eject a perfectly healthy
 * branch, and the session that owned it would spend its three attempts on somebody else's
 * `npm run dev`. So a queue entry goes to the front. It cannot starve anything for long:
 * the queue is configured one entry at a time, and an entry is one gate.
 *
 * ## Why the dedup keys on the TREE, not the commit
 *
 * A queue ref is a fresh merge commit even when nothing landed in between, so a
 * commit-sha dedup would never hit. Its **tree**, though, is byte-identical to the pull
 * request head's whenever the queue head has not moved since that head was gated — which
 * is the common case with one entry at a time. Re-driving an identical tree proves nothing
 * new and costs a live slot, so the verdict is reused and the status published at once.
 * When `main` HAS moved the trees differ, the drive happens, and that is exactly the case
 * where it is worth paying for.
 *
 * ## Why the entry is fetched before its tree is read
 *
 * A queue entry exists on GitHub and in no checkout. Reading `<sha>^{tree}` before fetching
 * it can therefore only fail, which is how the dedup shipped and why it never hit once:
 * every entry fell through the safe branch — "tree unknown, drive it live" — and paid a
 * full live slot, including the common case where the tree had been driven minutes earlier.
 * So the objects come down first. That costs a round trip on an idle tick, against the
 * ~113 s of exclusive bench time a needless drive costs.
 *
 * ## Why tree equality is necessary but not sufficient (B2.4)
 *
 * Tree equality proves the CODE is identical; it says nothing about whether the
 * candidate itself was ever proven live. Before B2.4, `mayReuseVerdict` reused any PASS
 * with a matching tree, so a candidate whose own gate skipped the live stage — despite
 * the router requiring flows — propagated forward as a plain PASS every downstream reuse
 * could not tell apart from a real live drive (15 records on the real corpus). See
 * {@link mayReuseVerdict} for the rule that closes this.
 *
 * Since #1182 the rule is positive: a candidate is reused only when its own liveness PROVES
 * something — it ran live, or it skipped with nothing routed. An absent or `'unknown'`
 * liveness proves nothing live, so that entry is re-gated, never reused; those verdicts stay
 * readable (`listVerdicts`, `attested()`), they just take a live slot instead.
 */

import { toErrorMessage } from '../../shared/error-utils';
import type { LiveAttestation } from './verdict';

/** Only refs GitHub itself creates for a merge group. */
const QUEUE_REF = /^refs\/heads\/(gh-readonly-queue\/[^\s]+)$/;

export interface QueueEntry {
  /** The full ref name, e.g. `gh-readonly-queue/main/pr-168-ce151856…`. */
  ref: string;
  /** The speculative commit. */
  sha: string;
}

export type LsRemote = (cwd: string) => string;

/**
 * The queue refs a `git ls-remote` listing carries.
 *
 * Parsing is separated from running so every shape — no refs, several, junk lines — is
 * testable without a network.
 */
export function parseQueueRefs(raw: string): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const line of raw.split('\n')) {
    const [sha, ref] = line.split(/\s+/);
    if (!sha || !ref) continue;
    const match = QUEUE_REF.exec(ref);
    if (match) out.push({ ref: match[1], sha });
  }
  return out;
}

/** Ask origin what queue refs exist right now. An unreachable remote yields none. */
export function listQueueEntries(lsRemote: LsRemote, cwd: string, log: (line: string) => void): QueueEntry[] {
  try {
    return parseQueueRefs(lsRemote(cwd));
  } catch (err: unknown) {
    // Never fatal: the queue is GitHub's to manage, and a listing we could not take is a
    // tick with nothing to do, not an error state to enter.
    log(`merge queue: could not list refs (${toErrorMessage(err)})`);
    return [];
  }
}

export interface QueueDecision {
  /** Nothing to do — already answered, or already queued. */
  skip: boolean;
  why?: string;
}

/**
 * Should this entry be gated?
 *
 * No when a `bench/gate` status already exists for the sha (we answered it), and no when a
 * job for it is already queued or running (we are answering it). Both are the same idea:
 * an entry is gated exactly once.
 */
export function shouldGate(
  entry: QueueEntry,
  alreadyAttested: (sha: string) => boolean,
  alreadyPending: (sha: string) => boolean,
): QueueDecision {
  if (alreadyPending(entry.sha)) return { skip: true, why: 'a job for this entry is already in the spool' };
  if (alreadyAttested(entry.sha)) return { skip: true, why: 'this entry already has a bench/gate status' };
  return { skip: false };
}

/**
 * The tree a ref points at.
 *
 * `<ref>^{tree}` rather than the commit, and that distinction is the whole dedup. A queue
 * entry is a fresh merge commit even when nothing landed between the pull request's gate
 * and its turn in the queue, so two commits are never equal — but their trees are, and the
 * tree is what a live drive actually exercises.
 */
export function treeOf(git: (args: string[], cwd: string) => string, ref: string, cwd: string): string | null {
  try {
    return git(['rev-parse', `${ref}^{tree}`], cwd).trim() || null;
  } catch {
    // A ref the checkout still does not have is not an error here — it is a reason to gate
    // it normally, which is what a null answer produces.
    return null;
  }
}

/**
 * Bring an entry's objects into the checkout, so that its tree can be read at all.
 *
 * Fetched **by ref name, with no local destination**: `refs/heads/gh-readonly-queue/…`
 * rather than the bare sha, because a server need not serve an arbitrary sha it was not
 * asked to advertise; and with no refspec, because the objects are all that is wanted —
 * nothing is written under `refs/`, so an entry GitHub deletes leaves nothing behind. Almost
 * every object is already present from the pull request head, so this is a round trip rather
 * than a transfer.
 *
 * Best-effort on purpose, and the caller reads the tree whether this succeeded or not: the
 * checkout may already hold the objects from an earlier tick. A failure is logged and never
 * thrown, and a tree that still cannot be read means *gate it* — never "assume it matches".
 */
export function fetchEntry(
  git: (args: string[], cwd: string) => string,
  entry: QueueEntry,
  cwd: string,
  log: (line: string) => void,
): boolean {
  try {
    git(['fetch', '--no-tags', '--quiet', 'origin', `refs/heads/${entry.ref}`], cwd);
    return true;
  } catch (err: unknown) {
    log(`merge queue: could not fetch ${entry.ref} (${toErrorMessage(err)})`);
    return false;
  }
}

export interface ReuseDecision {
  /** The sha whose verdict may be reused, or null when the drive has to happen. */
  reuseFrom: string | null;
  why: string;
}

/** One attested candidate `mayReuseVerdict` can pick from. */
export interface ReuseCandidate {
  head: string;
  tree: string | null;
  verdict: string;
  /**
   * What the candidate's own live stage did. See {@link LiveAttestation}. Absent means
   * `'unknown'` — either an explicit `{status:'unknown'}`, or a verdict `attested()`
   * (./worker) could not find an answer for at all: no on-disk `live` field AND no gate
   * artifact it could recover one from (worker.ts's `resolveLegacyLiveness`). Measured
   * 2026-09-03: 515 of 518 verdicts on file predate the `live` field — a DIFFERENT, smaller
   * population than the 518-of-518 still carrying the deleted `fingerprintStable` (see
   * ./verdict; the two counts were once conflated here) — and most of those 515 are
   * resolved from their gate artifact before this rule ever sees them. What resolution
   * still cannot answer reads as absent, and {@link mayReuseVerdict} re-gates it: it
   * proves nothing live.
   */
  live?: LiveAttestation;
}

/**
 * Does this candidate's own liveness prove enough to stand in for a live drive of the
 * identical tree? Only two states do: it ran live, or it skipped with nothing routed
 * (nothing was owed). A skip with flows routed is B2.4's "15-record case" — a static-only
 * PASS that would propagate as if it were live. Absent or `'unknown'` carries no `required`
 * list to judge by (see {@link LiveAttestation}), so it proves nothing live either.
 */
function provesItsLiveness(live: LiveAttestation | undefined): boolean {
  if (live?.status === 'ran') return true;
  return live?.status === 'skipped' && live.required.length === 0;
}

/**
 * May this entry reuse an existing PASS instead of taking a live slot?
 *
 * First: some already-attested sha must share **the same tree**. Then the live drive
 * would exercise byte-identical code and prove nothing new. When `main` has moved the
 * trees differ, the drive happens, and that is precisely the case worth paying for.
 *
 * Second (B2.4): the candidate's own liveness. Tree equality means the code is
 * identical, so whatever the router would require of THIS entry is exactly what it
 * already required — and did or did not receive — for the candidate. That makes the
 * candidate's `live` status a direct answer for the entry, not a proxy:
 *
 *  - `'ran'` is the strongest evidence there is — reuse it.
 *  - `'skipped'` with an empty `required` means nothing was owed; there is no live fact
 *    missing to propagate — reuse it.
 *  - `'skipped'` with a non-empty `required` is the hole this rule closes — refuse it,
 *    and drive the entry instead.
 *  - `'unknown'` — whether asserted directly, or because nothing on file could answer the
 *    question for this candidate at all (the field did not exist yet, the gate artifact
 *    was never written or is unreadable, or its recovery failed validation — see
 *    worker.ts's `resolveLegacyLiveness`) — proves nothing live, and carries no `required`
 *    list to judge by. Refuse it, and drive the entry instead (#1182).
 *
 *    Nearly all of that population is resolved before this rule sees it: every new write
 *    carries `live`, and `attested()` recovers a legacy verdict's answer from its gate
 *    artifact at decision time. Measured 2026-09-03: of the 377 PASS-with-tree candidates
 *    this rule can ever be asked to reuse, 359 are recoverable that way, leaving 18
 *    genuinely unrecoverable. Those 18 stay readable (`listVerdicts`, `attested()`) but
 *    are re-gated rather than reused — a live slot is the price of a verdict that never
 *    said what it proved.
 *
 * Fails toward driving: an unknown tree, an unreadable one, no candidates, all mean gate it.
 */
export function mayReuseVerdict(entryTree: string | null, attested: ReuseCandidate[]): ReuseDecision {
  if (!entryTree) return { reuseFrom: null, why: 'the entry tree could not be read' };
  const match = attested.find(
    a => a.tree === entryTree && a.verdict === 'PASS' && provesItsLiveness(a.live),
  );
  if (!match) return { reuseFrom: null, why: 'no passing attestation shares this tree' };
  const liveNote =
    match.live?.status === 'ran' ? ', already driven live' : ', already judged (no live drive was required)';
  return { reuseFrom: match.head, why: `identical tree to ${match.head.slice(0, 8)}${liveNote}` };
}

export interface MergeQueueDeps {
  lsRemote: LsRemote;
  git: (args: string[], cwd: string) => string;
  /** Every attestation on this machine, with the tree each one drove. */
  attested: () => ReuseCandidate[];
  /** Is a job for this sha already queued or running? */
  pendingFor: (sha: string) => boolean;
  /** Copy an existing verdict onto another sha, so the status lands without a live slot. */
  reuse: (fromSha: string, toSha: string, why: string) => void;
  /** Deposit a priority ref job for this entry. */
  deposit: (entry: QueueEntry) => void;
  checkoutDir: string;
  log: (line: string) => void;
}

/**
 * One pass over GitHub's merge queue, called from the worker's idle tick.
 *
 * Idle, and not on every tick, for the same reason the nightly is: an entry takes the
 * bench like any other job, and jumping the line (see the module comment) is only sound
 * if we are not also interrupting something mid-flight.
 *
 * Returns how many entries it acted on — 0 is the overwhelmingly common answer.
 */
export function serveMergeQueue(deps: MergeQueueDeps): number {
  const entries = listQueueEntries(deps.lsRemote, deps.checkoutDir, deps.log);
  if (entries.length === 0) return 0;

  const attested = deps.attested();
  const hasStatus = (sha: string): boolean => attested.some(a => a.head === sha);
  let acted = 0;

  for (const entry of entries) {
    const decision = shouldGate(entry, hasStatus, deps.pendingFor);
    if (decision.skip) continue;

    // Fetch, THEN read. The tree is read out of the checkout, and a speculative commit is
    // never in one until it is fetched — reading first made the answer unconditionally
    // "unknown", so the dedup could not hit even when the tree was identical.
    fetchEntry(deps.git, entry, deps.checkoutDir, deps.log);
    const reuse = mayReuseVerdict(treeOf(deps.git, entry.sha, deps.checkoutDir), attested);
    if (reuse.reuseFrom) {
      deps.log(`merge queue: ${entry.sha.slice(0, 8)} reuses ${reuse.reuseFrom.slice(0, 8)} — ${reuse.why}`);
      deps.reuse(reuse.reuseFrom, entry.sha, reuse.why);
    } else {
      deps.log(`merge queue: gating ${entry.sha.slice(0, 8)} (${entry.ref}) — ${reuse.why}`);
      deps.deposit(entry);
    }
    acted++;
  }
  return acted;
}
