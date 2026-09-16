/**
 * BottomSheet — Gesture-driven slide-up panel for all mobile content.
 *
 * Integrates useSheetGesture for drag-to-snap (peek/half/full).
 * Semi-transparent backdrop keeps the map visible behind.
 * Sits above BottomNav (56px offset).
 */

import { type ReactNode, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { useSheetGesture } from '../../hooks/useSheetGesture';
import { useUiStore } from '../../store/ui-store';
import styles from './BottomSheet.module.css';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}

export function BottomSheet({ open, onClose, title, children, actions }: BottomSheetProps) {
  const sheetSnap = useUiStore((s) => s.mobileSheetSnap);
  const setSheetSnap = useUiStore((s) => s.setMobileSheetSnap);

  const {
    snap,
    setSnap,
    dragOffset,
    isDragging,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  } = useSheetGesture({
    onDismiss: onClose,
    initialSnap: sheetSnap,
  });

  // Sync gesture snap to store
  useEffect(() => {
    setSheetSnap(snap);
  }, [snap, setSheetSnap]);

  // Reset to half when sheet opens with new content
  useEffect(() => {
    if (open) {
      setSnap('half');
    }
  }, [open, setSnap]);

  // Click-to-cycle as fallback for non-touch
  const cycleHeight = useCallback(() => {
    if (snap === 'peek') setSnap('half');
    else if (snap === 'half') setSnap('full');
    else setSnap('half');
  }, [snap, setSnap]);

  if (!open) return null;

  const heightClass =
    snap === 'full' ? styles.full : snap === 'half' ? styles.half : styles.peek;

  // During drag, apply translateY for 60fps performance
  const dragStyle = isDragging
    ? { transform: `translateY(${dragOffset}px)`, transition: 'none' }
    : undefined;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        className={`${styles.sheet} ${heightClass} ${isDragging ? styles.dragging : ''}`}
        style={dragStyle}
        role="dialog"
        aria-label={title}
      >
        {/* Drag handle */}
        <div
          className={styles.handleArea}
          onClick={cycleHeight}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          role="button"
          tabIndex={0}
          aria-label="Resize panel"
        >
          <span className={styles.handle} />
        </div>

        {/* Header */}
        <div className={styles.header}>
          <h3 className={styles.title}>{title}</h3>
          <div className={styles.headerActions}>
            {actions}
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={styles.content}>{children}</div>
      </div>
    </>
  );
}
