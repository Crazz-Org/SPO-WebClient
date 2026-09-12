/**
 * DirectoryPage — the directory tree below the town list.
 *
 * One component for all ten legacy pages (`New Directory/*.asp`), because the gateway
 * already resolved each of them to one of four shapes: a town page, a folder of names, a
 * folder of facilities, or a facility card. What the page shows follows from the shape;
 * where a click goes follows from the ref (`directory-refs.ts`).
 */

import { Building2, Briefcase, Mail, MapPin } from 'lucide-react';
import { useSearchStore } from '../../store/search-store';
import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import { GlassCard } from '../common';
import { tycoonAddress, writeTo } from '../mail/write-to';
import type { ClientCallbacks } from '../../bridge/client-bridge';
import type {
  DirectoryRef,
  DirectoryTownPage,
  DirectoryFacilityRow,
  DirectoryFacilityCard,
} from '@/shared/types';
import { childRef, facilityRef, directoryHeading } from './directory-refs';
import styles from './SearchPanel.module.css';

/**
 * Open a directory page: push the level, then ask for it — the same order the people
 * search uses for a tycoon profile (`SearchPanel.tsx`), so the panel is already on the new
 * page while the reply is in flight.
 */
export function openDirectory(client: ClientCallbacks, ref: DirectoryRef): void {
  useSearchStore.getState().pushDirectory(ref);
  client.onSearchMenuDirectory(ref);
}

/** "Show in map" (`New Directory.lng:21`) — the action the legacy link performed. */
function ShowOnMap({ x, y, client }: { x: number; y: number; client: ClientCallbacks }) {
  return (
    <button
      type="button"
      className={styles.rowAction}
      onClick={(e) => {
        e.stopPropagation();
        client.onNavigateToBuilding(x, y);
      }}
    >
      <MapPin size={12} /> Show on map
    </button>
  );
}

function TownView({ town, client }: { town: DirectoryTownPage | null; client: ClientCallbacks }) {
  // RenderTownIn.asp:30 — a cache path that failed to resolve still renders a page, under
  // the name "Unknown Town". A reply that never arrived reads the same way.
  if (!town || town.name === 'Unknown Town') {
    return (
      <div className={styles.listContainer}>
        <GlassCard className={styles.profileCard} light>
          <span className={styles.profileName}>Unknown Town</span>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className={styles.listContainer}>
      <GlassCard className={styles.profileCard} light>
        <div className={styles.profileHeader}>
          {town.iconUrl
            ? <img src={town.iconUrl} alt="" width={48} className={styles.listItemIcon} />
            : <Building2 size={28} className={styles.listItemIcon} />}
          <span className={styles.profileName}>{town.name}</span>
        </div>

        <div className={styles.profileStatsGrid}>
          <span className={styles.profileStatLabel}>Inhabitants</span>
          <span className={styles.profileStatValue}>{town.inhabitants.toLocaleString()}</span>
          <span className={styles.profileStatLabel}>Quality of life</span>
          <span className={styles.profileStatValue}>{town.qualityOfLife}%</span>
          <span className={styles.profileStatLabel}>Unemployment</span>
          <span className={styles.profileStatValue}>{town.unemploymentPercent}%</span>
        </div>

        <div className={styles.directoryActions}>
          <ShowOnMap x={town.x} y={town.y} client={client} />
          {/* RenderTownIn.asp:85, :95 — both links key on the displayed town name. */}
          <button
            type="button"
            className={styles.rowAction}
            onClick={() => openDirectory(client, { kind: 'town-facilities', town: town.name })}
          >
            <Building2 size={12} /> Facilities
          </button>
          <button
            type="button"
            className={styles.rowAction}
            onClick={() => openDirectory(client, { kind: 'town-companies', town: town.name })}
          >
            <Briefcase size={12} /> Companies
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

function FolderView({
  refValue, items, ownedBy, client,
}: { refValue: DirectoryRef; items: string[]; ownedBy: string | null; client: ClientCallbacks }) {
  return (
    <div className={styles.listContainer}>
      <h3 className={styles.sectionTitle}>{directoryHeading(refValue)}</h3>
      {/* InTownCompany.asp:70 — "Owned by %1" (New Directory.lng:13). */}
      {ownedBy && <div className={styles.listItemDetails}><span>Owned by {ownedBy}</span></div>}
      {items.length === 0
        ? <div className={styles.emptyState}>Nothing listed here.</div>
        : items.map((item) => {
          const child = childRef(refValue, item);
          return (
            <div
              key={item}
              className={styles.clickableListItem}
              onClick={() => { if (child) openDirectory(client, child); }}
            >
              <Building2 size={14} className={styles.listItemIcon} />
              <span>{item}</span>
            </div>
          );
        })}
    </div>
  );
}

function FacilityListView({
  refValue, facilities, client,
}: { refValue: DirectoryRef; facilities: DirectoryFacilityRow[]; client: ClientCallbacks }) {
  if (facilities.length === 0) {
    return (
      <div className={styles.listContainer}>
        <h3 className={styles.sectionTitle}>{directoryHeading(refValue)}</h3>
        <div className={styles.emptyState}>Nothing listed here.</div>
      </div>
    );
  }

  return (
    <div className={styles.listContainer}>
      <h3 className={styles.sectionTitle}>{directoryHeading(refValue)}</h3>
      {facilities.map((row) => (
        <GlassCard
          key={`${row.path}/${row.itemName}`}
          className={styles.listItem}
          light
          onClick={() => openDirectory(client, facilityRef(row))}
        >
          <div className={styles.listItemHeader}>
            {row.iconUrl
              ? <img src={row.iconUrl} alt="" width={30} className={styles.listItemIcon} />
              : <Building2 size={16} className={styles.listItemIcon} />}
            <span className={styles.listItemTitle}>{row.name}</span>
          </div>
          <div className={styles.listItemDetails}>
            {/* BrowseFacFolder.inc:24-36 — the row itself says which branch it took: the
                owning company, or the coordinates when ShowCompany was false. */}
            <span>{row.company ?? `(${row.x}, ${row.y})`}</span>
            <ShowOnMap x={row.x} y={row.y} client={client} />
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

function FacilityView({
  facility, client, worldName,
}: { facility: DirectoryFacilityCard | null; client: ClientCallbacks; worldName: string }) {
  if (!facility) {
    return <div className={styles.emptyState}>This facility is no longer in the directory.</div>;
  }

  return (
    <div className={styles.listContainer}>
      <GlassCard className={styles.profileCard} light>
        <div className={styles.profileHeader}>
          {facility.iconUrl
            ? <img src={facility.iconUrl} alt="" width={48} className={styles.listItemIcon} />
            : <Building2 size={28} className={styles.listItemIcon} />}
          <span className={styles.profileName}>{facility.name}</span>
        </div>
        <div className={styles.listItemDetails}><span>{facility.company}</span></div>

        {/* OpenFacility.asp:44-73 — the three values are printed as the server formatted
            them, ROI included ("Already." / "<N> years." / "Never."). */}
        <div className={styles.profileStatsGrid}>
          <span className={styles.profileStatLabel}>Net profit</span>
          <span className={styles.profileStatValue}>{facility.netProfitText}</span>
          <span className={styles.profileStatLabel}>Cost</span>
          <span className={styles.profileStatValue}>{facility.costText}</span>
          <span className={styles.profileStatLabel}>ROI</span>
          <span className={styles.profileStatValue}>{facility.roiText}</span>
        </div>

        <div className={styles.directoryActions}>
          <ShowOnMap x={facility.x} y={facility.y} client={client} />
          {/* OpenFacility.asp:88 addresses the composer to the facility's creator. */}
          {facility.creator !== '' && (
            <button
              type="button"
              className={styles.rowAction}
              onClick={() => writeTo(tycoonAddress(facility.creator, worldName))}
            >
              <Mail size={12} /> Send mail
            </button>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

export function DirectoryPage() {
  const entry = useSearchStore((s) => s.directoryStack[s.directoryStack.length - 1]);
  const worldName = useGameStore((s) => s.worldName);
  const client = useClient();

  if (!entry) return null;

  const { ref, page } = entry;

  if (ref.kind === 'town') {
    return <TownView town={page?.kind === 'town' ? page.town : null} client={client} />;
  }

  if (ref.kind === 'facility') {
    return (
      <FacilityView
        facility={page?.kind === 'facility' ? page.facility : null}
        client={client}
        worldName={worldName}
      />
    );
  }

  if (page?.kind === 'facility-list') {
    return <FacilityListView refValue={ref} facilities={page.facilities} client={client} />;
  }

  return (
    <FolderView
      refValue={ref}
      items={page?.kind === 'folder' ? page.items : []}
      ownedBy={page?.kind === 'folder' ? page.ownedBy : null}
      client={client}
    />
  );
}
