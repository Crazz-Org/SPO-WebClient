/**
 * `check-pr-rules.js` gates the required `typecheck + tests` check on the PULL REQUEST BODY —
 * it reads `PR_BODY` from `github.event.pull_request.body` and fails when a change to
 * `rdo-members.ts` carries no `File.pas:Line` citation. That is a mutable input to an
 * immutable verdict, and the two only stay in sync if an edit to the body re-runs the check.
 *
 * `pull_request` with no `types:` does not do that: it defaults to
 * [opened, synchronize, reopened], none of which a body edit fires. So a PR opened with an
 * incomplete body failed, got its citation added, and then waited on a re-run no event could
 * produce — red required check, valid body, no way forward but a human pressing the button.
 * PR #380 sat in exactly that state while a session slept on a schedule waiting for it.
 *
 * This file pins the trigger that closes the loop. It is not a style assertion: drop `edited`
 * and every citation added after opening deadlocks its own pull request.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const read = (...p: string[]): string => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

describe('a PR-body edit re-runs the check that reads the PR body', () => {
  const ci = read('.github', 'workflows', 'ci.yml');

  it('ci.yml declares pull_request types explicitly, including edited', () => {
    // The bare `pull_request:` form is the bug — it silently means "not edited".
    expect(ci).toMatch(/^ {2}pull_request:\n {4}types: \[[^\]]*\]/m);
    const types = /^ {2}pull_request:\n {4}types: \[([^\]]*)\]/m.exec(ci)?.[1] ?? '';
    expect(types.split(',').map((t) => t.trim())).toEqual(
      expect.arrayContaining(['opened', 'synchronize', 'reopened', 'edited'])
    );
  });

  it('the rules step still reads the body from the event payload it was re-triggered by', () => {
    // If PR_BODY ever stops coming from the event, `edited` stops being the right remedy.
    expect(ci).toMatch(/PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}/);
    expect(ci).toMatch(/run: node scripts\/check-pr-rules\.js/);
  });

  it('the rules step diffs against the base BRANCH, never the sha frozen at opening', () => {
    // `base.sha` is where the base was when the PR opened; CI checks out the merge ref, so
    // that sha makes `merge-base` return itself and every file the base gained since is
    // blamed on this branch. It failed the RDO citation rule on PR #743 — five files, none
    // of them the catalogue — on 2026-09-12.
    expect(ci).toMatch(/BASE_SHA: origin\/\$\{\{ github\.event\.pull_request\.base\.ref \}\}/);
    expect(ci).not.toMatch(/BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  });

  it('check-pr-rules.js is the consumer that makes the body a merge blocker', () => {
    const rules = read('scripts', 'check-pr-rules.js');
    expect(rules).toMatch(/process\.env\.PR_BODY/);
    expect(rules).toMatch(/cites no server declaration/);
  });

  it('the merge_group trigger survives — the queue reports on a speculative commit', () => {
    // Narrowing `pull_request` must never cost the queue its required context (#158 stage D).
    expect(ci).toMatch(/^ {2}merge_group:$/m);
  });
});
