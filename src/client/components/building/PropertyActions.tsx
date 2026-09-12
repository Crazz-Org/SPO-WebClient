/**
 * PropertyActions — Action components for building property panels.
 *
 * UpgradeActions: upgrade/downgrade building level controls
 * RepairControl: repair progress bar + start/stop buttons
 * TradeConnectButtons: quick trade connect/disconnect grid
 * ActionButton: generic action button from property definition
 * CloneSettings: clone configuration checklist + apply
 *
 * Extracted from PropertyGroup.tsx.
 */

import { useState, useCallback } from 'react';
import type { BuildingPropertyValue, WarehouseWareData } from '@/shared/types';
import type { PropertyDefinition } from '@/shared/building-details';
import { formatCurrency } from '@/shared/building-details';
import { parseCloneMenu, parseCurrencyInput, parseFilmMonths, FILM_MONTHS_MIN, FILM_MONTHS_MAX } from './property-utils';
import { useBuildingStore } from '../../store/building-store';
import { useUiStore } from '../../store/ui-store';
import { useClient } from '../../context';
import styles from './PropertyGroup.module.css';

// =============================================================================
// UPGRADE ACTIONS
// =============================================================================

export function UpgradeActions({
  properties,
  canEdit,
  buildingX,
  buildingY,
}: {
  properties: BuildingPropertyValue[];
  canEdit: boolean;
  buildingX: number;
  buildingY: number;
}) {
  const client = useClient();
  const [qty, setQty] = useState(1);
  const vm = new Map<string, string>();
  for (const p of properties) vm.set(p.name, p.value);

  const isUpgrading = vm.get('Upgrading') === '1' || vm.get('Upgrading')?.toLowerCase() === 'yes';
  const currentLevel = parseInt(vm.get('UpgradeLevel') ?? '0');
  const maxLevel = parseInt(vm.get('MaxUpgrade') ?? '0');
  const pending = parseInt(vm.get('Pending') ?? '0');
  const remaining = Math.max(0, maxLevel - currentLevel);

  // The spend the control is about to trigger. A missing, non-numeric or zero
  // unit cost means the total cannot be stated, so the row is not offered at all.
  const unitCost = parseFloat(vm.get('NextUpgCost') ?? '0');
  const costKnown = Number.isFinite(unitCost) && unitCost > 0;
  // `qty` is clamped by the - / + / onChange handlers, but `remaining` can shrink
  // under it between renders — `count` is what the row displays and sends.
  const count = Math.min(Math.max(1, qty), Math.max(1, remaining));
  const total = unitCost * count;

  const handleStartUpgrade = () => {
    useUiStore.getState().requestConfirm(
      'Start Upgrade',
      `Start ${count} upgrade level${count === 1 ? '' : 's'} for ${formatCurrency(total)}?`,
      () => client.onUpgradeBuilding(buildingX, buildingY, 'START_UPGRADE', count),
      {
        kind: 'spend',
        confirmLabel: 'Upgrade',
        typeToConfirm: null,
        rows: [
          { label: 'Levels', value: String(count) },
          { label: 'Total', value: formatCurrency(total), tone: 'gold' },
        ],
      },
    );
  };

  return (
    <div className={styles.upgradeContainer}>
      <div className={styles.upgradeLevel}>
        Level {currentLevel}
        {isUpgrading && pending > 0 && <span className={styles.upgradePending}>(+{pending})</span>}
        /{maxLevel}
      </div>

      {canEdit && (
        <>
          {isUpgrading && pending > 0 ? (
            <button
              className={styles.upgradeStopBtn}
              onClick={() => client.onUpgradeBuilding(buildingX, buildingY, 'STOP_UPGRADE')}
            >
              STOP
            </button>
          ) : (
            remaining > 0 && costKnown && (
              <div className={styles.upgradeRow}>
                <span className={styles.upgradeLabel}>Upgrade</span>
                <button className={styles.upgradeBtn} onClick={() => setQty((q) => Math.max(1, q - 1))}>-</button>
                <input
                  type="number"
                  className={styles.upgradeQty}
                  min={1}
                  max={remaining}
                  value={count}
                  onChange={(e) => setQty(Math.min(remaining, Math.max(1, parseInt(e.target.value) || 1)))}
                />
                <button className={styles.upgradeBtn} onClick={() => setQty((q) => Math.min(remaining, q + 1))}>+</button>
                <span className={styles.upgradeTotal} data-testid="upgrade-total">{formatCurrency(total)}</span>
                <button
                  className={styles.upgradeOkBtn}
                  onClick={handleStartUpgrade}
                >
                  OK
                </button>
              </div>
            )
          )}

          {/* A level-1 facility has no level to give back (Voyager's fbDowngrade needs
              upgradeLevel > 1), and while an upgrade is running the only offered action
              is STOP, so the button is not rendered at all. */}
          {currentLevel > 1 && !isUpgrading && (
            <button
              className={styles.downgradeBtn}
              onClick={() => client.onUpgradeBuilding(buildingX, buildingY, 'DOWNGRADE')}
            >
              Downgrade
            </button>
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
// REPAIR CONTROL (progress bar + conditional start/stop)
// =============================================================================

export function RepairControl({
  repairValue,
  repairPrice,
  canEdit,
  onAction,
}: {
  repairValue: string;
  repairPrice: string;
  canEdit: boolean;
  onAction: (id: string) => void;
}) {
  const progress = parseInt(repairValue, 10) || 0;
  const isRepairing = progress > 0 && progress < 100;
  const cost = parseFloat(repairPrice) || 0;

  return (
    <div className={styles.repairContainer}>
      <div className={styles.repairHeader}>
        <span className={styles.name}>Repair</span>
        {isRepairing && (
          <span className={styles.repairPercent}>{progress}%</span>
        )}
      </div>

      {isRepairing && (
        <div className={styles.repairBar}>
          <div className={styles.repairFill} style={{ width: `${progress}%` }} />
        </div>
      )}

      {canEdit && (
        <div className={styles.repairActions}>
          {isRepairing ? (
            <button
              className={styles.repairStopBtn}
              onClick={() => onAction('stopRepair')}
            >
              Stop Repair
            </button>
          ) : (
            <button
              className={styles.repairStartBtn}
              onClick={() => onAction('startRepair')}
            >
              Repair{cost > 0 ? ` (${formatCurrency(cost)})` : ''}
            </button>
          )}
        </div>
      )}

      {!canEdit && !isRepairing && (
        <span className={styles.value}>-</span>
      )}
    </div>
  );
}

// =============================================================================
// TRADE CONNECT BUTTONS (Quick Trade — visible to all players)
// =============================================================================

const TRADE_KINDS = [
  { kind: '4', label: 'Stores' },       // ftpStores = $04
  { kind: '2', label: 'Factories' },     // ftpFactories = $02
  { kind: '1', label: 'Warehouses' },    // ftpWarehouses = $01
] as const;

export function TradeConnectButtons({ onAction }: { onAction: (id: string) => void }) {
  const inFlightActions = useBuildingStore((s) => s.inFlightActions);
  return (
    <div className={styles.tradeConnectGrid}>
      {TRADE_KINDS.map(({ kind, label }) => {
        const connectBusy = inFlightActions.has(`tradeConnect:${kind}`);
        const disconnectBusy = inFlightActions.has(`tradeDisconnect:${kind}`);
        return (
          <div key={kind} className={styles.tradeConnectRow}>
            <button
              className={`${styles.tradeConnectBtn} ${styles.tradeConnectBtnLink}`}
              onClick={() => onAction(`tradeConnect:${kind}`)}
              disabled={connectBusy || disconnectBusy}
              title={connectBusy ? 'Connecting...' : `Connect all your ${label.toLowerCase()} to this building`}
            >
              {connectBusy ? (
                <svg className={styles.tradeConnectSpinner} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              )}
              {connectBusy ? 'Connecting...' : label}
            </button>
            <button
              className={`${styles.tradeConnectBtn} ${styles.tradeConnectBtnUnlink}`}
              onClick={() => onAction(`tradeDisconnect:${kind}`)}
              disabled={connectBusy || disconnectBusy}
              title={disconnectBusy ? 'Disconnecting...' : `Disconnect all your ${label.toLowerCase()} from this building`}
            >
              {disconnectBusy ? (
                <svg className={styles.tradeConnectSpinner} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
              )}
              {disconnectBusy ? 'Disconnecting...' : label}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// ACTION BUTTON
// =============================================================================

export function ActionButton({ def, onAction }: { def: PropertyDefinition; onAction: (id: string) => void }) {
  return (
    <div className={styles.actionBtnContainer}>
      <button
        className={styles.actionBtn}
        onClick={() => def.actionId && onAction(def.actionId)}
      >
        {def.buttonLabel ?? def.displayName}
      </button>
    </div>
  );
}

// =============================================================================
// FILM LAUNCH FORM (Films tab — FilmsSheet.pas:175,186,200,203,205,382-384)
// =============================================================================

/**
 * Launch Movie form — title, budget, months and the two auto flags in one
 * submission. Budget and months are validated before `onLaunch` is called;
 * a rejection shows an inline message and sends nothing, matching Voyager's
 * `CheckMoneyStr` refusal (FilmsSheet.pas:382-384) — never a `NaN` on the wire.
 */
export function FilmLaunchForm({
  autoRelDefault,
  autoProdDefault,
  onLaunch,
}: {
  autoRelDefault: boolean;
  autoProdDefault: boolean;
  onLaunch: (params: Record<string, string>) => void;
}) {
  const [title, setTitle] = useState('');
  const [budget, setBudget] = useState('$10,000,000');
  const [months, setMonths] = useState('12');
  const [autoRel, setAutoRel] = useState(autoRelDefault);
  const [autoProd, setAutoProd] = useState(autoProdDefault);
  const [error, setError] = useState<string | null>(null);

  const handleLaunch = useCallback(() => {
    const budgetNumber = parseCurrencyInput(budget);
    if (budgetNumber === null) {
      setError('Budget must be an amount like $10,000,000');
      return;
    }
    const monthsNumber = parseFilmMonths(months);
    if (monthsNumber === null) {
      setError(`Months must be between ${FILM_MONTHS_MIN} and ${FILM_MONTHS_MAX}`);
      return;
    }
    setError(null);
    onLaunch({
      filmName: title.trim(),
      budget: String(budgetNumber),
      months: String(monthsNumber),
      autoRel: autoRel ? '1' : '0',
      autoProd: autoProd ? '1' : '0',
    });
  }, [title, budget, months, autoRel, autoProd, onLaunch]);

  return (
    <div className={styles.upgradeContainer}>
      <div className={styles.upgradeRow}>
        <span className={styles.upgradeLabel}>Title</span>
        <input
          type="text"
          className={styles.textInput}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className={styles.upgradeRow}>
        <span className={styles.upgradeLabel}>Budget</span>
        <input
          type="text"
          className={styles.textInput}
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </div>
      <div className={styles.upgradeRow}>
        <span className={styles.upgradeLabel}>Months</span>
        <input
          type="number"
          className={styles.upgradeQty}
          min={FILM_MONTHS_MIN}
          max={FILM_MONTHS_MAX}
          value={months}
          onChange={(e) => setMonths(e.target.value)}
        />
      </div>
      <label className={styles.cloneOption}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={autoRel}
          onChange={(e) => setAutoRel(e.target.checked)}
        />
        <span>Auto Release</span>
      </label>
      <label className={styles.cloneOption}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={autoProd}
          onChange={(e) => setAutoProd(e.target.checked)}
        />
        <span>Auto Produce</span>
      </label>
      {error && <div role="alert" className={styles.filmFormError}>{error}</div>}
      <div className={styles.actionBtnContainer}>
        <button className={styles.actionBtn} onClick={handleLaunch}>
          Launch
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// CLONE SETTINGS (PropertyType.CLONE_SETTINGS)
// =============================================================================

/**
 * Clone Settings panel — propagate building configuration to same-type buildings.
 * Hardcoded: "Same Company" (0x02, checked), "Same Town" (0x01, checked).
 * Dynamic: from CloneMenu0 pipe-delimited property value.
 * Apply button OR's checked flags → fire-and-forget CloneFacility on ClientView.
 * Archaeology: ManagementSheet.pas:132-149,388-403, CloneOptions.pas
 */
export function CloneSettings({
  cloneMenuValue,
  buildingX,
  buildingY,
}: {
  cloneMenuValue: string;
  buildingX: number;
  buildingY: number;
}) {
  const client = useClient();
  const isOwner = useBuildingStore((s) => s.isOwner);

  const dynamicOptions = parseCloneMenu(cloneMenuValue);

  // Hardcoded scope options (always present, checked by default) + dynamic building-specific options
  const allOptions: Array<{ label: string; value: number; defaultChecked: boolean }> = [
    { label: 'Same Company', value: 0x02, defaultChecked: true },
    { label: 'Same Town', value: 0x01, defaultChecked: true },
    ...dynamicOptions.map(opt => ({ ...opt, defaultChecked: false })),
  ];

  const [checkedValues, setCheckedValues] = useState<Set<number>>(() => {
    const defaults = new Set<number>();
    for (const opt of allOptions) {
      if (opt.defaultChecked) defaults.add(opt.value);
    }
    return defaults;
  });

  const handleToggle = useCallback((value: number) => {
    setCheckedValues(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  const handleApply = useCallback(() => {
    let bitmask = 0;
    for (const v of checkedValues) bitmask |= v;
    client.onCloneFacility(buildingX, buildingY, bitmask);
  }, [checkedValues, buildingX, buildingY, client]);

  if (!isOwner) return null;

  return (
    <div className={styles.cloneSettings}>
      <div className={styles.cloneSettingsLabel}>Clone Settings</div>
      {allOptions.map((opt) => (
        <label key={opt.value} className={styles.cloneOption}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={checkedValues.has(opt.value)}
            onChange={() => handleToggle(opt.value)}
          />
          <span>{opt.label}</span>
        </label>
      ))}
      <div className={styles.actionBtnContainer}>
        <button className={styles.actionBtn} onClick={handleApply}>
          Apply Clone
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// WAREHOUSE WARES (PropertyType.WARE_CHECKLIST)
// =============================================================================

/** Show filter input when ware count exceeds this threshold. */
const WARE_FILTER_THRESHOLD = 8;

/**
 * Warehouse Wares checklist — toggles individual warehouse gates on/off.
 * Each ware shows a checkbox (enabled state from GateMap) + ware name.
 * Owner can toggle via RDOSelectWare(index, value).
 *
 * Features: search filter (>8 wares), summary counter, toggle all/none,
 * two-column grid layout, visual dimming for disabled wares.
 *
 * Archaeology: WHGeneralSheet.pas clbNames checklist
 */
export function WarehouseWares({
  wares,
  buildingX,
  buildingY,
  onPropertyChange,
}: {
  wares: WarehouseWareData[];
  buildingX: number;
  buildingY: number;
  onPropertyChange: (rdoName: string, value: string, params?: Record<string, string>) => void;
}) {
  const isOwner = useBuildingStore((s) => s.isOwner);
  const [filter, setFilter] = useState('');

  const handleToggle = useCallback((index: number, currentEnabled: boolean) => {
    // RDOSelectWare(index, value): value = -1 (enable/wordbool true) or 0 (disable/wordbool false)
    const newValue = currentEnabled ? '0' : '-1';
    onPropertyChange('RDOSelectWare', newValue, { index: String(index) });
  }, [onPropertyChange]);

  const handleToggleAll = useCallback((enable: boolean) => {
    const value = enable ? '-1' : '0';
    for (const ware of wares) {
      if (ware.enabled !== enable) {
        onPropertyChange('RDOSelectWare', value, { index: String(ware.index) });
      }
    }
  }, [wares, onPropertyChange]);

  if (wares.length === 0) {
    return <span className={styles.value}>No wares</span>;
  }

  const enabledCount = wares.filter(w => w.enabled).length;
  const lowerFilter = filter.toLowerCase();
  const filtered = filter
    ? wares.filter(w => w.name.toLowerCase().includes(lowerFilter))
    : wares;

  return (
    <div className={styles.wareChecklist}>
      <div className={styles.wareChecklistLabel}>Wares</div>

      {/* Summary + bulk toggle */}
      <div className={styles.wareToolbar}>
        <span className={styles.wareSummary}>{enabledCount} / {wares.length} enabled</span>
        {isOwner && (
          <div className={styles.wareBulkBtns}>
            <button className={styles.wareBulkBtn} onClick={() => handleToggleAll(true)}>All</button>
            <button className={styles.wareBulkBtn} onClick={() => handleToggleAll(false)}>None</button>
          </div>
        )}
      </div>

      {/* Filter input (only for long lists) */}
      {wares.length > WARE_FILTER_THRESHOLD && (
        <div className={styles.wareFilterWrap}>
          <input
            type="text"
            className={styles.wareFilterInput}
            placeholder="Filter wares..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}

      {/* Ware items (two-column grid via CSS) */}
      {filtered.length === 0 ? (
        <div className={styles.wareEmpty}>No wares matching "{filter}"</div>
      ) : (
        filtered.map((ware) => (
          <label key={ware.index} className={styles.wareItem}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={ware.enabled}
              disabled={!isOwner}
              onChange={() => handleToggle(ware.index, ware.enabled)}
            />
            <span className={styles.wareName}>{ware.name}</span>
          </label>
        ))
      )}
    </div>
  );
}
