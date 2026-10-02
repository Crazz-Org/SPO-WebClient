/**
 * InspectorV2 — the building inspector of UI v2: one column, no master/detail.
 *
 *   InspectorHero      identity, three figures, every action on the facility
 *   DiagnosisBanner    standard facilities only (v1 component, unchanged)
 *   SectionTabs        sticky; Overview first, then the server sections (civic: the civic tabs)
 *   section body       full width — QuickStats + section cards, a PropertyGroup, or a civic section
 *
 * Feature parity with v1's BuildingSurface + BuildingInspector + BuildingSheetActions. The
 * read pattern is v1's exactly: the same 30 s auto-refresh effect (paused while the tab is
 * hidden), and the same lazy section read through `resolveSectionFetch` on the raw
 * `currentTab`. The synthetic Overview tab is stored as `''` — the state v1 called "menu
 * showing" — so it matches no server tab and asks the server for nothing.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useBuildingStore } from '../../store/building-store';
import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import { isCivicBuilding } from '@/shared/building-details/civic-buildings';
import { parseFacilityDiagnosis } from '@/shared/building-details/facility-diagnosis';
import type { BuildingPropertyValue } from '@/shared/types';
import { Button, Skeleton } from '../../components/common';
import { DiagnosisBanner, tabForAction } from '../../components/building/DiagnosisBanner';
import { PropertyGroup } from '../../components/building/PropertyGroup';
import {
  resolveSectionFetch,
  sectionDisplayState,
  type SectionDisplayState,
} from '../../components/building/inspector-sections';
import { buildCivicTabs } from '../../components/politics/CivicTabConfig';
import { InspectorHero } from './InspectorHero';
import { SectionTabs } from './SectionTabs';
import { OverviewSection } from './OverviewSection';
import { CivicBody } from './CivicBody';
import {
  OVERVIEW_TAB_ID,
  activeCivicTabId,
  activeStandardTabId,
  buildStandardTabs,
  storeValueForTab,
  type SectionTabItem,
} from './inspector-model';
import styles from './InspectorV2.module.css';

/** Same cadence as v1 (see `AUTO_REFRESH_INTERVAL` in BuildingInspector for why 30 s, OB-29). */
export const AUTO_REFRESH_INTERVAL = 30_000;

const PANEL_ID = 'v2-inspector-section';

export function InspectorV2() {
  const focusedBuilding = useBuildingStore((s) => s.focusedBuilding);
  const details = useBuildingStore((s) => s.details);
  const isLoading = useBuildingStore((s) => s.isLoading);
  const detailsError = useBuildingStore((s) => s.detailsError);
  const currentTab = useBuildingStore((s) => s.currentTab);
  const setCurrentTab = useBuildingStore((s) => s.setCurrentTab);
  const tabLoadingStates = useBuildingStore((s) => s.tabLoadingStates);
  const isConnected = useGameStore((s) => s.status) === 'connected';
  const client = useClient();

  const isCivic = details ? isCivicBuilding(details.visualClass) : false;

  const tabs = useMemo<SectionTabItem[]>(() => {
    if (!details) return [];
    return isCivic
      ? buildCivicTabs(details.tabs).map((t) => ({ id: t.id, label: t.label }))
      : buildStandardTabs(details.tabs);
  }, [details, isCivic]);

  const activeServerTab = details && !isCivic ? activeStandardTabId(details.tabs, currentTab) : null;
  const activeGroup = details && activeServerTab ? details.groups[activeServerTab] : undefined;
  const properties = useMemo(
    () => (activeGroup ? activeGroup.filter((p) => p.name !== 'Name') : []),
    [activeGroup],
  );

  // Auto-refresh while open — v1's effect, same dependencies, same visibility pause.
  // Restarted on the same changes as v1 (facility, its tabs, the open section, connection).
  const refreshTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  const detailX = details?.x;
  const detailY = details?.y;
  const detailClass = details?.visualClass;
  const detailTabs = details?.tabs;
  useEffect(() => {
    if (detailX === undefined || detailY === undefined || !isConnected) return;
    const x = detailX;
    const y = detailY;
    const doRefresh = () => client.onRefreshBuilding(x, y, { userInitiated: false });
    const startTimer = () => {
      clearInterval(refreshTimer.current);
      refreshTimer.current = setInterval(doRefresh, AUTO_REFRESH_INTERVAL);
    };
    const onVisibilityChange = () => {
      if (document.hidden) clearInterval(refreshTimer.current);
      else startTimer();
    };
    startTimer();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(refreshTimer.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [detailX, detailY, detailClass, detailTabs, currentTab, isConnected, client]);

  // Lazy read of the open section — v1's effect, unchanged.
  useEffect(() => {
    if (!details || !isConnected) return;
    const fetch = resolveSectionFetch(details, currentTab, isCivic, tabLoadingStates);
    if (fetch) {
      client.onRequestTabData(details.x, details.y, fetch.tabId, details.visualClass, fetch.groupIds);
    }
  }, [currentTab, details, isCivic, isConnected, tabLoadingStates, client]);

  if (isLoading || (!details && !detailsError && focusedBuilding)) {
    return (
      <div className={styles.inspector} aria-busy="true">
        {focusedBuilding && (
          <header className={styles.placeholderHero}>
            <h2 className={styles.placeholderName} tabIndex={-1}>{focusedBuilding.buildingName}</h2>
            {focusedBuilding.ownerName && <span className={styles.placeholderOwner}>{focusedBuilding.ownerName}</span>}
          </header>
        )}
        <div className={styles.stateBox}>
          <Skeleton width="100%" height="60px" />
          <Skeleton width="100%" height="200px" />
        </div>
      </div>
    );
  }

  if (detailsError && focusedBuilding) {
    const retry = () => {
      useBuildingStore.getState().setDetailsError(null);
      useBuildingStore.getState().setLoading(true);
      client.onRefreshBuilding(focusedBuilding.x, focusedBuilding.y, { userInitiated: true });
    };
    return (
      <div className={styles.inspector}>
        <header className={styles.placeholderHero}>
          <h2 className={styles.placeholderName} tabIndex={-1}>{focusedBuilding.buildingName}</h2>
        </header>
        <div className={styles.stateBox} role="alert">
          <p className={styles.stateText}>{detailsError}</p>
          <Button size="sm" variant="secondary" onClick={retry}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!details || !focusedBuilding) {
    return (
      <div className={styles.inspector}>
        <p className={styles.empty}>Click a building on the map to inspect it</p>
      </div>
    );
  }

  const activeId = isCivic ? activeCivicTabId(tabs, currentTab) : (activeServerTab ?? OVERVIEW_TAB_ID);
  const refresh = () => client.onRefreshBuilding(details.x, details.y, { userInitiated: true });

  return (
    <div className={styles.inspector}>
      <InspectorHero details={details} focus={focusedBuilding} isCivic={isCivic} />

      {!isCivic && (
        <div className={styles.diagnosis}>
          <DiagnosisBanner
            diagnosis={parseFacilityDiagnosis(focusedBuilding.detailsText, focusedBuilding.hintsText)}
            onAction={(action) => {
              const tab = tabForAction(action, details.tabs);
              if (tab) setCurrentTab(tab);
            }}
          />
        </div>
      )}

      {tabs.length > 0 && (
        <SectionTabs
          tabs={tabs}
          activeId={activeId}
          onSelect={(id) => setCurrentTab(storeValueForTab(id))}
          panelId={PANEL_ID}
        />
      )}

      <section
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={activeId ? `${PANEL_ID}-tab-${activeId}` : undefined}
        className={styles.body}
      >
        {isCivic ? (
          <CivicBody
            activeTab={activeId ?? 'overview'}
            details={details}
            canGovern={details.canGovern ?? false}
            demographics={focusedBuilding.demographics ?? null}
          />
        ) : activeServerTab === null ? (
          <OverviewSection
            focus={focusedBuilding}
            sections={tabs.filter((t) => t.id !== OVERVIEW_TAB_ID)}
            onOpen={(id) => setCurrentTab(id)}
          />
        ) : (
          <SectionBody
            state={sectionDisplayState(details, activeServerTab, tabLoadingStates)}
            properties={properties}
            buildingX={details.x}
            buildingY={details.y}
            onRetry={refresh}
          />
        )}
      </section>
    </div>
  );
}

/** The open server section: its rows, a skeleton while it is read, or a retry if the read failed. */
function SectionBody({
  state,
  properties,
  buildingX,
  buildingY,
  onRetry,
}: {
  state: SectionDisplayState;
  properties: BuildingPropertyValue[];
  buildingX: number;
  buildingY: number;
  onRetry: () => void;
}) {
  if (state === 'error') {
    return (
      <div className={styles.stateBox} role="alert">
        <p className={styles.stateText}>This section could not be loaded.</p>
        <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  if (state === 'loading') {
    return (
      <div className={styles.stateBox} aria-busy="true">
        <Skeleton width="100%" height="24px" />
        <Skeleton width="80%" height="18px" />
        <Skeleton width="100%" height="120px" />
      </div>
    );
  }
  return <PropertyGroup properties={properties} buildingX={buildingX} buildingY={buildingY} />;
}
