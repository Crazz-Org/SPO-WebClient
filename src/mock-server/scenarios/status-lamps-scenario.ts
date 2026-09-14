/**
 * Two status lamps — who is watching your area, and whether a backup is running
 * (issue 611).
 *
 * `NotifyCompanionship` carries one `widestring` argument, a `#13#10`-separated
 * list of the players viewing the same map rectangle (`Protocol/Protocol.pas:211`,
 * comment at `:171-173`). An *empty* push is a normal push, not an absence — a
 * client that only reacted to a non-empty list would leave the lamp lit forever
 * once the last watcher moved away.
 *
 * `ModelStatusChanged` carries one ordinal status (`Protocol/Protocol.pas:220`);
 * `mstBusy = 0` is what the interface server turns into the human sentence about
 * writing backup files (`Interface Server/InterfaceServer.pas:3844-3860`).
 *
 * Both are server-initiated pushes nobody answers, so — like `chaseMoveToPush` /
 * `chaseLeavePush` (`chase-scenario.ts:53-60`) — they are built by hand here
 * rather than through the emitter: a push is never something this client sends,
 * so it is never catalogued in `rdo-members.ts`.
 *
 * The scenario's one RDO exchange is the `get ServerBusy` the reconnect re-poll
 * sends (`spo_session.ts` §3.2) — proof the frame that poll builds is one the
 * world can actually answer. It answers busy (`#-1`). A second, distinctly
 * answered exchange for the same argument-less member is not something
 * `RdoMock` can express: `methodMatch` returns the first array-order exchange
 * for a repeated member match regardless of consumption, so `nthOccurrenceMatch`
 * never runs for two exchanges sharing a bare `matchKeys.member` — one exchange
 * is what this scenario can honestly pin.
 */

import { rdoGet } from '@/shared/rdo-frame';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** Two watchers looking at the same part of the map. */
export const WATCHERS = ['Crazz', 'SPO_test3'];

/** A `NotifyCompanionship` push, hand-built like `chaseMoveToPush` — never catalogued, never emitted by this client. */
export function companionshipPush(clientViewId: string, names: string[]): string {
  return `C sel ${clientViewId} call NotifyCompanionship "*" "%${names.join('\r\n')}";`;
}

/** A `ModelStatusChanged` push, hand-built for the same reason. */
export function modelStatusPush(clientViewId: string, status: number): string {
  return `C sel ${clientViewId} call ModelStatusChanged "*" "#${status}";`;
}

function buildRdoExchanges(clientViewId: string): RdoExchange[] {
  return [
    {
      id: 'lamps-rdo-001',
      request: rdoGet('ServerBusy', clientViewId).toFrame(),
      response: 'A1 res="#-1"',
      matchKeys: {
        verb: 'sel',
        targetId: clientViewId,
        action: 'get',
        member: 'ServerBusy',
      },
    },
  ];
}

export function createStatusLampsScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'status-lamps',
    description: 'NotifyCompanionship / ModelStatusChanged pushes and the ServerBusy poll they ride beside',
    exchanges: buildRdoExchanges(vars.clientViewId),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
