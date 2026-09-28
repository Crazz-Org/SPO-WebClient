/**
 * Account settings key — where one account's `GameSettings` live in this browser.
 *
 * Voyager kept its options per user name, under `...\Starpeace\Client\Users\<UserName>`
 * (`Voyager/URLHandlers/ConfigHandler.pas:215-218`): per account, on that machine. This is the
 * same scope. `spo_settings` stays as "the settings last used on this browser" — the sign-in
 * form reads it, and an account with no entry of its own starts from it.
 *
 * The account id is the sign-in name normalised the way the directory server identifies an
 * account (`GetAliasId`, `DServer/DirectoryServerProtocol.pas:111-119`): trimmed, spaces turned
 * into `.`, upper-cased.
 */

export const LEGACY_SETTINGS_KEY = 'spo_settings';
export const SETTINGS_KEY_PREFIX = 'spo.settings.';

/** The sign-in name as the directory server identifies the account. */
export function accountId(username: string): string {
  const id = username.trim().replace(/\s+/g, '.').toUpperCase();
  return id || 'player';
}

/** The key one account's settings are written under. */
export function settingsKey(username: string): string {
  return `${SETTINGS_KEY_PREFIX}${accountId(username)}`;
}
