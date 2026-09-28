/**
 * Zoom-change notification of IsometricMapRenderer (#1068): the class is constructed
 * for real against jsdom (heavy collaborators jest-mocked), then every zoom path is
 * driven and setZoomChangedCallback observed.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('./isometric-terrain-renderer');
jest.mock('./game-object-texture-cache');
jest.mock('./vegetation-flat-mapper');
jest.mock('./touch-handler-2d');
jest.mock('./road-texture-system');
jest.mock('./concrete-texture-system');
jest.mock('./car-class-system');
jest.mock('./vehicle-animation-system');

import { IsometricMapRenderer } from './isometric-map-renderer';
import { TouchHandler2D } from './touch-handler-2d';

type AnyRecord = Record<string, unknown>;

function mockCtx(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    strokeStyle: '',
    fillRect: jest.fn(),
    clearRect: jest.fn(),
    drawImage: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    fillText: jest.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('IsometricMapRenderer zoom-changed callback', () => {
  let renderer: IsometricMapRenderer;
  let destroyed: boolean;
  let level: number;
  let cb: jest.Mock<(level: number) => void>;
  let terrain: AnyRecord;

  const internals = () => renderer as unknown as AnyRecord;
  const wheel = (deltaY: number) =>
    (internals().onWheel as (e: unknown) => void).call(renderer, {
      deltaY, clientX: 0, clientY: 0, preventDefault: jest.fn(),
    });
  const key = (k: string) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  const touchCallbacks = () =>
    (jest.mocked(TouchHandler2D).mock.calls.at(-1) as unknown[])[1] as {
      onZoom: (delta: number) => void;
      onPan: (dx: number, dy: number) => void;
    };

  beforeEach(() => {
    document.body.innerHTML = '<canvas id="game-map"></canvas>';
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(mockCtx() as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    (globalThis as AnyRecord).requestAnimationFrame = jest.fn(() => 1);
    jest.mocked(TouchHandler2D).mockClear();
    renderer = new IsometricMapRenderer('game-map');
    destroyed = false;
    level = 2;
    terrain = internals().terrainRenderer as AnyRecord;
    Object.assign(terrain, {
      getZoomLevel: jest.fn(() => level),
      setZoomLevel: jest.fn((l: number) => { level = Math.max(0, Math.min(3, l)); }),
      clearDistantZoomCaches: jest.fn(),
      screenToMap: jest.fn(() => ({ x: 0, y: 0 })),
      mapToScreen: jest.fn(() => ({ x: 0, y: 0 })),
      pan: jest.fn(),
      getRotation: jest.fn(() => 0),
    });
    Object.assign(internals(), {
      render: jest.fn(),
      checkVisibleZones: jest.fn(),
      startAnimationLoop: jest.fn(),
    });
    cb = jest.fn();
    renderer.setZoomChangedCallback(cb);
  });

  afterEach(() => {
    if (!destroyed) renderer.destroy();
    jest.restoreAllMocks();
  });

  const firing: Array<[string, number, () => void, number]> = [
    ['wheel in', 2, () => wheel(-100), 3],
    ['wheel out', 2, () => wheel(100), 1],
    ['+ key', 2, () => key('+'), 3],
    ['= key', 2, () => key('='), 3],
    ['- key', 2, () => key('-'), 1],
    ['zoomIn()', 2, () => renderer.zoomIn(), 3],
    ['zoomOut()', 2, () => renderer.zoomOut(), 1],
    ['pinch in', 2, () => touchCallbacks().onZoom(1), 3],
    ['pinch out', 2, () => touchCallbacks().onZoom(-1), 1],
    ['setZoom(0)', 2, () => renderer.setZoom(0), 0],
  ];
  it.each(firing)('fires once with the new level on %s', (_name, start, act, expected) => {
    level = start;
    act();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expected);
  });

  const silent: Array<[string, number, () => void]> = [
    ['zoomIn() at 3', 3, () => renderer.zoomIn()],
    ['zoomOut() at 0', 0, () => renderer.zoomOut()],
    ['wheel out at 0', 0, () => wheel(100)],
    ['wheel in at 3', 3, () => wheel(-100)],
    ['setZoom(2) at 2', 2, () => renderer.setZoom(2)],
    ['pinch in at 3', 3, () => touchCallbacks().onZoom(1)],
    ['a pan', 2, () => touchCallbacks().onPan(10, 5)],
  ];
  it.each(silent)('does not fire on %s', (_name, start, act) => {
    level = start;
    act();
    expect(cb).not.toHaveBeenCalled();
  });

  it('a cleared callback is not called', () => {
    renderer.setZoomChangedCallback(null);
    renderer.zoomIn();
    expect(level).toBe(3);
    expect(cb).not.toHaveBeenCalled();
  });

  it('destroy() clears the callback', () => {
    renderer.destroy();
    destroyed = true;
    renderer.zoomIn();
    expect(level).toBe(3);
    expect(cb).not.toHaveBeenCalled();
  });

  it('keeps the existing side effects of setZoom and zoomIn', () => {
    renderer.setZoom(1);
    expect(terrain.clearDistantZoomCaches).toHaveBeenCalledWith(1);
    expect(internals().checkVisibleZones).toHaveBeenCalled();
    expect(() => renderer.zoomIn()).not.toThrow();
    expect(level).toBe(2);
  });
});
