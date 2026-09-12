/**
 * Worker counts — the Workforce tab's live jobs-filled read.
 *
 * The cached `Workers{n}` property only moves when the whole panel is re-read.
 * The reference client did not wait for that: `Voyager/WorkforceSheet.pas:365-377`
 * binds to `CurrBlock` and calls `RDOGetWorkers(kind)` once per class whose
 * cached maximum is above zero, on its own 20 s timer.
 *
 * Three things this fixture holds that nothing else can:
 *
 *  - **the separator.** `RDOGetWorkers` is a 1-argument published FUNCTION
 *    (`Kernel/WorkCenterBlock.pas:139`), so the frame carries `"^"` and a reply
 *    comes back. A `"*"` here would be an arbitrary memory write on the real
 *    server, with no error to show for it.
 *  - **the bind target.** The call goes to the building's BLOCK, never to the
 *    cacher temp object the inspector holds — a frame sent against the temp
 *    object would reach a member that is not there.
 *  - **one call per staffed class, and no more.** A class with no jobs costs no
 *    call; the exchanges below are per-kind, so a gateway that asked for all
 *    three regardless would leave one unconsumed.
 *
 * Every request is built by the real emitter (`rdoCall`), so the fixture cannot
 * drift from what ships, and the separator and arity come from the catalogue
 * rather than from this file.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The factory's block id — `MOCK_FACTORY.id` + 1, as a block id is. */
export const WORKER_COUNTS_BLOCK = '127706281';

/** The cacher temp object the inspector holds — distinct from the block id. */
export const WORKER_COUNTS_TEMP_OBJECT = '7735';

/** What each class answers: executives, professionals, workers. */
export const WORKER_COUNTS: Record<number, number> = { 0: 5, 1: 14, 2: 69 };

function buildRdoExchanges(): RdoExchange[] {
  return [0, 1, 2].map((kind) => {
    const arg = RdoValue.int(kind);
    return {
      id: `wc-rdo-get-workers-${kind}`,
      request: rdoCall('RDOGetWorkers', WORKER_COUNTS_BLOCK, arg).toFrame(),
      response: `A${kind} res="#${WORKER_COUNTS[kind]}"`,
      matchKeys: {
        verb: 'sel',
        targetId: WORKER_COUNTS_BLOCK,
        action: 'call',
        member: 'RDOGetWorkers',
        argsPattern: [arg.format()],
      },
    };
  });
}

export function createWorkerCountsScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'worker-counts',
    description: 'RDOGetWorkers: one "^" call per staffed workforce class, bound to the building block',
    exchanges: buildRdoExchanges(),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
