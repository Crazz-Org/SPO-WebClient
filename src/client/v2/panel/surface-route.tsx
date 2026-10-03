/**
 * surface-route — which component the v2 side panel shows for each surface, and how the
 * stack reads as a breadcrumb.
 *
 * Every surface is the classic one (`SurfaceContent` from the sheet) except 'building', which
 * is the v2 inspector. Titles are the classic `SURFACE_TITLES`, so both interfaces name a
 * surface the same way.
 */

import type { ReactNode } from 'react';
import { Building2, Mail, Search, Landmark, User, Heart, Layers, Hammer, Map, GraduationCap } from 'lucide-react';
import type { Surface, SurfaceKind } from '../../store/ui-store';
import { SurfaceContent, SURFACE_TITLES } from '../../components/sheet';
import { InspectorV2 } from '../inspector/InspectorV2';

export const SURFACE_ICONS: Record<SurfaceKind, ReactNode> = {
  building: <Building2 size={16} />,
  mail: <Mail size={16} />,
  search: <Search size={16} />,
  politics: <Landmark size={16} />,
  empire: <User size={16} />,
  facilities: <Heart size={16} />,
  overlays: <Layers size={16} />,
  build: <Hammer size={16} />,
  supplierSearch: <Search size={16} />,
  map: <Map size={16} />,
  tutorial: <GraduationCap size={16} />,
};

/** Contents that draw their own heading (name, status, refresh…) — the panel adds none. */
export const OWN_HEADER: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>(['building', 'build', 'supplierSearch']);

export function surfaceTitle(kind: SurfaceKind): string {
  return SURFACE_TITLES[kind];
}

export interface Crumb {
  /** Position in the stack — what `popToSurface` takes. */
  index: number;
  kind: SurfaceKind;
  label: string;
  /** The surface on screen. */
  current: boolean;
  /** A middle crumb of a deep stack, shown as "…" (its label stays in the tooltip). */
  collapsed: boolean;
}

/**
 * The stack as breadcrumbs — the classic sheet's rule: past three surfaces, the middle ones
 * collapse to "…" so the root and the current surface stay readable.
 */
export function breadcrumbs(stack: readonly Surface[]): Crumb[] {
  return stack.map((surface, i) => ({
    index: i,
    kind: surface.kind,
    label: SURFACE_TITLES[surface.kind],
    current: i === stack.length - 1,
    collapsed: stack.length > 3 && i > 0 && i < stack.length - 1,
  }));
}

/** The body of the side panel for one surface. */
export function SurfaceRoute({ kind }: { kind: SurfaceKind }) {
  if (kind === 'building') return <InspectorV2 />;
  return <SurfaceContent kind={kind} />;
}
