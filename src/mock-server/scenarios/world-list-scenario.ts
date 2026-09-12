/**
 * Scenario 2/2bis: Region + World Selection
 * RDO: RDOQueryKey → world list with IP/port/population data, then the world-limit question
 * the reference client asked before offering a new world.
 *
 * `RDOCanJoinNewWorld` is declared `function RDOCanJoinNewWorld( Alias : widestring ) :
 * olevariant` on `TDirectorySession` (`DServer/DirectoryServer.pas:116`); its body
 * (`:1217-1234`) answers a boolean olevariant — `#-1` may join, `#0` already at the number of
 * worlds the account's nobility allows. `logonComplete.asp:100-106` opened a bare directory
 * session, made that one-argument call, and on a false answer sent the login to
 * `chooseVisa.asp` with `CanPlay=NO` — the Visitor visa only.
 */

import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage } from '@/shared/types/message-types';
import type { WsCaptureScenario } from '../types/mock-types';
import type { RdoScenario } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** World data as captured from the RDO protocol */
export interface CapturedWorldData {
  name: string;
  date: string;
  investors: number;
  online: number;
  population: number;
  ip?: string;
  port?: number;
  running?: boolean;
  url?: string;
}

const AMERICA_WORLDS: CapturedWorldData[] = [
  { name: 'shamba', date: '2232', investors: 21, online: 1, population: 91982248, ip: '142.44.158.91', port: 8000, running: true, url: 'http://142.44.158.91/Five/' },
  { name: 'trinity', date: '3412', investors: 26, online: 1, population: 47890344 },
  { name: 'zorcon', date: '2505', investors: 30, online: 1, population: 34948320, ip: '142.4.193.58', port: 8000, running: true, url: 'http://142.4.193.58/Five/' },
];

const ASIA_WORLDS: CapturedWorldData[] = [
  { name: 'aries', date: '2127', investors: 3, online: 0, population: 6116760, ip: '151.245.54.69', port: 8000, running: true, url: 'http://151.245.54.69/Five/' },
  { name: 'basinia', date: '2000', investors: 0, online: 0, population: 0 },
  { name: 'leonia', date: '2514', investors: 3, online: 0, population: 4094860 },
  { name: 'pathran', date: '2000', investors: 2, online: 1, population: 522, ip: '51.79.39.255', port: 8000, running: false, url: 'http://51.79.39.255/Five/' },
  { name: 'shamba', date: '2079', investors: 4, online: 0, population: 1081911, ip: '158.69.153.134', port: 8000, running: true, url: 'http://158.69.153.134/Five/' },
  { name: 'willow', date: '2260', investors: -1, online: 0, population: -1, ip: '104.234.200.251', port: 8000, url: 'http://104.234.200.251/FIVE/' },
  { name: 'xalion', date: '2000', investors: 2, online: 2, population: 0, ip: '38.46.142.229', port: 8000, running: false, url: 'http://38.46.142.229/Five/' },
  { name: 'zorcon', date: '2450', investors: 2, online: 1, population: 753800, ip: '104.234.200.250', port: 8000, running: false, url: 'http://104.234.200.250/Five/' },
  { name: 'zyrane', date: '2000', investors: 1, online: 0, population: 0, ip: '51.79.39.255', port: 8000, running: false, url: 'http://142.4.193.58/Five/' },
];

/**
 * Build the RDOQueryKey response string from world data.
 * Format: Count=N\nKey0=name\ngeneral/dateN=...\n...
 */
export function buildQueryKeyResponse(worlds: CapturedWorldData[]): string {
  const lines: string[] = [`Count=${worlds.length}`];

  for (let i = 0; i < worlds.length; i++) {
    const w = worlds[i];
    lines.push(`Key${i}=${w.name}`);
    lines.push(`general/date${i}=${w.date}`);
    lines.push(`general/investors${i}=${w.investors}`);
    lines.push(`general/online${i}=${w.online}`);
    lines.push(`general/population${i}=${w.population}`);
    if (w.ip) lines.push(`interface/ip${i}=${w.ip}`);
    if (w.port) lines.push(`interface/port${i}=${w.port}`);
    if (w.running !== undefined) lines.push(`interface/running${i}=${w.running}`);
    if (w.url) lines.push(`interface/url${i}=${w.url}`);
  }

  return lines.join('\n');
}

/** How the directory answers RDOCanJoinNewWorld. */
export interface WorldListOptions {
  /** What RDOCanJoinNewWorld answers — true (default) may join, false at the limit. */
  canJoinNewWorld?: boolean;
}

export function createWorldListScenario(
  overrides?: Partial<ScenarioVariables>,
  options?: WorldListOptions,
): { ws: WsCaptureScenario; rdo: RdoScenario } {
  const vars = mergeVariables(overrides);
  const canJoinNewWorld = options?.canJoinNewWorld ?? true;

  const americaResponse = buildQueryKeyResponse(AMERICA_WORLDS);
  const asiaResponse = buildQueryKeyResponse(ASIA_WORLDS);

  const queryBlock = [
    'General/Population',
    'General/Investors',
    'General/Online',
    'General/Date',
    'Interface/IP',
    'Interface/Port',
    'Interface/URL',
    'Interface/Running',
  ].join('\n');

  const rdo: RdoScenario = {
    name: 'world-list',
    description: 'Query world lists for America and Asia regions',
    exchanges: [
      {
        id: 'wl-rdo-001',
        request: `C 5 idof "DirectoryServer"`,
        response: `A5 objid="${vars.directoryServerId}"`,
        matchKeys: { verb: 'idof', targetId: 'DirectoryServer' },
      },
      {
        id: 'wl-rdo-002',
        request: `C 7 sel ${vars.directoryServerId} get RDOOpenSession`,
        response: `A7 RDOOpenSession="#${vars.directorySessionId}"`,
        matchKeys: { verb: 'sel', action: 'get', member: 'RDOOpenSession' },
      },
      {
        id: 'wl-rdo-003',
        request: `C 9 sel ${vars.directorySessionId} call RDOQueryKey "^" "%Root/Areas/America/Worlds","%${queryBlock}"`,
        response: `A9 res="%${americaResponse}\n"`,
        matchKeys: {
          verb: 'sel',
          action: 'call',
          member: 'RDOQueryKey',
          argsPattern: ['"%Root/Areas/America/Worlds"'],
        },
      },
      {
        // One widestring argument, against the directory SESSION id (not the server id),
        // inside the same query session, after the world list and before EndSession.
        id: 'wl-rdo-canjoin',
        request: `C 10 sel ${vars.directorySessionId} call RDOCanJoinNewWorld "^" "%${vars.username}"`,
        response: `A10 res="#${canJoinNewWorld ? -1 : 0}"`,
        matchKeys: {
          verb: 'sel',
          targetId: vars.directorySessionId,
          action: 'call',
          member: 'RDOCanJoinNewWorld',
          argsPattern: [`"%${vars.username}"`],
        },
      },
      {
        id: 'wl-rdo-004',
        request: `C 11 sel ${vars.directorySessionId} call RDOEndSession "*"`,
        response: `A11`,
        matchKeys: { verb: 'sel', action: 'call', member: 'RDOEndSession' },
      },
      // Asia variant (separate directory session from a different capture)
      {
        id: 'wl-rdo-005',
        request: `C 15 sel ${vars.directorySessionId} call RDOQueryKey "^" "%Root/Areas/Asia/Worlds","%${queryBlock}"`,
        response: `A15 res="%${asiaResponse}\n"`,
        matchKeys: {
          verb: 'sel',
          action: 'call',
          member: 'RDOQueryKey',
          argsPattern: ['"%Root/Areas/Asia/Worlds"'],
        },
      },
    ],
    variables: {},
  };

  // Build WS-level world list with IP/port data from Asia worlds
  const wsWorlds = ASIA_WORLDS.map(w => ({
    name: w.name,
    url: w.url ?? '',
    ip: w.ip ?? '',
    port: w.port ?? 0,
    population: w.population,
    investors: w.investors,
    online: w.online,
    date: w.date,
    running: w.running ?? false,
  }));

  const ws: WsCaptureScenario = {
    name: 'world-list',
    description: 'World list selection for Asia region',
    capturedAt: '2026-02-18',
    serverInfo: { world: vars.worldName, zone: 'BETA', date: '2026-02-18' },
    exchanges: [
      {
        id: 'wl-ws-001',
        timestamp: '2026-02-18T21:21:05.000Z',
        request: {
          type: WsMessageType.REQ_CONNECT_DIRECTORY,
          wsRequestId: 'wl-001',
          username: vars.username,
          password: vars.password,
          zonePath: 'Root/Areas/Asia/Worlds',
        } as WsMessage,
        responses: [
          {
            type: WsMessageType.RESP_CONNECT_SUCCESS,
            wsRequestId: 'wl-001',
            worlds: wsWorlds,
          } as WsMessage,
        ],
        tags: ['auth'],
      },
    ],
  };

  return { ws, rdo };
}

export { AMERICA_WORLDS, ASIA_WORLDS };
