/**
 * RDO Command Matcher for the mock server.
 * Matches incoming RDO command strings to captured exchanges
 * and returns the appropriate response.
 */

import { RdoProtocol } from '@/server/rdo';
import { RdoAction, type RdoPacket } from '@/shared/types/protocol-types';
import type { RdoExchange, RdoScenario } from './types/rdo-exchange-types';
import { substituteVariables, mergeVariables } from './scenarios/scenario-variables';
import type { ScenarioVariables } from './scenarios/scenario-variables';

/** Result from matching an RDO command */
export interface RdoMatchResult {
  exchange: RdoExchange;
  response: string;
  pushes: string[];
}

/**
 * RdoMock — matches incoming RDO commands to captured exchange data.
 *
 * Matching hierarchy (first match wins):
 * 1. Exact match: verb + targetId + action + member + all args
 * 2. Key field match: verb + action + member (wildcard targetId)
 * 3. Method match: action + member only
 * 4. Nth occurrence: same method, return next unconsumed
 */
export class RdoMock {
  private exchanges: RdoExchange[] = [];
  private consumed: Set<string> = new Set();
  private consumptionCount: Map<string, number> = new Map();

  /**
   * The bare property name to match on. `RdoProtocol.parse` folds a SET command's value into
   * `member` (e.g. `EnableEvents="#-1"`, `src/server/rdo.ts`'s get/set branch) — a scenario's
   * `matchKeys.member` names only the property, so a SET command has to be trimmed back to it
   * before comparison.
   */
  private static memberName(parsed: RdoPacket): string | undefined {
    if (parsed.action !== RdoAction.SET || !parsed.member) return parsed.member;
    const eq = parsed.member.indexOf('=');
    return eq === -1 ? parsed.member : parsed.member.slice(0, eq);
  }

  addScenario(scenario: RdoScenario): void {
    this.exchanges.push(...scenario.exchanges);
  }

  addExchange(exchange: RdoExchange): void {
    this.exchanges.push(exchange);
  }

  match(
    rawCommand: string,
    vars?: Partial<ScenarioVariables>
  ): RdoMatchResult | null {
    const parsed = RdoProtocol.parse(rawCommand);
    const resolved = mergeVariables(vars);

    // Try matching strategies in order
    const matched =
      this.exactMatch(parsed) ??
      this.keyFieldMatch(parsed) ??
      this.methodMatch(parsed) ??
      this.nthOccurrenceMatch(parsed);

    if (!matched) return null;

    // Track consumption
    const count = (this.consumptionCount.get(matched.id) ?? 0) + 1;
    this.consumptionCount.set(matched.id, count);
    this.consumed.add(matched.id);

    return {
      exchange: matched,
      response: substituteVariables(matched.response, resolved),
      pushes: (matched.pushes ?? []).map(p => substituteVariables(p, resolved)),
    };
  }

  /** Get set of consumed exchange IDs */
  getConsumedIds(): Set<string> {
    return new Set(this.consumed);
  }

  reset(): void {
    this.consumed.clear();
    this.consumptionCount.clear();
  }

  clearScenarios(): void {
    this.exchanges = [];
    this.reset();
  }

  private exactMatch(parsed: RdoPacket): RdoExchange | null {
    const member = RdoMock.memberName(parsed);
    for (const ex of this.exchanges) {
      if (!ex.matchKeys || ex.pushOnly) continue;
      const mk = ex.matchKeys;

      const verbOk = mk.verb === undefined || mk.verb === parsed.verb;
      const targetOk = mk.targetId === undefined || mk.targetId === '*' || mk.targetId === parsed.targetId;
      const actionOk = mk.action === undefined || mk.action === parsed.action;
      const memberOk = mk.member === undefined || mk.member === member;
      const argsOk = mk.argsPattern === undefined || this.argsMatch(mk.argsPattern, parsed.args);

      if (verbOk && targetOk && actionOk && memberOk && argsOk) {
        // For exact match, all 5 fields must be specified
        if (mk.verb && mk.targetId && mk.targetId !== '*' && mk.action && mk.member && mk.argsPattern) {
          return ex;
        }
      }
    }

    return null;
  }

  private keyFieldMatch(parsed: RdoPacket): RdoExchange | null {
    const member = RdoMock.memberName(parsed);
    // First pass: try exchanges that have argsPattern (most specific)
    for (const ex of this.exchanges) {
      if (!ex.matchKeys || ex.pushOnly) continue;
      const mk = ex.matchKeys;
      if (!mk.argsPattern) continue;

      const verbOk = mk.verb === undefined || mk.verb === parsed.verb;
      const actionOk = mk.action === undefined || mk.action === parsed.action;
      const memberOk = mk.member === undefined || mk.member === member;
      const targetWildcard = mk.targetId === undefined || mk.targetId === '*';
      const argsOk = this.argsMatch(mk.argsPattern, parsed.args);

      if (verbOk && actionOk && memberOk && targetWildcard && mk.member && argsOk) {
        return ex;
      }
    }

    // Second pass: exchanges without argsPattern (wildcard args)
    for (const ex of this.exchanges) {
      if (!ex.matchKeys || ex.pushOnly) continue;
      const mk = ex.matchKeys;
      if (mk.argsPattern) continue;

      const verbOk = mk.verb === undefined || mk.verb === parsed.verb;
      const actionOk = mk.action === undefined || mk.action === parsed.action;
      const memberOk = mk.member === undefined || mk.member === member;
      const targetWildcard = mk.targetId === undefined || mk.targetId === '*';

      if (verbOk && actionOk && memberOk && targetWildcard && mk.member) {
        return ex;
      }
    }
    return null;
  }

  private methodMatch(parsed: RdoPacket): RdoExchange | null {
    const member = RdoMock.memberName(parsed);
    for (const ex of this.exchanges) {
      if (!ex.matchKeys || ex.pushOnly) continue;
      const mk = ex.matchKeys;

      if (mk.member && mk.member === member) {
        return ex;
      }
    }
    return null;
  }

  private nthOccurrenceMatch(parsed: RdoPacket): RdoExchange | null {
    // Find exchanges matching by member, return next unconsumed or wrap around
    const member = RdoMock.memberName(parsed);
    const candidates = this.exchanges.filter(ex => {
      if (!ex.matchKeys?.member || ex.pushOnly) return false;
      return ex.matchKeys.member === member;
    });

    if (candidates.length === 0) {
      // Try matching by verb (for idof commands)
      if (parsed.verb === 'idof' && parsed.targetId) {
        const idofCandidates = this.exchanges.filter(ex =>
          !ex.pushOnly &&
          ex.matchKeys?.verb === 'idof' && (
            ex.matchKeys?.targetId === parsed.targetId ||
            ex.matchKeys?.targetId === '*'
          )
        );
        if (idofCandidates.length > 0) return idofCandidates[0];
      }
      return null;
    }

    // Find first unconsumed
    const unconsumed = candidates.find(c => !this.consumed.has(c.id));
    if (unconsumed) return unconsumed;

    // Wrap around — return the first candidate
    return candidates[0];
  }

  private argsMatch(pattern: string[], actual: string[] | undefined): boolean {
    if (!actual) return pattern.length === 0;
    if (pattern.length > actual.length) return false;

    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] !== '*' && pattern[i] !== actual[i]) {
        // Strip quotes for comparison
        const stripped = actual[i].replace(/^"|"$/g, '');
        const patStripped = pattern[i].replace(/^"|"$/g, '');
        if (stripped !== patStripped) return false;
      }
    }
    return true;
  }
}
