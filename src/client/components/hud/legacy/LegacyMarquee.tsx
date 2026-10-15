/**
 * LegacyMarquee — Voyager's TMarquee (`Voyager/Components/MarqueeCtrl.pas`), the two status
 * lines of the map's StatusPanel.
 *
 * Every 40 ms (`MapIsoView.dfm` TickersTimer) the text moves `STEP` px to the left: a caption
 * that fits slides in from the right edge and stops at the left margin; one that does not
 * scrolls for ever, copies `GAP` px apart (`Tick`, :325-360; `Paint`, :240-266). A new caption
 * first lifts the old one out of the line — up or down, 2 px a tick — and then enters from the
 * right (`SetMarqueeText`, :363-396). Positions are written straight to the DOM: no re-render
 * per tick.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import styles from './LegacyGameChrome.module.css';

const TICK_MS = 40;
const STEP = 2;
const GAP = 50;
const LEFT_MARGIN = 5;

interface LegacyMarqueeProps {
  text: string;
  /** The way the old caption leaves the line (TMarquee.Direction). */
  direction: 'up' | 'down';
  className?: string;
}

export function LegacyMarquee({ text, direction, className }: LegacyMarqueeProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLSpanElement>(null);
  const secondRef = useRef<HTMLSpanElement>(null);
  const state = useRef({ shown: text, pending: null as string | null, offset: LEFT_MARGIN, lift: 0 });

  // The text lives in the DOM only (the tick rewrites it), never as React children.
  useLayoutEffect(() => {
    const s = state.current;
    if (firstRef.current) firstRef.current.textContent = s.shown;
    if (secondRef.current) secondRef.current.textContent = s.shown;
  }, []);

  // A changed caption: lift the old one out first; the very first one is simply shown.
  useLayoutEffect(() => {
    const s = state.current;
    if (text === s.shown && s.pending === null) return;
    s.pending = text === s.shown ? null : text;
  }, [text]);

  useEffect(() => {
    const paint = () => {
      const s = state.current;
      const box = boxRef.current;
      const first = firstRef.current;
      const second = secondRef.current;
      const line = lineRef.current;
      if (!box || !first || !second || !line) return;
      const width = box.clientWidth;
      const textWidth = first.offsetWidth;

      if (s.pending !== null) {
        s.lift += STEP;
        if (s.lift >= box.clientHeight) {
          s.shown = s.pending;
          s.pending = null;
          s.lift = 0;
          first.textContent = s.shown;
          second.textContent = s.shown;
          s.offset = width;
        }
      } else if (textWidth > width - LEFT_MARGIN) {
        if (textWidth + s.offset < 0) s.offset = GAP;
        s.offset -= STEP;
      } else {
        s.offset = Math.max(LEFT_MARGIN, s.offset - STEP);
      }

      const overflowing = first.offsetWidth > width - LEFT_MARGIN;
      first.style.transform = `translateX(${s.offset}px)`;
      second.style.transform = `translateX(${s.offset + first.offsetWidth + GAP}px)`;
      second.hidden = !overflowing;
      line.style.transform = `translateY(${direction === 'up' ? -s.lift : s.lift}px)`;
    };
    const t = setInterval(paint, TICK_MS);
    return () => clearInterval(t);
  }, [direction]);

  return (
    <div ref={boxRef} className={`${styles.marquee} ${className ?? ''}`} title={text}>
      <div ref={lineRef} className={styles.marqueeLine}>
        <span ref={firstRef} className={styles.marqueeText} style={{ transform: `translateX(${LEFT_MARGIN}px)` }} />
        <span ref={secondRef} className={styles.marqueeText} hidden aria-hidden="true" />
      </div>
    </div>
  );
}
