/**
 * Road-reachability sweep for the connection picker (#584).
 *
 * A facility's cache object carries `NearCircuits`, the ids of the road circuits
 * its block touches, rendered as `"12,34,"` — comma-separated integers, with a
 * trailing comma (`~/SPO-Original/Kernel/KernelCache.pas:440` writes it, `:156-165`
 * `RenderCircuitStr` renders it). The reference search page sets
 * `search_obj.Circuits = cache_obj.NearCircuits` for the building being connected
 * (`~/SPO-ASP/Five/0/Visual/Clusters/Common/Includes/FiveSearchSite.inc:27`) and
 * prints `search_obj.Connected(i)` per row (`:43`), which is
 * `Result[i].Intercept(fCircuits)` (`~/SPO-Original/Cache/OutputSearchAuto.pas:203-211`,
 * `Cache/InputSearchAuto.pas:184-192`). `TFluidLink.Intercept`
 * (`~/SPO-Original/Cache/FluidLinks.pas:116-133`) returns false when either string
 * is empty (`:121`) and otherwise true iff any comma-token of one string appears
 * among the tokens of the other. The RDO `FindSuppliers`/`FindClients` reply does
 * not carry the candidate's circuits, so this module reads `NearCircuits` for the
 * building and for every candidate through the cacher object pool and applies
 * `Intercept` itself.
 *
 * The one thing it cannot take from the pool is `SetObject`: `ctx.cacherSetObject`
 * discards what the server answered, and that answer is the only thing that tells
 * "no facility at this position" from "a facility whose circuit string is empty".
 * Both read back as `''` — `SetObject` releases the previous object and answers
 * `fCachedObject <> nil` (`Cache Server/CachedObjectWrap.pas:127-139`), after which
 * `GetPropertyList` answers `''` on the released object (`:209-235`). So the sweep
 * emits its own `SetObject` and reads the boolean, exactly as `fetchGateDetails`
 * does with `SetPath` (`building-details-handler.ts:1297-1303`): a position that
 * did not load is `unknown`, never a false `not connected`.
 */

import type { SessionContext } from './session-context';
import type { ConnectionReachabilityEntry } from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { rdoCall } from '../../shared/rdo-frame';
import { RdoValue } from '../../shared/rdo-types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { cleanPayload, isTrueOrdinal } from '../rdo-helpers';

export const NEAR_CIRCUITS_PROP = 'NearCircuits';

/** The settle delay `cacherSetObject` applies before a read (`spo_session.ts:1447-1455`). */
const SET_OBJECT_SETTLE_MS = 30;

/** TFluidLink.Intercept (Cache/FluidLinks.pas:116-133): false if either side is empty (:121), else any shared token. */
export function circuitsIntersect(a: string, b: string): boolean {
  const tokensA = a.split(',').filter(t => t !== '');
  const tokensB = b.split(',').filter(t => t !== '');
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  return tokensA.some(t => tokensB.includes(t));
}

/**
 * Point the temp object at (x, y) and report whether anything loaded there.
 *
 * Same frame, socket, timeout and settle delay as `cacherSetObject`
 * (`spo_session.ts:1447-1455`) — only the answer is kept. Delphi wordbool true is
 * `#-1` on the wire, and any non-zero ordinal reads true (`isTrueOrdinal`).
 */
async function setObjectLoaded(
  ctx: SessionContext, tempObjectId: string, x: number, y: number,
): Promise<boolean> {
  const packet = await ctx.sendRdoRequest('map', rdoCall(
    'SetObject', tempObjectId,
    RdoValue.int(x),
    RdoValue.int(y),
  ).packet, undefined, TimeoutCategory.SLOW);
  // Brief delay for the server to populate the cache before the read.
  await new Promise(resolve => setTimeout(resolve, SET_OBJECT_SETTLE_MS));
  return isTrueOrdinal(cleanPayload(packet.payload || ''));
}

/** Read the loaded object's circuit string; `''` when the cache holds none. */
async function readNearCircuits(ctx: SessionContext, tempObjectId: string): Promise<string> {
  const values = await ctx.cacherGetPropertyList(tempObjectId, [NEAR_CIRCUITS_PROP]);
  return values[0] ?? '';
}

export async function resolveRoadReachability(
  ctx: SessionContext,
  buildingX: number, buildingY: number,
  positions: ReadonlyArray<{ x: number; y: number }>,
  isCurrent: () => boolean = () => true,
): Promise<ConnectionReachabilityEntry[]> {
  await ctx.connectMapService();
  if (!ctx.cacherId) {
    return positions.map(({ x, y }) => ({ x, y, connected: null }));
  }

  let tempObjectId: string;
  try {
    tempObjectId = await ctx.cacherCreateObject();
  } catch (e: unknown) {
    ctx.log.debug(`[ConnectionReachability] CreateObject failed: ${toErrorMessage(e)}`);
    return positions.map(({ x, y }) => ({ x, y, connected: null }));
  }

  try {
    let buildingCircuits: string;
    try {
      if (!(await setObjectLoaded(ctx, tempObjectId, buildingX, buildingY))) {
        ctx.log.debug(`[ConnectionReachability] SetObject loaded nothing at the building (${buildingX}, ${buildingY})`);
        return positions.map(({ x, y }) => ({ x, y, connected: null }));
      }
      buildingCircuits = await readNearCircuits(ctx, tempObjectId);
    } catch (e: unknown) {
      ctx.log.debug(`[ConnectionReachability] Building NearCircuits read failed: ${toErrorMessage(e)}`);
      return positions.map(({ x, y }) => ({ x, y, connected: null }));
    }

    const entries: ConnectionReachabilityEntry[] = [];
    for (const { x, y } of positions) {
      if (!isCurrent()) {
        entries.push({ x, y, connected: null });
        continue;
      }
      try {
        if (!(await setObjectLoaded(ctx, tempObjectId, x, y))) {
          // Nothing loaded: the cache would answer '' for every property, which
          // circuitsIntersect would read as "not connected". Unknown is the truth.
          ctx.log.debug(`[ConnectionReachability] SetObject loaded nothing at (${x}, ${y})`);
          entries.push({ x, y, connected: null });
          continue;
        }
        const candidateCircuits = await readNearCircuits(ctx, tempObjectId);
        entries.push({ x, y, connected: circuitsIntersect(buildingCircuits, candidateCircuits) });
      } catch (e: unknown) {
        ctx.log.debug(`[ConnectionReachability] Candidate NearCircuits read failed at (${x}, ${y}): ${toErrorMessage(e)}`);
        entries.push({ x, y, connected: null });
      }
    }
    return entries;
  } finally {
    ctx.cacherCloseObject(tempObjectId);
  }
}
