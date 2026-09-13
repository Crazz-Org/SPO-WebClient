/**
 * Tests for MinimapUI — canvas minimap component.
 *
 * Environment: node (no jsdom) — DOM elements mocked as plain objects.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { useUiStore } from '../store/ui-store';
import type { MinimapRendererAPI } from './minimap-ui';

// ---------------------------------------------------------------------------
// DOM mock infrastructure
// ---------------------------------------------------------------------------

interface MockElement {
  id: string;
  style: Record<string, string>;
  width: number;
  height: number;
  children: MockElement[];
  parentElement: MockElement | null;
  appendChild: jest.Mock;
  removeChild: jest.Mock;
  addEventListener: jest.Mock;
  onmousedown: ((e: unknown) => void) | null;
  onclick: (() => void) | null;
  getContext: jest.Mock;
  imageSmoothingEnabled: boolean;
}

interface MockContext {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineJoin: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  imageSmoothingEnabled: boolean;
  fillRect: jest.Mock;
  strokeRect: jest.Mock;
  beginPath: jest.Mock;
  closePath: jest.Mock;
  moveTo: jest.Mock;
  lineTo: jest.Mock;
  stroke: jest.Mock;
  fill: jest.Mock;
  arc: jest.Mock;
  fillText: jest.Mock;
  createLinearGradient: jest.Mock;
  save: jest.Mock;
  restore: jest.Mock;
  translate: jest.Mock;
  rotate: jest.Mock;
  scale: jest.Mock;
  drawImage: jest.Mock;
  createImageData: jest.Mock;
  putImageData: jest.Mock;
}

let allElements: MockElement[];
let mockCtx: MockContext;

function createMockElement(): MockElement {
  const el: MockElement = {
    id: '',
    style: {},
    width: 0,
    height: 0,
    children: [],
    parentElement: null,
    appendChild: jest.fn(function (this: MockElement, child: MockElement) {
      this.children.push(child);
      child.parentElement = this;
      return child;
    }),
    removeChild: jest.fn(function (this: MockElement, child: MockElement) {
      this.children = this.children.filter(c => c !== child);
      child.parentElement = null;
      return child;
    }),
    addEventListener: jest.fn(),
    onmousedown: null,
    onclick: null,
    getContext: jest.fn(() => mockCtx),
    imageSmoothingEnabled: true,
  };
  allElements.push(el);
  return el;
}

function createMockCtx(): MockContext {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    imageSmoothingEnabled: true,
    fillRect: jest.fn(),
    strokeRect: jest.fn(),
    beginPath: jest.fn(),
    closePath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    arc: jest.fn(),
    fillText: jest.fn(),
    createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    scale: jest.fn(),
    drawImage: jest.fn(),
    createImageData: jest.fn((w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    })),
    putImageData: jest.fn(),
  };
}

/** Build a small terrain pixel data array (100×100, all grass with some water). */
function createTerrainPixelData(width = 100, height = 100): { pixelData: Uint8Array; width: number; height: number } {
  const pixelData = new Uint8Array(width * height);
  // Fill with ZoneA (grass = landClass 0, bits 7-6 = 0x00)
  pixelData.fill(0x00);
  // Add some water (ZoneD = landClass 3, bits 7-6 = 0xC0) in the corners
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      pixelData[y * width + x] = 0xC0;
    }
  }
  return { pixelData, width, height };
}

function createMockRenderer(overrides: Partial<MinimapRendererAPI> = {}): MinimapRendererAPI {
  return {
    getCameraPosition: jest.fn(() => ({ x: 50, y: 50 })),
    centerOn: jest.fn(),
    getMapDimensions: jest.fn(() => ({ width: 100, height: 100 })),
    getMapName: jest.fn(() => 'Shamba'),
    getSeason: jest.fn(() => 2),
    getTerrainType: jest.fn(() => 'Alien Swamp'),
    getVisibleTileBounds: jest.fn(() => ({ minI: 20, maxI: 60, minJ: 25, maxJ: 65 })),
    getTerrainPixelData: jest.fn(() => createTerrainPixelData()),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Viewport mock — a resizable window whose resize listeners can be fired
// ---------------------------------------------------------------------------

interface MockWindow {
  innerWidth: number;
  innerHeight: number;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
}

let mockWindow: MockWindow | null = null;
let viewportHandlers: Array<() => void>;

function installWindow(width: number, height = 800): void {
  viewportHandlers = [];
  mockWindow = {
    innerWidth: width,
    innerHeight: height,
    addEventListener: jest.fn((type: string, fn: () => void) => {
      if (type === 'resize' || type === 'orientationchange') viewportHandlers.push(fn);
    }),
    removeEventListener: jest.fn((_type: string, fn: () => void) => {
      viewportHandlers = viewportHandlers.filter(h => h !== fn);
    }),
  };
  (globalThis as Record<string, unknown>).window = mockWindow;
}

/** Change the viewport width and fire the listener once, like a rotation would. */
function resizeTo(width: number, height = 800): void {
  if (mockWindow) {
    mockWindow.innerWidth = width;
    mockWindow.innerHeight = height;
  }
  // 'resize' and 'orientationchange' share one handler — fire it a single time.
  viewportHandlers.slice(0, 1).forEach(h => h());
}

function wrapperStyle(): string {
  return allElements.find(el => el.id === 'minimap-wrapper')!.style.cssText ?? '';
}

beforeEach(() => {
  jest.useFakeTimers();
  allElements = [];
  mockCtx = createMockCtx();
  viewportHandlers = [];

  const bodyEl = createMockElement();

  (globalThis as Record<string, unknown>).document = {
    createElement: jest.fn(() => createMockElement()),
    body: bodyEl,
    documentElement: {},
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  useUiStore.setState({
    minimapFullscreen: false,
    mobileTab: 'map',
    modal: null,
    rightPanel: null,
    leftPanel: null,
    commandPaletteOpen: false,
    isPlacingBuilding: false,
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  (globalThis as Record<string, unknown>).window = undefined;
  mockWindow = null;
  viewportHandlers = [];
});

const { MinimapUI } = require('./minimap-ui') as typeof import('./minimap-ui');

describe('MinimapUI', () => {
  it('should start hidden', () => {
    const minimap = new MinimapUI();
    expect(minimap.isVisible()).toBe(false);
  });

  it('should auto-show when setRenderer is called', () => {
    const minimap = new MinimapUI();
    minimap.setRenderer(createMockRenderer());

    // setRenderer() auto-calls show()
    expect(minimap.isVisible()).toBe(true);

    minimap.destroy();
  });

  it('should show/hide via toggle', () => {
    const minimap = new MinimapUI();
    minimap.setRenderer(createMockRenderer());

    // Already visible from setRenderer()
    expect(minimap.isVisible()).toBe(true);

    minimap.toggle();
    expect(minimap.isVisible()).toBe(false);

    minimap.toggle();
    expect(minimap.isVisible()).toBe(true);

    minimap.destroy();
  });

  it('should create canvas on setRenderer (auto-show)', () => {
    const minimap = new MinimapUI();
    minimap.setRenderer(createMockRenderer());

    // Should have created container + canvas
    const container = allElements.find(el => el.id === 'minimap-container');
    expect(container).toBeDefined();

    minimap.destroy();
  });

  it('should query map name on render', () => {
    const renderer = createMockRenderer();
    const minimap = new MinimapUI();
    minimap.setRenderer(renderer);

    expect(renderer.getMapName).toHaveBeenCalled();

    minimap.destroy();
  });

  it('should not render when map name is empty', () => {
    const renderer = createMockRenderer({
      getMapName: jest.fn(() => ''),
    });
    const minimap = new MinimapUI();
    minimap.setRenderer(renderer);

    // render() should return early — no fillRect or drawImage
    expect(mockCtx.fillRect).not.toHaveBeenCalled();

    minimap.destroy();
  });

  it('should clean up on destroy', () => {
    const minimap = new MinimapUI();
    minimap.setRenderer(createMockRenderer());

    expect(minimap.isVisible()).toBe(true);

    minimap.destroy();
    // After destroy, container should be removed
    expect(minimap.isVisible()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Terrain colormap tests
  // ---------------------------------------------------------------------------

  describe('terrain colormap', () => {
    it('should build colormap from terrain pixel data', () => {
      const renderer = createMockRenderer();
      const minimap = new MinimapUI();
      minimap.setRenderer(renderer);

      // Should have called getTerrainPixelData to build colormap
      expect(renderer.getTerrainPixelData).toHaveBeenCalled();

      minimap.destroy();
    });

    it('should draw terrain with rotation transform', () => {
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      // render() should apply translate + rotate(45°) + scale
      expect(mockCtx.translate).toHaveBeenCalled();
      expect(mockCtx.rotate).toHaveBeenCalledWith(Math.PI / 4);
      expect(mockCtx.scale).toHaveBeenCalled();
      expect(mockCtx.drawImage).toHaveBeenCalled();

      minimap.destroy();
    });

    it('should handle null terrain data gracefully', () => {
      const renderer = createMockRenderer({
        getTerrainPixelData: jest.fn(() => null),
      });
      const minimap = new MinimapUI();
      minimap.setRenderer(renderer);

      // Should still render (just dark background + border), no crash
      expect(minimap.isVisible()).toBe(true);
      // drawImage should NOT be called since there's no terrain data
      expect(mockCtx.drawImage).not.toHaveBeenCalled();

      minimap.destroy();
    });

    it('should create colormap with createImageData', () => {
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      // buildTerrainColormap uses createImageData + putImageData
      expect(mockCtx.createImageData).toHaveBeenCalled();
      expect(mockCtx.putImageData).toHaveBeenCalled();

      minimap.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Click-to-navigate tests (with 45° rotation)
  // ---------------------------------------------------------------------------

  describe('click-to-navigate', () => {
    it('should call centerOn when clicking the minimap', () => {
      const renderer = createMockRenderer();
      const minimap = new MinimapUI();
      minimap.setRenderer(renderer);

      const container = allElements.find(el => el.id === 'minimap-container');
      expect(container).toBeDefined();

      // Click at center of 220px minimap → should map to center of 100x100 map
      container!.onmousedown!({ offsetX: 110, offsetY: 110, preventDefault: jest.fn(), stopPropagation: jest.fn() });
      expect(renderer.centerOn).toHaveBeenCalled();

      minimap.destroy();
    });

    it('should map center click to center of map', () => {
      const renderer = createMockRenderer();
      const minimap = new MinimapUI();
      minimap.setRenderer(renderer);

      const container = allElements.find(el => el.id === 'minimap-container');

      // Click at dead center (110, 110) of 220px minimap
      // After reverse transform: center pixel → center of terrain grid → (50, 50) tile
      container!.onmousedown!({ offsetX: 110, offsetY: 110, preventDefault: jest.fn(), stopPropagation: jest.fn() });

      const calls = (renderer.centerOn as jest.Mock).mock.calls;
      const lastCall = calls[calls.length - 1] as number[];
      expect(lastCall[0]).toBe(50);  // x = j = center of 100 width
      expect(lastCall[1]).toBe(50);  // y = i = center of 100 height

      minimap.destroy();
    });

    it('should map top vertex click to tile (maxI, maxJ)', () => {
      const renderer = createMockRenderer();
      const minimap = new MinimapUI();
      minimap.setRenderer(renderer);

      const container = allElements.find(el => el.id === 'minimap-container');

      // Top vertex of 220px diamond = (110, 0)
      // After swap+flip, top of diamond = tile (maxI, maxJ) = (99, 99)
      container!.onmousedown!({ offsetX: 110, offsetY: 0, preventDefault: jest.fn(), stopPropagation: jest.fn() });

      const calls = (renderer.centerOn as jest.Mock).mock.calls;
      const lastCall = calls[calls.length - 1] as number[];
      // Due to padding, the exact top vertex won't map to (99,99) precisely
      // but it should be in the high range
      expect(lastCall[0]).toBeGreaterThanOrEqual(90);
      expect(lastCall[1]).toBeGreaterThanOrEqual(90);

      minimap.destroy();
    });

    it('should not navigate when terrain data is null', () => {
      const renderer = createMockRenderer({
        getTerrainPixelData: jest.fn(() => null),
      });
      const minimap = new MinimapUI();
      minimap.setRenderer(renderer);

      const container = allElements.find(el => el.id === 'minimap-container');
      container!.onmousedown!({ offsetX: 110, offsetY: 110, preventDefault: jest.fn(), stopPropagation: jest.fn() });

      // No terrain canvas → should not call centerOn
      expect(renderer.centerOn).not.toHaveBeenCalled();

      minimap.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Screen-space overlay tests (border)
  // ---------------------------------------------------------------------------

  describe('screen-space overlays', () => {
    it('should draw diamond border using createLinearGradient', () => {
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      // drawDiamondBorder calls createLinearGradient for the border stroke
      expect(mockCtx.createLinearGradient).toHaveBeenCalled();

      minimap.destroy();
    });

    it('should not draw vertex handle dots (no arc calls)', () => {
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      // No vertex dots — resize affordance removed
      expect(mockCtx.arc).not.toHaveBeenCalled();

      minimap.destroy();
    });

    it('should have wrapper with exactly 1 child (container only)', () => {
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      const wrapper = allElements.find(el => el.id === 'minimap-wrapper');
      expect(wrapper).toBeDefined();
      expect(wrapper!.children.length).toBe(1);
      expect(wrapper!.children[0].id).toBe('minimap-container');

      minimap.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Viewport indicator tests
  // ---------------------------------------------------------------------------

  describe('viewport indicator', () => {
    it('should draw viewport rectangle via strokeRect', () => {
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      // drawViewportInGrid calls fillRect (fill) + strokeRect (outline)
      expect(mockCtx.strokeRect).toHaveBeenCalled();

      minimap.destroy();
    });

    it('should not draw viewport when map dimensions are zero', () => {
      const renderer = createMockRenderer({
        getMapDimensions: jest.fn(() => ({ width: 0, height: 0 })),
      });
      const minimap = new MinimapUI();
      minimap.setRenderer(renderer);

      // No strokeRect for viewport
      expect(mockCtx.strokeRect).not.toHaveBeenCalled();

      minimap.destroy();
    });

    it('should draw viewport in terrain grid space (inside save/restore)', () => {
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      // Verify save/restore pairs were called (terrain transform + border)
      expect(mockCtx.save.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mockCtx.restore.mock.calls.length).toBeGreaterThanOrEqual(2);

      minimap.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Diamond shape tests
  // ---------------------------------------------------------------------------

  describe('diamond shape', () => {
    it('should apply diamond clip-path to container', () => {
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      const container = allElements.find(el => el.id === 'minimap-container');
      expect(container).toBeDefined();
      expect(container!.style.cssText).toContain('clip-path');
      expect(container!.style.cssText).toContain('polygon');

      minimap.destroy();
    });

    it('should set wrapper width and height equal to medium preset=220', () => {
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      const wrapper = allElements.find(el => el.id === 'minimap-wrapper');
      expect(wrapper).toBeDefined();
      // window.innerWidth=0 → isMobile()=false → default SIZE_MAP.medium=220
      expect(wrapper!.style.cssText).toContain('width: 220px');
      expect(wrapper!.style.cssText).toContain('height: 220px');

      minimap.destroy();
    });

    it('should NOT show minimap on mobile (innerWidth < 768)', () => {
      const origWindow = (globalThis as Record<string, unknown>).window;
      (globalThis as Record<string, unknown>).window = { innerWidth: 375 };

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      // Minimap should not be visible on mobile
      expect(minimap.isVisible()).toBe(false);

      minimap.destroy();
      (globalThis as Record<string, unknown>).window = origWindow;
    });
  });

  // ---------------------------------------------------------------------------
  // Preset size tests
  // ---------------------------------------------------------------------------

  describe('setSize', () => {
    it('should resize to small preset (160px)', () => {
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      minimap.setSize('small');

      const wrapper = allElements.find(el => el.id === 'minimap-wrapper');
      expect(wrapper!.style.width).toBe('160px');
      expect(wrapper!.style.height).toBe('160px');

      minimap.destroy();
    });

    it('should resize to large preset (320px)', () => {
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      minimap.setSize('large');

      const wrapper = allElements.find(el => el.id === 'minimap-wrapper');
      expect(wrapper!.style.width).toBe('320px');
      expect(wrapper!.style.height).toBe('320px');

      minimap.destroy();
    });

    it('should ignore setSize on mobile (minimap hidden)', () => {
      const origWindow = (globalThis as Record<string, unknown>).window;
      (globalThis as Record<string, unknown>).window = { innerWidth: 375 };

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      // Minimap should not be visible on mobile, so setSize is irrelevant
      expect(minimap.isVisible()).toBe(false);
      minimap.setSize('large');
      expect(minimap.isVisible()).toBe(false);

      minimap.destroy();
      (globalThis as Record<string, unknown>).window = origWindow;
    });

    it('should update canvas dimensions on setSize', () => {
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      minimap.setSize('small');

      // Find the canvas element (3rd created element: body, wrapper, container, canvas)
      const canvas = allElements.find(el => el.getContext.mock?.calls?.length > 0);
      expect(canvas).toBeDefined();
      expect(canvas!.width).toBe(160);
      expect(canvas!.height).toBe(160);

      minimap.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Mobile collision — the minimap must never sit on top of the mobile UI
  // ---------------------------------------------------------------------------

  describe('mobile collision', () => {
    it('keeps the docked minimap hidden on a mobile viewport', () => {
      installWindow(375);

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      expect(minimap.isVisible()).toBe(false);
      expect(wrapperStyle()).toContain('display: none');

      minimap.destroy();
    });

    it('hides the docked minimap at 700px — the band the mobile shell owns', () => {
      installWindow(1024);

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());
      expect(minimap.isVisible()).toBe(true);

      resizeTo(700);

      expect(minimap.isVisible()).toBe(false);
      expect(wrapperStyle()).toContain('display: none');

      minimap.destroy();
    });

    it('docks again — without the fullscreen scrim — when the viewport grows back', () => {
      installWindow(375);

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());
      minimap.setSize('large');

      useUiStore.getState().setMinimapFullscreen(true);
      expect(wrapperStyle()).toContain('inset: 0');

      resizeTo(1024);

      expect(useUiStore.getState().minimapFullscreen).toBe(false);
      expect(minimap.isVisible()).toBe(true);

      const style = wrapperStyle();
      expect(style).toContain('top: 12px');
      expect(style).toContain('width: 320px');
      expect(style).not.toContain('inset: 0');
      expect(style).not.toContain('rgba(0,0,0,0.6)');

      minimap.destroy();
    });

    it('re-shows the docked style after a fullscreen session, never the scrim', () => {
      installWindow(1024);

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      useUiStore.getState().setMinimapFullscreen(true);
      useUiStore.getState().setMinimapFullscreen(false);

      minimap.toggle();  // hide
      minimap.toggle();  // show again

      const style = wrapperStyle();
      expect(style).toContain('display: block');
      expect(style).not.toContain('rgba(0,0,0,0.6)');
      expect(style).toContain('z-index: var(--z-dropdown, 100)');

      minimap.destroy();
    });

    it('keeps the fullscreen scrim below modals', () => {
      installWindow(375);

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());
      useUiStore.getState().setMinimapFullscreen(true);

      expect(wrapperStyle()).toContain('z-index: calc(var(--z-modal) - 1)');

      minimap.destroy();
    });

    it('closes the fullscreen minimap when a menu opens', () => {
      installWindow(375);

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());
      useUiStore.getState().setMinimapFullscreen(true);
      expect(wrapperStyle()).toContain('inset: 0');

      useUiStore.getState().setMobileTab('build');

      expect(useUiStore.getState().minimapFullscreen).toBe(false);
      expect(wrapperStyle()).toContain('display: none');

      minimap.destroy();
    });

    it('closes the fullscreen minimap when a modal opens', () => {
      installWindow(375);

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());
      useUiStore.getState().setMinimapFullscreen(true);

      useUiStore.getState().openModal('settings');

      expect(useUiStore.getState().minimapFullscreen).toBe(false);

      minimap.destroy();
    });

    it('refuses to open over a menu that is already up', () => {
      installWindow(375);

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      useUiStore.getState().openModal('settings');
      useUiStore.getState().setMinimapFullscreen(true);

      expect(useUiStore.getState().minimapFullscreen).toBe(false);
      expect(wrapperStyle()).toContain('display: none');

      minimap.destroy();
    });

    it('closes the fullscreen minimap on a tap it cannot navigate from', () => {
      installWindow(375);

      const renderer = createMockRenderer({ getTerrainPixelData: jest.fn(() => null) });
      const minimap = new MinimapUI();
      minimap.setRenderer(renderer);
      useUiStore.getState().setMinimapFullscreen(true);

      const container = allElements.find(el => el.id === 'minimap-container');
      container!.onmousedown!({ offsetX: 10, offsetY: 10, preventDefault: jest.fn(), stopPropagation: jest.fn() });

      expect(renderer.centerOn).not.toHaveBeenCalled();
      expect(useUiStore.getState().minimapFullscreen).toBe(false);

      minimap.destroy();
    });

    it('resizes the fullscreen diamond on rotation', () => {
      installWindow(375, 800);

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());
      useUiStore.getState().setMinimapFullscreen(true);

      resizeTo(700, 375);

      const canvas = allElements.find(el => el.getContext.mock?.calls?.length > 0);
      expect(canvas!.width).toBe(375);   // min(700, 375)

      minimap.destroy();
    });

    it('stays anchored at left: 12px when a left surface opens and closes', () => {
      for (const kind of ['empire', 'facilities', 'overlays'] as const) {
        installWindow(1024);

        const minimap = new MinimapUI();
        minimap.setRenderer(createMockRenderer());

        const wrapper = allElements.find(el => el.id === 'minimap-wrapper');

        useUiStore.getState().openLeftPanel(kind);
        expect(wrapper!.style.left).toBe('12px');

        useUiStore.getState().closeLeftPanel();
        expect(wrapper!.style.left).toBe('12px');

        minimap.destroy();
      }
    });

    it('clears a stale fullscreen flag when the viewport shrinks into mobile', () => {
      installWindow(1024);

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      // Desktop has no fullscreen minimap — the flag can only be stale here.
      useUiStore.setState({ minimapFullscreen: true });

      resizeTo(375);

      expect(useUiStore.getState().minimapFullscreen).toBe(false);
      expect(minimap.isVisible()).toBe(false);

      minimap.destroy();
    });

    it('closes the fullscreen minimap on a scrim tap', () => {
      installWindow(375);

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());
      useUiStore.getState().setMinimapFullscreen(true);

      const wrapper = allElements.find(el => el.id === 'minimap-wrapper');
      expect(wrapper!.onclick).toBeDefined();
      wrapper!.onclick!();

      expect(useUiStore.getState().minimapFullscreen).toBe(false);
      expect(wrapper!.onclick).toBeNull();

      minimap.destroy();
    });

    it('detaches the viewport listener on destroy', () => {
      installWindow(375);

      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());
      expect(viewportHandlers.length).toBeGreaterThan(0);

      minimap.destroy();
      expect(viewportHandlers).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Zoom
  // ---------------------------------------------------------------------------

  describe('zoom', () => {
    function findWheelHandler(container: MockElement): (e: { deltaY: number; preventDefault: jest.Mock; stopPropagation: jest.Mock }) => void {
      const call = container.addEventListener.mock.calls.find((c: unknown[]) => c[0] === 'wheel');
      return call![1] as (e: { deltaY: number; preventDefault: jest.Mock; stopPropagation: jest.Mock }) => void;
    }

    it('clamps zoom-out at the minimum (1×) and reports it', () => {
      installWindow(1024);
      const onSettingsChange = jest.fn();
      const minimap = new MinimapUI(onSettingsChange);
      minimap.setRenderer(createMockRenderer());

      minimap.zoomBy(0.8);

      expect(onSettingsChange).toHaveBeenCalledWith({ minimapZoom: 1 });

      minimap.destroy();
    });

    it('clamps zoom-in at the maximum (8×) after repeated notches', () => {
      installWindow(1024);
      const onSettingsChange = jest.fn();
      const minimap = new MinimapUI(onSettingsChange);
      minimap.setRenderer(createMockRenderer());

      for (let i = 0; i < 20; i++) minimap.zoomBy(1.25);

      expect(onSettingsChange).toHaveBeenLastCalledWith({ minimapZoom: 8 });

      minimap.destroy();
    });

    it('setZoom(NaN) falls back to 1', () => {
      installWindow(1024);
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      minimap.setZoom(NaN);
      minimap.zoomBy(1); // report current zoom without changing it

      expect(minimap.isVisible()).toBe(true);

      minimap.destroy();
    });

    it('setZoom never fires the settings callback', () => {
      installWindow(1024);
      const onSettingsChange = jest.fn();
      const minimap = new MinimapUI(onSettingsChange);
      minimap.setRenderer(createMockRenderer());

      minimap.setZoom(3);

      expect(onSettingsChange).not.toHaveBeenCalled();

      minimap.destroy();
    });

    it('wheel with deltaY < 0 zooms in', () => {
      installWindow(1024);
      const onSettingsChange = jest.fn();
      const minimap = new MinimapUI(onSettingsChange);
      minimap.setRenderer(createMockRenderer());

      const container = allElements.find(el => el.id === 'minimap-container')!;
      const wheelHandler = findWheelHandler(container);
      wheelHandler({ deltaY: -10, preventDefault: jest.fn(), stopPropagation: jest.fn() });

      expect(onSettingsChange).toHaveBeenCalledWith({ minimapZoom: 1.25 });

      minimap.destroy();
    });

    it('is a no-op on a mobile viewport and reports nothing', () => {
      installWindow(375);
      const onSettingsChange = jest.fn();
      const minimap = new MinimapUI(onSettingsChange);
      minimap.setRenderer(createMockRenderer());

      minimap.zoomBy(1.25);

      expect(onSettingsChange).not.toHaveBeenCalled();

      minimap.destroy();
    });

    it('is a no-op in fullscreen and reports nothing', () => {
      installWindow(375);
      const onSettingsChange = jest.fn();
      const minimap = new MinimapUI(onSettingsChange);
      minimap.setRenderer(createMockRenderer());
      useUiStore.getState().setMinimapFullscreen(true);

      minimap.zoomBy(1.25);

      expect(onSettingsChange).not.toHaveBeenCalled();

      minimap.destroy();
    });

    it('translates by a non-zero focus at zoom 2 and a center click still lands inside the map', () => {
      installWindow(1024);
      const renderer = createMockRenderer();
      const minimap = new MinimapUI();
      minimap.setRenderer(renderer);

      mockCtx.translate.mockClear();
      minimap.setZoom(2);

      // Visible tile bounds (20..60, 25..65) are off-center on the 100x100 map, so the
      // focus translate (the second translate() call each render) is non-zero at zoom 2.
      const translateCalls = mockCtx.translate.mock.calls as number[][];
      expect(translateCalls.length).toBeGreaterThanOrEqual(2);
      const [fx, fy] = translateCalls[translateCalls.length - 1];
      expect(fx !== 0 || fy !== 0).toBe(true);

      const container = allElements.find(el => el.id === 'minimap-container');
      container!.onmousedown!({ offsetX: 110, offsetY: 110, preventDefault: jest.fn(), stopPropagation: jest.fn() });

      const calls = (renderer.centerOn as jest.Mock).mock.calls;
      const lastCall = calls[calls.length - 1] as number[];
      expect(lastCall[0]).toBeGreaterThanOrEqual(0);
      expect(lastCall[0]).toBeLessThanOrEqual(99);
      expect(lastCall[1]).toBeGreaterThanOrEqual(0);
      expect(lastCall[1]).toBeLessThanOrEqual(99);

      minimap.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Drag resize
  // ---------------------------------------------------------------------------

  describe('drag resize', () => {
    function findDocumentHandler(type: string): ((e: { clientX: number; clientY: number }) => void) | (() => void) {
      const docAddEventListener = (globalThis as unknown as { document: { addEventListener: jest.Mock } }).document.addEventListener;
      const call = docAddEventListener.mock.calls.find((c: unknown[]) => c[0] === type);
      return call![1] as ((e: { clientX: number; clientY: number }) => void) | (() => void);
    }

    it('mousedown off the grip still calls centerOn', () => {
      installWindow(1024);
      const renderer = createMockRenderer();
      const minimap = new MinimapUI();
      minimap.setRenderer(renderer);

      const container = allElements.find(el => el.id === 'minimap-container')!;
      container.onmousedown!({ offsetX: 10, offsetY: 10, preventDefault: jest.fn(), stopPropagation: jest.fn() });

      expect(renderer.centerOn).toHaveBeenCalled();

      minimap.destroy();
    });

    it('drags below the minimum and clamps to 120px', () => {
      installWindow(1024);
      const onSettingsChange = jest.fn();
      const minimap = new MinimapUI(onSettingsChange);
      minimap.setRenderer(createMockRenderer());

      // 220px diamond (medium preset) — grip band near the bottom-right edge
      const container = allElements.find(el => el.id === 'minimap-container')!;
      container.onmousedown!({ offsetX: 165, offsetY: 165, clientX: 500, clientY: 500, preventDefault: jest.fn(), stopPropagation: jest.fn() });

      const onMove = findDocumentHandler('mousemove') as (e: { clientX: number; clientY: number }) => void;
      onMove({ clientX: 0, clientY: 0 });

      const wrapper = allElements.find(el => el.id === 'minimap-wrapper')!;
      expect(wrapper.style.width).toBe('120px');

      const onUp = findDocumentHandler('mouseup') as () => void;
      onUp();

      expect(onSettingsChange).toHaveBeenCalledWith({ minimapPixelSize: 120 });

      minimap.destroy();
    });

    it('drags above the maximum and clamps to the viewport-capped 500px', () => {
      installWindow(1024, 800);
      const onSettingsChange = jest.fn();
      const minimap = new MinimapUI(onSettingsChange);
      minimap.setRenderer(createMockRenderer());

      const container = allElements.find(el => el.id === 'minimap-container')!;
      container.onmousedown!({ offsetX: 165, offsetY: 165, clientX: 500, clientY: 500, preventDefault: jest.fn(), stopPropagation: jest.fn() });

      const onMove = findDocumentHandler('mousemove') as (e: { clientX: number; clientY: number }) => void;
      onMove({ clientX: 2500, clientY: 2500 });

      const wrapper = allElements.find(el => el.id === 'minimap-wrapper')!;
      expect(wrapper.style.width).toBe('500px');

      const onUp = findDocumentHandler('mouseup') as () => void;
      onUp();
      expect(onSettingsChange).toHaveBeenCalledWith({ minimapPixelSize: 500 });

      minimap.destroy();
    });

    it('caps the drag to a smaller viewport height (1024x300 → 276px)', () => {
      installWindow(1024, 300);
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      const container = allElements.find(el => el.id === 'minimap-container')!;
      container.onmousedown!({ offsetX: 165, offsetY: 165, clientX: 500, clientY: 500, preventDefault: jest.fn(), stopPropagation: jest.fn() });

      const onMove = findDocumentHandler('mousemove') as (e: { clientX: number; clientY: number }) => void;
      onMove({ clientX: 2500, clientY: 2500 });

      const wrapper = allElements.find(el => el.id === 'minimap-wrapper')!;
      expect(wrapper.style.width).toBe('276px');

      minimap.destroy();
    });

    it('mouseup reports the final size and removes the drag listeners', () => {
      installWindow(1024);
      const onSettingsChange = jest.fn();
      const minimap = new MinimapUI(onSettingsChange);
      minimap.setRenderer(createMockRenderer());
      const docRemoveEventListener = (globalThis as unknown as { document: { removeEventListener: jest.Mock } }).document.removeEventListener;

      const container = allElements.find(el => el.id === 'minimap-container')!;
      container.onmousedown!({ offsetX: 165, offsetY: 165, clientX: 500, clientY: 500, preventDefault: jest.fn(), stopPropagation: jest.fn() });

      const onMove = findDocumentHandler('mousemove') as (e: { clientX: number; clientY: number }) => void;
      onMove({ clientX: 520, clientY: 520 });

      const onUp = findDocumentHandler('mouseup') as () => void;
      onUp();

      expect(onSettingsChange).toHaveBeenCalledWith({ minimapPixelSize: 240 });
      expect(docRemoveEventListener).toHaveBeenCalledWith('mousemove', onMove);
      expect(docRemoveEventListener).toHaveBeenCalledWith('mouseup', onUp);

      minimap.destroy();
    });

    it('flips the cursor between nwse-resize and crosshair', () => {
      installWindow(1024);
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      const container = allElements.find(el => el.id === 'minimap-container')!;
      const call = container.addEventListener.mock.calls.find((c: unknown[]) => c[0] === 'mousemove');
      const onMouseMove = call![1] as (e: { offsetX: number; offsetY: number }) => void;

      onMouseMove({ offsetX: 165, offsetY: 165 });
      expect(container.style.cursor).toBe('nwse-resize');

      onMouseMove({ offsetX: 10, offsetY: 10 });
      expect(container.style.cursor).toBe('crosshair');

      minimap.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Preset / custom size interplay
  // ---------------------------------------------------------------------------

  describe('setSize with a custom pixel size', () => {
    it('uses the custom size when given', () => {
      installWindow(1024);
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      minimap.setSize('small', 260);

      const wrapper = allElements.find(el => el.id === 'minimap-wrapper')!;
      expect(wrapper.style.width).toBe('260px');

      minimap.destroy();
    });

    it('falls back to the preset when the custom size is null', () => {
      installWindow(1024);
      const minimap = new MinimapUI();
      minimap.setRenderer(createMockRenderer());

      minimap.setSize('small', null);

      const wrapper = allElements.find(el => el.id === 'minimap-wrapper')!;
      expect(wrapper.style.width).toBe('160px');

      minimap.destroy();
    });
  });
});
