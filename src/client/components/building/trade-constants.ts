/**
 * The top of both price sliders — a product's sale price (`PricePc`) and an
 * input's maximum price (`MaxPrice`). The reference client's two controls are
 * both `TPercentEdit` with `MaxPerc` 400: `PricePc` at
 * Voyager/ProdSheetForm.dfm:37 and `xfer_MaxPrice` at
 * Voyager/SupplySheetForm.dfm:60 — so one bound serves both.
 */
export const PRICE_PERCENT_MAX = 400;

/**
 * The `TFacilityRole` values for which Voyager sets `IsInd := true` —
 * rolNeutral (0), rolProducer (1), rolBuyer (3), rolImporter (4)
 * (Voyager/IndustryGeneralSheet.pas:190-196; enum order per the comment at
 * Kernel/Kernel.pas:2862). Strings, because they are compared with the raw
 * `TradeRole` property value.
 */
export const NON_WAREHOUSE_TRADE_ROLES: readonly string[] = ['0', '1', '3', '4'];
