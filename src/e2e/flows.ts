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
  WsRespPoliticsVote,
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
  BuildingInfo,
  CompaniesData,
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
import { WsDriverError } from './ws-driver';
import {
  GOVERNED_TOWN,
  INTERFACE_LOG_BASE,
  LIMITS,
  PRIMARY_ACCOUNT,
  SECONDARY_ACCOUNT,
  TIMEOUTS,
  WORLD_NAME,
  type E2eAccount,
} from './config';
import { LOG_MARKERS, awaitMarker, findCurrentSurvivalLog, openLogWindow, readSince } from './live-log';
import {
  runProbe,
  runRoundTrip,
  probeFailure,
  type ProbeResult,
  type ProbeSpec,
  type RoundTripSpec,
} from './probe';
import { ALL_CONNECTION_ROLES, rolesToMask } from '../shared/connection-roles';
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
  FIXTURE_KINDS,
  ensureFixtures,
  facilityDimensions,
  findFixture,
  findFreeLot,
  isConstructionClass,
  isRefusedClass,
  listBuildable,
  newFacilityLineMatches,
  ownTycoonId,
  placeFacility,
  readCash,
  FIXTURE_CASH_FLOOR,
  type FixtureKind,
  type FixtureKindId,
  type FixtureOutcome,
} from './fixtures';

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
  status: 'PASS' | 'FAIL' | 'UNPROVEN' | 'SKIPPED';
  /** Why the flow did not run — only on `SKIPPED`: the second account was refused at login. */
  skipped?: string;
  assertions: { what: string; ok: boolean; detail?: string }[];
  /** What the flow could not prove, each with its reason. */
  unproven: string[];
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
   * runs after `run`, even when `run` throws. A failed seed skips `run` (UNPROVEN).
   */
  seed?: (ctx: FlowContext) => Promise<FlowSeed>;
  run: (ctx: FlowContext) => Promise<FlowResult>;
}

class Assertions {
  readonly items: { what: string; ok: boolean; detail?: string }[] = [];
  check(what: string, ok: boolean, detail?: string): void {
    this.items.push({ what, ok, detail });
  }
  /** Record what the flow could not prove, and why — the world held nothing to test. */
  readonly unprovenItems: string[] = [];
  unproven(what: string, reason: string): void {
    this.unprovenItems.push(`${what} — ${reason}`);
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
      const after = await awaitMarker(window, marker, TIMEOUTS.logSettle);
      assertions.check(
        'an explicit logout tears the ClientView down',
        after !== null,
        after ?? `no "${marker}" within ${TIMEOUTS.logSettle} ms`,
      );

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
      assertions.check('the probe proved the write reached the object', probes[0]?.status === 'PASS', probes[0]?.note);

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
          probes[1]?.status === 'PASS',
          probes[1]?.note,
        );
      } else {
        assertions.unproven(
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
      assertions.check('the probe proved the write reached the object', probes[0]?.status === 'PASS', probes[0]?.note);
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
      assertions.check('the round trip proved the write and restored it', probes[0]?.status === 'PASS', probes[0]?.note);
      return report('publicity-roundtrip', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * `TPoliticalTownHall.RDOVote` (`Kernel/TownPolitics.pas:395`, log `:400`). Data-gated: it
 * votes only when a prior vote exists and still names a current candidate or the mayor, so
 * the restore is a real vote and not a silent no-op (`Kernel/Politics.pas:916-933`).
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

      const prior = await readVoteOf();
      if (prior === undefined || prior.trim() === '') {
        assertions.unproven(
          'the vote round trip',
          `${voter} has no readable prior vote at ${town.name} — RDOVoteOf answered nothing, or the ` +
            'gateway did not serve VoteOf (enrichVotesTab binds to CurrBlock, which no Town Hall ' +
            'template requests); nothing written',
        );
        return report('vote-roundtrip', assertions, probes, session);
      }
      const choices = [...candidates, mayor].filter(n => n.trim() !== '');
      if (!choices.some(n => sameName(n, prior))) {
        assertions.unproven(
          'the vote round trip',
          `stale prior vote "${prior}": no campaign now and not the mayor (a town election deletes ` +
            'campaigns but keeps Voter.Votes — Kernel/TownPolitics.pas:690, :744; ' +
            'Kernel/Politics.pas:916-933); nothing written',
        );
        return report('vote-roundtrip', assertions, probes, session);
      }
      const other = choices.find(n => !sameName(n, prior));
      if (other === undefined) {
        assertions.unproven('the vote round trip', `no other candidate to vote for than "${prior}"; nothing written`);
        return report('vote-roundtrip', assertions, probes, session);
      }

      const what = `${town.name} vote of ${voter} — prior choice ${prior}`;
      const member = 'RDOVote';
      // The choice ends the line (TownPolitics.pas:400), so "by Bob" never matches "by Bobby".
      const votedBy = (line: string, choice: string): boolean =>
        line.trim().toLowerCase().endsWith(`voting: ${voter} by ${choice}`.toLowerCase());
      const url = ctx.survivalLogUrl ?? (await findCurrentSurvivalLog());
      let restoreLine: string | null = null;
      try {
        // Opened before the change vote: the restore's line is the one naming the prior choice.
        const restoreWindow = await openLogWindow(url);
        const result = await runRoundTrip(
          {
            what,
            member,
            read: async () => prior,
            testValue: () => other,
            write: async value => {
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
            },
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
          restoreLine = await awaitMarker(
            restoreWindow,
            { marker: LOG_MARKERS.RDOVote, match: line => votedBy(line, prior) },
            TIMEOUTS.logSettle,
          );
          assertions.check('the restore vote reached the object', restoreLine !== null, restoreLine ?? undefined);
        }
      } catch (err: unknown) {
        probes.push(probeFailure({ what, member }, err));
      }
      assertions.check('the round trip proved the vote and restored it', probes[0]?.status === 'PASS', probes[0]?.note);
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
  what: 'Crazz at the governed town hall sees canGovern=false',
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
  what: 'SPO_test3 sends -> Crazz receives -> delete',
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const sleep = ctx.sleep ?? defaultSleep;
    const subject = `e2e ${new Date().toISOString()}`;

    // Crazz first, before the compose: a refused login then leaves no mail behind.
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
 * Not required by routing (#1009): it runs and reports; its UNPROVEN is informational.
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
        assertions.unproven(
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
 * `News Server/NewsObject.pas:11-53`). An empty board is a pass, not UNPROVEN: the page
 * answering is what is proven, and the detail records the counts. Unlike `newspaper-read`
 * it is not data-gated, so routing requires it.
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

      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('newspaper-board-read', assertions, [], session);
    } finally {
      await logoff(session);
    }
  },
};

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

/** Crazz-sent alerts in SPO_test3's Inbox — a server-sent alert has another sender and is spared. */
const seededInInbox = (m: MailMessageHeader): boolean =>
  m.subject === ZONING_ALERT_SUBJECT && sameAccount(m.from, SECONDARY_ACCOUNT);
/** Crazz's own copies in `Sent`, filed there by Post — Mail Server/MailServer.pas:802-811. */
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
 * Crazz sends SPO_test3 one look-alike of the server's zoning alert, pointing at the governed
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
 * The seed (`seedZoningAlert`, #1009) feeds the flow: Crazz sends SPO_test3 one look-alike
 * alert before the run, and it is deleted from both mailboxes after. Read without the seed,
 * no zoning alert in the inbox is reported UNPROVEN, not PASS and not a failure — nothing
 * was zoned out of this account lately, so the flow proved nothing. A demolished building answering `ERROR_FacilityNotFound`
 * is also accepted: the whole point of the alert is that the building is gone.
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
        assertions.unproven(
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
          // The building the alert names was, by definition, demolished — a gateway
          // "not found" for that exact tile is an accepted outcome, not a wire failure.
          assertions.check(
            'REQ_BUILDING_FOCUS answered — either the tile focused, or the building is gone',
            err instanceof WsDriverError,
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
 * folder; never throws. A Crazz refusal here comes after the flow's first write, so its checks
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
    unproven: [],
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
  crazz: LiveSession,
  subject: string,
  sleep: (ms: number) => Promise<void>,
): Promise<FlowResult> {
  const name = 'mail-send-from-draft';
  const assertions = new Assertions();
  const bySubject = (m: MailMessageHeader): boolean => m.subject === subject;
  try {
    const session = await login(PRIMARY_ACCOUNT);
    try {
      await mailConnect(crazz);
      await mailConnect(session);
      const swept = await preSweep(
        assertions,
        [[session, 'Draft'], [session, 'Sent'], [crazz, 'Inbox']],
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

      const delivered = await rereadUntil(crazz, 'Inbox', msgs => msgs.some(bySubject), sleep);
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
    await logoff(crazz);
  }
}

/**
 * Send from an opened draft: `REQ_MAIL_COMPOSE` with `existingDraftId`, which deletes the Draft
 * copy once `Post` succeeds (#510). Crazz logs in first, so a refusal writes nothing (SKIPPED);
 * a refusal at the cleanup, after the send, is a FAIL naming the leftover.
 */
const mailSendFromDraft: Flow = {
  name: 'mail-send-from-draft',
  what: 'Crazz first -> SPO_test3 saves a draft to Crazz -> sends it from the draft -> Crazz receives it, Draft copy gone',
  mutates: true,
  run: async ctx => {
    const name = 'mail-send-from-draft';
    const sleep = ctx.sleep ?? defaultSleep;
    const subject = `${MAIL_SEND_FROM_DRAFT_MARKER}${new Date().toISOString()}`;
    // Crazz first, before any write: a refused login then leaves nothing behind.
    const crazz = await loginSecondary();
    if ('skipped' in crazz) return skippedResult(name, crazz.skipped);
    let result: FlowResult;
    try {
      result = await driveSendFromDraft(crazz, subject, sleep);
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
  crazz: LiveSession,
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
      await mailConnect(crazz);
      await mailConnect(session);
      const swept = await preSweep(
        assertions,
        [[session, 'Inbox'], [session, 'Sent'], [crazz, 'Inbox'], [crazz, 'Sent']],
        hasMarker(MAIL_REPLY_MARKER),
        sleep,
        markerLabel(MAIL_REPLY_MARKER),
      );
      if (!swept) return report(name, assertions, [], session);

      const sent = await sendMail(session, { to: SECONDARY_ACCOUNT.username, subject, body: [MAIL_PROBE_BODY] });
      assertions.check('the compose was accepted', sent.success === true, sent.message);

      const delivered = await rereadUntil(crazz, 'Inbox', msgs => msgs.some(bySubject), sleep);
      const received = delivered.messages.find(bySubject);
      assertions.check(
        `${SECONDARY_ACCOUNT.username}'s Inbox holds the message`,
        Boolean(received),
        `${subject} reads=${delivered.reads}`,
      );
      if (!received) return report(name, assertions, [], session);

      const { message } = await crazz.driver.request<WsRespMailMessage>(
        { type: WsMessageType.REQ_MAIL_READ_MESSAGE, folder: 'Inbox', messageId: received.messageId },
        WsMessageType.RESP_MAIL_MESSAGE,
      );
      assertions.check('the read message carries a sender address', Boolean(message.fromAddr), message.fromAddr);
      if (!message.fromAddr) return report(name, assertions, [], session);

      // The client's Reply (`startReply` in mail-store.ts): to the sender, `Re: ` subject, and
      // the four In-Reply-To* lines as headers. Crazz's one write — a pair the flow undoes.
      const reply = await sendMail(crazz, {
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
    await logoff(crazz);
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
  what: 'Crazz first -> SPO_test3 sends -> Crazz reads and replies (Re:, In-Reply-To* headers) -> SPO_test3 receives the reply',
  mutates: true,
  run: async ctx => {
    const name = 'mail-reply';
    const sleep = ctx.sleep ?? defaultSleep;
    const subject = `${MAIL_REPLY_MARKER}${new Date().toISOString()}`;
    // Crazz first, before any write: a refused login then leaves nothing behind.
    const crazz = await loginSecondary();
    if ('skipped' in crazz) return skippedResult(name, crazz.skipped);
    let result: FlowResult;
    try {
      result = await driveReply(crazz, subject, sleep);
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
 * flow costs one more login's worth. The camera is sent **to the saved position** the
 * select-company reply carried, so `savePlayerPosition` rewrites the same cookie values at
 * logoff. Nothing in the world is written: `mutates: false`.
 */
const worldReaders: Flow = {
  name: 'world-readers',
  what: 'context status -> world event -> ZONES + Beauty surfaces -> facility dimensions -> camera',
  mutates: false,
  run: async ctx => {
    const sleep = ctx.sleep ?? defaultSleep;
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
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

      // Fire-and-forget: handleUpdateCamera answers nothing. With the view fields,
      // updateCameraPosition emits SetViewedArea (session-only).
      session.driver.send({
        type: WsMessageType.REQ_UPDATE_CAMERA,
        x: session.playerX,
        y: session.playerY,
        viewX: Math.max(0, session.playerX - 16),
        viewY: Math.max(0, session.playerY - 16),
        viewW: 32,
        viewH: 32,
      });
      const after = await contextStatusAt(session, here.x, here.y);
      assertions.check('the gateway still answers after the camera update', typeof after === 'string');

      assertions.check('no gateway errors', session.driver.errors.length === 0);
      return report('world-readers', assertions, [], session);
    } finally {
      await logoff(session);
    }
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
        assertions.check(`"${company}" names its owner — InTownCompany.asp:63-71`, owner !== null, owner ?? '(none)');
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
 * (`RenderTycoon.asp:55` renders the request's `Tycoon`). Banks and newspapers prove
 * reachability only: an empty list passes and its count is in the detail.
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

      const papers = await session.driver.request<WsRespSearchMenuNewspapers>(
        { type: WsMessageType.REQ_SEARCH_MENU_NEWSPAPERS },
        WsMessageType.RESP_SEARCH_MENU_NEWSPAPERS,
      );
      assertions.check(
        'the newspapers list is well-formed (reachability only) — Newspapers.asp:61-62',
        Array.isArray(papers.newspapers) && papers.newspapers.every(p => p.paperName !== ''),
        `${papers.newspapers.length} newspapers`,
      );

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

/**
 * Live drive of the company list's Political Offices half (#1142): switch into the Mayor of
 * the governed town, read the world, switch back, read again.
 *
 * Side effects are session-only: the Interface Server drops a ClientView when its socket
 * closes (`TClientView.OnDisconnect`, `Interface Server/InterfaceServer.pas:1799-1813`). The
 * proof is the gateway answering `RESP_RDO_RESULT` only after `loginWorld` under the role
 * name and `selectCompany` succeeded. No check claims the reads answer "as the role":
 * `TTycoon.GetAllCompaniesCount` / `GetAllCompanies` walk the MasterRole
 * (`Kernel/Kernel.pas:10972-10992`), so neither can tell the identities apart.
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
        }
      } finally {
        back = await trySwitch(session, session.company);
      }
      assertions.check('the switch back to the own company answers RESP_RDO_RESULT', back.ok, back.detail);
      if (back.ok) {
        await hallRead(session, town, visualClass, assertions, 'the same world read answers after switching back');
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
          assertions.check(
            'the company P&L parses',
            cpl.data != null && cpl.error === undefined && lines > 0,
            cpl.error ?? `${lines} lines`,
          );
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

/** SPO_test3's row towards Crazz as `"<yours>:<theirs>"`, or `"none"` — no row, both neutral. */
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
 * The strategy towards Crazz, change-then-undo (#1146). GATE_ONLY: every `RDOSetPolicyStatus`
 * broadcasts a world event naming Crazz (Kernel/Kernel.pas:11790-11800). The restore from "no
 * row" expects the row gone — a neutral row left behind is not the original.
 */
const policyRoundTrip: Flow = {
  name: 'policy-roundtrip',
  what: "strategy towards Crazz: read -> set another status -> read back -> restore -> read back",
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
      assertions.check('the policy round trip proved the write and the restore', probes[0]?.status === 'PASS', probes[0]?.note);
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
          assertions.unproven(half, 'the initial suppliers page lists no fluid');
        }
        return report('autoconnection-roundtrip', assertions, probes, session);
      }
      const url = ctx.survivalLogUrl ?? (await findCurrentSurvivalLog());
      const fluidOf = async (fluidId: string) =>
        (await readAutoConnections(session)).fluids.find(f => f.fluidId === fluidId);
      const act = async (action: AutoConnectionActionType, fluidId: string, suppliers?: string): Promise<void> => {
        // `success` is ignored; the page read-back is the judge (doc/E2E-POLICY.md §5).
        await session.driver.request<WsRespProfileAutoConnectionAction>(
          { type: WsMessageType.REQ_PROFILE_AUTOCONNECTION_ACTION, action, fluidId, suppliers },
          WsMessageType.RESP_PROFILE_AUTOCONNECTION_ACTION,
        );
      };
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
        assertions.check(`the ${key} flip proved the write and the restore`, probe.status === 'PASS', probe.note);
      };

      await flip(initial.fluids[0], 'hireTradeCenter');

      // The checkbox is rendered only under Storable (TycoonAutoConnections.asp:103-104): a
      // non-storable fluid could never read the flag back.
      const storable = initial.fluids.find(f => f.storable === true);
      if (storable) {
        await flip(storable, 'onlyWarehouses');
      } else {
        assertions.unproven(
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
        assertions.unproven('the add/delete supplier half', 'no search result not already listed for any fluid');
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
      assertions.check('the supplier add proved the write and the delete', probe.status === 'PASS', probe.note);
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
          deleted ?? `no "${LOG_MARKERS.RDODelAutoConnection}" line for ${identity}`,
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
        assertions.unproven(
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
      assertions.check('the loan round trip proved the borrow and the payoff', probes[0]?.status === 'PASS', probes[0]?.note);
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

async function driveSendReturn(crazz: LiveSession, ctx: FlowContext, sleep: (ms: number) => Promise<void>): Promise<FlowResult> {
  const name = 'bank-send-return';
  const ME = PRIMARY_ACCOUNT.username;
  const HIM = SECONDARY_ACCOUNT.username;
  const what = 'the send → send back round trip';
  const assertions = new Assertions();
  const probes: ProbeResult[] = [];
  const me = await login(PRIMARY_ACCOUNT);
  try {
    await mailConnect(me);
    await mailConnect(crazz);

    // RDOSendMoney clips the amount to fBudget - LoanAmount - AprFee and answers
    // ERROR_InvalidMoneyValue when that is ≤ 0 (Kernel/Kernel.pas:11507-11512, :11535); the page
    // mirrors it as "You can transfer up to $…" (NewTycoon/TycoonBankAccount.asp:116-122).
    const mine = transferRefusal(await readBank(me));
    if (mine) {
      assertions.unproven(what, `${ME} cannot send $1: ${mine}; nothing sent`);
      return report(name, assertions, probes, me);
    }
    const theirs = transferRefusal(await readBank(crazz));
    if (theirs) {
      assertions.unproven(what, `${HIM} cannot send $1 back: ${theirs}; nothing sent`);
      return report(name, assertions, probes, me);
    }
    // The :11499 receiver limits, each profile read through its own session.
    for (const [account, s] of [[PRIMARY_ACCOUNT, me], [SECONDARY_ACCOUNT, crazz]] as const) {
      const refusal = receiverLimitRefusal(account, await readProfile(s));
      if (refusal) {
        assertions.unproven(what, `${refusal}; nothing sent`);
        return report(name, assertions, probes, me);
      }
    }

    for (const [s, folder, counterpart] of [
      [me, 'Inbox', HIM], [me, 'Sent', HIM], [crazz, 'Inbox', ME], [crazz, 'Sent', ME],
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
      String((await has(crazz, ME, out) ? 1 : 0) - (await has(me, HIM, back) ? 1 : 0));
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
          // Crazz writes only to complete the pair: nothing to send back unless the $1 arrived.
          if (!firstLegSent && !(await has(crazz, ME, out))) return;
          const answer = await send(crazz, ME, back);
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
    assertions.check('the transfer round trip proved the send and the send back', probes[0]?.status === 'PASS', probes[0]?.note);
    return report(name, assertions, probes, me);
  } finally {
    await logoff(me);
  }
}

/**
 * Send $1 to Crazz, and Crazz sends it back (#1147). Both accounts log in before the first send;
 * a refusal of Crazz then is SKIPPED with nothing sent. Nothing is sent unless both bank pages
 * offer the transfer and both profiles are under the receiver limits (Kernel/Kernel.pas:11499).
 * Two residual risks remain, each a FAIL with the pending restore kept ($1 stays with Crazz): a
 * Transcended item (not readable over the WS contract), and a nobility of 0 that cannot be told
 * from "Nobility label not found". Any failure after the first send is a FAIL, never SKIPPED.
 */
const bankSendReturn: Flow = {
  name: 'bank-send-return',
  what: 'both log in -> both pages offer $1 -> receiver limits -> send $1 to Crazz -> notice -> Crazz sends $1 back -> notice',
  mutates: true,
  run: async ctx => {
    const name = 'bank-send-return';
    const sleep = ctx.sleep ?? defaultSleep;
    const crazz = await loginSecondary();
    if ('skipped' in crazz) return skippedResult(name, crazz.skipped);
    let result: FlowResult;
    try {
      result = await driveSendReturn(crazz, ctx, sleep);
    } catch (err: unknown) {
      result = failedResult(name, err);
    } finally {
      await logoff(crazz);
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
        assertions.unproven(what, `no readable original portrait at ${url} (HTTP ${first.status}) — nothing to restore to; nothing uploaded`);
        return report(name, assertions, probes, session);
      }
      const refused = pictureCheck(first.bytes);
      if (refused) {
        assertions.unproven(
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
      assertions.check('the portrait round trip proved the upload and the restore', probes[0]?.status === 'PASS', probes[0]?.note);
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
          assertions.unproven(
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
  const window = await openLogWindow(url);
  const line = (marker: string, coords: number[]): Promise<string | null> =>
    awaitMarker(window, { marker, match: l => circuitLogMatches(l, marker, coords) }, TIMEOUTS.logSettle);

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
  const buildLine = await line(LOG_MARKERS.RDOCreateCircuitSeg, [span.x1, span.y1, span.x2, span.y2]);
  assertions.check('the build logged its CreateCircuitSeg: line', buildLine !== null, buildLine ?? '(no line)');
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
  const breakLine = await line(LOG_MARKERS.RDOBreakCircuitAt, [span.x1, span.y1]);
  assertions.check('the break logged its BreakCircuit: line', breakLine !== null, breakLine ?? '(no line)');
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
  const wipeLine = await line(LOG_MARKERS.RDOWipeCircuit, [second.x, second.y, third.x, third.y]);
  assertions.check('the wipe logged its WipingCircuit: line', wipeLine !== null, wipeLine ?? '(no line)');
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
        assertions.unproven(
          `a zone round trip in ${GOVERNED_TOWN}`,
          `no ${ZONE_W}×${ZONE_H} rectangle inside ${GOVERNED_TOWN} in the ±${SEARCH_RADIUS} window holding one zone id ` +
            `of {${MAYOR_ZONE_IDS.join(', ')}}, overlapped by no facility footprint, with a road within ${ZONE_REACH} tiles`,
        );
        return;
      }
      const window = await openLogWindow(url);
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
      assertions.check('the zone round trip proved the paint and the repaint', probe.status === 'PASS', probe.note);
      if (probe.written !== '') {
        const repaint = await awaitMarker(
          window,
          { marker: LOG_MARKERS.RDODefineZone, match: l => zoneLogMatches(l, Number(probe.original), rect) },
          TIMEOUTS.logSettle,
        );
        assertions.check('the repaint to the original logged its Defining Zone: line', repaint !== null, repaint ?? '(no line)');
      }
    }),
};

/** A property's raw value from any group of an opening read, or 'absent'. */
function rawProperty(groups: { [groupId: string]: BuildingPropertyValue[] }, name: string): string {
  for (const group of Object.values(groups)) {
    const hit = group.find(p => p.name === name);
    if (hit) return hit.value;
  }
  return 'absent';
}

/** The gateway's default loadMapArea chunk — one window centred on the town hall. */
const ROLE_PROBE_SPAN = 64;
const ROLE_PROBE_MAX_READS = 40;
const INDUSTRY_TRADE_ROLES = ['2', '5', '6'];

/**
 * Read-only bench probe (#1006): what a real WHGeneral warehouse's cached `Role` holds, and,
 * if one exists nearby, an IndGeneral facility's `Role`/`TradeRole`. The values are recorded
 * in the run artifact and never asserted; the flow fails only when a read fails, and reports
 * UNPROVEN when no warehouse is found. It is removed by the follow-up card that acts on the
 * reading.
 */
const warehouseRoleReading: Flow = {
  name: 'warehouse-role-reading',
  what: "a warehouse's cached Role / TradeRole near the governed town — recorded, never asserted",
  mutates: false,
  async run() {
    const assertions = new Assertions();
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const town = await findTown(session, GOVERNED_TOWN);
      const response = await session.driver.request<WsRespMapData>(
        {
          type: WsMessageType.REQ_MAP_LOAD,
          x: Math.max(0, town.x - ROLE_PROBE_SPAN / 2),
          y: Math.max(0, town.y - ROLE_PROBE_SPAN / 2),
          width: ROLE_PROBE_SPAN,
          height: ROLE_PROBE_SPAN,
        },
        [WsMessageType.RESP_MAP_DATA, WsMessageType.EVENT_MAP_DATA],
        TIMEOUTS.login,
      );
      const buildings: MapBuilding[] = response.data?.buildings ?? [];
      const dist = (b: MapBuilding): number => Math.abs(b.x - town.x) + Math.abs(b.y - town.y);
      const sorted = [...buildings].sort((a, b) => dist(a) - dist(b));

      const handlerByClass = new Map<string, string>();
      let reads = 0;
      let warehouse: TradeRoleReading | undefined;
      let industry: TradeRoleReading | undefined;
      for (const b of sorted) {
        if ((warehouse && industry) || reads >= ROLE_PROBE_MAX_READS) break;
        const known = handlerByClass.get(b.visualClass);
        if (known !== undefined) {
          if (known !== 'WHGeneral' && known !== 'IndGeneral') continue;
          if (known === 'WHGeneral' && warehouse) continue;
          if (known === 'IndGeneral' && industry) continue;
        }
        const details = await readBuildingDetails(session, b.x, b.y, b.visualClass);
        reads++;
        const handlers = details.tabs.map(t => t.handlerName);
        const handler = handlers.includes('WHGeneral')
          ? 'WHGeneral'
          : handlers.includes('IndGeneral')
            ? 'IndGeneral'
            : (handlers[0] ?? '');
        handlerByClass.set(b.visualClass, handler);
        const reading: TradeRoleReading = {
          facility: handler === 'WHGeneral' ? 'warehouse' : 'industry',
          x: b.x,
          y: b.y,
          visualClass: b.visualClass,
          templateName: details.templateName,
          role: rawProperty(details.groups, 'Role'),
          tradeRole: rawProperty(details.groups, 'TradeRole'),
        };
        if (handler === 'WHGeneral' && !warehouse) warehouse = reading;
        else if (
          handler === 'IndGeneral' &&
          !industry &&
          INDUSTRY_TRADE_ROLES.includes(reading.tradeRole)
        ) {
          industry = reading;
        }
      }

      const readings: TradeRoleReading[] = [];
      if (warehouse) readings.push(warehouse);
      if (industry) readings.push(industry);
      if (!warehouse) {
        assertions.unproven(
          `a WHGeneral warehouse's cached Role near ${GOVERNED_TOWN}`,
          `none among ${buildings.length} building(s) in the ${ROLE_PROBE_SPAN}×${ROLE_PROBE_SPAN} ` +
            `window (${reads} inspector read(s))`,
        );
      }
      return { ...report('warehouse-role-reading', assertions, [], session), readings };
    } finally {
      await logoff(session);
    }
  },
};

/**
 * The permanent fixtures (#1149): SPO_test3's own finished facility of each kind in Helartia,
 * found by kind — and, when one is missing, built once and kept (the one sanctioned permanent
 * mutation, doc/E2E-POLICY.md §9). A build is proven by its `New Facility:` line, result code 0
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
        else assertions.unproven(`${o.kind} fixture`, `${o.status === 'under construction' ? 'under construction — ' : ''}${o.reason ?? ''}`);
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
 * SPO_test3's own fixture of a kind, or `undefined` with the reason recorded as unproven. A flow
 * whose fixture is missing writes nothing, anywhere.
 */
async function ownFixture(
  session: LiveSession,
  kindId: FixtureKindId,
  assertions: Assertions,
): Promise<OwnFixture | undefined> {
  const lookup = await findFixture(session, fixtureKind(kindId));
  if (!lookup.found) {
    assertions.unproven(`${kindId} fixture`, lookup.reason ?? 'not found');
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

/**
 * Why a product gate's price must not be driven, or `null` when it may. A price change re-checks
 * every client link (`TOutput.SetPricePerc`, Kernel/Kernel.pas:7193-7205) and
 * `TGate.ConnectionChanged` drops any that no longer passes (:6664-6676, :6737-6750) — so the
 * gate must have no client, or only clients of SPO_test3's own company, all of them read.
 */
export function outputPriceRefusal(product: BuildingProductData | undefined, ownCompany: string): string | null {
  if (!product?.metaFluid || product.pricePc === undefined) return 'its header was not read';
  if (product.connectionCount !== product.connections.length) {
    return `${product.connectionCount ?? '?'} client(s) listed but ${product.connections.length} read (the row cap) — unread clients cannot be checked`;
  }
  const foreign = product.connections.filter(c => c.companyName !== ownCompany);
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

/** One round trip's verdict, as an assertion naming the member. */
function checkProbe(assertions: Assertions, probe: ProbeResult): void {
  assertions.check(`${probe.member}: the write read back and was restored`, probe.status === 'PASS', probe.note);
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
  mutates: false,
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
        assertions.unproven('RDOSetSalaries', NO_WORKFORCE_REASON);
        return report('store-price-salaries', assertions, probes, session);
      }

      const readSalaries = async (): Promise<string | undefined> => {
        const groups = await readSectionGroups(session, fx.x, fx.y, 'workforce', fx.visualClass);
        const values = WORKER_KINDS.map(i => propertyValue(groups, 'workforce', `Salaries${i}`));
        return values.some(v => v === undefined) ? undefined : values.join(',');
      };
      const salaries = await roundTripProbe(ctx, url, {
        what: `${fixtureLabel(fx)} salaries (hi,mid,lo)`,
        member: 'RDOSetSalaries',
        read: readSalaries,
        write: async value => {
          const [salary0, salary1, salary2] = value.split(',');
          // The whole triplet, the untouched two unchanged — buildRdoCommandArgs requires all three.
          await setBuildingProperty(session, fx.x, fx.y, 'RDOSetSalaries', salary0, { salary0, salary1, salary2 });
        },
        testValue: original => {
          const [hi, mid, lo] = original.split(',');
          return [nudgeWithin(hi, 0, 255), mid, lo].join(',');
        },
        proof: {
          log: {
            marker: LOG_MARKERS.RDOSetSalaries,
            match: (line, written) => {
              const [hi, mid, lo] = written.split(',');
              return salariesLineMatches(line, hi, mid, lo);
            },
          },
          readBack: readBackOn(
            `workforce.Salaries0..2 at (${fx.x},${fx.y}) via the gateway's section read`,
            `${FACILITY_CACHE_WHY}; the three values are stored verbatim (Kernel/WorkCenterBlock.pas:590-593)`,
            readSalaries,
          ),
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
 * a gate whose clients are all SPO_test3's own — a price change can drop another player's link
 * (`outputPriceRefusal`). The client list after the restore must equal its snapshot.
 */
const industryOutputPrice: Flow = {
  name: 'industry-output-price',
  what:
    "round trip on RDOSetOutputPrice at SPO_test3's industry fixture, on a product gate with no foreign " +
    'client — Survival line + read-back, restored, client links unchanged',
  mutates: true,
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const fx = await ownFixture(session, 'industry', assertions);
      if (!fx) return report('industry-output-price', assertions, probes, session);

      const refusals: string[] = [];
      let chosen: { name: string; product: BuildingProductData; fluid: string } | undefined;
      for (const stub of await gateStubs(session, fx, 'products')) {
        const product = (await gateConnections(session, fx, 'products', stub)).product;
        const refusal = outputPriceRefusal(product, session.company.name);
        if (refusal === null && product?.metaFluid) {
          chosen = { name: stub.name, product, fluid: product.metaFluid };
          break;
        }
        refusals.push(`${stub.name}: ${refusal ?? 'no fluid'}`);
      }
      if (!chosen) {
        assertions.unproven(
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
 * A supply gate's limits: max price, min quality, sort mode and one supplier's overprice
 * (`TFacility.RDOSetInput*`, Kernel/Kernel.pas:4358-4442). Nightly only (routing.ts). A member the
 * gate cannot carry is recorded unproven by name; the others still run.
 */
const industrySupplyLimits: Flow = {
  name: 'industry-supply-limits',
  what:
    "round trips on RDOSetInputMaxPrice / MinK / SortMode / OverPrice at SPO_test3's industry fixture — " +
    'Survival line + read-back each, restored',
  mutates: true,
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
        assertions.unproven(
          'the supply limits',
          'no supply gate of the industry fixture publishes MaxPrice — only a TPullInput caches it (Kernel/Kernel.pas:7813)',
        );
        return report('industry-supply-limits', assertions, probes, session);
      }

      const { name, supply, fluid } = gate;
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

      // The control is offered only on a gate that publishes QPSorted = 1 and a SortMode (SuppliesGroup.tsx).
      if (supply.qpSorted === '1' && supply.sortMode !== undefined) {
        const readSortMode = async (): Promise<string | undefined> => (await fresh())?.sortMode;
        const sortMode = await roundTripProbe(ctx, url, {
          what: `${fixtureLabel(fx)} ${name} input sort mode`,
          member: 'RDOSetInputSortMode',
          read: readSortMode,
          write: writeGate('RDOSetInputSortMode'),
          testValue: original => (original === '1' ? '0' : '1'),
          // The line carries no coordinates and no value (Kernel/Kernel.pas:4446): the read-back attributes it.
          proof: {
            log: { marker: LOG_MARKERS.RDOSetInputSortMode },
            readBack: readBackOn(source('SortMode'), GATE_CACHE_WHY, readSortMode),
          },
          restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOSetInputSortMode', additionalParams: { fluidId: fluid } },
        });
        probes.push(sortMode);
        checkProbe(assertions, sortMode);
      } else {
        assertions.unproven(
          'RDOSetInputSortMode',
          `the ${fluid} gate publishes no sort mode — only TMediaInput caches QPSorted/SortMode ` +
            "(Kernel/MediaGates.pas:388-389); a plain input's SetSortMode is empty (Kernel/Kernel.pas:7169-7171), " +
            'so no sort control is offered and a write would change nothing',
        );
      }

      const supplier = supply.connections[0];
      if (supplier) {
        // The supplier is identified by its lot, never by its row: a row can shift between reads.
        const same = (c: BuildingConnectionData): boolean => c.x === supplier.x && c.y === supplier.y;
        const readOverprice = async (): Promise<string | undefined> =>
          (await fresh())?.connections.find(same)?.overprice;
        const writeOverprice = async (value: string): Promise<void> => {
          const index = (await fresh())?.connections.findIndex(same) ?? -1;
          if (index < 0) throw new Error(`supplier (${supplier.x},${supplier.y}) is no longer on the ${fluid} gate`);
          await setBuildingProperty(session, fx.x, fx.y, 'RDOSetInputOverPrice', value, {
            fluidId: fluid,
            index: String(index),
          });
        };
        const overprice = await roundTripProbe(ctx, url, {
          what: `${fixtureLabel(fx)} ${name} overprice of ${supplier.facilityName} (${supplier.x},${supplier.y})`,
          member: 'RDOSetInputOverPrice',
          read: readOverprice,
          write: writeOverprice,
          testValue: original => nudgeWithin(original, 0, 150),
          proof: {
            log: { marker: LOG_MARKERS.RDOSetInputOverPrice, match: facMatch('Input overprice set') },
            // The gateway's own confirmed read is always empty for it (mapRdoCommandToPropertyName).
            readBack: readBackOn(source(`supplier row overprice (BuildingConnectionData.overprice)`), GATE_CACHE_WHY, readOverprice),
          },
          restoreRecord: { x: fx.x, y: fx.y, propertyName: 'RDOSetInputOverPrice', additionalParams: { fluidId: fluid } },
        });
        probes.push(overprice);
        checkProbe(assertions, overprice);
      } else {
        assertions.unproven(
          'RDOSetInputOverPrice',
          `the ${fluid} gate has no supplier row — the overprice is set per supplier, and a fixture built fresh has none (#1149)`,
        );
      }
      return report('industry-supply-limits', assertions, probes, session);
    } finally {
      await logoff(session);
    }
  },
};

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
  run: async ctx => {
    const assertions = new Assertions();
    const probes: ProbeResult[] = [];
    const session = await login(PRIMARY_ACCOUNT);
    try {
      const fx = await ownFixture(session, 'industry', assertions);
      if (!fx) return report('industry-auto-buy', assertions, probes, session);

      let gate: { name: string; fluid: string } | undefined;
      for (const stub of await gateStubs(session, fx, 'supplies')) {
        const supply = (await gateConnections(session, fx, 'supplies', stub)).supply;
        if (supply?.metaFluid && supply.selected !== undefined) {
          gate = { name: stub.name, fluid: supply.metaFluid };
          break;
        }
      }
      if (!gate) {
        assertions.unproven(
          'RDOSelSelected',
          'no supply gate of the industry fixture publishes Selected — only a TPullInput caches it (Kernel/Kernel.pas:7815)',
        );
        return report('industry-auto-buy', assertions, probes, session);
      }

      const { name, fluid } = gate;
      const url = await survivalUrl(ctx);
      const readSelected = async (): Promise<string | undefined> => (await readSupply(session, fx, name))?.selected;
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

/** Read at least once, then every `readBackPoll` until `done` holds or `readBack` has elapsed. */
async function pollUntil<T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
  ctx: FlowContext,
): Promise<{ ok: boolean; last: T }> {
  const now = ctx.now ?? Date.now;
  const sleep = ctx.sleep ?? defaultSleep;
  const deadline = now() + TIMEOUTS.readBack;
  for (;;) {
    const last = await read();
    if (done(last)) return { ok: true, last };
    if (now() >= deadline) return { ok: false, last };
    await sleep(TIMEOUTS.readBackPoll);
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
      const { categories } = await session.driver.request<WsRespBuildingCategories>(
        { type: WsMessageType.REQ_GET_BUILDING_CATEGORIES, companyName },
        WsMessageType.RESP_BUILDING_CATEGORIES,
      );
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
    assertions.unproven(what, 'cash unknown — no EVENT_TYCOON_UPDATE received');
    return;
  }
  const pick = pickPlacement(await listBuildable(session), cash - FIXTURE_CASH_FLOOR);
  const info = pick.info;
  if (!info) {
    assertions.unproven(what, `${pick.reason ?? 'nothing picked'} (${session.company.name})`);
    return;
  }
  const cls = info.facilityClass;
  const dims = await facilityDimensions(session);
  const d = dims[info.visualClassId];
  const footprint =
    info.xsize && info.ysize ? { xsize: info.xsize, ysize: info.ysize } : d ? { xsize: d.xsize, ysize: d.ysize } : null;
  if (!footprint) {
    assertions.unproven(what, `footprint unknown for ${cls}`);
    return;
  }
  const lot = await findFreeLot(session, footprint, info.zoneRequirement);
  if (!lot) {
    assertions.unproven(
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
      assertions.unproven(
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
        line ?? `(no New Facility: line for ${cls}, company ${companyId}, ${where})`,
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
    assertions.check('the demolition logged its Del Facility line', delLine !== null, (delLine ?? `(no Del Facility line for ${where})`) + kept);
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

export const FLOWS: Flow[] = [
  loginSpine,
  sessionResume,
  politicsRead,
  politicsWrite,
  townMinWage,
  publicityRoundTrip,
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
  bankBorrowPayoff,
  bankSendReturn,
  portraitRoundTrip,
  roadRoundTrip,
  zoneRoundTrip,
  warehouseRoleReading,
  fixturesEnsure,
  inspectorReads,
  storePriceSalaries,
  industryOutputPrice,
  industrySupplyLimits,
  facilityOpenClose,
  industryAutoBuy,
  buildMenuRead,
  placeRenameDemolish,
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
  if (!flow.seed) return guardSkip(await runUnseeded(flow, ctx), ctx);

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
        status: 'UNPROVEN',
        assertions: [],
        unproven: [`the flow's data — seed failed: ${what}${detail ? ` (${detail})` : ''}`],
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
  return guardSkip({ ...result, seed: seeded.outcome, cleanup, status }, ctx);
}

/**
 * A skip is only honest before the flow's first write. A `SKIPPED` result while the world
 * lock still holds a pending restore would leave that write behind, so it is a FAIL.
 */
function guardSkip(result: FlowResult, ctx: FlowContext): FlowResult {
  if (result.status !== 'SKIPPED') return result;
  const pending = ctx.lock.read().pendingRestores.length;
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
    unproven: [],
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
      unproven: [],
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
  return {
    name,
    status: failed ? 'FAIL' : assertions.unprovenItems.length > 0 ? 'UNPROVEN' : 'PASS',
    assertions: assertions.items,
    unproven: assertions.unprovenItems,
    probes,
    messagesSent: sent,
    messagesReceived: received,
    wireErrors: session.driver.errors.length,
  };
}
