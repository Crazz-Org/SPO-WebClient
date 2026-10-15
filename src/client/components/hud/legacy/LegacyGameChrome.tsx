/**
 * LegacyGameChrome — the original client's in-game frame under the legacy theme, in place of
 * the StatusPill / WorldEventTicker / ContextStatusStrip / CommandBar / RightRail HUD.
 *
 * Bottom to top, as Voyager stacked it (`VoyagerWindow.pas:389-404`, `MapIsoView.dfm`):
 *   - the Toolbar frame, 100 px (`ToolbarHandlerViewer.dfm`): toolbar.asp's icon row and the
 *     news BlockTicker on the left (468 px), the tycoon block on a #395950 → black gradient,
 *     the LEDs on the right (49 px);
 *   - the map's StatusPanel, 42 px: zoom / rotate, OVERLAY / CITY ZONES, INSPECT, the two
 *     marquee lines (selected object or town — green; hint — orange), BACK / NEXT /
 *     GO TOWN HALL;
 *   - over the map: the chat line (25 px, left of the minimap) and, when OVERLAY is on, the
 *     MapOptionsPanel ("Active Overlay:" and "Signal losing facilities").
 * Every control calls what the regular HUD calls; nothing here talks to the server itself.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useClient } from '../../../context';
import { useGameStore } from '../../../store/game-store';
import { useUiStore } from '../../../store/ui-store';
import { useMailStore } from '../../../store/mail-store';
import { useChatStore } from '../../../store/chat-store';
import { useBuildingStore } from '../../../store/building-store';
import { useMapStore } from '../../../store/map-store';
import { useSearchStore } from '../../../store/search-store';
import { isPanelOffered } from '../../../visitor-gating';
import { runChatCommand, type ChatCommandContext } from '../../../chat-commands';
import { nearestTown } from '@/shared/nearest-town';
import { OVERLAY_LIST, SurfaceType } from '@/shared/types';
import { useContextStatusText } from '../ContextStatusStrip';
import { useWorldEvent } from '../WorldEventTicker';
import { useModeDescriptor } from '../use-mode-descriptor';
import { LegacyMarquee } from './LegacyMarquee';
import { LegacyBlockTicker } from './LegacyBlockTicker';
import { LegacyChatWindow } from './LegacyChatWindow';
import styles from './LegacyGameChrome.module.css';

/** MapIsoViewer.tln — the captions of the StatusPanel and the chat line. */
const DEFAULT_HINT = 'Hint: Use a single click to select a facility on the map. Right click to invoke QuickWeb options.';
const NO_FACILITY = 'No facility selected';
const CHAT_PLACEHOLDER = 'Enter chat text here...';

const HOME_URL = 'https://www.starpeaceonline.com';
const SUPPORT_URL = 'https://www.starpeaceonline.com/support.asp';

/** "101.806.766.039.892" — the digits grouped as the viewer's locale groups them, as Voyager did. */
export function formatLegacyMoney(value: string | number): string {
  const raw = String(value).replace(/[^0-9-]/g, '');
  const negative = raw.startsWith('-');
  const digits = raw.replace(/-/g, '').replace(/^0+(?=\d)/, '') || '0';
  const sep = (1000).toLocaleString().charAt(1) || ',';
  return `${negative ? '-' : ''}$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep)}`;
}

/** "fev 24, 2859" — Voyager's `mmm d, yyyy` in the viewer's locale. */
export function formatLegacyDate(date: Date | null): string {
  if (!date) return '';
  const month = date.toLocaleDateString(undefined, { month: 'short' }).replace(/\.$/, '');
  return `${month} ${date.getDate()}, ${date.getFullYear()}`;
}

interface ToolButton {
  id: string;
  /** toolbar.asp's alt text (Toolbar.lng). */
  alt: string;
  img: string;
  onClick: () => void;
}

/** A TFramedButton: text in a 1 px frame, white under the pointer, lit (#FFFFBF) when on. */
function FramedButton({ children, className, selected, disabled, title, onClick }: {
  children: ReactNode;
  className?: string;
  selected?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.framed} ${selected ? styles.framedOn : ''} ${className ?? ''}`}
      disabled={disabled}
      title={title}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function LegacyGameChrome() {
  const client = useClient();
  const username = useGameStore((s) => s.username);
  const companyName = useGameStore((s) => s.companyName);
  const tycoonStats = useGameStore((s) => s.tycoonStats);
  const gameDate = useGameStore((s) => s.gameDate);
  const serverBusy = useGameStore((s) => s.serverBusy);
  const watchers = useGameStore((s) => s.watchers);
  const status = useGameStore((s) => s.status);
  const isVisitor = useGameStore((s) => s.isVisitor);
  const activeOverlay = useGameStore((s) => s.activeOverlay);
  const cityZones = useGameStore((s) => s.isCityZonesEnabled);
  const settings = useGameStore((s) => s.settings);
  const unreadMail = useMailStore((s) => s.unreadCount);
  const focused = useBuildingStore((s) => s.focusedBuilding);
  const historyIndex = useMapStore((s) => s.historyIndex);
  const historyLength = useMapStore((s) => s.history.length);
  const towns = useSearchStore((s) => s.townsData?.towns);
  const contextText = useContextStatusText();
  const worldEvent = useWorldEvent();
  const mode = useModeDescriptor();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [townHallPending, setTownHallPending] = useState(false);
  // The chat window over the map (the toolbar's chat icon) and the chat line on the map
  // ("Chat over Map" in that window, the line's own x) — ChatListHandlerViewer / MapIsoView.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatOverMap, setChatOverMap] = useState(true);

  const ui = useUiStore.getState;

  const tools: ToolButton[] = useMemo(() => {
    const all: (ToolButton & { panel?: Parameters<typeof isPanelOffered>[0] })[] = [
      { id: 'refresh', alt: 'Refresh all views', img: 'refresh', onClick: () => client.onRefreshMap() },
      { id: 'home', alt: 'Starpeace Online Home Page', img: 'home', onClick: () => window.open(HOME_URL, '_blank', 'noopener') },
      { id: 'build', alt: 'Display Build menu', img: 'build', panel: 'build', onClick: () => ui().toggleBuildSurface() },
      { id: 'fav', alt: 'Favorites', img: 'fav', panel: 'facilities', onClick: () => ui().toggleLeftPanel('facilities') },
      { id: 'search', alt: 'Search the Web', img: 'search', panel: 'search', onClick: () => ui().toggleRightPanel('search') },
      { id: 'profile', alt: 'User Profile', img: 'money', panel: 'empire', onClick: () => ui().toggleLeftPanel('empire') },
      { id: 'map', alt: 'Map view', img: 'map', onClick: () => ui().clearSurfaces() },
      { id: 'universe', alt: 'Universe View', img: 'stellarmap', onClick: () => client.onSwitchServer() },
      { id: 'mail', alt: 'Mail', img: 'mail', panel: 'mail', onClick: () => ui().toggleRightPanel('mail') },
      { id: 'chat', alt: 'Chat', img: 'chat', onClick: () => setChatOpen((v) => !v) },
      { id: 'options', alt: 'Options', img: 'options', onClick: () => ui().openModal('settings') },
      { id: 'help', alt: 'Support', img: 'help', onClick: () => window.open(SUPPORT_URL, '_blank', 'noopener') },
    ];
    return all.filter((t) => !t.panel || isPanelOffered(t.panel, isVisitor));
  }, [client, ui, isVisitor]);

  // GO TOWN HALL — the nearest hall to the camera, selected (MapIsoView.pas btTownHallClick);
  // with no town list yet, ask for it and go once it lands (as MapSurface does).
  const goToTownHall = useCallback(() => {
    const source = useMapStore.getState().source;
    const camera = source?.getCameraPosition();
    if (!camera) return;
    if (!towns) {
      setTownHallPending(true);
      client.onSearchMenuTowns();
      return;
    }
    const t = nearestTown(towns, camera.x, camera.y);
    if (!t) return;
    client.onNavigateToBuilding(t.x, t.y);
    useMapStore.getState().recordPosition(t.x, t.y);
  }, [towns, client]);

  useEffect(() => {
    if (!townHallPending || !towns) return;
    setTownHallPending(false);
    goToTownHall();
  }, [townHallPending, towns, goToTownHall]);

  const step = (pos: { x: number; y: number } | null) => {
    if (pos) useMapStore.getState().source?.centerOn(pos.x, pos.y);
  };

  const setOverlay = (value: string) => {
    if (value === 'NONE') {
      client.onSetOverlay(null);
      if (cityZones) client.onToggleCityZones();
    } else if (value === SurfaceType.ZONES) {
      if (!cityZones) client.onToggleCityZones();
    } else {
      client.onSetOverlay(value as SurfaceType);
    }
  };
  const overlayValue = activeOverlay ?? (cityZones ? SurfaceType.ZONES : 'NONE');

  const setSignalLosing = (on: boolean) => {
    useGameStore.getState().updateSettings({ signalLosingFacilities: on });
    client.onSettingsChange({ ...useGameStore.getState().settings, signalLosingFacilities: on });
  };

  // The chat line: `/` commands stay local (runChatCommand), the rest goes to the channel.
  const commandContext: ChatCommandContext = useMemo(() => ({
    moveTo: (x, y) => {
      useMapStore.getState().source?.centerOn(x, y);
      useMapStore.getState().recordPosition(x, y);
    },
    endComposition: () => client.onChatTypingChange(false),
    setAway: () => client.onChatAway(),
    tellPlayer: (message) => {
      const chat = useChatStore.getState();
      chat.addMessage(chat.currentChannel, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: 'SYSTEM',
        text: message,
        timestamp: Date.now(),
        isSystem: true,
        isGM: false,
      });
    },
  }), [client]);

  const sendChat = () => {
    const text = chatText.trim();
    if (!text) return;
    setChatText('');
    if (runChatCommand(text, commandContext) === 'handled') return;
    client.onSendChatMessage(text);
  };

  // The two marquee lines — MapIsoHandler.syncGetObjStatusText (:681-703): the selected
  // object's secondary and hint texts, else the town under the camera and the default hint.
  // A placing / road / zone mode speaks on the hint line while it lasts.
  const greenLine = focused
    ? (focused.detailsText || focused.buildingName || NO_FACILITY)
    : (contextText || NO_FACILITY);
  const orangeLine = mode
    ? [mode.title, mode.cost, mode.hint].filter(Boolean).join(' — ')
    : (focused?.hintsText || DEFAULT_HINT);

  const income = tycoonStats ? Number(String(tycoonStats.incomePerHour).replace(/[^0-9.-]/g, '')) : 0;
  const tickerText = worldEvent && worldEvent.text.trim() ? `${worldEvent.date} - ${worldEvent.text}` : '';

  return (
    <div className={styles.chrome}>
      {/* MapOptionsPanel — over the map, above the chat line, while OVERLAY is on */}
      {optionsOpen && !chatOpen && (
        <div className={styles.mapOptions}>
          <label className={styles.optionsLabel}>
            Active Overlay:
            <select className={styles.overlaySel} value={overlayValue} onChange={(e) => setOverlay(e.target.value)}>
              <option value="NONE">NONE</option>
              {OVERLAY_LIST.map((o) => (
                <option key={o.type} value={o.type}>{o.type === SurfaceType.ZONES ? 'Building Zones' : o.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.losingAlert} title="Facilities that are losing money show shaded in red">
            <input
              type="checkbox"
              checked={settings.signalLosingFacilities}
              onChange={(e) => setSignalLosing(e.target.checked)}
            />
            Signal losing facilities
          </label>
        </div>
      )}

      {/* ChatEditPanel — while the chat goes over the map and its window is closed */}
      {chatOverMap && !chatOpen && (
      <div className={styles.chatLine}>
        <input
          className={styles.chatInput}
          value={chatText}
          placeholder={CHAT_PLACEHOLDER}
          aria-label="Chat message"
          onChange={(e) => setChatText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              sendChat();
            }
          }}
        />
        <FramedButton className={styles.closeChat} title="Close chat box" onClick={() => setChatOverMap(false)}>x</FramedButton>
      </div>
      )}

      {/* StatusPanel */}
      <div className={styles.statusPanel}>
        <div className={styles.mapTools}>
          <button type="button" className={`${styles.bmpButton} ${styles.zoomIn}`} title="Zoom in" aria-label="Zoom in" onClick={() => client.onZoomIn()} />
          <button type="button" className={`${styles.bmpButton} ${styles.zoomOut}`} title="Zoom out" aria-label="Zoom out" onClick={() => client.onZoomOut()} />
          <button type="button" className={`${styles.bmpButton} ${styles.rotateCcw}`} title="Rotate CCW" aria-label="Rotate CCW" onClick={() => client.onRotateCCW()} />
          <button type="button" className={`${styles.bmpButton} ${styles.rotateCw}`} title="Rotate CW" aria-label="Rotate CW" onClick={() => client.onRotateCW()} />
          <FramedButton className={styles.overlayBtn} selected={optionsOpen} title="Display overlay map tools" onClick={() => setOptionsOpen((v) => !v)}>
            OVERLAY
          </FramedButton>
          <FramedButton className={styles.zonesBtn} selected={cityZones} title="Show City Zones overlay" onClick={() => client.onToggleCityZones()}>
            CITY ZONES
          </FramedButton>
          <FramedButton
            className={styles.inspectBtn}
            disabled={!focused}
            title="Get more info about the selected building (same as right-click over the building)"
            onClick={() => client.onInspectFocusedBuilding()}
          >
            INSPECT
          </FramedButton>
        </div>
        <div className={styles.tickers}>
          <LegacyMarquee text={greenLine} direction="up" className={styles.secondaryText} />
          <LegacyMarquee text={orangeLine} direction="down" className={styles.hintText} />
        </div>
        <div className={styles.navTools}>
          <FramedButton className={styles.backBtn} disabled={historyIndex <= 0} title="Go back to your previous location on the map" onClick={() => step(useMapStore.getState().goBack())}>
            &lt; BACK
          </FramedButton>
          <FramedButton className={styles.nextBtn} disabled={historyIndex >= historyLength - 1} title="Go forward to the next location you visited" onClick={() => step(useMapStore.getState().goNext())}>
            NEXT &gt;
          </FramedButton>
          <FramedButton className={styles.townHallBtn} title="Go to the nearest Town Hall" onClick={goToTownHall}>
            GO TOWN HALL
          </FramedButton>
        </div>
      </div>

      {/* The chat window, over the map and its StatusPanel */}
      {chatOpen && (
        <LegacyChatWindow chatOverMap={chatOverMap} onToggleChatOverMap={() => setChatOverMap((v) => !v)} />
      )}

      {/* Toolbar frame */}
      <div className={styles.toolbar}>
        <div className={styles.leftSide}>
          <nav className={styles.toolRow} aria-label="Game actions">
            {tools.map((t) => (
              <button
                key={t.id}
                type="button"
                className={styles.toolImg}
                data-tool={t.img}
                title={t.alt}
                aria-label={t.alt}
                onClick={t.onClick}
              />
            ))}
          </nav>
          <LegacyBlockTicker text={tickerText} />
        </div>
        <div className={styles.rightPanel}>
          {tycoonStats && (
            <>
              <span className={styles.nameRow}>
                <button type="button" className={styles.userName} onClick={() => ui().toggleLeftPanel('empire')} title="Open profile">
                  {tycoonStats.ranking}. {username}
                </button>
                <span className={styles.facCounter} title="Facilities">
                  {tycoonStats.buildingCount}/{tycoonStats.maxBuildings}
                  <span className={styles.facIcon} aria-hidden="true" />
                </span>
              </span>
              <span className={styles.companyName}>{companyName}</span>
              <span className={styles.money}>{formatLegacyMoney(tycoonStats.cash)}</span>
              <span className={`${styles.moneyDelta} ${income < 0 ? styles.moneyDeltaNeg : ''}`}>
                ({formatLegacyMoney(tycoonStats.incomePerHour)}/h)
              </span>
            </>
          )}
          <span className={styles.date}>{formatLegacyDate(gameDate)}</span>
        </div>
        <div className={styles.leds} aria-hidden="true">
          <span className={`${styles.led} ${styles.ledWatch} ${watchers.length > 0 ? styles.on : ''}`} title={watchers.join(', ')} />
          <span className={`${styles.led} ${styles.ledMail} ${unreadMail > 0 ? styles.on : ''}`} />
          <span className={`${styles.led} ${styles.ledBusy} ${serverBusy ? styles.on : ''}`} />
          <span className={`${styles.led} ${styles.ledOnline} ${status === 'connected' ? styles.on : ''}`} />
        </div>
      </div>
    </div>
  );
}
