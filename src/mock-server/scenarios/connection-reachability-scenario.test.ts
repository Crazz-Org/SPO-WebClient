/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `connection-reachability` — driven through the real gateway.
 *
 * Part 1 fixes the catalogue: every exchange is a catalogued `function`
 * (`"^"` — `CloseObject` is the one procedure, `"*"`), and every frame matches
 * back to its own exchange except the shared `cr-rdo-near`, whose value the
 * drive answers per bound coordinate instead.
 *
 * Part 2 drives `searchConnections` and then `resolveConnectionReachability`
 * against a single `RdoMock` shared by both RDO channels a session uses:
 * `sendRdoRequest` ("^" — FindSuppliers and, since `cacherSetObject` discards
 * its own reply, the sweep's own `SetObject` reads too) captured by
 * `fake.respond`, and `cacherGetPropertyList` / `cacherCreateObject` /
 * `cacherCloseObject` mocked directly on the fake, the same split
 * `gate-map-scenario.test.ts:71-92` uses.
 */

import { RdoProtocol } from '@/server/rdo';
import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import type { RdoPacket } from '@/shared/types';
import { searchConnections, resolveConnectionReachability } from '@/server/session/politics-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { rolesToMask, ALL_CONNECTION_ROLES } from '@/shared/connection-roles';
import { RdoMock } from '../rdo-mock';
import {
  createConnectionReachabilityScenario,
  REACHABILITY_BUILDING,
  REACHABILITY_CANDIDATES,
  REACHABILITY_TEMP_OBJECT,
  NEAR_CIRCUITS_AT,
} from './connection-reachability-scenario';

const { rdo } = createConnectionReachabilityScenario();

describe('connection-reachability scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('every exchange but CloseObject is a catalogued function, carrying "^"; CloseObject carries "*"', () => {
    for (const ex of rdo.exchanges) {
      if (ex.id === 'cr-rdo-close') {
        expect(RDO_MEMBERS.CloseObject.kind).toBe('procedure');
        expect(ex.request).toContain('"*"');
      } else {
        expect(ex.request).toContain('"^"');
        expect(ex.request).not.toContain('"*"');
      }
    }
  });

  it('matches each frame back to its own exchange, except the shared cr-rdo-near', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      const match = mock.match(ex.request);
      expect(match).not.toBeNull();
      if (ex.id !== 'cr-rdo-near') {
        expect(match!.exchange.id).toBe(ex.id);
      }
    }
  });
});

describe('connection-reachability scenario — the drive', () => {
  function makeDriveCtx() {
    const fake = makeSessionCtx({ currentWorldInfo: { name: 'Shamba', url: '', ip: '', port: 0 } });
    fake.cacher.createObject.mockResolvedValue(REACHABILITY_TEMP_OBJECT);

    const mock = new RdoMock();
    mock.addScenario(rdo);

    fake.respond((packet) => {
      const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
      const r = mock.match(frame);
      return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
    });

    /** The (x, y) of the last `SetObject` frame the sweep sent. */
    const lastBoundPosition = (): string => {
      const sets = fake.sent.filter(s => s.packet.member === 'SetObject');
      const last = sets[sets.length - 1];
      const x = parseInt((last.packet.args?.[0] ?? '').replace(/[^\d-]/g, ''), 10);
      const y = parseInt((last.packet.args?.[1] ?? '').replace(/[^\d-]/g, ''), 10);
      return `${x},${y}`;
    };

    fake.cacher.getPropertyList.mockImplementation(async (id: string, props: string[]) => {
      expect(id).toBe(REACHABILITY_TEMP_OBJECT);
      expect(props).toEqual(['NearCircuits']);
      const key = lastBoundPosition();
      const frame = rdoCall('GetPropertyList', REACHABILITY_TEMP_OBJECT, RdoValue.string('NearCircuits\t')).toFrame();
      mock.match(frame); // documents/consumes the shared wire-shape exchange
      if (!(key in NEAR_CIRCUITS_AT)) throw new Error(`no NearCircuits fixture for ${key}`);
      return [NEAR_CIRCUITS_AT[key]];
    });

    return { fake, mock };
  }

  it('FindSuppliers then the reachability sweep yield the connected/isolated/isolated/unknown split', async () => {
    const { fake, mock } = makeDriveCtx();

    const results = await searchConnections(
      fake.ctx, REACHABILITY_BUILDING.x, REACHABILITY_BUILDING.y, REACHABILITY_BUILDING.fluidId, 'input',
      { roles: rolesToMask('input', ALL_CONNECTION_ROLES) },
    );
    expect(results.map(r => ({ x: r.x, y: r.y }))).toEqual(
      REACHABILITY_CANDIDATES.map(c => ({ x: c.x, y: c.y })),
    );

    const onBatch = jest.fn();
    const entries = await resolveConnectionReachability(
      fake.ctx, REACHABILITY_BUILDING.x, REACHABILITY_BUILDING.y,
      results.map(r => ({ x: r.x, y: r.y })),
      onBatch,
    );

    expect(entries.map(e => e.reachability)).toEqual(REACHABILITY_CANDIDATES.map(c => c.expect));

    const consumed = mock.getConsumedIds();
    expect(consumed.has('cr-rdo-set-self')).toBe(true);
    for (const id of ['cr-rdo-set-near', 'cr-rdo-set-far', 'cr-rdo-set-roadless', 'cr-rdo-set-ghost']) {
      expect(consumed.has(id)).toBe(true);
    }
    expect(consumed.has('cr-rdo-near')).toBe(true);

    expect(fake.cacher.closeObject).toHaveBeenCalledTimes(1);
    expect(fake.cacher.closeObject).toHaveBeenCalledWith(REACHABILITY_TEMP_OBJECT);
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith(entries);
  });
});
