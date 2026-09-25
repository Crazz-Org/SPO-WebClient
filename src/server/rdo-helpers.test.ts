/**
 * Unit Tests for RDO Helpers
 * Tests for cleanPayload, parsePropertyResponse, and related utilities
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { Socket } from 'net';
import {
  cleanPayload,
  splitMultilinePayload,
  parsePropertyResponse,
  parseIdOfResponse,
  writeRdoFrame,
  tagRdoSocket,
  getRdoSocketTag,
  redactSensitiveRdoFrame,
  extractRevenue,
  isTrueOrdinal,
  parseResultCode,
} from './rdo-helpers';
import {
  getPropertyFallbackCensus,
  resetPropertyFallbackCensus,
} from './session/property-fallback-census';

describe('writeRdoFrame', () => {
  /** Capture what writeRdoFrame hands to socket.write. */
  function mockSocket(): { socket: Socket; written: Buffer[] } {
    const written: Buffer[] = [];
    const socket = {
      write: jest.fn((data: Buffer) => {
        written.push(data);
        return true;
      }),
    } as unknown as Socket;
    return { socket, written };
  }

  it('writes a Buffer, never a raw string', () => {
    const { socket, written } = mockSocket();
    writeRdoFrame(socket, 'C sel 42 get Name;');
    expect(written).toHaveLength(1);
    expect(Buffer.isBuffer(written[0])).toBe(true);
  });

  it('encodes ASCII identically to UTF-8 (no behavior change for plain frames)', () => {
    const { socket, written } = mockSocket();
    const frame = 'C 17 sel 42 call RDOSetPrice "^" "#5","@3.14";';
    writeRdoFrame(socket, frame);
    expect(written[0].equals(Buffer.from(frame, 'utf8'))).toBe(true);
  });

  it('encodes accented characters as single Latin-1 bytes (Delphi ANSI wire)', () => {
    const { socket, written } = mockSocket();
    writeRdoFrame(socket, 'é');
    // Latin-1: 'é' = 0xE9 (one byte). UTF-8 would be 0xC3 0xA9 (two bytes).
    expect(written[0].length).toBe(1);
    expect(written[0][0]).toBe(0xe9);
  });

  it('encodes a full accented chat frame in Latin-1', () => {
    const { socket, written } = mockSocket();
    const frame = 'C sel 42 call SayThis "*" "%","%Bonjour à l\'été";';
    writeRdoFrame(socket, frame);
    const bytes = written[0];
    expect(bytes.length).toBe(frame.length); // 1 byte per char — no UTF-8 expansion
    expect(bytes[frame.indexOf('à')]).toBe(0xe0);
    expect(bytes[frame.indexOf('é')]).toBe(0xe9);
  });

  it('returns the socket.write() backpressure result', () => {
    const written: Buffer[] = [];
    const socket = {
      write: jest.fn((data: Buffer) => {
        written.push(data);
        return false;
      }),
    } as unknown as Socket;
    expect(writeRdoFrame(socket, 'C sel 1 get X;')).toBe(false);
  });

  it('still writes the frame when alreadyLogged is true (tap skip must not skip the write)', () => {
    const { socket, written } = mockSocket();
    writeRdoFrame(socket, 'C 3 sel 42 get Name;', true);
    expect(written).toHaveLength(1);
    expect(written[0].toString('latin1')).toBe('C 3 sel 42 get Name;');
  });
});

describe('tagRdoSocket / getRdoSocketTag', () => {
  it('returns the tag set for a socket', () => {
    const socket = { write: jest.fn() } as unknown as Socket;
    tagRdoSocket(socket, 'world');
    expect(getRdoSocketTag(socket)).toBe('world');
  });

  it('returns "untagged" for unknown sockets', () => {
    const socket = { write: jest.fn() } as unknown as Socket;
    expect(getRdoSocketTag(socket)).toBe('untagged');
  });

  it('re-tagging overwrites the previous tag', () => {
    const socket = { write: jest.fn() } as unknown as Socket;
    tagRdoSocket(socket, 'mail');
    tagRdoSocket(socket, 'world');
    expect(getRdoSocketTag(socket)).toBe('world');
  });
});

describe('redactSensitiveRdoFrame', () => {
  it('redacts the trailing password of RDOLogonUser frames', () => {
    const frame = 'C 3 sel 142217260 call RDOLogonUser "^" "%SPO_test3","%test3"';
    expect(redactSensitiveRdoFrame(frame)).toBe(
      'C 3 sel 142217260 call RDOLogonUser "^" "%SPO_test3","%[REDACTED]"'
    );
  });

  it('redacts Logon frames with trailing delimiter', () => {
    const frame = 'C 7 sel 8161308 call Logon "^" "%SPO_test3","%test3";';
    expect(redactSensitiveRdoFrame(frame)).toBe(
      'C 7 sel 8161308 call Logon "^" "%SPO_test3","%[REDACTED]";'
    );
  });

  it('redacts AccountStatus and RDOLogonClient frames', () => {
    expect(
      redactSensitiveRdoFrame('C 5 sel 1 call AccountStatus "^" "%user","%secret"')
    ).toContain('%[REDACTED]');
    expect(
      redactSensitiveRdoFrame('C 6 sel 1 call RDOLogonClient "^" "%user","%secret"')
    ).toContain('%[REDACTED]');
  });

  it('leaves non-sensitive frames untouched', () => {
    const frame = 'C sel 42 call SayThis "*" "%","%Bonjour à l\'été";';
    expect(redactSensitiveRdoFrame(frame)).toBe(frame);
  });

  it('does not redact members that merely contain a sensitive name', () => {
    const frame = 'C 4 sel 42 call GetLogonHistory "^" "%user","%data"';
    expect(redactSensitiveRdoFrame(frame)).toBe(frame);
  });
});

describe('cleanPayload', () => {
  it('should clean res="..." format', () => {
    expect(cleanPayload('res="#6805584"')).toBe('6805584');
  });

  it('should clean res="%" (empty string)', () => {
    expect(cleanPayload('res="%"')).toBe('');
  });

  it('should remove outer quotes and type prefix', () => {
    expect(cleanPayload('"#42"')).toBe('42');
    expect(cleanPayload('"%hello"')).toBe('hello');
  });

  it('should handle plain values', () => {
    expect(cleanPayload('42')).toBe('42');
    expect(cleanPayload('hello')).toBe('hello');
  });

  it('should trim whitespace', () => {
    expect(cleanPayload('  res="#99"  ')).toBe('99');
  });

  it('should handle doubled quotes in res="..." (Delphi convention)', () => {
    expect(cleanPayload('res="%Hello ""World"""')).toBe('Hello "World"');
  });

  it('should strip all 7 type prefixes', () => {
    expect(cleanPayload('"#42"')).toBe('42');
    expect(cleanPayload('"%str"')).toBe('str');
    expect(cleanPayload('"@3.14"')).toBe('3.14');
    expect(cleanPayload('"$id"')).toBe('id');
    expect(cleanPayload('"^var"')).toBe('var');
    expect(cleanPayload('"!3.14"')).toBe('3.14');
    expect(cleanPayload('"*"')).toBe('');
  });

  // --- REGRESSION GUARDS for .trim() ---
  // cleanPayload has two .trim() calls: initial (strips outer whitespace so
  // the res= regex can match) and final (strips residual whitespace after
  // prefix removal). Both are load-bearing. These tests FAIL if either is
  // removed, preventing silent regressions on tab-delimited RDO data.

  describe('initial .trim() regression (line 12)', () => {
    it('tabs around res= format must be stripped for regex match', () => {
      expect(cleanPayload('\tres="%hello"\t')).toBe('hello');
    });

    it('newlines around quoted value must be stripped', () => {
      expect(cleanPayload('\n"#42"\n')).toBe('42');
    });

    it('mixed whitespace around res= format', () => {
      expect(cleanPayload(' \t res="#5" \n ')).toBe('5');
    });
  });

  describe('final .trim() regression (line 30)', () => {
    it('space after % prefix inside res= must be trimmed', () => {
      expect(cleanPayload('res="% value "')).toBe('value');
    });

    it('spaces around number inside res= must be trimmed', () => {
      expect(cleanPayload('res="# 42 "')).toBe('42');
    });
  });

  describe('tab-boundary behavior (documents known trade-off)', () => {
    // cleanPayload's final .trim() strips trailing tabs. This is why
    // cacherGetPropertyList in spo_session.ts inlines its own extraction for GetPropertyList
    // where positional alignment of tab-delimited values is critical.

    it('trailing tab is stripped — tab-split yields fewer elements', () => {
      const cleaned = cleanPayload('res="%A\tB\t"');
      expect(cleaned).toBe('A\tB');
      expect(cleaned.split('\t')).toEqual(['A', 'B']);
    });

    it('leading tab after prefix is stripped — first empty value lost', () => {
      const cleaned = cleanPayload('res="%\tvalue"');
      expect(cleaned).toBe('value');
      expect(cleaned.split('\t')).toEqual(['value']);
    });
  });

  describe('edge cases that must stay stable', () => {
    it('empty string returns empty', () => {
      expect(cleanPayload('')).toBe('');
    });

    it('whitespace-only returns empty', () => {
      expect(cleanPayload('   ')).toBe('');
    });

    it('tab-only returns empty', () => {
      expect(cleanPayload('\t\t')).toBe('');
    });

    it('bare type prefix returns empty', () => {
      expect(cleanPayload('#')).toBe('');
    });

    it('bare newline returns empty', () => {
      expect(cleanPayload('\n')).toBe('');
    });
  });
});

describe('parsePropertyResponse', () => {
  it('should extract Property="value" format', () => {
    expect(parsePropertyResponse('RDOOpenSession="#142217260"', 'RDOOpenSession')).toBe('142217260');
  });

  it('should extract res="value" via fallback', () => {
    expect(parsePropertyResponse('res="#42"', 'SomeProp')).toBe('42');
  });

  it('should handle doubled quotes in property values', () => {
    expect(parsePropertyResponse('Name="%Build ""Project"""', 'Name')).toBe('Build "Project"');
  });

  it('should handle payload starting with property name', () => {
    expect(parsePropertyResponse('Count="#5"', 'Count')).toBe('5');
  });
});

describe('parseIdOfResponse', () => {
  it('should extract objid="value"', () => {
    expect(parseIdOfResponse('objid="39751288"')).toBe('39751288');
  });

  it('should strip # prefix from objid', () => {
    expect(parseIdOfResponse('objid="#39751288"')).toBe('39751288');
  });

  it('should throw on empty/undefined', () => {
    expect(() => parseIdOfResponse(undefined)).toThrow('Empty idof response');
  });
});


describe('GetPropertyList empty-value pipeline', () => {
  // Regression: empty values (consecutive tabs) must survive cleanPayload + split
  // so that allValues.set() stores '' and does not shift downstream indices.
  // Bug: guard `if (value && ...)` dropped empty strings; fixed to `if (value !== 'error')`.

  it('preserves empty value in the middle of a tab-separated response', () => {
    // Mirrors: A26024 res="%SPO_test3\t29\t\t-134478120-\t...\t-1\t"
    const raw = cleanPayload('res="%SPO_test3\t29\t\t-134478120-\t32\t-1\t"');
    const values = raw.includes('\t') ? raw.split('\t').map(v => v.trim()) : raw.split(/\s+/);
    // Index 2 (Name) must be empty string, not undefined or skipped
    expect(values[2]).toBe('');
    expect(values.length).toBe(6); // trailing tab trimmed by cleanPayload → 6 elements
  });

  it('empty string is NOT filtered by value !== "error" guard', () => {
    const value: string = '';
    expect(value !== 'error').toBe(true);
  });

  it('"error" string IS filtered by value !== "error" guard', () => {
    const value: string = 'error';
    expect(value !== 'error').toBe(false);
  });
});

describe('GetPropertyList tab-split response parsing', () => {
  // Simulates cacherGetPropertyList parsing: cleanPayload + tab-split
  function parsePropertyListResponse(rawPayload: string): string[] {
    const raw = cleanPayload(rawPayload);
    return raw.split('\t').map(v => v.trim());
  }

  it('should split tab-delimited values correctly', () => {
    const result = parsePropertyListResponse('res="%Bars\tBooks\tCars"');
    expect(result).toEqual(['Bars', 'Books', 'Cars']);
  });

  it('should preserve multi-word values (not split by spaces)', () => {
    const result = parsePropertyListResponse('res="%Processed Food\tFresh Food\tHousehold Appliances"');
    expect(result).toEqual(['Processed Food', 'Fresh Food', 'Household Appliances']);
  });

  it('should preserve empty strings between tabs', () => {
    const result = parsePropertyListResponse('res="%value1\t\tvalue3"');
    expect(result).toEqual(['value1', '', 'value3']);
  });

  it('should handle all-empty tab-delimited response', () => {
    // cleanPayload trims trailing whitespace, so trailing tabs are stripped.
    // The server sends tab-separated empty values; after cleanPayload,
    // only the inner tabs survive → fewer elements than requested.
    // The caller (cacherGetPropertyList) handles this via the length warning.
    const result = parsePropertyListResponse('res="%\t\t\t"');
    expect(result).toEqual(['']);
  });

  it('should handle single value (no tabs)', () => {
    const result = parsePropertyListResponse('res="%42"');
    expect(result).toEqual(['42']);
  });

  it('should handle trailing tab (trimmed by cleanPayload)', () => {
    // cleanPayload trims the payload, which removes the trailing tab.
    // So "Bars\tBooks\t" becomes "Bars\tBooks" after trim → 2 elements.
    const result = parsePropertyListResponse('res="%Bars\tBooks\t"');
    expect(result).toEqual(['Bars', 'Books']);
  });

  it('should handle float values correctly', () => {
    const result = parsePropertyListResponse('res="%21.417142868042\t1.47142863273621\t0.0366818867623806"');
    expect(result).toEqual(['21.417142868042', '1.47142863273621', '0.0366818867623806']);
  });
});

describe('splitMultilinePayload', () => {
  it('should split and trim lines', () => {
    const result = splitMultilinePayload('res="%Line1\nLine2\nLine3"');
    expect(result).toEqual(['Line1', 'Line2', 'Line3']);
  });

  it('should filter empty lines', () => {
    const result = splitMultilinePayload('res="%A\n\nB"');
    expect(result).toEqual(['A', 'B']);
  });
});

describe('extractRevenue', () => {
  // Facility list lines carry the hourly balance in parentheses; the sign is
  // what tells a profitable plant from one bleeding money.
  it('extracts a positive amount and drops the parentheses', () => {
    expect(extractRevenue('Bakery ($26,564/h)')).toBe('$26,564/h');
  });

  it('keeps the minus sign of a loss', () => {
    expect(extractRevenue('Foundry (-$39,127/h)')).toBe('-$39,127/h');
    expect(extractRevenue('Silo (-$28,858/h)')).toBe('-$28,858/h');
  });

  it('matches an amount that is not parenthesised', () => {
    expect(extractRevenue('balance $1,000/h now')).toBe('$1,000/h');
  });

  it('returns an empty string when the line carries no amount', () => {
    expect(extractRevenue('Bakery')).toBe('');
    expect(extractRevenue('')).toBe('');
    // A total with no /h suffix is not an hourly revenue.
    expect(extractRevenue('($26,564)')).toBe('');
  });
});

describe('isTrueOrdinal', () => {
  // Delphi wordbool TRUE is -1, but the decoder does a VarCast to integer,
  // so ANY non-zero ordinal is true. A test
  // that only accepted "-1" would reject a legitimate server-side "#1".
  it.each(['-1', '1', '2', '-42'])('reads %s as true', (value) => {
    expect(isTrueOrdinal(value)).toBe(true);
  });

  it('reads 0 as false', () => {
    expect(isTrueOrdinal('0')).toBe(false);
  });

  it('reads an unparsable empty value as false', () => {
    expect(isTrueOrdinal('')).toBe(false);
  });
});

describe('parseResultCode', () => {
  // P-L9: the seven open-coded copies of this regex disagreed on whether the
  // code could be negative. `#-1` and `#0` are the boolean encoding, so
  // a negative ordinal is ordinary here, not a parse failure.
  it('reads the success code', () => {
    expect(parseResultCode('res="#0"')).toBe(0);
  });

  it('reads a negative code instead of falling through to -1 by accident', () => {
    expect(parseResultCode('res="#-1"')).toBe(-1);
    expect(parseResultCode('res="#-33"')).toBe(-33);
  });

  it('reads a refusal code the caller maps through getErrorMessage', () => {
    expect(parseResultCode('res="#33"')).toBe(33);
  });

  it('finds the code inside a larger payload', () => {
    expect(parseResultCode('objid="4242" res="#27" ')).toBe(27);
  });

  it.each([
    ['an absent payload', undefined],
    ['a null payload', null],
    ['an empty payload', ''],
    ['a payload with no res=', 'Name="%Bakery"'],
    ['a res= that is not an ordinal', 'res="%ok"'],
  ])('reports -1 for %s, which every caller treats as failure', (_label, payload) => {
    expect(parseResultCode(payload)).toBe(-1);
  });
});

describe('parsePropertyResponse — fallback paths', () => {
  beforeEach(() => {
    resetPropertyFallbackCensus();
  });

  it('reads an unquoted value when the payload starts with the property name', () => {
    // The anchored regex requires quotes; this is the second chance.
    expect(parsePropertyResponse('Count=5', 'Count')).toBe('5');
    expect(parsePropertyResponse('Count = #5', 'Count')).toBe('5');
  });

  it('strips the type prefix when there is no "=" at all', () => {
    expect(parsePropertyResponse('Count#5', 'Count')).toBe('5');
  });

  it('falls through when the matched value is empty', () => {
    // `Name=""` matches the regex but yields '', so the guard sends it on to
    // the startsWith branch — which returns '' as well, by another route.
    expect(parsePropertyResponse('Name=""', 'Name')).toBe('');
  });

  it('returns an empty string and warns when the payload cleans to nothing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(parsePropertyResponse('', 'Whatever')).toBe('');

    expect(warn).toHaveBeenCalledWith('[RdoHelpers] Empty response for property Whatever');
    warn.mockRestore();
  });

  it('records the bare-value fallback in the census', () => {
    // Observation only (P-M3 method): the census separates "we picked another
    // property's text" from "the payload really was a bare value".
    parsePropertyResponse('res="#42"', 'SomeProp');

    const census = getPropertyFallbackCensus();
    expect(census).toHaveLength(1);
    expect(census[0].observation.propName).toBe('SomeProp');
  });

  it('does not record a census entry when the property was matched properly', () => {
    parsePropertyResponse('SomeProp="#42"', 'SomeProp');

    expect(getPropertyFallbackCensus()).toEqual([]);
  });
});

describe('parseIdOfResponse — fallback paths', () => {
  it('falls back to the cleaned payload when there is no objid', () => {
    // Some members answer an idof with a bare res= instead of objid=.
    expect(parseIdOfResponse('res="#39751288"')).toBe('39751288');
  });

  it('strips leftover type punctuation from the fallback', () => {
    expect(parseIdOfResponse('  "#3975$1288"  ')).toBe('39751288');
  });

  it('falls back when objid carries an empty value, and returns junk', () => {
    // KNOWN DEFECT (lot 1): `objid=""` matches the regex with an empty group,
    // so the `objidMatch[1]` guard sends it to the fallback, which only strips
    // punctuation. The caller gets the string `objid=` and hands it to
    // RdoCommand.sel(), which accepts it (non-empty, not '0') and emits
    // `C sel objid= …`. The symmetric case — an empty payload — throws.
    // Pinning CURRENT behaviour, not endorsing it.
    expect(parseIdOfResponse('objid=""')).toBe('objid=');
  });

  it('throws on an empty payload rather than returning a null id', () => {
    // `sel ''` would be a null pointer on the server; failing here is the point.
    expect(() => parseIdOfResponse('')).toThrow('Empty idof response');
  });
});
