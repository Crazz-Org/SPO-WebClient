#!/usr/bin/env bash
# npm run board:claim — THE CLAIM READ. Run it ONCE per claim.
#
# Prints the ANSWER § 1 needs, not just the evidence for it: after the raw board dump, a
# `walk:` block replays § 1.2 over every Todo card in board order and names the one it would
# take (`candidates: 1`, or `candidates: none`). `busy areas:`, the blocked set and the item
# lines are still printed — the walk is derived from them, so they stay here to show the work
# and to feed `$ARGUMENTS` lookups and ownership statements — but the caller reads `walk:` /
# `candidates:` and stops there.
#
# One query, paginated by `gh --paginate` and costing ~2 GraphQL points PER PAGE (4 on
# today's 116-item board), everything a claim needs: every card with Status/Session/Area
# in board order (topmost Todo first = priority order), the blocked set, the project/field/
# option ids `item-edit` takes, and the price of asking.
#
# Never read the pool with `gh project item-list` in a session: same data, ~103 points
# (kanban-workflow § GitHub API discipline). That is how the board went unreadable on
# 2026-08-25. The busy set is computed INSIDE this call, never by a second one.
#
# `item …` lines render ONLY for Planning, Implementing, Gate, Validation, Checks & PR,
# Merging and Parked — the open, non-Todo columns, i.e. "who holds ground right now". Todo cards are already carried by
# the `walk:` block with their rank, area and title, so an `item` line for them would be a
# duplicate; and now that `board:take` resolves an item id from the issue number itself,
# the caller never needs an item id for a Todo card either. Done cards own no ground and
# are never a candidate. `$cards` itself stays the FULL fetched set (Done included) so
# `items: N/M` still proves the read was complete; `hidden: N (Done d, Todo t — …)`
# immediately below it accounts for everything now missing from the `item` lines.
#
# The `busy areas:` line IS the busy set (§ One session per area): Planning, Implementing,
# Gate, Validation, Checks & PR or Merging, `docs` excluded because it never blocks. It is
# computed rather than eyeballed off the item
# lines so the rule stays executable; `$cards` is bound once and both outputs read it. A busy
# card only counts while its ground reservation is LIVE, and that is read from the branch's
# last commit date on `origin`: ONE batched GraphQL call covering the whole busy set, issued
# only when that set is non-empty. A branch whose last commit is older than
# SPO_WORKTREE_IDLE_MIN (default 120) holds no ground. If that call fails for any reason the
# affected branches are treated as EXPIRED (free) and a `note:` line says so — the read
# degrades to "more candidates", never hangs.
#
# There was a second, cheaper source here until #441: a per-session heartbeat file stamped by
# .claude/hooks/session-heartbeat.sh. That hook went with the pilot hook layer in #425, so the
# commit date became the only path; the dead reader was removed rather than left to imply a
# liveness signal nothing produces.
#
# The blocked lines: `blockedBy(first: 10) { nodes { state } }` is read into one OPEN-only set
# and BOTH the `#N blocked by …` line and the walk's "blocked" skip render from that same
# bound set — `issueDependenciesSummary.blockedBy` (a separate count) is not consulted, so a
# read-replica lag between the two can no longer print an empty-tailed line one side calls
# blocked and the other does not. The board side now paginates itself; raise
# `issues(first: 100)` if the repository ever exceeds 100 open issues (41 open today).
#
# jq is available (jq 1.7 at /usr/bin/jq, installed 2026-08-26), but gh's own `--jq` runs once
# per page under `--paginate` and so cannot sum rateLimit.cost, dedupe the metadata, or compute
# a busy set across pages — which is why the stream is slurped into one jq program with `-s`.
# That is why the whole claim read is one program over one response, and not a saved file
# filtered twice. The `items: N/M` line proves the read was complete. (The ref-date sidecar is
# a separate, smaller read feeding the same jq program as `--argjson live`; it does not touch
# the board query or its pagination.)
#
#   bash scripts/claim-read.sh
set -euo pipefail

OWNER="Crazz-Org"
REPO="SPO-WebClient"
idle_min="${SPO_WORKTREE_IDLE_MIN:-120}"

raw=$(timeout 90 gh api graphql --paginate -f query='
query($endCursor: String) {
  rateLimit { cost remaining resetAt }
  organization(login: "Crazz-Org") { projectV2(number: 1) {
    id
    fields(first: 20) { nodes {
      ... on ProjectV2FieldCommon { id name }
      ... on ProjectV2SingleSelectField { options { id name } } } }
    items(first: 100, after: $endCursor) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
      id
      content { ... on Issue { number title } }
      fieldValues(first: 12) { nodes {
        ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
        ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } } } } }
  repository(owner: "Crazz-Org", name: "SPO-WebClient") {
    issues(first: 100, states: OPEN) { nodes {
      number
      blockedBy(first: 10) { nodes { number state } } } } }
}')

# Cards, bound once — the FULL fetched set, Done included, so `items: N/M` keeps proving
# completeness. Everything downstream (busy set, walk, item lines) reads this same array.
cards_json=$(jq -s -c '
  [.[] | .data.organization.projectV2.items.nodes[]
    | ([.fieldValues.nodes[] | select(.field != null) | {(.field.name): (.text // .name)}] | add // {})
      + {id: .id, number: (.content.number // 0), title: (.content.title // "")}]
' <<< "$raw")

# Busy-status branches (Planning/Implementing/Gate/Validation/Checks & PR/Merging, area !=
# docs) — every one of them needs the ref-date sidecar (rule F).
busy_branches_json=$(jq -c '
  [.[] | select(.Status == "Planning" or .Status == "Implementing" or .Status == "Gate" or .Status == "Validation" or .Status == "Checks & PR" or .Status == "Merging")
    | select(.Area != null and .Area != "docs")
    | (.Session // "") | split(" @ ")[0] | select(length > 0)]
  | unique
' <<< "$cards_json")

# `<branch> -> LIVE|EXPIRED` for every busy branch; empty when no branch is busy.
live_json='{}'
if [ "$(jq 'length' <<< "$busy_branches_json")" -gt 0 ]; then
  query="{ repository(owner: \"$OWNER\", name: \"$REPO\") {"
  i=0
  while IFS= read -r b; do
    query+=" b$i: ref(qualifiedName: \"refs/heads/$b\") { target { ... on Commit { committedDate } } }"
    i=$((i + 1))
  done < <(jq -r '.[]' <<< "$busy_branches_json")
  query+=" } }"

  if refraw=$(timeout 30 gh api graphql -f query="$query" 2>/dev/null); then
    live_json=$(jq -c --argjson branches "$busy_branches_json" --argjson idle_min_sec "$((idle_min * 60))" --arg now "$(date -u +%s)" '
      ($now | tonumber) as $now
      | .data.repository as $r
      | [range(0; ($branches | length))]
      | map({key: $branches[.], value: (
          $r["b\(.)"].target.committedDate as $d
          | if $d == null then "EXPIRED"
            elif ($now - ($d | fromdateiso8601)) < $idle_min_sec then "LIVE"
            else "EXPIRED" end) })
      | from_entries
    ' <<< "$refraw")
    ref_note=""
  else
    n=$(jq 'length' <<< "$busy_branches_json")
    ref_note="note: ref-date lookup failed, $n branches treated as free"
    live_json=$(jq -c '[.[] | {key: ., value: "EXPIRED"}] | from_entries' <<< "$busy_branches_json")
  fi
else
  ref_note=""
fi

# `raw` is a concatenation of one JSON object per page; every page carries the full
# `repository` block identically, so flatten+dedupe across pages is correct either way.
blocked_json=$(jq -s -c '[.[] | .data.repository.issues.nodes // empty] | flatten | unique_by(.number)' <<< "$raw")

total_json=$(jq -s -c '.[0].data.organization.projectV2.items.totalCount' <<< "$raw")
ratelimit_json=$(jq -s -c '{cost: ([.[] | .data.rateLimit.cost] | add), remaining: .[-1].data.rateLimit.remaining, resetAt: .[-1].data.rateLimit.resetAt}' <<< "$raw")
meta_json=$(jq -s -c '{projectId: .[0].data.organization.projectV2.id, fields: .[0].data.organization.projectV2.fields.nodes}' <<< "$raw")

# A single argv string is capped at 128 KiB by the kernel (MAX_ARG_STRLEN): anything that grows
# with the board goes in via `--slurpfile <(…)` (a file descriptor), never `--argjson`.
jq -n -r \
  --slurpfile cards_in <(printf '%s' "$cards_json") \
  --argjson total "$total_json" \
  --argjson rl "$ratelimit_json" \
  --argjson meta "$meta_json" \
  --slurpfile issues_in <(printf '%s' "$blocked_json") \
  --argjson live "$live_json" \
  --arg ref_note "$ref_note" '
  $cards_in[0] as $cards | $issues_in[0] as $issues
  | if ($cards | length) != ($total // -1)
    then error(if $total == null
               then "claim read: gh returned no usable response"
               else "claim read incomplete: \($cards | length) of \($total) items" end)
    else . end
  # The blocked set, bound ONCE from the rendered OPEN nodes — never from the (possibly
  # lagging) issueDependenciesSummary count. The `#N blocked by …` line and the walk both
  # read this same object, so they can never disagree.
  | ([$issues[]
      | {number, openBy: [.blockedBy.nodes[] | select(.state == "OPEN") | .number]}
      | select(.openBy | length > 0)]) as $blockedIssues
  | ($blockedIssues | map({(.number | tostring): .openBy}) | add // {}) as $blockedMap
  | ([$cards[]
      | select(.Status == "Planning" or .Status == "Implementing" or .Status == "Gate" or .Status == "Validation" or .Status == "Checks & PR" or .Status == "Merging")
      | select(.Area != null and .Area != "docs")
      # `split` on an EMPTY string returns [], so `[0]` is null and `$live[null]` is a
      # hard jq error — "Cannot index object with null" — that kills the whole claim read for
      # every session. An empty `Session` in a busy column is not a corrupt state: it is
      # exactly what the human release of an orphaned card produces (§ The ownership law,
      # law 3), in the window before the card is re-taken or moved back to Todo. A card
      # nobody owns reserves no ground, so it must simply not be busy.
      | select(((((.Session // "") | split(" @ ")[0]) // "") | length) > 0)
      | select((($live[((.Session // "") | split(" @ ")[0])]) // "EXPIRED") == "LIVE")
      | .Area] | unique) as $busy
  | (reduce ($cards[] | select(.Status == "Todo")) as $c
      ({rank: 0, lines: []};
        ($c.Session // "") as $sess
        | (($blockedMap[($c.number | tostring)] // [])) as $blockers
        | if ($sess != "") then
            .lines += ["  skip #\($c.number): owned by \($sess)"]
          elif ($blockers | length) > 0 then
            .lines += ["  skip #\($c.number): blocked by \([$blockers[] | "#\(.)"] | join(", "))"]
          elif ($c.Area != null and $c.Area != "" and (($busy | index($c.Area)) != null)) then
            .lines += ["  skip #\($c.number): area \($c.Area) busy"]
          else
            (.rank + 1) as $r
            | {rank: $r, lines: (.lines + ["  \($r) #\($c.number) area=\($c.Area // "-") \($c.title)"])}
          end)
    ) as $walk
  | ("rateLimit: cost \($rl.cost), remaining \($rl.remaining), resets \($rl.resetAt)"),
    ("items: \($cards | length)/\($total)"),
    ("hidden: \([$cards[] | select(.Status != "Planning" and .Status != "Implementing" and .Status != "Gate" and .Status != "Validation" and .Status != "Checks & PR" and .Status != "Merging" and .Status != "Parked")] | length) (Done \([$cards[] | select(.Status == "Done")] | length), Todo \([$cards[] | select(.Status == "Todo")] | length) — Todo cards are in the walk)"),
    ("busy areas: \($busy | join(" "))"),
    (if ($ref_note | length) > 0 then $ref_note else empty end),
    "walk:",
    ($walk.lines[]),
    ("candidates: \(if $walk.rank == 0 then "none" else ($walk.rank | tostring) end)"),
    ("projectId: \($meta.projectId)"),
    ($meta.fields[]
      | select(.name == "Status" or .name == "Session" or .name == "Area")
      | "field \(.name): \(.id)\(if .options then " " + ([.options[] | "\(.name)=\(.id)"] | join(" ")) else "" end)"),
    ($cards[]
      | select(.Status == "Planning" or .Status == "Implementing" or .Status == "Gate" or .Status == "Validation" or .Status == "Checks & PR" or .Status == "Merging" or .Status == "Parked")
      | "item \(.id) #\(.number) [\(.Status // "-")] area=\(.Area // "-") session=\(.Session // "-") \(.title)"),
    ($blockedIssues[]
      | "#\(.number) blocked by \([.openBy[] | "#\(.)"] | join(", "))")
'
