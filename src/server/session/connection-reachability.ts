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
 */

import type { SessionContext } from './session-context';
import type { ConnectionReachabilityEntry } from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';

export const NEAR_CIRCUITS_PROP = 'NearCircuits';

/** TFluidLink.Intercept (Cache/FluidLinks.pas:116-133): false if either side is empty (:121), else any shared token. */
export function circuitsIntersect(a: string, b: string): boolean {
  const tokensA = a.split(',').filter(t => t !== '');
  const tokensB = b.split(',').filter(t => t !== '');
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  return tokensA.some(t => tokensB.includes(t));
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
      await ctx.cacherSetObject(tempObjectId, buildingX, buildingY);
      const values = await ctx.cacherGetPropertyList(tempObjectId, [NEAR_CIRCUITS_PROP]);
      buildingCircuits = values[0] ?? '';
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
        await ctx.cacherSetObject(tempObjectId, x, y);
        const values = await ctx.cacherGetPropertyList(tempObjectId, [NEAR_CIRCUITS_PROP]);
        const candidateCircuits = values[0] ?? '';
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
