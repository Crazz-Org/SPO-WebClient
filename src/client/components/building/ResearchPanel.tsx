/**
 * ResearchPanel — Research/Inventions panel for HQ buildings.
 *
 * Layout:
 *   CategoryTabBar  (5 tabs: GENERAL, COMMERCE, REAL ESTATE, INDUSTRY, CIVICS)
 *   InventionGroupList (scrollable)
 *     InventionGroup[] (collapsible accordion per parent category)
 *       GroupHeader  (green/grey dot + name + chevron + "N available" badge)
 *       InventionRow[] (status dot + name + inline Research/Cancel button)
 *   DetailPanel (slide-down when invention selected)
 */

import { useEffect, useCallback, useState, useMemo } from 'react';
import type { ResearchInventionDetails } from '@/shared/types';
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
  type MergedInventionItem,
} from './research-utils';
import styles from './ResearchPanel.module.css';

interface ResearchPanelProps {
  buildingX: number;
  buildingY: number;
}

const FALLBACK_TABS = ['GENERAL', 'COMMERCE', 'REAL ESTATE', 'INDUSTRY', 'CIVICS'];

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

  // Fetch category tabs + first category on mount
  useEffect(() => {
    client.onResearchFetchCategoryTabs();
    client.onResearchLoadInventory(buildingX, buildingY, 0);
  }, [client, buildingX, buildingY]);

  // Handle tab change — lazy load if not cached
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
  const groups = useMemo(() => {
    if (!inventory) return null;
    const merged = mergeAndSortInventions(inventory);
    return groupInventionsByParent(merged);
  }, [inventory]);

  // The heading is the same label the clicked row shows; the server already
  // defaulted `name` to the id when the .dat index has no entry.
  const selectedName = useMemo(() => {
    if (!selectedId || !inventory) return selectedId;
    const item = [...inventory.available, ...inventory.developing, ...inventory.completed]
      .find((i) => i.inventionId === selectedId);
    return item?.name || selectedId;
  }, [inventory, selectedId]);

  return (
    <div className={styles.panel}>
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
          name={selectedName ?? selectedId}
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
  name,
  details,
  isLoading,
}: {
  inventionId: string;
  name: string;
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
      <div className={styles.detailHeader}>{name}</div>
      {details.properties && (
        <div className={styles.detailProperties}>{details.properties}</div>
      )}
      {details.description && (
        <div className={styles.detailDescription}>{details.description}</div>
      )}
    </div>
  );
}
