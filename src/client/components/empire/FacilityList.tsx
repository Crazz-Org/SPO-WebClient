/**
 * FacilityList — Scrollable list of owned facilities, grouped by state (H6),
 * plus the Favorites folder tree: create, rename, remove and move-into.
 *
 * Three sections: "Losing money" (server alert bit on a loaded building),
 * "Status unknown" (zone never loaded — honestly unknown, never assumed
 * healthy), "Operating". Clicking a row pans the map and opens the building
 * inspector — which also loads the zone and resolves an unknown state.
 *
 * Folders never enter a section: they carry no coordinates and the server
 * has no notion of a folder's status. `RDOFavoritesMoveItem`'s server-side
 * guard is a plain string prefix test (`Kernel/Favorites.pas:247`), which
 * would refuse moving a folder into one of its own descendants but not into
 * an unrelated one — so, to keep the client from ever depending on that
 * distinction, the client moves links only.
 */

import { memo, useCallback, useMemo, useState, type KeyboardEvent } from 'react';
import { useUiStore } from '../../store/ui-store';
import { useBuildingStore } from '../../store/building-store';
import { useMapStore } from '../../store/map-store';
import { useEmpireStore } from '../../store/empire-store';
import { useClient } from '../../context';
import { isTextInput } from '../../hooks/useKeyboardShortcuts';
import type { FavoritesItem } from '@/shared/types';
import { flattenFolders } from '@/shared/favorites-tree';
import { classifyFacilities } from './facility-status';
import styles from './FacilityList.module.css';

type FacilityState = 'losing' | 'unknown' | 'operating';

/**
 * `TFavorites.RDORenameItem` keeps the first 50 characters and drops the rest
 * (`Kernel/Favorites.pas:283`). The input stops there so the player never types
 * a name the server will silently shorten.
 */
const FAV_NAME_MAX = 50;

/** Locations never start with '/' — the sentinel for "move to the root". */
const ROOT_OPTION = '/';

/** The Location of the folder a path currently sits in, or '' for the root. */
function parentPathOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? '' : path.slice(0, idx);
}

interface FacilityRowProps {
  facility: FavoritesItem;
  state: FacilityState;
  parentName?: string;
  /** True when the tree holds at least one folder — decides whether the select renders at all. */
  hasFolders: boolean;
  /** Every folder the item can move into — the folder it already sits in is excluded. */
  folderOptions: { path: string; label: string }[];
  selected: boolean;
  onToggleSelect: (item: FavoritesItem) => void;
  onClick: (facility: FavoritesItem) => void;
  onRename: (facility: FavoritesItem, name: string) => void;
  onRemove: (facility: FavoritesItem) => void;
  onMove: (facility: FavoritesItem, destPath: string) => void;
}

const DOT_CLASS: Record<FacilityState, string> = {
  losing: 'dotLosing',
  unknown: 'dotUnknown',
  operating: 'dotOperating',
};

const FacilityRow = memo(function FacilityRow({
  facility, state, parentName, hasFolders, folderOptions, selected, onToggleSelect,
  onClick, onRename, onRemove, onMove,
}: FacilityRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(facility.name);

  const startEditing = () => {
    setDraft(facility.name);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    // An unchanged or empty name is not a rename — do not spend a round trip
    // on it, and never send the empty string the server would happily store.
    if (next && next !== facility.name) {
      onRename(facility, next);
    }
  };

  if (editing) {
    return (
      <div className={styles.row}>
        <input
          className={styles.renameInput}
          value={draft}
          maxLength={FAV_NAME_MAX}
          autoFocus
          aria-label={`Rename ${facility.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.row}>
      <input
        type="checkbox"
        className={styles.rowCheckbox}
        checked={selected}
        aria-label={`Select ${facility.name}`}
        onChange={() => onToggleSelect(facility)}
      />
      <button
        className={styles.rowMain}
        onClick={() => onClick(facility)}
      >
        <div className={styles.rowLeft}>
          <span className={styles.name}>
            <span className={`${styles.dot} ${styles[DOT_CLASS[state]]}`} aria-hidden="true" />
            {facility.name}
          </span>
          <span className={styles.category}>
            {facility.x}, {facility.y}{parentName ? ` · in ${parentName}` : ''}
          </span>
        </div>
      </button>
      <div className={styles.rowActions}>
        {hasFolders && (
          <select
            className={styles.moveSelect}
            aria-label={`Move ${facility.name} to…`}
            value=""
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              onMove(facility, value === ROOT_OPTION ? '' : value);
              e.target.value = '';
            }}
          >
            <option value="" disabled>Move to…</option>
            <option value={ROOT_OPTION}>Root</option>
            {folderOptions.map((opt) => (
              <option key={opt.path} value={opt.path}>{opt.label}</option>
            ))}
          </select>
        )}
        <button
          className={styles.rowAction}
          title={`Rename ${facility.name}`}
          aria-label={`Rename ${facility.name}`}
          onClick={startEditing}
        >
          ✎
        </button>
        <button
          className={styles.rowAction}
          // "Remove from list", never "delete": this removes the bookmark, it
          // does not touch the building.
          title={`Remove ${facility.name} from list`}
          aria-label={`Remove ${facility.name} from list`}
          onClick={() => onRemove(facility)}
        >
          ✕
        </button>
      </div>
    </div>
  );
});

interface FolderRowProps {
  folder: FavoritesItem;
  depth: number;
  selected: boolean;
  onToggleSelect: (item: FavoritesItem) => void;
  onRename: (folder: FavoritesItem, name: string) => void;
  onRemove: (folder: FavoritesItem) => void;
}

const FolderRow = memo(function FolderRow({
  folder, depth, selected, onToggleSelect, onRename, onRemove,
}: FolderRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder.name);
  const count = folder.children?.length ?? 0;

  const startEditing = () => {
    setDraft(folder.name);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== folder.name) {
      onRename(folder, next);
    }
  };

  const handleRemove = () => {
    if (count === 0) {
      onRemove(folder);
      return;
    }
    useUiStore.getState().requestConfirm(
      'Remove folder',
      `"${folder.name}" holds ${count} item${count === 1 ? '' : 's'}. Remove the folder and everything in it?`,
      () => onRemove(folder),
    );
  };

  if (editing) {
    return (
      <div className={styles.row} style={{ paddingLeft: depth * 16 }}>
        <input
          className={styles.renameInput}
          value={draft}
          maxLength={FAV_NAME_MAX}
          autoFocus
          aria-label={`Rename ${folder.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.row} style={{ paddingLeft: depth * 16 }}>
      <input
        type="checkbox"
        className={styles.rowCheckbox}
        checked={selected}
        aria-label={`Select ${folder.name}`}
        onChange={() => onToggleSelect(folder)}
      />
      <div className={styles.rowLeft}>
        <span className={styles.name}>📁 {folder.name}</span>
        <span className={styles.category}>{count} item{count === 1 ? '' : 's'}</span>
      </div>
      <div className={styles.rowActions}>
        <button
          className={styles.rowAction}
          title={`Rename ${folder.name}`}
          aria-label={`Rename ${folder.name}`}
          onClick={startEditing}
        >
          ✎
        </button>
        <button
          className={styles.rowAction}
          title={`Remove ${folder.name}`}
          aria-label={`Remove ${folder.name}`}
          onClick={handleRemove}
        >
          ✕
        </button>
      </div>
    </div>
  );
});

interface FacilityListProps {
  facilities: FavoritesItem[];
}

export function FacilityList({ facilities }: FacilityListProps) {
  const openRightPanel = useUiStore((s) => s.openRightPanel);
  const source = useMapStore((s) => s.source);
  const tree = useEmpireStore((s) => s.tree);
  const client = useClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const folders = useMemo(() => flattenFolders(tree), [tree]);
  const folderNameByPath = useMemo(
    () => new Map(folders.map(({ folder }) => [folder.path, folder.name])),
    [folders],
  );

  const groups = useMemo(
    () => classifyFacilities(facilities, source?.getAllBuildings?.() ?? []),
    [facilities, source],
  );

  const handleClick = useCallback((facility: FavoritesItem) => {
    useBuildingStore.getState().setLoading(true);
    openRightPanel('building');
    client.onNavigateToBuilding(facility.x, facility.y);
  }, [openRightPanel, client]);

  const handleRename = useCallback((facility: FavoritesItem, name: string) => {
    client.onRenameFavorite(facility.path, name);
  }, [client]);

  const handleRemove = useCallback((facility: FavoritesItem) => {
    client.onRemoveFavorite(facility.path, facility.name);
  }, [client]);

  const handleMove = useCallback((facility: FavoritesItem, destPath: string) => {
    client.onMoveFavorite(facility.path, destPath, facility.name);
  }, [client]);

  const handleFolderRename = useCallback((folder: FavoritesItem, name: string) => {
    client.onRenameFavorite(folder.path, name);
  }, [client]);

  const handleFolderRemove = useCallback((folder: FavoritesItem) => {
    client.onRemoveFavorite(folder.path, folder.name);
  }, [client]);

  const handleToggleSelect = useCallback((item: FavoritesItem) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.path)) next.delete(item.path);
      else next.add(item.path);
      return next;
    });
  }, []);

  // Deriving the selection from the current tree/facilities means a path the
  // refetch no longer returns silently drops out — no stale entry is ever re-sent.
  const visibleSelection = useMemo(() => {
    const all = [...facilities, ...folders.map(({ folder }) => folder)];
    return all.filter((item) => selected.has(item.path)).map(({ path, name }) => ({ path, name }));
  }, [facilities, folders, selected]);

  const anySelectedIsFolder = useMemo(
    () => folders.some(({ folder }) => selected.has(folder.path)),
    [folders, selected],
  );

  const requestRemoveSelected = useCallback(() => {
    const items = visibleSelection;
    if (items.length === 0) return;
    useUiStore.getState().requestConfirm(
      'Remove from list',
      `Remove ${items.length} item${items.length === 1 ? '' : 's'} from your list?` +
        (anySelectedIsFolder ? ' A folder goes with everything inside it.' : ''),
      () => { client.onRemoveFavorites(items); setSelected(new Set()); },
    );
  }, [visibleSelection, anySelectedIsFolder, client]);

  const handleListKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const isCheckbox = e.target instanceof HTMLInputElement && e.target.type === 'checkbox';
    if (isTextInput(e.target) && !isCheckbox) return;

    if (e.key === 'Delete' && selected.size > 0) {
      e.preventDefault();
      e.stopPropagation();
      requestRemoveSelected();
    } else if (e.key === 'Escape' && selected.size > 0) {
      e.preventDefault();
      e.stopPropagation();
      setSelected(new Set());
    }
  }, [selected, requestRemoveSelected]);

  const handleNewFolder = useCallback(() => {
    useUiStore.getState().requestPrompt('New folder', 'Name:', (name) => {
      const trimmed = name.trim();
      if (trimmed) client.onCreateFavoriteFolder('', trimmed);
    }, { placeholder: 'e.g. Farms' });
  }, [client]);

  const folderOptionsFor = useCallback((facility: FavoritesItem) => {
    if (folders.length === 0) return [];
    const currentParent = parentPathOf(facility.path);
    return folders
      .filter(({ folder }) => folder.path !== currentParent)
      .map(({ folder, depth }) => ({
        path: folder.path,
        label: `${'  '.repeat(depth)}${folder.name}`,
      }));
  }, [folders]);

  const renderRow = (f: FavoritesItem, state: FacilityState) => (
    <FacilityRow
      key={f.id}
      facility={f}
      state={state}
      parentName={folderNameByPath.get(parentPathOf(f.path))}
      hasFolders={folders.length > 0}
      folderOptions={folderOptionsFor(f)}
      selected={selected.has(f.path)}
      onToggleSelect={handleToggleSelect}
      onClick={handleClick}
      onRename={handleRename}
      onRemove={handleRemove}
      onMove={handleMove}
    />
  );

  const isEmpty = facilities.length === 0 && folders.length === 0;

  return (
    <div className={styles.list} tabIndex={-1} onKeyDown={handleListKeyDown}>
      <div className={styles.listHead}>
        {visibleSelection.length > 0 && (
          <div className={styles.selectBar}>
            <span className={styles.selectCount}>{visibleSelection.length} selected</span>
            <button
              className={styles.batchRemove}
              onClick={requestRemoveSelected}
            >
              Remove selected ({visibleSelection.length})
            </button>
            <button
              className={styles.newFolderButton}
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </button>
          </div>
        )}
        <button
          className={styles.newFolderButton}
          aria-label="New folder"
          onClick={handleNewFolder}
        >
          + New Folder
        </button>
      </div>

      {isEmpty ? (
        <div className={styles.empty}>
          No facilities found
        </div>
      ) : (
        <>
          {folders.length > 0 && (
            <>
              <div className={styles.sectionHeader}>Folders</div>
              {folders.map(({ folder, depth }) => (
                <FolderRow
                  key={folder.id}
                  folder={folder}
                  depth={depth}
                  selected={selected.has(folder.path)}
                  onToggleSelect={handleToggleSelect}
                  onRename={handleFolderRename}
                  onRemove={handleFolderRemove}
                />
              ))}
            </>
          )}

          <div className={styles.sectionHeader}>
            Losing money{groups.losing.length > 0 ? ` (${groups.losing.length})` : ''}
          </div>
          {groups.losing.length === 0 ? (
            <div className={styles.sectionEmpty}>
              No facility is losing money in the areas you&apos;ve visited.
            </div>
          ) : (
            groups.losing.map((f) => renderRow(f, 'losing'))
          )}

          {groups.unknown.length > 0 && (
            <>
              <div className={styles.sectionHeader}>Status unknown</div>
              <div className={styles.sectionNote}>Not visited yet — tap to check.</div>
              {groups.unknown.map((f) => renderRow(f, 'unknown'))}
            </>
          )}

          {groups.operating.length > 0 && (
            <>
              <div className={styles.sectionHeader}>Operating</div>
              {groups.operating.map((f) => renderRow(f, 'operating'))}
            </>
          )}
        </>
      )}
    </div>
  );
}
