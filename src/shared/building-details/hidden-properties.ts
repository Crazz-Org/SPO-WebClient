/**
 * Properties the inspector reads but never shows.
 *
 * These are hidden at RENDER time, not dropped from the templates: several of
 * them still do work off-screen.
 *
 *   - `SecurityId` decides `canGovern` server-side (building-details-handler).
 *   - `MoneyGraph` ("Has Graph") gates whether the revenue chart is drawn at
 *     all (PropertyGroup, GRAPH branch) — the flag is read from the value map,
 *     which is why hiding a ROW is not the same as removing a PROPERTY.
 *
 * The rest are duplicates of what the header already states (`Creator`,
 * `OwnerName`) or raw fields with no reading for a player (`Trouble`,
 * `UpgradeActions`).
 *
 * `TradeRole`/`Role` and `TradeLevel` were once on this list and are not any
 * more: they are the two trade settings the owner changes, and PropertyGroup
 * renders them as controls (TradeControls.tsx), not as raw rows.
 */
export const HIDDEN_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  // "Has Graph" — the boolean behind the revenue chart, not a fact to display
  'MoneyGraph',
  'UpgradeActions',
  'SecurityId',
  // Block id — an internal RDO address, not a fact for a player. The upgrade
  // group requests it so `enrichUpgradeTab` can bind its live AcceptCloning
  // read to it (Voyager/ManagementSheet.pas:243, :272), which is the same
  // read-but-never-show case as SecurityId above.
  'CurrBlock',
  'Trouble',
  // Owner: the header already names the society and the tycoon
  'Creator',
  'OwnerName',
]);

/** Should this property's row be rendered? */
export function isHiddenProperty(rdoName: string): boolean {
  return HIDDEN_PROPERTY_NAMES.has(rdoName);
}
