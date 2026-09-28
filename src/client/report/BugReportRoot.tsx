/**
 * The single mount point of the bug-reporting feature.
 *
 * Mounted from `main.tsx` rather than `App.tsx` so it survives the Login → Game transition,
 * and lazily so that a build without `SPO_BUG_REPORT` never fetches the chunk at all.
 *
 * It owns four things and nothing else: arming the journal, the F8 listener and floating
 * button (dev/test only — absent when `SPO_BUG_REPORT=player`), the Support request raised
 * through the UI store (`requestReportMode`), and the armed → captured → submitted walk
 * between the overlay and the modal. Every entry point acts only in-game; the journal runs
 * from mount regardless.
 */

import { useCallback, useEffect, useState } from 'react';
import { useClient } from '../context';
import { useResponsive } from '../hooks/useResponsive';
import { useUiStore } from '../store/ui-store';
import { useGameStore } from '../store/game-store';
import { showToast } from '../components/common/Toast';
import { config } from '../../shared/config';
import type { GeometryCapture, ReportAnchor, SessionContext } from '../../shared/bug-report-schema';
import { reportJournal } from './journal';
import { resolveDomAnchor } from './dom-anchor';
import { collectGeometry } from './geometry-collect';
import { submitReport, type ReportDraft } from './report-submit';
import { ReportModeOverlay } from './ReportModeOverlay';
import { ReportModal, type ReportModalSubmission } from './ReportModal';
import { ReportFab } from './ReportFab';
import { QuickPickGrid, type QuickPickSubmission } from './QuickPickGrid';

/** The map canvas, the one element the DOM walk cannot describe. */
const CANVAS_ID = 'game-canvas';

interface Captured {
  anchor: ReportAnchor;
  observedDefault: string;
  /** Mobile only: the measurements taken at the moment of the tap. */
  geometry?: GeometryCapture;
  /** Both profiles: a cheap fingerprint of what the player was doing, read synchronously from
   * the stores at the moment of capture -- a second correlation axis into the server log,
   * independent of the createdAtUtc/log clock-skew triage already has to account for. */
  sessionContext: SessionContext;
}

/** Read at the moment of capture, not later — the whole point is "what was true when flagged". */
function captureSessionContext(): SessionContext {
  const gameDate = useGameStore.getState().gameDate;
  const stack = useUiStore.getState().stack;
  const top = stack[stack.length - 1];
  return {
    gameDate: gameDate ? gameDate.toISOString() : null,
    surface: top ? top.kind : null,
  };
}

export function BugReportRoot() {
  const client = useClient();
  // Mobile is the ergonomics profile: a phone has no F8 and no devtools, so the same capture
  // core is driven by a draggable button and answered with taps instead of typing.
  const { isMobile } = useResponsive();
  const [armed, setArmed] = useState(false);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Read at render, never at module scope: in `player` mode the Support entry is the only way in.
  const playerMode = config.server.bugReportPlayerMode;
  // In-game only — the same test App.tsx uses to show the game screen. A report from the login
  // screen has no session to be deposited against.
  const live = useGameStore((s) => s.status === 'connected' || s.status === 'reconnecting');

  // The journal runs from mount, not from arming: nobody arms a mode *before* noticing a
  // problem, and the 60 seconds that led up to F8 are the evidence.
  useEffect(() => {
    reportJournal.arm(
      listener => useUiStore.subscribe(listener),
      () => useUiStore.getState().stack,
    );
    return () => reportJournal.disarm();
  }, []);

  useEffect(() => {
    if (isMobile || playerMode || !live) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'F8') return;
      event.preventDefault();
      setArmed(current => !current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobile, playerMode, live]);

  // Settings / menu → Support: the components raising it cannot import this lazy chunk, so the
  // request travels through the UI store. It arms; it never toggles.
  useEffect(() => {
    if (!live) return;
    return useUiStore.subscribe((state, prev) => {
      if (state.reportModeRequest !== prev.reportModeRequest) setArmed(true);
    });
  }, [live]);

  const onCapture = useCallback((element: Element, clientX: number, clientY: number) => {
    setArmed(false);
    if (element.id === CANVAS_ID) {
      const probe = client.onGetCanvasAnchor?.(clientX, clientY) ?? null;
      if (!probe) {
        showToast('The map is not ready — nothing to anchor the report on.', 'warning');
        return;
      }
      const screenshotDataUrl = client.onGetCanvasScreenshot?.() ?? undefined;
      setCaptured({
        anchor: { kind: 'canvas', ...probe, ...(screenshotDataUrl ? { screenshotDataUrl } : {}) },
        observedDefault: '',
        sessionContext: captureSessionContext(),
      });
      return;
    }
    const anchor = resolveDomAnchor(element);
    setCaptured({
      anchor,
      observedDefault: anchor.text,
      // Numbers, not a screenshot: a rect and a threshold are actionable, an impression is not.
      ...(isMobile ? { geometry: collectGeometry(element) } : {}),
      sessionContext: captureSessionContext(),
    });
  }, [client, isMobile]);

  const send = useCallback(async (partial: Omit<ReportDraft, 'anchor' | 'username' | 'world' | 'profile'>) => {
    if (!captured) return;
    setSubmitting(true);
    const outcome = await submitReport({
      profile: isMobile ? 'mobile' : 'desktop',
      anchor: captured.anchor,
      username: client.onGetUsername?.() ?? '',
      world: client.onGetWorld?.() ?? '',
      sessionContext: captured.sessionContext,
      ...partial,
    });
    setSubmitting(false);
    setCaptured(null);
    if (outcome.ok) showToast(`Report queued: ${outcome.detail}`, 'success', { title: 'Reported' });
    else showToast(`Report not sent: ${outcome.detail}`, 'error');
  }, [captured, client, isMobile]);

  const onSubmitDesktop = useCallback((submission: ReportModalSubmission) => {
    void send({
      kind: submission.kind,
      observed: submission.observed,
      expected: submission.expected,
      freeText: submission.freeText,
    });
  }, [send]);

  const onSubmitMobile = useCallback((submission: QuickPickSubmission) => {
    void send({
      kind: submission.kind,
      quickPicks: submission.quickPicks,
      freeText: submission.freeText,
      geometry: captured?.geometry,
    });
  }, [send, captured]);

  return (
    <>
      {isMobile && !playerMode && live && !captured && (
        <ReportFab armed={armed} onToggleArmed={() => setArmed(current => !current)} />
      )}
      {armed && !captured && (
        <ReportModeOverlay onCapture={onCapture} onCancel={() => setArmed(false)} />
      )}
      {captured && isMobile && (
        <QuickPickGrid
          anchor={captured.anchor}
          geometry={captured.geometry}
          onSubmit={onSubmitMobile}
          onCancel={() => setCaptured(null)}
          submitting={submitting}
        />
      )}
      {captured && !isMobile && (
        <ReportModal
          anchor={captured.anchor}
          observedDefault={captured.observedDefault}
          onSubmit={onSubmitDesktop}
          onCancel={() => setCaptured(null)}
          submitting={submitting}
        />
      )}
    </>
  );
}
