/**
 * useKeyboardShortcuts — global keyboard shortcuts (doc/ux/handoff/00-socle.md §4.3).
 *
 * One table, one handler. Three rules the audit found broken (doc/ux/audit.md §1.1 P9):
 *  - a modifier means "not ours": Ctrl/Cmd+R reloads the page, never the map; only Ctrl/Cmd+K
 *    is claimed;
 *  - Escape is handled AFTER the text-input guard and never during IME composition, so it
 *    cancels a chat line or an inline edit before it unstacks a surface;
 *  - the table is the single source of truth — Settings renders its list from SHORTCUTS.
 *
 * Keys the renderer binds itself (arrows pan, + / − zoom, 1–5 debug sub-overlays) are
 * listed here for the Settings page but not handled again (one owner per key).
 */

import { useEffect } from 'react';
import { useUiStore } from '../store/ui-store';
import { useGameStore } from '../store/game-store';
import type { ClientCallbacks } from '../bridge/client-bridge';

export interface Shortcut {
  keys: string;
  action: string;
  /** Handled by the renderer's own listener; shown for reference only. */
  rendererOwned?: boolean;
}

/** The reference list, in the order Settings shows it. */
export const SHORTCUTS: readonly Shortcut[] = [
  { keys: 'B', action: 'Build' },
  { keys: 'M', action: 'Map' },
  { keys: 'E', action: 'Empire / Profile' },
  { keys: 'P', action: 'Government' },
  { keys: 'L', action: 'Mail' },
  { keys: 'R', action: 'Refresh map' },
  { keys: 'Q / W', action: 'Rotate view' },
  { keys: 'Arrows', action: 'Pan the map', rendererOwned: true },
  { keys: '+ / −', action: 'Zoom', rendererOwned: true },
  { keys: 'D', action: 'Debug overlay' },
  { keys: 'Ctrl+K', action: 'Command palette' },
  { keys: 'Esc', action: 'Back / close' },
];

export function isTextInput(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  // Custom widgets that take text or own their keys
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

export function useKeyboardShortcuts(client: ClientCallbacks | null): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const store = useUiStore.getState();

      // Ctrl/Cmd+K — the one modifier chord we claim
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        store.toggleCommandPalette();
        return;
      }

      // Every other modifier chord belongs to the browser / assistive tech
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.isComposing) return;

      // A field that has the keyboard keeps it — including Escape (it cancels the edit there)
      if (isTextInput(e.target)) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        store.dismissTopmost();
        return;
      }

      // Plain letters only while nothing modal owns the keyboard
      if (store.modal || store.commandPaletteOpen) return;

      switch (e.key.toLowerCase()) {
        case 'b':
          if (useGameStore.getState().isVisitor) break;
          e.preventDefault();
          store.toggleBuildSurface();
          break;
        case 'e':
          if (useGameStore.getState().isVisitor) break;
          e.preventDefault();
          store.toggleLeftPanel('empire');
          break;
        case 'l':
          e.preventDefault();
          store.toggleRightPanel('mail');
          break;
        case 'p':
          e.preventDefault();
          store.toggleRightPanel('politics');
          break;
        case 'm':
          e.preventDefault();
          store.toggleMapSurface();
          break;
        case 'q':
          e.preventDefault();
          client?.onRotateCCW();
          break;
        case 'w':
          e.preventDefault();
          client?.onRotateCW();
          break;
        case 'r':
          e.preventDefault();
          client?.onRefreshMap();
          break;
        case 'd':
          e.preventDefault();
          client?.onToggleDebugOverlay();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [client]);
}
