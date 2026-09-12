/**
 * ServerSwitchOverlay — Full-screen overlay for switching to a different server.
 *
 * Renders Zone/World/Company selection stages on top of the running game.
 * Shows a "Back to [worldName]" cancel button on Zone and World stages.
 * The cancel button disappears at Company stage (old server already disconnected).
 */

import { useState, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import { ZoneStage, WorldStage, CompanyStage } from '../login';
import type { WorldZone } from '@/shared/types';
import styles from './ServerSwitchOverlay.module.css';

export function ServerSwitchOverlay() {
  const serverSwitchMode = useGameStore((s) => s.serverSwitchMode);
  const originWorld = useGameStore((s) => s.serverSwitchOriginWorld);
  const stage = useGameStore((s) => s.loginStage);
  const worlds = useGameStore((s) => s.loginWorlds);
  const companies = useGameStore((s) => s.companies);
  const isLoading = useGameStore((s) => s.loginLoading);
  const loginPage = useGameStore((s) => s.loginPage);
  const username = useGameStore((s) => s.username);
  const setLoginStage = useGameStore((s) => s.setLoginStage);
  const setLoginLoading = useGameStore((s) => s.setLoginLoading);

  const client = useClient();
  const [selectedWorld, setSelectedWorld] = useState('');

  // Zone → Worlds: use stored credentials via dedicated callback
  const handleZoneSelect = useCallback(
    (zone: WorldZone) => {
      setLoginLoading(true);
      client.onServerSwitchZoneSelect(zone.path);
    },
    [client, setLoginLoading],
  );

  // Worlds → Companies: reuses same onWorldSelect (server handles cleanup)
  const handleWorldSelect = useCallback(
    (worldName: string) => {
      setLoginLoading(true);
      setSelectedWorld(worldName);
      client.onWorldSelect(worldName);
    },
    [client, setLoginLoading],
  );

  // Companies → Game: same flow as normal login
  const handleCompanySelect = useCallback(
    (companyId: string) => {
      setLoginLoading(true);
      client.onCompanySelect(companyId);
    },
    [client, setLoginLoading],
  );

  const handleCreateCompany = useCallback(() => {
    client.onCreateCompany();
  }, [client]);

  const handleBackToZones = useCallback(() => {
    setLoginStage('zones');
  }, [setLoginStage]);

  const handleBackToWorlds = useCallback(() => {
    setLoginStage('worlds');
  }, [setLoginStage]);

  const handleCancel = useCallback(() => {
    client.onCancelServerSwitch();
  }, [client]);

  if (!serverSwitchMode) return null;

  // Cancel is allowed on zones/worlds stages, but not when loading after world select
  // (old session may already be torn down at that point)
  const canCancel = (stage === 'zones' || stage === 'worlds') && !isLoading;

  return (
    <>
      <div className={styles.backdrop} />
      <div className={styles.overlay}>
        {canCancel && (
          <button className={styles.cancelBtn} onClick={handleCancel}>
            <ArrowLeft size={14} />
            <span>Back to {originWorld}</span>
          </button>
        )}

        {stage === 'zones' && (
          <ZoneStage onSelect={handleZoneSelect} isLoading={isLoading} />
        )}

        {stage === 'worlds' && (
          <WorldStage
            worlds={worlds}
            onSelect={handleWorldSelect}
            onBack={handleBackToZones}
            isLoading={isLoading}
          />
        )}

        {stage === 'companies' && (
          <CompanyStage
            companies={companies}
            worldName={selectedWorld}
            loginPage={loginPage}
            username={username}
            onSelect={handleCompanySelect}
            onCreate={handleCreateCompany}
            onBack={handleBackToWorlds}
            isLoading={isLoading}
          />
        )}
      </div>
    </>
  );
}
