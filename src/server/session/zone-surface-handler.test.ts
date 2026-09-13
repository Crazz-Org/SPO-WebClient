/**
 * zone-surface-handler — `DefineZone` and `GetSurface` on the `world` socket.
 *
 * Both members are Delphi FUNCTIONS (they answer `res="…"`), so both go through
 * `sendRdoRequest` with `"^"` and a QueryId. What the tests pin is the target
 * (`worldContextId`, never the tycoon or the cacher), the argument order and
 * type prefix, and — the bulk of the file — the RLE decoder behind
 * `getSurfaceData`, which is only reachable through the public function.
 *
 * RLE format (parseRLEResponse / decodeRLERow): `%width:height:row,:row,:…`,
 * a row being `value=count,value=count`; Delphi CompressMap scales by 1000
 * before encoding, the decoder divides it back.
 */

import { defineZone, getSurfaceData } from './zone-surface-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import { RdoValue } from '../../shared/rdo-types';
import { RdoVerb, RdoAction, SurfaceType } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';

// ===========================================================================
// defineZone
// ===========================================================================

describe('defineZone', () => {
  it('sends DefineZone to the world context with tycoonId first, then zone and normalised bounds', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');

    const result = await defineZone(fake.ctx, 3, 10, 20, 30, 40);

    expect(fake.sent).toHaveLength(1);
    const [req] = fake.sent;
    expect(req.socketName).toBe('world');
    expect(req.category).toBe(TimeoutCategory.SLOW);
    expect(req.packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: FAKE_CONTEXT_IDS.worldContextId,
      action: RdoAction.CALL,
      member: 'DefineZone',
      separator: '"^"',
      args: [
        RdoValue.int(parseInt(FAKE_CONTEXT_IDS.tycoonId, 10)).format(),
        RdoValue.int(3).format(),
        RdoValue.int(10).format(),
        RdoValue.int(20).format(),
        RdoValue.int(30).format(),
        RdoValue.int(40).format(),
      ],
    });
    expect(result).toEqual({ success: true });
  });

  it('normalises inverted corners so (x1,y1) is always the min and (x2,y2) the max', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');

    await defineZone(fake.ctx, 1, 30, 40, 10, 20);

    const args = fake.sent[0].packet.args ?? [];
    // slot 0 is the tycoon id, slot 1 the zone id
    expect(args.slice(2)).toEqual([
      RdoValue.int(10).format(),
      RdoValue.int(20).format(),
      RdoValue.int(30).format(),
      RdoValue.int(40).format(),
    ]);
  });

  it('treats an empty payload (no result code) as a refusal', async () => {
    const fake = makeSessionCtx();
    // default responder: empty payload
    const result = await defineZone(fake.ctx, 1, 0, 0, 1, 1);
    expect(result).toEqual({
      success: false,
      message: 'Zone definition failed — the server sent no result code',
      errorCode: -1,
    });
  });

  it('refuses with res="#1" (ERROR_Unknown), naming the code', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#1"');

    const result = await defineZone(fake.ctx, 1, 0, 0, 1, 1);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(1);
    expect(result.message).toMatch(/code 1/);
    expect(result.message).toMatch(/unknown/i);
    expect(fake.log.warn).toHaveBeenCalled();
  });

  it('accepts with res="#0" (NOERROR)', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');

    const result = await defineZone(fake.ctx, 1, 0, 0, 1, 1);

    expect(result).toEqual({ success: true });
  });

  it('names an uncommon code via getErrorMessage, e.g. res="#15" (ERROR_AccessDenied)', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#15"');

    const result = await defineZone(fake.ctx, 1, 0, 0, 1, 1);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(15);
    expect(result.message).toMatch(/access denied/i);
    expect(result.message).toMatch(/code 15/);
  });

  it('refuses without a world context and emits nothing', async () => {
    const fake = makeSessionCtx({ worldContextId: null });
    await expect(defineZone(fake.ctx, 1, 0, 0, 1, 1)).rejects.toThrow('Not logged into world - cannot define zone');
    expect(fake.sent).toHaveLength(0);
  });

  it('refuses without a tycoon id and emits nothing', async () => {
    const fake = makeSessionCtx({ tycoonId: null });
    await expect(defineZone(fake.ctx, 1, 0, 0, 1, 1)).rejects.toThrow('No tycoon ID - cannot define zone');
    expect(fake.sent).toHaveLength(0);
  });

  it('propagates a request timeout unchanged', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => new Error('Request timeout: DefineZone'));
    await expect(defineZone(fake.ctx, 1, 0, 0, 1, 1)).rejects.toThrow('Request timeout: DefineZone');
  });
});

// ===========================================================================
// getSurfaceData — wire form
// ===========================================================================

describe('getSurfaceData — request', () => {
  it('sends GetSurface to the world context with the surface type as a string then the four bounds', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%2:1:0=2,"');

    await getSurfaceData(fake.ctx, SurfaceType.POLLUTION, 5, 6, 7, 8);

    expect(fake.sent).toHaveLength(1);
    const [req] = fake.sent;
    expect(req.socketName).toBe('world');
    expect(req.category).toBe(TimeoutCategory.NORMAL);
    expect(req.packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: FAKE_CONTEXT_IDS.worldContextId,
      action: RdoAction.CALL,
      member: 'GetSurface',
      separator: '"^"',
      args: [
        RdoValue.string(SurfaceType.POLLUTION).format(),
        RdoValue.int(5).format(),
        RdoValue.int(6).format(),
        RdoValue.int(7).format(),
        RdoValue.int(8).format(),
      ],
    });
  });

  it('refuses without a world context and emits nothing', async () => {
    const fake = makeSessionCtx({ worldContextId: null });
    await expect(getSurfaceData(fake.ctx, SurfaceType.POLLUTION, 0, 0, 1, 1)).rejects.toThrow('Not logged into world - cannot get surface data');
    expect(fake.sent).toHaveLength(0);
  });

  it('propagates a request timeout unchanged', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => new Error('Request timeout: GetSurface'));
    await expect(getSurfaceData(fake.ctx, SurfaceType.POLLUTION, 0, 0, 1, 1)).rejects.toThrow('Request timeout: GetSurface');
  });
});

// ===========================================================================
// getSurfaceData — RLE decoding (parseRLEResponse + decodeRLERow)
// ===========================================================================

describe('getSurfaceData — RLE decoding', () => {
  async function decode(payload: string) {
    const fake = makeSessionCtx();
    fake.respond(() => payload);
    const data = await getSurfaceData(fake.ctx, SurfaceType.POLLUTION, 0, 0, 3, 3);
    return { data, fake };
  }

  it('decodes a single run into a row and divides by the Delphi Scale of 1000', async () => {
    const { data } = await decode('res="%3:1:2000=3,"');
    expect(data).toEqual({ width: 3, height: 1, rows: [[2, 2, 2]] });
  });

  it('decodes several runs in one row and several rows, in order', async () => {
    const { data } = await decode('res="%3:2:1000=1,500=2,:0=3,"');
    expect(data).toEqual({ width: 3, height: 2, rows: [[1, 0.5, 0.5], [0, 0, 0]] });
  });

  it('accepts a payload without the res=" wrapper and without the % prefix', async () => {
    const { data } = await decode('2:1:1000=2,');
    expect(data).toEqual({ width: 2, height: 1, rows: [[1, 1]] });
  });

  it('skips a wholly empty row segment (":,:" or trailing ":")', async () => {
    // three segments after the dimensions: an empty one, a real one, an empty trailing one
    const { data } = await decode('res="%1:3::1000=1,:"');
    expect(data.rows).toEqual([[1]]);
    expect(data.height).toBe(3);
  });

  it('ignores a truncated run that has no "=" and keeps the well-formed ones', async () => {
    const { data } = await decode('res="%3:1:1000=2,500,"');
    expect(data.rows).toEqual([[1, 1]]);
  });

  it('does not reconcile a row whose run count differs from the announced width', async () => {
    // width says 4, the run only yields 2 cells: the decoder reports what it got
    const { data } = await decode('res="%4:1:1000=2,"');
    expect(data.width).toBe(4);
    expect(data.rows).toEqual([[1, 1]]);
  });

  it('returns an empty surface and warns when the payload has fewer than three fields', async () => {
    const { data, fake } = await decode('res="%3:1"');
    expect(data).toEqual({ width: 0, height: 0, rows: [] });
    expect(fake.log.warn).toHaveBeenCalledWith('[Surface] Invalid RLE response format');
  });

  it('returns an empty surface and warns on an empty payload', async () => {
    const { data, fake } = await decode('');
    expect(data).toEqual({ width: 0, height: 0, rows: [] });
    expect(fake.log.warn).toHaveBeenCalledWith('[Surface] Invalid RLE response format');
  });

  it('yields NaN dimensions rather than throwing when the header is not numeric', async () => {
    const { data } = await decode('res="%a:b:1000=1,"');
    expect(Number.isNaN(data.width)).toBe(true);
    expect(Number.isNaN(data.height)).toBe(true);
    expect(data.rows).toEqual([[1]]);
  });
});
