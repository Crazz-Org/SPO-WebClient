/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `gate-map` — driven through the real gateway.
 *
 * Part 1 fixes the catalogue: every exchange is a catalogued `function`, so
 * every request carries `"^"`, never `"*"`. Part 2 drives the real
 * `getBuildingTabData` / `getBuildingGateConnections` against a single
 * `RdoMock` shared by both RDO channels a session can use — `sendRdoRequest`
 * ("^", captured by `fake.respond`) and `cacherGetPropertyList` (mocked
 * directly on the fake, since the harness never wires it back onto the wire).
 * That is what lets one scenario answer both the `GetInputNames` list and the
 * `GateMap` / header `GetPropertyList` reads with a single, consistent set of
 * exchanges — and what lets the drive test prove the middle gate's `SetPath`
 * and header exchanges are never consumed.
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
  createGateMapScenario,
  GATE_MAP_TARGETS,
  GATE_MAP_INPUTS,
  GATE_MAP_VALUE,
  SUPPLY_HEADER_NAMES,
} from './gate-map-scenario';

const { rdo } = createGateMapScenario();

describe('gate-map scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('GetInputNames, SetPath and GetPropertyList are catalogued functions, so every frame carries "^"', () => {
    for (const member of ['GetInputNames', 'SetPath', 'GetPropertyList'] as const) {
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

describe('gate-map scenario — the drive', () => {
  const X = 472;
  const Y = 392;
  const VISUAL_CLASS = '9558';

  function makeGateMapCtx() {
    const fake = makeSessionCtx({ sockets: ['map'] });
    fake.cacher.createObject.mockResolvedValue(GATE_MAP_TARGETS.tempObject);

    const mock = new RdoMock();
    mock.addScenario(rdo);

    fake.respond((packet) => {
      const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
      const r = mock.match(frame);
      return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
    });

    fake.cacher.getPropertyList.mockImplementation(async (id: string, names: string[]) => {
      const frame = rdoCall('GetPropertyList', id, RdoValue.string(names.join('\t') + '\t')).toFrame();
      const r = mock.match(frame);
      if (!r) return [];
      return cleanPayload(RdoProtocol.parse(r.response).payload ?? '').split('\t');
    });

    return { fake, mock };
  }

  beforeEach(() => {
    registerInspectorTabs(
      '9558',
      [{ tabName: 'Supplies', tabHandler: 'Supplies' }],
      'Gate Map Factory',
    );
  });

  afterEach(() => {
    clearInspectorTabsCache();
  });

  it('lists two supplies out of three names, and records no header read for the middle gate', async () => {
    const { fake, mock } = makeGateMapCtx();

    const { supplies } = await getBuildingTabData(fake.ctx, X, Y, 'supplies', VISUAL_CLASS);

    expect(supplies?.map(s => s.path)).toEqual([GATE_MAP_INPUTS[0].path, GATE_MAP_INPUTS[2].path]);
    expect(mock.getConsumedIds()).toEqual(new Set(['gm-rdo-gatemap', 'gm-rdo-inputs']));
    expect(fake.sent.some(s => s.packet.member === 'SetPath')).toBe(false);

    for (const gate of supplies ?? []) {
      await getBuildingGateConnections(fake.ctx, X, Y, 'supplies', gate.path, gate.name, VISUAL_CLASS);
    }

    const consumed = mock.getConsumedIds();
    expect(consumed.has('gm-rdo-setpath-chemicals')).toBe(true);
    expect(consumed.has('gm-rdo-setpath-fuel')).toBe(true);
    expect(consumed.has('gm-rdo-header')).toBe(true);
    // The trap: the disabled middle gate's SetPath must never be sent.
    expect(consumed.has('gm-rdo-setpath-ore')).toBe(false);

    const sentSetPathPaths = fake.sent
      .filter(s => s.packet.member === 'SetPath')
      .map(s => s.packet.args?.[0]);
    expect(sentSetPathPaths).toEqual([
      RdoValue.string(GATE_MAP_INPUTS[0].path).format(),
      RdoValue.string(GATE_MAP_INPUTS[2].path).format(),
    ]);

    const gateMapReads = fake.cacher.getPropertyList.mock.calls.filter(
      ([, names]) => names.length === 1 && names[0] === 'GateMap',
    );
    expect(gateMapReads).toHaveLength(1);

    const headerReads = fake.cacher.getPropertyList.mock.calls.filter(
      ([, names]) => names.join(',') === SUPPLY_HEADER_NAMES.join(','),
    );
    expect(headerReads).toHaveLength(2);

    releaseInspector(fake.ctx);
  });

  it('the GateMap the scenario answers is exactly \'101\' — bit 1 disabled', () => {
    expect(GATE_MAP_VALUE).toBe('101');
    expect(GATE_MAP_INPUTS).toHaveLength(3);
  });
});
