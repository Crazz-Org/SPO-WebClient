import { describe, it, expect } from '@jest/globals';
import { PRICE_PERCENT_MAX, NON_WAREHOUSE_TRADE_ROLES } from './trade-constants';
import { TRADE_MODE_VALUES } from '@/shared/building-details/trade-settings';

describe('trade-constants', () => {
  it('both price sliders top out at 400 %', () => {
    expect(PRICE_PERCENT_MAX).toBe(400);
  });

  it('the non-warehouse roles are Neutral, Producer, Buyer and Importer', () => {
    expect(NON_WAREHOUSE_TRADE_ROLES).toEqual(['0', '1', '3', '4']);
  });

  it('shares no role with the trade modes a warehouse can be set to', () => {
    const modes = TRADE_MODE_VALUES.map(String);
    expect(NON_WAREHOUSE_TRADE_ROLES.filter((r) => modes.includes(r))).toEqual([]);
  });
});
