/**
 * MapTools — the v2 map controls rail on the right edge (replaces v1's RightRail).
 *
 * One 40 px pill, vertically centred: Zoom in / out, Rotate left / right, Map overlays (which
 * v1 kept behind More), Docked minimap, Refresh and — last, muted — the Debug overlay. Every
 * RightRail callback is here unchanged. Each button shows a tooltip with its shortcut on hover
 * and keyboard focus. The rail slides left while the side panel is open.
 */

import type { ReactNode } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, RotateCw, Layers, Map, RefreshCw, Bug } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useClient } from '../../context';
import { MAP_TOOL_GROUPS, toolLabel, type MapToolId } from './dock-model';
import styles from './MapTools.module.css';

const ICONS: Record<MapToolId, ReactNode> = {
  zoomIn: <ZoomIn size={18} />,
  zoomOut: <ZoomOut size={18} />,
  rotateCcw: <RotateCcw size={18} />,
  rotateCw: <RotateCw size={18} />,
  overlays: <Layers size={18} />,
  minimap: <Map size={18} />,
  refresh: <RefreshCw size={18} />,
  debug: <Bug size={18} />,
};

export function MapTools() {
  const client = useClient();
  const surfaceOpen = useUiStore((s) => s.stack.length > 0 && !s.connectMode.active);
  const overlaysOpen = useUiStore((s) => s.leftPanel === 'overlays');

  const run: Record<MapToolId, () => void> = {
    zoomIn: () => client.onZoomIn(),
    zoomOut: () => client.onZoomOut(),
    rotateCcw: () => client.onRotateCCW(),
    rotateCw: () => client.onRotateCW(),
    overlays: () => useUiStore.getState().toggleLeftPanel('overlays'),
    minimap: () => client.onToggleMinimap(),
    refresh: () => client.onRefreshMap(),
    debug: () => client.onToggleDebugOverlay(),
  };

  const cls = [styles.rail, surfaceOpen ? styles.shifted : ''].filter(Boolean).join(' ');

  return (
    <nav className={cls} aria-label="Map controls" data-v2="map-tools">
      {MAP_TOOL_GROUPS.map((group, gi) => (
        <div key={group[0].id} className={styles.group}>
          {gi > 0 && <span className={styles.divider} aria-hidden="true" />}
          {group.map((tool) => {
            const active = tool.id === 'overlays' && overlaysOpen;
            return (
              <button
                key={tool.id}
                type="button"
                className={[styles.tool, active ? styles.active : '', tool.muted ? styles.muted : ''].filter(Boolean).join(' ')}
                onClick={run[tool.id]}
                aria-label={toolLabel(tool)}
                aria-pressed={tool.id === 'overlays' ? active : undefined}
              >
                <span className={styles.icon} aria-hidden="true">{ICONS[tool.id]}</span>
                <span className={styles.tip} aria-hidden="true">
                  {tool.label}
                  {tool.kbd && <kbd className={styles.kbd}>{tool.kbd}</kbd>}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
