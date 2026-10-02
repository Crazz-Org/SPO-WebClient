/** `data-testid` values `getDebugState` (client.ts) reads — see doc/E2E-TESTING.md, "Programmatic State Verification". */
export const DEBUG_MARKERS = {
  moreMenu: 'more-menu',
  chatChannelPicker: 'chat-channel-picker',
  chatUsers: 'chat-users',
  buildMenu: 'build-menu',
  mobileBuildContent: 'mobile-build-content',
  mobileInfoBar: 'mobile-info-bar',
  chatBanner: 'chat-banner',
  /** Already rendered by report/ReportModeOverlay.tsx — not changed here. */
  reportModeOverlay: 'report-mode-overlay',
  /** Already rendered by report/ReportModal.tsx — not changed here. */
  reportModal: 'report-modal',
} as const;
