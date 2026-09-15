/**
 * ShowNotification — the Interface Server's one push for "tell the player
 * something", a 4-argument `procedure Kind, Title, Body, Options`
 * (`Protocol/Protocol.pas:219`), pushed at
 * `Interface Server/InterfaceServer.pas:2202`. It is a `procedure`, so every
 * frame here carries `"*"`, no QueryId and no reply — a `"^"` would build a
 * reply with no destination.
 *
 * The kind constants (`Protocol/Protocol.pas:178-186`) are the whole routing:
 * Voyager dispatched on them in one `case` (`Voyager/VoyagerWindow.pas:506-563`)
 * — a message box for kind 0, a URL frame for kind 1, `SayThis` for kinds 2
 * and 3, and `SayThis` plus a Build page refresh for kind 4 when `Options = 1`.
 * These four frames pin one push per kind (0, 1, 2, 4) so the browser
 * dispatch this scenario drives can be checked against the reference
 * behaviour rather than the flattened "always toast" it replaces.
 */

import type { RdoExchange, RdoScenario } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The four pushes this scenario carries, keyed by kind. */
export const NOTIFICATIONS = {
  0: 'C sel {{tycoonProxyId}} call ShowNotification "*" "#0","%Server maintenance","%The world restarts in 10 minutes.","#0";',
  // Options `#4` is `nopTutorial_SHOW`, the default `MetaTask.NotOptions`
  // (Tasks/Tasks.pas:285, constants :29-32) — `#0` is `nopTutorial_OFF` and
  // means the opposite, "take the tutorial affordance away"
  // (Tasks/Tasks.pas:636-644). The body is the URL shape `TTask.GetBaseURL`
  // actually builds (Tasks/Tasks.pas:620-634, prefix :12).
  1: 'C sel {{tycoonProxyId}} call ShowNotification "*" "#1","%Your first assignment","%http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/Tasks/Welcome/0/default.asp?Tycoon=SPO_test3&WorldName=Shamba","#4";',
  2: 'C sel {{tycoonProxyId}} call ShowNotification "*" "#2","%Mayor","% has raised the sales tax.","#0";',
  4: 'C sel {{tycoonProxyId}} call ShowNotification "*" "#4","%","%Research ""Water Quest Licenses"" completed. Check for new items in your Build page.","#1";',
} as const;

function substitute(template: string, vars: ScenarioVariables): string {
  return template.replace('{{tycoonProxyId}}', vars.tycoonProxyId);
}

function buildRdoExchanges(vars: ScenarioVariables): RdoExchange[] {
  return (Object.keys(NOTIFICATIONS) as unknown as Array<keyof typeof NOTIFICATIONS>).map((kind) => ({
    id: `notif-kind${kind}`,
    request: '',
    response: substitute(NOTIFICATIONS[kind], vars),
    pushOnly: true,
  }));
}

export function createShowNotificationScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'show-notification',
    description: 'ShowNotification: one push per kind (0, 1, 2, 4) — a dialog, a tutorial assignment, a chat line and a catalogue invalidation',
    exchanges: buildRdoExchanges(vars),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
