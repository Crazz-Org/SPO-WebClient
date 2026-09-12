/**
 * InspectorHeader — the facility identity block, shared shape with the map
 * preview so the two read as the same object.
 *
 *   [img] BUILDING NAME — Lvl N
 *   Society, Owner
 *   Revenue /h        ROI
 *
 * The preview (StatusOverlay) shows the same three lines minus ROI and minus
 * the owner: it only holds what `SwitchFocusEx` returned, and the tycoon behind
 * the society is a property read the preview does not pay for.
 */

import { useState, type ReactNode } from 'react';
import type { BuildingPropertyValue } from '@/shared/types';
import styles from './InspectorHeader.module.css';

interface InspectorHeaderProps {
  buildingName: string;
  /** Upgrade level, parsed from the focus details text. */
  level?: number;
  /** Company the facility belongs to — `SwitchFocusEx` group 1. */
  society?: string;
  /** Tycoon behind the company — the `Creator` property. */
  owner?: string;
  /** Revenue string as the server printed it, already suffixed "/h". */
  revenue?: string;
  /** Return on investment, as printed by the server (e.g. "12%"). */
  roi?: string;
  /** Coordinates, shown as a discreet third stat. */
  x?: number;
  y?: number;
  /** Rename control and anything else that belongs on the name row. */
  actions?: ReactNode;
  /** Replaces the name when the user is renaming the facility. */
  nameOverride?: ReactNode;
  /** Class image URL from the details response; omitted when the class has none. */
  iconUrl?: string;
}

/** First value found under `name` across every property group. */
export function findPropertyValue(
  groups: { [groupId: string]: BuildingPropertyValue[] },
  name: string,
): string | undefined {
  for (const group of Object.values(groups)) {
    for (const prop of group) {
      if (prop.name === name && prop.value) return prop.value;
    }
  }
  return undefined;
}

/** Positive revenue reads gold, a loss reads red, anything else stays neutral. */
export function revenueTone(revenue: string | undefined): string {
  if (!revenue) return styles.neutral;
  if (revenue.includes('-')) return styles.negative;
  if (revenue.includes('$') && !revenue.includes('$0')) return styles.positive;
  return styles.neutral;
}

/**
 * The facility picture. Hidden until the browser has it and dropped on a
 * failed load, so a missing file never costs the header a broken-image box
 * or a jump in layout.
 */
function FacilityIcon({ url }: { url: string }) {
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading');
  if (state === 'failed') return null;
  return (
    <img
      className={state === 'shown' ? styles.icon : styles.iconPending}
      src={url}
      alt=""
      aria-hidden="true"
      onLoad={() => setState('shown')}
      onError={() => setState('failed')}
    />
  );
}

export function InspectorHeader({
  buildingName,
  level,
  society,
  owner,
  revenue,
  roi,
  x,
  y,
  actions,
  nameOverride,
  iconUrl,
}: InspectorHeaderProps) {
  // "Society, Owner" collapses to whichever half exists — a facility with no
  // Creator read yet must not render a dangling comma.
  const attribution = [society, owner].filter((part) => part && part.length > 0).join(', ');

  return (
    <header className={styles.header}>
      <div className={styles.nameRow}>
        {iconUrl && <FacilityIcon key={iconUrl} url={iconUrl} />}
        {nameOverride ?? (
          <>
            <h3 className={styles.name}>{buildingName}</h3>
            {level !== undefined && <span className={styles.level}>Lvl {level}</span>}
          </>
        )}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>

      {attribution && <div className={styles.attribution}>{attribution}</div>}

      <div className={styles.stats}>
        {revenue && (
          <span className={styles.stat}>
            <span className={styles.statLabel}>Revenue</span>
            <span className={`${styles.statValue} ${revenueTone(revenue)}`}>{revenue}</span>
          </span>
        )}
        {roi && (
          <span className={styles.stat}>
            <span className={styles.statLabel}>ROI</span>
            <span className={styles.statValue}>{roi}</span>
          </span>
        )}
        {x !== undefined && y !== undefined && (
          <span className={styles.coords}>{x}, {y}</span>
        )}
      </div>
    </header>
  );
}
