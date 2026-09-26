/**
 * RDO wire test — RDOQueueResearch / RDOCancelResearch, driven through the
 * production emitter (`setBuildingProperty` and its research argument builder in
 * building-property-handler.ts), written fire-and-forget on the construction
 * socket with the building's CurrBlock as target.
 */

import { describe, it, expect } from '@jest/globals';
import { makeSessionCtx } from '../session/fake-session-context';
import { setBuildingProperty } from '../../session/building-property-handler';

const BLOCK = '127839460';

async function emit(member: string, params: Record<string, string>): Promise<{ success: boolean; frames: string[] }> {
  const fake = makeSessionCtx({ sockets: ['construction'] });
  fake.cacher.createObject.mockResolvedValue('temp-1');
  fake.cacher.getPropertyList.mockResolvedValue([BLOCK, BLOCK]);
  const result = await setBuildingProperty(fake.ctx, 10, 20, member, '0', params);
  return { success: result.success, frames: fake.frames.construction };
}

describe('Research wire frames (setBuildingProperty)', () => {
  it('RDOQueueResearch carries the invention and the given priority', async () => {
    const r = await emit('RDOQueueResearch', { inventionId: 'GreenTech.Level1', priority: '15' });
    expect(r.success).toBe(true);
    expect(r.frames).toEqual([`C sel ${BLOCK} call RDOQueueResearch "*" "%GreenTech.Level1","#15";`]);
  });

  it('RDOQueueResearch defaults the priority to 10', async () => {
    const r = await emit('RDOQueueResearch', { inventionId: 'GreenTech.Level1' });
    expect(r.success).toBe(true);
    expect(r.frames).toEqual([`C sel ${BLOCK} call RDOQueueResearch "*" "%GreenTech.Level1","#10";`]);
  });

  it('RDOCancelResearch carries the invention only', async () => {
    const r = await emit('RDOCancelResearch', { inventionId: 'GreenTech.Level1' });
    expect(r.success).toBe(true);
    expect(r.frames).toEqual([`C sel ${BLOCK} call RDOCancelResearch "*" "%GreenTech.Level1";`]);
  });
});
