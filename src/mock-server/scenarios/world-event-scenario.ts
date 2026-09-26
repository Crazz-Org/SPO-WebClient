/**
 * The newest world event — `PickEvent` (issue 612).
 *
 * `function PickEvent( TycoonId : integer ) : OleVariant;` is a published
 * FUNCTION on `TClientView` (`Interface Server/InterfaceServer.pas:166`, body
 * `:1158-1172`), so every frame carries `"^"` and a QueryId. Unlike
 * `ContextStatusText`, the argument is the tycoon id, not the world context —
 * the façade injects nothing, the client sends `PickEvent(TycoonId)` directly
 * (`InterfaceServer.pas:166`), and that frame is already pinned elsewhere:
 * `C sel 8161308 call PickEvent "^" "#4666201923"`
 * (`src/server/__tests__/rdo/rdo-callsite-wire-format.test.ts:99`).
 *
 * `TWorld.RDOPickEvent` pops one event and returns `TEvent.Render`, `''` for
 * an empty queue (`Kernel/World.pas:4840-4871`) — a CRLF-separated
 * `Name=Value` block (`Kernel/Events.pas:99-115`). `''` is the normal "backup
 * running / DA down / nothing queued" answer (`InterfaceServer.pas:1161-1163`),
 * never an error.
 *
 * ONE EXCHANGE PER VARIANT, NOT TWO IN ONE ARRAY. Both answers travel on an
 * identical frame — `PickEvent` takes no argument that would let the mock
 * tell them apart — and no `RdoMock` match strategy skips an already-consumed
 * exchange: each returns the first exchange whose declared keys all match the
 * frame (`RdoMock.match`). Two identical-frame exchanges in one scenario would
 * answer the event block twice and leave the empty-answer exchange unconsumed
 * forever. So the
 * **test**, not this factory, plays the sequence: `mock.clearScenarios()`
 * then `mock.addScenario(createWorldEventScenario(undefined, { event: null }).rdo)`
 * between the two asks — the same "the factory option picks the answer"
 * convention `createChaseScenario(vars, { chaseResult })` already uses.
 */

import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** Matches `FAKE_CONTEXT_IDS.worldContextId` (`fake-session-context.ts:78`). */
const WORLD_CONTEXT_ID = '8161308';
/** Matches `FAKE_CONTEXT_IDS.tycoonId` (`fake-session-context.ts:79`). */
const TYCOON_ID = '4666201923';

export const EVENT_FIXTURE = {
  date: '18/02/2026',
  kind: 1,
  url: '/Five/0/Visual/Voyager/NewFacility/MsgFacility.asp?x=706&y=436',
  text: 'Farm built in Helartia',
};
export const EVENT_TILE = { x: 706, y: 436 };

function buildRdoExchanges(event: typeof EVENT_FIXTURE | null): RdoExchange[] {
  // The literal frame production emits (QueryId stripped), captured in the
  // sibling test — never rebuilt with the emitter.
  const request = `C sel ${WORLD_CONTEXT_ID} call PickEvent "^" "#${TYCOON_ID}";`;
  const matchKeys = {
    verb: 'sel',
    targetId: WORLD_CONTEXT_ID,
    action: 'call',
    member: 'PickEvent',
    argsPattern: [RdoValue.int(Number(TYCOON_ID)).format()],
  };

  if (event) {
    const block = `%Date=${event.date}\r\nKind=${event.kind}\r\nURL=${event.url}\r\nText0=${event.text}\r\n`;
    return [
      {
        id: 'we-rdo-001',
        request,
        response: `A700 res="${block}"`,
        matchKeys,
      },
    ];
  }

  return [
    {
      id: 'we-rdo-002',
      request,
      response: 'A700 res="%"',
      matchKeys,
    },
  ];
}

export function createWorldEventScenario(
  overrides?: Partial<ScenarioVariables>,
  { event = EVENT_FIXTURE }: { event?: typeof EVENT_FIXTURE | null } = {},
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'world-event',
    description: 'PickEvent: a "^" function popping the newest world event, or "" for the backup / empty-queue answer',
    exchanges: buildRdoExchanges(event),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
