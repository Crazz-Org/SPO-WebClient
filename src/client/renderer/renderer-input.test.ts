/**
 * Input contract of IsometricMapRenderer — left-drag pan, deferred click, arrow-key pan.
 *
 * The interaction model follows Voyager's TCustomGameControl
 * (GameControl.pas:533-597): the left button decides between click and pan at
 * RELEASE time — a drag begins once |dx| + |dy| exceeds cMinDrag = 8 px, and a
 * release without drag performs the click. Arrow-key panning is a WebClient
 * addition (Voyager had the accelerators commented out, VoyagerWindow.pas:657-667).
 *
 * Private methods are exercised via prototype `.call()` with a crafted `this`
 * (same pattern as renderer-e2e-probe.test.ts) — the real methods run, only the
 * collaborators are stubbed.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';
import { ZOOM_LEVELS } from '../../shared/map-config';

const proto = IsometricMapRenderer.prototype as unknown as Record<
  string,
  (...args: unknown[]) => unknown
>;

/** A MouseEvent stand-in — only the fields the handlers read. */
function mouseEvent(button: number, clientX: number, clientY: number) {
  return { button, clientX, clientY, preventDefault: jest.fn() };
}

/** A KeyboardEvent stand-in. */
function keyEvent(
  key: string,
  overrides: Partial<{
    target: unknown;
    isComposing: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
  }> = {},
) {
  return {
    key,
    target: null,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault: jest.fn(),
    ...overrides,
  };
}

interface FakeRendererOptions {
  building?: { x: number; y: number; visualClass: string } | null;
  placementMode?: boolean;
  connectMode?: boolean;
  roadDrawingMode?: boolean;
  zonePaintingMode?: boolean;
  demolishMode?: boolean;
  placementInvalid?: boolean;
  rotation?: number;
}

/**
 * Build a fake `this` covering every field the input handlers touch.
 * screenToMap maps 10 screen px to 1 tile: map i = clientY/10, j = clientX/10.
 */
function makeRenderer(opts: FakeRendererOptions = {}) {
  const fake = {
    canvas: {
      style: { cursor: '' },
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      clientWidth: 800,
      clientHeight: 600,
    },
    terrainRenderer: {
      screenToMap: (sx: number, sy: number) => ({ x: sy / 10, y: sx / 10 }),
      pan: jest.fn(),
      getZoomLevel: () => 2,
      getRotation: () => opts.rotation ?? 0,
    },
    zoneRequestManager: { markMoving: jest.fn(), markStopped: jest.fn() },
    checkVisibleZones: jest.fn(),
    markCameraMoving: jest.fn(),
    requestRender: jest.fn(),
    zoomIn: jest.fn(),
    zoomOut: jest.fn(),
    rotateCounterClockwise: jest.fn(),
    rotateClockwise: jest.fn(),

    // Real private helpers, bound through the prototype
    screenToMap: proto.screenToMap,
    screenDeltaToMapDelta: proto.screenDeltaToMapDelta,
    updateCursor: proto.updateCursor,
    placementNWCorner: proto.placementNWCorner,
    beginLeftClickPending: proto.beginLeftClickPending,
    performLeftClick: proto.performLeftClick,
    startKeyboardPan: proto.startKeyboardPan,
    stopKeyboardPan: proto.stopKeyboardPan,
    cancelKeyboardPan: proto.cancelKeyboardPan,
    keyboardPanStep: proto.keyboardPanStep,
    handleMapKeyDown: proto.handleMapKeyDown,
    handleMapKeyUp: proto.handleMapKeyUp,

    // Mouse state
    isDragging: false,
    rightClickDragged: false,
    leftButtonDown: false,
    leftClickDragged: false,
    pressX: 0,
    pressY: 0,
    lastMouseX: 0,
    lastMouseY: 0,
    mouseMapI: 0,
    mouseMapJ: 0,
    mouseHasEnteredCanvas: false,
    hoveredBuilding: null as unknown,

    // Modes
    placementMode: opts.placementMode ?? false,
    connectMode: opts.connectMode ?? false,
    roadDrawingMode: opts.roadDrawingMode ?? false,
    zonePaintingMode: opts.zonePaintingMode ?? false,
    placementInvalid: opts.placementInvalid ?? false,
    placementPreview: opts.placementMode
      ? { i: 0, j: 0, xsize: 2, ysize: 2 }
      : null,
    roadDrawingState: { isDrawing: false, startX: 0, startY: 0, endX: 0, endY: 0 },
    zonePaintingState: { isDrawing: false, startX: 0, startY: 0, endX: 0, endY: 0 },
    roadDemolishDragState: { isDrawing: false, startX: 0, startY: 0, endX: 0, endY: 0 },
    roadTilesMap: new Map<string, unknown>([['3,2', {}]]),

    // Keyboard pan state
    heldPanKeys: new Set<string>(),
    keyboardPanRunning: false,
    lastKeyboardPanTime: 0,
    debugMode: false,

    // Callbacks
    onBuildingClick: jest.fn(),
    onEmptyMapClick: jest.fn(),
    onPlacementConfirm: jest.fn(),
    onConnectModeClick: jest.fn(),
    onCancelPlacement: jest.fn(),
    onCancelRoadDrawing: jest.fn(),
    onCancelZonePainting: jest.fn(),
    onCancelRoadDemolish: null as unknown,
    onRoadDemolishClick: opts.demolishMode ? jest.fn() : null,
    onRoadDemolishAreaComplete: jest.fn(),
    onRoadSegmentComplete: jest.fn(),
    onZoneAreaComplete: jest.fn(),
    onMapContextMenu: jest.fn(),

    getBuildingAt: jest.fn(() => opts.building ?? null),
  };
  return fake;
}

type Fake = ReturnType<typeof makeRenderer>;

const down = (r: Fake, x: number, y: number, button = 0) =>
  proto.onMouseDown.call(r, mouseEvent(button, x, y));
const move = (r: Fake, x: number, y: number) =>
  proto.onMouseMove.call(r, mouseEvent(0, x, y));
const up = (r: Fake, x: number, y: number, button = 0) =>
  proto.onMouseUp.call(r, mouseEvent(button, x, y));

describe('left click acts on release (Voyager GameControl.pas:595)', () => {
  it('does nothing on mousedown over a building', () => {
    const r = makeRenderer({ building: { x: 10, y: 5, visualClass: '100' } });
    down(r, 100, 50);
    expect(r.onBuildingClick).not.toHaveBeenCalled();
    expect(r.onEmptyMapClick).not.toHaveBeenCalled();
  });

  it('fires the building click on release without drag', () => {
    const r = makeRenderer({ building: { x: 10, y: 5, visualClass: '100' } });
    down(r, 100, 50);
    up(r, 100, 50);
    expect(r.onBuildingClick).toHaveBeenCalledWith(10, 5, '100');
  });

  it('fires the empty-map click on release over empty ground', () => {
    const r = makeRenderer({ building: null });
    down(r, 100, 50);
    up(r, 100, 50);
    expect(r.onEmptyMapClick).toHaveBeenCalledTimes(1);
  });

  it('ignores portal facilities on release, as before', () => {
    const r = makeRenderer({ building: { x: 10, y: 5, visualClass: '6031' } });
    down(r, 100, 50);
    up(r, 100, 50);
    expect(r.onBuildingClick).not.toHaveBeenCalled();
    expect(r.onEmptyMapClick).not.toHaveBeenCalled();
  });

  it('still clicks when the pointer wobbled at most 8 px (Manhattan)', () => {
    const r = makeRenderer({ building: { x: 10, y: 5, visualClass: '100' } });
    down(r, 100, 50);
    move(r, 104, 54); // |4| + |4| = 8, not > 8
    up(r, 104, 54);
    expect(r.isDragging).toBe(false);
    expect(r.terrainRenderer.pan).not.toHaveBeenCalled();
    expect(r.onBuildingClick).toHaveBeenCalledWith(10, 5, '100');
  });
});

describe('left drag pans the map past the 8 px threshold', () => {
  it('starts panning and swallows the click', () => {
    const r = makeRenderer({ building: { x: 10, y: 5, visualClass: '100' } });
    down(r, 100, 50);
    move(r, 105, 55); // |5| + |5| = 10 > 8
    expect(r.isDragging).toBe(true);
    move(r, 120, 60);
    expect(r.terrainRenderer.pan).toHaveBeenCalled();
    expect(r.markCameraMoving).toHaveBeenCalled();
    expect(r.zoneRequestManager.markMoving).toHaveBeenCalled();
    up(r, 120, 60);
    expect(r.onBuildingClick).not.toHaveBeenCalled();
    expect(r.onEmptyMapClick).not.toHaveBeenCalled();
    expect(r.isDragging).toBe(false);
    expect(r.zoneRequestManager.markStopped).toHaveBeenCalledWith(2);
    expect(r.checkVisibleZones).toHaveBeenCalled();
  });

  it('shows the grabbing cursor while panning, grab after release', () => {
    const r = makeRenderer({});
    down(r, 100, 50);
    move(r, 115, 50);
    expect(r.canvas.style.cursor).toBe('grabbing');
    up(r, 115, 50);
    expect(r.canvas.style.cursor).toBe('grab');
  });

  it('mouseleave aborts a pending left click', () => {
    const r = makeRenderer({ building: { x: 10, y: 5, visualClass: '100' } });
    down(r, 100, 50);
    proto.onMouseLeave.call(r);
    up(r, 100, 50);
    expect(r.onBuildingClick).not.toHaveBeenCalled();
  });
});

describe('placement mode — release places, drag pans', () => {
  it('confirms placement at the NW corner on release without drag', () => {
    const r = makeRenderer({ placementMode: true });
    down(r, 100, 50);
    move(r, 100, 50);
    up(r, 100, 50);
    // preview follows the cursor: i = 5, j = 10; NORTH rotation → NW = cursor
    expect(r.onPlacementConfirm).toHaveBeenCalledWith(10, 5);
  });

  it('does not confirm when the position is invalid', () => {
    const r = makeRenderer({ placementMode: true, placementInvalid: true });
    down(r, 100, 50);
    up(r, 100, 50);
    expect(r.onPlacementConfirm).not.toHaveBeenCalled();
  });

  it('pans instead of placing when the pointer dragged', () => {
    const r = makeRenderer({ placementMode: true });
    down(r, 100, 50);
    move(r, 120, 60);
    up(r, 120, 60);
    expect(r.terrainRenderer.pan).toHaveBeenCalled();
    expect(r.onPlacementConfirm).not.toHaveBeenCalled();
  });

  it('right-click release without drag cancels placement (8 px threshold)', () => {
    const r = makeRenderer({ placementMode: true });
    down(r, 100, 50, 2);
    move(r, 103, 53); // 6 px Manhattan — still a click
    up(r, 103, 53, 2);
    expect(r.onCancelPlacement).toHaveBeenCalledTimes(1);
  });

  it('right-click drag past 8 px pans and does not cancel placement', () => {
    const r = makeRenderer({ placementMode: true });
    down(r, 100, 50, 2);
    move(r, 110, 55);
    up(r, 110, 55, 2);
    expect(r.onCancelPlacement).not.toHaveBeenCalled();
    expect(r.terrainRenderer.pan).toHaveBeenCalled();
  });
});

describe('setMapContextMenuCallback', () => {
  it('stores the callback that onMouseUp calls on release without drag', () => {
    const r = makeRenderer();
    const cb = jest.fn();
    proto.setMapContextMenuCallback.call(r, cb);
    down(r, 100, 50, 2);
    up(r, 100, 50, 2);
    expect(cb).toHaveBeenCalledWith(100, 50, 10, 5);
  });
});

describe('right-click menu on release without drag', () => {
  it('opens the menu at the tile under the pointer on release without drag', () => {
    const r = makeRenderer();
    down(r, 100, 50, 2);
    up(r, 100, 50, 2);
    expect(r.onMapContextMenu).toHaveBeenCalledWith(100, 50, 10, 5);
  });

  it('does not open the menu when the release followed a drag; pans instead', () => {
    const r = makeRenderer();
    down(r, 100, 50, 2);
    move(r, 110, 55); // |10| + |5| = 15 > 8
    up(r, 110, 55, 2);
    expect(r.onMapContextMenu).not.toHaveBeenCalled();
    expect(r.terrainRenderer.pan).toHaveBeenCalled();
  });

  it('cancels placement instead of opening the menu on release without drag', () => {
    const r = makeRenderer({ placementMode: true });
    down(r, 100, 50, 2);
    up(r, 100, 50, 2);
    expect(r.onCancelPlacement).toHaveBeenCalledTimes(1);
    expect(r.onMapContextMenu).not.toHaveBeenCalled();
  });

  it('cancels road drawing on press and never reaches the menu on the following release', () => {
    const r = makeRenderer({ roadDrawingMode: true });
    down(r, 100, 50, 2);
    expect(r.onCancelRoadDrawing).toHaveBeenCalledTimes(1);
    up(r, 100, 50, 2);
    expect(r.onMapContextMenu).not.toHaveBeenCalled();
  });
});

describe('connect mode — release connects, drag pans', () => {
  it('connects the building under the cursor on release', () => {
    const r = makeRenderer({ connectMode: true, building: { x: 7, y: 3, visualClass: '200' } });
    down(r, 70, 30);
    up(r, 70, 30);
    expect(r.onConnectModeClick).toHaveBeenCalledWith(7, 3);
  });

  it('pans without connecting when dragged', () => {
    const r = makeRenderer({ connectMode: true, building: { x: 7, y: 3, visualClass: '200' } });
    down(r, 70, 30);
    move(r, 90, 40);
    up(r, 90, 40);
    expect(r.onConnectModeClick).not.toHaveBeenCalled();
    expect(r.terrainRenderer.pan).toHaveBeenCalled();
  });
});

describe('drawing modes keep drag-to-draw on mousedown', () => {
  it('road drawing starts at mousedown', () => {
    const r = makeRenderer({ roadDrawingMode: true });
    down(r, 100, 50);
    expect(r.roadDrawingState.isDrawing).toBe(true);
    expect(r.roadDrawingState.startX).toBe(10);
    expect(r.roadDrawingState.startY).toBe(5);
    expect(r.terrainRenderer.pan).not.toHaveBeenCalled();
  });

  it('zone painting starts at mousedown', () => {
    const r = makeRenderer({ zonePaintingMode: true });
    down(r, 100, 50);
    expect(r.zonePaintingState.isDrawing).toBe(true);
  });

  it('road demolition starts its drag selection at mousedown', () => {
    const r = makeRenderer({ demolishMode: true });
    down(r, 30, 20);
    expect(r.roadDemolishDragState.isDrawing).toBe(true);
    up(r, 30, 20);
    // single-click on a road tile (3,2 in roadTilesMap) demolishes it
    expect(r.onRoadDemolishClick).toHaveBeenCalledWith(3, 2);
  });
});

describe('arrow-key panning (WebClient addition — Voyager had them commented, VoyagerWindow.pas:657-667)', () => {
  let rafSpy: jest.Mock;
  const realRaf = globalThis.requestAnimationFrame;

  beforeEach(() => {
    rafSpy = jest.fn();
    (globalThis as Record<string, unknown>).requestAnimationFrame = rafSpy;
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).requestAnimationFrame = realRaf;
  });

  const key = (r: Fake, e: unknown) => proto.handleMapKeyDown.call(r, e);
  const keyUp = (r: Fake, e: unknown) => proto.handleMapKeyUp.call(r, e);

  it('ArrowRight starts the pan loop', () => {
    const r = makeRenderer({});
    const e = keyEvent('ArrowRight');
    key(r, e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(r.heldPanKeys.has('ArrowRight')).toBe(true);
    expect(r.keyboardPanRunning).toBe(true);
    expect(rafSpy).toHaveBeenCalled();
  });

  it('one step moves half a viewport per second toward the east', () => {
    const r = makeRenderer({});
    r.heldPanKeys.add('ArrowRight');
    proto.keyboardPanStep.call(r, 1);
    // View moves right = map content dragged left by half the canvas width
    const u = ZOOM_LEVELS[2].u;
    const dx = -0.5 * 800;
    const expected = { deltaI: dx / (2 * u), deltaJ: -dx / (2 * u) };
    expect(r.terrainRenderer.pan).toHaveBeenCalledTimes(1);
    const [di, dj] = (r.terrainRenderer.pan as jest.Mock).mock.calls[0] as [number, number];
    expect(di).toBeCloseTo(expected.deltaI, 6);
    expect(dj).toBeCloseTo(expected.deltaJ, 6);
    expect(r.markCameraMoving).toHaveBeenCalled();
    expect(r.zoneRequestManager.markMoving).toHaveBeenCalled();
    expect(r.requestRender).toHaveBeenCalled();
  });

  it('diagonals combine both axes in one pan call', () => {
    const r = makeRenderer({});
    r.heldPanKeys.add('ArrowUp');
    r.heldPanKeys.add('ArrowLeft');
    proto.keyboardPanStep.call(r, 0.5);
    expect(r.terrainRenderer.pan).toHaveBeenCalledTimes(1);
  });

  it('opposite arrows cancel out — no pan call', () => {
    const r = makeRenderer({});
    r.heldPanKeys.add('ArrowLeft');
    r.heldPanKeys.add('ArrowRight');
    proto.keyboardPanStep.call(r, 0.5);
    expect(r.terrainRenderer.pan).not.toHaveBeenCalled();
  });

  it('releasing the last arrow stops the loop and reloads zones', () => {
    const r = makeRenderer({});
    key(r, keyEvent('ArrowRight'));
    key(r, keyEvent('ArrowDown'));
    keyUp(r, keyEvent('ArrowRight'));
    expect(r.keyboardPanRunning).toBe(true);
    keyUp(r, keyEvent('ArrowDown'));
    expect(r.keyboardPanRunning).toBe(false);
    expect(r.zoneRequestManager.markStopped).toHaveBeenCalledWith(2);
    expect(r.checkVisibleZones).toHaveBeenCalled();
  });

  it('window blur cancels all held keys', () => {
    const r = makeRenderer({});
    key(r, keyEvent('ArrowRight'));
    proto.cancelKeyboardPan.call(r);
    expect(r.heldPanKeys.size).toBe(0);
    expect(r.keyboardPanRunning).toBe(false);
  });

  it('ignores arrows typed into a form field', () => {
    const r = makeRenderer({});
    key(r, keyEvent('ArrowRight', { target: { tagName: 'INPUT' } }));
    expect(r.heldPanKeys.size).toBe(0);
  });

  it('ignores arrows in ARIA text widgets and during IME composition', () => {
    const r = makeRenderer({});
    key(r, keyEvent('ArrowRight', {
      target: { tagName: 'DIV', getAttribute: () => 'searchbox' },
    }));
    key(r, keyEvent('ArrowLeft', { isComposing: true }));
    expect(r.heldPanKeys.size).toBe(0);
  });

  it('leaves modifier chords to the browser', () => {
    const r = makeRenderer({});
    key(r, keyEvent('ArrowRight', { ctrlKey: true }));
    expect(r.heldPanKeys.size).toBe(0);
    key(r, keyEvent('-', { ctrlKey: true }));
    expect(r.zoomOut).not.toHaveBeenCalled();
  });
});

describe('renderer keyboard ownership after N7', () => {
  it('no longer handles Q — rotation belongs to useKeyboardShortcuts', () => {
    const r = makeRenderer({});
    proto.handleMapKeyDown.call(r, keyEvent('q'));
    proto.handleMapKeyDown.call(r, keyEvent('Q'));
    expect(r.rotateCounterClockwise).not.toHaveBeenCalled();
    expect(r.rotateClockwise).not.toHaveBeenCalled();
  });

  it('still owns + / - zoom', () => {
    const r = makeRenderer({});
    proto.handleMapKeyDown.call(r, keyEvent('+'));
    expect(r.zoomIn).toHaveBeenCalledTimes(1);
    proto.handleMapKeyDown.call(r, keyEvent('-'));
    expect(r.zoomOut).toHaveBeenCalledTimes(1);
  });

  it('still owns the 1-5 debug sub-overlays when debug mode is on', () => {
    const r = makeRenderer({});
    r.debugMode = true;
    const flags = [
      ['1', 'debugShowTileInfo'],
      ['2', 'debugShowBuildingInfo'],
      ['3', 'debugShowConcreteInfo'],
      ['4', 'debugShowWaterGrid'],
      ['5', 'debugShowRoadInfo'],
    ] as const;
    for (const [digit, flag] of flags) {
      const before = (r as Record<string, unknown>)[flag];
      proto.handleMapKeyDown.call(r, keyEvent(digit));
      expect((r as Record<string, unknown>)[flag]).toBe(!before);
    }
  });
});
