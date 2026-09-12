/**
 * The legal arguments of `RDOSetRole` and `RDOSetTradeLevel`.
 *
 * Neither member range-checks on the server — `TWarehouse.RDOSetRole`
 * (StdBlocks/Warehouses.pas:527) and `TBlock.RDOSetTradeLevel`
 * (Kernel/Kernel.pas:6408) assign what they are handed — so the only thing that
 * keeps an illegal value off the wire is the set of options the client offers.
 * The reference client offered three of each, and those three are declared here
 * once, for the control and the L1 scenario both.
 */

/** One option of a trade control: the argument sent, and what the player reads. */
export interface TradeOption {
  value: number;
  label: string;
}

/**
 * The three items of Voyager's `cbMode`, in its own order — the combo is shown
 * only when the current role is one of them (`Voyager/IndustryGeneralSheet.pas:189-235`)
 * and each item sends its value to `RDOSetRole` (`cbModeChange`, `:478-482`).
 * Captions are the DFM strings (`Voyager/IndustryGeneralSheet.dfm`).
 */
export const TRADE_MODES: readonly TradeOption[] = [
  { value: 2, label: 'Company Warehouse' },
  { value: 5, label: 'Exporter' },
  { value: 6, label: 'Importer' },
];

/** The three `RDOSetRole` arguments, in option order. */
export const TRADE_MODE_VALUES: readonly number[] = TRADE_MODES.map((m) => m.value);

/**
 * Is this the role of a facility that gets the mode combo at all?
 *
 * Anything else — 0, 1, 3, 4, or a value that does not parse — is Voyager's
 * hidden `cbMode`: the facility has a role, but not one the player may change.
 */
export function isTradeModeValue(raw: string): boolean {
  const parsed = parseInt(raw, 10);
  return !isNaN(parsed) && TRADE_MODE_VALUES.includes(parsed);
}

/** The label of a role the mode combo carries, or the raw value if it has none. */
export function tradeModeLabel(raw: string): string {
  const parsed = parseInt(raw, 10);
  return TRADE_MODES.find((m) => m.value === parsed)?.label ?? raw;
}

/**
 * The three items of Voyager's `cbTrade` (`cbTradeChange`,
 * `Voyager/IndustryGeneralSheet.pas:455-462`; identical in
 * `Voyager/WHGeneralSheet.pas:549-568`). `1` (`tlvPupil`) is not among them —
 * the combo cannot express it, so it can never be sent.
 */
export const TRADE_LEVEL_VALUES: readonly number[] = [0, 2, 3];

/** Captions of items 1 and 2 (`Voyager/IndustryGeneralSheet.dfm`). */
const TRADE_LEVEL_LABELS: Readonly<Record<number, string>> = {
  2: 'Allies only',
  3: 'Anyone',
};

/**
 * The three options, with item 0 carrying the facility owner's name —
 * `cbTrade.Items[0] := GetFormattedLiteral('Literal33', [Creator.Caption])`
 * (`IndustryGeneralSheet.pas:223`).
 */
export function tradeLevelOptions(ownerName: string): TradeOption[] {
  return TRADE_LEVEL_VALUES.map((value) => ({
    value,
    label: TRADE_LEVEL_LABELS[value] ?? `Only ${ownerName}`,
  }));
}

/**
 * The option a stored level selects.
 *
 * `1` is `tlvPupil`, which the combo has no item for: Voyager selects item 0 for
 * it (`IndustryGeneralSheet.pas:226`), so it reads as the owner-only level.
 */
export function tradeLevelToOption(raw: string): number | undefined {
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) return undefined;
  if (parsed === 1) return 0;
  return TRADE_LEVEL_VALUES.includes(parsed) ? parsed : undefined;
}

/** What a visitor reads in place of the combo; the raw value if it is unknown. */
export function tradeLevelLabel(raw: string, ownerName: string): string {
  const option = tradeLevelToOption(raw);
  if (option === undefined) return raw;
  return TRADE_LEVEL_LABELS[option] ?? `Only ${ownerName}`;
}
