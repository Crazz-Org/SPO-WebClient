/**
 * Protocol Validation: Road Demolition (BreakCircuitAt)
 *
 * Drives production `demolishRoad` (road-handler.ts) on a real
 * StarpeaceSession through the protocol harness, strict validation on, and
 * pins the emitted frame as a literal (Delphi reference World.pas:4311-4354).
 *
 * BreakCircuitAt flow:
 *   sel <worldContextId> call BreakCircuitAt "^" "#1","#<ownerId>","#<x>","#<y>"
 *   -> res="#0" (success) or res="#<code>" (refusal)
 *
 * The scenario is inline (single-purpose): its request is the literal frame
 * production emits, QueryId stripped.
 */

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { describe, it, expect, afterEach } from '@jest/globals';
import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-test-harness';
import type { RdoScenario } from '../../../mock-server/types/rdo-exchange-types';
import { WsMessageType } from '../../../shared/types/message-types';

function breakCircuitScenario(result: number): RdoScenario {
  return {
    name: 'demolish-road',
    description: 'BreakCircuitAt(circuit, owner, x, y) on the world context',
    exchanges: [
      {
        id: 'dr-rdo-001',
        request: 'C sel 8161308 call BreakCircuitAt "^" "#1","#1234567","#100","#200"',
        response: `A1 res="#${result}"`,
        matchKeys: {
          verb: 'sel', action: 'call', member: 'BreakCircuitAt',
          argsPattern: ['"#1"', '"#1234567"', '"#100"', '"#200"'],
        },
      },
    ],
    variables: {},
  };
}

describe('Protocol Validation: BreakCircuitAt (Road Demolition)', () => {
  let harness: ProtocolTestHarness | undefined;

  async function setup(result: number): Promise<ProtocolTestHarness> {
    const h = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [breakCircuitScenario(result)] }],
    });
    harness = h;
    await h.session.createSocket('world', '127.0.0.1', 8000);
    h.session.setWorldContextId('8161308');
    h.session.setFTycoonProxyId(1234567);
    return h;
  }

  afterEach(() => {
    harness?.session.destroy();
    harness?.cleanup();
    harness = undefined;
  });

  it('emits BreakCircuitAt with the road circuit and the proxy id, and reports success', async () => {
    const h = await setup(0);

    const result = await h.session.demolishRoad(100, 200);

    expect(h.getCapturedCommands(0)).toEqual([
      'C 1000 sel 8161308 call BreakCircuitAt "^" "#1","#1234567","#100","#200"',
    ]);
    expect(result).toEqual({ success: true });
    h.assertNoViolations();
  });

  it('maps ERROR_AccessDenied (15) to its message', async () => {
    const h = await setup(15);

    const result = await h.session.demolishRoad(100, 200);

    expect(h.getCapturedCommands(0)).toEqual([
      'C 1000 sel 8161308 call BreakCircuitAt "^" "#1","#1234567","#100","#200"',
    ]);
    expect(result).toEqual({
      success: false,
      errorCode: 15,
      message: 'Permission denied — you do not have rights to demolish roads here',
    });
    h.assertNoViolations();
  });

  describe('message types', () => {
    it('should define REQ_DEMOLISH_ROAD message type', () => {
      expect(WsMessageType.REQ_DEMOLISH_ROAD).toBe('REQ_DEMOLISH_ROAD');
    });

    it('should define RESP_DEMOLISH_ROAD message type', () => {
      expect(WsMessageType.RESP_DEMOLISH_ROAD).toBe('RESP_DEMOLISH_ROAD');
    });

    it('should define EVENT_END_OF_PERIOD message type', () => {
      expect(WsMessageType.EVENT_END_OF_PERIOD).toBe('EVENT_END_OF_PERIOD');
    });
  });
});
