/**
 * LoginScreen — Cinematic full-screen login experience.
 *
 * Four stages with cinematic transitions:
 * A) Authentication — centered glassmorphed card on atmospheric background
 * B) Zone/Region Selection — BETA, Free Space, Restricted Space
 * C) World Selection — centered world card grid with gold hover glow
 * D) Company Selection — role-grouped company cards + create new
 *
 * The LoginBackground component provides animated floating orbs.
 * Each stage is a self-contained component that receives callbacks.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useGameStore } from '../store';
import { useClient } from '../context';
import { LoginBackground, AuthStage, AuthErrorModal, ZoneStage, WorldStage, CompanyStage } from '../components/login';
import { config } from '@/shared/config';
import { WORLD_ZONES } from '@/shared/types/protocol-types';
import type { WorldZone } from '@/shared/types';
import styles from './LoginScreen.module.css';

/** Parse "zoneId/worldName" into its parts, or return undefined if invalid. */
function parseForceWorld(value: string | undefined): { zoneId: string; worldName: string } | undefined {
  if (!value) return undefined;
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { zoneId: value.slice(0, slash), worldName: value.slice(slash + 1) };
}

const forceWorldConfig = parseForceWorld(config.server.forceWorld);

export function LoginScreen() {
  const status = useGameStore((s) => s.status);
  const stage = useGameStore((s) => s.loginStage);
  const worlds = useGameStore((s) => s.loginWorlds);
  const companies = useGameStore((s) => s.companies);
  const isLoading = useGameStore((s) => s.loginLoading);
  const authError = useGameStore((s) => s.authError);
  const loginPage = useGameStore((s) => s.loginPage);
  const setLoginStage = useGameStore((s) => s.setLoginStage);
  const setLoginLoading = useGameStore((s) => s.setLoginLoading);
  const setAuthError = useGameStore((s) => s.setAuthError);

  const client = useClient();
  const [storedCreds, setStoredCreds] = useState<{ username: string; password: string } | null>(null);
  const [selectedWorld, setSelectedWorld] = useState('');

  // Stage A: validate credentials via RDO auth check, then advance to zones on success
  const handleConnect = useCallback(
    (username: string, password: string) => {
      setStoredCreds({ username, password });
      setLoginLoading(true);
      client.onAuthCheck(username, password);
    },
    [client, setLoginLoading],
  );

  // Dismiss auth error modal
  const handleDismissAuthError = useCallback(() => {
    setAuthError(null);
  }, [setAuthError]);

  // Stage B → C: select zone, then perform directory connect with stored creds + zone path
  const handleZoneSelect = useCallback(
    (zone: WorldZone) => {
      if (!storedCreds) return;
      setLoginLoading(true);
      client.onDirectoryConnect(storedCreds.username, storedCreds.password, zone.path);
    },
    [client, storedCreds, setLoginLoading],
  );

  // Stage C → D: select world
  const handleWorldSelect = useCallback(
    (worldName: string) => {
      setLoginLoading(true);
      setSelectedWorld(worldName);
      client.onWorldSelect(worldName);
    },
    [client, setLoginLoading],
  );

  // Auto-advance zone + world stages when SPO_FORCE_WORLD is set (test phase).
  // One-shot ref prevents retry loops; 1s delay gives the directory socket time to initialize.
  const forceAdvancedRef = useRef<{ zones: boolean; worlds: boolean }>({ zones: false, worlds: false });
  useEffect(() => {
    if (!forceWorldConfig || isLoading) return;
    if (stage === 'zones' && !forceAdvancedRef.current.zones) {
      const zone = WORLD_ZONES.find((z) => z.id === forceWorldConfig.zoneId);
      if (zone) {
        forceAdvancedRef.current.zones = true;
        const timer = setTimeout(() => handleZoneSelect(zone), 1000);
        return () => clearTimeout(timer);
      }
    }
    if (stage === 'worlds' && !forceAdvancedRef.current.worlds) {
      forceAdvancedRef.current.worlds = true;
      handleWorldSelect(forceWorldConfig.worldName);
    }
  }, [stage, isLoading, handleZoneSelect, handleWorldSelect]);

  // Stage D → game: select company
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

  return (
    <div className={styles.screen}>
      <LoginBackground />

      {stage === 'auth' && (
        <AuthStage
          onConnect={handleConnect}
          isLoading={isLoading}
          status={status}
        />
      )}

      {stage === 'zones' && (
        <ZoneStage
          onSelect={handleZoneSelect}
          isLoading={isLoading}
        />
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
          onSelect={handleCompanySelect}
          onCreate={handleCreateCompany}
          onBack={handleBackToWorlds}
          isLoading={isLoading}
        />
      )}

      {authError && (
        <AuthErrorModal error={authError} onDismiss={handleDismissAuthError} />
      )}
    </div>
  );
}
