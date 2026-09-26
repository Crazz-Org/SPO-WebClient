/**
 * The login spine and the read/write primitives every L2 flow is built from.
 *
 * The spine — connect, auth, directory, world login, company select, logoff — is appended
 * to every live run regardless of routing (doc/E2E-POLICY.md §4). It is the cheapest
 * regression detector there is, and session-lifecycle breakage surfaces here first.
 */

import { WsMessageType } from '../shared/types/message-types';
import type {
  WsRespLoginSuccess,
  WsRespConnectSuccess,
  WsRespBuildingDetails,
  WsRespBuildingTabData,
  WsRespBuildingSetProperty,
  WsRespSearchMenuTowns,
  WsRespMapData,
} from '../shared/types/message-types';
import type {
  CompanyInfo,
  TownInfo,
  BuildingPropertyValue,
  MapBuilding,
  WorldInfo,
} from '../shared/types/domain-types';
import { WsDriver } from './ws-driver';
import {
  GATEWAY_ORIGIN,
  GATEWAY_URL,
  TIMEOUTS,
  WORLD_NAME,
  ZONE_PATH,
  type E2eAccount,
} from './config';

export interface LiveSession {
  driver: WsDriver;
  account: E2eAccount;
  company: CompanyInfo;
  worlds: number;
  companies: CompanyInfo[];
  /** The planitia entry from the directory listing — its IP reaches the world's ASP pages. */
  world?: WorldInfo;
}

/**
 * Drive the full login sequence for one account.
 *
 * Ordering is not decoration: the gateway gates message types by session phase
 * (server.ts:50-67), so a spine sent out of order is rejected rather than merely slow.
 */
export async function login(account: E2eAccount): Promise<LiveSession> {
  const driver = await WsDriver.connect(GATEWAY_URL, GATEWAY_ORIGIN);

  await driver.request(
    { type: WsMessageType.REQ_AUTH_CHECK, username: account.username, password: account.password },
    WsMessageType.RESP_AUTH_SUCCESS,
    TIMEOUTS.login,
  );

  const directory = await driver.request<WsRespConnectSuccess>(
    {
      type: WsMessageType.REQ_CONNECT_DIRECTORY,
      username: account.username,
      password: account.password,
      zonePath: ZONE_PATH,
    },
    WsMessageType.RESP_CONNECT_SUCCESS,
    TIMEOUTS.login,
  );

  if (!directory.worlds.some(w => w.name === WORLD_NAME)) {
    throw new Error(
      `World "${WORLD_NAME}" is not in the ${ZONE_PATH} listing — ` +
        `got: ${directory.worlds.map(w => w.name).join(', ') || '(none)'}`,
    );
  }

  const loggedIn = await driver.request<WsRespLoginSuccess>(
    {
      type: WsMessageType.REQ_LOGIN_WORLD,
      username: account.username,
      password: account.password,
      worldName: WORLD_NAME,
    },
    WsMessageType.RESP_LOGIN_SUCCESS,
    TIMEOUTS.login,
  );

  const companies = loggedIn.companies ?? [];
  const company = pickCompany(companies, account.username);
  await driver.request(
    { type: WsMessageType.REQ_SELECT_COMPANY, companyId: company.id },
    WsMessageType.RESP_RDO_RESULT,
    TIMEOUTS.login,
  );

  await awaitSearchMenu(driver);

  const world = directory.worlds.find(w => w.name === WORLD_NAME);
  return { driver, account, company, worlds: directory.worlds.length, companies, world };
}

/**
 * Wait until the gateway's search menu actually exists.
 *
 * Company selection returns before it does: the gateway builds `SearchMenuService` on a
 * 500 ms timer *after* the reply (server.ts:1191-1229), then fetches its home page. Any
 * request that needs it — the town list, and so every governance flow — fails with
 * "Search menu not available. Please log in first." if it arrives first.
 *
 * `RESP_CAPITOL_COORDS` is the push emitted once that fetch resolves, so it is the real
 * readiness signal rather than a guessed sleep. A world with no Capitol still sends it,
 * with `hasCapitol: false`.
 */
export async function awaitSearchMenu(driver: WsDriver): Promise<void> {
  await driver.waitFor(
    msg => msg.type === WsMessageType.RESP_CAPITOL_COORDS,
    TIMEOUTS.login,
    'RESP_CAPITOL_COORDS (the search menu becoming available)',
  );
}

/**
 * The player's own company, never a civic role company.
 *
 * `ownerRole` carries the public office when the entry is a role company
 * (domain-types.ts:30); driving a flow as "Mayor of Helartia" instead of as the tycoon
 * changes which identity the model server sees, which is exactly what the Interface
 * Server log distinguishes.
 */
export function pickCompany(companies: CompanyInfo[], username: string): CompanyInfo {
  if (companies.length === 0) throw new Error(`No company returned for ${username}`);
  const own = companies.filter(c => !c.ownerRole || c.ownerRole === username);
  const named = own.find(c => c.name.startsWith(`${username} `));
  return named ?? own[0] ?? companies[0];
}

/** Close cleanly — the gateway's ClientNotAware path issues the world `Logoff`. */
export async function logoff(session: LiveSession): Promise<void> {
  await session.driver.close();
}

/** Every town the world lists, with mayor, coordinates and town-hall class. */
export async function listTowns(session: LiveSession): Promise<TownInfo[]> {
  const response = await session.driver.request<WsRespSearchMenuTowns>(
    { type: WsMessageType.REQ_SEARCH_MENU_TOWNS },
    WsMessageType.RESP_SEARCH_MENU_TOWNS,
  );
  return response.towns;
}

/**
 * A town by name, from the world's own list.
 *
 * Deliberately *not* keyed on `TownInfo.mayor`: the search-menu list reports `mayor: null`
 * for every town on planitia (verified live 2026-08-21, all 25) and carries no `classId`
 * either — it is a map-navigation payload, not a governance one. The authority on whether
 * this account governs the town is `canGovern` on the Town Hall itself, which the server
 * decides via `grantAccess` (domain-types.ts:637); the write flow asserts it before
 * touching anything.
 */
export async function findTown(session: LiveSession, name: string): Promise<TownInfo> {
  const towns = await listTowns(session);
  const town = towns.find(t => t.name === name);
  if (!town) {
    throw new Error(
      `No town called "${name}" in ${WORLD_NAME} (${towns.length} listed). ` +
        `Update GOVERNED_TOWN before running a governance flow.`,
    );
  }
  return town;
}

/**
 * The visual class of the building at a coordinate.
 *
 * `REQ_BUILDING_FOCUS` will not give it — the browser client enriches focus from map data
 * it already holds, and the gateway returns the placeholder `"0"`, which resolves the
 * *generic* inspector template instead of the Town Hall one (so `townTaxes` comes back
 * empty). A headless driver has no map, so it loads a small window and reads the class the
 * same way the renderer does.
 */
export async function resolveVisualClass(
  session: LiveSession,
  x: number,
  y: number,
  window = 8,
): Promise<string> {
  const response = await session.driver.request<WsRespMapData>(
    {
      type: WsMessageType.REQ_MAP_LOAD,
      x: Math.max(0, x - window),
      y: Math.max(0, y - window),
      width: window * 2 + 1,
      height: window * 2 + 1,
    },
    [WsMessageType.RESP_MAP_DATA, WsMessageType.EVENT_MAP_DATA],
    TIMEOUTS.login,
  );

  const buildings: MapBuilding[] = response.data?.buildings ?? [];
  const here = buildings.find(b => b.x === x && b.y === y);
  if (!here?.visualClass) {
    throw new Error(
      `No building at (${x},${y}) in the loaded map window — ` +
        `${buildings.length} building(s) returned, none anchored there.`,
    );
  }
  return here.visualClass;
}

export async function readBuildingDetails(
  session: LiveSession,
  x: number,
  y: number,
  visualClass: string,
): Promise<WsRespBuildingDetails['details']> {
  const response = await session.driver.request<WsRespBuildingDetails>(
    { type: WsMessageType.REQ_BUILDING_DETAILS, x, y, visualClass },
    WsMessageType.RESP_BUILDING_DETAILS,
  );
  return response.details;
}

/**
 * Read one section of the inspector — the groups the opening read leaves out.
 *
 * `readBuildingDetails` carries the header group alone; every other group is
 * read here, when the user opens its menu entry. `groupIds` is what names them,
 * and a civic tab consolidates several, hence a list.
 */
export async function readBuildingTabData(
  session: LiveSession,
  x: number,
  y: number,
  tabId: string,
  visualClass: string,
  groupIds?: string[],
): Promise<WsRespBuildingTabData> {
  return session.driver.request<WsRespBuildingTabData>(
    { type: WsMessageType.REQ_BUILDING_TAB_DATA, x, y, tabId, visualClass, groupIds },
    WsMessageType.RESP_BUILDING_TAB_DATA,
  );
}

/**
 * Read one property group the way the panel does: open the facility, then open
 * the section that carries the group.
 *
 * The opening read carries the header group and nothing else, so a group named
 * here is only ever produced by its section request. Both round-trips are kept:
 * `readBuildingDetails` releases and recreates the inspector's temp object,
 * which is the freshest re-read available and the reason a probe's read-back
 * means anything.
 */
export async function readSectionGroups(
  session: LiveSession,
  x: number,
  y: number,
  groupId: string,
  visualClass: string,
): Promise<{ [groupId: string]: BuildingPropertyValue[] }> {
  await readBuildingDetails(session, x, y, visualClass);
  const section = await readBuildingTabData(session, x, y, groupId, visualClass, [groupId]);
  return section.groups ?? {};
}

export async function setBuildingProperty(
  session: LiveSession,
  x: number,
  y: number,
  propertyName: string,
  value: string,
  additionalParams?: Record<string, string>,
): Promise<WsRespBuildingSetProperty> {
  return session.driver.request<WsRespBuildingSetProperty>(
    { type: WsMessageType.REQ_BUILDING_SET_PROPERTY, x, y, propertyName, value, additionalParams },
    WsMessageType.RESP_BUILDING_SET_PROPERTY,
  );
}

/** One property out of a details group, by exact name. */
export function propertyValue(
  groups: { [groupId: string]: BuildingPropertyValue[] },
  groupId: string,
  name: string,
): string | undefined {
  return groups[groupId]?.find(p => p.name === name)?.value;
}
