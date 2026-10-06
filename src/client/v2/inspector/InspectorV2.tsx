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
 * open tab. The synthetic Overview tab is stored as `''` — the state v1 called "menu
 * showing" — so it matches no server tab and asks the server for nothing.
 *
 * Two departures from v1, both about switching facilities:
 *  - the details in hand are drawn only when they describe the focused facility; until the
 *    new one's arrive the inspector shows the loading state, never the previous facility;
 *  - the open tab is the one that exists on THIS facility. The store remembers the section
 *    across facilities on purpose (`rememberedSection`) and restores it when the new
 *    facility has it; when it does not, a stale `currentTab` (an HQ's "upgrade" on a Town
 *    Hall) falls back to Overview — for the strip AND for the lazy read.
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
  detailsMatchFocus,
  inspectorDiagnosis,
  sectionBodyState,
  sectionLabel,
  sectionReadTab,
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
  const detailsCurrent = detailsMatchFocus(details, focusedBuilding);

  const tabs = useMemo<SectionTabItem[]>(() => {
    if (!details) return [];
    return isCivic
      ? buildCivicTabs(details.tabs).map((t) => ({ id: t.id, label: sectionLabel(t.label) }))
      : buildStandardTabs(details.tabs);
  }, [details, isCivic]);

  const activeServerTab = details && !isCivic ? activeStandardTabId(details.tabs, currentTab) : null;
  const activeCivicTab = isCivic ? activeCivicTabId(tabs, currentTab) : undefined;
  const readTab = sectionReadTab(isCivic, activeServerTab, activeCivicTab);
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

  // Lazy read of the open section — v1's effect, asked about the tab actually open on this
  // facility (see `sectionReadTab`), and only once the details are this facility's.
  useEffect(() => {
    if (!details || !detailsCurrent || !isConnected) return;
    const fetch = resolveSectionFetch(details, readTab, isCivic, tabLoadingStates);
    if (fetch) {
      client.onRequestTabData(details.x, details.y, fetch.tabId, details.visualClass, fetch.groupIds);
    }
  }, [readTab, details, detailsCurrent, isCivic, isConnected, tabLoadingStates, client]);

  if (isLoading || (!detailsCurrent && !detailsError && focusedBuilding)) {
    // While loading with details that match the focus, the focus itself is the outgoing
    // facility (a new one is being read and has not been pushed yet): name nothing rather
    // than the facility the player just left.
    const named = focusedBuilding && !detailsCurrent ? focusedBuilding : null;
    return (
      <div className={styles.inspector} aria-busy="true">
        {focusedBuilding && (
          <header className={styles.placeholderHero}>
            <h2 className={styles.placeholderName} tabIndex={-1}>{named ? named.buildingName : 'Loading facility…'}</h2>
            {named?.ownerName && <span className={styles.placeholderOwner}>{named.ownerName}</span>}
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

  if (!details || !focusedBuilding || !detailsCurrent) {
    return (
      <div className={styles.inspector}>
        <p className={styles.empty}>Click a building on the map to inspect it</p>
      </div>
    );
  }

  const activeId = isCivic ? activeCivicTab : (activeServerTab ?? OVERVIEW_TAB_ID);
  const refresh = () => client.onRefreshBuilding(details.x, details.y, { userInitiated: true });

  return (
    <div className={styles.inspector}>
      <InspectorHero details={details} focus={focusedBuilding} isCivic={isCivic} />

      {!isCivic && (
        <div className={styles.diagnosis}>
          <DiagnosisBanner
            diagnosis={inspectorDiagnosis(parseFacilityDiagnosis(focusedBuilding.detailsText, focusedBuilding.hintsText))}
            onAction={(action) => {
              if (action.kind === 'connect') {
                client.onBuildingAction('connectMap');
                return;
              }
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
          <div className={styles.properties}>
            <CivicBody
              activeTab={activeId ?? 'overview'}
              details={details}
              canGovern={details.canGovern ?? false}
              demographics={focusedBuilding.demographics ?? null}
            />
          </div>
        ) : activeServerTab === null ? (
          <OverviewSection
            focus={focusedBuilding}
            sections={tabs.filter((t) => t.id !== OVERVIEW_TAB_ID)}
            onOpen={(id) => setCurrentTab(id)}
          />
        ) : (
          <SectionBody
            state={sectionBodyState({
              base: sectionDisplayState(details, activeServerTab, tabLoadingStates),
              loadState: tabLoadingStates[activeServerTab],
              readPending: isConnected && resolveSectionFetch(details, readTab, false, tabLoadingStates) !== null,
              hasRows: properties.length > 0,
            })}
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
  return (
    <div className={styles.properties}>
      <PropertyGroup properties={properties} buildingX={buildingX} buildingY={buildingY} />
    </div>
  );
}
