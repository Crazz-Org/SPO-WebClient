/**
 * OverviewSection — Ruler banner + election countdown + general building properties.
 * Consolidates ruler info (previously repeated on Towns/Ministries tabs) into one place.
 * The countdown yields to the tournament line on a tournament planet.
 */

import { useCallback, useMemo } from 'react';
import type { BuildingPropertyValue } from '@/shared/types';
import { usePoliticsStore } from '../../store/politics-store';
import { useNewspaperStore, type NewspaperView } from '../../store/newspaper-store';
import { useBuildingStore } from '../../store/building-store';
import { useUiStore } from '../../store/ui-store';
import { PropertyGroup } from '../building/PropertyGroup';
import { buildValueMap, getNum, formatCompact } from './capitol-utils';
import { isCapitolBuilding } from './CivicTabConfig';
import type { BuildingDetailsTab } from '@/shared/types';
import styles from './PoliticsPanel.module.css';

interface OverviewSectionProps {
  generalProperties: BuildingPropertyValue[];
  votesProperties: BuildingPropertyValue[];
  buildingX: number;
  buildingY: number;
  serverTabs: BuildingDetailsTab[];
}

export function OverviewSection({
  generalProperties,
  votesProperties,
  buildingX,
  buildingY,
  serverTabs,
}: OverviewSectionProps) {
  const data = usePoliticsStore((s) => s.data);
  const isCapitol = isCapitolBuilding(serverTabs);

  // `TownHallSheet.pas:127` reads the paper's name off the town properties and
  // `:348` passes it to the board as `PaperName`. Ours arrives in the general
  // group as `NewspaperName` (template-groups.ts townGeneral).
  const generalMap = useMemo(() => buildValueMap(generalProperties), [generalProperties]);
  const newspaperName = generalMap.get('NewspaperName') ?? '';
  const townName = data?.townName ?? generalMap.get('Town') ?? '';

  const openNewspaper = useCallback((view: NewspaperView) => {
    useNewspaperStore.getState().openFor({
      paperName: newspaperName,
      townName,
      isCapitol,
      buildingX,
      buildingY,
    }, view);
    // Single-slot modal, like Voyager: `TownHallSheet.pas:352` closes the object
    // inspector when it opens the board.
    useUiStore.getState().openModal('newspaper');
  }, [newspaperName, townName, isCapitol, buildingX, buildingY]);

  // Ruler info from votes group
  const valueMap = buildValueMap(votesProperties);
  const rulerName = valueMap.get('RulerName') ?? valueMap.get('ActualRuler') ?? '';
  const rulerVotes = getNum(valueMap, 'RulerVotes');
  const rulerRating = getNum(valueMap, 'RulerCmpRat');
  const rulerPoints = getNum(valueMap, 'RulerCmpPnts');

  const roleTitle = isCapitol ? 'President' : 'Mayor';

  // Filter general properties (remove Name — shown in modal header)
  const filteredGeneral = generalProperties.filter((p) => p.name !== 'Name');

  return (
    <>
      {/* Ruler banner */}
      {rulerName && (
        <div className={styles.rulerBanner}>
          <div className={styles.rulerAvatar}>
            {rulerName.charAt(0).toUpperCase()}
          </div>
          <div className={styles.rulerInfo}>
            <div className={styles.rulerName}>{rulerName}</div>
            <div className={styles.rulerRole}>
              {roleTitle}{townName ? ` of ${townName}` : ''}
            </div>
          </div>
          <div className={styles.rulerStats}>
            <div className={styles.rulerStat}>
              <div className={styles.rulerStatValue}>{formatCompact(rulerVotes)}</div>
              <div className={styles.rulerStatLabel}>Votes</div>
            </div>
            <div className={styles.rulerStat}>
              <div className={styles.rulerStatValue}>{rulerRating}%</div>
              <div className={styles.rulerStatLabel}>Rating</div>
            </div>
            <div className={styles.rulerStat}>
              <div className={styles.rulerStatValue}>{formatCompact(rulerPoints)}</div>
              <div className={styles.rulerStatLabel}>Points</div>
            </div>
          </div>
        </div>
      )}

      {/* Election countdown */}
      {data && (
        <div className={styles.countdownBar}>
          {data.campaignState === 'noElections' ? (
            <span className={styles.countdownLabel}>No elections on Tournament planets</span>
          ) : (
            <>
              <span className={styles.countdownValue}>{data.yearsToElections}</span>
              <span className={styles.countdownLabel}>
                {data.yearsToElections === 1 ? 'year' : 'years'} until next {isCapitol ? 'presidential' : 'mayoral'} election
              </span>
            </>
          )}
        </div>
      )}

      {/* The three buttons Voyager puts on this very sheet
          (`TownHallSheet.pas:49`/`:320`/`:337`, `CapitolSheet.pas:258`). "Visit
          Politics Page" opens a second window there; here it selects the tab. */}
      <div className={styles.overviewActions}>
        <button
          className={styles.actionBtn}
          onClick={() => useBuildingStore.getState().setCurrentTab('politics')}
        >
          {isCapitol ? 'Visit President Politics Page' : 'Visit Politics Page'}
        </button>
        {/* Capitol-only exception: `CapitolSheet.pas` has no RateMayor button —
            the presidential board is a town paper the Capitol does not own, and
            `boardmsg.asp:19` only fills the ratings folder for a town anyway. */}
        {!isCapitol && newspaperName !== '' && (
          <button className={styles.actionBtn} onClick={() => openNewspaper('board')}>
            Rate the Mayor
          </button>
        )}
        {/* Voyager's third button, `ReadNews` (`TownHallSheet.pas:49`, `:361`):
            same town and paper as RateMayor, but a different page — it opens
            `newsreader.asp`, the daily issue, not the editorial board. So this
            one opens the modal on its paper view. */}
        {!isCapitol && newspaperName !== '' && (
          <button className={styles.actionBtn} onClick={() => openNewspaper('paper')}>
            Read News
          </button>
        )}
      </div>
      {!isCapitol && newspaperName === '' && (
        <p className={styles.campaignMessage}>This town has no newspaper.</p>
      )}

      {/* General building properties */}
      {filteredGeneral.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>General Information</h4>
          <PropertyGroup properties={filteredGeneral} buildingX={buildingX} buildingY={buildingY} />
        </div>
      )}
    </>
  );
}
