/**
 * InspectorHero — the facility's identity and every action on it, in one block.
 *
 *   [icon] NAME  [Lvl n]
 *   Society, Owner · x, y        (civic: "Mayor: …" / "President: …")
 *   [Revenue] [ROI] [Construction | Workers]
 *   View on map · Refresh · Write to … · Add to Empire · Rename   [save state]
 *
 * v1 spread these over three places (the sheet's stack row, InspectorHeader, the civic
 * header in BuildingSurface). Here they are one row; each is offered under exactly the
 * rule v1 used (see `heroActionFlags`).
 */

import { useState } from 'react';
import { Check, Crosshair, Edit3, Mail, RefreshCw, Star, X } from 'lucide-react';
import type { BuildingDetailsResponse, BuildingFocusInfo } from '@/shared/types';
import { useBuildingStore, REFRESH_BUILDING_ACTION } from '../../store/building-store';
import { useEmpireStore } from '../../store/empire-store';
import { useGameStore } from '../../store/game-store';
import { usePoliticsStore } from '../../store/politics-store';
import { useClient } from '../../context';
import { Button, IconButton } from '../../components/common';
import { SaveIndicator } from '../../components/building/SaveIndicator';
import { parseRichDetails } from '../../components/building/RichDetails';
import { getCivicSubtitle } from '../../components/building/civic-subtitle';
import { isCapitolBuilding } from '../../components/politics/CivicTabConfig';
import { mayorAddress, tycoonAddress, writeTo } from '../../components/mail/write-to';
import { RENAME_PENDING_KEY } from '../../handlers/building-action-handler';
import {
  attributionLine,
  buildHeroKpis,
  findGroupValue,
  heroActionFlags,
  isFavorited,
} from './inspector-model';
import styles from './InspectorHero.module.css';

interface InspectorHeroProps {
  details: BuildingDetailsResponse;
  focus: BuildingFocusInfo;
  isCivic: boolean;
}

/** The facility picture — hidden until loaded, dropped on a failed load (as v1). */
function FacilityIcon({ url }: { url: string }) {
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading');
  if (state === 'failed') return null;
  return (
    <img
      className={state === 'shown' ? styles.icon : styles.iconPending}
      src={url}
      alt=""
      aria-hidden="true"
      onLoad={() => setState('shown')}
      onError={() => setState('failed')}
    />
  );
}

export function InspectorHero({ details, focus, isCivic }: InspectorHeroProps) {
  const client = useClient();
  const isOwner = useBuildingStore((s) => s.isOwner);
  const refreshing = useBuildingStore((s) => s.inFlightActions).has(REFRESH_BUILDING_ACTION);
  const favorites = useEmpireStore((s) => s.facilities);
  const worldName = useGameStore((s) => s.worldName);
  const politicsData = usePoliticsStore((s) => s.data);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');

  const ownerTycoon = findGroupValue(details, 'Creator');
  const townName = findGroupValue(details, 'Town');
  const flags = heroActionFlags({
    isCivic,
    isCapitol: isCapitolBuilding(details.tabs),
    isOwner,
    ownerTycoon,
    townName,
  });
  const level = focus.detailsText ? parseRichDetails(focus.detailsText)?.upgradeLevel : undefined;
  const subtitle = isCivic ? getCivicSubtitle(details, politicsData) : attributionLine(details.ownerName, ownerTycoon);
  const kpis = isCivic ? [] : buildHeroKpis(focus, findGroupValue(details, 'ROI'));
  const favorited = isFavorited(favorites, details.x, details.y);
  const { writeOwner, writeMayorTown, ownerTools } = flags;

  const startRename = () => {
    setNewName(details.buildingName);
    setRenaming(true);
  };
  const confirmRename = () => {
    const name = newName.trim();
    if (name) client.onRenameBuilding(details.x, details.y, name);
    setRenaming(false);
  };
  const cancelRename = () => setRenaming(false);

  return (
    <header className={styles.hero}>
      <div className={styles.nameRow}>
        {details.iconUrl && <FacilityIcon key={details.iconUrl} url={details.iconUrl} />}
        {renaming ? (
          <div className={styles.renameRow}>
            <input
              type="text"
              className={styles.renameInput}
              aria-label="New building name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename();
                if (e.key === 'Escape') cancelRename();
              }}
              autoFocus
            />
            <IconButton icon={<Check size={16} />} label="Confirm rename" size="sm" variant="ghost" onClick={confirmRename} />
            <IconButton icon={<X size={16} />} label="Cancel rename" size="sm" variant="ghost" onClick={cancelRename} />
          </div>
        ) : (
          <div className={styles.titleBlock}>
            <h2 className={styles.name} tabIndex={-1}>{details.buildingName}</h2>
            {level !== undefined && <span className={styles.level}>Lvl {level}</span>}
          </div>
        )}
      </div>

      <div className={styles.subRow}>
        {subtitle && <span className={isCivic ? styles.civicSubtitle : styles.attribution}>{subtitle}</span>}
        <span className={styles.coords}>{details.x}, {details.y}</span>
      </div>

      {kpis.length > 0 && (
        <dl className={styles.kpis}>
          {kpis.map((k) => (
            <div key={k.key} className={styles.kpi}>
              <dt className={styles.kpiLabel}>{k.label}</dt>
              <dd className={`${styles.kpiValue} ${styles[k.tone]}`}>{k.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {!renaming && (
        <div className={styles.actions} role="toolbar" aria-label="Facility actions">
          <Button
            size="sm"
            variant="ghost"
            iconLeft={<Crosshair size={14} />}
            onClick={() => client.onNavigateToBuilding(details.x, details.y)}
          >
            View on map
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconLeft={<RefreshCw size={14} />}
            disabled={refreshing}
            onClick={() => client.onRefreshBuilding(details.x, details.y, { userInitiated: true })}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          {writeOwner && (
            <Button
              size="sm"
              variant="ghost"
              iconLeft={<Mail size={14} />}
              title={`Write to ${writeOwner}`}
              onClick={() => writeTo(tycoonAddress(writeOwner, worldName))}
            >
              Write to owner
            </Button>
          )}
          {writeMayorTown && (
            <Button
              size="sm"
              variant="ghost"
              iconLeft={<Mail size={14} />}
              title={`Write to the Mayor of ${writeMayorTown}`}
              onClick={() => writeTo(mayorAddress(writeMayorTown))}
            >
              Write to Mayor
            </Button>
          )}
          {ownerTools && (
            <>
              {/* Disabled, not hidden, when already bookmarked: a control that vanishes reads as a bug. */}
              <Button
                size="sm"
                variant="ghost"
                iconLeft={<Star size={14} />}
                disabled={favorited}
                onClick={() => client.onAddFavorite(details.buildingName, details.x, details.y)}
              >
                {favorited ? 'In Empire list' : 'Add to Empire'}
              </Button>
              <Button size="sm" variant="ghost" iconLeft={<Edit3 size={14} />} onClick={startRename}>
                Rename
              </Button>
            </>
          )}
        </div>
      )}
      {ownerTools && (
        <div className={styles.saveSlot}>
          <SaveIndicator propertyKey={RENAME_PENDING_KEY} />
        </div>
      )}
    </header>
  );
}
