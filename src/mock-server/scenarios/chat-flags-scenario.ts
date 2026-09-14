/**
 * `chat-flags` — a `ChatMsg` push whose sender carries the packed AccDesc
 * (`ComposeChatUser`, `Protocol/Protocol.pas:482-492`), pushed at
 * `Interface Server/InterfaceServer.pas:3923`. `ChatMsg` is a `procedure`
 * (`Protocol/Protocol.pas:206`), so every frame here carries `"*"`, no
 * QueryId and no reply — the same shape as `show-notification-scenario.ts`.
 *
 * Two exchanges: a speaker absent from the local user list, whose badge can
 * only come from the AccDesc carried on the line, and a speaker present in
 * the user list with the same tier and modifiers, proving nothing changes
 * for a known speaker.
 */

import type { RdoExchange, RdoScenario } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** `(0x0010 << 16) | 8000` -> Duke + GameMaster. */
export const CHAT_FLAGS_STRANGER_ACCDESC = 1056576;
/** `(0x0080 << 16) | 500` -> Baron + Veteran. */
export const CHAT_FLAGS_KNOWN_ACCDESC = 8389108;

function substitute(template: string, vars: ScenarioVariables): string {
  return template.replace('{{tycoonProxyId}}', vars.tycoonProxyId);
}

function buildRdoExchanges(vars: ScenarioVariables): RdoExchange[] {
  return [
    {
      id: 'chat-flags-stranger',
      request: '',
      response: substitute(
        `C sel {{tycoonProxyId}} call ChatMsg "*" "%Zorg/${CHAT_FLAGS_STRANGER_ACCDESC}/0","%hi from outside the list :)";`,
        vars,
      ),
      pushOnly: true,
    },
    {
      id: 'chat-flags-known',
      request: '',
      response: substitute(
        `C sel {{tycoonProxyId}} call ChatMsg "*" "%SPO_test3/${CHAT_FLAGS_KNOWN_ACCDESC}/0","%still the same badge";`,
        vars,
      ),
      pushOnly: true,
    },
  ];
}

export function createChatFlagsScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'chat-flags',
    description: 'ChatMsg: a sender absent from the user list decorated from its own AccDesc, and one present with no change',
    exchanges: buildRdoExchanges(vars),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
