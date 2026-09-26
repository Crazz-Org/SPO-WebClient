/**
 * Self-test of `toPassStrictRdoValidation`: it judges the frames the client emitted
 * against a scenario, never the scenario's own requests.
 */
import type { RdoScenario } from '../../../mock-server/types/rdo-exchange-types';
import { rdoMatchers } from './rdo-matchers';

const SCENARIO: RdoScenario = {
  name: 'matcher-self-test',
  description: 'one "^" function exchange and one idof exchange',
  variables: {},
  exchanges: [
    {
      id: 'self-test-call',
      request: 'C 1 sel 8161308 call ObjectAt "^" "#10","#20";',
      response: 'A1 res="#1";',
      matchKeys: {
        verb: 'sel',
        targetId: '8161308',
        action: 'call',
        member: 'ObjectAt',
        argsPattern: ['"#10"', '"#20"'],
      },
    },
    {
      id: 'self-test-idof',
      request: 'C 2 idof "DirectoryServer"',
      response: 'A2 objid="39751288";',
      matchKeys: { verb: 'idof', targetId: 'DirectoryServer' },
    },
  ],
};

/** The frames under test, each as a client could emit it. */
const CONFORMING = 'C sel 8161308 call ObjectAt "^" "#10","#20";';
const WRONG_SEPARATOR = 'C sel 8161308 call ObjectAt "*" "#10","#20";';
const EXTRA_ARG = 'C sel 8161308 call ObjectAt "^" "#10","#20","#30";';
const WRONG_PREFIX = 'C sel 8161308 call ObjectAt "^" "%10","#20";';
const UNCOVERED_MEMBER = 'C sel 8161308 call ObjectsAt "^" "#10","#20";';
const COVERED_IDOF = 'C 5 idof "DirectoryServer"';
const UNCOVERED_IDOF = 'C 5 idof "InterfaceServer"';
const NO_FRAMES: string[] = [];
const SECOND_BAD = [CONFORMING, WRONG_SEPARATOR];

describe('toPassStrictRdoValidation — validates the frames the client emitted', () => {
  it('passes a conforming frame', () => {
    expect(CONFORMING).toPassStrictRdoValidation(SCENARIO);
  });

  it('fails a "*" frame for a "^" exchange', () => {
    expect(WRONG_SEPARATOR).not.toPassStrictRdoValidation(SCENARIO);
  });

  it('fails a frame carrying an extra argument', () => {
    expect(EXTRA_ARG).not.toPassStrictRdoValidation(SCENARIO);
  });

  it('fails a frame whose argument carries the wrong type prefix', () => {
    expect(WRONG_PREFIX).not.toPassStrictRdoValidation(SCENARIO);
  });

  it('fails a frame whose member no exchange covers', () => {
    expect(UNCOVERED_MEMBER).not.toPassStrictRdoValidation(SCENARIO);
  });

  it('fails an empty frame list', () => {
    expect(NO_FRAMES).not.toPassStrictRdoValidation(SCENARIO);
  });

  it('fails a list whose second frame is bad', () => {
    expect(SECOND_BAD).not.toPassStrictRdoValidation(SCENARIO);
  });

  it('passes the matching idof frame', () => {
    expect(COVERED_IDOF).toPassStrictRdoValidation(SCENARIO);
  });

  it('fails an idof frame for a name no exchange covers', () => {
    expect(UNCOVERED_IDOF).not.toPassStrictRdoValidation(SCENARIO);
  });

  it('names the frames and the scenario in its messages', () => {
    const good = rdoMatchers.toPassStrictRdoValidation([CONFORMING], SCENARIO);
    expect(good.pass).toBe(true);
    expect(good.message()).toContain('matcher-self-test');
    expect(good.message()).toContain('call ObjectAt');

    const bad = rdoMatchers.toPassStrictRdoValidation(WRONG_SEPARATOR, SCENARIO);
    expect(bad.pass).toBe(false);
    expect(bad.message()).toContain('separator mismatch');
    expect(bad.message()).toContain('"*" "#10","#20"');

    const empty = rdoMatchers.toPassStrictRdoValidation(NO_FRAMES, SCENARIO);
    expect(empty.pass).toBe(false);
    expect(empty.message()).toContain('no emitted frame to validate');
  });

  it('fails a list holding a non-string', () => {
    const received = [42] as unknown as string[];
    expect(rdoMatchers.toPassStrictRdoValidation(received, SCENARIO).pass).toBe(false);
  });
});
