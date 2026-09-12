/**
 * SearchPanel — World directory search with breadcrumb navigation.
 *
 * Home page: category cards built from the gateway's home menu (`homeData.categories`) —
 * see home-tiles.ts for the id -> action mapping.
 * Drill-down pages render actual data from the search store.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ChevronRight, Building2, UserSearch, Trophy, Landmark, Search, Newspaper, User, MapPin, Flag,
} from 'lucide-react';
import { useSearchStore } from '../../store/search-store';
import { useClient } from '../../context';
import { GlassCard, Skeleton, ErrorBoundary } from '../common';
import type {
  TownInfo, RankingCategory, RankingEntry, SearchMenuCategory,
} from '@/shared/types';
import { TycoonProfileView } from './TycoonProfileView';
import { TycoonFullProfileView } from './TycoonFullProfileView';
import { MediaPage } from './MediaPage';
import { DirectoryPage, openDirectory } from './DirectoryPage';
import { homeTileAction, type HomeTileAction } from './home-tiles';
import styles from './SearchPanel.module.css';

const TILE_ICONS: Record<string, React.ReactNode> = {
  Towns: <Building2 size={20} />,
  Tycoons: <UserSearch size={20} />,
  Rankings: <Trophy size={20} />,
  Banks: <Landmark size={20} />,
  Newspapers: <Newspaper size={20} />,
  local: <Flag size={20} />,
  capitol: <Flag size={20} />,
  RenderTycoon: <User size={20} />,
};

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
          // RenderTown.inc:6 — the row opens the town page; the map jump it used to do
          // is now the explicit action below.
          onClick={() => openDirectory(client, { kind: 'town', path: town.path, classId: town.classId })}
        >
          <div className={styles.listItemHeader}>
            {town.iconUrl
              ? <img src={town.iconUrl} alt="" width={32} className={styles.listItemIcon} />
              : <Building2 size={16} className={styles.listItemIcon} />}
            <span className={styles.listItemTitle}>{town.name}</span>
          </div>
          <div className={styles.listItemDetails}>
            {/* RenderTown.inc:19-35 — a town with no ruler says "none" in red, it does not omit the line. */}
            <span className={town.mayor ? undefined : styles.mayorNone}>
              {town.mayor
                ? `Mayor: ${town.mayor}${town.mayorTerm ? ` (Term ${town.mayorTerm})` : ''}`
                : 'Mayor: none'}
            </span>
            <span>Pop: {town.population.toLocaleString()}</span>
            <span>Unemployment: {town.unemploymentPercent}%</span>
            <span>QoL: {town.qualityOfLife}%</span>
            <button
              type="button"
              className={styles.rowAction}
              onClick={(e) => {
                e.stopPropagation();
                client.onNavigateToBuilding(town.x, town.y);
              }}
            >
              <MapPin size={12} /> Show on map
            </button>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People search sub-page (RDO-based directory search)
// ---------------------------------------------------------------------------

/** The A-Z index of the People page — one bucket of `Root/Users` per letter. */
const PEOPLE_INDEX_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function PeoplePage() {
  const results = useSearchStore((s) => s.peopleData?.results) ?? [];
  const isLoading = useSearchStore((s) => s.isLoading);
  const peopleQuery = useSearchStore((s) => s.peopleQuery);
  const client = useClient();
  const [searchStr, setSearchStr] = useState('');

  const handleSearch = useCallback(() => {
    const trimmed = searchStr.trim();
    if (trimmed) {
      useSearchStore.getState().setPeopleQuery({ mode: 'contains', term: trimmed });
      useSearchStore.getState().setLoading(true);
      client.onSearchMenuPeopleSearch(trimmed, 'contains');
    }
  }, [searchStr, client]);

  /** Browse the roster: one letter, no text typed. */
  const handleLetter = useCallback((letter: string) => {
    setSearchStr('');
    useSearchStore.getState().setPeopleQuery({ mode: 'prefix', term: letter });
    useSearchStore.getState().setLoading(true);
    client.onSearchMenuPeopleSearch(letter, 'prefix');
  }, [client]);

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

      {/* A-Z index — browse without typing anything */}
      <div className={styles.letterIndex} role="group" aria-label="Browse players by first letter">
        {PEOPLE_INDEX_LETTERS.map((letter) => {
          const active = peopleQuery?.mode === 'prefix' && peopleQuery.term === letter;
          return (
            <button
              key={letter}
              type="button"
              className={`${styles.letterBtn} ${active ? styles.letterBtnActive : ''}`}
              aria-pressed={active}
              onClick={() => handleLetter(letter)}
            >
              {letter}
            </button>
          );
        })}
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

      {/* Empty state — a letter that found nobody says so, it does not fall
          back to the "type something" placeholder. */}
      {results.length === 0 && !isLoading && (
        <div className={styles.emptyState}>
          {peopleQuery?.mode === 'prefix'
            ? `No players whose name starts with ${peopleQuery.term}.`
            : 'Search for people by name.'}
        </div>
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

/**
 * One podium place (Ranking.asp:78-106). Its own component because the photo
 * fallback needs a `useState` and hooks cannot live inside a `.map` — same shape
 * as RulerCard.
 */
function PodiumCard({ entry }: { entry: RankingEntry }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = Boolean(entry.photoUrl) && !photoFailed;

  return (
    <div className={styles.podiumCard}>
      {showPhoto ? (
        <img
          className={styles.profilePhoto}
          src={entry.photoUrl}
          alt=""
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        <div className={styles.profilePhotoPlaceholder}><User size={28} /></div>
      )}
      <span className={styles.rankingName}>#{entry.rank} {entry.name}</span>
      <span className={styles.rankingValue}>{entry.valueText}</span>
    </div>
  );
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
    const podium = detail.entries.filter((e: RankingEntry) => e.rank <= 3);
    const tail = detail.entries.filter((e: RankingEntry) => e.rank > 3);

    return (
      <div className={styles.listContainer}>
        <button
          className={styles.backLink}
          onClick={() => useSearchStore.getState().clearRankingDetail()}
        >
          ← Back to rankings
        </button>
        <h3 className={styles.sectionTitle}>{detail.title}</h3>
        {detail.entries.length === 0 ? (
          // Ranking.asp:132-136 prints strNoRelevant when Count = 0
          // (New Directory.lng:24).
          <div className={styles.emptyState}>
            There is no relevant performance to highlight in this area.
          </div>
        ) : (
          <>
            {podium.length > 0 && (
              <div className={styles.podium}>
                {podium.map((entry: RankingEntry) => (
                  <PodiumCard key={`${entry.rank}-${entry.name}`} entry={entry} />
                ))}
              </div>
            )}
            <div className={styles.rankingTable}>
              {tail.map((entry: RankingEntry) => (
                <div key={`${entry.rank}-${entry.name}`} className={styles.rankingRow}>
                  <span className={styles.rankingRank}>#{entry.rank}</span>
                  <span className={styles.rankingName}>{entry.name}</span>
                  <span className={styles.rankingValue}>{entry.valueText}</span>
                </div>
              ))}
            </div>
          </>
        )}
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
  'tycoon-full-profile': TycoonFullProfileView,
  rankings: RankingsPage,
  banks: BanksPage,
  media: MediaPage,
  directory: DirectoryPage,
};

const PAGE_LABELS: Record<string, string> = {
  towns: 'Towns',
  people: 'People',
  'tycoon-profile': 'Tycoon Profile',
  'tycoon-full-profile': 'Profile',
  rankings: 'Rankings',
  'ranking-detail': 'Ranking Detail',
  banks: 'Banks',
  media: 'Media',
  directory: 'Directory',
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function SearchPanel() {
  const currentPage = useSearchStore((s) => s.currentPage);
  const isLoading = useSearchStore((s) => s.isLoading);
  const navigateTo = useSearchStore((s) => s.navigateTo);
  const goBack = useSearchStore((s) => s.goBack);
  const pageHistory = useSearchStore((s) => s.pageHistory);
  const tiles = useSearchStore((s) => s.homeData?.categories);
  const client = useClient();

  // Request home data when opened
  useEffect(() => {
    client.onSearchMenuHome();
  }, [client]);

  const runTile = useCallback((cat: SearchMenuCategory, action: HomeTileAction) => {
    switch (action.kind) {
      case 'page': navigateTo(action.page); return;
      case 'you':
        navigateTo('tycoon-profile');
        client.onSearchMenuTycoonProfile('YOU');   // search-menu-service.ts:217-218 resolves YOU
        return;
      case 'capitol':
        if (cat.x !== undefined && cat.y !== undefined) client.onNavigateToBuilding(cat.x, cat.y);
        return;
    }
  }, [navigateTo, client]);

  // Fetch category data when navigating to a category page
  useEffect(() => {
    // 'directory' is caller-fetched: openDirectory asks for the exact level it pushed.
    if (currentPage === 'home' || currentPage === 'ranking-detail' || currentPage === 'tycoon-profile'
      || currentPage === 'tycoon-full-profile' || currentPage === 'directory') return;
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

      {/* Home — category grid, built from homeData.categories */}
      {!isLoading && currentPage === 'home' && tiles === undefined && (
        <div className={styles.loading}><Skeleton width="100%" height="60px" /></div>
      )}
      {!isLoading && currentPage === 'home' && tiles !== undefined && (
        <div className={styles.categoryGrid}>
          {tiles.map((cat) => {
            const action = homeTileAction(cat);
            const usable = cat.enabled && action !== null
              && (action.kind !== 'capitol' || (cat.x !== undefined && cat.y !== undefined));
            return (
              <GlassCard
                key={cat.id}
                className={`${styles.categoryCard} ${usable ? '' : styles.categoryCardDisabled}`}
                onClick={usable ? () => runTile(cat, action) : undefined}
              >
                <span className={styles.categoryIcon}>{TILE_ICONS[cat.id] ?? <Search size={20} />}</span>
                <span className={styles.categoryLabel}>{cat.label}</span>
              </GlassCard>
            );
          })}
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
