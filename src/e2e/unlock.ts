/**
 * `npm run e2e:unlock` — clear a world-dirty lock after a human has restored the world.
 *
 * The last resort after `runLive`'s automatic replay. Before refusing a run on a dirty world,
 * `runLive` already tried every pending restore that carries a structured target, and cleared the
 * lock itself when each read its original back. What is left needs a person: confirm the game
 * state is sane again, put back what the replay could not, then run this (doc/E2E-POLICY.md §6).
 */

import { WorldLock } from './world-lock';

export function unlock(lock: WorldLock = new WorldLock()): string {
  const previous = lock.forceUnlock();
  if (!previous.dirty && previous.pendingRestores.length === 0) {
    return 'No dirty lock was held — nothing to clear.';
  }
  const pending = previous.pendingRestores
    .map(
      p =>
        `  - ${p.what}${p.x !== undefined ? ` at (${p.x},${p.y}) ${p.propertyName}` : ''} ` +
        `-> "${p.originalValue}" [key: ${p.key ?? '(none — written before keys existed)'}]`,
    )
    .join('\n');
  return [
    `Cleared a dirty lock from ${previous.dirtySince ?? 'an earlier run'}.`,
    previous.dirtyReason ? `Reason: ${previous.dirtyReason}` : '',
    pending ? `Values that were pending a restore — confirm they are back:\n${pending}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

if (require.main === module) {
  process.stdout.write(`${unlock()}\n`);
}
