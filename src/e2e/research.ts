/**
 * Research reads shared by `research-roundtrip` (flows.ts) and the fixture builder (fixtures.ts,
 * #1233). They live here because `flows.ts` already imports from `./fixtures`: reusing them in
 * place would make the two modules import each other.
 */

import { WsMessageType } from '../shared/types/message-types';
import type {
  ResearchCategoryData,
  ResearchInventionDetails,
  WsRespResearchDetails,
  WsRespResearchInventory,
} from '../shared/types/message-types';
import type { LiveSession } from './session';

/**
 * The one invention research-roundtrip drives (maintainer, PR #1214): Commerce > Bars > Happy Hour,
 * id `HappyHour` in research.0.dat — Price $25,000,000, requires `Bars`.
 *
 * Isolation: research-roundtrip may freely queue, cancel and **sell** Happy Hour (maintainer, #1236).
 * (a) Nothing else depends on it — `FIXTURE_KINDS` has no Bar class, and the only other code naming
 * `HappyHour` is the fixture builder (#1233), which reads its price as a reserve and never queues
 * or cancels it. (b) A sell's server-side cascade is empty —
 * `TCompany.RetireInvention` refunds `TotalCost - Subsidy` (Kernel/Kernel0.pas:10239) and retires
 * every owned invention whose `Req` includes the sold one (Kernel/Kernel0.pas:10284-10289), and no
 * entry in `cache/Inventions/research.0.dat` carries `Requires: Happy Hour`.
 * That cascade is exactly why a shared prerequisite (e.g. General Services, on which every shop
 * depends) must never be the target: selling it would retire inventions other flows need — the
 * only case that justifies a human lock.
 */
export const RESEARCH_TARGET = { id: 'HappyHour', name: 'Happy Hour' } as const;

/** `Queue Research: <id>, <priority>` (Kernel/ResearchCenter.pas:384). */
export function queueResearchLineMatches(line: string, id: string): boolean {
  return line.includes(`Queue Research: ${id}, `);
}

/**
 * What queueing an invention costs, in dollars: the `Price:` and `License:` lines of its details
 * (`TInvention.GetProperties`, Inventions/Inventions.pas:715-727; labels Kernel/SimHints.pas:482-483;
 * amounts from `FormatMoney`, Utils/Misc/MathUtils.pas:87-99). A line the details do not show is 0. The server starts a
 * research only when `Budget >= Price + GetFeePrice` (Kernel/ResearchCenter.pas:240).
 */
export function researchCost(properties: string): number {
  const dollars = (label: string): number => {
    const m = new RegExp(`(?:^|\\s)${label}:\\s*\\$([0-9][0-9,.]*)`, 'i').exec(properties);
    return m ? Number(m[1].replace(/[^0-9]/g, '')) : 0;
  };
  return dollars('Price') + dollars('Licen[cs]e');
}

export type ResearchState = 'developing' | 'owned' | 'available' | 'absent';

/**
 * Where an invention stands in one category's inventory. The three lists are mutually exclusive
 * by construction (`TResearchCenter.StoreToCache`, Kernel/ResearchCenter.pas:797-817).
 */
export function researchState(data: ResearchCategoryData, id: string): ResearchState {
  const has = (list: { inventionId: string }[]): boolean => list.some(i => i.inventionId === id);
  if (has(data.developing)) return 'developing';
  if (has(data.completed)) return 'owned';
  if (has(data.available)) return 'available';
  return 'absent';
}

/** One category of a research center's inventory (`REQ_RESEARCH_INVENTORY`). */
export function researchInventory(
  session: LiveSession,
  at: { x: number; y: number },
  categoryIndex: number,
): Promise<WsRespResearchInventory> {
  return session.driver.request<WsRespResearchInventory>(
    { type: WsMessageType.REQ_RESEARCH_INVENTORY, buildingX: at.x, buildingY: at.y, categoryIndex },
    WsMessageType.RESP_RESEARCH_INVENTORY,
  );
}

/** One invention's details as a research center serves them (`REQ_RESEARCH_DETAILS`). */
export async function readResearchDetails(
  session: LiveSession,
  at: { x: number; y: number },
  inventionId: string,
): Promise<ResearchInventionDetails> {
  const { details } = await session.driver.request<WsRespResearchDetails>(
    { type: WsMessageType.REQ_RESEARCH_DETAILS, buildingX: at.x, buildingY: at.y, inventionId },
    WsMessageType.RESP_RESEARCH_DETAILS,
  );
  return details;
}

/**
 * The `Level:` line of an invention's details (`TInvention.GetProperties`,
 * Inventions/Inventions.pas:742-744), or undefined when the details show none.
 */
export function researchLevel(properties: string): string | undefined {
  return /(?:^|\s)Level:\s*([A-Za-z]+)/.exec(properties)?.[1];
}
