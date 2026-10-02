/**
 * focus-card-model — what the v2 FocusCard says about the focused building, as plain data.
 *
 * Everything here is derived from the pushed focus info (`BuildingFocusInfo`) with the same
 * parsers the classic StatusOverlay uses — no extra server read. The card is compact, so it
 * keeps the identity (name, level, owner, revenue), the diagnosis sentence, the two most
 * telling figures and the top sales lines; how many figures it left out is counted so the
 * card can say the inspector holds the rest.
 */

import type { BuildingFocusInfo } from '@/shared/types';
import { isCivicBuilding } from '@/shared/building-details/civic-buildings';
import { parseFacilityDiagnosis, type FacilityDiagnosis } from '@/shared/building-details/facility-diagnosis';
import { parseRichDetails, percentColor, type MetricColor, type RichDetails } from '../../components/building/RichDetails';
import { parseSalesLines, revenueDirection, type SalesLine } from '../../components/building/StatusOverlay';

/** Headline figures shown on the card; the rest is one click away in the inspector. */
export const MAX_FACTS = 2;
/** Sales lines shown on the card (the classic popover showed 4 in a 380 px box). */
export const MAX_SALES_ROWS = 3;

export type FactTone = 'positive' | 'warning' | 'negative' | 'gold' | 'neutral';

export interface FocusFact {
  label: string;
  value: string;
  tone: FactTone;
  /** A short qualifier under the value ("85% quality"); the tone colours it when present. */
  sub?: string;
}

export interface FocusSales {
  lines: SalesLine[];
  /** Lines not shown. */
  more: number;
}

export interface FocusCardModel {
  name: string;
  level: number | null;
  owner: string;
  revenue: { text: string; direction: 'up' | 'down' | 'neutral' } | null;
  isCivic: boolean;
  actionLabel: 'Inspect' | 'Visit';
  diagnosis: FacilityDiagnosis;
  /** The raw hint, only when the diagnosis found nothing to say. */
  hint: string | null;
  facts: FocusFact[];
  /** Figures parsed but not shown. */
  factsOmitted: number;
  /** One free line: the HQ status, or the raw details when no parser recognised them. */
  note: string | null;
  sales: FocusSales | null;
  /** Sales text no parser recognised, shown as is. */
  salesText: string | null;
}

const NO_HINTS = 'No hints for this facility.';

export function toneOf(color: MetricColor | undefined): FactTone {
  switch (color) {
    case 'success': return 'positive';
    case 'warning': return 'warning';
    case 'error': return 'negative';
    case 'gold': return 'gold';
    default: return 'neutral';
  }
}

/** Tone of a sales percentage — the classic thresholds (≤ 25 % bad, ≤ 60 % weak). */
export function salesTone(percent: number): FactTone {
  if (percent <= 25) return 'negative';
  if (percent <= 60) return 'warning';
  return 'positive';
}

function percentTone(value: string | undefined): FactTone {
  return value ? toneOf(percentColor(value)) : 'neutral';
}

/** Every figure the parsed details carry, most telling first. */
export function allFacts(rich: RichDetails): FocusFact[] {
  const metricFacts = (list: RichDetails['metrics']): FocusFact[] =>
    (list ?? []).map((m) => ({ label: m.label, value: m.value, tone: toneOf(m.color) }));

  switch (rich.category) {
    case 'farm':
      return [
        ...(rich.producing ?? []).map((p): FocusFact => {
          const parts = [p.quality && `${p.quality} quality`, p.efficiency && `${p.efficiency} eff.`].filter(Boolean);
          return {
            label: p.name,
            value: p.volume,
            tone: percentTone(p.efficiency ?? p.quality),
            ...(parts.length ? { sub: parts.join(' · ') } : {}),
          };
        }),
        ...metricFacts(rich.metrics),
      ];
    case 'storage':
      return (rich.storing ?? []).map((s) => ({
        label: s.name,
        value: s.amount,
        tone: percentTone(s.quality),
        ...(s.quality ? { sub: `${s.quality} quality` } : {}),
      }));
    case 'store': {
      const metrics = metricFacts(rich.metrics);
      const efficiency = metrics.filter((m) => m.label === 'Efficiency');
      const others = metrics.filter((m) => m.label !== 'Efficiency');
      const customers: FocusFact[] = rich.customers && (rich.customers.actual || rich.customers.potential)
        ? [{
            label: 'Customers',
            value: rich.customers.actual || '—',
            tone: 'neutral',
            ...(rich.customers.potential ? { sub: `of ${rich.customers.potential} /day` } : {}),
          }]
        : [];
      return [...efficiency, ...customers, ...others];
    }
    case 'residential':
      return [
        ...(rich.inhabitants ? [{ label: 'Inhabitants', value: rich.inhabitants, tone: 'neutral' as const }] : []),
        ...metricFacts(rich.qolMetrics),
        ...(rich.desirability ? [{ label: 'Desirability', value: rich.desirability, tone: 'neutral' as const }] : []),
      ];
    case 'public':
      return metricFacts(rich.coverages);
    case 'townhall': {
      const classes = metricFacts(rich.classes);
      if (classes.length === 0) return [];
      const total = (rich.classes ?? []).reduce((sum, c) => sum + (parseInt(c.value.replace(/,/g, ''), 10) || 0), 0);
      return [{ label: 'Population', value: total.toLocaleString('en-US'), tone: 'neutral' }, ...classes];
    }
    case 'hq':
      return rich.research ? [{ label: 'Research', value: rich.research, tone: 'neutral' }] : [];
    case 'generic':
      return (rich.entries ?? []).map((e) => ({ label: e.label, value: e.value, tone: 'neutral' }));
  }
}

export function buildFocusCard(b: BuildingFocusInfo): FocusCardModel {
  const rich = b.detailsText ? parseRichDetails(b.detailsText) : null;
  const facts = rich ? allFacts(rich) : [];
  const diagnosis = parseFacilityDiagnosis(b.detailsText, b.hintsText);
  const isCivic = isCivicBuilding(b.visualClass || '0');

  let note: string | null = null;
  if (rich?.category === 'hq' && rich.status) note = rich.status;
  else if (!rich && b.detailsText) note = b.detailsText;

  const lines = b.salesInfo ? parseSalesLines(b.salesInfo) : [];

  return {
    name: b.buildingName,
    level: rich?.upgradeLevel ?? null,
    owner: b.ownerName,
    revenue: b.revenue ? { text: b.revenue, direction: revenueDirection(b.revenue) } : null,
    isCivic,
    actionLabel: isCivic ? 'Visit' : 'Inspect',
    diagnosis,
    hint: diagnosis.severity === 'none' && b.hintsText && b.hintsText !== NO_HINTS ? b.hintsText : null,
    facts: facts.slice(0, MAX_FACTS),
    factsOmitted: Math.max(0, facts.length - MAX_FACTS),
    note,
    sales: lines.length > 0
      ? { lines: lines.slice(0, MAX_SALES_ROWS), more: Math.max(0, lines.length - MAX_SALES_ROWS) }
      : null,
    salesText: lines.length === 0 && b.salesInfo ? b.salesInfo : null,
  };
}
