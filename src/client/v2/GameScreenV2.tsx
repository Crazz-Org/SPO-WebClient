/**
 * GameScreenV2 — the experimental in-game interface ("Command Deck").
 *
 * Mounted by App instead of GameScreen when `useUiStore.uiVersion === 'v2'` (Settings →
 * Interface, or V). Same contract as GameScreen: a full-viewport overlay with
 * `pointer-events: none` over the canvas that client.ts owns — it never touches the renderer,
 * the session or the docked minimap, and everything it shows lives in the stores, so switching
 * interfaces keeps the open surfaces, the focused building, chat and any placement mode.
 *
 * What v2 replaces (desktop ≥ 1024 px only — below that both interfaces are the same
 * MobileShell, ticker and context strip):
 *   StatusPill → TopBar · ContextStatusStrip + WorldEventTicker → SignalLine
 *   CommandBar mode row → ModeBanner · CommandBar + MoreMenu → Dock · RightRail → MapTools
 *   ChatStrip → ChatDrawer · Sheet → SidePanel · StatusOverlay → FocusCard
 * Everything else (dialogs, modals, palette, version badge, server switch) is the same
 * component GameScreen mounts; the chase badge too, except while the TopBar is up (it carries
 * the chase control itself — the badge's corner is the bar's right end).
 *
 * H hides TopBar, SignalLine, Dock, MapTools and ChatDrawer together; ModeBanner, the side
 * panel and dialogs stay.
 */

import { lazy, Suspense, useEffect } from 'react';
import { useUiStore } from '../store';
import { useChatStore } from '../store/chat-store';
import { useResponsive } from '../hooks/useResponsive';
import { useChangelogCheck } from '../hooks/useChangelogCheck';
import { useCameraHistory } from '../hooks/useCameraHistory';
import { ContextStatusStrip, WorldEventTicker, VersionBadge } from '../components/hud';
import { ChaseBadge } from '../components/chat';
import { MapContextMenu } from '../components/map/MapContextMenu';
import { ServerSwitchOverlay, ZoneTypePicker } from '../components/modals';
import { CommandPalette } from '../components/command-palette';
import { MobileShell } from '../components/mobile';
import { ConfirmDialog, PromptDialog } from '../components/common';
import { showToast, dismissToast } from '../components/common/Toast';
import { TopBar, SignalLine, ModeBanner } from './topbar';
import { Dock, MapTools, ChatDrawer } from './dock';
import { SidePanel, FocusCard } from './panel';

// Lazy-loaded modals — the same set, loaded the same way, as GameScreen
const ChangelogModal = lazy(() => import('../components/modals/ChangelogModal').then(m => ({ default: m.ChangelogModal })));
const ChatHistoryModal = lazy(() => import('../components/modals/ChatHistoryModal').then(m => ({ default: m.ChatHistoryModal })));
const CreateChannelModal = lazy(() => import('../components/modals/CreateChannelModal').then(m => ({ default: m.CreateChannelModal })));
const NewspaperModal = lazy(() => import('../components/modals/NewspaperModal').then(m => ({ default: m.NewspaperModal })));
const SettingsDialog = lazy(() => import('../components/modals/SettingsDialog').then(m => ({ default: m.SettingsDialog })));
const ShortcutHelpDialog = lazy(() => import('../components/modals/ShortcutHelpDialog').then(m => ({ default: m.ShortcutHelpDialog })));
const SupplierSearchModal = lazy(() => import('../components/modals/SupplierSearchModal').then(m => ({ default: m.SupplierSearchModal })));

import styles from './GameScreenV2.module.css';

export function GameScreenV2() {
  const modal = useUiStore((s) => s.modal);
  const confirmPayload = useUiStore((s) => s.confirmPayload);
  const promptPayload = useUiStore((s) => s.promptPayload);
  const closeModal = useUiStore((s) => s.closeModal);
  const hudVisible = useUiStore((s) => s.hudVisible);
  const chatVisible = useChatStore((s) => s.chatVisible);
  const { isDesktop } = useResponsive();

  useChangelogCheck();
  useCameraHistory();

  // H hides the dock — and with it the menu that leads back to Settings. Tell the player how
  // to get the interface back; the hint goes away as soon as it is back.
  useEffect(() => {
    if (hudVisible) return;
    const id = showToast('Press H to show the interface', 'info', {
      action: { label: 'Show', onClick: () => useUiStore.getState().setHudVisible(true) },
    });
    return () => dismissToast(id);
  }, [hudVisible]);

  const chrome = isDesktop && hudVisible;

  return (
    <div className={styles.screen} data-ui="v2">
      {/* Canvas fills viewport — managed by client.ts outside React */}

      {/* FocusCard — compact card over the focused building */}
      <FocusCard />

      {/* MapContextMenu — right-click release (without drag) menu at the pointer */}
      <MapContextMenu />

      {/* Top deck — status bar, signal line; the mode banner stays even with the HUD hidden */}
      {chrome && <TopBar />}
      {chrome && <SignalLine />}
      {isDesktop && <ModeBanner />}

      {/* Below 1024 px both interfaces show v1's ticker and context strip (mobile layout) */}
      {!isDesktop && <WorldEventTicker />}
      {!isDesktop && <ContextStatusStrip />}

      {/* ChaseBadge — top-right while following another player's camera. Its corner is the
          TopBar's right end, so while the TopBar is mounted the bar carries the same control */}
      {!chrome && <ChaseBadge />}

      {/* Dock (bottom-left), map tools (right edge), chat drawer (above the dock) */}
      {chrome && <Dock />}
      {chrome && <MapTools />}
      {chrome && chatVisible && <ChatDrawer />}

      {/* The side panel — one stack of surfaces (inspector, mail, search, politics, profile…) */}
      <SidePanel />

      {/* Modals — z-400 (lazy-loaded, not needed on initial render) */}
      <Suspense fallback={null}>
        <ChatHistoryModal />
        <CreateChannelModal />
        <SupplierSearchModal />
        <NewspaperModal />
        <SettingsDialog />
        <ShortcutHelpDialog />
        <ChangelogModal />
      </Suspense>
      <ZoneTypePicker />

      {/* Confirm Dialog — z-400 */}
      {modal === 'confirm' && confirmPayload && (
        <ConfirmDialog
          title={confirmPayload.title}
          message={confirmPayload.message}
          kind={confirmPayload.options?.kind}
          rows={confirmPayload.options?.rows}
          confirmText={confirmPayload.options?.typeToConfirm}
          confirmLabel={confirmPayload.options?.confirmLabel}
          cancelLabel={confirmPayload.options?.cancelLabel}
          dontAskAgainKey={confirmPayload.options?.dontAskAgainKey}
          onConfirm={() => { confirmPayload.onConfirm(); closeModal(); }}
          onCancel={closeModal}
        />
      )}

      {/* Prompt Dialog — z-400 */}
      {modal === 'prompt' && promptPayload && (
        <PromptDialog
          title={promptPayload.title}
          message={promptPayload.message}
          placeholder={promptPayload.placeholder}
          defaultValue={promptPayload.defaultValue}
          type={promptPayload.type}
          onSubmit={(value) => { promptPayload.onSubmit(value); closeModal(); }}
          onCancel={closeModal}
        />
      )}

      {/* Server Switch Overlay — z-450, between modals and command palette */}
      <ServerSwitchOverlay />

      {/* Version badge — bottom-right, desktop only */}
      <VersionBadge />

      {/* Mobile shell — only renders below 1024 px */}
      <MobileShell />

      {/* Command Palette — z-500 */}
      <CommandPalette />
    </div>
  );
}
