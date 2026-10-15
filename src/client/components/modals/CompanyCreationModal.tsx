/**
 * CompanyCreationModal — Multi-panel cluster browser + company creation form.
 *
 * Shows cluster tabs, description, building categories, and facility previews.
 * Managed by ui-store modal state ('createCompany').
 */

import { Fragment, useState, useCallback, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useProfileStore } from '../../store/profile-store';
import { useClient } from '../../context';
import { playerErrorMessage } from '../../player-error';
import {
  CLUSTER_DISPLAY_NAMES,
  MAX_COMPANY_NAME_LENGTH,
  companyNameProblem,
  MAGNA_REFUSAL,
  canBuildAdvanced,
} from '@/shared/cluster-data';
import type { ClusterId } from '@/shared/cluster-data';
import type { ClusterCategory } from '@/shared/types';
import { Skeleton } from '../common/Skeleton';
import styles from './CompanyCreationModal.module.css';

/**
 * The legacy theme's tab edges — toptabs.asp draws a 10 px picture between two tabs and at
 * both ends, chosen by where the selected tab is (updateTabImages): tab1/tab2 open the strip
 * before a selected/plain first tab, tab3 leads into the selected tab, tab6 leads out of
 * it, tab7 sits between two plain ones, tab4/tab5 close it after a selected/plain last tab.
 * Edge `i` stands before tab `i`; edge `count` closes the strip.
 */
function tabEdge(i: number, count: number, selected: number): string {
  if (i === 0) return selected === 0 ? 'tab1' : 'tab2';
  if (i === count) return selected === count - 1 ? 'tab4' : 'tab5';
  if (selected === i) return 'tab3';
  if (selected === i - 1) return 'tab6';
  return 'tab7';
}

export function CompanyCreationModal() {
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const clusters = useGameStore((s) => s.companyCreationClusters);
  const clusterInfo = useGameStore((s) => s.clusterInfo);
  const clusterInfoLoading = useGameStore((s) => s.clusterInfoLoading);
  const facilities = useGameStore((s) => s.clusterFacilities);
  const facilitiesLoading = useGameStore((s) => s.clusterFacilitiesLoading);
  // RESP_GET_PROFILE (event-handler.ts:412-433) is the only writer of this slice; unlike
  // tycoonStats it is never rebuilt by the periodic EVENT_TYCOON_UPDATE push
  // (event-handler.ts:189-205), which carries no level/nobility fields of its own.
  const profile = useProfileStore((s) => s.profile);
  // Gate only on what is known: a profile that has not arrived yet (e.g. the
  // first-company modal at login, or right after a company switch resets the
  // profile store — auth-handler.ts:417-426) must show the ordinary name field,
  // never a refusal the client has not established. The server's own
  // ERROR_UnknownTycoon = 7 stands as the only refusal in that case.
  const magnaLocked = profile !== null && !canBuildAdvanced(profile.levelTier, profile.nobPoints);

  const [selectedCluster, setSelectedCluster] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ClusterCategory | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const client = useClient();
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (modal === 'createCompany') {
      const firstCluster = clusters[0] ?? '';
      setSelectedCluster(firstCluster);
      setSelectedCategory(null);
      setName('');
      setLoading(false);
      setError('');
      // Request info for the first cluster
      if (firstCluster && client.onRequestClusterInfo) {
        client.onRequestClusterInfo(firstCluster);
      }
    }
  }, [modal]); // eslint-disable-line react-hooks/exhaustive-deps

  // The company exists and the world is being entered: give way to the loading screen, which
  // sits under the modal layer. Waiting for onCreateCompanySubmit to settle kept this page up,
  // stretched over the login screen that had already left, for the whole map load.
  const enteringWorld = useGameStore((s) => s.mapLoading.active);
  useEffect(() => {
    if (enteringWorld && modal === 'createCompany') closeModal();
  }, [enteringWorld, modal, closeModal]);

  // When cluster info arrives and we have no selected category, pick the first one
  useEffect(() => {
    if (clusterInfo && clusterInfo.categories.length > 0 && !selectedCategory) {
      const first = clusterInfo.categories[0];
      setSelectedCategory(first);
      if (client.onRequestClusterFacilities) {
        client.onRequestClusterFacilities(selectedCluster, first.folder);
      }
    }
  }, [clusterInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClusterTabClick = useCallback((clusterId: string) => {
    if (clusterId === selectedCluster) return;
    setSelectedCluster(clusterId);
    setSelectedCategory(null);
    useGameStore.getState().setClusterFacilities([]);
    if (client.onRequestClusterInfo) {
      client.onRequestClusterInfo(clusterId);
    }
  }, [selectedCluster, client]);

  const handleCategoryClick = useCallback((category: ClusterCategory) => {
    if (category.folder === selectedCategory?.folder) return;
    setSelectedCategory(category);
    if (client.onRequestClusterFacilities) {
      client.onRequestClusterFacilities(selectedCluster, category.folder);
    }
  }, [selectedCluster, selectedCategory, client]);

  const handleCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  const handleSubmit = useCallback(async () => {
    if (loading) return;
    if (selectedCluster === 'Magna' && magnaLocked) return;

    const trimmed = name.trim();
    const problem = companyNameProblem(trimmed);
    if (problem) {
      setError(problem);
      return;
    }
    if (!selectedCluster) {
      setError('Please select a cluster');
      return;
    }

    setError('');
    setLoading(true);

    try {
      if (client.onCreateCompanySubmit) {
        await client.onCreateCompanySubmit(trimmed, selectedCluster);
      }
      closeModal();
    } catch (err: unknown) {
      setError(playerErrorMessage('create this company', err));
    } finally {
      setLoading(false);
    }
  }, [name, selectedCluster, loading, magnaLocked, closeModal, client]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !loading) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [loading, handleSubmit, handleCancel],
  );

  if (modal !== 'createCompany') return null;

  return (
    <>
      <div className={styles.backdrop} onClick={handleCancel} aria-hidden="true" />
      <div className={styles.modal} role="dialog" aria-label="Create New Company" onKeyDown={handleKeyDown}>
        {/* Header */}
        <div className={styles.header}>
          {/* data-legacy-text: toptabs.asp's strCreateCompany (strAssociateWith follows it
              in the legacy stylesheet) */}
          <h2 className={styles.title} data-legacy-text="Create Company">
            Create New Company
          </h2>
          <button className={styles.closeBtn} onClick={handleCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Cluster tabs */}
        <div className={styles.clusterTabs}>
          {clusters.map((id, i) => {
            const locked = id === 'Magna' && magnaLocked;
            return (
              <Fragment key={id}>
                {/* The legacy theme's tab edge pictures; hidden in every other theme */}
                <span
                  className={styles.tabEdge}
                  data-edge={tabEdge(i, clusters.length, clusters.indexOf(selectedCluster))}
                  aria-hidden="true"
                />
                <button
                  className={`${styles.clusterTab} ${id === selectedCluster ? styles.clusterTabActive : ''} ${locked ? styles.clusterTabLocked : ''}`}
                  onClick={() => handleClusterTabClick(id)}
                  title={locked ? MAGNA_REFUSAL : undefined}
                >
                  {CLUSTER_DISPLAY_NAMES[id as ClusterId] ?? id}
                </button>
              </Fragment>
            );
          })}
          {clusters.length > 0 && (
            <span
              className={styles.tabEdge}
              data-edge={tabEdge(clusters.length, clusters.length, clusters.indexOf(selectedCluster))}
              aria-hidden="true"
            />
          )}
        </div>

        {/* Two-column body */}
        <div className={styles.body}>
          {/* Left sidebar: description + categories */}
          <div className={styles.sidebar}>
            {clusterInfoLoading ? (
              <div className={styles.descriptionLoading}>
                <Skeleton width="100%" height="12px" />
                <Skeleton width="90%" height="12px" />
                <Skeleton width="75%" height="12px" />
                <Skeleton width="85%" height="12px" />
              </div>
            ) : clusterInfo ? (
              <>
                <div className={styles.description}>{clusterInfo.description}</div>
                <div className={styles.categoriesHeader}>Categories</div>
                <div className={styles.categoryList}>
                  {clusterInfo.categories.map((cat) => (
                    <button
                      key={cat.folder}
                      className={`${styles.categoryItem} ${cat.folder === selectedCategory?.folder ? styles.categoryItemActive : ''}`}
                      onClick={() => handleCategoryClick(cat)}
                    >
                      <span className={styles.categoryIndicator} />
                      {cat.name}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.descriptionLoading}>
                <Skeleton width="100%" height="12px" />
                <Skeleton width="80%" height="12px" />
              </div>
            )}
          </div>

          {/* Right panel: facility list */}
          <div className={styles.facilityPanel}>
            {facilitiesLoading ? (
              <div className={styles.facilityLoadingGrid}>
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} width="100%" height="56px" />
                ))}
              </div>
            ) : facilities.length > 0 ? (
              facilities.map((fac, i) => (
                <div key={i} className={styles.facilityCard}>
                  {fac.iconUrl && (
                    <img
                      src={fac.iconUrl}
                      alt={fac.name}
                      className={styles.facilityIcon}
                    />
                  )}
                  <div className={styles.facilityInfo}>
                    <span className={styles.facilityName}>{fac.name}</span>
                    {fac.description && (
                      <span className={styles.facilityDesc}>{fac.description}</span>
                    )}
                    {fac.zoneType && (
                      <span className={`${styles.facilityDesc} ${styles.facilityZoneText}`}>{fac.zoneType}</span>
                    )}
                  </div>
                  <div className={styles.facilityMeta}>
                    {/* The zone picture of the legacy theme, titled as FacilityList.asp titles it */}
                    {fac.zoneKind && (
                      <span className={styles.zoneIcon} data-zone={fac.zoneKind} title={fac.zoneType || undefined} />
                    )}
                    {fac.cost && <span className={styles.facilityCost}>{fac.cost}</span>}
                    {/* CacheClass.Size — a ground surface in metres, never a duration
                        (NewLogon/FacilityList.asp:227). Renamed from `buildTime`. */}
                    {fac.area && <span className={styles.facilityTime}>{fac.area}</span>}
                  </div>
                </div>
              ))
            ) : selectedCategory ? (
              <div className={styles.facilityEmpty}>No facilities in this category</div>
            ) : (
              <div className={styles.facilityEmpty}>Select a category to browse facilities</div>
            )}
          </div>
        </div>

        {/* Bottom bar: error + name input + submit */}
        <div className={styles.bottomSection}>
          {error && <div className={styles.error} style={{ margin: '0 var(--space-5)' }}>{error}</div>}
          <div className={styles.bottomBar}>
            {selectedCluster === 'Magna' && magnaLocked ? (
              <div className={styles.refusal} role="status">{MAGNA_REFUSAL}</div>
            ) : (
              <>
                {/* entername.asp's label, legacy theme only */}
                <label className={styles.nameLabel} htmlFor="create-company-name">Company name :</label>
                <input
                  id="create-company-name"
                  ref={inputRef}
                  className={styles.nameInput}
                  type="text"
                  maxLength={MAX_COMPANY_NAME_LENGTH}
                  placeholder="Enter company name..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                />
                <button
                  className={styles.submitBtn}
                  onClick={handleSubmit}
                  disabled={loading || !selectedCluster}
                  data-legacy-text="OK"
                >
                  {loading ? 'Creating...' : 'Create Company'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
