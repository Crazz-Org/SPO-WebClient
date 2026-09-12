/**
 * PropertyGroup utility functions — pure logic helpers for building property rendering.
 *
 * Extracted from PropertyGroup.tsx to reduce file size and improve testability.
 */

import type { BuildingPropertyValue } from '@/shared/types';
import type { RdoCommandMapping } from '@/shared/building-details';

// =============================================================================
// RDO COMMAND RESOLUTION
// =============================================================================

/**
 * Resolve a raw property name to the correct RDO command and params.
 * Uses the group's rdoCommands mapping to translate property names like
 * 'srvPrices0' → { command: 'RDOSetPrice', params: { index: '0' } }
 * 'Stopped' → { command: 'property', params: { propertyName: 'Stopped' } }
 */
export function resolveRdoCommand(
  propertyName: string,
  rdoCommands?: Record<string, RdoCommandMapping>,
): { command: string; params?: Record<string, string> } {
  if (!rdoCommands) {
    return { command: propertyName };
  }

  // Direct match (non-indexed): e.g., 'Stopped' → { command: 'property' }
  if (rdoCommands[propertyName]) {
    const mapping = rdoCommands[propertyName];
    if (mapping.command === 'property') {
      return { command: 'property', params: { propertyName, ...mapping.params } };
    }
    return { command: mapping.command, params: mapping.params };
  }

  // Indexed match: strip trailing digits to find base name.
  // e.g., 'srvPrices0' → base='srvPrices', index='0'
  const match = propertyName.match(/^(.+?)(\d+)$/);
  if (match) {
    const [, baseName, indexStr] = match;
    const mapping = rdoCommands[baseName];
    // M-C: `allSalaries` was declared on the Salaries mapping and read nowhere.
    // Only `indexed` was honoured, so `Salaries0` matched nothing, fell through
    // to the passthrough at the bottom of this function, and was sent to the
    // server as `call Salaries0` — a member it does not publish. The edit did
    // nothing, silently. Both flags mean "this name carries a trailing index".
    if (mapping?.indexed || mapping?.allSalaries) {
      const params: Record<string, string> = { index: indexStr, ...mapping.params };
      if (mapping.command === 'property') {
        return { command: 'property', params: { propertyName, ...params } };
      }
      return { command: mapping.command, params };
    }
  }

  // Mid-index match for columnSuffix patterns: digits embedded in middle.
  // e.g., 'Tax0Percent' → prefix='Tax', index='0', suffix='Percent' → key='TaxPercent'
  const midMatch = propertyName.match(/^(.*?)(\d+)(.+)$/);
  if (midMatch) {
    const [, prefix, indexStr, suffix] = midMatch;
    const compositeKey = prefix + suffix;
    const mapping = rdoCommands[compositeKey];
    if (mapping?.indexed) {
      const params: Record<string, string> = { index: indexStr, ...mapping.params };
      if (mapping.command === 'property') {
        return { command: 'property', params: { propertyName, ...params } };
      }
      return { command: mapping.command, params };
    }
  }

  // No mapping found — pass through as-is
  return { command: propertyName };
}

/**
 * Collect the full salary triplet for an `RDOSetSalaries` call.
 *
 * The server writes all three salaries in one command, so editing one means
 * resending the other two unchanged. Sending only the edited value made the
 * gateway default the other two — to the value just typed, overwriting them
 * silently (M-C). The gateway now refuses a partial triplet, so the three
 * values have to be assembled here, where the current ones are known.
 *
 * @param properties  the building's current property values
 * @param editedIndex '0' | '1' | '2' — the salary the user changed
 * @param newValue    its new value
 */
export function collectSalaryTriplet(
  properties: BuildingPropertyValue[],
  editedIndex: string,
  newValue: number,
): Record<string, string> {
  const current = new Map<string, string>();
  for (const p of properties) current.set(p.name, p.value);

  const triplet: Record<string, string> = {};
  for (let i = 0; i < 3; i++) {
    triplet[`salary${i}`] = String(i === Number(editedIndex)
      ? newValue
      : parseInt(current.get(`Salaries${i}`) ?? '0', 10) || 0);
  }
  return triplet;
}

/**
 * Build the exact `additionalParams` an `RDOSetSalaries` update travels with:
 * the resolved mapping params (the edited index) plus the full triplet.
 *
 * The workforce editor and the emitter must produce the SAME object, key order
 * included. `setBuildingProperty` derives its pending key from
 * `JSON.stringify(additionalParams)`, so a triplet assembled differently is a
 * different key, and the save indicator subscribed to it never lights up.
 * One function, two callers, no drift.
 */
export function buildSalaryParams(
  properties: BuildingPropertyValue[],
  resolvedParams: Record<string, string> | undefined,
  newValue: number,
): Record<string, string> {
  const index = resolvedParams?.index ?? '0';
  return { ...resolvedParams, ...collectSalaryTriplet(properties, index, newValue) };
}

/**
 * Class indices whose cached `WorkersMax{i}` is above zero — the only ones
 * Voyager polled (`Voyager/WorkforceSheet.pas:365-377` skips a class whose
 * cached maximum is zero, and so costs no call for it).
 *
 * Lives here rather than in the `.tsx` so the node-side protocol test can
 * import it without React or CSS modules.
 */
export function workerPollKinds(properties: BuildingPropertyValue[]): number[] {
  const current = new Map<string, string>();
  for (const p of properties) current.set(p.name, p.value);

  const kinds: number[] = [];
  for (let i = 0; i < 3; i++) {
    if ((parseFloat(current.get(`WorkersMax${i}`) ?? '0') || 0) > 0) kinds.push(i);
  }
  return kinds;
}

/**
 * The pending-update key `setBuildingProperty` will register for this command,
 * mirroring building-action-handler.ts: "command" or "command:{...params}".
 */
export function pendingKeyFor(
  command: string,
  params?: Record<string, string>,
): string {
  return params ? `${command}:${JSON.stringify(params)}` : command;
}

/**
 * Compute the pending-update key for a property, matching the key format
 * used in client.ts setBuildingProperty: "command" or "command:{"index":"0"}"
 */
export function computePendingKey(
  rdoName: string,
  rdoCommands?: Record<string, RdoCommandMapping>,
): string {
  const { command, params } = resolveRdoCommand(rdoName, rdoCommands);
  return pendingKeyFor(command, params);
}

// `checkIsMayor` lived here. It never compared the ruler to the player — it
// returned true whenever the town had a mayor at all — so it granted the town
// tab to every visitor. Replaced by `grantAccess` from '@/shared/security-id',
// which asks whether this player's tycoon id is in this facility's id list, the
// test Voyager itself performs (`Protocol/Protocol.pas:428-431`).

/**
 * Parse pipe-delimited CloneMenu0 value into option pairs.
 * Delphi format: "Label|decimalValue|Label|decimalValue|..."
 * Archaeology: ManagementSheet.pas:137-149, CompStringsParser.pas:93-116
 */
export function parseCloneMenu(value: string): Array<{ label: string; value: number }> {
  if (!value) return [];
  const parts = value.split('|').filter(s => s.length > 0);
  const options: Array<{ label: string; value: number }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const label = parts[i].trim();
    const numVal = parseInt(parts[i + 1], 10);
    if (label && !isNaN(numVal)) {
      options.push({ label, value: numVal });
    }
  }
  return options;
}

export function getColorClass(num: number, colorCode?: string): string {
  if (!colorCode) return '';
  if (colorCode === 'positive') return 'positive';
  if (colorCode === 'negative') return 'negative';
  if (colorCode === 'auto') {
    if (num > 0) return 'positive';
    if (num < 0) return 'negative';
  }
  return '';
}
