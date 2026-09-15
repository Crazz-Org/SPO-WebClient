/**
 * Facility "kinds" — the player-facing grouping used to hide whole categories of buildings
 * on the isometric map (e.g. "hide all Farms"). A kind is a CLASSES.BIN `[General]` FacId.
 */

import type { FacilityDimensions } from './types/domain-types';

export interface FacilityKind {
  facId: number;
  label: string;
}

/**
 * FacId -> player-facing name. Source: ~/SPO-Original/Model Extensions/FacIds.pas:11-113.
 * A dictionary for NAMING kinds, never the roster of kinds — the roster is derived below from
 * the world's own CLASSES.BIN, so a FacId this dictionary does not know (e.g. 151, the Portals)
 * still appears, labelled `Kind <n>`.
 */
const FACILITY_KIND_LABELS: Record<number, string> = {
  // Headquarters
  10: 'Main Headquarters',
  12: 'Office Headquarters',
  11: 'Industrial Headquarters',
  13: 'Commercial Headquarters',
  14: 'Public Headquarters',

  // Residentials
  20: 'High Class Residence (Low Cost)',
  21: 'Middle Class Residence (Low Cost)',
  22: 'Low Class Residence (Low Cost)',
  25: 'High Class Residence',
  26: 'Middle Class Residence',
  27: 'Low Class Residence',

  // Office
  30: 'Office',

  // Industries
  40: 'Farm',
  42: 'Food Processing',
  44: 'Chemical Plant',
  46: 'Mine',
  48: 'Textile Mill',
  50: 'Metal Plant',
  52: 'Electronic Components',
  54: 'Clothes Factory',
  56: 'Household Appliances',
  58: 'Business Machines',
  60: 'Heavy Industry',
  62: 'Car Factory',
  64: 'Construction Materials',
  65: 'Movie Studios',
  66: 'Pharmaceutics',
  68: 'Plastics',
  69: 'Toy Factory',
  200: 'Oil Rig',
  201: 'Refinery',
  202: 'Liquor Factory',
  203: 'Chemical Mine',
  204: 'Silicon Mine',
  205: 'Stone Mine',
  206: 'Coal Mine',
  207: 'Lumber Mill',
  208: 'Furniture Industry',
  209: 'Paper Industry',
  210: 'Printing Plant',
  211: 'CD Plant',

  // Commerce
  70: 'Food Store',
  71: 'Clothes Store',
  72: 'Household Appliances Store',
  73: 'Business Machines Store',
  74: 'Car Store',
  75: 'Supermarket',
  76: 'Bar',
  77: 'Restaurant',
  78: 'Movie Theater',
  79: 'Drug Store',
  90: 'Toy Store',
  91: 'Gas Station',
  92: 'Furniture Store',
  93: 'Book Store',
  94: 'Computer Store',
  95: 'Funeral Home',
  96: 'CD Store',

  // Business
  80: 'Software Firm',
  81: 'Lawyer Firm',

  // Public Facilities
  100: 'Hospital',
  101: 'School',
  102: 'Police Station',
  103: 'Fire Station',
  104: 'Correctional Facility',
  105: 'Park',
  106: 'Waste Disposal',
  107: 'Amusement Park',
  108: 'Jail',
  109: 'Agency',

  // Special
  110: 'Bank',
  111: 'TV Station',
  112: 'TV Antenna',

  // Warehouses
  120: 'Cold Warehouse',
  121: 'Chemical Warehouse',
  122: 'General Warehouse',
  123: 'Fabrics Warehouse',
  124: 'Ore Warehouse',
  125: 'Mega Warehouse (Import)',
  126: 'Mega Warehouse (Export)',

  // Luxury Facilities
  140: 'Luxury Facility',
};

export function facilityKindLabel(facId: number): string {
  return FACILITY_KIND_LABELS[facId] ?? `Kind ${facId}`;
}

/**
 * Enumerates the FacIds actually present in the shipped dimensions table (keyed by both
 * visualClass and name, so duplicates are expected), dropping `facId` 0/undefined — FID_None
 * is not a kind — and sorting by label with facId as tie-break.
 */
export function deriveFacilityKinds(dimensions: Record<string, FacilityDimensions>): FacilityKind[] {
  const seen = new Set<number>();
  const kinds: FacilityKind[] = [];

  for (const dims of Object.values(dimensions)) {
    const facId = dims.facId;
    if (typeof facId !== 'number' || facId <= 0 || seen.has(facId)) continue;
    seen.add(facId);
    kinds.push({ facId, label: facilityKindLabel(facId) });
  }

  return kinds.sort((a, b) => a.label.localeCompare(b.label) || a.facId - b.facId);
}
