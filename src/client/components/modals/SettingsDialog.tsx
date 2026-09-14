/**
 * SettingsDialog — Game settings modal.
 *
 * Toggle switches for visual/audio settings + keyboard shortcuts reference.
 */

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useGameStore, type GameSettings, type MinimapSize } from '../../store/game-store';
import { useUiStore } from '../../store/ui-store';
import { useClient } from '../../context';
import { showToast } from '../common/Toast';
import { Switch, confirmLogout } from '../common';
import { SHORTCUTS } from '../../hooks/useKeyboardShortcuts';
import { connectionStats, formatByteCount } from '../../connection-stats';
import { buildSupportUrl, getSupportUrl } from '../../support-link';
import styles from './SettingsDialog.module.css';

export function SettingsDialog() {
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const settings = useGameStore((s) => s.settings);
  const updateSettings = useGameStore((s) => s.updateSettings);

  const client = useClient();
  const username = useGameStore((s) => s.username);
  const worldName = useGameStore((s) => s.worldName);
  const supportHref = buildSupportUrl(getSupportUrl(), worldName, username);
  const [debugSending, setDebugSending] = useState(false);

  const handleSendDebugReport = useCallback(async () => {
    const spoDebug = (window as unknown as Record<string, unknown>).__spoDebug as
      { history?: Array<{ dir: string; type: string; ts: number; reqId?: string }> } | undefined;

    if (!spoDebug?.history?.length) {
      showToast('No debug data available', 'warning');
      return;
    }

    setDebugSending(true);
    try {
      const resp = await fetch('/api/debug-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player: username || 'unknown', history: spoDebug.history }),
      });
      const result = await resp.json() as { ok?: boolean; entries?: number; error?: string };
      if (result.ok) {
        showToast(`Debug report sent (${result.entries} entries)`, 'success');
      } else {
        showToast(result.error || 'Failed to send debug report', 'error');
      }
    } catch {
      showToast('Failed to send debug report', 'error');
    } finally {
      setDebugSending(false);
    }
  }, [username]);

  // Update store + notify client.ts to apply to renderer/sound/localStorage
  const handleSettingChange = useCallback(
    (partial: Partial<GameSettings>) => {
      updateSettings(partial);
      // Read the merged settings from the store after update
      const merged = { ...useGameStore.getState().settings, ...partial };
      client.onSettingsChange(merged);
    },
    [updateSettings, client],
  );

  if (modal !== 'settings') return null;

  const handleLogout = () => {
    confirmLogout(client.onLogout);
  };

  return (
    <>
      <div className={styles.backdrop} onClick={closeModal} aria-hidden="true" />
      <div className={styles.modal} role="dialog" aria-label="Settings">
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className={styles.closeBtn} onClick={closeModal} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className={styles.content}>
          {/* Visual settings */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Visual</h3>
            <ToggleRow
              label="Hide vegetation on move"
              checked={settings.isVegetationHiddenOnMove}
              onChange={(v) => handleSettingChange({ isVegetationHiddenOnMove: v })}
            />
            <ToggleRow
              label="Vehicle animations"
              checked={settings.vehicleAnimations}
              onChange={(v) => handleSettingChange({ vehicleAnimations: v })}
            />
            <ToggleRow
              label="Aircraft animations"
              checked={settings.aircraftAnimations}
              onChange={(v) => handleSettingChange({ aircraftAnimations: v })}
            />
            <ToggleRow
              label="Fade other players' buildings"
              checked={settings.glassForeignBuildings}
              onChange={(v) => handleSettingChange({ glassForeignBuildings: v })}
            />
            <ToggleRow
              label="Signal losing facilities"
              checked={settings.signalLosingFacilities}
              onChange={(v) => handleSettingChange({ signalLosingFacilities: v })}
            />
            <ToggleRow
              label="Debug overlay"
              checked={settings.isDebugOverlay}
              onChange={(v) => handleSettingChange({ isDebugOverlay: v })}
            />
            <SizeSelector
              label="Minimap size"
              value={settings.minimapSize}
              onChange={(v) => handleSettingChange({ minimapSize: v, minimapPixelSize: null })}
            />
          </section>

          {/* Audio settings */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Audio</h3>
            <ToggleRow
              label="Sound enabled"
              checked={settings.isSoundEnabled}
              onChange={(v) => handleSettingChange({ isSoundEnabled: v })}
            />
            <div className={styles.sliderRow}>
              <span className={styles.sliderLabel}>Effects volume</span>
              <input
                type="range"
                className={styles.slider}
                aria-label="Effects volume"
                min="0"
                max="1"
                step="0.05"
                value={settings.soundVolume}
                onChange={(e) => handleSettingChange({ soundVolume: parseFloat(e.target.value) })}
              />
              <span className={styles.sliderValue}>
                {Math.round(settings.soundVolume * 100)}%
              </span>
            </div>
            <div className={styles.sliderRow}>
              <span className={styles.sliderLabel}>Music volume</span>
              <input
                type="range"
                className={styles.slider}
                aria-label="Music volume"
                min="0"
                max="1"
                step="0.05"
                value={settings.musicVolume}
                onChange={(e) => handleSettingChange({ musicVolume: parseFloat(e.target.value) })}
              />
              <span className={styles.sliderValue}>
                {Math.round(settings.musicVolume * 100)}%
              </span>
            </div>
          </section>

          {/* Connection diagnostics */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Connection</h3>
            <ConnectionSection />
          </section>

          {/* Keyboard shortcuts reference */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Keyboard Shortcuts</h3>
            <div className={styles.shortcutGrid}>
              {SHORTCUTS.map((sc) => (
                <ShortcutRow key={sc.keys} keys={sc.keys} action={sc.action} />
              ))}
            </div>
          </section>

          {/* Debug */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Debug</h3>
            <button
              className={styles.debugBtn}
              onClick={handleSendDebugReport}
              disabled={debugSending}
            >
              {debugSending ? 'Sending...' : 'Send Debug Report'}
            </button>
          </section>

          {/* Support */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Support</h3>
            <a className={styles.supportLink} href={supportHref} target="_blank" rel="noopener noreferrer">
              Contact Support
            </a>
          </section>

          {/* Logout */}
          <section className={styles.section}>
            <button className={styles.logoutBtn} onClick={handleLogout}>
              Logout
            </button>
          </section>
        </div>
      </div>
    </>
  );
}

/** A labelled switch row — a real checkbox under the hood, so keyboard and screen readers work. */
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <Switch
      className={styles.toggleRow}
      label={label}
      labelPosition="start"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function SizeSelector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MinimapSize;
  onChange: (val: MinimapSize) => void;
}) {
  const options: MinimapSize[] = ['small', 'medium', 'large'];
  return (
    <div className={styles.sizeRow}>
      <span className={styles.sizeLabel}>{label}</span>
      <div className={styles.sizeButtons}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`${styles.sizeBtn} ${value === opt ? styles.sizeBtnActive : ''}`}
            aria-pressed={value === opt}
            onClick={() => onChange(opt)}
          >
            {opt.charAt(0).toUpperCase() + opt.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Live gateway round-trip + byte counters — re-reads the connectionStats snapshot every second. */
function ConnectionSection() {
  const [stats, setStats] = useState(() => connectionStats.snapshot());

  useEffect(() => {
    const id = setInterval(() => setStats(connectionStats.snapshot()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <div className={styles.statRow}>
        <span className={styles.statLabel}>Server round-trip</span>
        <span
          className={styles.statValue}
          title={stats.latencyMs === null ? 'No measurement yet' : undefined}
        >
          {stats.latencyMs === null ? '—' : `${stats.latencyMs} ms`}
        </span>
      </div>
      <div className={styles.statRow}>
        <span className={styles.statLabel}>Sent</span>
        <span className={styles.statValue}>
          {formatByteCount(stats.bytesSent)} · {formatByteCount(stats.sentBytesPerSec)}/s
        </span>
      </div>
      <div className={styles.statRow}>
        <span className={styles.statLabel}>Received</span>
        <span className={styles.statValue}>
          {formatByteCount(stats.bytesReceived)} · {formatByteCount(stats.receivedBytesPerSec)}/s
        </span>
      </div>
    </>
  );
}

function ShortcutRow({ keys, action }: { keys: string; action: string }) {
  return (
    <div className={styles.shortcutRow}>
      <kbd className={styles.kbd}>{keys}</kbd>
      <span className={styles.shortcutAction}>{action}</span>
    </div>
  );
}
