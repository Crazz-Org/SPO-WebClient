/**
 * Building inspector — the General-tab property writes, byte for byte.
 *
 * Drives `setBuildingProperty` (src/server/session/building-property-handler.ts) down its
 * direct-property path (`'property'` + `additionalParams.propertyName`) and pins the literal
 * frame the construction socket receives. Only writes no other production-driven suite pins
 * live here: every KNOWN_RDO_COMMANDS call is pinned by the command matrix of
 * building-property-handler.test.ts, and Interest / Name / Commercials by its
 * 'direct property set' block. CurrBlock and ObjectId differ, so a frame on the wrong id fails.
 */
import { setBuildingProperty } from '../../session/building-property-handler';
import { makeSessionCtx } from '../session/fake-session-context';
import type { FakeSessionCtx } from '../session/fake-session-context';

const CURR_BLOCK = '40133497';
const OBJECT_ID = '40133512';
const X = 459;
const Y = 389;

function makeInspectorCtx(): FakeSessionCtx {
  const fake = makeSessionCtx({ sockets: ['construction'] });
  fake.cacher.createObject.mockResolvedValue('cacher-obj-1');
  fake.cacher.getPropertyList.mockImplementation(async (_id: string, props: string[]) =>
    (props[0] === 'CurrBlock' ? [CURR_BLOCK, OBJECT_ID] : ['']));
  return fake;
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('General tabs — direct property writes (setBuildingProperty)', () => {
  it.each([
    { propertyName: 'Stopped', value: '-1', frame: 'C sel 40133497 set Stopped="#-1";' }, // Close — WordBool true, never #1
    { propertyName: 'Stopped', value: '0', frame: 'C sel 40133497 set Stopped="#0";' }, // Open
    { propertyName: 'Rent', value: '120', frame: 'C sel 40133497 set Rent="#120";' },
    { propertyName: 'Maintenance', value: '80', frame: 'C sel 40133497 set Maintenance="#80";' },
    { propertyName: 'HoursOnAir', value: '75', frame: 'C sel 40133497 set HoursOnAir="#75";' },
    { propertyName: 'Name', value: '', frame: 'C sel 40133497 set Name="%";' }, // widestring, empty clears
  ])('$propertyName=$value is sent as $frame', async ({ propertyName, value, frame }) => {
    const fake = makeInspectorCtx();
    const pending = setBuildingProperty(fake.ctx, X, Y, 'property', value, { propertyName });
    await jest.advanceTimersByTimeAsync(200); // the fire-and-forget branch sleeps 200 ms
    const result = await pending;
    expect(result.success).toBe(true);
    expect(fake.frames.construction).toEqual([frame]);
    expect(fake.sent).toEqual([]); // a property write never uses the request channel
  });
});
