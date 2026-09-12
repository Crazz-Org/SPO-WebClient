/**
 * CompanyCreationModal — Multi-panel cluster browser + company creation form.
 *
 * Shows cluster tabs, description, building categories, and facility previews.
 * Managed by ui-store modal state ('createCompany').
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useProfileStore } from '../../store/profile-store';
import { useClient } from '../../context';
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
  const magnaLocked = !canBuildAdvanced(profile?.levelTier, profile?.nobPoints);

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
      const msg = err instanceof Error ? err.message : 'Failed to create company';
      setError(msg);
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
          <h2 className={styles.title}>Create New Company</h2>
          <button className={styles.closeBtn} onClick={handleCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Cluster tabs */}
        <div className={styles.clusterTabs}>
          {clusters.map((id) => {
            const locked = id === 'Magna' && magnaLocked;
            return (
              <button
                key={id}
                className={`${styles.clusterTab} ${id === selectedCluster ? styles.clusterTabActive : ''} ${locked ? styles.clusterTabLocked : ''}`}
                onClick={() => handleClusterTabClick(id)}
                aria-disabled={locked || undefined}
                title={locked ? MAGNA_REFUSAL : undefined}
              >
                {CLUSTER_DISPLAY_NAMES[id as ClusterId] ?? id}
              </button>
            );
          })}
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
                      <span className={styles.facilityDesc}>{fac.zoneType}</span>
                    )}
                  </div>
                  <div className={styles.facilityMeta}>
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
                <input
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
