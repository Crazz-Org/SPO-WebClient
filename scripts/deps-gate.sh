#!/usr/bin/env bash
# npm run deps:gate [PR...] — take Dependabot's pull requests through the bench, one at a time.
#
# Default: every open PR by app/dependabot, oldest first. Per PR, strictly in sequence:
#
#   1. a throwaway worktree at .claude/worktrees/deps-<N> on the PR branch, with origin/main
#      MERGED in — Dependabot rebases only on conflict and never again once a human has
#      pushed, so "branch up to date" is ours to satisfy. A merge, never a rebase: history
#      is not rewritten, so the push needs no force (this repo forbids force pushes; the
#      merge queue will enforce MERGE). A merge conflict is not ours to
#      solve: comment `@dependabot recreate`, drop the worktree, move on (SKIPPED-conflict);
#   2. `npm ci` IN THAT WORKTREE. This is the whole point of the script: a session worktree has no
#      node_modules of its own, so npm and Node resolution walk up to ~/SPO-WebClient/
#      node_modules — the MAIN checkout's OLD dependencies. The bench worker builds and
#      drives the worktree (`npm run build`, `node dist/server/server.js`) and never runs
#      `npm ci`, so without this step a dependency bump would be built and driven against
#      the packages it is supposed to replace: a green bench/gate that tests nothing about
#      the bump. node_modules is gitignored, so the install does not disturb the tree
#      fingerprint the attestation is bound to;
#   3. `git push`, then `npm run gate` — the same command a session runs. The bench gates a
#      waited on. The worker attests the merged sha;
#   4. ONLY on gate exit 0: `gh pr merge
#      --merge --auto`, wait for MERGED, then `scripts/finish.sh` from the worktree (ff
#      main, refresh main's node_modules, remove worktree + branch).
#      Gate exit != 0: the worktree stays for inspection (GATE-FAIL), next PR.
#
# Why the push now happens BEFORE the gate: the bench fetches the commit it tests, so it
# has to exist on origin first (#158 stage C). Gating first would fail "NOT PUSHED" on
# every pull request here.
#
# The old order was not arbitrary — the push hook refused anything the bench had not
# attested, so this script had to gate first and then push exactly that sha and nothing
# else. That rule is gone, and pushing an ungated sha to a PR branch costs nothing:
# `bench/gate` is a required status check on `main` with an empty bypass list, so the
# `gh pr merge --auto` below cannot land a commit the worker has not attested. The
# guarantee moved from the push to the merge, which is where the irreversible act
# always was. The worker publishes bench/gate on the pushed sha within ~30 s.
#
# That guarantee held a gap: ruleset 21111153 dropped `bench/gate` from the required list
# on 2026-08-29T10:17:40Z (advisory only — `gh pr merge --auto` COULD have landed an
# unattested sha for those five days) and it was restored on 2026-09-03T07:32:42+02:00.
# Re-check before trusting this comment: `gh api repos/Crazz-Org/SPO-WebClient/rulesets/21111153`.
set -euo pipefail

MAIN_REPO="${SPO_MAIN_REPO:-$HOME/SPO-WebClient}"
WORKTREES="$MAIN_REPO/.claude/worktrees"
MERGE_TIMEOUT_S=600

summary=()
note() { summary+=("$1"); echo "== #$1"; }

if [ $# -gt 0 ]; then
  prs=("$@")
else
  mapfile -t prs < <(gh pr list --author app/dependabot --state open --json number -q 'sort_by(.number) | .[].number')
fi
if [ ${#prs[@]} -eq 0 ]; then
  echo "no open Dependabot PR"
  exit 0
fi
echo "Dependabot PRs, oldest first: ${prs[*]}"

for n in "${prs[@]}"; do
  echo
  echo "########## PR #$n"
  branch="$(gh pr view "$n" --json headRefName -q .headRefName)"
  wt="$WORKTREES/deps-$n"

  git -C "$MAIN_REPO" fetch --prune --quiet origin
  if [ -d "$wt" ]; then
    echo "-- removing a previous worktree at $wt"
    git -C "$MAIN_REPO" worktree remove --force "$wt"
  fi
  git -C "$MAIN_REPO" worktree add -B "$branch" "$wt" "origin/$branch"

  if ! git -C "$wt" merge --quiet --no-edit origin/main; then
    git -C "$wt" merge --abort || true
    echo "-- merging origin/main conflicts: asking Dependabot to recreate the PR"
    gh pr comment "$n" --body "@dependabot recreate"
    git -C "$MAIN_REPO" worktree remove --force "$wt"
    git -C "$MAIN_REPO" branch -D "$branch" >/dev/null 2>&1 || true
    note "$n SKIPPED-conflict ($branch)"
    continue
  fi
  sha="$(git -C "$wt" rev-parse HEAD)"

  echo "-- npm ci in $wt (the bench builds against THIS node_modules, not main's)"
  (cd "$wt" && npm ci --no-audit --no-fund)

  # PUSH FIRST, then gate. The order was the other way round until #158 stage C, because
  # the push hook refused any push the bench had not attested — so the gate had to come
  # first, and the script had to guarantee it pushed nothing else.
  #
  # The gate now tests a commit the worker FETCHES from GitHub, so the commit has to be
  # there before it can be gated at all. Gating first would fail with "NOT PUSHED" on
  # every Dependabot pull request.
  #
  # Nothing is weakened by pushing an ungated sha to a PR branch: `bench/gate` is a
  # required status check on `main` with an empty bypass list, so the `gh pr merge --auto`
  # below cannot land anything the worker has not attested. The guarantee moved from the
  # push to the merge, which is where the irreversible act always was. (That was false for
  # five days — 2026-08-29T10:17:40Z to 2026-09-03T07:32:42+02:00, see the header comment
  # above `set -euo pipefail`.)
  echo "-- pushing ${sha:0:8} so the bench can fetch it (fast-forward, no force)"
  # Dependabot may have recreated the branch (its conflict rebase): the remote then holds
  # work we do not have, and a fast-forward is rightly refused. That is not ours to force —
  # leave the worktree, report, and let the next run pick the new head up.
  if ! git -C "$wt" push origin "HEAD:$branch"; then
    note "$n SKIPPED-moved (the remote branch changed before the gate — ${sha:0:8} is not its head; rerun)"
    git -C "$MAIN_REPO" worktree remove --force "$wt"
    git -C "$MAIN_REPO" branch -D "$branch" >/dev/null 2>&1 || true
    continue
  fi

  # The log lives OUTSIDE the worktree: an untracked file inside it would dirty the tree
  # fingerprint and the worker would refuse to attest.
  gate_log="$WORKTREES/deps-$n.gate.log"
  echo "-- npm run gate (log: $gate_log)"
  if ! (cd "$wt" && npm run gate 2>&1 | tee "$gate_log"); then
    report="$(grep -o 'report will land in [^ ]*' "$gate_log" | tail -1 | sed 's/report will land in //')"
    note "$n GATE-FAIL ${report:-$gate_log} ($branch @ ${sha:0:8}; worktree kept at $wt)"
    continue
  fi

  echo "-- gate PASS for ${sha:0:8}: arming auto-merge"
  # --merge, never --squash: main's merge queue is set to MERGE and overrides the flag anyway.
  # Never --delete-branch here — it would destroy the queue entry (CLAUDE.md § Git).
  gh pr merge "$n" --merge --auto

  deadline=$(( $(date +%s) + MERGE_TIMEOUT_S ))
  state=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    # REST, not `gh pr view` (which goes through GraphQL): a bounded merge poll spends the
    # request bucket, not the GraphQL points every session's board reads share
    # (doc/kanban-workflow.md § GitHub API discipline).
    state="$(gh api "repos/{owner}/{repo}/pulls/$n" --jq 'if .merged then "MERGED" else .state end')"
    [ "$state" = "MERGED" ] && break
    sleep 30
  done
  if [ "$state" != "MERGED" ]; then
    note "$n TIMEOUT (state $state after ${MERGE_TIMEOUT_S}s; auto-merge armed, worktree kept at $wt)"
    continue
  fi

  echo "-- merged: finishing (main ff'd, node_modules refreshed, worktree + branch removed)"
  (cd "$wt" && bash scripts/finish.sh)
  note "$n MERGED ($branch @ ${sha:0:8})"
done

echo
echo "########## summary"
for line in "${summary[@]}"; do echo "#$line"; done
