/**
 * ResearchPanel — Research/Inventions panel for HQ buildings.
 *
 * Layout:
 *   OngoingResearchBlock (every `developing` item, all five categories — #888)
 *   CategoryTabBar  (5 tabs: GENERAL, COMMERCE, REAL ESTATE, INDUSTRY, CIVICS)
 *   InventionGroupList (scrollable)
 *     InventionGroup[] (collapsible accordion per parent category)
 *       GroupHeader  (green/grey dot + name + chevron + "N available" badge)
 *       InventionRow[] (status dot + name + inline Research/Cancel button)
 *   DetailPanel (slide-down when invention selected)
 */

import { useEffect, useCallback, useState, useMemo } from 'react';
import type { ResearchCategoryData, ResearchInventionDetails } from '@/shared/types';
import { useBuildingStore } from '../../store/building-store';
import { useClient } from '../../context';
import { TabBar } from '../common/TabBar';
import { Skeleton } from '../common/Skeleton';
import {
  mergeAndSortInventions,
  groupInventionsByParent,
  isGroupResearchable,
  countAvailableEnabled,
  countByStatus,
  collectOngoingResearch,
  type MergedInventionItem,
  type OngoingResearchItem,
  type ResearchPendingEntry,
} from './research-utils';
import styles from './ResearchPanel.module.css';

interface ResearchPanelProps {
  buildingX: number;
  buildingY: number;
}

const FALLBACK_TABS = ['GENERAL', 'COMMERCE', 'REAL ESTATE', 'INDUSTRY', 'CIVICS'];

/** The five research categories the server exposes (`avl0..4` / `dev0..4` / `has0..4`). */
const RESEARCH_CATEGORY_COUNT = FALLBACK_TABS.length;

/** Stable empty identities — a `new Map()` inline in the fallback would defeat the memo below. */
const EMPTY_INVENTORY: ReadonlyMap<number, ResearchCategoryData> = new Map();
const EMPTY_PENDING_OPS: ReadonlyMap<string, ResearchPendingEntry> = new Map();

export function ResearchPanel({ buildingX, buildingY }: ResearchPanelProps) {
  const client = useClient();
  const research = useBuildingStore((s) => s.research);
  const isOwner = useBuildingStore((s) => s.isOwner);

  const activeCategoryIndex = research?.activeCategoryIndex ?? 0;
  const categoryTabs = research?.categoryTabs ?? [];
  const isLoadingInventory = research?.isLoadingInventory ?? false;
  const isLoadingDetails = research?.isLoadingDetails ?? false;
  const selectedId = research?.selectedInventionId ?? null;
  const details = research?.selectedDetails ?? null;

  const tabLabels = categoryTabs.length > 0 ? categoryTabs : FALLBACK_TABS;
  const inventory = research?.inventoryByCategory.get(activeCategoryIndex) ?? null;

  // Fetch category tabs + every category on mount.
  //
  // The "In research queue" block above the tabs has to show everything that is
  // developing, and a queued invention can sit in any of the five categories —
  // so all five are fetched here rather than one per tab visit. This is a
  // deliberate exception to "do not eagerly fetch data for tabs/panels not yet
  // visible" (src/client/CLAUDE.md): the data feeds a block that is on screen
  // from the first paint, not a tab the player has not opened. The visible
  // category goes out first so its list paints without waiting on the rest.
  useEffect(() => {
    client.onResearchFetchCategoryTabs();
    for (let i = 0; i < RESEARCH_CATEGORY_COUNT; i++) {
      client.onResearchLoadInventory(buildingX, buildingY, i);
    }
  }, [client, buildingX, buildingY]);

  // Handle tab change — the mount effect already asked for every category, so
  // this only fires for one whose response never arrived (a retry path).
  const handleTabChange = useCallback(
    (tabId: string) => {
      const index = parseInt(tabId, 10);
      useBuildingStore.getState().setResearchActiveCategoryIndex(index);
      const loaded = useBuildingStore.getState().research?.loadedCategories;
      if (!loaded?.has(index)) {
        client.onResearchLoadInventory(buildingX, buildingY, index);
      }
    },
    [client, buildingX, buildingY],
  );

  const handleSelectInvention = useCallback(
    (item: MergedInventionItem) => {
      client.onResearchGetDetails(buildingX, buildingY, item.inventionId);
    },
    [client, buildingX, buildingY],
  );

  const handleQueueResearch = useCallback(
    (inventionId: string) => {
      client.onResearchQueueInvention(buildingX, buildingY, inventionId);
    },
    [client, buildingX, buildingY],
  );

  const handleCancelResearch = useCallback(
    (inventionId: string) => {
      client.onResearchCancelInvention(buildingX, buildingY, inventionId);
    },
    [client, buildingX, buildingY],
  );

  // Build tabs with badge counts
  const tabs = useMemo(() => {
    return tabLabels.map((label, i) => {
      const catData = research?.inventoryByCategory.get(i);
      const badge = catData ? countAvailableEnabled(catData) : undefined;
      return { id: String(i), label, badge };
    });
  }, [tabLabels, research?.inventoryByCategory]);

  // Merge + group items for current category
  const merged = useMemo(
    () => (inventory ? mergeAndSortInventions(inventory) : null),
    [inventory],
  );

  const groups = useMemo(
    () => (merged ? groupInventionsByParent(merged) : null),
    [merged],
  );

  // The name the clicked row showed — already in memory from the inventory
  // response (enriched server-side from research.0.dat). No extra request.
  const selectedName = useMemo(
    () => merged?.find((i) => i.inventionId === selectedId)?.name ?? null,
    [merged, selectedId],
  );

  const pendingOps = research?.pendingOps ?? EMPTY_PENDING_OPS;
  const ongoing = useMemo(
    () => collectOngoingResearch(research?.inventoryByCategory ?? EMPTY_INVENTORY, pendingOps),
    [research?.inventoryByCategory, pendingOps],
  );

  return (
    <div className={styles.panel}>
      {ongoing.length > 0 && (
        <OngoingResearchBlock items={ongoing} isOwner={isOwner} onCancel={handleCancelResearch} />
      )}

      {/* Category tabs */}
      <TabBar
        tabs={tabs}
        activeTab={String(activeCategoryIndex)}
        onTabChange={handleTabChange}
        className={styles.categoryTabs}
      />

      {/* Invention groups */}
      {isLoadingInventory ? (
        <div className={styles.loadingList}>
          <Skeleton height="1.5em" />
          <Skeleton height="1.5em" />
          <Skeleton height="1.5em" width="80%" />
        </div>
      ) : !groups || groups.size === 0 ? (
        <div className={styles.emptyState}>No inventions in this category</div>
      ) : (
        <div className={styles.groupList}>
          {Array.from(groups.entries()).map(([parent, items]) => (
            <InventionGroup
              key={parent || '__ungrouped__'}
              parent={parent}
              items={items}
              selectedId={selectedId}
              isOwner={isOwner}
              onSelect={handleSelectInvention}
              onQueue={handleQueueResearch}
              onCancel={handleCancelResearch}
            />
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedId && (
        <DetailPanel
          inventionId={selectedId}
          inventionName={selectedName}
          details={details}
          isLoading={isLoadingDetails}
        />
      )}
    </div>
  );
}

// =============================================================================
// INVENTION GROUP (Accordion)
// =============================================================================

function InventionGroup({
  parent,
  items,
  selectedId,
  isOwner,
  onSelect,
  onQueue,
  onCancel,
}: {
  parent: string;
  items: MergedInventionItem[];
  selectedId: string | null;
  isOwner: boolean;
  onSelect: (item: MergedInventionItem) => void;
  onQueue: (inventionId: string) => void;
  onCancel: (inventionId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const researchable = isGroupResearchable(items);
  const counts = countByStatus(items);

  return (
    <div className={styles.group}>
      <button
        className={styles.groupHeader}
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
      >
        <span className={`${styles.groupDot} ${researchable ? styles.groupDotActive : ''}`} />
        <span className={styles.groupName}>{parent || 'Uncategorized'}</span>
        {(counts.avail > 0 || counts.dev > 0 || counts.has > 0) && (
          <span className={styles.groupCount}>
            {[
              counts.avail > 0 ? `${counts.avail} avail` : '',
              counts.dev > 0 ? `${counts.dev} dev` : '',
              counts.has > 0 ? `${counts.has} owned` : '',
            ].filter(Boolean).join(' \u00B7 ')}
          </span>
        )}
        <svg
          className={`${styles.groupChevron} ${isOpen ? styles.groupChevronOpen : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isOpen && (
        <div className={styles.groupBody}>
          {items.map((item) => (
            <InventionRow
              key={item.inventionId}
              item={item}
              isSelected={item.inventionId === selectedId}
              isOwner={isOwner}
              onSelect={onSelect}
              onQueue={onQueue}
              onCancel={onCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// INVENTION ROW
// =============================================================================

function InventionRow({
  item,
  isSelected,
  isOwner,
  onSelect,
  onQueue,
  onCancel,
}: {
  item: MergedInventionItem;
  isSelected: boolean;
  isOwner: boolean;
  onSelect: (item: MergedInventionItem) => void;
  onQueue: (inventionId: string) => void;
  onCancel: (inventionId: string) => void;
}) {
  const isLocked = item.status === 'available' && item.enabled === false;

  const dotClass =
    item.status === 'available'
      ? isLocked
        ? styles.statusLocked
        : styles.statusAvailable
      : item.status === 'researching'
        ? styles.statusResearching
        : styles.statusDeveloped;

  const rowClass = [
    styles.inventionRow,
    isSelected ? styles.inventionRowSelected : '',
    isLocked ? styles.inventionRowLocked : '',
  ].join(' ');

  return (
    <div className={rowClass}>
      <span className={`${styles.statusDot} ${dotClass}`} />

      <button
        className={styles.inventionName}
        onClick={() => !isLocked && onSelect(item)}
        style={{ background: 'none', border: 'none', color: 'inherit', cursor: isLocked ? 'default' : 'pointer', textAlign: 'left', padding: 0, font: 'inherit' }}
        disabled={isLocked}
      >
        {item.name || item.inventionId}
      </button>

      {item.status === 'developed' && item.cost && (
        <span className={styles.inventionCost}>{item.cost}</span>
      )}

      {isLocked && <span className={styles.lockedTag}>locked</span>}

      {/* Inline action buttons — only for owner */}
      {isOwner && item.status === 'available' && !isLocked && (
        <button
          className={`${styles.inlineBtn} ${styles.inlineBtnResearch}`}
          onClick={(e) => { e.stopPropagation(); onQueue(item.inventionId); }}
        >
          Research
        </button>
      )}

      {isOwner && item.status === 'researching' && (
        <button
          className={`${styles.inlineBtn} ${styles.inlineBtnCancel}`}
          onClick={(e) => { e.stopPropagation(); onCancel(item.inventionId); }}
        >
          Cancel
        </button>
      )}

      {isOwner && item.status === 'developed' && (
        <button
          className={`${styles.inlineBtn} ${styles.inlineBtnSell}`}
          onClick={(e) => { e.stopPropagation(); onCancel(item.inventionId); }}
        >
          Sell
        </button>
      )}
    </div>
  );
}

// =============================================================================
// DETAIL PANEL
// =============================================================================

function DetailPanel({
  inventionId,
  inventionName,
  details,
  isLoading,
}: {
  inventionId: string;
  inventionName: string | null;
  details: ResearchInventionDetails | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className={styles.detailPanel}>
        <Skeleton height="1em" width="50%" />
        <Skeleton height="4em" />
        <Skeleton height="2em" width="80%" />
      </div>
    );
  }

  if (!details || details.inventionId !== inventionId) {
    return <div className={styles.selectHint}>Loading details...</div>;
  }

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailHeader}>{inventionName || inventionId}</div>
      {details.properties && (
        <div className={styles.detailProperties}>{details.properties}</div>
      )}
      {details.description && (
        <div className={styles.detailDescription}>{details.description}</div>
      )}
    </div>
  );
}

// =============================================================================
// ONGOING RESEARCH BLOCK (#888)
// =============================================================================

/**
 * All `developing` items across every category, one honest group — #887
 * (active-item progress) has not landed, so this does not distinguish an
 * "active" item from queued-behind ones.
 */
function OngoingResearchBlock({
  items,
  isOwner,
  onCancel,
}: {
  items: OngoingResearchItem[];
  isOwner: boolean;
  onCancel: (inventionId: string) => void;
}) {
  return (
    <div className={styles.ongoingBlock}>
      <div className={styles.ongoingHeader}>
        <span className={styles.ongoingLabel}>In research queue</span>
        <span className={styles.ongoingCount}>{items.length}</span>
      </div>
      <div className={styles.ongoingList}>
        {items.map((item) => (
          <div key={item.inventionId} className={styles.ongoingRow}>
            <span className={`${styles.statusDot} ${styles.statusResearching}`} />
            <span className={styles.ongoingName}>{item.name || item.inventionId}</span>
            {item.isPending && <span className={styles.ongoingPending}>sending…</span>}
            {isOwner && (
              <button
                className={`${styles.inlineBtn} ${styles.inlineBtnCancel}`}
                onClick={() => onCancel(item.inventionId)}
              >
                Cancel
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
