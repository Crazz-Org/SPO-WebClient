/**
 * Road circuit reachability — whether a connection candidate shares a road network with
 * the building being connected (issue #584).
 *
 * `NearCircuits` is a string the facility cache agent writes into the object cache,
 * `RenderCircuitStr` (`~/SPO-Original/Kernel/KernelCache.pas:156-165`): comma-separated ids
 * with a trailing comma, e.g. `"17,42,"`, or `''` when the block touches no road.
 *
 * The comparison is `TFluidLink.Intercept` (`~/SPO-Original/Cache/FluidLinks.pas:116-134`).
 * Line 121: `if (fCircuits <> '') and (aCircuits <> '')` — either side empty means false,
 * never true; otherwise true iff the two lists share one id.
 */

export type RoadReachability = 'connected' | 'isolated' | 'unknown';

/** `RenderCircuitStr` (`Kernel/KernelCache.pas:156-165`): trailing comma, stray spaces tolerated. */
export function parseRoadCircuits(circuits: string): string[] {
  return circuits
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}

/** `TFluidLink.Intercept` (`Cache/FluidLinks.pas:116-134`); `FluidLinks.pas:121` makes an empty side false. */
export function sharesRoadCircuit(own: string, theirs: string): boolean {
  if (own === '' || theirs === '') return false;
  const ownIds = parseRoadCircuits(own);
  const theirIds = parseRoadCircuits(theirs);
  return ownIds.some((id) => theirIds.includes(id));
}
