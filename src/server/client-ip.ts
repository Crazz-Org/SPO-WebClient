import type * as http from 'http';

/**
 * Resolve the client address for per-IP limits and logs (SEC-H-7).
 * With trustProxy, the RIGHTMOST X-Forwarded-For entry is used — the address our single
 * trusted nginx appended via $proxy_add_x_forwarded_for; every entry to its left is
 * client-supplied. Missing/empty header or empty last entry → socket peer address.
 */
export function resolveClientIp(
  headers: http.IncomingHttpHeaders,
  remoteAddress: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const xff = headers['x-forwarded-for'];
    const last = typeof xff === 'string' ? xff.split(',').pop()?.trim() : undefined;
    if (last) return last.replace('::ffff:', '');
  }
  return (remoteAddress || '0.0.0.0').replace('::ffff:', '');
}
