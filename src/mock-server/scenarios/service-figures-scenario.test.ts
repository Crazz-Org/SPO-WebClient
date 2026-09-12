/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `service-figures` — driven through the real gateway.
 *
 * Part 1 fixes the catalogue and the wire: both members are 1-argument
 * `function`s, so every frame carries `"^"` and exactly one argument — the
 * service index. Part 2 drives the real `getBuildingServiceFigures` against an
 * `RdoMock` loaded with the scenario, and asserts the two figures come back the
 * way the block answered them, not the way the cache holds them.
 */

import { RdoProtocol } from '@/server/rdo';
import { RdoValue } from '@/shared/rdo-types';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import type { RdoPacket } from '@/shared/types';
import { getBuildingServiceFigures } from '@/server/session/building-details-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { RdoMock } from '../rdo-mock';
import {
  createServiceFiguresScenario,
  SERVICE_FIGURES_BLOCK,
  SERVICE_FIGURES_INDEX,
  SERVICE_FIGURES_ANSWERS,
  SERVICE_FIGURES_CACHED,
} from './service-figures-scenario';

const { rdo } = createServiceFiguresScenario();

const X = 118;
const Y = 226;

describe('service-figures scenario — the catalogue and the wire', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('RDOGetDemand and RDOGetSupply are catalogued 1-argument functions', () => {
    for (const member of ['RDOGetDemand', 'RDOGetSupply'] as const) {
      expect(RDO_MEMBERS[member]).toEqual({ kind: 'function', arity: 1 });
    }
  });

  it('every frame carries the "^" read form, never the void "*"', () => {
    for (const ex of rdo.exchanges) {
      expect(ex.request).toContain('"^"');
      expect(ex.request).not.toContain('"*"');
    }
  });

  it('matches each frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });

  it('answers figures that disagree with the cached columns, so a cache read cannot pass', () => {
    expect(SERVICE_FIGURES_ANSWERS.supply).not.toBe(SERVICE_FIGURES_CACHED.srvSupplies);
    expect(SERVICE_FIGURES_ANSWERS.demand).not.toBe(SERVICE_FIGURES_CACHED.srvDemands);
  });
});

describe('service-figures scenario — the drive', () => {
  function makeCtx() {
    const fake = makeSessionCtx({ sockets: ['construction'] });
    (fake.ctx.getCacherPropertyListAt as jest.Mock).mockResolvedValue([SERVICE_FIGURES_BLOCK]);

    const mock = new RdoMock();
    mock.addScenario(rdo);

    fake.respond((packet) => {
      const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
      const r = mock.match(frame);
      return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
    });

    return { fake, mock };
  }

  it('returns what the block answered, and consumes both exchanges', async () => {
    const { fake, mock } = makeCtx();

    const figures = await getBuildingServiceFigures(fake.ctx, X, Y, SERVICE_FIGURES_INDEX);

    expect(figures).toEqual({
      supply: SERVICE_FIGURES_ANSWERS.supply,
      demand: SERVICE_FIGURES_ANSWERS.demand,
    });
    expect(mock.getConsumedIds()).toEqual(new Set(['sf-rdo-demand', 'sf-rdo-supply']));
  });

  it('emits the "^" read form with the service index as the single argument', async () => {
    const { fake } = makeCtx();

    await getBuildingServiceFigures(fake.ctx, X, Y, SERVICE_FIGURES_INDEX);

    expect(fake.sent).toHaveLength(2);
    const frames = fake.sent.map(s => RdoProtocol.format(s.packet as RdoPacket));
    expect(frames[0]).toContain(`call RDOGetDemand "^" ${RdoValue.int(SERVICE_FIGURES_INDEX).format()}`);
    expect(frames[1]).toContain(`call RDOGetSupply "^" ${RdoValue.int(SERVICE_FIGURES_INDEX).format()}`);
  });

  it('the index is on the wire, not implied: another service sends another argument', async () => {
    // Not an assertion on RdoMock consumption — its matching hierarchy falls
    // through to action+member when the arguments differ, so the mock would
    // answer for any index. The frame is where the index actually lives.
    const { fake } = makeCtx();

    await getBuildingServiceFigures(fake.ctx, X, Y, 0);

    const args = fake.sent.map(s => (s.packet as RdoPacket).args?.[0]);
    expect(args).toEqual([RdoValue.int(0).format(), RdoValue.int(0).format()]);
    expect(args[0]).not.toBe(RdoValue.int(SERVICE_FIGURES_INDEX).format());
  });
});
