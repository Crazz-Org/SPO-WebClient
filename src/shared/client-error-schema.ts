/**
 * The browser error report contract — what a player's browser may send to
 * `POST /api/client-error` when it hits an uncaught error, an unhandled rejection, an
 * error-boundary catch or a failed lazy chunk.
 *
 * It lives in `src/shared` so the browser code that builds the payload can import the caps
 * and the type; the gateway route (`server/client-error-endpoint.ts`) re-exports all of it.
 *
 * The key set is **closed**: any key outside the nine below refuses the whole report instead
 * of being stripped, so a client that tries to add a field (a name, a world, a tycoon) shows
 * up as a refusal. No field can hold a player's identity. Refusal reasons are fixed text and
 * never echo a submitted value.
 */

export const CLIENT_ERROR_SCHEMA_VERSION = 1;

export const MAX_MESSAGE_CHARS = 300;
export const MAX_FRAMES = 5;
export const MAX_FRAME_CHARS = 200;
export const MAX_BUILD_CHARS = 64;
export const MAX_SURFACE_CHARS = 32;

export const CLIENT_ERROR_KINDS = ['error', 'rejection', 'boundary', 'chunk'] as const;
export const CLIENT_ERROR_SCREENS = ['login', 'game'] as const;
export const CLIENT_ERROR_UAS = ['chrome', 'edge', 'firefox', 'safari', 'other'] as const;

export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];
export type ClientErrorScreen = (typeof CLIENT_ERROR_SCREENS)[number];
export type ClientErrorUa = (typeof CLIENT_ERROR_UAS)[number];

export interface ClientErrorReport {
  v: 1;
  /** `${APP_VERSION}#${BUILD_NUMBER}` */
  build: string;
  kind: ClientErrorKind;
  message: string;
  /** Top stack frames of the built bundle, file:line:col. */
  frames: string[];
  screen: ClientErrorScreen;
  /** The open `SurfaceKind`, or null. */
  surface: string | null;
  ua: ClientErrorUa;
  mobile: boolean;
}

export type ClientErrorValidation =
  | { ok: true; report: ClientErrorReport }
  | { ok: false; error: string };

const ALLOWED_KEYS: readonly string[] = [
  'v', 'build', 'kind', 'message', 'frames', 'screen', 'surface', 'ua', 'mobile',
];

const BUILD_PATTERN = /^[\w.+#-]+$/;
const SURFACE_PATTERN = /^[A-Za-z]{1,32}$/;

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function fail(error: string): ClientErrorValidation {
  return { ok: false, error };
}

export function validateClientErrorReport(value: unknown): ClientErrorValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('report must be a JSON object');
  }
  const obj = value as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.includes(key)) return fail('report has an unexpected field');
  }
  for (const key of ALLOWED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) return fail(`${key} is required`);
  }

  const { v, build, kind, message, frames, screen, surface, ua, mobile } = obj;

  if (v !== CLIENT_ERROR_SCHEMA_VERSION) return fail('v must be 1');
  if (typeof build !== 'string' || build.length < 1 || build.length > MAX_BUILD_CHARS || !BUILD_PATTERN.test(build)) {
    return fail(`build must be a string of 1-${MAX_BUILD_CHARS} chars from [A-Za-z0-9_.+#-]`);
  }
  if (!isOneOf(CLIENT_ERROR_KINDS, kind)) return fail(`kind must be one of ${CLIENT_ERROR_KINDS.join(', ')}`);
  if (typeof message !== 'string' || message.length < 1 || message.length > MAX_MESSAGE_CHARS) {
    return fail(`message must be a string of 1-${MAX_MESSAGE_CHARS} chars`);
  }
  if (
    !Array.isArray(frames)
    || frames.length > MAX_FRAMES
    || !frames.every((f: unknown) => typeof f === 'string' && f.length <= MAX_FRAME_CHARS)
  ) {
    return fail(`frames must be an array of at most ${MAX_FRAMES} strings of at most ${MAX_FRAME_CHARS} chars`);
  }
  if (!isOneOf(CLIENT_ERROR_SCREENS, screen)) return fail(`screen must be one of ${CLIENT_ERROR_SCREENS.join(', ')}`);
  if (surface !== null && (typeof surface !== 'string' || !SURFACE_PATTERN.test(surface))) {
    return fail(`surface must be null or 1-${MAX_SURFACE_CHARS} letters`);
  }
  if (!isOneOf(CLIENT_ERROR_UAS, ua)) return fail(`ua must be one of ${CLIENT_ERROR_UAS.join(', ')}`);
  if (typeof mobile !== 'boolean') return fail('mobile must be a boolean');

  return {
    ok: true,
    report: {
      v: CLIENT_ERROR_SCHEMA_VERSION,
      build,
      kind,
      message,
      frames: (frames as string[]).slice(),
      screen,
      surface,
      ua,
      mobile,
    },
  };
}
