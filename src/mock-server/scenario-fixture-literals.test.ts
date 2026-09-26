/**
 * Every scenario fixture spells its expected RDO request as a string literal.
 *
 * The strict validator reads the separator and the argument count of each
 * exchange's `request` and checks them against the catalogue. A request built
 * with the production emitter (`rdo-frame.ts`) derives both from that same
 * catalogue, so the check would compare the catalogue with itself and a wrong
 * entry would pass. The literal is copied from the frame production emits in
 * the scenario's sibling test (QueryId stripped) — see "Adding a New Scenario"
 * in `src/mock-server/CLAUDE.md`.
 *
 * This sweep reads the raw text of every non-test scenario file and fails on
 * any import of the emitter or any call to one of its builders.
 *
 * Lives beside `scenarios/`, not inside it: `substrate-discipline.test.ts`
 * requires every test under `scenarios/` to load a scenario factory.
 */

import * as fs from 'fs';
import * as path from 'path';

const SCENARIOS_DIR = path.join(__dirname, 'scenarios');

/** An import naming one of the builders, from any path ending in `rdo-frame`. */
const EMITTER_IMPORT_RE =
  /import\s*(?:type\s*)?\{[^}]*\b(?:rdoCall|rdoGet|rdoSet|rdoIdOf)\b[^}]*\}\s*from\s*['"][^'"]*rdo-frame['"]/;

/** A call to one of the builders, or to the `RdoCommand` builder they delegate to. */
const EMITTER_CALL_RE = /\b(?:rdoCall|rdoGet|rdoSet|rdoIdOf)\s*\(|\bRdoCommand\s*\./;

function isOffending(text: string): boolean {
  return EMITTER_IMPORT_RE.test(text) || EMITTER_CALL_RE.test(text);
}

function scenarioSourceFiles(): string[] {
  return fs
    .readdirSync(SCENARIOS_DIR)
    .filter(f => f.endsWith('.ts') && !/\.test\.tsx?$/.test(f))
    .sort();
}

describe('scenario fixtures spell their requests as literals', () => {
  describe('the scanner', () => {
    it.each([
      "request: rdoCall('X', 1).toFrame()",
      "import { rdoGet } from '@/shared/rdo-frame';",
      "import { rdoCall } from '../../shared/rdo-frame';",
      "RdoCommand.sel('1')",
    ])('flags %s', (text) => {
      expect(isOffending(text)).toBe(true);
    });

    it('flags an emitter import split across lines', () => {
      expect(EMITTER_IMPORT_RE.test("import {\n  RdoValue,\n  rdoSet,\n} from '@/shared/rdo-frame';")).toBe(true);
    });

    it.each([
      '`C sel 1 call X "*" "#1";`',
      'buildRdoCommandArgs(member, value)',
      "import { RdoValue } from '@/shared/rdo-types';",
      '"rdoSetAdvanceLevel.asp?TycoonId=1"',
    ])('leaves %s alone', (text) => {
      expect(isOffending(text)).toBe(false);
    });
  });

  it('reads the real scenario directory', () => {
    expect(scenarioSourceFiles().length).toBeGreaterThan(30);
  });

  it('no scenario file imports or calls the emitter', () => {
    const offenders: string[] = [];
    for (const file of scenarioSourceFiles()) {
      const text = fs.readFileSync(path.join(SCENARIOS_DIR, file), 'utf8');
      const importMatch = EMITTER_IMPORT_RE.exec(text);
      if (importMatch) {
        const line = text.slice(0, importMatch.index).split('\n').length;
        offenders.push(`${file}:${line}: ${importMatch[0].replace(/\s+/g, ' ')}`);
      }
      text.split('\n').forEach((lineText, i) => {
        if (EMITTER_CALL_RE.test(lineText)) offenders.push(`${file}:${i + 1}: ${lineText.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
