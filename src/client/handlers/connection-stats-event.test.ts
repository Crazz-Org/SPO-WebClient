import { WsMessageType } from '@/shared/types';
import type { WsMessage } from '@/shared/types';
import { dispatchEvent } from './event-handler';
import { connectionStats } from '../connection-stats';
import type { ClientHandlerContext } from './client-context';

const ctx = {} as ClientHandlerContext;

describe('EVENT_CONNECTION_STATS', () => {
  beforeEach(() => {
    connectionStats.reset();
  });

  it('lands the gateway-measured latency in connectionStats', () => {
    dispatchEvent(ctx, {
      type: WsMessageType.EVENT_CONNECTION_STATS,
      latencyMs: 87,
      samples: 4,
    } as unknown as WsMessage);

    const snap = connectionStats.snapshot();
    expect(snap.latencyMs).toBe(87);
    expect(snap.latencySamples).toBe(4);
  });

  it('keeps latencyMs null when the gateway has no sample yet', () => {
    dispatchEvent(ctx, {
      type: WsMessageType.EVENT_CONNECTION_STATS,
      latencyMs: null,
      samples: 0,
    } as unknown as WsMessage);

    const snap = connectionStats.snapshot();
    expect(snap.latencyMs).toBeNull();
    expect(snap.latencySamples).toBe(0);
  });
});
