/** @jest-environment jsdom */
import {
  buildMinimapOverlay,
  dimColor,
  minimapCellColor,
  zoneColor,
  MINIMAP_CONCRETE_COLOR,
  MINIMAP_LOSING_COLOR,
  MINIMAP_ROAD_COLOR,
  MINIMAP_SELECTED_COLOR,
  type MinimapOverlaySource,
} from './minimap-paint';
import type { TerrainColormap } from './minimap-colormap';
import type { MapBuilding } from '@/shared/types';

const MY_ID = 37;

function building(overrides: Partial<MapBuilding> = {}): MapBuilding {
  return { visualClass: '1', tycoonId: MY_ID, options: 0, x: 5, y: 5, level: 0, alert: false, attack: 0, ...overrides };
}

describe('minimapCellColor — the legacy priority chain (Map.pas:3855-3918)', () => {
  it('the selected tile wins even over an own losing building', () => {
    expect(minimapCellColor({ selected: true, building: building({ alert: true }) }, MY_ID)).toBe(MINIMAP_SELECTED_COLOR);
  });

  it('an own losing building is red', () => {
    expect(minimapCellColor({ building: building({ alert: true }) }, MY_ID)).toBe(MINIMAP_LOSING_COLOR);
  });

  it('an own building takes its zone colour undimmed', () => {
    expect(minimapCellColor({ building: building(), zoneType: 6 }, MY_ID)).toBe('#D7D988'); // Industrial
  });

  it("another company's building takes the dimmed zone colour, even when it is losing money", () => {
    expect(minimapCellColor({ building: building({ tycoonId: 99, alert: true }), zoneType: 6 }, MY_ID)).toBe(dimColor('#D7D988'));
  });

  it('a class with no zone takes the Commercial colour', () => {
    expect(minimapCellColor({ building: building() }, MY_ID)).toBe('#4974D8');
    expect(minimapCellColor({ building: building(), zoneType: 0 }, MY_ID)).toBe('#4974D8');
  });

  it('zones 8 and 9 (past the eight-entry Delphi array) take Civics / Offices', () => {
    expect(minimapCellColor({ building: building(), zoneType: 8 }, MY_ID)).toBe('#FFFFFF');
    expect(minimapCellColor({ building: building(), zoneType: 9 }, MY_ID)).toBe('#394488');
  });

  it('empty ground with a road takes the road colour', () => {
    expect(minimapCellColor({ hasRoad: true }, MY_ID)).toBe(MINIMAP_ROAD_COLOR);
  });

  it('empty ground with concrete alone takes the concrete colour', () => {
    expect(minimapCellColor({ hasConcrete: true }, MY_ID)).toBe(MINIMAP_CONCRETE_COLOR);
  });

  it('bare ground is left to the terrain', () => {
    expect(minimapCellColor({}, MY_ID)).toBeNull();
  });
});

describe('zoneColor', () => {
  it('returns undefined-zone class as Commercial', () => {
    expect(zoneColor(undefined)).toBe('#4974D8');
  });
});

describe('dimColor — DimColor, Map.pas:3818-3828', () => {
  it('subtracts R-30 G-59 B-11', () => {
    expect(dimColor('#D7D988')).toBe('#b99e7d');
  });

  it('clamps at 0 where Delphi let a byte wrap', () => {
    expect(dimColor('#000000')).toBe('#000000');
  });
});

describe('buildMinimapOverlay', () => {
  const cm: TerrainColormap = {
    canvas: document.createElement('canvas'),
    width: 10,
    height: 10,
    mapWidth: 10,
    mapHeight: 10,
  };

  function source(overrides: Partial<MinimapOverlaySource> = {}): MinimapOverlaySource {
    return {
      buildings: [],
      roads: [],
      concrete: [],
      selected: null,
      myTycoonId: MY_ID,
      zoneOf: () => undefined,
      ...overrides,
    };
  }

  const origGetContext = HTMLCanvasElement.prototype.getContext;
  let fills: Array<{ x: number; y: number; style: string }>;

  beforeEach(() => {
    fills = [];
    const ctx = {
      get fillStyle() { return this._fillStyle; },
      set fillStyle(v: string) { this._fillStyle = v; },
      _fillStyle: '',
      fillRect(x: number, y: number) { fills.push({ x, y, style: ctx._fillStyle }); },
    };
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx) as never;
  });
  afterEach(() => { HTMLCanvasElement.prototype.getContext = origGetContext; });

  it('sizes the canvas to the colormap', () => {
    const canvas = buildMinimapOverlay(cm, source());
    expect(canvas!.width).toBe(10);
    expect(canvas!.height).toBe(10);
  });

  it('paints concrete, then roads, then buildings, so a road wins over concrete on the same tile', () => {
    buildMinimapOverlay(cm, source({
      concrete: [{ x: 3, y: 3 }],
      roads: [{ x: 3, y: 3 }],
    }));
    // (3,3) on a 10x10 colormap lands at colormap pixel (7,7) — tileToColormap flips both axes.
    expect(fills).toEqual([
      { x: 7, y: 7, style: MINIMAP_CONCRETE_COLOR },
      { x: 7, y: 7, style: MINIMAP_ROAD_COLOR },
    ]);
  });

  it('calls zoneOf with the building visual class and paints its colour', () => {
    const zoneOf = jest.fn(() => 6);
    buildMinimapOverlay(cm, source({ buildings: [building({ visualClass: '42' })], zoneOf }));
    expect(zoneOf).toHaveBeenCalledWith('42');
    expect(fills).toEqual([{ x: 5, y: 5, style: '#D7D988' }]);
  });

  it('returns null when the canvas has no 2D context', () => {
    HTMLCanvasElement.prototype.getContext = jest.fn(() => null) as never;
    expect(buildMinimapOverlay(cm, source())).toBeNull();
  });
});
