import { describe, it, expect, jest, afterEach } from '@jest/globals';
import {
  PORTRAIT_WIDTH,
  PORTRAIT_HEIGHT,
  coverScale,
  fitView,
  clampView,
  panBy,
  zoomTo,
  cropRectOf,
  drawPortrait,
  validatePortraitFile,
  encodePortrait,
  loadImageFromFile,
} from '../portrait-crop';

function file(name: string, type: string, size: number): File {
  const f = new File([new Uint8Array(size)], name, { type });
  return f;
}

describe('portrait-crop', () => {
  describe('coverScale / fitView', () => {
    it('centres the window for a wide source', () => {
      const size = { width: 400, height: 100 };
      const scale = coverScale(size);
      expect(scale).toBeCloseTo(PORTRAIT_HEIGHT / 100);
      const view = fitView(size);
      expect(view.scale).toBeCloseTo(scale);
      const sw = PORTRAIT_WIDTH / view.scale;
      expect(view.offsetX).toBeCloseTo((400 - sw) / 2);
      expect(view.offsetY).toBeCloseTo(0);
    });

    it('centres the window for a tall source', () => {
      const size = { width: 100, height: 500 };
      const scale = coverScale(size);
      expect(scale).toBeCloseTo(PORTRAIT_WIDTH / 100);
      const view = fitView(size);
      const sh = PORTRAIT_HEIGHT / view.scale;
      expect(view.offsetX).toBeCloseTo(0);
      expect(view.offsetY).toBeCloseTo((500 - sh) / 2);
    });
  });

  describe('clampView', () => {
    const size = { width: 300, height: 300 };

    it('refuses a scale below cover', () => {
      const min = coverScale(size);
      const view = clampView({ scale: min / 2, offsetX: 0, offsetY: 0 }, size);
      expect(view.scale).toBeCloseTo(min);
    });

    it('pins offsets inside the image', () => {
      const view = clampView({ scale: coverScale(size) * 2, offsetX: -50, offsetY: 9999 }, size);
      const sw = PORTRAIT_WIDTH / view.scale;
      const sh = PORTRAIT_HEIGHT / view.scale;
      expect(view.offsetX).toBe(0);
      expect(view.offsetY).toBeCloseTo(size.height - sh);
      expect(view.offsetX + sw).toBeLessThanOrEqual(size.width + 1e-9);
    });

    it('returns the view unchanged for a zero-sized image, guarding division by zero', () => {
      const view = { scale: 1, offsetX: 0, offsetY: 0 };
      expect(clampView(view, { width: 0, height: 0 })).toEqual(view);
    });
  });

  describe('panBy', () => {
    it('dragging the picture right moves the window left, clamped inside the image', () => {
      const size = { width: 300, height: 300 };
      const view = fitView(size);
      const panned = panBy(view, 10, 0, size);
      expect(panned.offsetX).toBeLessThan(view.offsetX);

      const clampedAtEdge = panBy(view, 9999, 0, size);
      expect(clampedAtEdge.offsetX).toBe(0);
    });
  });

  describe('zoomTo', () => {
    it('re-centres the window on the point it was centred on before', () => {
      const size = { width: 300, height: 300 };
      const view = fitView(size);
      const zoomed = zoomTo(view, 2, size);
      expect(zoomed.scale).toBeCloseTo(coverScale(size) * 2);

      const oldCenterX = view.offsetX + PORTRAIT_WIDTH / view.scale / 2;
      const newCenterX = zoomed.offsetX + PORTRAIT_WIDTH / zoomed.scale / 2;
      expect(newCenterX).toBeCloseTo(oldCenterX, 5);
    });
  });

  describe('cropRectOf', () => {
    it('returns sw = 150/scale, sh = 200/scale', () => {
      const rect = cropRectOf({ scale: 2, offsetX: 5, offsetY: 7 });
      expect(rect).toEqual({ sx: 5, sy: 7, sw: 75, sh: 100 });
    });
  });

  describe('drawPortrait', () => {
    it('calls clearRect and the nine-argument drawImage with exactly the rect', () => {
      const ctx = { clearRect: jest.fn(), drawImage: jest.fn() };
      const image = {} as CanvasImageSource;
      const rect = { sx: 1, sy: 2, sw: 3, sh: 4 };
      drawPortrait(ctx as unknown as CanvasRenderingContext2D, image, rect);
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
      expect(ctx.drawImage).toHaveBeenCalledWith(image, 1, 2, 3, 4, 0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
    });
  });

  describe('validatePortraitFile', () => {
    it('returns null for a small image/png', () => {
      expect(validatePortraitFile(file('a.png', 'image/png', 1024))).toBeNull();
    });

    it('returns a reason naming the type for text/plain', () => {
      const reason = validatePortraitFile(file('a.txt', 'text/plain', 100));
      expect(reason).toContain('a.txt');
      expect(reason).toContain('text/plain');
    });

    it('returns a reason naming the limit for a 9 MB image', () => {
      const reason = validatePortraitFile(file('big.png', 'image/png', 9 * 1024 * 1024));
      expect(reason).toContain('8 MB');
    });
  });

  describe('encodePortrait', () => {
    it('resolves { dataUrl, base64 } from a stubbed toBlob', async () => {
      const canvas = document.createElement('canvas');
      const blob = new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' });
      (canvas as unknown as { toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => void }).toBlob =
        (cb) => cb(blob);

      const result = await encodePortrait(canvas);
      expect(result.dataUrl.startsWith('data:')).toBe(true);
      expect(result.base64.length).toBeGreaterThan(0);
      expect(result.dataUrl.endsWith(result.base64)).toBe(true);
    });

    it('rejects on a null blob', async () => {
      const canvas = document.createElement('canvas');
      (canvas as unknown as { toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => void }).toBlob =
        (cb) => cb(null);

      await expect(encodePortrait(canvas)).rejects.toThrow('The browser could not encode the portrait as JPEG.');
    });

    it('rejects when the FileReader itself fails', async () => {
      const canvas = document.createElement('canvas');
      const blob = new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' });
      (canvas as unknown as { toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => void }).toBlob =
        (cb) => cb(blob);

      const OrigFileReader = globalThis.FileReader;
      class FailingFileReader {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        result: string | null = null;
        readAsDataURL(): void {
          queueMicrotask(() => this.onerror?.());
        }
      }
      (globalThis as unknown as { FileReader: unknown }).FileReader = FailingFileReader;

      try {
        await expect(encodePortrait(canvas)).rejects.toThrow('The browser could not encode the portrait as JPEG.');
      } finally {
        globalThis.FileReader = OrigFileReader;
      }
    });
  });

  describe('loadImageFromFile', () => {
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const origImage = globalThis.Image;

    afterEach(() => {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      globalThis.Image = origImage;
    });

    it('resolves the decoded image and revokes the object URL', async () => {
      URL.createObjectURL = jest.fn(() => 'blob:fake') as never;
      URL.revokeObjectURL = jest.fn() as never;
      (globalThis as unknown as { Image: unknown }).Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 10;
        naturalHeight = 10;
        set src(_v: string) { queueMicrotask(() => this.onload?.()); }
      };

      const img = await loadImageFromFile(file('a.png', 'image/png', 10));
      expect(img.naturalWidth).toBe(10);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    });

    it('rejects naming the file when decoding fails', async () => {
      URL.createObjectURL = jest.fn(() => 'blob:fake') as never;
      URL.revokeObjectURL = jest.fn() as never;
      (globalThis as unknown as { Image: unknown }).Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) { queueMicrotask(() => this.onerror?.()); }
      };

      await expect(loadImageFromFile(file('bad.png', 'image/png', 10)))
        .rejects.toThrow('“bad.png” could not be decoded as an image.');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    });
  });
});
