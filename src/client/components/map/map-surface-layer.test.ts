/** @jest-environment jsdom */
import {
  buildDataLayer,
  dimColor,
  tileColor,
  CONCRETE_RGB,
  LOSING_RGB,
  ROAD_RGB,
  SELECTED_RGB,
  UNKNOWN_FOREIGN_RGB,
  UNKNOWN_OWN_RGB,
  ZONE_RGB,
} from './map-surface-layer';
import type { MapBuilding, MapSegment } from '@/shared/types';
import type { TerrainColormap } from '../../ui/minimap-colormap';

type Ctx2D = { createImageData: (w: number, h: number) => { data: Uint8ClampedArray }; putImageData: jest.Mock; drawImage: jest.Mock; getImageData: jest.Mock };

function fakeContext(): Ctx2D {
  return {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: jest.fn(),
    drawImage: jest.fn(),
    getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(0) })),
  };
}

function building(over: Partial<MapBuilding>): MapBuilding {
  return { visualClass: '1', tycoonId: 0, options: 0, x: 0, y: 0, level: 0, alert: false, attack: 0, ...over };
}

describe('map-surface-layer', () => {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  afterEach(() => { HTMLCanvasElement.prototype.getContext = origGetContext; });

  describe('dimColor', () => {
    it('subtracts, clamped at 0 instead of wrapping', () => {
      expect(dimColor([0, 128, 128])).toEqual([0, 69, 117]);
      expect(dimColor([10, 5, 2])).toEqual([0, 0, 0]);
    });
  });

  describe('tileColor', () => {
    const myTycoonId = 37;

    it('selected beats an own losing building', () => {
      const f = { selected: true, building: building({ tycoonId: myTycoonId, alert: true }), zoneType: 2 };
      expect(tileColor(f, myTycoonId)).toEqual(SELECTED_RGB);
    });

    it('an own losing building is red', () => {
      const f = { building: building({ tycoonId: myTycoonId, alert: true }), zoneType: 2 };
      expect(tileColor(f, myTycoonId)).toEqual(LOSING_RGB);
    });

    it('an own zone-2 building is the full zone colour', () => {
      const f = { building: building({ tycoonId: myTycoonId }), zoneType: 2 };
      expect(tileColor(f, myTycoonId)).toEqual(ZONE_RGB[2]);
    });

    it('a foreign zone-2 building is the dimmed zone colour', () => {
      const f = { building: building({ tycoonId: 99 }), zoneType: 2 };
      expect(tileColor(f, myTycoonId)).toEqual(dimColor(ZONE_RGB[2]));
    });

    it('a foreign losing building is not red — dimmed class colour', () => {
      const f = { building: building({ tycoonId: 99, alert: true }), zoneType: 2 };
      expect(tileColor(f, myTycoonId)).toEqual(dimColor(ZONE_RGB[2]));
      expect(tileColor(f, myTycoonId)).not.toEqual(LOSING_RGB);
    });

    it('zone 0 falls back to the commercial colour', () => {
      const f = { building: building({ tycoonId: myTycoonId }), zoneType: 0 };
      expect(tileColor(f, myTycoonId)).toEqual(ZONE_RGB[7]);
    });

    it('zones 8 and 9 have their own table entries', () => {
      expect(tileColor({ building: building({ tycoonId: myTycoonId }), zoneType: 8 }, myTycoonId)).toEqual(ZONE_RGB[8]);
      expect(tileColor({ building: building({ tycoonId: myTycoonId }), zoneType: 9 }, myTycoonId)).toEqual(ZONE_RGB[9]);
    });

    it('an unknown class keeps the two greys, own vs. foreign', () => {
      expect(tileColor({ building: building({ tycoonId: myTycoonId }) }, myTycoonId)).toEqual(UNKNOWN_OWN_RGB);
      expect(tileColor({ building: building({ tycoonId: 99 }) }, myTycoonId)).toEqual(UNKNOWN_FOREIGN_RGB);
    });

    it('a building beats road and concrete; road beats concrete', () => {
      const f = { building: building({ tycoonId: myTycoonId }), zoneType: 2, hasRoad: true, hasConcrete: true };
      expect(tileColor(f, myTycoonId)).toEqual(ZONE_RGB[2]);
      expect(tileColor({ hasRoad: true, hasConcrete: true }, myTycoonId)).toEqual(ROAD_RGB);
    });

    it('concrete alone, road alone, and bare ground', () => {
      expect(tileColor({ hasConcrete: true }, myTycoonId)).toEqual(CONCRETE_RGB);
      expect(tileColor({ hasRoad: true }, myTycoonId)).toEqual(ROAD_RGB);
      expect(tileColor({}, myTycoonId)).toBeNull();
    });

    it('myTycoonId = 0 never counts as own', () => {
      const f = { building: building({ tycoonId: 0, alert: true }), zoneType: 2 };
      expect(tileColor(f, 0)).toEqual(dimColor(ZONE_RGB[2]));
    });
  });

  describe('buildDataLayer', () => {
    const cm40 = (): TerrainColormap => ({ canvas: document.createElement('canvas'), width: 40, height: 40, mapWidth: 40, mapHeight: 40 });

    function pixelAt(data: Uint8ClampedArray, cw: number, px: number, py: number): [number, number, number, number] {
      const idx = (py * cw + px) * 4;
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
    }

    it('paints concrete, roads, buildings and the selection, and leaves empty ground transparent', () => {
      const ctx = fakeContext();
      HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx) as never;
      const cm = cm40();
      const segments: MapSegment[] = [{ x1: 10, y1: 5, x2: 13, y2: 5, unknown1: 0, unknown2: 0, unknown3: 0, unknown4: 0, unknown5: 0, unknown6: 0 }];
      const buildings: MapBuilding[] = [building({ visualClass: '1', tycoonId: 37, x: 20, y: 20 })];

      const canvas = buildDataLayer(cm, {
        buildings,
        segments,
        concreteTiles: ['6,6'],
        zoneOf: (vc) => (vc === '1' ? 2 : undefined),
        myTycoonId: 37,
        selection: { x: 20, y: 20, xsize: 1, ysize: 1 },
      });

      expect(canvas).not.toBeNull();
      expect(ctx.putImageData).toHaveBeenCalledTimes(1);
      const data = (ctx.putImageData.mock.calls[0][0] as { data: Uint8ClampedArray }).data;

      // Concrete tile (x=6, y=6)
      const concretePixel = pixelAt(data, cm.width, cm.mapHeight - 1 - 6, cm.mapWidth - 1 - 6);
      expect(concretePixel).toEqual([...CONCRETE_RGB, 255]);

      // Road tile (one of the four tiles on the segment, x=11, y=5)
      const roadPixel = pixelAt(data, cm.width, cm.mapHeight - 1 - 5, cm.mapWidth - 1 - 11);
      expect(roadPixel).toEqual([...ROAD_RGB, 255]);

      // Selection footprint (x=20, y=20) wins over the building sitting on the same tile
      const selPixel = pixelAt(data, cm.width, cm.mapHeight - 1 - 20, cm.mapWidth - 1 - 20);
      expect(selPixel).toEqual([...SELECTED_RGB, 255]);

      // Alpha 0 elsewhere
      expect(pixelAt(data, cm.width, 0, 0)[3]).toBe(0);
    });

    it('returns null when getContext yields null', () => {
      HTMLCanvasElement.prototype.getContext = jest.fn(() => null) as never;
      const cm = cm40();
      expect(buildDataLayer(cm, { buildings: [], segments: [], concreteTiles: [], zoneOf: () => undefined, myTycoonId: 0, selection: null })).toBeNull();
    });
  });
});
