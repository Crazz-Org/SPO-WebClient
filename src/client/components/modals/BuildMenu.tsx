/**
 * BuildMenu — Centered modal for building construction.
 *
 * Two phases:
 * 1. Category grid — building type categories with icons
 * 2. Facility list — buildings within selected category (expandable "blueprint" cards)
 *
 * Selecting a building closes the menu and starts placement mode.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, ArrowLeft, Lock } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import { GlassCard, Skeleton } from '../common';
import type { BuildingCategory, BuildingInfo } from '@/shared/types';
import styles from './BuildMenu.module.css';

const RESIDENCE_GROUPS: { key: BuildingInfo['residenceClass']; label: string; styleClass: string }[] = [
  { key: 'high', label: 'High Class', styleClass: styles.resGroupHigh },
  { key: 'middle', label: 'Middle Class', styleClass: styles.resGroupMid },
  { key: 'low', label: 'Low Class', styleClass: styles.resGroupLow },
];

type Phase = 'categories' | 'facilities';

/** Mini tile grid visualization showing building footprint */
function TileGrid({ xsize, ysize }: { xsize: number; ysize: number }) {
  // Cap display at 6×6 to keep grid reasonable
  const displayX = Math.min(xsize, 6);
  const displayY = Math.min(ysize, 6);
  return (
    <div
      className={styles.tileGrid}
      style={{ gridTemplateColumns: `repeat(${displayX}, 12px)` }}
      aria-label={`${xsize} by ${ysize} tile footprint`}
    >
      {Array.from({ length: displayX * displayY }, (_, i) => (
        <div key={i} className={styles.tileCell} />
      ))}
    </div>
  );
}

/** Zone requirement tag with colored dot */
function ZoneTag({ zone }: { zone: string }) {
  if (!zone) return null;
  return (
    <span className={styles.zoneTag}>
      <span className={styles.zoneDot} />
      {zone}
    </span>
  );
}

function FacilityCard({ facility, isExpanded, onToggleExpand, onSelect, cash }: {
  facility: BuildingInfo;
  isExpanded: boolean;
  onToggleExpand: (facilityClass: string) => void;
  onSelect: (f: { facilityClass: string; visualClassId: string; available: boolean }) => void;
  /** Player cash, when known — shows "cash after" and blocks an unaffordable placement (T1, H4). */
  cash?: number;
}) {
  const hasDims = facility.xsize != null && facility.ysize != null && facility.xsize > 0 && facility.ysize > 0;
  const after = cash !== undefined ? cash - facility.cost : undefined;
  const unaffordable = after !== undefined && after < 0;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (facility.available) onToggleExpand(facility.facilityClass);
    }
  }, [facility.available, facility.facilityClass, onToggleExpand]);

  return (
    <div
      className={`${styles.facilityCard} ${isExpanded ? styles.expanded : ''} ${!facility.available ? styles.unavailable : ''}`}
      onClick={() => facility.available && onToggleExpand(facility.facilityClass)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={facility.available ? 0 : -1}
      aria-expanded={isExpanded}
      aria-disabled={!facility.available}
      title={!facility.available ? 'Not available yet' : undefined}
    >
      {/* Collapsed row: Icon + Name/Desc + Cost/Tiles */}
      <div className={styles.facilityRow}>
        {facility.iconPath ? (
          <div className={styles.iconWrap}>
            <img
              src={facility.iconPath}
              alt={facility.name}
              className={styles.facilityIcon}
            />
            {!facility.available && (
              <span className={styles.lockOverlay} aria-hidden="true">
                <Lock size={14} />
              </span>
            )}
          </div>
        ) : !facility.available ? (
          <div className={styles.iconWrap}>
            <span className={styles.lockOverlay} aria-hidden="true">
              <Lock size={14} />
            </span>
          </div>
        ) : null}
        <div className={styles.facilityInfo}>
          <span className={styles.facilityName}>{facility.name}</span>
          {!isExpanded && (
            <span className={styles.facilityDesc}>{facility.description}</span>
          )}
        </div>
        <div className={styles.facilityMeta}>
          {!facility.available ? (
            <span className={styles.lockedBadge}>Locked</span>
          ) : (
            <span className={styles.facilityCost}>${facility.cost.toLocaleString()}</span>
          )}
          {hasDims && (
            <span className={styles.tileBadge}>
              {facility.xsize}×{facility.ysize}
            </span>
          )}
        </div>
      </div>

      {/* Under the Locked badge: the server's own requirement sentence
          (`FacilityList.asp:287-291`), or today's wording when the page
          carries none. */}
      {!facility.available && (
        <p className={styles.lockRequirement}>
          {facility.requirement || 'Not available yet'}
        </p>
      )}

      {/* Expanded detail area */}
      {isExpanded && (
        <div className={styles.facilityExpanded}>
          <p className={styles.fullDesc}>{facility.description}</p>
          <div className={styles.expandedLayout}>
            {hasDims && (
              <TileGrid xsize={facility.xsize!} ysize={facility.ysize!} />
            )}
            <div className={styles.expandedMeta}>
              {facility.zoneRequirement && <ZoneTag zone={facility.zoneRequirement} />}
              <span className={styles.metaLine}>
                Cost: ${facility.cost.toLocaleString()}
              </span>
              {after !== undefined && (
                <span className={`${styles.metaLine} ${unaffordable ? styles.metaNegative : styles.metaPositive}`}>
                  Cash after: {after < 0 ? '-' : ''}${Math.abs(after).toLocaleString()}
                </span>
              )}
              {hasDims && (
                <span className={styles.metaLine}>
                  Tiles: {facility.xsize} × {facility.ysize} ({facility.xsize! * facility.ysize!} tiles)
                </span>
              )}
            </div>
          </div>
          <button
            className={styles.placeBtn}
            disabled={unaffordable}
            title={unaffordable ? 'Not enough cash' : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (!unaffordable) onSelect(facility);
            }}
          >
            Place Building
          </button>
        </div>
      )}
    </div>
  );
}

interface BuildMenuProps {
  /** When true, renders inline without modal wrapper (used in mobile BottomSheet). */
  embedded?: boolean;
  /** Called when a building is selected in embedded mode. */
  onClose?: () => void;
}

export function BuildMenu({ embedded = false, onClose }: BuildMenuProps = {}) {
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const categories = useUiStore((s) => s.buildMenuCategories);
  const facilities = useUiStore((s) => s.buildMenuFacilities);
  const capitolIconUrl = useUiStore((s) => s.capitolIconUrl);

  const isPublicOfficeRole = useGameStore((s) => s.isPublicOfficeRole);
  const client = useClient();
  const [phase, setPhase] = useState<Phase>('categories');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [expandedFacility, setExpandedFacility] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const cash = useGameStore((s) => s.tycoonStats?.cash);
  const cashNum = cash ? parseFloat(String(cash).replace(/,/g, '')) : NaN;

  // Load categories when opened (modal mode or embedded mode). The list is kept for the
  // session (T1 handoff: one request, then cache) — only an empty store triggers a read.
  useEffect(() => {
    if (!embedded && modal !== 'buildMenu') return;
    setPhase('categories');
    setExpandedFacility(null);
    if (useUiStore.getState().buildMenuCategories.length === 0) {
      setIsLoading(true);
      client.onRequestBuildingCategories();
    } else {
      setIsLoading(false);
    }
  }, [modal, client, embedded]);

  // Stop loading when store receives data
  useEffect(() => {
    if (categories.length > 0) setIsLoading(false);
  }, [categories]);

  useEffect(() => {
    if (facilities.length > 0) setIsLoading(false);
  }, [facilities]);

  // Reset expanded card when switching to facilities phase
  useEffect(() => {
    setExpandedFacility(null);
  }, [facilities]);

  const handleCategorySelect = useCallback(
    (category: BuildingCategory) => {
      setSelectedCategory(category.kindName);
      setPhase('facilities');
      setIsLoading(true);
      client.onRequestBuildingFacilities(category.kind, category.cluster);
    },
    [client],
  );

  const dismiss = useCallback(() => {
    if (embedded) {
      onClose?.();
    } else {
      closeModal();
    }
  }, [embedded, onClose, closeModal]);

  const handleBuildCapitol = useCallback(() => {
    dismiss();
    client.onBuildCapitol();
  }, [dismiss, client]);

  const handleFacilitySelect = useCallback(
    (facility: { facilityClass: string; visualClassId: string; available: boolean }) => {
      dismiss();
      client.onPlaceBuilding(facility.facilityClass, facility.visualClassId);
    },
    [dismiss, client],
  );

  const handleToggleExpand = useCallback((facilityClass: string) => {
    setExpandedFacility((prev) => prev === facilityClass ? null : facilityClass);
  }, []);

  // Group facilities by residence class when any facility has one
  const hasResidenceGroups = useMemo(
    () => facilities.some((f) => f.residenceClass),
    [facilities],
  );

  const renderFacilityCard = useCallback((fac: BuildingInfo) => (
    <FacilityCard
      key={fac.facilityClass}
      facility={fac}
      isExpanded={expandedFacility === fac.facilityClass}
      onToggleExpand={handleToggleExpand}
      onSelect={handleFacilitySelect}
      cash={Number.isNaN(cashNum) ? undefined : cashNum}
    />
  ), [expandedFacility, handleToggleExpand, handleFacilitySelect, cashNum]);

  // Local filter — no request. Matches on name (and description) of the loaded list.
  const q = filter.trim().toLowerCase();
  const visibleFacilities = useMemo(
    () => (q ? facilities.filter((f) => f.name.toLowerCase().includes(q) || f.description?.toLowerCase().includes(q)) : facilities),
    [facilities, q],
  );
  const visibleCategories = useMemo(
    () => (q ? categories.filter((c) => c.kindName.toLowerCase().includes(q)) : categories),
    [categories, q],
  );

  if (!embedded && modal !== 'buildMenu') return null;

  // Embedded mode: render content directly without modal wrapper
  if (embedded) {
    return (
      <div>
        {/* Header */}
        <div className={styles.header}>
          {phase === 'facilities' && (
            <button className={styles.backBtn} onClick={() => setPhase('categories')}>
              <ArrowLeft size={16} />
            </button>
          )}
          <h2 className={styles.title}>
            {phase === 'categories' ? 'Build' : selectedCategory}
          </h2>
        </div>
        <div className={styles.filterRow}>
          <input
            type="search"
            className={styles.filterInput}
            placeholder={phase === 'categories' ? 'Filter categories…' : 'Filter buildings by name…'}
            aria-label={phase === 'categories' ? 'Filter categories' : 'Filter buildings by name'}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {/* Content */}
        <div className={styles.content}>
          {isLoading && (
            <div className={styles.loadingGrid}>
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} width="100%" height="80px" />
              ))}
            </div>
          )}

          {!isLoading && phase === 'categories' && (
            <div className={styles.categoryGrid}>
              {visibleCategories.map((cat) => (
                <GlassCard
                  key={cat.kind}
                  className={styles.categoryCard}
                  onClick={() => handleCategorySelect(cat)}
                >
                  {cat.iconPath && (
                    <img src={cat.iconPath} alt={cat.kindName} className={styles.categoryIcon} />
                  )}
                  <span className={styles.categoryName}>{cat.kindName}</span>
                </GlassCard>
              ))}
              {isPublicOfficeRole && capitolIconUrl && (
                <GlassCard
                  className={`${styles.categoryCard} ${styles.capitolCard}`}
                  onClick={handleBuildCapitol}
                >
                  <img src={capitolIconUrl} alt="Capitol" className={styles.categoryIcon} />
                  <span className={styles.categoryName}>Capitol</span>
                  <span className={styles.officeBadge}>Public Office</span>
                </GlassCard>
              )}
            </div>
          )}

          {!isLoading && phase === 'facilities' && (
            <div className={styles.facilityList}>
              {hasResidenceGroups
                ? <>
                    {RESIDENCE_GROUPS.map(({ key, label, styleClass }) => {
                      const group = visibleFacilities.filter((f) => f.residenceClass === key);
                      if (group.length === 0) return null;
                      return (
                        <div key={key} className={styles.resGroup}>
                          <div className={`${styles.resGroupHeader} ${styleClass}`}>{label}</div>
                          {group.map(renderFacilityCard)}
                        </div>
                      );
                    })}
                    {visibleFacilities.filter((f) => !f.residenceClass).map(renderFacilityCard)}
                  </>
                : visibleFacilities.map(renderFacilityCard)}
              {facilities.length === 0 && (
                <div className={styles.empty}>No buildings available in this category</div>
              )}
              {facilities.length > 0 && visibleFacilities.length === 0 && (
                <div className={styles.empty}>No building matches “{filter.trim()}”</div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div className={styles.backdrop} onClick={closeModal} aria-hidden="true" />

      <div className={styles.modal} role="dialog" aria-label="Build Menu">
        {/* Header */}
        <div className={styles.header}>
          {phase === 'facilities' && (
            <button className={styles.backBtn} onClick={() => setPhase('categories')}>
              <ArrowLeft size={16} />
            </button>
          )}
          <h2 className={styles.title}>
            {phase === 'categories' ? 'Build' : selectedCategory}
          </h2>
          <button className={styles.closeBtn} onClick={closeModal} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {isLoading && (
            <div className={styles.loadingGrid}>
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} width="100%" height="80px" />
              ))}
            </div>
          )}

          {!isLoading && phase === 'categories' && (
            <div className={styles.categoryGrid}>
              {categories.map((cat) => (
                <GlassCard
                  key={cat.kind}
                  className={styles.categoryCard}
                  onClick={() => handleCategorySelect(cat)}
                >
                  {cat.iconPath && (
                    <img
                      src={cat.iconPath}
                      alt={cat.kindName}
                      className={styles.categoryIcon}
                    />
                  )}
                  <span className={styles.categoryName}>{cat.kindName}</span>
                </GlassCard>
              ))}
              {isPublicOfficeRole && capitolIconUrl && (
                <GlassCard
                  className={`${styles.categoryCard} ${styles.capitolCard}`}
                  onClick={handleBuildCapitol}
                >
                  <img
                    src={capitolIconUrl}
                    alt="Capitol"
                    className={styles.categoryIcon}
                  />
                  <span className={styles.categoryName}>Capitol</span>
                  <span className={styles.officeBadge}>Public Office</span>
                </GlassCard>
              )}
            </div>
          )}

          {!isLoading && phase === 'facilities' && (
            <div className={styles.facilityList}>
              {hasResidenceGroups
                ? <>
                    {RESIDENCE_GROUPS.map(({ key, label, styleClass }) => {
                      const group = facilities.filter((f) => f.residenceClass === key);
                      if (group.length === 0) return null;
                      return (
                        <div key={key} className={styles.resGroup}>
                          <div className={`${styles.resGroupHeader} ${styleClass}`}>
                            {label}
                          </div>
                          {group.map(renderFacilityCard)}
                        </div>
                      );
                    })}
                    {facilities.filter((f) => !f.residenceClass).map(renderFacilityCard)}
                  </>
                : facilities.map(renderFacilityCard)}
              {facilities.length === 0 && (
                <div className={styles.empty}>No buildings available in this category</div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
