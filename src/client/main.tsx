/**
 * Single entry point — boots StarpeaceClient and mounts React UI.
 *
 * Vite bundles this into app.js. The client instance is created first,
 * then React renders with callbacks passed directly via ClientContext.
 */

import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ClientContext } from './context';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AppErrorBoundary } from './components/common/CrashScreen';
import { StarpeaceClient } from './client';
import { config } from '../shared/config';
import './styles/design-tokens.css';
import './styles/reset.css';
import './styles/typography.css';
import './styles/animations.css';
import { APP_VERSION, BUILD_DATE, BUILD_TIME, BUILD_NUMBER } from './version';

console.log(`[SPO] Beta ${APP_VERSION} | Built ${BUILD_DATE} ${BUILD_TIME} | #${BUILD_NUMBER}`);

// Dev-only bug reporting. Lazy so a build without SPO_BUG_REPORT never fetches the chunk,
// and mounted here rather than in App.tsx so it survives the Login → Game transition.
const BugReportRoot = lazy(() =>
  import('./report').then(m => ({ default: m.BugReportRoot }))
);

const client = new StarpeaceClient();

const rootElement = document.getElementById('react-root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <ClientContext.Provider value={client.callbacks}>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
        {config.server.bugReportMode && (
          <ErrorBoundary fallback={null}>
            <Suspense fallback={null}>
              <BugReportRoot />
            </Suspense>
          </ErrorBoundary>
        )}
      </ClientContext.Provider>
    </StrictMode>
  );
}
