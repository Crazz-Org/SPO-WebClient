/**
 * Extractor for action URLs embedded in ASP HTML responses.
 *
 * Classic ASP pages served by the Interface Server contain dynamic URLs
 * (form actions, href links, onclick handlers) with server-side parameters
 * like DAAddr, DAPort, WorldName, etc. These URLs are the authoritative
 * source — we must extract and reuse them rather than reconstructing.
 *
 * Follows the same regex-based parsing pattern as mail-list-parser.ts.
 *
 * Also reads a map tile coordinate off a URL of this class (`extractMapCoords`)
 * — the `x`/`y` a world event's URL carries (`ToolbarHandlerViewer.pas:259-262`).
 */

/** A single action URL extracted from ASP HTML */
export interface AspActionUrl {
  /** Derived key from ASP filename, e.g. 'TycoonPolicy.asp' */
  key: string;
  /** The full resolved URL */
  url: string;
  /** HTTP method implied by context */
  method: 'GET' | 'POST';
  /** Hidden form fields found alongside the URL (for forms only) */
  hiddenFields?: Record<string, string>;
}

/**
 * Resolve a potentially relative URL against a base URL.
 * Handles absolute URLs (http://...), protocol-relative (//...), root-relative (/...),
 * and relative paths (../..., same-dir).
 */
export function resolveUrl(relative: string, baseUrl: string): string {
  const trimmed = relative.trim();

  // Already absolute
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Extract origin and path directory from base URL
  const originMatch = baseUrl.match(/^(https?:\/\/[^/]+)(\/.*)?$/i);
  if (!originMatch) {
    return trimmed;
  }
  const origin = originMatch[1];
  const basePath = originMatch[2] || '/';
  const baseDir = basePath.substring(0, basePath.lastIndexOf('/') + 1) || '/';

  // Protocol-relative
  if (trimmed.startsWith('//')) {
    const proto = baseUrl.startsWith('https') ? 'https:' : 'http:';
    return proto + trimmed;
  }

  // Root-relative
  if (trimmed.startsWith('/')) {
    return origin + trimmed;
  }

  // Relative path — resolve against base directory
  const combined = baseDir + trimmed;
  // Normalize ../ and ./ segments
  const parts = combined.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      resolved.pop();
    } else if (part !== '.') {
      resolved.push(part);
    }
  }
  return origin + resolved.join('/');
}

/**
 * Derive a key from a URL by extracting the ASP filename.
 * e.g. 'http://1.2.3.4/Five/0/.../TycoonPolicy.asp?Action=modify&...' → 'TycoonPolicy.asp'
 */
export function deriveKey(url: string): string {
  // Remove query string, then extract last path segment
  const pathPart = url.split('?')[0];
  const segments = pathPart.split('/');
  const filename = segments[segments.length - 1] || '';
  return filename || url;
}

/**
 * Extract form action URLs from <form> elements, including hidden input fields.
 */
export function extractFormActions(html: string, baseUrl: string): AspActionUrl[] {
  const results: AspActionUrl[] = [];
  if (!html || typeof html !== 'string') return results;

  const formRegex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let formMatch;
  while ((formMatch = formRegex.exec(html)) !== null) {
    const attrs = formMatch[1];
    const body = formMatch[2];

    // Extract action attribute
    const actionMatch = attrs.match(/\baction\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
    if (!actionMatch) continue;
    const rawAction = actionMatch[1] ?? actionMatch[2] ?? actionMatch[3] ?? '';
    if (!rawAction) continue;

    // Determine method
    const methodMatch = attrs.match(/\bmethod\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
    const rawMethod = (methodMatch?.[1] ?? methodMatch?.[2] ?? methodMatch?.[3] ?? '').toUpperCase();
    const method: 'GET' | 'POST' = rawMethod === 'POST' ? 'POST' : rawMethod === 'GET' ? 'GET' : 'POST';

    const url = resolveUrl(rawAction, baseUrl);
    const key = deriveKey(url);

    // Extract hidden input fields
    const hiddenFields: Record<string, string> = {};
    const hiddenRegex = /<input\b[^>]*\btype\s*=\s*(?:"hidden"|'hidden'|hidden\b)[^>]*>/gi;
    let hiddenMatch;
    while ((hiddenMatch = hiddenRegex.exec(body)) !== null) {
      const tag = hiddenMatch[0];
      const nameMatch = tag.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+?)(?:\s|>))/i);
      const valueMatch = tag.match(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+?)(?:\s|>))/i);
      const name = nameMatch?.[1] ?? nameMatch?.[2] ?? nameMatch?.[3];
      const value = valueMatch?.[1] ?? valueMatch?.[2] ?? valueMatch?.[3] ?? '';
      if (name) {
        hiddenFields[name] = value;
      }
    }

    results.push({
      key,
      url,
      method,
      hiddenFields: Object.keys(hiddenFields).length > 0 ? hiddenFields : undefined,
    });
  }

  return results;
}

/**
 * Extract href URLs from <a> elements that point to ASP pages.
 * @param pathFilter - Optional regex to filter URLs (e.g. /resetTycoon|abandonRole/)
 */
export function extractHrefUrls(
  html: string,
  baseUrl: string,
  pathFilter?: RegExp,
): AspActionUrl[] {
  const results: AspActionUrl[] = [];
  if (!html || typeof html !== 'string') return results;

  const linkRegex = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+?)(?:\s|>))[^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const rawHref = match[1] ?? match[2] ?? match[3] ?? '';
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) continue;

    // Only include .asp URLs
    if (!/\.asp\b/i.test(rawHref)) continue;

    if (pathFilter && !pathFilter.test(rawHref)) continue;

    const url = resolveUrl(rawHref, baseUrl);
    const key = deriveKey(url);

    results.push({ key, url, method: 'GET' });
  }

  return results;
}

/**
 * Extract URLs from JavaScript onclick/onchange handlers.
 * Matches patterns like:
 *   onclick="location.href='...'"
 *   onchange="window.location='...'"
 *   onclick="navigate('...')"
 *   onclick="document.location='...'"
 */
export function extractOnClickUrls(html: string, baseUrl: string): AspActionUrl[] {
  const results: AspActionUrl[] = [];
  if (!html || typeof html !== 'string') return results;

  // Match on* event attributes containing URL assignments or navigate calls
  const handlerRegex = /\bon(?:click|change|submit)\s*=\s*"([^"]*)"/gi;
  let match;
  while ((match = handlerRegex.exec(html)) !== null) {
    const handler = match[1];

    // Pattern 1: location.href = '...' or window.location = '...' or document.location = '...'
    const locMatch = handler.match(
      /(?:window\.|document\.)?location(?:\.href)?\s*=\s*(?:'([^']*)'|"([^"]*)")/i,
    );
    if (locMatch) {
      const rawUrl = locMatch[1] ?? locMatch[2] ?? '';
      if (rawUrl && /\.asp\b/i.test(rawUrl)) {
        const url = resolveUrl(rawUrl, baseUrl);
        results.push({ key: deriveKey(url), url, method: 'GET' });
      }
    }

    // Pattern 2: navigate('...')
    const navMatch = handler.match(/navigate\s*\(\s*(?:'([^']*)'|"([^"]*)")\s*\)/i);
    if (navMatch) {
      const rawUrl = navMatch[1] ?? navMatch[2] ?? '';
      if (rawUrl && /\.asp\b/i.test(rawUrl)) {
        const url = resolveUrl(rawUrl, baseUrl);
        results.push({ key: deriveKey(url), url, method: 'GET' });
      }
    }
  }

  // Also match single-quoted on* attributes: onclick='...'
  const singleQuoteRegex = /\bon(?:click|change|submit)\s*=\s*'([^']*)'/gi;
  while ((match = singleQuoteRegex.exec(html)) !== null) {
    const handler = match[1];

    const locMatch = handler.match(
      /(?:window\.|document\.)?location(?:\.href)?\s*=\s*(?:"([^"]*)")/i,
    );
    if (locMatch) {
      const rawUrl = locMatch[1] ?? '';
      if (rawUrl && /\.asp\b/i.test(rawUrl)) {
        const url = resolveUrl(rawUrl, baseUrl);
        results.push({ key: deriveKey(url), url, method: 'GET' });
      }
    }
  }

  return results;
}

/**
 * Extract URLs built via string concatenation inside <script> block functions.
 * Handles patterns like:
 *   var URL = getBaseURL() + "file.asp" + "?Param=value" + ...;
 *   var URL = "file.asp?Param=value&...";
 *
 * Also resolves getBaseURL() if its function definition is in the same script block.
 * Dynamic expressions (e.g. `event.srcElement.checked`) are omitted — only string
 * literals are extracted, leaving dynamic parameter values empty in the URL.
 */
export function extractScriptNavigateUrls(html: string, baseUrl: string): AspActionUrl[] {
  const results: AspActionUrl[] = [];
  if (!html || typeof html !== 'string') return results;

  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const scriptBody = scriptMatch[1];

    // Find getBaseURL() return value if defined in this script block
    let scriptBaseUrl = '';
    const baseUrlFnMatch = scriptBody.match(
      /function\s+getBaseURL\s*\(\s*\)\s*\{[\s\S]*?return\s*\(([\s\S]*?)\)/i,
    );
    if (baseUrlFnMatch) {
      const literals: string[] = [];
      const litRegex = /"([^"]*)"/g;
      let litMatch;
      while ((litMatch = litRegex.exec(baseUrlFnMatch[1])) !== null) {
        literals.push(litMatch[1]);
      }
      scriptBaseUrl = literals.join('');
    }

    // Find `var URL = ...;` assignments containing .asp references
    const urlAssignRegex = /var\s+URL\s*=\s*([\s\S]*?);/gi;
    let urlMatch;
    while ((urlMatch = urlAssignRegex.exec(scriptBody)) !== null) {
      const expr = urlMatch[1];
      if (!/\.asp/i.test(expr)) continue;

      // Extract all string literals and join them
      const literals: string[] = [];
      const litRegex = /"([^"]*)"/g;
      let litMatch;
      while ((litMatch = litRegex.exec(expr)) !== null) {
        literals.push(litMatch[1]);
      }
      if (literals.length === 0) continue;

      // Prepend script base URL if getBaseURL() is called in the expression
      let rawUrl: string;
      if (/getBaseURL\s*\(\s*\)/.test(expr) && scriptBaseUrl) {
        rawUrl = scriptBaseUrl + literals.join('');
      } else {
        rawUrl = literals.join('');
      }

      if (!rawUrl || !/\.asp/i.test(rawUrl)) continue;

      const url = resolveUrl(rawUrl, baseUrl);
      const key = deriveKey(url);
      results.push({ key, url, method: 'GET' });
    }
  }

  return results;
}

/**
 * Read a map tile coordinate off an event URL's query string.
 *
 * Voyager's ticker read `GetParmValue(fURL,'x')` / `'y'` off the raw URL
 * (`ToolbarHandlerViewer.pas:259-262`, `Voyager/URLParser.pas:49`) before it
 * expanded the URL to absolute — so this must work on a relative href too,
 * which rules out `new URL()`. Returns `null` for anything that does not
 * carry both as non-negative integers. Never throws.
 */
export function extractMapCoords(url: string): { x: number; y: number } | null {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return null;

  const params = new URLSearchParams(url.slice(queryIndex + 1));
  const x = params.get('x');
  const y = params.get('y');
  if (!x || !y || !/^\d+$/.test(x) || !/^\d+$/.test(y)) return null;

  return { x: Number(x), y: Number(y) };
}

/**
 * Run all extractors and return a deduplicated Map keyed by ASP filename.
 * Later entries overwrite earlier ones if they share the same key.
 */
export function extractAllActionUrls(
  html: string,
  baseUrl: string,
  hrefFilter?: RegExp,
): Map<string, AspActionUrl> {
  const map = new Map<string, AspActionUrl>();

  for (const entry of extractFormActions(html, baseUrl)) {
    map.set(entry.key, entry);
  }
  for (const entry of extractHrefUrls(html, baseUrl, hrefFilter)) {
    map.set(entry.key, entry);
  }
  for (const entry of extractOnClickUrls(html, baseUrl)) {
    map.set(entry.key, entry);
  }
  for (const entry of extractScriptNavigateUrls(html, baseUrl)) {
    map.set(entry.key, entry);
  }

  return map;
}
