/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * The two people-search patterns, checked where they are actually built.
 *
 * The assertion that matters is the first argument of `RDOSearchKey`: `"%*"`
 * inside one bucket for the A-Z index (`DirectoryServer.wsc:841-847`), the
 * wrapped `"%*term*"` across 26 buckets for a typed term. Nothing here builds a
 * frame by hand — the gateway's own `searchPeople` is driven and its frames are
 * matched back against the exchanges.
 */

import { RdoProtocol } from '@/server/rdo';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import { searchPeople } from '@/server/session/login-handler';
import { makeLoginCtx } from '@/server/__tests__/session/fake-session-context';
import type { RdoPacket } from '@/shared/types';
import { RdoVerb } from '@/shared/types';
import { RdoMock } from '../rdo-mock';
import {
  createPeopleSearchScenario,
  peopleSearchArgs,
  containsPattern,
  PREFIX_PATTERN,
  PEOPLE_SEARCH_KEY,
  PEOPLE_SEARCH_LETTER,
  PEOPLE_SEARCH_TERM,
} from './people-search-scenario';

const { rdo } = createPeopleSearchScenario();
const vars = rdo.variables as Record<string, string>;

/** Drive the real gateway and hand back every frame it put on the wire. */
async function emit(term: string, mode: 'contains' | 'prefix') {
  const fake = makeLoginCtx();
  fake.respond((packet: Partial<RdoPacket>) => {
    if (packet.verb === RdoVerb.IDOF) return `objid="${vars.directoryServerId}"`;
    if (packet.member === 'RDOOpenSession') return `RDOOpenSession="#${vars.directorySessionId}"`;
    if (packet.member === 'RDOSetCurrentKey') return 'res="#-1"';
    if (packet.member === 'RDOSearchKey') return 'res="%Count=0"';
    return 'res="%"';
  });

  await searchPeople(fake.ctx, term, mode);

  return fake.sent.map(s => ({
    packet: s.packet,
    frame: `${RdoProtocol.format(s.packet as never)};`,
  }));
}

describe('people-search scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('RDOSearchKey is a 2-argument function, so both search frames carry "^"', () => {
    expect(RDO_MEMBERS.RDOSearchKey.kind).toBe('function');
    expect(RDO_MEMBERS.RDOSearchKey).toHaveProperty('arity', 2);

    for (const ex of rdo.exchanges) {
      if (ex.matchKeys?.action !== 'call') continue;
      expect(ex.request).toContain('"^"');
      expect(ex.request).not.toContain('"*" ');
    }
  });

  it('matches each frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });

  it('the two patterns are the ones the exchanges carry', () => {
    expect(PREFIX_PATTERN).toBe('*');
    expect(containsPattern(PEOPLE_SEARCH_TERM)).toBe('*Crazz*');
    expect(peopleSearchArgs(PREFIX_PATTERN).map(a => a.format()))
      .toEqual(['"%*"', '"%Alias\r\n"']);
  });
});

describe('people-search scenario — the pattern on the wire', () => {
  it('a prefix request searches one bucket with "%*"', async () => {
    const sent = await emit(PEOPLE_SEARCH_LETTER, 'prefix');

    const setKeys = sent.filter(s => s.packet.member === 'RDOSetCurrentKey');
    expect(setKeys).toHaveLength(1);
    expect(setKeys[0].packet.args).toEqual([`"%${PEOPLE_SEARCH_KEY}"`]);

    const searches = sent.filter(s => s.packet.member === 'RDOSearchKey');
    expect(searches).toHaveLength(1);

    const mock = new RdoMock();
    mock.addScenario(rdo);
    expect(mock.match(searches[0].frame)!.exchange.id).toBe('ps-rdo-004');
  });

  it('a typed request sweeps 26 buckets with the wrapped "%*Crazz*"', async () => {
    const sent = await emit(PEOPLE_SEARCH_TERM, 'contains');

    expect(sent.filter(s => s.packet.member === 'RDOSetCurrentKey')).toHaveLength(26);

    const searches = sent.filter(s => s.packet.member === 'RDOSearchKey');
    expect(searches).toHaveLength(26);

    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const s of searches) {
      expect(s.packet.args?.[0]).toBe(`"%${containsPattern(PEOPLE_SEARCH_TERM)}"`);
      expect(mock.match(s.frame)!.exchange.id).toBe('ps-rdo-005');
    }
  });
});
