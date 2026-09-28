/**
 * App — Root React component.
 *
 * Routes between LoginScreen (cinematic full-screen auth) and
 * GameScreen (map-first HUD overlay) based on connection status.
 * Keyboard shortcuts are registered globally here.
 */

import { lazy, Suspense } from 'react';
import { useGameStore } from './store';
import { LoginScreen } from './layouts/LoginScreen';
import { GameScreen } from './layouts/GameScreen';
import { ToastContainer, ReconnectingOverlay, NewVersionBanner } from './components/common';
import { ServerStartupScreen } from './components/startup/ServerStartupScreen';
import { MapLoadingScreen } from './components/startup/MapLoadingScreen';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useClient } from './context';

// Lazy-loaded modal — not needed on initial render
const CompanyCreationModal = lazy(() =>
  import('./components/modals/CompanyCreationModal').then(m => ({ default: m.CompanyCreationModal }))
);

export function App() {
  const status = useGameStore((s) => s.status);
  const serverReady = useGameStore((s) => s.serverStartup.ready);
  const client = useClient();

  // Register global keyboard shortcuts (B, E, M, R, D, Escape, Cmd+K)
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
      {status === 'connected' || status === 'reconnecting' ? <GameScreen /> : <LoginScreen />}
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
