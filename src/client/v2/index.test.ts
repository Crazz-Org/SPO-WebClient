import { describe, it, expect } from '@jest/globals';
import * as v2 from './index';
import { GameScreenV2 } from './GameScreenV2';

describe('v2 barrel', () => {
  it('exposes GameScreenV2 for App to lazy-load', () => {
    expect(v2.GameScreenV2).toBe(GameScreenV2);
  });
});
