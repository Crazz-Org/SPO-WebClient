/**
 * The delegated semantic reviewer of a finished change (#314) is a prompt, not a program:
 * nothing in the Jest suite executes it, and no workflow can observe whether a live session
 * actually spawned it before merging — that moment happens on a developer machine, the way
 * `card-reviewer-agent.test.ts` already pins for the card reviewer.
 *
 * What CAN be held is everything else: the read-only tool set, the three verdicts, the two
 * axes, the forbidden categories, the filing boundary, the model/escalation rule, and that
 * the three surfaces — the agent file, `CLAUDE.md`, `doc/kanban-workflow.md` —
 * all name the mechanism the same way. A rule that lives only in prose is protected by
 * nothing (#123), so this file pins it the same way the card-reviewer's own pin does.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const AGENT = path.join(ROOT, '.claude', 'agents', 'change-validator.md');
const RULEBOOK = path.join(ROOT, 'doc', 'kanban-workflow.md');
const CLAUDE_MD = path.join(ROOT, 'CLAUDE.md');

let agent: string;
let frontmatter: string;
let rulebook: string;
let claudeMd: string;

/**
 * Prose in these files is hard-wrapped at ~95 columns, so a sentence assertion written
 * against the reading order breaks the day a word crosses the margin. Every assertion about
 * a *sentence* runs against the collapsed copy; the ones about *structure* (frontmatter keys,
 * table rows, headings) keep the newlines they depend on.
 */
const collapse = (text: string): string => text.replace(/\s+/g, ' ');

beforeAll(() => {
  agent = fs.readFileSync(AGENT, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(agent);
  frontmatter = match ? match[1] : '';
  rulebook = fs.readFileSync(RULEBOOK, 'utf8');
  claudeMd = fs.readFileSync(CLAUDE_MD, 'utf8');
});

describe('change-validator agent', () => {
  describe('frontmatter', () => {
    it('opens with a frontmatter block, like the other agents in the directory', () => {
      expect(frontmatter).not.toBe('');
    });

    it('is registered under the name the rulebook and the command call it', () => {
      expect(frontmatter).toMatch(/^name: change-validator$/m);
    });

    it('describes itself as read-only', () => {
      const description = /^description: (.+)$/m.exec(frontmatter);
      expect(description).not.toBeNull();
      expect(description?.[1]).toMatch(/[Rr]ead-only/);
    });

    it('holds only reading tools', () => {
      // The tool line IS the read-only invariant — the prose below it is a promise, this is
      // the constraint. Adding Edit or Write here turns the validator into an author.
      const tools = /^tools: (.+)$/m.exec(frontmatter);
      expect(tools).not.toBeNull();
      const granted = (tools?.[1] ?? '').split(',').map(t => t.trim());
      expect(granted).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash']));
      for (const forbidden of ['Edit', 'Write', 'NotebookEdit']) {
        expect(granted).not.toContain(forbidden);
      }
    });

    it('routes to the model CLAUDE.md sends analysis to, by default', () => {
      expect(frontmatter).toMatch(/^model: fable$/m);
    });
  });

  describe('the two axes it judges', () => {
    it('names adequacy to the goal', () => {
      expect(agent).toMatch(/Adequacy to the goal/);
      expect(collapse(agent)).toMatch(
        /No workaround, no subset of the scope, no test written to ratify the code/
      );
    });

    it('names coherence of integration', () => {
      expect(agent).toMatch(/Coherence of integration/);
    });
  });

  describe('the forbidden categories', () => {
    it('forbids hunting bugs, checking tests pass, and re-deriving behaviour', () => {
      const text = collapse(agent);
      expect(text).toMatch(/\*\*Do not hunt bugs\.\*\*/);
      expect(text).toMatch(/\*\*Do not check that tests pass\.\*\*/);
      expect(text).toMatch(/\*\*Do not re-derive behaviour\.\*\*/);
    });
  });

  describe('the proof axis', () => {
    it('opens every Proof flows entry in src/e2e/flows.ts and REJECTs one that asserts only no error', () => {
      const text = collapse(agent);
      expect(agent).toMatch(/### 3 · Proof/);
      expect(text).toMatch(/`Proof flows:`.{0,200}src\/e2e\/flows\.ts/);
      expect(text).toMatch(/A demanded proof flow whose checks assert only that no error occurred is `REJECT`/);
    });

    it('REJECTs a live-run clause the gate did not drive, and precedent never waives it', () => {
      const text = collapse(agent);
      expect(text).toMatch(/Asked for and not driven: `REJECT`, never `PASS` and never `PASS WITH FINDINGS`/);
      expect(text).toMatch(/\*\*Precedent is not a reason\*\*/);
      expect(text).toMatch(/`"live"`/);
    });
  });

  describe('the verdict contract', () => {
    const verdicts = ['PASS', 'PASS WITH FINDINGS', 'REJECT'] as const;

    it.each(verdicts)('offers the verdict %s', verdict => {
      expect(agent).toContain(verdict);
    });

    it('dates the verdict, since every comment posts as the same account', () => {
      expect(agent).toMatch(/### Change validation — <YYYY-MM-DD>/);
    });

    it('gives REJECT its own budget, separate from the implementation attempts', () => {
      const text = collapse(agent);
      expect(text).toMatch(/own budget of 3\*\*, separate from the implementation attempts/);
      expect(text).toMatch(/never taste, never style/);
    });

    it('makes PASS WITH FINDINGS non-blocking', () => {
      const text = collapse(agent);
      expect(text).toMatch(/PASS WITH FINDINGS.{0,80}The orchestrator still proceeds/);
    });
  });

  describe('the filing boundary', () => {
    it('never opens an issue itself', () => {
      expect(collapse(agent)).toMatch(/\*\*You never open an issue\.\*\*/);
    });

    it('routes findings to card-reviewer exactly as every other draft', () => {
      expect(collapse(agent)).toMatch(
        /the orchestrator routes it to `card-reviewer` exactly as every other draft is/
      );
    });

    it('says DO NOT FILE creates nothing', () => {
      expect(collapse(agent)).toMatch(/`DO NOT FILE` creates nothing/);
    });

    it('bounds a finding to ground the diff touched', () => {
      const text = collapse(agent);
      expect(text).toMatch(/\*\*ground the diff touched\*\*/);
      expect(text).toMatch(/a modified file, or a direct caller of a modified function/);
      expect(text).toMatch(/Stay on the claimed card/);
    });
  });

  describe('the model and escalation rule', () => {
    it('routes to Fable 5 at effort high regardless of Size', () => {
      const text = collapse(agent);
      expect(text).toMatch(/effort high regardless of the card's `Size`/);
    });

    it('escalates to Opus 5 under the wire rule and as the fallback when Fable is unavailable', () => {
      const text = collapse(agent);
      expect(text).toMatch(/src\/shared\/rdo-\*.{0,40}src\/server\/rdo\.ts.{0,40}rdo-members\.ts/);
      expect(text).toMatch(/as the fallback when Fable is unavailable/);
    });

    it('never routes to Sonnet 5, naming why', () => {
      const text = collapse(agent);
      expect(text).toMatch(/\*\*Never Sonnet 5\*\*/);
      expect(text).toMatch(/a same-model judge ratifies/);
    });
  });

  describe('it files nothing itself', () => {
    it('forbids every board-writing command by name', () => {
      const forbidden = ['gh issue create', 'gh issue comment', 'gh issue edit', 'gh project item-'];
      for (const cmd of forbidden) {
        expect(collapse(agent)).toMatch(new RegExp(`Never file anything.{0,400}${cmd}`));
      }
    });

    it('states that the orchestrator, not the validator, routes the verdict onward', () => {
      expect(collapse(agent)).toMatch(/You return text; the orchestrator routes it to `card-reviewer`/);
    });
  });
});

describe('the mechanism is named on all four surfaces', () => {
  it('sits in the rulebook, inside the feeding rule it amends', () => {
    const feeding = rulebook.indexOf('## Feeding rule');
    const next = rulebook.indexOf('## Context discipline');
    expect(feeding).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(feeding);
    const section = rulebook.slice(feeding, next);
    expect(section).toMatch(/change-validator/);
    expect(section).toMatch(/PASS WITH FINDINGS/);
  });

  it('is inside the feeding rule list before "and by nothing else"', () => {
    const rule = rulebook.slice(rulebook.indexOf('## Feeding rule'));
    const listEnd = rule.indexOf('and by nothing');
    expect(listEnd).toBeGreaterThan(-1);
    expect(rule.slice(0, listEnd)).toContain('change-validator');
  });

  it('has its own row in the board column table, between Gate and Merging', () => {
    const table = rulebook.split('\n');
    const gateIdx = table.findIndex(l => l.startsWith('| 🧪 **Gate**'));
    const validationIdx = table.findIndex(l => l.startsWith('| 🔍 **Validation**'));
    const mergingIdx = table.findIndex(l => l.startsWith('| 🔀 **Merging**'));
    expect(gateIdx).toBeGreaterThan(-1);
    expect(validationIdx).toBe(gateIdx + 1);
    expect(mergingIdx).toBe(validationIdx + 1);
  });

  it('names ten columns in the rulebook, in both its heading and its short form', () => {
    expect(rulebook).toMatch(/## The board — ten columns/);
    expect(rulebook).toMatch(
      /ten columns \(Intake · Todo ·\s+Planning · Implementing · Checks & PR · Gate · Validation · Merging · Done · Parked\)/
    );
  });

  it('carries the UI-only warning for the new Status option', () => {
    const text = collapse(rulebook);
    expect(text).toMatch(/A new column must be appended to the `Status` field in the UI/);
    expect(text).toMatch(/Rebuilding regenerates every option id/);
  });

  it('has its routing owned by the orchestrator, not restated as prose here', () => {
    // The per-step model/effort table moved to SPO-Pipeline's step-contracts.js — a copy in
    // this rulebook could only drift away from the thing that actually spawns the models.
    const text = collapse(rulebook);
    expect(text).toMatch(/SPO-Pipeline `orchestrator\/step-contracts\.js`/);
    expect(text).toMatch(/`doc\/state-machine-spec\.md` § Step contracts/);
  });

  it('board:move needs no code change — it resolves a column by name', () => {
    expect(collapse(rulebook)).toMatch(
      /`board-move\.sh` resolves a column by name against the `Status` field's own options, so it works the moment the option exists/
    );
  });

  it('is in the CLAUDE.md sub-agents table', () => {
    expect(claudeMd).toMatch(/\|\s*`change-validator`\s*\|\s*Fable\s*\|/);
  });

  it('is in the filing-route sentence, bounded to ground the diff touched', () => {
    const text = collapse(rulebook);
    expect(text).toMatch(/a `PASS WITH FINDINGS` verdict from the `change-validator` sub-agent/);
    expect(text).toMatch(/bounded to ground the diff touched/);
  });
});
