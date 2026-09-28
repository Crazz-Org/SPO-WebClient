/**
 * Handler Utilities — shared patterns extracted from client handlers.
 *
 * Eliminates repeated boilerplate across auth, building, road, zone, and chat handlers.
 */

import { toErrorMessage } from '../../shared/error-utils';
import { ClientBridge } from '../bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';

/** The renderer type returned by ctx.getRenderer() */
type Renderer = NonNullable<ReturnType<ClientHandlerContext['getRenderer']>>;

/**
 * Wraps an async operation with error logging.
 * Catches errors and logs them via ClientBridge.
 *
 * @returns The result of `fn`, or `undefined` if it threw.
 */
export async function logErrors<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err: unknown) {
    ClientBridge.log('Error', `${label}: ${toErrorMessage(err)}`);
    return undefined;
  }
}

/**
 * Runs a callback with the renderer if available. Returns the callback result
 * or `undefined` if no renderer is active.
 */
export function withRenderer<T>(
  ctx: ClientHandlerContext,
  fn: (renderer: Renderer) => T,
): T | undefined {
  const renderer = ctx.getRenderer();
  if (!renderer) return undefined;
  return fn(renderer);
}

/**
 * Sets up a keyboard handler that cancels a mode when Escape is pressed.
 * Self-removes after firing. Replaces the identical pattern in road, zone, and build-menu handlers.
 */
export function setupEscapeHandler(
  isActive: () => boolean,
  cancel: () => void,
): void {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isActive()) {
      cancel();
      document.removeEventListener('keydown', handler);
    }
  };
  document.addEventListener('keydown', handler);
}
