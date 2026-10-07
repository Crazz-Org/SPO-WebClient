/**
 * topbar-model — the pure reading behind the v2 top deck (TopBar, SignalLine, ModeBanner).
 *
 * Every word the top deck shows is decided here, from plain values, so it is tested without
 * a DOM. The words themselves are v1's (StatusPill, WorldEventTicker, CommandBar's mode row):
 * the v2 deck redraws them, it does not re-word them.
 */

import { incomeSign } from '../../format-utils';
import type { TycoonStats } from '../../store/game-store';
import type { WorldEventLine } from '../../../shared/types';

export type Tone = 'positive' | 'negative' | 'neutral';

const COMPACT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

/** "PLANITIA", or "OFFLINE" before the world is known (StatusPill). */
export function worldLabel(worldName: string): string {
  return worldName ? worldName.toUpperCase() : 'OFFLINE';
}

/** "Mar 12, 2334", or "..." before the first RefreshDate push (StatusPill). */
export function formatCompactDate(date: Date | null): string {
  if (!date) return '...';
  return date.toLocaleDateString('en-US', COMPACT_DATE);
}

/** "Xs ago" / "Xm ago" since the last stats push; '' when there has been none (StatusPill). */
export function formatTimeAgo(timestamp: number | null, now: number): string {
  if (!timestamp) return '';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

/** The colour of the income figure: green above zero, red below, grey at zero or unknown. */
export function incomeTone(stats: TycoonStats | null): Tone {
  return stats ? incomeSign(stats.incomePerHour) : 'neutral';
}

export interface DebtState {
  level: number;
  /** failureLevel >= 2 — near bankruptcy, the tag pulses */
  critical: boolean;
  title: string;
}

/** The Debt tag, shown from failureLevel 1 (StatusPill, H6); null when the books are fine. */
export function debtState(stats: TycoonStats | null): DebtState | null {
  const level = stats?.failureLevel ?? 0;
  if (level < 1) return null;
  return {
    level,
    critical: level >= 2,
    title: `Debt — level ${level}. View facilities losing money.`,
  };
}

/** The watchers lamp's sentence (NotifyCompanionship), or null with nobody watching. */
export function watchersLabel(watchers: readonly string[]): string | null {
  return watchers.length > 0 ? `Watching your area: ${watchers.join(', ')}` : null;
}

/** The Backup lamp's sentence (ServerBusy / ModelStatusChanged). */
export const BACKUP_LABEL = 'Backup in progress — the world is saving; some actions may be slower';

/** "14/50" — facilities owned against the level's cap. */
export function facilitiesLabel(stats: TycoonStats): string {
  return `${stats.buildingCount}/${stats.maxBuildings}`;
}

/**
 * The role chip: a visitor is named as such (they hold no company, chooseVisa.asp), otherwise
 * the public-office role ("Mayor") when there is one, else nothing.
 */
export function roleLabel(ownerRole: string, isVisitor: boolean): string {
  if (isVisitor) return 'Visitor';
  return ownerRole;
}

export interface EventCaption {
  /** "<date> — <text>" — an em dash, as WorldEventTicker writes it */
  label: string;
  /** The tile the event's URL carried, or null when it carried none */
  tile: { x: number; y: number } | null;
}

/** The world event line; null for no event or an empty one (WorldEventTicker). */
export function eventCaption(event: WorldEventLine | null): EventCaption | null {
  if (!event || !event.text.trim()) return null;
  const tile = typeof event.x === 'number' && typeof event.y === 'number' ? { x: event.x, y: event.y } : null;
  return { label: `${event.date} — ${event.text}`, tile };
}

/** The context sentence, trimmed-empty meaning "no town here" (ContextStatusStrip). */
export function contextSentence(text: string): string | null {
  return text.trim() ? text : null;
}

/** The accessible name of the way out of a mode — the same words as MobileModeBar. */
export function modeExitLabel(doneLabel: string, kind: string): string {
  return `${doneLabel} — leave ${kind} mode`;
}

/** Join CSS module class names, dropping the falsy ones. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}
