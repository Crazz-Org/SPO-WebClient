/**
 * TypeScript type declarations for RDO matchers
 */

import type { RdoScenario } from '../../../mock-server/types/rdo-exchange-types';

declare global {
  namespace jest {
    interface Matchers<R> {
      toContainRdoCommand(method: string, args?: string[]): R;
      toMatchRdoFormat(): R;
      toMatchRdoCallFormat(method: string): R;
      toMatchRdoSetFormat(property: string): R;
      toHaveRdoTypePrefix(prefix: string): R;
      toMatchRdoResponse(requestId?: number): R;
      toPassStrictRdoValidation(scenario: RdoScenario): R;
    }
  }
}

export {};
