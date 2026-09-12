/**
 * Protocol validation tests for Company Creation via RDO.
 *
 * Our gateway calls InterfaceServer.NewCompany(name, cluster) — 2 params.
 * The IS fills in the username from the session automatically.
 * The IS internally calls World.RDONewCompany(username, name, cluster) — 3 params.
 *
 * Response is always a widestring (IS casts to widestring):
 *   Success: res="%[CompanyName,CompanyId]"
 *   Error:   res="%<errorCode>"  (string, not integer)
 */

import { describe, it, expect } from '@jest/globals';
import { RdoCommand, RdoValue } from '../../../shared/rdo-types';

describe('Company Creation RDO Protocol', () => {
  const worldContextId = '#987654';

  describe('NewCompany command format', () => {
    it('should build RDO command with 2 args: name and cluster (no username)', () => {
      const cmd = RdoCommand
        .sel(worldContextId)
        .call('NewCompany')
        .method()
        .args(
          RdoValue.string('My Company'),
          RdoValue.string('PGI')
        )
        .build();

      expect(cmd).toContain('sel #987654');
      expect(cmd).toContain('call NewCompany');
      expect(cmd).toContain('"^"');
      expect(cmd).toContain('"%My Company"');
      expect(cmd).toContain('"%PGI"');
    });

    it('should NOT include username in args — IS fills it from session', () => {
      const cmd = RdoCommand
        .sel(worldContextId)
        .call('NewCompany')
        .method()
        .args(
          RdoValue.string('TestCo'),
          RdoValue.string('Dissidents')
        )
        .build();

      // Count "% occurrences in the args portion (after "^")
      const argsSection = cmd.split('"^"')[1] || '';
      const stringArgCount = (argsSection.match(/"%/g) || []).length;
      expect(stringArgCount).toBe(2);
    });

    it('should use variant separator (^) for function return', () => {
      const cmd = RdoCommand
        .sel(worldContextId)
        .call('NewCompany')
        .method()
        .args(
          RdoValue.string('name'),
          RdoValue.string('cluster')
        )
        .build();

      expect(cmd).toContain('"^"');
      expect(cmd).not.toContain('"*"');
    });
  });

  describe('Response parsing', () => {
    it('should match success response: res="%[Name,Id]"', () => {
      const payload = 'res="%[TestCo,99]"';
      const resMatch = /res="%(.*)"/.exec(payload);
      expect(resMatch).not.toBeNull();
      expect(resMatch![1]).toBe('[TestCo,99]');

      const companyMatch = /^\[(.+),(\d+)]$/.exec(resMatch![1]);
      expect(companyMatch).not.toBeNull();
      expect(companyMatch![1]).toBe('TestCo');
      expect(companyMatch![2]).toBe('99');
    });

    it('should match string-typed error: res="%6"', () => {
      const payload = 'res="%6"';
      const resMatch = /res="%(.*)"/.exec(payload);
      expect(resMatch).not.toBeNull();

      const resultStr = resMatch![1];
      // Not a [Name,Id] format
      const companyMatch = /^\[(.+),(\d+)]$/.exec(resultStr);
      expect(companyMatch).toBeNull();

      // Parse as numeric error code
      const errorCode = parseInt(resultStr, 10);
      expect(isNaN(errorCode)).toBe(false);
      expect(errorCode).toBe(6);
    });

    it('should fallback to integer-typed error: res="#11"', () => {
      const payload = 'res="#11"';
      const intMatch = /res="#(-?\d+)"/.exec(payload);
      expect(intMatch).not.toBeNull();
      expect(parseInt(intMatch![1], 10)).toBe(11);
    });

    it('should handle company names with special characters', () => {
      const payload = 'res="%[Star & Moon Co.,42]"';
      const resMatch = /res="%(.*)"/.exec(payload);
      const companyMatch = /^\[(.+),(\d+)]$/.exec(resMatch![1]);
      expect(companyMatch).not.toBeNull();
      expect(companyMatch![1]).toBe('Star & Moon Co.');
      expect(companyMatch![2]).toBe('42');
    });

    it('should handle large company IDs', () => {
      const payload = 'res="%[Big Corp,7148036]"';
      const resMatch = /res="%(.*)"/.exec(payload);
      const companyMatch = /^\[(.+),(\d+)]$/.exec(resMatch![1]);
      expect(companyMatch).not.toBeNull();
      expect(companyMatch![2]).toBe('7148036');
    });
  });
});
