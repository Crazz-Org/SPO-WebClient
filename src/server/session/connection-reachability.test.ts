/**
 * connection-reachability — the road-flag sweep behind the connection picker
 * (#584). `circuitsIntersect` mirrors `TFluidLink.Intercept`
 * (Cache/FluidLinks.pas:116-133): false when either side is empty (:121),
 * else true iff any comma-token is shared. `resolveRoadReachability` drives
 * the sweep through the fake context: `SetObject` goes out on the `"^"`
 * channel (the sweep reads its boolean answer itself), `GetPropertyList`
 * through the fake cacher pool.
 *
 * The `SetObject` answers here are the server's own, not a throwing mock: a
 * position that loads nothing answers `res="#0"`
 * (`Cache Server/CachedObjectWrap.pas:127-139`) and the cache then answers `''`
 * for every property on the released object (`:209-235`) — which is exactly the
 * case that must read `unknown` and not `not connected`.
 */

import { circuitsIntersect, resolveRoadReachability, NEAR_CIRCUITS_PROP } from './connection-reachability';
import { makeSessionCtx, type FakeSessionCtx } from '../__tests__/session/fake-session-context';
import type { RdoPacket } from '../../shared/types';

describe('circuitsIntersect', () => {
  it.each([
    ['12,34,', '34,56,', true],
    ['12,', '78,', false],
    ['', '1,', false],
    ['1,', '', false],
    ['', '', false],
  ])('(%s, %s) -> %s', (a, b, expected) => {
    expect(circuitsIntersect(a, b)).toBe(expected);
  });
});

describe('resolveRoadReachability', () => {
  const BUILDING = { x: 459, y: 389 };
  const POSITIONS = [
    { x: 463, y: 389 },
    { x: 483, y: 684 },
    { x: 205, y: 505 },
    { x: 131, y: 298 },
  ];

  /** The (x, y) of every `SetObject` frame the sweep put on the wire, in order. */
  function setObjectCalls(fake: FakeSessionCtx): Array<{ x: number; y: number }> {
    return fake.sent
      .filter(s => s.packet.member === 'SetObject')
      .map(s => ({
        x: parseInt((s.packet.args?.[0] ?? '').replace(/[^\d-]/g, ''), 10),
        y: parseInt((s.packet.args?.[1] ?? '').replace(/[^\d-]/g, ''), 10),
      }));
  }

  /** The position the last `SetObject` frame addressed — what the cache now holds. */
  function lastSetObject(fake: FakeSessionCtx): { x: number; y: number } {
    const calls = setObjectCalls(fake);
    return calls[calls.length - 1];
  }

  /**
   * A fake whose `SetObject` answers `#-1` everywhere except the positions in
   * `unloadable`, which answer `#0` as the cache server does for an empty block.
   */
  function makeFake(unloadable: Array<{ x: number; y: number }> = []): FakeSessionCtx {
    const fake = makeSessionCtx();
    fake.cacher.createObject.mockResolvedValue('900584');
    fake.respond((packet: Partial<RdoPacket>) => {
      if (packet.member !== 'SetObject') return '';
      const x = parseInt((packet.args?.[0] ?? '').replace(/[^\d-]/g, ''), 10);
      const y = parseInt((packet.args?.[1] ?? '').replace(/[^\d-]/g, ''), 10);
      const loads = !unloadable.some(p => p.x === x && p.y === y);
      return loads ? 'res="#-1"' : 'res="#0"';
    });
    return fake;
  }

  it('resolves the connected/not-connected/unknown split, and closes the temp object once', async () => {
    // The fourth position holds no facility: SetObject answers #0.
    const fake = makeFake([POSITIONS[3]]);
    fake.cacher.getPropertyList.mockImplementation(async (tempObjectId: string, props: string[]) => {
      expect(tempObjectId).toBe('900584');
      expect(props).toEqual([NEAR_CIRCUITS_PROP]);
      const { x, y } = lastSetObject(fake);
      if (x === BUILDING.x && y === BUILDING.y) return ['12,34,'];
      if (x === 463 && y === 389) return ['34,56,'];
      if (x === 483 && y === 684) return ['78,'];
      if (x === 205 && y === 505) return [''];
      throw new Error(`unexpected read at (${x}, ${y})`);
    });

    const entries = await resolveRoadReachability(fake.ctx, BUILDING.x, BUILDING.y, POSITIONS);

    expect(entries.map(e => e.connected)).toEqual([true, false, false, null]);
    expect(entries.map(e => ({ x: e.x, y: e.y }))).toEqual(POSITIONS);
    expect(fake.cacher.closeObject).toHaveBeenCalledTimes(1);
    expect(fake.cacher.closeObject).toHaveBeenCalledWith('900584');

    expect(setObjectCalls(fake)).toEqual([BUILDING, ...POSITIONS]);
    // The unloadable position is never read: the cache would answer '' on the
    // released object, which is not the same thing as "no circuits".
    expect(fake.cacher.getPropertyList).toHaveBeenCalledTimes(4);
  });

  it('gives the unloadable candidate null even though the cache would answer an empty string', async () => {
    const fake = makeFake([POSITIONS[0]]);
    // Exactly what CachedObjectWrap.GetPropertyList answers on a released
    // object (:209-235) — the sweep must never reach it for that position.
    fake.cacher.getPropertyList.mockResolvedValue(['12,34,']);

    const entries = await resolveRoadReachability(fake.ctx, BUILDING.x, BUILDING.y, [POSITIONS[0], POSITIONS[1]]);

    expect(entries.map(e => e.connected)).toEqual([null, true]);
  });

  it('gives every entry null when the building itself loads nothing', async () => {
    const fake = makeFake([BUILDING]);
    fake.cacher.getPropertyList.mockResolvedValue(['12,34,']);

    const entries = await resolveRoadReachability(fake.ctx, BUILDING.x, BUILDING.y, POSITIONS);

    expect(entries.map(e => e.connected)).toEqual([null, null, null, null]);
    expect(fake.cacher.getPropertyList).not.toHaveBeenCalled();
    expect(fake.cacher.closeObject).toHaveBeenCalledTimes(1);
  });

  it('gives every entry null when the building read rejects', async () => {
    const fake = makeFake();
    fake.cacher.getPropertyList.mockRejectedValue(new Error('building read failed'));

    const entries = await resolveRoadReachability(fake.ctx, BUILDING.x, BUILDING.y, POSITIONS);

    expect(entries.map(e => e.connected)).toEqual([null, null, null, null]);
    expect(fake.cacher.closeObject).toHaveBeenCalledTimes(1);
  });

  it('gives every entry null when cacherId is missing', async () => {
    const fake = makeSessionCtx({ cacherId: null });

    const entries = await resolveRoadReachability(fake.ctx, BUILDING.x, BUILDING.y, POSITIONS);

    expect(entries.map(e => e.connected)).toEqual([null, null, null, null]);
    expect(fake.cacher.createObject).not.toHaveBeenCalled();
  });

  it('gives every entry null when CreateObject itself rejects', async () => {
    const fake = makeFake();
    fake.cacher.createObject.mockRejectedValue(new Error('create failed'));

    const entries = await resolveRoadReachability(fake.ctx, BUILDING.x, BUILDING.y, POSITIONS);

    expect(entries.map(e => e.connected)).toEqual([null, null, null, null]);
    expect(fake.cacher.closeObject).not.toHaveBeenCalled();
  });

  it('stops the sweep once isCurrent() goes false, and pads the rest null', async () => {
    const fake = makeFake();

    // isCurrent is checked once per position, before the read: after the
    // building read (call 1) and the first candidate's read (call 2), flip
    // it, so the remaining positions never get a SetObject frame at all.
    let calls = 0;
    let current = true;
    fake.cacher.getPropertyList.mockImplementation(async () => {
      calls += 1;
      if (calls === 2) current = false;
      return ['12,34,'];
    });

    const entries = await resolveRoadReachability(fake.ctx, BUILDING.x, BUILDING.y, POSITIONS, () => current);

    expect(entries.map(e => e.connected)).toEqual([true, null, null, null]);
    // Building + first candidate only.
    expect(setObjectCalls(fake)).toEqual([BUILDING, POSITIONS[0]]);
  });

  it('closes the temp object even when a candidate read throws mid-sweep', async () => {
    const fake = makeFake();
    let callIndex = 0;
    fake.cacher.getPropertyList.mockImplementation(async () => {
      callIndex += 1;
      if (callIndex === 1) return ['12,34,'];
      throw new Error('boom');
    });

    const entries = await resolveRoadReachability(fake.ctx, BUILDING.x, BUILDING.y, POSITIONS);

    expect(entries.map(e => e.connected)).toEqual([null, null, null, null]);
    expect(fake.cacher.closeObject).toHaveBeenCalledTimes(1);
  });

  it('gives every entry null when the SetObject frame itself rejects', async () => {
    const fake = makeFake();
    fake.respond(() => new Error('socket gone'));

    const entries = await resolveRoadReachability(fake.ctx, BUILDING.x, BUILDING.y, POSITIONS);

    expect(entries.map(e => e.connected)).toEqual([null, null, null, null]);
  });
});
