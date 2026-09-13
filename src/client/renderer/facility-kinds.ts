import type { FacilityDimensions, FacilityKind, MapBuilding } from '../../shared/types/domain-types';

/** Human-ish label from a map texture name: 'MapUWColdStorage64x32x0.gif' -> 'UWCold Storage'. Undefined for construction/odd names. */
export function facilityKindLabel(textureFilename: string | undefined): string | undefined {
  if (!textureFilename) return undefined;
  const match = /^Map(.+?)(?:\d+x\d+x\d+)?\.gif$/i.exec(textureFilename);
  if (!match) return undefined;
  return match[1].replace(/([a-z\d])([A-Z])/g, '$1 $2').trim();
}

/** The distinct kinds (facId > 0) among `buildings`, sorted by facId; label = first labelled texture, else `Kind <facId>`. */
export function collectFacilityKinds(
  buildings: readonly MapBuilding[],
  dimsOf: (visualClass: string) => Pick<FacilityDimensions, 'facId' | 'textureFilename'> | undefined,
): FacilityKind[] {
  const labels = new Map<number, string | undefined>();
  for (const building of buildings) {
    const dims = dimsOf(building.visualClass);
    if (!dims?.facId) continue;
    if (labels.get(dims.facId) === undefined) {
      labels.set(dims.facId, facilityKindLabel(dims.textureFilename));
    }
  }
  return Array.from(labels.entries())
    .sort(([a], [b]) => a - b)
    .map(([facId, label]) => ({ facId, label: label ?? `Kind ${facId}` }));
}
