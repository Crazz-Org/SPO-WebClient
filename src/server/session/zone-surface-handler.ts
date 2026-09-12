/**
 * Zone & Surface handler — extracted from StarpeaceSession.
 *
 * Public functions: defineZone, getSurfaceData
 * Module-private helpers: parseRLEResponse, decodeRLERow
 */

import type { SessionContext } from './session-context';
import type { SurfaceData, SurfaceType } from '../../shared/types';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { parseResultCode } from '../rdo-helpers';
import { NOERROR, getErrorMessage } from '../../shared/error-codes';

// =========================================================================
// PUBLIC — defineZone
// =========================================================================

export async function defineZone(
  ctx: SessionContext,
  zoneId: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Promise<{ success: boolean; message?: string }> {
  if (!ctx.worldContextId) {
    throw new Error('Not logged into world - cannot define zone');
  }
  if (!ctx.tycoonId) {
    throw new Error('No tycoon ID - cannot define zone');
  }

  // Normalize coordinates (ensure min/max)
  const nx1 = Math.min(x1, x2);
  const ny1 = Math.min(y1, y2);
  const nx2 = Math.max(x1, x2);
  const ny2 = Math.max(y1, y2);

  ctx.log.debug(`[Zone] Defining zone ${zoneId} from (${nx1},${ny1}) to (${nx2},${ny2})`);

  const packet = await ctx.sendRdoRequest('world', rdoCall(
    'DefineZone', ctx.worldContextId,
    RdoValue.int(parseInt(ctx.tycoonId, 10)),
    RdoValue.int(zoneId),
    RdoValue.int(nx1),
    RdoValue.int(ny1),
    RdoValue.int(nx2),
    RdoValue.int(ny2),
  ).packet, undefined, TimeoutCategory.SLOW);

  // RDODefineZone answers res="#<TErrorCode>": NOERROR (0) once the rectangle
  // was walked (Kernel/World.pas:4568), ERROR_Unknown (1) when the tycoon is
  // not found or an exception fires (:4581, :4583). A per-tile guard failure
  // inside the walk is skipped silently (:4544-4546), so NOERROR only means
  // "processed", never "every tile was zoned".
  const resultCode = parseResultCode(packet.payload);

  if (resultCode !== NOERROR) {
    ctx.log.warn(`[Zone] DefineZone refused by server, code ${resultCode}`);
    return {
      success: false,
      message: `Zone definition refused by the server: ${getErrorMessage(resultCode)} (error ${resultCode})`,
    };
  }

  ctx.log.debug('[Zone] DefineZone accepted by server');
  return { success: true };
}

// =========================================================================
// PUBLIC — getSurfaceData
// =========================================================================

/**
 * Request surface data (zones, pollution, etc.) for a map area.
 * Uses RLE (Run-Length Encoding) compression for efficient transmission.
 */
export async function getSurfaceData(
  ctx: SessionContext,
  surfaceType: SurfaceType,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Promise<SurfaceData> {
  if (!ctx.worldContextId) {
    throw new Error('Not logged into world - cannot get surface data');
  }

  ctx.log.debug(`[Surface] Requesting ${surfaceType} data for area (${x1},${y1}) to (${x2},${y2})`);

  const packet = await ctx.sendRdoRequest('world', rdoCall(
    'GetSurface', ctx.worldContextId,
    RdoValue.string(surfaceType),
    RdoValue.int(x1), RdoValue.int(y1), RdoValue.int(x2), RdoValue.int(y2),
  ).packet, undefined, TimeoutCategory.NORMAL);

  return parseRLEResponse(ctx, packet.payload || '');
}

// =========================================================================
// MODULE-PRIVATE — parseRLEResponse
// =========================================================================

/**
 * Parse RLE-encoded surface response.
 * Format: res="%width:height:row1_data,:row2_data,:..."
 */
function parseRLEResponse(ctx: SessionContext, response: string): SurfaceData {
  // Extract data after 'res="' or just use the response directly
  let data = response;
  const dataMatch = response.match(/res="([^"]+)"/);
  if (dataMatch) {
    data = dataMatch[1];
  }

  // Remove leading '%' if present
  if (data.startsWith('%')) {
    data = data.substring(1);
  }

  const parts = data.split(':');

  if (parts.length < 3) {
    ctx.log.warn('[Surface] Invalid RLE response format');
    return { width: 0, height: 0, rows: [] };
  }

  // Parse dimensions
  const width = parseInt(parts[0], 10);
  const height = parseInt(parts[1], 10);

  // Parse rows (skip first two parts which are dimensions)
  const rows: number[][] = [];
  for (let i = 2; i < parts.length; i++) {
    const rowData = parts[i].replace(/^,/, ''); // Remove leading comma
    if (rowData) {
      rows.push(decodeRLERow(rowData));
    }
  }

  ctx.log.debug(`[Surface] Parsed surface data: ${width}x${height}, ${rows.length} rows`);
  return { width, height, rows };
}

// =========================================================================
// MODULE-PRIVATE — decodeRLERow (pure, no ctx needed)
// =========================================================================

/**
 * Decode a single RLE-encoded row.
 * Format: "value1=count1,value2=count2,..."
 *
 * Delphi CompressMap multiplies all values by Scale=1000 before encoding.
 * We divide by 1000 here to restore original values, matching Delphi DecompressMap.
 */
function decodeRLERow(encodedRow: string): number[] {
  const cells: number[] = [];
  const segments = encodedRow.split(',');

  for (const segment of segments) {
    if (!segment) continue;

    const parts = segment.split('=');
    if (parts.length === 2) {
      const scaledValue = parseInt(parts[0], 10);
      const count = parseInt(parts[1], 10);
      // Delphi CompressMap uses Scale=1000; divide to restore original values
      const value = scaledValue / 1000;

      for (let i = 0; i < count; i++) {
        cells.push(value);
      }
    }
  }

  return cells;
}
