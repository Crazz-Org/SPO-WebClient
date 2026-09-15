/**
 * QuickStats — the details + sales blocks under the inspector header.
 *
 * Named for what it was (a revenue bar); revenue, society and ROI now live in
 * `InspectorHeader`, and what remains is the two blocks the redesigned panel
 * puts between the header and the section menu.
 */

import type { BuildingFocusInfo } from '@/shared/types';
import { ProgressBar, MiniBar } from '../common';
import { parseSalesLines } from './StatusOverlay';
import { RichDetailsView } from './RichDetails';
import styles from './QuickStats.module.css';

interface QuickStatsProps {
  focus: BuildingFocusInfo;
}

/** Parse "X% completed." pattern from salesInfo. Returns 0..100 or null. */
export function parseConstructionPercent(text: string): number | null {
  const match = text.match(/^(\d+)%\s*completed\.?$/i);
  return match ? parseInt(match[1], 10) : null;
}

/** Parsed detail entry from detailsText. */
export interface DetailEntry {
  label: string;
  value: string;
}

/* ------------------------------------------------------------------ */
/*  Type-aware detailsText parser                                      */
/*  Routes known building formats to dedicated mini-parsers;           */
/*  falls back to generic key:value extraction for unknown formats.    */
/* ------------------------------------------------------------------ */

/** Detect the building category from content markers. */
function classifyDetails(text: string): 'store' | 'farm' | 'storage' | 'residential' | 'public' | 'townhall' | 'hq' | 'generic' {
  if (text.includes('Items Sold:'))        return 'store';
  if (text.includes('Producing:'))         return 'farm';
  if (text.includes('Storing:'))           return 'storage';
  if (/\d+\s+inhabitants/.test(text))      return 'residential';
  if (text.includes('Coverage coverage'))  return 'public';
  if (/\d+.*High class.*Middle class.*Low class/.test(text)) return 'townhall';
  if (text.includes('Research Implementation:')) return 'hq';
  return 'generic';
}

/** Extract "Upgrade Level: N" from the beginning; return [level, remainder]. */
function extractUpgradeLevel(text: string): [DetailEntry | null, string] {
  const m = text.match(/^Upgrade Level:\s*(\d+)\s*/);
  if (!m) return [null, text];
  return [{ label: 'Upgrade Level', value: m[1] }, text.substring(m[0].length)];
}

/** Trim trailing periods/whitespace from a value string. */
function trimValue(v: string): string {
  return v.replace(/\.+\s*$/, '').trim();
}

/* --- Store parser ------------------------------------------------- */
function parseStore(text: string): DetailEntry[] {
  const entries: DetailEntry[] = [];
  // Strip preamble before "Upgrade Level" (e.g., "Drug Store.  Upgrade Level: ...")
  const ulIndex = text.indexOf('Upgrade Level:');
  const cleaned = ulIndex > 0 ? text.substring(ulIndex) : text;
  const [lvl, rest] = extractUpgradeLevel(cleaned);
  if (lvl) entries.push(lvl);

  // Split on double-space boundaries for most fields
  const segments = rest.split(/ {2,}/).map(s => s.trim()).filter(Boolean);

  for (const seg of segments) {
    // key: value segments
    const kvMatch = seg.match(/^(Potential customers \(per day\)|Actual customers|Items Sold|Efficiency|Desirability|Professionals|Workers):\s*(.*)/s);
    if (kvMatch) {
      // "Potential customers (per day): X. Actual customers: Y" can be in one segment
      const potActual = kvMatch[2].match(/^(.*?)\.\s*Actual customers:\s*(.*)/s);
      if (kvMatch[1] === 'Potential customers (per day)' && potActual) {
        entries.push({ label: 'Potential customers (per day)', value: trimValue(potActual[1]) });
        entries.push({ label: 'Actual customers', value: trimValue(potActual[2]) });
      } else {
        entries.push({ label: kvMatch[1], value: trimValue(kvMatch[2]) });
      }
    }
  }
  return entries;
}

/* --- Farm parser -------------------------------------------------- */
function parseFarm(text: string): DetailEntry[] {
  const entries: DetailEntry[] = [];
  const [lvl, rest] = extractUpgradeLevel(text);
  if (lvl) entries.push(lvl);

  // Handle "Producing:" and optional "Professionals:"/"Workers:" after it
  const normalized = rest.replace(/\.(?=[A-Z])/g, '. ');
  const producingMatch = normalized.match(/^Producing:\s*(.*)/s);
  if (producingMatch) {
    // Split products on ".." (double-period) sub-item delimiter
    const products = producingMatch[1]
      .split(/\.\.\s*/)
      .map(s => trimValue(s))
      .filter(Boolean);
    entries.push({ label: 'Producing', value: products.join('; ') });
  }

  // Also extract workforce keys if present (e.g., "Professionals: 1 of 1.Workers: 9 of 27.")
  const workforceKeys = [...normalized.matchAll(/(Professionals|Workers):\s*([^.]*(?:\.\s*(?=[A-Z])|$))/g)];
  for (const wk of workforceKeys) {
    entries.push({ label: wk[1], value: trimValue(wk[2]) });
  }

  return entries;
}

/* --- Storage parser ----------------------------------------------- */
function parseStorage(text: string): DetailEntry[] {
  const entries: DetailEntry[] = [];
  const [lvl, rest] = extractUpgradeLevel(text);
  if (lvl) entries.push(lvl);

  const storingMatch = rest.match(/^Storing:\s*(.*)/s);
  if (storingMatch) {
    // Sub-items separated by ". " + optional extra spaces (period + 2 spaces)
    const items = storingMatch[1]
      .split(/\.\s{2,}/)
      .map(s => trimValue(s))
      .filter(Boolean);
    entries.push({ label: 'Storing', value: items.join('; ') });
  }
  return entries;
}

/* --- Residential parser ------------------------------------------- */
function parseResidential(text: string): DetailEntry[] {
  const entries: DetailEntry[] = [];
  const [lvl, rest] = extractUpgradeLevel(text);
  if (lvl) entries.push(lvl);

  // Extract "N inhabitants"
  const inhab = rest.match(/([\d,]+)\s+inhabitants/);
  if (inhab) entries.push({ label: 'Inhabitants', value: inhab[1] });

  // Extract "N desirability"
  const desir = rest.match(/(\d+)\s+desirability/);
  if (desir) entries.push({ label: 'Desirability', value: desir[1] });

  // Extract QOL metrics (single-space separated key: value pairs)
  const qolKeys = ['QOL', 'Neighborhood Quality', 'Beauty', 'Crime', 'Pollution'];
  for (const key of qolKeys) {
    const re = new RegExp(key.replace(/\s/g, '\\s') + ':\\s*(\\d+%?)');
    const m = rest.match(re);
    if (m) entries.push({ label: key, value: m[1] });
  }
  return entries;
}

/* --- Public facility parser --------------------------------------- */
function parsePublic(text: string): DetailEntry[] {
  const entries: DetailEntry[] = [];
  const [lvl, rest] = extractUpgradeLevel(text);
  if (lvl) entries.push(lvl);

  // "X Coverage coverage accross the city reported at N%."  (NO colon after Coverage key)
  const coverageMatches = [...rest.matchAll(/(\w+(?:\s+\w+)?) Coverage coverage accross the city reported at (\d+%)/g)];
  for (const cm of coverageMatches) {
    entries.push({ label: `${cm[1]} Coverage`, value: cm[2] });
  }
  return entries;
}

/* --- Town Hall parser --------------------------------------------- */
function parseTownHall(text: string): DetailEntry[] {
  const entries: DetailEntry[] = [];
  const classMatches = [...text.matchAll(/([\d,]+)\s+(High|Middle|Low) class\s+\((\d+%)\s+unemp\)/g)];
  for (const cm of classMatches) {
    entries.push({ label: `${cm[2]} class`, value: `${cm[1]} (${cm[3]} unemp)` });
  }
  return entries;
}

/* --- Company HQ parser -------------------------------------------- */
function parseHQ(text: string): DetailEntry[] {
  const entries: DetailEntry[] = [];

  // Leading sentence as Status (e.g., "Company supported at 200%.")
  const riMatch = text.match(/Research Implementation:\s*(.*)/);
  if (riMatch) {
    const before = text.substring(0, riMatch.index).trim();
    if (before) {
      entries.push({ label: 'Status', value: trimValue(before) });
    }
    entries.push({ label: 'Research Implementation', value: trimValue(riMatch[1]) });
  }
  return entries;
}

/* --- Generic fallback parser -------------------------------------- */

const KNOWN_DETAIL_KEYS: string[] = [
  'Potential customers (per day)',
  'Research Implementation',
  'Actual customers',
  'Upgrade Level',
  'Desirability',
  'Professionals',
  'Items Sold',
  'Efficiency',
  'Producing',
  'Storing',
  'Workers',
];

const KEY_PATTERN = new RegExp(
  '(' +
  KNOWN_DETAIL_KEYS.map(k => k.replace(/[()]/g, '\\$&')).join('|') +
  '|[A-Z][a-z]+ Coverage' +
  '|[A-Z][A-Za-z]+(?: [A-Za-z]+)?' +
  '):\\s*',
  'g',
);

function parseGeneric(text: string): DetailEntry[] {
  const normalized = text.replace(/\.(?=[A-Z])/g, '. ');

  const firstKeyMatch = KEY_PATTERN.exec(normalized);
  KEY_PATTERN.lastIndex = 0;
  let working = normalized;
  if (firstKeyMatch && firstKeyMatch.index > 0) {
    const preamble = normalized.substring(0, firstKeyMatch.index).trim();
    if (!preamble.includes(':')) {
      working = normalized.substring(firstKeyMatch.index);
    }
  }

  const matches = [...working.matchAll(KEY_PATTERN)];
  if (matches.length === 0) return [];

  const entries: DetailEntry[] = [];
  if (matches[0].index > 0) {
    const before = working.substring(0, matches[0].index).trim().replace(/\.$/, '');
    if (before) entries.push({ label: 'Status', value: before });
  }

  for (let i = 0; i < matches.length; i++) {
    const label = matches[i][1];
    const valueStart = matches[i].index + matches[i][0].length;
    const valueEnd = i + 1 < matches.length ? matches[i + 1].index : working.length;
    const value = working.substring(valueStart, valueEnd).trim().replace(/\.?\s*$/, '');
    if (value) entries.push({ label, value });
  }
  return entries;
}

/* --- Main entry point --------------------------------------------- */

/** Parse detailsText into structured key-value entries.
 *  Routes known building formats to dedicated parsers;
 *  falls back to generic key:value extraction for unknown formats.
 */
export function parseDetailsText(text: string): DetailEntry[] {
  if (!text) return [];

  const category = classifyDetails(text);
  switch (category) {
    case 'store':       return parseStore(text);
    case 'farm':        return parseFarm(text);
    case 'storage':     return parseStorage(text);
    case 'residential': return parseResidential(text);
    case 'public':      return parsePublic(text);
    case 'townhall':    return parseTownHall(text);
    case 'hq':          return parseHQ(text);
    default:            return parseGeneric(text);
  }
}

/**
 * Facility summary: the parsed details block, then the sales list.
 *
 * Revenue used to head this bar; it now sits in `InspectorHeader` alongside the
 * society and the ROI, which is where the redesigned inspector states the
 * facility's identity. What is left here is the two blocks the spec puts under
 * the header, in that order — details, then sales.
 */
export function QuickStats({ focus }: QuickStatsProps) {
  const constructionPct = focus.salesInfo
    ? parseConstructionPercent(focus.salesInfo)
    : null;

  return (
    <div className={styles.bar}>
      <RichDetailsView detailsText={focus.detailsText} hintsText={focus.hintsText} />

      {constructionPct !== null ? (
        <div className={styles.construction}>
          <div className={styles.constructionHeader}>
            <span className={styles.constructionLabel}>Construction</span>
            <span className={styles.constructionPct}>{constructionPct}%</span>
          </div>
          <ProgressBar value={constructionPct / 100} variant="gold" height={4} />
        </div>
      ) : (
        focus.salesInfo && (() => {
          const lines = parseSalesLines(focus.salesInfo);
          if (lines.length > 0) {
            // A warehouse posts one row per ware it sells — 30+ of them. The
            // rows scroll inside a capped box so the section menu below keeps
            // its share of the inspector height.
            return (
              <div className={styles.salesList}>
                <div className={styles.salesListHeader}>
                  <span className={styles.label}>Sales</span>
                  <span className={styles.salesCount}>{lines.length}</span>
                </div>
                <div className={styles.salesScroll}>
                  {lines.map((line, i) => (
                    <div key={i} className={styles.salesRow}>
                      <div className={styles.salesRowHeader}>
                        <span className={styles.salesCategory}>{line.category}</span>
                      </div>
                      <MiniBar
                        value={line.percent / 100}
                        label={`${line.percent}%`}
                        variant={line.percent >= 80 ? 'success' : line.percent >= 40 ? 'gold' : 'warning'}
                        height={4}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div className={styles.stat}>
              <span className={styles.value}>{focus.salesInfo}</span>
              <span className={styles.label}>Sales</span>
            </div>
          );
        })()
      )}
    </div>
  );
}
