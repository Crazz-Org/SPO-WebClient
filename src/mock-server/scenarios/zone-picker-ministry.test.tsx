/**
 * The zone picker's office narrowing, driven end to end (issue 606): the
 * real gateway `handleTycoonRole` reads the Delphi tycoon cache row, the real
 * browser `ClientBridge.handleTycoonRoleResponse` writes it into the politics
 * store, and `<ZoneTypePicker />` renders only the zones that office's legacy
 * page offered (`MayorOptions.asp`).
 *
 * The bridge is NOT mocked here — this is the one place that proves the
 * cache row a minister's session actually holds ends up narrowing the list,
 * not a constant baked into the component.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '@/client/__tests__/setup/render-helpers';
import { useUiStore } from '@/client/store/ui-store';
import { useGameStore } from '@/client/store/game-store';
import { usePoliticsStore } from '@/client/store/politics-store';
import { ClientBridge } from '@/client/bridge/client-bridge';
import { ZoneTypePicker } from '@/client/components/modals/ZoneTypePicker';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { handleTycoonRole } from '@/server/ws-handlers/politics-handlers';
import { queryTycoonPoliticalRole } from '@/server/session/building-management-handler';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import type { WsMessage, WsRespTycoonRole } from '@/shared/types';
import { WsMessageType } from '@/shared/types';

/** Drive the real gateway handler over a fake tycoon-cache row and return the RESP_TYCOON_ROLE. */
async function driveGateway(cacheRow: string[]): Promise<WsRespTycoonRole> {
  const fake = makeSessionCtx();
  fake.cacher.createObject.mockResolvedValue('temp-1');
  fake.cacher.getPropertyList.mockResolvedValue(cacheRow);

  const sent: WsMessage[] = [];
  const ctx = {
    ws: { send: (payload: string) => sent.push(JSON.parse(payload) as WsMessage) },
    session: {
      queryTycoonPoliticalRole: (tycoonName: string) => queryTycoonPoliticalRole(fake.ctx, tycoonName),
    },
  } as unknown as WsHandlerContext;

  const req: WsMessage = {
    type: WsMessageType.REQ_TYCOON_ROLE,
    wsRequestId: 'req-1',
    tycoonName: 'spo_test3',
  } as unknown as WsMessage;

  await handleTycoonRole(ctx, req);

  expect(sent).toHaveLength(1);
  return sent[0] as WsRespTycoonRole;
}

describe('zone picker — ministry narrowing, live flow', () => {
  beforeEach(() => {
    resetStores();
    usePoliticsStore.getState().clearRoles();
    useGameStore.setState({ username: 'spo_test3' });
    useUiStore.getState().openModal('zonePicker');
  });

  it('a Minister of Housing is shown only High/Mid/Low Residential and Erase', async () => {
    // IsMayor, Town, IsCapitalMayor, IsPresident, IsMinister, Ministry — building-management-handler.ts:47-49
    const resp = await driveGateway(['0', '', '0', '0', '-1', 'Housing']);
    expect(resp.role.isMinister).toBe(true);
    expect(resp.role.ministry).toBe('Housing');

    ClientBridge.handleTycoonRoleResponse(resp);
    renderWithProviders(<ZoneTypePicker />);

    for (const label of ['High Residential', 'Mid Residential', 'Low Residential', 'Erase']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    for (const label of ['Industrial', 'Commercial', 'Civics', 'Offices', 'Reserved', 'Residential']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('the same flow for a mayor row shows the mayor set — the narrowing is the role, not a constant', async () => {
    const resp = await driveGateway(['-1', 'Helartia', '0', '0', '0', '']);
    expect(resp.role.isMayor).toBe(true);

    ClientBridge.handleTycoonRoleResponse(resp);
    renderWithProviders(<ZoneTypePicker />);

    for (const label of [
      'High Residential', 'Mid Residential', 'Low Residential',
      'Industrial', 'Commercial', 'Civics', 'Offices', 'Erase',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText('Reserved')).toBeNull();
    expect(screen.queryByText('Residential')).toBeNull();
  });
});
