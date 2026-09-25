// @ts-nocheck
/**
 * RDO Protocol Tests - Facility SET Command Formats
 *
 * Tests command format correctness for all 11 SET command variants
 * in buildRdoCommandArgs() (building-property-handler.ts).
 *
 * Since buildRdoCommandArgs is private, we replicate the same
 * RdoCommand builder calls and verify output format.
 */

/// <reference path="../matchers/rdo-matchers.d.ts" />

import { describe, it, expect } from '@jest/globals';
import { RdoValue } from '../../../shared/rdo-types';

/**
 * Replicates the private buildRdoCommandArgs logic from spo_session.ts
 * for testability. Mirrors spo_session.ts lines 4795-4886 exactly.
 */
function buildRdoCommandArgs(
  rdoCommand: string,
  value: string,
  additionalParams?: Record<string, string>
): string {
  const params = additionalParams || {};
  const args: RdoValue[] = [];

  switch (rdoCommand) {
    case 'RDOSetPrice': {
      const index = parseInt(params.index || '0', 10);
      const price = parseInt(value, 10);
      args.push(RdoValue.int(index), RdoValue.int(price));
      break;
    }
    case 'RDOSetSalaries': {
      const sal0 = parseInt(params.salary0 || value, 10);
      const sal1 = parseInt(params.salary1 || value, 10);
      const sal2 = parseInt(params.salary2 || value, 10);
      args.push(RdoValue.int(sal0), RdoValue.int(sal1), RdoValue.int(sal2));
      break;
    }
    case 'RDOSetCompanyInputDemand': {
      const index = parseInt(params.index || '0', 10);
      const ratio = parseInt(value, 10);
      args.push(RdoValue.int(index), RdoValue.int(ratio));
      break;
    }
    case 'RDOSetInputMaxPrice': {
      const metaFluid = params.metaFluid;
      if (!metaFluid) throw new Error('RDOSetInputMaxPrice requires metaFluid parameter');
      args.push(RdoValue.int(parseInt(metaFluid, 10)), RdoValue.int(parseInt(value, 10)));
      break;
    }
    case 'RDOSetInputMinK': {
      const metaFluid = params.metaFluid;
      if (!metaFluid) throw new Error('RDOSetInputMinK requires metaFluid parameter');
      args.push(RdoValue.int(parseInt(metaFluid, 10)), RdoValue.int(parseInt(value, 10)));
      break;
    }
    case 'RDOSetTradeLevel':
    case 'RDOSetRole':
    case 'RDOSetLoanPerc': {
      args.push(RdoValue.int(parseInt(value, 10)));
      break;
    }
    case 'RDOSetTaxValue': {
      // Args: TaxId (integer), percentage (widestring)
      // TaxId is resolved from Tax{idx}Id property, passed via params.taxId
      const taxId = parseInt(params.taxId || params.index || '0', 10);
      args.push(RdoValue.int(taxId), RdoValue.string(value));
      break;
    }
    case 'RDOAutoProduce': {
      const boolVal = parseInt(value, 10) !== 0 ? -1 : 0;
      args.push(RdoValue.int(boolVal));
      break;
    }
    case 'RDOLaunchMovie': {
      // MovieStudios.pas — 4th param is word bitmask: flgAutoRelease=$01, flgAutoProduce=$02
      const filmName = params.filmName || '';
      const budget = params.budget || '1000000';
      const months = params.months || '12';
      const autoRelBit = parseInt(params.autoRel || '0', 10) !== 0 ? 1 : 0;
      const autoProdBit = parseInt(params.autoProd || '0', 10) !== 0 ? 1 : 0;
      const autoInfo = autoRelBit | (autoProdBit << 1);
      args.push(
        RdoValue.string(filmName),
        RdoValue.double(parseFloat(budget)),
        RdoValue.int(parseInt(months, 10)),
        RdoValue.int(autoInfo)
      );
      break;
    }
    case 'RDOCancelMovie':
    case 'RDOReleaseMovie': {
      args.push(RdoValue.int(0));
      break;
    }
    case 'RDOSetMinistryBudget': {
      const minId = parseInt(params.ministryId || '0', 10);
      args.push(RdoValue.int(minId), RdoValue.string(value));
      break;
    }
    case 'RDOBanMinister': {
      const minId = parseInt(params.ministryId || '0', 10);
      args.push(RdoValue.int(minId));
      break;
    }
    case 'RDOSitMinister': {
      const minId = parseInt(params.ministryId || '0', 10);
      args.push(RdoValue.int(minId), RdoValue.string(value));
      break;
    }
    case 'RDOSetMinSalaryValue': {
      const levelIndex = params.levelIndex || '0';
      args.push(RdoValue.int(parseInt(levelIndex, 10)), RdoValue.int(parseInt(value, 10)));
      break;
    }
    case 'RDOSelectWare': {
      const index = parseInt(params.index || '0', 10);
      args.push(RdoValue.int(index), RdoValue.int(parseInt(value, 10)));
      break;
    }
    case 'RDOSetWordsOfWisdom': {
      args.push(RdoValue.string(value));
      break;
    }
    case 'RDOCacncelTransc': {
      break;
    }
    case 'RDOVote': {
      const voterName = params.voterName || '';
      args.push(RdoValue.string(voterName), RdoValue.string(value));
      break;
    }
    case 'RDOSetTownTaxes': {
      const index = parseInt(params.index || '0', 10);
      args.push(RdoValue.int(index), RdoValue.int(parseInt(value, 10)));
      break;
    }
    case 'RDOSitMayor': {
      const townName = params.townName || '';
      args.push(RdoValue.string(townName), RdoValue.string(value));
      break;
    }
    case 'RDOSetInputFluidPerc': {
      args.push(RdoValue.int(parseInt(value, 10)));
      break;
    }
    case 'property': {
      args.push(RdoValue.int(parseInt(value, 10)));
      break;
    }
    default:
      args.push(RdoValue.int(parseInt(value, 10)));
      break;
  }

  return args.map(arg => arg.format()).join(',');
}

/**
 * Replicates mapRdoCommandToPropertyName from building-property-handler.ts
 */
function mapRdoCommandToPropertyName(
  rdoCommand: string,
  additionalParams?: Record<string, string>
): string {
  const params = additionalParams || {};

  switch (rdoCommand) {
    case 'RDOSetPrice': return `srvPrices${params.index || '0'}`;
    case 'RDOSetSalaries': return 'Salaries0';
    case 'RDOSetCompanyInputDemand': return `cInputDem${params.index || '0'}`;
    case 'RDOSetInputMaxPrice': return 'MaxPrice';
    case 'RDOSetInputMinK': return 'minK';
    case 'RDOSetTradeLevel': return 'TradeLevel';
    case 'RDOSetRole': return 'Role';
    case 'RDOSetLoanPerc': return 'BudgetPerc';
    case 'RDOSetTaxValue': return `Tax${params.index || '0'}Percent`;
    case 'RDOAutoProduce': return 'AutoProd';
    case 'RDOSelectWare': return 'GateMap';
    case 'RDOSetWordsOfWisdom': return 'WordsOfWisdom';
    case 'RDOCacncelTransc': return 'Transcended';
    case 'RDOVote': return 'RulerVotes';
    case 'RDOSetTownTaxes': return `TownTax${params.index || '0'}`;
    case 'RDOSitMayor': return `HasMayor${params.index || '0'}`;
    case 'RDOSetInputFluidPerc': return 'nfActualMaxFluidValue';
    case 'property': return params.propertyName || rdoCommand;
    default: return rdoCommand.replace('RDOSet', 'srv');
  }
}

/**
 * Build the full RDO command string that setBuildingProperty sends.
 * Mirrors spo_session.ts lines 4747-4755.
 */
function buildFullSetCommand(
  currBlock: string,
  propertyName: string,
  value: string,
  additionalParams?: Record<string, string>
): string {
  const rdoArgs = buildRdoCommandArgs(propertyName, value, additionalParams);

  if (propertyName === 'property' && additionalParams?.propertyName) {
    return `C sel ${currBlock} set ${additionalParams.propertyName}=${rdoArgs};`;
  }
  return `C sel ${currBlock} call ${propertyName} "*" ${rdoArgs};`;
}

describe('Facility SET Command Format (buildRdoCommandArgs)', () => {
  describe('RDOSetPrice', () => {
    it('should format price with index and value as integers', () => {
      const result = buildRdoCommandArgs('RDOSetPrice', '220', { index: '0' });
      expect(result).toBe('"#0","#220"');
    });

    it('should default index to 0 when not specified', () => {
      const result = buildRdoCommandArgs('RDOSetPrice', '150');
      expect(result).toBe('"#0","#150"');
    });

    it('should handle different price indices', () => {
      const result = buildRdoCommandArgs('RDOSetPrice', '300', { index: '2' });
      expect(result).toBe('"#2","#300"');
    });

    it('should handle zero price', () => {
      const result = buildRdoCommandArgs('RDOSetPrice', '0', { index: '0' });
      expect(result).toBe('"#0","#0"');
    });
  });

  describe('RDOSetSalaries', () => {
    it('should format 3 salary values as integers', () => {
      const result = buildRdoCommandArgs('RDOSetSalaries', '100', {
        salary0: '100', salary1: '120', salary2: '150'
      });
      expect(result).toBe('"#100","#120","#150"');
    });

    it('should use main value as fallback when individual salaries not specified', () => {
      const result = buildRdoCommandArgs('RDOSetSalaries', '80');
      expect(result).toBe('"#80","#80","#80"');
    });

    it('should handle zero salaries', () => {
      const result = buildRdoCommandArgs('RDOSetSalaries', '0', {
        salary0: '0', salary1: '0', salary2: '0'
      });
      expect(result).toBe('"#0","#0","#0"');
    });

    it('should handle percentage salary values (150%, 175%, 200%)', () => {
      const result = buildRdoCommandArgs('RDOSetSalaries', '150', {
        salary0: '150', salary1: '175', salary2: '200'
      });
      expect(result).toBe('"#150","#175","#200"');
    });
  });

  describe('RDOSetCompanyInputDemand', () => {
    it('should format index and ratio as integers', () => {
      const result = buildRdoCommandArgs('RDOSetCompanyInputDemand', '75', { index: '0' });
      expect(result).toBe('"#0","#75"');
    });

    it('should default index to 0', () => {
      const result = buildRdoCommandArgs('RDOSetCompanyInputDemand', '50');
      expect(result).toBe('"#0","#50"');
    });
  });

  describe('RDOSetInputMaxPrice', () => {
    it('should format metaFluid and maxPrice as integers', () => {
      const result = buildRdoCommandArgs('RDOSetInputMaxPrice', '500', { metaFluid: '5' });
      expect(result).toBe('"#5","#500"');
    });

    it('should throw when metaFluid is missing', () => {
      expect(() => buildRdoCommandArgs('RDOSetInputMaxPrice', '500'))
        .toThrow('RDOSetInputMaxPrice requires metaFluid parameter');
    });
  });

  describe('RDOSetInputMinK', () => {
    it('should format metaFluid and minK as integers', () => {
      const result = buildRdoCommandArgs('RDOSetInputMinK', '10', { metaFluid: '5' });
      expect(result).toBe('"#5","#10"');
    });

    it('should throw when metaFluid is missing', () => {
      expect(() => buildRdoCommandArgs('RDOSetInputMinK', '10'))
        .toThrow('RDOSetInputMinK requires metaFluid parameter');
    });
  });

  describe('RDOSetTradeLevel', () => {
    it('should format single integer argument', () => {
      const result = buildRdoCommandArgs('RDOSetTradeLevel', '3');
      expect(result).toBe('"#3"');
    });

    it('should handle zero value', () => {
      const result = buildRdoCommandArgs('RDOSetTradeLevel', '0');
      expect(result).toBe('"#0"');
    });
  });

  describe('RDOSetRole', () => {
    it('should format single integer argument', () => {
      const result = buildRdoCommandArgs('RDOSetRole', '2');
      expect(result).toBe('"#2"');
    });
  });

  describe('RDOSetLoanPerc', () => {
    it('should format single integer argument', () => {
      const result = buildRdoCommandArgs('RDOSetLoanPerc', '50');
      expect(result).toBe('"#50"');
    });
  });

  describe('RDOSetTaxValue', () => {
    it('should format taxId (integer) and percentage (string)', () => {
      // Voyager: RDOSetTaxValue(TaxId, valueString) — TaxId from Tax{idx}Id property
      const result = buildRdoCommandArgs('RDOSetTaxValue', '100', { taxId: '110' });
      expect(result).toBe('"#110","%100"');
    });

    it('should handle different tax IDs', () => {
      const result = buildRdoCommandArgs('RDOSetTaxValue', '-50', { taxId: '150' });
      expect(result).toBe('"#150","%-50"');
    });

    it('should fall back to index when taxId not resolved', () => {
      const result = buildRdoCommandArgs('RDOSetTaxValue', '25', { index: '3' });
      expect(result).toBe('"#3","%25"');
    });

    it('should default to 0 when no params', () => {
      const result = buildRdoCommandArgs('RDOSetTaxValue', '15');
      expect(result).toBe('"#0","%15"');
    });
  });

  describe('RDOAutoProduce', () => {
    it('should format true as WordBool #-1', () => {
      const result = buildRdoCommandArgs('RDOAutoProduce', '1');
      expect(result).toBe('"#-1"');
    });

    it('should format false as WordBool #0', () => {
      const result = buildRdoCommandArgs('RDOAutoProduce', '0');
      expect(result).toBe('"#0"');
    });

    it('should treat any non-zero as true', () => {
      const result = buildRdoCommandArgs('RDOAutoProduce', '42');
      expect(result).toBe('"#-1"');
    });
  });

  describe('RDOLaunchMovie (bitmask)', () => {
    it('should encode autoRel=1, autoProd=0 as bitmask #1', () => {
      const result = buildRdoCommandArgs('RDOLaunchMovie', '0', {
        filmName: 'Test Film', budget: '2000000', months: '12',
        autoRel: '1', autoProd: '0',
      });
      expect(result).toBe('"%Test Film","@2000000","#12","#1"');
    });

    it('should encode autoRel=0, autoProd=1 as bitmask #2', () => {
      const result = buildRdoCommandArgs('RDOLaunchMovie', '0', {
        filmName: 'Test Film', budget: '2000000', months: '12',
        autoRel: '0', autoProd: '1',
      });
      expect(result).toBe('"%Test Film","@2000000","#12","#2"');
    });

    it('should encode autoRel=1, autoProd=1 as bitmask #3', () => {
      const result = buildRdoCommandArgs('RDOLaunchMovie', '0', {
        filmName: 'Test Film', budget: '2000000', months: '12',
        autoRel: '1', autoProd: '1',
      });
      expect(result).toBe('"%Test Film","@2000000","#12","#3"');
    });

    it('should encode both off as #0', () => {
      const result = buildRdoCommandArgs('RDOLaunchMovie', '0', {
        filmName: 'Test Film', budget: '2000000', months: '12',
        autoRel: '0', autoProd: '0',
      });
      expect(result).toBe('"%Test Film","@2000000","#12","#0"');
    });

    it('should format budget as double (@) not integer (#)', () => {
      const result = buildRdoCommandArgs('RDOLaunchMovie', '0', {
        filmName: 'Film', budget: '1500000.50', months: '6',
      });
      expect(result).toContain('"@1500000.5"');
    });
  });

  describe('RDOCancelMovie / RDOReleaseMovie', () => {
    it('should format cancel with dummy integer arg', () => {
      const result = buildRdoCommandArgs('RDOCancelMovie', '0');
      expect(result).toBe('"#0"');
    });

    it('should format release with dummy integer arg', () => {
      const result = buildRdoCommandArgs('RDOReleaseMovie', '0');
      expect(result).toBe('"#0"');
    });
  });

  describe('RDOSetMinistryBudget', () => {
    it('should format ministryId as integer and budget as string', () => {
      const result = buildRdoCommandArgs('RDOSetMinistryBudget', '5000000', { ministryId: '2' });
      expect(result).toBe('"#2","%5000000"');
    });
  });

  describe('RDOBanMinister / RDOSitMinister', () => {
    it('should format ban with ministryId integer', () => {
      const result = buildRdoCommandArgs('RDOBanMinister', '0', { ministryId: '3' });
      expect(result).toBe('"#3"');
    });

    it('should format sit with ministryId integer and tycoon name string', () => {
      const result = buildRdoCommandArgs('RDOSitMinister', 'TycoonName', { ministryId: '1' });
      expect(result).toBe('"#1","%TycoonName"');
    });
  });

  describe('RDOSetMinSalaryValue', () => {
    it('should format levelIndex and value as integers', () => {
      const result = buildRdoCommandArgs('RDOSetMinSalaryValue', '80', { levelIndex: '1' });
      expect(result).toBe('"#1","#80"');
    });
  });

  describe('RDOSelectWare', () => {
    it('should format index and value as integers', () => {
      const result = buildRdoCommandArgs('RDOSelectWare', '5', { index: '2' });
      expect(result).toBe('"#2","#5"');
    });
  });

  describe('RDOSetWordsOfWisdom', () => {
    it('should format words as string', () => {
      const result = buildRdoCommandArgs('RDOSetWordsOfWisdom', 'Be wise');
      expect(result).toBe('"%Be wise"');
    });
  });

  describe('RDOCacncelTransc', () => {
    it('should have no args (void)', () => {
      const result = buildRdoCommandArgs('RDOCacncelTransc', '');
      expect(result).toBe('');
    });
  });

  describe('RDOVote', () => {
    it('should format voterName and voteeName as strings', () => {
      const result = buildRdoCommandArgs('RDOVote', 'CandidateA', { voterName: 'VoterX' });
      expect(result).toBe('"%VoterX","%CandidateA"');
    });
  });

  describe('RDOSetTownTaxes', () => {
    it('should format index and value as integers', () => {
      const result = buildRdoCommandArgs('RDOSetTownTaxes', '15', { index: '2' });
      expect(result).toBe('"#2","#15"');
    });
  });

  describe('RDOSitMayor', () => {
    it('should format townName and tycoonName as strings', () => {
      const result = buildRdoCommandArgs('RDOSitMayor', 'TycoonY', { townName: 'TownX' });
      expect(result).toBe('"%TownX","%TycoonY"');
    });
  });

  describe('RDOSetInputFluidPerc', () => {
    it('should format perc as integer', () => {
      const result = buildRdoCommandArgs('RDOSetInputFluidPerc', '75');
      expect(result).toBe('"#75"');
    });
  });

  describe('Direct property SET', () => {
    it('should format integer value for property type', () => {
      const result = buildRdoCommandArgs('property', '42');
      expect(result).toBe('"#42"');
    });

    it('should handle zero value', () => {
      const result = buildRdoCommandArgs('property', '0');
      expect(result).toBe('"#0"');
    });

    it('should handle negative values', () => {
      const result = buildRdoCommandArgs('property', '-1');
      expect(result).toBe('"#-1"');
    });
  });

  describe('Default fallback', () => {
    it('should format unknown commands as single integer', () => {
      const result = buildRdoCommandArgs('UnknownCommand', '99');
      expect(result).toBe('"#99"');
    });
  });

  describe('Edge cases', () => {
    it('should handle large integer values', () => {
      const result = buildRdoCommandArgs('RDOSetPrice', '999999999', { index: '0' });
      expect(result).toBe('"#0","#999999999"');
    });

    it('should handle negative price values', () => {
      const result = buildRdoCommandArgs('RDOSetPrice', '-100', { index: '0' });
      expect(result).toBe('"#0","#-100"');
    });

    it('should floor non-integer values via parseInt', () => {
      // parseInt('3.7', 10) → 3 (truncates, doesn't round)
      const result = buildRdoCommandArgs('RDOSetTradeLevel', '3.7');
      expect(result).toBe('"#3"');
    });
  });
});

describe('Full SET Command String (setBuildingProperty format)', () => {
  const BUILDING_BLOCK = '100575368';

  it('should build RDO call command for RDOSetPrice', () => {
    const cmd = buildFullSetCommand(BUILDING_BLOCK, 'RDOSetPrice', '220', { index: '0' });
    expect(cmd).toBe(`C sel ${BUILDING_BLOCK} call RDOSetPrice "*" "#0","#220";`);
  });

  it('should build RDO call command for RDOSetSalaries', () => {
    const cmd = buildFullSetCommand(BUILDING_BLOCK, 'RDOSetSalaries', '100', {
      salary0: '100', salary1: '120', salary2: '150'
    });
    expect(cmd).toBe(`C sel ${BUILDING_BLOCK} call RDOSetSalaries "*" "#100","#120","#150";`);
  });

  it('should build SET verb for direct property', () => {
    const cmd = buildFullSetCommand(BUILDING_BLOCK, 'property', '42', {
      propertyName: 'TradeLevel'
    });
    expect(cmd).toBe(`C sel ${BUILDING_BLOCK} set TradeLevel="#42";`);
  });

  it('should build RDO call for boolean commands', () => {
    const cmd = buildFullSetCommand(BUILDING_BLOCK, 'RDOAutoProduce', '1');
    expect(cmd).toBe(`C sel ${BUILDING_BLOCK} call RDOAutoProduce "*" "#-1";`);
  });

  it('should use push separator (*) for all call commands', () => {
    const cmd = buildFullSetCommand(BUILDING_BLOCK, 'RDOSetTradeLevel', '3');
    expect(cmd).toContain('"*"');
    expect(cmd).not.toContain('"^"');
  });
});

describe('mapRdoCommandToPropertyName', () => {
  it('should map RDOSetPrice to srvPrices{index}', () => {
    expect(mapRdoCommandToPropertyName('RDOSetPrice', { index: '0' })).toBe('srvPrices0');
    expect(mapRdoCommandToPropertyName('RDOSetPrice', { index: '3' })).toBe('srvPrices3');
  });

  it('should map RDOSetSalaries to Salaries0', () => {
    expect(mapRdoCommandToPropertyName('RDOSetSalaries')).toBe('Salaries0');
  });

  it('should map RDOSetCompanyInputDemand to cInputDem{index}', () => {
    expect(mapRdoCommandToPropertyName('RDOSetCompanyInputDemand', { index: '2' })).toBe('cInputDem2');
  });

  it('should map RDOSetInputMaxPrice to MaxPrice', () => {
    expect(mapRdoCommandToPropertyName('RDOSetInputMaxPrice')).toBe('MaxPrice');
  });

  it('should map RDOSetInputMinK to minK', () => {
    expect(mapRdoCommandToPropertyName('RDOSetInputMinK')).toBe('minK');
  });

  it('should map RDOSetTradeLevel to TradeLevel', () => {
    expect(mapRdoCommandToPropertyName('RDOSetTradeLevel')).toBe('TradeLevel');
  });

  it('should map RDOSetRole to Role', () => {
    expect(mapRdoCommandToPropertyName('RDOSetRole')).toBe('Role');
  });

  it('should map RDOSetLoanPerc to BudgetPerc', () => {
    expect(mapRdoCommandToPropertyName('RDOSetLoanPerc')).toBe('BudgetPerc');
  });

  it('should map RDOSetTaxValue to Tax{index}Percent', () => {
    expect(mapRdoCommandToPropertyName('RDOSetTaxValue', { index: '0' })).toBe('Tax0Percent');
    expect(mapRdoCommandToPropertyName('RDOSetTaxValue', { index: '2' })).toBe('Tax2Percent');
  });

  it('should map RDOAutoProduce to AutoProd', () => {
    expect(mapRdoCommandToPropertyName('RDOAutoProduce')).toBe('AutoProd');
  });

  it('should map RDOSelectWare to GateMap', () => {
    expect(mapRdoCommandToPropertyName('RDOSelectWare')).toBe('GateMap');
  });

  it('should map RDOSetWordsOfWisdom to WordsOfWisdom', () => {
    expect(mapRdoCommandToPropertyName('RDOSetWordsOfWisdom')).toBe('WordsOfWisdom');
  });

  it('should map RDOCacncelTransc to Transcended', () => {
    expect(mapRdoCommandToPropertyName('RDOCacncelTransc')).toBe('Transcended');
  });

  it('should map RDOVote to RulerVotes', () => {
    expect(mapRdoCommandToPropertyName('RDOVote')).toBe('RulerVotes');
  });

  it('should map RDOSetTownTaxes to TownTax{index}', () => {
    expect(mapRdoCommandToPropertyName('RDOSetTownTaxes', { index: '0' })).toBe('TownTax0');
    expect(mapRdoCommandToPropertyName('RDOSetTownTaxes', { index: '3' })).toBe('TownTax3');
  });

  it('should map RDOSitMayor to HasMayor{index}', () => {
    expect(mapRdoCommandToPropertyName('RDOSitMayor', { index: '1' })).toBe('HasMayor1');
  });

  it('should map RDOSetInputFluidPerc to nfActualMaxFluidValue', () => {
    expect(mapRdoCommandToPropertyName('RDOSetInputFluidPerc')).toBe('nfActualMaxFluidValue');
  });

  it('should map property to additionalParams.propertyName', () => {
    expect(mapRdoCommandToPropertyName('property', { propertyName: 'CustomProp' })).toBe('CustomProp');
  });

  it('should fallback property to "property" when no propertyName param', () => {
    expect(mapRdoCommandToPropertyName('property')).toBe('property');
  });

  it('should use fallback for unknown commands (strip RDOSet prefix)', () => {
    expect(mapRdoCommandToPropertyName('RDOSetCustomThing')).toBe('srvCustomThing');
  });
});

describe('RdoValue format verification', () => {
  it('should format integers with # prefix', () => {
    expect(RdoValue.int(42).format()).toBe('"#42"');
    expect(RdoValue.int(0).format()).toBe('"#0"');
    expect(RdoValue.int(-1).format()).toBe('"#-1"');
  });

  it('should format OLE strings with % prefix', () => {
    expect(RdoValue.string('hello').format()).toBe('"%hello"');
    expect(RdoValue.string('').format()).toBe('"%"');
  });

  it('should format floats with ! prefix', () => {
    expect(RdoValue.float(3.14).format()).toBe('"!3.14"');
  });

  it('should format doubles with @ prefix', () => {
    expect(RdoValue.double(3.14159).format()).toBe('"@3.14159"');
  });

  it('should format void as * prefix', () => {
    expect(RdoValue.void().format()).toBe('"*"');
  });

  it('should floor integer values', () => {
    expect(RdoValue.int(3.9).format()).toBe('"#3"');
    expect(RdoValue.int(7.1).format()).toBe('"#7"');
  });
});
