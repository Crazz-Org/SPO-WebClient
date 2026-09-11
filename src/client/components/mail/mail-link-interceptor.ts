import { parseLocalAspUrl } from '@/shared/local-asp-url';

/**
 * Makes every anchor in a mail frame inert — a mail body is player-writable HTML, so no
 * link may navigate the app away. A `local.asp` map-select link (`MsgZoned.asp:117`)
 * becomes `onSelect(x, y)` instead, the same request the map's own building-select sends.
 * Returns the detach function.
 */
export function interceptMailLinks(doc: Document, onSelect: (x: number, y: number) => void): () => void {
  function onClick(event: MouseEvent): void {
    const target = event.target;
    if (!target || typeof (target as Element).closest !== 'function') return;
    const anchor = (target as Element).closest('a[href]');
    if (!anchor) return;

    event.preventDefault();

    const select = parseLocalAspUrl(anchor.getAttribute('href') ?? '');
    if (select) onSelect(select.x, select.y);
  }

  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}
