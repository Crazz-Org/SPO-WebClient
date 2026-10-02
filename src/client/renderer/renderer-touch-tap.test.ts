/**
 * Touch single-tap contract of IsometricMapRenderer (#1253).
 *
 * `setupTouchControls` hands callbacks to TouchHandler2D (mocked here so the test captures
 * them). In connect mode a tap must pick the tapped building for the connection, exactly
 * as the mouse path does (`performLeftClick`), and must never open the inspector —
 * Voyager had a single pick path for the map (Voyager/URLHandlers/MapIsoHandler.pas:105,
 * :1173-1180).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { TouchHandler2D } from './touch-handler-2d';
import { IsometricMapRenderer } from './isometric-map-renderer';

jest.mock('./touch-handler-2d', () => ({ TouchHandler2D: jest.fn() }));

const proto = IsometricMapRenderer.prototype as unknown as Record<
  string,
  (...args: unknown[]) => unknown
>;

interface TapCallbacks {
  onSingleTap: (x: number, y: number) => void;
}

const TouchHandlerMock = TouchHandler2D as unknown as jest.Mock;

/** A fake `this` with only the fields `onSingleTap` reads. 10 screen px = 1 tile. */
function makeRenderer(opts: {
  connectMode: boolean;
  building: { x: number; y: number; visualClass: string } | null;
}) {
  return {
    canvas: {},
    terrainRenderer: {
      screenToMap: (sx: number, sy: number) => ({ x: sy / 10, y: sx / 10 }),
    },
    placementMode: false,
    placementPreview: null,
    connectMode: opts.connectMode,
    onConnectModeClick: jest.fn(),
    onBuildingClick: jest.fn(),
    onEmptyMapClick: jest.fn(),
    getBuildingAt: jest.fn((_mapJ: number, _mapI: number) => opts.building),
  };
}

/** Run the real setupTouchControls and return the onSingleTap it handed to TouchHandler2D. */
function captureTap(fake: ReturnType<typeof makeRenderer>): TapCallbacks['onSingleTap'] {
  proto.setupTouchControls.call(fake);
  const callbacks = TouchHandlerMock.mock.calls[0][1] as TapCallbacks;
  return callbacks.onSingleTap;
}

describe('touch single tap in connect mode (#1253)', () => {
  beforeEach(() => {
    TouchHandlerMock.mockClear();
  });

  it('connects the tapped building and does not open its inspector', () => {
    const r = makeRenderer({ connectMode: true, building: { x: 7, y: 3, visualClass: '200' } });
    captureTap(r)(70, 30);
    expect(r.getBuildingAt).toHaveBeenCalledWith(7, 3);
    expect(r.onConnectModeClick).toHaveBeenCalledTimes(1);
    expect(r.onConnectModeClick).toHaveBeenCalledWith(7, 3);
    expect(r.onBuildingClick).not.toHaveBeenCalled();
    expect(r.onEmptyMapClick).not.toHaveBeenCalled();
  });

  it('does nothing on a tile with no building', () => {
    const r = makeRenderer({ connectMode: true, building: null });
    captureTap(r)(70, 30);
    expect(r.onConnectModeClick).not.toHaveBeenCalled();
    expect(r.onEmptyMapClick).not.toHaveBeenCalled();
    expect(r.onBuildingClick).not.toHaveBeenCalled();
  });

  it('still opens the inspector on a building when connect mode is off', () => {
    const r = makeRenderer({ connectMode: false, building: { x: 7, y: 3, visualClass: '200' } });
    captureTap(r)(70, 30);
    expect(r.onBuildingClick).toHaveBeenCalledWith(7, 3, '200');
    expect(r.onConnectModeClick).not.toHaveBeenCalled();
  });

  it('still reports an empty-ground tap when connect mode is off', () => {
    const r = makeRenderer({ connectMode: false, building: null });
    captureTap(r)(70, 30);
    expect(r.onEmptyMapClick).toHaveBeenCalledTimes(1);
    expect(r.onBuildingClick).not.toHaveBeenCalled();
  });

  it('ignores taps while placing a building', () => {
    const r = makeRenderer({ connectMode: true, building: { x: 7, y: 3, visualClass: '200' } });
    Object.assign(r, { placementMode: true, placementPreview: { i: 0, j: 0 } });
    captureTap(r)(70, 30);
    expect(r.getBuildingAt).not.toHaveBeenCalled();
    expect(r.onConnectModeClick).not.toHaveBeenCalled();
  });
});
