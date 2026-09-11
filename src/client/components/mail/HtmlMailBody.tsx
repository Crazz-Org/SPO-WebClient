/**
 * HtmlMailBody — renders HTML mail content in a sandboxed iframe.
 *
 * System notifications from the game server arrive as HTML, often with
 * META REFRESH redirects to dynamic ASP pages on the World Web Server.
 *
 * Two sandboxes, for two different reasons:
 *  - `sandbox="allow-same-origin"` frame: `srcdoc` puts the page's markup in a frame the
 *    app itself served, so the browser lets the app look inside it — that is what makes
 *    the click listener below possible. `allow-same-origin` alone still blocks scripts,
 *    forms and top-level navigation, so nothing the mail contains can run or leave the app.
 *  - The gateway could not fetch the page (a foreign host, or the world's IIS was down):
 *    fall back to today's cross-origin `src` frame. The browser cannot see inside a
 *    cross-origin frame either way, so there is nothing to intercept there.
 */

import { useCallback } from 'react';
import { useClient } from '../../context';
import { extractMetaRefreshUrl } from '@/shared/mail-html-utils';
import { interceptMailLinks } from './mail-link-interceptor';
import styles from './MailPanel.module.css';

interface HtmlMailBodyProps {
  body: string[];
  htmlBody?: string;
}

export function HtmlMailBody({ body, htmlBody }: HtmlMailBodyProps) {
  const client = useClient();
  const html = body.join('\n');
  const redirectUrl = extractMetaRefreshUrl(html);

  const onLoad = useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const doc = e.currentTarget.contentDocument;
    if (doc) interceptMailLinks(doc, client.onNavigateToBuilding);
  }, [client]);

  // META REFRESH, but the gateway could not fetch the page — today's cross-origin frame.
  if (redirectUrl && htmlBody === undefined) {
    return (
      <iframe
        className={styles.htmlBody}
        src={redirectUrl}
        sandbox="allow-same-origin"
        title="Mail content"
      />
    );
  }

  // Same-origin srcdoc, script-less — every link click is intercepted on load.
  return (
    <iframe
      className={styles.htmlBody}
      srcDoc={redirectUrl ? htmlBody : html}
      sandbox="allow-same-origin"
      title="Mail content"
      onLoad={onLoad}
    />
  );
}
