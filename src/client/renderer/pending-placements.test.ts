import { PendingPlacementLayer, pendingPlacementKey, PENDING_PLACEMENT_TTL_MS } from './pending-placements';

const CLIENT_REQUEST_DEADLINE_MS = 200_000; // client.ts:638

function makePlacement(x: number, y: number, startedAt: number) {
  return { x, y, visualClass: 'V1', xsize: 1, ysize: 1, startedAt };
}

describe('PendingPlacementLayer', () => {
  it('stores one entry per placement, keyed by "x,y"', () => {
    const layer = new PendingPlacementLayer();
    const key = layer.add(makePlacement(3, 4, 0));
    expect(key).toBe('3,4');
    expect(layer.size).toBe(1);
  });

  it('holds two entries for two different tiles', () => {
    const layer = new PendingPlacementLayer();
    layer.add(makePlacement(1, 1, 0));
    layer.add(makePlacement(2, 2, 0));
    expect(layer.size).toBe(2);
    expect(layer.list(0)).toHaveLength(2);
  });

  it('replaces the entry at the same tile — never two overlapping placements', () => {
    const layer = new PendingPlacementLayer();
    layer.add(makePlacement(5, 5, 0));
    layer.add(makePlacement(5, 5, 10));
    expect(layer.size).toBe(1);
    expect(layer.list(10)[0].startedAt).toBe(10);
  });

  it('remove clears the layer — the success and failure path', () => {
    const layer = new PendingPlacementLayer();
    const key = layer.add(makePlacement(1, 1, 0));
    expect(layer.remove(key)).toBe(true);
    expect(layer.size).toBe(0);
  });

  it('remove of an unknown key returns false and changes nothing', () => {
    const layer = new PendingPlacementLayer();
    layer.add(makePlacement(1, 1, 0));
    expect(layer.remove('9,9')).toBe(false);
    expect(layer.size).toBe(1);
  });

  it('prunes an entry past its TTL — the timeout path', () => {
    const layer = new PendingPlacementLayer(100);
    layer.add(makePlacement(1, 1, 0));
    expect(layer.list(100)).toEqual([]);
    expect(layer.size).toBe(0);
  });

  it('keeps an entry just under its TTL', () => {
    const layer = new PendingPlacementLayer(100);
    layer.add(makePlacement(1, 1, 0));
    expect(layer.list(99)).toHaveLength(1);
    expect(layer.size).toBe(1);
  });

  it('clear empties the layer', () => {
    const layer = new PendingPlacementLayer();
    layer.add(makePlacement(1, 1, 0));
    layer.add(makePlacement(2, 2, 0));
    layer.clear();
    expect(layer.size).toBe(0);
  });

  it('nextExpiry is null for an empty layer', () => {
    expect(new PendingPlacementLayer(100).nextExpiry()).toBeNull();
  });

  it('nextExpiry is the oldest entry\'s startedAt + TTL', () => {
    const layer = new PendingPlacementLayer(100);
    layer.add(makePlacement(1, 1, 50));
    layer.add(makePlacement(2, 2, 20));
    layer.add(makePlacement(3, 3, 70));
    expect(layer.nextExpiry()).toBe(120);
  });

  it('nextExpiry moves forward after remove and after a prune', () => {
    const layer = new PendingPlacementLayer(100);
    layer.add(makePlacement(1, 1, 0));
    layer.add(makePlacement(2, 2, 30));
    layer.add(makePlacement(3, 3, 60));
    layer.remove('1,1');
    expect(layer.nextExpiry()).toBe(130);
    layer.list(130); // prunes 2,2
    expect(layer.nextExpiry()).toBe(160);
    layer.list(160);
    expect(layer.nextExpiry()).toBeNull();
  });

  it('pendingPlacementKey formats "x,y"', () => {
    expect(pendingPlacementKey(3, 4)).toBe('3,4');
  });

  it('the TTL outlives the client request deadline (client.ts:638) so the request always clears first', () => {
    expect(PENDING_PLACEMENT_TTL_MS).toBeGreaterThan(CLIENT_REQUEST_DEADLINE_MS);
  });
});
