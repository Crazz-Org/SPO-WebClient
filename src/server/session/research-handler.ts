/**
 * research-handler — Research inventory and invention detail queries.
 *
 * Extracted from StarpeaceSession to keep the class lean.
 * Every exported function takes `ctx: SessionContext` as its first argument.
 */

import type { SessionContext } from './session-context';
import type { ResearchCategoryData, ResearchInventionDetails } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { parsePropertyResponse as parsePropertyResponseHelper } from '../rdo-helpers';
import { parseResearchItems } from './session-utils';
import { getActiveResearchStatus, markActiveDeveloping } from './research-status-handler';

/**
 * Fetch the full research inventory (available / developing / completed) for
 * a single category at the given building coordinates.
 */
export async function getResearchInventory(
  ctx: SessionContext,
  x: number, y: number, categoryIndex: number
): Promise<ResearchCategoryData> {
  // Building-level, not category-level: a Research Center runs one research at a
  // time. Never throws — a missing status leaves the three lists exactly as before.
  // Read before the temp object exists, so a slow status read cannot extend its life.
  const activeResearch = await getActiveResearchStatus(ctx, x, y);

  await ctx.connectMapService();
  const tempObjectId = await ctx.cacherCreateObject();

  try {
    await ctx.cacherSetObject(tempObjectId, x, y);
    const cat = categoryIndex;

    // Phase 1: Get counts
    const countProps = [`avlCount${cat}`, `devCount${cat}`, `hasCount${cat}`];
    const countValues = await ctx.cacherGetPropertyList(tempObjectId, countProps);
    const avlCount = parseInt(countValues[0] || '0', 10);
    const devCount = parseInt(countValues[1] || '0', 10);
    const hasCount = parseInt(countValues[2] || '0', 10);

    ctx.log.debug(`[Research] Counts for cat=${cat}: avl=${avlCount}, dev=${devCount}, has=${hasCount}`);

    // Phase 2: Build per-item property names
    const itemProps: string[] = [];

    for (let i = 0; i < avlCount; i++) {
      itemProps.push(
        `avl${cat}RsId${i}`, `avl${cat}RsEnabled${i}`,
        `avl${cat}RsName${i}`, `avl${cat}RsDyn${i}`, `avl${cat}RsParent${i}`
      );
    }
    for (let i = 0; i < devCount; i++) {
      itemProps.push(
        `dev${cat}RsId${i}`,
        `dev${cat}RsName${i}`, `dev${cat}RsDyn${i}`, `dev${cat}RsParent${i}`
      );
    }
    for (let i = 0; i < hasCount; i++) {
      itemProps.push(
        `has${cat}RsId${i}`, `has${cat}RsCost${i}`,
        `has${cat}RsName${i}`, `has${cat}RsDyn${i}`, `has${cat}RsParent${i}`
      );
    }

    // Fetch in batches
    const allItemValues = new Map<string, string>();
    const BATCH_SIZE = 50;
    for (let i = 0; i < itemProps.length; i += BATCH_SIZE) {
      const batch = itemProps.slice(i, i + BATCH_SIZE);
      const values = await ctx.cacherGetPropertyList(tempObjectId, batch);
      for (let j = 0; j < batch.length; j++) {
        // Allow empty strings — server returns '' for unset properties
        if (j < values.length && values[j] !== 'error') {
          allItemValues.set(batch[j], values[j]);
        }
      }
    }

    const available = parseResearchItems('avl', cat, avlCount, allItemValues, true);
    const developing = parseResearchItems('dev', cat, devCount, allItemValues, false);
    const completed = parseResearchItems('has', cat, hasCount, allItemValues, false);

    markActiveDeveloping(developing, activeResearch);

    return { categoryIndex, available, developing, completed, activeResearch: activeResearch ?? undefined };
  } finally {
    await ctx.cacherCloseObject(tempObjectId);
  }
}

/**
 * Fetch detailed properties + description for a single invention.
 *
 * Calls RDOGetInvPropsByLang (function, "^" separator) and
 * RDOGetInvDescEx (function, "^" separator) via sendRdoRequest on the
 * construction socket. Both are olevariant-returning functions — safe to
 * use with sendRdoRequest (which adds a QueryId).
 */
export async function getResearchDetails(
  ctx: SessionContext,
  x: number, y: number, inventionId: string
): Promise<ResearchInventionDetails> {
  await ctx.connectConstructionService();
  if (!ctx.worldId) {
    throw new Error('Construction service not initialized - worldId is null');
  }

  // Get CurrBlock for this building
  await ctx.connectMapService();
  const tempObjectId = await ctx.cacherCreateObject();
  let currBlock: string;

  try {
    await ctx.cacherSetObject(tempObjectId, x, y);
    const values = await ctx.cacherGetPropertyList(tempObjectId, ['CurrBlock']);
    currBlock = values[0];
    if (!currBlock) throw new Error(`No CurrBlock for building at (${x}, ${y})`);
  } finally {
    await ctx.cacherCloseObject(tempObjectId);
  }

  ctx.log.debug(`[Research] Getting details for "${inventionId}" on block ${currBlock}`);

  const propsPacket = await ctx.sendRdoRequest('construction', rdoCall(
    'RDOGetInvPropsByLang', currBlock,
    RdoValue.string(inventionId), RdoValue.string('0'),
  ).packet, undefined, TimeoutCategory.NORMAL);
  const properties = parsePropertyResponseHelper(propsPacket.payload || '', 'res') || '';

  const descPacket = await ctx.sendRdoRequest('construction', rdoCall(
    'RDOGetInvDescEx', currBlock,
    RdoValue.string(inventionId), RdoValue.string('0'),
  ).packet, undefined, TimeoutCategory.NORMAL);
  const description = parsePropertyResponseHelper(descPacket.payload || '', 'res') || '';

  ctx.log.debug(`[Research] Details for "${inventionId}": props=${properties.length} chars, desc=${description.length} chars`);

  return { inventionId, properties, description };
}
