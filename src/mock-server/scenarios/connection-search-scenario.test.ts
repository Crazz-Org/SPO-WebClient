/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * The `Role` argument of the two searches, checked where it is actually built.
 *
 * The assertion that matters is the ninth argument of the frame the real
 * gateway emits: `"#54"` for a supplier search with every box ticked, `"#78"`
 * for a customer search. 54 is not a number chosen here — it is the `#54` of the
 * captured trace (`src/server/__tests__/rdo/connection-search.test.ts:9`), and
 * the client used to send 27 for the same four boxes.
 */

import { RdoProtocol } from '@/server/rdo';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import { RdoValue } from '@/shared/rdo-types';
import {
  ALL_CONNECTION_ROLES, rolesToMask, type ConnectionRoleFlags,
} from '@/shared/connection-roles';
import { searchConnections } from '@/server/session/politics-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '@/server/__tests__/session/fake-session-context';
import { RdoMock } from '../rdo-mock';
import {
  createConnectionSearchScenario,
  connectionSearchArgs,
  CONNECTION_SEARCH_CACHER_ID,
  CONNECTION_SEARCH_QUERY,
  ROLE_ARG_INDEX,
  SUPPLIER_SEARCH_ROLE,
  CLIENT_SEARCH_ROLE,
} from './connection-search-scenario';

const { rdo } = createConnectionSearchScenario();

const NO_ROLES: ConnectionRoleFlags = {
  producer: false, distributer: false, importer: false,
  exporter: false, buyer: false, compImporter: false,
};

/**
 * Drive the real gateway with the captured query and give back the frame it
 * put on the wire. Nothing here builds a frame by hand.
 */
async function emit(direction: 'input' | 'output', roles: number) {
  const fake = makeSessionCtx({
    currentWorldInfo: { name: 'Shamba', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 7000 },
  });
  fake.respond(() => 'res="%"');

  const q = CONNECTION_SEARCH_QUERY;
  await searchConnections(fake.ctx, q.x, q.y, q.fluidId, direction, { roles });

  expect(fake.sent).toHaveLength(1);
  const packet = fake.sent[0].packet;
  return { packet, frame: `${RdoProtocol.format(packet as never)};` };
}

describe('connection-search scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('both searches are 9-argument functions, so both frames carry "^"', () => {
    for (const member of ['FindSuppliers', 'FindClients'] as const) {
      expect(RDO_MEMBERS[member].kind).toBe('function');
      expect(RDO_MEMBERS[member]).toHaveProperty('arity', 9);
    }
    for (const ex of rdo.exchanges) {
      expect(ex.request).toContain('"^"');
      expect(ex.request).not.toContain('"*"');
    }
  });

  it('the cacher id the exchanges address is the one a session holds', () => {
    expect(CONNECTION_SEARCH_CACHER_ID).toBe(FAKE_CONTEXT_IDS.cacherId);
  });

  it('every request parses as a well-formed sel/call frame', () => {
    for (const ex of rdo.exchanges) {
      const parsed = RdoProtocol.parse(ex.request);
      expect(parsed.verb).toBe('sel');
      expect(parsed.action).toBe('call');
      expect(parsed.member).toBe(ex.matchKeys!.member);
    }
  });

  it('matches each search frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });
});

describe('connection-search scenario — the Role argument on the wire', () => {
  it('a supplier search with every box ticked puts "#54" ninth', async () => {
    const { packet, frame } = await emit('input', rolesToMask('input', ALL_CONNECTION_ROLES));

    expect(packet.member).toBe('FindSuppliers');
    expect(packet.args?.[ROLE_ARG_INDEX]).toBe(RdoValue.int(54).format());

    const mock = new RdoMock();
    mock.addScenario(rdo);
    expect(mock.match(frame)!.exchange.id).toBe('cs-rdo-001');
  });

  it('a customer search with every box ticked puts "#78" ninth', async () => {
    const { packet, frame } = await emit('output', rolesToMask('output', ALL_CONNECTION_ROLES));

    expect(packet.member).toBe('FindClients');
    expect(packet.args?.[ROLE_ARG_INDEX]).toBe(RdoValue.int(78).format());

    const mock = new RdoMock();
    mock.addScenario(rdo);
    expect(mock.match(frame)!.exchange.id).toBe('cs-rdo-002');
  });

  it('the two exchanges carry exactly those two masks', () => {
    expect(SUPPLIER_SEARCH_ROLE).toBe(54);
    expect(CLIENT_SEARCH_ROLE).toBe(78);
    expect(connectionSearchArgs('input', 'Shamba')[ROLE_ARG_INDEX].format()).toBe('"#54"');
    expect(connectionSearchArgs('output', 'Shamba')[ROLE_ARG_INDEX].format()).toBe('"#78"');
  });

  it('Factories only puts "#2" on the wire — rolProducer, not rolNeutral', async () => {
    const { packet } = await emit('input', rolesToMask('input', { ...NO_ROLES, producer: true }));
    expect(packet.args?.[ROLE_ARG_INDEX]).toBe('"#2"');
  });

  it('no box ticked reaches the wire as "#0", not as a fallback mask', async () => {
    // `byte([])` is what Voyager emits; the gateway's `??` is what lets 0
    // through where `||` used to replace it with 31.
    const { packet } = await emit('input', rolesToMask('input', NO_ROLES));
    expect(packet.args?.[ROLE_ARG_INDEX]).toBe('"#0"');
  });
});
