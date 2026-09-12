/**
 * CompanyStage — Company selection grid.
 *
 * Stage C of the cinematic login flow.
 * Company cards grouped by role + "Create New Company" ghost card.
 *
 * A card shows everything `chooseCompany.asp` shows before a company is
 * entered: its cluster seal (`:186`), its facility count, and the owner role —
 * rendered as "Private" when the role is the logged-in account itself
 * (`chooseCompany.asp:193-197`).
 */

import { useMemo } from 'react';
import { GlassCard } from '../common';
import { Plus, ArrowLeft } from 'lucide-react';
import type { CompanyInfo } from '@/shared/types';
import styles from './CompanyStage.module.css';

interface CompanyStageProps {
  companies: CompanyInfo[];
  worldName: string;
  /** The logged-in account — the card whose owner role equals it reads "Private". */
  username: string;
  /** Interface Server host the seals are served from; without it, no <img>. */
  worldIp?: string;
  onSelect: (companyId: string) => void;
  onCreate: () => void;
  onBack: () => void;
  isLoading: boolean;
}

/**
 * The cluster seal the page itself loads — `images/comp-<cluster>.gif` under
 * the world's own NewLogon directory (`chooseCompany.asp:186`). The repo ships
 * no cluster art, so the image comes from the game host, as the mail bodies do.
 */
export function companySealUrl(worldIp: string, cluster: string): string {
  return `http://${worldIp}/Five/0/Visual/Voyager/NewLogon/images/comp-${cluster.toLowerCase()}.gif`;
}

/** The seal, or a text medallion when there is no art to point at. */
function CompanySeal({ cluster, worldIp }: { cluster?: string; worldIp?: string }) {
  if (cluster && worldIp) {
    return <img className={styles.seal} alt={cluster} src={companySealUrl(worldIp, cluster)} />;
  }
  return <span className={styles.sealFallback}>{cluster || '?'}</span>;
}

/** The role badge, with the ASP's "Private" rule applied. */
function roleLabel(company: CompanyInfo, username: string): string | undefined {
  if (!company.ownerRole) return undefined;
  return company.ownerRole === username ? 'Private' : company.ownerRole;
}

/** `38 Facilities` in the ASP; one facility is still singular here. */
function facilityLabel(count: number): string {
  return count === 1 ? '1 facility' : `${count} facilities`;
}

export function CompanyStage({
  companies,
  worldName,
  username,
  worldIp,
  onSelect,
  onCreate,
  onBack,
  isLoading,
}: CompanyStageProps) {
  // Group companies: player-owned vs political offices
  const { owned, political } = useMemo(() => {
    const ownedList: CompanyInfo[] = [];
    const politicalList: CompanyInfo[] = [];

    for (const company of companies) {
      const role = company.ownerRole?.toLowerCase() ?? '';
      if (role.includes('president') || role.includes('minister') || role.includes('mayor')) {
        politicalList.push(company);
      } else {
        ownedList.push(company);
      }
    }
    return { owned: ownedList, political: politicalList };
  }, [companies]);

  return (
    <div className={styles.stage}>
      <button className={styles.backLink} onClick={onBack}>
        <ArrowLeft size={14} />
        <span>Back to worlds</span>
      </button>

      <div className={styles.header}>
        <h2 className={styles.title}>{companies.length > 0 ? 'Select a Company' : 'Get Started'}</h2>
        <span className={styles.worldTag}>{worldName}</span>
      </div>

      {companies.length === 0 && (
        <p className={styles.emptyMessage}>
          Welcome to {worldName}! Create your first company to start building your empire.
        </p>
      )}

      {/* Player-owned companies */}
      {owned.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Your Companies</h3>
          <div className={styles.grid}>
            {owned.map((company) => (
              <GlassCard
                key={company.id}
                className={styles.companyCard}
                onClick={() => !isLoading && onSelect(company.id)}
              >
                <CompanySeal cluster={company.cluster} worldIp={worldIp} />
                <div className={styles.companyName}>{company.name}</div>
                {roleLabel(company, username) && (
                  <span className={styles.roleBadge}>{roleLabel(company, username)}</span>
                )}
                {typeof company.facilityCount === 'number' && (
                  <span className={styles.facilities}>{facilityLabel(company.facilityCount)}</span>
                )}
                {company.value != null && (
                  <span className={styles.companyValue}>
                    ${company.value.toLocaleString()}
                  </span>
                )}
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      {/* Political offices */}
      {political.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Political Offices</h3>
          <div className={styles.grid}>
            {political.map((company) => (
              <GlassCard
                key={company.id}
                className={styles.companyCard}
                onClick={() => !isLoading && onSelect(company.id)}
              >
                <CompanySeal cluster={company.cluster} worldIp={worldIp} />
                <div className={styles.companyName}>{company.name}</div>
                <span className={`${styles.roleBadge} ${styles.politicalBadge}`}>
                  {roleLabel(company, username)}
                </span>
                {typeof company.facilityCount === 'number' && (
                  <span className={styles.facilities}>{facilityLabel(company.facilityCount)}</span>
                )}
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      {/* Create new company */}
      <div className={styles.grid}>
        <GlassCard className={styles.createCard} onClick={() => !isLoading && onCreate()}>
          <Plus size={24} className={styles.createIcon} />
          <span className={styles.createLabel}>Create New Company</span>
        </GlassCard>
      </div>

      {isLoading && (
        <div className={styles.overlay}>
          <div className={styles.overlayContent}>
            <div className={styles.spinner} />
            <span className={styles.overlayText}>Entering world...</span>
          </div>
        </div>
      )}
    </div>
  );
}
