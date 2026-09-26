/**
 * cacher-object-pool.ts — the Map Service cacher's temporary-object calls
 * (CreateObject / SetObject / SetPath / GetPropertyList / CloseObject).
 *
 * Moved out of `StarpeaceSession` (issue 954), verbatim. This module is the only
 * place these five cacher frames are built: `StarpeaceSession` delegates its
 * `cacher*` methods here, and the test fake (`makeSessionCtx` with
 * `wireCacher: true`) calls the same functions over its own recording
 * `sendRdoRequest`, so an L1 scenario can answer a cacher read.
 * Each function takes `ctx: SessionContext` as its first argument.
 */

import type { SessionContext } from './session-context';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { cleanPayload, writeRdoFrame } from '../rdo-helpers';
import { toErrorMessage } from '../../shared/error-utils';

export async function createObject(ctx: SessionContext): Promise<string> {
  if (!ctx.cacherId) throw new Error('Missing cacherId');
  if (!ctx.currentWorldInfo?.name) throw new Error('Missing world name for CreateObject');
  const packet = await ctx.sendRdoRequest('map', rdoCall(
    'CreateObject', ctx.cacherId,
    RdoValue.string(ctx.currentWorldInfo.name),
  ).packet, undefined, TimeoutCategory.SLOW);
  return cleanPayload(packet.payload || '');
}

/**
 * VERIFIED [HIGH-02]: SetObject with critical delay
 * This method MUST be called before GetPropertyList to populate server cache
 */
export async function setObject(ctx: SessionContext, tempObjectId: string, x: number, y: number): Promise<void> {
  await ctx.sendRdoRequest('map', rdoCall(
    'SetObject', tempObjectId,
    RdoValue.int(x),
    RdoValue.int(y),
  ).packet, undefined, TimeoutCategory.SLOW);
  // Brief delay for server to populate cache (reduced from 100ms)
  await new Promise(resolve => setTimeout(resolve, 30));
}

export async function setPath(ctx: SessionContext, tempObjectId: string, path: string): Promise<void> {
  await ctx.sendRdoRequest('map', rdoCall(
    'SetPath', tempObjectId,
    RdoValue.string(path),
  ).packet, undefined, TimeoutCategory.SLOW);
  // No delay needed — Delphi SetPath is synchronous (loads file inline before responding)
}

export async function getPropertyList(ctx: SessionContext, tempObjectId: string, propertyNames: string[]): Promise<string[]> {
  const query = propertyNames.join('\t') + '\t';
  const packet = await ctx.sendRdoRequest('map', rdoCall(
    'GetPropertyList', tempObjectId,
    RdoValue.string(query),
  ).packet, undefined, TimeoutCategory.NORMAL);
  // Extract tab-delimited values WITHOUT trimming — cleanPayload's .trim()
  // strips leading/trailing tabs, destroying empty values at the boundaries.
  // The Delphi cache server always returns one value per requested property
  // (empty string for unknown properties), so positional alignment is critical.
  const rawPayload = packet.payload || '';
  let raw: string;
  const resMatch = rawPayload.match(/^res="((?:[^"]|"")*)"$/);
  if (resMatch) {
    raw = resMatch[1].replace(/""/g, '"');
    // Strip OLE string type prefix (%) but NOT whitespace/tabs
    if (raw.length > 0 && ['#', '%', '@', '$', '^', '!', '*'].includes(raw[0])) {
      raw = raw.substring(1);
    }
  } else {
    raw = cleanPayload(rawPayload);
  }

  // Tab-split: the Delphi server appends TAB after each value, so we get
  // N values + 1 trailing empty from the final tab. Trim individual values
  // (spaces only, not tabs) but preserve empty strings for missing properties.
  const values = raw.split('\t').map(v => v.trim());
  // Remove trailing empty element from the final TAB delimiter
  if (values.length > 0 && values[values.length - 1] === '') {
    values.pop();
  }
  if (values.length < propertyNames.length) {
    ctx.log.warn(
      `[cacherGetPropertyList] Response has ${values.length} values for ${propertyNames.length} requested properties`
    );
    ctx.log.warn(`[cacherGetPropertyList] Requested: ${propertyNames.join(', ')}`);
    ctx.log.warn(`[cacherGetPropertyList] Received: ${values.map((v, i) => `[${i}]="${v}"`).join(', ')}`);
  }
  return values;
}

export function closeObject(ctx: SessionContext, tempObjectId: string): void {
  if (!ctx.cacherId) return;
  const socket = ctx.getSocket('map');
  if (!socket) return;
  // CloseObject is a Delphi procedure (void) — fire-and-forget, no QueryId.
  // Delphi: procedure CloseObject(Obj: integer)
  try {
    const cmd = rdoCall('CloseObject', ctx.cacherId, RdoValue.int(parseInt(tempObjectId, 10))).toFrame();
    writeRdoFrame(socket, cmd);
  } catch (e: unknown) {
    ctx.log.warn('[cacherCloseObject] Failed:', toErrorMessage(e));
  }
}
