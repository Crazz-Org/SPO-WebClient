/**
 * World events handler — the newest event `PickEvent` pops off the tycoon's queue.
 *
 * `function PickEvent( TycoonId : integer ) : OleVariant;` is a published FUNCTION
 * on `TClientView` (`Interface Server/InterfaceServer.pas:166`, body `:1158-1172`),
 * already catalogued as `{ kind: 'function', arity: 1 }`
 * (`src/shared/rdo-members.ts:155`) from the two login-handshake calls. The
 * façade answers `''` whenever `fDAOK` is false or `fServerBusy` is true
 * (`InterfaceServer.pas:1161-1163`), and again `''` inside its `except`
 * (`:1165-1170`) — AN EMPTY ANSWER IS NEVER AN ERROR, it is "no event", "backup
 * running", or "DA down", indistinguishable and all normal.
 *
 * `TWorld.RDOPickEvent` pops one event off the tycoon's queue and returns
 * `TEvent.Render`, `''` for an empty queue (`Kernel/World.pas:4840-4871`). The
 * pop is destructive and single-shot (`TTycoon.PickEvent`,
 * `Kernel/Kernel.pas:11255-11271`) — an answer nobody reads is an event lost
 * for good, which is why this must never be polled while the tab is hidden.
 *
 * `TEvent.Render` is a `TStringList.Text`, a CRLF-separated `Name=Value` block
 * (`Kernel/Events.pas:99-115`) with keys `Date`, `Kind`, `URL` and one `Text<n>`
 * per language index (`Protocol/Protocol.pas:384-387`). `Date` is `DateToStr`,
 * locale-formatted server-side — passed through verbatim, never reparsed.
 */

import type { SessionContext } from './session-context';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { parsePropertyResponse } from '../rdo-helpers';
import { toErrorMessage } from '../../shared/error-utils';
import { extractMapCoords } from '../asp-url-extractor';
import type { WorldEventLine } from '../../shared/types';

/**
 * The façade's exception answer is the integer `ERROR_Unknown`, same shape as
 * `ContextStatusText` (`InterfaceServer.pas:840`); any `#`-prefixed result is a
 * code, never a rendered block.
 */
const ERROR_CODE_ANSWER = /(?:^|[\s,])res\s*=\s*"#/;

/** `evnKind_FacEvent = 1` (`Kernel/BasicEvents.pas:9`). */
const DEFAULT_KIND = 0;

function parseEventBlock(block: string, languageId: string): { date?: string; kind: number; url?: string; text?: string } {
  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    fields[key] = value;
  }

  const text = fields[`Text${languageId}`] ?? fields.Text0;
  const kind = fields.Kind !== undefined ? parseInt(fields.Kind, 10) : DEFAULT_KIND;

  return {
    date: fields.Date,
    kind: Number.isNaN(kind) ? DEFAULT_KIND : kind,
    url: fields.URL,
    text,
  };
}

/**
 * The newest world event, or `null` when there is none — a backup running,
 * the DA down, or the queue is simply empty. Never rejects: a browser polling
 * this every 45 s must not turn a failed read into a notification.
 */
export async function pickWorldEvent(ctx: SessionContext): Promise<WorldEventLine | null> {
  if (!ctx.worldContextId || !ctx.tycoonId) return null;

  try {
    // FAST (60 s, the legacy proxy DefTimeOut): a decoration re-asked every
    // 45 s must not hold a request slot for the NORMAL 180 s deadline.
    const packet = await ctx.sendRdoRequest('world', rdoCall(
      'PickEvent', ctx.worldContextId,
      RdoValue.int(parseInt(ctx.tycoonId, 10)),
    ).packet, undefined, TimeoutCategory.FAST);

    const payload = packet.payload || '';
    if (ERROR_CODE_ANSWER.test(payload)) {
      ctx.log.debug('[WorldEvent] Server answered an error code, not a block');
      return null;
    }

    const block = parsePropertyResponse(payload, 'res');
    if (!block.trim()) return null;

    const { date, kind, url, text } = parseEventBlock(block, ctx.languageId);
    if (!text?.trim() && !date?.trim()) return null;

    const event: WorldEventLine = {
      date: date ?? '',
      kind,
      text: text ?? '',
    };

    if (url) {
      const coords = extractMapCoords(url);
      if (coords) {
        event.x = coords.x;
        event.y = coords.y;
      }
    }

    return event;
  } catch (err: unknown) {
    ctx.log.debug(`[WorldEvent] Read failed, showing nothing: ${toErrorMessage(err)}`);
    return null;
  }
}
