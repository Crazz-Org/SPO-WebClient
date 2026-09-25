/**
 * Unit Tests for RDO Protocol Parser and Framer
 * Tests for RdoFramer and RdoProtocol classes
 */

import { describe, it, expect } from '@jest/globals';
import { RdoFramer, RdoProtocol } from './rdo';
import { RdoVerb, RdoAction } from '../shared/types';
import { RdoIdentifierError } from '../shared/rdo-types';

describe('RdoFramer', () => {
  describe('ingest() - Packet framing and buffering', () => {
    it('should extract single complete packet', () => {
      const framer = new RdoFramer();
      const packets = framer.ingest('C sel 123 call Method;');
      expect(packets).toEqual(['C sel 123 call Method']);
    });

    it('should extract multiple packets from one chunk', () => {
      const framer = new RdoFramer();
      const packets = framer.ingest('C sel 1 call Test1;C sel 2 call Test2;');
      expect(packets).toHaveLength(2);
      expect(packets[0]).toBe('C sel 1 call Test1');
      expect(packets[1]).toBe('C sel 2 call Test2');
    });

    it('should buffer incomplete packets', () => {
      const framer = new RdoFramer();
      const packets1 = framer.ingest('C sel 123 call');
      expect(packets1).toEqual([]);

      const packets2 = framer.ingest(' Method;');
      expect(packets2).toEqual(['C sel 123 call Method']);
    });

    it('should handle packet split across multiple chunks', () => {
      const framer = new RdoFramer();
      expect(framer.ingest('C sel ')).toEqual([]);
      expect(framer.ingest('100 ')).toEqual([]);
      expect(framer.ingest('call Test;')).toEqual(['C sel 100 call Test']);
    });

    it('should skip empty packets', () => {
      const framer = new RdoFramer();
      const packets = framer.ingest(';;C sel 1 call Test;;;');
      expect(packets).toEqual(['C sel 1 call Test']);
    });

    it('should trim whitespace from packets', () => {
      const framer = new RdoFramer();
      const packets = framer.ingest('  C sel 1 call Test  ;  ');
      expect(packets).toEqual(['C sel 1 call Test']);
    });

    it('should handle Buffer input', () => {
      const framer = new RdoFramer();
      const buffer = Buffer.from('C sel 1 call Test;', 'latin1');
      const packets = framer.ingest(buffer);
      expect(packets).toEqual(['C sel 1 call Test']);
    });

    it('should handle large chunks with many packets', () => {
      const framer = new RdoFramer();
      const chunk = Array.from({ length: 10 }, (_, i) => `C sel ${i} call Test${i}`).join(';') + ';';
      const packets = framer.ingest(chunk);
      expect(packets).toHaveLength(10);
      expect(packets[0]).toBe('C sel 0 call Test0');
      expect(packets[9]).toBe('C sel 9 call Test9');
    });

    it('should maintain buffer state across ingests', () => {
      const framer = new RdoFramer();
      framer.ingest('C sel 1 call Test1;Partial');
      const packets = framer.ingest('Complete;');
      expect(packets).toEqual(['PartialComplete']);
    });

    it('should NOT split on semicolons inside quoted strings', () => {
      const framer = new RdoFramer();
      const packets = framer.ingest('A1234 res="%Status; OK";');
      expect(packets).toHaveLength(1);
      expect(packets[0]).toBe('A1234 res="%Status; OK"');
    });

    it('should split correctly with quoted semicolons and real delimiters', () => {
      const framer = new RdoFramer();
      const packets = framer.ingest('A1 res="%a;b";A2 res="#42";');
      expect(packets).toHaveLength(2);
      expect(packets[0]).toBe('A1 res="%a;b"');
      expect(packets[1]).toBe('A2 res="#42"');
    });

    it('should handle semicolons in multi-value quoted strings', () => {
      const framer = new RdoFramer();
      const packets = framer.ingest('A1 Name="%Test;Corp";');
      expect(packets).toHaveLength(1);
      expect(packets[0]).toBe('A1 Name="%Test;Corp"');
    });
  });
});

describe('RdoProtocol.parse()', () => {
  describe('Frame terminator', () => {
    // `RdoCommand.build()` always appends `;`, so a frame handed straight to
    // parse() carries one. It used to end up inside the last argument.
    const TERMINATED = 'C sel 130500401 call RDOSetTaxValue "*" "#100","%15";';
    const BARE = 'C sel 130500401 call RDOSetTaxValue "*" "#100","%15"';

    it('does not swallow the terminator into the last argument', () => {
      expect(RdoProtocol.parse(TERMINATED).args).toEqual(['#100', '%15']);
    });

    it('parses a terminated frame exactly like a bare one', () => {
      const terminated = RdoProtocol.parse(TERMINATED);
      const bare = RdoProtocol.parse(BARE);
      expect(terminated.member).toBe(bare.member);
      expect(terminated.separator).toBe(bare.separator);
      expect(terminated.args).toEqual(bare.args);
    });

    it('strips the terminator from a member with no arguments', () => {
      expect(RdoProtocol.parse('C sel 123 call Method;').member).toBe('Method');
    });

    it('strips a terminator separated from the frame by whitespace', () => {
      expect(RdoProtocol.parse('C sel 123 call Method ;').member).toBe('Method');
    });

    it('strips the terminator from a response payload', () => {
      expect(RdoProtocol.parse('A1 Name="%Test Corp";').payload).toBe('Name="%Test Corp"');
    });

    it('leaves a quoted semicolon alone', () => {
      // Same rule as RdoFramer.findDelimiter: only an unquoted `;` terminates.
      expect(RdoProtocol.parse('A1 Name="%Test;Corp";').payload).toBe('Name="%Test;Corp"');
    });

    it('keeps a trailing semicolon that sits inside an unclosed quote', () => {
      expect(RdoProtocol.parse('A1 res="%oops;').payload).toBe('res="%oops;');
    });

    it('leaves a frame with no terminator untouched', () => {
      expect(RdoProtocol.parse('A1234 OK').payload).toBe('OK');
    });
  });

  describe('Packet type detection', () => {
    it('should detect RESPONSE type (A prefix)', () => {
      const packet = RdoProtocol.parse('A1234 OK');
      expect(packet.type).toBe('RESPONSE');
    });

    it('should detect COMMAND/PUSH type (C prefix)', () => {
      const packet = RdoProtocol.parse('C sel 123 call Method;');
      expect(packet.type).toBe('PUSH');
    });

    it('should detect REQUEST type (C with RID)', () => {
      const packet = RdoProtocol.parse('C 5678 sel 123 call Method;');
      expect(packet.type).toBe('REQUEST');
    });

    it('should handle unknown packet types as PUSH', () => {
      const packet = RdoProtocol.parse('UNKNOWN DATA');
      expect(packet.type).toBe('PUSH');
      expect(packet.payload).toBe('UNKNOWN DATA');
    });
  });

  describe('RESPONSE packet parsing', () => {
    it('should extract request ID from response', () => {
      const packet = RdoProtocol.parse('A1234 OK');
      expect(packet.type).toBe('RESPONSE');
      expect(packet.rid).toBe(1234);
      expect(packet.payload).toBe('OK');
    });

    it('should extract payload from response', () => {
      const packet = RdoProtocol.parse('A5678 ERROR Invalid command');
      expect(packet.rid).toBe(5678);
      expect(packet.payload).toBe('ERROR Invalid command');
    });

    it('should handle response with typed value', () => {
      const packet = RdoProtocol.parse('A9999 "%Building Name"');
      expect(packet.rid).toBe(9999);
      expect(packet.payload).toBe('"%Building Name"');
    });

    it('should handle response with multi-line payload', () => {
      const packet = RdoProtocol.parse('A1111 Line1\nLine2\nLine3');
      expect(packet.rid).toBe(1111);
      expect(packet.payload).toContain('Line1');
    });

    it('should handle response without payload', () => {
      const packet = RdoProtocol.parse('A2222');
      expect(packet.rid).toBe(2222);
      expect(packet.payload).toBe('');
    });
  });

  describe('RDO error code parsing (ErrorCodes.pas)', () => {
    it('should detect "error 0" as errNoError', () => {
      const packet = RdoProtocol.parse('A100 error 0');
      expect(packet.type).toBe('RESPONSE');
      expect(packet.rid).toBe(100);
      expect(packet.errorCode).toBe(0);
      expect(packet.errorName).toBe('errNoError');
      expect(packet.payload).toBe('error 0');
    });

    it('should detect "error 5" as errUnexistentMethod', () => {
      const packet = RdoProtocol.parse('A200 error 5');
      expect(packet.errorCode).toBe(5);
      expect(packet.errorName).toBe('errUnexistentMethod');
    });

    it('should detect "error 8" as errQueryTimedOut', () => {
      const packet = RdoProtocol.parse('A300 error 8');
      expect(packet.errorCode).toBe(8);
      expect(packet.errorName).toBe('errQueryTimedOut');
    });

    it('should detect "error 17" as errServerBusy', () => {
      const packet = RdoProtocol.parse('A400 error 17');
      expect(packet.errorCode).toBe(17);
      expect(packet.errorName).toBe('errServerBusy');
    });

    it('should detect "error 2" as errIllegalObject', () => {
      const packet = RdoProtocol.parse('A500 error 2');
      expect(packet.errorCode).toBe(2);
      expect(packet.errorName).toBe('errIllegalObject');
    });

    it('should handle unknown error codes gracefully', () => {
      const packet = RdoProtocol.parse('A600 error 99');
      expect(packet.errorCode).toBe(99);
      expect(packet.errorName).toBe('unknownError(99)');
    });

    it('should NOT treat normal payloads as errors', () => {
      const packet = RdoProtocol.parse('A700 res="#42"');
      expect(packet.errorCode).toBeUndefined();
      expect(packet.errorName).toBeUndefined();
    });

    it('should NOT treat partial "error" string as error code', () => {
      const packet = RdoProtocol.parse('A800 error message text');
      expect(packet.errorCode).toBeUndefined();
    });

    it('should be case-insensitive for "Error" vs "error"', () => {
      const packet = RdoProtocol.parse('A900 Error 5');
      expect(packet.errorCode).toBe(5);
      expect(packet.errorName).toBe('errUnexistentMethod');
    });

    // Delphi GetCommand/SetCommand append the member name to property errors
    // (RDOQueryServer.pas:274) — these MUST be detected as errors too.
    it('should detect "error <n> getting <Prop>" (Delphi GetCommand format)', () => {
      const packet = RdoProtocol.parse('A101 error 3 getting WorldName');
      expect(packet.errorCode).toBe(3);
      expect(packet.errorName).toBe('errUnexistentProperty (getting WorldName)');
    });

    it('should detect "error <n> setting <Prop>" (Delphi SetCommand format)', () => {
      const packet = RdoProtocol.parse('A102 error 4 setting EnableEvents');
      expect(packet.errorCode).toBe(4);
      expect(packet.errorName).toBe('errIllegalPropValue (setting EnableEvents)');
    });

    it('should be case-insensitive on the getting/setting suffix', () => {
      const packet = RdoProtocol.parse('A103 ERROR 5 GETTING Foo');
      expect(packet.errorCode).toBe(5);
      expect(packet.errorName).toBe('errUnexistentMethod (getting Foo)');
    });

    it('should NOT match "error <n>" embedded mid-payload', () => {
      const packet = RdoProtocol.parse('A104 res="%error 5 getting Foo"');
      expect(packet.errorCode).toBeUndefined();
    });

    it('should NOT match an error with trailing extra words beyond the member', () => {
      const packet = RdoProtocol.parse('A105 error 3 getting Foo Bar');
      expect(packet.errorCode).toBeUndefined();
    });

    it('should tolerate trailing whitespace after the member name', () => {
      const packet = RdoProtocol.parse('A106 error 3 getting Foo  ');
      expect(packet.errorCode).toBe(3);
    });
  });

  describe('IDOF verb parsing', () => {
    it('should parse IDOF verb', () => {
      const packet = RdoProtocol.parse('C idof "ObjectID"');
      expect(packet.verb).toBe(RdoVerb.IDOF);
      expect(packet.targetId).toBe('ObjectID');
    });

    it('should strip quotes from IDOF targetId', () => {
      const packet = RdoProtocol.parse('C idof "TestObject"');
      expect(packet.targetId).toBe('TestObject');
    });

    it('should handle IDOF with request ID', () => {
      const packet = RdoProtocol.parse('C 1234 idof "MyObject"');
      expect(packet.type).toBe('REQUEST');
      expect(packet.rid).toBe(1234);
      expect(packet.verb).toBe(RdoVerb.IDOF);
      expect(packet.targetId).toBe('MyObject');
    });
  });

  describe('SEL verb with CALL action', () => {
    it('should parse basic call command', () => {
      const packet = RdoProtocol.parse('C sel 123 call Method;');
      expect(packet.verb).toBe(RdoVerb.SEL);
      expect(packet.targetId).toBe('123');
      expect(packet.action).toBe(RdoAction.CALL);
      expect(packet.member).toBe('Method');
    });

    it('should parse call with push separator (*)', () => {
      const packet = RdoProtocol.parse('C sel 100 call TestMethod "*" "#42";');
      expect(packet.member).toBe('TestMethod');
      expect(packet.separator).toBe('"*"');
      expect(packet.args).toEqual(['#42']);
    });

    it('should parse call with method separator (^)', () => {
      const packet = RdoProtocol.parse('C sel 200 call RequestMethod "^" "#100";');
      expect(packet.member).toBe('RequestMethod');
      expect(packet.separator).toBe('"^"');
      expect(packet.args).toEqual(['#100']);
    });

    it('should parse call with multiple arguments', () => {
      const packet = RdoProtocol.parse('C sel 100 call SetPrice "*" "#0","#220";');
      expect(packet.member).toBe('SetPrice');
      expect(packet.args).toHaveLength(2);
      expect(packet.args![0]).toBe('#0');
      expect(packet.args![1]).toBe('#220');
    });

    it('should parse call with 3 arguments (RDOSetSalaries)', () => {
      const packet = RdoProtocol.parse('C sel 999 call RDOSetSalaries "*" "#100","#120","#150";');
      expect(packet.member).toBe('RDOSetSalaries');
      expect(packet.args).toHaveLength(3);
      expect(packet.args![0]).toBe('#100');
      expect(packet.args![1]).toBe('#120');
      expect(packet.args![2]).toBe('#150');
    });

    it('should parse call with string arguments', () => {
      const packet = RdoProtocol.parse('C sel 123 call Login "*" "%username","%password";');
      expect(packet.args).toHaveLength(2);
      expect(packet.args![0]).toBe('%username');
      expect(packet.args![1]).toBe('%password');
    });

    it('should parse call with mixed type arguments', () => {
      const packet = RdoProtocol.parse('C sel 300 call Test "*" "#42","!3.14","%hello";');
      expect(packet.args).toHaveLength(3);
      expect(packet.args![0]).toBe('#42');
      expect(packet.args![1]).toBe('!3.14');
      expect(packet.args![2]).toBe('%hello');
    });

    it('should handle call with no arguments', () => {
      const packet = RdoProtocol.parse('C sel 400 call NoArgs "*" ;');
      expect(packet.member).toBe('NoArgs');
      expect(packet.args).toEqual([]);
    });

    it('should handle arguments with quoted strings containing commas', () => {
      const packet = RdoProtocol.parse('C sel 200 call SetName "*" "%Building, Inc.";');
      expect(packet.verb).toBe(RdoVerb.SEL);
      expect(packet.action).toBe(RdoAction.CALL);
      expect(packet.member).toBe('SetName');
      expect(packet.separator).toBe('"*"');
      expect(packet.args).toEqual(['%Building, Inc.']);
    });

    it('should parse call with request ID', () => {
      const packet = RdoProtocol.parse('C 5678 sel 100 call Method "^" "#1";');
      expect(packet.type).toBe('REQUEST');
      expect(packet.rid).toBe(5678);
      expect(packet.member).toBe('Method');
      expect(packet.separator).toBe('"^"');
    });
  });

  describe('SEL verb with GET action', () => {
    it('should parse get command', () => {
      const packet = RdoProtocol.parse('C sel 456 get PropertyName;');
      expect(packet.verb).toBe(RdoVerb.SEL);
      expect(packet.targetId).toBe('456');
      expect(packet.action).toBe(RdoAction.GET);
      expect(packet.member).toBe('PropertyName');
    });

    it('should parse get with request ID', () => {
      const packet = RdoProtocol.parse('C 1111 sel 789 get srvName;');
      expect(packet.type).toBe('REQUEST');
      expect(packet.rid).toBe(1111);
      expect(packet.action).toBe(RdoAction.GET);
      expect(packet.member).toBe('srvName');
    });
  });

  describe('SEL verb with SET action', () => {
    it('should parse set command', () => {
      const packet = RdoProtocol.parse('C sel 789 set Value "#100";');
      expect(packet.verb).toBe(RdoVerb.SEL);
      expect(packet.targetId).toBe('789');
      expect(packet.action).toBe(RdoAction.SET);
      expect(packet.member).toBe('Value');
      expect(packet.args).toContain('#100');
    });

    it('should parse set with string value', () => {
      const packet = RdoProtocol.parse('C sel 100 set Name "%NewName";');
      expect(packet.member).toBe('Name');
      expect(packet.args![0]).toContain('%NewName');
    });
  });

  describe('Quote handling and escaping', () => {
    it('should respect quotes in tokenization', () => {
      const packet = RdoProtocol.parse('C sel 100 call Test "*" "%value with spaces";');
      expect(packet.args![0]).toBe('%value with spaces');
    });

    it('should handle escaped quotes in arguments', () => {
      const packet = RdoProtocol.parse('C sel 100 call Test "*" "%value \\"quoted\\"";');
      expect(packet.args![0]).toContain('\\"');
    });

    it('should handle multiple quoted arguments', () => {
      const packet = RdoProtocol.parse('C sel 100 call Test "*" "%arg1","%arg2","%arg3";');
      expect(packet.args).toHaveLength(3);
      expect(packet.args![0]).toBe('%arg1');
      expect(packet.args![1]).toBe('%arg2');
      expect(packet.args![2]).toBe('%arg3');
    });
  });

  describe('Edge cases', () => {
    it('should handle extra whitespace', () => {
      const packet = RdoProtocol.parse('  C   sel   123   call   Method  ;  ');
      expect(packet.verb).toBe(RdoVerb.SEL);
      expect(packet.targetId).toBe('123');
      expect(packet.member).toBe('Method');
    });

    it('should preserve raw input', () => {
      const input = 'C sel 123 call Test;';
      const packet = RdoProtocol.parse(input);
      expect(packet.raw).toBe(input);
    });

    it('should handle numeric string targetIds', () => {
      const packet = RdoProtocol.parse('C sel 100575368 call Method;');
      expect(packet.targetId).toBe('100575368');
    });

    it('should handle void type arguments', () => {
      const packet = RdoProtocol.parse('C sel 100 call Test "*" "*";');
      expect(packet.args![0]).toBe('*');
    });
  });
});

describe('RdoProtocol.format()', () => {
  describe('Basic formatting', () => {
    it('should format simple call command', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'PUSH',
        verb: RdoVerb.SEL,
        targetId: '123',
        action: RdoAction.CALL,
        member: 'Method',
        args: []
      });
      expect(result).toContain('C sel 123 call Method');
      expect(result).toContain('"*"');
    });

    it('should format call with arguments', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'PUSH',
        verb: RdoVerb.SEL,
        targetId: '100',
        action: RdoAction.CALL,
        member: 'SetPrice',
        separator: '*',
        args: ['#0', '#220']
      });
      expect(result).toContain('C sel 100 call SetPrice "*"');
      expect(result).toContain('"#0"');
      expect(result).toContain('"#220"');
    });

    it('should format get command', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'REQUEST',
        rid: 1234,
        verb: RdoVerb.SEL,
        targetId: '456',
        action: RdoAction.GET,
        member: 'PropertyName'
      });
      expect(result).toBe('C 1234 sel 456 get PropertyName');
    });

    it('should format set command', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'PUSH',
        verb: RdoVerb.SEL,
        targetId: '789',
        action: RdoAction.SET,
        member: 'Value',
        args: ['100']
      });
      expect(result).toContain('C sel 789 set Value=');
      expect(result).toContain('#100');
    });
  });

  describe('Request ID handling', () => {
    it('should add request ID when present', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'REQUEST',
        rid: 5678,
        verb: RdoVerb.SEL,
        targetId: '100',
        action: RdoAction.CALL,
        member: 'Method',
        args: []
      });
      expect(result).toContain('C 5678 sel 100 call Method');
    });

    it('should use ^ separator for requests', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'REQUEST',
        rid: 1234,
        verb: RdoVerb.SEL,
        targetId: '100',
        action: RdoAction.CALL,
        member: 'Method',
        args: ['#42']
      });
      expect(result).toContain('"^"');
    });
  });

  describe('IDOF formatting', () => {
    it('should quote targetId for IDOF verb', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'PUSH',
        verb: RdoVerb.IDOF,
        targetId: 'ObjectID'
      });
      expect(result).toBe('C idof "ObjectID"');
    });

    it('should handle IDOF with request ID', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'REQUEST',
        rid: 9999,
        verb: RdoVerb.IDOF,
        targetId: 'TestObj'
      });
      expect(result).toBe('C 9999 idof "TestObj"');
    });
  });

  describe('Type prefix handling', () => {
    it('should preserve type prefixes in arguments', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'PUSH',
        verb: RdoVerb.SEL,
        targetId: '100',
        action: RdoAction.CALL,
        member: 'Test',
        args: ['#42', '%hello', '!3.14']
      });
      expect(result).toContain('"#42"');
      expect(result).toContain('"%hello"');
      expect(result).toContain('"!3.14"');
    });

    it('should treat untyped numeric CALL args as OLEString (not integer)', () => {
      // CALL args must NOT auto-type numeric strings as integers.
      // Delphi methods expect OLEString parameters (e.g., Logon username "12345" → "%12345").
      // To pass an integer, callers must use RdoValue.int() explicitly.
      const result = RdoProtocol.format({
        raw: '',
        type: 'PUSH',
        verb: RdoVerb.SEL,
        targetId: '100',
        action: RdoAction.CALL,
        member: 'Test',
        args: ['42']
      });
      expect(result).toContain('"%42"');
    });

    it('should auto-type integers for SET operations', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'REQUEST',
        verb: RdoVerb.SEL,
        targetId: '789',
        action: RdoAction.SET,
        member: 'Value',
        args: ['100'],
      });
      expect(result).toContain('"#100"');
    });

    it('should add type prefix to untyped strings', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'PUSH',
        verb: RdoVerb.SEL,
        targetId: '100',
        action: RdoAction.CALL,
        member: 'Test',
        args: ['hello']
      });
      expect(result).toContain('"%hello"');
    });
  });

  describe('Separator handling', () => {
    it('should use * separator for push commands', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'PUSH',
        verb: RdoVerb.SEL,
        targetId: '100',
        action: RdoAction.CALL,
        member: 'Method',
        separator: '*',
        args: []
      });
      expect(result).toContain('"*"');
    });

    it('should quote unquoted separators', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'PUSH',
        verb: RdoVerb.SEL,
        targetId: '100',
        action: RdoAction.CALL,
        member: 'Method',
        separator: '^',
        args: []
      });
      expect(result).toContain('"^"');
    });

    it('should preserve already quoted separators', () => {
      const result = RdoProtocol.format({
        raw: '',
        type: 'PUSH',
        verb: RdoVerb.SEL,
        targetId: '100',
        action: RdoAction.CALL,
        member: 'Method',
        separator: '"*"',
        args: []
      });
      expect(result).toContain('"*"');
    });
  });

  describe('Roundtrip tests - parse() → format()', () => {
    it('should preserve call command', () => {
      const original = 'C sel 123 call Method "*" "#42";';
      const parsed = RdoProtocol.parse(original);
      const formatted = RdoProtocol.format(parsed);
      expect(formatted).toContain('sel 123 call Method');
      expect(formatted).toContain('"*"');
      expect(formatted).toContain('"#42"');
    });

    it('should preserve multi-argument commands', () => {
      const original = 'C sel 100 call SetPrice "*" "#0","#220";';
      const parsed = RdoProtocol.parse(original);
      const formatted = RdoProtocol.format(parsed);
      expect(formatted).toContain('"#0"');
      expect(formatted).toContain('"#220"');
    });

    it('should preserve get commands', () => {
      // parse() consumes FRAMED messages: RdoFramer.ingest() has already stripped
      // the ';' terminator (rdo.ts:75). Feeding the terminator in leaves it glued
      // to the member name — 'srvName;' — which format() now rejects as a
      // non-identifier (P-H3). Frame it the way production does.
      const [original] = new RdoFramer().ingest('C 1234 sel 456 get srvName;');
      const parsed = RdoProtocol.parse(original);
      const formatted = RdoProtocol.format(parsed);
      expect(formatted).toBe('C 1234 sel 456 get srvName');
    });

    it('never lets the frame terminator reach the member name', () => {
      // The artifact above is gone at the source: parse() drops the terminator,
      // so an unframed string round-trips exactly like a framed one.
      const parsed = RdoProtocol.parse('C 1234 sel 456 get srvName;');
      expect(parsed.member).toBe('srvName');
      expect(RdoProtocol.format(parsed)).toBe('C 1234 sel 456 get srvName');
    });

    it('still refuses to emit a member name that is not an identifier', () => {
      // The guard the test above used to carry, stated on its own terms: format()
      // rejects a non-identifier whatever put it there (P-H3).
      expect(() => RdoProtocol.format({
        raw: '',
        type: 'PUSH',
        verb: RdoVerb.SEL,
        targetId: '456',
        action: RdoAction.GET,
        member: 'srvName;',
      })).toThrow(RdoIdentifierError);
    });
  });

  describe('sel 0 validation (null pointer guard)', () => {
    it('should reject targetId "0" for SEL verb', () => {
      expect(() => RdoProtocol.format({
        raw: '', type: 'PUSH', verb: RdoVerb.SEL,
        targetId: '0', action: RdoAction.CALL,
        member: 'ObjectsInArea', args: ['#662', '#120', '#4', '#4']
      })).toThrow('Invalid RDO target ID');
    });

    it('should reject missing targetId for SEL verb', () => {
      expect(() => RdoProtocol.format({
        raw: '', type: 'PUSH', verb: RdoVerb.SEL,
        targetId: '', action: RdoAction.GET, member: 'ServerBusy'
      })).toThrow('Invalid RDO target ID');
    });

    it('should allow valid targetId for SEL verb', () => {
      expect(() => RdoProtocol.format({
        raw: '', type: 'PUSH', verb: RdoVerb.SEL,
        targetId: '8116248', action: RdoAction.GET, member: 'ServerBusy'
      })).not.toThrow();
    });

    it('should not affect IDOF verb (uses string names, not numeric IDs)', () => {
      expect(() => RdoProtocol.format({
        raw: '', type: 'PUSH', verb: RdoVerb.IDOF,
        targetId: 'DirectoryServer'
      })).not.toThrow();
    });
  });
});

describe('Malformed busy rejection "Aerror <n>" (WinSockRDOConnectionsServer.pas:812)', () => {
  // An overloaded server emits "A"+"error 17" with NO QueryId and NO ";" terminator.
  // Tier-4 conformity: the framer must isolate it so it never corrupts the next frame,
  // and the parser must surface errorCode 17 with no RID.

  describe('RdoFramer recovery', () => {
    it('separates "Aerror 17" glued to the next legitimate response', () => {
      const framer = new RdoFramer();
      const messages = framer.ingest('Aerror 17A55 ServerBusy="#0";');
      expect(messages).toEqual(['Aerror 17', 'A55 ServerBusy="#0"']);
    });

    it('separates "Aerror 17" glued to a following push', () => {
      const framer = new RdoFramer();
      const messages = framer.ingest('Aerror 17C sel 40133496 call RefreshTycoon "*" "%1","%2","#2","#33","#70";');
      expect(messages).toEqual(['Aerror 17', 'C sel 40133496 call RefreshTycoon "*" "%1","%2","#2","#33","#70"']);
    });

    it('holds a lone "Aerror 17" until the next byte proves the code is complete', () => {
      const framer = new RdoFramer();
      // No trailing byte yet — the error code could still be growing (chunk split)
      expect(framer.ingest('Aerror 1')).toEqual([]);
      // Next chunk completes the code AND starts the next frame
      expect(framer.ingest('7A56 res="#0";')).toEqual(['Aerror 17', 'A56 res="#0"']);
    });

    it('does NOT trigger on legitimate suffixed error responses', () => {
      const framer = new RdoFramer();
      const messages = framer.ingest('A17 error 5 getting ServerBusy;');
      expect(messages).toEqual(['A17 error 5 getting ServerBusy']);
    });

    it('does NOT trigger on "Aerror" text inside a quoted payload', () => {
      const framer = new RdoFramer();
      const messages = framer.ingest('A12 res="%Aerror 17 is just text";');
      expect(messages).toEqual(['A12 res="%Aerror 17 is just text"']);
    });
  });

  describe('RdoProtocol.parse classification', () => {
    it('parses "Aerror 17" as a RESPONSE with errorCode 17 and no RID', () => {
      const packet = RdoProtocol.parse('Aerror 17');
      expect(packet.type).toBe('RESPONSE');
      expect(packet.rid).toBeUndefined();
      expect(packet.errorCode).toBe(17);
      expect(packet.errorName).toBe('errServerBusy');
    });

    it('still parses regular error responses with RID normally', () => {
      const packet = RdoProtocol.parse('A42 error 17');
      expect(packet.rid).toBe(42);
      expect(packet.errorCode).toBe(17);
    });
  });
});

describe('RdoFramer — buffer overflow salvage (P-L6)', () => {
  const MAX_BUFFER_SIZE = 5 * 1024 * 1024;

  it('keeps the complete frames and drops only the unterminated tail', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const framer = new RdoFramer();

    // One complete frame, then a frame that never terminates. The old code
    // cleared the whole buffer, losing the response the first frame carried —
    // its request then waited out a full timeout for nothing (P-L7).
    const packets = framer.ingest('A42 res="#0";' + 'x'.repeat(MAX_BUFFER_SIZE));

    expect(packets).toEqual(['A42 res="#0"']);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Buffer exceeded 5242880 bytes'));
    // The framer is usable again straight away.
    expect(framer.ingest('A43 res="#0";')).toEqual(['A43 res="#0"']);
    error.mockRestore();
  });

  it('discards everything when no frame boundary was ever seen', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const framer = new RdoFramer();

    const packets = framer.ingest('x'.repeat(MAX_BUFFER_SIZE + 1));

    expect(packets).toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('keeping 0 bytes of complete frames'));
    expect(framer.ingest('A44 res="#0";')).toEqual(['A44 res="#0"']);
    error.mockRestore();
  });
});

describe('RdoProtocol.parse — responses that carry no QueryId', () => {
  it('surfaces the malformed busy rejection as an error code', () => {
    // "A"+"error <n>" with no QueryId and no ";" — an overloaded server
    // (WinSockRDOConnectionsServer.pas:812). Dropping it would lose the signal
    // that flips the session's busy flag.
    const packet = RdoProtocol.parse('A error 17');

    expect(packet.type).toBe('RESPONSE');
    expect(packet.errorCode).toBe(17);
    expect(packet.errorName).toBe('errServerBusy');
    expect(packet.payload).toBe('error 17');
  });

  it('names an error code the enum does not know', () => {
    const packet = RdoProtocol.parse('A error 99');

    expect(packet.errorCode).toBe(99);
    expect(packet.errorName).toBe('unknownError(99)');
  });

  it('keeps an unparsable answer whole rather than inventing a rid', () => {
    const packet = RdoProtocol.parse('Answer with no query id');

    expect(packet.type).toBe('RESPONSE');
    expect(packet.rid).toBeUndefined();
    expect(packet.errorCode).toBeUndefined();
    expect(packet.payload).toBe('Answer with no query id');
  });
});

describe('RdoProtocol.parse — call arguments', () => {
  it('yields an empty argument list for a bare fire-and-forget call', () => {
    // `ClientAware` takes no parameter (live capture); args must be [] and not
    // undefined, so a consumer can iterate without a guard.
    const packet = RdoProtocol.parse('C sel 8161308 call ClientAware "*"');

    expect(packet.member).toBe('ClientAware');
    expect(packet.separator).toBe('"*"');
    expect(packet.args).toEqual([]);
  });

  it('keeps a call with no separator at all as a bare member', () => {
    const packet = RdoProtocol.parse('C sel 8161308 call ClientAware');

    expect(packet.member).toBe('ClientAware');
    expect(packet.separator).toBeUndefined();
  });
});

describe('RdoProtocol.parse — a separator-like string inside a quoted argument (#915)', () => {
  // Delphi doubles a quote inside a string; rdo-types.ts:374 undoubles it.
  it('reads the separator after the member, not a "^" inside the chat text', () => {
    const packet = RdoProtocol.parse('C sel 100 call ChatMsg "*" "%a ""^"" b";');

    expect(packet.member).toBe('ChatMsg');
    expect(packet.separator).toBe('"*"');
    expect(packet.args).toEqual(['%a "^" b']);
  });

  it('reads the separator after the member in a CALL request too', () => {
    const packet = RdoProtocol.parse('C 7 sel 100 call ChatMsg "*" "%a ""^"" b";');

    expect(packet.type).toBe('REQUEST');
    expect(packet.rid).toBe(7);
    expect(packet.member).toBe('ChatMsg');
    expect(packet.separator).toBe('"*"');
    expect(packet.args).toEqual(['%a "^" b']);
  });

  it('regression guard (green before the fix): a "*" inside the chat text', () => {
    const packet = RdoProtocol.parse('C sel 100 call ChatMsg "*" "%a ""*"" b";');

    expect(packet.member).toBe('ChatMsg');
    expect(packet.separator).toBe('"*"');
    expect(packet.args).toEqual(['%a "*" b']);
  });

  it('regression guard (green before the fix): a comma inside a quoted argument', () => {
    const packet = RdoProtocol.parse('C sel 100 call ChatMsg "*" "%Crazz","%hello, world";');

    expect(packet.member).toBe('ChatMsg');
    expect(packet.separator).toBe('"*"');
    expect(packet.args).toEqual(['%Crazz', '%hello, world']);
  });
});

describe('RdoProtocol.format — injection guards on the unquoted positions', () => {
  // Every one of these values is spliced into the frame unquoted, at a position
  // the `repeat … until QueryTerm` loop of ExecQuery re-iterates
  // (RDOQueryServer.pas:133-160). An unvalidated value there becomes a second
  // sub-command the server executes, so format() is the chokepoint that must
  // refuse it — whatever the call site.
  it('refuses a target id that is not a decimal object id', () => {
    expect(() => RdoProtocol.format({
      raw: '', type: 'REQUEST', verb: RdoVerb.SEL, targetId: '42 call Evil "*" "',
      action: RdoAction.CALL, member: 'Foo',
    })).toThrow(/sel takes a decimal object id/);
  });

  it('refuses an action outside get / set / call', () => {
    expect(() => RdoProtocol.format({
      raw: '', type: 'REQUEST', verb: RdoVerb.SEL, targetId: '8161308',
      action: 'exec' as RdoAction, member: 'Foo',
    })).toThrow(/Invalid RDO action/);
  });

  it('refuses a separator that is neither of the two ReturnMarker literals', () => {
    expect(() => RdoProtocol.format({
      raw: '', type: 'REQUEST', verb: RdoVerb.SEL, targetId: '8161308',
      action: RdoAction.CALL, member: 'Foo', separator: '"x"',
    })).toThrow(/Invalid RDO separator/);
  });
});

describe('RdoProtocol.format — argument literals', () => {
  function callFrame(args: string[]): string {
    return RdoProtocol.format({
      raw: '', type: 'REQUEST', verb: RdoVerb.SEL, targetId: '8161308',
      action: RdoAction.CALL, member: 'Foo', separator: '"^"', args,
    });
  }

  it('passes a well-formed literal through without re-encoding it', () => {
    // Re-encoding would run encodeAnsi a second time, which is lossy once the
    // CP1252 band is active (shared/cp1252.ts, lot L11).
    expect(callFrame(['"%Caf\u00e9"'])).toBe('C sel 8161308 call Foo "^" "%Café"');
  });

  it('quotes a bare typed token', () => {
    expect(callFrame(['#42'])).toBe('C sel 8161308 call Foo "^" "#42"');
  });

  it('strips a stray pair of outer quotes before re-escaping', () => {
    // Unbalanced literal: outer quotes present, body carries an unescaped one.
    expect(callFrame(['"%a"b"'])).toBe('C sel 8161308 call Foo "^" "%a""b"');
  });

  it('honours a declared prefix while escaping a quote in the body', () => {
    expect(callFrame(['%Say "hi"'])).toBe('C sel 8161308 call Foo "^" "%Say ""hi"""');
  });

  it('leaves a numeric CALL argument as a widestring', () => {
    // Numeric usernames and passwords must not be mistyped as ordinals —
    // Delphi Logon expects OLEString parameters.
    expect(callFrame(['12345'])).toBe('C sel 8161308 call Foo "^" "%12345"');
  });
});

describe('RdoProtocol.format — verbless packets', () => {
  it('emits the payload as-is when there is no verb to build from', () => {
    // The relay path: a packet carrying only a pre-built payload (no verb, no
    // action) is passed through rather than being rebuilt from parts.
    expect(RdoProtocol.format({ raw: '', type: 'RESPONSE', rid: 42, payload: 'res="#0"' }))
      .toBe('C 42 res="#0"');
  });

  it('emits the bare prefix when there is neither verb nor payload', () => {
    expect(RdoProtocol.format({ raw: '', type: 'RESPONSE' })).toBe('C');
  });
});

describe('RdoProtocol.parse — degenerate commands', () => {
  it('returns a bare packet for a command with no content at all', () => {
    const packet = RdoProtocol.parse('C');

    expect(packet.type).toBe('PUSH');
    expect(packet.verb).toBeUndefined();
    expect(packet.member).toBeUndefined();
  });

  it('ignores a sel with no action token', () => {
    const packet = RdoProtocol.parse('C sel 8161308');

    expect(packet.verb).toBe(RdoVerb.SEL);
    expect(packet.targetId).toBeUndefined();
    expect(packet.action).toBeUndefined();
  });

  it('ignores a third token that is not get, set or call', () => {
    const packet = RdoProtocol.parse('C sel 8161308 frobnicate Foo');

    expect(packet.targetId).toBe('8161308');
    expect(packet.action).toBeUndefined();
    expect(packet.member).toBeUndefined();
  });

  it('skips empty argument slots rather than emitting empty strings', () => {
    const withHoles = RdoProtocol.parse('C sel 8161308 call Foo "^" "#1",,"#2",');
    const control = RdoProtocol.parse('C sel 8161308 call Foo "^" "#1","#2"');

    // An empty slot and a trailing comma must not shift the argument indices —
    // that is what would put a value on the wrong Delphi parameter.
    expect(withHoles.args).toEqual(control.args);
    expect(withHoles.args).toHaveLength(2);
  });
});

describe('RdoProtocol.format — incomplete packets', () => {
  it('emits nothing for the target when an idof carries no name', () => {
    expect(RdoProtocol.format({ raw: '', type: 'REQUEST', verb: RdoVerb.IDOF }))
      .toBe('C idof');
  });

  it('emits the action alone when there is no member', () => {
    expect(RdoProtocol.format({
      raw: '', type: 'REQUEST', verb: RdoVerb.SEL, targetId: '8161308', action: RdoAction.CALL,
    })).toBe('C sel 8161308 call "*"');
  });

  it('emits an empty assignment for a set with no value', () => {
    expect(RdoProtocol.format({
      raw: '', type: 'REQUEST', verb: RdoVerb.SEL, targetId: '8161308',
      action: RdoAction.SET, member: 'Name',
    })).toBe('C sel 8161308 set Name="%"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Lot C — the equivalence every migrated call site rests on
// ═══════════════════════════════════════════════════════════════════════════

describe('an omitted separator and an explicit "^" are the same frame', () => {
  /**
   * Roughly forty call sites used to omit `separator` on a CALL and let
   * `format()` default it from the presence of a QueryId (`rdo.ts:425`). The
   * migration makes it explicit, because `rdoCall` derives it from the member's
   * catalogued kind rather than from the transport.
   *
   * That changes the intermediate object, so tests that compare packets by
   * deep equality see a new key. It does not change the wire, and this is where
   * that is established once instead of at every migrated site.
   */
  const base = {
    raw: '', type: 'REQUEST' as const, rid: 7,
    verb: RdoVerb.SEL, targetId: '8161308', action: RdoAction.CALL,
    member: 'ObjectAt', args: ['"#120"', '"#64"'],
  };

  it('produces byte-identical output with and without the explicit separator', () => {
    const implicit = RdoProtocol.format(base);
    const explicit = RdoProtocol.format({ ...base, separator: '"^"' });

    expect(explicit).toBe(implicit);
    expect(explicit).toBe('C 7 sel 8161308 call ObjectAt "^" "#120","#64"');
  });

  it('accepts the bare "^" two chat sites used, and quotes it the same way', () => {
    // chat-handler wrote `separator: '^'` on GetChannelInfo and JoinChannel,
    // with a comment noting the inconsistency. format() strips and re-quotes
    // (`rdo.ts:437-444`), so all three spellings are one frame.
    expect(RdoProtocol.format({ ...base, separator: '^' }))
      .toBe(RdoProtocol.format({ ...base, separator: '"^"' }));
  });

  it('treats an empty args array and an absent one as the same frame', () => {
    // `rdoCall` always sets `args`, so a zero-argument member now carries `[]`
    // where the hand-built packet omitted the key. format() guards on
    // `args.length > 0` (`rdo.ts:447`), so both take the same branch.
    const zeroArg = { ...base, member: 'GetUserList', args: undefined as string[] | undefined };
    delete zeroArg.args;

    expect(RdoProtocol.format({ ...zeroArg, args: [] })).toBe(RdoProtocol.format(zeroArg));
    expect(RdoProtocol.format({ ...zeroArg, args: [] })).toBe('C 7 sel 8161308 call GetUserList "^"');
  });

  it('still defaults to "*" when there is no QueryId — the push path', () => {
    const { rid, ...noRid } = base;

    expect(RdoProtocol.format(noRid)).toBe('C sel 8161308 call ObjectAt "*" "#120","#64"');
  });
});
