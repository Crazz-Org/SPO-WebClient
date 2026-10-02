/**
 * SidePanel — UI v2: the panel docked on the right that shows the surface stack (replaces Sheet).
 *
 * Same behaviour as the classic sheet, one header row instead of two:
 *  - it shows the TOP of `ui-store.stack`; the breadcrumb is the stack itself, every earlier
 *    surface one click back (`popToSurface`), plus a Back button (`popSurface`);
 *  - Pin keeps it open while the player clicks other buildings (they stack instead of
 *    replacing the root); Close clears the stack; Escape pops one surface (the global
 *    `dismissTopmost`, unchanged);
 *  - connect mode hides it without destroying the stack, so the picker comes back untouched;
 *  - each surface renders behind an error boundary, slides in and out (`usePanel`).
 * 'building' is the v2 inspector, which carries its own actions (View on map, Refresh…);
 * every other surface is the classic content.
 */

import { Suspense } from 'react';
import { ArrowLeft, ChevronRight, Pin, PinOff, X } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { usePanel } from '../../hooks/usePanel';
import { IconButton, ErrorBoundary } from '../../components/common';
import { breadcrumbs, OWN_HEADER, SURFACE_ICONS, SurfaceRoute, surfaceTitle } from './surface-route';
import styles from './SidePanel.module.css';

export function SidePanel() {
  const stack = useUiStore((s) => s.stack);
  const pinned = useUiStore((s) => s.pinned);
  const setPinned = useUiStore((s) => s.setPinned);
  const popToSurface = useUiStore((s) => s.popToSurface);
  const popSurface = useUiStore((s) => s.popSurface);
  const clearSurfaces = useUiStore((s) => s.clearSurfaces);
  // Connect mode hides the panel without destroying the stack (N10).
  const connectActive = useUiStore((s) => s.connectMode.active);
  const open = stack.length > 0 && !connectActive;
  const { visible, animating } = usePanel(open);

  if (!visible) return null;

  const kind = stack[stack.length - 1]?.kind ?? 'building';
  const title = surfaceTitle(kind);
  const crumbs = breadcrumbs(stack);
  const previous = crumbs.slice(0, -1);
  const back = previous[previous.length - 1];

  const current = (
    <span className={styles.current}>
      <span className={styles.icon} aria-hidden="true" title={OWN_HEADER.has(kind) ? title : undefined}>{SURFACE_ICONS[kind]}</span>
      {OWN_HEADER.has(kind) ? (
        // The content draws its own heading ("Build", the building's name…): showing the name
        // here too printed it twice. It stays for assistive tech — the current crumb and the
        // region's name — but is not drawn.
        <span className={styles.srOnly} aria-current={previous.length > 0 ? 'page' : undefined}>{title}</span>
      ) : (
        <h2 className={styles.title} tabIndex={-1} aria-current={previous.length > 0 ? 'page' : undefined}>{title}</h2>
      )}
    </span>
  );

  return (
    <aside
      className={`${styles.panel} ${animating ? styles.open : styles.closed} ${pinned ? styles.pinned : ''}`}
      role="region"
      aria-label={title}
      data-surface={kind}
    >
      <div className={styles.header}>
        {back && (
          <IconButton
            icon={<ArrowLeft size={16} />}
            label={`Back to ${back.label}`}
            size="sm"
            onClick={popSurface}
            className={styles.back}
          />
        )}
        {previous.length > 0 ? (
          <nav className={styles.trail} aria-label="Open surfaces">
            <ol className={styles.crumbs}>
              {previous.map((c) => (
                <li key={`${c.kind}-${c.index}`} className={styles.crumb}>
                  <button
                    type="button"
                    className={`${styles.crumbButton} ${c.collapsed ? styles.collapsed : ''}`}
                    onClick={() => popToSurface(c.index)}
                    title={c.label}
                    aria-label={c.label}
                  >
                    {c.collapsed ? '…' : c.label}
                  </button>
                  <ChevronRight size={12} className={styles.sep} aria-hidden="true" />
                </li>
              ))}
              <li className={`${styles.crumb} ${styles.currentCrumb}`}>{current}</li>
            </ol>
          </nav>
        ) : (
          <div className={styles.trail}>{current}</div>
        )}
        <div className={styles.actions}>
          <IconButton
            icon={pinned ? <PinOff size={16} /> : <Pin size={16} />}
            label={pinned ? 'Unpin panel — map clicks replace this content' : 'Pin panel — keep it open while clicking the map'}
            size="sm"
            active={pinned}
            onClick={() => setPinned(!pinned)}
          />
          <IconButton icon={<X size={18} />} label="Close" size="sm" onClick={clearSurfaces} />
        </div>
      </div>

      {/* The only scroller. No padding: the inspector pads itself and its section tabs stick
          to the top of this box. */}
      <div className={styles.body}>
        {/* Keyed by kind: a crashed surface does not follow the player to the next one. */}
        <ErrorBoundary key={kind}>
          <Suspense fallback={null}>
            <SurfaceRoute kind={kind} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </aside>
  );
}
