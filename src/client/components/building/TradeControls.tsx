/**
 * TradeControls — the two trade settings of a facility sheet.
 *
 * Voyager put a combo box beside each (`Voyager/IndustryGeneralSheet.pas`,
 * `Voyager/WHGeneralSheet.pas`), and both are narrower than the property they
 * write:
 *
 *  - `cbMode` (→ `RDOSetRole`) appears at all only when the facility's current
 *    role is one of the three it can express (`:189-235`). A producer or a
 *    neutral block has a role, but not one the player may change, and the combo
 *    is hidden rather than disabled.
 *  - `cbTrade` (→ `RDOSetTradeLevel`) is always there, with three items whose
 *    values are 0, 2 and 3 (`:455-462`). `1` (`tlvPupil`) has no item: a stored
 *    1 selects item 0 (`:226`), and no interaction can send it back.
 *
 * Neither member range-checks server side, so the option list IS the guard.
 * A visitor reads both as text — the combos are `Enabled := fOwnsFacility`
 * (`:233-234`).
 */

import type { JSX } from 'react';
import {
  TRADE_MODES,
  isTradeModeValue,
  tradeModeLabel,
  tradeLevelOptions,
  tradeLevelToOption,
  tradeLevelLabel,
} from '@/shared/building-details/trade-settings';
import { SaveIndicator } from './SaveIndicator';
import styles from './PropertyGroup.module.css';

interface TradeControlProps {
  /** The value the cache holds, as the server spelled it. */
  value: string;
  canEdit: boolean;
  /** Sends the chosen option as the member's single integer argument. */
  onSend: (value: number) => void;
}

/**
 * Trade mode — Voyager's `cbMode`. Renders nothing at all for a role the combo
 * cannot express, which is the whole of its visibility rule.
 */
export function TradeModeControl({ value, canEdit, onSend }: TradeControlProps): JSX.Element | null {
  if (!isTradeModeValue(value)) return null;

  return (
    <div className={styles.row}>
      <span className={styles.name}>Trade mode</span>
      {canEdit ? (
        <>
          <select
            aria-label="Trade mode"
            className={styles.select}
            value={value}
            onChange={(e) => onSend(Number(e.target.value))}
          >
            {TRADE_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>{mode.label}</option>
            ))}
          </select>
          <SaveIndicator propertyKey="RDOSetRole" />
        </>
      ) : (
        <span className={styles.value}>{tradeModeLabel(value)}</span>
      )}
    </div>
  );
}

/**
 * Trade level — Voyager's `cbTrade`. Item 0 is re-labelled with the facility
 * owner's name at render time (`IndustryGeneralSheet.pas:223`).
 */
export function TradeLevelControl({
  value,
  ownerName,
  canEdit,
  onSend,
}: TradeControlProps & { ownerName: string }): JSX.Element {
  const options = tradeLevelOptions(ownerName);
  // A level with no item of its own falls back to item 0, as Voyager does.
  const selected = tradeLevelToOption(value) ?? 0;

  return (
    <div className={styles.row}>
      <span className={styles.name}>Trade level</span>
      {canEdit ? (
        <>
          <select
            aria-label="Trade level"
            className={styles.select}
            value={String(selected)}
            onChange={(e) => onSend(Number(e.target.value))}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <SaveIndicator propertyKey="RDOSetTradeLevel" />
        </>
      ) : (
        <span className={styles.value}>{tradeLevelLabel(value, ownerName)}</span>
      )}
    </div>
  );
}
