/**
 * App — Root React component.
 *
 * Routes between LoginScreen (cinematic full-screen auth) and
 * GameScreen (map-first HUD overlay) based on connection status.
 * In game, `useUiStore.uiVersion` picks the classic GameScreen or the experimental
 * GameScreenV2 (src/client/v2/, lazy); a v2 render error falls back to the classic one.
 * Keyboard shortcuts are registered globally here.
 */

import { lazy, Suspense } from 'react';
import { useGameStore, useUiStore } from './store';
import { LoginScreen } from './layouts/LoginScreen';
import { GameScreen } from './layouts/GameScreen';
import { ToastContainer, ReconnectingOverlay, NewVersionBanner } from './components/common';
import { ServerStartupScreen } from './components/startup/ServerStartupScreen';
import { MapLoadingScreen } from './components/startup/MapLoadingScreen';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useClient } from './context';
import { V2Boundary } from './v2/V2Boundary';

// Lazy-loaded modal — not needed on initial render
const CompanyCreationModal = lazy(() =>
  import('./components/modals/CompanyCreationModal').then(m => ({ default: m.CompanyCreationModal }))
);

// The experimental interface — only fetched once a player switches to it
const GameScreenV2 = lazy(() => import('./v2').then(m => ({ default: m.GameScreenV2 })));

export function App() {
  const status = useGameStore((s) => s.status);
  const serverReady = useGameStore((s) => s.serverStartup.ready);
  const uiVersion = useUiStore((s) => s.uiVersion);
  const client = useClient();

  // Register global keyboard shortcuts — the full list is SHORTCUTS in hooks/useKeyboardShortcuts.ts
  useKeyboardShortcuts(client);

  // Block all interaction until the server has finished initialising
  if (!serverReady) {
    return (
      <>
        <ServerStartupScreen />
        <ReconnectingOverlay />
        <NewVersionBanner />
        <ToastContainer />
      </>
    );
  }

  return (
    <>
      {status === 'connected' || status === 'reconnecting'
        ? (uiVersion === 'v2'
          ? (
            <V2Boundary>
              <Suspense fallback={null}>
                <GameScreenV2 />
              </Suspense>
            </V2Boundary>
          )
          : <GameScreen />)
        : <LoginScreen />}
      <MapLoadingScreen />
      <Suspense fallback={null}>
        <CompanyCreationModal />
      </Suspense>
      <ReconnectingOverlay />
      <NewVersionBanner />
      <ToastContainer />
    </>
  );
}
