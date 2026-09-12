/**
 * CommandPalette — Floating command search overlay.
 *
 * Triggered by Cmd+K (T7). Fuzzy-searches the registered commands, and — from what the client
 * already holds, no request per keystroke — my facilities, the towns, and "x,y" coordinates.
 * Center-top floating, 560px wide, z-500.
 */

import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useEmpireStore } from '../../store/empire-store';
import { useSearchStore } from '../../store/search-store';
import { useClient } from '../../context';
import { useCommandPalette, type Command } from '../../hooks/useCommandPalette';
import styles from './CommandPalette.module.css';

const CATEGORY_LABELS: Record<string, string> = {
  navigation: 'Navigation',
  search: 'Search',
  action: 'Actions',
};

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const close = useUiStore((s) => s.closeCommandPalette);
  const openModal = useUiStore((s) => s.openModal);
  const toggleLeftPanel = useUiStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const isVisitor = useGameStore((s) => s.isVisitor);

  const client = useClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef(0);

  // Register all commands
  const commands: Command[] = useMemo(
    () => [
      ...(isVisitor
        ? []
        : [
            {
              id: 'build',
              label: 'Open Build Menu',
              shortcut: 'B',
              category: 'navigation',
              execute: () => useUiStore.getState().toggleBuildSurface(),
            },
            {
              id: 'empire',
              label: 'Open Empire Overview',
              shortcut: 'E',
              category: 'navigation',
              execute: () => toggleLeftPanel('empire'),
            },
          ] as Command[]),
      {
        id: 'mail',
        label: 'Open Mail',
        shortcut: 'L',
        category: 'navigation',
        execute: () => toggleRightPanel('mail'),
      },
      {
        id: 'search',
        label: 'Open Search',
        category: 'navigation',
        execute: () => toggleRightPanel('search'),
      },
      {
        id: 'politics',
        label: 'Open Government (Capitol, towns)',
        shortcut: 'P',
        category: 'navigation',
        execute: () => toggleRightPanel('politics'),
      },
      {
        id: 'settings',
        label: 'Open Settings',
        shortcut: 'Cmd+,',
        category: 'navigation',
        execute: () => openModal('settings'),
      },
      {
        id: 'search-directory',
        label: 'Search the directory (towns, players, rankings)',
        category: 'search',
        execute: () => toggleRightPanel('search'),
      },
      {
        id: 'refresh',
        label: 'Refresh Map',
        shortcut: 'R',
        category: 'action',
        execute: () => {
          client.onRefreshMap();
        },
      },
    ],
    [openModal, toggleLeftPanel, toggleRightPanel, client, isVisitor],
  );

  // Dynamic entries (T7, missing-features S1 / N5): my facilities (the favorites list the
  // client already reads), towns (directory page already read by Search/Government) and
  // "x,y" coordinates. All local — no request is made by typing.
  const facilities = useEmpireStore((s) => s.facilities);
  const towns = useSearchStore((s) => s.townsData?.towns);
  const [rawQuery, setRawQuery] = useState('');
  const dynamicCommands: Command[] = useMemo(() => {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return [];
    const out: Command[] = [];
    const coord = rawQuery.match(/^\s*(\d{1,4})\s*[,; ]\s*(\d{1,4})\s*$/);
    if (coord) {
      const x = parseInt(coord[1], 10);
      const y = parseInt(coord[2], 10);
      out.push({ id: `goto-${x}-${y}`, label: `Go to (${x}, ${y})`, category: 'navigation', execute: () => client.onNavigateToBuilding(x, y) });
    }
    for (const f of facilities) {
      if (f.name.toLowerCase().includes(q)) {
        out.push({ id: `fac-${f.id}`, label: `My facility: ${f.name}`, category: 'search', execute: () => client.onNavigateToBuilding(f.x, f.y) });
      }
      if (out.length > 12) break;
    }
    for (const t of towns ?? []) {
      if (t.name.toLowerCase().includes(q)) {
        out.push({ id: `town-${t.name}`, label: `Town: ${t.name}${t.mayor ? ` (mayor ${t.mayor})` : ''}`, category: 'search', execute: () => client.onNavigateToBuilding(t.x, t.y) });
      }
    }
    return out;
  }, [rawQuery, facilities, towns, client]);

  const allCommands = useMemo(() => [...dynamicCommands, ...commands], [dynamicCommands, commands]);
  const { query, setQuery: setQueryInner, filteredCommands, groupedCommands, resetQuery: resetQueryInner } =
    useCommandPalette(allCommands);
  const setQuery = useCallback((v: string) => { setRawQuery(v); setQueryInner(v); }, [setQueryInner]);
  const resetQuery = useCallback(() => { setRawQuery(''); resetQueryInner(); }, [resetQueryInner]);

  // The facilities list and the towns page are read once per session, the first time the
  // palette opens (the same store slots Empire / Search / Government fill).
  useEffect(() => {
    if (!open) return;
    if (facilities.length === 0 && !useEmpireStore.getState().isLoading) {
      client.onRequestFacilities();
    }
    if (!towns && !useSearchStore.getState().isLoading) {
      client.onSearchMenuTowns();
    }
  }, [open, facilities.length, towns, client]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      resetQuery();
      selectedRef.current = 0;
      // Small delay for animation
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, resetQuery]);

  const executeCommand = useCallback(
    (cmd: Command) => {
      close();
      cmd.execute();
    },
    [close],
  );

  // Arrow key navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedRef.current = Math.min(selectedRef.current + 1, filteredCommands.length - 1);
        // Force re-render via query trick is avoided — use data attribute
        const items = document.querySelectorAll(`[data-palette-item]`);
        items.forEach((el, i) => {
          (el as HTMLElement).dataset.selected = i === selectedRef.current ? 'true' : 'false';
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedRef.current = Math.max(selectedRef.current - 1, 0);
        const items = document.querySelectorAll(`[data-palette-item]`);
        items.forEach((el, i) => {
          (el as HTMLElement).dataset.selected = i === selectedRef.current ? 'true' : 'false';
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filteredCommands[selectedRef.current];
        if (cmd) executeCommand(cmd);
      } else if (e.key === 'Escape') {
        // The global shortcut ignores keys typed in a text field — the input closes itself.
        e.preventDefault();
        close();
      }
    },
    [filteredCommands, executeCommand, close],
  );

  if (!open) return null;

  let itemIndex = 0;

  return (
    <>
      {/* Backdrop */}
      <div className={styles.backdrop} onClick={close} aria-hidden="true" />

      <div className={styles.palette} role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder="My facilities, a town, x,y — or a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            selectedRef.current = 0;
          }}
          onKeyDown={handleKeyDown}
        />

        <div className={styles.results}>
          {Object.entries(groupedCommands).map(([category, cmds]) => (
            <div key={category} className={styles.group}>
              <div className={styles.groupLabel}>
                {CATEGORY_LABELS[category] ?? category}
              </div>
              {cmds.map((cmd) => {
                const idx = itemIndex++;
                return (
                  <button
                    key={cmd.id}
                    className={styles.item}
                    data-palette-item=""
                    data-selected={idx === 0 ? 'true' : 'false'}
                    onClick={() => executeCommand(cmd)}
                  >
                    <span className={styles.itemLabel}>{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className={styles.shortcut}>{cmd.shortcut}</kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {filteredCommands.length === 0 && (
            <div className={styles.empty}>No commands found</div>
          )}
        </div>
      </div>
    </>
  );
}
