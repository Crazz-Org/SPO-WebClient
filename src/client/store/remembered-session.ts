/**
 * Remembered session — the world and company a player entered last time.
 *
 * One small JSON object in localStorage, keyed by `REMEMBERED_SESSION_KEY`. Never carries a
 * password: the record only lets the sign-in screen offer "type the password once, click one
 * button" for a specific world and company. Modelled on `legacy-bookmarks.ts`'s `storage()`
 * guard and try/catch discipline — a corrupt or absent value must read as "nothing remembered",
 * never as a crash.
 */

/** One remembered world + company. `ownerRole` decides `selectCompanyAndStart` vs a switch. */
export interface RememberedSession {
  username: string;
  /** What REQ_CONNECT_DIRECTORY was sent with — '' is the gateway's default zone. */
  zonePath: string;
  /** The name as listed by the directory — what REQ_LOGIN_WORLD carries. */
  worldName: string;
  companyId: string;
  companyName: string;
  ownerRole?: string;
}

export const REMEMBERED_SESSION_KEY = 'spo_last_session';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isRememberedSession(value: unknown): value is RememberedSession {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.username === 'string'
    && typeof v.zonePath === 'string'
    && typeof v.worldName === 'string'
    && typeof v.companyId === 'string'
    && typeof v.companyName === 'string'
    && (v.ownerRole === undefined || typeof v.ownerRole === 'string');
}

/** Read the remembered record. `null` on no storage, no key, bad JSON, or a missing field. */
export function loadRememberedSession(): RememberedSession | null {
  try {
    const raw = storage()?.getItem(REMEMBERED_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRememberedSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveRememberedSession(record: RememberedSession): void {
  try {
    storage()?.setItem(REMEMBERED_SESSION_KEY, JSON.stringify(record));
  } catch {
    /* private mode or a storage that throws — the record just won't be there next time */
  }
}

export function clearRememberedSession(): void {
  try {
    storage()?.removeItem(REMEMBERED_SESSION_KEY);
  } catch {
    /* same as above */
  }
}
