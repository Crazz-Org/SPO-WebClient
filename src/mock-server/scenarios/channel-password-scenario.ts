/**
 * Password-protected chat channels (issue 618).
 *
 * `GetChannelList` answers with pairs of lines — name then password, each
 * followed by `#13#10` (`Interface Server/InterfaceServer.pas:3386-3388`,
 * `LineBreak = #13#10` at `Protocol/Protocol.pas:19`). An OPEN channel's
 * password line is an EMPTY line, so the pairing must be positional and must
 * not drop blank lines before pairing them up.
 *
 * `JoinChannel( ChannelName, Password : widestring ) : OleVariant`
 * (`Interface Server/InterfaceServer.pas:187`, body `:1535-1560`) compares
 * `uppercase(Channel.fPassword) = uppercase(Password)` and answers
 * `ERROR_InvalidPassword = 13` on a mismatch, then checks
 * `(fUserLimit = 0) or (fMembers.Count < fUserLimit)` and answers
 * `ERROR_NotEnoughRoom = 32` when the channel is full, otherwise `NOERROR = 0`.
 *
 * Both members are functions, so every frame here carries `"^"` and a QueryId.
 * Each request is the literal frame production emits (QueryId stripped),
 * captured in the sibling test — never rebuilt with the emitter, so a wrong
 * catalogue entry cannot produce a matching wrong fixture.
 */

import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** An open channel: an empty password line. */
export const OPEN_CHANNEL = 'Trade';

/** A protected channel: a non-empty password line. */
export const PROTECTED_CHANNEL = 'Boardroom';

/** The correct password for `PROTECTED_CHANNEL`. */
export const CHANNEL_PASSWORD = 'hunter2';

/** `fName + LineBreak + fPassword + LineBreak` per channel — InterfaceServer.pas:3386-3388. */
export const CHANNEL_LIST_RAW = `${OPEN_CHANNEL}\r\n\r\n${PROTECTED_CHANNEL}\r\n${CHANNEL_PASSWORD}\r\n`;

function buildRdoExchanges(worldId: string): RdoExchange[] {
  const emptyPassword = RdoValue.string('');
  const rightPassword = RdoValue.string(CHANNEL_PASSWORD);

  return [
    {
      id: 'channel-list',
      request: `C sel ${worldId} call GetChannelList "^" "%ROOT";`,
      response: `A1 res="%${CHANNEL_LIST_RAW}"`,
      matchKeys: {
        verb: 'sel',
        targetId: worldId,
        action: 'call',
        member: 'GetChannelList',
      },
    },
    {
      id: 'join-protected-wrong-password',
      request: `C sel ${worldId} call JoinChannel "^" "%${PROTECTED_CHANNEL}","%";`,
      response: 'A2 res="#13"',
      matchKeys: {
        verb: 'sel',
        targetId: worldId,
        action: 'call',
        member: 'JoinChannel',
        argsPattern: [RdoValue.string(PROTECTED_CHANNEL).format(), emptyPassword.format()],
      },
    },
    {
      id: 'join-protected-right-password',
      request: `C sel ${worldId} call JoinChannel "^" "%${PROTECTED_CHANNEL}","%${CHANNEL_PASSWORD}";`,
      response: 'A3 res="#0"',
      matchKeys: {
        verb: 'sel',
        targetId: worldId,
        action: 'call',
        member: 'JoinChannel',
        argsPattern: [RdoValue.string(PROTECTED_CHANNEL).format(), rightPassword.format()],
      },
    },
    {
      id: 'join-open-full',
      request: `C sel ${worldId} call JoinChannel "^" "%${OPEN_CHANNEL}","%";`,
      response: 'A4 res="#32"',
      matchKeys: {
        verb: 'sel',
        targetId: worldId,
        action: 'call',
        member: 'JoinChannel',
        argsPattern: [RdoValue.string(OPEN_CHANNEL).format(), emptyPassword.format()],
      },
    },
  ];
}

export function createChannelPasswordScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'channel-password',
    description: 'GetChannelList/JoinChannel: password-protected channels, wrong password and full-channel refusals',
    exchanges: buildRdoExchanges(vars.clientViewId),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
