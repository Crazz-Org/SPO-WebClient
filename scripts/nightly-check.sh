#!/usr/bin/env bash
# Print one verdict line and exit with a code the caller branches on —
# it never re-derives the predicate.
#
# action B3.2 (SPO-Pipeline): the classification below is the SAME table
# orchestrator/steps/scripted.js's classifyNightly applies to this exact
# file from the other repo (a merge-onto-main guard, not a status probe) —
# kept in sync by hand, not by import, since the two are bash and Node in
# two separate repos with no shared runtime. See that function's own header
# comment for the full rationale. Before this action the two disagreed with
# themselves and with each other, and both failed towards green: this
# script mapped ENVIRONMENT/INTERRUPTED and a stale FAIL to "MAIN: GREEN",
# and scripted.js's own guard only ever checked FAIL-at-this-exact-sha,
# silently treating everything else (missing file, INTERRUPTED, a stale
# sha) the same as a genuine PASS.
#
# Exit codes:
#   0 - GREEN: a positive attestation that origin/main AT THIS EXACT SHA
#       passed (verdict PASS, sha recorded, sha == origin/main's current
#       tip). The only case this script calls green.
#   1 - RED: a positive attestation that origin/main AT THIS EXACT SHA
#       failed (verdict FAIL, sha recorded, sha == origin/main's current
#       tip). The only case this script calls red.
#   2 - UNKNOWN: everything else — no nightly on file, a git/jq failure,
#       missing/invalid JSON, a missing verdict field, an unrecognised
#       verdict, a verdict that by design attests nothing about main
#       (ENVIRONMENT/INTERRUPTED/BLOCKED/DIRTY/ABANDONED/STALE/LEASED —
#       worker.ts's own NON_ATTESTING plus the verdicts it doesn't cover),
#       or a PASS/FAIL recorded for a sha that is NOT origin/main's current
#       tip. A sha mismatch is the routine case, not corruption — it means
#       "unproven for the sha in question", never "broken" and never
#       "clean". This is NOT because nightly runs at most once a day
#       (NIGHTLY_MIN_GAP_MS, nightly.ts, governs only the periodic window
#       path): nightlyDue also re-fires on a main-moved event, rate-limited
#       at just NIGHTLY_MOVE_RATE_LIMIT_MS = 15 minutes, so the nightly
#       runs several times a day in practice — five drives on 2026-09-02
#       alone. A mismatch is routine because proving a freshly-arrived tip
#       still takes time: measured over that day, two of five origin/main
#       tips were superseded before any nightly ever proved them, and the
#       fastest proof took 7 minutes. Never mistake this for green, and
#       never mistake it for red either: a stale FAIL does not mean main
#       is still broken any more than a stale PASS means it is still
#       fine — both are simply unproven for the sha being asked about.
#
# The trigger (#801). A nightly is either `scheduled` — the worker's own
# idle branch, inside its UTC window or on a main-moved event — or
# `manual`: a maintainer ran `npm run bench:nightly-request` because they
# had read the log and believed a red was not the code. A manual run is
# independent of the 20 h window slot (re-measuring one sha must not
# silently cancel that night's window run, so the gap is measured from
# `.scheduledSubmittedAt`) but counts against the 15-minute
# NIGHTLY_MOVE_RATE_LIMIT_MS: it is a live drive like any other. The
# GREEN and RED lines below name the trigger, and the requester when
# there is one, so a human reading the line knows which it was.
#
# The classification table itself does NOT change for a manual run, and
# it cannot: a manual run replaces latest.json only when it ATTESTS —
# PASS or FAIL, at the sha that was requested. ENVIRONMENT, INTERRUPTED,
# STALE and a superseded tip leave the published file byte-identical and
# are recorded under `nightly/manual/` instead, so they never reach this
# script at all. That is why the non-attesting arm keeps every verdict it
# has: the scheduled path can still produce all of them.
#
# Usage: bash scripts/nightly-check.sh
set -euo pipefail

BENCH_DIR="${SPO_BENCH_DIR:-$HOME/.spo-bench}"
NIGHTLY="$BENCH_DIR/nightly/latest.json"

if [ ! -f "$NIGHTLY" ]; then
  echo "MAIN: UNKNOWN no nightly on file — nothing is known about main"
  exit 2
fi

if ! git fetch -q origin main; then
  echo "MAIN: UNKNOWN git fetch origin main failed"
  exit 2
fi

ORIGIN_MAIN="$(git rev-parse origin/main 2>/dev/null)" || {
  echo "MAIN: UNKNOWN git rev-parse origin/main failed"
  exit 2
}

if ! command -v jq >/dev/null 2>&1; then
  echo "MAIN: UNKNOWN jq not installed (apt install jq)"
  exit 2
fi

if ! jq -e . "$NIGHTLY" >/dev/null 2>&1; then
  echo "MAIN: UNKNOWN unreadable or invalid JSON in $NIGHTLY"
  exit 2
fi

VERDICT="$(jq -r '.verdict // empty' "$NIGHTLY")"
SHA="$(jq -r '.sha // empty' "$NIGHTLY")"
DETAIL="$(jq -r '.detail // empty' "$NIGHTLY")"
LOGFILE="$(jq -r '.logFile // empty' "$NIGHTLY")"
FINISHED_AT="$(jq -r '.finishedAt // empty' "$NIGHTLY")"
# Absent means scheduled: every file written before #801 is a scheduled run.
TRIGGER="$(jq -r '.trigger // "scheduled"' "$NIGHTLY")"
REQUESTED_BY="$(jq -r '.requestedBy.user // empty' "$NIGHTLY")"

BY=""
if [ "$TRIGGER" = "manual" ] && [ -n "$REQUESTED_BY" ]; then
  BY=" by=$REQUESTED_BY"
fi

if [ -z "$VERDICT" ]; then
  echo "MAIN: UNKNOWN missing verdict field in $NIGHTLY"
  exit 2
fi

case "$VERDICT" in
  FAIL)
    if [ -n "$SHA" ] && [ "$SHA" = "$ORIGIN_MAIN" ]; then
      echo "MAIN: RED sha=$SHA detail=$DETAIL logFile=$LOGFILE trigger=$TRIGGER$BY"
      exit 1
    else
      # A FAIL recorded for a DIFFERENT sha than origin/main's current tip proves nothing about
      # THIS tip — main may or may not still be broken. Assuming "moved past it, so it's fixed"
      # (the old behaviour) is exactly the unknown-reads-as-green bug this action fixes.
      echo "MAIN: UNKNOWN FAIL recorded for ${SHA:-"(no sha)"}, not origin/main's current tip ($ORIGIN_MAIN) — unproven either way"
      exit 2
    fi
    ;;
  PASS)
    if [ -n "$SHA" ] && [ "$SHA" = "$ORIGIN_MAIN" ]; then
      echo "MAIN: GREEN (PASS $FINISHED_AT, sha=$SHA) trigger=$TRIGGER$BY"
      exit 0
    else
      echo "MAIN: UNKNOWN PASS recorded for ${SHA:-"(no sha)"}, not origin/main's current tip ($ORIGIN_MAIN) — unproven for this tip"
      exit 2
    fi
    ;;
  ENVIRONMENT|INTERRUPTED|BLOCKED|DIRTY|ABANDONED|STALE|LEASED)
    echo "MAIN: UNKNOWN ($VERDICT — the run proved nothing about main)"
    exit 2
    ;;
  *)
    echo "MAIN: UNKNOWN unrecognised verdict $VERDICT"
    exit 2
    ;;
esac
