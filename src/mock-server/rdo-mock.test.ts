/**
 * Unit tests for RdoMock — the L1 matcher answers only a frame matching every key an exchange
 * declares; the member-/verb-only path exists only for exchanges that give a `looseMatch` reason.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { RdoMock } from './rdo-mock';
import type { RdoExchange, RdoMatchKey } from './types/rdo-exchange-types';

function ex(id: string, matchKeys: RdoMatchKey, extra?: Partial<RdoExchange>): RdoExchange {
  return { id, request: '', response: `A1 res="%${id}"`, matchKeys, ...extra };
}

const PINNED: RdoMatchKey = {
  verb: 'sel', targetId: '100', action: 'call', member: 'Foo', argsPattern: ['"#1"'],
};

describe('RdoMock', () => {
  let mock: RdoMock;

  beforeEach(() => {
    mock = new RdoMock();
  });

  describe('target', () => {
    it('refuses a wrong-target frame for an exchange that pins its target', () => {
      mock.addExchange(ex('pinned', PINNED));
      expect(mock.match('C 1 sel 200 call Foo "^" "#1"')).toBeNull();
      expect(mock.match('C 1 sel 100 call Foo "^" "#1"')?.exchange.id).toBe('pinned');
    });

    it('answers the wrong-target frame only when the exchange carries a looseMatch reason', () => {
      mock.addExchange(ex('loose', PINNED, { looseMatch: 'any Foo will do here' }));
      expect(mock.match('C 1 sel 200 call Foo "^" "#1"')?.exchange.id).toBe('loose');
    });

    it('treats an empty or blank looseMatch as absent', () => {
      mock.addExchange(ex('empty', PINNED, { looseMatch: '' }));
      mock.addExchange(ex('blank', PINNED, { looseMatch: '   ' }));
      expect(mock.match('C 1 sel 200 call Foo "^" "#1"')).toBeNull();
    });

    it('checks a pinned target on an exchange without argsPattern', () => {
      mock.addExchange(ex('no-args', { verb: 'sel', targetId: '100', action: 'call', member: 'Foo' }));
      expect(mock.match('C 1 sel 100 call Foo "^" "#9"')?.exchange.id).toBe('no-args');
      expect(mock.match('C 1 sel 200 call Foo "^" "#9"')).toBeNull();
    });

    it('accepts any target when the target is "*"', () => {
      mock.addExchange(ex('wild', { verb: 'sel', targetId: '*', action: 'call', member: 'Foo', argsPattern: ['"#1"'] }));
      expect(mock.match('C 1 sel 555 call Foo "^" "#1"')?.exchange.id).toBe('wild');
    });
  });

  describe('verb and action', () => {
    it('refuses a wrong verb or a wrong action', () => {
      mock.addExchange(ex('call', { verb: 'sel', action: 'call', member: 'Foo' }));
      expect(mock.match('C 1 sel 100 get Foo')).toBeNull();
      expect(mock.match('C 1 idof "Foo"')).toBeNull();
      expect(mock.match('C 1 sel 100 call Foo "^"')?.exchange.id).toBe('call');
    });
  });

  describe('argsPattern arity', () => {
    beforeEach(() => {
      mock.addExchange(ex('two', { verb: 'sel', action: 'call', member: 'Foo', argsPattern: ['"#1"', '*'] }));
    });

    it('refuses an extra trailing argument', () => {
      expect(mock.match('C 1 sel 100 call Foo "^" "#1","%x","%extra"')).toBeNull();
    });

    it('refuses one argument too few, and no argument at all', () => {
      expect(mock.match('C 1 sel 100 call Foo "^" "#1"')).toBeNull();
      expect(mock.match('C 1 sel 100 call Foo "^"')).toBeNull();
    });

    it('answers the exact count, "*" leaving a position unpinned', () => {
      expect(mock.match('C 1 sel 100 call Foo "^" "#1","%anything"')?.exchange.id).toBe('two');
    });

    it('refuses a pinned position with another value', () => {
      expect(mock.match('C 1 sel 100 call Foo "^" "#2","%x"')).toBeNull();
    });

    it('an empty argsPattern answers only a frame with no argument', () => {
      mock.addExchange(ex('none', { verb: 'sel', action: 'call', member: 'Bar', argsPattern: [] }));
      expect(mock.match('C 1 sel 100 call Bar "^"')?.exchange.id).toBe('none');
      expect(mock.match('C 1 sel 100 call Bar "^" "#1"')).toBeNull();
    });
  });

  describe('member-only exchanges', () => {
    it('answer nothing without looseMatch', () => {
      mock.addExchange(ex('bare', { member: 'Foo' }));
      mock.addExchange(ex('bare-star', { member: 'Foo', targetId: '*' }));
      expect(mock.match('C 1 sel 100 call Foo "^" "#1"')).toBeNull();
    });

    it('answer any frame for the member with looseMatch', () => {
      mock.addExchange(ex('bare', { member: 'Foo' }, { looseMatch: 'catch-all for this test' }));
      expect(mock.match('C 1 sel 100 call Foo "^" "#1"')?.exchange.id).toBe('bare');
      expect(mock.match('C 1 sel 7 get Foo')?.exchange.id).toBe('bare');
      expect(mock.match('C 1 sel 7 get Other')).toBeNull();
    });

    it('with target "*" behave the same', () => {
      mock.addExchange(ex('bare-star', { member: 'Foo', targetId: '*' }, { looseMatch: 'reason' }));
      expect(mock.match('C 1 sel 100 call Foo "^" "#1"')?.exchange.id).toBe('bare-star');
    });
  });

  describe('idof', () => {
    it('answers the exact name only', () => {
      mock.addExchange(ex('ds', { verb: 'idof', targetId: 'DirectoryServer' }));
      expect(mock.match('C 0 idof "DirectoryServer"')?.exchange.id).toBe('ds');
      expect(mock.match('C 0 idof "Other"')).toBeNull();
    });

    it('a "*" idof exchange answers nothing without looseMatch, anything with it', () => {
      mock.addExchange(ex('any', { verb: 'idof', targetId: '*' }));
      expect(mock.match('C 0 idof "Other"')).toBeNull();

      mock.clearScenarios();
      mock.addExchange(ex('any', { verb: 'idof', targetId: '*' }, { looseMatch: 'every name' }));
      expect(mock.match('C 0 idof "Other"')?.exchange.id).toBe('any');
    });

    it('a loose idof exchange naming another object is not answered', () => {
      mock.addExchange(ex('named', { verb: 'idof', targetId: 'X' }, { looseMatch: 'reason' }));
      expect(mock.match('C 0 idof "Y"')).toBeNull();
    });
  });

  describe('pushOnly and SET frames', () => {
    it('a pushOnly exchange never answers, loose or not', () => {
      mock.addExchange(ex('push', { verb: 'sel', action: 'call', member: 'Foo' }, { pushOnly: true }));
      mock.addExchange(ex('push-loose', { member: 'Foo' }, { pushOnly: true, looseMatch: 'reason' }));
      mock.addExchange(ex('push-idof', { verb: 'idof', targetId: 'X' }, { pushOnly: true }));
      expect(mock.match('C 1 sel 100 call Foo "^"')).toBeNull();
      expect(mock.match('C 0 idof "X"')).toBeNull();
    });

    it('matches a SET frame on the bare property name', () => {
      mock.addExchange(ex('set', { verb: 'sel', action: 'set', member: 'Foo' }));
      expect(mock.match('C 1 sel 100 set Foo="#1"')?.exchange.id).toBe('set');
    });

    it('an exchange without matchKeys answers nothing', () => {
      mock.addExchange({ id: 'raw', request: 'C 1 sel 1 call Foo "^"', response: 'A1' });
      expect(mock.match('C 1 sel 1 call Foo "^"')).toBeNull();
    });
  });

  describe('precedence and bookkeeping', () => {
    it('prefers the exact match, then an argsPattern exchange over a no-args one', () => {
      mock.addExchange(ex('no-args', { verb: 'sel', action: 'call', member: 'Foo' }));
      mock.addExchange(ex('args', { verb: 'sel', action: 'call', member: 'Foo', argsPattern: ['"#1"'] }));
      mock.addExchange(ex('exact', PINNED));
      expect(mock.match('C 1 sel 100 call Foo "^" "#1"')?.exchange.id).toBe('exact');
      expect(mock.match('C 1 sel 200 call Foo "^" "#1"')?.exchange.id).toBe('args');
      expect(mock.match('C 1 sel 200 call Foo "^" "#2"')?.exchange.id).toBe('no-args');
    });

    it('prefers a precise exchange over a loose one declared first', () => {
      mock.addExchange(ex('loose', { member: 'Foo' }, { looseMatch: 'reason' }));
      mock.addExchange(ex('precise', { verb: 'sel', action: 'call', member: 'Foo' }));
      expect(mock.match('C 1 sel 1 call Foo "^"')?.exchange.id).toBe('precise');
    });

    it('substitutes variables, tracks consumption, and resets', () => {
      mock.addScenario({
        name: 's', description: 'd', variables: {},
        exchanges: [ex('v', { verb: 'sel', action: 'call', member: 'Foo' }, {
          response: 'A1 res="%{{username}}"', pushes: ['C sel 1 call Push "*" "%{{username}}"'],
        })],
      });
      const result = mock.match('C 1 sel 1 call Foo "^"', { username: 'Zed' });
      expect(result?.response).toBe('A1 res="%Zed"');
      expect(result?.pushes).toEqual(['C sel 1 call Push "*" "%Zed"']);
      expect(mock.getConsumedIds()).toEqual(new Set(['v']));

      mock.reset();
      expect(mock.getConsumedIds().size).toBe(0);

      mock.clearScenarios();
      expect(mock.match('C 1 sel 1 call Foo "^"')).toBeNull();
    });
  });
});
