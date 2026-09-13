/**
 * `pickBuildingTexture`, `overlayFillColor`, `setBuildingAnimationsEnabled` and
 * `setTransparentOverlays` on IsometricMapRenderer — private methods exercised via
 * prototype `.call()` (same pattern as renderer-input.test.ts).
 */

import { describe, it, expect, jest } from '@jest/globals';
import { IsometricMapRenderer } from './isometric-map-renderer';

const proto = IsometricMapRenderer.prototype as unknown as Record<
  string,
  (...args: unknown[]) => unknown
>;

describe('pickBuildingTexture', () => {
  const staticFrame = { id: 'static' } as unknown as ImageBitmap;
  const animatedTexture = { id: 'anim-tex' };
  const animatedFrame = { id: 'animated' } as unknown as ImageBitmap;

  function makeFake(hasAnimated: boolean) {
    const gameObjectTextureCache = {
      getTextureSync: jest.fn(() => staticFrame),
      getAnimatedTexture: jest.fn(() => (hasAnimated ? animatedTexture : null)),
      getAnimatedFrame: jest.fn(() => animatedFrame),
    };
    return { gameObjectTextureCache, hasAnimatedBuildings: false };
  }

  it('returns the static frame and skips getAnimatedFrame when animations are disabled', () => {
    const fake = { ...makeFake(true), buildingAnimationsEnabled: false };

    const result = proto.pickBuildingTexture.call(fake, 'house1.png');

    expect(result).toBe(staticFrame);
    expect(fake.gameObjectTextureCache.getAnimatedFrame).not.toHaveBeenCalled();
    expect(fake.hasAnimatedBuildings).toBe(false);
  });

  it('returns the animated frame and sets hasAnimatedBuildings when enabled', () => {
    const fake = { ...makeFake(true), buildingAnimationsEnabled: true };

    const result = proto.pickBuildingTexture.call(fake, 'house1.png');

    expect(result).toBe(animatedFrame);
    expect(fake.hasAnimatedBuildings).toBe(true);
  });

  it('returns null in both modes when there is no static frame', () => {
    const cache = {
      getTextureSync: jest.fn(() => null),
      getAnimatedTexture: jest.fn(() => animatedTexture),
      getAnimatedFrame: jest.fn(() => animatedFrame),
    };

    const fakeOff = { gameObjectTextureCache: cache, hasAnimatedBuildings: false, buildingAnimationsEnabled: false };
    const fakeOn = { gameObjectTextureCache: cache, hasAnimatedBuildings: false, buildingAnimationsEnabled: true };

    expect(proto.pickBuildingTexture.call(fakeOff, 'house1.png')).toBeNull();
    expect(proto.pickBuildingTexture.call(fakeOn, 'house1.png')).toBeNull();
  });
});

describe('setBuildingAnimationsEnabled / setTransparentOverlays', () => {
  it('setBuildingAnimationsEnabled writes the field and requests a render', () => {
    const fake = { buildingAnimationsEnabled: true, requestRender: jest.fn() };

    proto.setBuildingAnimationsEnabled.call(fake, false);

    expect(fake.buildingAnimationsEnabled).toBe(false);
    expect(fake.requestRender).toHaveBeenCalledTimes(1);
  });

  it('setTransparentOverlays writes the field and requests a render', () => {
    const fake = { transparentOverlays: true, requestRender: jest.fn() };

    proto.setTransparentOverlays.call(fake, false);

    expect(fake.transparentOverlays).toBe(false);
    expect(fake.requestRender).toHaveBeenCalledTimes(1);
  });
});

describe('drawBuildings calls pickBuildingTexture at the texture-selection site', () => {
  it('reaches pickBuildingTexture for every visible building', () => {
    const building = { x: 1, y: 1, visualClass: '100' };
    const fake = {
      ctx: {},
      terrainRenderer: {
        getZoomLevel: () => 2,
        mapToScreen: () => ({ x: 0, y: 0 }),
      },
      allBuildings: [building],
      buildingEffects: new Map(),
      facilityDimensionsCache: { get: () => undefined },
      hoveredBuilding: null,
      gameObjectTextureCache: {
        getTextureSync: jest.fn<(category: string, name: string) => ImageBitmap | null>(() => null),
        getAnimatedTexture: jest.fn(),
        getAnimatedFrame: jest.fn(),
      },
      buildingAnimationsEnabled: true,
      hasAnimatedBuildings: false,
      pickBuildingTexture: proto.pickBuildingTexture,
    };
    fake.pickBuildingTexture = fake.pickBuildingTexture.bind(fake);

    proto.drawBuildings.call(fake, { minI: 0, maxI: 10, minJ: 0, maxJ: 10 });

    expect(fake.gameObjectTextureCache.getTextureSync).toHaveBeenCalledWith('BuildingImages', expect.any(String));
  });
});

describe('drawZoneOverlay calls overlayFillColor at the fill-style site', () => {
  it('applies overlayFillColor to the tile it paints', () => {
    const ctx = { beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), closePath: jest.fn(), fill: jest.fn(), fillStyle: '' };
    const fake = {
      zoneOverlayEnabled: true,
      cachedZoneSurfaces: new Map([['a', { x: 0, y: 0, data: { rows: [[1]] } }]]),
      ctx,
      terrainRenderer: { getZoomLevel: () => 2, mapToScreen: () => ({ x: 0, y: 0 }) },
      overlayIsHeatmap: false,
      overlayIsTowns: false,
      canvas: { width: 1000, height: 1000 },
      transparentOverlays: false,
      overlayFillColor: proto.overlayFillColor,
    };
    fake.overlayFillColor = fake.overlayFillColor.bind(fake);

    proto.drawZoneOverlay.call(fake, { minI: 0, maxI: 10, minJ: 0, maxJ: 10 });

    expect(ctx.fillStyle).not.toBe('');
    expect(ctx.fill).toHaveBeenCalledTimes(1);
  });
});

describe('overlayFillColor', () => {
  it('returns the input unchanged when transparentOverlays is true', () => {
    const fake = { transparentOverlays: true };
    expect(proto.overlayFillColor.call(fake, 'rgba(0,128,128,0.3)')).toBe('rgba(0,128,128,0.3)');
  });

  it('replaces the trailing alpha with 1 when transparentOverlays is false', () => {
    const fake = { transparentOverlays: false };
    expect(proto.overlayFillColor.call(fake, 'rgba(0,128,128,0.3)')).toBe('rgba(0,128,128,1)');
    expect(proto.overlayFillColor.call(fake, 'rgba(255, 99, 71, 0.35)')).toBe('rgba(255, 99, 71,1)');
  });

  it('leaves a colour with no alpha suffix unchanged', () => {
    const fake = { transparentOverlays: false };
    expect(proto.overlayFillColor.call(fake, 'transparent')).toBe('transparent');
  });
});
