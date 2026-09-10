/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * The supplier / customer search, checked against the one thing its wire format cannot state
 * on its own: the role byte.
 *
 * A `FindSuppliers` frame carrying `#1` instead of `#54` is perfectly well formed — same verb,
 * same separator, same nine arguments — and asks the server about `rolNeutral` facilities.
 * That is precisely the bug this scenario exists to fail on, so the ninth argument is asserted
 * twice here: on the fixture the emitter builds, and on the frame the real handler puts on the
 * socket when driven through `RdoMock`.
 */

import { RdoProtocol } from '@/server/rdo';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import { RdoValue } from '@/shared/rdo-types';
import { rolesToMask, ALL_CONNECTION_ROLES } from '@/shared/connection-roles';
import { searchConnections } from '@/server/session/politics-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import type { RdoPacket, WorldInfo } from '@/shared/types';
import { RdoMock } from '../rdo-mock';
import {
  createConnectionSearchScenario,
  CONNECTION_SEARCH_TARGET,
  CONNECTION_SEARCH_PROBE,
} from './connection-search-scenario';

const { rdo } = createConnectionSearchScenario();

const WORLD = { name: 'Shamba', url: '', ip: '', port: 0 } as unknown as WorldInfo;

const exchangeFor = (member: string) =>
  rdo.exchanges.find(e => e.matchKeys?.member === member)!;

describe('connection-search scenario — the frame', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('both members are functions of arity 9, so "^" and a reply are correct', () => {
    for (const member of ['FindSuppliers', 'FindClients'] as const) {
      expect(RDO_MEMBERS[member].kind).toBe('function');
      expect(RDO_MEMBERS[member]).toHaveProperty('arity', 9);
      expect(exchangeFor(member).request).toContain('"^"');
    }
  });

  it('the ninth argument of FindSuppliers is #54', () => {
    const request = exchangeFor('FindSuppliers').request;
    const parsed = RdoProtocol.parse(request);
    expect(parsed.args).toHaveLength(9);
    // `parse` strips the wire quotes; the frame itself ends on `"#54"`.
    expect(parsed.args![8]).toBe('#54');
    expect(request.endsWith('"#54";')).toBe(true);
  });

  it('the ninth argument of FindClients is #78', () => {
    const request = exchangeFor('FindClients').request;
    const parsed = RdoProtocol.parse(request);
    expect(parsed.args).toHaveLength(9);
    expect(parsed.args![8]).toBe('#78');
    expect(request.endsWith('"#78";')).toBe(true);
  });

  it('matches each search frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      const result = mock.match(ex.request);
      expect(result).not.toBeNull();
      expect(result!.exchange.id).toBe(ex.id);
    }
  });
});

describe('connection-search scenario — the gateway driven against it', () => {
  function drive() {
    const mock = new RdoMock();
    mock.addScenario(rdo);

    const fake = makeSessionCtx({ currentWorldInfo: WORLD });
    fake.respond((packet: Partial<RdoPacket>) => {
      const result = mock.match(RdoProtocol.format({ ...packet, rid: 1, type: 'REQUEST' } as RdoPacket));
      if (!result) return new Error('L1: no exchange for this frame');
      // The exchange stores the wire response; the transport hands the handler its payload.
      return result.response.replace(/^A\d+\s+/, '');
    });
    return fake;
  }

  it('a supplier search reaches the exchange with #54 and parses its row', async () => {
    const fake = drive();

    const results = await searchConnections(
      fake.ctx, CONNECTION_SEARCH_PROBE.x, CONNECTION_SEARCH_PROBE.y,
      CONNECTION_SEARCH_PROBE.fluidId, 'input',
      { maxResults: CONNECTION_SEARCH_PROBE.count, roles: rolesToMask('input', ALL_CONNECTION_ROLES) },
    );

    expect(fake.sent[0].packet.member).toBe('FindSuppliers');
    expect(fake.sent[0].packet.targetId).toBe(CONNECTION_SEARCH_TARGET.cacherId);
    expect(fake.sent[0].packet.args![8]).toBe(RdoValue.int(54).format());
    expect(results).toEqual([{
      x: 463, y: 389, facilityName: 'Trade Center', companyName: 'PGI',
      town: 'Olympus', price: '$80', quality: '40',
    }]);
  });

  it('a customer search reaches the exchange with #78 and parses its row', async () => {
    const fake = drive();

    const results = await searchConnections(
      fake.ctx, CONNECTION_SEARCH_PROBE.x, CONNECTION_SEARCH_PROBE.y,
      CONNECTION_SEARCH_PROBE.fluidId, 'output',
      { maxResults: CONNECTION_SEARCH_PROBE.count, roles: rolesToMask('output', ALL_CONNECTION_ROLES) },
    );

    expect(fake.sent[0].packet.member).toBe('FindClients');
    expect(fake.sent[0].packet.args![8]).toBe(RdoValue.int(78).format());
    expect(results).toEqual([{
      x: 200, y: 300, facilityName: 'Small Farm', companyName: 'AcmeCorp', town: 'Springfield',
    }]);
  });

  it('the gateway default alone lands on the same exchange — no filter needed', async () => {
    // If `searchConnections` ever went back to a `|| 31`, this frame would carry #31 and no
    // exchange would match it: the responder answers with an Error and the search returns [].
    const fake = drive();

    const results = await searchConnections(
      fake.ctx, CONNECTION_SEARCH_PROBE.x, CONNECTION_SEARCH_PROBE.y,
      CONNECTION_SEARCH_PROBE.fluidId, 'input',
    );

    expect(fake.sent[0].packet.args![8]).toBe(RdoValue.int(54).format());
    expect(results).toHaveLength(1);
  });
});
