/**
 * BuildingInspector — Figma-like property sheet for building details.
 *
 * Slides in via RightPanel when a building is focused.
 * For civic buildings (Capitol/TownHall), uses consolidated tabs:
 *   Overview | Administration | Demographics | Elections
 * For other buildings, uses the server-sent pill grid tabs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Edit3, RefreshCw, X, Check, Crosshair, Star, Mail } from 'lucide-react';
import { useBuildingStore } from '../../store/building-store';
import { useEmpireStore } from '../../store/empire-store';
import { useGameStore } from '../../store/game-store';
import { useUiStore } from '../../store';
import { useClient } from '../../context';
import { isCivicBuilding } from '@/shared/building-details/civic-buildings';
import type { BuildingPropertyValue, TownHallDemographics } from '@/shared/types';
import { IconButton, Skeleton, TabBar } from '../common';
import { QuickStats } from './QuickStats';
import { InspectorHeader, findPropertyValue } from './InspectorHeader';
import { DiagnosisBanner, tabForAction } from './DiagnosisBanner';
import { parseFacilityDiagnosis } from '@/shared/building-details/facility-diagnosis';
import { InspectorMenu } from './InspectorMenu';
import { tycoonAddress, writeTo } from '../mail/write-to';
import { resolveSectionFetch, sectionDisplayState, type SectionDisplayState } from './inspector-sections';
import { parseRichDetails } from './RichDetails';
import { PropertyGroup } from './PropertyGroup';
import {
  OverviewSection,
  AdministrationSection,
  DemographicsSection,
  ElectionsSection,
  PoliticsSection,
  buildCivicTabs,
  getGeneralGroupId,
} from '../politics';
import type { CivicTabId } from '../politics/CivicTabConfig';
import styles from './BuildingInspector.module.css';
import { SaveIndicator } from './SaveIndicator';
import { RENAME_PENDING_KEY } from '../../handlers/building-action-handler';

/**
 * Auto-refresh interval for the open building panel (ms).
 *
 * Deliberately NOT slowed down for civic buildings, and `OB-29` is why. The
 * Town Hall is the one facility whose cache object opts into a TTL — two
 * minutes, `CreateTTL(0,0,2,0)` (`Kernel/Population.pas:1192`); every other
 * facility defaults to `NULLTTL` and re-pulls on every read
 * (`Cache/CacheAgent.pas:90`), the Capitol included. So on a Town Hall three
 * polls out of four hand back the bytes the previous one already returned.
 *
 * Matching the interval to that TTL looks tempting and is the wrong move: the
 * two clocks are not aligned. A poll that lands just before the TTL lapses
 * would then wait a full further interval, leaving a refreshed value unseen
 * for up to two minutes. Polling faster than the TTL is what bounds that gap
 * to one interval — the repeated reads are what buys the freshness, not waste
 * to be optimised away.
 */
const AUTO_REFRESH_INTERVAL = 30_000;

interface BuildingInspectorProps {
  /** Hide the built-in header (used when wrapped in a modal that already shows the name). */
  hideHeader?: boolean;
}

export function BuildingInspector({ hideHeader }: BuildingInspectorProps = {}) {
  const focusedBuilding = useBuildingStore((s) => s.focusedBuilding);
  const details = useBuildingStore((s) => s.details);
  const isLoading = useBuildingStore((s) => s.isLoading);
  const currentTab = useBuildingStore((s) => s.currentTab);
  const setCurrentTab = useBuildingStore((s) => s.setCurrentTab);
  const isOwner = useBuildingStore((s) => s.isOwner);
  const favorites = useEmpireStore((s) => s.facilities);
  const closeRightPanel = useUiStore((s) => s.closeRightPanel);
  const client = useClient();
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');

  const isCivic = details ? isCivicBuilding(details.visualClass) : false;
  const connectionStatus = useGameStore((s) => s.status);
  const isConnected = connectionStatus === 'connected';
  const worldName = useGameStore((s) => s.worldName);

  // Build civic tabs from server groups (only for civic buildings)
  const civicTabs = useMemo(() => {
    if (!details || !isCivic) return [];
    return buildCivicTabs(details.tabs);
  }, [details, isCivic]);

  // For non-civic buildings, use server-sent tabs directly
  const standardTabs = details?.tabs ?? [];

  // Candidacy used to be inferred here, from the `Candidate{i}` series and from
  // PoliticsData.campaigns, to gate a campaign button on the Elections tab. Both
  // now live on the Politics tab, where `tycooncampaign.asp` answers the
  // question directly (`:222-224`) and gives the reason when the answer is no.
  // The inference — and the store subscription plus useMemo it cost on every
  // details change — is gone with the button it served.

  /**
   * Does this player govern THIS facility?
   *
   * Decided by the gateway (`grantAccess` over the facility's SecurityId) and
   * shipped with the details. The requester half is the InitClient proxy id — a
   * pointer the browser never sees — so this cannot be computed here. A live run
   * proved the point: the facility's SecurityId is `-296197588--295583672--`,
   * object addresses, while `tycoonId` is 37.
   */
  const canGovern = details?.canGovern ?? false;

  const detailsError = useBuildingStore((s) => s.detailsError);

  // Compute active section + filtered properties BEFORE early returns so that
  // the useMemo hook is always called — React requires identical hook count
  // across every render of the same component instance.
  //
  // No fallback to the first tab any more: a `currentTab` that matches nothing
  // means the menu is showing, which is how the panel opens.
  const activeStandardTab = (!isCivic)
    ? standardTabs.find((t) => t.id === currentTab) ?? null
    : null;
  const activeGroupData = (details && activeStandardTab)
    ? details.groups[activeStandardTab.id]
    : undefined;
  const standardProperties = useMemo(
    () => activeGroupData ? activeGroupData.filter((p) => p.name !== 'Name') : [],
    [activeGroupData],
  );

  const handleRefresh = useCallback(() => {
    if (details) client.onRefreshBuilding(details.x, details.y);
  }, [details?.x, details?.y, client]);

  const handleRetryFromError = useCallback(() => {
    if (focusedBuilding) {
      useBuildingStore.getState().setDetailsError(null);
      useBuildingStore.getState().setLoading(true);
      client.onRefreshBuilding(focusedBuilding.x, focusedBuilding.y);
    }
  }, [focusedBuilding?.x, focusedBuilding?.y, client]);

  const handleClose = useCallback(() => {
    closeRightPanel();
  }, [closeRightPanel]);

  const handleStartRename = useCallback(() => {
    setNewName(details?.buildingName ?? '');
    setIsRenaming(true);
  }, [details]);

  const handleConfirmRename = useCallback(() => {
    if (newName.trim() && details) {
      client.onRenameBuilding(details.x, details.y, newName.trim());
    }
    setIsRenaming(false);
  }, [details?.x, details?.y, newName, client]);

  const handleCancelRename = useCallback(() => {
    setIsRenaming(false);
  }, []);

  // Matched on coordinates, not on name: the favourite keeps the name it was
  // given when it was added, and a building rename never updates it.
  const isFavorited = useMemo(
    () => !!details && favorites.some((f) => f.x === details.x && f.y === details.y),
    [favorites, details?.x, details?.y],
  );

  const handleAddFavorite = useCallback(() => {
    if (details) {
      client.onAddFavorite(details.buildingName, details.x, details.y);
    }
  }, [details?.buildingName, details?.x, details?.y, client]);

  // Auto-refresh building details while panel is open.
  // Refreshes basic properties and resets the active lazy tab so it re-fetches.
  const refreshTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    if (!details || !isConnected) return;
    const x = details.x;
    const y = details.y;

    const doRefresh = () => {
      if (!isConnected) return;
      client.onRefreshBuilding(x, y);
      // Tab re-fetch is handled by the useEffect at line ~162 which reacts
      // to resetTabLoadingStates() inside refreshBuildingDetails().
      // The previous 2-second setTimeout here caused race conditions by
      // overwriting in-flight 'loading' states with 'idle'.
    };

    const startTimer = () => {
      clearInterval(refreshTimer.current);
      refreshTimer.current = setInterval(doRefresh, AUTO_REFRESH_INTERVAL);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(refreshTimer.current);
      } else {
        startTimer();
      }
    };

    startTimer();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(refreshTimer.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [details?.x, details?.y, details?.visualClass, details?.tabs, currentTab, isConnected, client]);

  // Lazy tab loading state
  const tabLoadingStates = useBuildingStore((s) => s.tabLoadingStates);

  // Read the open section, if it is not already in hand. Nothing is read while
  // the menu is showing — that is the whole point of the section-at-a-time
  // panel: opening a facility costs the header group and nothing else.
  useEffect(() => {
    if (!details || !isConnected) return;

    const fetch = resolveSectionFetch(details, currentTab, isCivic, tabLoadingStates);
    if (fetch) {
      client.onRequestTabData(details.x, details.y, fetch.tabId, details.visualClass, fetch.groupIds);
    }
  }, [currentTab, details, isCivic, isConnected, tabLoadingStates, client]);

  // Loading state — show building name from focusedBuilding to prevent blink
  if (isLoading || (!details && !detailsError && focusedBuilding)) {
    return (
      <div className={styles.inspector}>
        {!hideHeader && focusedBuilding && (
          <div className={`${styles.header} ${styles.stagger0}`}>
            <div className={styles.nameRow}>
              <h3 className={styles.buildingName}>{focusedBuilding.buildingName}</h3>
            </div>
            {focusedBuilding.ownerName && (
              <span className={styles.ownerName}>{focusedBuilding.ownerName}</span>
            )}
          </div>
        )}
        <div className={styles.loadingState}>
          <Skeleton width="100%" height="60px" />
          <Skeleton width="100%" height="200px" />
        </div>
      </div>
    );
  }

  // Error state — details failed to load after retry
  if (detailsError && focusedBuilding) {
    return (
      <div className={styles.inspector}>
        {!hideHeader && (
          <div className={`${styles.header} ${styles.stagger0}`}>
            <div className={styles.nameRow}>
              <h3 className={styles.buildingName}>{focusedBuilding.buildingName}</h3>
            </div>
          </div>
        )}
        <div className={styles.errorState}>
          <p>{detailsError}</p>
          <button className={styles.retryBtn} onClick={handleRetryFromError}>Retry</button>
        </div>
      </div>
    );
  }

  // No building selected
  if (!details || !focusedBuilding) {
    return (
      <div className={styles.inspector}>
        <div className={styles.empty}>
          Click a building on the map to inspect it
        </div>
      </div>
    );
  }

  // Determine active tab
  const activeCivicTab = (isCivic && civicTabs.some((t) => t.id === currentTab))
    ? currentTab as CivicTabId
    : civicTabs[0]?.id as CivicTabId | undefined;

  // Header fields. The level comes from the focus text the map preview already
  // showed; the society is the `SwitchFocusEx` company line, and the tycoon
  // behind it is `Creator` — a property, hence absent until the header read
  // returns, which is why the attribution collapses gracefully.
  const diagnosis = parseFacilityDiagnosis(focusedBuilding.detailsText, focusedBuilding.hintsText);
  const richDetails = focusedBuilding.detailsText
    ? parseRichDetails(focusedBuilding.detailsText)
    : null;
  const ownerTycoon = findPropertyValue(details.groups, 'Creator');
  const roi = findPropertyValue(details.groups, 'ROI');

  const sectionState = sectionDisplayState(details, activeStandardTab?.id ?? null, tabLoadingStates);

  return (
    <div className={styles.inspector}>
      {/* Toolbar — refresh + close (top-right, hidden when modal provides its own) */}
      {!hideHeader && (
        <div className={styles.toolbar}>
          <IconButton
            icon={<Crosshair size={16} />}
            label="View on map"
            size="sm"
            variant="ghost"
            disabled={!details}
            onClick={() => {
              if (details) client.onNavigateToBuilding(details.x, details.y);
            }}
          />
          <IconButton
            icon={<RefreshCw size={16} />}
            label="Refresh"
            size="sm"
            variant="ghost"
            onClick={handleRefresh}
          />
          <IconButton
            icon={<X size={16} />}
            label="Close"
            size="sm"
            variant="ghost"
            onClick={handleClose}
          />
        </div>
      )}

      {/* Header — name/level, society + owner, revenue and ROI.
          Hidden when inside the civic modal, which states its own title. */}
      {!hideHeader && (
        <div className={styles.stagger0}>
          <InspectorHeader
            buildingName={details.buildingName}
            iconUrl={details.iconUrl}
            level={richDetails?.upgradeLevel}
            society={details.ownerName}
            owner={ownerTycoon}
            revenue={focusedBuilding.revenue}
            roi={roi}
            x={details.x}
            y={details.y}
            nameOverride={isRenaming ? (
              <>
                <input
                  type="text"
                  className={styles.renameInput}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmRename();
                    if (e.key === 'Escape') handleCancelRename();
                  }}
                  autoFocus
                />
                <IconButton
                  icon={<Check size={14} />}
                  label="Confirm rename"
                  size="sm"
                  variant="ghost"
                  onClick={handleConfirmRename}
                />
                <IconButton
                  icon={<X size={14} />}
                  label="Cancel rename"
                  size="sm"
                  variant="ghost"
                  onClick={handleCancelRename}
                />
              </>
            ) : undefined}
            actions={!isRenaming ? (
              <>
                {ownerTycoon && (
                  <IconButton
                    icon={<Mail size={14} />}
                    label={`Write to ${ownerTycoon}`}
                    size="sm"
                    variant="ghost"
                    onClick={() => writeTo(tycoonAddress(ownerTycoon, worldName))}
                  />
                )}
                {isOwner && (
                  <>
                    {/* Adding to the Empire list — the write half of the Favorites
                        tree the panel has only ever read. Disabled, not hidden,
                        when the facility is already bookmarked: a control that
                        vanishes reads as a bug. */}
                    <IconButton
                      icon={<Star size={14} />}
                      label={isFavorited ? 'Already in your Empire list' : 'Add to Empire list'}
                      size="sm"
                      variant="ghost"
                      disabled={isFavorited}
                      onClick={handleAddFavorite}
                    />
                    <IconButton
                      icon={<Edit3 size={14} />}
                      label="Rename building"
                      size="sm"
                      variant="ghost"
                      onClick={handleStartRename}
                    />
                    {/* The rename now says whether it took, and why not (B6). */}
                    <SaveIndicator propertyKey={RENAME_PENDING_KEY} />
                  </>
                )}
              </>
            ) : undefined}
          />
        </div>
      )}

      {/* Diagnosis — the first thing to read: severity + sentence + one action (T2, B7).
          Parsed from the pushed status text; no extra read. Civic buildings carry
          demographics here instead, which the Town Hall tabs already show. */}
      {!isCivic && (
        <DiagnosisBanner
          diagnosis={diagnosis}
          onAction={(action) => {
            const tab = tabForAction(action, details.tabs);
            if (tab) setCurrentTab(tab);
          }}
        />
      )}

      {/* Details + sales (hidden for civic — revenue/workers not meaningful) */}
      {!isCivic && (
        <div className={`${styles.quickStatsSlot} ${styles.stagger1}`}>
          <QuickStats focus={focusedBuilding} />
        </div>
      )}

      {isCivic ? (
        <>
          {/* Civic: horizontal TabBar with consolidated tabs */}
          {civicTabs.length > 0 && (
            <div className={styles.stagger2}>
              <TabBar
                tabs={civicTabs}
                activeTab={activeCivicTab ?? civicTabs[0]?.id ?? ''}
                onTabChange={setCurrentTab}
              />
            </div>
          )}
          <div className={`${styles.content} ${styles.stagger3}`}>
            <CivicTabContent
              activeTab={activeCivicTab ?? 'overview'}
              details={details}
              buildingX={details.x}
              buildingY={details.y}
              canGovern={canGovern}
              demographics={focusedBuilding?.demographics ?? null}
            />
          </div>
        </>
      ) : (
        /* Standard: section menu, each entry opening its own drawer */
        <InspectorMenu
          tabs={standardTabs}
          activeTab={activeStandardTab?.id ?? null}
          onSelect={(tabId) => setCurrentTab(tabId ?? '')}
        >
          <SectionBody
            state={sectionState}
            properties={standardProperties}
            buildingX={details.x}
            buildingY={details.y}
          />
        </InspectorMenu>
      )}
    </div>
  );
}

/**
 * The open section's body: its property rows, a skeleton while the section is
 * being read, or a retry hint if that read failed.
 */
function SectionBody({
  state,
  properties,
  buildingX,
  buildingY,
}: {
  state: SectionDisplayState;
  properties: BuildingPropertyValue[];
  buildingX: number;
  buildingY: number;
}) {
  if (state === 'error') {
    return (
      <div className={styles.loadingState}>
        <span>Failed to load this section. Click refresh to retry.</span>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className={styles.loadingState}>
        <Skeleton width="100%" height="24px" />
        <Skeleton width="80%" height="18px" />
        <Skeleton width="100%" height="120px" />
      </div>
    );
  }

  return (
    <PropertyGroup
      properties={properties}
      buildingX={buildingX}
      buildingY={buildingY}
    />
  );
}

/** Routes civic tab IDs to the appropriate section component. */
function CivicTabContent({
  activeTab,
  details,
  buildingX,
  buildingY,
  canGovern,
  demographics,
}: {
  activeTab: CivicTabId;
  details: NonNullable<ReturnType<typeof useBuildingStore.getState>['details']>;
  buildingX: number;
  buildingY: number;
  /** Does this player govern THIS facility? Result of `grantAccess`. */
  canGovern: boolean;
  demographics: TownHallDemographics | null;
}) {
  const groups = details.groups ?? {};
  const generalGroupId = getGeneralGroupId(details.tabs);
  const generalProps = generalGroupId ? (groups[generalGroupId] ?? []) : [];
  const votesProps = groups['votes'] ?? [];
  const townsProps = groups['capitolTowns'] ?? [];
  const ministriesProps = groups['ministeries'] ?? [];
  const jobsProps = groups['townJobs'] ?? [];
  const resProps = groups['townRes'] ?? [];
  const taxesProps = groups['townTaxes'] ?? [];
  const servicesProps = groups['townServices'] ?? [];

  switch (activeTab) {
    case 'overview':
      return (
        <OverviewSection
          generalProperties={generalProps}
          votesProperties={votesProps}
          buildingX={buildingX}
          buildingY={buildingY}
          serverTabs={details.tabs}
        />
      );
    case 'administration':
      return (
        <AdministrationSection
          townsProperties={townsProps}
          ministriesProperties={ministriesProps}
          taxesProperties={taxesProps}
          buildingX={buildingX}
          buildingY={buildingY}
          canGovern={canGovern}
        />
      );
    case 'demographics':
      return (
        <DemographicsSection
          jobsProperties={jobsProps}
          residentialsProperties={resProps}
          servicesProperties={servicesProps}
          buildingX={buildingX}
          buildingY={buildingY}
          serverTabs={details.tabs}
          demographics={demographics}
          canGovern={canGovern}
        />
      );
    case 'elections':
      return (
        <ElectionsSection
          votesProperties={votesProps}
          buildingX={buildingX}
          buildingY={buildingY}
        />
      );
    case 'politics':
      // Until now this tab was declared in CivicTabConfig with no case here, so
      // opening it fell through to `null` and rendered an empty panel.
      return <PoliticsSection buildingX={buildingX} buildingY={buildingY} />;
    default:
      return null;
  }
}
