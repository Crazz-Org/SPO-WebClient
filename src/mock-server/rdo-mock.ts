/**
 * RDO Command Matcher for the mock server.
 * Matches incoming RDO command strings to captured exchanges
 * and returns the appropriate response.
 */

import { RdoProtocol } from '@/server/rdo';
import { RdoAction, type RdoPacket } from '@/shared/types/protocol-types';
import { RdoParser } from '@/shared/rdo-types';
import type { RdoExchange, RdoMatchKey, RdoScenario } from './types/rdo-exchange-types';
import { substituteVariables, mergeVariables } from './scenarios/scenario-variables';
import type { ScenarioVariables } from './scenarios/scenario-variables';

/** Result from matching an RDO command */
export interface RdoMatchResult {
  exchange: RdoExchange;
  response: string;
  pushes: string[];
}

/**
 * Split a SET packet's glued `Name=<value>` member (how `RdoProtocol.parse` reads the emitter's
 * `set Name="#v"` form) into the bare property name and the value as the single argument, in the
 * same `<prefix><value>` shape CALL args take. Any other packet is returned unchanged.
 * Shared by RdoMock and RdoStrictValidator so the two cannot drift.
 */
export function normalizeSetPacket(parsed: RdoPacket): RdoPacket {
  if (parsed.action !== RdoAction.SET || !parsed.member) return parsed;
  const eq = parsed.member.indexOf('=');
  if (eq === -1) return parsed;
  // A value containing whitespace was split by the parser; its tail landed in args.
  const rawValue = [parsed.member.slice(eq + 1), ...(parsed.args ?? [])].join(' ');
  const { prefix, value } = RdoParser.extract(rawValue);
  return { ...parsed, member: parsed.member.slice(0, eq), args: [prefix + value] };
}

/**
 * RdoMock — matches incoming RDO commands to captured exchange data.
 *
 * An exchange answers a frame only if EVERY key its `matchKeys` declares matches the frame:
 * a declared target must equal the frame's target, a declared `argsPattern` must have exactly
 * as many positions as the frame has args. Matching order (first match wins):
 * 1. Exact match: verb + specific targetId + action + member + argsPattern all declared and equal
 * 2. Key field match: every declared key equal (argsPattern exchanges first); an exchange that
 *    declares only a member (no verb/action/args, target absent or '*') is skipped here
 * 3. idof match: `idof` frame whose name equals an exchange's specific `targetId`
 * 4. Loose fallback: ONLY exchanges carrying a non-empty `looseMatch` reason — answers on the
 *    member name alone (or, for `idof`, the verb alone)
 * No strategy skips an already-consumed exchange.
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
    return normalizeSetPacket(parsed).member;
  }

  /** True when the exchange, by its own declaration, answers on the member name alone. */
  private static isMemberOnly(mk: RdoMatchKey): boolean {
    return (
      !!mk.member &&
      mk.verb === undefined &&
      mk.action === undefined &&
      mk.argsPattern === undefined &&
      (mk.targetId === undefined || mk.targetId === '*')
    );
  }

  /** True when the exchange opted into member-/verb-only matching with a written reason. */
  private static hasLooseReason(ex: RdoExchange): boolean {
    return typeof ex.looseMatch === 'string' && ex.looseMatch.trim() !== '';
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
      this.idofMatch(parsed) ??
      this.looseFallback(parsed);

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
    // First pass: exchanges that declare an argsPattern (most specific); second pass: the rest.
    for (const withArgs of [true, false]) {
      for (const ex of this.exchanges) {
        if (!ex.matchKeys || ex.pushOnly) continue;
        const mk = ex.matchKeys;
        if ((mk.argsPattern !== undefined) !== withArgs) continue;
        // A member-only exchange answers nothing here — only the loose fallback, with a reason.
        if (!mk.member || RdoMock.isMemberOnly(mk)) continue;

        const verbOk = mk.verb === undefined || mk.verb === parsed.verb;
        const actionOk = mk.action === undefined || mk.action === parsed.action;
        const memberOk = mk.member === member;
        const targetOk = mk.targetId === undefined || mk.targetId === '*' || mk.targetId === parsed.targetId;
        const argsOk = mk.argsPattern === undefined || this.argsMatch(mk.argsPattern, parsed.args);

        if (verbOk && actionOk && memberOk && targetOk && argsOk) {
          return ex;
        }
      }
    }
    return null;
  }

  /** An `idof` frame is verb + name, so an exchange naming that exact object is a full match. */
  private idofMatch(parsed: RdoPacket): RdoExchange | null {
    if (parsed.verb !== 'idof' || !parsed.targetId) return null;
    for (const ex of this.exchanges) {
      if (ex.pushOnly) continue;
      if (ex.matchKeys?.verb === 'idof' && ex.matchKeys.targetId === parsed.targetId) {
        return ex;
      }
    }
    return null;
  }

  /**
   * The only member-only (or, for `idof`, verb-only) path — reserved for exchanges that state
   * why in `looseMatch`.
   */
  private looseFallback(parsed: RdoPacket): RdoExchange | null {
    const isIdof = parsed.verb === 'idof';
    const member = RdoMock.memberName(parsed);
    for (const ex of this.exchanges) {
      if (ex.pushOnly || !ex.matchKeys || !RdoMock.hasLooseReason(ex)) continue;
      const mk = ex.matchKeys;
      if (isIdof) {
        if (mk.verb === 'idof' && (mk.targetId === undefined || mk.targetId === '*' || mk.targetId === parsed.targetId)) {
          return ex;
        }
      } else if (mk.member && mk.member === member) {
        return ex;
      }
    }
    return null;
  }

  private argsMatch(pattern: string[], actual: string[] | undefined): boolean {
    if (!actual) return pattern.length === 0;
    if (pattern.length !== actual.length) return false;

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
