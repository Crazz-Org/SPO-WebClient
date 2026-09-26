import type { SurfaceKind } from './store/ui-store';

/**
 * The panels a visitor cannot open. A visitor enters with no company (the Visitor Visa,
 * chooseVisa.asp:108-127): nothing to build, no empire, no facilities. CommandBar,
 * BottomNav, MobileMenu and MobileInfoBar all read this one list.
 */
export const VISITOR_GATED_PANELS: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>(['build', 'empire', 'facilities']);

/** True when this panel may be offered to the current player. */
export function isPanelOffered(panel: SurfaceKind, isVisitor: boolean): boolean {
  return !isVisitor || !VISITOR_GATED_PANELS.has(panel);
}
