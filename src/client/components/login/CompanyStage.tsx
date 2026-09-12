/**
 * CompanyStage — Company selection grid.
 *
 * Stage C of the cinematic login flow.
 * Company cards grouped by role + "Create New Company" ghost card.
 */

import { useMemo } from 'react';
import { GlassCard } from '../common';
import { Plus, ArrowLeft, Eye } from 'lucide-react';
import type { CompanyInfo, LoginPageOutcome, WorldAdmission } from '@/shared/types';
import { VISITOR_COMPANY_ID } from '@/shared/visitor-visa';
import { isMinisterAccount } from '../../minister-account';
import { TimeoutCategory } from '@/shared/timeout-categories';
import { ConnectingGauge } from './ConnectingGauge';
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
  /** CanJoinWorldEx said this world will refuse a new company — so it is not offered. */
  admission?: WorldAdmission | null;
  /**
   * RDOCanJoinNewWorld said this account is at its nobility-bound world limit. It only blocks
   * a world the player holds no company in — the guard Kernel/World.pas:6028 applies.
   */
  atWorldLimit?: boolean;
  /** Enter with no company, the Visitor visa of chooseVisa.asp:108-127. */
  onVisit?: () => void;
  /** chooseCompany.asp:23 — a minister account is never offered company creation. */
  username: string;
}

export function CompanyStage({
  companies,
  worldName,
  onSelect,
  onCreate,
  onBack,
  isLoading,
  loginPage,
  admission,
  atWorldLimit,
  onVisit,
  username,
}: CompanyStageProps) {
  const isMinister = isMinisterAccount(username);
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

  // The world limit only bites where the player holds nothing here (Kernel/World.pas:6028),
  // and it takes precedence over the world's own admission answer — the reference client
  // never asked CanJoinWorldEx after a false RDOCanJoinNewWorld (logonComplete.asp:106, :144).
  const worldLimitBlocks = atWorldLimit === true && companies.length === 0;

  // No company here means the visa page, as the legacy did: chooseVisa.asp offers the
  // Visitor Visa and the Tycoon Visa, and the Tycoon Visa is how a first company gets
  // created (ServerCnxHandler.pas:2796-2798 sets NEWACCOUNT on AccountStatus
  // ACCOUNT_Unexisting OR GetCompanyCount = 0; logonComplete.asp:168-181 then routes to
  // chooseVisa.asp). It yields to every refusal the server actually made — the world
  // limit and the world's admission answer both win — and to a minister account, which
  // is not a tycoon and is never offered a visa.
  if (!worldLimitBlocks && !admission && !isMinister
      && (loginPage?.kind === 'visa' || companies.length === 0)) {
    const firstVisit = loginPage?.kind === 'visa' ? loginPage.firstVisit : false;
    return (
      <div className={styles.stage}>
        <button className={styles.backLink} onClick={onBack}>
          <ArrowLeft size={14} />
          <span>Back to worlds</span>
        </button>

        <div className={styles.header}>
          <h2 className={styles.title}>
            {firstVisit ? 'Apply for a Visa' : `Welcome back to ${worldName}`}
          </h2>
          <span className={styles.worldTag}>{worldName}</span>
        </div>

        <p className={styles.emptyMessage}>
          {firstVisit
            ? `There is no record of you in IFEL's files for ${worldName}. You need a visa to enter this world.`
            : `It seems that you already visited ${worldName}. Visitor Visas have to be renewed every time you enter — maybe it is time to become a Tycoon!`}
        </p>

        <div className={styles.grid}>
          <GlassCard className={styles.companyCard} onClick={() => !isLoading && onCreate()}>
            <div className={styles.companyName}>Tycoon Visa</div>
            <span className={styles.visaHint}>Found a company · Build an empire</span>
          </GlassCard>
          <GlassCard
            className={styles.companyCard}
            onClick={() => !isLoading && onSelect(VISITOR_COMPANY_ID)}
          >
            <div className={styles.companyName}>Visitor Visa</div>
            <span className={styles.visaHint}>Meet new people · See what&apos;s happening · Become a Tycoon later</span>
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

  // With companies the player still picks one; with none, the title names why there is
  // nothing to pick from.
  let emptyTitle = companies.length > 0 ? 'Select a Company' : 'Get Started';
  if (worldLimitBlocks) {
    emptyTitle = 'World Limit Reached';
  } else if (companies.length === 0 && admission) {
    emptyTitle = admission.kind === 'full' ? 'World Full' : 'Nobility Too Low';
  }

  return (
    <div className={styles.stage}>
      <button className={styles.backLink} onClick={onBack}>
        <ArrowLeft size={14} />
        <span>Back to worlds</span>
      </button>

      <div className={styles.header}>
        <h2 className={styles.title}>{emptyTitle}</h2>
        <span className={styles.worldTag}>{worldName}</span>
      </div>

      {worldLimitBlocks && (
        <>
          <p className={styles.denialMessage}>
            You have reached the number of worlds your nobility allows, so no company can be
            founded in {worldName}. You can look around as a visitor, or choose a world where you
            already own a company.
          </p>
          <div className={styles.grid}>
            <GlassCard className={styles.createCard} onClick={() => !isLoading && onVisit?.()}>
              <Eye size={24} className={styles.createIcon} />
              <span className={styles.createLabel}>Enter as a visitor</span>
            </GlassCard>
          </div>
          <button className={styles.backLink} onClick={onBack}>
            <ArrowLeft size={14} />
            <span>Choose another world</span>
          </button>
        </>
      )}

      {!worldLimitBlocks && admission && (
        <>
          <p className={styles.denialMessage}>
            {admission.kind === 'full'
              ? `${worldName} has reached its maximum number of tycoons, so no new company can be founded here. The other worlds are still open.`
              : `Your nobility is ${admission.shortfall} point(s) below the minimum ${worldName} requires to found a company.`}
          </p>
          <button className={styles.backLink} onClick={onBack}>
            <ArrowLeft size={14} />
            <span>Choose another world</span>
          </button>
        </>
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

      {/* Create new company — withheld when the server already said NewCompany would fail,
          when the account is at its world limit, or when the account is a minister
          (chooseCompany.asp:23, :233). */}
      {!worldLimitBlocks && !admission && !isMinister && (
        <div className={styles.grid}>
          <GlassCard className={styles.createCard} onClick={() => !isLoading && onCreate()}>
            <Plus size={24} className={styles.createIcon} />
            <span className={styles.createLabel}>Create New Company</span>
          </GlassCard>
        </div>
      )}

      {isLoading && (
        <div className={styles.overlay}>
          <div className={styles.overlayContent}>
            <ConnectingGauge label="Entering world..." category={TimeoutCategory.NORMAL} />
          </div>
        </div>
      )}
    </div>
  );
}
