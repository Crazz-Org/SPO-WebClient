/**
 * The runtime config script the gateway serves at `/spo-runtime-config.js`.
 *
 * It is how a server-side setting reaches the browser without an inline `<script>`, which
 * the CSP forbids: `index.html` links this file, and the file assigns the few `window.__SPO_*`
 * globals `src/shared/config.ts` reads before falling back to its build-time defaults.
 *
 * Only the values that differ from the defaults are emitted — in the Docker deployment the
 * body is a single CDN assignment, and the injection into `index.html` does not happen at all.
 */

export interface RuntimeConfigInput {
  /** The CDN base the client should fetch chunks from; `''` sends it through the gateway's /cdn/ proxy. */
  cdnUrl: string;
  /** One local player: relaxes the checks that only make sense for a shared deployment. */
  singleUserMode?: boolean;
  /** Skips the world picker and logs straight into this world. */
  forceWorld?: string;
  /** Dev-only: turns on the in-app bug-reporting capture. */
  bugReport?: boolean;
  /** Registration page for "Create an account" on the sign-in screen; empty renders no action. */
  registerUrl?: string;
}

export function buildRuntimeConfigScript(input: RuntimeConfigInput): string {
  const lines = [`window.__SPO_CDN_URL__=${JSON.stringify(input.cdnUrl)};`];
  if (input.singleUserMode) {
    lines.push(`window.__SPO_SINGLE_USER__=true;`);
  }
  if (input.forceWorld) {
    lines.push(`window.__SPO_FORCE_WORLD__=${JSON.stringify(input.forceWorld)};`);
  }
  if (input.bugReport) {
    lines.push(`window.__SPO_BUG_REPORT__=true;`);
  }
  if (input.registerUrl) {
    lines.push(`window.__SPO_REGISTER_URL__=${JSON.stringify(input.registerUrl)};`);
  }
  return lines.join('\n');
}
