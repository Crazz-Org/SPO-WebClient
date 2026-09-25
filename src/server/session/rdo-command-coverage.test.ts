import { KNOWN_RDO_COMMANDS, RDO_SET_PROPERTIES } from './building-property-handler';
import { RDO_MEMBERS } from '../../shared/rdo-members';
import * as templateGroups from '../../shared/building-details/template-groups';
import type { RdoCommandMapping } from '../../shared/building-details/property-definitions';

/**
 * The UI and the gateway must agree on the command vocabulary.
 *
 * Since M-D, an unmapped property name is refused instead of being forwarded to
 * the server verbatim. That is the right behaviour — the old fallback turned a
 * mapping bug into a silent no-op on the wire — but it means a command declared
 * in a UI mapping and missing from KNOWN_RDO_COMMANDS now fails at runtime, in
 * front of the user, on a control that used to appear to work.
 *
 * This test is the compile-time-ish guard for that: it fails the moment the two
 * sides drift, instead of waiting for someone to click the control.
 */

/** Every `command` string declared across the shared rdoCommands mappings. */
function declaredCommands(): Set<string> {
  const found = new Set<string>();

  for (const group of Object.values(templateGroups)) {
    const rdoCommands = (group as { rdoCommands?: Record<string, RdoCommandMapping> })?.rdoCommands;
    if (!rdoCommands) continue;
    for (const mapping of Object.values(rdoCommands)) {
      if (mapping?.command) found.add(mapping.command);
    }
  }
  return found;
}

describe('UI command vocabulary vs gateway allowlist', () => {
  it('declares at least the commands we know the UI ships', () => {
    // Sanity: if the scan finds nothing, the assertion below is vacuous.
    expect(declaredCommands().size).toBeGreaterThan(20);
  });

  it('has no UI command the gateway would refuse', () => {
    // `property` is not an RDO member — it is the marker for a direct SET, and
    // setBuildingProperty handles it before the allowlist is consulted.
    const orphans = [...declaredCommands()]
      .filter(command => command !== 'property')
      .filter(command => !KNOWN_RDO_COMMANDS.has(command));

    expect(orphans).toEqual([]);
  });
});

describe('KNOWN_RDO_COMMANDS kinds', () => {
  // Every command on the list is emitted with rdoCall(...) — "*" with no QueryId,
  // safe only on a procedure. The one exemption is derived from the routing
  // constant that sends a name to rdoSet before the call branch is reached.
  const callable = [...KNOWN_RDO_COMMANDS].filter((c) => !RDO_SET_PROPERTIES.has(c));
  const members = RDO_MEMBERS as Record<string, { kind: string; access?: readonly string[] }>;
  const isCatalogued = (c: string): boolean => Object.prototype.hasOwnProperty.call(RDO_MEMBERS, c);

  it('every call-routed entry is a catalogued procedure', () => {
    const offenders = callable.filter((c) => !isCatalogued(c) || members[c].kind !== 'procedure');
    expect(offenders).toEqual([]);
  });

  it('is not vacuous', () => {
    expect(callable.length).toBeGreaterThan(30);
  });

  it('every RDO_SET_PROPERTIES entry is a catalogued settable accessor', () => {
    const offenders = [...RDO_SET_PROPERTIES].filter(
      (c) => !isCatalogued(c) || members[c].kind !== 'accessor' || !(members[c].access ?? []).includes('set')
    );
    expect(offenders).toEqual([]);
  });

  it('the set-routed exemption is exactly RDOAcceptCloning', () => {
    expect([...RDO_SET_PROPERTIES]).toEqual(['RDOAcceptCloning']);
  });
});
