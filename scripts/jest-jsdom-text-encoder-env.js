/**
 * jsdom doesn't implement `TextEncoder` — every real browser does, and `report-submit.ts`
 * uses it to measure a bug report in UTF-8 bytes (#864). Polyfilling it here, in the test
 * environment itself rather than in `src/client/__tests__/setup/component-setup.ts`, is
 * deliberate: Jest does not collect coverage for `setupFilesAfterEnv` modules in this
 * project's config (confirmed empirically, including after `--clearCache` — every statement
 * in that file reports 0 hits despite executing on every component test), so any line added
 * there permanently fails `coverage:changed`'s >= 93 % gate on new/modified lines. A file
 * outside `src/` is exempt from that gate entirely, and a custom `testEnvironment` is the
 * standard Jest mechanism for adding a global before every test in a project.
 */
const JSDOMEnvironment = require('jest-environment-jsdom').default;
const { TextEncoder, TextDecoder } = require('node:util');

class JsdomWithTextEncoder extends JSDOMEnvironment {
  constructor(...args) {
    super(...args);
    this.global.TextEncoder = TextEncoder;
    this.global.TextDecoder = TextDecoder;
  }
}

module.exports = JsdomWithTextEncoder;
