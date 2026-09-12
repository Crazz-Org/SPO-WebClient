import { describe, it, expect } from '@jest/globals';
import { HIDDEN_PROPERTY_NAMES, isHiddenProperty } from './hidden-properties';
import { HANDLER_TO_GROUP } from './template-groups';

describe('hidden properties', () => {
  it('hides every name the redesign took off the sheet', () => {
    for (const name of ['MoneyGraph',
      'UpgradeActions', 'SecurityId', 'Trouble', 'Creator', 'OwnerName',
      'CurrBlock']) {
      expect(isHiddenProperty(name)).toBe(true);
    }
  });

  /**
   * `TradeRole`/`Role` and `TradeLevel` left the list with issue 551: they are
   * the two trade settings the owner changes, and the sheet now carries a
   * control for each (Voyager's `cbMode` / `cbTrade`), so hiding the row hid the
   * only way to reach `RDOSetRole` and `RDOSetTradeLevel` from the UI.
   */
  it('leaves everything else alone, the two trade settings included', () => {
    for (const name of ['ROI', 'Cost', 'Name', 'Stopped', 'Workers0', 'GateMap',
      'TradeRole', 'Role', 'TradeLevel']) {
      expect(isHiddenProperty(name)).toBe(false);
    }
  });

  /**
   * The hide list is a RENDER filter, not a fetch filter — two of its entries
   * still do work off-screen (`SecurityId` decides `canGovern`, `MoneyGraph`
   * gates the revenue chart), so the templates must keep declaring them.
   */
  it('does not remove the hidden names from the templates that declare them', () => {
    const declared = new Set<string>();
    for (const group of Object.values(HANDLER_TO_GROUP)) {
      for (const prop of group.properties) declared.add(prop.rdoName);
    }
    expect(declared.has('SecurityId')).toBe(true);
    expect(declared.has('MoneyGraph')).toBe(true);
    // `CurrBlock` is the third: hidden on the sheet, but the upgrade section
    // must still fetch it — `enrichUpgradeTab` binds its live AcceptCloning
    // read to it, exactly as Voyager does (ManagementSheet.pas:243, :272).
    expect(declared.has('CurrBlock')).toBe(true);
  });

  it('keeps CurrBlock in the upgrade group, where the live read needs it', () => {
    const upgrade = HANDLER_TO_GROUP['facManagement'];
    expect(upgrade.properties.map(p => p.rdoName)).toContain('CurrBlock');
  });

  it('is a set, so membership does not depend on order', () => {
    expect(HIDDEN_PROPERTY_NAMES.has('SecurityId')).toBe(true);
    expect(HIDDEN_PROPERTY_NAMES.size).toBeGreaterThan(0);
  });
});
