import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { PendingPlacementLayer, pendingPlacementKey, PENDING_PLACEMENT_TTL_MS } from './pending-placement-layer';

function makePlacement(x: number, y: number) {
  return { x, y, xsize: 2, ysize: 2, visualClass: '123', fallbackIconUrl: 'icon.gif' };
}

describe('PendingPlacementLayer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keys entries as `${x},${y}` and holds one entry per tile', () => {
    const onChange = jest.fn();
    const layer = new PendingPlacementLayer(onChange);
    const key = layer.add(makePlacement(10, 20));
    expect(key).toBe(pendingPlacementKey(10, 20));
    expect(layer.size).toBe(1);
    expect(layer.has(key)).toBe(true);
    expect(layer.entries()).toEqual([makePlacement(10, 20)]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a second add at the same tile replaces the entry rather than duplicating it', () => {
    const layer = new PendingPlacementLayer(jest.fn());
    layer.add(makePlacement(5, 5));
    layer.add({ ...makePlacement(5, 5), visualClass: '999' });
    expect(layer.size).toBe(1);
    expect(layer.entries()[0].visualClass).toBe('999');
  });

  it('remove clears the entry and notifies once, and reports whether it removed anything', () => {
    const onChange = jest.fn();
    const layer = new PendingPlacementLayer(onChange);
    const key = layer.add(makePlacement(1, 1));
    onChange.mockClear();
    expect(layer.remove(key)).toBe(true);
    expect(layer.size).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(layer.remove(key)).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('advancing past the TTL drops the entry and notifies', () => {
    const onChange = jest.fn();
    const layer = new PendingPlacementLayer(onChange);
    const key = layer.add(makePlacement(2, 3));
    onChange.mockClear();
    jest.advanceTimersByTime(PENDING_PLACEMENT_TTL_MS);
    expect(layer.has(key)).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a custom ttlMs is honoured', () => {
    const onChange = jest.fn();
    const layer = new PendingPlacementLayer(onChange, 1000);
    const key = layer.add(makePlacement(2, 3));
    onChange.mockClear();
    jest.advanceTimersByTime(999);
    expect(layer.has(key)).toBe(true);
    jest.advanceTimersByTime(1);
    expect(layer.has(key)).toBe(false);
  });

  it('advancing after an explicit remove fires nothing more — the timer was cleared', () => {
    const onChange = jest.fn();
    const layer = new PendingPlacementLayer(onChange);
    const key = layer.add(makePlacement(4, 4));
    layer.remove(key);
    onChange.mockClear();
    jest.advanceTimersByTime(PENDING_PLACEMENT_TTL_MS);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('dropWhere removes matching entries and notifies once for the whole batch', () => {
    const onChange = jest.fn();
    const layer = new PendingPlacementLayer(onChange);
    layer.add(makePlacement(1, 1));
    layer.add(makePlacement(2, 2));
    layer.add(makePlacement(3, 3));
    onChange.mockClear();
    const dropped = layer.dropWhere(p => p.x !== 3);
    expect(dropped).toBe(true);
    expect(layer.size).toBe(1);
    expect(layer.entries()).toEqual([makePlacement(3, 3)]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('dropWhere is a no-op notification when nothing matches', () => {
    const onChange = jest.fn();
    const layer = new PendingPlacementLayer(onChange);
    layer.add(makePlacement(1, 1));
    onChange.mockClear();
    expect(layer.dropWhere(() => false)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clear removes every entry, stops pending timers, and notifies once', () => {
    const onChange = jest.fn();
    const layer = new PendingPlacementLayer(onChange);
    layer.add(makePlacement(1, 1));
    layer.add(makePlacement(2, 2));
    onChange.mockClear();
    layer.clear();
    expect(layer.size).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    onChange.mockClear();
    jest.advanceTimersByTime(PENDING_PLACEMENT_TTL_MS);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clear on an already-empty layer does not notify', () => {
    const onChange = jest.fn();
    const layer = new PendingPlacementLayer(onChange);
    layer.clear();
    expect(onChange).not.toHaveBeenCalled();
  });
});
