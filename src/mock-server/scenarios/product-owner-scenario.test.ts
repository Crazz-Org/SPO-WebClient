/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `product-owner` — driven through the real gateway.
 *
 * Part 1 fixes the catalogue: every exchange is a catalogued `function`, so
 * every request carries `"^"`, never `"*"`. Part 2 drives the real
 * `getBuildingTabData` / `getBuildingGateConnections` against a single
 * `RdoMock` shared by both RDO channels a session can use, exactly as
 * `gate-map-scenario.test.ts` does, and asserts the full decoded connection —
 * so any shift of the seven Voyager positions by the appended eighth column
 * fails alongside a missing owner.
 */

import { RdoProtocol } from '@/server/rdo';
import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import type { RdoPacket } from '@/shared/types';
import { cleanPayload } from '@/server/rdo-helpers';
import {
  getBuildingTabData,
  getBuildingGateConnections,
  releaseInspector,
} from '@/server/session/building-details-handler';
import { registerInspectorTabs, clearInspectorTabsCache } from '@/shared/building-details';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { RdoMock } from '../rdo-mock';
import {
  createProductOwnerScenario,
  PRODUCT_OWNER_TARGETS,
  PRODUCT_OWNER_GATE,
  PRODUCT_OWNER,
} from './product-owner-scenario';

const { rdo } = createProductOwnerScenario();

describe('product-owner scenario — the catalogue', () => {
  it('GetOutputNames, SetPath, GetPropertyList and GetSubObjectProps are catalogued functions, so every frame carries "^"', () => {
    for (const member of ['GetOutputNames', 'SetPath', 'GetPropertyList', 'GetSubObjectProps'] as const) {
      expect(RDO_MEMBERS[member].kind).toBe('function');
    }
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
});

describe('product-owner scenario — the drive', () => {
  const X = 481;
  const Y = 396;
  const VISUAL_CLASS = '9559';

  function makeProductOwnerCtx() {
    const fake = makeSessionCtx({ sockets: ['map'] });
    fake.cacher.createObject.mockResolvedValue(PRODUCT_OWNER_TARGETS.tempObject); // substrate-exception: the fake's cacher emits no frame, so no RdoMock scenario can answer it

    const mock = new RdoMock();
    mock.addScenario(rdo);

    fake.respond((packet) => {
      const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
      const r = mock.match(frame);
      return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
    });

    fake.cacher.getPropertyList.mockImplementation(async (id: string, names: string[]) => { // substrate-exception: the fake's cacher emits no frame, so no RdoMock scenario can answer it
      const frame = rdoCall('GetPropertyList', id, RdoValue.string(names.join('\t') + '\t')).toFrame();
      const r = mock.match(frame);
      if (!r) return [];
      return cleanPayload(RdoProtocol.parse(r.response).payload ?? '').split('\t');
    });

    return { fake, mock };
  }

  beforeEach(() => {
    registerInspectorTabs(
      '9559',
      [{ tabName: 'Products', tabHandler: 'Products' }],
      'Product Owner Factory',
    );
  });

  afterEach(() => {
    clearInspectorTabsCache();
  });

  it("reads a product customer's owning tycoon off the eighth column, with the seven Voyager positions unshifted", async () => {
    const { fake, mock } = makeProductOwnerCtx();

    const { products } = await getBuildingTabData(fake.ctx, X, Y, 'products', VISUAL_CLASS);

    expect(products?.map(p => p.path)).toEqual([PRODUCT_OWNER_GATE.path]);

    const { product } = await getBuildingGateConnections(
      fake.ctx, X, Y, 'products', PRODUCT_OWNER_GATE.path, PRODUCT_OWNER_GATE.name, VISUAL_CLASS,
    );

    expect(product?.connections[0]).toEqual({
      facilityName: 'Drug Store 10',
      companyName: 'Yellow Inc.',
      createdBy: PRODUCT_OWNER,
      price: '',
      overprice: '',
      lastValue: '120',
      cost: '$15',
      quality: '',
      connected: true,
      x: 477,
      y: 392,
    });

    // Consumed by the drive itself, before the re-match loop below touches the mock.
    expect(mock.getConsumedIds().has('po-rdo-cnx0')).toBe(true);

    // The customer row read on the gate: seven Voyager names, cnxCreatedBy0 appended last.
    const cnxFrames = fake.sent
      .filter(s => s.packet.member === 'GetSubObjectProps')
      .map(s => `${RdoProtocol.format(s.packet as RdoPacket)};`);
    expect(cnxFrames).toEqual([
      'C sel 900002 call GetSubObjectProps "^" "#0","%cnxFacilityName0\tcnxCompanyName0\tLastValueCnxInfo0\tConnectedCnxInfo0\ttCostCnxInfo0\tcnxXPos0\tcnxYPos0\tcnxCreatedBy0\t";',
    ]);

    // Every frame production sent that a fixture answers equals that fixture's
    // literal byte for byte (the cacher reads emit no frame and are not here).
    const hits = fake.sent
      .map(s => `${RdoProtocol.format(s.packet as RdoPacket)};`)
      .map(frame => ({ frame, hit: mock.match(frame) }))
      .filter(h => h.hit !== null);
    for (const { frame, hit } of hits) {
      expect(frame).toBe(hit!.exchange.request);
    }
    expect(new Set(hits.map(h => h.hit!.exchange.id))).toEqual(new Set(['po-rdo-outputs', 'po-rdo-setpath', 'po-rdo-cnx0']));
    expect(hits.map(h => h.frame)).toPassStrictRdoValidation(rdo);

    releaseInspector(fake.ctx);
  });
});
