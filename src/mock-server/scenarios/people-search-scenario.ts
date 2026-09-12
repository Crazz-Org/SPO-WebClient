/**
 * People search — the two patterns the directory page puts on the wire.
 *
 * The People page offers two ways to reach the same roster, and they differ by
 * exactly one argument of `RDOSearchKey`:
 *
 *  - **prefix** (the A-Z index): one bucket, the bare `*` pattern. This is what
 *    the reference client emitted for a single letter — `SearchUsers` narrows to
 *    `Root/Users/<Letter>` and searches it with `"*"`
 *    (`~/SPO-ASP/Five/Web Objects/DirectoryServer.wsc:841-847`) — and the server
 *    turns it into `Entry LIKE 'Root/Users/<Letter>/%'`, i.e. every player in the
 *    bucket (`~/SPO-Original/Directory Server/DirectoryManager.pas:1001-1017`,
 *    where `FormatQuery` maps `*` to `%`).
 *  - **contains** (the typed path): the wrapped `*term*` pattern, swept across
 *    all 26 buckets.
 *
 * A wrong pattern costs no crash and no error reply — the server simply answers
 * about other players — so the only place the difference can be caught is here,
 * against the frame the real gateway emits.
 *
 * Both `RDOSearchKey` requests are built by the real emitter (`rdoCall`), so the
 * fixture cannot drift from what ships, and the separator and arity come from
 * the catalogue rather than from this file. `idof` is the one exception: it
 * exists to read an object id, so it has no fire-and-forget form the emitter can
 * build (`rdo-frame.ts:180-186`) — it is written here as the other scenarios
 * write it.
 */

import { rdoCall, rdoGet } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** The bucket the exchanges below address — `Root/Users/C`. */
export const PEOPLE_SEARCH_LETTER = 'C';
export const PEOPLE_SEARCH_KEY = `Root/Users/${PEOPLE_SEARCH_LETTER}`;

/** The term the contains exchange searches for. */
export const PEOPLE_SEARCH_TERM = 'Crazz';

/** The A-Z index pattern: the bare `*`, inside one bucket. */
export const PREFIX_PATTERN = '*';

/** The typed-search pattern: the term, wrapped. */
export function containsPattern(term: string): string {
  return `*${term}*`;
}

/**
 * Byte-for-byte `"Alias" & vbCrLf` (`DirectoryServer.wsc:835-836`). The list is
 * never empty — the server wraps its whole body in `if valueNames.Count > 0`.
 */
export const PEOPLE_SEARCH_VALUE_NAMES = 'Alias\r\n';

/** The two arguments of one `RDOSearchKey`, in emitter order. */
export function peopleSearchArgs(pattern: string): RdoValue[] {
  return [RdoValue.string(pattern), RdoValue.string(PEOPLE_SEARCH_VALUE_NAMES)];
}

/** One row: `crazz` in the `C` bucket, aliased `Crazz`. */
const SEARCH_ANSWER = 'res="%Count=1\r\nKey0=crazz\r\nAlias0=Crazz\r\n"';

function buildRdoExchanges(vars: ScenarioVariables): RdoExchange[] {
  const setKeyArg = RdoValue.string(PEOPLE_SEARCH_KEY);
  const prefixArgs = peopleSearchArgs(PREFIX_PATTERN);
  const containsArgs = peopleSearchArgs(containsPattern(PEOPLE_SEARCH_TERM));

  return [
    {
      id: 'ps-rdo-001',
      request: `C 0 idof "DirectoryServer"`,
      response: `A0 objid="${vars.directoryServerId}"`,
      matchKeys: { verb: 'idof', targetId: 'DirectoryServer' },
    },
    {
      id: 'ps-rdo-002',
      request: rdoGet('RDOOpenSession', vars.directoryServerId).toFrame(),
      response: `A1 RDOOpenSession="#${vars.directorySessionId}"`,
      matchKeys: { verb: 'sel', action: 'get', member: 'RDOOpenSession' },
    },
    {
      id: 'ps-rdo-003',
      request: rdoCall('RDOSetCurrentKey', vars.directorySessionId, setKeyArg).toFrame(),
      // `#-1` — the bucket exists, so the search that follows is issued.
      response: `A2 res="#-1"`,
      matchKeys: {
        verb: 'sel', action: 'call', member: 'RDOSetCurrentKey',
        argsPattern: [setKeyArg.format()],
      },
    },
    {
      id: 'ps-rdo-004',
      request: rdoCall('RDOSearchKey', vars.directorySessionId, ...prefixArgs).toFrame(),
      response: `A3 ${SEARCH_ANSWER}`,
      matchKeys: {
        verb: 'sel', action: 'call', member: 'RDOSearchKey',
        argsPattern: prefixArgs.map(a => a.format()),
      },
    },
    {
      id: 'ps-rdo-005',
      request: rdoCall('RDOSearchKey', vars.directorySessionId, ...containsArgs).toFrame(),
      response: `A4 ${SEARCH_ANSWER}`,
      matchKeys: {
        verb: 'sel', action: 'call', member: 'RDOSearchKey',
        argsPattern: containsArgs.map(a => a.format()),
      },
    },
  ];
}

export function createPeopleSearchScenario(
  overrides?: Partial<ScenarioVariables>,
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'people-search',
    description: 'RDOSearchKey: the A-Z index pattern "*" in one bucket vs the typed "*term*" sweep',
    exchanges: buildRdoExchanges(vars),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
