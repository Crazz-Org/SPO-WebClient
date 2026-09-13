/**
 * Protocol Test Harness — Wires StarpeaceSession to mock transport.
 *
 * Creates a real StarpeaceSession instance with:
 * - net.Socket replaced by MockTcpSocket (RDO command matching)
 * - node-fetch replaced by HttpMock (HTTP response matching)
 *
 * Each socket gets its OWN RdoMock instance to avoid cross-socket matching
 * conflicts (e.g., directory_auth vs directory_query use different session IDs).
 */

import { MockTcpSocket, PushTrigger, FallbackResponse } from './mock-tcp-socket';
import { RdoMock } from '../../../mock-server/rdo-mock';
import { HttpMock } from '../../../mock-server/http-mock';
import {
  RdoStrictValidator,
  ViolationSeverity,
} from '../../../mock-server/rdo-strict-validator';
import type { RdoViolation, StrictValidatorConfig } from '../../../mock-server/rdo-strict-validator';
import type { RdoScenario } from '../../../mock-server/types/rdo-exchange-types';
import type { HttpScenario } from '../../../mock-server/types/http-exchange-types';
import type { StarpeaceSession } from '../../spo_session';

/** Configuration for a single socket connection */
export interface SocketConfig {
  /** RDO scenarios for this specific socket */
  rdoScenarios: RdoScenario[];
  /** Push triggers for this socket */
  pushTriggers?: PushTrigger[];
  /** Fallback responses for commands not in scenarios */
  fallbackResponses?: FallbackResponse[];
  /** Disable strict validation for this socket (default: false = validation enabled) */
  disableStrictValidation?: boolean;
}

/** Configuration for creating a test harness */
export interface HarnessConfig {
  /**
   * Per-socket configurations, in creation order.
   * Socket 0 = first createSocket() call, Socket 1 = second, etc.
   * If more sockets are created than configs provided, they get an empty RdoMock.
   */
  socketConfigs: SocketConfig[];
  /** HTTP scenarios for node-fetch mock (shared across all requests) */
  httpScenarios?: HttpScenario[];
  /** Global strict validation config overrides */
  strictValidation?: Partial<StrictValidatorConfig>;
  /**
   * World connection pool. Off by default: a populated pool takes over world
   * traffic, so leaving it on would silently move every wire assertion in this
   * directory onto a connection the test never configured.
   *
   * When enabled, pool sockets are built from `poolSocketConfigs` and tracked
   * separately — they do NOT consume `socketConfigs` entries and do NOT shift
   * `getSockets()` indices.
   */
  worldPool?: {
    enabled: boolean;
    /** Per-pool-connection configs, in creation order */
    socketConfigs?: SocketConfig[];
    /** Make the Nth pool connection (0-based) fail to connect */
    failConnectionAt?: number;
  };
}

/** The test harness instance */
export interface ProtocolTestHarness {
  /** The real StarpeaceSession under test */
  session: StarpeaceSession;
  /** HTTP mock for inspecting matches */
  httpMock: HttpMock;
  /** Get all MockTcpSocket instances created during the test */
  getSockets(): MockTcpSocket[];
  /** Get the MockTcpSocket instances the world pool built (empty unless enabled) */
  getPoolSockets(): MockTcpSocket[];
  /** Commands captured on pool connections only */
  getPoolCapturedCommands(): string[];
  /** Get the RdoMock for a specific socket */
  getRdoMock(socketIndex: number): RdoMock | undefined;
  /** Get captured commands from all sockets combined */
  getAllCapturedCommands(): string[];
  /** Get captured commands from a specific socket (by creation order) */
  getCapturedCommands(socketIndex: number): string[];
  /** Get all strict validation violations from all sockets combined */
  getAllViolations(): RdoViolation[];
  /** Get violations from a specific socket's validator */
  getViolations(socketIndex: number): RdoViolation[];
  /** Assert no strict validation errors — throws with AI-friendly report if any exist */
  assertNoViolations(): void;
  /** Format a full violation report */
  getViolationReport(): string;
  /** Clean up listeners and state */
  cleanup(): void;
}

/**
 * Creates a protocol test harness.
 *
 * IMPORTANT: Call this AFTER jest.mock('net') and jest.mock('node-fetch') in your test file.
 * The mocks must be declared at module level; this function configures their behavior.
 */
export function createProtocolTestHarness(config: HarnessConfig): ProtocolTestHarness {
  const httpMock = new HttpMock();
  const createdSockets: MockTcpSocket[] = [];
  const rdoMocks: RdoMock[] = [];
  const validators: RdoStrictValidator[] = [];
  let socketCreateCount = 0;

  // Load HTTP scenarios
  if (config.httpScenarios) {
    for (const scenario of config.httpScenarios) {
      httpMock.addScenario(scenario);
    }
  }

  const poolSockets: MockTcpSocket[] = [];
  let poolCreateCount = 0;

  /** Build one MockTcpSocket from a SocketConfig, registering its mock + validator. */
  const buildSocket = (socketConfig: SocketConfig | undefined): MockTcpSocket => {
    // Create per-socket RdoMock
    const rdoMock = new RdoMock();
    if (socketConfig) {
      for (const scenario of socketConfig.rdoScenarios) {
        rdoMock.addScenario(scenario);
      }
    }
    rdoMocks.push(rdoMock);

    // Create per-socket strict validator
    let validator: RdoStrictValidator | undefined;
    if (!socketConfig?.disableStrictValidation) {
      // Auto-exempt fallback response members from strict validation
      const exemptMembers = new Set<string>();
      if (socketConfig?.fallbackResponses) {
        for (const fb of socketConfig.fallbackResponses) {
          exemptMembers.add(fb.member);
        }
      }

      validator = new RdoStrictValidator({
        enabled: true,
        exemptMembers,
        ...config.strictValidation,
      });

      // Load same scenarios into validator
      if (socketConfig) {
        for (const scenario of socketConfig.rdoScenarios) {
          validator.addScenario(scenario);
        }
      }
    }
    validators.push(validator ?? new RdoStrictValidator({ enabled: false }));

    const socket = new MockTcpSocket(rdoMock, validator);

    // Apply push triggers
    if (socketConfig?.pushTriggers) {
      for (const trigger of socketConfig.pushTriggers) {
        socket.addPushTrigger(trigger);
      }
    }

    // Apply fallback responses
    if (socketConfig?.fallbackResponses) {
      for (const fb of socketConfig.fallbackResponses) {
        socket.addFallbackResponse(fb);
      }
    }

    return socket;
  };

  // Configure net.Socket mock — each call gets its own RdoMock from socketConfigs
  const netMock = jest.requireMock('net');
  netMock.Socket.mockImplementation(() => {
    const socket = buildSocket(config.socketConfigs[socketCreateCount++]);
    createdSockets.push(socket);
    return socket;
  });

  // Configure node-fetch mock — handles redirect chains (302 → follow Location)
  const fetchMock = jest.requireMock('node-fetch');
  fetchMock.default.mockImplementation(async (url: string, options?: Record<string, unknown>) => {
    const method = (options?.method as string) || 'GET';
    let currentUrl = url;
    let redirected = false;
    const maxRedirects = 5;

    for (let i = 0; i < maxRedirects; i++) {
      const result = httpMock.match(method, currentUrl);

      if (!result) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          url: currentUrl,
          text: async () => 'Not Found',
          json: async () => ({ error: 'Not Found' }),
          headers: new Map(),
          redirected,
        };
      }

      // Handle redirects (302, 301)
      if ((result.status === 302 || result.status === 301) && result.headers?.Location) {
        const location = result.headers.Location;
        if (location.startsWith('http')) {
          currentUrl = location;
        } else {
          const baseUrl = currentUrl.substring(0, currentUrl.lastIndexOf('/') + 1);
          currentUrl = baseUrl + location;
        }
        redirected = true;
        continue;
      }

      // Final response
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        statusText: result.status === 200 ? 'OK' : 'Error',
        url: currentUrl,
        text: async () => result.body,
        json: async () => JSON.parse(result.body),
        headers: new Map(Object.entries(result.headers || {})),
        redirected,
      };
    }

    throw new Error(`Too many redirects for ${url}`);
  });

  // Create the real session (dynamically to pick up mocks)

  const { StarpeaceSession: SessionClass } = require('../../spo_session');
  const session = new SessionClass() as StarpeaceSession;

  // The pool is off unless a test opts in — see HarnessConfig.worldPool.
  const poolEnabled = config.worldPool?.enabled === true;
  session.setWorldPoolEnabled(poolEnabled);

  // Pool sockets come from their own list so they neither consume socketConfigs
  // entries nor shift getSockets() indices.
  session.setSocketFactory((purpose: string) => {
    if (!purpose.startsWith('pool:')) {
      return new netMock.Socket();
    }
    const idx = poolCreateCount++;
    if (config.worldPool?.failConnectionAt === idx) {
      const failing = buildSocket(undefined);
      failing.failNextConnect = true;
      poolSockets.push(failing);
      return failing;
    }
    const socket = buildSocket(config.worldPool?.socketConfigs?.[idx]);
    poolSockets.push(socket);
    return socket;
  });

  return {
    session,
    httpMock,

    getSockets(): MockTcpSocket[] {
      return [...createdSockets];
    },

    getPoolSockets(): MockTcpSocket[] {
      return [...poolSockets];
    },

    getPoolCapturedCommands(): string[] {
      return poolSockets.flatMap(s => s.getCapturedCommands());
    },

    getRdoMock(socketIndex: number): RdoMock | undefined {
      return rdoMocks[socketIndex];
    },

    getAllCapturedCommands(): string[] {
      return createdSockets.flatMap(s => s.getCapturedCommands());
    },

    getCapturedCommands(socketIndex: number): string[] {
      if (socketIndex >= createdSockets.length) return [];
      return createdSockets[socketIndex].getCapturedCommands();
    },

    getAllViolations(): RdoViolation[] {
      return validators.flatMap(v => v.getViolations());
    },

    getViolations(socketIndex: number): RdoViolation[] {
      if (socketIndex >= validators.length) return [];
      return validators[socketIndex].getViolations();
    },

    assertNoViolations(): void {
      const allViolations = validators.flatMap(v => v.getViolations());
      const errors = allViolations.filter(
        v => v.severity === ViolationSeverity.ERROR
      );
      if (errors.length > 0) {
        const reports = validators
          .filter(v => v.hasErrors())
          .map(v => v.formatReport());
        throw new Error(
          `RDO STRICT VALIDATION: ${errors.length} error(s) detected.\n\n` +
          reports.join('\n\n===\n\n')
        );
      }
    },

    getViolationReport(): string {
      return validators
        .map((v, i) => {
          const report = v.formatReport();
          return report !== 'No RDO strict validation violations.'
            ? `Socket ${i}: ${report}`
            : '';
        })
        .filter(Boolean)
        .join('\n\n===\n\n') || 'No RDO strict validation violations.';
    },

    cleanup(): void {
      for (const socket of [...createdSockets, ...poolSockets]) {
        socket.destroy();
        socket.removeAllListeners();
      }
      createdSockets.length = 0;
      poolSockets.length = 0;
      rdoMocks.length = 0;
      validators.length = 0;
      socketCreateCount = 0;
      poolCreateCount = 0;
      httpMock.reset();
    },
  };
}

/**
 * Build fallback responses for common world properties.
 * LoginWorld fetches 9 properties via GET — these need responses.
 */
export function buildWorldPropertyFallbacks(vars: {
  worldName: string;
  worldIp: string;
  worldPort: string;
  mailAddr: string;
  mailPort: string;
}): FallbackResponse[] {
  return [
    { member: 'WorldName', payload: `WorldName="%${vars.worldName}"` },
    { member: 'WorldURL', payload: `WorldURL="%http://${vars.worldIp}"` },
    { member: 'DAAddr', payload: `DAAddr="%${vars.worldIp}"` },
    { member: 'DALockPort', payload: `DALockPort="#7002"` },
    { member: 'MailAddr', payload: `MailAddr="%${vars.mailAddr}"` },
    { member: 'MailPort', payload: `MailPort="#${vars.mailPort}"` },
    { member: 'WorldXSize', payload: `WorldXSize="#1024"` },
    { member: 'WorldYSize', payload: `WorldYSize="#1024"` },
    { member: 'WorldSeason', payload: `WorldSeason="%Spring"` },
    // User properties after login
    { member: 'MailAccount', payload: `MailAccount="%SPO_test3@Shamba.net"` },
    { member: 'TycoonId', payload: `TycoonId="#22"` },
    { member: 'RDOCnntId', payload: `RDOCnntId="#12345678"` },
    { member: 'GetCompanyCount', payload: `GetCompanyCount="#1"` },
    // The company row itself — five 1-argument calls (chooseCompany.asp:166-170).
    // A fallback matches on the member name alone, so a `call` frame is served
    // here exactly as a property `get` is.
    { member: 'GetCompanyOwnerRole', payload: `res="%SPO_test3"` },
    { member: 'GetCompanyName', payload: `res="%Yellow Inc."` },
    { member: 'GetCompanyId', payload: `res="#28"` },
    { member: 'GetCompanyCluster', payload: `res="%PGI"` },
    { member: 'GetCompanyFacilityCount', payload: `res="#38"` },
  ];
}

/**
 * Fallbacks for the planet-access reads `performDirectoryAuth` makes on the
 * directory session (logonComplete.asp:50-67). Without them the three frames go
 * unanswered and the gate falls open on a timeout instead of on an answer.
 */
export function buildPlanetAccessFallbacks(paidPlanets = '01/01/2030'): FallbackResponse[] {
  return [
    { member: 'RDOGetUserPath', payload: `res="%Root/Users/S/SPO_test3"` },
    { member: 'RDOSetCurrentKey', payload: `res="#0"` },
    { member: 'RDOReadString', payload: `res="%${paidPlanets}"` },
  ];
}

/**
 * Build push triggers for the loginWorld InitClient flow.
 * When RegisterEventsById is sent, the server:
 * 1. Sends an idof InterfaceEvents request (server→client)
 * 2. Sends an InitClient push command
 */
export function buildLoginPushTriggers(contextId: string): PushTrigger[] {
  return [
    {
      triggerOnMember: 'RegisterEventsById',
      pushData: [
        // Server asks client to identify InterfaceEvents
        `C 99999 idof "InterfaceEvents"`,
        // Server sends InitClient push with game state
        `C sel ${contextId} call InitClient "*" "@78006","%419278163478","#0","#223892356"`,
      ],
      delayMs: 10,
    },
  ];
}
