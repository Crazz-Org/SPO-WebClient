/**
 * CreateChannel — making a chat channel, and what the wire says when the name
 * was already taken.
 *
 * `function CreateChannel( ChannelName, Password, aSessionApp, aSessionAppId :
 * widestring; anUserLimit : integer ) : OleVariant`
 * (`Interface Server/InterfaceServer.pas:186`) — a published FUNCTION on
 * `TClientView`, so both frames here carry `"^"` and a QueryId and the server
 * answers `res="#<code>"`. A `"*"` would be an arbitrary memory write with no
 * error to show for it, which is why the requests below are built by the real
 * emitter (`rdoCall`) and the separator comes from the catalogue.
 *
 * **Five arguments, and the middle two are the trap.** The reference client's
 * New Channel dialog sent `('', '', 100)` for the session app, its id and the
 * user limit (`Voyager.1/URLHandlers/ChatHandlerViewer.pas:221`) — empty
 * strings, not omitted. Drop them and `anUserLimit` lands in `aSessionApp`'s
 * slot and is read as a widestring: no error, no reply difference, a channel
 * with a meaningless session app and a zero user limit.
 *
 * **The push asymmetry is the whole point.** The body (`:1512-1533`) looks the
 * name up first: unknown → `ClientCreatedChannel`, which is the only thing that
 * broadcasts `uchInclusion` (`:4594`); taken → it falls through to
 * `JoinChannel`, which broadcasts nothing. Both answer `0`, so the presence or
 * absence of that push is the only wire evidence distinguishing the two — and
 * it is encoded here, in the fixture, never in production code: the broadcast
 * travels on a different path with no correlation id, so no client could pair
 * it with its own call, and nothing needs the distinction anyway.
 *
 * `13` (`ERROR_InvalidPassword`) and `32` (`ERROR_NotEnoughRoom`,
 * `Protocol/Protocol.pas:42,61`) are reachable through the `JoinChannel`
 * fall-through alone, so they are themselves proof the name was taken;
 * `createCreateChannelScenario(vars, { takenResult })` is how a test asks for
 * one of them.
 */

import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import { CHANNEL_USER_LIMIT } from '@/shared/chat-channel';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** A name nobody holds — `GetChannel` returns nil and the channel is created. */
export const FREE_CHANNEL = 'Traders';

/** A name already on the server — the call falls through to `JoinChannel`. */
export const TAKEN_CHANNEL = 'Podan Merchants';

/** The password both attempts carry. */
export const CHANNEL_PASSWORD = 's3cret';

/**
 * The `uchInclusion` broadcast `ClientCreatedChannel` fans out to every
 * `TClientView` (`InterfaceServer.pas:4049`, `:4594`). A push: `"*"`, no
 * QueryId, nothing to answer. `uchInclusion = 0` (`Protocol/Protocol.pas:120`).
 *
 * Written out literally rather than built by `rdoCall`:
 * `NotifyChannelListChange` is inbound only, so it is not — and must not be —
 * in the catalogue of what this client emits.
 */
export function channelInclusionPush(clientViewId: string, name: string, password: string): string {
  return `C sel ${clientViewId} call NotifyChannelListChange "*" "%${name}","%${password}","#0";`;
}

function createArgs(name: string) {
  return [
    RdoValue.string(name),
    RdoValue.string(CHANNEL_PASSWORD),
    RdoValue.string(''),
    RdoValue.string(''),
    RdoValue.int(CHANNEL_USER_LIMIT),
  ];
}

function buildRdoExchanges(clientViewId: string, takenResult: number): RdoExchange[] {
  const freeArgs = createArgs(FREE_CHANNEL);
  const takenArgs = createArgs(TAKEN_CHANNEL);

  return [
    {
      id: 'create-channel-free',
      request: rdoCall('CreateChannel', clientViewId, ...freeArgs).toFrame(),
      response: 'A1 res="#0"',
      // Created: ClientCreatedChannel broadcast the inclusion (:4594).
      pushes: [channelInclusionPush(clientViewId, FREE_CHANNEL, CHANNEL_PASSWORD)],
      matchKeys: {
        verb: 'sel',
        targetId: clientViewId,
        action: 'call',
        member: 'CreateChannel',
        argsPattern: freeArgs.map(a => a.format()),
      },
    },
    {
      id: 'create-channel-taken',
      request: rdoCall('CreateChannel', clientViewId, ...takenArgs).toFrame(),
      response: `A2 res="#${takenResult}"`,
      // Taken: JoinChannel answered instead, and it broadcasts nothing.
      pushes: [],
      matchKeys: {
        verb: 'sel',
        targetId: clientViewId,
        action: 'call',
        member: 'CreateChannel',
        argsPattern: takenArgs.map(a => a.format()),
      },
    },
  ];
}

export function createCreateChannelScenario(
  overrides?: Partial<ScenarioVariables>,
  { takenResult = 0 }: { takenResult?: number } = {},
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'create-channel',
    description: 'CreateChannel: a 5-argument "^" function on the ClientView — a free name (created, inclusion push) and a taken one (joined, no push)',
    exchanges: buildRdoExchanges(vars.clientViewId, takenResult),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
