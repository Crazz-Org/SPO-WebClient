/**
 * src/shared/rdo-separator-lock.test.ts
 *
 * Editing a row here changes a live frame. The PR must cite the reference-client emission (Voyager / SPO-ASP) that justifies it.
 *
 * The table below is a literal record of how every catalogued RDO member is
 * emitted today — its form, separator and arity — kept apart from
 * `RDO_MEMBERS` on purpose. `RDO_MEMBERS` is imported only for its key set, to
 * check that every member has a row; it never supplies an expected value.
 *
 * No expected value is computed with `rdoCall`, `RdoCommand` or `RDO_MEMBERS`:
 * the builders are only the thing under test. A one-word change to a `kind` in
 * `rdo-members.ts` therefore turns this file red instead of silently changing
 * the separator on the wire.
 *
 * There is no wire-string or argument-prefix column: this test supplies its own
 * arguments, so checking their prefixes would be circular. Call-site argument
 * prefixes are covered by `src/server/__tests__/rdo/rdo-callsite-wire-format.test.ts`.
 *
 * Columns:
 *   member    — the catalogued member name
 *   form      — 'call' (function / procedure), or 'get' / 'set' / 'get/set' (accessor)
 *   separator — '"^"' or '"*"' exactly as the packet carries it; null for accessors,
 *               whose grammar has no separator
 *   arity     — argument count of a call; null for accessors (get takes none,
 *               set exactly one value)
 *   source    — the citation in the member's own catalogue comment, `[UNKNOWN]` otherwise
 */

import { describe, it, expect } from '@jest/globals';
import { RdoValue } from './rdo-types';
import { rdoCall, rdoGet, rdoSet, RdoFrameError } from './rdo-frame';
import { RDO_MEMBERS, isCataloguedRdoMember } from './rdo-members';

type Form = 'call' | 'get' | 'set' | 'get/set';
/** null = the get/set grammar has no separator. */
type Separator = '"^"' | '"*"' | null;
//                       member | form | separator literal | arity | source
type LockRow = readonly [string, Form, Separator, number | null, string];

const U = '[UNKNOWN]';

const LOCK: readonly LockRow[] = [
  ['AccountStatus',            'call',    '"^"', 2,    U],
  ['AddHeaders',               'call',    '"*"', 1,    U],
  ['AddLine',                  'call',    '"*"', 1,    U],
  ['AllObjectStatusText',      'call',    '"^"', 2,    'Interface Server/InterfaceServer.pas:148'],
  ['BreakCircuitAt',           'call',    '"^"', 4,    U],
  ['BudgetPerc',               'get',     null,  null, 'StdBlocks/Banks.pas:39; Voyager/BankGeneralSheet.pas:266'],
  ['CanJoinWorldEx',           'call',    '"^"', 1,    'Interface Server/InterfaceServer.pas:441'],
  ['Chase',                    'call',    '"^"', 1,    'Interface Server/InterfaceServer.pas:189'],
  ['CheckNewMail',             'call',    '"^"', 2,    U],
  ['ClientAware',              'call',    '"*"', 0,    U],
  ['ClientNotAware',           'call',    '"*"', 0,    U],
  ['CloneFacility',            'call',    '"*"', 5,    U],
  ['CloseMessage',             'call',    '"*"', 1,    U],
  ['CloseObject',              'call',    '"*"', 1,    U],
  ['Commercials',              'get/set', null,  null, 'StdBlocks/Broadcast.pas:53; TVGeneralSheet.pas:274,322'],
  ['Completed',                'set',     null,  null, 'Tasks/Tasks.pas:156; ModifyTask.asp:32-33'],
  ['ConnectFacilities',        'call',    '"^"', 2,    U],
  ['ContextStatusText',        'call',    '"^"', 2,    'Interface Server/InterfaceServer.pas:149'],
  ['CreateChannel',            'call',    '"^"', 5,    'Interface Server/InterfaceServer.pas:186'],
  ['CreateCircuitSeg',         'call',    '"^"', 7,    U],
  ['CreateObject',             'call',    '"^"', 1,    U],
  ['DAAddr',                   'get',     null,  null, U],
  ['DALockPort',               'get',     null,  null, U],
  ['DefineZone',               'call',    '"^"', 6,    'Interface Server/InterfaceServer.pas:161; Voyager/URLHandlers/ServerCnxHandler.pas:2231'],
  ['DeleteMessage',            'call',    '"*"', 4,    U],
  ['EnableEvents',             'set',     null,  null, U],
  ['FindClients',              'call',    '"^"', 9,    U],
  ['FindSuppliers',            'call',    '"^"', 9,    U],
  ['GetAttachment',            'call',    '"^"', 1,    U],
  ['GetAttachmentCount',       'call',    '"^"', 1,    U],
  ['GetChannelInfo',           'call',    '"^"', 1,    U],
  ['GetChannelList',           'call',    '"^"', 1,    U],
  ['GetCompanyCluster',        'call',    '"^"', 1,    'Interface Server/InterfaceServer.pas:171'],
  ['GetCompanyCount',          'get',     null,  null, U],
  ['GetCompanyFacilityCount',  'call',    '"^"', 1,    'Interface Server/InterfaceServer.pas:173'],
  ['GetCompanyId',             'call',    '"^"', 1,    'Interface Server/InterfaceServer.pas:172'],
  ['GetCompanyName',           'call',    '"^"', 1,    'Interface Server/InterfaceServer.pas:170'],
  ['GetCompanyOwnerRole',      'call',    '"^"', 1,    'Interface Server/InterfaceServer.pas:169'],
  ['GetHeaders',               'call',    '"^"', 1,    U],
  ['GetInputNames',            'call',    '"^"', 2,    U],
  ['GetLines',                 'call',    '"^"', 1,    U],
  ['GetOutputNames',           'call',    '"^"', 2,    U],
  ['GetPropertyList',          'call',    '"^"', 1,    U],
  ['GetSubObjectProps',        'call',    '"^"', 2,    U],
  ['GetSurface',               'call',    '"^"', 5,    U],
  ['GetTycoonCookie',          'call',    '"^"', 2,    U],
  ['GetUserList',              'call',    '"^"', 0,    U],
  ['HoursOnAir',               'get/set', null,  null, 'StdBlocks/Broadcast.pas:51'],
  ['Interest',                 'get/set', null,  null, 'StdBlocks/Banks.pas:40'],
  ['JoinChannel',              'call',    '"^"', 2,    U],
  ['KeepAlive',                'call',    '"*"', 0,    U],
  ['Logoff',                   'get',     null,  null, U],
  ['Logon',                    'call',    '"^"', 2,    U],
  ['LogServerOn',              'call',    '"^"', 1,    U],
  ['MailAccount',              'get',     null,  null, U],
  ['MailAddr',                 'get',     null,  null, U],
  ['MailPort',                 'get',     null,  null, U],
  ['Maintenance',              'set',     null,  null, U],
  ['MsgCompositionChanged',    'call',    '"*"', 1,    U],
  ['Name',                     'set',     null,  null, U],
  ['NewCompany',               'call',    '"^"', 2,    U],
  ['NewFacility',              'call',    '"^"', 4,    U],
  ['NewMail',                  'call',    '"^"', 3,    U],
  ['ObjectAt',                 'call',    '"^"', 2,    U],
  ['ObjectsInArea',            'call',    '"^"', 4,    U],
  ['OpenMessage',              'call',    '"^"', 4,    U],
  ['PickEvent',                'call',    '"^"', 1,    U],
  ['Post',                     'call',    '"^"', 2,    U],
  ['RDOAcceptCloning',         'get/set', null,  null, U],
  ['RDOAskLoan',               'call',    '"^"', 2,    'StdBlocks/Banks.pas:46; Voyager/BankGeneralSheet.pas:439'],
  ['RDOAutoProduce',           'call',    '"*"', 1,    U],
  ['RDOBanMinister',           'call',    '"*"', 1,    U],
  ['RDOCacncelTransc',         'call',    '"*"', 0,    U],
  ['RDOCancelMovie',           'call',    '"*"', 1,    U],
  ['RDOCancelResearch',        'call',    '"*"', 1,    U],
  ['RDOCanJoinNewWorld',       'call',    '"^"', 1,    'DServer/DirectoryServer.pas:116'],
  ['RDOClose',                 'call',    '"*"', 1,    'Tasks/InformativeTask.pas:15'],
  ['RDOCnntId',                'get',     null,  null, U],
  ['RDOConnectInput',          'call',    '"*"', 2,    U],
  ['RDOConnectOutput',         'call',    '"*"', 2,    U],
  ['RDOConnectToTycoon',       'call',    '"*"', 3,    U],
  ['RDODelFacility',           'call',    '"^"', 2,    U],
  ['RDODisconnectFromTycoon',  'call',    '"*"', 3,    U],
  ['RDODisconnectInput',       'call',    '"*"', 2,    U],
  ['RDODisconnectOutput',      'call',    '"*"', 2,    U],
  ['RDODowngrade',             'call',    '"*"', 0,    U],
  ['RDOEndSession',            'call',    '"*"', 0,    'DServer/DirectoryServer.pas:31'],
  ['RDOEstimateLoan',          'call',    '"^"', 1,    'StdBlocks/Banks.pas:45'],
  ['RDOFavoritesDelItem',      'call',    '"^"', 1,    U],
  ['RDOFavoritesGetSubItems',  'call',    '"^"', 1,    U],
  ['RDOFavoritesMoveItem',     'call',    '"^"', 2,    'Interface Server/InterfaceServer.pas:202'],
  ['RDOFavoritesNewItem',      'call',    '"^"', 4,    U],
  ['RDOFavoritesRenameItem',   'call',    '"^"', 2,    U],
  ['RDOGetDemand',             'call',    '"^"', 1,    'StdBlocks/ServiceBlock.pas:309'],
  ['RDOGetInvDescEx',          'call',    '"^"', 2,    U],
  ['RDOGetInvPropsByLang',     'call',    '"^"', 2,    U],
  ['RDOGetSupply',             'call',    '"^"', 1,    'StdBlocks/ServiceBlock.pas:310'],
  ['RDOGetWorkers',            'call',    '"^"', 1,    'Kernel/WorkCenterBlock.pas:139'],
  ['RDOLaunchMovie',           'call',    '"*"', 4,    U],
  ['RDOLogonClient',           'call',    '"*"', 2,    'Kernel/World.pas:412'],
  ['RDOLogonUser',             'call',    '"^"', 2,    'DServer/DirectoryServer.pas:92'],
  ['RDOMapSegaUser',           'call',    '"^"', 1,    U],
  ['RDONextStep',              'call',    '"*"', 1,    'Tasks/InformativeTask.pas:16'],
  ['RDOOpenSession',           'get',     null,  null, 'DServer/DirectoryServer.pas:143'],
  ['RDOPrevStep',              'call',    '"*"', 1,    'Tasks/InformativeTask.pas:17'],
  ['RDOQueryKey',              'call',    '"^"', 2,    U],
  ['RDOQueueResearch',         'call',    '"*"', 2,    U],
  ['RDOReleaseMovie',          'call',    '"*"', 1,    U],
  ['RdoRepair',                'call',    '"*"', 1,    U],
  ['RDOSearchKey',             'call',    '"^"', 2,    'DServer/DirectoryServer.pas:84'],
  ['RDOSelectWare',            'call',    '"*"', 2,    U],
  ['RDOSelSelected',           'call',    '"*"', 1,    U],
  ['RDOSetCompanyInputDemand', 'call',    '"*"', 2,    U],
  ['RDOSetCurrentKey',         'call',    '"^"', 1,    'DServer/DirectoryServer.pas:36'],
  ['RDOSetInputFluidPerc',     'call',    '"*"', 1,    U],
  ['RDOSetInputMaxPrice',      'call',    '"*"', 2,    U],
  ['RDOSetInputMinK',          'call',    '"*"', 2,    U],
  ['RDOSetInputOverPrice',     'call',    '"*"', 3,    U],
  ['RDOSetInputSortMode',      'call',    '"*"', 2,    U],
  ['RDOSetLoanPerc',           'call',    '"*"', 1,    U],
  ['RDOSetMinistryBudget',     'call',    '"*"', 2,    U],
  ['RDOSetMinSalaryValue',     'call',    '"*"', 2,    U],
  ['RDOSetOutputPrice',        'call',    '"*"', 2,    U],
  ['RDOSetPrice',              'call',    '"*"', 2,    U],
  ['RDOSetProjectData',        'call',    '"*"', 3,    'Kernel/TownPolitics.pas:45, Kernel/WorldPolitics.pas:260'],
  ['RDOSetPublicity',          'call',    '"*"', 2,    'Kernel/TownPolitics.pas:41, Kernel/WorldPolitics.pas:257'],
  ['RDOSetRatingFrom',         'call',    '"*"', 3,    'Kernel/TownPolitics.pas:40, Kernel/WorldPolitics.pas:256'],
  ['RDOSetRole',               'call',    '"*"', 1,    U],
  ['RDOSetSalaries',           'call',    '"*"', 3,    U],
  ['RDOSetTaxValue',           'call',    '"*"', 2,    U],
  ['RDOSetTownTaxes',          'call',    '"*"', 2,    U],
  ['RDOSetTradeLevel',         'call',    '"*"', 1,    U],
  ['RDOSetWordsOfWisdom',      'call',    '"*"', 1,    U],
  ['RDOSitMayor',              'call',    '"*"', 2,    U],
  ['RDOSitMinister',           'call',    '"*"', 2,    U],
  ['RDOStartUpgrades',         'call',    '"*"', 1,    U],
  ['RdoStopRepair',            'call',    '"*"', 1,    U],
  ['RDOStopUpgrade',           'call',    '"*"', 0,    U],
  ['RDOVote',                  'call',    '"*"', 2,    U],
  ['RDOVoteOf',                'call',    '"^"', 1,    U],
  ['RegisterEventsById',       'call',    '"^"', 1,    U],
  ['Rent',                     'set',     null,  null, U],
  ['Save',                     'call',    '"^"', 2,    U],
  ['SayThis',                  'call',    '"*"', 2,    U],
  ['SegmentsInArea',           'call',    '"^"', 5,    U],
  ['ServerBusy',               'get',     null,  null, U],
  ['SetLanguage',              'call',    '"*"', 1,    U],
  ['SetObject',                'call',    '"^"', 2,    U],
  ['SetPath',                  'call',    '"^"', 1,    U],
  ['SetTycoonCookie',          'call',    '"*"', 3,    U],
  ['SetViewedArea',            'call',    '"*"', 4,    U],
  ['StopChase',                'call',    '"^"', 0,    'Interface Server/InterfaceServer.pas:190'],
  ['Stopped',                  'set',     null,  null, U],
  ['SwitchFocusEx',            'call',    '"^"', 3,    U],
  ['Term',                     'get/set', null,  null, 'StdBlocks/Banks.pas:41'],
  ['TycoonId',                 'get',     null,  null, U],
  ['UnfocusObject',            'call',    '"*"', 1,    U],
  ['WipeCircuit',              'call',    '"^"', 6,    U],
  ['WorldName',                'get',     null,  null, U],
  ['WorldSeason',              'get',     null,  null, U],
  ['WorldURL',                 'get',     null,  null, U],
  ['WorldXSize',               'get',     null,  null, U],
  ['WorldYSize',               'get',     null,  null, U],
];

const TARGET = '12345';
const rowMembers = new Set(LOCK.map(([member]) => member));

describe('RDO emission table — the literal record of every catalogued member', () => {
  it('is non-empty', () => {
    expect(LOCK.length).toBeGreaterThan(0);
  });

  it('names each member once', () => {
    const seen = new Set<string>();
    const duplicates = LOCK.map(([member]) => member).filter(m => {
      const dup = seen.has(m);
      seen.add(m);
      return dup;
    });
    expect(duplicates).toEqual([]);
  });

  it('cites a .pas/.asp line or says [UNKNOWN]', () => {
    const bad = LOCK.filter(([, , , , source]) => source !== U && !/\.(pas|asp):\d/.test(source));
    expect(bad).toEqual([]);
  });

  it('gives every call a separator and an arity, and no accessor either', () => {
    const bad = LOCK.filter(([, form, separator, arity]) =>
      form === 'call'
        ? separator === null || arity === null || !Number.isInteger(arity) || arity < 0
        : separator !== null || arity !== null
    );
    expect(bad).toEqual([]);
  });

  it('has a row for every catalogued member', () => {
    expect(Object.keys(RDO_MEMBERS).filter(m => !rowMembers.has(m))).toEqual([]);
  });

  it('has no row for a member the catalogue does not hold', () => {
    expect(LOCK.filter(([member]) => !isCataloguedRdoMember(member))).toEqual([]);
  });
});

describe.each(LOCK)('%s', (member, form, separator, arity) => {
  it(`is emitted as ${form}${separator ? ` ${separator}` : ''}${arity !== null ? ` with ${arity} argument(s)` : ''}`, () => {
    if (!isCataloguedRdoMember(member)) {
      throw new Error(`${member} is not catalogued (see the orphan check above)`);
    }

    if (form === 'call') {
      const args = Array.from({ length: arity ?? 0 }, (_, i) => RdoValue.int(i));
      const frame = rdoCall(member, TARGET, ...args);
      expect(frame.packet.separator).toBe(separator);
      expect(frame.packet.args).toHaveLength(arity ?? 0);
      expect(frame.toFrame()).toContain(`call ${member} ${separator}`);
      expect(() => rdoGet(member, TARGET)).toThrow(RdoFrameError);
      expect(() => rdoSet(member, TARGET, RdoValue.int(1))).toThrow(RdoFrameError);
      return;
    }

    expect(() => rdoCall(member, TARGET)).toThrow(RdoFrameError);

    if (form === 'get' || form === 'get/set') {
      const frame = rdoGet(member, TARGET);
      expect(frame.packet.separator ?? null).toBe(separator);
      expect(frame.packet.args).toBeUndefined();
      expect(frame.toFrame()).toContain(` get ${member};`);
    } else {
      expect(() => rdoGet(member, TARGET)).toThrow(RdoFrameError);
    }

    if (form === 'set' || form === 'get/set') {
      const frame = rdoSet(member, TARGET, RdoValue.int(1));
      expect(frame.packet.separator ?? null).toBe(separator);
      expect(frame.packet.args).toHaveLength(1);
      expect(frame.toFrame()).toContain(` set ${member}=`);
    } else {
      expect(() => rdoSet(member, TARGET, RdoValue.int(1))).toThrow(RdoFrameError);
    }
  });
});
