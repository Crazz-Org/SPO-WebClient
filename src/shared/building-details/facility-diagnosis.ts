/**
 * Facility diagnosis — turns the status text the server pushes (sections 1 and 2 of
 * `RDOAllObjectStatusText`) into ONE line the player can act on: a severity, a sentence,
 * and, when the sentence names a fix the client can offer, an action.
 *
 * Everything here is read from text the client already receives — no RDO read is added.
 * The sentences are the English MLS defaults of `Kernel/SimHints.pas:279-516` (the only
 * language shipped); the parser falls back to the raw text for anything it does not know.
 *
 * Two facts from the Delphi source shape the rules (see doc/ux/missing-features.md B7):
 *  - the STOP-grade states never reach the hint section: `facStoppedByTycoon`,
 *    `facNeedsBudget`, weather stops write "Stopped by %s." / "Stopped: needs money." /
 *    "Stopped due to weather conditions." at the head of section 1
 *    (`Kernel/Kernel.pas:5017-5024`) while section 2 reads "No hints for this facility.";
 *  - every authored hint starts with a lexical prefix — `Warning:` / `Hint:` /
 *    `Congratulations:` / upper-case `WARNING:` / `HINT:` / `ATTENTION!` — which is the
 *    per-sentence severity the server encodes (`Kernel/SimHints.pas`).
 */

export type DiagnosisSeverity = 'stop' | 'warning' | 'hint' | 'ok' | 'none';

export type DiagnosisAction =
  | { kind: 'findSupplier'; fluidName?: string }
  | { kind: 'openSupplies' }
  | { kind: 'openServices' }
  | { kind: 'openWorkforce'; peopleKind?: string }
  | { kind: 'openResearch' }
  | { kind: 'connect' };

export interface FacilityDiagnosis {
  severity: DiagnosisSeverity;
  /** One sentence, already stripped of its "Warning:" / "Hint:" prefix. */
  message: string;
  /** Short word for the status chip. */
  label: string;
  action?: DiagnosisAction;
  /** The raw hint the diagnosis was derived from (for tooltips / debugging). */
  raw?: string;
}

const NO_HINTS = /^No hints for this facility\.?$/i;
const HINTS_DENIED = /^This facility belongs to .+ There are no hints for you\.?$/i;

/**
 * True when section 2 carries a real sentence — i.e. not empty, not the
 * "No hints for this facility." placeholder, and not the "belongs to …" denial
 * the server sends for a facility the player may not inspect.
 */
export function hasFacilityHint(hintsText: string | undefined): boolean {
  const hints = (hintsText ?? '').trim();
  return hints !== '' && !NO_HINTS.test(hints) && !HINTS_DENIED.test(hints);
}

/** Section-1 "Stopped …" heads — `Kernel/Kernel.pas:5017-5024`, strings at `:13476-13479`. */
const STOPPED_RULES: Array<{ re: RegExp; message: (m: RegExpMatchArray) => string }> = [
  { re: /^Stopped by (.+?)\.?$/im, message: (m) => `Stopped by ${m[1]}.` },
  { re: /^Stopped: needs money\.?$/im, message: () => 'Stopped: needs money.' },
  { re: /^Stopped: needs connections\.?$/im, message: () => 'Stopped: needs connections.' },
  { re: /^Stopped due to weather conditions\.?$/im, message: () => 'Stopped due to weather conditions.' },
];

/** Section-2 hint templates — `Kernel/SimHints.pas` English defaults. First match wins. */
const HINT_RULES: Array<{
  re: RegExp;
  severity: DiagnosisSeverity;
  label: string;
  message?: (m: RegExpMatchArray) => string;
  action?: (m: RegExpMatchArray) => DiagnosisAction | undefined;
}> = [
  // mtidFacilityWillBeDemolished — the one stop-grade hint
  { re: /^ATTENTION! THE MAYOR OF (.+?) REQUESTED THE DEMOLITION/i, severity: 'stop', label: 'Demolition ordered',
    message: (m) => `The mayor of ${m[1]} ordered the demolition of this building.` },
  // mtidEvalBlockNeedsBasicInput
  { re: /^Warning: This facility requires (.+?) to produce\./i, severity: 'warning', label: 'No supplies',
    message: (m) => `Needs ${m[1]} to produce.`, action: (m) => ({ kind: 'findSupplier', fluidName: m[1] }) },
  // mtidServiceLowSupplies
  { re: /^Warning: (.+?) service need more supplies\./i, severity: 'warning', label: 'Low supplies',
    message: (m) => `${m[1]} service needs more supplies.`, action: (m) => ({ kind: 'findSupplier', fluidName: m[1] }) },
  // mtidEvalBlockNeedsMoreSupplies
  { re: /^Hint: This facility needs more (.+?) to produce (.+?)\./i, severity: 'hint', label: 'More supplies',
    message: (m) => `Needs more ${m[1]} to produce ${m[2]}.`, action: (m) => ({ kind: 'findSupplier', fluidName: m[1] }) },
  // mtidBlockNeedsWorkForce
  { re: /^Warning: This facility needs (.+?) work force\./i, severity: 'warning', label: 'Needs workers',
    message: (m) => `Needs ${m[1]} workers.`, action: (m) => ({ kind: 'openWorkforce', peopleKind: m[1] }) },
  // mtidNeedsCompSupport
  { re: /^Warning: Not enough company support\./i, severity: 'warning', label: 'No company support',
    message: () => 'Not enough company support — build more headquarters or attract more people to them.' },
  // mtidEvalBlockNeedsMoreCompSupplies
  { re: /^Warning: This facility is lacking services\./i, severity: 'warning', label: 'Lacking services',
    message: () => 'Lacking company services.', action: () => ({ kind: 'openServices' }) },
  // mtidEvalBlockNeedTechnology
  { re: /^Warning: Cannot operate until you research again (.+?)\./i, severity: 'warning', label: 'Research needed',
    message: (m) => `Cannot operate until ${m[1]} is researched again.`, action: () => ({ kind: 'openResearch' }) },
  // mtidServiceHighCompetition
  { re: /^Warning: You have a problem with competition\./i, severity: 'warning', label: 'Competition',
    message: () => 'Strong competition — get some advertisement.' },
  // mtidTVWarning / mtidAntenaHint
  { re: /^WARNING: There are no antennas attached/i, severity: 'warning', label: 'No antenna',
    message: () => 'No antenna attached — connect one.', action: () => ({ kind: 'connect' }) },
  { re: /^HINT: Use the "Connect" button .* connect this antenna/i, severity: 'hint', label: 'Not connected',
    message: () => 'Connect this antenna to a station.', action: () => ({ kind: 'connect' }) },
  // mtidBewareOfTranscend
  { re: /^WARNING! All facilities belonging to (.+?) will disappear/i, severity: 'warning', label: 'Transcendence',
    message: (m) => `All facilities of ${m[1]} will disappear except this building.` },
  // mtidEvalBlockBadWeatherCond
  { re: /^There is nothing we can do about the weather/i, severity: 'hint', label: 'Weather',
    message: () => 'Bad weather — nothing to do but wait.' },
  // mtidServiceOpening
  { re: /^The facility started just few hours ago/i, severity: 'hint', label: 'Just opened',
    message: () => 'Just opened — no hints yet.' },
  // Residential
  { re: /^Congratulations: This building is working OK/i, severity: 'ok', label: 'Working well',
    message: () => 'Working well — you could raise the rent a little.' },
  { re: /^Warning: You need to attract more people to this building\./i, severity: 'warning', label: 'Under-populated',
    message: () => 'Needs many more tenants.' },
  { re: /^Hint: You (?:still can|need to) attract more people to this building\./i, severity: 'hint', label: 'Room left',
    message: () => 'Could attract more tenants.' },
  { re: /^Hint: Try to attract more customers/i, severity: 'hint', label: 'Few customers',
    message: () => 'Attract more customers with better quality and prices.' },
  // HQ / research
  { re: /^Hint: Be sure there are enought workers to carry out the research/i, severity: 'hint', label: 'Research',
    message: () => 'Make sure there are enough workers for the research.', action: () => ({ kind: 'openResearch' }) },
  { re: /^Hint: Go to "Settings" to carry out new researchs/i, severity: 'hint', label: 'Idle',
    message: () => 'No research running.', action: () => ({ kind: 'openResearch' }) },
  { re: /^Hint: Well, .+?, this is a good time/i, severity: 'ok', label: 'Researching',
    message: () => 'Research under way.' },
  // Capitol
  { re: /^Hint: If you have more than 1000 prestige points/i, severity: 'hint', label: 'Campaign',
    message: () => 'With 1000+ prestige you can run for the presidency.' },
];

function firstLine(text: string): string {
  // Lines are separated by #10#13 in the Delphi writer; tolerate any order.
  return text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean)[0] ?? '';
}

function genericSeverity(hint: string): { severity: DiagnosisSeverity; label: string; message: string } {
  const m = hint.match(/^(Warning|Hint|Congratulations|WARNING|HINT|ATTENTION)[:!]\s*(.*)$/s);
  if (!m) return { severity: 'hint', label: 'Notice', message: hint };
  const prefix = m[1].toLowerCase();
  const rest = m[2].trim() || hint;
  if (prefix === 'attention') return { severity: 'stop', label: 'Attention', message: rest };
  if (prefix === 'warning') return { severity: 'warning', label: 'Warning', message: rest };
  if (prefix === 'congratulations') return { severity: 'ok', label: 'Working well', message: rest };
  return { severity: 'hint', label: 'Hint', message: rest };
}

/**
 * Diagnose a facility from its pushed status text.
 * @param detailsText section 1 (may start with a "Stopped …" line)
 * @param hintsText   section 2 (one or two sentences, or "No hints for this facility.")
 */
export function parseFacilityDiagnosis(detailsText: string | undefined, hintsText: string | undefined): FacilityDiagnosis {
  const details = (detailsText ?? '').trim();
  const hints = (hintsText ?? '').trim();

  // 1. Stop-grade states live in section 1
  for (const rule of STOPPED_RULES) {
    const m = details.match(rule.re);
    if (m) return { severity: 'stop', label: 'Stopped', message: rule.message(m), raw: m[0] };
  }

  // 2. Hints
  if (!hints || NO_HINTS.test(hints)) {
    return { severity: 'none', label: '', message: '' };
  }
  if (HINTS_DENIED.test(hints)) {
    return { severity: 'none', label: '', message: '' };
  }
  const head = firstLine(hints);
  for (const rule of HINT_RULES) {
    const m = head.match(rule.re);
    if (m) {
      return {
        severity: rule.severity,
        label: rule.label,
        message: rule.message ? rule.message(m) : head,
        action: rule.action?.(m),
        raw: hints,
      };
    }
  }
  // 3. Unknown sentence: keep it, read the severity off its prefix
  const g = genericSeverity(head);
  return { ...g, raw: hints };
}
