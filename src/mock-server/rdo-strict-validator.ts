/**
 * RDO Strict Validator — Protocol conformity checker for mock/test infrastructure.
 *
 * Validates incoming RDO commands against scenario matchKeys and produces
 * detailed, AI-friendly violation reports when commands don't match expectations.
 *
 * Design: Non-blocking. Violations are collected and asserted in afterEach(),
 * never thrown inline. The existing RdoMock matching is unaffected.
 */

import { RdoProtocol } from '@/server/rdo';
import { RdoAction, type RdoPacket } from '@/shared/types/protocol-types';
import type { RdoExchange, RdoScenario } from './types/rdo-exchange-types';
import { normalizeSetPacket } from './rdo-mock';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum ViolationSeverity {
  /** Command will malfunction — wrong verb/action/separator, arg count or arg type prefix */
  ERROR = 'ERROR',
  /**
   * A known production divergence (`KNOWN_PRODUCTION_DIVERGENCES`) — reported, never fails a
   * test
   */
  WARNING = 'WARNING',
  /** Informational — no scenario covers this member */
  INFO = 'INFO',
}

export enum ViolationType {
  ACTION_MISMATCH = 'ACTION_MISMATCH',
  VERB_MISMATCH = 'VERB_MISMATCH',
  SEPARATOR_MISMATCH = 'SEPARATOR_MISMATCH',
  ARG_COUNT_MISMATCH = 'ARG_COUNT_MISMATCH',
  ARG_TYPE_PREFIX_MISMATCH = 'ARG_TYPE_PREFIX_MISMATCH',
  UNRECOGNIZED_MEMBER = 'UNRECOGNIZED_MEMBER',
}

/** One member whose working production frame differs from its fixture in arity or type prefix */
export interface KnownProductionDivergence {
  member: string;
  type: ViolationType.ARG_COUNT_MISMATCH | ViolationType.ARG_TYPE_PREFIX_MISMATCH;
  /** What the production frame sends that the fixture/declaration does not */
  differs: string;
  /** Why the production frame is kept as is (a citation), or '[UNKNOWN]' */
  reason: string;
}

/**
 * The ONE allowlist of arg-count / type-prefix divergences that stay WARNING. An entry is added
 * only when a currently-working production frame would otherwise fail; every other arg-count or
 * type-prefix mismatch is an ERROR.
 */
export const KNOWN_PRODUCTION_DIVERGENCES: readonly KnownProductionDivergence[] = [];

/**
 * Severity of an arg-count / type-prefix mismatch: WARNING when the member is on the allowlist
 * for that violation type, ERROR otherwise. `allowlist` is a parameter only so a test can
 * exercise the WARNING branch; the validator always passes the default.
 */
export function argMismatchSeverity(
  member: string | undefined,
  type: KnownProductionDivergence['type'],
  allowlist: readonly KnownProductionDivergence[] = KNOWN_PRODUCTION_DIVERGENCES
): ViolationSeverity {
  return allowlist.some((d) => d.member === member && d.type === type)
    ? ViolationSeverity.WARNING
    : ViolationSeverity.ERROR;
}

/** A single protocol violation with AI-friendly context */
export interface RdoViolation {
  /** The exchange ID that partially matched (e.g., "auth-rdo-002") */
  exchangeId: string;
  severity: ViolationSeverity;
  type: ViolationType;
  /** The raw command string that was sent */
  sentCommand: string;
  /** Parsed details of what was sent */
  sent: {
    verb?: string;
    action?: string;
    member?: string;
    args?: string[];
    separator?: string;
  };
  /** What was expected from matchKeys / exchange.request */
  expected: {
    verb?: string;
    action?: string;
    member?: string;
    argsPattern?: string[];
    separator?: string;
  };
  /** Human-readable message explaining the problem */
  message: string;
  /** Actionable fix suggestion */
  fix: string;
  /** Reference to documentation */
  docRef?: string;
}

/** Configuration for the validator */
export interface StrictValidatorConfig {
  /** Set to false to disable strict validation (default: true) */
  enabled: boolean;
  /** Members to exempt from strict validation (e.g., fallback-only properties) */
  exemptMembers: Set<string>;
  /** Whether to include INFO-level unrecognized member violations (default: false) */
  reportUnrecognizedMembers: boolean;
}

/** Internal: an exchange with its parent scenario name */
interface IndexedExchange {
  exchange: RdoExchange;
  scenarioName: string;
  /** Parsed representation of exchange.request (cached) */
  parsedRequest: RdoPacket | null;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export class RdoStrictValidator {
  private violations: RdoViolation[] = [];
  private indexed: IndexedExchange[] = [];
  private config: StrictValidatorConfig;

  constructor(config?: Partial<StrictValidatorConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      exemptMembers: config?.exemptMembers ?? new Set(),
      reportUnrecognizedMembers: config?.reportUnrecognizedMembers ?? false,
    };
  }

  /** Load exchanges from a scenario for validation */
  addScenario(scenario: RdoScenario): void {
    for (const exchange of scenario.exchanges) {
      if (exchange.pushOnly) continue; // skip server-initiated pushes
      const parsedRequest = exchange.request
        ? normalizeSetPacket(RdoProtocol.parse(exchange.request))
        : null;
      this.indexed.push({
        exchange,
        scenarioName: scenario.name,
        parsedRequest,
      });
    }
  }

  /**
   * Validate a parsed command against all loaded exchanges.
   * Returns violations found (may be empty). Does NOT block matching.
   */
  validate(input: RdoPacket, rawCommand: string): RdoViolation[] {
    if (!this.config.enabled) return [];
    const parsed = normalizeSetPacket(input);

    const member = parsed.member;
    const isIdof = parsed.verb === 'idof';

    // For idof commands, match by verb + targetId
    if (isIdof) {
      return this.validateIdof(parsed, rawCommand);
    }

    // Skip if no member to validate
    if (!member) return [];

    // Skip exempt members
    if (this.config.exemptMembers.has(member)) return [];

    // Find all exchanges matching by member name
    const candidates = this.indexed.filter(
      (ix) => ix.exchange.matchKeys?.member === member
    );

    if (candidates.length === 0) {
      // No scenario covers this member
      if (this.config.reportUnrecognizedMembers) {
        const violation: RdoViolation = {
          exchangeId: 'N/A',
          severity: ViolationSeverity.INFO,
          type: ViolationType.UNRECOGNIZED_MEMBER,
          sentCommand: rawCommand,
          sent: { verb: parsed.verb, action: parsed.action, member },
          expected: {},
          message: `No scenario exchange has matchKeys.member="${member}". ` +
            `This command has no mock coverage.`,
          fix: `Add an RdoExchange with matchKeys.member="${member}" to the ` +
            `appropriate scenario file, or add "${member}" to exemptMembers ` +
            `if this is a fallback-only property.`,
        };
        this.violations.push(violation);
        return [violation];
      }
      return [];
    }

    // Check each candidate — find the one with fewest violations
    let bestViolations: RdoViolation[] | null = null;

    for (const candidate of candidates) {
      const candidateViolations = this.checkCandidate(
        parsed,
        rawCommand,
        candidate
      );

      // If any candidate has zero violations, command is valid
      if (candidateViolations.length === 0) {
        return [];
      }

      // Track best (fewest violations)
      if (
        bestViolations === null ||
        candidateViolations.length < bestViolations.length
      ) {
        bestViolations = candidateViolations;
      }
    }

    // All candidates had violations — record the best match's violations
    if (bestViolations && bestViolations.length > 0) {
      this.violations.push(...bestViolations);
    }
    return bestViolations ?? [];
  }

  /** Get all accumulated violations */
  getViolations(): RdoViolation[] {
    return [...this.violations];
  }

  /** Get violations filtered by severity */
  getErrors(): RdoViolation[] {
    return this.violations.filter(
      (v) => v.severity === ViolationSeverity.ERROR
    );
  }

  getWarnings(): RdoViolation[] {
    return this.violations.filter(
      (v) => v.severity === ViolationSeverity.WARNING
    );
  }

  /** Check if any ERROR-level violations exist */
  hasErrors(): boolean {
    return this.violations.some(
      (v) => v.severity === ViolationSeverity.ERROR
    );
  }

  /** Reset accumulated violations */
  reset(): void {
    this.violations = [];
  }

  /** Format all violations into a single AI-friendly report string */
  formatReport(): string {
    if (this.violations.length === 0) return 'No RDO strict validation violations.';

    const errors = this.getErrors();
    const warnings = this.getWarnings();
    const infos = this.violations.filter(
      (v) => v.severity === ViolationSeverity.INFO
    );

    const sections: string[] = [];
    sections.push(
      `RDO STRICT VALIDATION: ${errors.length} error(s), ` +
      `${warnings.length} warning(s), ${infos.length} info(s)\n`
    );

    for (const v of this.violations) {
      sections.push(this.formatViolation(v));
    }

    return sections.join('\n---\n\n');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Validate an idof command */
  private validateIdof(
    parsed: RdoPacket,
    rawCommand: string
  ): RdoViolation[] {
    const targetId = parsed.targetId;
    if (!targetId) return [];

    // Skip exempt
    if (this.config.exemptMembers.has(targetId)) return [];

    // Find idof exchanges
    const candidates = this.indexed.filter(
      (ix) =>
        ix.exchange.matchKeys?.verb === 'idof' &&
        (ix.exchange.matchKeys?.targetId === targetId ||
          ix.exchange.matchKeys?.targetId === '*')
    );

    if (candidates.length === 0) {
      if (this.config.reportUnrecognizedMembers) {
        const violation: RdoViolation = {
          exchangeId: 'N/A',
          severity: ViolationSeverity.INFO,
          type: ViolationType.UNRECOGNIZED_MEMBER,
          sentCommand: rawCommand,
          sent: { verb: 'idof', member: targetId },
          expected: {},
          message: `No scenario exchange has idof "${targetId}".`,
          fix: `Add an RdoExchange with matchKeys: { verb: 'idof', targetId: '${targetId}' } ` +
            `to the appropriate scenario file.`,
        };
        this.violations.push(violation);
        return [violation];
      }
      return [];
    }

    // idof commands are simple — no action/args to validate
    return [];
  }

  /** Check a single candidate exchange against the parsed command */
  private checkCandidate(
    parsed: RdoPacket,
    rawCommand: string,
    candidate: IndexedExchange
  ): RdoViolation[] {
    const violations: RdoViolation[] = [];
    const mk = candidate.exchange.matchKeys!;
    const exchangeId = candidate.exchange.id;
    const expectedParsed = candidate.parsedRequest;

    // --- Verb check ---
    if (mk.verb !== undefined && parsed.verb !== mk.verb) {
      violations.push({
        exchangeId,
        severity: ViolationSeverity.ERROR,
        type: ViolationType.VERB_MISMATCH,
        sentCommand: rawCommand,
        sent: {
          verb: parsed.verb,
          action: parsed.action,
          member: parsed.member,
        },
        expected: {
          verb: mk.verb,
          action: mk.action,
          member: mk.member,
        },
        message:
          `Method '${parsed.member}' matched but verb mismatch: ` +
          `sent '${parsed.verb}', expected '${mk.verb}'.`,
        fix: this.generateFix(
          ViolationType.VERB_MISMATCH,
          parsed,
          mk,
          parsed.member ?? ''
        ),
        docRef: 'doc/spo-original-reference.md',
      });
    }

    // --- Action check ---
    if (mk.action !== undefined && parsed.action !== mk.action) {
      violations.push({
        exchangeId,
        severity: ViolationSeverity.ERROR,
        type: ViolationType.ACTION_MISMATCH,
        sentCommand: rawCommand,
        sent: {
          verb: parsed.verb,
          action: parsed.action,
          member: parsed.member,
        },
        expected: {
          verb: mk.verb,
          action: mk.action,
          member: mk.member,
        },
        message:
          `Method '${parsed.member}' matched but action mismatch: ` +
          `sent '${parsed.action}', expected '${mk.action}'.`,
        fix: this.generateFix(
          ViolationType.ACTION_MISMATCH,
          parsed,
          mk,
          parsed.member ?? ''
        ),
        docRef: 'doc/spo-original-reference.md',
      });
    }

    // --- Separator check (only for CALL actions) ---
    if (parsed.action === 'call' && expectedParsed?.action === 'call') {
      const sentSep = this.normalizeSeparator(parsed.separator);
      const expectedSep = this.normalizeSeparator(expectedParsed.separator);

      if (sentSep && expectedSep && sentSep !== expectedSep) {
        violations.push({
          exchangeId,
          severity: ViolationSeverity.ERROR,
          type: ViolationType.SEPARATOR_MISMATCH,
          sentCommand: rawCommand,
          sent: {
            verb: parsed.verb,
            action: parsed.action,
            member: parsed.member,
            separator: sentSep,
          },
          expected: {
            verb: mk.verb,
            action: mk.action,
            member: mk.member,
            separator: expectedSep,
          },
          message:
            `Method '${parsed.member}' matched but separator mismatch: ` +
            `sent '${sentSep}', expected '${expectedSep}'. ` +
            `'^' = function with return value, '*' = void procedure.`,
          fix: this.generateFix(
            ViolationType.SEPARATOR_MISMATCH,
            { ...parsed, separator: sentSep },
            { ...mk, separator: expectedSep },
            parsed.member ?? ''
          ),
          docRef: 'doc/spo-original-reference.md',
        });
      }
    }

    // --- Arg count check ---
    // A SET exchange without argsPattern falls back to its own request value.
    const expectedArgs = mk.argsPattern ??
      (parsed.action === RdoAction.SET && expectedParsed?.action === RdoAction.SET
        ? expectedParsed.args
        : undefined);
    if (expectedArgs !== undefined) {
      const sentCount = parsed.args?.length ?? 0;
      const expectedCount = expectedArgs.length;

      if (sentCount !== expectedCount) {
        violations.push({
          exchangeId,
          severity: argMismatchSeverity(parsed.member, ViolationType.ARG_COUNT_MISMATCH),
          type: ViolationType.ARG_COUNT_MISMATCH,
          sentCommand: rawCommand,
          sent: {
            verb: parsed.verb,
            action: parsed.action,
            member: parsed.member,
            args: parsed.args,
          },
          expected: {
            verb: mk.verb,
            action: mk.action,
            member: mk.member,
            argsPattern: expectedArgs,
          },
          message:
            `Method '${parsed.member}' matched but arg count mismatch: ` +
            `sent ${sentCount} arg(s), expected ${expectedCount}.`,
          fix: this.generateFix(
            ViolationType.ARG_COUNT_MISMATCH,
            parsed,
            { ...mk, argsPattern: expectedArgs },
            parsed.member ?? ''
          ),
          docRef: 'doc/spo-original-reference.md',
        });
      } else {
        // --- Arg type prefix check (only when counts match) ---
        for (let i = 0; i < expectedCount; i++) {
          const expectedArg = expectedArgs[i];
          const sentArg = parsed.args?.[i] ?? '';

          // Skip wildcard patterns
          if (expectedArg === '*') continue;

          const expectedPrefix = this.extractTypePrefix(expectedArg);
          const sentPrefix = this.extractTypePrefix(sentArg);

          if (expectedPrefix && sentPrefix && expectedPrefix !== sentPrefix) {
            violations.push({
              exchangeId,
              severity: argMismatchSeverity(parsed.member, ViolationType.ARG_TYPE_PREFIX_MISMATCH),
              type: ViolationType.ARG_TYPE_PREFIX_MISMATCH,
              sentCommand: rawCommand,
              sent: {
                verb: parsed.verb,
                action: parsed.action,
                member: parsed.member,
                args: parsed.args,
              },
              expected: {
                verb: mk.verb,
                action: mk.action,
                member: mk.member,
                argsPattern: expectedArgs,
              },
              message:
                `Method '${parsed.member}' arg[${i}] type prefix mismatch: ` +
                `sent '${sentPrefix}' (${this.prefixName(sentPrefix)}), ` +
                `expected '${expectedPrefix}' (${this.prefixName(expectedPrefix)}).`,
              fix:
                `In spo_session.ts, check argument ${i} type for ${parsed.member}. ` +
                `Sent prefix '${sentPrefix}' (${this.prefixName(sentPrefix)}), ` +
                `expected '${expectedPrefix}' (${this.prefixName(expectedPrefix)}). ` +
                `Use the correct RdoValue builder: ` +
                `# → RdoValue.int(), % → RdoValue.string(), @ → RdoValue.double(), ` +
                `! → RdoValue.float().`,
            });
          }
        }
      }
    }

    return violations;
  }

  /** Strip quotes and extract the bare separator character */
  private normalizeSeparator(sep: string | undefined): string | undefined {
    if (!sep) return undefined;
    return sep.replace(/"/g, '');
  }

  /** Extract type prefix from a typed token (e.g., "#42" → "#", "%hello" → "%") */
  private extractTypePrefix(token: string): string | undefined {
    const cleaned = token.replace(/^"|"$/g, '');
    if (cleaned.length === 0) return undefined;
    const first = cleaned.charAt(0);
    if ('#%@$^!*'.includes(first)) return first;
    return undefined;
  }

  /** Human-readable name for a type prefix */
  private prefixName(prefix: string): string {
    const names: Record<string, string> = {
      '#': 'integer',
      '%': 'string',
      '@': 'double',
      '!': 'float',
      '$': 'shortstring',
      '^': 'variant',
      '*': 'void',
    };
    return names[prefix] ?? 'unknown';
  }

  /** Generate an actionable fix suggestion */
  private generateFix(
    type: ViolationType,
    sent: { verb?: string; action?: string; separator?: string; args?: string[] },
    expected: { verb?: string; action?: string; separator?: string; argsPattern?: string[] },
    member: string
  ): string {
    switch (type) {
      case ViolationType.ACTION_MISMATCH:
        return (
          `In spo_session.ts, change RdoAction.${String(sent.action).toUpperCase()} ` +
          `to RdoAction.${String(expected.action).toUpperCase()} for ${member}. ` +
          `Verify against doc/spo-original-reference.md for the correct verb ` +
          `(property → get/set, function → call).`
        );
      case ViolationType.VERB_MISMATCH:
        return (
          `In spo_session.ts, change RdoVerb.${String(sent.verb).toUpperCase()} ` +
          `to RdoVerb.${String(expected.verb).toUpperCase()} for ${member}. ` +
          `'sel' selects an object by ID, 'idof' resolves an object name to ID.`
        );
      case ViolationType.SEPARATOR_MISMATCH:
        return (
          `In spo_session.ts, change separator from '${String(sent.separator)}' ` +
          `to '${String(expected.separator)}' for ${member}. ` +
          `Use .call() for '^' (function with return) or .push() for '*' (void procedure). ` +
          `See doc/spo-original-reference.md → RDO Dispatch Rules table.`
        );
      case ViolationType.ARG_COUNT_MISMATCH:
        return (
          `In spo_session.ts, ${member} expects ` +
          `${expected.argsPattern?.length ?? 0} arg(s) ` +
          `but ${sent.args?.length ?? 0} were sent. ` +
          `Check the method signature in doc/spo-original-reference.md.`
        );
      default:
        return `Check ${member} in doc/spo-original-reference.md for the correct protocol format.`;
    }
  }

  /** Format a single violation into an AI-friendly string */
  private formatViolation(v: RdoViolation): string {
    const lines: string[] = [];

    lines.push(`RDO STRICT VALIDATION ${v.severity} [${v.exchangeId}]:`);
    lines.push(v.message);
    lines.push('');
    lines.push(`SENT:     ${v.sentCommand}`);

    // Build expected summary from matchKeys
    const expectedParts: string[] = [];
    if (v.expected.verb) expectedParts.push(v.expected.verb);
    if (v.expected.action) expectedParts.push(v.expected.action);
    if (v.expected.member) expectedParts.push(v.expected.member);
    if (v.expected.separator) expectedParts.push(`"${v.expected.separator}"`);
    if (v.expected.argsPattern) expectedParts.push(v.expected.argsPattern.join(','));
    if (expectedParts.length > 0) {
      lines.push(`EXPECTED: ${expectedParts.join(' ')} (from matchKeys)`);
    }

    lines.push('');
    lines.push(`FIX: ${v.fix}`);
    if (v.docRef) {
      lines.push(`REF: ${v.docRef}`);
    }

    return lines.join('\n');
  }
}
