/**
 * connection-reachability — the road-flag sweep behind the connection picker
 * (#584). `circuitsIntersect` mirrors `TFluidLink.Intercept`
 * (Cache/FluidLinks.pas:116-133): false when either side is empty (:121),
 * else true iff any comma-token is shared. `resolveRoadReachability` drives
 * the sweep through the fake cacher pool from `fake-session-context.ts`.
 */

import { circuitsIntersect, resolveRoadReachability, NEAR_CIRCUITS_PROP } from './connection-reachability';
import { makeSessionCtx } from '../__tests__/session/fake-session-context';

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

  it('resolves the connected/not-connected/unknown split, and closes the temp object once', async () => {
    const fake = makeSessionCtx();
    fake.cacher.createObject.mockResolvedValue('900584');
    fake.cacher.getPropertyList.mockImplementation(async (tempObjectId: string, props: string[]) => {
      expect(tempObjectId).toBe('900584');
      expect(props).toEqual([NEAR_CIRCUITS_PROP]);
      const lastSet = fake.cacher.setObject.mock.calls[fake.cacher.setObject.mock.calls.length - 1];
      const [, x, y] = lastSet;
      if (x === BUILDING.x && y === BUILDING.y) return ['12,34,'];
      if (x === 463 && y === 389) return ['34,56,'];
      if (x === 483 && y === 684) return ['78,'];
      if (x === 205 && y === 505) return [''];
      if (x === 131 && y === 298) throw new Error('no cache answer');
      throw new Error(`unexpected position (${x}, ${y})`);
    });

    const entries = await resolveRoadReachability(fake.ctx, BUILDING.x, BUILDING.y, POSITIONS);

    expect(entries.map(e => e.connected)).toEqual([true, false, false, null]);
    expect(entries.map(e => ({ x: e.x, y: e.y }))).toEqual(POSITIONS);
    expect(fake.cacher.closeObject).toHaveBeenCalledTimes(1);
    expect(fake.cacher.closeObject).toHaveBeenCalledWith('900584');

    const setCalls = fake.cacher.setObject.mock.calls.map(([, x, y]) => ({ x, y }));
    expect(setCalls).toEqual([BUILDING, ...POSITIONS]);
  });

  it('gives every entry null when the building read rejects', async () => {
    const fake = makeSessionCtx();
    fake.cacher.createObject.mockResolvedValue('900584');
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
    const fake = makeSessionCtx();
    fake.cacher.createObject.mockRejectedValue(new Error('create failed'));

    const entries = await resolveRoadReachability(fake.ctx, BUILDING.x, BUILDING.y, POSITIONS);

    expect(entries.map(e => e.connected)).toEqual([null, null, null, null]);
    expect(fake.cacher.closeObject).not.toHaveBeenCalled();
  });

  it('stops the sweep once isCurrent() goes false, and pads the rest null', async () => {
    const fake = makeSessionCtx();
    fake.cacher.createObject.mockResolvedValue('900584');
    fake.cacher.getPropertyList.mockImplementation(async () => ['12,34,']);

    // isCurrent is checked once per position, before the read: after the
    // building read (call 1) and the first candidate's read (call 2), flip
    // it, so the remaining positions never get a setObject/getPropertyList
    // call at all.
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
    expect(fake.cacher.setObject).toHaveBeenCalledTimes(2);
  });

  it('closes the temp object even when a candidate read throws mid-sweep', async () => {
    const fake = makeSessionCtx();
    fake.cacher.createObject.mockResolvedValue('900584');
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
});
