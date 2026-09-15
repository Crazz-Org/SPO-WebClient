/**
 * Portrait crop — the pure half of the tycoon picture upload (card TC-03b).
 *
 * Everything here is plain math and DOM calls that jsdom or a stub can exercise without a real
 * canvas or a real decoded image. `PortraitUploader.tsx` is the only caller.
 */

/** PicShopForm.pas:13, mirrored by PICTURE_WIDTH (src/server/session/picture-transfer.ts:30) */
export const PORTRAIT_WIDTH = 150;
/** PicShopForm.pas:14, mirrored by PICTURE_HEIGHT (src/server/session/picture-transfer.ts:32) */
export const PORTRAIT_HEIGHT = 200;
export const PORTRAIT_JPEG_QUALITY = 0.85;
export const PORTRAIT_MAX_INPUT_BYTES = 8 * 1024 * 1024;

/**
 * `scale` is source-pixels-per-frame-pixel inverted: the visible source window is
 * `PORTRAIT_WIDTH / scale` wide and `PORTRAIT_HEIGHT / scale` tall, with its top-left at
 * `(offsetX, offsetY)` in source-image pixels.
 */
export interface CropView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface SourceSize {
  width: number;
  height: number;
}

/** The floor below which the frame could not be filled. */
export function coverScale(size: SourceSize): number {
  return Math.max(PORTRAIT_WIDTH / size.width, PORTRAIT_HEIGHT / size.height);
}

export function fitView(size: SourceSize): CropView {
  const scale = coverScale(size);
  const sw = PORTRAIT_WIDTH / scale;
  const sh = PORTRAIT_HEIGHT / scale;
  return {
    scale,
    offsetX: (size.width - sw) / 2,
    offsetY: (size.height - sh) / 2,
  };
}

export function clampView(view: CropView, size: SourceSize): CropView {
  if (size.width === 0 || size.height === 0) return view;
  const min = coverScale(size);
  const scale = Math.min(Math.max(view.scale, min), min * 8);
  const sw = PORTRAIT_WIDTH / scale;
  const sh = PORTRAIT_HEIGHT / scale;
  const offsetX = Math.min(Math.max(view.offsetX, 0), size.width - sw);
  const offsetY = Math.min(Math.max(view.offsetY, 0), size.height - sh);
  return { scale, offsetX, offsetY };
}

/** Dragging the picture right moves the window left. */
export function panBy(view: CropView, dxFrame: number, dyFrame: number, size: SourceSize): CropView {
  return clampView(
    { scale: view.scale, offsetX: view.offsetX - dxFrame / view.scale, offsetY: view.offsetY - dyFrame / view.scale },
    size,
  );
}

export function zoomTo(view: CropView, zoom: number, size: SourceSize): CropView {
  const oldSw = PORTRAIT_WIDTH / view.scale;
  const oldSh = PORTRAIT_HEIGHT / view.scale;
  const centerX = view.offsetX + oldSw / 2;
  const centerY = view.offsetY + oldSh / 2;
  const scale = coverScale(size) * zoom;
  const sw = PORTRAIT_WIDTH / scale;
  const sh = PORTRAIT_HEIGHT / scale;
  return clampView({ scale, offsetX: centerX - sw / 2, offsetY: centerY - sh / 2 }, size);
}

export function cropRectOf(view: CropView): CropRect {
  return {
    sx: view.offsetX,
    sy: view.offsetY,
    sw: PORTRAIT_WIDTH / view.scale,
    sh: PORTRAIT_HEIGHT / view.scale,
  };
}

export function drawPortrait(ctx: CanvasRenderingContext2D, image: CanvasImageSource, rect: CropRect): void {
  ctx.clearRect(0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
  ctx.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
}

/** `null` when acceptable, otherwise the reason sentence shown inline in the dialog. */
export function validatePortraitFile(file: File): string | null {
  if (!file.type.startsWith('image/')) {
    return `“${file.name}” is not an image (${file.type || 'unknown type'}).`;
  }
  if (file.size > PORTRAIT_MAX_INPUT_BYTES) {
    return `“${file.name}” is ${Math.round(file.size / 1024)} KB — the limit is 8 MB.`;
  }
  return null;
}

export interface EncodedPortrait {
  dataUrl: string;
  base64: string;
}

/** One `FileReader` read yields both the wire `base64` and the optimistic-header `dataUrl`. */
export function encodePortrait(canvas: HTMLCanvasElement): Promise<EncodedPortrait> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The browser could not encode the portrait as JPEG.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        resolve({ dataUrl, base64 });
      };
      reader.onerror = () => {
        reject(new Error('The browser could not encode the portrait as JPEG.'));
      };
      reader.readAsDataURL(blob);
    }, 'image/jpeg', PORTRAIT_JPEG_QUALITY);
  });
}

/** Isolated so the component test can stub `Image` and `URL.createObjectURL`, which jsdom does not implement. */
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`“${file.name}” could not be decoded as an image.`));
    };
    image.src = url;
  });
}
