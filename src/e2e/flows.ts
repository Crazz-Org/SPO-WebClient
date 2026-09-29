/**
 * The L2 flow catalogue.
 *
 * A flow is a scripted live drive over the WebSocket contract, with its own assertions.
 * The gate picks which flows to run from the diff (doc/E2E-POLICY.md §4) — a fixed script
 * drifts and eventually tests nothing that changed.
 */

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
  WsRespSearchConnections,
  ConnectionSearchResult,
} from '../shared/types/message-types';
import { SurfaceType } from '../shared/types/domain-types';
import type {
  AutoConnectionActionType,
  AutoConnectionFluid,
  AutoConnectionsData,
  BankAccountData,
  CompaniesData,
  CurriculumData,
  PolicyData,
  ProfitLossData,
  BuildingPropertyValue,
  DirectoryRef,
  DirectoryPage,
  MailFolder,
  MailMessageFull,
  MailMessageHeader,
  MapBuilding,
  RankingCategory,
} from '../shared/types/domain-types';
import { flattenFavoriteLinks, flattenFolders } from '../shared/favorites-tree';
import { toErrorMessage } from '../shared/error-utils';
import { ERROR_AccessDenied } from '../shared/error-codes';
import { parseLocalAspUrl } from '../shared/local-asp-url';
import { WsDriverError } from './ws-driver';
import {
  GOVERNED_TOWN,
  INTERFACE_LOG_BASE,
  LIMITS,
  PRIMARY_ACCOUNT,
  SECONDARY_ACCOUNT,
  TIMEOUTS,
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
  type LiveSession,
  type SecondaryLogin,
} from './session';
import type { WorldLock } from './world-lock';

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

      const politics = await session.driver.request<WsRespPoliticsData>(
        {
          type: WsMessageType.REQ_POLITICS_DATA,
          townName: town.name,
          buildingX: town.x,
          buildingY: town.y,
        },
        WsMessageType.RESP_POLITICS_DATA,
      );
      assertions.check('politics data returned', Boolean(politics.data));
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
  what: 'round-trip probe on RDOSetTaxValue at the governed town hall',
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
      return report('politics-write', assertions, probes, session);
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

export const FLOWS: Flow[] = [
  loginSpine,
  sessionResume,
  politicsRead,
  politicsWrite,
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
  profileRead,
  policyRoundTrip,
  autoConnectionRoundTrip,
  warehouseRoleReading,
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
