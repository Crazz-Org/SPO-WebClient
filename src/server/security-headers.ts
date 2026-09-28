/** Host header shape allowed into the CSP: hostname or IPv4, optional port. Anything else is dropped. */
const SAFE_HOST = /^[A-Za-z0-9.-]+(:[0-9]{1,5})?$/;

/**
 * Builds the page's Content-Security-Policy.
 *
 * The WebSocket origins `ws://H wss://H` mirror the host-derived origins `verifyClient`
 * accepts; both schemes are listed because the gateway cannot know whether TLS was
 * terminated in front of it. They are explicit rather than relying on CSP-3 `'self'`
 * matching ws schemes. A Host that is not a plain hostname/IPv4 with optional port is
 * dropped, so nothing from the header can add a directive; an IPv6 literal cannot be a
 * CSP host-source and falls back to `'self'`.
 */
export function buildContentSecurityPolicy(host: string | undefined, cdnUrl: string): string {
  const cdnOrigin = cdnUrl ? ` ${cdnUrl}` : '';
  const wsOrigins = host !== undefined && SAFE_HOST.test(host) ? ` ws://${host} wss://${host}` : '';
  return [
    "default-src 'self'",
    `connect-src 'self'${wsOrigins}${cdnOrigin}`,
    `img-src 'self' data: blob:${cdnOrigin}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
