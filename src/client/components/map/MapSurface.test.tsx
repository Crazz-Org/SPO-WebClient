import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useMapStore } from '../../store/map-store';
import { useEmpireStore } from '../../store/empire-store';
import { useGameStore } from '../../store/game-store';
import { useSearchStore } from '../../store/search-store';
import { useUiStore } from '../../store/ui-store';
import { useBuildingStore } from '../../store/building-store';
import { MapSurface } from './MapSurface';
import { tileColor, LOSING_RGB, ROAD_RGB, CONCRETE_RGB, ZONE_RGB } from './map-surface-layer';
import { nearestTown } from '@/shared/nearest-town';
import type { MinimapRendererAPI } from '../../ui/minimap-colormap';
import type { TownInfo, BuildingFocusInfo } from '@/shared/types';

const W = 40, H = 40;

// jsdom has no PointerEvent: without this, pointer events carry no clientX/clientY.
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, props: MouseEventInit & { pointerId?: number } = {}) {
    super(type, props);
    this.pointerId = props.pointerId ?? 0;
  }
}
(globalThis as unknown as { PointerEvent: unknown }).PointerEvent = FakePointerEvent;

function fakeCtx() {
  return {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: jest.fn(), drawImage: jest.fn(), getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(0) })),
    fillRect: jest.fn(), strokeRect: jest.fn(), save: jest.fn(), restore: jest.fn(), translate: jest.fn(), rotate: jest.fn(), scale: jest.fn(),
    fillStyle: '', strokeStyle: '', lineWidth: 1, imageSmoothingEnabled: true,
  };
}

function fakeSource(): MinimapRendererAPI & { centerOn: jest.Mock; camera: { x: number; y: number } } {
  const src = {
    camera: { x: 20, y: 20 },
    getCameraPosition() { return this.camera; },
    centerOn: jest.fn(),
    getMapDimensions: () => ({ width: W, height: H }),
    getMapName: () => 'planitia',
    getSeason: () => 0,
    getTerrainType: () => 'temperate',
    getVisibleTileBounds: () => ({ minI: 15, maxI: 25, minJ: 15, maxJ: 25 }),
    getTerrainPixelData: () => ({ pixelData: new Uint8Array(W * H), width: W, height: H }),
    getAllBuildings: () => [
      { visualClass: '1', tycoonId: 37, options: 0, x: 5, y: 5, level: 0, alert: false, attack: 0 },
      { visualClass: '2', tycoonId: 99, options: 1, x: 30, y: 30, level: 0, alert: true, attack: 0 },
    ],
    getAllSegments: () => [{ x1: 10, y1: 5, x2: 13, y2: 5, unknown1: 0, unknown2: 0, unknown3: 0, unknown4: 0, unknown5: 0, unknown6: 0 }],
    getConcreteTiles: () => new Set(['6,6']),
    getFacilityZone: (vc: string) => (vc === '1' ? 2 : undefined),
  };
  return src as never;
}

const TOWN_LIST: TownInfo[] = [
  { name: 'Helartia', iconUrl: '', mayor: 'SPO_test3', population: 1, unemploymentPercent: 0, qualityOfLife: 0, x: 10, y: 10, path: '', classId: 'TownHall' },
  { name: 'Faraway', iconUrl: '', mayor: null, population: 1, unemploymentPercent: 0, qualityOfLife: 0, x: 39, y: 0, path: '', classId: 'TownHall' },
];
const TOWNS = { towns: TOWN_LIST } as never;

describe('MapSurface', () => {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  const origRect = HTMLCanvasElement.prototype.getBoundingClientRect;
  let ctx: ReturnType<typeof fakeCtx>;

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 320 });
  });
  beforeEach(() => {
    ctx = fakeCtx();
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx) as never;
    HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320, x: 0, y: 0, toJSON: () => ({}) });
    useMapStore.getState().reset();
    useGameStore.setState({ tycoonId: '37', worldName: 'planitia', username: 'SPO_test3' });
    localStorage.clear();
    useUiStore.setState({ modal: null, promptPayload: null });
    useEmpireStore.getState().reset();
    useSearchStore.setState({ townsData: null, isLoading: false });
    useBuildingStore.getState().clearFocus();
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
    HTMLCanvasElement.prototype.getBoundingClientRect = origRect;
  });

  it('colours tiles in the legacy priority order: own losing red, class colour, road/concrete on empty ground; nearest town by Manhattan distance', () => {
    expect(tileColor({ building: { alert: true, tycoonId: 37 } as never, zoneType: 2 }, 37)).toEqual(LOSING_RGB);
    expect(tileColor({ building: { alert: false, tycoonId: 37 } as never, zoneType: 2 }, 37)).toEqual(ZONE_RGB[2]);
    expect(tileColor({ hasRoad: true }, 37)).toEqual(ROAD_RGB);
    expect(tileColor({ hasConcrete: true }, 37)).toEqual(CONCRETE_RGB);
    expect(nearestTown(TOWN_LIST, 12, 12)?.name).toBe('Helartia');
    expect(nearestTown(TOWN_LIST, 39, 2)?.name).toBe('Faraway');
    expect(nearestTown(undefined, 0, 0)).toBeNull();
  });

  it('says when the map is not ready, and asks for the towns once', () => {
    const onSearchMenuTowns = jest.fn();
    renderWithProviders(<MapSurface />, { clientCallbacks: createSpiedCallbacks({ onSearchMenuTowns }) });
    expect(screen.getByText('The map is not ready yet.')).toBeTruthy();
    expect(onSearchMenuTowns).toHaveBeenCalledTimes(1);
  });

  it('draws the terrain, the buildings and the viewport; a click jumps there and records the trip', () => {
    const src = fakeSource();
    useMapStore.getState().setSource(src);
    renderWithProviders(<MapSurface />);
    const canvas = screen.getByRole('img', { name: /World map/ });
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(ctx.strokeRect).toHaveBeenCalled();
    // centre of the canvas = centre of the map
    fireEvent.pointerDown(canvas, { clientX: 160, clientY: 160, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 160, clientY: 160, pointerId: 1 });
    expect(src.centerOn).toHaveBeenCalledTimes(1);
    const [x, y] = src.centerOn.mock.calls[0] as [number, number];
    expect(Math.abs(x - W / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(y - H / 2)).toBeLessThanOrEqual(1);
    expect(useMapStore.getState().history).toHaveLength(1);
    // outside the diamond: nothing happens
    fireEvent.pointerDown(canvas, { clientX: 2, clientY: 2, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 2, clientY: 2, pointerId: 1 });
    expect(src.centerOn).toHaveBeenCalledTimes(1);
  });

  it('Back / Next walk the history and move the camera; Nearest Town Hall arrives through the selecting path', () => {
    const src = fakeSource();
    useMapStore.getState().setSource(src);
    useMapStore.getState().recordPosition(0, 0);
    useMapStore.getState().recordPosition(30, 30);
    useSearchStore.setState({ townsData: TOWNS });
    const onNavigateToBuilding = jest.fn();
    renderWithProviders(<MapSurface />, { clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }) });
    const back = screen.getByRole('button', { name: /Back/ }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(back);
    expect(src.centerOn).toHaveBeenLastCalledWith(0, 0);
    expect((screen.getByRole('button', { name: /Back/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(src.centerOn).toHaveBeenLastCalledWith(30, 30);
    fireEvent.click(screen.getByRole('button', { name: /Nearest Town Hall/ }));
    expect(onNavigateToBuilding).toHaveBeenCalledWith(10, 10);
    expect(src.centerOn).toHaveBeenLastCalledWith(30, 30);
  });

  it('the Nearest Town Hall button is usable before the towns page has loaded', () => {
    const src = fakeSource();
    useMapStore.getState().setSource(src);
    const onSearchMenuTowns = jest.fn();
    const onNavigateToBuilding = jest.fn();
    renderWithProviders(<MapSurface />, { clientCallbacks: createSpiedCallbacks({ onSearchMenuTowns, onNavigateToBuilding }) });
    const button = screen.getByRole('button', { name: /Nearest Town Hall/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    // Once on mount (towns unloaded), once from the click.
    expect(onSearchMenuTowns).toHaveBeenCalledTimes(2);
    expect(onNavigateToBuilding).not.toHaveBeenCalled();

    act(() => useSearchStore.setState({ townsData: TOWNS }));
    expect(onNavigateToBuilding).toHaveBeenCalledTimes(1);
    expect(onNavigateToBuilding).toHaveBeenCalledWith(10, 10);
    expect(src.centerOn).not.toHaveBeenCalled();
    expect(useMapStore.getState().history).toHaveLength(1);

    fireEvent.click(button);
    expect(onSearchMenuTowns).toHaveBeenCalledTimes(2);
    expect(onNavigateToBuilding).toHaveBeenCalledTimes(2);
  });

  it('an empty town list arriving while pending clears the wait and navigates nowhere', () => {
    const src = fakeSource();
    useMapStore.getState().setSource(src);
    const onNavigateToBuilding = jest.fn();
    renderWithProviders(<MapSurface />, { clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }) });
    fireEvent.click(screen.getByRole('button', { name: /Nearest Town Hall/ }));
    act(() => useSearchStore.setState({ townsData: { towns: [] } as never }));
    expect(onNavigateToBuilding).not.toHaveBeenCalled();
    expect(src.centerOn).not.toHaveBeenCalled();
  });

  it('zooms with the wheel and the buttons (1× … 8×), pans by dragging when zoomed, resets', () => {
    useMapStore.getState().setSource(fakeSource());
    renderWithProviders(<MapSurface />);
    const canvas = screen.getByRole('img', { name: /World map/ });
    expect(screen.getByText('100%')).toBeTruthy();
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 160, clientY: 160 });
    expect(screen.getByText('125%')).toBeTruthy();
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('800%')).toBeTruthy();
    // drag pans, and a drag is not a click
    const src = useMapStore.getState().source as ReturnType<typeof fakeSource>;
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 140, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 140, clientY: 130, pointerId: 1 });
    expect(src.centerOn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByText('640%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(screen.getByText('100%')).toBeTruthy();
    fireEvent.wheel(canvas, { deltaY: 100, clientX: 160, clientY: 160 });
    expect(screen.getByText('100%')).toBeTruthy();
    fireEvent.pointerLeave(canvas);
  });

  it('shows the hovered tile, and redraws on its own clock', () => {
    jest.useFakeTimers();
    useMapStore.getState().setSource(fakeSource());
    renderWithProviders(<MapSurface />);
    const canvas = screen.getByRole('img', { name: /World map/ });
    fireEvent.pointerMove(canvas, { clientX: 160, clientY: 160, pointerId: 1 });
    expect(screen.getByText(/^\(\d+, \d+\)$/)).toBeTruthy();
    const before = (ctx.drawImage as jest.Mock).mock.calls.length;
    act(() => { jest.advanceTimersByTime(1100); });
    expect((ctx.drawImage as jest.Mock).mock.calls.length).toBeGreaterThan(before);
    jest.useRealTimers();
  });

  it('paints the data layer once per tick, not per pointer move', () => {
    jest.useFakeTimers();
    useMapStore.getState().setSource(fakeSource());
    renderWithProviders(<MapSurface />);
    const canvas = screen.getByRole('img', { name: /World map/ });
    const puts = () => (ctx.putImageData as jest.Mock).mock.calls.length;
    const afterMount = puts();
    fireEvent.pointerMove(canvas, { clientX: 150, clientY: 150, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 160, clientY: 160, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 170, clientY: 170, pointerId: 1 });
    expect(puts()).toBe(afterMount);
    act(() => { jest.advanceTimersByTime(1100); });
    expect(puts()).toBeGreaterThan(afterMount);
    jest.useRealTimers();
  });

  it('marks the selected tile and follows the selection', () => {
    useMapStore.getState().setSource(fakeSource());
    renderWithProviders(<MapSurface />);
    const strokes = () => (ctx.strokeRect as jest.Mock).mock.calls.length;
    const puts = () => (ctx.putImageData as jest.Mock).mock.calls.length;
    const beforeFocus = strokes();
    const putsBeforeFocus = puts();

    act(() => useBuildingStore.getState().setFocus({
      buildingId: '1', buildingName: '', ownerName: '', salesInfo: '', revenue: '',
      detailsText: '', hintsText: '', x: 5, y: 5, xsize: 1, ysize: 1, visualClass: '1',
    } as BuildingFocusInfo));
    const afterFocus = strokes();
    expect(afterFocus - beforeFocus).toBe(2); // viewport rectangle + the selection ring
    expect(puts()).toBeGreaterThan(putsBeforeFocus); // the layer key changed with the selection

    act(() => useBuildingStore.getState().clearFocus());
    expect(strokes() - afterFocus).toBe(1); // back to the viewport rectangle only
  });

  it('the legend shows the class/zone colours, not the old ownership-only ones', () => {
    useMapStore.getState().setSource(fakeSource());
    renderWithProviders(<MapSurface />);
    expect(screen.getByText('Selected')).toBeTruthy();
    expect(screen.getByText('Road')).toBeTruthy();
    expect(screen.queryByText('Mine')).toBeNull();
    expect(screen.queryByText('Others')).toBeNull();
  });

  it('bookmarks: the server list is asked for, and add / go / rename / delete go to the Favorites tree', () => {
    const src = fakeSource();
    useMapStore.getState().setSource(src);
    const onRequestFacilities = jest.fn();
    const onAddFavorite = jest.fn();
    const onRenameFavorite = jest.fn();
    const onRemoveFavorite = jest.fn();
    renderWithProviders(<MapSurface />, {
      clientCallbacks: createSpiedCallbacks({ onRequestFacilities, onAddFavorite, onRenameFavorite, onRemoveFavorite }),
    });

    expect(onRequestFacilities).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/No bookmarks yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Bookmark this place/ }));
    const prompt = useUiStore.getState().promptPayload;
    expect(prompt?.title).toBe('Bookmark this place');
    expect(prompt?.defaultValue).toBe('(20, 20)');
    act(() => prompt?.onSubmit('  Home '));
    expect(onAddFavorite).toHaveBeenCalledWith('Home', 20, 20);

    // Nothing appears until the server answers — the list is the tree, not a local guess.
    expect(screen.getByText(/No bookmarks yet/)).toBeTruthy();
    act(() => useEmpireStore.getState().setFacilities([{ id: 4211, name: 'Home', x: 20, y: 20, path: '4211' }]));

    fireEvent.click(screen.getByRole('button', { name: /Go to Home/ }));
    expect(src.centerOn).toHaveBeenLastCalledWith(20, 20);

    fireEvent.click(screen.getByRole('button', { name: 'Rename Home' }));
    act(() => useUiStore.getState().promptPayload?.onSubmit('Base'));
    expect(onRenameFavorite).toHaveBeenCalledWith('4211', 'Base');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Home' }));
    expect(onRemoveFavorite).toHaveBeenCalledWith('4211', 'Home');
  });

  it('an empty name falls back to the coordinates, and an empty rename is not sent', () => {
    const src = fakeSource();
    useMapStore.getState().setSource(src);
    const onAddFavorite = jest.fn();
    const onRenameFavorite = jest.fn();
    renderWithProviders(<MapSurface />, { clientCallbacks: createSpiedCallbacks({ onAddFavorite, onRenameFavorite }) });
    act(() => useEmpireStore.getState().setFacilities([{ id: 4211, name: 'Home', x: 20, y: 20, path: '4211' }]));

    fireEvent.click(screen.getByRole('button', { name: /Bookmark this place/ }));
    act(() => useUiStore.getState().promptPayload?.onSubmit('   '));
    expect(onAddFavorite).toHaveBeenCalledWith('(20, 20)', 20, 20);

    fireEvent.click(screen.getByRole('button', { name: 'Rename Home' }));
    act(() => useUiStore.getState().promptPayload?.onSubmit('   '));
    expect(onRenameFavorite).not.toHaveBeenCalled();
  });
});
