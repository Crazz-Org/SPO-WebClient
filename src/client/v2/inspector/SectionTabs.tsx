/**
 * SectionTabs — the inspector's sticky, horizontally scrollable section strip.
 *
 * Replaces v1's master/detail section menu: every section is one click away and the open
 * one always gets the full width of the panel. Keyboard: arrows / Home / End move between
 * tabs and open the one they land on (the ARIA tabs pattern with automatic activation).
 *
 * A facility can carry more sections than the panel is wide. The strip then fades out at
 * the edge that hides tabs and puts a small arrow there; the arrow scrolls the strip by
 * most of its width. Neither shows on a side with nothing hidden, so an arrow always works.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { nextTabIndex, scrollEdges, type SectionTabItem } from './inspector-model';
import styles from './SectionTabs.module.css';

interface SectionTabsProps {
  tabs: SectionTabItem[];
  activeId: string | undefined;
  onSelect: (tabId: string) => void;
  /** Id of the tab panel the strip controls, for aria-controls. */
  panelId: string;
}

/** Share of the visible strip one arrow click scrolls — keeps a tab of context on screen. */
const SCROLL_SHARE = 0.7;

export function SectionTabs({ tabs, activeId, onSelect, panelId }: SectionTabsProps) {
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const stripRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const next = scrollEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  // Re-measure when the tabs change and whenever the strip is resized (panel width, font load).
  useEffect(() => {
    measure();
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, tabs]);

  const scrollByShare = (direction: -1 | 1) => {
    const el = stripRef.current;
    if (!el) return;
    const left = direction * Math.max(1, Math.round(el.clientWidth * SCROLL_SHARE));
    if (typeof el.scrollBy === 'function') el.scrollBy({ left, behavior: 'smooth' });
    else el.scrollLeft += left;
    measure();
  };

  // Keep the open tab visible when the strip is wider than the panel.
  useEffect(() => {
    if (!activeId) return;
    refs.current.get(activeId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((t) => t.id === activeId);
    const next = nextTabIndex(current < 0 ? 0 : current, tabs.length, e.key);
    if (next === null) return;
    e.preventDefault();
    const tab = tabs[next];
    onSelect(tab.id);
    refs.current.get(tab.id)?.focus();
  };

  return (
    <div className={styles.bar}>
      <div
        ref={stripRef}
        className={`${styles.strip} ${edges.left ? styles.fadeLeft : ''} ${edges.right ? styles.fadeRight : ''}`}
        role="tablist"
        aria-label="Facility sections"
        onKeyDown={onKeyDown}
        onScroll={measure}
      >
        {tabs.map((tab, i) => {
          const active = tab.id === activeId;
          const focusable = active || (!tabs.some((t) => t.id === activeId) && i === 0);
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) refs.current.set(tab.id, el);
                else refs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`${panelId}-tab-${tab.id}`}
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={focusable ? 0 : -1}
              className={`${styles.tab} ${active ? styles.active : ''}`}
              onClick={() => onSelect(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {edges.left && (
        <button
          type="button"
          className={`${styles.arrow} ${styles.arrowLeft}`}
          aria-label="Scroll sections left"
          tabIndex={-1}
          onClick={() => scrollByShare(-1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
      )}
      {edges.right && (
        <button
          type="button"
          className={`${styles.arrow} ${styles.arrowRight}`}
          aria-label="Scroll sections right"
          tabIndex={-1}
          onClick={() => scrollByShare(1)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
