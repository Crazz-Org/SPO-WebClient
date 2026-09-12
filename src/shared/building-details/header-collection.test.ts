/**
 * `collectHeaderPropertyNames` — the opening read of the facility inspector.
 *
 * The panel used to read every group of the template on open, then show one of
 * them. It now reads the first group plus the header fields, and every other
 * group when its menu entry is opened. These tests pin the contract the whole
 * load-time change rests on: the opening read is a strict subset, and it still
 * carries the two names that do work off-screen.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  registerInspectorTabs,
  clearInspectorTabsCache,
  getTemplateForVisualClass,
  collectTemplatePropertyNamesStructured,
  collectTemplatePropertyNamesForGroups,
  collectHeaderPropertyNames,
  HEADER_PROPERTY_NAMES,
} from './property-templates';
import { PRODUCTS_GROUP, HQ_INVENTIONS_GROUP } from './template-groups';

/** A four-group industrial template, the shape the old read paid for in full. */
function registerFourGroupTemplate(visualClass: string): void {
  registerInspectorTabs(visualClass, [
    { tabName: 'IndGeneral', tabHandler: 'IndGeneral' },
    { tabName: 'Workforce', tabHandler: 'Workforce' },
    { tabName: 'Upgrade', tabHandler: 'Upgrade' },
    { tabName: 'Finances', tabHandler: 'Finances' },
  ]);
}

describe('collectHeaderPropertyNames', () => {
  beforeEach(clearInspectorTabsCache);

  it('reads strictly less than the whole template', () => {
    registerFourGroupTemplate('8801');
    const template = getTemplateForVisualClass('8801');

    const header = collectHeaderPropertyNames(template);
    const everything = collectTemplatePropertyNamesStructured(template);

    expect(header.regularProperties.length).toBeLessThan(everything.regularProperties.length);
    expect(header.countProperties.length).toBeLessThanOrEqual(everything.countProperties.length);
  });

  it('covers the first group — the one the panel shows before anything is picked', () => {
    registerFourGroupTemplate('8802');
    const template = getTemplateForVisualClass('8802');

    const header = new Set(collectHeaderPropertyNames(template).regularProperties);
    for (const prop of template.groups[0].properties) {
      if (!prop.indexed && !prop.countProperty) {
        expect(header.has(prop.rdoName)).toBe(true);
      }
    }
  });

  it('carries the header fields even when no group declares them', () => {
    registerFourGroupTemplate('8803');
    const template = getTemplateForVisualClass('8803');

    const header = new Set(collectHeaderPropertyNames(template).regularProperties);
    for (const name of HEADER_PROPERTY_NAMES) {
      expect(header.has(name)).toBe(true);
    }
  });

  /**
   * `CurrBlock` is the trap: it is a `buildingId` fallback, but asking for it
   * on open hands `enrichVotesTab` a block id for every town hall and turns a
   * per-candidate `RDOVoteOf` into part of the opening cost.
   */
  it('never asks for CurrBlock', () => {
    expect(HEADER_PROPERTY_NAMES).not.toContain('CurrBlock');

    // A town hall: its first group is `townGeneral`, which does not declare
    // CurrBlock either, so the opening read cannot reach the votes enrichment.
    registerInspectorTabs('8804', [{ tabName: 'townGeneral', tabHandler: 'townGeneral' }]);
    const header = collectHeaderPropertyNames(getTemplateForVisualClass('8804'));
    expect(header.regularProperties).not.toContain('CurrBlock');
  });

  it('adds nothing a plain first-group collect would not already have, beyond the header fields', () => {
    registerFourGroupTemplate('8805');
    const template = getTemplateForVisualClass('8805');

    const firstGroupOnly = new Set(collectTemplatePropertyNamesForGroups(template, []).regularProperties);
    const extra = collectHeaderPropertyNames(template).regularProperties
      .filter((name) => !firstGroupOnly.has(name));

    for (const name of extra) expect(HEADER_PROPERTY_NAMES).toContain(name);
  });

  it('leaves a single-group template covered in full', () => {
    registerInspectorTabs('8806', [{ tabName: 'unkGeneral', tabHandler: 'unkGeneral' }]);
    const template = getTemplateForVisualClass('8806');
    expect(template.groups).toHaveLength(1);

    const header = collectHeaderPropertyNames(template);
    const everything = collectTemplatePropertyNamesStructured(template);

    // One group means the opening read IS the whole read — nothing is deferred,
    // and the panel behaves exactly as before for the simplest facilities.
    for (const name of everything.regularProperties) {
      expect(header.regularProperties).toContain(name);
    }
  });
});

describe('registerInspectorTabs tab label', () => {
  beforeEach(clearInspectorTabsCache);

  it("shows the CLASSES.BIN tab name on the handler's group", () => {
    registerInspectorTabs('8807', [{ tabName: 'CLIENTS', tabHandler: 'Products' }]);
    const template = getTemplateForVisualClass('8807');
    const group = template.groups.find(g => g.handlerName === 'Products');
    expect(group).toBeDefined();
    expect(group!.name).toBe('CLIENTS');
    expect(group!.id).toBe(PRODUCTS_GROUP.id);
    expect(group!.properties).toBe(PRODUCTS_GROUP.properties);
  });

  it('keeps the group default label when TabName is empty', () => {
    registerInspectorTabs('8808', [{ tabName: '', tabHandler: 'Products' }]);
    const template = getTemplateForVisualClass('8808');
    const group = template.groups.find(g => g.handlerName === 'Products');
    expect(group).toBeDefined();
    expect(group!.name).toBe(PRODUCTS_GROUP.name);
  });

  it('keeps the default label on a runtime-injected group', () => {
    registerInspectorTabs('8809', [{ tabName: 'GENERAL', tabHandler: 'HqGeneral' }]);
    const template = getTemplateForVisualClass('8809');
    const group = template.groups.find(g => g.handlerName === 'hdqInventions');
    expect(group).toBeDefined();
    expect(group!.name).toBe(HQ_INVENTIONS_GROUP.name);
  });
});
