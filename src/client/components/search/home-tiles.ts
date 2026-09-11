import { Crown, User, Building2, UserSearch, Trophy, Landmark, Newspaper, Search } from 'lucide-react';
import type { SearchMenuCategory } from '@/shared/types';
import type { SearchPage } from '../../store/search-store';

/** What a home tile does when clicked. */
export type HomeTileAction =
  | { kind: 'page'; page: SearchPage }
  | { kind: 'capitol' }
  | { kind: 'you' };

const ACTIONS_BY_ID: Record<string, HomeTileAction> = {
  local: { kind: 'capitol' },
  capitol: { kind: 'capitol' },
  towns: { kind: 'page', page: 'towns' },
  rendertycoon: { kind: 'you' },
  tycoons: { kind: 'page', page: 'people' },
  rankings: { kind: 'page', page: 'rankings' },
  banks: { kind: 'page', page: 'banks' },
  newspapers: { kind: 'page', page: 'media' },
};

/**
 * Server tile id (last `.asp` path segment, or lower-cased label for a disabled cell) -> action.
 * `null` = a tile the client has no page for (rendered inert).
 */
export function homeTileAction(cat: Pick<SearchMenuCategory, 'id'>): HomeTileAction | null {
  return ACTIONS_BY_ID[cat.id.toLowerCase()] ?? null;
}

const ICON_BY_PAGE: Partial<Record<SearchPage, typeof Building2>> = {
  towns: Building2,
  people: UserSearch,
  rankings: Trophy,
  banks: Landmark,
  media: Newspaper,
};

/** Icon for a home tile action; `Search` for one with no action (unknown/inert). */
export function homeTileIcon(action: HomeTileAction | null) {
  if (!action) return Search;
  if (action.kind === 'capitol') return Crown;
  if (action.kind === 'you') return User;
  return ICON_BY_PAGE[action.page] ?? Search;
}
