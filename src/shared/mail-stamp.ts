/**
 * Mail stamp index — picture chosen by `stamp mod 15`, as the reference client
 * derives it (MessageHeader.asp:167-169, GetStamp = "images/stamp" & (Stamp mod 15) & ".jpg").
 */

export const MAIL_STAMP_COUNT = 15; // MessageHeader.asp:168 — stamp0.jpg … stamp14.jpg

/**
 * `stamp mod 15`, as MessageHeader.asp:167-169. Anything that is not a
 * non-negative finite integer (missing header, a non-numeric header parsed to
 * `NaN`, `NaN` turned into `null` once JSON-serialised) falls back to 0.
 */
export function mailStampIndex(stamp: number | null | undefined): number {
  return Number.isInteger(stamp) && (stamp as number) >= 0 ? (stamp as number) % MAIL_STAMP_COUNT : 0;
}

/** Path of the stamp picture under the world's IIS root, for `toProxyUrl(path, worldIp)`. */
export function mailStampPath(stamp: number | null | undefined): string {
  return `/Five/0/Visual/Voyager/Mail/images/stamp${mailStampIndex(stamp)}.jpg`;
}
