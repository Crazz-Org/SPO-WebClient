/**
 * Unit Tests for RDO Protocol Type System
 * Tests for RdoValue, RdoParser, RdoCommand, and rdoArgs
 */

import { describe, it, expect } from '@jest/globals';
import {
  RdoValue,
  RdoParser,
  RdoCommand,
  rdoArgs,
  RdoTypePrefix,
  RdoIdentifierError,
  RDO_IDENTIFIER_PATTERN,
  RDO_TYPE_PREFIXES,
  assertValidRdoIdentifier,
  encodeRdoLiteral,
  isRdoTypePrefix,
  isValidRdoIdentifier,
  isWellFormedRdoLiteral,
  stripRdoPrefix,
} from './rdo-types';
import { ERROR_InvalidParameter, getErrorMessage } from './error-codes';

describe('RdoValue', () => {
  describe('int() - Integer values (OrdinalId)', () => {
    it('should create integer value with # prefix', () => {
      const value = RdoValue.int(42);
      expect(value.format()).toBe('"#42"');
    });

    it('should floor decimal values', () => {
      const value = RdoValue.int(42.7);
      expect(value.format()).toBe('"#42"');
    });

    it('should handle zero', () => {
      const value = RdoValue.int(0);
      expect(value.format()).toBe('"#0"');
    });

    it('should handle negative integers', () => {
      const value = RdoValue.int(-100);
      expect(value.format()).toBe('"#-100"');
    });

    it('should expose raw value', () => {
      const value = RdoValue.int(42);
      expect(value.value).toBe(42);
      expect(value.prefix).toBe(RdoTypePrefix.INTEGER);
    });
  });

  describe('string() - Wide strings (OLEStringId)', () => {
    it('should create string value with % prefix', () => {
      const value = RdoValue.string('hello');
      expect(value.format()).toBe('"%hello"');
    });

    it('should handle empty strings', () => {
      const value = RdoValue.string('');
      expect(value.format()).toBe('"%"');
    });

    it('should handle strings with spaces', () => {
      const value = RdoValue.string('Hello World');
      expect(value.format()).toBe('"%Hello World"');
    });

    it('should handle special characters', () => {
      const value = RdoValue.string('Test, Inc.');
      expect(value.format()).toBe('"%Test, Inc."');
    });

    it('should escape internal double quotes (Delphi convention: " → "")', () => {
      const value = RdoValue.string('Build "Project"');
      expect(value.format()).toBe('"%Build ""Project"""');
    });

    it('should handle strings with only a double quote', () => {
      const value = RdoValue.string('"');
      expect(value.format()).toBe('"%"""');
    });

    it('should expose raw value', () => {
      const value = RdoValue.string('test');
      expect(value.value).toBe('test');
      expect(value.prefix).toBe(RdoTypePrefix.OLESTRING);
    });
  });

  describe('float() - Single precision floats (SingleId)', () => {
    it('should create float value with ! prefix', () => {
      const value = RdoValue.float(3.14);
      expect(value.format()).toBe('"!3.14"');
    });

    it('should handle zero', () => {
      const value = RdoValue.float(0.0);
      expect(value.format()).toBe('"!0"');
    });

    it('should handle negative floats', () => {
      const value = RdoValue.float(-2.5);
      expect(value.format()).toBe('"!-2.5"');
    });

    it('should preserve decimal precision', () => {
      const value = RdoValue.float(1.23456789);
      expect(value.format()).toBe('"!1.23456789"');
    });
  });

  describe('double() - Double precision floats (DoubleId)', () => {
    it('should create double value with @ prefix', () => {
      const value = RdoValue.double(2.71828);
      expect(value.format()).toBe('"@2.71828"');
    });

    it('should handle large numbers', () => {
      const value = RdoValue.double(1e10);
      expect(value.format()).toBe('"@10000000000"');
    });
  });

  describe('stringId() - Short string identifiers (StringId)', () => {
    it('should create stringId value with $ prefix', () => {
      const value = RdoValue.stringId('ID_123');
      expect(value.format()).toBe('"$ID_123"');
    });
  });

  describe('variant() - Variant type (VariantId)', () => {
    it('should create variant with ^ prefix for strings', () => {
      const value = RdoValue.variant('test');
      expect(value.format()).toBe('"^test"');
    });

    it('should create variant with ^ prefix for numbers', () => {
      const value = RdoValue.variant(42);
      expect(value.format()).toBe('"^42"');
    });
  });

  describe('void() - Void type (VoidId)', () => {
    it('should create void value with * prefix', () => {
      const value = RdoValue.void();
      expect(value.format()).toBe('"*"');
    });

    it('should have empty value', () => {
      const value = RdoValue.void();
      expect(value.value).toBe('');
    });
  });

  describe('toTypedValue()', () => {
    it('should return internal representation', () => {
      const value = RdoValue.int(42);
      const typed = value.toTypedValue();
      expect(typed).toEqual({
        prefix: RdoTypePrefix.INTEGER,
        rawValue: 42
      });
    });
  });

  describe('toString()', () => {
    it('should call format()', () => {
      const value = RdoValue.int(100);
      expect(value.toString()).toBe('"#100"');
    });
  });
});

describe('RdoParser', () => {
  describe('extract() - Parse formatted values', () => {
    it('should extract integer prefix and value', () => {
      const result = RdoParser.extract('"#42"');
      expect(result).toEqual({ prefix: '#', value: '42' });
    });

    it('should extract string prefix and value', () => {
      const result = RdoParser.extract('"%hello"');
      expect(result).toEqual({ prefix: '%', value: 'hello' });
    });

    it('should extract float prefix and value', () => {
      const result = RdoParser.extract('"!3.14"');
      expect(result).toEqual({ prefix: '!', value: '3.14' });
    });

    it('should extract double prefix and value', () => {
      const result = RdoParser.extract('"@2.718"');
      expect(result).toEqual({ prefix: '@', value: '2.718' });
    });

    it('should extract stringId prefix and value', () => {
      const result = RdoParser.extract('"$ID"');
      expect(result).toEqual({ prefix: '$', value: 'ID' });
    });

    it('should extract variant prefix and value', () => {
      const result = RdoParser.extract('"^test"');
      expect(result).toEqual({ prefix: '^', value: 'test' });
    });

    it('should extract void prefix', () => {
      const result = RdoParser.extract('"*"');
      expect(result).toEqual({ prefix: '*', value: '' });
    });

    it('should handle input without outer quotes', () => {
      const result = RdoParser.extract('#42');
      expect(result).toEqual({ prefix: '#', value: '42' });
    });

    it('should handle input with whitespace', () => {
      const result = RdoParser.extract('  "#100"  ');
      expect(result).toEqual({ prefix: '#', value: '100' });
    });

    it('should return empty prefix for untyped values', () => {
      const result = RdoParser.extract('"hello"');
      expect(result).toEqual({ prefix: '', value: 'hello' });
    });

    it('should unescape doubled quotes in values (Delphi convention: "" → ")', () => {
      const result = RdoParser.extract('"%Build ""Project"""');
      expect(result).toEqual({ prefix: '%', value: 'Build "Project"' });
    });

    it('should unescape doubled quotes without prefix', () => {
      const result = RdoParser.extract('"Hello ""World"""');
      expect(result).toEqual({ prefix: '', value: 'Hello "World"' });
    });

    it('should roundtrip strings with double quotes', () => {
      const original = 'A "B" C';
      const encoded = RdoValue.string(original).format();
      const decoded = RdoParser.extract(encoded);
      expect(decoded.prefix).toBe('%');
      expect(decoded.value).toBe(original);
    });
  });

  describe('getValue() - Extract value only', () => {
    it('should extract value without prefix', () => {
      expect(RdoParser.getValue('"#42"')).toBe('42');
      expect(RdoParser.getValue('"%hello"')).toBe('hello');
      expect(RdoParser.getValue('"!3.14"')).toBe('3.14');
    });

    it('should handle unquoted input', () => {
      expect(RdoParser.getValue('#100')).toBe('100');
    });
  });

  describe('getPrefix() - Extract prefix only', () => {
    it('should extract prefix characters', () => {
      expect(RdoParser.getPrefix('"#42"')).toBe('#');
      expect(RdoParser.getPrefix('"%hello"')).toBe('%');
      expect(RdoParser.getPrefix('"!3.14"')).toBe('!');
      expect(RdoParser.getPrefix('"@2.718"')).toBe('@');
      expect(RdoParser.getPrefix('"$ID"')).toBe('$');
      expect(RdoParser.getPrefix('"^var"')).toBe('^');
      expect(RdoParser.getPrefix('"*"')).toBe('*');
    });

    it('should return empty string for untyped values', () => {
      expect(RdoParser.getPrefix('"plain"')).toBe('');
    });
  });

  describe('hasPrefix() - Type checking', () => {
    it('should check for integer prefix', () => {
      expect(RdoParser.hasPrefix('"#42"', RdoTypePrefix.INTEGER)).toBe(true);
      expect(RdoParser.hasPrefix('"%test"', RdoTypePrefix.INTEGER)).toBe(false);
    });

    it('should check for string prefix', () => {
      expect(RdoParser.hasPrefix('"%hello"', RdoTypePrefix.OLESTRING)).toBe(true);
      expect(RdoParser.hasPrefix('"#42"', RdoTypePrefix.OLESTRING)).toBe(false);
    });

    it('should check for void prefix', () => {
      expect(RdoParser.hasPrefix('"*"', RdoTypePrefix.VOID)).toBe(true);
    });
  });

  describe('asInt() - Convert to integer', () => {
    it('should parse integer values', () => {
      expect(RdoParser.asInt('"#42"')).toBe(42);
      expect(RdoParser.asInt('"#0"')).toBe(0);
      expect(RdoParser.asInt('"#-100"')).toBe(-100);
    });

    it('should parse from unquoted input', () => {
      expect(RdoParser.asInt('#123')).toBe(123);
    });

    it('should handle large integers', () => {
      expect(RdoParser.asInt('"#1000000"')).toBe(1000000);
    });
  });

  describe('asFloat() - Convert to float', () => {
    it('should parse float values', () => {
      expect(RdoParser.asFloat('"!3.14"')).toBeCloseTo(3.14);
      expect(RdoParser.asFloat('"!0.5"')).toBe(0.5);
      expect(RdoParser.asFloat('"!-2.5"')).toBe(-2.5);
    });

    it('should parse double values', () => {
      expect(RdoParser.asFloat('"@2.71828"')).toBeCloseTo(2.71828);
    });

    it('should handle integer formatted as float', () => {
      expect(RdoParser.asFloat('"!100"')).toBe(100);
    });
  });

  describe('asString() - Convert to string', () => {
    it('should extract string values', () => {
      expect(RdoParser.asString('"%hello"')).toBe('hello');
      expect(RdoParser.asString('"$ID_123"')).toBe('ID_123');
    });

    it('should handle strings with spaces', () => {
      expect(RdoParser.asString('"%Building Name"')).toBe('Building Name');
    });

    it('should work with any type prefix', () => {
      expect(RdoParser.asString('"#42"')).toBe('42');
    });
  });

  describe('Roundtrip tests - format() → parse()', () => {
    it('should preserve integer values', () => {
      const original = 42;
      const formatted = RdoValue.int(original).format();
      const parsed = RdoParser.asInt(formatted);
      expect(parsed).toBe(original);
    });

    it('should preserve float values', () => {
      const original = 3.14159;
      const formatted = RdoValue.float(original).format();
      const parsed = RdoParser.asFloat(formatted);
      expect(parsed).toBeCloseTo(original);
    });

    it('should preserve string values', () => {
      const original = 'Test String';
      const formatted = RdoValue.string(original).format();
      const parsed = RdoParser.asString(formatted);
      expect(parsed).toBe(original);
    });
  });
});

describe('rdoArgs() - Helper function', () => {
  it('should convert RdoValue instances as-is', () => {
    const args = rdoArgs(RdoValue.int(42), RdoValue.string('test'));
    expect(args).toHaveLength(2);
    expect(args[0].format()).toBe('"#42"');
    expect(args[1].format()).toBe('"%test"');
  });

  it('should convert raw numbers to int', () => {
    const args = rdoArgs(100, 200);
    expect(args).toHaveLength(2);
    expect(args[0].format()).toBe('"#100"');
    expect(args[1].format()).toBe('"#200"');
  });

  it('should convert plain strings to olestring', () => {
    const args = rdoArgs('hello', 'world');
    expect(args).toHaveLength(2);
    expect(args[0].format()).toBe('"%hello"');
    expect(args[1].format()).toBe('"%world"');
  });

  it('should auto-detect typed string values', () => {
    const args = rdoArgs('#42', '!3.14', '%test', '$ID', '*');
    expect(args).toHaveLength(5);
    expect(args[0].format()).toBe('"#42"');
    expect(args[1].format()).toBe('"!3.14"');
    expect(args[2].format()).toBe('"%test"');
    expect(args[3].format()).toBe('"$ID"');
    expect(args[4].format()).toBe('"*"');
  });

  it('should handle quoted typed strings', () => {
    const args = rdoArgs('"#100"', '"%hello"');
    expect(args).toHaveLength(2);
    expect(args[0].format()).toBe('"#100"');
    expect(args[1].format()).toBe('"%hello"');
  });

  it('should handle mixed types', () => {
    const args = rdoArgs(RdoValue.int(42), 100, 'test', '#200');
    expect(args).toHaveLength(4);
    expect(args[0].format()).toBe('"#42"');
    expect(args[1].format()).toBe('"#100"');
    expect(args[2].format()).toBe('"%test"');
    expect(args[3].format()).toBe('"#200"');
  });

  it('should handle empty array', () => {
    const args = rdoArgs();
    expect(args).toHaveLength(0);
  });
});

describe('RdoCommand', () => {
  describe('Basic command construction', () => {
    it('should build simple call command', () => {
      const cmd = RdoCommand.sel(123).call('TestMethod').build();
      expect(cmd).toBe('C sel 123 call TestMethod "*";');
    });

    it('should build get command', () => {
      const cmd = RdoCommand.sel(456).get('PropertyName').build();
      expect(cmd).toBe('C sel 456 get PropertyName;');
    });

    it('should build set command', () => {
      const cmd = RdoCommand.sel(789).set('Value').args(RdoValue.int(100)).build();
      expect(cmd).toBe('C sel 789 set Value="#100";');
    });
  });

  describe('Call commands with arguments', () => {
    it('should build call with single argument', () => {
      const cmd = RdoCommand.sel(100)
        .call('Method')
        .push()
        .args(RdoValue.int(42))
        .build();
      expect(cmd).toBe('C sel 100 call Method "*" "#42";');
    });

    it('should build call with multiple arguments', () => {
      const cmd = RdoCommand.sel(100)
        .call('SetPrice')
        .push()
        .args(RdoValue.int(0), RdoValue.int(220))
        .build();
      expect(cmd).toBe('C sel 100 call SetPrice "*" "#0","#220";');
    });

    it('should build call with mixed argument types', () => {
      const cmd = RdoCommand.sel(200)
        .call('TestTypes')
        .push()
        .args(RdoValue.int(42), RdoValue.string('hello'), RdoValue.float(3.14))
        .build();
      expect(cmd).toBe('C sel 200 call TestTypes "*" "#42","%hello","!3.14";');
    });

    it('should auto-convert raw values in args', () => {
      const cmd = RdoCommand.sel(300)
        .call('Method')
        .push()
        .args(42, 'test')
        .build();
      expect(cmd).toBe('C sel 300 call Method "*" "#42","%test";');
    });
  });

  describe('Separator types', () => {
    it('should use * separator with push()', () => {
      const cmd = RdoCommand.sel(100)
        .call('Method')
        .push()
        .build();
      expect(cmd).toContain('"*"');
    });

    it('should use ^ separator with method()', () => {
      const cmd = RdoCommand.sel(100)
        .call('Method')
        .method()
        .build();
      expect(cmd).toContain('"^"');
    });
  });

  describe('Request IDs', () => {
    it('should add request ID to command', () => {
      const cmd = RdoCommand.sel(100)
        .call('Method')
        .withRequestId(1234)
        .build();
      expect(cmd).toBe('C 1234 sel 100 call Method "^";');
    });

    it('should automatically use ^ separator with request ID', () => {
      const cmd = RdoCommand.sel(100)
        .call('Method')
        .withRequestId(5678)
        .args(RdoValue.int(42))
        .build();
      expect(cmd).toBe('C 5678 sel 100 call Method "^" "#42";');
    });
  });

  // P-L4 — QueryId and separator are two independent axes.
  // withRequestId() used to overwrite
  // the separator unconditionally, which made the reference client's void form
  // — `C 2174 sel 30430748 call AddLine "*" "%test message";` → `A2174 ;`
  // (live capture) — impossible to express with RdoCommand.
  describe('QueryId × separator decoupling (P-L4)', () => {
    it('does not overwrite an explicit push() when a request ID is added', () => {
      const cmd = RdoCommand.sel(30430748)
        .call('AddLine')
        .push()
        .withRequestId(2174)
        .args(RdoValue.string('test message'))
        .build();
      expect(cmd).toBe('C 2174 sel 30430748 call AddLine "*" "%test message";');
    });

    it('accepts push() after withRequestId() too — order must not matter', () => {
      const cmd = RdoCommand.sel(30430748)
        .call('AddLine')
        .withRequestId(2174)
        .push()
        .args(RdoValue.string('test message'))
        .build();
      expect(cmd).toBe('C 2174 sel 30430748 call AddLine "*" "%test message";');
    });

    it('keeps the "^" default when no separator was stated explicitly', () => {
      expect(RdoCommand.sel(100).call('M').withRequestId(7).build())
        .toBe('C 7 sel 100 call M "^";');
    });

    it('does not overwrite an explicit method() either', () => {
      expect(RdoCommand.sel(100).call('M').method().withRequestId(7).build())
        .toBe('C 7 sel 100 call M "^";');
    });

    it('still defaults to "*" with no request ID and no explicit separator', () => {
      expect(RdoCommand.sel(100).call('M').build()).toBe('C sel 100 call M "*";');
    });

    it('withRequestId puts the QueryId at the head of the frame', () => {
      // withRequestId only ever ADDS a QueryId, placed right after the "C".
      const cmd = RdoCommand.sel(100).call('M').withRequestId(9).build();
      expect(cmd.startsWith('C 9 ')).toBe(true);
    });
  });

  describe('Complex real-world examples', () => {
    it('should build RDOSetPrice command', () => {
      const cmd = RdoCommand.sel(100575368)
        .call('RDOSetPrice')
        .push()
        .args(RdoValue.int(0), RdoValue.int(220))
        .build();
      expect(cmd).toBe('C sel 100575368 call RDOSetPrice "*" "#0","#220";');
    });

    it('should build RDOSetSalaries command (3 args)', () => {
      const cmd = RdoCommand.sel(100575368)
        .call('RDOSetSalaries')
        .push()
        .args(RdoValue.int(100), RdoValue.int(120), RdoValue.int(150))
        .build();
      expect(cmd).toBe('C sel 100575368 call RDOSetSalaries "*" "#100","#120","#150";');
    });

    it('builder example: explicit method() yields "^" (not a production form — RDOLogonClient is a procedure, sent "*" via rdoCall)', () => {
      // Exercises the RdoCommand builder only; production code never emits this frame.
      const cmd = RdoCommand.sel(123)
        .call('RDOLogonClient')
        .method()
        .args(RdoValue.string('username'), RdoValue.string('password'))
        .build();
      expect(cmd).toBe('C sel 123 call RDOLogonClient "^" "%username","%password";');
    });

    it('should build property get command', () => {
      const cmd = RdoCommand.sel(456).get('srvName').build();
      expect(cmd).toBe('C sel 456 get srvName;');
    });
  });

  describe('String target IDs', () => {
    it('should handle string target IDs', () => {
      const cmd = RdoCommand.sel('ABC123').call('Method').build();
      expect(cmd).toBe('C sel ABC123 call Method "*";');
    });

    it('should convert numeric target IDs to strings', () => {
      const cmd = RdoCommand.sel(999).call('Test').build();
      expect(cmd).toContain('sel 999');
    });
  });

  describe('toString()', () => {
    it('should call build()', () => {
      const cmd = RdoCommand.sel(100).call('Method');
      expect(cmd.toString()).toBe(cmd.build());
    });
  });

  describe('Edge cases', () => {
    it('should handle empty args array', () => {
      const cmd = RdoCommand.sel(100).call('NoArgs').push().args().build();
      expect(cmd).toBe('C sel 100 call NoArgs "*";');
    });

    it('should handle void arguments', () => {
      const cmd = RdoCommand.sel(100)
        .call('WithVoid')
        .push()
        .args(RdoValue.void())
        .build();
      expect(cmd).toBe('C sel 100 call WithVoid "*" "*";');
    });

    it('should handle command chaining', () => {
      const cmd = RdoCommand.sel(100)
        .call('Test1')
        .push()
        .args(RdoValue.int(1))
        .build();

      const cmd2 = RdoCommand.sel(200)
        .call('Test2')
        .push()
        .args(RdoValue.int(2))
        .build();

      expect(cmd).toContain('sel 100');
      expect(cmd2).toContain('sel 200');
    });
  });

  describe('sel 0 validation (null pointer guard)', () => {
    it('should reject numeric 0', () => {
      expect(() => RdoCommand.sel(0)).toThrow('Invalid RDO target ID');
    });

    it('should reject string "0"', () => {
      expect(() => RdoCommand.sel('0')).toThrow('Invalid RDO target ID');
    });

    it('should reject empty string', () => {
      expect(() => RdoCommand.sel('')).toThrow('Invalid RDO target ID');
    });

    it('should accept valid numeric ID', () => {
      expect(() => RdoCommand.sel(8116248)).not.toThrow();
    });

    it('should accept valid string ID', () => {
      expect(() => RdoCommand.sel('100575368')).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Lot L2 — the boundary primitives exported for rdo.ts and for lot L5
// ---------------------------------------------------------------------------

describe('RDO_TYPE_PREFIXES / isRdoTypePrefix', () => {
  it('lists exactly the seven wire prefixes', () => {
    expect([...RDO_TYPE_PREFIXES].sort()).toEqual(['!', '#', '$', '%', '*', '@', '^']);
  });

  it('recognises each of them, and only single characters', () => {
    for (const p of RDO_TYPE_PREFIXES) expect(isRdoTypePrefix(p)).toBe(true);
    expect(isRdoTypePrefix('a')).toBe(false);
    expect(isRdoTypePrefix('')).toBe(false);
    expect(isRdoTypePrefix('##')).toBe(false);
  });
});

describe('encodeRdoLiteral', () => {
  it('narrows to the wire alphabet BEFORE escaping (RDOUtils.pas:379)', () => {
    // U+0122 truncates to 0x22 '"' under a naive latin1 write. Narrowing first
    // turns it into '?', so no metacharacter can be forged after escaping.
    expect(encodeRdoLiteral('%', 'a\u0122b')).toBe('"%a?b"');
  });

  it('doubles internal quotes (RDOUtils.pas:246-254)', () => {
    expect(encodeRdoLiteral('%', 'say "hi"')).toBe('"%say ""hi"""');
  });

  it('leaves Latin-1 accents untouched', () => {
    expect(encodeRdoLiteral('%', 'déjà vu')).toBe('"%déjà vu"');
  });

  it('is what RdoValue.format() emits', () => {
    expect(RdoValue.string('a"b').format()).toBe(encodeRdoLiteral('%', 'a"b'));
    expect(RdoValue.int(-1).format()).toBe(encodeRdoLiteral('#', '-1'));
  });
});

describe('isWellFormedRdoLiteral', () => {
  it('accepts anything RdoValue.format() produces', () => {
    for (const v of [
      RdoValue.int(42), RdoValue.string(''), RdoValue.string('say "hi"'),
      RdoValue.string('a;b,c'), RdoValue.float(3.14), RdoValue.void(),
      RdoValue.stringId('x'), RdoValue.double(1.5), RdoValue.variant('v'),
    ]) {
      expect(isWellFormedRdoLiteral(v.format())).toBe(true);
    }
  });

  it('rejects a token that closes its literal early', () => {
    expect(isWellFormedRdoLiteral('"%evil" call Evil "*" "')).toBe(false);
    expect(isWellFormedRdoLiteral('"%a""')).toBe(false);
    expect(isWellFormedRdoLiteral('"%a"b"')).toBe(false);
  });

  it('rejects tokens without quotes or without a type prefix', () => {
    expect(isWellFormedRdoLiteral('%hello')).toBe(false);
    expect(isWellFormedRdoLiteral('"hello"')).toBe(false);
    expect(isWellFormedRdoLiteral('')).toBe(false);
    expect(isWellFormedRdoLiteral('"')).toBe(false);
  });

  it('matches in linear time on a long hostile token', () => {
    // The alternation is unambiguous, so there is no backtracking blowup.
    const started = Date.now();
    expect(isWellFormedRdoLiteral(`"%${'a"'.repeat(20000)}`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('assertValidRdoIdentifier / isValidRdoIdentifier (P-H3, contract for lot L5)', () => {
  it('exposes the Delphi grammar as a pattern', () => {
    expect(RDO_IDENTIFIER_PATTERN.source).toBe('^[A-Za-z_][A-Za-z0-9_]*$');
  });

  it.each(['RDOOpenSession', '_x', 'a1', 'Tax0Id', 'EnableEvents'])('accepts %j', (name) => {
    expect(isValidRdoIdentifier(name)).toBe(true);
    expect(() => assertValidRdoIdentifier(name)).not.toThrow();
  });

  it.each(['', '1a', 'a b', 'a;', 'a.b', 'a-b', 'a"', 'a\tb', 'a=1'])('rejects %j', (name) => {
    expect(isValidRdoIdentifier(name)).toBe(false);
    expect(() => assertValidRdoIdentifier(name)).toThrow(RdoIdentifierError);
  });

  it('rejects non-string input without throwing a TypeError', () => {
    expect(isValidRdoIdentifier(undefined)).toBe(false);
    expect(isValidRdoIdentifier(42)).toBe(false);
    expect(isValidRdoIdentifier(null)).toBe(false);
  });

  it('carries identifier, context and a protocol error code', () => {
    const err = (() => {
      try {
        assertValidRdoIdentifier('Foo Bar', 'propertyName');
        return null;
      } catch (e: unknown) {
        return e as RdoIdentifierError;
      }
    })();
    expect(err).toBeInstanceOf(RdoIdentifierError);
    expect(err!.identifier).toBe('Foo Bar');
    expect(err!.context).toBe('propertyName');
    expect(err!.errorCode).toBe(ERROR_InvalidParameter);
    expect(getErrorMessage(err!.errorCode)).toBe('Invalid parameter');
    expect(err!.message).toContain('propertyName');
    expect(err!.message).toContain('RDOUtils.pas:70-78');
  });

  it('defaults the context label to "member"', () => {
    expect(() => assertValidRdoIdentifier('a b')).toThrow(/for member/);
  });
});

describe('numeric wire guards (P-M4)', () => {
  // Coordinates and counts arrive from browser JSON with nothing validating
  // them at the WebSocket boundary. Delphi's decoder does
  // VarCast(Result, tmp, varInteger) (RDOUtils.pas:333-344) and raises on a
  // non-numeric literal, so a "#NaN" reaches the shared server as a malformed
  // query — the class of frame this project must never emit.
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
  ])('int() refuses %s instead of formatting it', (_label, value) => {
    expect(() => RdoValue.int(value)).toThrow(RangeError);
    expect(() => RdoValue.int(value)).toThrow(/needs a finite number/);
  });

  it('float() and double() refuse a non-finite value, naming themselves', () => {
    expect(() => RdoValue.float(NaN)).toThrow(/RdoValue\.float\(\) needs a finite number/);
    expect(() => RdoValue.double(Infinity)).toThrow(/RdoValue\.double\(\) needs a finite number/);
  });

  it('int() refuses a magnitude that would stringify in exponential form', () => {
    // 1e21 formats as "1e+21", which is not an RDO ordinal.
    expect(() => RdoValue.int(1e21)).toThrow(/needs a safe integer/);
    expect(() => RdoValue.int(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('accepts the boundary values on either side of the guard', () => {
    expect(RdoValue.int(Number.MAX_SAFE_INTEGER).format()).toBe(`"#${Number.MAX_SAFE_INTEGER}"`);
    expect(RdoValue.int(0).format()).toBe('"#0"');
    // Delphi wordbool TRUE — the one value that must never be normalised to 1.
    expect(RdoValue.int(-1).format()).toBe('"#-1"');
  });
});

describe('stripRdoPrefix', () => {
  // P-M6: eleven sites open-coded `[$#%@]` and lost `!` (SingleId) and `^`
  // (VariantId) — RDOUtils.pas:369-370 and :381 show the server emitting both.
  it.each([
    ['#42', '42'],
    ['$id', 'id'],
    ['%wide', 'wide'],
    ['@3.14', '3.14'],
    ['!0.85', '0.85'],
    ['^42', '42'],
    ['*', ''],
  ])('strips %s down to %s', (input, expected) => {
    expect(stripRdoPrefix(input)).toBe(expected);
  });

  it('leaves an unprefixed value alone, and only strips the leading character', () => {
    expect(stripRdoPrefix('Bakery')).toBe('Bakery');
    expect(stripRdoPrefix('')).toBe('');
    expect(stripRdoPrefix('##7')).toBe('#7');
  });
});

describe('rdoArgs — prefix round-trip', () => {
  // rdoArgs re-types an already-formatted token; the prefix decides which
  // RdoValue constructor is used, and therefore what goes back on the wire.
  it.each([
    ['#42', '"#42"'],
    ['!0.5', '"!0.5"'],
    ['@3.14', '"@3.14"'],
    ['$Sess', '"$Sess"'],
    ['%wide', '"%wide"'],
    ['^42', '"^42"'],
  ])('rebuilds %s as %s', (input, expected) => {
    expect(rdoArgs(input)[0].format()).toBe(expected);
  });

  it('treats the void prefix as a void value', () => {
    expect(rdoArgs('*')[0].format()).toBe('"*"');
  });

  it('treats an unprefixed string as a widestring, and a number as an ordinal', () => {
    expect(rdoArgs('Bakery')[0].format()).toBe('"%Bakery"');
    expect(rdoArgs(42)[0].format()).toBe('"#42"');
  });

  it('passes an RdoValue through untouched', () => {
    const value = RdoValue.stringId('Cacher');
    expect(rdoArgs(value)[0]).toBe(value);
  });
});

describe('RdoCommand.build — argument grammar guards (P-L5)', () => {
  // The grammar has no place for GET arguments and exactly one place for a SET
  // value. build() used to drop the surplus silently; the next caller to write
  // `.get('X').args(y)` would have watched `y` vanish onto the wire.
  it('refuses arguments on a get', () => {
    expect(() => RdoCommand.sel('8161308').get('Money').args(RdoValue.int(1)).build())
      .toThrow(/RDO get Money was given 1 argument\(s\)/);
  });

  it('refuses a second argument on a set', () => {
    expect(() => RdoCommand.sel('8161308').set('Name').args(RdoValue.string('a'), RdoValue.string('b')).build())
      .toThrow(/RDO set Name was given 2 arguments/);
  });

  it('still builds the legitimate single-argument set and no-argument get', () => {
    // build() appends the packet delimiter (RDO_CONSTANTS.PACKET_DELIMITER).
    expect(RdoCommand.sel('8161308').set('EnableEvents').args(RdoValue.int(-1)).build())
      .toBe('C sel 8161308 set EnableEvents="#-1";');
    expect(RdoCommand.sel('8161308').get('Money').build()).toBe('C sel 8161308 get Money;');
  });
});

describe('RdoCommand.build — incomplete commands', () => {
  it('emits an empty assignment for a set with no value', () => {
    expect(RdoCommand.sel('8161308').set('Name').build()).toBe('C sel 8161308 set Name=;');
  });

  it('emits the default push separator when no member was named', () => {
    // `.sel()` alone: action defaults to 'call' and the separator to "*".
    expect(RdoCommand.sel('8161308').build()).toBe('C sel 8161308 call "*";');
  });
});
