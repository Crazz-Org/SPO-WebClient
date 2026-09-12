/**
 * Navigation between directory pages — which ref a row opens, and what the legacy page
 * printed above its list.
 *
 * Pure by design: the page component asks these two questions on every click, and a
 * discriminated union is easier to trust when the answer is a function nobody has to render
 * to test.
 */

import type { DirectoryRef, DirectoryFacilityRow } from '@/shared/types';

/**
 * The ref a folder row opens, or null when the ref is not a folder at all.
 *
 * Mirrors the `dirHref` each legacy page writes for its own rows:
 * `InTownFacilities.asp:16`, `InTownCompanies.asp:17`, `InTownCompany.asp:22`,
 * `TycoonCompanies.asp:22`, `TycoonCompany.asp:13`.
 */
export function childRef(parent: DirectoryRef, item: string): DirectoryRef | null {
  switch (parent.kind) {
    case 'town-facilities':
      return { kind: 'town-facility-kind', town: parent.town, facKind: item };
    case 'town-companies':
      return { kind: 'town-company', town: parent.town, company: item };
    case 'town-company':
      return {
        kind: 'town-company-facility-kind',
        town: parent.town,
        company: parent.company,
        facKind: item,
      };
    case 'tycoon-companies':
      return { kind: 'tycoon-company', tycoon: parent.tycoon, company: item };
    case 'tycoon-company':
      return {
        kind: 'tycoon-facility-kind',
        tycoon: parent.tycoon,
        company: parent.company,
        facKind: item,
      };
    default:
      return null;
  }
}

/** The card a facility row opens — `OpenFacility.asp?Path=…&Name=…` (BrowseFacFolder.inc:15). */
export function facilityRef(row: DirectoryFacilityRow): DirectoryRef {
  return { kind: 'facility', path: row.path, name: row.itemName };
}

/**
 * The header stack the legacy page printed above its list, as one line.
 *
 * `BrowseTownCompFacFolder.asp:28-63` stacks town / Companies / company / kind in four
 * separate divs; the town page and the facility card print their own name instead, so they
 * have no heading of their own here.
 */
export function directoryHeading(ref: DirectoryRef): string {
  switch (ref.kind) {
    case 'town-facilities':
      return `${ref.town} › Facilities`;
    case 'town-companies':
      return `${ref.town} › Companies`;
    case 'town-company':
      return `${ref.town} › Companies › ${ref.company}`;
    case 'town-facility-kind':
      return `${ref.town} › Facilities › ${ref.facKind}`;
    case 'town-company-facility-kind':
      return `${ref.town} › Companies › ${ref.company} › ${ref.facKind}`;
    case 'tycoon-companies':
      return `${ref.tycoon} › Companies`;
    case 'tycoon-company':
      return `${ref.tycoon} › ${ref.company}`;
    case 'tycoon-facility-kind':
      return `${ref.tycoon} › ${ref.company} › ${ref.facKind}`;
    default:
      return '';
  }
}
