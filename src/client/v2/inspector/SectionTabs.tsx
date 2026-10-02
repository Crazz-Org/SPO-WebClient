/**
 * SectionTabs — the inspector's sticky, horizontally scrollable section strip.
 *
 * Replaces v1's master/detail section menu: every section is one click away and the open
 * one always gets the full width of the panel. Keyboard: arrows / Home / End move between
 * tabs and open the one they land on (the ARIA tabs pattern with automatic activation).
 */

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { nextTabIndex, type SectionTabItem } from './inspector-model';
import styles from './SectionTabs.module.css';

interface SectionTabsProps {
  tabs: SectionTabItem[];
  activeId: string | undefined;
  onSelect: (tabId: string) => void;
  /** Id of the tab panel the strip controls, for aria-controls. */
  panelId: string;
}

export function SectionTabs({ tabs, activeId, onSelect, panelId }: SectionTabsProps) {
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());

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
    <div className={styles.strip} role="tablist" aria-label="Facility sections" onKeyDown={onKeyDown}>
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
  );
}
