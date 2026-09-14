/**
 * scripts/check-rdo-citation.js — the deterministic implementation of
 * .claude/agents/citation-verifier.md's "Parameter counting" and kind/accessor-determination
 * algorithm, run against the real `~/SPO-Original` reference tree.
 *
 * Mirrors the require()-a-plain-script pattern of check-pr-rules.test.ts: the script under
 * test is plain CommonJS, matching this repo's other scripts/*.js convention.
 *
 * The reference-tree-dependent tests are guarded: if `~/SPO-Original` (or
 * `SPO_ORIGINAL_DIR`) is not present on disk — e.g. a CI checkout without it — they skip with
 * a clearly stated reason rather than failing as though the tree had diverged.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface Declaration {
  kind: 'function' | 'procedure' | 'accessor';
  name: string;
  arity?: number;
  paramNames?: string[];
  access?: ('get' | 'set')[];
  startLine: number;
  endLine: number;
  raw: string;
}

interface CitationResult {
  verdict: string;
  ok: boolean;
  found?: Declaration | null;
  detail?: string;
}

interface EntryResult {
  name: string;
  overallVerdict: string;
  ok: boolean;
  perCitation: (CitationResult & { file: string; line: number })[];
}

interface CheckRdoCitationModule {
  resolveReferenceRoot(): string;
  referenceRootExists(root?: string): boolean;
  resolvePasPath(file: string, root?: string): string;
  readPasFile(file: string, root?: string): string;
  maskInert(text: string): string;
  splitTopLevel(str: string, sepChar: string): string[];
  findTopLevelChar(str: string, ch: string): number;
  findMatchingClose(str: string, openIdx: number): number;
  countParams(paramListStr: string): { count: number; names: string[] };
  parseDeclarationText(declText: string): Declaration | null;
  findDeclarationAtLine(text: string, lineNumber: number): Declaration | null;
  describeCitation(file: string, line: number, root?: string): { found: boolean; declaration?: Declaration };
  compareClaim(found: Declaration | null, claim: { kind: string; arity?: number; access?: string[] }): CitationResult;
  verifyCitation(
    file: string,
    line: number,
    claim: { kind: string; arity?: number; access?: string[] },
    root?: string,
  ): CitationResult;
  verifyEntry(
    entry: { name: string; kind: string; arity?: number; access?: string[]; citations: { file: string; line: number }[] },
    root?: string,
  ): EntryResult;
}

const checker: CheckRdoCitationModule = require('../../scripts/check-rdo-citation.js');

const SPO_ORIGINAL_ROOT = process.env.SPO_ORIGINAL_DIR || `${require('os').homedir()}/SPO-Original`;
const referenceTreeAvailable = checker.referenceRootExists(SPO_ORIGINAL_ROOT);

function describeIfAvailable(name: string, fn: () => void) {
  if (referenceTreeAvailable) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (skipped: ~/SPO-Original not found at ${SPO_ORIGINAL_ROOT})`, fn);
  }
}

// -------------------------------------------------------------------------------------------
// Parameter counting — the three worked examples from citation-verifier.md, verbatim.
// -------------------------------------------------------------------------------------------

describe('countParams — the three worked examples from citation-verifier.md', () => {
  it('function ObjectAt(x, y: Integer; const opts: string = \'\'): TWorldObject; -> 3 params', () => {
    const result = checker.countParams("x, y: Integer; const opts: string = ''");
    expect(result.count).toBe(3);
    expect(result.names).toEqual(['x', 'y', 'opts']);
  });

  it('procedure SetRatingFrom(rater, target: Integer; value: Single); -> 3 params', () => {
    const result = checker.countParams('rater, target: Integer; value: Single');
    expect(result.count).toBe(3);
    expect(result.names).toEqual(['rater', 'target', 'value']);
  });

  it('function Lookup(const key: string; opts: array of TFilterSpec): Integer; -> 2 params', () => {
    const result = checker.countParams('const key: string; opts: array of TFilterSpec');
    expect(result.count).toBe(2);
    expect(result.names).toEqual(['key', 'opts']);
  });
});

describe('countParams — supporting rules the doc states explicitly', () => {
  it('a parameterless list counts as 0', () => {
    expect(checker.countParams('').count).toBe(0);
    expect(checker.countParams('   ').count).toBe(0);
  });

  it('modifiers (const, var, out) do not count and do not break the split', () => {
    expect(checker.countParams('var a, b: Integer; out c: string').count).toBe(3);
  });

  it('nested brackets keep an inner ; or , from being mistaken for a top-level separator', () => {
    // A default-value expression and an array type both carry characters that would
    // miscount the parameter list if nesting depth were not tracked.
    const result = checker.countParams('a: array[0..3] of Integer; b: Integer = 1');
    expect(result.count).toBe(2);
    expect(result.names).toEqual(['a', 'b']);
  });

  it('a default value does not add or remove a parameter', () => {
    expect(checker.countParams("opts: string = ''").count).toBe(1);
  });
});

// -------------------------------------------------------------------------------------------
// Comments and string literals inside a declaration.
//
// citation-verifier.md's algorithm assumes a comment-free parameter list. The real reference
// tree does not always provide one: 147 of 134,810 declarations in ~/SPO-Original carry a
// comment inside their parameter list. Before maskInert() these produced a confident WRONG
// ARITY rather than an error — the exact silent failure this checker exists to prevent. None
// of the 147 are in the four directories rdo-members.ts cites (Kernel, StdBlocks, DServer,
// Interface Server), so the baseline never saw them; that is luck, not a guarantee, and a
// future citation is not obliged to keep it.
// -------------------------------------------------------------------------------------------

describe('comments and string literals never contribute parameters, brackets or separators', () => {
  it('a line comment carrying a comma does not inflate the arity', () => {
    const d = checker.parseDeclarationText(
      'function F(\n  a: Integer; // the first, primary arg\n  b: Integer\n): Boolean;',
    );
    expect(d!.arity).toBe(2);
    expect(d!.paramNames).toEqual(['a', 'b']);
  });

  it('a brace comment carrying a semicolon does not split the parameter list', () => {
    const d = checker.parseDeclarationText('function F(a: Integer; { note; careful } b: Integer): Integer;');
    expect(d!.arity).toBe(2);
    expect(d!.paramNames).toEqual(['a', 'b']);
  });

  it('a (* *) comment before a modifier does not become part of the name', () => {
    const d = checker.parseDeclarationText('function F(a: TCaps; (*out*)var b: TSurface): HResult;');
    expect(d!.paramNames).toEqual(['a', 'b']);
  });

  it('parentheses inside a line comment do not close the real parameter list', () => {
    const d = checker.parseDeclarationText(
      'function F(\n  ic: HIC; // compressor (NULL if any will do)\n  n: uint\n): Integer;',
    );
    expect(d!.arity).toBe(2);
    expect(d!.paramNames).toEqual(['ic', 'n']);
  });

  it('a semicolon inside a string default does not split the parameter list', () => {
    expect(checker.countParams("s: string = 'a;b'")).toEqual({ count: 1, names: ['s'] });
    expect(checker.countParams("s: string = 'a;b'; n: Integer").count).toBe(2);
  });

  it('a doubled quote inside a string default does not end the literal early', () => {
    expect(checker.countParams("s: string = 'it''s; fine'; n: Integer")).toEqual({
      count: 2,
      names: ['s', 'n'],
    });
  });

  it('a stray `>` never drives bracket depth negative (which would swallow the terminator)', () => {
    // `{ NULL -> use previous }` in Utils/Vcl/dsintf.pas:887 did exactly this: depth went to
    // -1, the declaration's own terminating `;` was not recognised at "top level", and the
    // parsed span ran on into the NEXT declaration.
    expect(checker.countParams('a: Boolean = 1 > 0; b: Integer')).toEqual({
      count: 2,
      names: ['a', 'b'],
    });
  });

  it('a commented-out declaration is not mistaken for the enclosing one', () => {
    const src = ['type', '  TFoo = class', '    // function Old(a, b, c: Integer): Boolean;', '  end;'].join('\n');
    expect(checker.findDeclarationAtLine(src, 3)).toBeNull();
  });

  it('maskInert preserves length and newlines, so offsets stay valid against the original', () => {
    const src = "a { c, d } b // e, f\n'g;h' i";
    const masked = checker.maskInert(src);
    expect(masked).toHaveLength(src.length);
    expect(masked.split('\n')).toHaveLength(src.split('\n').length);
    expect(masked).not.toContain('c, d');
    expect(masked).not.toContain('e, f');
    expect(masked).not.toContain('g;h');
  });
});

describeIfAvailable('comment-bearing declarations in the real reference tree', () => {
  it('Utils/Vcl/dsintf.pas:887 stops at its own `;` instead of running into the next declaration', () => {
    const text = checker.readPasFile('Utils/Vcl/dsintf.pas', SPO_ORIGINAL_ROOT);
    const d = checker.findDeclarationAtLine(text, 887)!;
    expect(d.name).toBe('LocateWithFilter');
    expect(d.arity).toBe(2);
    expect(d.paramNames).toEqual(['pCanExpr', 'iLen']);
    expect(d.endLine).toBeLessThanOrEqual(891);
  });

  it('DirectX Sources/DxTools.pas:83 counts 4 parameters, not the 7 the comments suggested', () => {
    const text = checker.readPasFile('DirectX Sources/DxTools.pas', SPO_ORIGINAL_ROOT);
    const d = checker.findDeclarationAtLine(text, 83)!;
    expect(d.paramNames).toEqual(['from', 'at', 'world_up', 'roll']);
  });
});

// -------------------------------------------------------------------------------------------
// Encoding — ISO-8859-1 (latin1) decoding of the files citation-verifier.md names as
// defeating naive text reads.
// -------------------------------------------------------------------------------------------

describeIfAvailable('ISO-8859-1 decoding of the four named files', () => {
  it('decodes an accented character in Kernel/MediaNameGenerator.pas cleanly (latin1, not UTF-8)', () => {
    const text = checker.readPasFile('Kernel/MediaNameGenerator.pas', SPO_ORIGINAL_ROOT);
    // The movie title "Léon" — 0xE9 in ISO-8859-1. Decoded as UTF-8 this byte would either
    // throw or produce a replacement/mangled character; latin1 renders it as 'é' cleanly.
    expect(text).toContain("Add('Léon')");
  });

  it('decodes a superscript-two in Kernel/KernelCache.pas cleanly (0xB2 -> "m²")', () => {
    const text = checker.readPasFile('Kernel/KernelCache.pas', SPO_ORIGINAL_ROOT);
    expect(text).toContain('m²');
  });

  it('reading the same bytes as UTF-8 would NOT reproduce the same text (sanity check on the fixture)', () => {
    const buf = fs.readFileSync(checker.resolvePasPath('Kernel/MediaNameGenerator.pas', SPO_ORIGINAL_ROOT));
    const asLatin1 = buf.toString('latin1');
    const asUtf8 = buf.toString('utf8');
    expect(asLatin1).not.toBe(asUtf8);
    expect(asLatin1).toContain('Léon');
  });
});

// -------------------------------------------------------------------------------------------
// Kind determination + the accessor/property shape, against real declarations.
// -------------------------------------------------------------------------------------------

describeIfAvailable('kind determination against real declarations', () => {
  it('reads `function` off a real function declaration (InterfaceServer.pas:441, CanJoinWorldEx)', () => {
    const { found, declaration } = checker.describeCitation(
      'Interface Server/InterfaceServer.pas',
      441,
      SPO_ORIGINAL_ROOT,
    );
    expect(found).toBe(true);
    expect(declaration!.kind).toBe('function');
    expect(declaration!.arity).toBe(1);
  });

  it('reads `procedure` off a real procedure declaration (DServer/DirectoryServer.pas:31, RDOEndSession)', () => {
    const { found, declaration } = checker.describeCitation('DServer/DirectoryServer.pas', 31, SPO_ORIGINAL_ROOT);
    expect(found).toBe(true);
    expect(declaration!.kind).toBe('procedure');
    expect(declaration!.arity).toBe(0);
  });

  it('recognises a `property ... read ... write ...;` shape as kind accessor, with access derived from read/write (StdBlocks/Banks.pas:40, Interest)', () => {
    const { found, declaration } = checker.describeCitation('StdBlocks/Banks.pas', 40, SPO_ORIGINAL_ROOT);
    expect(found).toBe(true);
    expect(declaration!.kind).toBe('accessor');
    expect(declaration!.access).toEqual(['get', 'set']);
  });

  it('recognises a field-backed property (read fX write fX, no method names) the same way (StdBlocks/Broadcast.pas:51, HoursOnAir)', () => {
    const { found, declaration } = checker.describeCitation('StdBlocks/Broadcast.pas', 51, SPO_ORIGINAL_ROOT);
    expect(found).toBe(true);
    expect(declaration!.kind).toBe('accessor');
    expect(declaration!.access).toEqual(['get', 'set']);
  });

  it('recognises a read-only property as access ["get"] only', () => {
    // Every real *cited* accessor in rdo-members.ts happens to declare both read and write
    // except BudgetPerc (StdBlocks/Banks.pas:39), which the parser also parses as get+set —
    // that is the deliberate mismatch case covered below, not a read-only shape. So the
    // read-only shape itself is exercised directly against the same property grammar.
    const parsed = checker.parseDeclarationText('property Foo : integer read GetFoo;');
    expect(parsed!.kind).toBe('accessor');
    expect(parsed!.access).toEqual(['get']);
  });
});

// -------------------------------------------------------------------------------------------
// CITATION_NOT_FOUND — a citation pointing at a line that is not a declaration at all.
// -------------------------------------------------------------------------------------------

describeIfAvailable('CITATION_NOT_FOUND', () => {
  it('reports not-found for a blank line before any declaration in the file', () => {
    const { found } = checker.describeCitation('Interface Server/InterfaceServer.pas', 2, SPO_ORIGINAL_ROOT);
    expect(found).toBe(false);
  });

  it('reports not-found for a `uses` clause line', () => {
    const { found } = checker.describeCitation('Interface Server/InterfaceServer.pas', 9, SPO_ORIGINAL_ROOT);
    expect(found).toBe(false);
  });

  it('verifyCitation surfaces CITATION_NOT_FOUND as the verdict, not a thrown error', () => {
    const result = checker.verifyCitation(
      'Interface Server/InterfaceServer.pas',
      2,
      { kind: 'function', arity: 1 },
      SPO_ORIGINAL_ROOT,
    );
    expect(result.verdict).toBe('CITATION_NOT_FOUND');
    expect(result.ok).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------
// End-to-end MATCH / MISMATCH against real citations already in rdo-members.ts.
// -------------------------------------------------------------------------------------------

describeIfAvailable('verifyCitation / verifyEntry against real rdo-members.ts citations', () => {
  it('MATCHes a real function citation (ContextStatusText, InterfaceServer.pas:149, arity 2)', () => {
    const result = checker.verifyCitation(
      'Interface Server/InterfaceServer.pas',
      149,
      { kind: 'function', arity: 2 },
      SPO_ORIGINAL_ROOT,
    );
    expect(result.verdict).toBe('MATCH(function, 2)');
    expect(result.ok).toBe(true);
  });

  it('MATCHes a real procedure citation with two params in one group (RDOLogonClient, World.pas:412)', () => {
    const result = checker.verifyCitation(
      'Kernel/World.pas',
      412,
      { kind: 'procedure', arity: 2 },
      SPO_ORIGINAL_ROOT,
    );
    expect(result.verdict).toBe('MATCH(procedure, 2)');
  });

  it('reports MISMATCH(kind) when the claimed kind is wrong', () => {
    const result = checker.verifyCitation(
      'Interface Server/InterfaceServer.pas',
      149, // ContextStatusText — a function
      { kind: 'procedure', arity: 2 },
      SPO_ORIGINAL_ROOT,
    );
    expect(result.verdict).toBe('MISMATCH(kind)');
  });

  it('reports MISMATCH(arity) when the claimed arity is wrong', () => {
    const result = checker.verifyCitation(
      'Interface Server/InterfaceServer.pas',
      149, // ContextStatusText — arity 2, not 3
      { kind: 'function', arity: 3 },
      SPO_ORIGINAL_ROOT,
    );
    expect(result.verdict).toBe('MISMATCH(arity)');
  });

  it('reports MISMATCH(access) for BudgetPerc — the one real entry this baseline flags', () => {
    // StdBlocks/Banks.pas:39 declares `property BudgetPerc : integer read GetBudgetPerc write
    // SetBudgetPerc;` (both read and write), but rdo-members.ts claims access: ['get'] only —
    // documented in the source as an intentional Rule 2 divergence (the reference client never
    // emits `set BudgetPerc`). The deterministic parser does not adjudicate that rule; it only
    // reports what the two sides literally say.
    const result = checker.verifyCitation(
      'StdBlocks/Banks.pas',
      39,
      { kind: 'accessor', access: ['get'] },
      SPO_ORIGINAL_ROOT,
    );
    expect(result.verdict).toBe('MISMATCH(access)');
    expect(result.found!.access).toEqual(['get', 'set']);
  });

  it('verifyEntry reports an uncited entry as NO_CITATION rather than throwing or passing', () => {
    // An entry with no citation is the very thing check-pr-rules.js rejects; it must never
    // reach a CI caller as a MATCH, and must not blow up as a TypeError either.
    const result = checker.verifyEntry({ name: 'Uncited', kind: 'function', arity: 0, citations: [] });
    expect(result.ok).toBe(false);
    expect(result.overallVerdict).toBe('NO_CITATION');
    expect(result.perCitation).toEqual([]);
  });

  it('verifyEntry requires every citation to match for a dual-cited entry (RDOSetRatingFrom)', () => {
    const result = checker.verifyEntry(
      {
        name: 'RDOSetRatingFrom',
        kind: 'procedure',
        arity: 3,
        citations: [
          { file: 'Kernel/TownPolitics.pas', line: 40 },
          { file: 'Kernel/WorldPolitics.pas', line: 256 },
        ],
      },
      SPO_ORIGINAL_ROOT,
    );
    expect(result.ok).toBe(true);
    expect(result.perCitation).toHaveLength(2);
    expect(result.perCitation.every(c => c.verdict === 'MATCH(procedure, 3)')).toBe(true);
  });
});

// -------------------------------------------------------------------------------------------
// The CLI itself, spawned as a real subprocess (mirrors check-pr-rules.test.ts's "the script
// against a real repository" pattern). The library functions above call describeCitation()
// and destructure `{ found, declaration }` correctly; main()'s own `check`/`describe` branches
// used to destructure only `{ found }` and pass that bare boolean on as if it were the parsed
// declaration — every unit test above still passed, because none of them go through the CLI's
// own argv-to-verdict wiring. Exercising the compiled CLI end to end is the only thing that
// catches that class of bug, so it is covered here deliberately, not just at the library level.
// -------------------------------------------------------------------------------------------

describeIfAvailable('the CLI (scripts/check-rdo-citation.js), spawned as a subprocess', () => {
  const SCRIPT = path.resolve(__dirname, '../../scripts/check-rdo-citation.js');

  const run = (args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync('node', [SCRIPT, ...args], {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, SPO_ORIGINAL_DIR: SPO_ORIGINAL_ROOT },
      });
      return { code: 0, out };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };

  it('`check` on a real matching citation prints MATCH and exits 0', () => {
    const { code, out } = run(['check', 'Interface Server/InterfaceServer.pas', '149', 'function', '2']);
    expect(out).toContain('MATCH(function, 2)');
    expect(code).toBe(0);
  });

  it('`check` on a wrong arity prints MISMATCH(arity) and exits 1', () => {
    const { code, out } = run(['check', 'Interface Server/InterfaceServer.pas', '149', 'function', '3']);
    expect(out).toContain('MISMATCH(arity)');
    expect(code).toBe(1);
  });

  it('`check` on a wrong kind prints MISMATCH(kind) and exits 1', () => {
    const { code, out } = run(['check', 'Interface Server/InterfaceServer.pas', '149', 'procedure', '2']);
    expect(out).toContain('MISMATCH(kind)');
    expect(code).toBe(1);
  });

  it('`check` on a non-declaration line prints CITATION_NOT_FOUND and exits 1', () => {
    const { code, out } = run(['check', 'Interface Server/InterfaceServer.pas', '2', 'function', '1']);
    expect(out).toContain('CITATION_NOT_FOUND');
    expect(code).toBe(1);
  });

  it('`check` on a real accessor prints MATCH(accessor, ...) and exits 0', () => {
    const { code, out } = run(['check', 'StdBlocks/Banks.pas', '40', 'accessor', 'get,set']);
    expect(out).toContain('MATCH(accessor, [get, set])');
    expect(code).toBe(0);
  });

  it('`describe` prints the parsed declaration as JSON', () => {
    const { code, out } = run(['describe', 'StdBlocks/Banks.pas', '39']);
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({ kind: 'accessor', name: 'BudgetPerc', access: ['get', 'set'] });
  });

  it('`entry` reports the real BudgetPerc mismatch and exits 1', () => {
    const { code, out } = run([
      'entry',
      JSON.stringify({
        name: 'BudgetPerc',
        kind: 'accessor',
        access: ['get'],
        citations: [{ file: 'StdBlocks/Banks.pas', line: 39 }],
      }),
    ]);
    expect(out).toContain('MISMATCH(access)');
    expect(code).toBe(1);
  });

  it('`entry` MATCHes a dual-citation entry and exits 0', () => {
    const { code, out } = run([
      'entry',
      JSON.stringify({
        name: 'RDOSetRatingFrom',
        kind: 'procedure',
        arity: 3,
        citations: [
          { file: 'Kernel/TownPolitics.pas', line: 40 },
          { file: 'Kernel/WorldPolitics.pas', line: 256 },
        ],
      }),
    ]);
    expect(out).toContain('RDOSetRatingFrom: MATCH');
    expect(code).toBe(0);
  });
});
