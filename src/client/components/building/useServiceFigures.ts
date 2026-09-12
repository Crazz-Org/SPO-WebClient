/**
 * useServiceFigures — the live Offer / Demand pair of the SELECTED service.
 *
 * The General tab draws its service cards from the cached `srvSupplies{i}` /
 * `srvDemands{i}` columns, which only move when the whole tab is re-read every
 * 30 seconds. The reference client never showed those two figures from the
 * cache: `TServiceGeneralSheetHandler.threadedRefresh` binds the model-server
 * proxy to the block and reads `RDOGetDemand(CurrentFinger)` then
 * `RDOGetSupply(CurrentFinger)` on its own `tRefresh` timer
 * (Voyager/SrvGeneralSheetForm.pas:398-425, ~5 s per
 * doc/voyager-inspector-architecture.md:292).
 *
 * Two guards come from the same Pascal and are the reason this is a hook rather
 * than a call in the render path: `fQueryFlag` (`:398-402`) refuses to stack a
 * second read on one in flight, and the `Finger = CurrentFinger` /
 * `Update = fLastUpdate` version check (`:424`) throws away an answer that
 * arrived for a selection the user has left. Here they are `inFlight` and
 * `alive` plus the effect's own reset — a new selection shows no figures at all
 * rather than the previous service's.
 */

import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';

/** Voyager's `tRefresh` interval — doc/voyager-inspector-architecture.md:292. [INFERRED] */
export const SERVICE_FIGURES_POLL_MS = 5_000;

export interface ServiceFigures {
  /** RDOGetSupply — the card's "Supply" figure. */
  supply: number;
  /** RDOGetDemand — the card's "Local Demand" figure. */
  demand: number;
}

export function useServiceFigures(
  x: number,
  y: number,
  serviceIndex: number,
): ServiceFigures | undefined {
  const client = useClient();
  const isConnected = useGameStore((s) => s.status === 'connected');
  const [figures, setFigures] = useState<ServiceFigures | undefined>(undefined);

  useEffect(() => {
    setFigures(undefined);
    if (!isConnected || serviceIndex < 0) return;

    let alive = true;
    let inFlight = false;

    const tick = async (): Promise<void> => {
      // A hidden tab is not worth a round trip: the figures it would update are
      // not on screen, and the next visible tick reads them anyway.
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const reply = await client.onRequestServiceFigures(x, y, serviceIndex);
        // `reply` is checked for truthiness, not against `null`: the test
        // Proxy stubs answer `undefined` for a callback nobody spied on.
        if (alive && reply) {
          setFigures({
            supply: parseFloat(reply.supply) || 0,
            demand: parseFloat(reply.demand) || 0,
          });
        }
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = setInterval(() => { void tick(); }, SERVICE_FIGURES_POLL_MS);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [client, isConnected, x, y, serviceIndex]);

  return figures;
}
