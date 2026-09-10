import type { SearchPage } from '../../store/search-store';

const PAGE_BY_ID: Record<string, SearchPage> = {
  towns: 'towns',
  tycoons: 'people',
  rankings: 'rankings',
  banks: 'banks',
  newspapers: 'media',
  rendertycoon: 'tycoon-profile',
};

/** Directory cell id (parser output, case-insensitive) -> the panel page it opens. */
export function pageForCategoryId(id: string): SearchPage | null {
  return PAGE_BY_ID[id.toLowerCase()] ?? null;
}
