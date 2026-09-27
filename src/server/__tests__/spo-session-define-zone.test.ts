/**
 * DefineZone — driven through production `defineZone` (zone-surface-handler.ts)
 * on a real StarpeaceSession, via the protocol harness with strict validation on.
 *
 * The frame pinned below is the one production emits: a 6-argument FUNCTION
 * call carrying `"^"` and a QueryId, the same form the #912 lock in
 * `src/shared/rdo-separator-lock.test.ts` pins. An earlier version of this file
 * rebuilt the frame itself with a void-push builder (`"*"`), a form production
 * never emitted.
 */

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { describe, it, expect, afterEach } from '@jest/globals';
import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-validation/protocol-test-harness';
import { createDefineZoneScenario } from '../../mock-server/scenarios/define-zone-scenario';

describe('defineZone (production) — DefineZone wire frame', () => {
  let harness: ProtocolTestHarness;

  async function setup(result?: number): Promise<void> {
    const scenario = result === undefined
      ? createDefineZoneScenario()
      : createDefineZoneScenario(undefined, { result });
    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [scenario.rdo] }],
    });
    await harness.session.createSocket('world', '127.0.0.1', 8000);
    harness.session.setWorldContextId('8161308');
    harness.session.setTycoonId('4666201923');
  }

  afterEach(() => {
    harness.session.destroy();
    harness.cleanup();
  });

  it('emits the "^" function frame with normalised corners and reports success on NOERROR', async () => {
    await setup();

    // Corners passed inverted on purpose: production normalises them.
    const result = await harness.session.defineZone(2, 102, 102, 100, 100);

    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 sel 8161308 call DefineZone "^" "#4666201923","#2","#100","#100","#102","#102"',
    ]);
    expect(result).toEqual({ success: true });
    harness.assertNoViolations();
  });

  it('reports the refusal code and message on ERROR_Unknown', async () => {
    await setup(1);

    const result = await harness.session.defineZone(2, 100, 100, 102, 102);

    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 sel 8161308 call DefineZone "^" "#4666201923","#2","#100","#100","#102","#102"',
    ]);
    expect(result).toEqual({
      success: false,
      errorCode: 1,
      message: 'Zone refused by the server: Unknown error (code 1)',
    });
    harness.assertNoViolations();
  });
});
