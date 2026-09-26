/**
 * Store lifecycle ratchet — which store belongs to which reset path.
 *
 * Three code paths clear client state, each touching a different set of stores:
 *   - logout          `ClientBridge.reset()`            (bridge/client-bridge.ts)
 *   - company switch  `applyLocalCompanySwitch`         (handlers/auth-handler.ts)
 *   - reconnect       `ClientBridge.setReconnecting()`  (bridge/client-bridge.ts)
 *
 * They are listed here, not merged. Everything is derived from the sources at test
 * time: every exported `use…Store` in this directory, and — for each path — the
 * stores its body writes into (`useXStore.getState()`). "Reset set" means exactly
 * that: the stores the path writes into; a company switch re-points `useGameStore`
 * rather than clearing it.
 *
 * Every store must be either in a path's reset set or in that path's SURVIVES list
 * with a reason. Adding a store forces a decision for each of the three paths.
 */

import * as fs from 'fs';
import * as path from 'path';

type PathName = 'logout' | 'company switch' | 'reconnect';

const SRC = path.join(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

function collectStores(): Set<string> {
  const names = new Set<string>();
  const files = fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts');
  for (const file of files) {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const m of text.matchAll(/export\s+(?:const|function)\s+(use[A-Z]\w*Store)\b/g)) {
      names.add(m[1]);
    }
  }
  return names;
}

/** The body of the block opened by the first `{` after `signature`, brace-matched. */
function bodyOf(fileText: string, signature: string, label: string): string {
  const at = fileText.indexOf(signature);
  if (at < 0) throw new Error(`store-lifecycle: signature for "${label}" not found: ${JSON.stringify(signature)}`);
  const open = fileText.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < fileText.length; i++) {
    const ch = fileText[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return fileText.slice(open + 1, i);
    }
  }
  throw new Error(`store-lifecycle: unbalanced braces after signature for "${label}"`);
}

function storesWrittenBy(body: string): Set<string> {
  const names = new Set<string>();
  for (const m of body.matchAll(/\b(use[A-Z]\w*Store)\.getState\(\)/g)) names.add(m[1]);
  return names;
}

const PATHS: Record<PathName, { file: string; signature: string }> = {
  'logout': { file: 'bridge/client-bridge.ts', signature: '  reset(): void {' },
  'company switch': {
    file: 'handlers/auth-handler.ts',
    signature: 'export function applyLocalCompanySwitch(ctx: ClientHandlerContext, company: CompanyInfo): void {',
  },
  'reconnect': { file: 'bridge/client-bridge.ts', signature: '  setReconnecting(): void {' },
};

const LOG_REASON = 'A 500-entry debug ring buffer for the page, not tied to any session.';
const RECONNECT_REASON =
  'The reconnect replays login + selectCompanyAndStart for the same user, world and company '
  + '(attemptReconnect in client.ts), so the data is still the player\'s.';

/** Store name → why the path leaves it alone. */
const SURVIVES: Record<PathName, Record<string, string>> = {
  'logout': {
    useChatStore: 'Not cleared by this path today: channels, messages, the online list and typing state.',
    useLogStore: LOG_REASON,
    useMailStore: 'Not cleared by this path today: folder navigation, message list and compose state.',
    useMapStore: 'Not cleared by this path today: the Map surface\'s renderer source and the camera history.',
    useNewspaperStore: 'Not cleared by this path today: the open town paper and what was last read off it.',
    useTutorialStore: 'Not cleared by this path today: the last tutorial assignment the server reported.',
    useUiStore: 'Not cleared by this path today: panel visibility, modals, command palette and mobile navigation.',
  },
  'company switch': {
    useChatStore: 'Not cleared by this path today: channels, messages, the online list and typing state.',
    useEmpireStore: 'Not cleared by this path today: the Favorites tree of owned facilities.',
    useLogStore: LOG_REASON,
    useMailStore: 'Not cleared by this path today: folder navigation, message list and compose state.',
    useMapStore: 'The camera history is positions on the same world map, which a company switch keeps.',
    useNewspaperStore: 'Not cleared by this path today: the open town paper and what was last read off it.',
    usePoliticsStore: 'Not cleared by this path today: the town politics data last fetched.',
    useSearchStore: 'Not cleared by this path today: the directory search pages last fetched.',
    useTutorialStore: 'Not cleared by this path today: the last tutorial assignment the server reported.',
  },
  'reconnect': {
    useBuildingStore: RECONNECT_REASON,
    useEmpireStore: RECONNECT_REASON,
    useLogStore: LOG_REASON,
    useMailStore: RECONNECT_REASON,
    useMapStore: RECONNECT_REASON,
    useNewspaperStore: RECONNECT_REASON,
    usePoliticsStore: RECONNECT_REASON,
    useProfileStore: RECONNECT_REASON,
    useSearchStore: RECONNECT_REASON,
    useTutorialStore: RECONNECT_REASON,
    useUiStore: RECONNECT_REASON,
  },
};

const STORES = collectStores();
const RESET_SETS: Record<PathName, Set<string>> = {
  'logout': storesWrittenBy(bodyOf(read(PATHS['logout'].file), PATHS['logout'].signature, 'logout')),
  'company switch': storesWrittenBy(
    bodyOf(read(PATHS['company switch'].file), PATHS['company switch'].signature, 'company switch'),
  ),
  'reconnect': storesWrittenBy(bodyOf(read(PATHS['reconnect'].file), PATHS['reconnect'].signature, 'reconnect')),
};
const PATH_NAMES = Object.keys(PATHS) as PathName[];

describe('store lifecycle ratchet', () => {
  it('collects every store in src/client/store', () => {
    expect(STORES.has('useGameStore')).toBe(true);
    expect(STORES.size).toBeGreaterThanOrEqual(13);
  });

  it('bodyOf names the missing signature', () => {
    expect(() => bodyOf('nothing here', 'reset(): void {', 'x')).toThrow(/signature for "x" not found/);
    expect(() => bodyOf('reset(): void { {', 'reset(): void {', 'y')).toThrow(/unbalanced braces/);
  });

  describe.each(PATH_NAMES)('%s', (pathName) => {
    it('writes into at least one store', () => {
      expect(RESET_SETS[pathName].size).toBeGreaterThan(0);
    });

    it.each([...STORES].sort())('%s is reset or listed with a reason', (store) => {
      const reset = RESET_SETS[pathName].has(store);
      const reason = (SURVIVES[pathName][store] ?? '').trim();
      expect({ store, path: pathName, decided: reset || reason !== '' })
        .toEqual({ store, path: pathName, decided: true });
    });

    it('lists only real stores', () => {
      const unknown = Object.keys(SURVIVES[pathName]).filter((s) => !STORES.has(s));
      expect(unknown).toEqual([]);
    });

    it('lists no store the path already resets', () => {
      const stale = Object.keys(SURVIVES[pathName]).filter((s) => RESET_SETS[pathName].has(s));
      expect(stale).toEqual([]);
    });
  });
});
