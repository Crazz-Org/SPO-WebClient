/**
 * The L2 flow catalogue.
 *
 * A flow is a scripted live drive over the WebSocket contract, with its own assertions.
 * The gate picks which flows to run from the diff (doc/E2E-POLICY.md §4) — a fixed script
 * drifts and eventually tests nothing that changed.
 */

import { createHash, randomUUID } from 'crypto';
import { WsMessageType } from '../shared/types/message-types';
import { nearestTown } from '../shared/nearest-town';
import type {
  WsRespBuildingFocus,
  WsRespEmpireFacilities,
  WsRespFavoriteAdd,
  WsRespFavoriteDelete,
  WsRespFavoriteRename,
  WsRespFavoriteFolderCreate,
  WsRespFavoriteMove,
  WsRespMailConnected,
  WsRespMailDeleted,
  WsRespMailDraftSaved,
  WsRespMailFolder,
  WsRespMailMessage,
  WsRespMailSent,
  WsRespMailUnreadCount,
  WsRespNewspaperBoard,
  WsRespNewspaperIssue,
  WsRespNewspaperIssues,
  WsRespPoliticsData,
  WsRespPoliticsSetPublicity,
  WsRespPoliticsSetRating,
  WsRespPoliticsVote,
  WsRespTycoonRole,
  WsRespSearchMenuPeopleSearch,
  WsRespSearchMenuDirectory,
  WsRespSearchMenuHome,
  WsRespSearchMenuRankings,
  WsRespSearchMenuRankingDetail,
  WsRespSearchMenuTycoonProfile,
  WsRespSearchMenuTycoonFullProfile,
  WsRespSearchMenuBanks,
  WsRespSearchMenuNewspapers,
  WsRespMapData,
  WsRespChatUserList,
  WsRespContextStatus,
  WsRespWorldEvent,
  WsRespSurfaceData,
  WsRespAllFacilityDimensions,
  WsRespClusterInfo,
  WsRespClusterFacilities,
  WsRespRdoResult,
  WsRespGetProfile,
  WsRespProfileCurriculum,
  WsRespProfileBank,
  WsRespProfileProfitLoss,
  WsRespProfileCompanies,
  WsRespProfileCompanyProfitLoss,
  WsRespProfileAutoConnections,
  WsRespProfilePolicy,
  WsRespProfilePolicySet,
  WsRespProfileAutoConnectionAction,
  WsRespProfileBankAction,
  WsRespProfileUploadPicture,
  PictureUploadFailure,
  WsRespSearchConnections,
  ConnectionSearchResult,
  WsRespConnectionReachability,
  WsRespNearCircuits,
  WsRespFacilityStatusBatch,
  WsRespConnectFacilities,
  WsRespBuildingSetProperty,
  WsRespBuildRoad,
  WsRespDemolishRoad,
  WsRespDemolishRoadArea,
  WsRespDefineZone,
  WsRespBuildingGateConnections,
  WsRespBuildingServiceFigures,
  WsRespBuildingWorkerCounts,
  WsRespBuildingRefreshProperties,
  WorkerCount,
  WsRespBuildingCategories,
  WsRespBuildingFacilities,
  WsRespRenameFacility,
  WsRespDeleteFacility,
  WsRespBuildingUpgrade,
  WsRespBuildingLoanRequest,
  WsRespCloneFacility,
  WsRespChatChannelList,
  WsRespChatChannelInfo,
  WsRespChatSuccess,
  WsEventChatMsg,
  WsEventChatUserTyping,
  WsEventChatChannelChange,
  WsEventMoveTo,
} from '../shared/types/message-types';
import { SurfaceType } from '../shared/types/domain-types';
import { CLUSTER_IDS } from '../shared/cluster-data';
import type {
  AutoConnectionActionType,
  AutoConnectionFluid,
  AutoConnectionsData,
  BankAccountData,
  BuildingConnectionData,
  BuildingProductData,
  BuildingSupplyData,
  BuildingFocusInfo,
  BuildingInfo,
  ChatUser,
  CompaniesData,
  CompInputData,
  CurriculumData,
  PolicyData,
  ProfitLossData,
  BuildingPropertyValue,
  CompanyInfo,
  DirectoryRef,
  DirectoryPage,
  FacilityDimensions,
  LoanInfo,
  MailFolder,
  MailMessageFull,
  MailMessageHeader,
  MapBuilding,
  MapSegment,
  PoliticsData,
  RankingCategory,
  TycoonProfileFull,
} from '../shared/types/domain-types';
import { flattenFavoriteLinks, flattenFolders } from '../shared/favorites-tree';
import { toErrorMessage } from '../shared/error-utils';
import { ERROR_AccessDenied, ERROR_TooManyFacilities } from '../shared/error-codes';
import { parseLocalAspUrl } from '../shared/local-asp-url';
import { WsDriver, WsDriverError, type OutboundMessage } from './ws-driver';
import {
  GATEWAY_ORIGIN,
  GATEWAY_URL,
  GOVERNED_TOWN,
  INTERFACE_LOG_BASE,
  LIMITS,
  PRIMARY_ACCOUNT,
  SECONDARY_ACCOUNT,
  TIMEOUTS,
  WORLD_NAME,
  ZONE_PATH,
  type E2eAccount,
} from './config';
import {
  LOG_MARKERS,
  awaitMarker,
  describeLogMiss,
  findCurrentSurvivalLog,
  openLogWindow,
  readSince,
  type LogWindow,
} from './live-log';
import {
  runProbe,
  runRoundTrip,
  probeFailure,
  type ProbeResult,
  type ProbeSpec,
  type RoundTripSpec,
} from './probe';
import { ALL_CONNECTION_ROLES, rolesToMask } from '../shared/connection-roles';
import { sharesRoadCircuit } from '../shared/road-circuits';
import { TRADE_LEVEL_VALUES, TRADE_MODE_VALUES } from '../shared/building-details/trade-settings';
import { bankLoanOutcomeOf } from '../shared/building-details/bank-loan';
import {
  awaitResumeToken,
  findTown,
  listTowns,
  resolveVisualClass,
  login,
  loginSecondary,
  logoff,
  readBuildingDetails,
  readBuildingTabData,
  readSectionGroups,
  propertyValue,
  resumeSession,
  setBuildingProperty,
  switchToMayor,
  type LiveSession,
  type SecondaryLogin,
} from './session';
import type { WorldLock } from './world-lock';
import {
  RESEARCH_TARGET,
  queueResearchLineMatches,
  readResearchDetails,
  researchCost,
  researchInventory,
  researchState,
  type ResearchState,
} from './research';
import {
  FIXTURE_KINDS,
  ensureFixtures,
  facilityDimensions,
  findFixture,
  findFreeLot,
  helartiaValue,
  isConstructionClass,
  isRefusedClass,
  listBuildable,
  listTycoonFacilities,
  newFacilityLineMatches,
  ownLotRefusal,
  ownTycoonId,
  placeFacility,
  readCash,
  scanHoldings,
  townValueAt,
  FIXTURE_CASH_FLOOR,
  type FixtureKind,
  type FixtureKindId,
  type FixtureOutcome,
  type Holding,
  type TycoonFacility,
} from './fixtures';

/** Moved to ./research (#1233) — re-exported for research-roundtrip's tests. */
export { RESEARCH_TARGET, queueResearchLineMatches, researchCost, researchState, type ResearchState } from './research';

export interface FlowContext {
  lock: WorldLock;
  /** Injected so a dry run can exercise the catalogue without touching the world. */
  survivalLogUrl?: string;
  /** Injected so a test can avoid a real delay between mailRoundTrip's Inbox re-reads. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so a test can bound a round trip's read-back poll without waiting. */
  now?: () => number;
}

export interface FlowResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'UNTESTABLE' | 'SKIPPED';
  /** Why the flow did not run — only on `SKIPPED`: the second account was refused at login. */
  skipped?: string;
  assertions: { what: string; ok: boolean; detail?: string }[];
  /** What the flow could not prove, each with its reason. */
  untestable: string[];
  probes: ProbeResult[];
  messagesSent: number;
  messagesReceived: number;
  wireErrors: number;
  error?: string;
  /** Values recorded, never asserted — a reading for a later card (see warehouseRoleReading). */
  readings?: TradeRoleReading[];
  /** What the flow's seed produced — only on a flow that has one. */
  seed?: FlowCheck;
  /** One entry per mailbox (or store) the seed's cleanup restored — only on a seeded flow. */
  cleanup?: FlowCheck[];
  /** Per fixture kind: found, under construction, built (with its `New Facility:` line), or why not — fixtures-ensure only. */
  fixtures?: FixtureOutcome[];
}

/** One named outcome — a seed, or one mailbox's cleanup. */
export interface FlowCheck {
  what: string;
  ok: boolean;
  detail?: string;
  /** The check could not run: the second account was refused at login (the reason). */
  skipped?: string;
}

/** What a seed produced, and how to undo it. */
export interface FlowSeed {
  outcome: FlowCheck;
  cleanup?: () => Promise<FlowCheck[]>;
}

/** One facility's trade fields, as the inspector's opening read served them (#1006). */
export interface TradeRoleReading {
  facility: 'warehouse' | 'industry';
  x: number;
  y: number;
  visualClass: string;
  templateName: string;
  /** The raw cached `Role` value, verbatim — `'absent'` when the read did not return it. */
  role: string;
  /** The raw cached `TradeRole` value, verbatim — `'absent'` when the read did not return it. */
  tradeRole: string;
}

export interface Flow {
  name: string;
  /** One line, shown in the gate report. */
  what: string;
  /** True when the flow writes to the live world — subject to the blast-radius rule. */
  mutates: boolean;
  /**
   * Optional: plants the data the flow reads. It runs before `run`; the cleanup it returns
   * runs after `run`, even when `run` throws. A failed seed skips `run` (UNTESTABLE).
   */
  seed?: (ctx: FlowContext) => Promise<FlowSeed>;
  run: (ctx: FlowContext) => Promise<FlowResult>;
}

class Assertions {
  readonly items: { what: string; ok: boolean; detail?: string }[] = [];
  check(what: string, ok: boolean, detail?: string): void {
    this.items.push({ what, ok, detail });
  }
  /**
   * Record what the flow could not observe, and why (doc/E2E-POLICY.md §7): the world held
   * nothing to exercise, the log line could not be found or read, or the server answered a
   * fault the client can neither cause nor fix. Non-blocking — the reason is always kept.
   */
  readonly untestableItems: string[] = [];
  untestable(what: string, reason: string): void {
    this.untestableItems.push(`${what} — ${reason}`);
  }
  get failed(): boolean {
    return this.items.some(a => !a.ok);
  }
}

/**
 * The login spine — appended to every run regardless of routing. Cheapest possible
 * regression detector, and where session-lifecycle breakage surfaces first.
 */
const loginSpine: Flow = {
  name: 'login-spine',
  what: 'connect -> auth -> directory -> world login -> company select -> logoff',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      assertions.check('world listing is not empty', session.worlds > 0, `${session.worlds} worlds`);
      assertions.check('a company was selected', Boolean(session.company.id), session.company.name);
      assertions.check(
        'the selected company belongs to the tycoon, not a civic role',
        !session.company.ownerRole || session.company.ownerRole === PRIMARY_ACCOUNT.username,
        session.company.ownerRole ?? '(none)',
      );
      assertions.check('no gateway errors on the spine', session.driver.errors.length === 0);
      return report('login-spine', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * Live proof of gateway session parking (#1045): a WebSocket dropped without `REQ_LOGOUT`
 * keeps its Interface Server ClientView, and an explicit logout still tears it down.
 *
 * The evidence is the Interface Server's Survival log. `TClientView.OnDisconnect` logs
 * `Start Disconnecting <user>` when its TCP connection drops (`Interface Server/
 * InterfaceServer.pas:1803`) — so the line must be absent between close and resume, and
 * present after the logout. Retirement by a later login is a different path with a different
 * line (`[OJO!] Retiring the old Client View..`, `:3145-3146`). The flow changes no game state.
 */
const sessionResume: Flow = {
  name: 'session-resume',
  what:
    'close the WebSocket without logout -> 20 s -> resume -> read -> old token refused -> ' +
    'logout tears the ClientView down',
  mutates: false,
  run: async ctx => {
    const sleep = ctx.sleep ?? defaultSleep;
    const marker = `Start Disconnecting ${PRIMARY_ACCOUNT.username}`;
    const assertions = new Assertions();
    const first = await login(PRIMARY_ACCOUNT);
    let live: LiveSession = first;
    let loggedOff = false;
    try {
      const token = await awaitResumeToken(first.driver);
      const window = await openLogWindow(await findCurrentSurvivalLog(INTERFACE_LOG_BASE));

      // Deliberately not logoff: a bare close is what parks the session.
      await first.driver.close();
      await sleep(TIMEOUTS.resumeGap);

      try {
        const resumed = await resumeSession(PRIMARY_ACCOUNT, token);
        live = { ...first, driver: resumed.driver };
        const company = resumed.snapshot.company;
        assertions.check(
          'the resume succeeds and its snapshot names the same company',
          company?.id === first.company.id && company?.name === first.company.name,
          `resumed ${company?.name ?? '(none)'}, logged in as ${first.company.name}`,
        );
      } catch (err: unknown) {
        // The parked session stays parked; its park timer (or the next login's eviction)
        // ends it. The finally's logoff tolerates the closed driver.
        assertions.check('the parked session resumes', false, toErrorMessage(err));
        return report('session-resume', assertions, [], first);
      }

      try {
        const users = await live.driver.request<WsRespChatUserList>(
          { type: WsMessageType.REQ_CHAT_GET_USERS },
          WsMessageType.RESP_CHAT_USER_LIST,
        );
        assertions.check(
          'a read answers on the resumed session (GetUserList, answered by the Interface Server ClientView)',
          Array.isArray(users.users),
          Array.isArray(users.users) ? `${users.users.length} user(s)` : 'no user list',
        );
      } catch (err: unknown) {
        assertions.check(
          'a read answers on the resumed session (GetUserList, answered by the Interface Server ClientView)',
          false,
          toErrorMessage(err),
        );
      }

      try {
        const again = await resumeSession(PRIMARY_ACCOUNT, token);
        // Accepted: the gateway moved the session to this socket, so the logout must use it.
        live = { ...first, driver: again.driver };
        assertions.check('the used token is refused when presented again', false, 'the old token was accepted');
      } catch (err: unknown) {
        assertions.check(
          'the used token is refused when presented again',
          err instanceof WsDriverError && err.code === ERROR_AccessDenied,
          toErrorMessage(err),
        );
      }

      // Read last before the logout: the window covers close -> gap -> resume -> read -> old token.
      const gap = await readSince(window);
      const line = gap.split(/\r?\n/).find(l => l.includes(marker));
      assertions.check(
        'no Interface Server teardown between close and resume',
        line === undefined,
        line?.trim() ?? `${gap.length} bytes appended since the close, no "${marker}" line`,
      );

      await logoff(live);
      loggedOff = true;
      // logoff() swallows its answer; the driver's log keeps it. An answered logout is the
      // evidence that agrees when the teardown line cannot be seen — there is no read-back here.
      const answered = live.driver.log.some(e => e.direction === 'received' && e.type === WsMessageType.RESP_LOGOUT);
      const teardown = 'an explicit logout tears the ClientView down';
      const look = await lookForLine({ url: window.url, window }, w => awaitMarker(w, marker, TIMEOUTS.logSettle));
      if (look.line === null && !answered) {
        assertions.check(teardown, false, `${logMissReason(look, marker, window.url)} — and the logout request was not answered`);
      } else {
        checkLogLine(assertions, teardown, look, { marker, url: window.url }, 'the logout request was answered (RESP_LOGOUT)');
      }

      assertions.check('no gateway errors', live.driver.errors.length === 0);
      return report('session-resume', assertions, [], live);
    } finally {
      if (!loggedOff) await logoff(live);
    }
  },
};

/** Read-only governance: the town this account governs, and its politics payload. */
const politicsRead: Flow = {
  name: 'politics-read',
  what: 'town list -> governed town -> politics data',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const town = await findTown(session, GOVERNED_TOWN);
      assertions.check('the governed town is still listed', town.name === GOVERNED_TOWN, town.name);

      const data = await readPolitics(session, town);
      assertions.check('politics data returned', Boolean(data));
      const ratingCount =
        (data?.popularRatings ?? []).length + (data?.ifelRatings ?? []).length + (data?.tycoonsRatings ?? []).length;
      assertions.check('ratings are listed', ratingCount > 0, `${ratingCount} rating row(s)`);
      const mayorName = data?.mayorName ?? '';
      assertions.check("mayorName names SPO_test3's office", holdsGovernedOffice(mayorName), mayorName);
      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('politics-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * The mutation flow. One probe, on the tax rate of the town this account governs —
 * inside the blast radius by construction (doc/E2E-POLICY.md §9).
 */
const politicsWrite: Flow = {
  name: 'politics-write',
  what: 'round-trip probes on RDOSetTaxValue at the governed town hall: row-0 rate, then row-0 subsidy',
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const town = await findTown(session, GOVERNED_TOWN);
      const visualClass = await resolveVisualClass(session, town.x, town.y);
      const details = await readBuildingDetails(session, town.x, town.y, visualClass);
      assertions.check('the town hall is governable by this account', details.canGovern === true);
      if (!details.canGovern) return report('politics-write', assertions, probes, session);

      // The tax table is a section: the opening read above answers `canGovern`
      // and the header group, and this is the request that brings the rates.
      const taxes = await readSectionGroups(session, town.x, town.y, 'townTaxes', visualClass);
      const current = propertyValue(taxes, 'townTaxes', 'Tax0Percent');
      assertions.check('a tax row is readable', current !== undefined, current);
      if (current === undefined) return report('politics-write', assertions, probes, session);

      const spec: ProbeSpec = {
        what: `${town.name} tax row 0 rate`,
        member: 'RDOSetTaxValue',
        x: town.x,
        y: town.y,
        visualClass,
        groupId: 'townTaxes',
        readProperty: 'Tax0Percent',
        writeProperty: 'RDOSetTaxValue',
        // building-property-handler.ts:141 resolves the row index to the real TaxId.
        additionalParams: { index: '0' },
        testValue: original => nudge(original),
      };

      const url = ctx.survivalLogUrl ?? (await findCurrentSurvivalLog());
      try {
        probes.push(await runProbe(session, spec, ctx.lock, openLogWindow, url));
      } catch (err: unknown) {
        probes.push(probeFailure(spec, err));
      }
      assertions.check('the probe proved the write reached the object', probeHeld(probes[0]), probes[0]?.note);

      // The subsidy restores to the rate probe's original, never to a value re-read now: the
      // facility's cache (two-minute TTL, Kernel/Population.pas:1192) can still hand back the
      // rate probe's test value. So it runs only when that original was confirmed.
      const rate = probes[0];
      if (rate?.restored === true) {
        const taxId = propertyValue(taxes, 'townTaxes', 'Tax0Id');
        const subsidy: ProbeSpec = {
          ...spec,
          what: `${town.name} tax row 0 subsidy`,
          testValue: () => SUBSIDY_VALUE,
          original: rate.original,
          // Kernel/Population.pas:1254 — "Setting Tax value: <town>, <TaxId>, <value>".
          logMatch: (line, written) => taxLogMatches(line, town.name, taxId, written),
        };
        try {
          probes.push(
            await runProbe(session, subsidy, ctx.lock, openLogWindow, url, { now: ctx.now, sleep: ctx.sleep }),
          );
        } catch (err: unknown) {
          probes.push(probeFailure(subsidy, err));
        }
        assertions.check(
          "the subsidy probe proved the write and restored the rate probe's original",
          probeHeld(probes[1]),
          probes[1]?.note,
        );
      } else {
        assertions.untestable(
          'the subsidy probe',
          "not attempted — the rate probe's restore did not read back, so its original is unconfirmed",
        );
      }
      return report('politics-write', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * What a subsidy writes: `TaxesTab.tsx` sends the literal `'-10'`, as Voyager does, and
 * `Kernel/BasicTaxes.pas:247-250` stores it (`StoreToCache` then writes `Tax0Percent = -10`).
 */
const SUBSIDY_VALUE = '-10';

/** The tax line's identifying fields — the town, the TaxId when the section served it, the value. */
export function taxLogMatches(line: string, town: string, taxId: string | undefined, written: string): boolean {
  const trimmed = line.trim();
  if (taxId !== undefined) return trimmed.endsWith(`Setting Tax value: ${town}, ${taxId}, ${written}`);
  return trimmed.includes(`Setting Tax value: ${town}, `) && trimmed.endsWith(`, ${written}`);
}

/** `REQ_POLITICS_DATA` for a town hall — the payload the Politics panel reads. */
async function readPolitics(
  session: LiveSession,
  town: { name: string; x: number; y: number },
): Promise<PoliticsData> {
  const politics = await session.driver.request<WsRespPoliticsData>(
    {
      type: WsMessageType.REQ_POLITICS_DATA,
      townName: town.name,
      buildingX: town.x,
      buildingY: town.y,
    },
    WsMessageType.RESP_POLITICS_DATA,
  );
  return politics.data;
}

/**
 * Whether a ruler name is SPO_test3's office: the login name, or the role name a company
 * switch installs — the two prongs `holdsOffice` (politics-handler.ts) applies, case-insensitively.
 */
export function holdsGovernedOffice(mayorName: string): boolean {
  const name = mayorName.trim().toLowerCase();
  return name === PRIMARY_ACCOUNT.username.toLowerCase() || name === `mayor of ${GOVERNED_TOWN}`.toLowerCase();
}

/**
 * The town minimum wage — `TTownHall.RDOSetMinSalaryValue` (`Kernel/Population.pas:167`,
 * body `:1292`, log `:1294`). The Capitol's variant (`Kernel/WorldPolitics.pas:265`) stays a
 * capability exception (`PRESIDENT_MEMBERS`); this drives the town hall's.
 */
const townMinWage: Flow = {
  name: 'town-min-wage',
  what: 'round-trip probe on RDOSetMinSalaryValue (population kind 0) at the governed town hall',
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const town = await findTown(session, GOVERNED_TOWN);
      const visualClass = await resolveVisualClass(session, town.x, town.y);
      const details = await readBuildingDetails(session, town.x, town.y, visualClass);
      assertions.check('the town hall is governable by this account', details.canGovern === true);
      if (!details.canGovern) return report('town-min-wage', assertions, probes, session);

      const jobs = await readSectionGroups(session, town.x, town.y, 'townJobs', visualClass);
      const current = propertyValue(jobs, 'townJobs', 'hiMinSalary');
      assertions.check('the minimum wage is readable', current !== undefined, current);
      if (current === undefined) return report('town-min-wage', assertions, probes, session);

      const spec: ProbeSpec = {
        what: `${town.name} minimum wage, population kind 0 (hi)`,
        member: 'RDOSetMinSalaryValue',
        x: town.x,
        y: town.y,
        visualClass,
        // hiMinSalary is MayorMinSalary, the town's own figure (Kernel/Population.pas:1219);
        // the write invalidates the facility (:1300), so the read-back does not lag.
        groupId: 'townJobs',
        readProperty: 'hiMinSalary',
        writeProperty: 'RDOSetMinSalaryValue',
        // TOWN_JOBS_GROUP's mapping; building-property-handler.ts builds (levelIndex, value).
        additionalParams: { levelIndex: '0' },
        // 0..100 — inside the 255 clamp of Kernel/Population.pas:1299.
        testValue: original => nudge(original),
        logMatch: (line, written) => minWageLogMatches(line, town.name, written),
      };

      const url = ctx.survivalLogUrl ?? (await findCurrentSurvivalLog());
      try {
        probes.push(await runProbe(session, spec, ctx.lock, openLogWindow, url, { now: ctx.now, sleep: ctx.sleep }));
      } catch (err: unknown) {
        probes.push(probeFailure(spec, err));
      }
      assertions.check('the probe proved the write reached the object', probeHeld(probes[0]), probes[0]?.note);
      return report('town-min-wage', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/** `Kernel/Population.pas:1294` — "Setting Min Wage: <town>, <PopKind>, <value>"; kind 0 here. */
export function minWageLogMatches(line: string, town: string, written: string): boolean {
  return line.trim().endsWith(`Setting Min Wage: ${town}, 0, ${written}`);
}

const PUBLICITY_LEVELS = [0, 25, 50, 75, 100];

/**
 * Another publicity level than `original`. The reference client emits only 0/25/50/75/100
 * (`mayorpub.asp:182-186`) and the default is 0 (`Kernel/Politics.pas:453`), so any other
 * original is refused — before the round trip records or writes anything.
 */
export function otherPublicityLevel(original: string): string {
  const parsed = Number(original);
  if (original.trim() === '' || !PUBLICITY_LEVELS.includes(parsed)) {
    throw new Error(
      `publicity "${original}" is not one of 0/25/50/75/100 — the restore could not be exact, so nothing is written`,
    );
  }
  return String(parsed >= 50 ? parsed - 25 : parsed + 25);
}

/** `Kernel/TownPolitics.pas:224` — "Setting town politics publicity: <RatingId>, <value>". */
export function publicityLogMatches(line: string, ratingId: string, written: string): boolean {
  return line.trim().endsWith(`Setting town politics publicity: ${ratingId}, ${written}`);
}

/** `TPoliticalTownHall.RDOSetPublicity` (`Kernel/TownPolitics.pas:220`) — town-scoped. */
const publicityRoundTrip: Flow = {
  name: 'publicity-roundtrip',
  what: 'round trip on RDOSetPublicity for one rating at the governed town hall',
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const town = await findTown(session, GOVERNED_TOWN);
      const data = await readPolitics(session, town);
      const row = (data?.publicity ?? [])[0];
      assertions.check('a publicity row is listed', row !== undefined, row ? `${row.name} (${row.id})` : 'none');
      if (!row) return report('publicity-roundtrip', assertions, probes, session);

      const ratingId = row.id;
      const read = async (): Promise<string | undefined> => {
        const level = (await readPolitics(session, town))?.publicity?.find(p => p.id === ratingId)?.level;
        return level === undefined ? undefined : String(level);
      };
      const what = `${town.name} publicity for rating ${row.name} (${ratingId})`;
      const member = 'RDOSetPublicity';
      const url = ctx.survivalLogUrl ?? (await findCurrentSurvivalLog());
      try {
        probes.push(
          await runRoundTrip(
            {
              what,
              member,
              read,
              testValue: otherPublicityLevel,
              write: async value => {
                const resp = await session.driver.request<WsRespPoliticsSetPublicity>(
                  {
                    type: WsMessageType.REQ_POLITICS_SET_PUBLICITY,
                    buildingX: town.x,
                    buildingY: town.y,
                    ratingId,
                    value: Number(value),
                  },
                  WsMessageType.RESP_POLITICS_SET_PUBLICITY,
                );
                if (!resp.success) throw new Error(`SET_PUBLICITY refused: ${resp.message ?? 'no message'}`);
              },
              proof: {
                log: {
                  marker: LOG_MARKERS.RDOSetPublicity,
                  match: (line, written) => publicityLogMatches(line, ratingId, written),
                },
                readBack: {
                  source: `publicity[${ratingId}].level via REQ_POLITICS_DATA (mayorpub.asp's selected option)`,
                  why:
                    'the page reads 25*(RulerPublicity \\ 25) (mayorpub.asp:169) and the write ' +
                    'invalidates the town hall cache (Kernel/TownPolitics.pas:231-232)',
                  read,
                  boundMs: TIMEOUTS.readBack,
                },
              },
            },
            ctx.lock,
            openLogWindow,
            url,
            { now: ctx.now, sleep: ctx.sleep },
          ),
        );
      } catch (err: unknown) {
        probes.push(probeFailure({ what, member }, err));
      }
      assertions.check('the round trip proved the write and restored it', probeHeld(probes[0]), probes[0]?.note);
      return report('publicity-roundtrip', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The test-owned value of `mayor-rating-roundtrip`: SPO_test's opinion of SPO_test3's term.
 *
 * The baseline is 100 and the probe 0 — the two ends of the 0..100 range — so the direction of
 * every move is known whatever SPO_test's prior opinion P was on the very first run: P lies in
 * [0, 100], so writing 0 can only move the aggregate down (or leave it), and writing 100 can only
 * move it up (or leave it). The first run leaves SPO_test's opinion at 100 for good — accepted by the
 * maintainer (2026-09-29): a test account's opinion of a test account.
 */
export const RATING_BASELINE = 100;
export const RATING_PROBE = 0;

/**
 * `Kernel/TownPolitics.pas:192` — "Setting town politics Tycoon rating: <TycoonId>, <RatingId>,
 * <Value>". The rater is the gateway's login name (`politicsSetRating`), compared case-insensitively.
 */
export function ratingLogMatches(line: string, rater: string, ratingId: string, value: string): boolean {
  return line
    .trim()
    .toLowerCase()
    .endsWith(`Setting town politics Tycoon rating: ${rater}, ${ratingId}, ${value}`.toLowerCase());
}

export type RatingMove = 'towards' | 'away' | 'still';

/** How the aggregate moved from `before` to `after`, against a write going from `from` to `to`. */
export function ratingMove(before: number, after: number, from: number, to: number): RatingMove {
  const moved = Math.sign(after - before);
  if (moved === 0) return 'still';
  return moved === Math.sign(to - from) ? 'towards' : 'away';
}

const RATING_STILL_REASON =
  'the aggregate TycoonsRating did not move — it is round(Σ (prestige+1)·ethics·opinion / Σ (prestige+1)) ' +
  'over every survey (Kernel/Politics.pas:374-392, evaluated from Kernel/TownPolitics.pas:210), so it equals ' +
  "SPO_test's opinion only when SPO_test is the sole survey; the other surveys' weight, the rounding, or a SPO_test " +
  'campaign in the town (ethics 0, Kernel/TownPolitics.pas:550-553) can hold it still';

/**
 * SPO_test rates SPO_test3's term at Helartia (`TPoliticalTownHall.RDOSetRatingFrom`,
 * Kernel/TownPolitics.pas:186, log :192) — the maintainer's decision of 2026-09-29 (E2E-POLICY §9).
 *
 * SPO_test's own opinion cannot be read: the gateway reads only the aggregate `TycoonsRating`
 * (`parsePoliticsRatings`, tycoonratings.asp:147), and the per-rater `RDOGetRatingFrom`
 * (Kernel/TownPolitics.pas:163-184) is uncatalogued. So the opinion is a test-owned value with the
 * fixed baseline `RATING_BASELINE`: write `RATING_PROBE`, see the line and the aggregate move towards
 * it, rate the baseline again, see it move back. An aggregate that does not move is UNTESTABLE.
 */
const mayorRatingRoundTrip: Flow = {
  name: 'mayor-rating-roundtrip',
  what:
    `SPO_test rates SPO_test3's term at ${GOVERNED_TOWN} ${RATING_PROBE}, then back to ${RATING_BASELINE} — ` +
    'Survival line + the aggregate Tycoons rating moving each way',
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const crazz = await loginSecondary();
    if ('skipped' in crazz) return skippedResult('mayor-rating-roundtrip', crazz.skipped);
    try {
      await mayorRatingSteps(crazz, ctx, assertions);
      return report('mayor-rating-roundtrip', assertions, [], crazz);
    } finally {
      await logoff(crazz);
    }
  },
};

async function mayorRatingSteps(crazz: LiveSession, ctx: FlowContext, assertions: Assertions): Promise<void> {
  const rater = SECONDARY_ACCOUNT.username;
  const town = await findTown(crazz, GOVERNED_TOWN);
  const data = await readPolitics(crazz, town);
  const mayor = data?.mayorName ?? '';
  if (!holdsGovernedOffice(mayor)) {
    assertions.untestable(
      'the rating round trip',
      `${GOVERNED_TOWN}'s mayor is "${mayor}", not ${PRIMARY_ACCOUNT.username} — ${rater} rates only ` +
        `${PRIMARY_ACCOUNT.username}'s term (maintainer, 2026-09-29); nothing written`,
    );
    return;
  }
  const row = (data?.tycoonsRatings ?? []).find(r => r.id !== undefined && r.id !== '');
  assertions.check(
    "a Tycoons' rating row with an id is listed",
    row?.id !== undefined,
    row ? `${row.name} (${String(row.id)}) = ${row.value}` : 'none — nothing written',
  );
  if (row?.id === undefined) return;

  const ratingId = row.id;
  const before = row.value;
  const read = async (): Promise<number | undefined> =>
    (await readPolitics(crazz, town))?.tycoonsRatings?.find(r => r.id === ratingId)?.value;
  const rate = async (value: number): Promise<void> => {
    const resp = await crazz.driver.request<WsRespPoliticsSetRating>(
      { type: WsMessageType.REQ_POLITICS_SET_RATING, buildingX: town.x, buildingY: town.y, ratingId, value },
      WsMessageType.RESP_POLITICS_SET_RATING,
    );
    if (resp.success === false) throw new Error(`SET_RATING ${value} refused: ${resp.message ?? 'no message'}`);
  };
  const lineOf = (window: Awaited<ReturnType<typeof openLogWindow>>, value: number): Promise<string | null> =>
    awaitMarker(
      window,
      { marker: LOG_MARKERS.RDOSetRatingFrom, match: l => ratingLogMatches(l, rater, ratingId, String(value)) },
      TIMEOUTS.logSettle,
    );

  const key = `RDOSetRatingFrom:${randomUUID()}`;
  ctx.lock.addPendingRestore({
    key,
    what:
      `${rater}'s rating of ${PRIMARY_ACCOUNT.username}'s term at ${town.name}, criterion ${row.name} (${ratingId}) — ` +
      `put back ${RATING_BASELINE} (log in as ${rater}, Politics → Tycoons' ratings)`,
    originalValue: String(RATING_BASELINE),
  });
  const url = await survivalUrl(ctx);

  // The write leg. `move` stays undefined when the write threw or the row vanished.
  let move: RatingMove | undefined;
  let after: number | undefined;
  try {
    // A log fault is never reported as the write's: the window opens, and is searched, apart.
    const opened = await openLog(url);
    await rate(RATING_PROBE);
    const polled = await pollUntil(
      read,
      v => v !== undefined && ratingMove(before, v, RATING_BASELINE, RATING_PROBE) !== 'still',
      ctx,
    );
    after = polled.last;
    // The evidence beside a missing line, as observed: only a move towards the probe agrees.
    const observed = after === undefined ? undefined : ratingMove(before, after, RATING_BASELINE, RATING_PROBE);
    checkLogLine(
      assertions,
      `the write of ${RATING_PROBE} logged its Tycoon rating line`,
      await lookForLine(opened, window => lineOf(window, RATING_PROBE)),
      { marker: LOG_MARKERS.RDOSetRatingFrom, url },
      observed === 'towards'
        ? `the aggregate read ${before} -> ${String(after)}`
        : `and the aggregate does not agree (${observed === undefined ? `row ${ratingId} no longer listed` : `${before} -> ${String(after)}`})`,
    );
    if (after === undefined) {
      assertions.check('the rating row reads back after the write', false, `row ${ratingId} is no longer listed`);
    } else {
      move = ratingMove(before, after, RATING_BASELINE, RATING_PROBE);
      if (move === 'still') assertions.untestable('the rating write', `${before} -> ${after}: ${RATING_STILL_REASON}`);
      else {
        assertions.check(
          `the aggregate moved towards the written ${RATING_PROBE}`,
          move === 'towards',
          `${before} -> ${after}`,
        );
      }
    }
  } catch (err: unknown) {
    assertions.check(`the write of ${RATING_PROBE} was accepted`, false, toErrorMessage(err));
  } finally {
    await restoreRating(ctx, key, assertions, {
      url,
      write: () => rate(RATING_BASELINE),
      line: window => lineOf(window, RATING_BASELINE),
      read,
      anchor: after ?? before,
      moved: move === 'towards',
    });
  }
}

/**
 * The rating's restore — rate the baseline again, always, even after a failed write. After a proven
 * write the aggregate must move back; otherwise it must at least not move away.
 *
 * The pending restore is cleared when the restore write did not throw and that aggregate condition
 * holds — with the restore line seen, or with it missing or unreadable (maintainer decision
 * 2026-10-05, option b: the line is then UNTESTABLE, its reason kept). It is kept, and the flow
 * FAILs, when the write throws or is refused, the aggregate moves away or never moves back, or the
 * row cannot be read back: nothing observable agrees.
 */
async function restoreRating(
  ctx: FlowContext,
  key: string,
  assertions: Assertions,
  leg: {
    url: string;
    write: () => Promise<void>;
    line: (window: LogWindow) => Promise<string | null>;
    read: () => Promise<number | undefined>;
    anchor: number;
    moved: boolean;
  },
): Promise<void> {
  const opened = await openLog(leg.url);
  let back = false;
  let detail = '';
  let look: LogLook | undefined;
  try {
    await leg.write();
    look = await lookForLine(opened, leg.line);
    if (leg.moved) {
      const polled = await pollUntil(
        leg.read,
        v => v !== undefined && ratingMove(leg.anchor, v, RATING_PROBE, RATING_BASELINE) === 'towards',
        ctx,
      );
      back = polled.ok;
      detail = `${leg.anchor} -> ${String(polled.last)}`;
      assertions.check(`the aggregate moved back towards ${RATING_BASELINE}`, back, detail);
    } else {
      const now = await leg.read();
      back = now !== undefined && ratingMove(leg.anchor, now, RATING_PROBE, RATING_BASELINE) !== 'away';
      detail = `${leg.anchor} -> ${String(now)}`;
      assertions.check(`the restore did not move the aggregate away from ${RATING_BASELINE}`, back, detail);
    }
  } catch (err: unknown) {
    const what = look === undefined ? `the restore to ${RATING_BASELINE} was accepted` : 'the rating row reads back after the restore';
    assertions.check(what, false, toErrorMessage(err));
  }
  if (look !== undefined) {
    checkLogLine(
      assertions,
      `the restore to ${RATING_BASELINE} logged its Tycoon rating line`,
      look,
      { marker: LOG_MARKERS.RDOSetRatingFrom, url: leg.url },
      back
        ? `the aggregate read ${detail}, so the pending restore is cleared (maintainer decision 2026-10-05, option b)`
        : `and the aggregate does not agree (${detail || 'not read back'}), so the pending restore is kept`,
      `the restore to ${RATING_BASELINE}'s Tycoon rating line`,
    );
  }
  if (back) ctx.lock.clearPendingRestore(key);
  else assertions.check('the rating restore is proven', false, 'pending restore kept');
}

/**
 * The political role the gateway reads for a tycoon (`handleTycoonRole`, ws-handlers/politics-handlers.ts)
 * — sent today only by `checkCapability`, never by a flow. `TMayor.StoreRoleInfoToCache` writes
 * `IsMayor` and `Town` (Kernel/TownPolitics.pas:642-651), and the roles recursion reaches the human's
 * cache (Kernel/KernelCache.pas:903-910). No write.
 */
const tycoonRoleRead: Flow = {
  name: 'tycoon-role-read',
  what: `REQ_TYCOON_ROLE for SPO_test3 -> the answer names the Mayor of ${GOVERNED_TOWN} — no write`,
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const { role } = await session.driver.request<WsRespTycoonRole>(
        { type: WsMessageType.REQ_TYCOON_ROLE, tycoonName: PRIMARY_ACCOUNT.username },
        WsMessageType.RESP_TYCOON_ROLE,
      );
      assertions.check(
        `the answer names ${PRIMARY_ACCOUNT.username}`,
        sameName(role?.tycoonName ?? '', PRIMARY_ACCOUNT.username),
        role?.tycoonName,
      );
      assertions.check(`${PRIMARY_ACCOUNT.username} is a mayor`, role?.isMayor === true, `isMayor=${String(role?.isMayor)}`);
      assertions.check(`the mayor's town is ${GOVERNED_TOWN}`, sameName(role?.town ?? '', GOVERNED_TOWN), role?.town);
      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('tycoon-role-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * `TPoliticalTownHall.RDOVote` (`Kernel/TownPolitics.pas:395`, log `:400`): vote for another
 * candidate, then re-vote the prior choice.
 *
 * With no prior vote, the flow first seeds a vote for the mayor. That vote sticks only through
 * the town's winning campaign (`Kernel/Politics.pas:1053-1060`), and the town hall caches
 * `RulerName` only when that campaign exists (`Kernel/TownPolitics.pas:483-489`) — so the seed
 * runs only when `RulerName` names the mayor, and ends UNTESTABLE, nothing written, otherwise.
 * The seed is proven by its `Voting:` line (`Kernel/TownPolitics.pas:400`) and a `VoteOf`
 * read-back. It records no pending restore: SPO_test3's own vote at the governed town is an
 * isolated target of a disposable test account (maintainer rule 2026-10-01, #1236), and a vote
 * cannot be retracted (`Kernel/Politics.pas:1035-1074`), so the vote the seed leaves is the
 * state the next run starts from. That next run, when the prior names the mayor, the mayor is
 * still `RulerName` and no other candidate exists, re-votes the mayor through the same proof
 * (line and read-back, no pending restore) instead of ending UNTESTABLE.
 *
 * A prior that no longer names a current candidate or the mayor — stale after a town election
 * (`Kernel/TownPolitics.pas:690`, `:744`) — ends UNTESTABLE, since its restore would be a silent
 * no-op (`Kernel/Politics.pas:916-933`).
 */
const voteRoundTrip: Flow = {
  name: 'vote-roundtrip',
  what: 'vote for another candidate, then re-vote the prior choice, at the governed town hall',
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const voter = PRIMARY_ACCOUNT.username;
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const town = await findTown(session, GOVERNED_TOWN);
      const visualClass = await resolveVisualClass(session, town.x, town.y);
      const data = await readPolitics(session, town);
      const candidates = (data?.campaigns ?? []).map(c => c.candidateName).filter(n => n.trim() !== '');
      const mayor = data?.mayorName ?? '';
      const readVoteOf = async (): Promise<string | undefined> =>
        propertyValue(await readSectionGroups(session, town.x, town.y, 'votes', visualClass), 'votes', 'VoteOf');
      // The choice ends the line (TownPolitics.pas:400), so "by Bob" never matches "by Bobby".
      const votedBy = (line: string, choice: string): boolean =>
        line.trim().toLowerCase().endsWith(`voting: ${voter} by ${choice}`.toLowerCase());
      const vote = async (value: string): Promise<void> => {
        const resp = await session.driver.request<WsRespPoliticsVote>(
          {
            type: WsMessageType.REQ_POLITICS_VOTE,
            buildingX: town.x,
            buildingY: town.y,
            candidateName: value,
          },
          WsMessageType.RESP_POLITICS_VOTE,
        );
        if (resp.success === false) throw new Error(`VOTE refused: ${resp.message ?? 'no message'}`);
      };

      // A vote for the mayor, proven by its Voting: line and a VoteOf read-back. No pending
      // restore — an isolated target of a disposable account (see the doc comment).
      const voteForMayor = async (kind: 'seed' | 're-vote'): Promise<void> => {
        // The log is opened and searched apart from the vote: a log fault is never the vote's.
        const opened = await openSurvivalLog(ctx);
        try {
          await vote(mayor);
          const back = await pollUntil(readVoteOf, v => v !== undefined && sameName(v, mayor), ctx, TIMEOUTS.logSettle);
          assertions.check(
            `the ${kind} vote for ${mayor} read back through votes.VoteOf (RDOVoteOf)`,
            back.ok,
            `last "${back.last ?? '(absent)'}" after ${TIMEOUTS.logSettle} ms`,
          );
          checkLogLine(
            assertions,
            `the ${kind} vote logged its Voting: line`,
            await lookForLine(opened, window =>
              awaitMarker(window, { marker: LOG_MARKERS.RDOVote, match: l => votedBy(l, mayor) }, TIMEOUTS.logSettle),
            ),
            { marker: LOG_MARKERS.RDOVote, url: opened.url },
            `votes.VoteOf read back "${back.last ?? '(absent)'}"`,
          );
        } catch (err: unknown) {
          assertions.check(`the ${kind} vote was accepted`, false, toErrorMessage(err));
        }
      };

      const gate = await readSectionGroups(session, town.x, town.y, 'votes', visualClass);
      let prior = propertyValue(gate, 'votes', 'VoteOf');
      const ruler = propertyValue(gate, 'votes', 'RulerName') ?? '';
      const rulerIsMayor = ruler.trim() !== '' && mayor.trim() !== '' && sameName(ruler, mayor);
      let seeded = false;
      if (prior === undefined || prior.trim() === '') {
        if (!rulerIsMayor) {
          assertions.untestable(
            'the vote round trip',
            `${voter} has no prior vote at ${town.name}, and RulerName "${ruler}" is not the mayor ` +
              `"${mayor}": no winning campaign to vote for (a vote sticks only for a campaign or the ` +
              'winning campaign — Kernel/Politics.pas:1053-1060; RulerName is cached only when that ' +
              'campaign exists — Kernel/TownPolitics.pas:483-489); nothing written',
          );
          return report('vote-roundtrip', assertions, probes, session);
        }
        await voteForMayor('seed');
        if (assertions.failed) return report('vote-roundtrip', assertions, probes, session);
        prior = mayor;
        seeded = true;
      }
      const choices = [...candidates, mayor].filter(n => n.trim() !== '');
      if (!choices.some(n => sameName(n, prior))) {
        assertions.untestable(
          'the vote round trip',
          `stale prior vote "${prior}": no campaign now and not the mayor (a town election deletes ` +
            'campaigns but keeps Voter.Votes — Kernel/TownPolitics.pas:690, :744; ' +
            'Kernel/Politics.pas:916-933); nothing written',
        );
        return report('vote-roundtrip', assertions, probes, session);
      }
      const other = choices.find(n => !sameName(n, prior));
      if (other === undefined) {
        // After a proven seed, the seed itself is this run's vote proof.
        if (seeded) return report('vote-roundtrip', assertions, probes, session);
        // The steady state a seed leaves: the prior already names the mayor, still the ruler.
        // Re-voting the mayor through the seed's proof is this run's vote proof.
        if (rulerIsMayor && sameName(prior, mayor)) {
          await voteForMayor('re-vote');
          return report('vote-roundtrip', assertions, probes, session);
        }
        assertions.untestable('the vote round trip', `no other candidate to vote for than "${prior}"; nothing written`);
        return report('vote-roundtrip', assertions, probes, session);
      }

      const what = `${town.name} vote of ${voter} — prior choice ${prior}`;
      const member = 'RDOVote';
      const url = await survivalUrl(ctx);
      try {
        // Opened before the change vote: the restore's line is the one naming the prior choice.
        const restoreLog = await openLog(url);
        const result = await runRoundTrip(
          {
            what,
            member,
            read: async () => prior,
            testValue: () => other,
            write: vote,
            proof: {
              // The voter in the match excludes the Capitol's identical line (WorldPolitics.pas:1822).
              log: { marker: LOG_MARKERS.RDOVote, match: votedBy },
              readBack: {
                source: 'votes.VoteOf via the section read (enrichVotesTab, RDOVoteOf)',
                why: 'RDOVoteOf is a live function (Kernel/TownPolitics.pas:47) with no cache in between',
                read: readVoteOf,
                normalise: v => v.trim().toLowerCase(),
                boundMs: TIMEOUTS.logSettle,
              },
            },
          },
          ctx.lock,
          openLogWindow,
          url,
          { now: ctx.now, sleep: ctx.sleep },
        );
        probes.push(result);
        if (result.restored) {
          checkLogLine(
            assertions,
            'the restore vote reached the object',
            await lookForLine(restoreLog, window =>
              awaitMarker(window, { marker: LOG_MARKERS.RDOVote, match: line => votedBy(line, prior) }, TIMEOUTS.logSettle),
            ),
            { marker: LOG_MARKERS.RDOVote, url },
            `votes.VoteOf read back the prior choice "${prior}"`,
          );
        }
      } catch (err: unknown) {
        probes.push(probeFailure({ what, member }, err));
      }
      assertions.check('the round trip proved the vote and restored it', probeHeld(probes[0]), probes[0]?.note);
      return report('vote-roundtrip', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * The negative case the second account exists for: a basic tycoon must not be offered
 * the mayor's controls. Catches the `tycoonratings.asp:24-25` failure mode — a guard
 * commented out and the result hardcoded true — in our own client.
 */
const permissionNegative: Flow = {
  name: 'permission-negative',
  what: `${SECONDARY_ACCOUNT.username} at the governed town hall sees canGovern=false`,
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await loginSecondary();
    if ('skipped' in session) return skippedResult('permission-negative', session.skipped);
    try {
      const town = await findTown(session, GOVERNED_TOWN);
      const visualClass = await resolveVisualClass(session, town.x, town.y);
      const details = await readBuildingDetails(session, town.x, town.y, visualClass);
      assertions.check(
        'a non-mayor is refused governance of the town hall',
        details.canGovern === false,
        `canGovern=${details.canGovern}`,
      );
      assertions.check('the read itself still succeeds', Boolean(details.visualClass));
      return report('permission-negative', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * Two-party mail, end to end for the first time: send from the primary account, read it
 * in the secondary's inbox, then delete it — the restore half of the blast-radius rule.
 */
const mailRoundTrip: Flow = {
  name: 'mail-roundtrip',
  what: `SPO_test3 sends -> ${SECONDARY_ACCOUNT.username} receives -> delete`,
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const sleep = ctx.sleep ?? defaultSleep;
    const subject = `e2e ${new Date().toISOString()}`;

    // The secondary account first, before the compose: a refused login then leaves no mail behind.
    const recipient = await loginSecondary();
    if ('skipped' in recipient) return skippedResult('mail-roundtrip', recipient.skipped);
    try {
      const sender = await login(PRIMARY_ACCOUNT);
      try {
        await sender.driver.request({ type: WsMessageType.REQ_MAIL_CONNECT }, WsMessageType.RESP_MAIL_CONNECTED);
        const sent = await sender.driver.request<WsRespMailSent>(
          {
            type: WsMessageType.REQ_MAIL_COMPOSE,
            to: SECONDARY_ACCOUNT.username,
            subject,
            body: ['Automated L2 probe. Safe to delete.'],
          },
          WsMessageType.RESP_MAIL_SENT,
          TIMEOUTS.login,
        );
        assertions.check('the compose was accepted', sent.type === WsMessageType.RESP_MAIL_SENT);
      } finally {
        await logoff(sender);
      }

      // The recipient's mail connect stays after the compose, so its unread count includes it.
      const connected = await recipient.driver.request<WsRespMailConnected>(
        { type: WsMessageType.REQ_MAIL_CONNECT },
        WsMessageType.RESP_MAIL_CONNECTED,
      );
      const inbox = await recipient.driver.request<WsRespMailFolder>(
        { type: WsMessageType.REQ_MAIL_GET_FOLDER, folder: 'Inbox' },
        WsMessageType.RESP_MAIL_FOLDER,
      );
      const delivered = inbox.messages.find(m => m.subject === subject);
      assertions.check('the message arrived in the recipient inbox', Boolean(delivered), subject);

      if (delivered) {
        const before = connected.unreadCount;
        await recipient.driver.request<WsRespMailMessage>(
          { type: WsMessageType.REQ_MAIL_READ_MESSAGE, folder: 'Inbox', messageId: delivered.messageId },
          WsMessageType.RESP_MAIL_MESSAGE,
        );
        const { count: after } = await recipient.driver.request<WsRespMailUnreadCount>(
          { type: WsMessageType.REQ_MAIL_GET_UNREAD_COUNT },
          WsMessageType.RESP_MAIL_UNREAD_COUNT,
        );
        assertions.check(
          'reading the message lowered CheckNewMail by one',
          after === before - 1,
          `messageId=${delivered.messageId} before=${before} after=${after}`,
        );

        await recipient.driver.request(
          { type: WsMessageType.REQ_MAIL_DELETE, folder: 'Inbox', messageId: delivered.messageId },
          WsMessageType.RESP_MAIL_DELETED,
        );

        // DeleteMessage is a fire-and-forget RDO procedure (Mail Server/MailServer.pas:109) —
        // the gateway answers before the server has necessarily removed the message's
        // directory, and the Inbox listing is served over HTTP from IIS (MessageList.asp),
        // not the RDO socket, so in-order delivery on the mail socket cannot put the delete
        // ahead of the read. Re-read until the message is gone, bounded, and assert on the
        // last read (issue #1025).
        let stillListed = true;
        let reads = 0;
        for (let attempt = 1; attempt <= LIMITS.mailDeleteMaxReads; attempt++) {
          const inboxAfter = await recipient.driver.request<WsRespMailFolder>(
            { type: WsMessageType.REQ_MAIL_GET_FOLDER, folder: 'Inbox' },
            WsMessageType.RESP_MAIL_FOLDER,
          );
          reads = attempt;
          stillListed = inboxAfter.messages.some(m => m.messageId === delivered.messageId);
          if (!stillListed) break;
          if (attempt < LIMITS.mailDeleteMaxReads) await sleep(TIMEOUTS.mailDeleteReread);
        }
        assertions.check(
          'the probe message was deleted again',
          !stillListed,
          `messageId=${delivered.messageId} reads=${reads}`,
        );
      }
      return report('mail-roundtrip', assertions, [], recipient);
    } finally {
      await logoff(recipient);
    }
  },
};

/**
 * People search — issue #455: proves the Root/Users sweep finds a known
 * alias live, on the account not currently logged in.
 */
const peopleSearch: Flow = {
  name: 'people-search',
  what: 'search menu: searching a known alias finds it under Root/Users',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const response = await session.driver.request<WsRespSearchMenuPeopleSearch>(
        { type: WsMessageType.REQ_SEARCH_MENU_PEOPLE_SEARCH, searchStr: SECONDARY_ACCOUNT.username },
        WsMessageType.RESP_SEARCH_MENU_PEOPLE_SEARCH,
      );
      assertions.check(
        `search for "${SECONDARY_ACCOUNT.username}" finds it`,
        response.results.includes(SECONDARY_ACCOUNT.username),
        `results: ${response.results.join(', ')}`,
      );
      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('people-search', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/** Building inspector read — the path every facility panel depends on. */
/**
 * Building inspector read — the path every facility panel depends on.
 *
 * The inspector reads one section at a time: the opening read carries the
 * header group, and each other group arrives when its menu entry is opened.
 * Both halves are asserted here, because only a live drive can show that the
 * deferred read still finds its properties in the real Delphi cache — the
 * temp object has to survive between the two round-trips and be reset to the
 * building root before the second.
 */
const buildingDetails: Flow = {
  name: 'building-details',
  what: 'town hall inspector read: header group at open, section group on demand',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const town = await findTown(session, GOVERNED_TOWN);
      const visualClass = await resolveVisualClass(session, town.x, town.y);
      const details = await readBuildingDetails(session, town.x, town.y, visualClass);

      assertions.check('tabs were served', details.tabs.length > 0, `${details.tabs.length} tabs`);
      // The template is what declares the tabs, and it is unchanged by the
      // section-at-a-time read — so it is the tab list, not the groups, that
      // tells a Town Hall from the generic fallback.
      assertions.check(
        'the Town Hall template resolved, not the generic one',
        details.tabs.some(t => t.id === 'townTaxes'),
        `tabs: ${details.tabs.map(t => t.id).join(' ')}`,
      );
      assertions.check(
        'the opening read carries the header group',
        details.groups.townGeneral !== undefined,
        `groups: ${Object.keys(details.groups).join(' ')}`,
      );
      // The load-time contract: a section nobody opened costs nothing.
      assertions.check(
        'the opening read does NOT carry a section nobody opened',
        details.groups.townTaxes === undefined,
        `groups: ${Object.keys(details.groups).join(' ')}`,
      );

      const section = await readBuildingTabData(
        session, town.x, town.y, 'townTaxes', visualClass, ['townTaxes'],
      );
      assertions.check(
        'opening the section reads its group',
        section.groups?.townTaxes !== undefined,
        `groups: ${Object.keys(section.groups ?? {}).join(' ')}`,
      );
      assertions.check(
        'the section read has property values, not just a key',
        (section.groups?.townTaxes?.length ?? 0) > 0,
        `${section.groups?.townTaxes?.length ?? 0} values`,
      );

      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('building-details', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * The Favorites tree, written for the first time: add a link, rename it,
 * remove it — each step proven by re-reading the tree.
 *
 * EVIDENCE. Unlike the civic writes, these members do not print to the
 * Survival log (`Kernel/Favorites.pas` logs only the refused root-delete), so
 * the read-back IS the proof here — and it is a sound one, because
 * `RDOFavoritesGetSubItems` walks the same in-memory `TFavorites` object the
 * write just touched. There is no model-server cache in between and therefore
 * no OB-29 lag to excuse: an item missing after an add is a failure, not a
 * late refresh.
 *
 * BLAST RADIUS. Per-tycoon and self-cleaning. The tree lives inside
 * SPO_test3's own `TTycoon`; nothing here touches the world, another player,
 * or any building. The flow removes what it created, and sweeps any leftover
 * from an interrupted earlier run by matching its own marker prefix.
 */
const FAVORITE_MARKER = 'e2e-favorite';

const favoritesRoundTrip: Flow = {
  name: 'favorites-roundtrip',
  what: 'favorites tree: add -> read back -> rename -> read back -> delete',
  mutates: true,
  run: async () => {
    const assertions = new Assertions();
    const name = `${FAVORITE_MARKER} ${new Date().toISOString()}`;
    const renamed = `${FAVORITE_MARKER} renamed`;

    const session = await login(PRIMARY_ACCOUNT);
    const listFavorites = async (): Promise<WsRespEmpireFacilities> =>
      session.driver.request<WsRespEmpireFacilities>(
        { type: WsMessageType.REQ_EMPIRE_FACILITIES },
        WsMessageType.RESP_EMPIRE_FACILITIES,
      );

    try {
      // Sweep first: an earlier run killed between add and delete would
      // otherwise leave its marker behind for good.
      const before = await listFavorites();
      for (const stale of before.facilities.filter(f => f.name.startsWith(FAVORITE_MARKER))) {
        await session.driver.request<WsRespFavoriteDelete>(
          { type: WsMessageType.REQ_FAVORITE_DELETE, path: stale.path },
          WsMessageType.RESP_FAVORITE_DELETE,
        );
      }

      const added = await session.driver.request<WsRespFavoriteAdd>(
        { type: WsMessageType.REQ_FAVORITE_ADD, name, x: 641, y: 66 },
        WsMessageType.RESP_FAVORITE_ADD,
      );
      assertions.check('the add was accepted and answered an id', added.success && (added.id ?? 0) > 0,
        `id=${added.id ?? 'none'}`);

      const afterAdd = await listFavorites();
      const item = afterAdd.facilities.find(f => f.name === name);
      assertions.check('the added favourite is in the tree the server serves', Boolean(item), name);
      assertions.check('it kept the coordinates it was given',
        item?.x === 641 && item?.y === 66, `${item?.x},${item?.y}`);

      if (item) {
        const renameResp = await session.driver.request<WsRespFavoriteRename>(
          { type: WsMessageType.REQ_FAVORITE_RENAME, path: item.path, name: renamed },
          WsMessageType.RESP_FAVORITE_RENAME,
        );
        assertions.check('the rename was accepted', renameResp.success);

        const afterRename = await listFavorites();
        const moved = afterRename.facilities.find(f => f.path === item.path);
        assertions.check('the tree serves the new name', moved?.name === renamed, moved?.name);

        const deleted = await session.driver.request<WsRespFavoriteDelete>(
          { type: WsMessageType.REQ_FAVORITE_DELETE, path: item.path },
          WsMessageType.RESP_FAVORITE_DELETE,
        );
        assertions.check('the delete was accepted', deleted.success);

        const afterDelete = await listFavorites();
        assertions.check('the favourite is gone — the world is restored',
          !afterDelete.facilities.some(f => f.path === item.path));
      }

      return report('favorites-roundtrip', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * Folder operations on the Favorites tree: create, move a link into it, move
 * it back out, delete the (now empty) folder.
 *
 * EVIDENCE. Same reasoning as `favoritesRoundTrip`: `Kernel/Favorites.pas`
 * logs nothing for these members, so the read-back through
 * `RDOFavoritesGetSubItems` — which walks the very in-memory `TFavorites`
 * object the write just touched — IS the proof, and a sound one: no
 * model-server cache sits in between to lag.
 *
 * BLAST RADIUS. Per-tycoon and self-cleaning, same as the round trip: the
 * tree lives inside SPO_test3's own `TTycoon`. The flow removes what it
 * created and sweeps any marker left by an interrupted earlier run, deepest
 * path first so a leftover link is gone before its leftover folder is asked
 * to delete itself.
 */
const FOLDER_MARKER = 'e2e-favfolder';

const favoritesFolders: Flow = {
  name: 'favorites-folders',
  what: 'favorites tree: create folder -> move link in -> move link out -> delete folder',
  mutates: true,
  run: async () => {
    const assertions = new Assertions();
    const name = `${FOLDER_MARKER} ${new Date().toISOString()}`;

    const session = await login(PRIMARY_ACCOUNT);
    const listFavorites = async (): Promise<WsRespEmpireFacilities> =>
      session.driver.request<WsRespEmpireFacilities>(
        { type: WsMessageType.REQ_EMPIRE_FACILITIES },
        WsMessageType.RESP_EMPIRE_FACILITIES,
      );

    try {
      // Sweep first, deepest path first: a link left inside a marker folder
      // from an interrupted run must go before the folder that holds it.
      const before = await listFavorites();
      const stale = [
        ...flattenFavoriteLinks(before.facilities),
        ...flattenFolders(before.facilities).map(e => e.folder),
      ].filter(item => item.name.startsWith(FOLDER_MARKER));
      stale.sort((a, b) => b.path.split('/').length - a.path.split('/').length);
      for (const item of stale) {
        await session.driver.request<WsRespFavoriteDelete>(
          { type: WsMessageType.REQ_FAVORITE_DELETE, path: item.path },
          WsMessageType.RESP_FAVORITE_DELETE,
        );
      }

      const created = await session.driver.request<WsRespFavoriteFolderCreate>(
        { type: WsMessageType.REQ_FAVORITE_FOLDER_CREATE, parentPath: '', name },
        WsMessageType.RESP_FAVORITE_FOLDER_CREATE,
      );
      assertions.check('the folder create was accepted and answered an id',
        created.success && (created.id ?? 0) > 0, `id=${created.id ?? 'none'}`);

      const afterCreate = await listFavorites();
      const folder = flattenFolders(afterCreate.facilities).map(e => e.folder).find(f => f.name === name);
      assertions.check('the folder is served with isFolder === true', folder?.isFolder === true, folder?.name);

      if (folder) {
        const added = await session.driver.request<WsRespFavoriteAdd>(
          { type: WsMessageType.REQ_FAVORITE_ADD, name: `${FOLDER_MARKER}-link`, x: 641, y: 66 },
          WsMessageType.RESP_FAVORITE_ADD,
        );
        assertions.check('the link add was accepted and answered an id',
          added.success && (added.id ?? 0) > 0, `id=${added.id ?? 'none'}`);

        const afterAdd = await listFavorites();
        const link = flattenFavoriteLinks(afterAdd.facilities).find(f => f.name === `${FOLDER_MARKER}-link`);
        assertions.check('the added link is at the root', Boolean(link), `${FOLDER_MARKER}-link`);

        if (link) {
          const movedIn = await session.driver.request<WsRespFavoriteMove>(
            { type: WsMessageType.REQ_FAVORITE_MOVE, path: link.path, destPath: folder.path },
            WsMessageType.RESP_FAVORITE_MOVE,
          );
          assertions.check('the move into the folder was accepted', movedIn.success);

          const afterMoveIn = await listFavorites();
          const inFolder = flattenFolders(afterMoveIn.facilities)
            .map(e => e.folder).find(f => f.path === folder.path);
          const movedLink = flattenFavoriteLinks(afterMoveIn.facilities).find(f => f.name === link.name);
          assertions.check('the moved link\'s path now sits under the folder',
            movedLink?.path.startsWith(`${folder.path}/`) ?? false, movedLink?.path);
          assertions.check('the folder\'s own children list carries it — the tree persists after refresh',
            inFolder?.children?.some(c => c.path === movedLink?.path) ?? false,
            `children: ${inFolder?.children?.map(c => c.path).join(' ')}`);

          if (movedLink) {
            const movedOut = await session.driver.request<WsRespFavoriteMove>(
              { type: WsMessageType.REQ_FAVORITE_MOVE, path: movedLink.path, destPath: '' },
              WsMessageType.RESP_FAVORITE_MOVE,
            );
            assertions.check('the move back to the root was accepted', movedOut.success);

            const afterMoveOut = await listFavorites();
            const backAtRoot = flattenFavoriteLinks(afterMoveOut.facilities).find(f => f.name === link.name);
            assertions.check('the link is at the root again',
              backAtRoot?.path === String(backAtRoot?.id), backAtRoot?.path);

            if (backAtRoot) {
              await session.driver.request<WsRespFavoriteDelete>(
                { type: WsMessageType.REQ_FAVORITE_DELETE, path: backAtRoot.path },
                WsMessageType.RESP_FAVORITE_DELETE,
              );
            }
          }
        }

        const deletedFolder = await session.driver.request<WsRespFavoriteDelete>(
          { type: WsMessageType.REQ_FAVORITE_DELETE, path: folder.path },
          WsMessageType.RESP_FAVORITE_DELETE,
        );
        assertions.check('the now-empty folder delete was accepted', deletedFolder.success);

        const afterDelete = await listFavorites();
        const remaining = [
          ...flattenFavoriteLinks(afterDelete.facilities),
          ...flattenFolders(afterDelete.facilities).map(e => e.folder),
        ].filter(item => item.name.startsWith(FOLDER_MARKER));
        assertions.check('no marker item remains — the world is restored', remaining.length === 0,
          remaining.map(r => r.name).join(', '));
      }

      return report('favorites-folders', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * The town paper, read end to end: the town hall names it, the bar lists its
 * kept issues, and the newest one opens with stories in it.
 *
 * Read-only, and outside the RDO wire entirely — the paper lives on the ASP
 * side (`Visual/News/`), so what this proves is the other half of the gateway:
 * that the pages are reachable, that the folder names still decode, and that
 * an issue page still parses into stories.
 *
 * A paper with no kept issue is an environment exception, not a failure. The
 * issues are folders under `Newspapers\<World>\<Paper>\` written by the News
 * Server (`News.pas:986`), a process planitia does not run — its log listing
 * carries FIVECACHE, FIVEINTERFACE, FIVEMAIL and FIVEMODELSERVER and no news
 * server — so `ShowBar.asp:81-109` has nothing to iterate and the gateway
 * correctly answers an empty list with no error. What still holds live is the
 * half this world can prove: the town hall names its paper, and `showbar.asp`
 * is reachable and parses. The empty-list rendering itself is covered at L0/L1.
 *
 * Not required by routing (#1009): it runs and reports; its UNTESTABLE is informational.
 */
const newspaperRead: Flow = {
  name: 'newspaper-read',
  what: 'town hall -> its paper -> the issue bar -> the newest issue',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const town = await findTown(session, GOVERNED_TOWN);
      const visualClass = await resolveVisualClass(session, town.x, town.y);
      const details = await readBuildingDetails(session, town.x, town.y, visualClass);
      const paperName = propertyValue(details.groups, 'townGeneral', 'NewspaperName') ?? '';
      assertions.check('the town hall names its paper', paperName !== '', paperName || '(none)');

      const target = {
        paperName,
        townName: town.name,
        isCapitol: false,
        buildingX: town.x,
        buildingY: town.y,
      };

      const listed = await session.driver.request<WsRespNewspaperIssues>(
        { type: WsMessageType.REQ_NEWSPAPER_ISSUES, ...target },
        WsMessageType.RESP_NEWSPAPER_ISSUES,
      );
      assertions.check('the issue bar was read', listed.list.error === '', listed.list.error);

      const issues = listed.list.issues;
      if (issues.length > 0) {
        // The newest, which is what the bar selects with `Selected` empty.
        const newest = issues[0].folder;
        const opened = await session.driver.request<WsRespNewspaperIssue>(
          { type: WsMessageType.REQ_NEWSPAPER_ISSUE, ...target, folder: newest },
          WsMessageType.RESP_NEWSPAPER_ISSUE,
        );
        assertions.check('the newest issue was read', opened.issue.error === '', opened.issue.error);
        assertions.check(
          'the issue answers for the folder that was asked for',
          opened.issue.folder === newest,
          `${opened.issue.folder} vs ${newest}`,
        );
        assertions.check(
          'the newest issue opens with stories',
          opened.issue.stories.length > 0,
          `${opened.issue.stories.length} stories`,
        );
      } else {
        // Environment exception, not a defect — see the flow's note above. Never
        // fall through to REQ_NEWSPAPER_ISSUE with the folder `''`.
        assertions.untestable(
          'the newest issue opens with stories',
          `${paperName}: 0 issues — no news server prints on this world`,
        );
      }

      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('newspaper-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * The paper's columns board: the town hall names its paper, then the board index
 * (`boardmsg.asp?top=TRUE` + `boardlist.asp`) is read. Read-only — the read branch of
 * `boardmsg.asp` only opens `NewsBoard.NewsObject`; `action=post` is the only write branch
 * and is never sent (posting is excluded, maintainer 2026-09-29: no member deletes a post,
 * `News Server/NewsObject.pas:11-53`). The detail records the counts. A board with no column
 * and no tree entry ends UNTESTABLE (#1188): the page answering proves no read of a post, and
 * the flow cannot post one. Routing still requires it.
 */
const newspaperBoardRead: Flow = {
  name: 'newspaper-board-read',
  what: 'town hall -> its paper -> the columns board',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const town = await findTown(session, GOVERNED_TOWN);
      const visualClass = await resolveVisualClass(session, town.x, town.y);
      const details = await readBuildingDetails(session, town.x, town.y, visualClass);
      const paperName = propertyValue(details.groups, 'townGeneral', 'NewspaperName') ?? '';
      assertions.check('the town hall names its paper', paperName !== '', paperName || '(none)');
      // Never ask for the board of a paper with no name.
      if (paperName === '') return report('newspaper-board-read', assertions, [], session);

      const { board } = await session.driver.request<WsRespNewspaperBoard>(
        {
          type: WsMessageType.REQ_NEWSPAPER_BOARD,
          paperName,
          townName: town.name,
          isCapitol: false,
          buildingX: town.x,
          buildingY: town.y,
        },
        WsMessageType.RESP_NEWSPAPER_BOARD,
      );
      assertions.check('the columns board was read', board.error === '', board.error);
      const wellFormed =
        Array.isArray(board.columns) &&
        Array.isArray(board.tree) &&
        board.columns.every(c => c.path !== '') &&
        board.tree.every(e => e.path !== '');
      assertions.check(
        'the board lists are well-formed',
        wellFormed,
        `${board.columns.length} columns, ${board.tree.length} tree entries`,
      );
      if (board.columns.length === 0 && board.tree.length === 0) {
        assertions.untestable(
          'the board lists a column',
          `${paperName}: 0 columns, 0 tree entries — nothing is posted, and posting is excluded ` +
            '(News Server/NewsObject.pas:11-53)',
        );
      }

      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('newspaper-board-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * What a focus on an empty tile answers: `parseBuildingFocusResponse` (`src/server/map-parsers.ts`)
 * throws it on an empty reply, and `withErrorHandler` (`src/server/ws-handlers/ws-utils.ts`)
 * forwards the message under `ERROR_FacilityNotFound` — the code is the same for every focus
 * error, so only the message proves the tile is empty. A copy: the e2e build does not import
 * server code; the unit test pins it to the parser.
 */
export const EMPTY_TILE_FOCUS_ERROR = 'Invalid building focus header format - no data';

const ZONING_ALERT_SUBJECT = 'Zoning Alert!'; // World.pas:2721
/** The header the server's own alert carries — Mail Server/ModelServer.pas:883. */
const ZONING_ALERT_HEADERS = 'ContentType=text/html';
/** Marks what the seed plants, so a reader of the mailbox knows it is not a real alert. */
const SEED_MARKER = 'e2e-seed';

function sameAccount(name: string, account: E2eAccount): boolean {
  return name.trim().toLowerCase() === account.username.toLowerCase();
}

/**
 * The alert page URL, shaped as `Kernel/World.pas:35-37`, `:2710-2719` build it. Its host must
 * be the world IP — the gateway fetches the page only then — and it holds no space or quote,
 * where the META extractor stops.
 */
function zoningAlertUrl(ip: string, x: number, y: number): string {
  const query = new URLSearchParams({
    Zoned: PRIMARY_ACCOUNT.username,
    BuildNo: '1',
    Zoner0: SECONDARY_ACCOUNT.username,
    BuildName0: SEED_MARKER,
    BuildCompany0: SEED_MARKER,
    BuildX0: String(x),
    BuildY0: String(y),
  });
  return `http://${ip}/Five/0/Visual/Voyager/Mail/SpecialMessages/MsgZoned.asp?${query.toString()}`;
}

/** The three-line body the server writes — Mail Server/ModelServer.pas:903-905. */
function zoningAlertBody(url: string): string[] {
  return ['<HEAD>', `<META HTTP-EQUIV="REFRESH" CONTENT="0; URL=${url}">`, '</HEAD>'];
}

/** Delete every matching alert from one mailbox. Never throws: one mailbox failing never skips the other. */
async function purgeSeededAlerts(
  account: E2eAccount,
  folder: 'Inbox' | 'Sent',
  matches: (m: MailMessageHeader) => boolean,
): Promise<FlowCheck> {
  const what = `seeded "${ZONING_ALERT_SUBJECT}" removed from ${account.username}'s ${folder}`;
  try {
    const opened = account === SECONDARY_ACCOUNT ? await loginSecondary() : await login(account);
    if ('skipped' in opened) {
      return {
        what,
        ok: false,
        skipped: opened.skipped,
        detail:
          `${account.username} refused at login (${opened.skipped}) — ` +
          `any seeded "${ZONING_ALERT_SUBJECT}" is left in ${account.username}'s ${folder}`,
      };
    }
    const session = opened;
    try {
      await session.driver.request({ type: WsMessageType.REQ_MAIL_CONNECT }, WsMessageType.RESP_MAIL_CONNECTED);
      const listing = await session.driver.request<WsRespMailFolder>(
        { type: WsMessageType.REQ_MAIL_GET_FOLDER, folder },
        WsMessageType.RESP_MAIL_FOLDER,
      );
      const stale = listing.messages.filter(matches);
      let deleted = 0;
      for (const m of stale) {
        const resp = await session.driver.request<WsRespMailDeleted>(
          { type: WsMessageType.REQ_MAIL_DELETE, folder, messageId: m.messageId },
          WsMessageType.RESP_MAIL_DELETED,
        );
        if (resp.success === true) deleted++;
      }
      return { what, ok: deleted === stale.length, detail: `${deleted}/${stale.length} deleted` };
    } finally {
      await logoff(session);
    }
  } catch (err: unknown) {
    return { what, ok: false, detail: toErrorMessage(err) };
  }
}

/** Alerts sent by the secondary account in SPO_test3's Inbox — a server-sent alert has another sender and is spared. */
const seededInInbox = (m: MailMessageHeader): boolean =>
  m.subject === ZONING_ALERT_SUBJECT && sameAccount(m.from, SECONDARY_ACCOUNT);
/** The secondary's own copies in `Sent`, filed there by Post — Mail Server/MailServer.pas:802-811. */
const seededInSent = (m: MailMessageHeader): boolean =>
  m.subject === ZONING_ALERT_SUBJECT && sameAccount(m.to, PRIMARY_ACCOUNT);

/** The seed's cleanup, and also its pre-compose sweep of any leftover from an interrupted run. */
async function sweepSeededAlerts(): Promise<FlowCheck[]> {
  return [
    await purgeSeededAlerts(PRIMARY_ACCOUNT, 'Inbox', seededInInbox),
    await purgeSeededAlerts(SECONDARY_ACCOUNT, 'Sent', seededInSent),
  ];
}

/**
 * The secondary account sends SPO_test3 one look-alike of the server's zoning alert, pointing at the governed
 * town hall — a building that exists, so the flow's focus lands. The cleanup deletes it from
 * both mailboxes.
 */
async function seedZoningAlert(): Promise<FlowSeed> {
  const what = `${SECONDARY_ACCOUNT.username} sends ${PRIMARY_ACCOUNT.username} one look-alike "${ZONING_ALERT_SUBJECT}"`;
  const cleanup = sweepSeededAlerts;

  const swept = await sweepSeededAlerts();
  const refused = swept.find(c => c.skipped !== undefined);
  if (refused) return { outcome: { what, ok: false, skipped: refused.skipped }, cleanup };
  const bad = swept.find(c => !c.ok);
  if (bad) {
    return { outcome: { what, ok: false, detail: `stale sweep: ${bad.what} — ${bad.detail ?? ''}` }, cleanup };
  }

  try {
    const opened = await loginSecondary();
    if ('skipped' in opened) return { outcome: { what, ok: false, skipped: opened.skipped }, cleanup };
    const sender = opened;
    try {
      const ip = sender.world?.ip;
      if (!ip) return { outcome: { what, ok: false, detail: 'the login carried no world IP' }, cleanup };
      const hall = await findTown(sender, GOVERNED_TOWN);
      await sender.driver.request({ type: WsMessageType.REQ_MAIL_CONNECT }, WsMessageType.RESP_MAIL_CONNECTED);
      const sent = await sender.driver.request<WsRespMailSent>(
        {
          type: WsMessageType.REQ_MAIL_COMPOSE,
          to: PRIMARY_ACCOUNT.username,
          subject: ZONING_ALERT_SUBJECT,
          body: zoningAlertBody(zoningAlertUrl(ip, hall.x, hall.y)),
          headers: ZONING_ALERT_HEADERS,
        },
        WsMessageType.RESP_MAIL_SENT,
        TIMEOUTS.login,
      );
      const ok = sent.success === true;
      return {
        outcome: { what, ok, detail: ok ? `hall (${hall.x},${hall.y}) via ${ip}` : (sent.message ?? 'compose refused') },
        cleanup,
      };
    } finally {
      await logoff(sender);
    }
  } catch (err: unknown) {
    return { outcome: { what, ok: false, detail: toErrorMessage(err) }, cleanup };
  }
}

/**
 * Opens the newest "Zoning Alert!" mail (issue #515), reads the gateway-fetched HTML page
 * (see mail-handler.ts's `fetchSystemMailPage`), translates the first building-name link
 * through `parseLocalAspUrl` — the same translator the client's link interceptor uses —
 * and sends the very REQ_BUILDING_FOCUS the client sends on a click.
 *
 * The seed (`seedZoningAlert`, #1009) feeds the flow: the secondary account sends SPO_test3 one look-alike
 * alert before the run, and it is deleted from both mailboxes after. Read without the seed,
 * no zoning alert in the inbox is reported UNTESTABLE, not PASS and not a failure — nothing
 * was zoned out of this account lately, so the flow proved nothing. A demolished building is
 * also accepted — the whole point of the alert is that the building is gone — but only on the
 * empty-tile message (`EMPTY_TILE_FOCUS_ERROR`). The error code proves nothing: every focus
 * error is wrapped as `ERROR_FacilityNotFound` (#1188). Any other error, a timeout included,
 * fails.
 */
const zoningAlertRead: Flow = {
  name: 'zoning-alert-read',
  what: 'Inbox -> newest "Zoning Alert!" -> gateway-fetched page -> link -> tile -> REQ_BUILDING_FOCUS',
  // The seed sends and deletes one mail on the two LOCKED mailboxes, like mail-roundtrip;
  // nothing else in the world changes.
  mutates: true,
  seed: seedZoningAlert,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      await session.driver.request<WsRespMailConnected>(
        { type: WsMessageType.REQ_MAIL_CONNECT },
        WsMessageType.RESP_MAIL_CONNECTED,
      );
      const inbox = await session.driver.request<WsRespMailFolder>(
        { type: WsMessageType.REQ_MAIL_GET_FOLDER, folder: 'Inbox' },
        WsMessageType.RESP_MAIL_FOLDER,
      );
      const alert = inbox.messages.find(m => m.subject === ZONING_ALERT_SUBJECT);

      if (!alert) {
        assertions.untestable(
          'a zoning alert link focuses its tile',
          'no "Zoning Alert!" in the inbox — nothing was zoned out of this account lately',
        );
        return report('zoning-alert-read', assertions, [], session);
      }

      const opened = await session.driver.request<WsRespMailMessage>(
        { type: WsMessageType.REQ_MAIL_READ_MESSAGE, folder: 'Inbox', messageId: alert.messageId },
        WsMessageType.RESP_MAIL_MESSAGE,
      );
      const htmlBody = opened.message.htmlBody;
      assertions.check(
        'the alert page was fetched and contains a map-select link',
        typeof htmlBody === 'string' && htmlBody.includes('frame_Action=SELECT'),
        htmlBody ? `${htmlBody.length} chars` : '(none)',
      );

      const hrefs = [...(htmlBody ?? '').matchAll(/href="([^"]+)"/gi)].map(m => m[1]);
      const targets = hrefs.map(parseLocalAspUrl).filter((t): t is NonNullable<typeof t> => t !== null);
      assertions.check('at least one link translates to a map tile', targets.length > 0, `${targets.length} targets`);

      if (targets.length > 0) {
        const { x, y } = targets[0];
        let focus: WsRespBuildingFocus | undefined;
        try {
          focus = await session.driver.request<WsRespBuildingFocus>(
            { type: WsMessageType.REQ_BUILDING_FOCUS, x, y },
            WsMessageType.RESP_BUILDING_FOCUS,
          );
        } catch (err: unknown) {
          // The building the alert names was, by definition, demolished — the empty-tile
          // message for that exact tile is an accepted outcome, not a wire failure.
          assertions.check(
            'REQ_BUILDING_FOCUS answered — either the tile focused, or the building is gone (empty tile)',
            err instanceof WsDriverError && err.message === EMPTY_TILE_FOCUS_ERROR,
            toErrorMessage(err),
          );
        }

        if (focus !== undefined) {
          await session.driver.request(
            { type: WsMessageType.REQ_BUILDING_UNFOCUS },
            WsMessageType.RESP_CHAT_SUCCESS,
          );
          assertions.check(
            'the focus opened on a building at the alert tile',
            Boolean(focus.building.buildingId),
            `x=${x} y=${y} buildingId=${focus.building.buildingId}`,
          );
          assertions.check('no gateway errors', session.driver.errors.length === 0);
        }
      }

      return report('zoning-alert-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

// ---------------------------------------------------------------------------
// Drafts, send-from-draft and reply (#1144)
//
// Mail is served by the Mail Server, not the model server: there is no Survival line, and the
// proof is the mailbox read back through the account that should hold the message (the
// mail-roundtrip precedent). `Post` files a Sent copy for the sender
// (Mail Server/MailServer.pas:809-811), which is why each sender's `Sent` is swept too.
// ---------------------------------------------------------------------------

const MAIL_DRAFTS_MARKER = 'e2e-mail-drafts ';
const MAIL_SEND_FROM_DRAFT_MARKER = 'e2e-mail-send-from-draft ';
const MAIL_REPLY_MARKER = 'e2e-mail-reply ';
const MAIL_PROBE_BODY = 'Automated L2 probe. Safe to delete.';
const DRAFT_FIRST_TEXT = 'Automated L2 draft probe, first save. Safe to delete.';
const DRAFT_SECOND_TEXT = 'Automated L2 draft probe, second save. Safe to delete.';

/** Matches a message whose subject starts with `marker` — also once answered (`Re: <marker>…`). */
function hasMarker(marker: string): (m: MailMessageHeader) => boolean {
  return m => m.subject.replace(/^re:\s*/i, '').startsWith(marker);
}

/**
 * The reply headers the client's Reply sends — the same four lines, in the same order, as
 * `buildReplyHeaders` in `src/client/store/mail-store.ts`. A copy, because the e2e build
 * (`tsconfig.e2e.json`) includes only `src/e2e/**` and `src/shared/**`, and that store imports
 * `zustand`; a unit test pins the two equal.
 */
export function replyHeaders(message: MailMessageFull): string {
  return [
    `In-Reply-To=${message.messageId}`,
    `In-Reply-To-From=${message.fromAddr}`,
    `In-Reply-To-Subject=${message.subject}`,
    `In-Reply-To-Date=${message.date}`,
  ].join('\n');
}

async function mailConnect(session: LiveSession): Promise<void> {
  await session.driver.request({ type: WsMessageType.REQ_MAIL_CONNECT }, WsMessageType.RESP_MAIL_CONNECTED);
}

async function listFolder(session: LiveSession, folder: MailFolder): Promise<MailMessageHeader[]> {
  const listing = await session.driver.request<WsRespMailFolder>(
    { type: WsMessageType.REQ_MAIL_GET_FOLDER, folder },
    WsMessageType.RESP_MAIL_FOLDER,
  );
  return listing.messages;
}

interface MailOut {
  to: string;
  subject: string;
  body: string[];
  headers?: string;
  existingDraftId?: string;
}

function saveDraft(session: LiveSession, mail: MailOut): Promise<WsRespMailDraftSaved> {
  return session.driver.request<WsRespMailDraftSaved>(
    { type: WsMessageType.REQ_MAIL_SAVE_DRAFT, ...mail },
    WsMessageType.RESP_MAIL_DRAFT_SAVED,
    TIMEOUTS.login,
  );
}

function sendMail(session: LiveSession, mail: MailOut): Promise<WsRespMailSent> {
  return session.driver.request<WsRespMailSent>(
    { type: WsMessageType.REQ_MAIL_COMPOSE, ...mail },
    WsMessageType.RESP_MAIL_SENT,
    TIMEOUTS.login,
  );
}

interface Reread {
  /** The last listing read — the one every assertion is judged on. */
  messages: MailMessageHeader[];
  reads: number;
  settled: boolean;
}

/**
 * The bounded re-read of #1025: the listing is IIS-served and deletes are fire-and-forget, so
 * one read can lag in either direction. Reads until `settled`, at most
 * `LIMITS.mailDeleteMaxReads` times, `TIMEOUTS.mailDeleteReread` apart (never after the last).
 */
async function rereadUntil(
  session: LiveSession,
  folder: MailFolder,
  settled: (messages: MailMessageHeader[]) => boolean,
  sleep: (ms: number) => Promise<void>,
): Promise<Reread> {
  let messages: MailMessageHeader[] = [];
  let reads = 0;
  let done = false;
  for (let attempt = 1; attempt <= LIMITS.mailDeleteMaxReads; attempt++) {
    messages = await listFolder(session, folder);
    reads = attempt;
    done = settled(messages);
    if (done) break;
    if (attempt < LIMITS.mailDeleteMaxReads) await sleep(TIMEOUTS.mailDeleteReread);
  }
  return { messages, reads, settled: done };
}

/** Delete every match from one folder, judged on the last bounded re-read. Never throws. */
async function purgeFolder(
  session: LiveSession,
  folder: MailFolder,
  matches: (m: MailMessageHeader) => boolean,
  sleep: (ms: number) => Promise<void>,
  label: string,
): Promise<FlowCheck> {
  const what = `${label} removed from ${session.account.username}'s ${folder}`;
  try {
    const stale = (await listFolder(session, folder)).filter(matches);
    for (const m of stale) {
      await session.driver.request<WsRespMailDeleted>(
        { type: WsMessageType.REQ_MAIL_DELETE, folder, messageId: m.messageId },
        WsMessageType.RESP_MAIL_DELETED,
      );
    }
    const after = await rereadUntil(session, folder, msgs => !msgs.some(matches), sleep);
    const left = after.messages.filter(matches).length;
    return {
      what,
      ok: left === 0,
      detail: `${stale.length} deleted, ${left} still listed after ${after.reads} read(s)`,
    };
  } catch (err: unknown) {
    return { what, ok: false, detail: toErrorMessage(err) };
  }
}

/**
 * The cleanup of one mailbox: a fresh login — the cleanup matters most after a failure, which
 * is when the drive's socket may be dead — then `purgeFolder` on each folder. One check per
 * folder; never throws. A refusal of the secondary account here comes after the flow's first write, so its checks
 * are not ok and name the leftover.
 */
async function purgeMailbox(
  account: E2eAccount,
  folders: MailFolder[],
  matches: (m: MailMessageHeader) => boolean,
  sleep: (ms: number) => Promise<void>,
  label: string,
): Promise<FlowCheck[]> {
  const whatOf = (folder: MailFolder): string => `${label} removed from ${account.username}'s ${folder}`;
  const failAll = (detail: string): FlowCheck[] => folders.map(f => ({ what: whatOf(f), ok: false, detail }));
  let opened: SecondaryLogin;
  try {
    opened = account === SECONDARY_ACCOUNT ? await loginSecondary() : await login(account);
  } catch (err: unknown) {
    return failAll(toErrorMessage(err));
  }
  if ('skipped' in opened) {
    const reason = opened.skipped;
    return folders.map(f => ({
      what: whatOf(f),
      ok: false,
      skipped: reason,
      detail: `${account.username} refused at login (${reason}) — any ${label} is left in ${account.username}'s ${f}`,
    }));
  }
  const session = opened;
  try {
    await mailConnect(session);
    const checks: FlowCheck[] = [];
    for (const f of folders) checks.push(await purgeFolder(session, f, matches, sleep, label));
    return checks;
  } catch (err: unknown) {
    return failAll(toErrorMessage(err));
  } finally {
    await logoff(session);
  }
}

/**
 * Sweep every folder the flow writes for its marker before anything is composed — a run killed
 * between send and cleanup leaves nothing the next run cannot remove. Each sweep is recorded as
 * a `pre-sweep:` assertion; returns false when one could not clear its folder.
 */
async function preSweep(
  assertions: Assertions,
  targets: [LiveSession, MailFolder][],
  matches: (m: MailMessageHeader) => boolean,
  sleep: (ms: number) => Promise<void>,
  label: string,
): Promise<boolean> {
  for (const [session, folder] of targets) {
    const check = await purgeFolder(session, folder, matches, sleep, label);
    assertions.check(`pre-sweep: ${check.what}`, check.ok, check.detail);
  }
  return !assertions.failed;
}

/** The drive's result with the cleanup attached; a cleanup that left anything turns it FAIL. */
function withCleanup(result: FlowResult, cleanup: FlowCheck[]): FlowResult {
  return { ...result, cleanup, status: cleanup.some(c => !c.ok) ? 'FAIL' : result.status };
}

/** The same FAIL shape `runUnseeded` builds for a drive that threw. */
function failedResult(name: string, err: unknown): FlowResult {
  return {
    name,
    status: 'FAIL',
    assertions: [],
    untestable: [],
    probes: [],
    messagesSent: 0,
    messagesReceived: 0,
    wireErrors: 0,
    error: toErrorMessage(err),
  };
}

const markerLabel = (marker: string): string => `"${marker.trim()}" mail`;

async function driveDrafts(subject: string, sleep: (ms: number) => Promise<void>): Promise<FlowResult> {
  const name = 'mail-drafts';
  const assertions = new Assertions();
  const bySubject = (m: MailMessageHeader): boolean => m.subject === subject;
  const session = await login(PRIMARY_ACCOUNT);
  try {
    await mailConnect(session);
    const swept = await preSweep(
      assertions, [[session, 'Draft']], hasMarker(MAIL_DRAFTS_MARKER), sleep, markerLabel(MAIL_DRAFTS_MARKER),
    );
    if (!swept) return report(name, assertions, [], session);

    // Addressed to itself: a draft is never delivered, and if a regression ever posted it,
    // it could not land in another player's mailbox.
    const mail = { to: PRIMARY_ACCOUNT.username, subject };
    const first = await saveDraft(session, { ...mail, body: [DRAFT_FIRST_TEXT] });
    assertions.check('the first save was accepted', first.success === true, first.message);

    const listed = await rereadUntil(session, 'Draft', msgs => msgs.some(bySubject), sleep);
    const firstCopy = listed.messages.find(bySubject);
    assertions.check('the Draft folder lists the saved draft', Boolean(firstCopy), `${subject} reads=${listed.reads}`);
    if (!firstCopy) return report(name, assertions, [], session);

    const second = await saveDraft(session, { ...mail, body: [DRAFT_SECOND_TEXT], existingDraftId: firstCopy.messageId });
    assertions.check('the save over the draft was accepted', second.success === true, second.message);

    const replaced = await rereadUntil(
      session,
      'Draft',
      msgs => {
        const copies = msgs.filter(bySubject);
        return copies.length === 1 && copies[0].messageId !== firstCopy.messageId;
      },
      sleep,
    );
    const copies = replaced.messages.filter(bySubject);
    assertions.check(
      'Draft holds exactly one copy, not the old one',
      replaced.settled,
      `old=${firstCopy.messageId} listed=[${copies.map(m => m.messageId).join(',')}] reads=${replaced.reads}`,
    );
    if (!replaced.settled) return report(name, assertions, [], session);

    const kept = copies[0];
    const opened = await session.driver.request<WsRespMailMessage>(
      { type: WsMessageType.REQ_MAIL_READ_MESSAGE, folder: 'Draft', messageId: kept.messageId },
      WsMessageType.RESP_MAIL_MESSAGE,
    );
    const text = (opened.message.body ?? []).join('\n');
    assertions.check('the kept copy carries the new text', text.includes(DRAFT_SECOND_TEXT), text);

    await session.driver.request(
      { type: WsMessageType.REQ_MAIL_DELETE, folder: 'Draft', messageId: kept.messageId },
      WsMessageType.RESP_MAIL_DELETED,
    );
    const gone = await rereadUntil(session, 'Draft', msgs => !msgs.some(bySubject), sleep);
    assertions.check('the draft was deleted', gone.settled, `messageId=${kept.messageId} reads=${gone.reads}`);
    return report(name, assertions, [], session);
  } finally {
    await logoff(session);
  }
}

/**
 * Save draft (`REQ_MAIL_SAVE_DRAFT`), then save again over it (`existingDraftId`): the Draft
 * folder must end with exactly one copy, carrying the new text; the draft is then deleted.
 * SPO_test3 only — no second account.
 */
const mailDrafts: Flow = {
  name: 'mail-drafts',
  what: 'save draft -> Draft lists it -> save again over it -> one copy, new text -> delete -> gone',
  mutates: true,
  run: async ctx => {
    const sleep = ctx.sleep ?? defaultSleep;
    const subject = `${MAIL_DRAFTS_MARKER}${new Date().toISOString()}`;
    let result: FlowResult;
    try {
      result = await driveDrafts(subject, sleep);
    } catch (err: unknown) {
      result = failedResult('mail-drafts', err);
    }
    const cleanup = await purgeMailbox(
      PRIMARY_ACCOUNT, ['Draft'], hasMarker(MAIL_DRAFTS_MARKER), sleep, markerLabel(MAIL_DRAFTS_MARKER),
    );
    return withCleanup(result, cleanup);
  },
};

async function driveSendFromDraft(
  secondary: LiveSession,
  subject: string,
  sleep: (ms: number) => Promise<void>,
): Promise<FlowResult> {
  const name = 'mail-send-from-draft';
  const assertions = new Assertions();
  const bySubject = (m: MailMessageHeader): boolean => m.subject === subject;
  try {
    const session = await login(PRIMARY_ACCOUNT);
    try {
      await mailConnect(secondary);
      await mailConnect(session);
      const swept = await preSweep(
        assertions,
        [[session, 'Draft'], [session, 'Sent'], [secondary, 'Inbox']],
        hasMarker(MAIL_SEND_FROM_DRAFT_MARKER),
        sleep,
        markerLabel(MAIL_SEND_FROM_DRAFT_MARKER),
      );
      if (!swept) return report(name, assertions, [], session);

      const mail = { to: SECONDARY_ACCOUNT.username, subject, body: [MAIL_PROBE_BODY] };
      const saved = await saveDraft(session, mail);
      assertions.check('the draft save was accepted', saved.success === true, saved.message);

      const listed = await rereadUntil(session, 'Draft', msgs => msgs.some(bySubject), sleep);
      const draft = listed.messages.find(bySubject);
      assertions.check('the Draft folder lists the saved draft', Boolean(draft), `${subject} reads=${listed.reads}`);
      if (!draft) return report(name, assertions, [], session);

      const sent = await sendMail(session, { ...mail, existingDraftId: draft.messageId });
      assertions.check('the send from the draft was accepted', sent.success === true, sent.message);

      const delivered = await rereadUntil(secondary, 'Inbox', msgs => msgs.some(bySubject), sleep);
      assertions.check(
        `${SECONDARY_ACCOUNT.username}'s Inbox holds it`,
        delivered.settled,
        `${subject} reads=${delivered.reads}`,
      );

      const draftGone = await rereadUntil(session, 'Draft', msgs => !msgs.some(bySubject), sleep);
      assertions.check(
        `${PRIMARY_ACCOUNT.username}'s Draft no longer holds it (#510)`,
        draftGone.settled,
        `draftId=${draft.messageId} reads=${draftGone.reads}`,
      );
      return report(name, assertions, [], session);
    } finally {
      await logoff(session);
    }
  } finally {
    await logoff(secondary);
  }
}

/**
 * Send from an opened draft: `REQ_MAIL_COMPOSE` with `existingDraftId`, which deletes the Draft
 * copy once `Post` succeeds (#510). The secondary account logs in first, so a refusal writes nothing (SKIPPED);
 * a refusal at the cleanup, after the send, is a FAIL naming the leftover.
 */
const mailSendFromDraft: Flow = {
  name: 'mail-send-from-draft',
  what: `${SECONDARY_ACCOUNT.username} first -> SPO_test3 saves a draft to ${SECONDARY_ACCOUNT.username} -> sends it from the draft -> ${SECONDARY_ACCOUNT.username} receives it, Draft copy gone`,
  mutates: true,
  run: async ctx => {
    const name = 'mail-send-from-draft';
    const sleep = ctx.sleep ?? defaultSleep;
    const subject = `${MAIL_SEND_FROM_DRAFT_MARKER}${new Date().toISOString()}`;
    // The secondary account first, before any write: a refused login then leaves nothing behind.
    const secondary = await loginSecondary();
    if ('skipped' in secondary) return skippedResult(name, secondary.skipped);
    let result: FlowResult;
    try {
      result = await driveSendFromDraft(secondary, subject, sleep);
    } catch (err: unknown) {
      result = failedResult(name, err);
    }
    const matches = hasMarker(MAIL_SEND_FROM_DRAFT_MARKER);
    const label = markerLabel(MAIL_SEND_FROM_DRAFT_MARKER);
    const cleanup = [
      ...(await purgeMailbox(PRIMARY_ACCOUNT, ['Draft', 'Sent'], matches, sleep, label)),
      ...(await purgeMailbox(SECONDARY_ACCOUNT, ['Inbox'], matches, sleep, label)),
    ];
    return withCleanup(result, cleanup);
  },
};

async function driveReply(
  secondary: LiveSession,
  subject: string,
  sleep: (ms: number) => Promise<void>,
): Promise<FlowResult> {
  const name = 'mail-reply';
  const assertions = new Assertions();
  const bySubject = (m: MailMessageHeader): boolean => m.subject === subject;
  const replySubject = `Re: ${subject}`;
  try {
    const session = await login(PRIMARY_ACCOUNT);
    try {
      await mailConnect(secondary);
      await mailConnect(session);
      const swept = await preSweep(
        assertions,
        [[session, 'Inbox'], [session, 'Sent'], [secondary, 'Inbox'], [secondary, 'Sent']],
        hasMarker(MAIL_REPLY_MARKER),
        sleep,
        markerLabel(MAIL_REPLY_MARKER),
      );
      if (!swept) return report(name, assertions, [], session);

      const sent = await sendMail(session, { to: SECONDARY_ACCOUNT.username, subject, body: [MAIL_PROBE_BODY] });
      assertions.check('the compose was accepted', sent.success === true, sent.message);

      const delivered = await rereadUntil(secondary, 'Inbox', msgs => msgs.some(bySubject), sleep);
      const received = delivered.messages.find(bySubject);
      assertions.check(
        `${SECONDARY_ACCOUNT.username}'s Inbox holds the message`,
        Boolean(received),
        `${subject} reads=${delivered.reads}`,
      );
      if (!received) return report(name, assertions, [], session);

      const { message } = await secondary.driver.request<WsRespMailMessage>(
        { type: WsMessageType.REQ_MAIL_READ_MESSAGE, folder: 'Inbox', messageId: received.messageId },
        WsMessageType.RESP_MAIL_MESSAGE,
      );
      assertions.check('the read message carries a sender address', Boolean(message.fromAddr), message.fromAddr);
      if (!message.fromAddr) return report(name, assertions, [], session);

      // The client's Reply (`startReply` in mail-store.ts): to the sender, `Re: ` subject, and
      // the four In-Reply-To* lines as headers. The secondary's one write — a pair the flow undoes.
      const reply = await sendMail(secondary, {
        to: message.fromAddr,
        subject: `Re: ${message.subject}`,
        body: ['Automated L2 reply probe. Safe to delete.'],
        headers: replyHeaders(message),
      });
      assertions.check('the reply was accepted', reply.success === true, reply.message);

      const answered = await rereadUntil(session, 'Inbox', msgs => msgs.some(m => m.subject === replySubject), sleep);
      assertions.check(
        `${PRIMARY_ACCOUNT.username}'s Inbox holds the reply with a Re: subject`,
        answered.settled,
        `${replySubject} reads=${answered.reads}`,
      );
      return report(name, assertions, [], session);
    } finally {
      await logoff(session);
    }
  } finally {
    await logoff(secondary);
  }
}

/**
 * Reply, the way the client's Reply does it: `Re: <subject>` and the `In-Reply-To*` headers
 * (`replyHeaders`). What it does NOT prove: `RESP_MAIL_MESSAGE` carries only the fixed header
 * keys (`parseMailHeaders` in `session/mail-handler.ts`) and `AddHeaders` is fire-and-forget, so
 * whether the `In-Reply-To*` lines landed is not observable over the WS contract. It proves a
 * compose carrying `headers` is still posted and delivered with its `Re:` subject.
 */
const mailReply: Flow = {
  name: 'mail-reply',
  what: `${SECONDARY_ACCOUNT.username} first -> SPO_test3 sends -> ${SECONDARY_ACCOUNT.username} reads and replies (Re:, In-Reply-To* headers) -> SPO_test3 receives the reply`,
  mutates: true,
  run: async ctx => {
    const name = 'mail-reply';
    const sleep = ctx.sleep ?? defaultSleep;
    const subject = `${MAIL_REPLY_MARKER}${new Date().toISOString()}`;
    // The secondary account first, before any write: a refused login then leaves nothing behind.
    const secondary = await loginSecondary();
    if ('skipped' in secondary) return skippedResult(name, secondary.skipped);
    let result: FlowResult;
    try {
      result = await driveReply(secondary, subject, sleep);
    } catch (err: unknown) {
      result = failedResult(name, err);
    }
    const matches = hasMarker(MAIL_REPLY_MARKER);
    const label = markerLabel(MAIL_REPLY_MARKER);
    const cleanup = [
      ...(await purgeMailbox(PRIMARY_ACCOUNT, ['Inbox', 'Sent'], matches, sleep, label)),
      ...(await purgeMailbox(SECONDARY_ACCOUNT, ['Inbox', 'Sent'], matches, sleep, label)),
    ];
    return withCleanup(result, cleanup);
  },
};

/**
 * The map surface's "Nearest Town Hall" jump, end to end: the local Manhattan approximation
 * (`@/shared/nearest-town`) picks a town, then the arrival goes through the same
 * `REQ_BUILDING_FOCUS` the client's selecting path (`onNavigateToBuilding`) sends.
 *
 * Standing on the governed town's own hall makes the expected answer known without a second
 * town in the fixture: the local metric must pick that town over any other on the list.
 */
const nearestTownHall: Flow = {
  name: 'nearest-town-hall',
  what: 'town list -> local Manhattan pick -> REQ_BUILDING_FOCUS -> inspector opens on the hall',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const towns = await listTowns(session);
      const here = towns.find(t => t.name === GOVERNED_TOWN);
      assertions.check('the governed town is still listed', here !== undefined);
      if (!here) return report('nearest-town-hall', assertions, [], session);

      const target = nearestTown(towns, here.x, here.y);
      assertions.check(
        'the local metric picks the town whose hall we stand on',
        target?.name === GOVERNED_TOWN,
        target?.name,
      );

      const focus = await session.driver.request<WsRespBuildingFocus>(
        { type: WsMessageType.REQ_BUILDING_FOCUS, x: here.x, y: here.y },
        WsMessageType.RESP_BUILDING_FOCUS,
      );
      assertions.check('the focus opened on a building', focus.building.buildingName !== '' && focus.building.buildingId !== '');

      const visualClass = await resolveVisualClass(session, here.x, here.y);
      const details = await readBuildingDetails(session, here.x, here.y, visualClass);
      assertions.check(
        'the inspector resolved the Town Hall template at the arrival tile',
        details.tabs.some(t => t.id === 'townTaxes'),
      );

      await session.driver.request(
        { type: WsMessageType.REQ_BUILDING_UNFOCUS },
        WsMessageType.RESP_CHAT_SUCCESS,
      );
      assertions.check('no gateway errors', session.driver.errors.length === 0);

      return report('nearest-town-hall', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/** The side of the square view a camera update carries. */
const CAMERA_VIEW_SIZE = 32;

/**
 * Fire-and-forget camera update centred on (x, y), with its view — `handleUpdateCamera`
 * answers nothing; with the view fields `updateCameraPosition` also emits `SetViewedArea`.
 */
function sendCamera(session: LiveSession, x: number, y: number): { viewX: number; viewY: number } {
  const viewX = Math.max(0, x - CAMERA_VIEW_SIZE / 2);
  const viewY = Math.max(0, y - CAMERA_VIEW_SIZE / 2);
  session.driver.send({
    type: WsMessageType.REQ_UPDATE_CAMERA,
    x,
    y,
    viewX,
    viewY,
    viewW: CAMERA_VIEW_SIZE,
    viewH: CAMERA_VIEW_SIZE,
  });
  return { viewX, viewY };
}

interface Tile { x: number; y: number }
const tileText = (p: Tile): string => `(${p.x},${p.y})`;
const sameTile = (a: Tile, b: Tile): boolean => a.x === b.x && a.y === b.y;

/**
 * A fresh SPO_test3 login's saved camera — `selectCompany` reads it from the `LastX.0` /
 * `LastY.0` cookie (`login-handler.ts`) — then, when given, one camera update before the
 * logoff that saves it (`savePlayerPosition`).
 */
async function readSavedCamera(then?: Tile): Promise<Tile> {
  const s = await login(PRIMARY_ACCOUNT);
  try {
    const saved = { x: s.playerX, y: s.playerY };
    if (then) sendCamera(s, then.x, then.y);
    return saved;
  } finally {
    await logoff(s);
  }
}

/**
 * The camera cookie read back at a new login (#1188): it must hold `sent`; the camera is then
 * put back on `original`, and a third login confirms it. Never throws. `savePlayerPosition`
 * never writes (0,0) (`spo_session.ts`), so an original (0,0) cannot be restored — UNTESTABLE.
 */
async function cameraReadBack(assertions: Assertions, original: Tile, sent: Tile): Promise<void> {
  const readBack = 'the camera cookie reads back the camera sent';
  try {
    const read = await readSavedCamera(original);
    assertions.check(readBack, sameTile(read, sent), `read ${tileText(read)}, sent ${tileText(sent)}`);
  } catch (err: unknown) {
    assertions.check(readBack, false, toErrorMessage(err));
    return;
  }
  const restored = 'the camera cookie is restored';
  if (original.x === 0 && original.y === 0) {
    assertions.untestable(restored, 'the saved position was (0,0), which savePlayerPosition never writes (spo_session.ts)');
    return;
  }
  try {
    const read = await readSavedCamera();
    assertions.check(restored, sameTile(read, original), `read ${tileText(read)}, original ${tileText(original)}`);
  } catch (err: unknown) {
    assertions.check(restored, false, toErrorMessage(err));
  }
}

/** One `REQ_CONTEXT_STATUS` read at (x, y). */
async function contextStatusAt(session: LiveSession, x: number, y: number): Promise<string> {
  const response = await session.driver.request<WsRespContextStatus>(
    { type: WsMessageType.REQ_CONTEXT_STATUS, x, y },
    WsMessageType.RESP_CONTEXT_STATUS,
  );
  return response.text;
}

/**
 * The context status at (x, y), re-read a bounded number of times: `ContextStatusText`
 * answers `''` while the ClientView is `fServerBusy` (`Interface Server/InterfaceServer.pas:837-839`).
 */
async function readContextStatus(
  session: LiveSession,
  x: number,
  y: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ text: string; reads: number }> {
  let text = '';
  let reads = 0;
  while (reads < LIMITS.contextStatusMaxReads) {
    if (reads > 0) await sleep(TIMEOUTS.contextStatusReread);
    text = await contextStatusAt(session, x, y);
    reads++;
    if (text !== '') break;
  }
  return { text, reads };
}

interface Rect { x1: number; y1: number; x2: number; y2: number }

/**
 * Whether a surface grid covers the inclusive rectangle (`Kernel/MapCompress.pas:45-50`):
 * `y2-y1+1` rows of `x2-x1+1` cells. Reads the rows only, never the `width`/`height`
 * labels — `CompressMap` writes the row count first (`MapCompress.pas:44`) while
 * `parseRLEResponse` labels it `width`, so a label check fails on correct data.
 */
function surfaceShape(rows: number[][], rect: Rect): { ok: boolean; detail: string } {
  const w = rect.x2 - rect.x1 + 1;
  const h = rect.y2 - rect.y1 + 1;
  const ok = rows.length === h && rows.every(r => r.length === w);
  return { ok, detail: `${rows.length} rows × ${rows[0]?.length ?? 0} cells (expected ${h} × ${w})` };
}

/**
 * The map & world readers: context status, world event, two surfaces, the facility
 * dimensions and the camera update.
 *
 * Two persistent effects, both bounded. The world event is **consumed** — `PickEvent`
 * extracts and frees the head of SPO_test3's event queue (`Kernel/Kernel.pas:11255-11271`,
 * `Kernel/World.pas:4840-4871`), the same pop every login's `selectCompany` makes, so the
 * flow costs one more login's worth. The camera is sent **to the town hall** (one tile off it
 * when the saved position is the hall), so it differs from the saved position the
 * select-company reply carried; `savePlayerPosition` writes it at logoff, and a fresh login
 * reads it back (#1188). That login puts the camera back on the saved position, and a third
 * confirms it. The only write is SPO_test3's own camera bookmark, which every logoff already
 * rewrites, moved and put back — nothing in the world is written: `mutates: false`.
 */
const worldReaders: Flow = {
  name: 'world-readers',
  what: 'context status -> world event -> ZONES + Beauty surfaces -> facility dimensions -> camera',
  mutates: false,
  run: async ctx => {
    const sleep = ctx.sleep ?? defaultSleep;
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    const saved: Tile = { x: session.playerX, y: session.playerY };
    let camera: Tile | undefined;
    try {
      const here = (await listTowns(session)).find(t => t.name === GOVERNED_TOWN);
      assertions.check('the governed town is still listed', here !== undefined);
      if (!here) return report('world-readers', assertions, [], session);

      const status = await readContextStatus(session, here.x, here.y, sleep);
      assertions.check(
        'the context status at the town hall is non-empty',
        status.text !== '',
        `${status.reads} read(s): ${status.text || "''"}`,
      );

      const { event } = await session.driver.request<WsRespWorldEvent>(
        { type: WsMessageType.REQ_WORLD_EVENT },
        WsMessageType.RESP_WORLD_EVENT,
      );
      assertions.check(
        'the world event answer is well-formed',
        event === null ||
          (typeof event.date === 'string' && typeof event.kind === 'number' && typeof event.text === 'string'),
        event === null ? 'no event queued' : `kind ${event.kind}: ${event.text}`,
      );

      // Non-square on purpose: a transposed grid cannot pass (13 cells × 7 rows).
      const rect: Rect = {
        x1: Math.max(0, here.x - 6),
        y1: Math.max(0, here.y - 3),
        x2: here.x + 6,
        y2: here.y + 3,
      };
      for (const surfaceType of [SurfaceType.ZONES, SurfaceType.BEAUTY]) {
        const { data } = await session.driver.request<WsRespSurfaceData>(
          { type: WsMessageType.REQ_GET_SURFACE, surfaceType, ...rect },
          WsMessageType.RESP_SURFACE_DATA,
        );
        const shape = surfaceShape(data.rows, rect);
        assertions.check(`the ${surfaceType} surface covers the requested rectangle`, shape.ok, shape.detail);
      }

      // Answered from the gateway's own facilityDimensionsCache (src/server/facility-dimensions-cache.ts),
      // not the world — holding the hall's class is all this proves.
      const visualClass = await resolveVisualClass(session, here.x, here.y);
      const { dimensions } = await session.driver.request<WsRespAllFacilityDimensions>(
        { type: WsMessageType.REQ_GET_ALL_FACILITY_DIMENSIONS },
        WsMessageType.RESP_ALL_FACILITY_DIMENSIONS,
      );
      const count = Object.keys(dimensions).length;
      assertions.check('the facility dimensions are not empty', count > 0, String(count));
      assertions.check('the facility dimensions hold the town hall class', visualClass in dimensions, visualClass);

      // A camera that differs from the saved position, so the read-back can tell it was sent.
      const hall: Tile = { x: here.x, y: here.y };
      camera = sameTile(hall, saved) ? { x: hall.x + 1, y: hall.y + 1 } : hall;
      sendCamera(session, camera.x, camera.y);
      const after = await contextStatusAt(session, here.x, here.y);
      assertions.check('the gateway still answers after the camera update', typeof after === 'string');

      assertions.check('no gateway errors', session.driver.errors.length === 0);
    } finally {
      await logoff(session);
      // Also after a throw: once the camera moved, it is put back. Never throws.
      if (camera) await cameraReadBack(assertions, saved, camera);
    }
    return report('world-readers', assertions, [], session);
  },
};

/** One page of the directory tree, by ref — the gateway rebuilds the legacy URL itself. */
async function readDirectory(session: LiveSession, ref: DirectoryRef): Promise<DirectoryPage> {
  const response = await session.driver.request<WsRespSearchMenuDirectory>(
    { type: WsMessageType.REQ_SEARCH_MENU_DIRECTORY, ref },
    WsMessageType.RESP_SEARCH_MENU_DIRECTORY,
  );
  return response.page;
}

/**
 * The directory descent below the town list: town page -> Facilities -> a kind -> a
 * facility card, then on into the company and tycoon branches — the first row's company
 * in the town, its owner's companies, that company's facility kinds, the first kind. Each
 * step follows a row the previous page listed, so none is empty by construction. Read-only, so no Survival-log probe (doc/E2E-POLICY.md §5 scopes the probe
 * to mutations).
 *
 * An empty kind list or an empty facility list fails here rather than being excused as an
 * environment quirk: Helartia is the primary account's own town and has facilities by
 * construction.
 */
const directoryBrowse: Flow = {
  name: 'directory-browse',
  what: 'town list -> town page -> Facilities -> first kind -> first facility card -> the company\'s town page -> its owner\'s companies -> that company\'s kinds -> first kind',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const town = await findTown(session, GOVERNED_TOWN);
      assertions.check(
        'the town list carries the cache path — RenderTown.inc:6',
        town.path !== '',
        town.path || '(empty)',
      );
      if (town.path === '') return report('directory-browse', assertions, [], session);

      const townPage = await readDirectory(session, {
        kind: 'town', path: town.path, classId: town.classId,
      });
      assertions.check(
        'the town page names the town, not Unknown Town',
        townPage.kind === 'town' && townPage.town.name === GOVERNED_TOWN,
        townPage.kind === 'town' ? townPage.town.name : townPage.kind,
      );
      if (townPage.kind !== 'town' || townPage.town.name !== GOVERNED_TOWN) {
        return report('directory-browse', assertions, [], session);
      }

      const facilities = await readDirectory(session, { kind: 'town-facilities', town: town.name });
      const kinds = facilities.kind === 'folder' ? facilities.items : [];
      assertions.check('the town lists at least one facility kind', kinds.length > 0, `${kinds.length} kinds`);
      if (kinds.length === 0) return report('directory-browse', assertions, [], session);

      const folder = await readDirectory(session, {
        kind: 'town-facility-kind', town: town.name, facKind: kinds[0],
      });
      const rows = folder.kind === 'facility-list' ? folder.facilities : [];
      assertions.check(`"${kinds[0]}" lists at least one facility`, rows.length > 0, `${rows.length} rows`);
      assertions.check(
        'every row names the owning company — BrowseTownFacFolder.asp:53 ShowCompany = true',
        rows.length > 0 && rows.every(r => r.company !== null),
        rows.filter(r => r.company === null).length + ' rows without a company',
      );
      if (rows.length === 0) return report('directory-browse', assertions, [], session);

      const card = await readDirectory(session, {
        kind: 'facility', path: rows[0].path, name: rows[0].itemName,
      });
      const facility = card.kind === 'facility' ? card.facility : null;
      assertions.check('the facility card resolved', facility !== null, rows[0].name);
      if (facility) {
        assertions.check('the card names the facility', facility.name !== '', facility.name);
        assertions.check('the card names its company', facility.company !== '', facility.company);
        assertions.check('the card carries a net profit', facility.netProfitText !== '', facility.netProfitText);
        assertions.check(
          'ROI is one of the three legacy forms — OpenFacility.asp:64-72',
          /^(Already\.|.+ years\.|Never\.)$/.test(facility.roiText),
          facility.roiText || '(empty)',
        );
      }

      const company = rows[0].company;
      if (company !== null) {
        const townCompanies = await readDirectory(session, { kind: 'town-companies', town: town.name });
        const listed = townCompanies.kind === 'folder' ? townCompanies.items : [];
        assertions.check(
          `${town.name}'s companies list "${company}" — InTownCompanies.asp`,
          listed.includes(company),
          `${listed.length} companies`,
        );
        if (!listed.includes(company)) return report('directory-browse', assertions, [], session);

        const companyPage = await readDirectory(session, { kind: 'town-company', town: town.name, company });
        const owner = companyPage.kind === 'folder' ? companyPage.ownedBy : null;
        const ownerWhat = `"${company}" names its owner — InTownCompany.asp:63-71`;
        if (owner === null && await companyPathMissing(session, company)) {
          assertions.untestable(ownerWhat, COMPANY_FILE_MISSING_REASON);
          return report('directory-browse', assertions, [], session);
        }
        assertions.check(ownerWhat, owner !== null, owner ?? '(none)');
        if (owner === null) return report('directory-browse', assertions, [], session);

        const ownerCompanies = await readDirectory(session, { kind: 'tycoon-companies', tycoon: owner });
        const owned = ownerCompanies.kind === 'folder' ? ownerCompanies.items : [];
        assertions.check(
          `${owner}'s companies list "${company}" — TycoonCompanies.asp`,
          owned.includes(company),
          `${owned.length} companies`,
        );
        if (!owned.includes(company)) return report('directory-browse', assertions, [], session);

        const tycoonCompany = await readDirectory(session, { kind: 'tycoon-company', tycoon: owner, company });
        const facKinds = tycoonCompany.kind === 'folder' ? tycoonCompany.items : [];
        assertions.check(
          `"${company}" lists at least one facility kind — TycoonCompany.asp:7, :13`,
          facKinds.length > 0,
          `${facKinds.length} kinds`,
        );
        if (facKinds.length === 0) return report('directory-browse', assertions, [], session);

        const tycoonFacs = await readDirectory(session, {
          kind: 'tycoon-facility-kind', tycoon: owner, company, facKind: facKinds[0],
        });
        const ownedRows = tycoonFacs.kind === 'facility-list' ? tycoonFacs.facilities : [];
        assertions.check(
          `"${company}" lists at least one "${facKinds[0]}" facility — TycoonFacilities.asp`,
          ownedRows.length > 0,
          `${ownedRows.length} rows`,
        );
        if (ownedRows.length === 0) return report('directory-browse', assertions, [], session);
      }

      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('directory-browse', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/** The first ranking that can be opened — depth-first, because RankingCategory nests children. */
function firstOpenableRanking(categories: RankingCategory[]): RankingCategory | undefined {
  for (const c of categories) {
    if (c.url !== '') return c;
    const hit = firstOpenableRanking(c.children ?? []);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The search menu's read-only pages: home, rankings, one ranking, a tycoon card and its
 * full profile, banks, newspapers, and the people index by letter (the one-bucket prefix
 * path in `searchPeople`). Read-only, so no Survival-log probe.
 *
 * The profiles are read for a tycoon other than the session's own — the own branch of
 * `resolveTycoon` answers with the gateway's name — and never assert the echoed name
 * (`RenderTycoon.asp:55` renders the request's `Tycoon`). Banks and newspapers are checked
 * well-formed, their count in the detail; an empty one ends UNTESTABLE (#1188) — a page that
 * lists nothing proves only that it answered.
 */
const searchMenuRead: Flow = {
  name: 'search-menu-read',
  what: 'search home -> rankings -> one ranking -> a tycoon card and full profile -> banks -> newspapers -> people by letter',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const home = await session.driver.request<WsRespSearchMenuHome>(
        { type: WsMessageType.REQ_SEARCH_MENU_HOME },
        WsMessageType.RESP_SEARCH_MENU_HOME,
      );
      assertions.check('the search home lists at least one tile', home.categories.length > 0, `${home.categories.length} tiles`);

      const rankings = await session.driver.request<WsRespSearchMenuRankings>(
        { type: WsMessageType.REQ_SEARCH_MENU_RANKINGS },
        WsMessageType.RESP_SEARCH_MENU_RANKINGS,
      );
      assertions.check(
        'the rankings list at least one ranking',
        rankings.categories.length > 0,
        `${rankings.categories.length} rankings`,
      );

      const ranking = firstOpenableRanking(rankings.categories);
      assertions.check('some ranking carries a url', ranking !== undefined, ranking?.label ?? '(none)');
      if (ranking) {
        const detail = await session.driver.request<WsRespSearchMenuRankingDetail>(
          { type: WsMessageType.REQ_SEARCH_MENU_RANKING_DETAIL, rankingPath: ranking.url },
          WsMessageType.RESP_SEARCH_MENU_RANKING_DETAIL,
        );
        assertions.check('the ranking detail has a title', detail.title.trim() !== '', detail.title || '(empty)');
        assertions.check(
          'the ranking detail lists at least one row',
          detail.entries.length > 0,
          `${detail.entries.length} rows`,
        );

        const tycoon = detail.entries.find(e => !sameAccount(e.name, PRIMARY_ACCOUNT))?.name;
        assertions.check(`the ranking lists a tycoon other than ${PRIMARY_ACCOUNT.username}`, tycoon !== undefined, tycoon ?? '(none)');
        if (tycoon !== undefined) {
          const card = await session.driver.request<WsRespSearchMenuTycoonProfile>(
            { type: WsMessageType.REQ_SEARCH_MENU_TYCOON_PROFILE, tycoonName: tycoon },
            WsMessageType.RESP_SEARCH_MENU_TYCOON_PROFILE,
          );
          assertions.check(
            `the ${tycoon} card carries a level — RenderTycoon.asp:103`,
            card.profile.level !== 'Unknown',
            card.profile.level,
          );
          const full = await session.driver.request<WsRespSearchMenuTycoonFullProfile>(
            { type: WsMessageType.REQ_SEARCH_MENU_TYCOON_FULL_PROFILE, tycoonName: tycoon },
            WsMessageType.RESP_SEARCH_MENU_TYCOON_FULL_PROFILE,
            TIMEOUTS.profilePage,
          );
          assertions.check(
            `the ${tycoon} full profile names a current level`,
            full.data.currentLevelName.trim() !== '',
            full.data.currentLevelName || '(empty)',
          );
        }
      }

      const banks = await session.driver.request<WsRespSearchMenuBanks>(
        { type: WsMessageType.REQ_SEARCH_MENU_BANKS },
        WsMessageType.RESP_SEARCH_MENU_BANKS,
      );
      assertions.check(
        'the banks list is well-formed (reachability only)',
        Array.isArray(banks.banks) && banks.banks.every(b => b.name !== ''),
        `${banks.banks.length} banks`,
      );
      if (banks.banks.length === 0) {
        assertions.untestable('a bank is listed', '0 banks — Banks.asp lists none on this world');
      }

      const papers = await session.driver.request<WsRespSearchMenuNewspapers>(
        { type: WsMessageType.REQ_SEARCH_MENU_NEWSPAPERS },
        WsMessageType.RESP_SEARCH_MENU_NEWSPAPERS,
      );
      assertions.check(
        'the newspapers list is well-formed (reachability only) — Newspapers.asp:61-62',
        Array.isArray(papers.newspapers) && papers.newspapers.every(p => p.paperName !== ''),
        `${papers.newspapers.length} newspapers`,
      );
      if (papers.newspapers.length === 0) {
        assertions.untestable(
          'a newspaper is listed',
          '0 newspapers — Newspapers.asp:61-62 lists none on this world',
        );
      }

      const letter = PRIMARY_ACCOUNT.username.charAt(0).toUpperCase();
      const people = await session.driver.request<WsRespSearchMenuPeopleSearch>(
        { type: WsMessageType.REQ_SEARCH_MENU_PEOPLE_SEARCH, searchStr: letter, mode: 'prefix' },
        WsMessageType.RESP_SEARCH_MENU_PEOPLE_SEARCH,
      );
      assertions.check(
        `the "${letter}" index lists ${PRIMARY_ACCOUNT.username}`,
        people.results.some(r => sameAccount(r, PRIMARY_ACCOUNT)),
        `${people.results.length} results`,
      );

      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('search-menu-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/** Send `REQ_SWITCH_COMPANY`; never throws — a `RESP_ERROR` or timeout becomes `ok: false`. */
async function trySwitch(session: LiveSession, company: CompanyInfo): Promise<{ ok: boolean; detail: string }> {
  try {
    await session.driver.request<WsRespRdoResult>(
      { type: WsMessageType.REQ_SWITCH_COMPANY, company },
      WsMessageType.RESP_RDO_RESULT,
      TIMEOUTS.login,
    );
    return { ok: true, detail: 'RESP_RDO_RESULT' };
  } catch (err: unknown) {
    const prefix = err instanceof WsDriverError ? `RESP_ERROR (code ${err.code}): ` : '';
    return { ok: false, detail: prefix + toErrorMessage(err) };
  }
}

/** One town-hall read recorded as a check; never throws. */
async function hallRead(
  session: LiveSession,
  town: { x: number; y: number },
  visualClass: string,
  assertions: Assertions,
  label: string,
): Promise<void> {
  try {
    const details = await readBuildingDetails(session, town.x, town.y, visualClass);
    assertions.check(label, details !== undefined, details?.templateName ?? '(no details)');
  } catch (err: unknown) {
    assertions.check(label, false, toErrorMessage(err));
  }
}

/** One Lobby user-list read recorded as a check; never throws. */
async function userListCheck(
  session: LiveSession,
  assertions: Assertions,
  label: string,
  holds: (users: ChatUser[]) => boolean,
): Promise<void> {
  try {
    const users = await readChatUsers(session);
    assertions.check(label, holds(users), users.map(u => u.name).join(', ') || '(empty)');
  } catch (err: unknown) {
    assertions.check(label, false, toErrorMessage(err));
  }
}

/**
 * Live drive of the company list's Political Offices half (#1142): switch into the Mayor of
 * the governed town, read the world, switch back, read again.
 *
 * Side effects are session-only: the Interface Server drops a ClientView when its socket
 * closes (`TClientView.OnDisconnect`, `Interface Server/InterfaceServer.pas:1799-1813`). The
 * switch reply carries no identity (`result: ''` plus the position), and the identity is not
 * proven by `GetAllCompaniesCount` / `GetAllCompanies`, which walk the MasterRole
 * (`Kernel/Kernel.pas:10972-10992`). It is proven by the Lobby user list (#1188): the role
 * ClientView logs on under the role name (`Interface Server/InterfaceServer.pas:3238`) and
 * `GetUserList` lists clients by that name (`:3342-3358`) — the role after the switch,
 * SPO_test3 after the switch back. A role already listed before the switch cannot tell this
 * session's switch apart, so that step ends UNTESTABLE.
 */
const companySwitch: Flow = {
  name: 'company-switch',
  what: 'company list -> switch to Mayor of <town> -> town hall read -> switch back -> town hall read',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const wanted = `Mayor of ${GOVERNED_TOWN}`.toLowerCase();
      const role = session.companies.find(c => (c.ownerRole ?? '').toLowerCase() === wanted);
      const listed = session.companies.map(c => `${c.name} [${c.ownerRole ?? ''}]`).join(', ') || '(empty)';
      assertions.check(`the company list holds the Mayor of ${GOVERNED_TOWN} entry`, role !== undefined, listed);
      if (!role) return report('company-switch', assertions, [], session);

      const town = await findTown(session, GOVERNED_TOWN);
      const visualClass = await resolveVisualClass(session, town.x, town.y);

      const roleName = role.ownerRole ?? '';
      const namesRole = (users: ChatUser[]): boolean => users.some(u => sameName(u.name, roleName));
      const roleLabel =
        `the Lobby user list names ${roleName} — the role ClientView logged on under the role name ` +
        '(Interface Server/InterfaceServer.pas:3238, :3342-3358)';
      let before: ChatUser[] | undefined;
      try {
        before = await readChatUsers(session);
      } catch (err: unknown) {
        assertions.check('the Lobby user list answers before the switch', false, toErrorMessage(err));
      }

      let back: { ok: boolean; detail: string };
      try {
        const there = await trySwitch(session, role);
        assertions.check('the switch to the role answers RESP_RDO_RESULT, not RESP_ERROR', there.ok, there.detail);
        if (there.ok) {
          await hallRead(
            session,
            town,
            visualClass,
            assertions,
            'a world read answers on the role ClientView (REQ_BUILDING_DETAILS at the town hall)',
          );
          if (before !== undefined && namesRole(before)) {
            assertions.untestable(
              roleLabel,
              'the role was already listed before the switch — the list cannot tell this session’s switch apart',
            );
          } else if (before !== undefined) {
            await userListCheck(session, assertions, roleLabel, namesRole);
          }
        }
      } finally {
        back = await trySwitch(session, session.company);
      }
      assertions.check('the switch back to the own company answers RESP_RDO_RESULT', back.ok, back.detail);
      if (back.ok) {
        await hallRead(session, town, visualClass, assertions, 'the same world read answers after switching back');
        await userListCheck(session, assertions, 'the Lobby user list names SPO_test3 after switching back', users =>
          users.some(u => isSelf(u.name)),
        );
      }

      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('company-switch', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * One Empire panel tab read. A dead page does not throw at the gateway — it answers the neutral
 * default with `cacheUnavailable: true` — so this helper throws on it, and on a missing `data`.
 */
async function readProfileTab<R extends { data?: { cacheUnavailable?: boolean } }>(
  session: LiveSession,
  req: WsMessageType,
  resp: WsMessageType,
  page: string,
): Promise<NonNullable<R['data']>> {
  const answer = await session.driver.request<{ type: WsMessageType } & R>({ type: req }, resp);
  const data = answer.data;
  if (!data) throw new Error(`${page} answered without data`);
  if (data.cacheUnavailable) {
    throw new Error(`${page} answered cacheUnavailable — the page failed or ObjValid=false`);
  }
  return data;
}

const PAGE_CURRICULUM = 'NewTycoon/TycoonCurriculum.asp';
const PAGE_BANK = 'NewTycoon/TycoonBankAccount.asp';
const PAGE_PROFITLOSS = 'NewTycoon/TycoonProfitAndLoses.asp';
const PAGE_COMPANIES = 'NewLogon/chooseCompany.asp';
const PAGE_AUTOCONNECTIONS = 'NewTycoon/TycoonAutoConnections.asp';
const PAGE_POLICY = 'NewTycoon/TycoonPolicy.asp';

/** The bank tab, failing on `cacheUnavailable` — what a bank write restores against. */
export function readBank(session: LiveSession): Promise<BankAccountData> {
  return readProfileTab<WsRespProfileBank>(
    session, WsMessageType.REQ_PROFILE_BANK, WsMessageType.RESP_PROFILE_BANK, PAGE_BANK,
  );
}

/** The initial suppliers tab, failing on `cacheUnavailable`. */
export function readAutoConnections(session: LiveSession): Promise<AutoConnectionsData> {
  return readProfileTab<WsRespProfileAutoConnections>(
    session, WsMessageType.REQ_PROFILE_AUTOCONNECTIONS, WsMessageType.RESP_PROFILE_AUTOCONNECTIONS, PAGE_AUTOCONNECTIONS,
  );
}

/** The strategy tab, failing on `cacheUnavailable`. */
export function readPolicy(session: LiveSession): Promise<PolicyData> {
  return readProfileTab<WsRespProfilePolicy>(
    session, WsMessageType.REQ_PROFILE_POLICY, WsMessageType.RESP_PROFILE_POLICY, PAGE_POLICY,
  );
}

/** The curriculum tab, failing on `cacheUnavailable`. */
export function readCurriculum(session: LiveSession): Promise<CurriculumData> {
  return readProfileTab<WsRespProfileCurriculum>(
    session, WsMessageType.REQ_PROFILE_CURRICULUM, WsMessageType.RESP_PROFILE_CURRICULUM, PAGE_CURRICULUM,
  );
}

function readProfitLoss(session: LiveSession): Promise<ProfitLossData> {
  return readProfileTab<WsRespProfileProfitLoss>(
    session, WsMessageType.REQ_PROFILE_PROFITLOSS, WsMessageType.RESP_PROFILE_PROFITLOSS, PAGE_PROFITLOSS,
  );
}

function readCompanies(session: LiveSession): Promise<CompaniesData> {
  return readProfileTab<WsRespProfileCompanies>(
    session, WsMessageType.REQ_PROFILE_COMPANIES, WsMessageType.RESP_PROFILE_COMPANIES, PAGE_COMPANIES,
  );
}

const POLICY_STATUSES = [0, 1, 2];

/**
 * Read-only drive of the Empire panel's profile & finance tabs (#1141). Two traps shape it:
 * a dead page does not throw — it answers the neutral default with `cacheUnavailable: true`,
 * which every read here fails on; and the profile's `name` is the gateway's own session name,
 * so only `levelName` (parsed from `NewTycoon/TycoonCurriculum.asp`) proves the page was read.
 * A missing strategy row for the second account passes: it means both sides are neutral
 * (`Kernel/Kernel.pas:11348`). Each read runs on its own, so the artifact names every dead page.
 */
const profileRead: Flow = {
  name: 'profile-read',
  what: 'profile -> curriculum -> bank -> profit & loss -> companies -> company P&L -> initial suppliers -> strategy',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    const attempt = async (page: string, read: () => Promise<void>): Promise<void> => {
      try {
        await read();
      } catch (err: unknown) {
        assertions.check(`${page} answered without cacheUnavailable`, false, toErrorMessage(err));
      }
    };
    try {
      await attempt(PAGE_CURRICULUM, async () => {
        const answer = await session.driver.request<WsRespGetProfile>(
          { type: WsMessageType.REQ_GET_PROFILE },
          WsMessageType.RESP_GET_PROFILE,
        );
        const levelName = answer.profile?.levelName ?? '';
        assertions.check(
          `the profile carries a level name parsed from ${PAGE_CURRICULUM}`,
          levelName.trim() !== '',
          levelName || '(empty)',
        );
      });

      await attempt(PAGE_CURRICULUM, async () => {
        const cv = await readCurriculum(session);
        assertions.check(
          'the curriculum names a level',
          cv.currentLevelName.trim() !== '' && cv.currentLevelName !== 'Unknown' && Number.isInteger(cv.currentLevel),
          `${cv.currentLevel} ${cv.currentLevelName || '(empty)'}`,
        );
      });

      await attempt(PAGE_BANK, async () => {
        const bank = await readBank(session);
        assertions.check('the bank page has a balance', /^-?\d+$/.test(bank.balance), bank.balance || '(empty)');
      });

      await attempt(PAGE_PROFITLOSS, async () => {
        const pl = await readProfitLoss(session);
        const lines = pl.root.children?.length ?? 0;
        assertions.check('profit & loss has at least one line', lines > 0, `${lines} lines`);
      });

      let company: CompaniesData['companies'][number] | undefined;
      await attempt(PAGE_COMPANIES, async () => {
        const list = await readCompanies(session);
        company = list.companies.find(c => c.name === session.company.name);
        assertions.check(
          `the companies list holds ${session.company.name}`,
          company !== undefined,
          `${list.companies.length} companies`,
        );
      });

      const found = company;
      if (found === undefined) {
        assertions.check('the company P&L parses', false, 'no company to read');
      } else {
        await attempt('CompanyPage.asp', async () => {
          const cpl = await session.driver.request<WsRespProfileCompanyProfitLoss>(
            {
              type: WsMessageType.REQ_PROFILE_COMPANY_PROFITLOSS,
              companyName: found.name,
              cluster: found.cluster,
            },
            WsMessageType.RESP_PROFILE_COMPANY_PROFITLOSS,
          );
          const lines = cpl.data?.root.children?.length ?? 0;
          const ok = cpl.data != null && cpl.error === undefined && lines > 0;
          if (!ok && await companyPathMissing(session, found.name)) {
            assertions.untestable('the company P&L parses', COMPANY_FILE_MISSING_REASON);
          } else {
            assertions.check('the company P&L parses', ok, cpl.error ?? `${lines} lines`);
          }
        });
      }

      await attempt(PAGE_AUTOCONNECTIONS, async () => {
        const ac = await readAutoConnections(session);
        assertions.check(
          'initial suppliers parse (may list none)',
          Array.isArray(ac.fluids) && ac.fluids.every(f => f.fluidId !== ''),
          `${ac.fluids.length} fluids`,
        );
      });

      await attempt(PAGE_POLICY, async () => {
        const policy = await readPolicy(session);
        assertions.check('the strategy page parses', Array.isArray(policy.policies), `${policy.policies.length} rows`);
        const row = policy.policies.find(p => sameAccount(p.tycoonName, SECONDARY_ACCOUNT));
        // No row passes: both sides are neutral — a PolTycoon row is written only when a side
        // is not pstNeutral (Kernel/Kernel.pas:11348).
        assertions.check(
          row
            ? `the ${SECONDARY_ACCOUNT.username} strategy row carries a status`
            : `no ${SECONDARY_ACCOUNT.username} strategy row`,
          row === undefined || (POLICY_STATUSES.includes(row.yourPolicy) && POLICY_STATUSES.includes(row.theirPolicy)),
          row
            ? `yours ${row.yourPolicy}, theirs ${row.theirPolicy}`
            : 'both sides neutral (Kernel/Kernel.pas:11348: a PolTycoon row is written only when a side is not pstNeutral)',
        );
      });

      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('profile-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/** `TPolicyStatus = (pstAlly, pstNeutral, pstEnemy)` — Kernel/Kernel.pas:2267. */
const PST_NEUTRAL = 1;
const PST_ENEMY = 2;

/** The read-back half of a round trip: a transient dead page keeps the bounded poll going. */
function tolerantRead(read: () => Promise<string | undefined>): () => Promise<string | undefined> {
  return async () => {
    try {
      return await read();
    } catch {
      return undefined;
    }
  };
}

/** The Survival line carries the server's spelling of the tycoon, so compare case-insensitively. */
function lineHas(line: string, expected: string): boolean {
  return line.toLowerCase().includes(expected.toLowerCase());
}

/** One round trip, a throw (unreadable original, `cacheUnavailable`) folded into a FAIL. */
async function roundTripProbe(
  ctx: FlowContext,
  url: string,
  spec: RoundTripSpec,
): Promise<ProbeResult> {
  try {
    return await runRoundTrip(spec, ctx.lock, openLogWindow, url, { now: ctx.now, sleep: ctx.sleep });
  } catch (err: unknown) {
    return probeFailure(spec, err);
  }
}

/** SPO_test3's row towards the secondary account as `"<yours>:<theirs>"`, or `"none"` — no row, both neutral. */
async function policyTowardsSecondary(session: LiveSession): Promise<string> {
  const policy = await readPolicy(session);
  const row = policy.policies.find(p => sameAccount(p.tycoonName, SECONDARY_ACCOUNT));
  return row ? `${row.yourPolicy}:${row.theirPolicy}` : 'none';
}

/** The status a policy value asks SPO_test3 to hold: `"none"` is neutral. */
function policyStatus(value: string): number {
  return value === 'none' ? PST_NEUTRAL : Number(value.split(':')[0]);
}

/**
 * The strategy towards the secondary account, change-then-undo (#1146). GATE_ONLY: every `RDOSetPolicyStatus`
 * broadcasts a world event naming the secondary account (Kernel/Kernel.pas:11790-11800). The restore from "no
 * row" expects the row gone — a neutral row left behind is not the original.
 */
const policyRoundTrip: Flow = {
  name: 'policy-roundtrip',
  what: `strategy towards ${SECONDARY_ACCOUNT.username}: read -> set another status -> read back -> restore -> read back`,
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const url = ctx.survivalLogUrl ?? (await findCurrentSurvivalLog());
      const read = (): Promise<string> => policyTowardsSecondary(session);
      probes.push(
        await roundTripProbe(ctx, url, {
          what: `${PRIMARY_ACCOUNT.username}'s strategy towards ${SECONDARY_ACCOUNT.username} ("none" = no row, both neutral)`,
          member: 'RDOSetPolicyStatus',
          read,
          testValue: original => {
            const [yours, theirs] =
              original === 'none' ? [PST_NEUTRAL, PST_NEUTRAL] : original.split(':').map(Number);
            const next = yours === PST_ENEMY ? PST_NEUTRAL : PST_ENEMY;
            return next === PST_NEUTRAL && theirs === PST_NEUTRAL ? 'none' : `${next}:${theirs}`;
          },
          write: async value => {
            // `success` is ignored: the gateway answers false whenever the row disappears — every
            // restore to neutral against a neutral counterpart. The read-back is the judge.
            await session.driver.request<WsRespProfilePolicySet>(
              {
                type: WsMessageType.REQ_PROFILE_POLICY_SET,
                tycoonName: SECONDARY_ACCOUNT.username,
                status: policyStatus(value),
              },
              WsMessageType.RESP_PROFILE_POLICY_SET,
            );
          },
          proof: {
            log: {
              marker: LOG_MARKERS.RDOSetPolicyStatus,
              match: (line, written) =>
                lineHas(line, `${PRIMARY_ACCOUNT.username}, ${SECONDARY_ACCOUNT.username}, ${policyStatus(written)}`),
            },
            readBack: {
              source: `the ${SECONDARY_ACCOUNT.username} row of ${PAGE_POLICY}`,
              why:
                'the page reads the object cache, refreshed after the write (Kernel/Kernel.pas:11787-11788) ' +
                '— OB-29 lag, so the poll is bounded',
              read: tolerantRead(read),
              boundMs: TIMEOUTS.readBack,
            },
          },
        }),
      );
      assertions.check('the policy round trip proved the write and the restore', probeHeld(probes[0]), probes[0]?.note);
      return report('policy-roundtrip', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/** The company-creation dialog's cluster reads (#1142) — class-cache ASP reads, no write. */
const clusterInfoRead: Flow = {
  name: 'cluster-info-read',
  what: 'REQ_CLUSTER_INFO (first cluster) -> REQ_CLUSTER_FACILITIES (its first category)',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const cluster = CLUSTER_IDS[0];
      const { clusterInfo } = await session.driver.request<WsRespClusterInfo>(
        { type: WsMessageType.REQ_CLUSTER_INFO, clusterName: cluster },
        WsMessageType.RESP_CLUSTER_INFO,
      );
      assertions.check(
        'the cluster description is non-empty',
        clusterInfo.description.trim() !== '',
        `${cluster}: ${clusterInfo.description.length} chars`,
      );
      const folder = clusterInfo.categories[0]?.folder ?? '';
      assertions.check(
        'the cluster lists a facility category',
        folder !== '',
        folder || `${clusterInfo.categories.length} categories`,
      );
      if (folder !== '') {
        const { facilities } = await session.driver.request<WsRespClusterFacilities>(
          { type: WsMessageType.REQ_CLUSTER_FACILITIES, cluster, folder },
          WsMessageType.RESP_CLUSTER_FACILITIES,
        );
        assertions.check(
          'the category lists at least one facility',
          facilities.length > 0,
          `${facilities.length} facilities in ${folder}`,
        );
      }

      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('cluster-info-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

type AutoConnectionSwitch = 'hireTradeCenter' | 'onlyWarehouses';

const SWITCHES: Record<
  AutoConnectionSwitch,
  { on: 'hireTradeCenter' | 'onlyWarehouses'; off: 'dontHireTradeCenter' | 'dontOnlyWarehouses'; onMember: string; offMember: string }
> = {
  hireTradeCenter: {
    on: 'hireTradeCenter',
    off: 'dontHireTradeCenter',
    onMember: 'RDOHireTradeCenter',
    offMember: 'RDODontHireTradeCenter',
  },
  onlyWarehouses: {
    on: 'onlyWarehouses',
    off: 'dontOnlyWarehouses',
    onMember: 'RDOHireOnlyFromWarehouse',
    offMember: 'RDODontHireOnlyFromWarehouse',
  },
};

/** `ParseGateList` (Kernel/Kernel.pas:4277, called at :11653) needs the trailing comma. */
function supplierGate(r: ConnectionSearchResult): string {
  return `${r.x},${r.y},`;
}

/**
 * One REQ_PROFILE_AUTOCONNECTION_ACTION, as the initial-suppliers page sends it. `success` is
 * ignored; the page read-back is the judge (doc/E2E-POLICY.md §5).
 */
async function autoConnectionAction(
  session: LiveSession,
  action: AutoConnectionActionType,
  fluidId: string,
  suppliers?: string,
): Promise<void> {
  await session.driver.request<WsRespProfileAutoConnectionAction>(
    { type: WsMessageType.REQ_PROFILE_AUTOCONNECTION_ACTION, action, fluidId, suppliers },
    WsMessageType.RESP_PROFILE_AUTOCONNECTION_ACTION,
  );
}

/**
 * The initial suppliers, change-then-undo (#1146): flip the Trade Center switch, flip the
 * only-warehouses switch on a storable fluid, then add one default supplier not already listed
 * and delete it. None of these members broadcasts (Kernel/Kernel.pas:11679-11766).
 */
const autoConnectionRoundTrip: Flow = {
  name: 'autoconnection-roundtrip',
  what: 'initial suppliers: flip Trade Center -> flip only-warehouses -> add a supplier -> delete it',
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      let initial: AutoConnectionsData;
      try {
        initial = await readAutoConnections(session);
      } catch (err: unknown) {
        assertions.check(`${PAGE_AUTOCONNECTIONS} answered without cacheUnavailable`, false, toErrorMessage(err));
        return report('autoconnection-roundtrip', assertions, probes, session);
      }
      if (initial.fluids.length === 0) {
        for (const half of ['the Trade Center flip', 'the only-warehouses flip', 'the add/delete supplier half']) {
          assertions.untestable(half, 'the initial suppliers page lists no fluid');
        }
        return report('autoconnection-roundtrip', assertions, probes, session);
      }
      const url = ctx.survivalLogUrl ?? (await findCurrentSurvivalLog());
      const fluidOf = async (fluidId: string) =>
        (await readAutoConnections(session)).fluids.find(f => f.fluidId === fluidId);
      const act = (action: AutoConnectionActionType, fluidId: string, suppliers?: string): Promise<void> =>
        autoConnectionAction(session, action, fluidId, suppliers);
      const readBackWhy =
        `${PAGE_AUTOCONNECTIONS} reads the object cache (NewTycoon/TycoonAutoConnections.asp:3,12,29), ` +
        'refreshed by the member with BackgroundInvalidateCache — OB-29 lag, so the poll is bounded';

      const flip = async (fluid: AutoConnectionFluid, key: AutoConnectionSwitch): Promise<void> => {
        const sw = SWITCHES[key];
        const read = async (): Promise<string | undefined> => {
          const f = await fluidOf(fluid.fluidId);
          return f ? String(f[key]) : undefined;
        };
        const probe = await roundTripProbe(ctx, url, {
          what: `${PRIMARY_ACCOUNT.username}'s ${key} switch on ${fluid.fluidId}`,
          member: fluid[key] ? sw.offMember : sw.onMember,
          read,
          testValue: original => (original === 'true' ? 'false' : 'true'),
          write: value => act(value === 'true' ? sw.on : sw.off, fluid.fluidId),
          proof: {
            log: {
              marker: LOG_MARKERS[fluid[key] ? sw.offMember : sw.onMember],
              match: line => lineHas(line, `${PRIMARY_ACCOUNT.username}, ${fluid.fluidId}`),
            },
            readBack: {
              source: `${fluid.fluidId}.${key} on ${PAGE_AUTOCONNECTIONS}`,
              why: readBackWhy,
              read: tolerantRead(read),
              boundMs: TIMEOUTS.readBack,
            },
          },
        });
        probes.push(probe);
        assertions.check(`the ${key} flip proved the write and the restore`, probeHeld(probe), probe.note);
      };

      await flip(initial.fluids[0], 'hireTradeCenter');

      // The checkbox is rendered only under Storable (TycoonAutoConnections.asp:103-104): a
      // non-storable fluid could never read the flag back.
      const storable = initial.fluids.find(f => f.storable === true);
      if (storable) {
        await flip(storable, 'onlyWarehouses');
      } else {
        assertions.untestable(
          'the only-warehouses flip',
          'no storable fluid listed — the checkbox is rendered only under Storable (TycoonAutoConnections.asp:103-104)',
        );
      }

      // A supplier found the way the Add Supplier dialog finds one (SupplierSearchModal.tsx):
      // profile-level coords 0,0, the ASP default roles (TycoonSuppliesSearch.asp:29), no Trade
      // Center (:43-44), and not already listed for that fluid.
      let target: { fluid: AutoConnectionFluid; gate: string } | undefined;
      for (const fluid of initial.fluids) {
        const search = await session.driver.request<WsRespSearchConnections>(
          {
            type: WsMessageType.REQ_SEARCH_CONNECTIONS,
            buildingX: 0,
            buildingY: 0,
            fluidId: fluid.fluidId,
            direction: 'input',
            filters: { maxResults: 50, roles: rolesToMask('input', { ...ALL_CONNECTION_ROLES, exporter: false }) },
          },
          WsMessageType.RESP_SEARCH_CONNECTIONS,
        );
        const listed = new Set(fluid.suppliers.map(s => s.facilityId));
        const hit = (search.results ?? []).find(
          r => r.facilityName !== 'Trade Center' && !listed.has(supplierGate(r)),
        );
        if (hit) {
          target = { fluid, gate: supplierGate(hit) };
          break;
        }
      }
      if (!target) {
        assertions.untestable('the add/delete supplier half', 'no search result not already listed for any fluid');
        return report('autoconnection-roundtrip', assertions, probes, session);
      }

      const { fluid, gate } = target;
      const identity = `${PRIMARY_ACCOUNT.username}, ${fluid.fluidId}, ${gate}`;
      const delWindow = await openLogWindow(url);
      const read = async (): Promise<string | undefined> => {
        const f = await fluidOf(fluid.fluidId);
        if (!f) return undefined;
        return f.suppliers.some(s => s.facilityId === gate) ? 'listed' : 'absent';
      };
      const probe = await roundTripProbe(ctx, url, {
        what: `${PRIMARY_ACCOUNT.username}'s default supplier ${gate} for ${fluid.fluidId}`,
        member: 'RDOAddAutoConnection',
        read,
        testValue: () => 'listed',
        write: value => act(value === 'listed' ? 'add' : 'delete', fluid.fluidId, gate),
        proof: {
          log: { marker: LOG_MARKERS.RDOAddAutoConnection, match: line => lineHas(line, identity) },
          readBack: {
            source: `${fluid.fluidId}'s supplier list on ${PAGE_AUTOCONNECTIONS}`,
            why: readBackWhy,
            read: tolerantRead(read),
            boundMs: TIMEOUTS.readBack,
          },
        },
      });
      probes.push(probe);
      assertions.check('the supplier add proved the write and the delete', probeHeld(probe), probe.note);
      if (probe.original !== '') {
        const deleted = await awaitMarker(
          delWindow,
          {
            marker: LOG_MARKERS.RDODelAutoConnection,
            match: line => line.includes(LOG_MARKERS.RDODelAutoConnection) && lineHas(line, identity),
          },
          TIMEOUTS.logSettle,
        );
        assertions.check(
          'the delete reached the model server (Deleting initial suppliers: line)',
          deleted !== null,
          deleted ?? describeLogMiss(delWindow, `no "${LOG_MARKERS.RDODelAutoConnection}" line for ${identity}`),
        );
      }
      return report('autoconnection-roundtrip', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

// ---------------------------------------------------------------------------
// Borrow → pay off, send → send back, and the portrait upload (#1147)
// ---------------------------------------------------------------------------

/** The session's own profile. `handleGetProfile` calls `fetchTycoonProfile()` with no name. */
async function readProfile(session: LiveSession): Promise<TycoonProfileFull> {
  const answer = await session.driver.request<WsRespGetProfile>(
    { type: WsMessageType.REQ_GET_PROFILE },
    WsMessageType.RESP_GET_PROFILE,
  );
  return answer.profile;
}

/**
 * The level names `parseCurriculumHtml` (`profile-finance-handler.ts`) maps to a tier. A copy:
 * the e2e build includes only `src/e2e/**` and `src/shared/**`.
 */
export const PROFILE_LEVEL_NAMES = [
  'apprentice', 'entrepreneur', 'tycoon', 'master', 'paradigm', 'legend', 'beyondlegend', 'legendx',
];

/**
 * Why `RDOSendMoney` could refuse `account` as a receiver, or `null`. The limits are
 * `NobPoints < 50` and `Level.Tier < 6` (Kernel/Kernel.pas:11499). The parser leaves
 * `levelTier` 0 on a missing or unmapped level image and `fetchTycoonProfile` carries no
 * `cacheUnavailable`, so a profile without a known level name proves nothing.
 */
export function receiverLimitRefusal(account: E2eAccount, profile: TycoonProfileFull): string | null {
  const who = account.username;
  const level = (profile.levelName ?? '').trim().toLowerCase();
  if (level === '') return `${who}'s profile has no level name — the page was not read`;
  if (!PROFILE_LEVEL_NAMES.includes(level)) {
    return `${who}'s level "${profile.levelName}" is not one parseCurriculumHtml maps to a tier`;
  }
  if (profile.nobPoints >= 50) return `${who} has ${profile.nobPoints} nobility points (≥ 50, Kernel/Kernel.pas:11499)`;
  if (profile.levelTier >= 6) return `${who} is at level tier ${profile.levelTier} (≥ 6, Kernel/Kernel.pas:11499)`;
  return null;
}

const BORROW_AMOUNT = '1';

/**
 * Pair the listed loans with the baseline, as a multiset: first on bank, date and amount, then
 * on bank and date alone — a yearly slice lowers an old loan's amount without making it new.
 */
function matchLoans(baseline: LoanInfo[], now: LoanInfo[]): { added: LoanInfo[]; gone: number } {
  const left = [...baseline];
  const take = (key: (l: LoanInfo) => string, loan: LoanInfo): boolean => {
    const i = left.findIndex(b => key(b) === key(loan));
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  };
  const exact = (l: LoanInfo): string => `${l.bank}|${l.date}|${l.amount}`;
  const loose = (l: LoanInfo): string => `${l.bank}|${l.date}`;
  const unmatched = now.filter(l => !take(exact, l));
  const added = unmatched.filter(l => !take(loose, l));
  return { added, gone: left.length };
}

/** `new=<amounts of loans not in the baseline, or none> gone=<baseline loans no longer listed>`. */
export function loanDelta(baseline: LoanInfo[], now: LoanInfo[]): string {
  const { added, gone } = matchLoans(baseline, now);
  const amounts = added.map(l => l.amount).sort();
  return `new=${amounts.length > 0 ? amounts.join(',') : 'none'} gone=${gone}`;
}

/** The loan the flow took: not in the baseline, and of the borrowed amount. */
export function newLoan(baseline: LoanInfo[], now: LoanInfo[]): LoanInfo | undefined {
  return matchLoans(baseline, now).added.find(l => l.amount === BORROW_AMOUNT);
}

/**
 * Borrow $1, then pay that loan off (#1147). GATE_ONLY: `TBank.AskLoan` broadcasts the loan to
 * every online tycoon (Kernel/Kernel.pas:8849-8859). `RDOPayOff` pays only when
 * `Loan.Amount < Budget - AprFee` (Kernel/Kernel.pas:11572), so the flow borrows nothing unless
 * the balance is above 0. A refused payoff throws in the restore: the pending restore is kept.
 */
const bankBorrowPayoff: Flow = {
  name: 'bank-borrow-payoff',
  what: 'bank: balance > 0 -> borrow $1 -> AskLoan: line + the loan listed -> pay it off -> the loan list as before',
  mutates: true,
  run: async ctx => {
    const name = 'bank-borrow-payoff';
    const ME = PRIMARY_ACCOUNT.username;
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const baseline = await readBank(session);
      if (!(Number(baseline.balance) > 0)) {
        assertions.untestable(
          'the borrow → pay off round trip',
          `balance ${baseline.balance} is not > 0 — RDOPayOff pays only if Loan.Amount < Budget - AprFee ` +
            '(Kernel/Kernel.pas:11572); nothing borrowed',
        );
        return report(name, assertions, probes, session);
      }
      const url = ctx.survivalLogUrl ?? (await findCurrentSurvivalLog());
      const n = baseline.loans.length;
      const bankAction = (msg: { action: 'borrow' | 'payoff'; amount?: string; loanIndex?: number }) =>
        session.driver.request<WsRespProfileBankAction>(
          { type: WsMessageType.REQ_PROFILE_BANK_ACTION, ...msg },
          WsMessageType.RESP_PROFILE_BANK_ACTION,
          TIMEOUTS.login,
        );
      const read = async (): Promise<string> => loanDelta(baseline.loans, (await readBank(session)).loans);
      probes.push(
        await roundTripProbe(ctx, url, {
          what:
            `${ME}'s $${BORROW_AMOUNT} loan from the main bank — pay off the $${BORROW_AMOUNT} loan not among ` +
            `the ${n} loans listed before (baseline indices 0..${n - 1})`,
          member: 'RDOAskLoan',
          read: tolerantRead(read),
          testValue: original => {
            if (original !== 'new=none gone=0') throw new Error(`the loan list moved before the borrow: ${original}`);
            return `new=${BORROW_AMOUNT} gone=0`;
          },
          write: async () => {
            // TBank.LoanApproved (Kernel/Kernel.pas:8909) accepts any Amount > 0 within EstimateLoan.
            const answer = await bankAction({ action: 'borrow', amount: BORROW_AMOUNT });
            if (answer.result?.success !== true) throw new Error(`borrow refused: ${answer.result?.message ?? '(no result)'}`);
          },
          restore: async () => {
            const loan = newLoan(baseline.loans, (await readBank(session)).loans);
            if (!loan) return;
            const answer = await bankAction({ action: 'payoff', loanIndex: loan.loanIndex });
            if (answer.result?.success !== true) {
              throw new Error(`payoff of loan ${loan.loanIndex} refused: ${answer.result?.message ?? '(no result)'}`);
            }
          },
          proof: {
            log: {
              marker: LOG_MARKERS.RDOAskLoan,
              // ' AskLoan: ' + Name + ', $' + AmountStr (Kernel/Kernel.pas:11455); endsWith keeps $1 from matching $10.
              match: line => line.trim().toLowerCase().endsWith(`askloan: ${ME}, $${BORROW_AMOUNT}`.toLowerCase()),
            },
            readBack: {
              source: `the loan list on ${PAGE_BANK}`,
              why:
                'the page re-reads the tycoon cache that RDOAskLoan / RDOPayOff invalidate ' +
                '(Kernel/Kernel.pas:11466, :11593) — OB-29 lag, so the poll is bounded',
              read: tolerantRead(read),
              boundMs: TIMEOUTS.readBack,
            },
          },
        }),
      );
      assertions.check('the loan round trip proved the borrow and the payoff', probeHeld(probes[0]), probes[0]?.note);
      return report(name, assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/** Every transfer marker the flow writes starts with this — the sweep and the cleanup match it. */
const TRANSFER_MARKER = 'e2e-send-';

/**
 * The ids of the transfer notices in `folder` from (Inbox) or to (Sent) `counterpart` whose body
 * carries `needle`. The subject is localised (`mtidMsgMoneyTransfer`) and the same for every
 * transfer, so only the body's refresh URL — `…&Reason=<reason>&Amount=…`
 * (Kernel/Kernel.pas:11521-11529) — tells one transfer from another.
 */
async function noticeIds(
  session: LiveSession,
  folder: MailFolder,
  counterpart: string,
  needle: string,
): Promise<Set<string>> {
  const who = counterpart.toLowerCase();
  const ids = new Set<string>();
  for (const m of await listFolder(session, folder)) {
    const party = folder === 'Sent' ? m.to : m.from;
    if (!party.toLowerCase().includes(who)) continue;
    const { message } = await session.driver.request<WsRespMailMessage>(
      { type: WsMessageType.REQ_MAIL_READ_MESSAGE, folder, messageId: m.messageId },
      WsMessageType.RESP_MAIL_MESSAGE,
    );
    if ((message.body ?? []).join('\n').includes(needle)) ids.add(m.messageId);
  }
  return ids;
}

const transferLabel = `"Reason=${TRANSFER_MARKER}" transfer notice`;

/** Delete every flow transfer notice from one folder. Never throws. */
async function purgeTransferFolder(
  session: LiveSession,
  folder: MailFolder,
  counterpart: string,
  sleep: (ms: number) => Promise<void>,
): Promise<FlowCheck> {
  let ids: Set<string>;
  try {
    ids = await noticeIds(session, folder, counterpart, `Reason=${TRANSFER_MARKER}`);
  } catch (err: unknown) {
    return { what: `${transferLabel} removed from ${session.account.username}'s ${folder}`, ok: false, detail: toErrorMessage(err) };
  }
  return purgeFolder(session, folder, m => ids.has(m.messageId), sleep, transferLabel);
}

/** The cleanup of one mailbox, as `purgeMailbox`: a fresh login, one check per folder, never throws. */
async function purgeTransferMailbox(
  account: E2eAccount,
  counterpart: string,
  folders: MailFolder[],
  sleep: (ms: number) => Promise<void>,
): Promise<FlowCheck[]> {
  const whatOf = (folder: MailFolder): string => `${transferLabel} removed from ${account.username}'s ${folder}`;
  const failAll = (detail: string): FlowCheck[] => folders.map(f => ({ what: whatOf(f), ok: false, detail }));
  let opened: SecondaryLogin;
  try {
    opened = account === SECONDARY_ACCOUNT ? await loginSecondary() : await login(account);
  } catch (err: unknown) {
    return failAll(toErrorMessage(err));
  }
  if ('skipped' in opened) {
    const reason = opened.skipped;
    return folders.map(f => ({
      what: whatOf(f),
      ok: false,
      skipped: reason,
      detail: `${account.username} refused at login (${reason}) — any ${transferLabel} is left in ${account.username}'s ${f}`,
    }));
  }
  const session = opened;
  try {
    await mailConnect(session);
    const checks: FlowCheck[] = [];
    for (const f of folders) checks.push(await purgeTransferFolder(session, f, counterpart, sleep));
    return checks;
  } catch (err: unknown) {
    return failAll(toErrorMessage(err));
  } finally {
    await logoff(session);
  }
}

/** Why `bank` cannot send $1, or `null` — the page mirrors `RDOSendMoney`'s clip as `maxTransfer`. */
function transferRefusal(bank: BankAccountData): string | null {
  if (bank.transferDenied) return `the page denies the transfer (${bank.transferDenied})`;
  if (bank.maxTransfer === undefined) return 'the page offers no transfer (no "You can transfer up to $…" note)';
  if (!(Number(bank.maxTransfer) >= 1)) return `the page offers at most $${bank.maxTransfer}`;
  return null;
}

async function driveSendReturn(secondary: LiveSession, ctx: FlowContext, sleep: (ms: number) => Promise<void>): Promise<FlowResult> {
  const name = 'bank-send-return';
  const ME = PRIMARY_ACCOUNT.username;
  const HIM = SECONDARY_ACCOUNT.username;
  const what = 'the send → send back round trip';
  const assertions = new Assertions();
  const probes: ProbeResult[] = [];
  const me = await login(PRIMARY_ACCOUNT);
  try {
    await mailConnect(me);
    await mailConnect(secondary);

    // RDOSendMoney clips the amount to fBudget - LoanAmount - AprFee and answers
    // ERROR_InvalidMoneyValue when that is ≤ 0 (Kernel/Kernel.pas:11507-11512, :11535); the page
    // mirrors it as "You can transfer up to $…" (NewTycoon/TycoonBankAccount.asp:116-122).
    const mine = transferRefusal(await readBank(me));
    if (mine) {
      assertions.untestable(what, `${ME} cannot send $1: ${mine}; nothing sent`);
      return report(name, assertions, probes, me);
    }
    const theirs = transferRefusal(await readBank(secondary));
    if (theirs) {
      assertions.untestable(what, `${HIM} cannot send $1 back: ${theirs}; nothing sent`);
      return report(name, assertions, probes, me);
    }
    // The :11499 receiver limits, each profile read through its own session.
    for (const [account, s] of [[PRIMARY_ACCOUNT, me], [SECONDARY_ACCOUNT, secondary]] as const) {
      const refusal = receiverLimitRefusal(account, await readProfile(s));
      if (refusal) {
        assertions.untestable(what, `${refusal}; nothing sent`);
        return report(name, assertions, probes, me);
      }
    }

    for (const [s, folder, counterpart] of [
      [me, 'Inbox', HIM], [me, 'Sent', HIM], [secondary, 'Inbox', ME], [secondary, 'Sent', ME],
    ] as const) {
      const check = await purgeTransferFolder(s, folder, counterpart, sleep);
      assertions.check(`pre-sweep: ${check.what}`, check.ok, check.detail);
    }
    if (assertions.failed) return report(name, assertions, probes, me);

    // Reason is concatenated into the URL unencoded (:11528): letters, digits and '-' only.
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '');
    const out = `${TRANSFER_MARKER}${stamp}-out`;
    const back = `${TRANSFER_MARKER}${stamp}-back`;
    const has = async (s: LiveSession, from: string, marker: string): Promise<boolean> =>
      (await noticeIds(s, 'Inbox', from, `Reason=${marker}&`)).size > 0;
    const owed = async (): Promise<string> =>
      String((await has(secondary, ME, out) ? 1 : 0) - (await has(me, HIM, back) ? 1 : 0));
    const send = (s: LiveSession, toTycoon: string, reason: string) =>
      s.driver.request<WsRespProfileBankAction>(
        { type: WsMessageType.REQ_PROFILE_BANK_ACTION, action: 'send', amount: '1', toTycoon, reason },
        WsMessageType.RESP_PROFILE_BANK_ACTION,
        TIMEOUTS.login,
      );
    let firstLegSent = false;

    probes.push(
      await roundTripProbe(ctx, ctx.survivalLogUrl ?? '', {
        what: `$1 sent by ${ME} to ${HIM} (reason ${out}) — ${HIM} owes ${ME} $1 back`,
        // No LOG_MARKERS entry: RDOSendMoney logs to a Money log the listing does not publish (:11491).
        member: 'RDOSendMoney',
        read: tolerantRead(owed),
        testValue: original => {
          if (original !== '0') throw new Error(`a transfer notice was already listed before the send: ${original}`);
          return '1';
        },
        write: async () => {
          const answer = await send(me, HIM, out);
          if (answer.result?.success !== true) throw new Error(`send refused: ${answer.result?.message ?? '(no result)'}`);
          firstLegSent = true;
        },
        restore: async () => {
          // The secondary account writes only to complete the pair: nothing to send back unless the $1 arrived.
          if (!firstLegSent && !(await has(secondary, ME, out))) return;
          const answer = await send(secondary, ME, back);
          if (answer.result?.success !== true) throw new Error(`send back refused: ${answer.result?.message ?? '(no result)'}`);
        },
        proof: {
          readBack: {
            source:
              `the transfer notification (Reason=<marker> in its refresh URL, Kernel/Kernel.pas:11521-11529) in ` +
              `${HIM}'s Inbox for the send and ${ME}'s Inbox for the return, each read through the receiver's own login`,
            why: 'the Money log is not published; the server mails the receiver only after GenMoney moved the $1 (:11514-11529)',
            read: tolerantRead(owed),
            boundMs: TIMEOUTS.readBack,
          },
        },
      }),
    );
    assertions.check('the transfer round trip proved the send and the send back', probeHeld(probes[0]), probes[0]?.note);
    return report(name, assertions, probes, me);
  } finally {
    await logoff(me);
  }
}

/**
 * Send $1 to the secondary account, and it sends it back (#1147). Both accounts log in before the first send;
 * a refusal of the secondary account then is SKIPPED with nothing sent. Nothing is sent unless both bank pages
 * offer the transfer and both profiles are under the receiver limits (Kernel/Kernel.pas:11499).
 * Two residual risks remain, each a FAIL with the pending restore kept ($1 stays with the secondary account): a
 * Transcended item (not readable over the WS contract), and a nobility of 0 that cannot be told
 * from "Nobility label not found". Any failure after the first send is a FAIL, never SKIPPED.
 */
const bankSendReturn: Flow = {
  name: 'bank-send-return',
  what: `both log in -> both pages offer $1 -> receiver limits -> send $1 to ${SECONDARY_ACCOUNT.username} -> notice -> ${SECONDARY_ACCOUNT.username} sends $1 back -> notice`,
  mutates: true,
  run: async ctx => {
    const name = 'bank-send-return';
    const sleep = ctx.sleep ?? defaultSleep;
    const secondary = await loginSecondary();
    if ('skipped' in secondary) return skippedResult(name, secondary.skipped);
    let result: FlowResult;
    try {
      result = await driveSendReturn(secondary, ctx, sleep);
    } catch (err: unknown) {
      result = failedResult(name, err);
    } finally {
      await logoff(secondary);
    }
    const cleanup = [
      ...(await purgeTransferMailbox(PRIMARY_ACCOUNT, SECONDARY_ACCOUNT.username, ['Inbox', 'Sent'], sleep)),
      ...(await purgeTransferMailbox(SECONDARY_ACCOUNT, PRIMARY_ACCOUNT.username, ['Inbox', 'Sent'], sleep)),
    ];
    return withCleanup(result, cleanup);
  },
};

const PORTRAIT_WIDTH = 150;
const PORTRAIT_HEIGHT = 200;
const PORTRAIT_MAX_BYTES = 32 * 1024;

/**
 * The committed test portrait: a 150×200 baseline grayscale JPEG, flat mid-grey, built from
 * constants so its bytes are fixed by the source. One quantisation table, one DC and one AC
 * Huffman table each holding the single code `0` for symbol 0, then 19×25 = 475 blocks of two
 * zero bits (DC diff 0, EOB) — 950 bits, the last byte padded with ones.
 */
export function testPortraitJpeg(): Buffer {
  const dht = (tableClass: number): number[] => [0xff, 0xc4, 0x00, 0x14, tableClass, 0x01, ...new Array<number>(15).fill(0), 0x00];
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array<number>(64).fill(0x01),
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0xc8, 0x00, 0x96, 0x01, 0x01, 0x11, 0x00,
    ...dht(0x00),
    ...dht(0x10),
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    ...new Array<number>(118).fill(0x00), 0x03,
    0xff, 0xd9,
  ]);
}

/** The JPEG marker walk `readJpegDimensions` (`picture-transfer.ts`) does — a copy, see below. */
function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    offset++;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset++;
    if (marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (offset + 1 >= bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 7 >= bytes.length) return null;
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += segmentLength;
  }
  return null;
}

/**
 * The checks `validatePicture` (`picture-transfer.ts`) applies, in its order — the gateway
 * refuses any upload that fails them, the restore included. A copy, because the e2e build does
 * not include gateway code; a unit test pins the two equal.
 */
export function pictureCheck(bytes: Buffer): PictureUploadFailure | null {
  if (bytes.length === 0) return 'NOT_A_JPEG';
  if (bytes.length > PORTRAIT_MAX_BYTES) return 'TOO_LARGE';
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 'NOT_A_JPEG';
  const dims = jpegDimensions(bytes);
  if (!dims) return 'NOT_A_JPEG';
  if (dims.width !== PORTRAIT_WIDTH || dims.height !== PORTRAIT_HEIGHT) return 'WRONG_DIMENSIONS';
  return null;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The portrait on the world web server — the path `RenderTycoon.asp:58` emits and
 * `fetchTycoonProfile` reads. Never the gateway's `/proxy-image`: it answers a missing image
 * with a 1×1 placeholder and caches for up to 30 days.
 */
export function portraitUrl(ip: string, world: string, tycoon: string): string {
  return `http://${ip}/fivedata/userinfo/${encodeURIComponent(world)}/${encodeURIComponent(tycoon)}/largephoto.jpg`;
}

async function fetchPortrait(url: string): Promise<{ status: number; bytes?: Buffer }> {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUTS.request) });
  if (!res.ok) return { status: res.status };
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}

/**
 * Upload the committed test portrait, then the original back (#1147). The original is fetched
 * directly from the world web server and must pass the gateway's picture checks, or nothing is
 * uploaded — the restore upload would be refused after the test image is stored. An original
 * that already is the test image means an earlier run died after its upload: FAIL, world dirty.
 * The pending restore holds the original bytes (base64) before the test upload; the restore
 * uploads those bytes, never a fresh download.
 */
const portraitRoundTrip: Flow = {
  name: 'portrait-roundtrip',
  what: 'fetch largephoto.jpg directly -> picture checks -> upload the test JPEG -> byte-identical re-fetch -> upload the original -> byte-identical re-fetch',
  mutates: true,
  run: async ctx => {
    const name = 'portrait-roundtrip';
    const ME = PRIMARY_ACCOUNT.username;
    const what = 'the portrait round trip';
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const ip = session.world?.ip;
      if (!ip) {
        assertions.check('the login carried the world IP', false, 'no world IP — the portrait URL cannot be built');
        return report(name, assertions, probes, session);
      }
      const url = portraitUrl(ip, session.world?.name ?? WORLD_NAME, ME);
      const first = await fetchPortrait(url);
      if (!first.bytes) {
        assertions.untestable(what, `no readable original portrait at ${url} (HTTP ${first.status}) — nothing to restore to; nothing uploaded`);
        return report(name, assertions, probes, session);
      }
      const refused = pictureCheck(first.bytes);
      if (refused) {
        assertions.untestable(
          what,
          `the original at ${url} fails the picture checks (${refused}) — the gateway would refuse the restore ` +
            'upload after the test image is stored; nothing uploaded',
        );
        return report(name, assertions, probes, session);
      }
      const test = testPortraitJpeg();
      if (sha256(first.bytes) === sha256(test)) {
        ctx.lock.addPendingRestore({
          key: `portrait-leftover:${randomUUID()}`,
          what:
            `${ME}'s largephoto.jpg (${url}) is the e2e test image — an earlier run died after its upload; ` +
            "put the real portrait back from that run's saved originalValue",
          originalValue: '',
        });
        assertions.check('the original portrait is not the e2e test image', false, `${url} — nothing uploaded, world marked dirty`);
        return report(name, assertions, probes, session);
      }
      const originalB64 = first.bytes.toString('base64');
      const testB64 = test.toString('base64');
      probes.push(
        await roundTripProbe(ctx, ctx.survivalLogUrl ?? '', {
          what: `${ME}'s portrait ${url} — the original JPEG is this entry's originalValue (base64) in the world lock file; re-upload it`,
          // The cache server's picture socket: no Survival line, so the read-back alone.
          member: 'PictureUpload',
          read: async () => originalB64,
          testValue: () => testB64,
          write: async value => {
            const answer = await session.driver.request<WsRespProfileUploadPicture>(
              { type: WsMessageType.REQ_PROFILE_UPLOAD_PICTURE, pictureBase64: value },
              WsMessageType.RESP_PROFILE_UPLOAD_PICTURE,
              TIMEOUTS.login,
            );
            if (answer.success !== true) throw new Error(`upload refused: ${answer.reason ?? ''} ${answer.message ?? ''}`.trim());
          },
          proof: {
            readBack: {
              source: `a direct re-fetch of ${url}, compared byte for byte`,
              why:
                'the cache server writes the uploaded bytes verbatim and answers OK only then ' +
                '(Cache Server/CacheServerReportForm.pas:548-549, :574-600); its OK alone proves nothing',
              read: tolerantRead(async () => (await fetchPortrait(url)).bytes?.toString('base64')),
              boundMs: TIMEOUTS.readBack,
            },
          },
        }),
      );
      assertions.check('the portrait round trip proved the upload and the restore', probeHeld(probes[0]), probes[0]?.note);
      return report(name, assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Roads & zones as the Mayor of the governed town (#1151)
// ---------------------------------------------------------------------------------------------

/** Circuit id of roads — the gateway's `circuitId = 1` in `buildRoad` (road-handler.ts). */
const ROAD_CIRCUIT = 1;
/** Tiles in the test road: an end break then keeps two tiles as one segment (Circuits/Circuits.pas:582). */
const ROAD_SPAN = 3;
/** Candidates lie within the town hall ± this many tiles. */
const SEARCH_RADIUS = 12;
/** The map load grows the search window by this much, so a footprint anchored outside it is seen. */
const FOOTPRINT_MARGIN = 10;
/** Non-square on purpose: a transposed surface read cannot pass. */
const ZONE_W = 3;
const ZONE_H = 2;
/**
 * Every rectangle tile needs a road tile within this Chebyshev distance. `RDODefineZone` writes a
 * non-None zone only where the road reach matrix marks the tile (Kernel/World.pas:4527-4528,
 * tolerance 7 in Circuits/MatrixCircuits.pas:205-244); 3 is conservative, because the client
 * cannot see whether a road belongs to a valid circuit.
 */
const ZONE_REACH = 3;
/**
 * The zones the reference client offered the mayor (Five/0/Visual/Voyager/Build/MayorOptions.asp:134-224,
 * :388). Reserved (1) is commented out (:234-249); Residential (2) was never offered (#606).
 */
const MAYOR_ZONE_IDS = [0, 3, 4, 5, 6, 7, 8, 9];
/** The ids the flow may paint over the original. */
const PAINT_ZONE_IDS = [3, 4, 5, 6, 7, 8, 9];

/** What `readArea` saw around the town hall. Grids are indexed `rows[y - rect.y1][x - rect.x1]`. */
export interface AreaRead {
  rect: Rect;
  towns: number[][];
  zones?: number[][];
  /** `x,y` of every tile a facility footprint covers. */
  occupied: Set<string>;
  /** `x,y` of every tile a road segment covers. */
  road: Set<string>;
  /** The TOWNS value at the town-hall tile — the server's "inside the town" test. */
  hallTown: number;
}

const tileKey = (x: number, y: number): string => `${x},${y}`;
const rectText = (r: Rect): string => `(${r.x1},${r.y1})-(${r.x2},${r.y2})`;

function cell(grid: number[][] | undefined, rect: Rect, x: number, y: number): number | undefined {
  return grid?.[y - rect.y1]?.[x - rect.x1];
}

function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
}

/** The min/max box of a segment; a tile is covered when it lies inside the box. */
function segmentBox(s: MapSegment): Rect {
  return {
    x1: Math.min(s.x1, s.x2),
    y1: Math.min(s.y1, s.y2),
    x2: Math.max(s.x1, s.x2),
    y2: Math.max(s.y1, s.y2),
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
}

async function loadMap(session: LiveSession, rect: Rect): Promise<{ buildings: MapBuilding[]; segments: MapSegment[] }> {
  const response = await session.driver.request<WsRespMapData>(
    {
      type: WsMessageType.REQ_MAP_LOAD,
      x: rect.x1,
      y: rect.y1,
      width: rect.x2 - rect.x1 + 1,
      height: rect.y2 - rect.y1 + 1,
    },
    [WsMessageType.RESP_MAP_DATA, WsMessageType.EVENT_MAP_DATA],
    TIMEOUTS.login,
  );
  return { buildings: response.data?.buildings ?? [], segments: response.data?.segments ?? [] };
}

async function readSurface(session: LiveSession, surfaceType: SurfaceType, rect: Rect): Promise<number[][]> {
  const { data } = await session.driver.request<WsRespSurfaceData>(
    { type: WsMessageType.REQ_GET_SURFACE, surfaceType, ...rect },
    WsMessageType.RESP_SURFACE_DATA,
  );
  const shape = surfaceShape(data.rows, rect);
  if (!shape.ok) throw new Error(`the ${surfaceType} surface does not cover ${rectText(rect)}: ${shape.detail}`);
  return data.rows;
}

/**
 * The TOWNS surface (and ZONES when asked) over the town hall ± SEARCH_RADIUS, the facilities and
 * roads over that window grown by FOOTPRINT_MARGIN, and the facility sizes. `GetSurface` compresses
 * the world live (Kernel/World.pas:4461-4470) — no object-cache lag.
 */
async function readArea(session: LiveSession, hall: { x: number; y: number }, withZones: boolean): Promise<AreaRead> {
  const rect: Rect = {
    x1: Math.max(0, hall.x - SEARCH_RADIUS),
    y1: Math.max(0, hall.y - SEARCH_RADIUS),
    x2: hall.x + SEARCH_RADIUS,
    y2: hall.y + SEARCH_RADIUS,
  };
  const towns = await readSurface(session, SurfaceType.TOWNS, rect);
  const zones = withZones ? await readSurface(session, SurfaceType.ZONES, rect) : undefined;
  const loaded: Rect = {
    x1: Math.max(0, rect.x1 - FOOTPRINT_MARGIN),
    y1: Math.max(0, rect.y1 - FOOTPRINT_MARGIN),
    x2: rect.x2 + FOOTPRINT_MARGIN,
    y2: rect.y2 + FOOTPRINT_MARGIN,
  };
  const map = await loadMap(session, loaded);
  const { dimensions } = await session.driver.request<WsRespAllFacilityDimensions>(
    { type: WsMessageType.REQ_GET_ALL_FACILITY_DIMENSIONS },
    WsMessageType.RESP_ALL_FACILITY_DIMENSIONS,
  );

  // A footprint covers (x .. x+xsize-1, y .. y+ysize-1) from its origin — the renderer's
  // occupied-tile rule (isometric-map-renderer.ts). An unknown class counts as one tile.
  const occupied = new Set<string>();
  for (const b of map.buildings) {
    const dims = dimensions[b.visualClass];
    const w = dims?.xsize ?? 1;
    const h = dims?.ysize ?? 1;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) occupied.add(tileKey(b.x + dx, b.y + dy));
  }
  const road = new Set<string>();
  for (const s of map.segments) {
    const box = segmentBox(s);
    for (let y = Math.max(box.y1, loaded.y1); y <= Math.min(box.y2, loaded.y2); y++) {
      for (let x = Math.max(box.x1, loaded.x1); x <= Math.min(box.x2, loaded.x2); x++) road.add(tileKey(x, y));
    }
  }
  const hallTown = cell(towns, rect, hall.x, hall.y);
  if (hallTown === undefined) throw new Error(`the town hall (${hall.x},${hall.y}) is outside ${rectText(rect)}`);
  return { rect, towns, zones, occupied, road, hallTown };
}

/** Every tile of the area, nearest the town hall first: Chebyshev distance, then y, then x. */
function tilesByDistance(area: AreaRead, hall: { x: number; y: number }): { x: number; y: number }[] {
  const tiles: { x: number; y: number; d: number }[] = [];
  for (let y = area.rect.y1; y <= area.rect.y2; y++) {
    for (let x = area.rect.x1; x <= area.rect.x2; x++) {
      tiles.push({ x, y, d: Math.max(Math.abs(x - hall.x), Math.abs(y - hall.y)) });
    }
  }
  return tiles.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
}

/**
 * The nearest straight ROAD_SPAN-tile span inside the town (every tile reads the hall's TOWNS
 * value) with no facility and no road on it or on its 8-neighbour halo, span and halo inside the
 * read window. Horizontal before vertical. `undefined` when nothing fits.
 */
export function findRoadSpan(area: AreaRead, hall: { x: number; y: number }): Rect | undefined {
  for (const { x, y } of tilesByDistance(area, hall)) {
    for (const span of [
      { x1: x, y1: y, x2: x + ROAD_SPAN - 1, y2: y },
      { x1: x, y1: y, x2: x, y2: y + ROAD_SPAN - 1 },
    ]) {
      if (roadSpanFits(area, span)) return span;
    }
  }
  return undefined;
}

function roadSpanFits(area: AreaRead, span: Rect): boolean {
  for (let y = span.y1 - 1; y <= span.y2 + 1; y++) {
    for (let x = span.x1 - 1; x <= span.x2 + 1; x++) {
      if (!inside(area.rect, x, y)) return false;
      if (area.occupied.has(tileKey(x, y)) || area.road.has(tileKey(x, y))) return false;
    }
  }
  return spanTiles(span).every(t => cell(area.towns, area.rect, t.x, t.y) === area.hallTown);
}

/**
 * The nearest ZONE_W × ZONE_H rectangle inside the town whose tiles all hold one zone id the mayor
 * was offered, that no facility footprint overlaps, and whose every tile has a road within
 * ZONE_REACH. `undefined` when nothing fits.
 */
export function findZoneRect(area: AreaRead, hall: { x: number; y: number }): Rect | undefined {
  for (const { x, y } of tilesByDistance(area, hall)) {
    const rect = { x1: x, y1: y, x2: x + ZONE_W - 1, y2: y + ZONE_H - 1 };
    if (zoneRectFits(area, rect)) return rect;
  }
  return undefined;
}

function zoneRectFits(area: AreaRead, rect: Rect): boolean {
  if (!inside(area.rect, rect.x2, rect.y2)) return false;
  const zone = cell(area.zones, area.rect, rect.x1, rect.y1);
  if (zone === undefined || !MAYOR_ZONE_IDS.includes(zone)) return false;
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let x = rect.x1; x <= rect.x2; x++) {
      if (cell(area.towns, area.rect, x, y) !== area.hallTown) return false;
      if (cell(area.zones, area.rect, x, y) !== zone) return false;
      if (area.occupied.has(tileKey(x, y))) return false;
      if (!roadWithin(area, x, y)) return false;
    }
  }
  return true;
}

function roadWithin(area: AreaRead, x: number, y: number): boolean {
  for (let dy = -ZONE_REACH; dy <= ZONE_REACH; dy++) {
    for (let dx = -ZONE_REACH; dx <= ZONE_REACH; dx++) {
      if (area.road.has(tileKey(x + dx, y + dy))) return true;
    }
  }
  return false;
}

/** The tiles of a straight span, from (x1,y1) to (x2,y2). */
function spanTiles(span: Rect): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  for (let y = span.y1; y <= span.y2; y++) for (let x = span.x1; x <= span.x2; x++) tiles.push({ x, y });
  return tiles;
}

interface SpanRead {
  /** Span tiles, in span order, covered by a segment lying wholly inside the span — and by no foreign one. */
  covered: string[];
  /** Segments that touch the span but extend beyond it. */
  foreign: number;
}

const spanReadText = (r: SpanRead): string => `covered=[${r.covered.join(' ')}] foreign=${r.foreign}`;

/** `SegmentsInArea` over the span grown by 2 tiles. */
async function readSpan(session: LiveSession, span: Rect): Promise<SpanRead> {
  const { segments } = await loadMap(session, {
    x1: Math.max(0, span.x1 - 2),
    y1: Math.max(0, span.y1 - 2),
    x2: span.x2 + 2,
    y2: span.y2 + 2,
  });
  const own: Rect[] = [];
  const foreign: Rect[] = [];
  for (const s of segments) {
    const box = segmentBox(s);
    if (!overlaps(box, span)) continue;
    const wholly = box.x1 >= span.x1 && box.x2 <= span.x2 && box.y1 >= span.y1 && box.y2 <= span.y2;
    (wholly ? own : foreign).push(box);
  }
  const covered = spanTiles(span)
    .filter(t => own.some(b => inside(b, t.x, t.y)) && !foreign.some(b => inside(b, t.x, t.y)))
    .map(t => tileKey(t.x, t.y));
  return { covered, foreign: foreign.length };
}

/** Read at least once, then every `readBackPoll` until `done` holds or `readBack` has elapsed. */
async function pollSpan(
  session: LiveSession,
  span: Rect,
  done: (r: SpanRead) => boolean,
  ctx: FlowContext,
): Promise<{ ok: boolean; last: SpanRead }> {
  const now = ctx.now ?? Date.now;
  const sleep = ctx.sleep ?? defaultSleep;
  const deadline = now() + TIMEOUTS.readBack;
  for (;;) {
    const last = await readSpan(session, span);
    if (done(last)) return { ok: true, last };
    if (now() >= deadline) return { ok: false, last };
    await sleep(TIMEOUTS.readBackPoll);
  }
}

/** The span reads exactly these tiles, and no foreign segment touches it. */
const exactly = (expected: string[]) => (r: SpanRead): boolean =>
  r.foreign === 0 && r.covered.length === expected.length && r.covered.every((t, i) => t === expected[i]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A circuit Survival line (Kernel/World.pas:4263, :4320, :4366): `<marker> <CircuitId>, <TycoonRef>, <coords>`.
 * The tycoon field is the gateway's object reference, which no WS message exposes — so the line
 * is matched on the road circuit id and the coordinates as sent.
 */
export function circuitLogMatches(line: string, marker: string, coords: number[]): boolean {
  return new RegExp(`${escapeRegExp(marker)} ${ROAD_CIRCUIT}, -?\\d+, ${coords.join(', ')}(?!\\d)`).test(line);
}

/** `Defining Zone: <ZoneId>, <TycoonId>, <x1>, <y1>, <x2>, <y2>` (Kernel/World.pas:4526), rectangle normalised. */
export function zoneLogMatches(line: string, zoneId: number, rect: Rect): boolean {
  const coords = [rect.x1, rect.y1, rect.x2, rect.y2].join(', ');
  return new RegExp(`${escapeRegExp(LOG_MARKERS.RDODefineZone)} ${zoneId}, -?\\d+, ${coords}(?!\\d)`).test(line);
}

/** The ZONES value of the rectangle when every tile holds the same mayor-offered id, else `undefined`. */
async function readZone(session: LiveSession, rect: Rect): Promise<string | undefined> {
  const { data } = await session.driver.request<WsRespSurfaceData>(
    { type: WsMessageType.REQ_GET_SURFACE, surfaceType: SurfaceType.ZONES, ...rect },
    WsMessageType.RESP_SURFACE_DATA,
  );
  if (!surfaceShape(data.rows, rect).ok) return undefined;
  const first = data.rows[0][0];
  if (!data.rows.every(r => r.every(v => v === first)) || !MAYOR_ZONE_IDS.includes(first)) return undefined;
  return String(first);
}

/**
 * Log in, find the governed town (the search menu belongs to the own session), switch to the
 * Mayor role company, run the body, and switch back in a `finally` — including when the switch
 * itself threw. A throw still propagates, so `runFlow` turns it into FAIL.
 */
async function asMayor(
  name: string,
  ctx: FlowContext,
  body: (
    session: LiveSession,
    town: { x: number; y: number },
    url: string,
    assertions: Assertions,
    probes: ProbeResult[],
  ) => Promise<void>,
): Promise<FlowResult> {
  const assertions = new Assertions();
  const probes: ProbeResult[] = [];
  const session = await login(PRIMARY_ACCOUNT);
  try {
    const town = await findTown(session, GOVERNED_TOWN);
    const url = ctx.survivalLogUrl ?? (await findCurrentSurvivalLog());
    try {
      await switchToMayor(session);
      await body(session, town, url, assertions, probes);
    } finally {
      const back = await trySwitch(session, session.company);
      assertions.check('the switch back to the own company answers RESP_RDO_RESULT', back.ok, back.detail);
    }
    assertions.check('no gateway errors', session.driver.errors.length === 0);
    return report(name, assertions, probes, session);
  } finally {
    await logoff(session);
  }
}

/**
 * Build a 3-tile road, break its start tile, wipe the two tiles left — as the Mayor of the
 * governed town (#1151).
 *
 * Roads need the Mayor role: as the plain player `CreateCircuitSeg` answers `#22`
 * (`ERROR_CannotCreateSeg`, Protocol/Protocol.pas:51; the guard at Kernel/World.pas:4273). The
 * mayor may break any segment in the town (`TWorld.OnAuthorizeBreak`, Kernel/World.pas:5593-5608),
 * so the span choice — empty tiles, no road on or next to them — and the cleanup rule are the only
 * guards: the cleanup re-reads the span and breaks only tiles of a segment lying wholly inside it,
 * one tile at a time, never with `REQ_DEMOLISH_ROAD_AREA`.
 *
 * `TSegment.MakeHole` on the start tile moves the node in and keeps the other two tiles as one
 * segment (Circuits/Circuits.pas:582-598); a break within one tile of both ends deletes the whole
 * segment (:556-577), which is why the span is 3. Each run spends two road blocks of a tier-<2
 * identity's yearly quota (`tiles := abs(x2-x1)+abs(y2-y1)`, Kernel/World.pas:4271, :4290;
 * Kernel/Kernel.pas:13180-13187) and the road's construction cost — accepted by the maintainer.
 * Each write is proven by its Survival line (Kernel/World.pas:4263, :4320, :4366 —
 * `CreateCircuitSeg: OK!` at :4307 is unconditional and proves nothing) and a `SegmentsInArea`
 * read-back.
 */
const roadRoundTrip: Flow = {
  name: 'road-roundtrip',
  what: 'as Mayor: find an empty 3-tile span -> build a road -> break its start tile -> wipe the other two -> no segment left',
  mutates: true,
  run: ctx =>
    asMayor('road-roundtrip', ctx, async (session, town, url, assertions) => {
      let span: Rect | undefined;
      let key: string | undefined;
      try {
        const area = await readArea(session, town, false);
        span = findRoadSpan(area, town);
        if (!span) {
          assertions.untestable(
            `a road round trip in ${GOVERNED_TOWN}`,
            `no straight ${ROAD_SPAN}-tile span inside ${GOVERNED_TOWN} with no object and no road on or next to it ` +
              `in the ±${SEARCH_RADIUS} window`,
          );
          return;
        }
        key = `road-roundtrip:${randomUUID()}`;
        ctx.lock.addPendingRestore({
          key,
          what: `break the road on ${rectText(span)} as Mayor of ${GOVERNED_TOWN} — road-roundtrip built it`,
          originalValue: 'no road',
        });
        await roadSteps(session, span, url, assertions, ctx);
      } catch (err: unknown) {
        assertions.check('the road steps ran without a throw', false, toErrorMessage(err));
      }
      if (span && key) await roadCleanup(session, span, key, assertions, ctx);
    }),
};

async function roadSteps(
  session: LiveSession,
  span: Rect,
  url: string,
  assertions: Assertions,
  ctx: FlowContext,
): Promise<void> {
  const tiles = spanTiles(span).map(t => tileKey(t.x, t.y));
  const [, second, third] = spanTiles(span);
  const opened = await openLog(url);
  const line = (marker: string, coords: number[]): Promise<LogLook> =>
    lookForLine(opened, window =>
      awaitMarker(window, { marker, match: l => circuitLogMatches(l, marker, coords) }, TIMEOUTS.logSettle),
    );
  // A missing line is UNTESTABLE beside the map read-back, which decides the step.
  const mapSays = (ok: boolean, read: SpanRead): string =>
    `the map read-back ${ok ? 'agrees' : 'does not agree'} (${spanReadText(read)})`;

  // Build.
  const built = await session.driver.request<WsRespBuildRoad>(
    { type: WsMessageType.REQ_BUILD_ROAD, ...span },
    WsMessageType.RESP_BUILD_ROAD,
    TIMEOUTS.login,
  );
  assertions.check(
    'the gateway accepted the road build',
    built.success === true && !built.partial,
    `success=${built.success} partial=${built.partial ?? false} ${built.message ?? ''}`.trim(),
  );
  if (built.success !== true) return;
  const afterBuild = await pollSpan(session, span, exactly(tiles), ctx);
  assertions.check('the map shows segments covering exactly the span', afterBuild.ok, spanReadText(afterBuild.last));
  checkLogLine(
    assertions,
    'the build logged its CreateCircuitSeg: line',
    await line(LOG_MARKERS.RDOCreateCircuitSeg, [span.x1, span.y1, span.x2, span.y2]),
    { marker: LOG_MARKERS.RDOCreateCircuitSeg, url },
    mapSays(afterBuild.ok, afterBuild.last),
  );
  if (!afterBuild.ok) return;

  // Break the start tile: the node moves in, the other two tiles stay as one segment.
  const broken = await session.driver.request<WsRespDemolishRoad>(
    { type: WsMessageType.REQ_DEMOLISH_ROAD, x: span.x1, y: span.y1 },
    WsMessageType.RESP_DEMOLISH_ROAD,
    TIMEOUTS.login,
  );
  assertions.check('the gateway accepted the break', broken.success === true, broken.message);
  const afterBreak = await pollSpan(session, span, exactly(tiles.slice(1)), ctx);
  assertions.check('the map shows exactly the other two tiles left', afterBreak.ok, spanReadText(afterBreak.last));
  checkLogLine(
    assertions,
    'the break logged its BreakCircuit: line',
    await line(LOG_MARKERS.RDOBreakCircuitAt, [span.x1, span.y1]),
    { marker: LOG_MARKERS.RDOBreakCircuitAt, url },
    mapSays(afterBreak.ok, afterBreak.last),
  );
  // A break that removed everything goes on to the wipe step, which FAILs for it.
  if (!afterBreak.ok && afterBreak.last.covered.length > 0) return;

  // Wipe the two tiles left — the undo.
  const before = await readSpan(session, span);
  if (before.covered.length === 0 || before.foreign > 0) {
    assertions.check(
      'a segment remained on the span for the wipe',
      false,
      before.foreign > 0 ? `a segment extends beyond the span — nothing wiped (${spanReadText(before)})` : 'the break removed the whole road',
    );
    return;
  }
  const wiped = await session.driver.request<WsRespDemolishRoadArea>(
    { type: WsMessageType.REQ_DEMOLISH_ROAD_AREA, x1: second.x, y1: second.y, x2: third.x, y2: third.y },
    WsMessageType.RESP_DEMOLISH_ROAD_AREA,
    TIMEOUTS.login,
  );
  assertions.check('the gateway accepted the wipe', wiped.success === true, wiped.message);
  const afterWipe = await pollSpan(session, span, exactly([]), ctx);
  assertions.check('the map shows no segment left on the span', afterWipe.ok, spanReadText(afterWipe.last));
  checkLogLine(
    assertions,
    'the wipe logged its WipingCircuit: line',
    await line(LOG_MARKERS.RDOWipeCircuit, [second.x, second.y, third.x, third.y]),
    { marker: LOG_MARKERS.RDOWipeCircuit, url },
    mapSays(afterWipe.ok, afterWipe.last),
  );
}

/**
 * Leave the span as found. Breaks, one tile at a time, only tiles of a segment lying wholly inside
 * the span; stops without touching anything when a segment extends beyond it. The pending restore
 * is cleared only when the span reads clean.
 */
async function roadCleanup(
  session: LiveSession,
  span: Rect,
  key: string,
  assertions: Assertions,
  ctx: FlowContext,
): Promise<void> {
  let last: SpanRead | undefined;
  let clean = false;
  try {
    for (let breaks = 0; ; breaks++) {
      last = await readSpan(session, span);
      if (last.covered.length === 0 && last.foreign === 0) {
        clean = true;
        break;
      }
      if (last.foreign > 0 || breaks >= ROAD_SPAN) break;
      const target = last.covered[0];
      const [x, y] = target.split(',').map(Number);
      await session.driver.request<WsRespDemolishRoad>(
        { type: WsMessageType.REQ_DEMOLISH_ROAD, x, y },
        WsMessageType.RESP_DEMOLISH_ROAD,
        TIMEOUTS.login,
      );
      await pollSpan(session, span, r => !r.covered.includes(target), ctx);
    }
  } catch (err: unknown) {
    assertions.check('the road cleanup ran without a throw', false, toErrorMessage(err));
  }
  if (clean) ctx.lock.clearPendingRestore(key);
  assertions.check(
    'no segment is left on the span',
    clean,
    clean ? rectText(span) : `${rectText(span)}: ${last ? spanReadText(last) : 'unread'} — pending restore kept`,
  );
}

/**
 * Paint a small uniform rectangle in the town with another zone, then repaint the original — as
 * the Mayor of the governed town (#1151).
 *
 * The rectangle holds one zone id the reference client offered the mayor, so one call restores it
 * exactly, and no facility footprint overlaps it: rezoning under a private facility schedules its
 * demolition and mails its owner a Zoning Alert (`ReportZoning`, Kernel/World.pas:4546-4561 ->
 * :7908-7916), which a repaint cannot unsend. Each write is proven by its `Defining Zone:` line
 * (Kernel/World.pas:4526) and the ZONES surface read back live from `fZones` (:4461-4464).
 */
const zoneRoundTrip: Flow = {
  name: 'zone-roundtrip',
  what: 'as Mayor: find a uniform unbuilt rectangle -> paint another zone -> read back -> repaint the original -> read back',
  mutates: true,
  run: ctx =>
    asMayor('zone-roundtrip', ctx, async (session, town, url, assertions, probes) => {
      const area = await readArea(session, town, true);
      const rect = findZoneRect(area, town);
      if (!rect) {
        assertions.untestable(
          `a zone round trip in ${GOVERNED_TOWN}`,
          `no ${ZONE_W}×${ZONE_H} rectangle inside ${GOVERNED_TOWN} in the ±${SEARCH_RADIUS} window holding one zone id ` +
            `of {${MAYOR_ZONE_IDS.join(', ')}}, overlapped by no facility footprint, with a road within ${ZONE_REACH} tiles`,
        );
        return;
      }
      const opened = await openLog(url);
      const probe = await roundTripProbe(ctx, url, {
        what: `the zone of ${rectText(rect)} in ${GOVERNED_TOWN} — repaint it as Mayor of ${GOVERNED_TOWN} with REQ_DEFINE_ZONE`,
        member: 'RDODefineZone',
        read: () => readZone(session, rect),
        testValue: original => String(PAINT_ZONE_IDS.find(z => String(z) !== original)),
        write: async value => {
          const answer = await session.driver.request<WsRespDefineZone>(
            { type: WsMessageType.REQ_DEFINE_ZONE, zoneId: Number(value), ...rect },
            WsMessageType.RESP_DEFINE_ZONE,
            TIMEOUTS.login,
          );
          if (answer.success !== true) throw new Error(`REQ_DEFINE_ZONE refused: ${answer.message ?? ''}`.trim());
        },
        proof: {
          log: {
            marker: LOG_MARKERS.RDODefineZone,
            match: (line, written) => zoneLogMatches(line, Number(written), rect),
          },
          readBack: {
            source: 'the ZONES surface over the rectangle (REQ_GET_SURFACE)',
            why: 'GetSurface compresses fZones live — no object cache (Kernel/World.pas:4461-4464)',
            read: tolerantRead(() => readZone(session, rect)),
            boundMs: TIMEOUTS.readBack,
          },
        },
      });
      probes.push(probe);
      assertions.check('the zone round trip proved the paint and the repaint', probeHeld(probe), probe.note);
      if (probe.written !== '') {
        checkLogLine(
          assertions,
          'the repaint to the original logged its Defining Zone: line',
          await lookForLine(opened, window =>
            awaitMarker(
              window,
              { marker: LOG_MARKERS.RDODefineZone, match: l => zoneLogMatches(l, Number(probe.original), rect) },
              TIMEOUTS.logSettle,
            ),
          ),
          { marker: LOG_MARKERS.RDODefineZone, url },
          `the ZONES read-back ${probe.restored ? 'shows' : 'does not show'} the original ${probe.original}`,
        );
      }
    }),
};

/**
 * The permanent fixtures (#1149): SPO_test3's own finished facility of each kind in Helartia,
 * found by kind — and, when one is missing, built once and kept (the sanctioned permanent fixture
 * build, doc/E2E-POLICY.md §9). This flow ensures every kind in one pass; each fixture flow's own
 * seed ensures its own kinds (`fixtureSeed`, #1185). A build is proven by its `New Facility:` line, result code 0
 * and the lot read-back; nothing is restored, so no pending restore is recorded.
 */
const fixturesEnsure: Flow = {
  name: 'fixtures-ensure',
  what:
    "SPO_test3's facility per kind in Helartia -> build each missing kind once (permanent fixture): " +
    'New Facility: line + result 0 + lot read-back',
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const outcomes = await ensureFixtures(session, {
        survivalLogUrl: ctx.survivalLogUrl,
        now: ctx.now,
        sleep: ctx.sleep,
      });
      for (const o of outcomes) {
        const at = o.x !== undefined ? `at (${o.x},${o.y}) vc ${o.visualClass ?? '?'}` : '';
        // A found fixture carries its lot; a built one its New Facility: line (receipt).
        if (o.status === 'found') assertions.check(`${o.kind}: fixture found`, o.x !== undefined && o.y !== undefined, at);
        else if (o.status === 'built') {
          assertions.check(`${o.kind}: fixture built`, Boolean(o.logLine) && o.x !== undefined, `${at} — ${o.logLine ?? ''}`);
        }
        else if (o.status === 'FAIL') assertions.check(`${o.kind} fixture`, false, o.reason);
        else assertions.untestable(`${o.kind} fixture`, `${o.status === 'under construction' ? 'under construction — ' : ''}${o.reason ?? ''}`);
      }
      return { ...report('fixtures-ensure', assertions, [], session), fixtures: outcomes };
    } finally {
      await logoff(session);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Inspector flows (#1152) — owner setters and live reads on SPO_test3's own fixtures
// ---------------------------------------------------------------------------------------------
//
// Every write below is a round trip (`runRoundTrip`): the Survival line proves receipt only —
// each of these handlers logs before its owner check — and a read-back equal to the value
// written proves the change. The gateway's own `confirmed` flag is never used as proof.

/** Where a fixture stands — what `findFixture` found, and nothing else. */
interface OwnFixture {
  x: number;
  y: number;
  visualClass: string;
  name: string;
}

/** A gate as the tab data lists it — path and name, nothing read off the gate yet. */
interface GateStub {
  path: string;
  name: string;
}

/** The kind's row in FIXTURE_KINDS. */
export function fixtureKind(id: FixtureKindId): FixtureKind {
  const kind = FIXTURE_KINDS.find(k => k.id === id);
  if (!kind) throw new Error(`No fixture kind "${id}" in FIXTURE_KINDS`);
  return kind;
}

/**
 * A fixture flow's seed (#1185): log in as SPO_test3 and ensure only the kinds the flow reads —
 * building a missing one once, as `fixtures-ensure` would — so the flow runs alone. Nothing is
 * undone (permanent fixtures, doc/E2E-POLICY.md §9), so there is no cleanup. `found`, `built`,
 * `under construction` and `unproven` leave the seed ok: the run then looks the fixture up and
 * reports `pickFixture`'s own reason as UNTESTABLE (a fixture placed now is still under
 * construction in this run). Only a `FAIL` — a build that went wrong — fails the seed, so the run
 * is skipped and the flow ends UNTESTABLE `seed failed`. A throw (login refused, terrain
 * unreadable) propagates; `runFlow` records it as a failed seed.
 */
function fixtureSeed(...kindIds: FixtureKindId[]): (ctx: FlowContext) => Promise<FlowSeed> {
  return async ctx => {
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const outcomes = await ensureFixtures(
        session,
        { survivalLogUrl: ctx.survivalLogUrl, now: ctx.now, sleep: ctx.sleep },
        kindIds.map(fixtureKind),
      );
      const detail = outcomes
        .map(o => {
          const at = o.x !== undefined ? ` at (${o.x},${o.y})` : '';
          const reason = o.reason ? ` — ${o.reason}` : '';
          const line = o.logLine ? ` — ${o.logLine}` : '';
          return `${o.kind}: ${o.status}${at}${reason}${line}`;
        })
        .join(' | ');
      return {
        outcome: {
          what: `ensure ${kindIds.join(' + ')} fixture(s) in ${GOVERNED_TOWN}`,
          ok: !outcomes.some(o => o.status === 'FAIL'),
          detail,
        },
      };
    } finally {
      await logoff(session);
    }
  };
}

/**
 * SPO_test3's own fixture of a kind, or `undefined` with the reason recorded as untestable. The run
 * writes nothing when its fixture is missing — only the flow's seed may have built it.
 */
async function ownFixture(
  session: LiveSession,
  kindId: FixtureKindId,
  assertions: Assertions,
): Promise<OwnFixture | undefined> {
  const lookup = await findFixture(session, fixtureKind(kindId));
  if (!lookup.found) {
    assertions.untestable(`${kindId} fixture`, lookup.reason ?? 'not found');
    return undefined;
  }
  return lookup.found;
}

const fixtureLabel = (fx: OwnFixture): string => `${fx.name} (${fx.x},${fx.y})`;

/**
 * The gates of one accordion. The opening read comes first: it recreates the inspector's temp
 * object, so what follows is a current read (`readSectionGroups` explains why).
 */
async function gateStubs(session: LiveSession, fx: OwnFixture, tabId: 'supplies' | 'products'): Promise<GateStub[]> {
  await readBuildingDetails(session, fx.x, fx.y, fx.visualClass);
  const tab = await readBuildingTabData(session, fx.x, fx.y, tabId, fx.visualClass);
  return (tabId === 'supplies' ? tab.supplies : tab.products) ?? [];
}

function gateConnections(
  session: LiveSession,
  fx: OwnFixture,
  tabId: 'supplies' | 'products',
  stub: GateStub,
  headerOnly = false,
): Promise<WsRespBuildingGateConnections> {
  return session.driver.request<WsRespBuildingGateConnections>(
    {
      type: WsMessageType.REQ_BUILDING_GATE_CONNECTIONS,
      x: fx.x,
      y: fx.y,
      tabId,
      path: stub.path,
      name: stub.name,
      visualClass: fx.visualClass,
      ...(headerOnly ? { headerOnly: true } : {}),
    },
    WsMessageType.RESP_BUILDING_GATE_CONNECTIONS,
  );
}

/** A fresh read of one supply gate, found by name. */
async function readSupply(session: LiveSession, fx: OwnFixture, name: string): Promise<BuildingSupplyData | undefined> {
  const stub = (await gateStubs(session, fx, 'supplies')).find(g => g.name === name);
  return stub ? (await gateConnections(session, fx, 'supplies', stub)).supply : undefined;
}

/** A fresh read of one product gate, found by name. */
async function readProduct(session: LiveSession, fx: OwnFixture, name: string): Promise<BuildingProductData | undefined> {
  const stub = (await gateStubs(session, fx, 'products')).find(g => g.name === name);
  return stub ? (await gateConnections(session, fx, 'products', stub)).product : undefined;
}

/** A read-back channel that polls through `read` until the bound. */
function readBackOn(
  source: string,
  why: string,
  read: () => Promise<string | undefined>,
  normalise?: (value: string) => string,
): RoundTripSpec['proof']['readBack'] {
  return { source, why, read, boundMs: TIMEOUTS.readBack, ...(normalise ? { normalise } : {}) };
}

const FACILITY_CACHE_WHY =
  "the facility's object-cache entry refreshes within its TTL (OB-29); the poll waits the lag out";
const GATE_CACHE_WHY =
  "the gate's own cache object, read the way the Supplies/Products tab reads it (SetPath onto the gate, " +
  'building-details-handler.ts); the poll waits the cache refresh out';

/**
 * The integer ±1 toward the middle of `[min, max]`, clamped. `nudge` clamps to 0..100, which
 * would turn a salary of 150 into 100 — a write of a different magnitude, not a nudge.
 */
export function nudgeWithin(original: string, min: number, max: number): string {
  const middle = (min + max) / 2;
  const parsed = Number(original);
  if (original.trim() === '' || !Number.isFinite(parsed)) return String(Math.round(middle));
  const rounded = Math.round(parsed);
  const next = rounded >= middle ? rounded - 1 : rounded + 1;
  return String(Math.min(max, Math.max(min, next)));
}

/** The largest price the client offers for a service (SRV_GENERAL_GROUP's slider, template-groups.ts). */
const SERVICE_PRICE_MAX = 500;
/** `high(fServiceData[index].Price)` — a byte (StdBlocks/ServiceBlock.pas:1585). */
const SERVICE_PRICE_STORED_MAX = 255;

/**
 * The service price to write: ±10 from the original, inside 0..500, and always **even** —
 * `RDOSetPrice` stores `round(value/2)` and the cache publishes `2*Price`
 * (StdBlocks/ServiceBlock.pas:1585, :1731), so an odd value would read back different.
 */
export function evenPriceNudge(original: string): string {
  const parsed = Number(original);
  if (original.trim() === '' || !Number.isFinite(parsed)) return '100';
  const base = Math.round(parsed);
  const moved = Math.min(SERVICE_PRICE_MAX, Math.max(0, base >= 250 ? base - 10 : base + 10));
  return String(moved % 2 === 0 ? moved : moved - 1);
}

/** Delphi's `round`: banker's rounding, a tie goes to the even neighbour. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * What the cache publishes for a written service price: `2 * min(255, round(v/2))`
 * (StdBlocks/ServiceBlock.pas:1585 stores it, :1731 publishes `2*Price`).
 */
export function servicePriceQuantised(value: string): string {
  const parsed = Number(value);
  if (value.trim() === '' || !Number.isFinite(parsed)) return value;
  return String(2 * Math.min(SERVICE_PRICE_STORED_MAX, roundHalfEven(parsed / 2)));
}

/** `text` directly after `Fac(<x>,<y>) `, ending the line or followed by whitespace. */
export function facLineMatches(line: string, x: number, y: number, text: string): boolean {
  return new RegExp(`${escapeRegExp(`Fac(${x},${y}) ${text}`)}(?=\\s|$)`).test(line);
}

/** `StdBlocks/ServiceBlock.pas:1580` — "Service SetPrice: <index>, <value>"; service 0 here. */
export function servicePriceLineMatches(line: string, written: string): boolean {
  return new RegExp(`${escapeRegExp(`Service SetPrice: 0, ${written}`)}(?=\\s|$)`).test(line);
}

/** `Kernel/WorkCenterBlock.pas:584` — "Setting salaries: <hi>, <mid>, <lo>". */
export function salariesLineMatches(line: string, hi: string, mid: string, lo: string): boolean {
  return new RegExp(`${escapeRegExp(`Setting salaries: ${hi}, ${mid}, ${lo}`)}(?=\\s|$)`).test(line);
}

/**
 * A salary slot the server left unpublished reads `""`: `TWorkCenter.StoreToCache` writes
 * `Salaries<k>` only for a class the block has capacity for (Kernel/WorkCenterBlock.pas:567-571).
 * It is sent as 0, as the inspector sends it (`collectSalaryTriplet`, property-utils.ts) — an
 * empty slot must never reach `RdoValue.int` as `parseInt('')`.
 */
export function salaryArg(value: string): string {
  return value.trim() === '' ? '0' : value;
}

/**
 * The triplet with the first **published** class nudged, the unpublished slots kept empty so the
 * read-back can tell them apart. Throws when no class is published — nothing is written then.
 */
export function salariesNudge(original: string): string {
  const slots = original.split(',');
  const k = slots.findIndex(s => s.trim() !== '');
  if (k < 0) throw new Error(`no salary class is published ("${original}") — nothing to nudge`);
  slots[k] = nudgeWithin(slots[k], 0, 255);
  return slots.join(',');
}

/**
 * The read-back compares the published classes only — a slot `expected` leaves empty was never
 * published, so its value cannot be read back (Kernel/WorkCenterBlock.pas:567-571).
 */
export function publishedSalariesMatch(last: string, expected: string): boolean {
  const got = last.split(',');
  const want = expected.split(',');
  return got.length === want.length && want.every((w, i) => w.trim() === '' || got[i] === w);
}

const linkKey = (c: BuildingConnectionData): string => `${c.x},${c.y},${c.facilityName}`;
const linkLabel = (c: BuildingConnectionData): string => `${c.facilityName} (${c.x},${c.y}) of ${c.companyName}`;

/** The client links in one list and not the other, by identity (x, y, facility name). */
export function clientLinksDiff(
  before: BuildingConnectionData[],
  after: BuildingConnectionData[],
): { lost: string[]; gained: string[] } {
  const afterKeys = new Set(after.map(linkKey));
  const beforeKeys = new Set(before.map(linkKey));
  return {
    lost: before.filter(c => !afterKeys.has(linkKey(c))).map(linkLabel),
    gained: after.filter(c => !beforeKeys.has(linkKey(c))).map(linkLabel),
  };
}

/** SPO_test3's own side: every company the directory lists for the tycoon, and every facility lot as `x,y`. */
export interface OwnClients {
  companies: ReadonlySet<string>;
  lots: ReadonlySet<string>;
}

/**
 * Why a product gate's price must not be driven, or `null` when it may. A price change re-checks
 * every client link (`TOutput.SetPricePerc`, Kernel/Kernel.pas:7193-7205) and
 * `TGate.ConnectionChanged` drops any that no longer passes (:6664-6676, :6737-6750) — so the
 * gate must have no client, or only clients of any of SPO_test3's companies (a company the
 * directory lists for the tycoon, or a lot that is one of its facilities — the rule
 * `quick-trade-roundtrip`'s guard 1 applies), all of them read. A plain string is one company, no lots.
 */
export function outputPriceRefusal(product: BuildingProductData | undefined, own: string | OwnClients): string | null {
  if (!product?.metaFluid || product.pricePc === undefined) return 'its header was not read';
  if (product.connectionCount !== product.connections.length) {
    return `${product.connectionCount ?? '?'} client(s) listed but ${product.connections.length} read (the row cap) — unread clients cannot be checked`;
  }
  const set: OwnClients = typeof own === 'string' ? { companies: new Set([own]), lots: new Set() } : own;
  const foreign = product.connections.filter(c => !set.companies.has(c.companyName) && !set.lots.has(`${c.x},${c.y}`));
  if (foreign.length > 0) return `client(s) of another company: ${foreign.map(linkLabel).join('; ')}`;
  return null;
}

/**
 * The `facStoppedByTycoon` bit ($04, Kernel/Kernel.pas:107) of the cached `Trouble`
 * (Kernel/KernelCache.pas:417), as '1'/'0' — `undefined` when `Trouble` is absent or not a number.
 */
export function stoppedBit(trouble: string | undefined): string | undefined {
  if (trouble === undefined || trouble.trim() === '') return undefined;
  const parsed = Number(trouble);
  if (!Number.isInteger(parsed)) return undefined;
  return (parsed & 0x04) !== 0 ? '1' : '0';
}

const WORKER_KINDS = [0, 1, 2];

/** What is wrong with a worker-count answer for kinds 0, 1 and 2, or `null`. */
export function workerCountsProblem(counts: WorkerCount[]): string | null {
  const problems: string[] = [];
  for (const kind of WORKER_KINDS) {
    const hit = counts.filter(c => c.kind === kind);
    if (hit.length === 0) problems.push(`kind ${kind} missing`);
    else if (!Number.isFinite(hit[0].workers)) problems.push(`kind ${kind} is not a number`);
  }
  const extra = counts.filter(c => !WORKER_KINDS.includes(c.kind)).map(c => c.kind);
  if (extra.length > 0) problems.push(`unasked kind(s) ${extra.join(', ')}`);
  return problems.length > 0 ? problems.join('; ') : null;
}

/** Every group id and property name of the opening read that the refresh does not carry. */
export function refreshMissingKeys(
  opening: { [groupId: string]: BuildingPropertyValue[] },
  refreshed: { [groupId: string]: BuildingPropertyValue[] },
): string[] {
  const missing: string[] = [];
  for (const [groupId, values] of Object.entries(opening)) {
    const again = refreshed[groupId];
    if (!again) {
      missing.push(groupId);
      continue;
    }
    const names = new Set(again.map(v => v.name));
    for (const v of values) if (!names.has(v.name)) missing.push(`${groupId}.${v.name}`);
  }
  return missing;
}

/**
 * Whether a round trip held: PASS, or UNTESTABLE (the read-back confirmed, the log line could
 * not be observed). Only a FAIL fails the check; `report()` carries an UNTESTABLE probe's note.
 */
export function probeHeld(probe: ProbeResult | undefined): boolean {
  return probe !== undefined && probe.status !== 'FAIL';
}

/** One round trip's verdict, as an assertion naming the member. */
function checkProbe(assertions: Assertions, probe: ProbeResult): void {
  assertions.check(`${probe.member}: the write read back and was restored`, probeHeld(probe), probe.note);
}

/**
 * A log window opened before a write, or why it could not be: a log that cannot be read is a
 * reason the line is unobservable, never a failed write (maintainer decision 2026-10-05).
 */
export interface OpenedLog {
  url: string;
  window: LogWindow | null;
  fault?: string;
}

/** One search of the log for a line: the line, or `null` with the fault that stopped the read. */
export interface LogLook {
  line: string | null;
  /** Why the log could not be read at all — absent when it was read and held no line. */
  fault?: string;
  /** The window searched, when the search ran. */
  window?: LogWindow;
}

/** Open the log window without throwing — the fault is kept for the UNTESTABLE reason. */
export async function openLog(url: string): Promise<OpenedLog> {
  try {
    return { url, window: await openLogWindow(url) };
  } catch (err: unknown) {
    return { url, window: null, fault: `the log window could not be opened: ${toErrorMessage(err)}` };
  }
}

/** Find the current Survival log and open its window, without throwing. */
export async function openSurvivalLog(ctx: FlowContext): Promise<OpenedLog> {
  let url: string;
  try {
    url = await survivalUrl(ctx);
  } catch (err: unknown) {
    return { url: '(the Survival log)', window: null, fault: `the current Survival log could not be found: ${toErrorMessage(err)}` };
  }
  return openLog(url);
}

/** Look for a line in an opened log without throwing. */
export async function lookForLine(
  opened: OpenedLog,
  find: (window: LogWindow) => Promise<string | null>,
): Promise<LogLook> {
  if (opened.window === null) return { line: null, fault: opened.fault };
  try {
    return { line: await find(opened.window), window: opened.window };
  } catch (err: unknown) {
    return { line: null, fault: `the log could not be read: ${toErrorMessage(err)}` };
  }
}

/** What was looked for and where, and why it was not seen — the UNTESTABLE reason's head. */
export function logMissReason(look: LogLook, marker: string, url: string): string {
  return look.fault !== undefined
    ? `no "${marker}" line could be looked for in ${url} — ${look.fault}`
    : describeLogMiss(look.window, `no "${marker}" within ${TIMEOUTS.logSettle} ms in ${url}`);
}

/**
 * Record a log-line check (maintainer decision 2026-10-05, doc/E2E-POLICY.md §5). A line seen
 * passes. A line missing or unreadable is UNTESTABLE — the line proves receipt only, and the
 * agreeing evidence (`agrees`, e.g. the read-back) is what was observed. Returns whether it was seen.
 */
export function checkLogLine(
  assertions: Assertions,
  what: string,
  look: LogLook,
  where: { marker: string; url: string },
  agrees: string,
  untestableWhat: string = what,
): boolean {
  const seen = look.line !== null;
  if (seen) assertions.check(what, seen, look.line ?? undefined);
  else assertions.untestable(untestableWhat, `${logMissReason(look, where.marker, where.url)} — ${agrees}`);
  return seen;
}

async function survivalUrl(ctx: FlowContext): Promise<string> {
  return ctx.survivalLogUrl ?? (await findCurrentSurvivalLog());
}

/** The industry half of inspector-reads: one supply and one product gate, connections parsed. */
async function readIndustryGates(session: LiveSession, fx: OwnFixture, assertions: Assertions): Promise<void> {
  for (const tabId of ['supplies', 'products'] as const) {
    const stubs = await gateStubs(session, fx, tabId);
    assertions.check(`the industry fixture lists a ${tabId} gate`, stubs.length > 0, `${stubs.length} gate(s)`);
    if (stubs.length === 0) continue;
    const response = await gateConnections(session, fx, tabId, stubs[0]);
    const gate = tabId === 'supplies' ? response.supply : response.product;
    assertions.check(
      `${tabId} gate "${stubs[0].name}": header and connections parsed`,
      gate !== undefined &&
        Boolean(gate.metaFluid) &&
        typeof gate.connectionCount === 'number' &&
        Array.isArray(gate.connections),
      gate ? `metaFluid ${gate.metaFluid ?? '(none)'}, ${String(gate.connectionCount)} connection(s)` : 'no gate in the answer',
    );
    if (gate === undefined) continue;
    // #1347: the same gate, header only — the count without the rows.
    const lite = await gateConnections(session, fx, tabId, stubs[0], true);
    const liteGate = tabId === 'supplies' ? lite.supply : lite.product;
    const label = `${tabId} gate "${stubs[0].name}" headerOnly`;
    assertions.check(`${label}: the answer echoes headerOnly`, lite.headerOnly === true, `headerOnly ${String(lite.headerOnly)}`);
    assertions.check(
      `${label}: connections is empty`,
      liteGate !== undefined && liteGate.connections.length === 0,
      liteGate ? `${liteGate.connections.length} row(s)` : 'no gate in the answer',
    );
    assertions.check(
      `${label}: connectionCount equals the full read's`,
      liteGate?.connectionCount === gate.connectionCount,
      `header-only ${String(liteGate?.connectionCount)}, full ${String(gate.connectionCount)}`,
    );
  }
}

/** The store half of inspector-reads: service figures, worker counts, and a refresh. */
async function readStoreFigures(session: LiveSession, fx: OwnFixture, assertions: Assertions): Promise<void> {
  const opening = await readBuildingDetails(session, fx.x, fx.y, fx.visualClass);

  const figures = await session.driver.request<WsRespBuildingServiceFigures>(
    { type: WsMessageType.REQ_BUILDING_SERVICE_FIGURES, x: fx.x, y: fx.y, serviceIndex: 0 },
    WsMessageType.RESP_BUILDING_SERVICE_FIGURES,
  );
  assertions.check(
    'service 0: supply and demand are present',
    figures.supply !== '' && figures.demand !== '',
    `supply "${figures.supply}", demand "${figures.demand}"`,
  );

  const workers = await session.driver.request<WsRespBuildingWorkerCounts>(
    { type: WsMessageType.REQ_BUILDING_WORKER_COUNTS, x: fx.x, y: fx.y, kinds: WORKER_KINDS },
    WsMessageType.RESP_BUILDING_WORKER_COUNTS,
  );
  const problem = workerCountsProblem(workers.counts);
  assertions.check(
    'worker counts: a number for each of kinds 0, 1 and 2',
    problem === null,
    problem ?? workers.counts.map(c => `${c.kind}=${c.workers}`).join(' '),
  );

  // "Same keys" is "every key the opening read carried comes back": a refresh without the tab
  // scope reads the whole template (refreshBuildingProperties), so it may carry more.
  const activeTabId = Object.keys(opening.groups)[0];
  const refreshed = await session.driver.request<WsRespBuildingRefreshProperties>(
    { type: WsMessageType.REQ_BUILDING_REFRESH_PROPERTIES, x: fx.x, y: fx.y, visualClass: fx.visualClass, activeTabId },
    WsMessageType.RESP_BUILDING_REFRESH_PROPERTIES,
  );
  const missing = refreshMissingKeys(opening.groups, refreshed.details.groups);
  assertions.check(
    'refresh properties: every key of the opening read comes back',
    missing.length === 0,
    missing.length > 0 ? `missing: ${missing.join(' ')}` : `groups: ${Object.keys(refreshed.details.groups).join(' ')}`,
  );
}

/**
 * The inspector reads no other flow sends: gate connections (industry), service figures, worker
 * counts and a property refresh (store). No write.
 */
const inspectorReads: Flow = {
  name: 'inspector-reads',
  what:
    "SPO_test3's industry and store fixtures: gate connections (one supply, one product), service 0 " +
    'figures, worker counts 0..2, refresh properties — no write',
  // Its seed may build a permanent fixture (#1185).
  mutates: true,
  seed: fixtureSeed('industry', 'store'),
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const industry = await ownFixture(session, 'industry', assertions);
      if (industry) await readIndustryGates(session, industry, assertions);
      const store = await ownFixture(session, 'store', assertions);
      if (store) await readStoreFigures(session, store, assertions);
      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('inspector-reads', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

const NO_WORKFORCE_REASON =
  "the store fixture's template carries no workforce group (WORKFORCE_GROUP) — FIXTURE_KINDS' store kind " +
  'does not require it (#1149)';

const NO_SALARY_CLASS_REASON =
  "the store fixture publishes no salary class — TWorkCenter.StoreToCache writes Salaries<k> only for a " +
  'class with capacity (Kernel/WorkCenterBlock.pas:567-571), so no write could be read back';

/**
 * The store's owner settings: service 0's price (`TServiceBlock.RDOSetPrice`,
 * StdBlocks/ServiceBlock.pas:1578) and the salary triplet (`TWorkCenter.RDOSetSalaries`,
 * Kernel/WorkCenterBlock.pas:582). Both set back to the values read.
 */
const storePriceSalaries: Flow = {
  name: 'store-price-salaries',
  what:
    "round trips on SPO_test3's store fixture: RDOSetPrice (service 0, an even value) and RDOSetSalaries " +
    '(the whole triplet) — Survival line + read-back, restored',
  mutates: true,
  seed: fixtureSeed('store'),
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const fx = await ownFixture(session, 'store', assertions);
      if (!fx) return report('store-price-salaries', assertions, probes, session);
      const url = await survivalUrl(ctx);
      const details = await readBuildingDetails(session, fx.x, fx.y, fx.visualClass);

      const readPrice = async (): Promise<string | undefined> =>
        propertyValue(await readSectionGroups(session, fx.x, fx.y, 'srvGeneral', fx.visualClass), 'srvGeneral', 'srvPrices0');
      const price = await roundTripProbe(ctx, url, {
        what: `${fixtureLabel(fx)} service 0 price`,
        member: 'RDOSetPrice',
        read: readPrice,
        write: async value => {
          await setBuildingProperty(session, fx.x, fx.y, 'RDOSetPrice', value, { index: '0' });
        },
        testValue: evenPriceNudge,
        proof: {
          log: { marker: LOG_MARKERS.RDOSetPrice, match: servicePriceLineMatches },
          readBack: readBackOn(
            `srvGeneral.srvPrices0 at (${fx.x},${fx.y}) via the gateway's section read`,
            `${FACILITY_CACHE_WHY}; the price is stored halved and published doubled (StdBlocks/ServiceBlock.pas:1585, :1731)`,
            readPrice,
            servicePriceQuantised,
          ),
        },
        restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOSetPrice', additionalParams: { index: '0' } },
      });
      probes.push(price);
      checkProbe(assertions, price);

      if (!details.tabs.some(t => t.id === 'workforce')) {
        assertions.untestable('RDOSetSalaries', NO_WORKFORCE_REASON);
        return report('store-price-salaries', assertions, probes, session);
      }

      const readSalaries = async (): Promise<string | undefined> => {
        const groups = await readSectionGroups(session, fx.x, fx.y, 'workforce', fx.visualClass);
        const values = WORKER_KINDS.map(i => propertyValue(groups, 'workforce', `Salaries${i}`));
        return values.some(v => v === undefined) ? undefined : values.join(',');
      };
      const before = await readSalaries();
      if (before !== undefined && before.split(',').every(s => s.trim() === '')) {
        assertions.untestable('RDOSetSalaries', NO_SALARY_CLASS_REASON);
        return report('store-price-salaries', assertions, probes, session);
      }
      const salaries = await roundTripProbe(ctx, url, {
        what: `${fixtureLabel(fx)} salaries (hi,mid,lo)`,
        member: 'RDOSetSalaries',
        read: readSalaries,
        write: async value => {
          const [salary0, salary1, salary2] = value.split(',').map(salaryArg);
          // The whole triplet, the untouched two unchanged — buildRdoCommandArgs requires all three.
          await setBuildingProperty(session, fx.x, fx.y, 'RDOSetSalaries', salary0, { salary0, salary1, salary2 });
        },
        testValue: salariesNudge,
        proof: {
          log: {
            marker: LOG_MARKERS.RDOSetSalaries,
            match: (line, written) => {
              const [hi, mid, lo] = written.split(',').map(salaryArg);
              return salariesLineMatches(line, hi, mid, lo);
            },
          },
          readBack: {
            ...readBackOn(
              `workforce.Salaries0..2 at (${fx.x},${fx.y}) via the gateway's section read, published classes only`,
              `${FACILITY_CACHE_WHY}; the three values are stored verbatim (Kernel/WorkCenterBlock.pas:590-593), ` +
                'and only a class with capacity is published (:567-571)',
              readSalaries,
            ),
            matches: publishedSalariesMatch,
          },
        },
        restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOSetSalaries' },
      });
      probes.push(salaries);
      checkProbe(assertions, salaries);
      return report('store-price-salaries', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * A product gate's price (`TFacility.RDOSetOutputPrice`, Kernel/Kernel.pas:4332), driven only on
 * a gate whose clients all belong to one of SPO_test3's companies — a price change can drop another player's link
 * (`outputPriceRefusal`). The client list after the restore must equal its snapshot.
 */
const industryOutputPrice: Flow = {
  name: 'industry-output-price',
  what:
    "round trip on RDOSetOutputPrice at SPO_test3's industry fixture, on a product gate with no client of " +
    "another player's company — Survival line + read-back, restored, client links unchanged",
  mutates: true,
  seed: fixtureSeed('industry'),
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const fx = await ownFixture(session, 'industry', assertions);
      if (!fx) return report('industry-output-price', assertions, probes, session);

      const tycoon = await listTycoonFacilities(session);
      const own: OwnClients = {
        companies: new Set([session.company.name, ...tycoon.companies]),
        lots: new Set(tycoon.facilities.map(f => `${f.x},${f.y}`)),
      };
      const refusals: string[] = [];
      let chosen: { name: string; product: BuildingProductData; fluid: string } | undefined;
      for (const stub of await gateStubs(session, fx, 'products')) {
        const product = (await gateConnections(session, fx, 'products', stub)).product;
        const refusal = outputPriceRefusal(product, own);
        if (refusal === null && product?.metaFluid) {
          chosen = { name: stub.name, product, fluid: product.metaFluid };
          break;
        }
        refusals.push(`${stub.name}: ${refusal ?? 'no fluid'}`);
      }
      if (!chosen) {
        assertions.untestable(
          'RDOSetOutputPrice',
          `no product gate is safe to drive — a price change re-checks every client link and drops a failing ` +
            `one (Kernel/Kernel.pas:7193-7205): ${refusals.length > 0 ? refusals.join(' | ') : 'the fixture lists no product gate'}`,
        );
        return report('industry-output-price', assertions, probes, session);
      }

      const { name, product, fluid } = chosen;
      const snapshot = product.connections;
      const readPrice = async (): Promise<string | undefined> => (await readProduct(session, fx, name))?.pricePc;
      const url = await survivalUrl(ctx);
      const probe = await roundTripProbe(ctx, url, {
        what: `${fixtureLabel(fx)} ${name} output price`,
        member: 'RDOSetOutputPrice',
        read: readPrice,
        write: async value => {
          await setBuildingProperty(session, fx.x, fx.y, 'RDOSetOutputPrice', value, { fluidId: fluid });
        },
        testValue: original => nudgeWithin(original, 0, 400),
        proof: {
          log: {
            marker: LOG_MARKERS.RDOSetOutputPrice,
            match: (line, written) => facLineMatches(line, fx.x, fx.y, `Output price set: ${fluid} to ${written}`),
          },
          readBack: readBackOn(`the ${name} product gate's PricePc via REQ_BUILDING_GATE_CONNECTIONS`, GATE_CACHE_WHY, readPrice),
        },
        restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOSetOutputPrice', additionalParams: { fluidId: fluid } },
      });
      probes.push(probe);
      checkProbe(assertions, probe);

      const after = await readProduct(session, fx, name);
      const diff = clientLinksDiff(snapshot, after?.connections ?? []);
      const kept = diff.lost.length === 0 && diff.gained.length === 0 && after?.connectionCount === product.connectionCount;
      assertions.check(
        `the ${name} gate's client links equal their snapshot after the restore`,
        kept,
        kept
          ? `${snapshot.length} client link(s)`
          : `lost: ${diff.lost.join('; ') || '(none)'} — gained: ${diff.gained.join('; ') || '(none)'} — ` +
              `count ${String(product.connectionCount)} -> ${String(after?.connectionCount)}`,
      );
      return report('industry-output-price', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * A supply gate's limits: max price and min quality (`TFacility.RDOSetInputMaxPrice` /
 * `RDOSetInputMinK`, Kernel/Kernel.pas:4390-4420). Nightly only (routing.ts).
 *
 * Sort mode and overprice are **excluded**, never driven (#1195):
 * - `RDOSetInputSortMode` — only `TMediaInput` caches `QPSorted` / `SortMode`
 *   (Kernel/MediaGates.pas:388-389), and its sole user is the movie theatre's Films input
 *   (StdBlocks/Movie.pas:84); a plain input's `SetSortMode` is empty (Kernel/Kernel.pas:7169-7171).
 *   No sanctioned fixture kind (FIXTURE_KINDS, E2E-POLICY §9) is a movie theatre.
 * - `RDOSetInputOverPrice` — set per supplier row; overpaying another player's supplier touches
 *   that player's income (§9), and an own row exists only after `supplier-hire-fire` (#1153),
 *   itself nightly-only and data-gated.
 */
const industrySupplyLimits: Flow = {
  name: 'industry-supply-limits',
  what:
    "round trips on RDOSetInputMaxPrice / MinK at SPO_test3's industry fixture — Survival line + read-back " +
    'each, restored; RDOSetInputSortMode / RDOSetInputOverPrice are excluded (no fixture carries them)',
  mutates: true,
  seed: fixtureSeed('industry'),
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const fx = await ownFixture(session, 'industry', assertions);
      if (!fx) return report('industry-supply-limits', assertions, probes, session);

      let gate: { name: string; supply: BuildingSupplyData; fluid: string } | undefined;
      for (const stub of await gateStubs(session, fx, 'supplies')) {
        const supply = (await gateConnections(session, fx, 'supplies', stub)).supply;
        if (supply?.metaFluid && supply.maxPrice !== undefined) {
          gate = { name: stub.name, supply, fluid: supply.metaFluid };
          break;
        }
      }
      if (!gate) {
        assertions.untestable(
          'the supply limits',
          'no supply gate of the industry fixture publishes MaxPrice — only a TPullInput caches it (Kernel/Kernel.pas:7813)',
        );
        return report('industry-supply-limits', assertions, probes, session);
      }

      const { name, fluid } = gate;
      const url = await survivalUrl(ctx);
      const fresh = (): Promise<BuildingSupplyData | undefined> => readSupply(session, fx, name);
      const source = (field: string): string => `the ${name} supply gate's ${field} via REQ_BUILDING_GATE_CONNECTIONS`;
      const facMatch = (text: string) => (line: string, written: string): boolean =>
        facLineMatches(line, fx.x, fx.y, `${text}: ${fluid} to ${written}`);
      const writeGate = (member: string) => async (value: string): Promise<void> => {
        await setBuildingProperty(session, fx.x, fx.y, member, value, { fluidId: fluid });
      };

      const readMaxPrice = async (): Promise<string | undefined> => (await fresh())?.maxPrice;
      const maxPrice = await roundTripProbe(ctx, url, {
        what: `${fixtureLabel(fx)} ${name} input max price`,
        member: 'RDOSetInputMaxPrice',
        read: readMaxPrice,
        write: writeGate('RDOSetInputMaxPrice'),
        testValue: original => nudgeWithin(original, 0, 400),
        proof: {
          log: { marker: LOG_MARKERS.RDOSetInputMaxPrice, match: facMatch('Input max price set') },
          readBack: readBackOn(source('MaxPrice'), GATE_CACHE_WHY, readMaxPrice),
        },
        restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOSetInputMaxPrice', additionalParams: { fluidId: fluid } },
      });
      probes.push(maxPrice);
      checkProbe(assertions, maxPrice);

      const readMinK = async (): Promise<string | undefined> => (await fresh())?.minK;
      const minK = await roundTripProbe(ctx, url, {
        what: `${fixtureLabel(fx)} ${name} input min K`,
        member: 'RDOSetInputMinK',
        read: readMinK,
        write: writeGate('RDOSetInputMinK'),
        testValue: original => nudgeWithin(original, 0, 100),
        proof: {
          log: { marker: LOG_MARKERS.RDOSetInputMinK, match: facMatch('Input min K set') },
          readBack: readBackOn(source('minK'), GATE_CACHE_WHY, readMinK),
        },
        restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOSetInputMinK', additionalParams: { fluidId: fluid } },
      });
      probes.push(minK);
      checkProbe(assertions, minK);

      return report('industry-supply-limits', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * The ad percentage Voyager shows: `min(100, round(100*nfActualMaxFluidValue/nfCapacity))`
 * (Voyager/AdvSheetForm.pas:651-660). Undefined when either value is absent or not a number, or
 * when the capacity is not positive — nothing to compare a write with.
 */
export function adPercent(actualMaxFluid: string | undefined, capacity: string | undefined): string | undefined {
  if (actualMaxFluid === undefined || capacity === undefined) return undefined;
  if (actualMaxFluid.trim() === '' || capacity.trim() === '') return undefined;
  const fld = Number(actualMaxFluid);
  const cap = Number(capacity);
  if (!Number.isFinite(fld) || !Number.isFinite(cap) || cap <= 0) return undefined;
  return String(Math.min(100, roundHalfEven((100 * fld) / cap)));
}

/** `tidFluid_Advertisement` (StdBlocks/StdFluids.pas:32) — the gate's fluid, and its name. */
const ADVERTISEMENT = 'Advertisement';

/**
 * The ad budget — `TInput.RDOSetInputFluidPerc` (Kernel/Kernel.pas:1508, body :7154-7160, log :7156)
 * on the Advertisement input of SPO_test3's research fixture.
 *
 * The research fixture, not the store: a food store declares only its food input gates
 * (StdBlocks/FoodStore.pas:71-100) and takes advertisement as a company input
 * (StdBlocks/ServiceBlock.pas:540), so the gate-bound member has nothing to address there. The
 * general headquarters declares an Advertisement `TPullInput`, cacheable and editable
 * (Kernel/Headquarters.pas:130-143). The gateway binds the write to that input's own ObjectId, as
 * Voyager does (Voyager/AdvSheetForm.pas:456-457).
 *
 * The proof is the Survival log line, not a read-back (maintainer decision 2026-10-01, #1195
 * option c). A read-back can never show the write: Advertisement is a company fluid
 * (StdBlocks/StdFluids.pas:499, mfCompanyFluid), so the input joins its company's TCompanyInput
 * (Kernel/Kernel.pas:5232-5233, :10323-10329), whose `Spread` runs every company cycle (:10160)
 * and overwrites ActualMaxFluid from the demand slices (`UpdateMaxFluids`, :10003-10008) — so the
 * percentage read back is the spread's, whatever was written. The write PASSes on its own
 * `Setting Input fluid perc: <value>` line at the fixture's coordinates (Kernel/Kernel.pas:7156);
 * the original percentage is still read first, written back afterwards, and the restore is proven
 * by its own line. A missing write line FAILs; a missing restore line FAILs and keeps the pending
 * restore. This exception is this flow's alone — every other round trip still needs its read-back.
 */
const adBudgetRoundTrip: Flow = {
  name: 'ad-budget-roundtrip',
  what:
    "round trip on RDOSetInputFluidPerc at the Advertisement input of SPO_test3's research (HQ) fixture — " +
    'proven by the Survival line of the write and of the restore (no read-back: Kernel/Kernel.pas:10003-10008, :10160)',
  mutates: true,
  seed: fixtureSeed('research'),
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const fx = await ownFixture(session, 'research', assertions);
      if (!fx) return report('ad-budget-roundtrip', assertions, probes, session);

      const details = await readBuildingDetails(session, fx.x, fx.y, fx.visualClass);
      let gate: GateStub | undefined;
      if (details.tabs.some(t => t.id === 'supplies')) {
        for (const stub of await gateStubs(session, fx, 'supplies')) {
          if ((await gateConnections(session, fx, 'supplies', stub)).supply?.metaFluid === ADVERTISEMENT) {
            gate = stub;
            break;
          }
        }
      }
      if (!gate) {
        assertions.untestable(
          'RDOSetInputFluidPerc',
          `${fixtureLabel(fx)} lists no ${ADVERTISEMENT} input — the HQ declares one (Kernel/Headquarters.pas:130-143); ` +
            'nothing written',
        );
        return report('ad-budget-roundtrip', assertions, probes, session);
      }

      const { name } = gate;
      const supply = await readSupply(session, fx, name);
      const original = adPercent(supply?.actualMaxFluid, supply?.capacity);
      if (original === undefined) {
        assertions.check(
          'RDOSetInputFluidPerc: the original ad percentage is readable',
          false,
          `${fixtureLabel(fx)} ${name} input has no readable percentage — nothing to restore to, nothing written`,
        );
        return report('ad-budget-roundtrip', assertions, probes, session);
      }
      const url = await survivalUrl(ctx);
      probes.push(await adBudgetLogRoundTrip(ctx, url, session, fx, name, original, assertions));
      return report('ad-budget-roundtrip', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * The ad budget's write and restore, each proven by its own Survival line — no read-back (see
 * `adBudgetRoundTrip`). The pending restore is recorded before the write and cleared only when
 * the restore's line is seen: with no read-back, nothing observable could agree with a restore
 * whose line is missing, so it still FAILs — the one exception to option b (maintainer decision
 * 2026-10-05, doc/E2E-POLICY.md §9). A missing or unreadable *write* line is UNTESTABLE.
 */
async function adBudgetLogRoundTrip(
  ctx: FlowContext,
  url: string,
  session: LiveSession,
  fx: OwnFixture,
  name: string,
  original: string,
  assertions: Assertions,
): Promise<ProbeResult> {
  const written = nudgeWithin(original, 0, 100);
  const set = async (value: string): Promise<void> => {
    await setBuildingProperty(session, fx.x, fx.y, 'RDOSetInputFluidPerc', value, { fluidId: ADVERTISEMENT });
  };
  const lineFor = (window: LogWindow, value: string): Promise<string | null> =>
    awaitMarker(
      window,
      {
        marker: LOG_MARKERS.RDOSetInputFluidPerc,
        match: l => facLineMatches(l, fx.x, fx.y, `Setting Input fluid perc: ${value}`),
      },
      TIMEOUTS.logSettle,
    );
  const what = `${fixtureLabel(fx)} ${name} input fluid percentage (the ad budget)`;
  const key = `RDOSetInputFluidPerc:${randomUUID()}`;
  ctx.lock.addPendingRestore({
    key,
    what: `${what} — put back "${original}"`,
    originalValue: original,
    x: fx.x,
    y: fx.y,
    propertyName: 'RDOSetInputFluidPerc',
    additionalParams: { fluidId: ADVERTISEMENT },
  });

  const marker = LOG_MARKERS.RDOSetInputFluidPerc;
  let logLine: string | null = null;
  let writeThrew = false;
  let untestable: string | null = null;
  // Each log is opened and searched apart from its write: a log fault is never the write's.
  const writeLog = await openLog(url);
  try {
    await set(written);
    const look = await lookForLine(writeLog, window => lineFor(window, written));
    logLine = look.line;
    if (logLine === null) {
      untestable = `the write of ${written}'s Setting Input fluid perc line: ${logMissReason(look, marker, url)}`;
    } else {
      assertions.check(`RDOSetInputFluidPerc: the write of ${written} logged its Setting Input fluid perc line`, logLine !== '', logLine);
    }
  } catch (err: unknown) {
    writeThrew = true;
    assertions.check(`RDOSetInputFluidPerc: the write of ${written} was accepted`, false, toErrorMessage(err));
  }

  // The restore runs whatever happened above.
  let restoreLook: LogLook = { line: null };
  const restoreLog = await openLog(url);
  try {
    await set(original);
    restoreLook = await lookForLine(restoreLog, window => lineFor(window, original));
  } catch (err: unknown) {
    assertions.check(`RDOSetInputFluidPerc: the restore to ${original} was accepted`, false, toErrorMessage(err));
  }
  const restoreLine = restoreLook.line;
  const restored = restoreLine !== null;
  if (restored) ctx.lock.clearPendingRestore(key);
  assertions.check(
    `RDOSetInputFluidPerc: the restore to ${original} logged its Setting Input fluid perc line`,
    restored,
    restoreLine ??
      `${describeLogMiss(restoreLook.window, 'no restore line')}${restoreLook.fault ? ` (${restoreLook.fault})` : ''} — pending restore kept`,
  );

  const failed = writeThrew || !restored;
  const proof =
    'proven by the Survival lines alone — TCompanyInput.Spread overwrites the read-back every cycle ' +
    '(Kernel/Kernel.pas:10003-10008, :10160; maintainer decision 2026-10-01)';
  return {
    what,
    member: 'RDOSetInputFluidPerc',
    status: failed ? 'FAIL' : untestable !== null ? 'UNTESTABLE' : 'PASS',
    original,
    written,
    logLine,
    readBack: 'UNCONFIRMED',
    restored,
    note: untestable !== null ? `${untestable}; ${proof}` : proof,
  };
}

/**
 * Stop and restart the store (`TFacility.SetStopped`, Kernel/Kernel.pas:3948). `Stopped` is
 * set-only; the read-back is the `facStoppedByTycoon` bit of the cached `Trouble` (`stoppedBit`).
 */
const facilityOpenClose: Flow = {
  name: 'facility-open-close',
  what:
    "round trip on Stopped at SPO_test3's store fixture — the Stopping Facility. line + the Trouble " +
    'facStoppedByTycoon bit read back, restored',
  mutates: true,
  seed: fixtureSeed('store'),
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const fx = await ownFixture(session, 'store', assertions);
      if (!fx) return report('facility-open-close', assertions, probes, session);
      const url = await survivalUrl(ctx);
      const readStopped = async (): Promise<string | undefined> =>
        stoppedBit(
          propertyValue(await readSectionGroups(session, fx.x, fx.y, 'srvGeneral', fx.visualClass), 'srvGeneral', 'Trouble'),
        );
      const probe = await roundTripProbe(ctx, url, {
        what: `${fixtureLabel(fx)} stopped by its owner`,
        member: 'Stopped',
        read: readStopped,
        write: async bit => {
          // A boolean property travels as #-1 / #0.
          await setBuildingProperty(session, fx.x, fx.y, 'property', bit === '1' ? '-1' : '0', { propertyName: 'Stopped' });
        },
        testValue: original => (original === '1' ? '0' : '1'),
        // The line carries no coordinates (Kernel/Kernel.pas:3950): the read-back attributes it.
        proof: {
          log: { marker: LOG_MARKERS.Stopped },
          readBack: readBackOn(
            `the facStoppedByTycoon bit ($04, Kernel/Kernel.pas:107) of srvGeneral.Trouble at (${fx.x},${fx.y})`,
            `Stopped is set-only; Trouble is what the facility caches (Kernel/KernelCache.pas:417). ${FACILITY_CACHE_WHY}`,
            readStopped,
          ),
        },
        restoreRecord: { x: fx.x, y: fx.y, propertyName: 'Stopped' },
      });
      probes.push(probe);
      checkProbe(assertions, probe);
      return report('facility-open-close', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * A supply gate's auto-buy flag (`RDOSelSelected`, declared on the input gate). It prints no
 * Survival line, so the read-back alone proves it: `Selected` off the gate header
 * (Kernel/Kernel.pas:7815).
 */
const industryAutoBuy: Flow = {
  name: 'industry-auto-buy',
  what: "toggle RDOSelSelected on a supply gate of SPO_test3's industry fixture — read-back, toggled back",
  mutates: true,
  seed: fixtureSeed('industry'),
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const fx = await ownFixture(session, 'industry', assertions);
      if (!fx) return report('industry-auto-buy', assertions, probes, session);

      let gate: { stub: GateStub; name: string; fluid: string } | undefined;
      for (const stub of await gateStubs(session, fx, 'supplies')) {
        const supply = (await gateConnections(session, fx, 'supplies', stub)).supply;
        if (supply?.metaFluid && supply.selected !== undefined) {
          gate = { stub, name: stub.name, fluid: supply.metaFluid };
          break;
        }
      }
      if (!gate) {
        assertions.untestable(
          'RDOSelSelected',
          'no supply gate of the industry fixture publishes Selected — only a TPullInput caches it (Kernel/Kernel.pas:7815)',
        );
        return report('industry-auto-buy', assertions, probes, session);
      }

      const { stub, name, fluid } = gate;
      const url = await survivalUrl(ctx);
      // Read on the gate's own path, never re-listed by name: once Selected is 0 the gate's
      // GateMap bit is 0 (`IsActive`, Kernel/Kernel.pas:5843-5845, :7897-7899) and the
      // Supplies tab stops listing it (Voyager/SupplySheetForm.pas:382) — #1322.
      const readSelected = async (): Promise<string | undefined> =>
        (await gateConnections(session, fx, 'supplies', stub)).supply?.selected;
      const probe = await roundTripProbe(ctx, url, {
        what: `${fixtureLabel(fx)} ${name} auto-buy`,
        member: 'RDOSelSelected',
        read: readSelected,
        write: async value => {
          await setBuildingProperty(session, fx.x, fx.y, 'RDOSelSelected', value, { fluidId: fluid });
        },
        testValue: original => (original === '1' ? '0' : '1'),
        proof: {
          readBack: readBackOn(
            `the ${name} supply gate's Selected via REQ_BUILDING_GATE_CONNECTIONS`,
            `RDOSelSelected prints no Survival line; ${GATE_CACHE_WHY}`,
            readSelected,
          ),
        },
        restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOSelSelected', additionalParams: { fluidId: fluid } },
      });
      probes.push(probe);
      checkProbe(assertions, probe);
      return report('industry-auto-buy', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Inspector flows (#1153) — suppliers, clients, Connect on the map, Quick Trade, trade settings,
// warehouse wares, company input demand
// ---------------------------------------------------------------------------------------------
//
// Every counterpart is SPO_test3's own: a link is written on both gates (`TGate.ConnectTo`,
// Kernel/Kernel.pas:6784-6785), so hiring anyone else would write their facility
// (doc/E2E-POLICY.md §9). A Survival line proves receipt only; the read-back decides.

/** How many search results the reachability read asks about — below REACHABILITY_BATCH_SIZE (10), so one push. */
const REACHABILITY_CANDIDATES = 5;

/** A gate's links as sorted, de-duplicated `x,y` keys joined by a space — its identity for a snapshot. */
export function linkSet(connections: BuildingConnectionData[]): string {
  return [...new Set(connections.map(c => `${c.x},${c.y}`))].sort().join(' ');
}

/** `set` with `key` added, in `linkSet` form. */
function withLink(set: string, key: string): string {
  return [...new Set([...set.split(' ').filter(Boolean), key])].sort().join(' ');
}

/** `ParseGateList` (Kernel/Kernel.pas:4277) reads `x1,y1,x2,y2,` — a trailing comma after each pair. */
function connectionList(keys: string[]): string {
  return keys.map(k => `${k},`).join('');
}

/**
 * The search results a hire may pick: owned by `owner` (a search row's company column is the
 * owner's name — `searchOwn`), on `lot`, in Helartia (or no town given), not already connected to
 * the gate, and not the fixture itself. The owner filter reaches every company of the tycoon,
 * shared fixtures included, so only the expected counterpart's lot is kept; `ownLotRefusal` stays
 * the last check (`runHire`).
 */
export function hireCandidates(
  results: ConnectionSearchResult[],
  connected: BuildingConnectionData[],
  owner: string,
  fx: { x: number; y: number },
  lot: { x: number; y: number },
): ConnectionSearchResult[] {
  const linked = new Set(connected.map(c => `${c.x},${c.y}`));
  return results.filter(
    r =>
      sameName(r.companyName, owner) &&
      r.x === lot.x &&
      r.y === lot.y &&
      (!r.town || r.town === GOVERNED_TOWN) &&
      !linked.has(`${r.x},${r.y}`) &&
      !(r.x === fx.x && r.y === fx.y),
  );
}

/** Every gate of a facility, keyed `supplies:<name>` / `products:<name>`. */
export type GateLinks = Record<string, { fluid: string; keys: string[]; complete: boolean }>;

/**
 * `'snapshot'` when every gate equals its snapshot, `'new-links'` when nothing was lost and at
 * least one link was gained, otherwise the lost links by gate.
 */
export function linkState(snapshot: GateLinks, now: GateLinks): string {
  const lost: string[] = [];
  for (const [gate, before] of Object.entries(snapshot)) {
    const after = new Set(now[gate]?.keys ?? []);
    const missing = before.keys.filter(k => !after.has(k));
    if (missing.length > 0) lost.push(`lost ${gate}: ${missing.join(' ')}`);
  }
  if (lost.length > 0) return lost.join('; ');
  return gainedLinks(snapshot, now).length > 0 ? 'new-links' : 'snapshot';
}

/** The links each gate shows that its snapshot did not. */
export function gainedLinks(
  snapshot: GateLinks,
  now: GateLinks,
): { gate: string; tab: 'supplies' | 'products'; fluid: string; keys: string[] }[] {
  const out: { gate: string; tab: 'supplies' | 'products'; fluid: string; keys: string[] }[] = [];
  for (const [gate, after] of Object.entries(now)) {
    const before = new Set(snapshot[gate]?.keys ?? []);
    const keys = after.keys.filter(k => !before.has(k));
    if (keys.length > 0) out.push({ gate, tab: gate.startsWith('supplies:') ? 'supplies' : 'products', fluid: after.fluid, keys });
  }
  return out;
}

/** Several facilities' `linkState`s as one: any loss wins, then any gain. */
function combinedState(states: string[]): string {
  const lost = states.filter(s => s !== 'snapshot' && s !== 'new-links');
  if (lost.length > 0) return lost.join('; ');
  return states.includes('new-links') ? 'new-links' : 'snapshot';
}

/** The first `RDOSetRole` argument the client offers that differs from the original (TRADE_MODE_VALUES). */
export function tradeRoleNudge(original: string): string {
  const current = parseInt(original, 10);
  return String(TRADE_MODE_VALUES.find(v => v !== current) ?? TRADE_MODE_VALUES[0]);
}

/** Another trade level the client offers (TRADE_LEVEL_VALUES): 3 (Anyone) <-> 2 (Allies only). */
export function tradeLevelNudge(original: string): string {
  return original === '3' ? '2' : '3';
}

/** A value the trade-level combo can send back (TRADE_LEVEL_VALUES, trade-settings.ts). */
function isTradeLevelValue(raw: string | undefined): boolean {
  return raw !== undefined && /^\d+$/.test(raw.trim()) && TRADE_LEVEL_VALUES.includes(Number(raw));
}

/**
 * The class is an Import or Export Storage: `FID_MegaWarehouseImp` / `FID_MegaWarehouseExp`
 * (Model Extensions/FacIds.pas:109-110), both `TMegaStorage` (General/GeneralPack1.dpr:711-715,
 * :746-750) — the only block publishing `RDOSelectWare` (StdBlocks/MegaWarehouse.pas:25).
 */
export function isMegaStorage(dims: Record<string, FacilityDimensions>, visualClass: string): boolean {
  const facId = dims[visualClass]?.facId;
  return facId === 125 || facId === 126;
}

/** The demand as the slider shows it: `round(100 * cInputDem / cInputMax)`. */
export function companyDemandPercent(dem: number, max: number): number {
  return Math.round((100 * dem) / max);
}

/** The percent to write: 20 points toward the middle. */
export function companyDemandTarget(p0: number): number {
  return p0 >= 50 ? p0 - 20 : p0 + 20;
}

/** The units a percent reads back as: `cInputDem = ceil(units(Max))` (Kernel/Kernel.pas:5878). */
export function companyDemandUnits(p: number, max: number): number {
  return Math.ceil((p * max) / 100);
}

/** One initial-supplier row: its fluid and the page's `facilityId`, verbatim. */
export interface InitialSupplierRow {
  fluidId: string;
  facilityId: string;
}

/**
 * The initial-supplier rows of the facility at (x, y), one per fluid that lists it. `facilityId`
 * is `"x,y,"` (auto-connection-handler.ts) and is kept as the page gives it: `ParseGateList`
 * needs the trailing comma (Kernel/Kernel.pas:4277-4302).
 */
export function initialSupplierRowsAt(data: AutoConnectionsData, x: number, y: number): InitialSupplierRow[] {
  return data.fluids.flatMap(f =>
    f.suppliers
      .filter(s => {
        const [sx, sy] = s.facilityId.split(',');
        return Number(sx) === x && Number(sy) === y;
      })
      .map(s => ({ fluidId: f.fluidId, facilityId: s.facilityId })),
  );
}

/** (x, y) is one of the tycoon's initial suppliers. */
export function initialSupplierAt(data: AutoConnectionsData, x: number, y: number): boolean {
  return initialSupplierRowsAt(data, x, y).length > 0;
}

/**
 * `RDODelAutoConnection` for each row (DeleteDefaultSupplier.asp:11-14 → `TTycoon.RDODelAutoConnection`,
 * Kernel/Kernel.pas:11689): `ModifyAutoConnection` removes the facility found at the row's
 * coordinates and invalidates the tycoon's cache (:11640-11676). Deleting a facility the list no
 * longer holds is a no-op (`TCollection.Delete`, Kernel/Collection.pas:235-242).
 */
async function deleteInitialSupplierRows(session: LiveSession, rows: readonly InitialSupplierRow[]): Promise<void> {
  for (const r of rows) await autoConnectionAction(session, 'delete', r.fluidId, r.facilityId);
}

/** The initial-supplier list's identity: sorted `fluidId:facilityId` entries. */
export function initialSuppliersKey(data: AutoConnectionsData): string {
  return data.fluids
    .flatMap(f => f.suppliers.map(s => `${f.fluidId}:${s.facilityId}`))
    .sort()
    .join(' ');
}

/**
 * A set-property the gateway waits on: `RDOConnectInput` / `RDOConnectOutput` are synchronous
 * (`SYNCHRONOUS_RDO_COMMANDS`, building-property-handler.ts, 5–30 s by its own comment), past
 * the default request bound.
 */
async function setPropertySlow(
  session: LiveSession,
  fx: OwnFixture,
  propertyName: string,
  additionalParams: Record<string, string>,
): Promise<void> {
  await session.driver.request<WsRespBuildingSetProperty>(
    { type: WsMessageType.REQ_BUILDING_SET_PROPERTY, x: fx.x, y: fx.y, propertyName, value: '0', additionalParams },
    WsMessageType.RESP_BUILDING_SET_PROPERTY,
    TIMEOUTS.login,
  );
}

/**
 * A connection search the way the hire dialogs send it, restricted to Helartia and SPO_test3 as
 * owner. `filters.company` is the cache's `Name` argument (Cache Server/CacheServerReportForm.pas:108-109,
 * :217-233), matched against the Company segment of the link-file names (Cache/OutputSearch.pas:166-171,
 * Cache/InputSearch.pas:111-115). `CreateOutputLink` / `CreateInputLink` (Cache/MSObjectCacher.pas:430-480)
 * fill that segment with the owner's name, `Block.Facility.Company.Owner.Name`
 * (Kernel/KernelCache.pas:514-516, :526 inputs; :657-659, :669 outputs), and a row's company column
 * is that same segment (Cache/OutputSearch.pas:81, Cache/InputSearch.pas:74; Cache Server/OutputSearchWrap.pas:33,
 * Cache Server/InputSearchWrap.pas:39). Voyager labels the field "Owner"
 * (Voyager/URLHandlers/OutputSearchHandlerViewer.pas:261, InputSearchHandlerViewer.pas:194). A company
 * name ("SPO_test3 - Green") matches nothing.
 */
async function searchOwn(
  session: LiveSession,
  fx: OwnFixture,
  fluidId: string,
  direction: 'input' | 'output',
): Promise<WsRespSearchConnections> {
  return session.driver.request<WsRespSearchConnections>(
    {
      type: WsMessageType.REQ_SEARCH_CONNECTIONS,
      buildingX: fx.x,
      buildingY: fx.y,
      fluidId,
      direction,
      filters: { town: GOVERNED_TOWN, company: PRIMARY_ACCOUNT.username },
    },
    WsMessageType.RESP_SEARCH_CONNECTIONS,
  );
}

/** Every listed gate of the given tabs, read fresh. A gate that answers nothing is incomplete. */
async function readGateLinks(
  session: LiveSession,
  fx: OwnFixture,
  tabs: readonly ('supplies' | 'products')[],
): Promise<GateLinks> {
  const out: GateLinks = {};
  for (const tabId of tabs) {
    for (const stub of await gateStubs(session, fx, tabId)) {
      const response = await gateConnections(session, fx, tabId, stub);
      const gate = tabId === 'supplies' ? response.supply : response.product;
      out[`${tabId}:${stub.name}`] = gate
        ? {
            fluid: gate.metaFluid ?? '',
            keys: linkSet(gate.connections).split(' ').filter(Boolean),
            complete: gate.connectionCount === gate.connections.length,
          }
        : { fluid: '', keys: [], complete: false };
    }
  }
  return out;
}

const BOTH_TABS = ['supplies', 'products'] as const;
const LINK_WHY = `${GATE_CACHE_WHY}; a link is written on both gates (Kernel/Kernel.pas:6784-6785)`;
const FOREIGN_WHY = 'hiring anyone else writes their gate (Kernel/Kernel.pas:6784-6785, E2E-POLICY §9)';

/**
 * The connection searches the hire dialogs send, read only: one input fluid of the industry
 * fixture, Helartia and SPO_test3 as owner (`searchOwn`), then the road reachability of the first results.
 */
const supplierSearchRead: Flow = {
  name: 'supplier-search-read',
  what:
    "REQ_SEARCH_CONNECTIONS for one input fluid of SPO_test3's industry fixture (Helartia, owner SPO_test3) -> " +
    'REQ_CONNECTION_REACHABILITY for the first candidates — no write',
  // Its seed may build a permanent fixture (#1185).
  mutates: true,
  seed: fixtureSeed('industry'),
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const fx = await ownFixture(session, 'industry', assertions);
      if (!fx) return report('supplier-search-read', assertions, [], session);
      let fluid: string | undefined;
      for (const stub of await gateStubs(session, fx, 'supplies')) {
        const supply = (await gateConnections(session, fx, 'supplies', stub)).supply;
        if (supply?.metaFluid) {
          fluid = supply.metaFluid;
          break;
        }
      }
      assertions.check('the industry fixture lists a supply gate with a fluid', fluid !== undefined, fluid ?? 'none');
      if (fluid !== undefined) {
        const search = await searchOwn(session, fx, fluid, 'input');
        const results = Array.isArray(search.results) ? search.results : undefined;
        // An empty list is an answer: SPO_test3 may own no supplier of that fluid in Helartia.
        assertions.check(
          `REQ_SEARCH_CONNECTIONS answered a candidate list for ${fluid}`,
          results !== undefined,
          results ? `${results.length} candidate(s)` : 'no results array',
        );
        const batch = (results ?? []).slice(0, REACHABILITY_CANDIDATES);
        if (batch.length === 0) {
          // The gateway pushes nothing for an empty list (resolveConnectionReachability): a request
          // sent here would wait for an answer that never comes.
          const sent = session.driver.log.some(
            e => e.direction === 'sent' && e.type === WsMessageType.REQ_CONNECTION_REACHABILITY,
          );
          assertions.check('REQ_CONNECTION_REACHABILITY', !sent, sent ? 'sent for an empty list' : 'not sent: no candidate');
        } else {
          const answer = await session.driver.request<WsRespConnectionReachability>(
            {
              type: WsMessageType.REQ_CONNECTION_REACHABILITY,
              buildingX: fx.x,
              buildingY: fx.y,
              fluidId: fluid,
              direction: 'input',
              candidates: batch.map(r => ({ x: r.x, y: r.y })),
            },
            WsMessageType.RESP_CONNECTION_REACHABILITY,
          );
          const entries = answer.entries ?? [];
          const missing = batch.filter(
            r =>
              !entries.some(
                e => e.x === r.x && e.y === r.y && ['connected', 'isolated', 'unknown'].includes(e.reachability),
              ),
          );
          assertions.check(
            'REQ_CONNECTION_REACHABILITY answered each candidate',
            missing.length === 0,
            missing.length === 0
              ? entries.map(e => `(${e.x},${e.y}) ${e.reachability}`).join(' ')
              : `no answer for ${missing.map(r => `(${r.x},${r.y})`).join(' ')}`,
          );
        }
      }
      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('supplier-search-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/** What a read of the chemical fixture shows that a reset must remove — or could not see. */
interface ChemicalLinks {
  /** Own suppliers, by supply fluid. */
  ownSupplies: { fluid: string; keys: string[] }[];
  /** Own clients, as `<gate>: <linkLabel>`. */
  ownClients: string[];
  /** The plant's rows in the initial-supplier list. */
  initialSupplier: InitialSupplierRow[];
  /** Gates (or the initial-supplier list) that could not be read in full. */
  unread: string[];
}

function chemicalClean(s: ChemicalLinks): boolean {
  return s.ownSupplies.length === 0 && s.ownClients.length === 0 && s.initialSupplier.length === 0 && s.unread.length === 0;
}

/** What is left; `delSent` names an entry that outlived an `RDODelAutoConnection` as such. */
function chemicalRemains(s: ChemicalLinks, delSent: boolean): string {
  const entry = delSent ? 'initial supplier (still listed after RDODelAutoConnection)' : 'initial supplier';
  return [
    ...s.ownSupplies.map(g => `${g.fluid} from ${g.keys.join(' ')}`),
    ...s.ownClients.map(c => `client ${c}`),
    ...(s.initialSupplier.length > 0 ? [entry] : []),
    ...s.unread.map(u => `unread ${u}`),
  ].join(' | ');
}

/**
 * Bring the chemical fixture back to no own link (#1293) before a link flow uses it. A new plant
 * arrives linked: its inputs are hired to the tycoon's initial suppliers (`TTycoon.AutoConnectFacility`,
 * Kernel/Kernel.pas:12346-12390) and every own warehouse is linked both ways (`SearchOwner`,
 * Kernel/World.pas:5216-5238). Only the four link flows use this fixture, so this is self-heal of
 * an isolated target (maintainer rule 2026-10-01, #1236): reset from whatever state it is found in,
 * no pending restore. Every link removed has an SPO_test3 facility on both ends, and a disconnect
 * removes both sides (`TGate.DisconnectFrom`, Kernel/Kernel.pas:6794-6799). `RDODisconnectFromTycoon`
 * drops the plant's outputs from every own facility's matching input (:4581-4600) and, by its
 * RemoveAsDefault flag, calls `UnregisterSupplier` (:4606-4607). That alone was observed not to
 * clear the initial-supplier entry live: on 2026-10-07 it logged `OK.` 8 times (Survival log,
 * 2:27:29-2:51:56) while TycoonAutoConnections.asp kept listing the plant for 24 minutes — past the
 * tycoon cache's 5-minute TTL (Kernel/KernelCache.pas:964), so the model kept (or regained) the
 * entry; why was not identified without probing. So each row the plant holds is also deleted the
 * way the reference client deletes one, `RDODelAutoConnection` with the page's `facilityId`
 * (`deleteInitialSupplierRows`): it removes by `FacilityAt` and invalidates the tycoon's cache
 * (:11640-11676), which covers both a kept entry and a stale page. `RDODisconnectInput` carries own
 * keys only — a foreign link is never touched (FOREIGN_WHY). Returns false after recording the flow
 * untestable; one retry.
 */
async function resetChemical(
  session: LiveSession,
  fx: OwnFixture,
  ctx: FlowContext,
  assertions: Assertions,
  member: string,
): Promise<boolean> {
  const own = await listTycoonFacilities(session);
  const ownCompanies = new Set(own.companies);
  const ownLots = new Set(own.facilities.map(f => `${f.x},${f.y}`));
  const isOwn = (c: BuildingConnectionData): boolean => ownCompanies.has(c.companyName) || ownLots.has(`${c.x},${c.y}`);

  const readState = async (): Promise<ChemicalLinks> => {
    const state: ChemicalLinks = { ownSupplies: [], ownClients: [], initialSupplier: [], unread: [] };
    for (const stub of await gateStubs(session, fx, 'supplies')) {
      const supply = (await gateConnections(session, fx, 'supplies', stub)).supply;
      if (!supply?.metaFluid || supply.connectionCount !== supply.connections.length) {
        state.unread.push(`supplies:${stub.name}`);
        continue;
      }
      const keys = [...new Set(supply.connections.filter(isOwn).map(c => `${c.x},${c.y}`))];
      if (keys.length > 0) state.ownSupplies.push({ fluid: supply.metaFluid, keys });
    }
    for (const stub of await gateStubs(session, fx, 'products')) {
      const product = (await gateConnections(session, fx, 'products', stub)).product;
      if (!product || product.connectionCount !== product.connections.length) {
        state.unread.push(`products:${stub.name}`);
        continue;
      }
      for (const c of product.connections) if (isOwn(c)) state.ownClients.push(`${stub.name}: ${linkLabel(c)}`);
    }
    try {
      state.initialSupplier = initialSupplierRowsAt(await readAutoConnections(session), fx.x, fx.y);
    } catch (err: unknown) {
      state.unread.push(`initial suppliers: ${toErrorMessage(err)}`);
    }
    return state;
  };

  let delSent = false;
  const apply = async (state: ChemicalLinks): Promise<void> => {
    if (state.initialSupplier.length > 0 || state.ownClients.length > 0) {
      await setBuildingProperty(session, fx.x, fx.y, 'RDODisconnectFromTycoon', '0', { kind: WAREHOUSES_KIND });
    }
    if (state.initialSupplier.length > 0) {
      await deleteInitialSupplierRows(session, state.initialSupplier);
      delSent = true;
    }
    for (const g of state.ownSupplies) {
      await setBuildingProperty(session, fx.x, fx.y, 'RDODisconnectInput', '0', {
        fluidId: g.fluid,
        connectionList: connectionList(g.keys),
      });
    }
  };

  const first = await readState();
  if (first.unread.length > 0) {
    assertions.untestable(
      member,
      `chemical fixture reset: cannot see every link of ${fixtureLabel(fx)} — ${first.unread.join(' | ')}; nothing sent`,
    );
    return false;
  }
  if (chemicalClean(first)) return true;

  let last = first;
  for (let attempt = 0; attempt < 2; attempt++) {
    await apply(last);
    const polled = await pollUntil(readState, chemicalClean, ctx);
    if (polled.ok) return true;
    last = polled.last;
  }
  assertions.untestable(member, `chemical fixture reset did not take: ${chemicalRemains(last, delSent)}`);
  return false;
}

/** The first facility linked on a gate of the fixture, supply gates first, with that gate's fluid and direction. */
async function firstLinkedFacility(
  session: LiveSession,
  fx: OwnFixture,
): Promise<{ x: number; y: number; fluid: string; direction: 'input' | 'output' } | undefined> {
  for (const tabId of BOTH_TABS) {
    for (const stub of await gateStubs(session, fx, tabId)) {
      const response = await gateConnections(session, fx, tabId, stub);
      const gate = tabId === 'supplies' ? response.supply : response.product;
      const link = gate?.connections[0];
      if (gate && link) {
        return { x: link.x, y: link.y, fluid: gate.metaFluid ?? '', direction: tabId === 'supplies' ? 'input' : 'output' };
      }
    }
  }
  return undefined;
}

/**
 * The raw road circuits, read only (#1334): REQ_NEAR_CIRCUITS for the industry fixture's tile and
 * a facility linked to it. Each answer is the cached `NearCircuits` (`Kernel/KernelCache.pas:440`),
 * and the pair must compare (`sharesRoadCircuit`) to the verdict REQ_CONNECTION_REACHABILITY gives
 * for the same tiles — both are `readNearCircuits` in politics-handler.ts.
 */
const nearCircuitsRead: Flow = {
  name: 'near-circuits-read',
  what:
    "REQ_NEAR_CIRCUITS for SPO_test3's industry fixture and a facility linked to it -> both NearCircuits, " +
    'non-empty and agreeing with REQ_CONNECTION_REACHABILITY for the pair — no write',
  // Its seed may build a permanent fixture (#1185).
  mutates: true,
  seed: fixtureSeed('industry'),
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const fx = await ownFixture(session, 'industry', assertions);
      if (!fx) return report('near-circuits-read', assertions, [], session);
      const linked = await firstLinkedFacility(session, fx);
      if (!linked) {
        assertions.untestable('a facility linked to the industry fixture', 'no supply or product gate lists a link');
      } else {
        const tiles = [{ x: fx.x, y: fx.y }, { x: linked.x, y: linked.y }];
        const answer = await session.driver.request<WsRespNearCircuits>(
          { type: WsMessageType.REQ_NEAR_CIRCUITS, tiles },
          WsMessageType.RESP_NEAR_CIRCUITS,
        );
        const entries = answer.tiles ?? [];
        const inOrder =
          entries.length === tiles.length && tiles.every((t, i) => entries[i].x === t.x && entries[i].y === t.y);
        assertions.check(
          'REQ_NEAR_CIRCUITS answered one entry per tile, in request order',
          inOrder,
          entries.map(e => `(${e.x},${e.y}) ${JSON.stringify(e.circuits)}`).join(' ') || 'no entries',
        );
        const own = inOrder ? entries[0].circuits : null;
        const theirs = inOrder ? entries[1].circuits : null;
        assertions.check(`the industry fixture's NearCircuits is non-empty (${fx.x},${fx.y})`, !!own, JSON.stringify(own));
        assertions.check(
          `the linked facility's NearCircuits is non-empty (${linked.x},${linked.y})`,
          !!theirs,
          JSON.stringify(theirs),
        );
        if (own && theirs) {
          const reach = await session.driver.request<WsRespConnectionReachability>(
            {
              type: WsMessageType.REQ_CONNECTION_REACHABILITY,
              buildingX: fx.x,
              buildingY: fx.y,
              fluidId: linked.fluid,
              direction: linked.direction,
              candidates: [{ x: linked.x, y: linked.y }],
            },
            WsMessageType.RESP_CONNECTION_REACHABILITY,
          );
          const verdict = (reach.entries ?? []).find(e => e.x === linked.x && e.y === linked.y)?.reachability;
          const expected = sharesRoadCircuit(own, theirs) ? 'connected' : 'isolated';
          assertions.check(
            'NearCircuits agrees with REQ_CONNECTION_REACHABILITY for the pair',
            verdict === expected,
            `NearCircuits says ${expected}, reachability says ${verdict ?? 'nothing'}`,
          );
        }
      }
      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('near-circuits-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/** An id no session's focus returns (a facility id is a pointer), valid for the request's own check. */
export const NEVER_FOCUSED_FACILITY_ID = '1';

/**
 * The status text of own facilities, read without focus (#1335): REQ_BUILDING_FOCUS on two of
 * SPO_test3's fixtures, then REQ_FACILITY_STATUS_BATCH for both ids plus one this session never
 * focused. The batch reads `AllObjectStatusText`, which is the text SwitchFocusEx appends to the
 * id (`Interface Server/InterfaceServer.pas:924-935`), so each answer must name the facility and
 * owner the focus read showed, and carry a money-per-hour figure exactly when focus did — the
 * figure itself may move with a sim tick between the two reads. The never-focused id must come
 * back as a per-id error, refused by the gateway.
 */
const facilityStatusBatchRead: Flow = {
  name: 'facility-status-batch-read',
  what:
    "REQ_BUILDING_FOCUS on SPO_test3's industry and store fixtures, then REQ_FACILITY_STATUS_BATCH for both ids " +
    'and one never focused -> both status texts as focus shows them, the third a per-id error — no write',
  // Its seed may build a permanent fixture (#1185).
  mutates: true,
  seed: fixtureSeed('industry', 'store'),
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const focused: Array<{ fx: OwnFixture; building: BuildingFocusInfo }> = [];
      for (const kind of ['industry', 'store'] as const) {
        const fx = await ownFixture(session, kind, assertions);
        if (!fx) continue;
        const focus = await session.driver.request<WsRespBuildingFocus>(
          { type: WsMessageType.REQ_BUILDING_FOCUS, x: fx.x, y: fx.y },
          WsMessageType.RESP_BUILDING_FOCUS,
        );
        focused.push({ fx, building: focus.building });
      }
      if (focused.length < 2) return report('facility-status-batch-read', assertions, [], session);
      // The batch must not need the focus: drop it before asking.
      await session.driver.request({ type: WsMessageType.REQ_BUILDING_UNFOCUS }, WsMessageType.RESP_CHAT_SUCCESS);

      const ids = [...focused.map(f => f.building.buildingId), NEVER_FOCUSED_FACILITY_ID];
      const answer = await session.driver.request<WsRespFacilityStatusBatch>(
        { type: WsMessageType.REQ_FACILITY_STATUS_BATCH, ids },
        WsMessageType.RESP_FACILITY_STATUS_BATCH,
      );
      const entries = answer.entries ?? [];
      const inOrder = entries.length === ids.length && ids.every((id, i) => entries[i].id === id);
      assertions.check(
        'REQ_FACILITY_STATUS_BATCH answered one entry per id, in request order',
        inOrder,
        entries.map(e => `${e.id}:${e.status}`).join(' ') || 'no entries',
      );
      if (inOrder) {
        focused.forEach(({ fx, building }, i) => {
          const entry = entries[i];
          const label = fixtureLabel(fx);
          assertions.check(`${label}: the batch answered its status text`, entry.status === 'ok', JSON.stringify(entry));
          if (entry.status !== 'ok') return;
          assertions.check(
            `${label}: the batch names the facility and owner focus showed`,
            entry.text.buildingName === building.buildingName && entry.text.ownerName === building.ownerName,
            `batch "${entry.text.buildingName}" / "${entry.text.ownerName}", ` +
              `focus "${building.buildingName}" / "${building.ownerName}"`,
          );
          assertions.check(
            `${label}: the batch carries money per hour exactly when focus does`,
            (entry.text.revenue === '') === (building.revenue === '') &&
              (entry.text.revenue === '' || entry.text.revenuePerHour !== null),
            `batch "${entry.text.revenue}" (${String(entry.text.revenuePerHour)}), focus "${building.revenue}"`,
          );
        });
        const third = entries[ids.length - 1];
        assertions.check(
          `the never-focused id ${NEVER_FOCUSED_FACILITY_ID} is a per-id error`,
          third.status === 'error',
          JSON.stringify(third),
        );
      }
      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('facility-status-batch-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/** One side of a hire: a supplier on an input gate, or a client on an output gate. */
interface HireSide {
  flow: string;
  tab: 'supplies' | 'products';
  direction: 'input' | 'output';
  connect: 'RDOConnectInput' | 'RDOConnectOutput';
  disconnect: 'RDODisconnectInput' | 'RDODisconnectOutput';
  role: string;
  /** `Kernel/Kernel.pas:4304` / `:4311` */
  connected: string;
  /** `Kernel/Kernel.pas:4320` / `:4327` */
  disconnected: string;
}

/**
 * Hire one own counterpart on a gate of the industry fixture, then fire it. The chemical fixture
 * (#1293) is reset first (`resetChemical`) and is the only counterpart taken: Chemicals for a supplier,
 * Raw Chemicals for a client. The search is filtered by owner (`searchOwn`), which reaches every
 * SPO_test3 company, shared fixtures included — so the candidate must be the chemical fixture's lot,
 * in Helartia and not already connected (`hireCandidates`), and its lot's owner is read back last
 * (`ownLotRefusal`); the gate must list exactly its snapshot again after the undo.
 */
async function runHire(side: HireSide, ctx: FlowContext): Promise<FlowResult> {
  const assertions = new Assertions();
  const probes: ProbeResult[] = [];
  const session = await login(PRIMARY_ACCOUNT);
  try {
    const fx = await ownFixture(session, 'industry', assertions);
    if (!fx) return report(side.flow, assertions, probes, session);
    const chem = await ownFixture(session, 'chemical', assertions);
    if (!chem) return report(side.flow, assertions, probes, session);
    if (!(await resetChemical(session, chem, ctx, assertions, side.connect))) return report(side.flow, assertions, probes, session);

    const refusals: string[] = [];
    let target: { name: string; fluid: string; candidate: ConnectionSearchResult } | undefined;
    for (const stub of await gateStubs(session, fx, side.tab)) {
      const response = await gateConnections(session, fx, side.tab, stub);
      const gate = side.tab === 'supplies' ? response.supply : response.product;
      if (!gate?.metaFluid) {
        refusals.push(`${stub.name}: its header was not read`);
        continue;
      }
      if (gate.connectionCount !== gate.connections.length) {
        refusals.push(
          `${stub.name}: ${String(gate.connectionCount)} link(s) listed but ${gate.connections.length} read — ` +
            'an unread link cannot be told from a candidate',
        );
        continue;
      }
      const search = await searchOwn(session, fx, gate.metaFluid, side.direction);
      const results = search.results ?? [];
      const candidates = hireCandidates(results, gate.connections, PRIMARY_ACCOUNT.username, fx, chem);
      if (candidates.length === 0) {
        refusals.push(
          `${stub.name}: no ${side.role} on ${fixtureLabel(chem)} in ${GOVERNED_TOWN} not already connected ` +
            `(${results.length} result(s) for owner ${PRIMARY_ACCOUNT.username})`,
        );
        continue;
      }
      for (const candidate of candidates) {
        const refusal = await ownLotRefusal(session, candidate.x, candidate.y);
        if (refusal === null) {
          target = { name: stub.name, fluid: gate.metaFluid, candidate };
          break;
        }
        refusals.push(`${stub.name}: ${candidate.facilityName} (${candidate.x},${candidate.y}) — ${refusal}`);
      }
      if (target) break;
    }
    if (!target) {
      assertions.untestable(
        side.connect,
        `no ${side.role} owned by ${PRIMARY_ACCOUNT.username} on the chemical fixture's lot in ${GOVERNED_TOWN} for any ${side.tab} gate of the industry ` +
          `fixture — ${FOREIGN_WHY}: ${refusals.length > 0 ? refusals.join(' | ') : `the fixture lists no ${side.tab} gate`}`,
      );
      return report(side.flow, assertions, probes, session);
    }

    const { name, fluid, candidate } = target;
    const key = `${candidate.x},${candidate.y}`;
    const list = connectionList([key]);
    const read = async (): Promise<string | undefined> => {
      const gate = side.tab === 'supplies' ? await readSupply(session, fx, name) : await readProduct(session, fx, name);
      return gate ? linkSet(gate.connections) : undefined;
    };
    const url = await survivalUrl(ctx);
    const undoWindow = await openLogWindow(url);
    const probe = await roundTripProbe(ctx, url, {
      what: `${fixtureLabel(fx)} ${name}: ${side.role} ${candidate.facilityName} (${key})`,
      member: side.connect,
      read,
      testValue: original => withLink(original, key),
      write: async () => {
        await setPropertySlow(session, fx, side.connect, { fluidId: fluid, connectionList: list });
      },
      restore: async () => {
        await setBuildingProperty(session, fx.x, fx.y, side.disconnect, '0', { fluidId: fluid, connectionList: list });
      },
      proof: {
        log: {
          marker: LOG_MARKERS[side.connect],
          match: line => facLineMatches(line, fx.x, fx.y, `${side.connected} ${fluid} to ${list}`),
        },
        readBack: readBackOn(
          `the ${name} ${side.tab} gate's links (x,y) via REQ_BUILDING_GATE_CONNECTIONS`,
          LINK_WHY,
          tolerantRead(read),
        ),
      },
      restoreRecord: {
        x: fx.x,
        y: fx.y,
        propertyName: side.disconnect,
        additionalParams: { fluidId: fluid, connectionList: list },
      },
    });
    probes.push(probe);
    assertions.check(
      `${side.connect}: the gate listed the ${side.role}, and exactly its snapshot again after ${side.disconnect}`,
      probeHeld(probe),
      probe.note,
    );
    // `written` is empty only when the round trip never reached its write (probeFailure);
    // `original` is legitimately empty — a gate with no link.
    if (probe.written !== '') {
      const marker = LOG_MARKERS[side.disconnect];
      const undoLine = await awaitMarker(
        undoWindow,
        {
          marker,
          match: line => line.includes(marker) && facLineMatches(line, fx.x, fx.y, `${side.disconnected} ${fluid} from ${list}`),
        },
        TIMEOUTS.logSettle,
      );
      assertions.check(
        `the undo reached the model server (${marker} line)`,
        undoLine !== null,
        undoLine ?? describeLogMiss(undoWindow, `no "${marker}" line for Fac(${fx.x},${fx.y}) ${fluid} from ${list}`),
      );
    }
    return report(side.flow, assertions, probes, session);
  } finally {
    await logoff(session);
  }
}

/** Hire an own supplier (the chemical fixture, searched by owner) on an input gate of the industry fixture, then fire it. NIGHTLY_ONLY (routing.ts). */
const supplierHireFire: Flow = {
  name: 'supplier-hire-fire',
  what:
    "reset the chemical fixture, then hire an own supplier (Helartia, owner SPO_test3; only the chemical fixture's lot " +
    'taken) on an input of the industry fixture -> Input connected: line + the gate lists it -> fire it -> the gate lists exactly its snapshot',
  mutates: true,
  seed: fixtureSeed('industry', 'chemical'),
  run: ctx =>
    runHire(
      {
        flow: 'supplier-hire-fire',
        tab: 'supplies',
        direction: 'input',
        connect: 'RDOConnectInput',
        disconnect: 'RDODisconnectInput',
        role: 'supplier',
        connected: 'Input connected:',
        disconnected: 'Input disconnect:',
      },
      ctx,
    ),
};

/** Add an own client (the chemical fixture, searched by owner) on an output gate of the industry fixture, then remove it. NIGHTLY_ONLY (routing.ts). */
const clientHireRemove: Flow = {
  name: 'client-hire-remove',
  what:
    "reset the chemical fixture, then add an own client (Helartia, owner SPO_test3; only the chemical fixture's lot " +
    'taken) on an output of the industry fixture -> Output connected: line + the gate lists it -> remove it -> the gate lists exactly its snapshot',
  mutates: true,
  seed: fixtureSeed('industry', 'chemical'),
  run: ctx =>
    runHire(
      {
        flow: 'client-hire-remove',
        tab: 'products',
        direction: 'output',
        connect: 'RDOConnectOutput',
        disconnect: 'RDODisconnectOutput',
        role: 'client',
        connected: 'Output connected:',
        disconnected: 'Output disconnect:',
      },
      ctx,
    ),
};

/** The fluids of `from`'s tab that `to` carries on the opposite tab. */
function sharedFluids(from: GateLinks, to: GateLinks): string[] {
  const opposite = (gate: string): string => (gate.startsWith('supplies:') ? 'products:' : 'supplies:');
  const shared = new Set<string>();
  for (const [gate, g] of Object.entries(from)) {
    if (!g.fluid) continue;
    const prefix = opposite(gate);
    if (Object.entries(to).some(([other, o]) => other.startsWith(prefix) && o.fluid === g.fluid)) shared.add(g.fluid);
  }
  return [...shared];
}

/**
 * Connect on the map (`TWorld.RDOConnectFacilities`, Kernel/World.pas:3710-3726): the industry and
 * chemical fixtures (#1293), both SPO_test3's own; the chemical fixture is reset first
 * (`resetChemical`). It hires every matching fluid in both directions
 * (Kernel/Kernel.pas:5470-5513), so every gate of both facilities is snapshotted and every new
 * link is undone. NIGHTLY_ONLY (routing.ts).
 */
const connectOnMap: Flow = {
  name: 'connect-on-map',
  what:
    'REQ_CONNECT_FACILITIES between the industry and chemical fixtures (the chemical one reset first) -> a new link read back -> every new link ' +
    'disconnected -> both facilities\' inputs and outputs equal their snapshot',
  mutates: true,
  seed: fixtureSeed('industry', 'chemical'),
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const industry = await ownFixture(session, 'industry', assertions);
      const chemical = industry ? await ownFixture(session, 'chemical', assertions) : undefined;
      if (!industry || !chemical) return report('connect-on-map', assertions, probes, session);
      if (!(await resetChemical(session, chemical, ctx, assertions, 'ConnectFacilities'))) {
        return report('connect-on-map', assertions, probes, session);
      }

      const snapIndustry = await readGateLinks(session, industry, BOTH_TABS);
      const snapChemical = await readGateLinks(session, chemical, BOTH_TABS);
      const incomplete = [
        ...Object.entries(snapIndustry).filter(([, g]) => !g.complete).map(([gate]) => `${fixtureLabel(industry)} ${gate}`),
        ...Object.entries(snapChemical).filter(([, g]) => !g.complete).map(([gate]) => `${fixtureLabel(chemical)} ${gate}`),
      ];
      if (incomplete.length > 0) {
        assertions.untestable(
          'ConnectFacilities',
          `gate(s) whose links were not all read — the undo could not tell a new link from an unread one: ${incomplete.join(' | ')}`,
        );
        return report('connect-on-map', assertions, probes, session);
      }
      const shared = sharedFluids(snapIndustry, snapChemical);
      if (shared.length === 0) {
        assertions.untestable(
          'ConnectFacilities',
          `${fixtureLabel(industry)} and ${fixtureLabel(chemical)} share no fluid on opposite gates — ConnectFacilities ` +
            'hires only a matching fluid (Kernel/Kernel.pas:5470-5513), so nothing is sent',
        );
        return report('connect-on-map', assertions, probes, session);
      }

      const read = async (): Promise<string> =>
        combinedState([
          linkState(snapIndustry, await readGateLinks(session, industry, BOTH_TABS)),
          linkState(snapChemical, await readGateLinks(session, chemical, BOTH_TABS)),
        ]);
      const url = await survivalUrl(ctx);
      const probe = await roundTripProbe(ctx, url, {
        what: `Connect ${fixtureLabel(industry)} with ${fixtureLabel(chemical)} (shared: ${shared.join(', ')})`,
        member: 'ConnectFacilities',
        read,
        testValue: () => 'new-links',
        write: async () => {
          const answer = await session.driver.request<WsRespConnectFacilities>(
            {
              type: WsMessageType.REQ_CONNECT_FACILITIES,
              sourceX: industry.x,
              sourceY: industry.y,
              targetX: chemical.x,
              targetY: chemical.y,
            },
            WsMessageType.RESP_CONNECT_FACILITIES,
            TIMEOUTS.login,
          );
          if (answer.success !== true) throw new Error(`REQ_CONNECT_FACILITIES answered success=false: ${answer.resultMessage}`);
        },
        restore: async () => {
          for (const [fx, snap] of [
            [industry, snapIndustry],
            [chemical, snapChemical],
          ] as const) {
            for (const g of gainedLinks(snap, await readGateLinks(session, fx, BOTH_TABS))) {
              await setBuildingProperty(
                session,
                fx.x,
                fx.y,
                g.tab === 'supplies' ? 'RDODisconnectInput' : 'RDODisconnectOutput',
                '0',
                { fluidId: g.fluid, connectionList: connectionList(g.keys) },
              );
            }
          }
        },
        // The `Connect Facilities` line carries no coordinates (Kernel/World.pas:3713): read-back alone.
        proof: {
          readBack: readBackOn(
            'every input and output gate of both facilities via REQ_BUILDING_GATE_CONNECTIONS',
            LINK_WHY,
            tolerantRead(read),
          ),
        },
        restoreRecord: { x: industry.x, y: industry.y, propertyName: 'ConnectFacilities' },
      });
      probes.push(probe);
      assertions.check(
        'ConnectFacilities: a new link read back, and both facilities equal their snapshot after the undo',
        probeHeld(probe),
        probe.note,
      );
      return report('connect-on-map', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

const COMPANY_INPUT_KINDS: readonly FixtureKindId[] = ['store', 'industry', 'warehouse'];

async function readCompInputs(session: LiveSession, fx: OwnFixture): Promise<CompInputData[]> {
  await readBuildingDetails(session, fx.x, fx.y, fx.visualClass);
  const tab = await readBuildingTabData(session, fx.x, fx.y, 'compInputs', fx.visualClass);
  return tab.compInputs ?? [];
}

/**
 * A company input's demand (`TBlock.RDOSetCompanyInputDemand`, Kernel/Kernel.pas:6371): written as
 * a percent, cached in units (`cInputDem = ceil(units(Max))`, :5878), so the read-back allows the
 * one unit the `ceil` introduces. Only an editable input is written. NIGHTLY_ONLY (routing.ts).
 */
const companyInputDemand: Flow = {
  name: 'company-input-demand',
  what:
    "RDOSetCompanyInputDemand on an editable company input of SPO_test3's fixtures — SetCompanyInputDemand line + " +
    'cInputDem moves, restored within one unit',
  mutates: true,
  seed: fixtureSeed(...COMPANY_INPUT_KINDS),
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const refusals: string[] = [];
      let chosen: { fx: OwnFixture; index: number; input: CompInputData } | undefined;
      for (const kindId of COMPANY_INPUT_KINDS) {
        const lookup = await findFixture(session, fixtureKind(kindId));
        if (!lookup.found) {
          refusals.push(`${kindId} fixture: ${lookup.reason ?? 'not found'}`);
          continue;
        }
        const fx = lookup.found;
        const inputs = await readCompInputs(session, fx);
        if (inputs.length === 0) refusals.push(`${kindId} ${fixtureLabel(fx)}: no company input`);
        inputs.forEach((input, index) => {
          if (chosen) return;
          if (!input.editable) refusals.push(`${kindId} ${fixtureLabel(fx)} input ${index} "${input.name}": not editable`);
          else if (!(input.maxDemand > 0)) refusals.push(`${kindId} ${fixtureLabel(fx)} input ${index} "${input.name}": capacity ${input.maxDemand}`);
          else chosen = { fx, index, input };
        });
        if (chosen) break;
      }
      if (!chosen) {
        assertions.untestable(
          'RDOSetCompanyInputDemand',
          'no editable company input on any fixture — cEditable is written only for a meta input flagged Editable ' +
            `(Kernel/Kernel.pas:5887): ${refusals.join(' | ')}`,
        );
        return report('company-input-demand', assertions, probes, session);
      }

      const { fx, index, input } = chosen;
      const dem0 = input.demanded;
      const max = input.maxDemand;
      const p0 = companyDemandPercent(dem0, max);
      const p1 = companyDemandTarget(p0);
      if (Math.abs(companyDemandUnits(p1, max) - dem0) < 3) {
        assertions.untestable(
          'RDOSetCompanyInputDemand',
          `${fixtureLabel(fx)} input ${index} "${input.name}": capacity ${max} is too small to tell a move from the one ` +
            'unit the ceil introduces (Kernel/Kernel.pas:5878)',
        );
        return report('company-input-demand', assertions, probes, session);
      }

      const readDemand = async (): Promise<string | undefined> => {
        const hit = (await readCompInputs(session, fx))[index];
        return hit && hit.name === input.name ? String(hit.demanded) : undefined;
      };
      const url = await survivalUrl(ctx);
      const probe = await roundTripProbe(ctx, url, {
        what: `${fixtureLabel(fx)} company input ${index} "${input.name}" demand (percent; ${dem0} of ${max} units)`,
        member: 'RDOSetCompanyInputDemand',
        // Pinned like runProbe's fixed original: the percent is derived, never read back as such.
        read: async () => String(p0),
        testValue: () => String(p1),
        write: async value => {
          await setBuildingProperty(session, fx.x, fx.y, 'RDOSetCompanyInputDemand', value, { index: String(index) });
        },
        proof: {
          log: {
            marker: LOG_MARKERS.RDOSetCompanyInputDemand,
            match: line => facLineMatches(line, fx.x, fx.y, 'SetCompanyInputDemand'),
          },
          readBack: {
            ...readBackOn(
              `compInputs[${index}].demanded (cInputDem) via REQ_BUILDING_TAB_DATA`,
              `${FACILITY_CACHE_WHY}; cInputDem = ceil(units(Max)) and cInputMax is the capacity (Kernel/Kernel.pas:5878, :5888)`,
              tolerantRead(readDemand),
            ),
            matches: (last, expected) => {
              const got = Number(last);
              if (last.trim() === '' || !Number.isFinite(got)) return false;
              if (expected === String(p0)) return Math.abs(got - dem0) <= 1;
              return Math.abs(got - companyDemandUnits(Number(expected), max)) <= 1 && last !== String(dem0);
            },
          },
        },
        restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOSetCompanyInputDemand', additionalParams: { index: String(index) } },
      });
      probes.push(probe);
      checkProbe(assertions, probe);
      return report('company-input-demand', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * The trade level (warehouse and industry, `TBlock.RDOSetTradeLevel`, Kernel/Kernel.pas:6408).
 * Only values the client offers are written. The trade role is not driven here: `RDOSetRole` is
 * offered only on an IndGeneral storage, and the warehouse fixture is a WHGeneral Import Storage (#1255).
 */
const tradeSettings: Flow = {
  name: 'trade-settings',
  what:
    "RDOSetTradeLevel on SPO_test3's warehouse and industry fixtures (SetTradeLevel line + read-back) — each restored",
  mutates: true,
  seed: fixtureSeed('industry', 'warehouse'),
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const warehouse = await ownFixture(session, 'warehouse', assertions);
      const industry = await ownFixture(session, 'industry', assertions);
      if (!warehouse && !industry) return report('trade-settings', assertions, probes, session);
      const url = await survivalUrl(ctx);
      const readField = (fx: OwnFixture, groupId: string, name: string) => async (): Promise<string | undefined> =>
        propertyValue(await readSectionGroups(session, fx.x, fx.y, groupId, fx.visualClass), groupId, name);

      const tradeLevel = async (fx: OwnFixture, groupId: string): Promise<void> => {
        const read = readField(fx, groupId, 'TradeLevel');
        const original = await read();
        if (!isTradeLevelValue(original)) {
          assertions.untestable(
            `RDOSetTradeLevel on ${fixtureLabel(fx)}`,
            `its TradeLevel "${original ?? 'absent'}" is not one the client sends (TRADE_LEVEL_VALUES ` +
              `${TRADE_LEVEL_VALUES.join('/')}, trade-settings.ts) — the restore would need a value the client never writes`,
          );
          return;
        }
        const probe = await roundTripProbe(ctx, url, {
          what: `${fixtureLabel(fx)} trade level`,
          member: 'RDOSetTradeLevel',
          read,
          testValue: tradeLevelNudge,
          write: async value => {
            await setBuildingProperty(session, fx.x, fx.y, 'RDOSetTradeLevel', value);
          },
          proof: {
            // The Fac(x,y) match excludes ' Error in SetTradeLevel..' (Kernel/Kernel.pas:6404).
            log: { marker: LOG_MARKERS.RDOSetTradeLevel, match: line => facLineMatches(line, fx.x, fx.y, 'SetTradeLevel') },
            readBack: readBackOn(`${groupId}.TradeLevel at (${fx.x},${fx.y}) via the gateway's section read`, FACILITY_CACHE_WHY, tolerantRead(read)),
          },
          restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOSetTradeLevel' },
        });
        probes.push(probe);
        checkProbe(assertions, probe);
      };

      // No RDOSetRole: the warehouse fixture is an Import Storage (WHGeneral), whose sheet never
      // offered a trade mode (Voyager/WHGeneralSheet.pas carries cbTrade only, :46) — its role is
      // preset by class (Model Extensions/General/GeneralPack1.dpr:719). No storage that offers it
      // can be built (ordinary storages are seed-only), so its live proof is parked:
      // doc/E2E-POLICY.md §7 "Parked flows". L1 covers it (trade-settings-scenario.ts).
      if (warehouse) {
        await tradeLevel(warehouse, 'whGeneral');
      }
      // RDOSetRole is never sent to the industry: only TWarehouse publishes it (StdBlocks/Warehouses.pas:95).
      if (industry) await tradeLevel(industry, 'indGeneral');
      return report('trade-settings', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * Toggle one ware of the warehouse's checklist (`TMegaStorage.RDOSelectWare`,
 * StdBlocks/MegaWarehouse.pas:94) and toggle it back — only on a MegaStorage. NIGHTLY_ONLY (routing.ts).
 */
const warehouseWares: Flow = {
  name: 'warehouse-wares',
  what: "toggle one ware of SPO_test3's warehouse fixture when it is a MegaStorage (RDOSelectWare) — read-back, toggled back",
  mutates: true,
  seed: fixtureSeed('warehouse'),
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const fx = await ownFixture(session, 'warehouse', assertions);
      if (!fx) return report('warehouse-wares', assertions, probes, session);
      const dims = await facilityDimensions(session);
      if (!isMegaStorage(dims, fx.visualClass)) {
        assertions.untestable(
          'RDOSelectWare',
          `${fixtureLabel(fx)} (facId ${String(dims[fx.visualClass]?.facId ?? 'absent')}) is not an Import/Export Storage — ` +
            'only a TMegaStorage publishes RDOSelectWare (StdBlocks/MegaWarehouse.pas:25); a TWarehouse publishes ' +
            'RDOSetRole only (StdBlocks/Warehouses.pas:95)',
        );
        return report('warehouse-wares', assertions, probes, session);
      }
      const wares = (await readBuildingDetails(session, fx.x, fx.y, fx.visualClass)).warehouseWares ?? [];
      const ware = wares.find(w => !w.enabled) ?? wares[0];
      if (!ware) {
        assertions.untestable('RDOSelectWare', `${fixtureLabel(fx)} lists no ware (GateMap)`);
        return report('warehouse-wares', assertions, probes, session);
      }
      const read = async (): Promise<string | undefined> => {
        const hit = (await readBuildingDetails(session, fx.x, fx.y, fx.visualClass)).warehouseWares?.find(
          w => w.index === ware.index && w.name === ware.name,
        );
        return hit ? (hit.enabled ? '1' : '0') : undefined;
      };
      const url = await survivalUrl(ctx);
      const probe = await roundTripProbe(ctx, url, {
        what: `${fixtureLabel(fx)} ware ${ware.index} "${ware.name}"`,
        member: 'RDOSelectWare',
        read,
        testValue: original => (original === '1' ? '0' : '1'),
        write: async value => {
          // A WordBool, as WarehouseWares sends it: #-1 selects, #0 clears.
          await setBuildingProperty(session, fx.x, fx.y, 'RDOSelectWare', value === '1' ? '-1' : '0', { index: String(ware.index) });
        },
        // RDOSelectWare logs nothing: the read-back alone proves it.
        proof: {
          readBack: readBackOn(
            `warehouseWares[${ware.index}] (GateMap) via REQ_BUILDING_DETAILS`,
            `RDOSelectWare prints no Survival line; ${FACILITY_CACHE_WHY}`,
            tolerantRead(read),
          ),
        },
        restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOSelectWare', additionalParams: { index: String(ware.index) } },
      });
      probes.push(probe);
      checkProbe(assertions, probe);
      return report('warehouse-wares', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * `ftpWarehouses` (Kernel/Kernel.pas:2760) — Voyager's `btnSellToWareHouses`
 * (Voyager/IndustryGeneralSheet.pas:45, sent by `SellToAll`, :345). Also the kind every reset sends
 * with `RDODisconnectFromTycoon`, which ignores it (Kernel/Kernel.pas:4581-4600).
 */
const WAREHOUSES_KIND = '1';
/** `ftpFactories` (Kernel/Kernel.pas:2761) — Voyager's `btnSellToFacs` (Voyager/IndustryGeneralSheet.pas:44, :345). */
const FACTORIES_KIND = '2';

/**
 * What one storage's (or the industry fixture's) supply gate of a plant fluid shows of the plant:
 * `undefined` is a gate the facility does not list. A link found among the rows read counts even
 * when not every row was read.
 */
export function storageGateState(gate: BuildingSupplyData | undefined, plant: { x: number; y: number }): string {
  if (!gate) return 'gate not listed';
  if (gate.connections.some(c => c.x === plant.x && c.y === plant.y)) return 'plant linked';
  if (gate.connectionCount !== gate.connections.length) return 'count mismatch (unread)';
  return 'no plant link';
}

/** The first supply gate of `fx` whose fluid is `fluid` — a stub named after it is read first. */
async function supplyByFluid(
  session: LiveSession,
  fx: OwnFixture,
  stubs: readonly GateStub[],
  fluid: string,
): Promise<BuildingSupplyData | undefined> {
  for (const stub of [...stubs.filter(s => s.name === fluid), ...stubs.filter(s => s.name !== fluid)]) {
    const supply = (await gateConnections(session, fx, 'supplies', stub)).supply;
    if (supply?.metaFluid === fluid) return supply;
  }
  return undefined;
}

/** The fluids among `fluids` that `fx` lists a supply gate for. */
async function suppliedFluids(session: LiveSession, fx: OwnFixture, fluids: readonly string[]): Promise<string[]> {
  const stubs = await gateStubs(session, fx, 'supplies');
  const out: string[] = [];
  for (const fluid of fluids) if (await supplyByFluid(session, fx, stubs, fluid)) out.push(fluid);
  return out;
}

/** Each supply gate of `fx` carrying one of `fluids`, as `storageGateState` writes it. */
async function supplySideNote(
  session: LiveSession,
  fx: OwnFixture,
  fluids: readonly string[],
  plant: OwnFixture,
): Promise<{ note: string; linked: boolean }> {
  const stubs = await gateStubs(session, fx, 'supplies');
  const parts: string[] = [];
  let linked = false;
  for (const fluid of fluids) {
    const state = storageGateState(await supplyByFluid(session, fx, stubs, fluid), plant);
    if (state === 'plant linked') linked = true;
    parts.push(`${fixtureLabel(fx)} ${fluid}: ${state}`);
  }
  return { note: parts.join(' | '), linked };
}

/**
 * `TFacilityRole`, in ordinal order — the cached `TradeRole` is `integer(Role)` (TBlock.StoreToCache,
 * Kernel/Kernel.pas:5893). Kernel's own declaration is commented out (:405); the live one is
 * Cache/CacheCommon.pas:53, which Kernel uses (:11), in the order the permission map's comment gives (:2862).
 */
const FACILITY_ROLES = ['rolNeutral', 'rolProducer', 'rolDistributer', 'rolBuyer', 'rolImporter', 'rolCompExport', 'rolCompInport'];
const ROL_DISTRIBUTER = 2;
const ROL_IMPORTER = 4;

/**
 * One cached `TradeRole` as the flow records it: `<n> (<name>)`, `unread` when the read did not
 * return it. A rolImporter is flagged: its row of the tycoons' permission map is all zeros
 * (Kernel/Kernel.pas:2875), and `TGate.ConnectTo` checks that map on both sides (:6766-6767), so
 * every link it is asked for is refused.
 */
export function tradeRoleNote(raw: string | undefined): string {
  if (raw === undefined) return 'unread';
  const n = Number(raw);
  const name = Number.isInteger(n) ? FACILITY_ROLES[n] : undefined;
  if (raw.trim() === '' || !name) return `${raw} (not a TFacilityRole)`;
  const note = `${n} (${name})`;
  return n === ROL_IMPORTER
    ? `${note} — refuses every link per the tycoon permission map (Kernel/Kernel.pas:2875, checked at :6766-6767)`
    : note;
}

/** The cached `TradeRole` of a warehouse from its general group, as `tradeRoleNote` writes it. Never throws. */
async function cachedTradeRole(session: LiveSession, fx: OwnFixture): Promise<string> {
  try {
    return tradeRoleNote(propertyValue(await readSectionGroups(session, fx.x, fx.y, 'whGeneral', fx.visualClass), 'whGeneral', 'TradeRole'));
  } catch (err: unknown) {
    return `unread: ${toErrorMessage(err)}`;
  }
}

/**
 * What the guards read of SPO_test3's other facilities, before any write: the own lots in Helartia
 * (the only places a Quick Trade link may land), the facilities outside Helartia that carry an
 * input of a plant product — `RDOConnectToTycoon` links only an input whose fluid is one of the
 * plant's outputs (Kernel/Kernel.pas:4545-4549), so these are every lot outside Helartia it could
 * write, for either kind — and the cached trade role of each own warehouse in Helartia (any
 * facility showing the whGeneral tab, MegaStorage or not). That role is the block's runtime `Role`
 * (a warehouse's `fRole`, StdBlocks/Warehouses.pas:543-546), while the connect tests the class's
 * `MetaFacility.Kind.Role` (Kernel/Kernel.pas:4542): the runtime one is the only one the client can
 * read, so a 2 makes kind 1 worth sending, not certain to link.
 */
interface QuickTradeReach {
  helartiaLots: Set<string>;
  outside: string[];
  warehouses: string[];
  distributers: number;
}

async function quickTradeReach(
  session: LiveSession,
  plant: OwnFixture,
  facilities: readonly TycoonFacility[],
  helartia: number | undefined,
  fluids: readonly string[],
): Promise<QuickTradeReach> {
  const reach: QuickTradeReach = { helartiaLots: new Set(), outside: [], warehouses: [], distributers: 0 };
  for (const f of facilities) {
    if (f.x === plant.x && f.y === plant.y) continue;
    const label = `${f.name} (${f.x},${f.y})`;
    const inHelartia = helartia !== undefined && (await townValueAt(session, f.x, f.y)) === helartia;
    if (inHelartia) reach.helartiaLots.add(`${f.x},${f.y}`);
    try {
      const fx: OwnFixture = { x: f.x, y: f.y, visualClass: await resolveVisualClass(session, f.x, f.y), name: f.name };
      if (!inHelartia) {
        const carried = await suppliedFluids(session, fx, fluids);
        if (carried.length > 0) reach.outside.push(`${label} of ${f.company} takes ${carried.join('/')}`);
        continue;
      }
      if (!(await readBuildingDetails(session, f.x, f.y, fx.visualClass)).tabs.some(t => t.id === 'whGeneral')) continue;
      const role = await cachedTradeRole(session, fx);
      if (role.startsWith(`${ROL_DISTRIBUTER} (`)) reach.distributers++;
      reach.warehouses.push(`${label}: ${role}`);
    } catch (err: unknown) {
      (inHelartia ? reach.warehouses : reach.outside).push(`${label} could not be read: ${toErrorMessage(err)}`);
    }
  }
  return reach;
}

/** The Quick Trade flow's live context, shared by both kinds. */
interface QuickTradeScope {
  session: LiveSession;
  plant: OwnFixture;
  ctx: FlowContext;
  url: string;
  /** The initial-supplier list before any write: what the restore puts back. */
  suppliersKey: string;
  /** Every key a read-back saw newly linked on the plant's product gates. */
  touched: Set<string>;
}

/**
 * One `RDOConnectToTycoon` round trip of `kind` on the plant, undone by `RDODisconnectFromTycoon`
 * (whose kind is ignored: it drops the plant's outputs from every own facility's matching input,
 * Kernel/Kernel.pas:4590-4600). The connect registers the plant as an initial supplier
 * (SetAsDefault, :4564-4565), and the undo's `UnregisterSupplier` alone was seen not to clear such
 * an entry live (`resetChemical`), so the undo also deletes every row the plant holds that the
 * snapshot did not (`deleteInitialSupplierRows`).
 */
async function tycoonRoundTrip(
  s: QuickTradeScope,
  kind: string,
  target: string,
  source: string,
  read: () => Promise<string>,
): Promise<ProbeResult> {
  const { session, plant } = s;
  const listed = new Set(s.suppliersKey.split(' '));
  return roundTripProbe(s.ctx, s.url, {
    what: `${fixtureLabel(plant)} Quick Trade kind ${kind} (${target})`,
    member: 'RDOConnectToTycoon',
    read,
    testValue: () => 'new-links',
    write: async () => {
      await setBuildingProperty(session, plant.x, plant.y, 'RDOConnectToTycoon', '0', { kind });
    },
    restore: async () => {
      await setBuildingProperty(session, plant.x, plant.y, 'RDODisconnectFromTycoon', '0', { kind });
      let after: AutoConnectionsData;
      try {
        after = await readAutoConnections(session);
      } catch {
        return; // the initial-supplier check reports an unreadable page
      }
      await deleteInitialSupplierRows(
        session,
        initialSupplierRowsAt(after, plant.x, plant.y).filter(r => !listed.has(`${r.fluidId}:${r.facilityId}`)),
      );
    },
    proof: {
      log: { marker: LOG_MARKERS.RDOConnectToTycoon, match: line => facLineMatches(line, plant.x, plant.y, 'Connect to Tycoon:') },
      readBack: readBackOn(source, LINK_WHY, tolerantRead(read)),
    },
    restoreRecord: { x: plant.x, y: plant.y, propertyName: 'RDODisconnectFromTycoon', additionalParams: { kind } },
  });
}

/** The plant's product gates against the snapshot (`linkState`), each newly linked key kept in `touched`. */
async function plantSide(s: QuickTradeScope, snapshot: GateLinks): Promise<string> {
  const now = await readGateLinks(s.session, s.plant, ['products']);
  for (const g of gainedLinks(snapshot, now)) for (const k of g.keys) s.touched.add(k);
  return linkState(snapshot, now);
}

/**
 * Quick Trade (`TFacility.RDOConnectToTycoon`, Kernel/Kernel.pas:4521) on the chemical fixture
 * (#1293, reset first by `resetChemical`), proven on the kind the live server honours for it.
 *
 * Kind 2 (`ftpFactories`) links the plant's outputs into the matching input of every own
 * `rolProducer` (Kernel/Kernel.pas:4543) — the industry fixture's, and any other own producer's
 * with such an input. Its proof needs both sides: new links on the plant's product gates, and the
 * industry fixture's supply gate listing the plant. Every link it makes is written on both gates
 * (:6784-6785), so the plant's product-gate snapshot covers every own facility it touches, and
 * every newly linked key must be an SPO_test3 lot in Helartia.
 *
 * Kind 1 (`ftpWarehouses`) linked no MegaStorage of SPO_test3's live (attempt-6 gate, 2026-10-07):
 * the shape of Kernel/Kernel1.pas:3150 tests the class's `Kind.Role = rolDistributer` only, where
 * Kernel/Kernel.pas:4542 also accepts rolCompExport/rolCompInport. So it is sent only when an own
 * warehouse in Helartia reads `TradeRole` 2 (rolDistributer), and is UNTESTABLE otherwise.
 *
 * The undo reaches every SPO_test3 facility (:4537-4553, :4593-4600) and unregisters the plant as
 * an initial supplier (:4564-4565, :4606-4607), so the flow runs only behind three data guards.
 * NIGHTLY_ONLY (routing.ts).
 */
const quickTradeRoundTrip: Flow = {
  name: 'quick-trade-roundtrip',
  what:
    "RDOConnectToTycoon on SPO_test3's chemical fixture (reset first) behind three guards: kind 2 (factories) -> " +
    "Connect to Tycoon: line + new links on the plant and the industry fixture's input; kind 1 (warehouses) only when an " +
    'own warehouse reads rolDistributer -> RDODisconnectFromTycoon after each -> the output links and the initial-supplier ' +
    'list equal their snapshots',
  mutates: true,
  seed: fixtureSeed('chemical', 'industry'),
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const fx = await ownFixture(session, 'chemical', assertions);
      if (!fx) return report('quick-trade-roundtrip', assertions, probes, session);
      if (!(await resetChemical(session, fx, ctx, assertions, 'RDOConnectToTycoon'))) {
        return report('quick-trade-roundtrip', assertions, probes, session);
      }
      const own = await listTycoonFacilities(session);
      const ownCompanies = new Set(own.companies);
      const ownLots = new Set(own.facilities.map(f => `${f.x},${f.y}`));
      let refused = false;

      // Guard 1: the undo drops the fixture's outputs from every SPO_test3 facility's matching input.
      const clients: string[] = [];
      for (const stub of await gateStubs(session, fx, 'products')) {
        const product = (await gateConnections(session, fx, 'products', stub)).product;
        if (!product || product.connectionCount !== product.connections.length) {
          clients.push(`${stub.name}: ${String(product?.connectionCount)} client(s) listed but ${product?.connections.length ?? 0} read`);
          continue;
        }
        for (const c of product.connections) {
          if (ownCompanies.has(c.companyName) || ownLots.has(`${c.x},${c.y}`)) clients.push(`${stub.name}: ${linkLabel(c)}`);
        }
      }
      if (clients.length > 0) {
        refused = true;
        assertions.untestable(
          'RDOConnectToTycoon',
          'an SPO_test3 facility is already a client of the fixture (or a client could not be read) — the undo would ' +
            `drop it, whatever its type (Kernel/Kernel.pas:4593-4600): ${clients.join(' | ')}`,
        );
      }

      // Guard 2: the undo unregisters the fixture as an initial supplier.
      const auto = await readAutoConnections(session);
      if (initialSupplierAt(auto, fx.x, fx.y)) {
        refused = true;
        assertions.untestable(
          'RDOConnectToTycoon',
          `${fixtureLabel(fx)} is one of SPO_test3's initial suppliers — the undo would remove it for good ` +
            '(Kernel/Kernel.pas:4564-4565, :4606-4607)',
        );
      }

      // Guard 3: the connect and its undo reach every company and town of the tycoon.
      const snapshot = await readGateLinks(session, fx, ['products']);
      const fluids = [...new Set(Object.values(snapshot).map(g => g.fluid).filter(Boolean))];
      const helartia = await helartiaValue(session);
      const reach = await quickTradeReach(session, fx, own.facilities, helartia, fluids);
      if (reach.outside.length > 0) {
        refused = true;
        assertions.untestable(
          'RDOConnectToTycoon',
          `an SPO_test3 facility outside ${GOVERNED_TOWN} takes a plant product (or could not be read) — Quick Trade ` +
            `reaches every company and town of the tycoon (Kernel/Kernel.pas:4537-4553): ${reach.outside.join(' | ')}`,
        );
      }
      if (refused) return report('quick-trade-roundtrip', assertions, probes, session);

      const s: QuickTradeScope = { session, plant: fx, ctx, url: await survivalUrl(ctx), suppliersKey: initialSuppliersKey(auto), touched: new Set() };
      const productsSource = "the plant's product gates' links via REQ_BUILDING_GATE_CONNECTIONS";

      // Kind 2: both sides must show the link.
      let kindOneBlocked: string | undefined;
      const mine = await ownFixture(session, 'industry', assertions);
      const mineFluids = mine ? await suppliedFluids(session, mine, fluids) : [];
      if (!mine) {
        assertions.untestable('RDOConnectToTycoon kind 2 (factories)', "the industry fixture is the other side of its proof and was not found");
      } else if (mineFluids.length === 0) {
        assertions.untestable(
          'RDOConnectToTycoon kind 2 (factories)',
          `${fixtureLabel(mine)} lists no input of the plant's products (${fluids.join('/') || 'none'}) — no own side to read back`,
        );
      } else {
        const readFactories = async (): Promise<string> => {
          const plantState = await plantSide(s, snapshot);
          const mineSide = await supplySideNote(session, mine, mineFluids, fx);
          if (plantState === 'new-links' && mineSide.linked) return 'new-links';
          if (plantState === 'snapshot' && !mineSide.linked) return 'snapshot';
          return `plant side: ${plantState}; ${mineSide.note}`;
        };
        const probe = await tycoonRoundTrip(
          s,
          FACTORIES_KIND,
          'factories',
          `${productsSource}, and ${fixtureLabel(mine)}'s ${mineFluids.join('/')} supply gate listing the plant`,
          readFactories,
        );
        probes.push(probe);
        assertions.check(
          'RDOConnectToTycoon kind 2: new links on the plant and the industry fixture, and both equal their snapshot after the undo',
          probeHeld(probe),
          probe.note,
        );
        if (!probe.restored) kindOneBlocked = "kind 2's undo did not read back the snapshot, so a kind-1 read-back could not tell its links apart";
      }

      // Kind 1: only a rolDistributer warehouse can take it.
      const roles = reach.warehouses.length > 0 ? reach.warehouses.join(' | ') : `no own warehouse in ${GOVERNED_TOWN}`;
      if (reach.distributers === 0) {
        assertions.untestable(
          'RDOConnectToTycoon kind 1 (warehouses)',
          `no own warehouse in ${GOVERNED_TOWN} reads TradeRole ${ROL_DISTRIBUTER} (rolDistributer) — ${roles}. Live, the ` +
            "ftpWarehouses branch linked none of SPO_test3's MegaStorages (roles 6/5/6) while kind 2 and a direct " +
            'RDOConnectOutput linked the same plant (attempt-6 gate, job fae2cc, 2026-10-07) — the shape of ' +
            'Kernel/Kernel1.pas:3150, which tests the class role `Kind.Role = rolDistributer` only; nothing sent',
        );
      } else if (kindOneBlocked) {
        assertions.untestable('RDOConnectToTycoon kind 1 (warehouses)', `${kindOneBlocked}; nothing sent`);
      } else {
        const probe = await tycoonRoundTrip(s, WAREHOUSES_KIND, 'warehouses', productsSource, () => plantSide(s, snapshot));
        probes.push(probe);
        assertions.check(
          'RDOConnectToTycoon kind 1: new links read back, and the output links equal their snapshot after the undo',
          probeHeld(probe),
          [probe.note, `trade roles before the write — ${roles}`].filter(Boolean).join(' — '),
        );
      }
      if (probes.length === 0) return report('quick-trade-roundtrip', assertions, probes, session);

      const strays = [...s.touched].filter(k => !reach.helartiaLots.has(k));
      assertions.check(
        `every link Quick Trade made is an SPO_test3 lot in ${GOVERNED_TOWN}`,
        strays.length === 0,
        strays.length > 0 ? `linked outside: ${strays.join(' ')}` : `linked: ${[...s.touched].join(' ') || '(none)'}`,
      );

      const suppliers = await pollUntil(
        async () => {
          try {
            return initialSuppliersKey(await readAutoConnections(session));
          } catch (err: unknown) {
            return `(unreadable: ${toErrorMessage(err)})`;
          }
        },
        k => k === s.suppliersKey,
        ctx,
      );
      assertions.check(
        'the initial-supplier list equals its snapshot',
        suppliers.ok,
        suppliers.ok ? `${s.suppliersKey || '(none)'}` : `before: ${s.suppliersKey || '(none)'} — after: ${suppliers.last || '(none)'}`,
      );
      return report('quick-trade-roundtrip', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Build menu, placement, rename, demolition (#1150)
// ---------------------------------------------------------------------------------------------

/**
 * The facility place-rename-demolish places: the cheapest one offered, never a refused class
 * (a transcendence block or the Capitol, `isRefusedClass`) even when it is the cheapest, and
 * only when it costs no more than `budget` (cash minus `FIXTURE_CASH_FLOOR`).
 */
export function pickPlacement(buildable: BuildingInfo[], budget: number): { info?: BuildingInfo; reason?: string } {
  const allowed = buildable.filter(b => !isRefusedClass(b.facilityClass)).sort((a, b) => a.cost - b.cost);
  const cheapest = allowed[0];
  if (!cheapest) return { reason: 'nothing buildable offered' };
  if (cheapest.cost > budget) {
    return {
      reason: `the cheapest buildable ${cheapest.facilityClass} costs ${cheapest.cost}, above cash minus FIXTURE_CASH_FLOOR (${budget})`,
    };
  }
  return { info: cheapest };
}

/**
 * The object at the lot is the one this run placed: owned by SPO_test3's tycoon id
 * (`MapBuilding.tycoonId` is `Company.Owner.Id`, `Kernel/World.pas:3295-3300` — a role company's
 * owner is the role tycoon, so the Mayor's facilities never match), and a construction-state
 * class or the placed class's own visual class (registered, or completed = registered + 1,
 * `Kernel/KernelCache.pas:291`) — the rule `placeFacility` confirms with.
 */
export function ownsPlacement(
  b: MapBuilding | undefined,
  dims: Record<string, FacilityDimensions>,
  visualClassId: string,
  tycoonId: string,
): boolean {
  if (!b || String(b.tycoonId) !== tycoonId) return false;
  return (
    isConstructionClass(dims, b.visualClass) ||
    b.visualClass === visualClassId ||
    b.visualClass === String(Number(visualClassId) + 1)
  );
}

/** `Del Facility, x: <x> y: <y>` (`Kernel/World.pas:3575`), on both coordinates. */
export function delFacilityLineMatches(line: string, x: number, y: number): boolean {
  return new RegExp(`${escapeRegExp(LOG_MARKERS.RDODelFacility)} ${x} y: ${y}(\\s|$)`).test(line);
}

/** The building anchored exactly at (x, y), read from a ±8 window around it. */
async function lotBuilding(session: LiveSession, x: number, y: number): Promise<MapBuilding | undefined> {
  const { buildings } = await loadMap(session, { x1: Math.max(0, x - 8), y1: Math.max(0, y - 8), x2: x + 8, y2: y + 8 });
  return buildings.find(b => b.x === x && b.y === y);
}

/** Read at least once, then every `readBackPoll` until `done` holds or `boundMs` (default `readBack`) has elapsed. */
async function pollUntil<T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
  ctx: FlowContext,
  boundMs: number = TIMEOUTS.readBack,
): Promise<{ ok: boolean; last: T }> {
  const now = ctx.now ?? Date.now;
  const sleep = ctx.sleep ?? defaultSleep;
  const deadline = now() + boundMs;
  for (;;) {
    const last = await read();
    if (done(last)) return { ok: true, last };
    if (now() >= deadline) return { ok: false, last };
    await sleep(TIMEOUTS.readBackPoll);
  }
}

/** #1349 — the reason a company-file failure ends UNTESTABLE: planitia's cache cleaner deleted the company folder. */
const COMPANY_FILE_MISSING_REASON =
  'company cache file missing — KindList.asp:18 "Couldn\'t open the path" (server cache cleaner)';

/**
 * Whether KindList.asp could not open `Companies\<companyName>.five\` — the one page of the three
 * that says so (#1349). Asks about the named company only: the cleaner's 20 000-file cap can
 * leave one company's folder and delete another's. A throw, or no marker, reads as "present".
 */
async function companyPathMissing(session: LiveSession, companyName: string): Promise<boolean> {
  try {
    const answer: WsRespBuildingCategories | undefined = await session.driver.request<WsRespBuildingCategories>(
      { type: WsMessageType.REQ_GET_BUILDING_CATEGORIES, companyName },
      WsMessageType.RESP_BUILDING_CATEGORIES,
    );
    return answer?.companyPathMissing === true;
  } catch {
    return false;
  }
}

/**
 * The build menu, read only (#1150): the categories the own company is offered, then the
 * facilities of the first category of its cluster — the two reads the client's build menu makes.
 */
const buildMenuRead: Flow = {
  name: 'build-menu-read',
  what: "build menu: categories -> the first category of the own company's cluster -> its facilities, each with a class and a cost",
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const companyName = session.company.name;
      const answer = await session.driver.request<WsRespBuildingCategories>(
        { type: WsMessageType.REQ_GET_BUILDING_CATEGORIES, companyName },
        WsMessageType.RESP_BUILDING_CATEGORIES,
      );
      const { categories } = answer;
      if (categories.length === 0 && answer.companyPathMissing === true) {
        assertions.untestable('the build menu lists at least one category', COMPANY_FILE_MISSING_REASON);
        return report('build-menu-read', assertions, [], session);
      }
      assertions.check('the build menu lists at least one category', categories.length > 0, `${categories.length} categories`);
      if (categories.length === 0) return report('build-menu-read', assertions, [], session);

      const cluster = session.company.cluster;
      const category = cluster
        ? categories.find(c => c.cluster.toLowerCase() === cluster.toLowerCase())
        : categories[0];
      assertions.check(
        "a category of the own company's cluster is listed",
        category !== undefined,
        `cluster ${cluster ?? '(unset)'}; listed: ${[...new Set(categories.map(c => c.cluster))].join(', ')}`,
      );
      if (!category) return report('build-menu-read', assertions, [], session);

      const { facilities } = await session.driver.request<WsRespBuildingFacilities>(
        {
          type: WsMessageType.REQ_GET_BUILDING_FACILITIES,
          companyName,
          cluster: category.cluster,
          kind: category.kind,
          kindName: category.kindName,
          folder: category.folder,
          tycoonLevel: category.tycoonLevel,
        },
        WsMessageType.RESP_BUILDING_FACILITIES,
      );
      assertions.check(
        'the category lists at least one facility',
        facilities.length > 0,
        `${facilities.length} facilities in ${category.kindName}`,
      );
      const bad = facilities.filter(
        f => !(f.facilityClass ?? '').trim() || typeof f.cost !== 'number' || !Number.isFinite(f.cost),
      );
      assertions.check(
        'every facility carries a class and a cost',
        bad.length === 0,
        bad.map(f => `${f.name}: class "${f.facilityClass ?? ''}", cost ${String(f.cost)}`).join('; ') || undefined,
      );
      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('build-menu-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

interface Placement {
  x: number;
  y: number;
  facilityClass: string;
  visualClassId: string;
  tycoonId: string;
  key: string;
  /** NewFacility answered non-zero: every such branch returns before a facility exists (`Kernel/World.pas:3180-3195`). */
  refused: boolean;
  url: string;
  dims: Record<string, FacilityDimensions>;
}

/**
 * Place, rename and demolish one facility on a free Helartia lot, as SPO_test3's own company
 * (#1150). The cheapest buildable class is placed — never a transcendence block nor the Capitol
 * (`isRefusedClass`; `placeFacility` refuses them again before sending). The pending restore is
 * recorded before `NewFacility` is sent. The placement is proven by its `New Facility:` line
 * (`Kernel/World.pas:3565`, logged on entry — receipt), result code 0 and a lot read-back of
 * the placed class or its construction state (`StdBlocks/Construction.pas:55`) owned by
 * SPO_test3; the demolition by its `Del Facility` line (`:3575`) and an empty lot. The cleanup
 * demolishes only what this run placed. The construction cost is spent each run — accepted by
 * the maintainer (2026-09-29).
 */
const placeRenameDemolish: Flow = {
  name: 'place-rename-demolish',
  what:
    'place the cheapest non-refused buildable facility on a free Helartia lot -> New Facility: line + result 0 + ' +
    'owned read-back -> rename to a marker and back -> demolish -> Del Facility line + empty lot',
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      await placeRenameDemolishSteps(session, ctx, assertions);
      return report('place-rename-demolish', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

async function placeRenameDemolishSteps(session: LiveSession, ctx: FlowContext, assertions: Assertions): Promise<void> {
  const what = `a place-rename-demolish round trip in ${GOVERNED_TOWN}`;
  const cash = await readCash(session);
  if (cash === null) {
    assertions.untestable(what, 'cash unknown — no EVENT_TYCOON_UPDATE received');
    return;
  }
  const pick = pickPlacement(await listBuildable(session), cash - FIXTURE_CASH_FLOOR);
  const info = pick.info;
  if (!info) {
    assertions.untestable(what, `${pick.reason ?? 'nothing picked'} (${session.company.name})`);
    return;
  }
  const cls = info.facilityClass;
  const dims = await facilityDimensions(session);
  const d = dims[info.visualClassId];
  const footprint =
    info.xsize && info.ysize ? { xsize: info.xsize, ysize: info.ysize } : d ? { xsize: d.xsize, ysize: d.ysize } : null;
  if (!footprint) {
    assertions.untestable(what, `footprint unknown for ${cls}`);
    return;
  }
  const lot = await findFreeLot(session, footprint, info.zoneRequirement);
  if (!lot) {
    assertions.untestable(
      what,
      `no free lot in ${GOVERNED_TOWN} for ${cls} (${footprint.xsize}×${footprint.ysize}, ${info.zoneRequirement || 'no zone'})`,
    );
    return;
  }

  const url = ctx.survivalLogUrl ?? (await findCurrentSurvivalLog());
  const newWindow = await openLogWindow(url);
  const tycoonId = ownTycoonId(session);
  const companyId = session.company.id;
  const where = `(${lot.x},${lot.y})`;

  // Recorded before NewFacility is sent: a crash after the send cannot leave an unmarked building.
  const key = `place-rename-demolish:${randomUUID()}`;
  ctx.lock.addPendingRestore({
    key,
    x: lot.x,
    y: lot.y,
    what:
      `demolish the ${cls} at ${where}, company ${companyId} (${session.company.name}) — place-rename-demolish ` +
      `placed it in ${GOVERNED_TOWN}; demolish it as ${PRIMARY_ACCOUNT.username}, then npm run e2e:unlock`,
    originalValue: 'no facility',
  });

  let refused = false;
  try {
    const placed = await placeFacility(session, cls, lot.x, lot.y, {
      visualClassId: info.visualClassId,
      now: ctx.now,
      sleep: ctx.sleep,
    });
    refused = placed.code !== 0;
    if (placed.code === ERROR_TooManyFacilities) {
      assertions.untestable(
        what,
        `NewFacility answered ERROR_TooManyFacilities for ${cls} — facility limit or company uniqueness (Kernel/World.pas:3195)`,
      );
    } else {
      assertions.check('NewFacility answered 0', !refused, `answered ${placed.code} for ${cls} at ${where}`);
    }
    if (!refused) {
      const line = await awaitMarker(
        newWindow,
        { marker: LOG_MARKERS.RDONewFacility, match: l => newFacilityLineMatches(l, cls, companyId, lot.x, lot.y) },
        TIMEOUTS.logSettle,
        undefined,
        ctx.now,
        ctx.sleep,
      );
      assertions.check(
        'the placement logged its New Facility: line (class, company, x, y)',
        line !== null,
        line ?? describeLogMiss(newWindow, `(no New Facility: line for ${cls}, company ${companyId}, ${where})`),
      );
      const rb = placed.readBack;
      assertions.check(
        'the lot reads back the placed class or its construction state, owned by SPO_test3',
        placed.confirmed,
        rb ? `visual class ${rb.visualClass}, owner ${rb.tycoonId}${rb.construction ? ', construction' : ''}` : 'nothing at the lot',
      );
      if (line !== null && placed.confirmed && rb) await renameSteps(session, ctx, lot, rb.visualClass, assertions);
    }
  } catch (err: unknown) {
    assertions.check('the place-rename-demolish steps ran without a throw', false, toErrorMessage(err));
  }

  await removePlacement(
    session,
    ctx,
    { ...lot, facilityClass: cls, visualClassId: info.visualClassId, tycoonId, key, refused, url, dims },
    assertions,
  );
}

/**
 * Rename to a marker, read it back, rename back to the original, read it back. Not a pending
 * restore of its own: the facility is demolished next, and the placement's entry covers it.
 */
async function renameSteps(
  session: LiveSession,
  ctx: FlowContext,
  lot: { x: number; y: number },
  vc: string,
  assertions: Assertions,
): Promise<void> {
  const { x, y } = lot;
  const nameAt = (): Promise<string> => readBuildingDetails(session, x, y, vc).then(d => d.buildingName ?? '');
  const rename = (newName: string): Promise<WsRespRenameFacility> =>
    session.driver.request<WsRespRenameFacility>(
      { type: WsMessageType.REQ_RENAME_FACILITY, x, y, newName },
      WsMessageType.RESP_RENAME_FACILITY,
      TIMEOUTS.login,
    );
  try {
    const original = await nameAt();
    const marker = `e2e-rename-${randomUUID().slice(0, 8)}`;
    const toMarker = await rename(marker);
    assertions.check('the gateway accepted the rename to the marker', toMarker.success === true, toMarker.message);
    const readMarker = await pollUntil(nameAt, n => n.trim() === marker, ctx);
    assertions.check('the details read the marker name', readMarker.ok, `"${readMarker.last}" (expected "${marker}")`);
    if (!readMarker.ok) return;

    const back = await rename(original);
    assertions.check('the gateway accepted the rename back', back.success === true, back.message);
    const readBack = await pollUntil(nameAt, n => n.trim() === original.trim(), ctx);
    assertions.check('the details read the original name back', readBack.ok, `"${readBack.last}" (expected "${original}")`);
  } catch (err: unknown) {
    assertions.check('the rename steps ran without a throw', false, toErrorMessage(err));
  }
}

/**
 * The single demolition path, happy or not: demolishes only what this run placed — the lot
 * holds the placed class (or its construction state) owned by SPO_test3's tycoon id. Anything
 * else is left alone and FAILs, keeping the pending restore; the lock then goes dirty and a
 * human demolishes and runs `npm run e2e:unlock` (E2E-POLICY §6). The pending restore is cleared
 * only after a `Del Facility` line and an empty lot, or after a refused placement that left the
 * lot empty.
 */
async function removePlacement(session: LiveSession, ctx: FlowContext, p: Placement, assertions: Assertions): Promise<void> {
  const where = `(${p.x},${p.y})`;
  try {
    const b = await lotBuilding(session, p.x, p.y);
    if (!b) {
      if (p.refused) {
        ctx.lock.clearPendingRestore(p.key);
        assertions.check('nothing was placed at the lot', b === undefined, `NewFacility refused; ${where} is empty`);
      } else {
        assertions.check(
          'the placed facility stands at the lot for the demolition',
          false,
          `nothing at ${where} — nothing demolished, pending restore kept`,
        );
      }
      return;
    }
    if (!ownsPlacement(b, p.dims, p.visualClassId, p.tycoonId)) {
      assertions.check(
        'the object at the lot is the one this run placed',
        false,
        `visual class ${b.visualClass}, owner ${b.tycoonId} at ${where} — nothing demolished, pending restore kept`,
      );
      return;
    }

    const delWindow = await openLogWindow(p.url);
    const deleted = await session.driver.request<WsRespDeleteFacility>(
      { type: WsMessageType.REQ_DELETE_FACILITY, x: p.x, y: p.y },
      WsMessageType.RESP_DELETE_FACILITY,
      TIMEOUTS.login,
    );
    assertions.check('the gateway accepted the demolition', deleted.success === true, deleted.message);
    const delLine = await awaitMarker(
      delWindow,
      { marker: LOG_MARKERS.RDODelFacility, match: l => delFacilityLineMatches(l, p.x, p.y) },
      TIMEOUTS.logSettle,
      undefined,
      ctx.now,
      ctx.sleep,
    );
    const gone = await pollUntil(() => lotBuilding(session, p.x, p.y), v => v === undefined, ctx);
    const kept = delLine !== null && gone.ok ? '' : ' — pending restore kept';
    assertions.check('the demolition logged its Del Facility line', delLine !== null, (delLine ?? describeLogMiss(delWindow, `(no Del Facility line for ${where})`)) + kept);
    assertions.check(
      'nothing stands at the lot on REQ_MAP_LOAD',
      gone.ok,
      (gone.last ? `visual class ${gone.last.visualClass} still at ${where}` : `${where} is empty`) + kept,
    );
    if (delLine !== null && gone.ok) ctx.lock.clearPendingRestore(p.key);
  } catch (err: unknown) {
    assertions.check('the demolition cleanup ran without a throw', false, `${toErrorMessage(err)} — pending restore kept`);
  }
}

// ---------------------------------------------------------------------------------------------
// Inspector flows (#1154) — residential, bank, TV and research settings, repair, upgrades and
// accept-cloning on SPO_test3's own fixtures. Every write is set back: a setting to its original,
// a repair by its stop, a queued research by its cancel, an upgrade by its stop.
// ---------------------------------------------------------------------------------------------

/**
 * A boolean as the gateway compares it — by truthiness: `1`, `255` and `-1` are all `'1'`
 * (`wanted` / `held` in building-property-handler.ts). `undefined` when absent or blank.
 */
export function truthyFlag(value: string | undefined): '1' | '0' | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return Number(value) !== 0 ? '1' : '0';
}

/**
 * `Repairing: <name>` (Kernel/PopulatedBlock.pas:773) — never `Stop Repairing: <name>` (:781),
 * which carries the same marker.
 */
export function repairLineMatches(line: string, name: string): boolean {
  return new RegExp(`(?<!Stop )${escapeRegExp(`Repairing: ${name}`)}(?=\\s|$)`).test(line);
}

/** `Cancel Research: <id>` (Kernel/ResearchCenter.pas:396). */
export function cancelResearchLineMatches(line: string, id: string): boolean {
  return new RegExp(`${escapeRegExp(`Cancel Research: ${id}`)}(?=\\s|$)`).test(line);
}

/** `Facility Start Upgrade count: <count>` (Kernel/Kernel.pas:4675). */
export function startUpgradeLineMatches(line: string, count: number): boolean {
  return new RegExp(`${escapeRegExp(`Facility Start Upgrade count: ${count}`)}(?=\\s|$)`).test(line);
}

/**
 * The test interest: strictly below the original, never above, never negative (the flow drives
 * `Interest` only when it reads above 0). A loan granted during the window keeps its rate for
 * life (Kernel/Kernel.pas:8837), so a lower test rate never worsens another player's debt.
 */
export function lowerInterest(original: string): string {
  return String(Math.ceil(Number(original)) - 1);
}

/** One setting of a composite round trip. */
interface SettingMember {
  /** The key the section read carries. */
  key: string;
  /** The member's name in the report. */
  label: string;
  testValue: (original: string) => string;
  write: (value: string) => Promise<void>;
}

/**
 * Several settings of one tab in ONE round trip: write them all, wait once for the object-cache
 * refresh, read them all, restore them all, wait once more. None of these setters logs a Survival
 * line, so the read-back alone proves them — every member must read back the value written.
 */
function settingsRoundTrip(
  ctx: FlowContext,
  url: string,
  session: LiveSession,
  fx: OwnFixture,
  tabId: string,
  members: SettingMember[],
  why: string,
): Promise<ProbeResult> {
  const read = async (): Promise<string | undefined> => {
    const groups = await readSectionGroups(session, fx.x, fx.y, tabId, fx.visualClass);
    const values = members.map(m => propertyValue(groups, tabId, m.key));
    return values.some(v => v === undefined) ? undefined : values.join(',');
  };
  const label = members.map(m => m.label).join('+');
  return roundTripProbe(ctx, url, {
    what: `${fixtureLabel(fx)} ${label}`,
    member: label,
    read,
    write: async value => {
      const parts = value.split(',');
      for (const [i, m] of members.entries()) await m.write(parts[i]);
    },
    testValue: original => original.split(',').map((v, i) => members[i].testValue(v)).join(','),
    proof: {
      readBack: readBackOn(
        `${tabId}.${members.map(m => m.key).join(',')} at (${fx.x},${fx.y}) via the gateway's section read`,
        why,
        read,
      ),
    },
    restoreRecord: { x: fx.x, y: fx.y, propertyName: label },
  });
}

/** A `property` set of one published member, the way the inspector's sliders send it. */
function propertyWriter(session: LiveSession, fx: OwnFixture, propertyName: string): (value: string) => Promise<void> {
  return async value => {
    await setBuildingProperty(session, fx.x, fx.y, 'property', value, { propertyName });
  };
}

/** Whether the fixture's template carries the tab — otherwise `member` is untestable, nothing sent. */
async function hasTab(
  session: LiveSession,
  fx: OwnFixture,
  tabId: string,
  member: string,
  assertions: Assertions,
): Promise<boolean> {
  const details = await readBuildingDetails(session, fx.x, fx.y, fx.visualClass);
  if (details.tabs.some(t => t.id === tabId)) return true;
  assertions.untestable(member, `${fixtureLabel(fx)} carries no ${tabId} tab — its template does not offer it`);
  return false;
}

type FixtureSteps = (
  session: LiveSession,
  ctx: FlowContext,
  fx: OwnFixture,
  assertions: Assertions,
  probes: ProbeResult[],
) => Promise<void>;

/**
 * A flow on one fixture's tab: its seed ensures the kind (#1185); no fixture or no tab → untestable,
 * the run sends no write.
 */
function fixtureFlow(
  name: string,
  what: string,
  kind: FixtureKindId,
  tabId: string,
  member: string,
  steps: FixtureSteps,
): Flow {
  return {
    name,
    what,
    mutates: true,
    seed: fixtureSeed(kind),
    run: async ctx => {
      const assertions = new Assertions();
      const probes: ProbeResult[] = [];
      const session = await login(PRIMARY_ACCOUNT);
      try {
        const fx = await ownFixture(session, kind, assertions);
        if (fx && (await hasTab(session, fx, tabId, member, assertions))) {
          await steps(session, ctx, fx, assertions, probes);
        }
        return report(name, assertions, probes, session);
      } finally {
        await logoff(session);
      }
    },
  };
}

/** Rent and maintenance (`TPopulatedBlock.SetRent` / `SetMaintenance`, Kernel/PopulatedBlock.pas:722-758). */
const residentialSettings = fixtureFlow(
  'residential-settings',
  "Rent + Maintenance on SPO_test3's residential fixture — written together, read back, restored, read back",
  'residential',
  'resGeneral',
  'Rent+Maintenance',
  async (session, ctx, fx, assertions, probes) => {
    const probe = await settingsRoundTrip(
      ctx,
      await survivalUrl(ctx),
      session,
      fx,
      'resGeneral',
      [
        { key: 'Rent', label: 'Rent', testValue: v => nudgeWithin(v, 0, 200), write: propertyWriter(session, fx, 'Rent') },
        {
          key: 'Maintenance',
          label: 'Maintenance',
          testValue: v => nudgeWithin(v, 0, 200),
          write: propertyWriter(session, fx, 'Maintenance'),
        },
      ],
      `${FACILITY_CACHE_WHY} (Kernel/PopulatedBlock.pas:921-922 caches both verbatim)`,
    );
    probes.push(probe);
    checkProbe(assertions, probe);
  },
);

/**
 * Repair → stop repair on the residential fixture. `Repair` is a 0..100 progress, not a flag
 * (Kernel/PopulatedBlock.pas:623-638): "reads > 0" proves the repair, "reads 0" the stop (:783).
 * Driven only from 0 — a stop would cancel a repair the owner started. The repair's spend
 * between the two is the accepted cost (maintainer, 2026-09-29).
 */
const residentialRepair = fixtureFlow(
  'residential-repair',
  "RdoRepair on SPO_test3's residential fixture, only when Repair reads 0 — Repairing: line + Repair > 0, " +
    'then RdoStopRepair → Repair reads 0',
  'residential',
  'resGeneral',
  'RdoRepair',
  async (session, ctx, fx, assertions, probes) => {
    const groups = await readSectionGroups(session, fx.x, fx.y, 'resGeneral', fx.visualClass);
    const raw = propertyValue(groups, 'resGeneral', 'Repair');
    if (raw === undefined) {
      assertions.check('Repair is readable on the resGeneral tab', false, `${fixtureLabel(fx)}: no Repair — nothing sent`);
      return;
    }
    if (Number(raw) !== 0) {
      assertions.untestable(
        'RdoRepair',
        `Repair reads ${raw} — a repair of the owner's own is running; RdoStopRepair would cancel it (Kernel/PopulatedBlock.pas:783)`,
      );
      return;
    }
    const name = propertyValue(groups, 'resGeneral', 'Name') ?? fx.name;
    const readRepairing = async (): Promise<string | undefined> => {
      const value = propertyValue(
        await readSectionGroups(session, fx.x, fx.y, 'resGeneral', fx.visualClass),
        'resGeneral',
        'Repair',
      );
      return value === undefined ? undefined : Number(value) > 0 ? '1' : '0';
    };
    const probe = await roundTripProbe(ctx, await survivalUrl(ctx), {
      what: `${fixtureLabel(fx)} repair ("1" = Repair reads > 0)`,
      member: 'RdoRepair',
      read: readRepairing,
      testValue: () => '1',
      write: async value => {
        await setBuildingProperty(session, fx.x, fx.y, value === '1' ? 'RdoRepair' : 'RdoStopRepair', '0');
      },
      proof: {
        log: { marker: LOG_MARKERS.RdoRepair, match: line => repairLineMatches(line, name) },
        readBack: readBackOn(
          `resGeneral.Repair at (${fx.x},${fx.y}) via the gateway's section read, > 0 while repairing`,
          `${FACILITY_CACHE_WHY}; fRepair runs 0..100 (Kernel/PopulatedBlock.pas:623-638) and RdoStopRepair sets it to 0 (:783)`,
          readRepairing,
        ),
      },
      restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RdoStopRepair' },
    });
    probes.push(probe);
    checkProbe(assertions, probe);
  },
);

/**
 * The bank's interest, term and budget percentage — three live gets (`enrichBankTab`). Interest
 * only ever goes down (`lowerInterest`); an original of 0 leaves it unsent and untestable.
 */
const bankSettings = fixtureFlow(
  'bank-settings',
  "Interest (down only) + Term + RDOSetLoanPerc on SPO_test3's bank fixture — written together, read back, " +
    'restored, read back',
  'bank',
  'bankGeneral',
  'Interest+Term+RDOSetLoanPerc',
  async (session, ctx, fx, assertions, probes) => {
    const groups = await readSectionGroups(session, fx.x, fx.y, 'bankGeneral', fx.visualClass);
    const interest = propertyValue(groups, 'bankGeneral', 'Interest');
    const members: SettingMember[] = [];
    // An unreadable Interest stays in, so the round trip refuses to write and FAILs.
    if (interest === undefined || Number(interest) > 0) {
      members.push({ key: 'Interest', label: 'Interest', testValue: lowerInterest, write: propertyWriter(session, fx, 'Interest') });
    } else {
      assertions.untestable(
        'Interest',
        `reads ${interest} — the flow only nudges it down: a loan granted during the window keeps its rate for life (Kernel/Kernel.pas:8837)`,
      );
    }
    members.push(
      { key: 'Term', label: 'Term', testValue: v => nudgeWithin(v, 1, 100), write: propertyWriter(session, fx, 'Term') },
      {
        key: 'BudgetPerc',
        label: 'RDOSetLoanPerc',
        testValue: v => nudgeWithin(v, 0, 100),
        write: async value => {
          await setBuildingProperty(session, fx.x, fx.y, 'RDOSetLoanPerc', value);
        },
      },
    );
    const probe = await settingsRoundTrip(
      ctx,
      await survivalUrl(ctx),
      session,
      fx,
      'bankGeneral',
      members,
      'Interest, Term and BudgetPerc are live gets on the block (enrichBankTab), no object cache between',
    );
    probes.push(probe);
    checkProbe(assertions, probe);
  },
);

/**
 * `account`'s rows among the bank's granted loans (`bankLoans`: `LoanCount`, `Debtor<i>`, …,
 * `TBankBlock.StoreToCache`, StdBlocks/Banks.pas:194-204), or `undefined` when the group carries
 * no `LoanCount`. A non-tycoon debtor leaves a gap in the index (:197), so every `Debtor<i>` is
 * read, not `0..LoanCount-1`.
 */
export function bankDebtorCount(
  groups: { [groupId: string]: BuildingPropertyValue[] },
  account: E2eAccount,
): number | undefined {
  if (propertyValue(groups, 'bankLoans', 'LoanCount') === undefined) return undefined;
  return (groups.bankLoans ?? []).filter(p => /^Debtor\d+$/.test(p.name) && sameAccount(p.value, account)).length;
}

/** A read that may throw (`cacheUnavailable`), as `undefined`. */
async function readOrUndefined<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/** The block-form loan: the ordinal `TBankBlock.RDOAskLoan` answers, named. */
function loanRefusal(result: number): string {
  const outcome = bankLoanOutcomeOf(result);
  const why: Record<string, string> = {
    rejected: 'rejected (StdBlocks/Banks.pas:164-166)',
    notEnoughFunds: "granted but the owner's budget could not cover it (Kernel/Kernel.pas:8866-8870)",
    error: 'no answer from the block (the gateway sent no frame, or an unknown ordinal)',
  };
  return `the loan request answered ${result}: ${why[outcome] ?? outcome}`;
}

async function driveFacilityLoan(secondary: LiveSession, ctx: FlowContext): Promise<FlowResult> {
  const name = 'facility-bank-loan';
  const HIM = SECONDARY_ACCOUNT.username;
  const what = `${HIM}'s loan at the bank fixture → pay off round trip`;
  const assertions = new Assertions();
  const probes: ProbeResult[] = [];
  const me = await login(PRIMARY_ACCOUNT);
  try {
    const fx = await ownFixture(me, 'bank', assertions);
    if (!fx) return report(name, assertions, probes, me);

    // The owner must cover the loan: TBank.LoanApproved needs EstimateLoan >= Amount
    // (Kernel/Kernel.pas:8911), EstimateLoan is Owner.BankLoanLimit for an owned bank (:8813-8814),
    // min(1, BankLoanPerc/100) * Budget (:9095-9097). Short of it the loan is still granted with
    // brqNotEnoughFunds and only Owner.Budget taken (:8866-8870) — so the flow borrows nothing then.
    const general = await readOrUndefined(() => readSectionGroups(me, fx.x, fx.y, 'bankGeneral', fx.visualClass));
    const perc = general ? propertyValue(general, 'bankGeneral', 'BudgetPerc') : undefined;
    const balance = (await readOrUndefined(() => readBank(me)))?.balance;
    if (perc === undefined || perc.trim() === '' || balance === undefined || balance.trim() === '') {
      assertions.untestable(
        what,
        `the bank's BudgetPerc (${perc ?? 'unreadable'}) or ${PRIMARY_ACCOUNT.username}'s balance ` +
          `(${balance ?? 'unreadable'}) cannot be read — the owner's cover (Kernel/Kernel.pas:8813-8814, ` +
          ':9095-9097) is unknown; nothing borrowed',
      );
      return report(name, assertions, probes, me);
    }
    const cover = Math.min(1, Number(perc) / 100) * Number(balance);
    if (!(cover >= Number(BORROW_AMOUNT))) {
      assertions.untestable(
        what,
        `the owner's loan limit is ${cover} (BudgetPerc ${perc} of ${balance}, Kernel/Kernel.pas:9095-9097) < ` +
          `$${BORROW_AMOUNT} — TBank.LoanApproved would refuse it (Kernel/Kernel.pas:8911) or grant it ` +
          'uncovered (:8866-8870); nothing borrowed',
      );
      return report(name, assertions, probes, me);
    }

    const secondaryBank = await readOrUndefined(() => readBank(secondary));
    if (!secondaryBank || !(Number(secondaryBank.balance) > 0)) {
      assertions.untestable(
        what,
        `${HIM}'s balance ${secondaryBank?.balance ?? 'unreadable'} is not > 0 — RDOPayOff pays only if ` +
          'Loan.Amount < Budget - AprFee (Kernel/Kernel.pas:11572); nothing borrowed',
      );
      return report(name, assertions, probes, me);
    }
    const secondaryLoans = secondaryBank.loans;
    const readRows = async (): Promise<number | undefined> =>
      bankDebtorCount(await readSectionGroups(me, fx.x, fx.y, 'bankLoans', fx.visualClass), SECONDARY_ACCOUNT);
    const rows0 = await readOrUndefined(readRows);
    if (rows0 === undefined) {
      assertions.untestable(
        what,
        `${fixtureLabel(fx)}'s bankLoans group carries no LoanCount (StdBlocks/Banks.pas:194-204) — the ` +
          "bank's side of the loan cannot be read back; nothing borrowed",
      );
      return report(name, assertions, probes, me);
    }

    const url = await survivalUrl(ctx);
    const read = tolerantRead(async () => {
      const rows = await readRows();
      if (rows === undefined) return undefined;
      const delta = rows - rows0;
      return `secondary ${loanDelta(secondaryLoans, (await readBank(secondary)).loans)}; bank ${delta >= 0 ? '+' : ''}${delta}`;
    });
    const probe = await roundTripProbe(ctx, url, {
      what:
        `${HIM}'s $${BORROW_AMOUNT} loan at ${PRIMARY_ACCOUNT.username}'s bank ${fixtureLabel(fx)} — ${HIM} pays off ` +
        `the $${BORROW_AMOUNT} loan not among the ${secondaryLoans.length} loans listed before`,
      member: 'TBankBlock.RDOAskLoan',
      read,
      testValue: original => {
        if (original !== 'secondary new=none gone=0; bank +0') throw new Error(`the loan lists moved before the borrow: ${original}`);
        return `secondary new=${BORROW_AMOUNT} gone=0; bank +1`;
      },
      write: async () => {
        // The borrower is the session that asks: the gateway sends SPO_test's own proxy id
        // (requestBankLoan, building-details-handler.ts).
        const answer = await secondary.driver.request<WsRespBuildingLoanRequest>(
          { type: WsMessageType.REQ_BUILDING_LOAN_REQUEST, x: fx.x, y: fx.y, amount: BORROW_AMOUNT },
          WsMessageType.RESP_BUILDING_LOAN_REQUEST,
          TIMEOUTS.login,
        );
        if (answer.result !== 0) throw new Error(loanRefusal(answer.result));
      },
      restore: async () => {
        // brqNotEnoughFunds still leaves a loan (Kernel/Kernel.pas:8866-8870): pay off whatever was granted.
        const loan = newLoan(secondaryLoans, (await readBank(secondary)).loans);
        if (!loan) return;
        // TTycoon.RDOPayOff repays the bank owner and deletes the loan from the bank (Kernel/Kernel.pas:11555, :11592-11594).
        const answer = await secondary.driver.request<WsRespProfileBankAction>(
          { type: WsMessageType.REQ_PROFILE_BANK_ACTION, action: 'payoff', loanIndex: loan.loanIndex },
          WsMessageType.RESP_PROFILE_BANK_ACTION,
          TIMEOUTS.login,
        );
        if (answer.result?.success !== true) {
          throw new Error(
            `${HIM}'s payoff of loan ${loan.loanIndex} (${loan.bank}) refused: ${answer.result?.message ?? '(no result)'}`,
          );
        }
      },
      proof: {
        log: {
          marker: LOG_MARKERS['TBankBlock.RDOAskLoan'],
          // "Fac(<x>,<y>) AskLoan" (StdBlocks/Banks.pas:162) — never the tycoon's "AskLoan:" line.
          match: line => facLineMatches(line, fx.x, fx.y, 'AskLoan'),
        },
        readBack: {
          source: `${HIM}'s loan list on ${PAGE_BANK} and the Debtor rows of the bank's bankLoans group`,
          why:
            'both are object-cache reads RDOAskLoan / RDOPayOff invalidate or refresh within the TTL ' +
            '(Kernel/Kernel.pas:8873, :11594, :11596) — OB-29, bounded poll',
          read,
          boundMs: TIMEOUTS.readBack,
        },
      },
      restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOPayOff' },
    });
    probes.push(probe);
    checkProbe(assertions, probe);
    return report(name, assertions, probes, me);
  } finally {
    await logoff(me);
  }
}

/**
 * SPO_test borrows $1 at SPO_test3's bank fixture and pays it off (#1189, lifted by the maintainer on
 * 2026-09-29). GATE_ONLY: an approved loan posts a world event every online player sees
 * (Kernel/Kernel.pas:8849-8859). SPO_test logs in first — refused → SKIPPED, nothing sent. Nothing is
 * borrowed unless the owner covers the loan and SPO_test can pay it off.
 */
const facilityBankLoan: Flow = {
  name: 'facility-bank-loan',
  what:
    "SPO_test asks $1 at SPO_test3's bank fixture -> Fac(x,y) AskLoan line + SPO_test's loan list and the bank's " +
    'debtors show it -> SPO_test pays it off -> both lists as before',
  mutates: true,
  seed: fixtureSeed('bank'),
  run: async ctx => {
    const secondary = await loginSecondary();
    if ('skipped' in secondary) return skippedResult('facility-bank-loan', secondary.skipped);
    try {
      return await driveFacilityLoan(secondary, ctx);
    } finally {
      await logoff(secondary);
    }
  },
};

/** Hours on air and commercials, stored verbatim (StdBlocks/Broadcast.pas:51-53). */
const tvSettings = fixtureFlow(
  'tv-settings',
  "HoursOnAir + Commercials on SPO_test3's TV fixture — written together, read back, restored, read back",
  'tv',
  'tvGeneral',
  'HoursOnAir+Commercials',
  async (session, ctx, fx, assertions, probes) => {
    const probe = await settingsRoundTrip(
      ctx,
      await survivalUrl(ctx),
      session,
      fx,
      'tvGeneral',
      [
        { key: 'HoursOnAir', label: 'HoursOnAir', testValue: v => nudgeWithin(v, 0, 24), write: propertyWriter(session, fx, 'HoursOnAir') },
        // Read under the template's one-m key, written under the published two-m name (enrichTvTab).
        {
          key: 'Comercials',
          label: 'Commercials',
          testValue: v => nudgeWithin(v, 0, 100),
          write: propertyWriter(session, fx, 'Commercials'),
        },
      ],
      'HoursOnAir and Commercials are live gets on the block (enrichTvTab), stored verbatim (StdBlocks/Broadcast.pas:51-53)',
    );
    probes.push(probe);
    checkProbe(assertions, probe);
  },
);

/**
 * `RDOAcceptCloning` toggled and toggled back. Its read is the live get `enrichUpgradeTab` makes
 * — no object cache between — and each write must come back `confirmed: true` from the gateway's
 * own live get. Every comparison is by truthiness (`truthyFlag`).
 */
const acceptCloning = fixtureFlow(
  'accept-cloning',
  "RDOAcceptCloning on SPO_test3's industry fixture — toggled (confirmed + read back by truthiness), toggled back",
  'industry',
  'upgrade',
  'RDOAcceptCloning',
  async (session, ctx, fx, assertions, probes) => {
    const readCloning = async (): Promise<string | undefined> =>
      truthyFlag(propertyValue(await readSectionGroups(session, fx.x, fx.y, 'upgrade', fx.visualClass), 'upgrade', 'AcceptCloning'));
    const probe = await roundTripProbe(ctx, await survivalUrl(ctx), {
      what: `${fixtureLabel(fx)} accepts cloning ("1" = true)`,
      member: 'RDOAcceptCloning',
      read: readCloning,
      testValue: original => (original === '1' ? '0' : '1'),
      write: async value => {
        const r = await setBuildingProperty(session, fx.x, fx.y, 'RDOAcceptCloning', value);
        if (r.confirmed !== true) {
          throw new Error(`RDOAcceptCloning ${value}: the gateway's live get did not confirm it (holds "${r.newValue}")`);
        }
      },
      proof: {
        readBack: readBackOn(
          `upgrade.AcceptCloning at (${fx.x},${fx.y}), by truthiness`,
          'the live RDOAcceptCloning get enrichUpgradeTab makes — no object cache between; the member prints no Survival line',
          readCloning,
        ),
      },
      restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOAcceptCloning' },
    });
    probes.push(probe);
    checkProbe(assertions, probe);
  },
);

/**
 * Same town + same company + salaries only: `cloneOption_SameTown = $1`, `cloneOption_SameCompany
 * = $2`, `cloneOption_Salaries = $100` (Kernel/CloneOptions.pas:7-8, :13) — the scope the
 * maintainer lifted the clone exclusion for (2026-09-29).
 */
export const CLONE_SALARIES_OPTIONS = 0x103;

/**
 * A salary triplet `hi,mid,lo` differing from `source` and from every one of `others`: the first
 * **published** class moved ±1, ±2, … inside 0..255, toward the middle first (as `nudgeWithin`),
 * the unpublished slots kept empty (as `salariesNudge`, Kernel/WorkCenterBlock.pas:567-571). Throws
 * when no class is published, or when no such triplet exists.
 */
export function distinctSalaries(source: string, others: string[]): string {
  const slots = source.split(',');
  const k = slots.findIndex(s => s.trim() !== '');
  if (k < 0) throw new Error(`no salary class is published ("${source}") — nothing to nudge`);
  const base = Math.round(Number(slots[k]));
  const taken = new Set([source, ...others]);
  const toward = base >= 127.5 ? -1 : 1;
  for (let step = 1; step <= 255; step++) {
    for (const candidate of [base + toward * step, base - toward * step]) {
      if (candidate < 0 || candidate > 255) continue;
      const triplet = slots.map((s, i) => (i === k ? String(candidate) : s)).join(',');
      if (!taken.has(triplet)) return triplet;
    }
  }
  throw new Error(`no salary triplet inside 0..255 differs from ${source} and ${others.join(' ')}`);
}

/** `CloneFacility: <TycoonId>` (Kernel/World.pas:4801) — the id whole, so 12 never matches 1. */
export function cloneLineMatches(line: string, tycoonId: string): boolean {
  return new RegExp(`${escapeRegExp(`CloneFacility: ${tycoonId}`)}(?=\\s|$)`).test(line);
}

/** `workforce.Salaries0..2` as `hi,mid,lo`, or `undefined` when any of the three is unreadable. */
async function readSalaryTriplet(session: LiveSession, h: Holding): Promise<string | undefined> {
  const groups = await readOrUndefined(() => readSectionGroups(session, h.x, h.y, 'workforce', h.visualClass));
  if (!groups) return undefined;
  const values = WORKER_KINDS.map(i => propertyValue(groups, 'workforce', `Salaries${i}`));
  return values.some(v => v === undefined) ? undefined : values.join(',');
}

/** The live `AcceptCloning` get (`enrichUpgradeTab`), by truthiness. */
async function readAcceptCloning(session: LiveSession, h: Holding): Promise<'1' | '0' | undefined> {
  const groups = await readOrUndefined(() => readSectionGroups(session, h.x, h.y, 'upgrade', h.visualClass));
  return groups ? truthyFlag(propertyValue(groups, 'upgrade', 'AcceptCloning')) : undefined;
}

const holdingKey = (h: { x: number; y: number }): string => `${h.x},${h.y}`;

/** `x,y=hi,mid,lo;…` → one entry per facility. */
function parseSalarySegments(value: string): { key: string; triplet: string }[] {
  return value.split(';').map(segment => {
    const [key, triplet] = segment.split('=');
    return { key, triplet };
  });
}

async function cloneSalariesSteps(
  session: LiveSession,
  ctx: FlowContext,
  assertions: Assertions,
  probes: ProbeResult[],
): Promise<void> {
  const what = 'the salaries clone round trip';
  const holdings = (await scanHoldings(session)).holdings.filter(h => h.tabIds.includes('workforce'));
  const cls = holdings.find(h => holdings.filter(o => o.visualClass === h.visualClass).length >= 2)?.visualClass;
  if (cls === undefined) {
    assertions.untestable(
      what,
      'no two finished SPO_test3 work centers of one class in Helartia; TWorld.CloneFacility writes only the ' +
        'same FacId (Kernel/World.pas:3529); nothing sent',
    );
    return;
  }
  const [source, ...same] = holdings.filter(h => h.visualClass === cls);
  const guards = holdings.filter(h => h.visualClass !== cls);
  // Every other work center is listed too: the FacId is not readable over the WS, so a class that
  // shares it would be written as well — it must read back unchanged, and is restored if it moved.
  const listed = [source, ...same, ...guards];

  const originals = new Map<string, string>();
  for (const h of listed) {
    const triplet = await readSalaryTriplet(session, h);
    if (triplet === undefined) {
      assertions.untestable(
        what,
        `the salaries of ${fixtureLabel(h)} cannot be read (workforce.Salaries0..2) — it could not be restored ` +
          'or proven unchanged; nothing sent',
      );
      return;
    }
    originals.set(holdingKey(h), triplet);
  }
  const accepting = new Set<string>();
  for (const h of same) {
    const flag = await readAcceptCloning(session, h);
    if (flag === undefined) {
      assertions.untestable(
        what,
        `${fixtureLabel(h)}'s AcceptCloning cannot be read — whether the clone writes it is unknown ` +
          '(Kernel/Kernel.pas:5101-5104); nothing sent',
      );
      return;
    }
    if (flag === '1') accepting.add(holdingKey(h));
  }
  if (accepting.size === 0) {
    assertions.untestable(
      what,
      `no ${cls} target accepts cloning — TFacility.CopySettingsFrom skips it (Kernel/Kernel.pas:5101-5104); nothing sent`,
    );
    return;
  }

  const sourceTriplet = originals.get(holdingKey(source)) as string;
  if (sourceTriplet.split(',').every(s => s.trim() === '')) {
    assertions.untestable(
      what,
      `${fixtureLabel(source)} publishes no salary class — TWorkCenter.StoreToCache writes Salaries<k> only for ` +
        'a class with capacity (Kernel/WorkCenterBlock.pas:567-571), so no clone could be read back; nothing sent',
    );
    return;
  }
  const written = distinctSalaries(sourceTriplet, same.map(h => originals.get(holdingKey(h)) as string));
  const byKey = new Map(listed.map(h => [holdingKey(h), h]));
  const tycoonId = ownTycoonId(session);
  const writeSalaries = async (h: Holding, triplet: string): Promise<void> => {
    // An unpublished slot reads "" and goes as 0 — never `parseInt('')` into RdoValue.int.
    const [salary0, salary1, salary2] = triplet.split(',').map(salaryArg);
    await setBuildingProperty(session, h.x, h.y, 'RDOSetSalaries', salary0, { salary0, salary1, salary2 });
  };
  const readAll = async (): Promise<string | undefined> => {
    const segments: string[] = [];
    for (const h of listed) {
      const triplet = await readSalaryTriplet(session, h);
      if (triplet === undefined) return undefined;
      segments.push(`${holdingKey(h)}=${triplet}`);
    }
    return segments.join(';');
  };

  const probe = await roundTripProbe(ctx, await survivalUrl(ctx), {
    what: `salaries clone (options 0x103) from ${fixtureLabel(source)} — put back every listed facility's hi,mid,lo`,
    member: 'CloneFacility',
    read: readAll,
    // The source and each accepting target take the new triplet; a refusing target and every
    // other work center keep their own.
    testValue: original =>
      parseSalarySegments(original)
        .map(({ key, triplet }) => `${key}=${key === holdingKey(source) || accepting.has(key) ? written : triplet}`)
        .join(';'),
    write: async () => {
      await writeSalaries(source, written);
      const answer = await session.driver.request<WsRespCloneFacility>(
        { type: WsMessageType.REQ_CLONE_FACILITY, x: source.x, y: source.y, options: CLONE_SALARIES_OPTIONS },
        WsMessageType.RESP_CLONE_FACILITY,
      );
      if (answer.success !== true) throw new Error(`REQ_CLONE_FACILITY answered success ${String(answer.success)}`);
    },
    restore: async original => {
      const failures: string[] = [];
      for (const { key, triplet } of parseSalarySegments(original)) {
        const h = byKey.get(key) as Holding;
        if ((await readSalaryTriplet(session, h)) === triplet) continue;
        try {
          await writeSalaries(h, triplet);
        } catch (err: unknown) {
          failures.push(`${fixtureLabel(h)}: ${toErrorMessage(err)}`);
        }
      }
      if (failures.length > 0) throw new Error(`salaries not put back: ${failures.join('; ')}`);
    },
    proof: {
      log: { marker: LOG_MARKERS.CloneFacility, match: line => cloneLineMatches(line, tycoonId) },
      readBack: readBackOn(
        "workforce.Salaries0..2 of every listed facility via the gateway's section read",
        'RDOCloneFacility only queues the clone (Kernel/World.pas:4815), drained once per simulation cycle ' +
          "(:1996-1998); each target's cache then refreshes within its TTL (OB-29) — bounded poll",
        tolerantRead(readAll),
      ),
    },
    restoreRecord: { x: source.x, y: source.y, propertyName: 'RDOSetSalaries' },
  });
  probes.push(probe);
  checkProbe(assertions, probe);
}

/**
 * The salaries-only clone (#1189, lifted by the maintainer on 2026-09-29). `TWorld.CloneFacility`
 * (Kernel/World.pas:3494) writes every facility of the source's kind of that company in that town,
 * so every SPO_test3 work center in Helartia is snapshotted before anything is sent, and each one
 * is restored in the same run. A target refusing cloning (Kernel/Kernel.pas:5101-5104) must read
 * back unchanged. An unreadable target, or no accepting one, is UNTESTABLE with nothing sent.
 */
const cloneSalariesRoundTrip: Flow = {
  name: 'clone-salaries-roundtrip',
  what:
    "snapshot every SPO_test3 work center's salaries in Helartia -> a distinct salary on the source -> " +
    'REQ_CLONE_FACILITY (0x103) -> CloneFacility: line + every accepting target equal to the source -> restore all',
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      await cloneSalariesSteps(session, ctx, assertions, probes);
      return report('clone-salaries-roundtrip', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * Queue Happy Hour, prove it is in development, cancel it. It starts from any state: one left owned
 * or in development by an earlier run is cancelled/sold first (Kernel/ResearchCenter.pas:354-372).
 * After the queue the cancel is always sent — it removes a queued invention and sells one bought at
 * once (`Time = 0`, :319-334) — and the inventory reading `available` again decides the restore.
 */
const researchRoundTrip = fixtureFlow(
  'research-roundtrip',
  "REQ_RESEARCH_INVENTORY + DETAILS for Happy Hour on SPO_test3's research fixture → RDOQueueResearch (Queue Research: line, " +
    'in development) → RDOCancelResearch (Cancel Research: line, no longer queued)',
  'research',
  'hqInventions',
  'RDOQueueResearch',
  async (session, ctx, fx, assertions) => {
    try {
      await researchSteps(session, ctx, fx, assertions);
    } catch (err: unknown) {
      assertions.check('the research steps ran without a throw', false, toErrorMessage(err));
    }
  },
);

async function researchSteps(session: LiveSession, ctx: FlowContext, fx: OwnFixture, assertions: Assertions): Promise<void> {
  // CatCount is the highest category index, not a count (Kernel/ResearchCenter.pas:820).
  const groups = await readSectionGroups(session, fx.x, fx.y, 'hqInventions', fx.visualClass);
  const parsed = Number(propertyValue(groups, 'hqInventions', 'CatCount') ?? '0');
  const catMax = Number.isFinite(parsed) ? parsed : 0;

  const cash = await readCash(session);
  if (cash === null) {
    assertions.untestable('RDOQueueResearch', 'cash unknown — no EVENT_TYCOON_UPDATE received');
    return;
  }

  // The one pinned invention (maintainer, PR #1214), wherever the building lists it — the
  // category index is read, not assumed. The three lists are exclusive (researchState).
  const { id, name } = RESEARCH_TARGET;
  const at = `${fx.name} (${fx.x},${fx.y})`;
  let found: { category: number; state: ResearchState; enabled: boolean } | undefined;
  for (let category = 0; category <= catMax && !found; category++) {
    const { data } = await researchInventory(session, fx, category);
    const state = researchState(data, id);
    if (state !== 'absent') {
      found = { category, state, enabled: data.available.some(i => i.inventionId === id && i.enabled === true) };
    }
  }
  if (!found) {
    assertions.untestable('RDOQueueResearch', `${name} not listed at ${at} (categories 0..${catMax})`);
    return;
  }
  const { category } = found;
  const stateOf = async (): Promise<ResearchState> => researchState((await researchInventory(session, fx, category)).data, id);
  // Isolated target (RESEARCH_TARGET): a leftover is cancelled/sold first, with no pending restore.
  if (found.state === 'owned' || found.state === 'developing') {
    await setBuildingProperty(session, fx.x, fx.y, 'RDOCancelResearch', '0', { inventionId: id });
    const reset = await pollUntil(stateOf, s => s === 'available', ctx);
    if (!reset.ok) {
      assertions.untestable(
        'RDOQueueResearch',
        `${name} at ${at}: read ${found.state}, cancel/sell sent, still reads ${reset.last} — not reset; nothing else sent`,
      );
      return;
    }
    const { data } = await researchInventory(session, fx, category);
    found = { category, state: 'available', enabled: data.available.some(i => i.inventionId === id && i.enabled === true) };
  }
  if (!found.enabled) {
    assertions.untestable(
      'RDOQueueResearch',
      `${name} at ${at}: listed but not enabled — its prerequisite Bars is not owned, or the tier / nobility does not match ` +
        '(TInvention.Enabled, Inventions/Inventions.pas:658-693); nothing sent',
    );
    return;
  }

  const details = await readResearchDetails(session, fx, id);
  const properties = details.properties.trim().replace(/\s+/g, ' ');
  assertions.check(
    `REQ_RESEARCH_DETAILS answers for ${id} with its properties`,
    details.inventionId === id && properties !== '',
    `${details.inventionId}: ${properties || '(no properties)'}`,
  );
  // One the account cannot pay for is accepted, then dropped at once (StartResearch,
  // Kernel/ResearchCenter.pas:240-253) — it would never read queued.
  const cost = researchCost(details.properties);
  if (cost > cash) {
    assertions.untestable('RDOQueueResearch', `${name} costs $${cost} (Price + License), above the cash ($${cash}); nothing sent`);
    return;
  }

  const url = await survivalUrl(ctx);
  const key = `research-roundtrip:${randomUUID()}`;
  ctx.lock.addPendingRestore({
    key,
    x: fx.x,
    y: fx.y,
    propertyName: 'RDOCancelResearch',
    what:
      `cancel/sell research ${id} at (${fx.x},${fx.y}) — queued by research-roundtrip; RDOCancelResearch removes a queued ` +
      `invention and sells an owned one (Kernel/ResearchCenter.pas:354-372); ${name} is an isolated test invention, so ` +
      'selling it is the intended undo',
    originalValue: 'available',
  });

  let queued = false;
  let refused = false;
  try {
    const window = await openLogWindow(url);
    queued = true;
    await setBuildingProperty(session, fx.x, fx.y, 'RDOQueueResearch', '0', { inventionId: id, priority: '10' });
    const line = await awaitMarker(
      window,
      { marker: LOG_MARKERS.RDOQueueResearch, match: l => queueResearchLineMatches(l, id) },
      TIMEOUTS.logSettle,
      undefined,
      ctx.now,
      ctx.sleep,
    );
    assertions.check('the queue logged its Queue Research: line', line !== null, line ?? describeLogMiss(window, `(no Queue Research: line for ${id})`));
    const listed = await pollUntil(stateOf, s => s !== 'available' && s !== 'absent', ctx);
    if (listed.last === 'owned') {
      assertions.check(
        `${id} is listed in development, not owned`,
        false,
        `bought at once: ${id} (${properties}) — an invention with Time = 0 is bought on the spot ` +
          '(Kernel/ResearchCenter.pas:319-334) — sold back by the cancel',
      );
    } else if (listed.last === 'available') {
      // Reads exactly what the pending restore would put back: the server dropped the queue and
      // nothing is owed. No cancel — nothing is queued (Kernel/ResearchCenter.pas:240-253).
      refused = true;
      ctx.lock.clearPendingRestore(key);
      assertions.check(
        `${id} is listed in development, not owned`,
        false,
        `the server did not take the queue — ${id} (${properties}) still reads available; nothing to cancel, ` +
          'world unchanged, pending restore cleared',
      );
    } else {
      assertions.check(
        `${id} is listed in development, not owned`,
        listed.ok,
        listed.ok ? `${id} in development` : `never listed in development — reads ${listed.last}; cancel sent anyway`,
      );
    }
  } catch (err: unknown) {
    assertions.check('the queue steps ran without a throw', false, toErrorMessage(err));
  }
  if (queued && !refused) await cancelQueuedResearch(session, ctx, fx, { id, key, url, stateOf }, assertions);
}

/**
 * The cancel, always sent whatever the state — a queued invention is removed, an owned one sold,
 * an absent one is harmless for the isolated target (RESEARCH_TARGET). The inventory reading
 * `available` clears the pending restore whatever the log said; one retry before it is kept.
 */
async function cancelQueuedResearch(
  session: LiveSession,
  ctx: FlowContext,
  fx: OwnFixture,
  q: { id: string; key: string; url: string; stateOf: () => Promise<ResearchState> },
  assertions: Assertions,
): Promise<void> {
  try {
    let line: string | null = null;
    let searched: LogWindow | undefined;
    let back: { ok: boolean; last: ResearchState } = { ok: false, last: 'absent' };
    for (let attempt = 1; attempt <= 2 && !back.ok; attempt++) {
      const window = await openLogWindow(q.url);
      await setBuildingProperty(session, fx.x, fx.y, 'RDOCancelResearch', '0', { inventionId: q.id });
      if (line === null) searched = window;
      line ??= await awaitMarker(
        window,
        { marker: LOG_MARKERS.RDOCancelResearch, match: l => cancelResearchLineMatches(l, q.id) },
        TIMEOUTS.logSettle,
        undefined,
        ctx.now,
        ctx.sleep,
      );
      back = await pollUntil(q.stateOf, s => s === 'available', ctx);
    }
    if (back.ok) ctx.lock.clearPendingRestore(q.key);
    const kept = back.ok ? '' : ' — pending restore kept';
    assertions.check('the cancel logged its Cancel Research: line', line !== null, line ?? describeLogMiss(searched, `(no Cancel Research: line for ${q.id})`));
    assertions.check(`the inventory reads ${q.id} available again`, back.ok, `reads ${back.last}${kept}`);
  } catch (err: unknown) {
    assertions.check('the research cancel ran without a throw', false, `${toErrorMessage(err)} — pending restore kept`);
  }
}

/** The upgrade tab's cached counters (Kernel/Kernel.pas:5896-5899) and the live AcceptCloning. */
interface UpgradeState {
  level: number;
  upgrading: number;
  pending: number;
  max: number;
  cloning: '1' | '0' | undefined;
}

async function readUpgrade(session: LiveSession, fx: OwnFixture): Promise<UpgradeState> {
  const groups = await readSectionGroups(session, fx.x, fx.y, 'upgrade', fx.visualClass);
  const num = (name: string): number => {
    const raw = propertyValue(groups, 'upgrade', name);
    return raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  };
  return {
    level: num('UpgradeLevel'),
    upgrading: num('Upgrading'),
    pending: num('Pending'),
    max: num('MaxUpgrade'),
    cloning: truthyFlag(propertyValue(groups, 'upgrade', 'AcceptCloning')),
  };
}

const upgradeText = (u: UpgradeState): string =>
  `level ${u.level}/${u.max}, Upgrading ${u.upgrading}, Pending ${u.pending}, AcceptCloning ${u.cloning ?? '(unread)'}`;

/** What the upgrade flow must undo, and whether its START went out. */
interface UpgradeRun {
  key: string;
  url: string;
  level0: number;
  cloning0: '1' | '0';
  startSent: boolean;
}

function requestUpgrade(
  session: LiveSession,
  fx: OwnFixture,
  action: 'START_UPGRADE' | 'STOP_UPGRADE',
): Promise<WsRespBuildingUpgrade> {
  return session.driver.request<WsRespBuildingUpgrade>(
    { type: WsMessageType.REQ_BUILDING_UPGRADE, x: fx.x, y: fx.y, action, ...(action === 'START_UPGRADE' ? { count: 1 } : {}) },
    WsMessageType.RESP_BUILDING_UPGRADE,
  );
}

/**
 * Start one upgrade and stop it (`manageConstructionImpl`, building-management-handler.ts). The
 * handler refuses unless AcceptCloning reads true, writes `-1` itself and never restores it — so
 * the flow sets AcceptCloning back to its original's truthiness after the STOP. Driven only on a
 * fixture below MaxUpgrade with nothing upgrading or pending: `TBlock.StartUpgrading` is a no-op
 * while `fUpgradeHours > 0` (Kernel/Kernel.pas:6525), and the STOP would cancel an upgrade the
 * flow did not start. A level that completes before the STOP cannot be undone (downgrade is
 * excluded) and FAILs.
 */
const upgradeStop = fixtureFlow(
  'upgrade-stop',
  "REQ_BUILDING_UPGRADE START (count 1) on SPO_test3's industry fixture → Start Upgrade line + Upgrading/Pending " +
    '→ STOP → Stop Upgrade line + zeros + level unchanged → AcceptCloning back to its original',
  'industry',
  'upgrade',
  'REQ_BUILDING_UPGRADE',
  async (session, ctx, fx, assertions) => {
    try {
      await upgradeSteps(session, ctx, fx, assertions);
    } catch (err: unknown) {
      assertions.check('the upgrade pre-checks ran without a throw', false, toErrorMessage(err));
    }
  },
);

async function upgradeSteps(session: LiveSession, ctx: FlowContext, fx: OwnFixture, assertions: Assertions): Promise<void> {
  const before = await readUpgrade(session, fx);
  const counters = [before.level, before.upgrading, before.pending, before.max];
  if (counters.some(n => !Number.isFinite(n)) || before.cloning === undefined) {
    assertions.check('the upgrade tab reads UpgradeLevel, Upgrading, Pending, MaxUpgrade and AcceptCloning', false, upgradeText(before));
    return;
  }
  if (before.level >= before.max) {
    assertions.untestable('REQ_BUILDING_UPGRADE', `${fixtureLabel(fx)} is at MaxUpgrade (${before.level}/${before.max}) — nothing to start`);
    return;
  }
  if (before.upgrading > 0 || before.pending > 0) {
    assertions.untestable(
      'REQ_BUILDING_UPGRADE',
      `${fixtureLabel(fx)} is already upgrading (Upgrading ${before.upgrading}, Pending ${before.pending}) — ` +
        'TBlock.StartUpgrading is a no-op while fUpgradeHours > 0 (Kernel/Kernel.pas:6525), and the STOP would cancel ' +
        'an upgrade the flow did not start; nothing sent',
    );
    return;
  }

  const run: UpgradeRun = {
    key: `upgrade-stop:${randomUUID()}`,
    url: await survivalUrl(ctx),
    level0: before.level,
    cloning0: before.cloning,
    startSent: false,
  };
  ctx.lock.addPendingRestore({
    key: run.key,
    x: fx.x,
    y: fx.y,
    propertyName: 'RDOStopUpgrade+RDOAcceptCloning',
    what:
      `stop the upgrade at (${fx.x},${fx.y}) of ${fixtureLabel(fx)}, set AcceptCloning back to ` +
      `${run.cloning0 === '1' ? 'true' : 'false'} — upgrade-stop started one upgrade from level ${run.level0}; ` +
      `do both as ${PRIMARY_ACCOUNT.username}, then npm run e2e:unlock`,
    originalValue: `level ${run.level0}, AcceptCloning ${run.cloning0}`,
  });

  try {
    await startUpgrade(session, ctx, fx, run, assertions);
  } catch (err: unknown) {
    assertions.check('the upgrade steps ran without a throw', false, toErrorMessage(err));
  }
  await undoUpgrade(session, ctx, fx, run, assertions);
}

async function startUpgrade(
  session: LiveSession,
  ctx: FlowContext,
  fx: OwnFixture,
  run: UpgradeRun,
  assertions: Assertions,
): Promise<void> {
  if (run.cloning0 === '0') {
    const r = await setBuildingProperty(session, fx.x, fx.y, 'RDOAcceptCloning', '1');
    assertions.check(
      'AcceptCloning set true before the START (manageConstructionImpl refuses otherwise)',
      r.confirmed === true,
      `live get holds "${r.newValue}"`,
    );
    if (r.confirmed !== true) return;
  }
  const window = await openLogWindow(run.url);
  run.startSent = true;
  const started = await requestUpgrade(session, fx, 'START_UPGRADE');
  assertions.check('the gateway accepted START_UPGRADE', started.success === true, started.message);
  const line = await awaitMarker(
    window,
    { marker: LOG_MARKERS.RDOStartUpgrades, match: l => startUpgradeLineMatches(l, 1) },
    TIMEOUTS.logSettle,
    undefined,
    ctx.now,
    ctx.sleep,
  );
  assertions.check('the START logged Facility Start Upgrade count: 1', line !== null, line ?? describeLogMiss(window, '(no Facility Start Upgrade count: 1 line)'));
  const moved = await pollUntil(() => readUpgrade(session, fx), u => u.upgrading > 0 || u.pending >= 1, ctx);
  assertions.check(
    'Upgrading or Pending moved after the START',
    moved.ok,
    moved.ok ? upgradeText(moved.last) : `neither Upgrading nor Pending moved — ${upgradeText(moved.last)}`,
  );
}

/** `readUpgrade` that answers a rejected read with its error text instead of a throw — "not yet". */
async function tryReadUpgrade(session: LiveSession, fx: OwnFixture): Promise<UpgradeState | string> {
  try {
    return await readUpgrade(session, fx);
  } catch (err: unknown) {
    return toErrorMessage(err);
  }
}

/** Nothing upgrading or pending, at the original level — the STOP is proven. */
function idleAt(u: UpgradeState | string | undefined, level0: number): boolean {
  return typeof u === 'object' && u.upgrading === 0 && u.pending === 0 && u.level === level0;
}

const upgradeOrError = (u: UpgradeState | string | undefined): string =>
  typeof u === 'object' ? upgradeText(u) : `read failed: ${u ?? '(no read)'}`;

/**
 * AcceptCloning back to its original's truthiness, then one read of the upgrade tab — returned so
 * the caller can use it as a second proof of the STOP.
 */
async function restoreCloning(
  session: LiveSession,
  fx: OwnFixture,
  run: UpgradeRun,
  assertions: Assertions,
  suffix: string,
): Promise<{ back: boolean; after: UpgradeState | string | undefined }> {
  try {
    const r = await setBuildingProperty(session, fx.x, fx.y, 'RDOAcceptCloning', run.cloning0);
    assertions.check(
      `AcceptCloning set back to ${run.cloning0 === '1' ? 'true' : 'false'}, confirmed by the gateway's live get${suffix}`,
      r.confirmed === true,
      `live get holds "${r.newValue}"`,
    );
    const after = await tryReadUpgrade(session, fx);
    const cloning = typeof after === 'object' ? after.cloning : undefined;
    assertions.check(
      `AcceptCloning reads its original truthiness${suffix}`,
      cloning === run.cloning0,
      typeof after === 'object' ? `reads ${cloning ?? '(unread)'}, original ${run.cloning0}` : `read failed: ${after}`,
    );
    return { back: r.confirmed === true && cloning === run.cloning0, after };
  } catch (err: unknown) {
    assertions.check(`the AcceptCloning restore ran without a throw${suffix}`, false, `${toErrorMessage(err)} — pending restore kept`);
    return { back: false, after: undefined };
  }
}

/**
 * The STOP when the START went out, then — always — AcceptCloning back to its original's
 * truthiness, which also undoes the handler's own `-1`. The read-back after the STOP polls past
 * a failed read ("not yet"); the server's cached counters can read stale for ~2 min after a STOP
 * (`TBlock.StopUpgrading` refreshes the cache before zeroing, Kernel/Kernel.pas:6554-6560;
 * Kernel/KernelCache.pas:405), so the AcceptCloning restore's own read is a second chance. If that
 * read still shows an upgrade running, one more STOP is sent (ignored when idle,
 * Kernel/Kernel.pas:4694) and re-checked once. The pending restore is kept only when the upgrade
 * is still provably running, every read failed, or AcceptCloning does not read its original.
 */
async function undoUpgrade(
  session: LiveSession,
  ctx: FlowContext,
  fx: OwnFixture,
  run: UpgradeRun,
  assertions: Assertions,
): Promise<void> {
  let proof: UpgradeState | string | undefined;
  let polled = false;
  let reachedPoll = false;
  if (run.startSent) {
    try {
      const window = await openLogWindow(run.url);
      const r = await requestUpgrade(session, fx, 'STOP_UPGRADE');
      assertions.check('the gateway accepted STOP_UPGRADE', r.success === true, r.message);
      // The line carries no coordinates (Kernel/Kernel.pas:4689): the read-back attributes it.
      const line = await awaitMarker(window, { marker: LOG_MARKERS.RDOStopUpgrade }, TIMEOUTS.logSettle, undefined, ctx.now, ctx.sleep);
      assertions.check('the STOP logged Facility Stop Upgrade..', line !== null, line ?? describeLogMiss(window, '(no Facility Stop Upgrade.. line)'));
      const idle = await pollUntil(
        () => tryReadUpgrade(session, fx),
        u => typeof u === 'object' && u.upgrading === 0 && u.pending === 0,
        ctx,
      );
      reachedPoll = true;
      polled = idle.ok;
      proof = idle.last;
    } catch (err: unknown) {
      assertions.check('the upgrade STOP ran without a throw', false, `${toErrorMessage(err)} — pending restore kept`);
    }
  }
  const lastPoll = proof;

  let restored = await restoreCloning(session, fx, run, assertions, '');
  if (!run.startSent) {
    if (restored.back) ctx.lock.clearPendingRestore(run.key);
    return;
  }

  let source = '';
  if (!polled) {
    // A failed restore read falls back on the poll's last state, never on a worse proof.
    proof = typeof restored.after === 'object' || typeof lastPoll !== 'object' ? (restored.after ?? lastPoll) : lastPoll;
    if (typeof restored.after === 'object') source = ' (from the read after the AcceptCloning restore)';
  }
  if (typeof proof === 'object' && (proof.upgrading > 0 || proof.pending > 0)) {
    try {
      if (run.cloning0 === '0') {
        const set = await setBuildingProperty(session, fx.x, fx.y, 'RDOAcceptCloning', '1');
        assertions.check(
          'AcceptCloning set true before the second STOP (manageConstructionImpl refuses otherwise)',
          set.confirmed === true,
          `live get holds "${set.newValue}"`,
        );
      }
      const r = await requestUpgrade(session, fx, 'STOP_UPGRADE');
      assertions.check('the gateway accepted the second STOP_UPGRADE', r.success === true, r.message);
      restored = await restoreCloning(session, fx, run, assertions, ' (after the second STOP)');
      proof = restored.after;
      source = ' (after a second STOP)';
    } catch (err: unknown) {
      assertions.check('the second STOP ran without a throw', false, `${toErrorMessage(err)} — pending restore kept`);
    }
  }

  if (reachedPoll && proof !== undefined) {
    const zeros = typeof proof === 'object' && proof.upgrading === 0 && proof.pending === 0;
    assertions.check(
      'Upgrading and Pending read 0 after the STOP',
      zeros,
      zeros
        ? `${upgradeOrError(proof)}${source}`
        : typeof proof === 'object'
          ? `${upgradeText(proof)}${source} — still upgrading, pending restore kept`
          : `every read failed: ${proof}, pending restore kept`,
    );
    if (typeof proof === 'object') {
      const sameLevel = proof.level === run.level0;
      assertions.check(
        'UpgradeLevel equals its original after the STOP',
        sameLevel,
        sameLevel
          ? `level ${run.level0}`
          : `a level completed before the STOP — downgrade is excluded, level ${run.level0}→${proof.level} kept`,
      );
    }
  }
  if (idleAt(proof, run.level0) && restored.back) ctx.lock.clearPendingRestore(run.key);
}

/** A chat name is SPO_test3's own — `ChatMsg`'s `From` may still carry `/AccDesc`. */
function isSelf(name: string): boolean {
  return sameAccount(name.split('/')[0], PRIMARY_ACCOUNT);
}

/** Run one step; its assertion holds exactly when the step did not throw. */
async function attempt(assertions: Assertions, what: string, step: () => Promise<unknown>): Promise<boolean> {
  let error: string | undefined;
  try {
    await step();
  } catch (err: unknown) {
    error = toErrorMessage(err);
  }
  assertions.check(what, error === undefined, error);
  return error === undefined;
}

/**
 * The Lobby user list, as the session's own ClientView answers it: `TClientView.GetUserList`
 * -> `TInterfaceServer.GetUserList(fCurrChannel)` walks every client whose current channel is
 * the caller's, by the name it logged on under (`Interface Server/InterfaceServer.pas:
 * 1635-1646`, `:3342-3358`, name set at `:3238`).
 */
async function readChatUsers(session: LiveSession): Promise<ChatUser[]> {
  const resp = await session.driver.request<WsRespChatUserList>(
    { type: WsMessageType.REQ_CHAT_GET_USERS },
    WsMessageType.RESP_CHAT_USER_LIST,
  );
  return resp.users;
}

/**
 * The chat channel list, the Lobby's user list and the Lobby's info (#1148, proof #1188).
 * Read-only. The gateway prepends the Lobby to every list (`getChatChannelList` in
 * `chat-handler.ts`), so its presence proves nothing — the list check is that every entry is
 * well-formed. The membership proof is the user list, not the channel info: the info read
 * lists `fHomeChannel.fMembers` (`Interface Server/InterfaceServer.pas:3419-3437`,
 * `:4565-4575`), which `Logon` never fills — it only sets `fCurrChannel := fHomeChannel`
 * (`:3227`), and only `ClientEnteredChannel` inserts (`:4601-4615`). `GetUserList` walks the
 * clients by `fCurrChannel` (`:3342-3358`), so it names SPO_test3 once logged on. The info is
 * still read, by the Lobby's server name `''`, and must be non-empty text.
 */
const chatRead: Flow = {
  name: 'chat-read',
  what: 'chat channel list -> Lobby channel info',
  mutates: false,
  run: async () => {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const list = await session.driver.request<WsRespChatChannelList>(
        { type: WsMessageType.REQ_CHAT_GET_CHANNELS },
        WsMessageType.RESP_CHAT_CHANNEL_LIST,
      );
      const channels: unknown = list.channels;
      const wellFormed =
        Array.isArray(channels) &&
        channels.every(
          (c: { name?: unknown; isProtected?: unknown }) =>
            typeof c.name === 'string' && c.name !== '' && typeof c.isProtected === 'boolean',
        );
      assertions.check(
        'the channel list is well-formed (each entry a name and isProtected)',
        wellFormed,
        Array.isArray(channels) ? `${channels.length} channel(s)` : 'not a list',
      );
      const users = await readChatUsers(session);
      assertions.check(
        'the Lobby user list names SPO_test3 (GetUserList — Interface Server/InterfaceServer.pas:3227, :3342-3358)',
        users.some(u => isSelf(u.name)),
        `${users.length} user(s)`,
      );
      // '' is the Lobby's server name (Interface Server/InterfaceServer.pas:2623, :4565-4575).
      const info = await session.driver.request<WsRespChatChannelInfo>(
        { type: WsMessageType.REQ_CHAT_GET_CHANNEL_INFO, channelName: '' },
        WsMessageType.RESP_CHAT_CHANNEL_INFO,
      );
      assertions.check(
        'the Lobby channel info is non-empty text',
        typeof info.info === 'string' && info.info.trim() !== '',
        typeof info.info === 'string' ? info.info || "''" : 'not a string',
      );
      assertions.check('no gateway errors on the chat reads', session.driver.errors.length === 0);
      return report('chat-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * A password channel the flow creates, chats in, and removes (#1148). GATE_ONLY — nothing
 * here is private:
 * - `TClientView.CreateChannel` enters the creator (`Interface Server/InterfaceServer.pas:1512`,
 *   `:4591-4593`) and `ClientCreatedChannel` broadcasts the list change, password included, to
 *   every client (`:4594` -> `:4049-4060`); `GetChannelList` lists passwords in clear
 *   (`:3373-3390`). The channel is deleted when its last member leaves (`:4688-4693`).
 * - `ChatMsg` delivers only to the sender's channel, sender included (`:3902-3924`) — the
 *   `EVENT_CHAT_MSG` echo is a real server witness.
 * - `MsgCompositionChanged` loops over every client, sender included (`:3968-3980`,
 *   `TClientView.NotifyMsgCompositionState` `:2426-2430`) — typing is proven by the sender's
 *   own echo. The echo cannot carry away (the gateway maps only state '1' to typing), so away
 *   is proven by the user list's AFK flag, which `MsgCompositionChanged` sets before the
 *   broadcast (`:1495-1502`, listed by `GetUserList` `:3342-3358`). AFK sticks until another
 *   state, so the cleanup pushes idle.
 * - The Lobby's server name is `''` (`:2623`, `:4565-4575`), never `'Lobby'`.
 * - A killed run cleans itself up: `DoLogOff` -> `ClientLeavedChannel` (`:2000`).
 */
const chatPrivateChannel: Flow = {
  name: 'chat-private-channel',
  what: 'create a password channel -> listed -> send (echo) -> typing on/off -> away -> idle -> Lobby -> gone',
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    const driver = session.driver;
    try {
      const id = randomUUID().slice(0, 8);
      const channel = `e2e-${id}`;
      const password = randomUUID();
      const line = `e2e chat probe ${id} — automated L2 check, safe to ignore`;

      // Every call is a fresh request, correlated by its own wsRequestId — never a push.
      const listed = async (): Promise<string> => {
        const resp = await driver.request<WsRespChatChannelList>(
          { type: WsMessageType.REQ_CHAT_GET_CHANNELS },
          WsMessageType.RESP_CHAT_CHANNEL_LIST,
        );
        return resp.channels.some(c => c.name === channel) ? 'listed' : 'absent';
      };

      // The start index is what stops an earlier identical echo (typing off) from
      // satisfying the AWAY wait or the cleanup's idle wait.
      const awaitSelfTyping = (push: OutboundMessage, isTyping: boolean, label: string): Promise<boolean> => {
        const from = driver.receivedCount();
        driver.send(push);
        return attempt(assertions, label, () =>
          driver.waitFor(
            m => {
              const e = m as WsEventChatUserTyping;
              return m.type === WsMessageType.EVENT_CHAT_USER_TYPING && isSelf(e.username) && e.isTyping === isTyping;
            },
            TIMEOUTS.request,
            label,
            from,
          ),
        );
      };

      let createdFrom = 0;

      /** Never throws; nothing is sent outside the marker channel. */
      const useChannel = async (): Promise<void> => {
        const entered = await attempt(assertions, 'the session is in the marker channel', () =>
          driver.waitFor(
            m =>
              m.type === WsMessageType.EVENT_CHAT_CHANNEL_CHANGE &&
              (m as WsEventChatChannelChange).channelName === channel,
            TIMEOUTS.request,
            `EVENT_CHAT_CHANNEL_CHANGE to ${channel} — nothing is sent`,
            createdFrom,
          ),
        );
        if (!entered) return;

        const sendFrom = driver.receivedCount();
        const sent = await attempt(assertions, 'the message was sent in the marker channel', () =>
          driver.request<WsRespChatSuccess>(
            { type: WsMessageType.REQ_CHAT_SEND_MESSAGE, message: line },
            WsMessageType.RESP_CHAT_SUCCESS,
          ),
        );
        if (sent) {
          await attempt(assertions, 'the server echoed the message in the channel', () =>
            driver.waitFor(
              m => {
                const e = m as WsEventChatMsg;
                return m.type === WsMessageType.EVENT_CHAT_MSG && isSelf(e.from) && e.message === line;
              },
              TIMEOUTS.request,
              'the EVENT_CHAT_MSG echo of the marker line',
              sendFrom,
            ),
          );
        }

        await awaitSelfTyping(
          { type: WsMessageType.REQ_CHAT_TYPING_STATUS, isTyping: true },
          true,
          'the typing-on self-echo (isTyping: true)',
        );
        await awaitSelfTyping(
          { type: WsMessageType.REQ_CHAT_TYPING_STATUS, isTyping: false },
          false,
          'the typing-off self-echo (isTyping: false)',
        );
        // The echo orders what follows: MsgCompositionChanged sets AFK before it broadcasts
        // (:1495-1502), so after it the user list carries the away flag.
        const awayEchoed = await awaitSelfTyping(
          { type: WsMessageType.REQ_CHAT_AWAY },
          false,
          'the AWAY self-echo for SPO_test3',
        );
        if (!awayEchoed) return;
        await userListCheck(
          session,
          assertions,
          'the channel user list marks SPO_test3 away (isAway) — ' +
            'Interface Server/InterfaceServer.pas:1495-1502, :3342-3358',
          users => users.some(u => isSelf(u.name) && u.isAway === true),
        );
      };

      /** Idle first (clears AFK, :1495-1502), and only after its echo the Lobby join. */
      const leaveChannel = async (): Promise<void> => {
        const idle = await awaitSelfTyping(
          { type: WsMessageType.REQ_CHAT_TYPING_STATUS, isTyping: false },
          false,
          'the cleanup idle self-echo',
        );
        if (!idle) {
          throw new Error(
            'the idle push was never echoed — the Lobby join is not sent; logoff’s DoLogOff removes ' +
              'the channel (Interface Server/InterfaceServer.pas:2000)',
          );
        }
        await driver.request<WsRespChatSuccess>(
          { type: WsMessageType.REQ_CHAT_JOIN_CHANNEL, channelName: '' },
          WsMessageType.RESP_CHAT_SUCCESS,
        );
      };

      const what = `password channel ${channel}`;
      const member = 'CreateChannel';
      try {
        // CreateChannel has no LOG_MARKERS entry: chat is the Interface Server, whose chat log
        // is not published — so no log part, and the log URL is never opened.
        probes.push(
          await runRoundTrip(
            {
              what,
              member,
              read: listed,
              testValue: () => 'listed',
              write: async () => {
                createdFrom = driver.receivedCount();
                await driver.request<WsRespChatSuccess>(
                  { type: WsMessageType.REQ_CHAT_CREATE_CHANNEL, channelName: channel, password },
                  WsMessageType.RESP_CHAT_SUCCESS,
                );
              },
              restore: async () => {
                try {
                  await useChannel();
                } finally {
                  await leaveChannel();
                }
              },
              proof: {
                readBack: {
                  source: 'RESP_CHAT_CHANNEL_LIST of a fresh REQ_CHAT_GET_CHANNELS (GetChannelList)',
                  why:
                    'TInterfaceServer.GetChannelList answers from the live channel table, no cache in ' +
                    'between (Interface Server/InterfaceServer.pas:3373-3390)',
                  read: listed,
                  boundMs: TIMEOUTS.logSettle,
                },
              },
            },
            ctx.lock,
            openLogWindow,
            ctx.survivalLogUrl ?? '',
            { now: ctx.now, sleep: ctx.sleep },
          ),
        );
      } catch (err: unknown) {
        probes.push(probeFailure({ what, member }, err));
      }
      const probe = probes[0];
      assertions.check(
        'the fresh channel list showed the marker channel after the create',
        probe?.readBack === 'CONFIRMED',
      );
      assertions.check(
        'the marker channel is gone after the cleanup',
        probe?.restoreReadBack === 'CONFIRMED',
        probe?.restoreReadBack === 'CONFIRMED'
          ? undefined
          : `${channel} is still listed — a third party may have joined: its name and password are ` +
              'public (Interface Server/InterfaceServer.pas:4594, :3373-3390); a human must check',
      );
      assertions.check('the channel round trip passed', probeHeld(probe), probe?.note);
      assertions.check('no gateway errors in the channel', driver.errors.length === 0);
      return report('chat-private-channel', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

/**
 * SPO_test3 chases the secondary account, then stops (#1148, proof #1188). `TClientView.Chase` inserts the
 * chaser in the target's list and moves the chaser's own view (`Interface Server/
 * InterfaceServer.pas:1579-1608`, `MoveTo` at `:1590`). The proof is SPO_test3's view
 * following the secondary account: it sends one camera update, `SetViewedArea` ends with `UpdateChasers`
 * (`:742`), which pushes every chaser `MoveTo(x + dx div 2, y + dy div 2)` (`:705-718`,
 * `TClientView.MoveTo` `:2215-2219`), and the gateway forwards it as `EVENT_MOVE_TO`. The
 * camera sits on the secondary's own saved position, so its logoff cookie is unchanged. `DoLogOff`
 * (`:2002`) and `Destroy` (`:654`) end any chase a dead run leaves.
 */
const chatChase: Flow = {
  name: 'chat-chase',
  what: `${SECONDARY_ACCOUNT.username} online -> SPO_test3 chases ${SECONDARY_ACCOUNT.username} -> stop chase`,
  mutates: false,
  run: async () => {
    const secondary = await loginSecondary();
    if ('skipped' in secondary) return skippedResult('chat-chase', secondary.skipped);
    try {
      const assertions = new Assertions();
      const session = await login(PRIMARY_ACCOUNT);
      try {
        // attempt() never throws, so STOP_CHASE is sent whatever the chase answered.
        const from = session.driver.receivedCount();
        const chased = await attempt(assertions, `CHASE ${SECONDARY_ACCOUNT.username} answered without error`, () =>
          session.driver.request<WsRespChatSuccess>(
            { type: WsMessageType.REQ_CHAT_CHASE, userName: SECONDARY_ACCOUNT.username },
            WsMessageType.RESP_CHAT_SUCCESS,
          ),
        );
        if (chased) {
          const view = sendCamera(secondary, secondary.playerX, secondary.playerY);
          const ex = view.viewX + CAMERA_VIEW_SIZE / 2;
          const ey = view.viewY + CAMERA_VIEW_SIZE / 2;
          const label =
            `SPO_test3's view follows ${SECONDARY_ACCOUNT.username}: EVENT_MOVE_TO at (${ex},${ey}) — ` +
            'Interface Server/InterfaceServer.pas:705-718, :742, :1590';
          await attempt(assertions, label, () =>
            session.driver.waitFor(
              m => {
                const e = m as WsEventMoveTo;
                return m.type === WsMessageType.EVENT_MOVE_TO && e.x === ex && e.y === ey;
              },
              TIMEOUTS.request,
              label,
              from,
            ),
          );
        }
        await attempt(assertions, 'STOP_CHASE answered', () =>
          session.driver.request<WsRespChatSuccess>(
            { type: WsMessageType.REQ_CHAT_STOP_CHASE },
            WsMessageType.RESP_CHAT_SUCCESS,
          ),
        );
        return report('chat-chase', assertions, [], session);
      } finally {
        await logoff(session);
      }
    } finally {
      await logoff(secondary);
    }
  },
};

/** The refusal `handleGmChatSend` answers a non-GM with (ws-handlers/chat-handlers.ts). */
const GM_REFUSAL = 'Only Game Masters can send GM messages';
/** The phase gate's refusal (`PHASE_ALLOWED_MESSAGES` in server.ts). */
const PHASE_REFUSAL = 'Operation not allowed in current session state';

/**
 * Send one GM message expecting a refusal. The handler never answers an accepted GM send, so
 * acceptance surfaces as a timeout (a plain Error), a refusal as a WsDriverError.
 */
async function gmSendRefusal(driver: WsDriver, message: string): Promise<WsDriverError | string> {
  try {
    await driver.request<WsRespChatSuccess>(
      { type: WsMessageType.REQ_GM_CHAT_SEND, message },
      WsMessageType.RESP_CHAT_SUCCESS,
    );
    return 'answered without an error';
  } catch (err: unknown) {
    return err instanceof WsDriverError ? err : `not refused: ${toErrorMessage(err)}`;
  }
}

/**
 * GM broadcast (#1199). `handleGmChatSend` (ws-handlers/chat-handlers.ts) makes no RDO call and
 * sends only to the gateway's own `connectedClients` — on the bench, the drive's own sessions,
 * where SPO_test3 is the named GM (#1197, doc/E2E-POLICY.md §6). Nothing reaches a player and
 * there is nothing to undo. The secondary account logs in BEFORE the send, and is the receiver
 * rather than a second SPO_test3 session: a second SPO_test3 world session would retire the first
 * (Interface Server/InterfaceServer.pas:3138-3146).
 */
const gmBroadcast: Flow = {
  name: 'gm-broadcast',
  what:
    `${SECONDARY_ACCOUNT.username} online -> SPO_test3 GM message -> ${SECONDARY_ACCOUNT.username} receives it on GM -> ` +
    `${SECONDARY_ACCOUNT.username} refused -> a directory-only session refused by the phase gate`,
  mutates: false,
  run: async () => {
    const secondary = await loginSecondary();
    if ('skipped' in secondary) return skippedResult('gm-broadcast', secondary.skipped);
    try {
      const session = await login(PRIMARY_ACCOUNT);
      try {
        const assertions = new Assertions();
        const id = randomUUID().slice(0, 8);
        const text = `e2e gm probe ${id} — automated L2 check, safe to ignore`;

        // 1. Delivered. Matched on channel, text, GM flag and sender — Lobby chat shares the event type.
        const from = secondary.driver.receivedCount();
        await attempt(assertions, `${SECONDARY_ACCOUNT.username} received the GM message on channel GM`, () => {
          // send, not request: an accepted GM send gets no reply.
          session.driver.send({ type: WsMessageType.REQ_GM_CHAT_SEND, message: text });
          return secondary.driver.waitFor(
            m => {
              const e = m as WsEventChatMsg;
              return (
                m.type === WsMessageType.EVENT_CHAT_MSG &&
                e.channel === 'GM' &&
                e.message === text &&
                e.isGM === true &&
                isSelf(e.from)
              );
            },
            TIMEOUTS.request,
            `EVENT_CHAT_MSG on GM carrying "${text}"`,
            from,
          );
        });
        const senderErrors = session.driver.errors
          .map(e => (e as { errorMessage?: string }).errorMessage ?? 'gateway error')
          .join('; ');
        assertions.check(
          'no gateway errors on the GM sender',
          session.driver.errors.length === 0,
          senderErrors === ''
            ? undefined
            : `${senderErrors} — is the gateway started with SPO_GM_USERS=SPO_test3 (#1197)?`,
        );

        // 2. A non-GM is refused by the GM check.
        const refusal = await gmSendRefusal(secondary.driver, `e2e gm refusal probe ${id} — safe to ignore`);
        const refusalDetail = refusal instanceof WsDriverError ? refusal.message : refusal;
        assertions.check(
          `a non-GM session (${SECONDARY_ACCOUNT.username}) is refused`,
          refusalDetail === GM_REFUSAL,
          refusalDetail,
        );

        // 3. A session still DIRECTORY_CONNECTED — as the GM, so only the phase gate can refuse it
        // (it is not in connectedClients, so the GM check would give the other message).
        // No REQ_LOGIN_WORLD: no Interface Server logon, no eviction of the world session.
        let phaseOk = false;
        let phaseDetail: string;
        try {
          const dir = await WsDriver.connect(GATEWAY_URL, GATEWAY_ORIGIN);
          try {
            await dir.request(
              {
                type: WsMessageType.REQ_AUTH_CHECK,
                username: PRIMARY_ACCOUNT.username,
                password: PRIMARY_ACCOUNT.password,
              },
              WsMessageType.RESP_AUTH_SUCCESS,
              TIMEOUTS.login,
            );
            await dir.request(
              {
                type: WsMessageType.REQ_CONNECT_DIRECTORY,
                username: PRIMARY_ACCOUNT.username,
                password: PRIMARY_ACCOUNT.password,
                zonePath: ZONE_PATH,
              },
              WsMessageType.RESP_CONNECT_SUCCESS,
              TIMEOUTS.login,
            );
            const outcome = await gmSendRefusal(dir, `e2e gm phase probe ${id} — safe to ignore`);
            phaseOk =
              outcome instanceof WsDriverError &&
              outcome.message === PHASE_REFUSAL &&
              outcome.code === ERROR_AccessDenied;
            phaseDetail = outcome instanceof WsDriverError ? `${outcome.message} (code ${outcome.code})` : outcome;
          } finally {
            // A session never in the world is never parked: a bare close ends it.
            await dir.close();
          }
        } catch (err: unknown) {
          phaseOk = false;
          phaseDetail = toErrorMessage(err);
        }
        assertions.check('a session not yet WORLD_CONNECTED is refused by the phase gate', phaseOk, phaseDetail);

        return report('gm-broadcast', assertions, [], session);
      } finally {
        await logoff(session);
      }
    } finally {
      await logoff(secondary);
    }
  },
};

export const FLOWS: Flow[] = [
  loginSpine,
  sessionResume,
  politicsRead,
  politicsWrite,
  townMinWage,
  publicityRoundTrip,
  mayorRatingRoundTrip,
  tycoonRoleRead,
  voteRoundTrip,
  buildingDetails,
  permissionNegative,
  mailRoundTrip,
  favoritesRoundTrip,
  favoritesFolders,
  peopleSearch,
  newspaperRead,
  newspaperBoardRead,
  zoningAlertRead,
  mailDrafts,
  mailSendFromDraft,
  mailReply,
  nearestTownHall,
  worldReaders,
  directoryBrowse,
  searchMenuRead,
  companySwitch,
  clusterInfoRead,
  profileRead,
  policyRoundTrip,
  autoConnectionRoundTrip,
  chatRead,
  chatPrivateChannel,
  chatChase,
  gmBroadcast,
  bankBorrowPayoff,
  bankSendReturn,
  portraitRoundTrip,
  roadRoundTrip,
  zoneRoundTrip,
  fixturesEnsure,
  inspectorReads,
  storePriceSalaries,
  industryOutputPrice,
  industrySupplyLimits,
  adBudgetRoundTrip,
  facilityOpenClose,
  industryAutoBuy,
  supplierSearchRead,
  nearCircuitsRead,
  facilityStatusBatchRead,
  supplierHireFire,
  clientHireRemove,
  connectOnMap,
  companyInputDemand,
  tradeSettings,
  warehouseWares,
  quickTradeRoundTrip,
  buildMenuRead,
  placeRenameDemolish,
  residentialSettings,
  residentialRepair,
  bankSettings,
  tvSettings,
  researchRoundTrip,
  acceptCloning,
  upgradeStop,
  facilityBankLoan,
  cloneSalariesRoundTrip,
];

export function flowByName(name: string): Flow {
  const flow = FLOWS.find(f => f.name === name);
  if (!flow) {
    throw new Error(`Unknown flow "${name}". Known: ${FLOWS.map(f => f.name).join(', ')}`);
  }
  return flow;
}

/**
 * Run one flow, turning an unexpected throw into a reportable FAIL. A seeded flow runs
 * seed -> run -> cleanup; the cleanup runs even when `run` throws, and a cleanup that leaves
 * data behind turns the result FAIL (the restore rule, doc/E2E-POLICY.md §5/§9).
 */
export async function runFlow(flow: Flow, ctx: FlowContext): Promise<FlowResult> {
  const before = new Set(ctx.lock.read().pendingRestores.map(p => p.key));
  if (!flow.seed) return guardSkip(await runUnseeded(flow, ctx), ctx, before);

  let seeded: FlowSeed;
  try {
    seeded = await flow.seed(ctx);
  } catch (err: unknown) {
    seeded = { outcome: { what: 'seed', ok: false, detail: toErrorMessage(err) } };
  }

  let result: FlowResult;
  let cleanup: FlowCheck[] = [];
  try {
    if (seeded.outcome.ok) {
      result = await runUnseeded(flow, ctx);
    } else if (seeded.outcome.skipped !== undefined) {
      result = skippedResult(flow.name, seeded.outcome.skipped);
    } else {
      const { what, detail } = seeded.outcome;
      result = {
        name: flow.name,
        status: 'UNTESTABLE',
        assertions: [],
        untestable: [`the flow's data — seed failed: ${what}${detail ? ` (${detail})` : ''}`],
        probes: [],
        messagesSent: 0,
        messagesReceived: 0,
        wireErrors: 0,
      };
    }
  } finally {
    if (seeded.cleanup) {
      try {
        cleanup = await seeded.cleanup();
      } catch (err: unknown) {
        cleanup = [{ what: 'seed cleanup', ok: false, detail: toErrorMessage(err) }];
      }
    }
  }

  // A second-account refusal in the cleanup is forgiven only when the seed itself was skipped:
  // nothing was sent. After a seed that ran, the refused mailbox keeps the leftover — FAIL.
  const seedSkipped = seeded.outcome.skipped !== undefined;
  const leftBehind = cleanup.some(c => !c.ok && !(seedSkipped && c.skipped !== undefined));
  const status = leftBehind ? 'FAIL' : result.status;
  return guardSkip({ ...result, seed: seeded.outcome, cleanup, status }, ctx, before);
}

/**
 * A skip is only honest before the flow's first write. A `SKIPPED` result while the world
 * lock still holds a pending restore this flow added would leave that write behind, so it is a
 * FAIL. `before` is the set of restore keys already pending when the flow started: an earlier
 * flow's unrestored write is that flow's problem (`lock.release()` marks the world dirty for
 * it), not grounds to turn this flow's honest skip into a FAIL.
 */
function guardSkip(result: FlowResult, ctx: FlowContext, before: ReadonlySet<string | undefined>): FlowResult {
  if (result.status !== 'SKIPPED') return result;
  const pending = ctx.lock.read().pendingRestores.filter(p => !before.has(p.key)).length;
  if (pending === 0) return result;
  return {
    ...result,
    status: 'FAIL',
    error: `skipped after a write (${result.skipped ?? 'no reason'}) — ${pending} pending restore(s) still held`,
  };
}

/** A flow that did not run: the second account was refused at login, before any write. */
function skippedResult(name: string, reason: string): FlowResult {
  return {
    name,
    status: 'SKIPPED',
    skipped: reason,
    assertions: [],
    untestable: [],
    probes: [],
    messagesSent: 0,
    messagesReceived: 0,
    wireErrors: 0,
  };
}

async function runUnseeded(flow: Flow, ctx: FlowContext): Promise<FlowResult> {
  try {
    return await flow.run(ctx);
  } catch (err: unknown) {
    return {
      name: flow.name,
      status: 'FAIL',
      assertions: [],
      untestable: [],
      probes: [],
      messagesSent: 0,
      messagesReceived: 0,
      wireErrors: 0,
      error: toErrorMessage(err),
    };
  }
}

/** Move a value without leaving the legal 0..100 range, so the probe never writes junk. */
export function nudge(original: string): string {
  const parsed = Number(original);
  if (!Number.isFinite(parsed)) return '1';
  const next = parsed >= 50 ? parsed - 1 : parsed + 1;
  return String(Math.min(100, Math.max(0, Math.round(next))));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function report(
  name: string,
  assertions: Assertions,
  probes: ProbeResult[],
  session: LiveSession,
): FlowResult {
  const sent = session.driver.log.filter(e => e.direction === 'sent').length;
  const received = session.driver.log.filter(e => e.direction === 'received').length;
  const failed = assertions.failed || probes.some(p => p.status === 'FAIL');
  const untestable = [
    ...assertions.untestableItems,
    ...probes.filter(p => p.status === 'UNTESTABLE').map(p => `${p.what} — ${p.note ?? 'not observable'}`),
  ];
  return {
    name,
    status: failed ? 'FAIL' : untestable.length > 0 ? 'UNTESTABLE' : 'PASS',
    assertions: assertions.items,
    untestable,
    probes,
    messagesSent: sent,
    messagesReceived: received,
    wireErrors: session.driver.errors.length,
  };
}
