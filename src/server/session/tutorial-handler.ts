/**
 * Tutorial handler — the onboarding curriculum's read and its four actions.
 *
 * The engine is entirely server-side. A live assignment publishes itself onto
 * the tycoon's own cache object under the `Tutorial` prefix
 * (`Kernel/KernelCache.pas:1126-1131`, written by `TTask.StoreToCache`,
 * `Tasks/Tasks.pas:521-550`), and the four things a player can do to it are
 * dispatched against the raw task object id the cache carries
 * (`Tasks/ModifyTask.asp:13`, `:23-34`).
 *
 * So there is nothing to invent here: read the cache by path, and bind the id
 * it hands back. When the world's Tutorial parameter is off, no assignment is
 * ever written, `ActiveTutorial` stays empty, and {@link fetchTutorialState}
 * answers `null` — which is how "a tycoon with no assignment sees nothing at
 * all" is satisfied by construction rather than by a UI guard.
 */

import type { SessionContext } from './session-context';
import type { TutorialState, TutorialActionType } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall, rdoSet } from '../../shared/rdo-frame';
import { writeRdoFrame } from '../rdo-helpers';
import { toErrorMessage } from '../../shared/error-utils';

// =========================================================================
// PRIVATE HELPERS
// =========================================================================

/**
 * Parse a boolean value from the Delphi cache.
 * Accepts '1', '-1', or 'true' (case-insensitive) as truthy — the renderings
 * `TObjectCache.WriteBoolean` can produce.
 */
function parseBooleanCacheValue(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === '-1' || v === 'true';
}

function parseIntCacheValue(value: string | undefined): number {
  return parseInt(value || '', 10) || 0;
}

// =========================================================================
// PUBLIC API
// =========================================================================

/**
 * The `Tutorial*` fields the panel needs, in the order `GetPropertyList`
 * returns them.
 *
 * `ActiveTutorial` is not one of `StoreToCache`'s fields — it is the tycoon's
 * own flag, the same one `TycoonOptions.asp:12` tests before offering the
 * Tutorial button, and it leads the list for that reason.
 */
export const TUTORIAL_PROPS = [
  'ActiveTutorial', 'TutorialObjId', 'TutorialId', 'TutorialName',
  'TutorialStage', 'TutorialProgress', 'TutorialGoal', 'TutorialTaskDone',
  'TutorialCompany', 'TutorialTown',
] as const;

/**
 * Read the tycoon's live assignment off the object cache, or `null`.
 *
 * The path is the tycoon folder `Tycoons\<name>.five\` — the same object
 * `queryTycoonPoliticalRole` reads (`building-management-handler.ts:41-63`) and
 * the one `Tutorial.asp:23` / `ModifyTask.asp:10-11` open.
 *
 * A path that does not resolve is not an error and is not special-cased: the
 * Delphi cache server answers `GetPropertyList` with one empty value per
 * requested name whichever object the handle points at, so a tycoon with no
 * assignment and a tycoon whose folder is missing arrive identically — as
 * `null`, which is what both mean here.
 */
export async function fetchTutorialState(ctx: SessionContext): Promise<TutorialState | null> {
  // The plain directory name, preferred over `activeUsername`: that one may
  // hold a role, and a role has no tutorial folder of its own.
  const tycoonName = ctx.cachedUsername || ctx.activeUsername || '';
  if (!tycoonName) return null;

  await ctx.connectMapService();
  const tempObjId = await ctx.cacherCreateObject();
  let values: string[];
  try {
    await ctx.cacherSetPath(tempObjId, `Tycoons\\${tycoonName}.five\\`);
    values = await ctx.cacherGetPropertyList(tempObjId, [...TUTORIAL_PROPS]);
  } finally {
    await ctx.cacherCloseObject(tempObjId);
  }

  const active = (values[0] || '').trim();
  const taskObjId = parseIntCacheValue(values[1]);
  const kindId = (values[2] || '').trim();

  // The exact test the legacy pages make: `TycoonOptions.asp:12` gates the
  // button on `ActiveTutorial <> ""`, `Tutorial.asp:26-30` on `TutorialId`.
  // A zero object id is added because binding an RDO proxy to object 0 is a
  // request with no destination, so an assignment we could not act on is not
  // an assignment we should draw.
  if (active === '' || kindId === '' || taskObjId === 0) return null;

  return {
    taskObjId: String(taskObjId),
    kindId,
    name: values[3] || '',
    stage: parseIntCacheValue(values[4]),
    progress: parseIntCacheValue(values[5]),
    goal: values[6] || '',
    done: parseBooleanCacheValue(values[7]),
    company: values[8] || '',
    town: values[9] || '',
  };
}

/**
 * Run one of the four assignment actions, then re-read the state.
 *
 * `next` / `prev` / `close` are Pascal `procedure`s (`RDONextStep`,
 * `RDOPrevStep`, `RDOClose`, all declared on `TInformativeTask`,
 * `Tasks/InformativeTask.pas:15-17`): they answer nothing, so the frame going
 * out is the whole of what this function can report. `complete` is a `set` on
 * the published `Completed` property (`Tasks/Tasks.pas:156`, the form
 * `ModifyTask.asp:32-33` uses), which does get a reply.
 *
 * About the re-read: `RDONextStep` calls `UpdateObjectCache` before it
 * re-notifies (`InformativeTask.pas:46-48`), so the second read usually lands
 * on the new stage. Usually, not always — a lagging cache read is expected
 * (`OB-29`) and is not a failure. The kind-1 push the server sends right after
 * makes the browser ask again, which is what actually settles the panel.
 */
export async function runTutorialAction(
  ctx: SessionContext, action: TutorialActionType,
): Promise<{ success: boolean; message: string; state: TutorialState | null }> {
  try {
    const state = await fetchTutorialState(ctx);
    if (state === null) {
      // Emit nothing: there is no object to bind.
      return { success: false, message: 'No active assignment', state: null };
    }

    await ctx.connectConstructionService();
    const socket = ctx.getSocket('construction');
    if (!socket) throw new Error('Construction socket unavailable');

    ctx.log.debug(`[Tutorial] ${action} on TutorialObjId ${state.taskObjId}`);

    if (action === 'complete') {
      // -1 is the Delphi WordBool TRUE (login-handler.ts:705).
      await ctx.sendRdoRequest(
        'construction',
        rdoSet('Completed', state.taskObjId, RdoValue.int(-1)).packet,
        undefined,
        TimeoutCategory.NORMAL,
      );
    } else {
      const member = action === 'next' ? 'RDONextStep' : action === 'prev' ? 'RDOPrevStep' : 'RDOClose';
      // The declared `useless : integer` the body never reads.
      writeRdoFrame(socket, rdoCall(member, state.taskObjId, RdoValue.int(0)).toFrame());
    }

    return { success: true, message: '', state: await fetchTutorialState(ctx) };
  } catch (e: unknown) {
    ctx.log.warn(`[Tutorial] ${action} failed: ${toErrorMessage(e)}`);
    return { success: false, message: toErrorMessage(e), state: null };
  }
}
