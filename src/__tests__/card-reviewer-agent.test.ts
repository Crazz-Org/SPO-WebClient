/**
 * The neutral reader of a backlog card (#150) is a prompt, not a program: nothing in the
 * Jest suite executes it, and no workflow can observe whether a live session actually
 * spawned it before running `gh issue create` — that moment happens on a developer machine.
 *
 * What CAN be held is everything else, and #123 is the reason to hold it: a rule that lives
 * only in prose is protected by nothing. So this file pins the same way
 * `claude-review-workflow.test.ts` pins the PR reviewer — the properties that make the
 * mechanism the thing #150 asked for, each one a single edit away from being lost and none
 * of them visible in a diff review of one file alone.
 *
 * Two invariants matter more than the rest:
 *
 *   - **Read-only.** The reviewer must never file, comment or edit. A reviewer that writes
 *     to the board is a second author, and the card is back to having one reader.
 *   - **The four surfaces stay consistent.** The agent, the rulebook, the `/triage-report`
 *     command and CLAUDE.md all have to name the mechanism, or a session reading any one of
 *     them is following a rule the others no longer carry. Gut any of the four and this
 *     test — inside the required `typecheck + tests` check — goes red.
 *
 * Deciding the review is not worth its cost is a legitimate decision. It just has to be
 * made here as well as in the agent file, which is the point of pinning it.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const AGENT = path.join(ROOT, '.claude', 'agents', 'card-reviewer.md');
const RULEBOOK = path.join(ROOT, 'doc', 'kanban-workflow.md');
const TRIAGE_COMMAND = path.join(ROOT, '.claude', 'commands', 'triage-report.md');
const CLAUDE_MD = path.join(ROOT, 'CLAUDE.md');

let agent: string;
let frontmatter: string;
let rulebook: string;
let triageCommand: string;
let claudeMd: string;

/**
 * Prose in these files is hard-wrapped at ~95 columns, so a sentence assertion written
 * against the reading order breaks the day a word crosses the margin. Every assertion about
 * a *sentence* runs against the collapsed copy; the ones about *structure* (frontmatter
 * keys, table rows, headings) keep the newlines they depend on.
 */
const collapse = (text: string): string => text.replace(/\s+/g, ' ');

beforeAll(() => {
  agent = fs.readFileSync(AGENT, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(agent);
  frontmatter = match ? match[1] : '';
  rulebook = fs.readFileSync(RULEBOOK, 'utf8');
  triageCommand = fs.readFileSync(TRIAGE_COMMAND, 'utf8');
  claudeMd = fs.readFileSync(CLAUDE_MD, 'utf8');
});

describe('card-reviewer agent', () => {
  describe('frontmatter', () => {
    it('opens with a frontmatter block, like the other agents in the directory', () => {
      expect(frontmatter).not.toBe('');
    });

    it('is registered under the name the rulebook and the command call it', () => {
      expect(frontmatter).toMatch(/^name: card-reviewer$/m);
    });

    it('describes itself as read-only', () => {
      const description = /^description: (.+)$/m.exec(frontmatter);
      expect(description).not.toBeNull();
      expect(description?.[1]).toMatch(/[Rr]ead-only/);
    });

    it('holds only reading tools', () => {
      // The tool line IS the read-only invariant — the prose below it is a promise, this is
      // the constraint. Adding Edit or Write here turns the reviewer into a second author.
      const tools = /^tools: (.+)$/m.exec(frontmatter);
      expect(tools).not.toBeNull();
      const granted = (tools?.[1] ?? '').split(',').map(t => t.trim());
      expect(granted).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob']));
      for (const forbidden of ['Edit', 'Write', 'NotebookEdit']) {
        expect(granted).not.toContain(forbidden);
      }
    });

    it('routes to the model CLAUDE.md sends analysis to', () => {
      // A card review is analysis, so § Model routing says Fable 5 — the same reasoning
      // claude-review.yml records for `--model claude-fable-5`.
      expect(frontmatter).toMatch(/^model: fable$/m);
    });
  });

  describe('the four checks #150 asked for', () => {
    const checks: ReadonlyArray<readonly [string, RegExp]> = [
      ['the claim holds against the code', /Does the claim hold against the code\?/],
      ['it is not already covered', /Is it already covered\?/],
      ['it is actionable as written', /Is it actionable as written\?/],
      ['the weight is right and the ground is named', /Is the weight right, and the ground named\?/],
    ];

    it.each(checks)('names the check that %s', (_label, pattern) => {
      expect(agent).toMatch(pattern);
    });

    it('requires a file:line or an explicit reason there can be none', () => {
      expect(collapse(agent)).toMatch(/at least one `file:line` reference, or an explicit reason/);
    });

    it('requires the card to state what done looks like', () => {
      expect(collapse(agent)).toMatch(/what \*\*done\*\* looks like/);
    });

    // The audit's C21-C23: cards filed on the wrong repo, with a "done" only a PR body or a
    // live read could show, against a scoped CLAUDE.md, or narrower than their own title.
    describe('check 3 reads the criterion against where it has to land', () => {
      const check3 = (): string => {
        const start = agent.indexOf('### 3 · Is it actionable as written?');
        const end = agent.indexOf('### 4 ·');
        return collapse(agent.slice(start, end));
      };

      it('sends a card whose ground truth is in SPO-Pipeline or SPO-Deploy away', () => {
        expect(check3()).toMatch(
          /\*\*Ground truth in this repo\.\*\* If the cited files or behaviour live in SPO-Pipeline \(`orchestrator\/\*\.js`, `bin\/spo`, `prompts\/`\) or SPO-Deploy → `DO NOT FILE`, naming the tracker to refile on/
        );
      });

      it('amends a done clause a diff cannot satisfy', () => {
        expect(check3()).toMatch(
          /\*\*Satisfiable by a diff\.\*\* A "done" clause that needs a PR-body sentence, an issue comment, a live measurement or a maintainer reply → `FILE AMENDED`/
        );
      });

      it('amends a criterion that contradicts the scoped CLAUDE.md', () => {
        const text = check3();
        expect(text).toMatch(/\*\*Not against a scoped rule\.\*\* Open the `CLAUDE\.md` of the card's Area/);
        expect(text).toMatch(/grep it for the criterion's verb; a contradiction → `FILE AMENDED` naming the rule/);
      });

      it('makes the reviewer name every case the title covers and the criterion does not', () => {
        const text = check3();
        expect(text).toMatch(/\*\*Title and criterion promise the same set\.\*\* Name any case the title covers and the criterion does not/);
        expect(text).toMatch(/A criterion names the shared helper or a bound, never a formatting literal/);
      });

      it('adds no fifth verdict', () => {
        const verdictRows = agent.match(/^\| `(?:FILE|FILE AMENDED|DO NOT FILE)` \|/gm) ?? [];
        expect(verdictRows).toHaveLength(3);
        expect(agent).toMatch(/## Your verdict — one of three/);
      });
    });

    it('names both weight fields, which feed the human priority order', () => {
      expect(agent).toMatch(/`Category`/);
      expect(agent).toMatch(/`Size`/);
    });

    // #236: Area is the one field on a card that another session's claim depends on, and
    // nothing else checks it — no workflow sets it, and the orchestrator only fills it after the
    // claim. A card filed without one reserves no ground while looking like any other.
    it('receives Area alongside the two weight fields', () => {
      expect(collapse(agent)).toMatch(
        /as the session intends to file it\*\*: title, body, `Category`, `Size`, `Area`/
      );
    });

    it('treats a missing Area as a correction, not as a detail', () => {
      const text = collapse(agent);
      expect(text).toMatch(/an `Area` that is \*\*missing\*\*/);
      expect(text).toMatch(/is a correction like any other/);
    });

    it('says why an empty Area costs something — it reserves no ground', () => {
      const text = collapse(agent);
      expect(text).toMatch(/\*\*empty\*\* `Area` blocks nothing/);
      expect(text).toMatch(/two tasks can stand on the same tree/);
    });

    it('sends the reviewer to the partition, and forbids "none of them fits"', () => {
      const text = collapse(agent);
      expect(text).toMatch(/rows of `doc\/kanban-workflow\.md` § The areas/);
      expect(text).toMatch(/"none of them fits" is never the answer/);
    });

    it('carries Area into the report block, so the verdict states it', () => {
      expect(agent).toMatch(
        /- \*\*Weight and ground\*\* — <`Category` \/ `Size` \/ `Area`, kept or corrected/
      );
    });

    it('sends an RDO claim to the declaring unit, not to the finding aid', () => {
      // Rdo/Server/ is the transport and holds no member declaration (CLAUDE.md § Adding or
      // changing a member); the declaration lives in Kernel/, DServer/ or the Voyager unit.
      const text = collapse(agent);
      expect(text).toMatch(/\*\*declaring unit\*\*/);
      expect(text).toMatch(/`Kernel\/` \(`Kernel\/TownPolitics\.pas:40`/);
      expect(text).toMatch(/`DServer\/` for the directory server/);
      expect(text).toMatch(/the Voyager unit/);
      expect(text).toMatch(/`Rdo\/Server\/` is the \*\*transport\*\*: it holds no member declaration/);
      expect(text).not.toMatch(/declaration in (?:the )?[^.]{0,40}Rdo\/Server/);
      expect(agent).toMatch(/never probe the live server|never treat `doc\/spo-original-reference\.md`/);
    });

    it('keeps a separator the reference client emitted over the bare declaration', () => {
      expect(collapse(agent)).toMatch(
        /a card that would "correct" a separator the client emits today from the declaration alone does not hold/
      );
    });
  });

  describe('the verdict contract', () => {
    const verdicts = ['FILE', 'FILE AMENDED', 'DO NOT FILE'] as const;

    it.each(verdicts)('offers the verdict %s', verdict => {
      expect(agent).toContain(verdict);
    });

    it('dates the verdict, since every comment posts as the same account', () => {
      expect(agent).toMatch(/### Card review — <YYYY-MM-DD>/);
    });

    it('makes FILE AMENDED name the corrections instead of asking for more detail', () => {
      expect(collapse(agent)).toMatch(/"Needs more detail" is not a correction/);
    });

    it('keeps DO NOT FILE about the finding, never about priority', () => {
      expect(collapse(agent)).toMatch(/\*\*priority is the human's\*\*/);
    });

    it('licenses an unchanged FILE, so the reviewer does not invent objections', () => {
      expect(collapse(agent)).toMatch(/\*\*expected outcome on most cards\*\*/);
      expect(collapse(agent)).toMatch(/inventing an objection to look useful/);
    });
  });

  describe('it files nothing itself', () => {
    it('forbids every board-writing command by name', () => {
      const forbidden = ['gh issue create', 'gh issue comment', 'gh issue edit', 'gh project item-'];
      for (const cmd of forbidden) {
        expect(collapse(agent)).toMatch(new RegExp(`Never file anything.{0,400}${cmd}`));
      }
    });

    it('states that the session, not the reviewer, posts the verdict', () => {
      expect(collapse(agent)).toMatch(/You return text; the session posts it/);
    });
  });
});

describe('the mechanism is named on all five surfaces', () => {
  it('sits in the rulebook, inside the feeding rule it amends', () => {
    const feeding = rulebook.indexOf('## Feeding rule');
    const next = rulebook.indexOf('## Context discipline');
    expect(feeding).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(feeding);
    const section = rulebook.slice(feeding, next);
    expect(section).toMatch(/### The card review/);
    expect(section).toMatch(/card-reviewer/);
  });

  it('states in the rulebook that the verdict is the card first comment', () => {
    expect(collapse(rulebook)).toMatch(/verbatim as the card's first comment/);
  });

  it('leaves the claim handshake and the human out of it', () => {
    // The constraint from #150: the path a session already follows is unchanged in shape.
    expect(collapse(rulebook)).toMatch(/The claim handshake is untouched\. No human step is added\./);
    expect(collapse(rulebook)).toMatch(/No session ever waits on another session's review/);
  });

  it('is in the /triage-report command, which files the most cards of any surface', () => {
    expect(triageCommand).toMatch(/`card-reviewer`/);
    for (const verdict of ['FILE', 'FILE AMENDED', 'DO NOT FILE']) {
      expect(triageCommand).toContain(verdict);
    }
    expect(collapse(triageCommand)).toMatch(
      /posted verbatim as the card's first comment, dated/
    );
  });

  it('is in the CLAUDE.md sub-agents table', () => {
    expect(claudeMd).toMatch(/\|\s*`card-reviewer`\s*\|\s*Fable\s*\|/);
  });

  it('says in CLAUDE.md that a card landing under .claude/ is maintainer-only', () => {
    expect(collapse(claudeMd)).toMatch(
      /The pipeline harness refuses writes under `\.claude\/`; a card whose change must land there is maintainer-only and says so in its body/
    );
  });

  it('is in the feeding rule', () => {
    expect(collapse(rulebook)).toMatch(/Every draft card is read first by the `card-reviewer` sub-agent/);
  });

  it('says that the review covers Area, where the filer reads its job', () => {
    // The three fields no workflow sets are named two sentences earlier; the sentence that
    // sends the draft to the reviewer has to reach them, or the check is invisible to the filer.
    const text = collapse(rulebook);
    expect(text).toMatch(/`Category`, `Size` and `Area`; those stay the filer's job/);
    expect(text).toMatch(/which checks those three fields too, `Area` included/);
  });

  it('says in the rulebook why Area is checked at filing time and not later', () => {
    const feeding = rulebook.indexOf('## Feeding rule');
    const next = rulebook.indexOf('## Context discipline');
    const section = collapse(rulebook.slice(feeding, next));
    expect(section).toMatch(/\*\*`Area` is checked here because nothing else checks it\.\*\*/);
    expect(section).toMatch(/the orchestrator only fills it \*after\* a claim/);
  });
});
