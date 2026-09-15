/**
 * MobileShell — Map-first mobile layout.
 *
 * The canvas map is ALWAYS visible at 100% viewport.
 * All UI floats on top: MobileInfoBar (top), BottomSheet (content), BottomNav (bottom).
 * Tab content is routed into the BottomSheet — no opaque content layer.
 */

import { useEffect } from 'react';
import { useUiStore, type MobileTab } from '../../store/ui-store';
import { useResponsive } from '../../hooks/useResponsive';
import { useClient } from '../../context';
import { useModeDescriptor } from '../hud/use-mode-descriptor';
import { ChatStrip } from '../chat';
import { ErrorBoundary } from '../common';
import { SurfaceContent, SURFACE_TITLES, BuildingSheetActions } from '../sheet';
import { useChatStore } from '../../store/chat-store';
import { BottomNav } from './BottomNav';
import { BottomSheet } from './BottomSheet';
import { ChatBanner } from './ChatBanner';
import { MobileBuildContent } from './MobileBuildContent';
import { MobileInfoBar } from './MobileInfoBar';
import { MobileSearchPill } from './MobileSearchPill';
import { MobileMenu } from './MobileMenu';
import { MobileModeBar } from './MobileModeBar';
import { PlacementHUD } from './PlacementHUD';
import styles from './MobileShell.module.css';

/** Map mobileTab → sheet title */
const SHEET_TITLES: Record<MobileTab, string> = {
  map: '',
  chat: 'Chat',
  build: 'Build',
  more: 'Menu',
};

/** Content rendered inside the BottomSheet: the top of the surface stack wins, then the tab */
function SheetContent() {
  const mobileTab = useUiStore((s) => s.mobileTab);
  const top = useUiStore((s) => s.stack[s.stack.length - 1]);
  const resetUnreadChat = useChatStore((s) => s.resetUnreadChat);

  // Reset unread chat count when the chat tab is shown (after render, not during it)
  useEffect(() => {
    if (mobileTab === 'chat' && !top) resetUnreadChat();
  }, [mobileTab, top, resetUnreadChat]);

  // The surface stack takes priority — every desktop surface (politics and profile included) is reachable here
  if (top) return <SurfaceContent kind={top.kind} />;

  switch (mobileTab) {
    case 'chat':
      return <ChatStrip mode="embedded" />;
    case 'build':
      return <MobileBuildContent />;
    case 'more':
      return <MobileMenu />;
    default:
      return null;
  }
}

export function MobileShell() {
  // Lot g: the 768-1023 tablet band joined the mobile model — one shell, one
  // sheet, one tab bar for everything under the desktop breakpoint.
  const { isDesktop } = useResponsive();
  const mobileTab = useUiStore((s) => s.mobileTab);
  const top = useUiStore((s) => s.stack[s.stack.length - 1]);
  const stackDepth = useUiStore((s) => s.stack.length);
  const popSurface = useUiStore((s) => s.popSurface);
  const setMobileTab = useUiStore((s) => s.setMobileTab);
  const isPlacingBuilding = useUiStore((s) => s.isPlacingBuilding);
  const placementValid = useUiStore((s) => s.placementValid);
  const mode = useModeDescriptor();
  const connectActive = useUiStore((s) => s.connectMode.active);
  const client = useClient();

  if (isDesktop) return null;

  // Determine if the BottomSheet should be open. Connect mode hides it (N10):
  // on a phone the sheet covers the very map the mode asks to tap; the stack
  // stays intact underneath and comes back when the mode ends.
  const hasRightPanel = top != null;
  const sheetOpen = (mobileTab !== 'map' || hasRightPanel) && !connectActive;

  // Sheet title from the top surface or the active tab
  const sheetTitle = top ? SURFACE_TITLES[top.kind] : SHEET_TITLES[mobileTab];

  // Closing unstacks one surface (a supplier search returns to its building); the tab closes last.
  const handleSheetClose = () => {
    if (stackDepth > 0) {
      popSurface();
    } else {
      setMobileTab('map');
    }
  };

  return (
    <div className={styles.shell} style={{ pointerEvents: 'none' }}>
      {/* Compact info bar at top */}
      <MobileInfoBar />

      {/* Chat banner — only visible on map tab */}
      {mobileTab === 'map' && !hasRightPanel && <ChatBanner />}

      {/* Search row of the command bar — map tab, no sheet, no placement */}
      {mobileTab === 'map' && !hasRightPanel && !mode && <MobileSearchPill />}

      {/* Universal BottomSheet — all non-map content goes here */}
      <BottomSheet
        open={sheetOpen}
        onClose={handleSheetClose}
        title={sheetTitle}
        actions={top?.kind === 'building' ? <BuildingSheetActions /> : undefined}
      >
        <ErrorBoundary>
          <SheetContent />
        </ErrorBoundary>
      </BottomSheet>

      {/* Bottom navigation — PlacementHUD while placing, the mode bar for roads and zones */}
      {isPlacingBuilding ? (
        <PlacementHUD
          onCancel={() => client.onCancelBuildingPlacement()}
          onRotate={() => client.onRotateCW()}
          onConfirm={() => client.onConfirmBuildingPlacement()}
          canConfirm={placementValid}
        />
      ) : mode ? (
        <MobileModeBar mode={mode} />
      ) : (
        <BottomNav />
      )}
    </div>
  );
}
