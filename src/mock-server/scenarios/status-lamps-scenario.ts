/**
 * status-lamps — the two desktop status-pill lamps: watchers (NotifyCompanionship) and
 * backup (ModelStatusChanged).
 *
 * `NotifyCompanionship` is a `procedure NotifyCompanionship( Names : widestring )`
 * (`Protocol/Protocol.pas:211`), pushed by the Interface Server whenever another player's
 * viewport starts or stops intersecting this one's — `SetViewedArea`, `Logon` and `Logoff`
 * all trigger a recompute (`Interface Server/InterfaceServer.pas:741`, `:3263`, `:3323`).
 * The payload is the watching usernames joined with `#13#10`
 * (`Interface Server/InterfaceServer.pas:2359-2361`), and an empty string means nobody's
 * viewport currently overlaps this player's (`:2353-2361`) — the "extinguish" case the
 * criterion names.
 *
 * `ModelStatusChanged` is a `procedure ModelStatusChanged( Status : integer )`
 * (`Protocol/Protocol.pas:220`). `Protocol/Protocol.pas:191-193` declares its constants as a
 * bitmask (`mstBusy = 1`, `mstNotBusy = 2`, `mstError = 4`), which this gateway does NOT
 * follow: `push-dispatcher.ts:347-360` encodes `status = 0` as busy and `status = 1` as not
 * busy, per the card's own criterion. That divergence is deliberate and documented at length
 * in the issue-611 plan ("A protocol divergence found, and deliberately NOT fixed") — the
 * push itself is a production dead letter anyway (`TClientView.ModelStatusChanged` is an
 * empty stub, `Interface Server/InterfaceServer.pas:2211-2213`, and Voyager's own receiver is
 * empty too, `Voyager/URLHandlers/ServerCnxHandler.pas:662-664`); the lamp's live source is
 * the polled `ServerBusy` boolean, which uses the same `0`/`1` encoding on this gateway. The
 * push is exercised here because it exists and the card asks the L1 scenario to drive it.
 *
 * Both members are `procedure`s, so every frame here carries `"*"`, no QueryId and no reply —
 * a `"^"` would build a reply with no destination.
 */

import type { RdoExchange, RdoScenario } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The raw push frame NotifyCompanionship arrives as; `names` are already `#13#10`-joined. */
export function companionshipPush(targetId: string, names: string): string {
  return `C sel ${targetId} call NotifyCompanionship "*" "%${names}";`;
}

/** The raw push frame ModelStatusChanged arrives as. */
export function modelStatusChangedPush(targetId: string, status: number): string {
  return `C sel ${targetId} call ModelStatusChanged "*" "#${status}";`;
}

function buildRdoExchanges(clientViewId: string): RdoExchange[] {
  return [
    {
      id: 'companionship-two',
      request: '',
      response: companionshipPush(clientViewId, 'Crazz\r\nSPO_test3'),
      pushOnly: true,
    },
    {
      id: 'companionship-empty',
      request: '',
      response: companionshipPush(clientViewId, ''),
      pushOnly: true,
    },
    {
      id: 'backup-started',
      request: '',
      response: modelStatusChangedPush(clientViewId, 0),
      pushOnly: true,
    },
    {
      id: 'backup-finished',
      request: '',
      response: modelStatusChangedPush(clientViewId, 1),
      pushOnly: true,
    },
  ];
}

export function createStatusLampsScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'status-lamps',
    description: 'NotifyCompanionship and ModelStatusChanged: the watchers and backup status-pill lamps',
    exchanges: buildRdoExchanges(vars.clientViewId),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
