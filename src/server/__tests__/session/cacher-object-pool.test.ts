/**
 * The cacher object pool, answered by a capture instead of a stub.
 *
 * `makeSessionCtx({ wireCacher: true })` runs the production
 * `cacher-object-pool` module over the fake's recording transport, so every
 * cacher frame goes out through `sendRdoRequest` (or the map socket, for the
 * `CloseObject` procedure) and the captured `connection-reachability` scenario
 * answers it through `RdoMock`. The expected frames are the scenario's own
 * string literals, never rebuilt with the emitter.
 */

import { RdoProtocol } from '@/server/rdo';
import { RdoMock } from '@/mock-server/rdo-mock';
import { createConnectionReachabilityScenario } from '@/mock-server/scenarios/connection-reachability-scenario';
import { makeSessionCtx } from './fake-session-context';
import type { FakeSessionCtx } from './fake-session-context';

const WORLD_NAME = 'Shamba';

function makeDriver(): { fake: FakeSessionCtx; mock: RdoMock; req: (id: string) => string | undefined } {
  const { rdo } = createConnectionReachabilityScenario({ worldName: WORLD_NAME });
  const mock = new RdoMock();
  mock.addScenario(rdo);

  const fake = makeSessionCtx({
    sockets: ['map'],
    wireCacher: true,
    currentWorldInfo: { name: WORLD_NAME, url: '', ip: '', port: 0 },
  });
  fake.respond((packet) => {
    const frame = `${RdoProtocol.format(packet as never)};`;
    const hit = mock.match(frame);
    return hit ? hit.response.replace(/^A\d+\s+/, '') : new Error(`L1: no exchange for ${frame}`);
  });

  const req = (id: string) => rdo.exchanges.find(e => e.id === id)?.request;
  return { fake, mock, req };
}

describe('cacher-object-pool — answered by the connection-reachability capture', () => {
  it('drives CreateObject → SetObject → GetPropertyList → CloseObject on the captured frames', async () => {
    const { fake, mock, req } = makeDriver();

    const tempObjectId = await fake.ctx.cacherCreateObject();
    await fake.ctx.cacherSetObject(tempObjectId, 472, 392);
    const values = await fake.ctx.cacherGetPropertyList(tempObjectId, ['NearCircuits']);
    fake.ctx.cacherCloseObject(tempObjectId);

    expect(tempObjectId).toBe('900002');
    expect(values).toEqual(['17,42,']);

    expect(fake.sent).toHaveLength(3);
    expect(fake.sent.map(s => s.socketName)).toEqual(['map', 'map', 'map']);
    expect(fake.sent.map(s => `${RdoProtocol.format(s.packet as never)};`)).toEqual([
      req('cr-rdo-create'),
      req('cr-rdo-set-self'),
      req('cr-rdo-near'),
    ]);
    expect(fake.frames.map).toEqual([req('cr-rdo-close')]);

    const consumed = mock.getConsumedIds();
    expect(consumed.has('cr-rdo-create')).toBe(true);
    expect(consumed.has('cr-rdo-set-self')).toBe(true);
    expect(consumed.has('cr-rdo-near')).toBe(true);

    expect(fake.cacher.getPropertyList).toHaveBeenCalledWith('900002', ['NearCircuits']);
  });

  it('a read the capture never recorded fails loudly', async () => {
    const { fake } = makeDriver();

    await expect(fake.ctx.cacherGetPropertyList('900002', ['Unknown'])).rejects.toThrow('L1: no exchange');
    expect(fake.sent).toHaveLength(1);
  });
});

describe('cacher-object-pool — wiring is opt-in', () => {
  it('without wireCacher the fake cacher emits nothing', async () => {
    const fake = makeSessionCtx({ sockets: ['map'] });

    await fake.ctx.cacherSetObject('7', 1, 1);
    fake.ctx.cacherCloseObject('7');

    expect(fake.cacher.setObject).toHaveBeenCalledTimes(1);
    expect(fake.sent).toHaveLength(0);
    expect(fake.frames.map).toHaveLength(0);
  });
});
