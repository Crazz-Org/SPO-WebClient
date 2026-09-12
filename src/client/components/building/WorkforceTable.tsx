/**
 * WorkforceTable — one card per workforce class (Executives / Professionals /
 * Workers): jobs, quality, hourly cost, and the salary as a slider.
 *
 * Three things the previous grid of number fields did not do:
 *
 *  - the request leaves on slider RELEASE, not while dragging and not on a
 *    debounce. `RDOSetSalaries` rewrites the whole triplet, so an emitter that
 *    fired per tick would put a dozen triplet writes on the wire for one drag.
 *  - every slider is locked while one update is in flight. The triplet is
 *    assembled from the values currently displayed, so editing a second class
 *    mid-flight would assemble it from values the server has not acknowledged.
 *  - the value shown afterwards is the server's, not the one released. A town
 *    minimum wage raises a salary set below it, and the panel has to show what
 *    the server holds — hence the property refresh before the lock is released.
 *  - the wage figure beside the slider is a local preview computed from
 *    `WorkForcePrice`, never a server value.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuildingPropertyValue } from '@/shared/types';
import {
  formatCurrency,
  formatPercentage,
  type RdoCommandMapping,
} from '@/shared/building-details';
import { useBuildingStore } from '../../store/building-store';
import { useClient } from '../../context';
import { resolveRdoCommand, buildSalaryParams, pendingKeyFor } from './property-utils';
import { SaveIndicator } from './SaveIndicator';
import styles from './PropertyGroup.module.css';

/** Column order of every `*{0,1,2}` workforce property. */
const CLASS_NAMES = ['Executives', 'Professionals', 'Workers'] as const;

/** Upper bound of a salary percentage, as the legacy client clamps it. */
const SALARY_MAX = 250;

/** Wage the slider position implies: base cost scaled by the salary percentage. */
function formatWage(cost: number, salaryPct: number): string {
  return `$${Math.round((cost * salaryPct) / 100).toLocaleString('en-US')}`;
}

/**
 * How long the sliders stay locked when the refreshed properties never arrive.
 * A stuck lock is worse than a stale value: it takes the panel away from the
 * user with no way back.
 */
const SETTLE_TIMEOUT_MS = 2000;

// =============================================================================
// COMMIT / LOCK CYCLE
// =============================================================================

interface SalaryCommit {
  /** True from the moment a salary is released until the fresh values land. */
  locked: boolean;
  /** Pending key of the last update, on the class that started it. */
  indicatorKey: (index: number) => string | undefined;
  /** Send the triplet with `index` set to `value`. */
  commit: (index: number, value: number) => void;
}

function useSalaryCommit(
  properties: BuildingPropertyValue[],
  rdoCommands: Record<string, RdoCommandMapping> | undefined,
  buildingX: number,
  buildingY: number,
  onPropertyChange: (name: string, value: number) => void,
): SalaryCommit {
  const client = useClient();
  const [lastCommit, setLastCommit] = useState<{ key: string; index: number } | null>(null);
  const [locked, setLocked] = useState(false);
  const [settling, setSettling] = useState(false);

  const pending = useBuildingStore((s) => (lastCommit ? s.pendingUpdates.has(lastCommit.key) : false));
  const details = useBuildingStore((s) => s.details);
  const settleBaseline = useRef<unknown>(undefined);

  const commit = useCallback(
    (index: number, value: number) => {
      const rdoName = `Salaries${index}`;
      const resolved = resolveRdoCommand(rdoName, rdoCommands);
      // Same builder the emitter uses, so the key predicted here is the key
      // setBuildingProperty registers — see buildSalaryParams.
      const params = buildSalaryParams(properties, resolved.params, value);
      setLastCommit({ key: pendingKeyFor(resolved.command, params), index });
      setSettling(false);
      setLocked(true);
      onPropertyChange(rdoName, value);
    },
    [properties, rdoCommands, onPropertyChange],
  );

  // The gateway answered. Its answer carries one read-back value; the panel
  // needs all three, possibly corrected — ask for a fresh read and hold the
  // lock until it lands.
  useEffect(() => {
    if (!locked || pending || settling) return;
    settleBaseline.current = details;
    setSettling(true);
    client.onRefreshBuildingProperties(buildingX, buildingY);
  }, [locked, pending, settling, details, client, buildingX, buildingY]);

  // Release on the next details object — or on the timeout, so a refresh that
  // never comes back cannot leave the sliders dead.
  useEffect(() => {
    if (!locked || !settling) return;
    const release = () => {
      setLocked(false);
      setSettling(false);
    };
    if (details !== settleBaseline.current) {
      release();
      return;
    }
    const timer = setTimeout(release, SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [locked, settling, details]);

  const indicatorKey = useCallback(
    (index: number) => (lastCommit?.index === index ? lastCommit.key : undefined),
    [lastCommit],
  );

  return { locked, indicatorKey, commit };
}

// =============================================================================
// WORKFORCE CARDS
// =============================================================================

export function WorkforceTable({
  properties,
  canEdit,
  rdoCommands,
  buildingX,
  buildingY,
  onPropertyChange,
}: {
  properties: BuildingPropertyValue[];
  canEdit: boolean;
  rdoCommands?: Record<string, RdoCommandMapping>;
  buildingX: number;
  buildingY: number;
  onPropertyChange: (name: string, value: number) => void;
}) {
  const vm = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of properties) map.set(p.name, p.value);
    return map;
  }, [properties]);

  const getNum = (name: string) => parseFloat(vm.get(name) ?? '0') || 0;
  const isActive = (i: number) => {
    const cap = vm.has(`WorkersCap${i}`) ? getNum(`WorkersCap${i}`) : getNum(`WorkersMax${i}`);
    return cap > 0;
  };

  const { locked, indicatorKey, commit } = useSalaryCommit(
    properties, rdoCommands, buildingX, buildingY, onPropertyChange,
  );

  const active = [0, 1, 2].filter(isActive);
  if (active.length === 0) {
    return <div className={styles.empty}>No workforce</div>;
  }

  return (
    <div className={styles.wfCards}>
      {active.map((i) => (
        <WorkforceClassCard
          key={i}
          className={CLASS_NAMES[i]}
          workers={getNum(`Workers${i}`)}
          workersMax={getNum(`WorkersMax${i}`)}
          quality={getNum(`WorkersK${i}`)}
          cost={getNum(`WorkForcePrice${i}`)}
          salary={getNum(`Salaries${i}`)}
          minSalary={getNum(`MinSalaries${i}`)}
          canEdit={canEdit}
          locked={locked}
          pendingKey={indicatorKey(i)}
          onCommit={(value) => commit(i, value)}
        />
      ))}
    </div>
  );
}

function WorkforceClassCard({
  className,
  workers,
  workersMax,
  quality,
  cost,
  salary,
  minSalary,
  canEdit,
  locked,
  pendingKey,
  onCommit,
}: {
  className: string;
  workers: number;
  workersMax: number;
  quality: number;
  cost: number;
  salary: number;
  minSalary: number;
  canEdit: boolean;
  locked: boolean;
  pendingKey?: string;
  onCommit: (value: number) => void;
}) {
  const [localVal, setLocalVal] = useState(salary);
  const [dragging, setDragging] = useState(false);
  const lastSent = useRef<number | null>(null);

  // The server has the last word: outside a drag and once the round-trip is
  // over, the slider shows what the building reports — which is not always what
  // was released (town minimum wage).
  useEffect(() => {
    if (dragging || locked) return;
    lastSent.current = null;
    setLocalVal(salary);
  }, [salary, dragging, locked]);

  const min = minSalary > 0 ? Math.min(minSalary, SALARY_MAX) : 0;

  // Release — not "the user stopped moving". Several events end one gesture
  // (pointer up, key up, the blur the lock itself causes), so the guards below
  // are what keep one gesture to one triplet write.
  const release = useCallback(() => {
    setDragging(false);
    if (locked) return;
    if (localVal === salary) return;        // nothing moved
    if (lastSent.current === localVal) return; // already on the wire
    lastSent.current = localVal;
    onCommit(localVal);
  }, [locked, localVal, salary, onCommit]);

  return (
    <div className={`${styles.wfCard} ${locked ? styles.wfCardLocked : ''}`}>
      <div className={styles.wfCardHeader}>
        <span className={styles.wfCardName}>{className}</span>
        <span className={styles.wfCardStat}>
          Jobs: <strong>{workers}/{workersMax}</strong>
        </span>
      </div>

      <div className={styles.wfCardStats}>
        <span className={styles.wfCardStat}>
          Quality: <strong>{formatPercentage(quality)}</strong>
        </span>
        <span className={styles.wfCardStat}>
          Cost: <strong>{formatCurrency(cost)}</strong>
        </span>
      </div>

      {canEdit ? (
        <div className={styles.wfSliderRow}>
          <span className={styles.sliderLabel}>Salary</span>
          <input
            type="range"
            className={styles.slider}
            aria-label={`${className} salary`}
            min={min}
            max={SALARY_MAX}
            step={1}
            value={localVal}
            disabled={locked}
            onChange={(e) => {
              setDragging(true);
              setLocalVal(parseInt(e.target.value, 10) || 0);
            }}
            onPointerUp={release}
            onKeyUp={release}
            onBlur={release}
          />
          <span className={styles.sliderValue}>{localVal}%</span>
          <span className={styles.wfSalaryCost} aria-live="polite">{formatWage(cost, localVal)}</span>
          {pendingKey && <SaveIndicator propertyKey={pendingKey} />}
        </div>
      ) : (
        <div className={styles.wfSliderRow}>
          <span className={styles.sliderLabel}>Salary</span>
          <span className={styles.wfSalaryReadonly}>{salary}%</span>
          <span className={styles.wfSalaryCost} aria-live="polite">{formatWage(cost, salary)}</span>
        </div>
      )}

      {min > 0 && (
        <span className={styles.wfMinHint}>Town minimum: {min}%</span>
      )}
    </div>
  );
}
