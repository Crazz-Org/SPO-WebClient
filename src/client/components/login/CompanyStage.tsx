/**
 * CompanyStage — Company selection grid.
 *
 * Stage C of the cinematic login flow.
 * Company cards grouped by role + "Create New Company" ghost card.
 */

import { useMemo } from 'react';
import { GlassCard } from '../common';
import { Plus, ArrowLeft } from 'lucide-react';
import type { CompanyInfo, LoginPageOutcome } from '@/shared/types';
import styles from './CompanyStage.module.css';

/** LogonNoAccess.asp:97-100 — the `01/01/2008` PA value is the sentinel for "never had access", not an expiry date. */
const NO_ACCESS_SENTINEL = '01/01/2008';

interface CompanyStageProps {
  companies: CompanyInfo[];
  worldName: string;
  onSelect: (companyId: string) => void;
  onCreate: () => void;
  onBack: () => void;
  isLoading: boolean;
  loginPage?: LoginPageOutcome | null;
}

export function CompanyStage({
  companies,
  worldName,
  onSelect,
  onCreate,
  onBack,
  isLoading,
  loginPage,
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

  if (loginPage?.kind === 'denied') {
    const isSentinel = !loginPage.expiresOn || loginPage.expiresOn === NO_ACCESS_SENTINEL;
    return (
      <div className={styles.stage}>
        <button className={styles.backLink} onClick={onBack}>
          <ArrowLeft size={14} />
          <span>Back to worlds</span>
        </button>

        <div className={styles.header}>
          <h2 className={styles.title}>Access Denied</h2>
          <span className={styles.worldTag}>{worldName}</span>
        </div>

        <p className={styles.denialMessage}>
          {isSentinel
            ? `A special travel pass (subscription or invitation) is required to enter ${worldName}.`
            : `Your portal travel privileges to ${worldName} expired on ${loginPage.expiresOn}.`}
        </p>
      </div>
    );
  }

  if (loginPage?.kind === 'error') {
    return (
      <div className={styles.stage}>
        <button className={styles.backLink} onClick={onBack}>
          <ArrowLeft size={14} />
          <span>Back to worlds</span>
        </button>

        <div className={styles.header}>
          <h2 className={styles.title}>Could not enter {worldName}</h2>
        </div>

        <p className={styles.denialMessage}>
          The portal rejected the request ({loginPage.errorCode}).
        </p>
      </div>
    );
  }

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
                <div className={styles.companyName}>{company.name}</div>
                {company.ownerRole && (
                  <span className={styles.roleBadge}>{company.ownerRole}</span>
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
                <div className={styles.companyName}>{company.name}</div>
                <span className={`${styles.roleBadge} ${styles.politicalBadge}`}>
                  {company.ownerRole}
                </span>
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
