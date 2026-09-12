/**
 * Home grid tile actions — which drill-down (or special action) a directory home tile opens.
 *
 * Pure by design, mirroring `directory-refs.ts` in this folder: the panel asks this question
 * on every click, and a discriminated union is easier to trust when the answer is a function
 * nobody has to render to test.
 */

import type { SearchMenuCategory } from '@/shared/types';
import type { SearchPage } from '../../store/search-store';

/** Tile id (the legacy cell's .asp file name, search-menu-parser.ts:42) → drill-down page. */
export const HOME_TILE_PAGES: Readonly<Record<string, SearchPage>> = {
  Towns: 'towns',
  Tycoons: 'people',
  Rankings: 'rankings',
  Banks: 'banks',
  Newspapers: 'media',
};

export type HomeTileAction =
  | { kind: 'page'; page: SearchPage }
  | { kind: 'capitol' }   // DirectoryMain.asp:79 — SELECT x,y on the map
  | { kind: 'you' };      // DirectoryMain.asp:137 — RenderTycoon.asp for the signed-in tycoon

/** null = no action known for this id (renders dimmed and inert). */
export function homeTileAction(cat: SearchMenuCategory): HomeTileAction | null {
  if (cat.id === 'local' || cat.id === 'capitol') return { kind: 'capitol' };
  if (cat.id === 'RenderTycoon') return { kind: 'you' };
  const page = HOME_TILE_PAGES[cat.id];
  if (page) return { kind: 'page', page };
  return null;
}
