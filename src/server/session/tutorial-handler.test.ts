/// <reference path="../__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `tutorial-handler` — the state read and the four actions, driven against the
 * shared fake `SessionContext`.
 *
 * The two things worth failing on are both degenerate: a tycoon with no
 * assignment must decode to `null` rather than to an empty one, and an action
 * with no live task must emit NOTHING — binding an RDO proxy to object 0 is a
 * request with no destination.
 */

import { makeSessionCtx } from '../__tests__/session/fake-session-context';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { fetchTutorialState, runTutorialAction, TUTORIAL_PROPS } from './tutorial-handler';

/** A fully populated tycoon folder, in TUTORIAL_PROPS order. */
const LIVE_VALUES = [
  '1', '130600501', 'GrowMoney', 'Make Profit', '2', '66', '$5,000,000', '-1', 'Yellow Inc.', 'Shamba',
];

function makeCtx(values: string[] | undefined, opts: { sockets?: string[] } = {}) {
  const fake = makeSessionCtx({
    cachedUsername: 'SPO_test3',
    sockets: opts.sockets ?? ['construction'],
  });
  fake.cacher.createObject.mockResolvedValue('7742');
  if (values) fake.cacher.getPropertyList.mockResolvedValue(values);
  return fake;
}

describe('fetchTutorialState — the read', () => {
  it('decodes a populated tycoon folder', async () => {
    const fake = makeCtx(LIVE_VALUES);

    const state = await fetchTutorialState(fake.ctx);

    expect(state).toEqual({
      taskObjId: '130600501',
      kindId: 'GrowMoney',
      name: 'Make Profit',
      stage: 2,
      progress: 66,
      goal: '$5,000,000',
      done: true,
      company: 'Yellow Inc.',
      town: 'Shamba',
    });
    // The tycoon folder, by path — the same convention queryTycoonPoliticalRole uses.
    expect(fake.cacher.setPath).toHaveBeenCalledWith('7742', 'Tycoons\\SPO_test3.five\\');
    expect(fake.cacher.getPropertyList).toHaveBeenCalledWith('7742', [...TUTORIAL_PROPS]);
    // The temp object is always given back.
    expect(fake.cacher.closeObject).toHaveBeenCalledWith('7742');
  });

  it('accepts the three renderings Delphi WriteBoolean can produce for TaskDone', async () => {
    for (const [raw, expected] of [['1', true], ['-1', true], ['TRUE', true], ['0', false], ['', false]] as const) {
      const values = [...LIVE_VALUES];
      values[7] = raw;
      const state = await fetchTutorialState(makeCtx(values).ctx);
      expect(state?.done).toBe(expected);
    }
  });

  it('is null when ActiveTutorial is empty — the TycoonOptions.asp:12 test', async () => {
    const values = [...LIVE_VALUES];
    values[0] = '';
    expect(await fetchTutorialState(makeCtx(values).ctx)).toBeNull();
  });

  it('is null when TutorialId is empty — the Tutorial.asp:26 test', async () => {
    const values = [...LIVE_VALUES];
    values[2] = '';
    expect(await fetchTutorialState(makeCtx(values).ctx)).toBeNull();
  });

  it('is null when TutorialObjId is 0 — there would be nothing to bind', async () => {
    const values = [...LIVE_VALUES];
    values[1] = '0';
    expect(await fetchTutorialState(makeCtx(values).ctx)).toBeNull();
  });

  it('is null for every-name-empty, the shape an unresolved path answers with', async () => {
    expect(await fetchTutorialState(makeCtx(TUTORIAL_PROPS.map(() => '')).ctx)).toBeNull();
  });

  it('is null with no round-trip when the session has no tycoon name', async () => {
    const fake = makeSessionCtx({ sockets: ['construction'] });
    expect(await fetchTutorialState(fake.ctx)).toBeNull();
    expect(fake.ctx.cacherCreateObject).not.toHaveBeenCalled();
  });

  it('falls back to activeUsername when there is no cached directory name', async () => {
    const fake = makeSessionCtx({ activeUsername: 'Crazz', sockets: ['construction'] });
    fake.cacher.createObject.mockResolvedValue('7742');
    fake.cacher.getPropertyList.mockResolvedValue(LIVE_VALUES);

    await fetchTutorialState(fake.ctx);

    expect(fake.cacher.setPath).toHaveBeenCalledWith('7742', 'Tycoons\\Crazz.five\\');
  });
});

describe('runTutorialAction — the four actions', () => {
  it.each([
    ['next', 'RDONextStep'],
    ['prev', 'RDOPrevStep'],
    ['close', 'RDOClose'],
  ] as const)('%s emits one fire-and-forget %s bound to TutorialObjId', async (action, member) => {
    const fake = makeCtx(LIVE_VALUES);

    const result = await runTutorialAction(fake.ctx, action);

    expect(result.success).toBe(true);
    expect(fake.frames.construction).toHaveLength(1);
    const frame = fake.frames.construction[0];
    expect(frame).toContain(`sel 130600501 call ${member}`);
    // A procedure: "*", never "^", and no QueryId to answer into.
    expect(frame).toContain('"*"');
    expect(frame).not.toContain('"^"');
    // The declared `useless : integer` (InformativeTask.pas:15-17).
    expect(frame).toContain('#0');
    // Fire-and-forget: nothing was sent through the request path.
    expect(fake.sent).toHaveLength(0);
    // The state is re-read afterwards, so the panel follows the server.
    expect(result.state).not.toBeNull();
  });

  it('prev still emits at stage 0 — the server no-ops it, the panel disables the button', async () => {
    const values = [...LIVE_VALUES];
    values[4] = '0';
    const fake = makeCtx(values);

    const result = await runTutorialAction(fake.ctx, 'prev');

    expect(result.success).toBe(true);
    expect(fake.frames.construction).toHaveLength(1);
  });

  it('complete writes Completed as a set and awaits the reply', async () => {
    const fake = makeCtx(LIVE_VALUES);
    fake.respond(() => 'res="#0"');

    const result = await runTutorialAction(fake.ctx, 'complete');

    expect(result.success).toBe(true);
    // No fire-and-forget frame: a `set` travels through the request path.
    expect(fake.frames.construction).toHaveLength(0);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].socketName).toBe('construction');
    expect(fake.sent[0].category).toBe(TimeoutCategory.NORMAL);
    expect(fake.sent[0].packet.action).toBe('set');
    expect(fake.sent[0].packet.member).toBe('Completed');
    expect(fake.sent[0].packet.targetId).toBe('130600501');
    // -1 is the Delphi WordBool TRUE.
    expect(fake.sent[0].packet.args).toEqual(['"#-1"']);
  });

  it('refuses with a legible message and emits NOTHING when there is no assignment', async () => {
    const fake = makeCtx(TUTORIAL_PROPS.map(() => ''));

    const result = await runTutorialAction(fake.ctx, 'next');

    expect(result).toEqual({ success: false, message: 'No active assignment', state: null });
    expect(fake.frames.construction).toHaveLength(0);
    expect(fake.sent).toHaveLength(0);
  });

  it('reports the failure when the construction socket is unavailable', async () => {
    const fake = makeCtx(LIVE_VALUES, { sockets: [] });

    const result = await runTutorialAction(fake.ctx, 'next');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Construction socket unavailable');
    expect(result.state).toBeNull();
    expect(fake.log.warn).toHaveBeenCalled();
  });

  it('reports the failure when the cache read itself throws', async () => {
    const fake = makeSessionCtx({ cachedUsername: 'SPO_test3', sockets: ['construction'] });
    fake.cacher.createObject.mockRejectedValue(new Error('Request timeout: CreateObject'));

    const result = await runTutorialAction(fake.ctx, 'close');

    expect(result).toEqual({
      success: false, message: 'Request timeout: CreateObject', state: null,
    });
  });
});
