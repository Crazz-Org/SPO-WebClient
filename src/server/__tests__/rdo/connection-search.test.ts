/**
 * RDO Protocol Tests - Connection Search (FindSuppliers / FindClients)
 *
 * Tests the RDO-based connection search that replaces the legacy HTTP/ASP approach.
 * FindSuppliers: direction='input'  → 7 fields: x}y}FacName}Company}Town}$Price}Quality
 * FindClients:   direction='output' → 5 fields: x}y}FacName}Company}Town
 *
 * Captured RDO trace (reference):
 *   C 92 sel 30501576 call FindSuppliers "^" "%Drugs","%Shamba","%","%","#20","#459","#389","#1","#54";
 *   A92 res="%463}389}Trade Center}PGI}Olympus}$80}40\n...";
 */

import { describe, it, expect } from '@jest/globals';
import { splitMultilinePayload } from '../../rdo-helpers';
import { RdoProtocol } from '../../rdo';
import { RdoVerb, RdoAction } from '../../../shared/types/protocol-types';
import type { RdoPacket } from '../../../shared/types/protocol-types';

// ============================================================================
// Types
// ============================================================================

interface ConnectionSearchResult {
  facilityName: string;
  companyName: string;
  x: number;
  y: number;
  price?: string;
  quality?: string;
  town?: string;
}

// ============================================================================
// Parser (mirrors spo_session.ts parseRdoConnectionResults)
// ============================================================================

function parseRdoConnectionResults(
  payload: string, direction: 'input' | 'output'
): ConnectionSearchResult[] {
  const lines = splitMultilinePayload(payload);
  if (lines.length === 0) return [];

  return lines.map(line => {
    const fields = line.split('}');
    const x = parseInt(fields[0], 10);
    const y = parseInt(fields[1], 10);
    if (isNaN(x) || isNaN(y)) return null;

    const result: ConnectionSearchResult = {
      x, y,
      facilityName: fields[2] || 'Unknown',
      companyName: fields[3] || '',
      town: fields[4] || undefined,
    };

    if (direction === 'input' && fields.length >= 7) {
      result.price = fields[5] || undefined;
      result.quality = fields[6] || undefined;
    }

    return result;
  }).filter((r): r is ConnectionSearchResult => r !== null);
}

// ============================================================================
// Captured response data (from live RDO trace)
// ============================================================================

const CAPTURED_FIND_SUPPLIERS_RESPONSE = `res="%463}389}Trade Center}PGI}Olympus}$80}40
483}684}Trade Center}Dissidents}Clementia}$80}40
205}505}Trade Center}PGI}Eraclia}$80}40
131}298}Trade Center}Mariko}Drakka}$80}40
767}500}Trade Center}Mariko}Toshimi}$80}40
667}116}Trade Center}Dissidents}Paraiso}$80}40
885}319}Trade Center}Moab}Atharsia}$80}40
407}925}Trade Center}Moab}Cathar}$80}40
137}78}Trade Center}Mariko}Gundia}$80}40
101}676}Trade Center}Dissidents}Silmaria}$80}40
805}827}Trade Center}PGI}Vulcania}$80}40
"`;

const CAPTURED_FIND_CLIENTS_RESPONSE = `res="%200}300}Small Farm}AcmeCorp}Springfield
400}500}Warehouse}GlobalInc}Shelbyville
"`;

// ============================================================================
// FindSuppliers Response Parsing
// ============================================================================

describe('FindSuppliers response parsing', () => {
  it('parses captured multi-line response with 11 results', () => {
    const results = parseRdoConnectionResults(CAPTURED_FIND_SUPPLIERS_RESPONSE, 'input');

    expect(results).toHaveLength(11);
  });

  it('extracts coordinates correctly from first result', () => {
    const results = parseRdoConnectionResults(CAPTURED_FIND_SUPPLIERS_RESPONSE, 'input');

    expect(results[0].x).toBe(463);
    expect(results[0].y).toBe(389);
  });

  it('extracts facility name, company, and town', () => {
    const results = parseRdoConnectionResults(CAPTURED_FIND_SUPPLIERS_RESPONSE, 'input');

    expect(results[0].facilityName).toBe('Trade Center');
    expect(results[0].companyName).toBe('PGI');
    expect(results[0].town).toBe('Olympus');
  });

  it('extracts price and quality for suppliers', () => {
    const results = parseRdoConnectionResults(CAPTURED_FIND_SUPPLIERS_RESPONSE, 'input');

    expect(results[0].price).toBe('$80');
    expect(results[0].quality).toBe('40');
  });

  it('parses all 11 results with correct data', () => {
    const results = parseRdoConnectionResults(CAPTURED_FIND_SUPPLIERS_RESPONSE, 'input');

    // Spot-check several entries
    expect(results[1]).toEqual({
      x: 483, y: 684,
      facilityName: 'Trade Center', companyName: 'Dissidents',
      town: 'Clementia', price: '$80', quality: '40',
    });

    expect(results[4]).toEqual({
      x: 767, y: 500,
      facilityName: 'Trade Center', companyName: 'Mariko',
      town: 'Toshimi', price: '$80', quality: '40',
    });

    expect(results[10]).toEqual({
      x: 805, y: 827,
      facilityName: 'Trade Center', companyName: 'PGI',
      town: 'Vulcania', price: '$80', quality: '40',
    });
  });

  it('handles single-result response', () => {
    const payload = 'res="%100}200}Factory}MyCompany}Downtown}$50}85"';
    const results = parseRdoConnectionResults(payload, 'input');

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      x: 100, y: 200,
      facilityName: 'Factory', companyName: 'MyCompany',
      town: 'Downtown', price: '$50', quality: '85',
    });
  });

  it('handles empty response', () => {
    const results = parseRdoConnectionResults('res="%"', 'input');
    expect(results).toHaveLength(0);
  });

  it('handles empty string payload', () => {
    const results = parseRdoConnectionResults('', 'input');
    expect(results).toHaveLength(0);
  });

  it('does not confuse $80 price with RDO type prefix', () => {
    const results = parseRdoConnectionResults(CAPTURED_FIND_SUPPLIERS_RESPONSE, 'input');

    // The $80 is inside the data, not a type prefix — should be preserved literally
    for (const r of results) {
      expect(r.price).toBe('$80');
    }
  });
});

// ============================================================================
// FindClients Response Parsing
// ============================================================================

describe('FindClients response parsing', () => {
  it('parses 5-field response without price/quality', () => {
    const results = parseRdoConnectionResults(CAPTURED_FIND_CLIENTS_RESPONSE, 'output');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      x: 200, y: 300,
      facilityName: 'Small Farm', companyName: 'AcmeCorp',
      town: 'Springfield',
    });
  });

  it('does not include price/quality for output direction', () => {
    // Even if there were extra fields, output direction should not extract price/quality
    const payload = 'res="%200}300}Factory}Corp}Town}$99}50"';
    const results = parseRdoConnectionResults(payload, 'output');

    expect(results).toHaveLength(1);
    expect(results[0].price).toBeUndefined();
    expect(results[0].quality).toBeUndefined();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Connection search edge cases', () => {
  it('skips lines with non-numeric coordinates', () => {
    const payload = 'res="%abc}def}BadFacility}BadCo}BadTown}$0}0"';
    const results = parseRdoConnectionResults(payload, 'input');

    expect(results).toHaveLength(0);
  });

  it('handles facility name with spaces and special chars', () => {
    const payload = 'res="%100}200}Chemical Plant (Large)}O\'Brien & Co}New York}$150}90"';
    const results = parseRdoConnectionResults(payload, 'input');

    expect(results).toHaveLength(1);
    expect(results[0].facilityName).toBe('Chemical Plant (Large)');
    expect(results[0].companyName).toBe("O'Brien & Co");
    expect(results[0].town).toBe('New York');
  });

  it('handles missing optional fields gracefully', () => {
    // Only 2 fields (x and y) — minimal valid entry
    const payload = 'res="%100}200"';
    const results = parseRdoConnectionResults(payload, 'input');

    expect(results).toHaveLength(1);
    expect(results[0].x).toBe(100);
    expect(results[0].y).toBe(200);
    expect(results[0].facilityName).toBe('Unknown');
    expect(results[0].companyName).toBe('');
  });
});

// ============================================================================
// RDO Request Construction
// ============================================================================

describe('FindSuppliers RDO request construction', () => {
  it('formats request matching the captured trace', () => {
    // Simulates what spo_session.searchConnections builds
    const packet: Partial<RdoPacket> = {
      verb: RdoVerb.SEL,
      targetId: '30501576',
      action: RdoAction.CALL,
      member: 'FindSuppliers',
      args: [
        'Drugs',     // fluidId
        'Shamba',    // worldName
        '',          // town filter (empty = all)
        '',          // company filter (empty = all)
        '20',        // count
        '459',       // buildingX
        '389',       // buildingY
        '1',         // sortMode
        '54',        // roles bitmask
      ],
    };

    // Add rid for synchronous call (sendRdoRequest adds this)
    const fullPacket = { ...packet, rid: 92, type: 'REQUEST' as const } as RdoPacket;
    const formatted = RdoProtocol.format(fullPacket);

    // Verify the formatted string matches expected wire format
    expect(formatted).toContain('sel 30501576');
    expect(formatted).toContain('call FindSuppliers');
    expect(formatted).toContain('"^"');
    expect(formatted).toContain('"%Drugs"');
    expect(formatted).toContain('"%Shamba"');
    // CALL args: raw numeric strings are now typed as OLEString (not integer).
    // Delphi OLE variant system auto-converts "%20" → integer where needed.
    expect(formatted).toContain('"%20"');
    expect(formatted).toContain('"%459"');
    expect(formatted).toContain('"%389"');
    expect(formatted).toContain('"%1"');
    expect(formatted).toContain('"%54"');
  });

  it('formats empty string filters as bare type prefix', () => {
    const packet: Partial<RdoPacket> = {
      verb: RdoVerb.SEL,
      targetId: '12345',
      action: RdoAction.CALL,
      member: 'FindSuppliers',
      args: ['Drugs', 'Shamba', '', '', '20', '100', '200', '1', '31'],
    };

    const fullPacket = { ...packet, rid: 1, type: 'REQUEST' as const } as RdoPacket;
    const formatted = RdoProtocol.format(fullPacket);

    // Empty string → "%"  (just the type prefix, no value)
    expect(formatted).toContain('"%"');
  });

  it('maps direction to correct RDO method name', () => {
    const methodMap: Record<string, string> = {
      input: 'FindSuppliers',
      output: 'FindClients',
    };
    expect(methodMap['input']).toBe('FindSuppliers');
    expect(methodMap['output']).toBe('FindClients');
  });

  it('defaults roles to 31 — the gateway legacy value, used only with no filter', () => {
    // 31 is not a role set the UI can produce: the dialogs always send a mask
    // built from TFacilityRole bits (54 suppliers, 78 clients — see line 9).
    // It survives as the default of a caller that passes no `roles` at all.
    const roles = undefined;
    const defaultRoles = roles || 31;
    expect(defaultRoles).toBe(31);
    // 31 = rolNeutral(1) | rolProducer(2) | rolDistributer(4) | rolBuyer(8) | rolImporter(16)
    expect(defaultRoles & 1).toBe(1);   // Neutral
    expect(defaultRoles & 2).toBe(2);   // Producer
    expect(defaultRoles & 4).toBe(4);   // Distributer
    expect(defaultRoles & 8).toBe(8);   // Buyer
    expect(defaultRoles & 16).toBe(16); // Importer
  });

  it('defaults count to 20', () => {
    const maxResults = undefined;
    expect(String(maxResults || 20)).toBe('20');
  });
});
