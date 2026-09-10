/**
 * SearchPanel — World directory search with breadcrumb navigation.
 *
 * Home page: the category grid the server sends (`homeData.categories`) — adding or
 * removing a tile server-side changes the panel with no client edit.
 * Drill-down pages render actual data from the search store.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ChevronRight, Building, Building2, UserRound, UserSearch, Trophy, Landmark, Search, Newspaper,
} from 'lucide-react';
import { useSearchStore, type SearchPage } from '../../store/search-store';
import { useClient } from '../../context';
import { GlassCard, Skeleton, ErrorBoundary } from '../common';
import type {
  TownInfo, RankingCategory, RankingEntry, SearchMenuCategory,
} from '@/shared/types';
import { TycoonProfileView } from './TycoonProfileView';
import { MediaPage } from './MediaPage';
import { pageForCategoryId } from './home-tiles';
import styles from './SearchPanel.module.css';

const ICON_BY_ID: Record<string, React.ReactNode> = {
  capitol: <Building size={20} />,
  towns: <Building2 size={20} />,
  rendertycoon: <UserRound size={20} />,
  tycoons: <UserSearch size={20} />,
  rankings: <Trophy size={20} />,
  banks: <Landmark size={20} />,
  newspapers: <Newspaper size={20} />,
};

function iconForCategoryId(id: string): React.ReactNode {
  return ICON_BY_ID[id.toLowerCase()] ?? <Search size={20} />;
}

// ---------------------------------------------------------------------------
// Towns sub-page
// ---------------------------------------------------------------------------

function TownsPage() {
  const towns = useSearchStore((s) => s.townsData?.towns) ?? [];
  const client = useClient();

  if (towns.length === 0) {
    return <div className={styles.emptyState}>No towns found.</div>;
  }

  return (
    <div className={styles.listContainer}>
      {towns.map((town: TownInfo) => (
        <GlassCard
          key={town.name}
          className={styles.listItem}
          light
          onClick={() => client.onNavigateToBuilding(town.x, town.y)}
        >
          <div className={styles.listItemHeader}>
            <Building2 size={16} className={styles.listItemIcon} />
            <span className={styles.listItemTitle}>{town.name}</span>
          </div>
          <div className={styles.listItemDetails}>
            {town.mayor && <span>Mayor: {town.mayor}</span>}
            <span>Pop: {town.population.toLocaleString()}</span>
            <span>QoL: {town.qualityOfLife}%</span>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People search sub-page (RDO-based directory search)
// ---------------------------------------------------------------------------

function PeoplePage() {
  const results = useSearchStore((s) => s.peopleData?.results) ?? [];
  const isLoading = useSearchStore((s) => s.isLoading);
  const client = useClient();
  const [searchStr, setSearchStr] = useState('');

  const handleSearch = useCallback(() => {
    const trimmed = searchStr.trim();
    if (trimmed) {
      useSearchStore.getState().setLoading(true);
      client.onSearchMenuPeopleSearch(trimmed);
    }
  }, [searchStr, client]);

  return (
    <div className={styles.listContainer}>
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search people..."
          value={searchStr}
          onChange={(e) => setSearchStr(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button className={styles.searchBtn} onClick={handleSearch} disabled={isLoading}>
          <Search size={14} />
        </button>
      </div>

      {/* Search results list */}
      {results.length > 0 && !isLoading && (
        <div className={styles.simpleList}>
          {results.map((name: string) => (
            <div
              key={name}
              className={styles.clickableListItem}
              onClick={() => {
                useSearchStore.getState().navigateTo('tycoon-profile');
                client.onSearchMenuTycoonProfile(name);
              }}
            >
              <UserSearch size={14} className={styles.listItemIcon} />
              <span>{name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {results.length === 0 && !isLoading && (
        <div className={styles.emptyState}>Search for people by name.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rankings sub-page (flattened tree with visual hierarchy → detail)
// ---------------------------------------------------------------------------

interface FlatRankingItem {
  cat: RankingCategory;
  depth: number;
  hasChildren: boolean;
}

function flattenCategories(categories: RankingCategory[], depth: number = 0): FlatRankingItem[] {
  const result: FlatRankingItem[] = [];
  for (const cat of categories) {
    const hasChildren = (cat.children?.length ?? 0) > 0;
    result.push({ cat, depth, hasChildren });
    if (cat.children && cat.children.length > 0) {
      result.push(...flattenCategories(cat.children, depth + 1));
    }
  }
  return result;
}

function RankingsPage() {
  const categories = useSearchStore((s) => s.rankingsData?.categories) ?? [];
  const detail = useSearchStore((s) => s.rankingDetailData);
  const client = useClient();

  const flatItems = useMemo(() => flattenCategories(categories), [categories]);

  const handleCategoryClick = useCallback((cat: RankingCategory) => {
    useSearchStore.getState().setLoading(true);
    client.onSearchMenuRankingDetail(cat.url);
  }, [client]);

  // Show detail view if loaded
  if (detail) {
    return (
      <div className={styles.listContainer}>
        <button
          className={styles.backLink}
          onClick={() => useSearchStore.getState().clearRankingDetail()}
        >
          ← Back to rankings
        </button>
        <h3 className={styles.sectionTitle}>{detail.title}</h3>
        <div className={styles.rankingTable}>
          {detail.entries.map((entry: RankingEntry) => (
            <div key={`${entry.rank}-${entry.name}`} className={styles.rankingRow}>
              <span className={styles.rankingRank}>#{entry.rank}</span>
              <span className={styles.rankingName}>{entry.name}</span>
              <span className={styles.rankingValue}>{entry.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (flatItems.length === 0) {
    return <div className={styles.emptyState}>No ranking categories available.</div>;
  }

  return (
    <div className={styles.listContainer}>
      {flatItems.map(({ cat, depth, hasChildren }) => (
        <div
          key={cat.id}
          className={`${styles.rankingItem} ${hasChildren ? styles.rankingCategoryItem : styles.rankingLeafItem}`}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => handleCategoryClick(cat)}
        >
          {hasChildren ? (
            <Trophy size={14} className={styles.listItemIcon} />
          ) : (
            <ChevronRight size={12} className={styles.rankingChevron} />
          )}
          <span>{cat.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banks sub-page
// ---------------------------------------------------------------------------

function BanksPage() {
  const banks = useSearchStore((s) => s.banksData?.banks) ?? [];

  if (banks.length === 0) {
    return <div className={styles.emptyState}>No banks found.</div>;
  }

  return (
    <div className={styles.listContainer}>
      {banks.map((bank, idx) => {
        const b = bank as Record<string, unknown>;
        return (
          <GlassCard key={String(b.name ?? idx)} className={styles.listItem} light>
            <div className={styles.listItemHeader}>
              <Landmark size={16} className={styles.listItemIcon} />
              <span className={styles.listItemTitle}>{String(b.name ?? `Bank ${idx + 1}`)}</span>
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component map
// ---------------------------------------------------------------------------

const PAGE_COMPONENTS: Record<string, React.FC> = {
  towns: TownsPage,
  people: PeoplePage,
  'tycoon-profile': TycoonProfileView,
  rankings: RankingsPage,
  banks: BanksPage,
  media: MediaPage,
};

const PAGE_LABELS: Record<string, string> = {
  towns: 'Towns',
  people: 'People',
  'tycoon-profile': 'Tycoon Profile',
  rankings: 'Rankings',
  'ranking-detail': 'Ranking Detail',
  banks: 'Banks',
  media: 'Media',
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

/** Action a home tile fires when clicked, or undefined for a tile that is dimmed and inert. */
function tileAction(
  cat: SearchMenuCategory,
  client: ReturnType<typeof useClient>,
  navigateTo: (page: SearchPage) => void,
): (() => void) | undefined {
  if (!cat.enabled) return undefined;
  const id = cat.id.toLowerCase();

  if (id === 'capitol') {
    if (typeof cat.x !== 'number' || typeof cat.y !== 'number') return undefined;
    return () => client.onNavigateToBuilding(cat.x as number, cat.y as number);
  }

  const page = pageForCategoryId(id);
  if (page === 'tycoon-profile') {
    return () => {
      navigateTo('tycoon-profile');
      client.onSearchMenuTycoonProfile('YOU');
    };
  }
  if (page === null) return undefined;
  return () => navigateTo(page);
}

export function SearchPanel() {
  const currentPage = useSearchStore((s) => s.currentPage);
  const isLoading = useSearchStore((s) => s.isLoading);
  const navigateTo = useSearchStore((s) => s.navigateTo);
  const goBack = useSearchStore((s) => s.goBack);
  const pageHistory = useSearchStore((s) => s.pageHistory);
  const homeData = useSearchStore((s) => s.homeData);
  const client = useClient();

  // Request home data when opened
  useEffect(() => {
    client.onSearchMenuHome();
  }, [client]);

  // Fetch category data when navigating to a category page
  useEffect(() => {
    if (currentPage === 'home' || currentPage === 'ranking-detail' || currentPage === 'tycoon-profile') return;
    const fetchers: Record<string, () => void> = {
      towns: () => client.onSearchMenuTowns(),
      people: () => {
        // People page shows a search field — just stop loading (no server roundtrip needed)
        useSearchStore.getState().setLoading(false);
      },
      rankings: () => client.onSearchMenuRankings(),
      banks: () => client.onSearchMenuBanks(),
      media: () => client.onSearchMenuNewspapers(),
    };
    fetchers[currentPage]?.();
  }, [currentPage, client]);

  const PageComponent = currentPage !== 'home' ? PAGE_COMPONENTS[currentPage] : null;

  return (
    <div className={styles.panel}>
      {/* Breadcrumb navigation */}
      {currentPage !== 'home' && (
        <div className={styles.breadcrumb}>
          <button className={styles.breadcrumbLink} onClick={goBack}>
            {pageHistory.length > 0 ? '← Back' : '← Home'}
          </button>
          <ChevronRight size={12} className={styles.breadcrumbSep} />
          <span className={styles.breadcrumbCurrent}>
            {PAGE_LABELS[currentPage] ?? currentPage}
          </span>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className={styles.loading}>
          <Skeleton width="100%" height="60px" />
          <Skeleton width="100%" height="60px" />
          <Skeleton width="100%" height="60px" />
        </div>
      )}

      {/* Home — category grid, built from the server's homeData.categories */}
      {!isLoading && currentPage === 'home' && (
        <div className={styles.categoryGrid}>
          {homeData === null ? (
            <div className={styles.emptyState}>Loading directory…</div>
          ) : (
            homeData.categories.map((cat) => {
              const onClick = tileAction(cat, client, navigateTo);
              return (
                <GlassCard
                  key={cat.id}
                  className={
                    onClick
                      ? styles.categoryCard
                      : `${styles.categoryCard} ${styles.categoryCardDisabled}`
                  }
                  onClick={onClick}
                >
                  <span className={styles.categoryIcon}>{iconForCategoryId(cat.id)}</span>
                  <span className={styles.categoryLabel} data-tile={cat.id}>{cat.label}</span>
                </GlassCard>
              );
            })
          )}
        </div>
      )}

      {/* Drill-down pages — actual data from stores */}
      {!isLoading && currentPage !== 'home' && PageComponent && (
        <div className={styles.pageContent}>
          <ErrorBoundary>
            <PageComponent />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}
