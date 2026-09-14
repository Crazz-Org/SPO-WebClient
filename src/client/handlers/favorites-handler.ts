/**
 * Favorites Handler — the mutations of the player's bookmark tree, and the
 * one-off migration of the places that used to live in this browser.
 *
 * Each mutation waits for the gateway's answer and acts on what the server
 * actually said. On success the list is re-read from the server rather than
 * patched locally, so the panel can only ever show what the server confirmed;
 * on a refusal nothing is re-read and the player is told (OB-1: a detected
 * failure reported as an OK is the defect this avoids).
 */

import {
  WsMessageType,
  type WsReqFavoriteAdd,
  type WsRespFavoriteAdd,
  type WsReqFavoriteDelete,
  type WsRespFavoriteDelete,
  type WsReqFavoriteRename,
  type WsRespFavoriteRename,
  type WsReqFavoriteFolderCreate,
  type WsRespFavoriteFolderCreate,
  type WsReqFavoriteMove,
  type WsRespFavoriteMove,
} from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { ClientBridge } from '../bridge/client-bridge';
import { useGameStore } from '../store/game-store';
import { useEmpireStore } from '../store/empire-store';
import { bookmarksKey, readLegacyBookmarks, clearLegacyBookmarks } from '../store/legacy-bookmarks';
import type { ClientHandlerContext } from './client-context';

/** Re-read the root of the tree. Shared by the three mutations. */
function refreshFacilities(ctx: ClientHandlerContext): void {
  ClientBridge.setEmpireLoading(true);
  ctx.sendMessage({ type: WsMessageType.REQ_EMPIRE_FACILITIES });
}

export async function addFavorite(
  ctx: ClientHandlerContext, name: string, x: number, y: number,
): Promise<void> {
  const req: WsReqFavoriteAdd = { type: WsMessageType.REQ_FAVORITE_ADD, name, x, y };
  try {
    const response = await ctx.sendRequest(req) as WsRespFavoriteAdd;
    if (!response.success) {
      ctx.showNotification(response.message || 'Could not add this favourite.', 'error');
      return;
    }
    ctx.showNotification(`"${name}" added to your list`, 'success');
    refreshFacilities(ctx);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to add favourite: ${toErrorMessage(err)}`, 'error');
  }
}

export async function removeFavorite(
  ctx: ClientHandlerContext, path: string, name: string,
): Promise<void> {
  const req: WsReqFavoriteDelete = { type: WsMessageType.REQ_FAVORITE_DELETE, path };
  try {
    const response = await ctx.sendRequest(req) as WsRespFavoriteDelete;
    if (!response.success) {
      ctx.showNotification(response.message || 'Could not remove this favourite.', 'error');
      return;
    }
    ctx.showNotification(`"${name}" removed from your list`, 'success');
    refreshFacilities(ctx);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to remove favourite: ${toErrorMessage(err)}`, 'error');
  }
}

export interface FavoriteRemoval { path: string; name: string }

export interface BatchRemovalOutcome {
  /** The names the server confirmed removed. */
  removed: string[];
  /** One entry per item the server refused or that never got an answer. */
  failed: { name: string; message: string }[];
}

/**
 * Remove several favourites in one action. One `REQ_FAVORITE_DELETE` per
 * remaining item, sequentially, so a refusal on one item never stops the
 * rest — the batch reports what actually happened per item rather than
 * collapsing to a single success/failure (OB-1, in its batch form).
 */
export async function removeFavorites(
  ctx: ClientHandlerContext, items: readonly FavoriteRemoval[],
): Promise<BatchRemovalOutcome> {
  // A folder's contents go with it — asking for a selected descendant too
  // would come back as a refusal nobody caused.
  const toRemove = items.filter(
    (p) => !items.some((q) => q !== p && p.path.startsWith(`${q.path}/`)),
  );

  const removed: string[] = [];
  const failed: { name: string; message: string }[] = [];

  for (const item of toRemove) {
    const req: WsReqFavoriteDelete = { type: WsMessageType.REQ_FAVORITE_DELETE, path: item.path };
    try {
      const response = await ctx.sendRequest(req) as WsRespFavoriteDelete;
      if (!response.success) {
        failed.push({ name: item.name, message: response.message || 'the server refused it' });
      } else {
        removed.push(item.name);
      }
    } catch (err: unknown) {
      failed.push({ name: item.name, message: toErrorMessage(err) });
    }
  }

  const total = toRemove.length;
  if (failed.length === 0) {
    const message = total === 1
      ? `"${removed[0]}" removed from your list`
      : `${total} places removed from your list`;
    ctx.showNotification(message, 'success');
  } else {
    const reasons = failed.map((f) => `"${f.name}": ${f.message}`).join('; ');
    if (removed.length === 0) {
      ctx.showNotification(`Nothing was removed — ${reasons}`, 'error');
    } else {
      ctx.showNotification(`Removed ${removed.length} of ${total} — ${reasons}`, 'warning');
    }
  }

  if (removed.length > 0) refreshFacilities(ctx);

  return { removed, failed };
}

export async function renameFavorite(
  ctx: ClientHandlerContext, path: string, name: string,
): Promise<void> {
  const req: WsReqFavoriteRename = { type: WsMessageType.REQ_FAVORITE_RENAME, path, name };
  try {
    const response = await ctx.sendRequest(req) as WsRespFavoriteRename;
    if (!response.success) {
      ctx.showNotification(response.message || 'Could not rename this favourite.', 'error');
      return;
    }
    refreshFacilities(ctx);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to rename favourite: ${toErrorMessage(err)}`, 'error');
  }
}

export async function createFolder(
  ctx: ClientHandlerContext, parentPath: string, name: string,
): Promise<void> {
  const req: WsReqFavoriteFolderCreate = { type: WsMessageType.REQ_FAVORITE_FOLDER_CREATE, parentPath, name };
  try {
    const response = await ctx.sendRequest(req) as WsRespFavoriteFolderCreate;
    if (!response.success) {
      ctx.showNotification(response.message || 'Could not create this folder.', 'error');
      return;
    }
    ctx.showNotification(`"${name}" created`, 'success');
    refreshFacilities(ctx);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to create folder: ${toErrorMessage(err)}`, 'error');
  }
}

export async function moveFavorite(
  ctx: ClientHandlerContext, path: string, destPath: string, name: string,
): Promise<void> {
  const req: WsReqFavoriteMove = { type: WsMessageType.REQ_FAVORITE_MOVE, path, destPath };
  try {
    const response = await ctx.sendRequest(req) as WsRespFavoriteMove;
    if (!response.success) {
      ctx.showNotification(response.message || 'Could not move this favourite.', 'error');
      return;
    }
    ctx.showNotification(`"${name}" moved`, 'success');
    refreshFacilities(ctx);
  } catch (err: unknown) {
    ctx.showNotification(`Failed to move favourite: ${toErrorMessage(err)}`, 'error');
  }
}

/**
 * Keys already handled this session. Clearing the storage key is not enough on
 * its own: a second facilities response can arrive while the first migration is
 * still pushing, and would read the same list again and duplicate it.
 */
const migrationDone = new Set<string>();

/**
 * Move the places this browser kept (N4) into the server's Favorites tree, once.
 *
 * Merge, never overwrite: what the tree already holds at the same coordinates is
 * left alone, and the local key is only dropped once every missing place has been
 * accepted by the server. A refusal keeps the local list and lets a later
 * facilities read try again — losing a player's places to a failed write would be
 * the worst possible outcome of a migration.
 */
export async function migrateLocalBookmarks(ctx: ClientHandlerContext): Promise<void> {
  const { worldName, username } = useGameStore.getState();
  const key = bookmarksKey(worldName, username);
  if (migrationDone.has(key)) return;
  migrationDone.add(key);

  const local = readLegacyBookmarks(worldName, username);
  if (local.length === 0) return;

  const known = useEmpireStore.getState().facilities;
  const missing = local.filter((b) => !known.some((f) => f.x === b.x && f.y === b.y));
  if (missing.length === 0) {
    clearLegacyBookmarks(worldName, username);
    return;
  }

  try {
    for (const b of missing) {
      const req: WsReqFavoriteAdd = { type: WsMessageType.REQ_FAVORITE_ADD, name: b.name, x: b.x, y: b.y };
      const response = await ctx.sendRequest(req) as WsRespFavoriteAdd;
      if (!response.success) {
        throw new Error(response.message || 'the server refused one of them');
      }
    }
  } catch (err: unknown) {
    migrationDone.delete(key);
    ctx.showNotification(
      `Could not move your saved places to your account: ${toErrorMessage(err)}`, 'error',
    );
    return;
  }

  clearLegacyBookmarks(worldName, username);
  ctx.showNotification(
    `${missing.length} saved place${missing.length > 1 ? 's' : ''} moved to your account`, 'success',
  );
  refreshFacilities(ctx);
}
