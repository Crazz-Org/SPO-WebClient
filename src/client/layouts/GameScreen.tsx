/**
 * GameScreen — Map-first HUD overlay system.
 *
 * The canvas fills 100% of the viewport (managed by client.ts).
 * All UI is absolutely positioned overlays:
 * - StatusPill (z-350): top, player status in one line
 * - WorldEventTicker (z-350): just above ContextStatusStrip, the newest world event (#612)
 * - ContextStatusStrip (z-350): just above CommandBar, the town sentence under the camera
 * - CommandBar (z-350): bottom, search / mode bar + seven tiles
 * - RightRail (z-200): map controls
 * - ChatStrip (z-150): bottom-edge persistent chat, hidden when the player closed it (#610)
 * - StatusPill / CommandBar are hidden together while the HUD is collapsed (H, #613)
 * - Sheet (z-400): the universal surface — one stack (inspector, mail, search, politics, profile…)
 * - Modals (z-400): build menu, settings
 * - CommandPalette (z-500)
 */

import { lazy, Suspense } from 'react';
import { useUiStore } from '../store';
import { StatusPill, CommandBar, ContextStatusStrip, WorldEventTicker, RightRail, VersionBadge } from '../components/hud';
import { ChatStrip, ChaseBadge } from '../components/chat';
import { useChatStore } from '../store/chat-store';
import { StatusOverlay } from '../components/building';
import { MapContextMenu } from '../components/map/MapContextMenu';
import { ServerSwitchOverlay, ZoneTypePicker } from '../components/modals';
import { useChangelogCheck } from '../hooks/useChangelogCheck';
import { useCameraHistory } from '../hooks/useCameraHistory';
import { CommandPalette } from '../components/command-palette';
import { MobileShell } from '../components/mobile';
import { ConfirmDialog, PromptDialog } from '../components/common';
import { Sheet } from '../components/sheet';

// Lazy-loaded modals — not needed on initial render
const BuildMenu = lazy(() => import('../components/modals/BuildMenu').then(m => ({ default: m.BuildMenu })));
const BuildingInspectorModal = lazy(() => import('../components/modals/BuildingInspectorModal').then(m => ({ default: m.BuildingInspectorModal })));
const ChangelogModal = lazy(() => import('../components/modals/ChangelogModal').then(m => ({ default: m.ChangelogModal })));
const ConnectionPickerModal = lazy(() => import('../components/modals/ConnectionPickerModal').then(m => ({ default: m.ConnectionPickerModal })));
const CreateChannelModal = lazy(() => import('../components/modals/CreateChannelModal').then(m => ({ default: m.CreateChannelModal })));
const NewspaperModal = lazy(() => import('../components/modals/NewspaperModal').then(m => ({ default: m.NewspaperModal })));
const SettingsDialog = lazy(() => import('../components/modals/SettingsDialog').then(m => ({ default: m.SettingsDialog })));
const SupplierSearchModal = lazy(() => import('../components/modals/SupplierSearchModal').then(m => ({ default: m.SupplierSearchModal })));

import styles from './GameScreen.module.css';

export function GameScreen() {
  const modal = useUiStore((s) => s.modal);
  const confirmPayload = useUiStore((s) => s.confirmPayload);
  const promptPayload = useUiStore((s) => s.promptPayload);
  const closeModal = useUiStore((s) => s.closeModal);
  const chatVisible = useChatStore((s) => s.chatVisible);
  const hudVisible = useUiStore((s) => s.hudVisible);

  useChangelogCheck();
  useCameraHistory();

  return (
    <div className={styles.screen}>
      {/* Canvas fills viewport — managed by client.ts outside React */}

      {/* StatusOverlay — floating building preview (z-250, between map and panels) */}
      <StatusOverlay />

      {/* MapContextMenu — right-click release (without drag) menu at the pointer */}
      <MapContextMenu />


      {/* StatusPill — top, the player's state in one line; hidden while the HUD is collapsed (#613) */}
      {hudVisible && <StatusPill />}

      {/* ChaseBadge — top-right, shown only while following another player's camera */}
      <ChaseBadge />

      {/* WorldEventTicker — the newest world event (PickEvent), #612 */}
      <WorldEventTicker />

      {/* ContextStatusStrip — the server's sentence for the town under the camera */}
      <ContextStatusStrip />

      {/* CommandBar — bottom: search / mode bar + six tiles; hidden while the HUD is collapsed (#613) */}
      {hudVisible && <CommandBar />}

      {/* RightRail — map controls */}
      <RightRail />

      {/* ChatStrip — bottom-edge persistent chat, hidden when the player closed it (#610) */}
      {chatVisible && <ChatStrip />}

      {/* The universal sheet — one stack of surfaces (inspector, mail, search, politics, profile…) */}
      <Sheet />

      {/* Modals — z-400 (lazy-loaded, not needed on initial render) */}
      <Suspense fallback={null}>
        <BuildingInspectorModal />
        <BuildMenu />
        <ConnectionPickerModal />
        <CreateChannelModal />
        <SupplierSearchModal />
        <NewspaperModal />
        <SettingsDialog />
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
          onSubmit={(value) => { promptPayload.onSubmit(value); closeModal(); }}
          onCancel={closeModal}
        />
      )}

      {/* Server Switch Overlay — z-450, between modals and command palette */}
      <ServerSwitchOverlay />

      {/* Version badge — bottom-right, desktop only */}
      <VersionBadge />

      {/* Mobile shell — only renders on < 768px */}
      <MobileShell />

      {/* Command Palette — z-500 */}
      <CommandPalette />
    </div>
  );
}
