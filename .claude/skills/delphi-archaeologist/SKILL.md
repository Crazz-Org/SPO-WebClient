---
name: delphi-archaeologist
description: "TRIGGER: When reverse-engineering SPO-Original Delphi source, tracing RDO server handlers, or documenting legacy subsystems. Two modes: Explore (understand) and Document (write formal docs)."
user-invokable: true
disable-model-invocation: false
metadata:
  version: 1.0.0
  codebase-path: ~/SPO-Original  # ../SPO-Original relative to the repo root; NOT from a session worktree
  file-count: 2383
  generation-date: 2026-02-24
---

# Delphi Archaeologist

Reverse-engineer the SPO-Original Delphi 5 codebase efficiently. Two modes: **Explore** (understand) and **Document** (write knowledge base).

## Codebase Root

`~/SPO-Original` — 67 directories, ~1747 .pas, ~256 .dpr, ~380 .dfm. (`../SPO-Original`
relative to the repo root — but **not** from a session worktree, where `..` resolves to
`.claude/worktrees/`, not the repo root.)

## Triggers

| Trigger | Mode | Example |
|---------|------|---------|
| understand / explore / trace / how does X work | Explore | "How does the Interface Server handle client sessions?" |
| document / write docs / knowledge base / spec | Document | "Document the RDO protocol layer for the knowledge base" |
| RDO archaeology / reverse-engineer RDO method | Explore | "Reverse-engineer RDOSetPrice on the Model Server" |
| map dependencies / trace uses | Explore | "What units does Kernel.pas depend on?" |
| legacy client / legacy server / delphi / original client / original server | Explore | "Check the legacy client to see how taxes work" |

## Safety Rules

- **READ ONLY**: Never modify any file in SPO-Original. It is a historical artifact.
- **Evidence required**: Every claim MUST cite `FileName.pas:LineNumber` or be marked `[INFERRED]`.
- **Unknown is valid**: Use `[UNKNOWN]` rather than guessing. Do not fabricate Delphi source.
- **Scope limits**: Max 15 files per investigation, max 4 call-depth levels, max 3 grep retries per pattern.
- **Token budget**: Load resources/ files only when needed. Use sub-agents for deep dives with 5+ files.

## Mode: Explore

**Goal**: Answer "How does X work?" with evidence from the Delphi source.

### Workflow

1. **Scope** — Identify which service/directory is relevant. Consult `resources/service-map.md`.
2. **Entry point** — Find the `.dpr` file or the primary `.pas` unit. Read the `uses` clause to map dependencies.
3. **Surface scan** — Grep for the feature name, class name, or RDO method name across relevant directories only (not the entire codebase).
4. **Interface section** — Read only the `interface` section first (stop at `implementation`). Extract: type hierarchy, published members, property declarations.
5. **Targeted deep dive** — Read `implementation` of specific methods that matter. Use line ranges (first 50 + last 20 for large files, then targeted middle).
5b. **Find the writer** — For every value the client will compare (cache property, ASP field, `KindId`), cite the Pascal that *writes* it — `StoreToCache`, `WriteString`/`WriteInteger`, `KindId :=`, `.Values[Language]` — quote the literal and its type, and say whether it depends on language or a registry. A declaration or a reader is not a writer; if none is found, write `[UNKNOWN]`.
6. **Synthesize** — Write findings with evidence citations. Mark uncertainties.

### Output Format

Emit only sections the question needs — omit sections with no findings. Always include Evidence Chain.

```
## Finding: [Topic]

### Architecture (if tracing service/unit structure)
[High-level description with service/unit relationships]

### Key Types (if types are relevant)
| Type | Unit | Line | Purpose |
|------|------|------|---------|
| [only cited types] | | | |

### Key Methods (if methods are relevant)
| Method | Unit:Line | Signature | Behavior |
|--------|-----------|-----------|----------|
| [only cited methods] | | | |

### RDO Surface (if reverse-engineering RDO members)
| Member | Kind | Verb | Params | Return | Notes |
|--------|------|------|--------|--------|-------|
| [only cited members] | | | | | |

### Evidence Chain (always present)
- [FileName.pas:Line] — [what was observed]
- [INFERRED] — [reasoning]
- [UNKNOWN] — [what could not be determined]
```

**Example — kind/arity lookup (minimal format):**
```
## Finding: RDOSetRatingFrom member type

### RDO Surface
| Member | Kind | Verb | Params | Return | Notes |
|--------|------|------|--------|--------|-------|
| RDOSetRatingFrom | procedure | call | 3 (RatingId: widestring, TycoonId: widestring, Value: integer) | none | bound to the Town Hall |

### Evidence Chain
- Kernel/TownPolitics.pas:40 — `procedure RDOSetRatingFrom( RatingId : widestring; TycoonId : widestring; Value : integer );` declaration (3 params, no result)
- Five/0/Visual/Voyager/Politics/rdoModifyRating.asp:24-27 (SPO-ASP) — the reference client does `BindTo(TownHallId)`, then calls `RDOSetRatingFrom(RatingId, TycoonName, Value)` in that order
```

The declaration lives in the declaring unit (`Kernel/`, `DServer/`, or a Voyager unit), never in
`Rdo/Server/` — that directory is the transport and declares no member. Where the reference
client demonstrably emitted a form, that form wins over the bare declaration (CLAUDE.md § *Two
rules the catalogue does not encode*, rule 2): report a difference as a finding, never as a fix
to a call that works today.

## Mode: Document

**Goal**: Produce formal documentation for `SPO-WebClient/doc/` knowledge base.

### Workflow

1. **Scope** — Define the subsystem boundary using `resources/service-map.md`.
2. **Explore first** — Run Explore mode internally to gather evidence.
3. **Template** — Load `resources/documentation-templates.md` and select the appropriate template.
4. **Draft** — Fill template with findings. Sections are only included if they have evidence.
5. **Cross-reference** — Check existing docs in `SPO-WebClient/doc/` for overlap or conflicts.
6. **User checkpoint** — Present ≤10-line outline (section list + one line each) plus file path; full text written once to disk.

### Output Location

All docs go to `SPO-WebClient/doc/` following existing naming: `kebab-case.md`.

## Anti-Patterns

| Do NOT | Why | Instead |
|--------|-----|---------|
| Grep entire SPO-Original recursively | 2383 files, token explosion | Target specific directories from service-map |
| Read full implementation of 1000+ line files | Token waste | Read interface section, then targeted line ranges |
| Guess RDO method signatures | Wrong types crash the protocol | Follow `resources/rdo-archaeology-checklist.md` |
| Mix evidence from different source versions | `Copy of X.pas`, `X1.pas` exist | Prefer the file referenced in .dpr `uses` clause |
| Load all resources/ files at startup | Wastes context | Load specific resource files on demand |

## Resources (load on demand)

| File | When to load |
|------|-------------|
| `resources/service-map.md` | Always load first — cheap, essential for targeting |
| `resources/delphi-patterns.md` | When searching/navigating Delphi code |
| `resources/documentation-templates.md` | Document mode only |
| `resources/rdo-archaeology-checklist.md` | When reverse-engineering RDO methods |
| `resources/analysis-workflow.md` | Complex multi-file investigations |

## Integration with Existing Docs

| Existing doc | Relationship |
|--------------|-------------|
| `doc/spo-original-reference.md` | Primary RDO member index — new member discoveries go here |
| `doc/facility-tabs-reference.md` | Inspector tab handlers — cross-reference Voyager source |
| `~/SPO-Original/BUILDING_VISUALCLASS_REFERENCE.md` | Visual class catalog (lives in the SPO-Original root, NOT in `doc/`) |

## Sub-Agent Delegation

For investigations spanning 5+ files, delegate to a sub-agent:

```
Task(subagent_type: "general-purpose",
  prompt: "Read these SPO-Original Delphi files and extract [specific info]:
  1. /home/crazz/SPO-Original/Kernel/World.pas — interface section only
  2. /home/crazz/SPO-Original/Kernel/Population.pas — lines 1-80
  Return: type names, published methods, class hierarchy.
  Mark anything uncertain as [INFERRED].")
```
