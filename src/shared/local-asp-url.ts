/**
 * `local.asp` URL translator — the map-select link a system mail page prints for each
 * building it names, e.g. a zoning alert (`MsgZoned.asp:117`):
 *   `http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=<BuildX>&y=<BuildY>`
 * Voyager routed that URL to `MoveTo(URL, true)` — centre the map on the tile and select
 * it (`MapIsoHandler.pas:309-310`). This is the client-side equivalent: parse the same
 * URL shape into `{x, y}`, or `null` for anything else. Never throws.
 */
export interface LocalAspSelect {
  x: number;
  y: number;
}

export function parseLocalAspUrl(href: string): LocalAspSelect | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.hostname.toLowerCase() !== 'local.asp') return null;

  const frameId = url.searchParams.get('frame_Id');
  const frameAction = url.searchParams.get('frame_Action');
  if (frameId?.toLowerCase() !== 'mapisoview') return null;
  if (frameAction?.toLowerCase() !== 'select') return null;

  const x = url.searchParams.get('x');
  const y = url.searchParams.get('y');
  if (!x || !y || !/^\d+$/.test(x) || !/^\d+$/.test(y)) return null;

  return { x: Number(x), y: Number(y) };
}
