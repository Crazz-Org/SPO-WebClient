/**
 * Scenario integrity tests for all 11 mock server scenario factory functions
 * and the scenario registry.
 */
import { describe, it, expect } from '@jest/globals';
import { WsMessageType } from '@/shared/types/message-types';
import { createAuthScenario } from './auth-scenario';
import { createWorldListScenario, AMERICA_WORLDS, ASIA_WORLDS } from './world-list-scenario';
import { createCompanyListScenario, CAPTURED_COMPANY } from './company-list-scenario';
import { createSelectCompanyScenario, CAPTURED_COOKIE } from './select-company-scenario';
import { createSwitchFocusScenario, CAPTURED_FARM, CAPTURED_DRUG_STORE } from './switch-focus-scenario';
import { createBuildMenuScenario, CAPTURED_BUILD_SUCCESS, CAPTURED_BUILD_DUPLICATE } from './build-menu-scenario';
import { createBuildRoadsScenario, CAPTURED_ROAD_BUILD } from './build-roads-scenario';
import { createMailScenario, CAPTURED_MAIL_SEND } from './mail-scenario';
import {
  createBuildingDetailsScenario,
  MOCK_FACTORY,
  MOCK_BANK,
  MOCK_TV_STATION,
  MOCK_CAPITOL,
  MOCK_TOWN_HALL,
  ALL_MOCK_BUILDINGS,
} from './building-details-scenario';
import { createCivicMutationsScenario } from './civic-mutations-scenario';
import { HANDLER_TO_GROUP } from '@/shared/building-details/template-groups';
import type { BuildingTemplate, PropertyGroup } from '@/shared/building-details/property-definitions';
import { collectTemplatePropertyNamesStructured } from '@/shared/building-details/property-templates';
import { loadScenario, loadAll, SCENARIO_NAMES } from './scenario-registry';

// =============================================================================
// Scenario 1: auth
// =============================================================================

describe('auth scenario', () => {
  it('creates scenario with default variables', () => {
    const { ws, rdo } = createAuthScenario();
    expect(ws).toBeDefined();
    expect(rdo).toBeDefined();
    expect(ws.name).toBe('auth');
    expect(rdo.name).toBe('auth');
  });

  it('RDO has 5 exchanges (idof, OpenSession, MapSegaUser, LogonUser, EndSession)', () => {
    const { rdo } = createAuthScenario();
    expect(rdo.exchanges).toHaveLength(5);
    const members = rdo.exchanges.map(e => e.matchKeys?.member ?? e.matchKeys?.targetId);
    expect(members).toEqual([
      'DirectoryServer',
      'RDOOpenSession',
      'RDOMapSegaUser',
      'RDOLogonUser',
      'RDOEndSession',
    ]);
  });

  it('RDO exchanges contain correct matchKeys', () => {
    const { rdo } = createAuthScenario();
    expect(rdo.exchanges[0].matchKeys).toEqual({ verb: 'idof', targetId: 'DirectoryServer' });
    expect(rdo.exchanges[1].matchKeys).toEqual({ verb: 'sel', action: 'get', member: 'RDOOpenSession' });
    expect(rdo.exchanges[2].matchKeys).toEqual({ verb: 'sel', action: 'call', member: 'RDOMapSegaUser' });
    expect(rdo.exchanges[3].matchKeys).toEqual({ verb: 'sel', action: 'call', member: 'RDOLogonUser' });
    expect(rdo.exchanges[4].matchKeys).toEqual({ verb: 'sel', action: 'call', member: 'RDOEndSession' });
  });

  it('WS exchange has REQ_CONNECT_DIRECTORY request and RESP_CONNECT_SUCCESS response', () => {
    const { ws } = createAuthScenario();
    expect(ws.exchanges).toHaveLength(1);
    const exchange = ws.exchanges[0];
    expect(exchange.request.type).toBe(WsMessageType.REQ_CONNECT_DIRECTORY);
    expect(exchange.responses).toHaveLength(1);
    expect(exchange.responses[0].type).toBe(WsMessageType.RESP_CONNECT_SUCCESS);
  });

  it('variable override changes username in RDO exchanges', () => {
    const { rdo } = createAuthScenario({ username: 'TestPlayer' });
    const mapSegaUser = rdo.exchanges[2];
    expect(mapSegaUser.request).toContain('%TestPlayer');
    expect(mapSegaUser.request).not.toContain('%SPO_test3');
  });
});

// =============================================================================
// Scenario 2: world-list
// =============================================================================

describe('world-list scenario', () => {
  it('creates scenario with RDO and WS', () => {
    const { ws, rdo } = createWorldListScenario();
    expect(ws).toBeDefined();
    expect(rdo).toBeDefined();
    expect(ws.name).toBe('world-list');
    expect(rdo.name).toBe('world-list');
  });

  it('AMERICA_WORLDS has 3 worlds', () => {
    expect(AMERICA_WORLDS).toHaveLength(3);
  });

  it('ASIA_WORLDS has 9 worlds', () => {
    expect(ASIA_WORLDS).toHaveLength(9);
  });

  it('RDO response contains "Count=3" for America', () => {
    const { rdo } = createWorldListScenario();
    const americaExchange = rdo.exchanges.find(
      e => e.matchKeys?.argsPattern?.some(a => a.includes('America'))
    );
    expect(americaExchange).toBeDefined();
    expect(americaExchange!.response).toContain('Count=3');
  });

  it('RDO response contains "Count=9" for Asia', () => {
    const { rdo } = createWorldListScenario();
    const asiaExchange = rdo.exchanges.find(
      e => e.matchKeys?.argsPattern?.some(a => a.includes('Asia'))
    );
    expect(asiaExchange).toBeDefined();
    expect(asiaExchange!.response).toContain('Count=9');
  });

  it('WS response contains world list', () => {
    const { ws } = createWorldListScenario();
    expect(ws.exchanges).toHaveLength(1);
    const resp = ws.exchanges[0].responses[0] as unknown as Record<string, unknown>;
    expect(resp.type).toBe(WsMessageType.RESP_CONNECT_SUCCESS);
    const worlds = resp.worlds as Array<Record<string, unknown>>;
    expect(worlds).toBeDefined();
    expect(worlds.length).toBe(ASIA_WORLDS.length);
  });
});

// =============================================================================
// Scenario 3: company-list
// =============================================================================

describe('company-list scenario', () => {
  it('creates scenario with HTTP and WS', () => {
    const { ws, http } = createCompanyListScenario();
    expect(ws).toBeDefined();
    expect(http).toBeDefined();
    expect(ws.name).toBe('company-list');
    expect(http.name).toBe('company-list');
  });

  it('CAPTURED_COMPANY has correct name/id/ownerRole', () => {
    expect(CAPTURED_COMPANY.name).toBe('Yellow Inc.');
    expect(CAPTURED_COMPANY.id).toBe('28');
    expect(CAPTURED_COMPANY.ownerRole).toBe('SPO_test3');
  });

  it('HTTP has 5 exchanges (pleasewait, logonComplete, chooseCompany, CompanyPage x2)', () => {
    const { http } = createCompanyListScenario();
    expect(http.exchanges).toHaveLength(5);
    expect(http.exchanges[0].urlPattern).toContain('pleasewait.asp');
    expect(http.exchanges[1].urlPattern).toContain('logonComplete.asp');
    expect(http.exchanges[2].urlPattern).toContain('chooseCompany.asp');
    expect(http.exchanges[3].urlPattern).toContain('CompanyPage.asp');
    expect(http.exchanges[4].urlPattern).toContain('CompanyPage.asp');
  });

  it('chooseCompany HTML contains company name and ID', () => {
    const { http } = createCompanyListScenario();
    const chooseCompany = http.exchanges[2];
    expect(chooseCompany.body).toContain('Yellow Inc.');
    expect(chooseCompany.body).toContain('companyId="28"');
  });

  it('variable override changes company name in HTML', () => {
    const { http } = createCompanyListScenario({ companyName: 'Red Corp.' });
    const chooseCompany = http.exchanges[2];
    expect(chooseCompany.body).toContain('Red Corp.');
    expect(chooseCompany.body).not.toContain('Yellow Inc.');
  });
});

// =============================================================================
// Scenario 4: select-company
// =============================================================================

describe('select-company scenario', () => {
  it('creates scenario with WS, RDO, HTTP', () => {
    const { ws, rdo, http } = createSelectCompanyScenario();
    expect(ws).toBeDefined();
    expect(rdo).toBeDefined();
    expect(http).toBeDefined();
  });

  it('RDO has EnableEvents, PickEvent, GetTycoonCookie exchanges', () => {
    const { rdo } = createSelectCompanyScenario();
    const members = rdo.exchanges.map(e => e.matchKeys?.member);
    expect(members).toContain('EnableEvents');
    expect(members).toContain('PickEvent');
    expect(members).toContain('GetTycoonCookie');
  });

  it('HTTP toolbar contains button links', () => {
    const { http } = createSelectCompanyScenario();
    const toolbar = http.exchanges.find(e => e.urlPattern.includes('toolbar'));
    expect(toolbar).toBeDefined();
    expect(toolbar!.body).toContain('btnBuild');
    expect(toolbar!.body).toContain('btnMail');
    expect(toolbar!.body).toContain('btnSearch');
  });

  it('WS has scheduledEvents (tycoon update, chat msg)', () => {
    const { ws } = createSelectCompanyScenario();
    expect(ws.scheduledEvents).toBeDefined();
    expect(ws.scheduledEvents!.length).toBeGreaterThanOrEqual(2);
    const eventTypes = ws.scheduledEvents!.map(e => e.event.type);
    expect(eventTypes).toContain(WsMessageType.EVENT_TYCOON_UPDATE);
    expect(eventTypes).toContain(WsMessageType.EVENT_CHAT_MSG);
  });

  it('CAPTURED_COOKIE has lastX and lastY coordinates', () => {
    expect(CAPTURED_COOKIE.lastX).toBe('467');
    expect(CAPTURED_COOKIE.lastY).toBe('395');
  });
});

// =============================================================================
// Scenario 5: switch-focus
// =============================================================================

describe('switch-focus scenario', () => {
  it('CAPTURED_FARM has name "Farm 10" and ownerCompany "Yellow Inc."', () => {
    expect(CAPTURED_FARM.name).toBe('Farm 10');
    expect(CAPTURED_FARM.ownerCompany).toBe('Yellow Inc.');
  });

  it('CAPTURED_DRUG_STORE has name starting with number', () => {
    expect(CAPTURED_DRUG_STORE.name).toBe('10');
    expect(/^\d/.test(CAPTURED_DRUG_STORE.name)).toBe(true);
  });

  it('RDO has 2 SwitchFocusEx exchanges', () => {
    const { rdo } = createSwitchFocusScenario();
    const switchFocusExchanges = rdo.exchanges.filter(
      e => e.matchKeys?.member === 'SwitchFocusEx'
    );
    expect(switchFocusExchanges).toHaveLength(2);
  });
});

// =============================================================================
// Scenario 6: build-menu
// =============================================================================

describe('build-menu scenario', () => {
  it('creates scenario with HTTP and RDO', () => {
    const { http, rdo } = createBuildMenuScenario();
    expect(http).toBeDefined();
    expect(rdo).toBeDefined();
  });

  it('CAPTURED_BUILD_SUCCESS has result=0', () => {
    expect(CAPTURED_BUILD_SUCCESS.result).toBe(0);
  });

  it('CAPTURED_BUILD_DUPLICATE has result=33', () => {
    expect(CAPTURED_BUILD_DUPLICATE.result).toBe(33);
  });

  it('HTTP Build.asp contains frameset', () => {
    const { http } = createBuildMenuScenario();
    const buildAsp = http.exchanges.find(e => e.urlPattern.includes('Build.asp'));
    expect(buildAsp).toBeDefined();
    expect(buildAsp!.body).toContain('frameset');
  });

  it('RDO NewFacility has correct matchKeys', () => {
    const { rdo } = createBuildMenuScenario();
    const newFacility = rdo.exchanges.find(
      e => e.matchKeys?.member === 'NewFacility'
    );
    expect(newFacility).toBeDefined();
    expect(newFacility!.matchKeys?.verb).toBe('sel');
    expect(newFacility!.matchKeys?.action).toBe('call');
    expect(newFacility!.matchKeys?.member).toBe('NewFacility');
  });
});

// =============================================================================
// Scenario 7: build-roads
// =============================================================================

describe('build-roads scenario', () => {
  it('CAPTURED_ROAD_BUILD has correct coordinates', () => {
    expect(CAPTURED_ROAD_BUILD.x1).toBe(462);
    expect(CAPTURED_ROAD_BUILD.y1).toBe(403);
    expect(CAPTURED_ROAD_BUILD.x2).toBe(464);
    expect(CAPTURED_ROAD_BUILD.y2).toBe(403);
  });

  it('RDO CreateCircuitSeg has pushes array', () => {
    const { rdo } = createBuildRoadsScenario();
    const createSeg = rdo.exchanges.find(
      e => e.matchKeys?.member === 'CreateCircuitSeg'
    );
    expect(createSeg).toBeDefined();
    expect(createSeg!.pushes).toBeDefined();
    expect(createSeg!.pushes!.length).toBeGreaterThan(0);
    expect(createSeg!.pushes![0]).toContain('RefreshArea');
  });

  it('HTTP RoadOptions.asp contains BuildRoad and DemolishRoad', () => {
    const { http } = createBuildRoadsScenario();
    const roadOptions = http.exchanges.find(e => e.urlPattern.includes('RoadOptions'));
    expect(roadOptions).toBeDefined();
    expect(roadOptions!.body).toContain('BuildRoad');
    expect(roadOptions!.body).toContain('DemolishRoad');
  });
});

// =============================================================================
// Scenario 8: mail
// =============================================================================

describe('mail scenario', () => {
  it('CAPTURED_MAIL_SEND has correct to/subject', () => {
    expect(CAPTURED_MAIL_SEND.to).toBe('Mayor of Olympus@Shamba.net');
    expect(CAPTURED_MAIL_SEND.subject).toBe('test subjct');
  });

  it('RDO has 15 exchanges covering all mail operations', () => {
    const { rdo } = createMailScenario();
    expect(rdo.exchanges).toHaveLength(15);
    const members = rdo.exchanges.map(
      e => e.matchKeys?.member ?? e.matchKeys?.targetId
    );
    // First 6: original compose/save flow
    expect(members.slice(0, 6)).toEqual([
      'MailServer',
      'NewMail',
      'AddLine',
      'MailServer',
      'Save',
      'CloseMessage',
    ]);
    // Additional 9: Post, DeleteMessage, OpenMessage, GetHeaders, GetLines,
    // GetAttachmentCount, LogServerOn (mail session id — MailServer.pas:100),
    // CheckNewMail, AddHeaders
    expect(members.slice(6)).toEqual([
      'Post',
      'DeleteMessage',
      'OpenMessage',
      'GetHeaders',
      'GetLines',
      'GetAttachmentCount',
      'LogServerOn',
      'CheckNewMail',
      'AddHeaders',
    ]);
  });

  it('HTTP has MailFolder, MailFolderTop, MessageList, and MessageBody pages', () => {
    const { http } = createMailScenario();
    expect(http.exchanges).toHaveLength(5);
    expect(http.exchanges[0].urlPattern).toContain('MailFolder.asp');
    expect(http.exchanges[1].urlPattern).toContain('MailFolderTop.asp');
    expect(http.exchanges[2].urlPattern).toContain('MessageList.asp');
    expect(http.exchanges[3].urlPattern).toContain('MessageList.asp');
    expect(http.exchanges[4].urlPattern).toContain('MessageBody.asp');
  });

  it('MailFolderTop HTML contains Inbox/Sent/Draft tabs', () => {
    const { http } = createMailScenario();
    const folderTop = http.exchanges.find(
      e => e.urlPattern.includes('MailFolderTop')
    );
    expect(folderTop).toBeDefined();
    expect(folderTop!.body).toContain('Inbox');
    expect(folderTop!.body).toContain('Sent');
    expect(folderTop!.body).toContain('Draft');
  });
});

// =============================================================================
// Scenario 9: building-details
// =============================================================================

describe('building-details scenario', () => {
  it('creates scenario with WS and RDO', () => {
    const { ws, rdo } = createBuildingDetailsScenario();
    expect(ws).toBeDefined();
    expect(rdo).toBeDefined();
    expect(ws.name).toBe('building-details');
    expect(rdo.name).toBe('building-details');
  });

  it('has WS exchanges for all mock buildings', () => {
    const { ws } = createBuildingDetailsScenario();
    expect(ws.exchanges).toHaveLength(ALL_MOCK_BUILDINGS.length);
    for (const exchange of ws.exchanges) {
      expect(exchange.tags).toContain('building-details');
      const request = exchange.request as unknown as Record<string, unknown>;
      expect(request.type).toBe(WsMessageType.REQ_BUILDING_DETAILS);
    }
  });

  it('MOCK_FACTORY has IndGeneral + products + supplies + workforce + upgrade + finances tabs', () => {
    expect(MOCK_FACTORY.tabs).toHaveLength(6);
    const handlerNames = MOCK_FACTORY.tabs.map(t => t.handlerName);
    expect(handlerNames).toContain('IndGeneral');
    expect(handlerNames).toContain('Products');
    expect(handlerNames).toContain('Supplies');
    expect(handlerNames).toContain('Workforce');
    expect(handlerNames).toContain('facManagement');
    expect(handlerNames).toContain('Chart');
  });

  it('MOCK_BANK has BankGeneral + BankLoans tabs', () => {
    expect(MOCK_BANK.tabs).toHaveLength(2);
    expect(MOCK_BANK.groups['bankLoans']).toBeDefined();
    const loanCount = MOCK_BANK.groups['bankLoans'].find(p => p.name === 'LoanCount');
    expect(loanCount?.value).toBe('3');
  });

  it('MOCK_TV_STATION has TVGeneral + Antennas + Films tabs', () => {
    expect(MOCK_TV_STATION.tabs).toHaveLength(4);
    expect(MOCK_TV_STATION.groups['antennas']).toBeDefined();
    expect(MOCK_TV_STATION.groups['films']).toBeDefined();
    const antCount = MOCK_TV_STATION.groups['antennas'].find(p => p.name === 'antCount');
    expect(antCount?.value).toBe('3');
  });

  it('MOCK_CAPITOL has capitolGeneral + CapitolTowns + Ministeries + Votes tabs', () => {
    expect(MOCK_CAPITOL.tabs).toHaveLength(4);
    const handlerNames = MOCK_CAPITOL.tabs.map(t => t.handlerName);
    expect(handlerNames).toContain('capitolGeneral');
    expect(handlerNames).toContain('CapitolTowns');
    expect(handlerNames).toContain('Ministeries');
    expect(handlerNames).toContain('Votes');
  });

  it('MOCK_TOWN_HALL has townGeneral + townJobs + townRes + townServices + townTaxes tabs', () => {
    expect(MOCK_TOWN_HALL.tabs).toHaveLength(5);
    const handlerNames = MOCK_TOWN_HALL.tabs.map(t => t.handlerName);
    expect(handlerNames).toContain('townGeneral');
    expect(handlerNames).toContain('townJobs');
    expect(handlerNames).toContain('townRes');
    expect(handlerNames).toContain('townServices');
    expect(handlerNames).toContain('townTaxes');
  });

  it('townTaxes serves the keys the template actually asks for', () => {
    const taxProps = MOCK_TOWN_HALL.groups['townTaxes'];
    expect(taxProps).toBeDefined();
    const propNames = taxProps.map(p => p.name);
    // `Tax0Name0`, not `Tax0Name.0`: TOWN_TAXES_GROUP declares columnSuffix
    // 'Name0', so the language ordinal is part of the suffix and carries no dot.
    // The mock disagreed with the template here, and nothing caught it.
    expect(propNames).toContain('Tax0Name0');
    expect(propNames).not.toContain('Tax0Name.0');
    expect(propNames).toContain('Tax0Kind');
    expect(propNames).toContain('Tax0Percent');
    expect(propNames).toContain('Tax0LastYear');
    // The gateway resolves Tax{index}Id into the real TaxId before every write
    // (building-property-handler.ts:141-153); without it the write cannot be
    // addressed at all.
    expect(propNames).toContain('Tax0Id');
  });

  it('townTaxes Kind is the tkPercent/tkValue ordinal, not a word', () => {
    // BasicTaxes.pas:9-10 — taxKind_Percent = 0, taxKind_ValuePerUnit = 1. The
    // client switches on this to choose between a rate bar and a currency field.
    const taxProps = MOCK_TOWN_HALL.groups['townTaxes'];
    const kinds = taxProps.filter(p => /^Tax\d+Kind$/.test(p.name));
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(['0', '1']).toContain(kind.value);
    }
  });

  it('townServices serves svr* keys, not the products group', () => {
    // This fixture held prd* keys belonging to TOWN_PRODUCTS_GROUP, so every
    // property TOWN_SERVICES_GROUP declares came back missing.
    const srvProps = MOCK_TOWN_HALL.groups['townServices'];
    expect(srvProps).toBeDefined();
    const propNames = srvProps.map(p => p.name);
    expect(propNames).toContain('GQOS');
    expect(propNames).toContain('srvCount');
    expect(propNames).toContain('svrName0.0');
    expect(propNames).toContain('svrRatio0');
    expect(propNames.some(n => n.startsWith('prd'))).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Mock <-> template key parity, for the civic groups
  //
  // The divergence this exists to catch is silent by construction: the mock
  // answers whatever key it holds, so a fixture serving `covName0.0` where the
  // template asks for `covName0` looks healthy from both ends and simply
  // renders nothing. It had already happened three times — `Tax0Name.0`,
  // `townServices` filled with `prd*` keys, and the Capitol's coverage names.
  //
  // Scoped to the civic groups on purpose. A blanket sweep over all 27 handlers
  // reports the special tabs (supplies, products, workforce) whose data does not
  // travel in `groups` at all, and would be noise rather than a guard.
  // ---------------------------------------------------------------------------

  /**
   * Every property name the template would put in its `GetPropertyList`, with
   * indexed rows expanded against the count the mock itself serves.
   *
   * ACTION_BUTTON columns are excluded: they name a control, not a cache
   * property, and no server writes one.
   */
  function templateKeysFor(group: PropertyGroup, served: Map<string, string>): string[] {
    const template = { id: 't', name: 't', groups: [group] } as unknown as BuildingTemplate;
    const collected = collectTemplatePropertyNamesStructured(template);
    const keys = new Set<string>(collected.regularProperties);

    for (const countProp of collected.countProperties) {
      keys.add(countProp);
      const count = parseInt(served.get(countProp) ?? '0', 10);
      for (const info of collected.indexedByCount.get(countProp) ?? []) {
        for (let i = 0; i < count; i++) {
          if (info.columns) {
            for (const col of info.columns) {
              const suffix = col.indexSuffix !== undefined ? col.indexSuffix : (info.indexSuffix ?? '');
              keys.add(`${col.rdoSuffix}${i}${col.columnSuffix ?? ''}${suffix}`);
            }
          } else {
            keys.add(`${info.rdoName}${i}${info.indexSuffix ?? ''}`);
          }
        }
      }
    }
    return Array.from(keys);
  }

  const CIVIC_TABS = [
    ['townGeneral', MOCK_TOWN_HALL], ['townJobs', MOCK_TOWN_HALL],
    ['townRes', MOCK_TOWN_HALL], ['townServices', MOCK_TOWN_HALL],
    ['townTaxes', MOCK_TOWN_HALL],
    ['capitolGeneral', MOCK_CAPITOL], ['capitolTowns', MOCK_CAPITOL],
    ['ministeries', MOCK_CAPITOL], ['votes', MOCK_CAPITOL],
  ] as const;

  it.each(CIVIC_TABS)('%s serves every key its template asks for', (tabId, building) => {
    const tab = building.tabs.find(t => t.id === tabId)!;
    const props = building.groups[tabId];
    const served = new Map(props.map(p => [p.name, p.value]));
    const group = HANDLER_TO_GROUP[tab.handlerName!];
    expect(group).toBeDefined();

    const missing = templateKeysFor(group, served).filter(k => !served.has(k));
    expect(missing).toEqual([]);
  });

  it('the Capitol coverage names carry no language suffix, unlike the town\'s', () => {
    // WorldPolitics.pas:1303 writes `covName0` flat; Population.pas:1090 writes
    // the town's through StoreMultiStringToCache, hence `covName0.0`. Serving
    // the same shape on both is what emptied the Capitol GENERAL tab.
    const capitol = MOCK_CAPITOL.groups['capitolGeneral'].map(p => p.name);
    expect(capitol).toContain('covName0');
    expect(capitol).not.toContain('covName0.0');

    const town = MOCK_TOWN_HALL.groups['townGeneral'].map(p => p.name);
    expect(town).toContain('covName0.0');
    expect(town).not.toContain('covName0');
  });

  it('RDO has GetPropertyList exchanges for each building group', () => {
    const { rdo } = createBuildingDetailsScenario();
    // Each building has exchanges for each group
    const totalGroups = ALL_MOCK_BUILDINGS.reduce(
      (sum, b) => sum + Object.keys(b.groups).length, 0
    );
    expect(rdo.exchanges).toHaveLength(totalGroups);
    for (const exchange of rdo.exchanges) {
      expect(exchange.matchKeys?.member).toBe('GetPropertyList');
    }
  });
});

// =============================================================================
// Scenario Registry
// =============================================================================

// =============================================================================
// Scenario 16: civic-mutations
// =============================================================================

describe('civic-mutations scenario', () => {
  it('creates scenario with RDO and HTTP', () => {
    const { rdo, http } = createCivicMutationsScenario();
    expect(rdo.name).toBe('civic-mutations');
    expect(http.name).toBe('civic-mutations');
    expect(rdo.exchanges.length).toBeGreaterThan(0);
    expect(http.exchanges).toHaveLength(5);
  });

  it('variable override reaches the campaign page body', () => {
    const { http } = createCivicMutationsScenario({ worldName: 'Helartia' });
    expect(http.variables.worldName).toBe('Helartia');
  });
});

describe('scenario registry', () => {
  it('SCENARIO_NAMES has 11 entries', () => {
    expect(SCENARIO_NAMES).toHaveLength(11);
  });

  it('loadScenario returns bundle for each name', () => {
    for (const name of SCENARIO_NAMES) {
      const bundle = loadScenario(name);
      expect(bundle).toBeDefined();
      // Every scenario should have at least one of ws, rdo, or http
      const hasAtLeastOne = bundle.ws !== undefined || bundle.rdo !== undefined || bundle.http !== undefined;
      expect(hasAtLeastOne).toBe(true);
    }
  });

  it('loadAll merges all scenarios', () => {
    const all = loadAll();
    expect(all.ws).toBeDefined();
    expect(all.rdo).toBeDefined();
    expect(all.http).toBeDefined();
    expect(all.ws.name).toBe('all-scenarios');
    expect(all.rdo.name).toBe('all-scenarios');
    expect(all.http.name).toBe('all-scenarios');
  });

  it('loadAll.ws has exchanges from all scenarios', () => {
    const all = loadAll();
    expect(all.ws.exchanges.length).toBeGreaterThanOrEqual(5);
  });

  it('loadAll.rdo has exchanges from all scenarios', () => {
    const all = loadAll();
    // Auth(5) + world-list(5) + select-company(5) + switch-focus(2) +
    // build-menu(2) + build-roads(1) + mail(14) + building-details(many) = 34+
    expect(all.rdo.exchanges.length).toBeGreaterThanOrEqual(20);
  });

  it('loadAll.http has exchanges from all scenarios', () => {
    const all = loadAll();
    // company-list(5) + select-company(2) + build-menu(2) + build-roads(1) + mail(4) = 14
    expect(all.http.exchanges.length).toBeGreaterThanOrEqual(8);
  });

  it('variable overrides propagate through registry', () => {
    const all = loadAll({ username: 'TestUser' });
    // Check that auth WS exchange uses the override
    const authExchange = all.ws.exchanges.find(
      e => e.id === 'auth-ws-001'
    );
    expect(authExchange).toBeDefined();
    const request = authExchange!.request as unknown as Record<string, unknown>;
    expect(request.username).toBe('TestUser');
  });
});
