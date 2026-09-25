/**
 * src/shared/rdo-frame.ts
 *
 * The five outgoing RDO frame forms, as a discriminated union, plus the four
 * builders that produce them.
 *
 * ## What this replaces
 *
 * Before this module a call site restated, by hand, three things the member
 * already determines:
 *
 * ```ts
 * await ctx.sendRdoRequest('world', {
 *   verb: RdoVerb.SEL, targetId, action: RdoAction.CALL, member: 'ObjectAt',
 *   separator: '"^"',                                   // <- retyped, 210 times
 *   args: [RdoValue.int(x).format(), RdoValue.int(y).format()],  // <- .format() at the call site
 * }, undefined, TimeoutCategory.NORMAL);
 * ```
 *
 * `separator` is not a choice: it follows from the member's `kind` in
 * `rdo-members.ts` — `function` takes `"^"`, `procedure` takes `"*"`. Retyping
 * it at every site is what let a wrong one through. Here it is derived, never
 * passed, and it does not appear in the public surface at all. Likewise the
 * argument count is checked against the catalogue, and `.format()` moves into
 * the engine: call sites hand over `RdoValue` objects.
 *
 * ## Two checks, not one
 *
 * The builders take `RdoMemberName`, so an uncatalogued member is a **compile**
 * error at the ~107 sites that name one literally. The two sites that choose a
 * member at runtime — the property path of `building-property-handler` — reach
 * that type through the `isCataloguedRdoMember` type guard, which narrows
 * `string` to `RdoMemberName` without a cast. They therefore keep a **runtime**
 * check and gain the static one; nothing is traded away. Arity and access are
 * checked at runtime in both cases, since neither is expressible in the
 * parameter type.
 *
 * ## The five forms
 *
 * `SEL`/`IDOF` crossed with `CALL`/`GET`/`SET`, as actually emitted:
 *
 * | form | frame | builder |
 * |------|-------|---------|
 * | idof | `C idof "<name>"` | {@link rdoIdOf} |
 * | call on a `function`  | `C sel <id> call <M> "^" <args>` | {@link rdoCall} |
 * | call on a `procedure` | `C sel <id> call <M> "*" <args>` | {@link rdoCall} |
 * | get  | `C sel <id> get <P>` | {@link rdoGet} |
 * | set  | `C sel <id> set <P>=<v>` | {@link rdoSet} |
 *
 * ## Byte-identity
 *
 * This module does not format anything itself. {@link RdoFrame.packet} yields
 * the same `Partial<RdoPacket>` the call sites built by hand, and
 * {@link RdoFrame.toFrame} delegates to `RdoCommand`, the builder the
 * fire-and-forget sites already used. The engine — `rdo-types.ts` and
 * `server/rdo.ts` — is untouched, so the bytes cannot move: the only change is
 * *who* decides the separator and *where* `.format()` runs.
 */

import {
  RdoValue,
  RdoCommand,
  assertValidRdoIdentifier,
} from './rdo-types';
import { RDO_MEMBERS, isCataloguedRdoMember } from './rdo-members';
import type { RdoMemberName } from './rdo-members';
import { RdoVerb, RdoAction } from './types';
import type { RdoPacket } from './types';

/**
 * One outgoing frame, before a QueryId is assigned.
 *
 * `call` carries the member's `kind` rather than a separator: the separator is
 * derived from it at build time and never crosses this boundary.
 */
export type RdoFrameSpec =
  | { readonly form: 'idof'; readonly targetId: string }
  | {
      readonly form: 'call';
      readonly targetId: string;
      readonly member: RdoMemberName;
      readonly kind: 'function' | 'procedure';
      readonly args: readonly RdoValue[];
    }
  | { readonly form: 'get'; readonly targetId: string; readonly member: RdoMemberName }
  | {
      readonly form: 'set';
      readonly targetId: string;
      readonly member: RdoMemberName;
      readonly value: RdoValue;
    };

/**
 * A built frame, consumable either way the transport needs it.
 *
 * Two consumers exist and they take different shapes — a request needs a packet
 * so `executeRdoRequest` can stamp a QueryId onto it, a fire-and-forget push
 * needs the finished string. Producing both from one object is what lets a call
 * site state the frame once, regardless of how it is sent.
 */
export interface RdoFrame {
  /** The frame, as it was described. */
  readonly spec: RdoFrameSpec;
  /** Shape for `sendRdoRequest` — the QueryId is added downstream. */
  readonly packet: Partial<RdoPacket>;
  /** Finished frame for `writeRdoFrame`, terminator included. */
  toFrame(): string;
}

/** Thrown when a frame contradicts the catalogue. */
export class RdoFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RdoFrameError';
  }
}

/**
 * Look a member up, or say precisely why it cannot be emitted.
 *
 * The builders take `RdoMemberName`, so an uncatalogued literal is already a
 * compile error and this cannot fire from a well-typed site. It stays because
 * the two runtime-named sites reach `RdoMemberName` through the
 * `isCataloguedRdoMember` type guard, and a future one could reach it through a
 * cast instead — at which point this is the only thing left between a
 * browser-supplied string and the wire.
 */
function specOf(member: string, context: string) {
  if (!isCataloguedRdoMember(member)) {
    throw new RdoFrameError(
      `RDO ${context} ${JSON.stringify(member)} is not in RDO_MEMBERS. A member is ` +
      `catalogued from the call sites that emit it (src/shared/rdo-members.ts); ` +
      `emitting one that is absent means nothing established its wire form.`
    );
  }
  return RDO_MEMBERS[member];
}

/** `sel` takes a decimal object id; the engine rejects `0` as a null pointer. */
function normaliseTarget(targetId: string | number): string {
  return typeof targetId === 'number' ? targetId.toString() : targetId;
}

function build(spec: RdoFrameSpec): RdoFrame {
  return {
    spec,
    get packet(): Partial<RdoPacket> {
      switch (spec.form) {
        case 'idof':
          return { verb: RdoVerb.IDOF, targetId: spec.targetId };
        case 'call':
          return {
            verb: RdoVerb.SEL,
            targetId: spec.targetId,
            action: RdoAction.CALL,
            member: spec.member,
            // The whole point of the module: derived, never passed in.
            separator: spec.kind === 'function' ? '"^"' : '"*"',
            args: spec.args.map(a => a.format()),
          };
        case 'get':
          return {
            verb: RdoVerb.SEL,
            targetId: spec.targetId,
            action: RdoAction.GET,
            member: spec.member,
          };
        case 'set':
          return {
            verb: RdoVerb.SEL,
            targetId: spec.targetId,
            action: RdoAction.SET,
            member: spec.member,
            args: [spec.value.format()],
          };
      }
    },
    toFrame(): string {
      switch (spec.form) {
        case 'idof':
          // No site emits idof without a QueryId — all eight resolve a name and
          // read the answer. There is no established form to reproduce here.
          throw new RdoFrameError(
            'idof cannot be sent fire-and-forget: it exists to read an object id, ' +
            'so it needs a QueryId. Send it through sendRdoRequest.'
          );
        case 'call': {
          const cmd = RdoCommand.sel(spec.targetId).call(spec.member);
          (spec.kind === 'function' ? cmd.method() : cmd.push());
          return cmd.args(...spec.args).build();
        }
        case 'get':
          return RdoCommand.sel(spec.targetId).get(spec.member).build();
        case 'set':
          return RdoCommand.sel(spec.targetId).set(spec.member).args(spec.value).build();
      }
    },
  };
}

/**
 * `C idof "<name>"` — resolve a published object name to its id.
 *
 * The name is a bare quoted string with no type prefix; the engine doubles any
 * `"` it contains. Not catalogued: `idof` names an object, not a member.
 */
export function rdoIdOf(objectName: string): RdoFrame {
  if (!objectName) {
    throw new RdoFrameError('idof needs an object name');
  }
  return build({ form: 'idof', targetId: objectName });
}

/**
 * `C sel <id> call <member> <sep> <args>` — the separator comes from the
 * member's `kind`, the argument count is checked against its `arity`.
 *
 * @throws {RdoFrameError} if the member is uncatalogued, is an accessor, or the
 *         argument count differs from the catalogued arity
 */
export function rdoCall(
  member: RdoMemberName,
  targetId: string | number,
  ...args: RdoValue[]
): RdoFrame {
  const spec = specOf(member, 'call');
  if (spec.kind === 'accessor') {
    throw new RdoFrameError(
      `RDO call ${member} is catalogued as an accessor (${spec.access.join('/')}), ` +
      `not a callable. Use ` +
      `${(spec.access as readonly string[]).includes('get') ? 'rdoGet' : 'rdoSet'}.`
    );
  }
  if (args.length !== spec.arity) {
    throw new RdoFrameError(
      `RDO call ${member} takes ${spec.arity} argument(s), got ${args.length}. ` +
      `The dispatcher reads its parameters from the received array, so a count ` +
      `that differs from the emitted form is not a type error, it is a different call.`
    );
  }
  return build({
    form: 'call',
    targetId: normaliseTarget(targetId),
    member,
    kind: spec.kind,
    args,
  });
}

/**
 * `C sel <id> get <property>`.
 *
 * @throws {RdoFrameError} if the member is uncatalogued or is not read this way
 */
export function rdoGet(member: RdoMemberName, targetId: string | number): RdoFrame {
  const spec = specOf(member, 'get');
  if (spec.kind !== 'accessor' || !(spec.access as readonly string[]).includes('get')) {
    throw new RdoFrameError(
      `RDO get ${member} is not a catalogued read: it is emitted as a ${spec.kind}.`
    );
  }
  return build({ form: 'get', targetId: normaliseTarget(targetId), member });
}

/**
 * `C sel <id> set <property>=<value>`.
 *
 * @throws {RdoFrameError} if the member is uncatalogued or is not written this way
 */
export function rdoSet(member: RdoMemberName, targetId: string | number, value: RdoValue): RdoFrame {
  const spec = specOf(member, 'set');
  if (spec.kind !== 'accessor' || !(spec.access as readonly string[]).includes('set')) {
    throw new RdoFrameError(
      `RDO set ${member} is not a catalogued write: it is emitted as a ${spec.kind}.`
    );
  }
  // Belt and braces: the catalogue is a closed set, so this cannot fire today,
  // but `set` is the one path that takes a browser-chosen name (see the header
  // of rdo-members.ts) and the grammar splices the name in unquoted.
  assertValidRdoIdentifier(member, 'set');
  return build({
    form: 'set',
    targetId: normaliseTarget(targetId),
    member,
    value,
  });
}

/**
 * Members whose catalogue kind is `procedure` — the only kind that may be sent
 * fire-and-forget (`.toFrame()`, no QueryId). `"^"` with no rid on a `function`
 * builds a reply with no destination: the server crashes.
 */
export type RdoProcedureName = {
  [K in RdoMemberName]: (typeof RDO_MEMBERS)[K]['kind'] extends 'procedure' ? K : never;
}[RdoMemberName];

/** True when `name` is catalogued with kind `procedure`. */
export function isCataloguedRdoProcedure(name: string): name is RdoProcedureName {
  return isCataloguedRdoMember(name) && RDO_MEMBERS[name].kind === 'procedure';
}
