/**
 * Unit Tests for Template Groups (Handler Registry)
 *
 * Verifies that all CLASSES.BIN handlers have dedicated PropertyGroup definitions
 * with correct RDO property names matching the Voyager Delphi source.
 */

import { describe, it, expect } from '@jest/globals';
import { RDO_MEMBERS, isCataloguedRdoMember } from '../rdo-members';
import { PropertyType, type BuildingTemplate } from './property-definitions';
import { HIDDEN_PROPERTY_NAMES } from './hidden-properties';
import {
  HANDLER_TO_GROUP,
  GROUP_BY_ID,
  getGroupById,
  GENERIC_GROUP,
  UNK_GENERAL_GROUP,
  IND_GENERAL_GROUP,
  SRV_GENERAL_GROUP,
  RES_GENERAL_GROUP,
  HQ_GENERAL_GROUP,
  BANK_GENERAL_GROUP,
  WH_GENERAL_GROUP,
  TV_GENERAL_GROUP,
  CAPITOL_GENERAL_GROUP,
  TOWN_GENERAL_GROUP,
  WORKFORCE_GROUP,
  SUPPLIES_GROUP,
  PRODUCTS_GROUP,
  ADVERTISEMENT_GROUP,
  UPGRADE_GROUP,
  FINANCES_GROUP,
  BANK_LOANS_GROUP,
  ANTENNAS_GROUP,
  FILMS_GROUP,
  MAUSOLEUM_GROUP,
  VOTES_GROUP,
  CAPITOL_TOWNS_GROUP,
  MINISTERIES_GROUP,
  TOWN_JOBS_GROUP,
  TOWN_RES_GROUP,
  TOWN_SERVICES_GROUP,
  TOWN_TAXES_GROUP
} from './template-groups';
import {
  collectTemplatePropertyNamesStructured,
  collectTemplatePropertyNamesForGroups,
  registerInspectorTabs,
  getTemplateForVisualClass,
  clearInspectorTabsCache,
} from './property-templates';

describe('HANDLER_TO_GROUP mapping', () => {
  it('should map all 29 CLASSES.BIN handler names', () => {
    const expectedHandlers = [
      'unkGeneral', 'ResGeneral', 'IndGeneral', 'SrvGeneral',
      'HqGeneral', 'BankGeneral', 'WHGeneral', 'TVGeneral',
      'capitolGeneral', 'townGeneral',
      'Supplies', 'Products', 'compInputs', 'Ads', 'Workforce', 'facManagement', 'Chart',
      'BankLoans', 'Antennas', 'Films', 'Mausoleum',
      'Votes', 'CapitolTowns', 'Ministeries',
      'townJobs', 'townRes', 'townServices', 'townProducts', 'townTaxes',
    ];
    for (const handler of expectedHandlers) {
      expect(HANDLER_TO_GROUP[handler]).toBeDefined();
    }
  });

  it('should map all handlers to non-GENERIC groups', () => {
    const genericHandlers = Object.entries(HANDLER_TO_GROUP)
      .filter(([, group]) => group === GENERIC_GROUP)
      .map(([name]) => name);

    expect(genericHandlers).toEqual([]);
  });

  it('should map each general handler to a unique group', () => {
    expect(HANDLER_TO_GROUP['unkGeneral']).toBe(UNK_GENERAL_GROUP);
    expect(HANDLER_TO_GROUP['ResGeneral']).toBe(RES_GENERAL_GROUP);
    expect(HANDLER_TO_GROUP['IndGeneral']).toBe(IND_GENERAL_GROUP);
    expect(HANDLER_TO_GROUP['SrvGeneral']).toBe(SRV_GENERAL_GROUP);
    expect(HANDLER_TO_GROUP['HqGeneral']).toBe(HQ_GENERAL_GROUP);
    expect(HANDLER_TO_GROUP['BankGeneral']).toBe(BANK_GENERAL_GROUP);
    expect(HANDLER_TO_GROUP['WHGeneral']).toBe(WH_GENERAL_GROUP);
    expect(HANDLER_TO_GROUP['TVGeneral']).toBe(TV_GENERAL_GROUP);
    expect(HANDLER_TO_GROUP['capitolGeneral']).toBe(CAPITOL_GENERAL_GROUP);
    expect(HANDLER_TO_GROUP['townGeneral']).toBe(TOWN_GENERAL_GROUP);
  });

  it('should map core handlers to existing groups', () => {
    expect(HANDLER_TO_GROUP['Supplies']).toBe(SUPPLIES_GROUP);
    expect(HANDLER_TO_GROUP['Products']).toBe(PRODUCTS_GROUP);
    expect(HANDLER_TO_GROUP['compInputs']).toBe(ADVERTISEMENT_GROUP);
    expect(HANDLER_TO_GROUP['Workforce']).toBe(WORKFORCE_GROUP);
    expect(HANDLER_TO_GROUP['facManagement']).toBe(UPGRADE_GROUP);
    expect(HANDLER_TO_GROUP['Chart']).toBe(FINANCES_GROUP);
  });

  it('should map specialized handlers to dedicated groups', () => {
    expect(HANDLER_TO_GROUP['BankLoans']).toBe(BANK_LOANS_GROUP);
    expect(HANDLER_TO_GROUP['Antennas']).toBe(ANTENNAS_GROUP);
    expect(HANDLER_TO_GROUP['Films']).toBe(FILMS_GROUP);
    expect(HANDLER_TO_GROUP['Mausoleum']).toBe(MAUSOLEUM_GROUP);
    expect(HANDLER_TO_GROUP['Votes']).toBe(VOTES_GROUP);
    expect(HANDLER_TO_GROUP['CapitolTowns']).toBe(CAPITOL_TOWNS_GROUP);
    expect(HANDLER_TO_GROUP['Ministeries']).toBe(MINISTERIES_GROUP);
    expect(HANDLER_TO_GROUP['townJobs']).toBe(TOWN_JOBS_GROUP);
    expect(HANDLER_TO_GROUP['townRes']).toBe(TOWN_RES_GROUP);
    expect(HANDLER_TO_GROUP['townServices']).toBe(TOWN_SERVICES_GROUP);
    expect(HANDLER_TO_GROUP['townTaxes']).toBe(TOWN_TAXES_GROUP);
  });
});

describe('GROUP_BY_ID lookup', () => {
  it('should contain all group IDs', () => {
    const expectedIds = [
      'overview', 'generic',
      'unkGeneral', 'indGeneral', 'srvGeneral', 'resGeneral',
      'hqGeneral', 'bankGeneral', 'whGeneral', 'tvGeneral',
      'capitolGeneral', 'townGeneral',
      'workforce', 'supplies', 'upgrade', 'finances',
      'advertisement', 'town', 'coverage', 'trade', 'localServices',
      'bankLoans', 'antennas', 'films', 'mausoleum',
      'votes', 'capitolTowns', 'ministeries',
      'townJobs', 'townRes', 'townServices', 'townTaxes',
    ];
    for (const id of expectedIds) {
      expect(GROUP_BY_ID[id]).toBeDefined();
    }
  });
});

describe('getGroupById()', () => {
  it('should resolve direct IDs', () => {
    expect(getGroupById('workforce')).toBe(WORKFORCE_GROUP);
    expect(getGroupById('bankLoans')).toBe(BANK_LOANS_GROUP);
    expect(getGroupById('townTaxes')).toBe(TOWN_TAXES_GROUP);
  });

  it('should resolve handler-suffixed IDs', () => {
    // When registerInspectorTabs creates duplicate IDs, they get suffixed
    expect(getGroupById('generic_Ministeries')).toBe(GENERIC_GROUP);
    expect(getGroupById('generic_BankLoans')).toBe(GENERIC_GROUP);
  });

  it('should return undefined for unknown IDs', () => {
    expect(getGroupById('nonexistent')).toBeUndefined();
    expect(getGroupById('foo_bar')).toBeUndefined();
  });
});

describe('General handler RDO properties', () => {
  it('IndGeneral should have trade properties', () => {
    const rdoNames = IND_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(rdoNames).toContain('Name');
    expect(rdoNames).toContain('Creator');
    expect(rdoNames).toContain('Cost');
    expect(rdoNames).toContain('ROI');
    expect(rdoNames).toContain('TradeRole');
    expect(rdoNames).toContain('TradeLevel');
  });

  it('IndGeneral should have rdoCommands for trade settings', () => {
    expect(IND_GENERAL_GROUP.rdoCommands).toBeDefined();
    expect(IND_GENERAL_GROUP.rdoCommands!['TradeLevel']?.command).toBe('RDOSetTradeLevel');
    expect(IND_GENERAL_GROUP.rdoCommands!['TradeRole']?.command).toBe('RDOSetRole');
  });

  it('ResGeneral should have Rent and Maintenance sliders', () => {
    const rentProp = RES_GENERAL_GROUP.properties.find(p => p.rdoName === 'Rent');
    expect(rentProp).toBeDefined();
    expect(rentProp!.type).toBe(PropertyType.SLIDER);
    expect(rentProp!.editable).toBe(true);

    const maintProp = RES_GENERAL_GROUP.properties.find(p => p.rdoName === 'Maintenance');
    expect(maintProp).toBeDefined();
    expect(maintProp!.type).toBe(PropertyType.SLIDER);
    expect(maintProp!.editable).toBe(true);
  });

  it('ResGeneral should have 23 properties (PopulatedBlock stats + investment sliders + repair control + stop toggle + demolish + kind/cluster/town)', () => {
    expect(RES_GENERAL_GROUP.properties).toHaveLength(23);
  });

  it('ResGeneral should have residential stats from PopulatedBlock.StoreToCache', () => {
    const rdoNames = RES_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(rdoNames).toContain('Occupancy');
    expect(rdoNames).toContain('Inhabitants');
    expect(rdoNames).toContain('QOL');
    expect(rdoNames).toContain('Beauty');
    expect(rdoNames).toContain('Crime');
    expect(rdoNames).toContain('Pollution');
  });

  it('ResGeneral should have investment properties as read-only PERCENTAGE (not editable)', () => {
    const investmentProps = ['invCrimeRes', 'invPollutionRes', 'invPrivacy', 'InvBeauty'];
    for (const propName of investmentProps) {
      const prop = RES_GENERAL_GROUP.properties.find(p => p.rdoName === propName);
      expect(prop).toBeDefined();
      expect(prop!.type).toBe(PropertyType.PERCENTAGE);
      expect(prop!.editable).toBeUndefined();
    }
  });

  it('ResGeneral should have rdoCommands for editable sliders (Rent, Maintenance only)', () => {
    const editableSliders = ['Rent', 'Maintenance'];
    for (const name of editableSliders) {
      expect(RES_GENERAL_GROUP.rdoCommands![name]).toBeDefined();
      expect(RES_GENERAL_GROUP.rdoCommands![name].command).toBe('property');
    }
    // Investment properties are read-only — no rdoCommands
    const readOnlyProps = ['invCrimeRes', 'invPollutionRes', 'invPrivacy', 'InvBeauty'];
    for (const name of readOnlyProps) {
      expect(RES_GENERAL_GROUP.rdoCommands![name]).toBeUndefined();
    }
  });

  it('ResGeneral should have REPAIR_CONTROL with RepairPrice as maxProperty', () => {
    const repair = RES_GENERAL_GROUP.properties.find(p => p.rdoName === 'Repair');
    expect(repair).toBeDefined();
    expect(repair!.type).toBe(PropertyType.REPAIR_CONTROL);
    expect(repair!.maxProperty).toBe('RepairPrice');
  });

  it('BankGeneral should have BudgetPerc slider', () => {
    const budgetProp = BANK_GENERAL_GROUP.properties.find(p => p.rdoName === 'BudgetPerc');
    expect(budgetProp).toBeDefined();
    expect(budgetProp!.type).toBe(PropertyType.SLIDER);
    expect(budgetProp!.editable).toBe(true);
    expect(BANK_GENERAL_GROUP.rdoCommands!['BudgetPerc']?.command).toBe('RDOSetLoanPerc');
  });

  it('TVGeneral should have HoursOnAir and Comercials sliders', () => {
    const hoursOnAir = TV_GENERAL_GROUP.properties.find(p => p.rdoName === 'HoursOnAir');
    expect(hoursOnAir).toBeDefined();
    expect(hoursOnAir!.type).toBe(PropertyType.SLIDER);

    const comercials = TV_GENERAL_GROUP.properties.find(p => p.rdoName === 'Comercials');
    expect(comercials).toBeDefined();
    expect(comercials!.type).toBe(PropertyType.SLIDER);
  });

  it('BankGeneral bounds Interest 0-50 and Term 1-100, as Voyager does', () => {
    // BankGeneralSheet.dfm: peInterest MinPerc 0 / MaxPerc 50, peTerm 1 / 100.
    const interest = BANK_GENERAL_GROUP.properties.find(p => p.rdoName === 'Interest')!;
    expect([interest.min, interest.max]).toEqual([0, 50]);
    const term = BANK_GENERAL_GROUP.properties.find(p => p.rdoName === 'Term')!;
    expect([term.min, term.max]).toEqual([1, 100]);
  });

  it('TVGeneral bounds HoursOnAir 0-24 in hours, not as a percentage', () => {
    // TVGeneralSheet.dfm peHoursOnAir 0..24 — a count of hours in a day.
    const hours = TV_GENERAL_GROUP.properties.find(p => p.rdoName === 'HoursOnAir')!;
    expect([hours.min, hours.max]).toEqual([0, 24]);
    expect(hours.step).toBe(1); // PropertyGroup defaults a missing step to 5
    expect(hours.unit).toBeDefined();
    expect(hours.unit).not.toBe('%');
  });

  it('the six values StoreToCache never writes are marked notCached', () => {
    // TBankBlock.StoreToCache (StdBlocks/Banks.pas:188-206) and
    // TBroadcaster.StoreToCache (StdBlocks/Broadcast.pas:431-453) hold none of them.
    for (const name of ['EstLoan', 'Interest', 'Term', 'BudgetPerc']) {
      expect(BANK_GENERAL_GROUP.properties.find(p => p.rdoName === name)!.notCached).toBe(true);
    }
    for (const name of ['HoursOnAir', 'Comercials']) {
      expect(TV_GENERAL_GROUP.properties.find(p => p.rdoName === name)!.notCached).toBe(true);
    }
  });

  it('both groups request the hidden CurrBlock the live reads bind to', () => {
    for (const group of [BANK_GENERAL_GROUP, TV_GENERAL_GROUP]) {
      const block = group.properties.find(p => p.rdoName === 'CurrBlock');
      expect(block).toBeDefined();
      expect(block!.notCached).toBeUndefined(); // it IS in the cache — it is what we read
      expect(HIDDEN_PROPERTY_NAMES.has('CurrBlock')).toBe(true);
    }
  });

  it('capitolGeneral should have coverage TABLE', () => {
    const tableProp = CAPITOL_GENERAL_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(tableProp).toBeDefined();
    expect(tableProp!.countProperty).toBe('covCount');
    expect(tableProp!.columns).toHaveLength(2);
    expect(tableProp!.columns![0].rdoSuffix).toBe('covName');
    expect(tableProp!.columns![1].rdoSuffix).toBe('covValue');
  });

  it('townGeneral should have coverage TABLE and mayor properties', () => {
    const rdoNames = TOWN_GENERAL_GROUP.properties.map(p => p.rdoName);
    expect(rdoNames).toContain('ActualRuler');
    expect(rdoNames).toContain('Town');
    expect(rdoNames).toContain('NewspaperName');
    expect(rdoNames).toContain('RulerPrestige');
    expect(rdoNames).toContain('HasRuler');

    const tableProp = TOWN_GENERAL_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(tableProp).toBeDefined();
    expect(tableProp!.countProperty).toBe('covCount');
    // TownHall: covName uses MLS (.0 suffix), covValue is plain integer (no suffix)
    // Population.pas:1090 — StoreMultiStringToCache for covName, WriteInteger for covValue
    expect(tableProp!.indexSuffix).toBe('.0');
    const covNameCol = tableProp!.columns!.find(c => c.rdoSuffix === 'covName');
    expect(covNameCol!.indexSuffix).toBeUndefined(); // inherits table-level '.0'
    const covValueCol = tableProp!.columns!.find(c => c.rdoSuffix === 'covValue');
    expect(covValueCol!.indexSuffix).toBe(''); // overrides to '' — covValue is plain integer
  });

  it('SrvGeneral should have SERVICE_CARDS with editable price column', () => {
    const cardProp = SRV_GENERAL_GROUP.properties.find(p => p.type === PropertyType.SERVICE_CARDS);
    expect(cardProp).toBeDefined();
    expect(cardProp!.countProperty).toBe('ServiceCount');
    expect(cardProp!.columns).toHaveLength(7);

    const priceCol = cardProp!.columns!.find(c => c.rdoSuffix === 'srvPrices');
    expect(priceCol).toBeDefined();
    expect(priceCol!.editable).toBe(true);
    expect(priceCol!.type).toBe(PropertyType.SLIDER);
  });

  it('SrvGeneral declares the srvSales column, unsuffixed, expanding to srvSales0', () => {
    // Services.asp:57 (mvcProperty=Sales); ServiceBlock.pas:1735 WriteInteger('srvSales'+i)
    const cardProp = SRV_GENERAL_GROUP.properties.find(p => p.type === PropertyType.SERVICE_CARDS);
    const salesCol = cardProp!.columns!.find(c => c.rdoSuffix === 'srvSales');
    expect(salesCol).toBeDefined();
    expect(salesCol!.label).toBe('Sales');
    expect(salesCol!.type).toBe(PropertyType.PERCENTAGE);
    expect(salesCol!.indexSuffix).toBeUndefined();
    expect(salesCol!.editable).toBeFalsy();
    // Sits beside Offer and Demand, before the price columns
    const order = cardProp!.columns!.map(c => c.rdoSuffix);
    expect(order.indexOf('srvSales')).toBe(order.indexOf('srvDemands') + 1);

    // Property-name expansion for index 0 is exactly `srvSales0` — no language suffix
    const template = { id: 't', name: 't', groups: [SRV_GENERAL_GROUP] } as unknown as BuildingTemplate;
    const collected = collectTemplatePropertyNamesStructured(template);
    const info = collected.indexedByCount.get('ServiceCount')!.find(i => i.rdoName === 'srvNames')!;
    const col = info.columns!.find(c => c.rdoSuffix === 'srvSales')!;
    const suffix = col.indexSuffix !== undefined ? col.indexSuffix : (info.indexSuffix ?? '');
    expect(`${col.rdoSuffix}0${col.columnSuffix ?? ''}${suffix}`).toBe('srvSales0');
  });
});

describe('Specialized handler RDO properties', () => {
  it('BankLoans should have loan TABLE', () => {
    const tableProp = BANK_LOANS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(tableProp).toBeDefined();
    expect(tableProp!.countProperty).toBe('LoanCount');
    expect(tableProp!.columns).toHaveLength(4);
    const colNames = tableProp!.columns!.map(c => c.rdoSuffix);
    expect(colNames).toEqual(['Debtor', 'Amount', 'Interest', 'Term']);
  });

  it('Antennas should have antenna TABLE', () => {
    const tableProp = ANTENNAS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(tableProp).toBeDefined();
    expect(tableProp!.countProperty).toBe('antCount');
    expect(tableProp!.columns).toHaveLength(6);
    const colNames = tableProp!.columns!.map(c => c.rdoSuffix);
    expect(colNames).toEqual(['antName', 'antTown', 'antViewers', 'antActive', 'antX', 'antY']);
  });

  it('Films should have 10 properties (display + controls + action buttons)', () => {
    expect(FILMS_GROUP.properties).toHaveLength(10);
  });

  it('Films should have display properties from FilmsSheet.pas', () => {
    const rdoNames = FILMS_GROUP.properties.map(p => p.rdoName);
    expect(rdoNames).toContain('FilmName');
    expect(rdoNames).toContain('FilmBudget');
    expect(rdoNames).toContain('FilmTime');

    const filmName = FILMS_GROUP.properties.find(p => p.rdoName === 'FilmName');
    expect(filmName!.type).toBe(PropertyType.TEXT);

    const filmBudget = FILMS_GROUP.properties.find(p => p.rdoName === 'FilmBudget');
    expect(filmBudget!.type).toBe(PropertyType.CURRENCY);

    const filmTime = FILMS_GROUP.properties.find(p => p.rdoName === 'FilmTime');
    expect(filmTime!.type).toBe(PropertyType.NUMBER);
    expect(filmTime!.unit).toBe('months');
  });

  it('Films should have production properties with editable booleans', () => {
    const rdoNames = FILMS_GROUP.properties.map(p => p.rdoName);
    expect(rdoNames).toContain('InProd');
    expect(rdoNames).toContain('FilmDone');
    expect(rdoNames).toContain('AutoProd');
    expect(rdoNames).toContain('AutoRel');

    const autoProd = FILMS_GROUP.properties.find(p => p.rdoName === 'AutoProd');
    expect(autoProd!.type).toBe(PropertyType.BOOLEAN);
    expect(autoProd!.editable).toBe(true);

    // AutoRel displays, it does not write: no server member sets auto-release after
    // launch, so a mapping here would emit a frame the server discards. It rides bit 0
    // of RDOLaunchMovie's AutoInfo instead (StdBlocks/MovieStudios.pas:19,104).
    const autoRel = FILMS_GROUP.properties.find(p => p.rdoName === 'AutoRel');
    expect(autoRel!.type).toBe(PropertyType.BOOLEAN);
    expect(autoRel!.editable).toBeUndefined();

    expect(FILMS_GROUP.rdoCommands!['AutoProd']?.command).toBe('RDOAutoProduce');
    expect(FILMS_GROUP.rdoCommands!['AutoRel']).toBeUndefined();
  });

  it('Mausoleum should have memorial properties', () => {
    const rdoNames = MAUSOLEUM_GROUP.properties.map(p => p.rdoName);
    expect(rdoNames).toContain('WordsOfWisdom');
    expect(rdoNames).toContain('OwnerName');
    expect(rdoNames).toContain('Transcended');
  });

  it('Votes should have ruler properties and candidate TABLE', () => {
    const rdoNames = VOTES_GROUP.properties.map(p => p.rdoName);
    expect(rdoNames).toContain('RulerName');
    expect(rdoNames).toContain('RulerVotes');

    const tableProp = VOTES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(tableProp).toBeDefined();
    expect(tableProp!.countProperty).toBe('CampaignCount');
  });

  it('CapitolTowns should have town TABLE', () => {
    const tableProp = CAPITOL_TOWNS_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(tableProp).toBeDefined();
    expect(tableProp!.countProperty).toBe('TownCount');
    expect(tableProp!.columns!.length).toBeGreaterThanOrEqual(6);
  });

  it('Ministeries should have minister TABLE with MLS indexSuffix on Ministry column', () => {
    const tableProp = MINISTERIES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(tableProp).toBeDefined();
    expect(tableProp!.countProperty).toBe('MinisterCount');
    // Property-level indexSuffix is undefined; column-level indexSuffix handles MLS
    expect(tableProp!.indexSuffix).toBeUndefined();
    const ministryCol = tableProp!.columns!.find(c => c.rdoSuffix === 'Ministry');
    expect(ministryCol!.indexSuffix).toBe('.0');
  });

  it('townJobs should have salary properties', () => {
    const rdoNames = TOWN_JOBS_GROUP.properties.map(p => p.rdoName);
    expect(rdoNames).toContain('hiMinSalary');
    expect(rdoNames).toContain('midMinSalary');
    expect(rdoNames).toContain('loMinSalary');
    expect(rdoNames).toContain('hiActualMinSalary');
    expect(rdoNames).toContain('midActualMinSalary');
    expect(rdoNames).toContain('loActualMinSalary');
  });

  it('townServices should have svr* TABLE with 8 columns (from TownProdxSheet.pas)', () => {
    const tableProp = TOWN_SERVICES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(tableProp).toBeDefined();
    expect(tableProp!.countProperty).toBe('srvCount');
    expect(tableProp!.columns).toHaveLength(8);
    const colNames = tableProp!.columns!.map(c => c.rdoSuffix);
    expect(colNames).toContain('svrName');
    expect(colNames).toContain('svrDemand');
    expect(colNames).toContain('svrOffer');
    expect(colNames).toContain('svrCapacity');
    expect(colNames).toContain('svrRatio');
    expect(colNames).toContain('svrMarketPrice');
    expect(colNames).toContain('svrPrice');
    expect(colNames).toContain('svrQuality');
    // GQOS should be a standalone property
    const gqos = TOWN_SERVICES_GROUP.properties.find(p => p.rdoName === 'GQOS');
    expect(gqos).toBeDefined();
    expect(gqos!.type).toBe(PropertyType.PERCENTAGE);
  });

  it('townRes should have 9 residential properties (3 classes × 3 metrics)', () => {
    const rdoNames = TOWN_RES_GROUP.properties.map(p => p.rdoName);
    expect(rdoNames).toContain('hiResDemand');
    expect(rdoNames).toContain('hiResQ');
    expect(rdoNames).toContain('hiRentPrice');
    expect(rdoNames).toContain('midResDemand');
    expect(rdoNames).toContain('midResQ');
    expect(rdoNames).toContain('midRentPrice');
    expect(rdoNames).toContain('loResDemand');
    expect(rdoNames).toContain('loResQ');
    expect(rdoNames).toContain('loRentPrice');
    expect(TOWN_RES_GROUP.properties).toHaveLength(9);

    // Rent prices should be PERCENTAGE type (displayed as "200%")
    const hiRent = TOWN_RES_GROUP.properties.find(p => p.rdoName === 'hiRentPrice');
    expect(hiRent!.type).toBe(PropertyType.PERCENTAGE);
  });
});

describe('ENUM type properties', () => {
  it('IndGeneral should use ENUM type for TradeRole and TradeLevel', () => {
    const tradeRole = IND_GENERAL_GROUP.properties.find(p => p.rdoName === 'TradeRole');
    expect(tradeRole!.type).toBe(PropertyType.ENUM);
    expect(tradeRole!.enumLabels).toBeDefined();
    expect(tradeRole!.enumLabels!['0']).toBe('Neutral');
    expect(tradeRole!.enumLabels!['3']).toBe('Buyer');

    const tradeLevel = IND_GENERAL_GROUP.properties.find(p => p.rdoName === 'TradeLevel');
    expect(tradeLevel!.type).toBe(PropertyType.ENUM);
    expect(tradeLevel!.editable).toBe(true);
    expect(tradeLevel!.enumLabels!['0']).toBe('Same Owner');
    expect(tradeLevel!.enumLabels!['3']).toBe('Anyone');
  });

  it('WHGeneral should use ENUM type for Role and TradeLevel', () => {
    const role = WH_GENERAL_GROUP.properties.find(p => p.rdoName === 'Role');
    expect(role!.type).toBe(PropertyType.ENUM);

    const tradeLevel = WH_GENERAL_GROUP.properties.find(p => p.rdoName === 'TradeLevel');
    expect(tradeLevel!.type).toBe(PropertyType.ENUM);
    expect(tradeLevel!.editable).toBe(true);
  });

  it('IndGeneral TradeRole should use ENUM type with facility role labels', () => {
    const tradeRole = IND_GENERAL_GROUP.properties.find(p => p.rdoName === 'TradeRole');
    expect(tradeRole!.type).toBe(PropertyType.ENUM);
    expect(tradeRole!.editable).toBe(true);
    expect(tradeRole!.enumLabels!['1']).toBe('Producer');
    expect(tradeRole!.enumLabels!['6']).toBe('Import');
  });
});

describe('townTaxes columnSuffix pattern', () => {
  it('should have Tax columns with columnSuffix (Name0 includes language code)', () => {
    const tableProp = TOWN_TAXES_GROUP.properties.find(p => p.type === PropertyType.TABLE);
    expect(tableProp).toBeDefined();
    expect(tableProp!.countProperty).toBe('TaxCount');

    // Name column includes language code '0' in suffix: Tax{i}Name0
    const nameSuffixCol = tableProp!.columns!.find(c => c.columnSuffix === 'Name0');
    expect(nameSuffixCol).toBeDefined();
    expect(nameSuffixCol!.rdoSuffix).toBe('Tax');

    // Hidden Id column for RDO command reference
    const idCol = tableProp!.columns!.find(c => c.columnSuffix === 'Id');
    expect(idCol).toBeDefined();
    expect(idCol!.width).toBe('0%');

    const percentCol = tableProp!.columns!.find(c => c.columnSuffix === 'Percent');
    expect(percentCol).toBeDefined();
    expect(percentCol!.editable).toBe(true);
  });

  it('should have rdoCommands for RDOSetTaxValue (not RDOSetTaxPercent)', () => {
    expect(TOWN_TAXES_GROUP.rdoCommands).toBeDefined();
    expect(TOWN_TAXES_GROUP.rdoCommands!['TaxPercent']?.command).toBe('RDOSetTaxValue');
    expect(TOWN_TAXES_GROUP.rdoCommands!['TaxPercent']?.indexed).toBe(true);
  });
});

describe('collectTemplatePropertyNamesStructured with TABLE columns', () => {
  beforeEach(() => {
    clearInspectorTabsCache();
  });

  it('should collect count property and indexed column defs for TABLE properties', () => {
    registerInspectorTabs('testBank', [
      { tabName: 'Loans', tabHandler: 'BankLoans' },
    ]);

    const template = getTemplateForVisualClass('testBank');
    const collected = collectTemplatePropertyNamesStructured(template);

    expect(collected.countProperties).toContain('LoanCount');
    expect(collected.indexedByCount.has('LoanCount')).toBe(true);

    const indexedDefs = collected.indexedByCount.get('LoanCount')!;
    expect(indexedDefs.length).toBeGreaterThanOrEqual(1);

    // TABLE column info should be present
    const tableDef = indexedDefs.find(d => d.columns && d.columns.length > 0);
    expect(tableDef).toBeDefined();
    expect(tableDef!.columns!.length).toBe(4);
  });

  it('should collect columnSuffix in TABLE column defs', () => {
    registerInspectorTabs('testTownTax', [
      { tabName: 'Taxes', tabHandler: 'townTaxes' },
    ]);

    const template = getTemplateForVisualClass('testTownTax');
    const collected = collectTemplatePropertyNamesStructured(template);

    expect(collected.countProperties).toContain('TaxCount');
    const indexedDefs = collected.indexedByCount.get('TaxCount')!;
    const tableDef = indexedDefs.find(d => d.columns && d.columns.length > 0);
    expect(tableDef).toBeDefined();

    // Verify columnSuffix is preserved (Name0 includes language code)
    const nameCol = tableDef!.columns!.find(c => c.columnSuffix === 'Name0');
    expect(nameCol).toBeDefined();
    expect(nameCol!.rdoSuffix).toBe('Tax');
  });

  it('should collect flat properties for simple handlers', () => {
    registerInspectorTabs('testFilms', [
      { tabName: 'Films', tabHandler: 'Films' },
    ]);

    const template = getTemplateForVisualClass('testFilms');
    const collected = collectTemplatePropertyNamesStructured(template);

    expect(collected.regularProperties).toContain('InProd');
    expect(collected.regularProperties).toContain('FilmDone');
    expect(collected.regularProperties).toContain('AutoProd');
    expect(collected.regularProperties).toContain('AutoRel');
    expect(collected.regularProperties).toContain('FilmName');
    expect(collected.regularProperties).toContain('FilmBudget');
    expect(collected.regularProperties).toContain('FilmTime');
  });

  it('should expand WORKFORCE_TABLE to 24 properties (8 per class × 3 classes)', () => {
    registerInspectorTabs('testWorkforce', [
      { tabName: 'Workforce', tabHandler: 'Workforce' },
    ]);

    const template = getTemplateForVisualClass('testWorkforce');
    const collected = collectTemplatePropertyNamesStructured(template);

    // 8 properties per class: Workers, WorkersMax, WorkersK, Salaries,
    // WorkForcePrice, WorkersCap, MinSalaries, SalaryValues
    const workforceProps = [
      'Workers', 'WorkersMax', 'WorkersK', 'Salaries',
      'WorkForcePrice', 'WorkersCap', 'MinSalaries', 'SalaryValues',
    ];
    for (const baseName of workforceProps) {
      for (let i = 0; i < 3; i++) {
        expect(collected.regularProperties).toContain(`${baseName}${i}`);
      }
    }

    // Count workforce-specific properties (all 24)
    const wfProps = Array.from(collected.regularProperties).filter(p =>
      workforceProps.some(base => p.startsWith(base))
    );
    expect(wfProps).toHaveLength(24);
  });
});

describe('registerInspectorTabs integration', () => {
  beforeEach(() => {
    clearInspectorTabsCache();
  });

  it('should register tabs and retrieve template', () => {
    registerInspectorTabs('testClass', [
      { tabName: 'General', tabHandler: 'IndGeneral' },
      { tabName: 'Supplies', tabHandler: 'Supplies' },
      { tabName: 'Workforce', tabHandler: 'Workforce' },
      { tabName: 'Management', tabHandler: 'facManagement' },
      { tabName: 'Money', tabHandler: 'Chart' },
    ]);

    const template = getTemplateForVisualClass('testClass');
    expect(template.groups).toHaveLength(5);
    expect(template.groups[0].handlerName).toBe('IndGeneral');
    expect(template.groups[1].handlerName).toBe('Supplies');
  });

  it('should show the raw CLASSES.BIN tabName as the tab label', () => {
    // Building inspector tab name from CLASSES.BIN is 'SERVICES' (all-caps raw value).
    // registerInspectorTabs must show that raw tabName, as Voyager does, not the
    // canonical PropertyGroup name for the Supplies handler ('Supplies').
    registerInspectorTabs('testHQ', [
      { tabName: 'SERVICES', tabHandler: 'Supplies' },
    ]);
    const template = getTemplateForVisualClass('testHQ');
    const suppliesGroup = template.groups.find(g => g.handlerName === 'Supplies');
    expect(suppliesGroup).toBeDefined();
    expect(suppliesGroup!.name).toBe('SERVICES');  // raw CLASSES.BIN value, not 'Supplies'
  });

  it('should handle duplicate group IDs with handler suffix', () => {
    registerInspectorTabs('testCapitol', [
      { tabName: 'General', tabHandler: 'capitolGeneral' },
      { tabName: 'Towns', tabHandler: 'CapitolTowns' },
      { tabName: 'Ministries', tabHandler: 'Ministeries' },
      { tabName: 'Votes', tabHandler: 'Votes' },
    ]);

    const template = getTemplateForVisualClass('testCapitol');
    expect(template.groups).toHaveLength(4);

    // Verify all groups have unique IDs
    const ids = template.groups.map(g => g.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe('Capitol building RDO property name generation', () => {
  beforeEach(() => {
    clearInspectorTabsCache();
  });

  /**
   * Register a full Capitol building (all 7 tabs) and collect property names.
   * Verifies that the two-phase fetch generates property names matching
   * the actual RDO protocol traces captured from the Delphi server.
   */
  function registerCapitolAndCollect() {
    registerInspectorTabs('testCapitolFull', [
      { tabName: 'General', tabHandler: 'capitolGeneral' },
      { tabName: 'Ministries', tabHandler: 'Ministeries' },
      { tabName: 'Towns', tabHandler: 'CapitolTowns' },
      { tabName: 'Services', tabHandler: 'townServices' },
      { tabName: 'Jobs', tabHandler: 'townJobs' },
      { tabName: 'Residentials', tabHandler: 'townRes' },
      { tabName: 'Votes', tabHandler: 'Votes' },
    ]);
    const template = getTemplateForVisualClass('testCapitolFull');
    return collectTemplatePropertyNamesStructured(template);
  }

  it('capitolGeneral should fetch ActualRuler, QOL, RulerPeriods, HasRuler, ratings, elections', () => {
    const collected = registerCapitolAndCollect();
    // Phase 1 regular properties (from RDO trace: GetPropertyList "ActualRuler\tRulerRating\t...")
    const expectedRegular = [
      'QOL', 'ActualRuler', 'RulerRating', 'TycoonsRating',
      'RulerPeriods', 'YearsToElections', 'HasRuler',
    ];
    for (const prop of expectedRegular) {
      expect(collected.regularProperties).toContain(prop);
    }
    // covCount is a count property for indexed coverage table
    expect(collected.countProperties).toContain('covCount');
  });

  it('capitolGeneral coverage TABLE should generate covName{i} and covValue{i} (no MLS suffix)', () => {
    const collected = registerCapitolAndCollect();
    const indexedDefs = collected.indexedByCount.get('covCount')!;
    expect(indexedDefs).toBeDefined();

    const tableDef = indexedDefs.find(d => d.columns && d.columns.length > 0);
    expect(tableDef).toBeDefined();

    // Capitol writes covName{i} (plain, no MLS .0 suffix) — WorldPolitics.pas:1303
    // Unlike TownHall which uses covName{i}.{lang} (with MLS suffix)
    expect(tableDef!.indexSuffix).toBe('');

    const covNameCol = tableDef!.columns!.find(c => c.rdoSuffix === 'covName');
    expect(covNameCol).toBeDefined();
    expect(covNameCol!.indexSuffix).toBeUndefined();

    const covValueCol = tableDef!.columns!.find(c => c.rdoSuffix === 'covValue');
    expect(covValueCol).toBeDefined();
    expect(covValueCol!.indexSuffix).toBeUndefined();
  });

  it('CapitolTowns should generate Town{i} not TownName{i}', () => {
    const collected = registerCapitolAndCollect();
    const indexedDefs = collected.indexedByCount.get('TownCount')!;
    const tableDef = indexedDefs.find(d => d.columns && d.columns.length > 0);
    expect(tableDef).toBeDefined();

    // The town name column must use rdoSuffix 'Town' → generates Town0, Town1, ...
    const townCol = tableDef!.columns!.find(c => c.rdoSuffix === 'Town');
    expect(townCol).toBeDefined();

    // Must NOT have a TownName column (would generate wrong property names)
    const wrongCol = tableDef!.columns!.find(c => c.rdoSuffix === 'TownName');
    expect(wrongCol).toBeUndefined();

    // TownRating column should exist (Voyager fetches it, CapitolTownsSheet.pas:198)
    const ratingCol = tableDef!.columns!.find(c => c.rdoSuffix === 'TownRating');
    expect(ratingCol).toBeDefined();
  });

  it('townServices svrName column should have columnSuffix .0 for language code', () => {
    const collected = registerCapitolAndCollect();
    const indexedDefs = collected.indexedByCount.get('srvCount')!;
    const tableDef = indexedDefs.find(d => d.columns && d.columns.length > 0);
    expect(tableDef).toBeDefined();

    // svrName column must have columnSuffix '.0' to generate svrName0.0
    const svrNameCol = tableDef!.columns!.find(c => c.rdoSuffix === 'svrName');
    expect(svrNameCol).toBeDefined();
    expect(svrNameCol!.columnSuffix).toBe('.0');

    // Other columns should NOT have columnSuffix
    const svrDemandCol = tableDef!.columns!.find(c => c.rdoSuffix === 'svrDemand');
    expect(svrDemandCol!.columnSuffix).toBeUndefined();
  });

  it('Ministeries should generate Ministry{i}.0 for name and MinisterBudget{i} for budget', () => {
    const collected = registerCapitolAndCollect();
    const indexedDefs = collected.indexedByCount.get('MinisterCount')!;
    const tableDef = indexedDefs.find(d => d.columns && d.columns.length > 0);
    expect(tableDef).toBeDefined();

    // Ministry column has column-level indexSuffix '.0' for MLS
    const ministryCol = tableDef!.columns!.find(c => c.rdoSuffix === 'Ministry');
    expect(ministryCol).toBeDefined();
    expect(ministryCol!.indexSuffix).toBe('.0');

    // MinisterBudget column should exist (no suffix)
    const budgetCol = tableDef!.columns!.find(c => c.rdoSuffix === 'MinisterBudget');
    expect(budgetCol).toBeDefined();
    expect(budgetCol!.indexSuffix).toBeUndefined();
  });

  it('townJobs should have slider properties with max 200', () => {
    const hiSlider = TOWN_JOBS_GROUP.properties.find(p => p.rdoName === 'hiMinSalary');
    expect(hiSlider).toBeDefined();
    expect(hiSlider!.type).toBe(PropertyType.SLIDER);
    expect(hiSlider!.max).toBe(200);

    const midSlider = TOWN_JOBS_GROUP.properties.find(p => p.rdoName === 'midMinSalary');
    expect(midSlider!.max).toBe(200);

    const loSlider = TOWN_JOBS_GROUP.properties.find(p => p.rdoName === 'loMinSalary');
    expect(loSlider!.max).toBe(200);
  });

  it('townJobs ActualMinSalary properties are read-only NUMBER, not the slider', () => {
    for (const name of ['hiActualMinSalary', 'midActualMinSalary', 'loActualMinSalary']) {
      const prop = TOWN_JOBS_GROUP.properties.find(p => p.rdoName === name);
      expect(prop).toBeDefined();
      expect(prop!.type).toBe(PropertyType.NUMBER);
      expect(prop!.editable).toBeUndefined();
    }
  });

  it('townJobs rdoCommands are keyed on the MinSalary names', () => {
    expect(Object.keys(TOWN_JOBS_GROUP.rdoCommands!).sort()).toEqual(['hiMinSalary', 'loMinSalary', 'midMinSalary']);
  });

  it('townJobs salary properties should be PERCENTAGE type', () => {
    const hiSalary = TOWN_JOBS_GROUP.properties.find(p => p.rdoName === 'hiSalary');
    expect(hiSalary!.type).toBe(PropertyType.PERCENTAGE);

    const midSalaryValue = TOWN_JOBS_GROUP.properties.find(p => p.rdoName === 'midSalaryValue');
    expect(midSalaryValue!.type).toBe(PropertyType.PERCENTAGE);
  });

  it('townRes quality properties should be PERCENTAGE type', () => {
    const hiResQ = TOWN_RES_GROUP.properties.find(p => p.rdoName === 'hiResQ');
    expect(hiResQ!.type).toBe(PropertyType.PERCENTAGE);
    expect(hiResQ!.displayName).toContain('Quality Index');

    const midRent = TOWN_RES_GROUP.properties.find(p => p.rdoName === 'midRentPrice');
    expect(midRent!.type).toBe(PropertyType.PERCENTAGE);
  });

  it('Votes should have Trouble property (hidden when zero)', () => {
    const trouble = VOTES_GROUP.properties.find(p => p.rdoName === 'Trouble');
    expect(trouble).toBeDefined();
    expect(trouble!.type).toBe(PropertyType.NUMBER);
    expect(trouble!.hideEmpty).toBe(true);
  });

  it('Capitol template should have all 7 tabs', () => {
    registerInspectorTabs('testCapitolTabs', [
      { tabName: 'General', tabHandler: 'capitolGeneral' },
      { tabName: 'Ministries', tabHandler: 'Ministeries' },
      { tabName: 'Towns', tabHandler: 'CapitolTowns' },
      { tabName: 'Services', tabHandler: 'townServices' },
      { tabName: 'Jobs', tabHandler: 'townJobs' },
      { tabName: 'Residentials', tabHandler: 'townRes' },
      { tabName: 'Votes', tabHandler: 'Votes' },
    ]);
    const template = getTemplateForVisualClass('testCapitolTabs');
    expect(template.groups).toHaveLength(7);

    const handlerNames = template.groups.map(g => g.handlerName);
    expect(handlerNames).toEqual([
      'capitolGeneral', 'Ministeries', 'CapitolTowns',
      'townServices', 'townJobs', 'townRes', 'Votes',
    ]);
  });
});

describe('UPGRADE_GROUP clone settings', () => {
  it('AcceptCloning rdoCommands key matches property rdoName', () => {
    const acceptProp = UPGRADE_GROUP.properties.find(p => p.rdoName === 'AcceptCloning');
    expect(acceptProp).toBeDefined();
    expect(acceptProp!.type).toBe(PropertyType.BOOLEAN);
    expect(acceptProp!.editable).toBe(true);
    // Key must match rdoName so handlePropertyChange can find the command
    expect(UPGRADE_GROUP.rdoCommands!['AcceptCloning']).toBeDefined();
    expect(UPGRADE_GROUP.rdoCommands!['AcceptCloning'].command).toBe('RDOAcceptCloning');
  });

  it('CloneMenu0 is CLONE_SETTINGS type (not TEXT or ACTION_BUTTON)', () => {
    const cloneMenu = UPGRADE_GROUP.properties.find(p => p.rdoName === 'CloneMenu0');
    expect(cloneMenu).toBeDefined();
    expect(cloneMenu!.type).toBe(PropertyType.CLONE_SETTINGS);
  });

  it('no ACTION_BUTTON for cloneFacility (removed — replaced by CloneSettings component)', () => {
    const actionButton = UPGRADE_GROUP.properties.find(
      p => p.type === PropertyType.ACTION_BUTTON && p.actionId === 'clone'
    );
    expect(actionButton).toBeUndefined();
  });

  it('no CloneFacility in rdoCommands (now uses dedicated handler)', () => {
    expect(UPGRADE_GROUP.rdoCommands!['CloneFacility']).toBeUndefined();
  });
});

describe('collectTemplatePropertyNamesForGroups (R1 tab-scoped refresh)', () => {
  beforeEach(() => {
    clearInspectorTabsCache();
  });

  function registerFactory() {
    registerInspectorTabs('testFactory', [
      { tabName: 'General', tabHandler: 'IndGeneral' },
      { tabName: 'Supplies', tabHandler: 'Supplies' },
      { tabName: 'Products', tabHandler: 'Products' },
      { tabName: 'Workforce', tabHandler: 'Workforce' },
      { tabName: 'Management', tabHandler: 'facManagement' },
    ]);
    return getTemplateForVisualClass('testFactory');
  }

  it('should return only the requested group + first group (overview)', () => {
    const template = registerFactory();
    const workforceGroupId = template.groups.find(g => g.handlerName === 'Workforce')!.id;
    const firstGroupId = template.groups[0].id;

    const scoped = collectTemplatePropertyNamesForGroups(template, [workforceGroupId]);

    // Should contain workforce properties
    expect(scoped.regularProperties).toContain('Workers0');
    expect(scoped.regularProperties).toContain('WorkersMax2');

    // Should contain first group (overview) properties
    const full = collectTemplatePropertyNamesStructured(template);
    const firstGroupProps = collectTemplatePropertyNamesForGroups(template, [firstGroupId]);
    for (const prop of firstGroupProps.regularProperties) {
      expect(scoped.regularProperties).toContain(prop);
    }

    // Should NOT contain properties exclusive to other groups (e.g., Management)
    const managementGroupId = template.groups.find(g => g.handlerName === 'facManagement')!.id;
    const managementOnly = collectTemplatePropertyNamesForGroups(template, [managementGroupId]);
    // Find properties unique to management (not in overview or workforce)
    const overviewAndWorkforceProps = new Set(scoped.regularProperties);
    const managementExclusive = managementOnly.regularProperties.filter(
      p => !overviewAndWorkforceProps.has(p) && !firstGroupProps.regularProperties.includes(p)
    );
    for (const prop of managementExclusive) {
      expect(scoped.regularProperties).not.toContain(prop);
    }

    // Should be a subset of the full collection
    expect(scoped.regularProperties.length).toBeLessThan(full.regularProperties.length);
  });

  it('should always include the first group even if not in groupIds', () => {
    const template = registerFactory();
    const workforceGroupId = template.groups.find(g => g.handlerName === 'Workforce')!.id;
    const firstGroupId = template.groups[0].id;

    // Request only workforce — first group should still be included
    expect(workforceGroupId).not.toBe(firstGroupId);
    const scoped = collectTemplatePropertyNamesForGroups(template, [workforceGroupId]);

    // First group (IndGeneral) has properties like 'Trouble', 'Cost', 'ROI'
    const firstOnly = collectTemplatePropertyNamesForGroups(template, [firstGroupId]);
    for (const prop of firstOnly.regularProperties) {
      expect(scoped.regularProperties).toContain(prop);
    }
  });

  it('should not duplicate properties when groupIds includes the first group', () => {
    const template = registerFactory();
    const firstGroupId = template.groups[0].id;

    const scoped = collectTemplatePropertyNamesForGroups(template, [firstGroupId]);

    // No duplicates (the function uses Sets internally)
    const unique = new Set(scoped.regularProperties);
    expect(unique.size).toBe(scoped.regularProperties.length);

    const uniqueCounts = new Set(scoped.countProperties);
    expect(uniqueCounts.size).toBe(scoped.countProperties.length);
  });

  it('should return same structure as collectTemplatePropertyNamesStructured', () => {
    const template = registerFactory();
    const allGroupIds = template.groups.map(g => g.id);

    // Requesting ALL groups should produce the same result as the full collection
    const scoped = collectTemplatePropertyNamesForGroups(template, allGroupIds);
    const full = collectTemplatePropertyNamesStructured(template);

    expect(new Set(scoped.regularProperties)).toEqual(new Set(full.regularProperties));
    expect(new Set(scoped.countProperties)).toEqual(new Set(full.countProperties));
    expect(scoped.indexedByCount.size).toBe(full.indexedByCount.size);
  });

  it('should handle non-existent group IDs gracefully', () => {
    const template = registerFactory();

    // Non-existent group — should still return first group properties
    const scoped = collectTemplatePropertyNamesForGroups(template, ['nonExistentGroup']);
    const firstOnly = collectTemplatePropertyNamesForGroups(template, [template.groups[0].id]);

    expect(new Set(scoped.regularProperties)).toEqual(new Set(firstOnly.regularProperties));
  });

  it('should preserve count properties and indexedByCount for the scoped group', () => {
    registerInspectorTabs('testCapitolScoped', [
      { tabName: 'General', tabHandler: 'capitolGeneral' },
      { tabName: 'Towns', tabHandler: 'CapitolTowns' },
      { tabName: 'Services', tabHandler: 'townServices' },
      { tabName: 'Votes', tabHandler: 'Votes' },
    ]);
    const template = getTemplateForVisualClass('testCapitolScoped');
    const townsGroupId = template.groups.find(g => g.handlerName === 'CapitolTowns')!.id;

    const scoped = collectTemplatePropertyNamesForGroups(template, [townsGroupId]);

    // CapitolTowns has TownCount as a count property
    expect(scoped.countProperties).toContain('TownCount');
    expect(scoped.indexedByCount.has('TownCount')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The dynamic `set` path — its name set must stay closed and catalogued
// ═══════════════════════════════════════════════════════════════════════════

describe('every property-set mapping names a catalogued RDO member', () => {
  /**
   * `rdoCommands` entries with `command: 'property'` are the only source of
   * member names for the runtime-named `set` in
   * server/session/building-property-handler.ts:188. The name that reaches the
   * wire is `params.propertyName` when the mapping supplies one, otherwise the
   * table key — property-utils.ts:32 spreads `mapping.params` after the key.
   *
   * This is the ratchet that would have caught A-2: the TV slider carried the
   * cache key `Comercials` (one m, TVGeneralSheet.pas:15) into the write, where
   * the published property is `Commercials` (StdBlocks/Broadcast.pas:53). The
   * RTTI lookup missed and the setting silently never landed.
   */
  function emittedSetNames(): Array<{ key: string; emitted: string; groupId: string }> {
    return Object.values(GROUP_BY_ID).flatMap(group =>
      Object.entries(group.rdoCommands ?? {})
        .filter(([, mapping]) => mapping.command === 'property')
        .map(([key, mapping]) => ({
          key,
          emitted: mapping.params?.propertyName ?? key,
          groupId: group.id,
        })),
    );
  }

  it('emits only names RDO_MEMBERS declares settable', () => {
    const offenders = emittedSetNames().filter(({ emitted }) => {
      if (!isCataloguedRdoMember(emitted)) return true;
      const spec = RDO_MEMBERS[emitted];
      // `as const` makes each `access` a literal tuple, so the union's
      // `includes` parameter collapses to `never`. Widen to read it.
      return spec.kind !== 'accessor' || !(spec.access as readonly string[]).includes('set');
    });

    expect(offenders).toEqual([]);
  });

  it('resolves the TV advertising slider to the published Commercials', () => {
    // The read key stays `Comercials` — that is what the cacher returns — and
    // only the write is overridden.
    expect(TV_GENERAL_GROUP.rdoCommands!['Comercials']).toEqual({
      command: 'property',
      params: { propertyName: 'Commercials' },
    });
  });

  it('finds property-set mappings at all — the ratchet must have teeth', () => {
    const names = emittedSetNames();

    expect(names.length).toBeGreaterThanOrEqual(17);
    expect(new Set(names.map(n => n.emitted)).size).toBe(8);
  });
});

/**
 * The gate's data path, not its logic.
 *
 * `grantAccess(tycoonId, details.securityId)` decides every civic control, and
 * `securityId` comes from `allValues`, which holds ONLY what a template declares
 * (building-details-handler.ts:668-685). When the civic general groups did not
 * declare `SecurityId`, the property was never requested, the response carried
 * '' and the gate refused everyone — the mayor of the town included.
 *
 * Component tests could not catch this: they build a BuildingDetailsResponse by
 * hand and set `securityId` on it, bypassing collection entirely.
 */
describe('civic templates request the SecurityId the gate needs', () => {
  beforeEach(() => {
    clearInspectorTabsCache();
  });

  it.each([
    ['capitolGeneral', 'testCapitolSec'],
    ['townGeneral', 'testTownHallSec'],
  ])('%s collects SecurityId', (handler, visualClass) => {
    registerInspectorTabs(visualClass, [{ tabName: 'General', tabHandler: handler }]);

    const collected = collectTemplatePropertyNamesStructured(
      getTemplateForVisualClass(visualClass),
    );

    expect(collected.regularProperties).toContain('SecurityId');
  });

  it.each([
    ['capitolGeneral', CAPITOL_GENERAL_GROUP],
    ['townGeneral', TOWN_GENERAL_GROUP],
  ])('%s declares SecurityId without displaying it', (_id, group) => {
    const prop = group.properties.find((p) => p.rdoName === 'SecurityId');
    expect(prop).toBeDefined();
    // It is an authorisation input, not a figure to show the player.
    expect(prop!.hideEmpty).toBe(true);
  });
});

/**
 * GeneralInfo.inc:9,14,19 — every ordinary facility shows its kind, cluster and
 * town. The kind is a multi-string on the cache: StoreMultiStringToCache appends
 * the language index (Languages.pas:248) and the bare name is commented out
 * (KernelCache.pas:419-420), so the request must be MetaFacilityName0.
 */
describe('ordinary-facility general groups declare kind, cluster and town', () => {
  const ORDINARY_GENERAL_GROUPS = [
    ['IndGeneral', IND_GENERAL_GROUP],
    ['SrvGeneral', SRV_GENERAL_GROUP],
    ['ResGeneral', RES_GENERAL_GROUP],
    ['HqGeneral', HQ_GENERAL_GROUP],
    ['BankGeneral', BANK_GENERAL_GROUP],
    ['WHGeneral', WH_GENERAL_GROUP],
    ['TVGeneral', TV_GENERAL_GROUP],
  ] as const;

  it.each(ORDINARY_GENERAL_GROUPS)('%s declares the three GeneralInfo.inc rows', (_id, group) => {
    const rdoNames = group.properties.map(p => p.rdoName);
    expect(rdoNames).toContain('MetaFacilityName0');
    expect(rdoNames).toContain('Cluster');
    expect(rdoNames).toContain('Town');
  });

  it.each(ORDINARY_GENERAL_GROUPS)('%s requests the kind as MetaFacilityName0, never bare', (_id, group) => {
    const rdoNames = group.properties.map(p => p.rdoName);
    expect(rdoNames).not.toContain('MetaFacilityName');
    const kind = group.properties.find(p => p.rdoName === 'MetaFacilityName0')!;
    expect(kind.type).toBe(PropertyType.TEXT);
    // An empty kind renders no row rather than an empty one.
    expect(kind.hideEmpty).toBe(true);
  });

  it.each(ORDINARY_GENERAL_GROUPS)('%s puts the three rows on the wire as regular reads', (id, _group) => {
    clearInspectorTabsCache();
    registerInspectorTabs(`test580_${id}`, [{ tabName: 'General', tabHandler: id }]);
    const collected = collectTemplatePropertyNamesStructured(getTemplateForVisualClass(`test580_${id}`));
    expect(collected.regularProperties).toContain('MetaFacilityName0');
    expect(collected.regularProperties).toContain('Cluster');
    expect(collected.regularProperties).toContain('Town');
    expect(collected.regularProperties).not.toContain('MetaFacilityName');
  });

  it('none of the three is hidden at render time', () => {
    for (const name of ['MetaFacilityName0', 'Cluster', 'Town']) {
      expect(HIDDEN_PROPERTY_NAMES.has(name)).toBe(false);
    }
  });
});
