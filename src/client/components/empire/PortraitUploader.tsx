/**
 * PortraitUploader — crop-and-encode dialog for the tycoon picture upload (card TC-03b).
 *
 * Layout follows the legacy dialog (Voyager/PicShopForm.pas:20-34: Load · Preview · Zoom± ·
 * Send · Cancel). One canvas is both the live preview and the encode surface.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../common';
import { useClient } from '../../context';
import { useProfileStore } from '../../store/profile-store';
import {
  PORTRAIT_WIDTH,
  PORTRAIT_HEIGHT,
  coverScale,
  cropRectOf,
  drawPortrait,
  encodePortrait,
  fitView,
  loadImageFromFile,
  panBy,
  validatePortraitFile,
  zoomTo,
  type CropView,
} from './portrait-crop';
import styles from './PortraitUploader.module.css';

export function PortraitUploader({ onClose }: { onClose: () => void }) {
  const client = useClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState<CropView>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawPortrait(ctx, image, cropRectOf(view));
  }, [image, view]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reason = validatePortraitFile(file);
    if (reason) {
      setError(reason);
      return;
    }
    loadImageFromFile(file)
      .then((img) => {
        setImage(img);
        setView(fitView({ width: img.naturalWidth, height: img.naturalHeight }));
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const size = useMemo(
    () => (image ? { width: image.naturalWidth, height: image.naturalHeight } : null),
    [image],
  );

  const handlePan = useCallback((dx: number, dy: number) => {
    if (!size) return;
    setView((v) => panBy(v, dx, dy, size));
  }, [size]);

  const handleZoom = useCallback((zoom: number) => {
    if (!size) return;
    setView((v) => zoomTo(v, zoom, size));
  }, [size]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const step = 8;
    switch (e.key) {
      case 'ArrowLeft': handlePan(-step, 0); break;
      case 'ArrowRight': handlePan(step, 0); break;
      case 'ArrowUp': handlePan(0, -step); break;
      case 'ArrowDown': handlePan(0, step); break;
      default: return;
    }
    e.preventDefault();
  }, [handlePan]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    handlePan(dx, dy);
  }, [handlePan]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleSend = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || busy) return;
    setBusy(true);
    encodePortrait(canvas)
      .then(({ dataUrl, base64 }) => {
        useProfileStore.getState().applyPortrait(dataUrl);
        client.onProfileUploadPicture(base64);
        onClose();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      });
  }, [image, busy, client, onClose]);

  return (
    <Dialog
      title="Change portrait"
      onClose={onClose}
      primary={{ label: 'Send', onClick: handleSend, disabled: !image || busy }}
    >
      <div className={styles.body}>
        <label className={styles.fileLabel}>
          Choose an image
          <input type="file" accept="image/*" onChange={handleFileChange} className={styles.fileInput} />
        </label>
        <canvas
          ref={canvasRef}
          width={PORTRAIT_WIDTH}
          height={PORTRAIT_HEIGHT}
          className={styles.canvas}
          role="img"
          aria-label="Portrait crop preview"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        <label className={styles.zoomLabel}>
          Zoom
          <input
            type="range"
            min="1"
            max="8"
            step="0.1"
            value={size ? view.scale / coverScale(size) : 1}
            onChange={(e) => handleZoom(Number(e.target.value))}
            disabled={!image}
          />
        </label>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
