/**
 * LegacyBlockTicker — the news ticker under the toolbar icons (`ToolbarHandlerViewer.dfm`
 * BlockTicker, drawn by `Voyager/Components/BlockTicker.pas`).
 *
 * A caption "types in": one more character every 80 ms (TickerTimer), the newest one white
 * behind a `|` caret, the one before it halfway between white and the ticker colour, the rest
 * in the ticker colour (`BlockTicker.pas:130-201`). The caret goes once the caption is whole.
 */

import { useEffect, useState } from 'react';
import styles from './LegacyGameChrome.module.css';

const TYPE_MS = 80;

export function LegacyBlockTicker({ text }: { text: string }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    setShown(0);
    if (!text) return;
    const t = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(t);
          return n;
        }
        return n + 1;
      });
    }, TYPE_MS);
    return () => clearInterval(t);
  }, [text]);

  const typing = shown < text.length;
  const settled = typing ? text.slice(0, Math.max(0, shown - 2)) : text;
  const middle = typing && shown >= 2 ? text.charAt(shown - 2) : '';
  const newest = typing && shown >= 1 ? text.charAt(shown - 1) : '';

  return (
    <div className={styles.blockTicker} role="status" aria-live="polite" aria-label={text}>
      <span aria-hidden="true">
        {settled}
        {middle && <span className={styles.blockTickerMid}>{middle}</span>}
        {newest && <span className={styles.blockTickerLit}>{newest}</span>}
        {typing && <span className={styles.blockTickerLit}>|</span>}
      </span>
    </div>
  );
}
