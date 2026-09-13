/** @jest-environment jsdom */
import { buildTerrainColormap, colormapToTile, landColor, sampleAtlasColors, tileToColormap, tileToColormapPixel, FALLBACK_COLORS } from './minimap-colormap';

type Ctx2D = { createImageData: (w: number, h: number) => { data: Uint8ClampedArray }; putImageData: jest.Mock; drawImage: jest.Mock; getImageData: jest.Mock };

function fakeContext(getImageDataPixels?: Uint8ClampedArray): Ctx2D {
  return {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: jest.fn(),
    drawImage: jest.fn(),
    getImageData: jest.fn(() => ({ data: getImageDataPixels ?? new Uint8ClampedArray(0) })),
  };
}

describe('minimap colormap', () => {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  afterEach(() => { HTMLCanvasElement.prototype.getContext = origGetContext; });

  it('falls back to the land-class colour without an atlas', () => {
    expect(landColor(0, null)).toEqual(FALLBACK_COLORS[0]);
    expect(landColor(3 << 6, null)).toEqual(FALLBACK_COLORS[3]);
    expect(landColor(7, new Map([[7, [1, 2, 3]]]))).toEqual([1, 2, 3]);
  });

  it('builds a colormap sized to the map (swapped axes) and maps tiles both ways', () => {
    const ctx = fakeContext();
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx) as never;
    const width = 40, height = 20;
    const cm = buildTerrainColormap(new Uint8Array(width * height), width, height, null);
    expect(cm).not.toBeNull();
    expect(cm!.width).toBe(height);
    expect(cm!.height).toBe(width);
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
    // tile (x=0,y=0) → far corner; round-trips within a tile
    const p = tileToColormap(cm!, 10, 5);
    const back = colormapToTile(cm!, p.cx, p.cy);
    expect(back).toEqual({ x: 10, y: 5 });
    expect(colormapToTile(cm!, -50, -50)).toEqual({ x: width - 1, y: height - 1 });
    expect(colormapToTile(cm!, 10_000, 10_000)).toEqual({ x: 0, y: 0 });
  });

  it('downsamples large maps to at most 128 per side', () => {
    HTMLCanvasElement.prototype.getContext = jest.fn(() => fakeContext()) as never;
    const cm = buildTerrainColormap(new Uint8Array(2000 * 2000), 2000, 2000, null);
    expect(cm!.width).toBeLessThanOrEqual(128);
  });

  it('maps a tile to the colormap pixel that holds it, and clamps out-of-map input', () => {
    const cm40 = { width: 40, height: 40, mapWidth: 40, mapHeight: 40 };
    expect(tileToColormapPixel(cm40, 0, 0)).toEqual({ px: 39, py: 39 });
    expect(tileToColormapPixel(cm40, 39, 39)).toEqual({ px: 0, py: 0 });

    const cm2000 = { width: 125, height: 125, mapWidth: 2000, mapHeight: 2000 };
    expect(tileToColormapPixel(cm2000, 0, 0)).toEqual({ px: 124, py: 124 });
    expect(tileToColormapPixel(cm2000, 1999, 1999)).toEqual({ px: 0, py: 0 });

    expect(tileToColormapPixel(cm40, -50, -50)).toEqual({ px: 39, py: 39 });
    expect(tileToColormapPixel(cm40, 10_000, 10_000)).toEqual({ px: 0, py: 0 });
  });

  it('returns null without a 2D context, and samples atlas centres when it has one', () => {
    HTMLCanvasElement.prototype.getContext = jest.fn(() => null) as never;
    expect(buildTerrainColormap(new Uint8Array(4), 2, 2, null)).toBeNull();
    expect(sampleAtlasColors({ width: 2, height: 2 } as ImageBitmap, { tiles: {} } as never)).toBeNull();
    const pixels = new Uint8ClampedArray(2 * 2 * 4);
    pixels.set([9, 8, 7, 255], (1 * 2 + 1) * 4);
    HTMLCanvasElement.prototype.getContext = jest.fn(() => fakeContext(pixels)) as never;
    const colors = sampleAtlasColors({ width: 2, height: 2 } as ImageBitmap, { tiles: { 5: { x: 1, y: 1, width: 1, height: 1 } } } as never);
    expect(colors?.get(5)).toEqual([9, 8, 7]);
  });
});
