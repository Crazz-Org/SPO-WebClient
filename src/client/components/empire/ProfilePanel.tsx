/**
 * ProfilePanel — Tycoon profile, master/detail.
 *
 * A vertical list of sections (Curriculum, Bank, P&L, Companies, Initial
 * Suppliers, Strategy). Picking one opens a drawer to the right of the list
 * with that section's content.
 *
 * Nothing is selected on mount: no section means no server round-trip, so
 * opening the panel costs nothing until the user asks for a section.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  GraduationCap, Landmark, TrendingUp, Factory, Link, Flag, X, Plus,
  RotateCcw, LogOut, Wrench, ChevronUp, ChevronRight, ArrowLeft, User,
} from 'lucide-react';
import { Skeleton, SkeletonLines, ConfirmDialog, Switch, Sparkline, ErrorState } from '../common';
import { useProfileStore, type ProfileTab, type CompanyProfitLossView } from '../../store/profile-store';
import { useGameStore } from '../../store/game-store';
import { useUiStore } from '../../store/ui-store';
import { useClient } from '../../context';
import { isMinisterAccount } from '../../minister-account';
import type {
  AutoConnectionActionType,
  CurriculumActionType,
  ProfitLossNode as ProfitLossNodeData,
  TransferDenial,
} from '@/shared/types';
import styles from './ProfilePanel.module.css';

import { formatMoney } from '../../format-utils';
// Re-export for backwards compatibility (used by ProfilePanel.test.ts)
export { formatMoney };

interface ProfileSection {
  id: ProfileTab;
  icon: typeof GraduationCap;
  label: string;
  hint: string;
}

const SECTIONS: ProfileSection[] = [
  { id: 'curriculum', icon: GraduationCap, label: 'Curriculum', hint: 'Level, prestige and ranking' },
  { id: 'bank', icon: Landmark, label: 'Bank Account', hint: 'Balance, loans and credit' },
  { id: 'profitloss', icon: TrendingUp, label: 'Profit & Loss', hint: 'Revenue and expenses' },
  { id: 'companies', icon: Factory, label: 'Companies', hint: 'Companies you own' },
  { id: 'autoconnections', icon: Link, label: 'Initial Suppliers', hint: 'Default supply links' },
  { id: 'policy', icon: Flag, label: 'Strategy', hint: 'Stance towards other tycoons' },
];

export function ProfilePanel() {
  const currentTab = useProfileStore((s) => s.currentTab);
  const isLoading = useProfileStore((s) => s.isLoading);
  const refreshCounter = useProfileStore((s) => s.refreshCounter);
  const setCurrentTab = useProfileStore((s) => s.setCurrentTab);
  const client = useClient();

  // Fetch only once a section is open — an unopened panel costs no round-trip.
  useEffect(() => {
    if (currentTab === null) return;
    requestTabData(currentTab, client);
  }, [currentTab, client, refreshCounter]);

  // Leaving the panel collapses the drawer, so it reopens on the list.
  useEffect(() => () => {
    useProfileStore.getState().setCurrentTab(null);
  }, []);

  const toggleSection = useCallback((id: ProfileTab) => {
    setCurrentTab(useProfileStore.getState().currentTab === id ? null : id);
  }, [setCurrentTab]);

  const activeSection = SECTIONS.find((s) => s.id === currentTab) ?? null;

  return (
    <div className={styles.panel}>
      <ProfileIdentityHeader />
      <div className={`${styles.body} ${activeSection ? styles.split : ''}`}>
        <SectionList activeTab={currentTab} onSelect={toggleSection} />
        {activeSection && (
          <SectionDrawer section={activeSection} isLoading={isLoading} onClose={() => setCurrentTab(null)} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Identity header — portrait, name and rank, shown above the section list
// ---------------------------------------------------------------------------

function ProfileIdentityHeader() {
  const profile = useProfileStore((s) => s.profile);
  const [photoErrored, setPhotoErrored] = useState(false);

  if (!profile) return null;

  const showPhoto = Boolean(profile.photoUrl) && !photoErrored;

  return (
    <header className={styles.identityHeader}>
      {showPhoto ? (
        <img
          className={styles.identityPhoto}
          src={profile.photoUrl}
          alt={profile.name}
          onError={() => setPhotoErrored(true)}
        />
      ) : (
        <div className={styles.identityPhotoPlaceholder}>
          <User size={20} />
        </div>
      )}
      <span className={styles.identityName}>{profile.name}</span>
      <span className={styles.identityRank}>#{profile.ranking}</span>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Section list — vertical rail, the panel's default view
// ---------------------------------------------------------------------------

function SectionList({ activeTab, onSelect }: { activeTab: ProfileTab | null; onSelect: (id: ProfileTab) => void }) {
  return (
    <nav className={styles.sectionList} aria-label="Profile sections">
      {SECTIONS.map((section) => {
        const Icon = section.icon;
        const active = section.id === activeTab;
        return (
          <button
            key={section.id}
            type="button"
            aria-expanded={active}
            aria-current={active ? 'true' : undefined}
            className={`${styles.sectionItem} ${active ? styles.sectionItemActive : ''}`}
            onClick={() => onSelect(section.id)}
          >
            <Icon size={16} className={styles.sectionIcon} />
            <span className={styles.sectionText}>
              <span className={styles.sectionLabel}>{section.label}</span>
              <span className={styles.sectionHint}>{section.hint}</span>
            </span>
            <ChevronRight size={14} className={styles.sectionChevron} />
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Section drawer — slides out to the right of the list
// ---------------------------------------------------------------------------

function SectionDrawer({ section, isLoading, onClose }: { section: ProfileSection; isLoading: boolean; onClose: () => void }) {
  const Icon = section.icon;
  return (
    <section className={styles.drawer} aria-label={section.label}>
      <header className={styles.drawerHeader}>
        <button type="button" className={styles.drawerBack} onClick={onClose} aria-label="Back to sections">
          <ArrowLeft size={16} />
        </button>
        <Icon size={15} className={styles.drawerIcon} />
        <h3 className={styles.drawerTitle}>{section.label}</h3>
        <button type="button" className={styles.drawerClose} onClick={onClose} aria-label="Close section">
          <X size={15} />
        </button>
      </header>
      <div className={styles.content}>
        {isLoading ? (
          <div className={styles.loading}>
            <Skeleton width="100%" height="60px" />
            <SkeletonLines lines={4} />
          </div>
        ) : (
          <TabContent tab={section.id} />
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function requestTabData(tab: ProfileTab, client: ReturnType<typeof useClient>) {
  const setLoading = useProfileStore.getState().setLoading;
  setLoading(true);

  switch (tab) {
    case 'curriculum':
      client.onProfileCurriculum();
      break;
    case 'bank':
      client.onProfileBank();
      break;
    case 'profitloss':
      client.onProfileProfitLoss();
      break;
    case 'companies':
      client.onProfileCompanies();
      break;
    case 'autoconnections':
      client.onProfileAutoConnections();
      break;
    case 'policy':
      client.onProfilePolicy();
      break;
  }
}

function TabContent({ tab }: { tab: ProfileTab }) {
  switch (tab) {
    case 'curriculum':
      return <CurriculumTab />;
    case 'bank':
      return <BankTab />;
    case 'profitloss':
      return <ProfitLossTab />;
    case 'companies':
      return <CompaniesTab />;
    case 'autoconnections':
      return <AutoConnectionsTab />;
    case 'policy':
      return <PolicyTab />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Curriculum Tab — full legacy layout
// ---------------------------------------------------------------------------

function CurriculumTab() {
  const data = useProfileStore((s) => s.curriculum);
  const client = useClient();
  const [confirmAction, setConfirmAction] = useState<CurriculumActionType | null>(null);

  const handleAction = useCallback((action: CurriculumActionType) => {
    if (action === 'resetAccount' || action === 'abandonRole') {
      setConfirmAction(action);
    } else if (action === 'upgradeLevel') {
      client.onProfileCurriculumAction('upgradeLevel', !data?.isUpgradeRequested);
    } else {
      client.onProfileCurriculumAction(action);
    }
  }, [client, data?.isUpgradeRequested]);

  const handleConfirm = useCallback(() => {
    if (confirmAction) {
      client.onProfileCurriculumAction(confirmAction);
      setConfirmAction(null);
    }
  }, [client, confirmAction]);

  if (!data) return <EmptyState message="No curriculum data" />;
  if (data.cacheUnavailable) return <ProfileUnavailable />;

  return (
    <div className={styles.tabBody}>
      {/* Section 1: Summary Stats */}
      <div className={styles.statGrid}>
        <StatCard label="Fortune" value={data.fortune || formatMoney(data.budget)} />
        <StatCard label="Avg. Profit" value={data.averageProfit || '-'} />
        <StatCard label="Prestige" value={`${data.prestige} pts`} />
        <StatCard label="Nobility" value={`${data.nobPoints} pts`} />
      </div>
      {data.tournamentOn && (
        <div className={styles.statGrid}>
          <StatCard label="Ability" value={`${data.abilityTotal} points`} />
        </div>
      )}
      {data.tournamentOn && (
        <div className={styles.abilityBreakdown}>
          {data.abilityRankingPoints} from the rankings, {data.abilityLevelPoints} for being at
          the highest level, {data.abilityLoanPoints} for having loans
        </div>
      )}

      {/* Section 2: Action Buttons */}
      <div className={styles.cvActions}>
        <button className={styles.dangerBtn} onClick={() => handleAction('resetAccount')}>
          <RotateCcw size={12} />
          Reset Account
        </button>
        <button className={styles.dangerBtn} onClick={() => handleAction('abandonRole')}>
          <LogOut size={12} />
          Abandon Role
        </button>
        <button className={styles.utilityBtn} onClick={() => handleAction('rebuildLinks')}>
          <Wrench size={12} />
          Rebuild Links
        </button>
      </div>

      {/* Section 3: Level Progression */}
      <div className={styles.levelSection}>
        <div className={styles.levelCard}>
          <div className={styles.levelHeader}>Current Level</div>
          <div className={styles.levelName}>{data.currentLevelName}</div>
          {data.currentLevelDescription && (
            <div className={styles.levelDesc}>{data.currentLevelDescription}</div>
          )}
          {data.currentLevelBadgeUrl && (
            <img
              className={styles.levelBadge}
              src={data.currentLevelBadgeUrl}
              alt={`${data.currentLevelName} level badge`}
              width={80}
              height={80}
            />
          )}
          {data.currentLevelCondition && (
            <div className={styles.levelCondition}>{data.currentLevelCondition}</div>
          )}
          {data.canUpgrade && (
            <label className={styles.upgradeCheck}>
              <input
                type="checkbox"
                checked={data.isUpgradeRequested}
                onChange={() => handleAction('upgradeLevel')}
              />
              <ChevronUp size={12} />
              Upgrade to next level
            </label>
          )}
        </div>
        {data.levelReqStatus && (
          <div className={styles.levelReqStatus} role="alert">
            {data.levelReqStatus}
          </div>
        )}
        {data.nextLevelName && (
          <div className={styles.levelCard}>
            <div className={styles.levelHeader}>Next Level</div>
            <div className={styles.levelName}>{data.nextLevelName}</div>
            {data.nextLevelDescription && (
              <div className={styles.levelDesc}>{data.nextLevelDescription}</div>
            )}
            {data.nextLevelRequirements && (
              <div className={styles.levelReqs}>
                <strong>Requires:</strong> {data.nextLevelRequirements}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 4: Quick Stats */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Stats</h4>
        <div className={styles.cvStatsGrid}>
          <div className={styles.cvStatRow}>
            <span className={styles.cvStatLabel}>Ranking</span>
            <span className={styles.cvStatValue}>#{data.ranking}</span>
          </div>
          <div className={styles.cvStatRow}>
            <span className={styles.cvStatLabel}>Facilities</span>
            <span className={styles.cvStatValue}>{data.facCount} / {data.facMax}</span>
          </div>
          <div className={styles.cvStatRow}>
            <span className={styles.cvStatLabel}>Area</span>
            <span className={styles.cvStatValue}>{data.area}</span>
          </div>
          <div className={styles.cvStatRow}>
            <span className={styles.cvStatLabel}>Fac. Prestige</span>
            <span className={styles.cvStatValue}>{data.facPrestige}</span>
          </div>
          <div className={styles.cvStatRow}>
            <span className={styles.cvStatLabel}>Research</span>
            <span className={styles.cvStatValue}>{data.researchPrestige}</span>
          </div>
        </div>
      </div>

      {/* Section 5: Rankings Table */}
      {data.rankings.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>{data.tycoonName} in the rankings</h4>
          <div className={styles.rankingsGrid}>
            {data.rankings.map((r, i) => (
              <div key={i} className={styles.rankingRow}>
                <span className={styles.rankingCategory}>{r.category}</span>
                <span className={styles.rankingValue}>
                  {r.rank !== null ? `#${r.rank}` : '-'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 6: Curriculum Items */}
      {data.curriculumItems.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Curriculum Items</h4>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Prestige</th>
                </tr>
              </thead>
              <tbody>
                {data.curriculumItems.map((item, i) => (
                  <tr key={i}>
                    <td>{item.item}</td>
                    <td className={`${styles.numCell} ${item.prestige >= 0 ? styles.positiveValue : styles.negativeValue}`}>
                      {item.prestige >= 0 ? '+' : ''}{item.prestige}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction === 'resetAccount' ? 'Reset Account' : 'Abandon Role'}
          message={
            confirmAction === 'resetAccount'
              ? 'This will permanently reset your tycoon account. All progress will be lost. This action cannot be undone.'
              : 'This will abandon your current role. You will lose all associated privileges. This action cannot be undone.'
          }
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bank Tab — with date column, pay off, total row, dynamic calc
// ---------------------------------------------------------------------------

/** What TycoonBankAccount.asp prints where the Send form would be (:476, :478, :488, :506). */
const TRANSFER_DENIED_TEXT: Record<TransferDenial, string> = {
  tournament: 'Money transfers are not allowed in Tournament planets',
  loans: 'You cannot send money that you received with loans or as part of your Investor Visa',
  'no-money': 'You have no money to send',
  demo: 'This is a Demo account: you cannot transfer money to other players or political figures',
};

function BankTab() {
  const data = useProfileStore((s) => s.bankAccount);
  const client = useClient();
  const [action, setAction] = useState<'borrow' | 'send' | null>(null);
  const [amount, setAmount] = useState('');
  const [toTycoon, setToTycoon] = useState('');
  const [reason, setReason] = useState('');

  // Dynamic interest/term calculation based on borrow amount.
  // Declared before the early return: a hook that only runs once the data lands
  // changes the hook order between renders, and React throws on the next render.
  const dynamicCalc = useMemo(() => {
    if (!data) return null;
    const numAmount = parseFloat(amount.replace(/,/g, ''));
    if (!numAmount || isNaN(numAmount)) return null;
    const totalLoansNum = parseFloat((data.totalLoans || '0').replace(/,/g, ''));
    const combined = totalLoansNum + numAmount;
    const interest = Math.round(combined / 100_000_000);
    const term = Math.max(5, 200 - Math.round(combined / 10_000_000));
    return { interest, term };
  }, [amount, data]);

  if (!data) return <EmptyState message="No bank data" />;
  if (data.cacheUnavailable) return <ProfileUnavailable />;

  const handleBorrow = () => {
    if (!amount) return;
    client.onProfileBankAction('borrow', amount);
    setAction(null);
    setAmount('');
  };

  const handleSend = () => {
    if (!amount || !toTycoon) return;
    client.onProfileBankAction('send', amount, toTycoon, reason || undefined);
    setAction(null);
    setAmount('');
    setToTycoon('');
    setReason('');
  };

  const handlePayoff = (loanIndex: number) => {
    client.onProfileBankAction('payoff', undefined, undefined, undefined, loanIndex);
  };

  const cancelAction = () => {
    setAction(null);
    setAmount('');
    setToTycoon('');
    setReason('');
  };

  return (
    <div className={styles.tabBody}>
      <div className={styles.statGrid}>
        <StatCard label="Balance" value={formatMoney(data.balance)} />
        <StatCard label="Max Loan" value={formatMoney(data.maxLoan)} />
      </div>

      {data.loans.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Active Loans</h4>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Bank</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Rate</th>
                  <th>Term</th>
                  <th>Next payment</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.loans.map((loan) => (
                  <tr key={loan.loanIndex}>
                    <td>{loan.bank}</td>
                    <td>{loan.date || '-'}</td>
                    <td className={styles.numCell}>{formatMoney(loan.amount)}</td>
                    <td className={styles.numCell}>{loan.interest}%</td>
                    <td className={styles.numCell}>{loan.term}y</td>
                    <td className={styles.numCell}>{formatMoney(loan.slice)}</td>
                    <td>
                      <button
                        className={styles.payoffBtn}
                        onClick={() => handlePayoff(loan.loanIndex)}
                      >
                        Pay Off
                      </button>
                    </td>
                  </tr>
                ))}
                {data.totalNextPayment && (
                  <tr className={styles.totalRow}>
                    <td colSpan={5}><strong>Total</strong></td>
                    <td className={styles.numCell}><strong>{formatMoney(data.totalNextPayment)}</strong></td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {data.loans.length === 0 && (
        <p className={styles.hint}>No active loans</p>
      )}

      {/* Action buttons */}
      <div className={styles.actionBar}>
        <button
          className={`${styles.actionPill} ${action === 'borrow' ? styles.actionPillActive : ''}`}
          onClick={() => setAction(action === 'borrow' ? null : 'borrow')}
        >
          Request Loan
        </button>
        {!data.transferDenied && (
          <button
            className={`${styles.actionPill} ${action === 'send' ? styles.actionPillActive : ''}`}
            onClick={() => setAction(action === 'send' ? null : 'send')}
          >
            Send Money
          </button>
        )}
      </div>
      {data.transferDenied && (
        <p className={styles.hint}>{TRANSFER_DENIED_TEXT[data.transferDenied]}</p>
      )}

      {/* Inline forms */}
      {action === 'borrow' && (
        <div className={styles.inlineForm}>
          <label className={styles.formLabel}>Amount</label>
          <input
            className={styles.formInput}
            type="text"
            placeholder="Enter amount..."
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className={styles.hint}>
            Max loan: ${data.maxLoan}
            {dynamicCalc
              ? <> &middot; Rate: {dynamicCalc.interest}% &middot; Term: {dynamicCalc.term}y</>
              : <> &middot; Rate: {data.defaultInterest}% &middot; Term: {data.defaultTerm}y</>
            }
          </p>
          <div className={styles.formActions}>
            <button className={styles.formSubmit} onClick={handleBorrow} disabled={!amount}>Borrow</button>
            <button className={styles.formCancel} onClick={cancelAction}>Cancel</button>
          </div>
        </div>
      )}
      {action === 'send' && !data.transferDenied && (
        <div className={styles.inlineForm}>
          <label className={styles.formLabel}>Recipient</label>
          <input
            className={styles.formInput}
            type="text"
            placeholder="Tycoon name..."
            value={toTycoon}
            onChange={(e) => setToTycoon(e.target.value)}
          />
          <label className={styles.formLabel}>Amount</label>
          <input
            className={styles.formInput}
            type="text"
            placeholder="Enter amount..."
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {data.maxTransfer && (
            <p className={styles.hint}>You can transfer up to ${data.maxTransfer}</p>
          )}
          <label className={styles.formLabel}>Reason (optional)</label>
          <input
            className={styles.formInput}
            type="text"
            placeholder="Reason..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className={styles.formActions}>
            <button className={styles.formSubmit} onClick={handleSend} disabled={!amount || !toTycoon}>Send</button>
            <button className={styles.formCancel} onClick={cancelAction}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// P&L Tab — with inline history series
// ---------------------------------------------------------------------------

function ProfitLossTab() {
  const data = useProfileStore((s) => s.profitLoss);
  if (!data) return <EmptyState message="No P&L data" />;
  if (data.cacheUnavailable) return <ProfileUnavailable />;

  return (
    <div className={styles.tabBody}>
      <ProfitLossNode node={data.root} />
    </div>
  );
}

function ProfitLossNode({ node, inTaxSection = false }: { node: ProfitLossNodeData; inTaxSection?: boolean }) {
  const indent = node.level * 12;
  const history = node.chartData && node.chartData.length >= 2 ? node.chartData : null;
  const historySummary = history
    ? `Latest ${formatMoney(history[history.length - 1])} · High ${formatMoney(Math.max(...history))} · Low ${formatMoney(Math.min(...history))}`
    : undefined;
  const isTaxHeader = node.isTax === true && node.isHeader === true;
  const showSplit = isTaxHeader || inTaxSection;
  const childInTaxSection = node.isHeader ? node.isTax === true : inTaxSection;
  return (
    <>
      <div
        className={`${styles.plRow} ${node.isHeader ? styles.plHeader : ''}`}
        style={{ paddingLeft: `${indent + 12}px` }}
      >
        <span className={styles.plLabel}>{node.label}</span>
        {history && (
          <span className={styles.plChart} title={historySummary} aria-label={historySummary}>
            <Sparkline data={history} width={64} height={14} />
          </span>
        )}
        <span className={`${styles.plAmount} ${node.amount.startsWith('-') ? styles.negativeValue : ''}`}>{node.amount}</span>
        {showSplit && (
          <span className={styles.plSplit}>
            {isTaxHeader ? (
              <>
                <span className={styles.plSplitCell}>Town</span>
                <span className={styles.plSplitCell}>IFEL</span>
              </>
            ) : node.secAmount !== undefined ? (
              <>
                {(() => {
                  const town = String(Number(node.amount) - Number(node.secAmount));
                  return (
                    <>
                      <span className={`${styles.plSplitCell} ${town.startsWith('-') ? styles.negativeValue : ''}`}>{town}</span>
                      <span className={`${styles.plSplitCell} ${node.secAmount.startsWith('-') ? styles.negativeValue : ''}`}>{node.secAmount}</span>
                    </>
                  );
                })()}
              </>
            ) : (
              <>
                <span className={styles.plSplitCell} />
                <span className={styles.plSplitCell} />
              </>
            )}
          </span>
        )}
      </div>
      {node.children?.map((child, i) => (
        <ProfitLossNode key={i} node={child} inTaxSection={childInTaxSection} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Companies Tab — with switch + create
// ---------------------------------------------------------------------------

function CompaniesTab() {
  const data = useProfileStore((s) => s.companies);
  const companyView = useProfileStore((s) => s.companyProfitLoss);
  const client = useClient();
  const currentCompanyName = useGameStore((s) => s.companyName);
  const isSwitchingCompany = useGameStore((s) => s.isSwitchingCompany);
  const username = useGameStore((s) => s.username);
  const isMinister = isMinisterAccount(username);

  if (!data) return <EmptyState message="No companies data" />;
  if (data.cacheUnavailable) return <ProfileUnavailable />;
  if (companyView) return <CompanyProfitLossView view={companyView} />;

  const openProfitLoss = (co: { name: string; cluster: string }) => {
    useProfileStore.getState().openCompanyProfitLoss(co.name, co.cluster);
    client.onProfileCompanyProfitLoss(co.name, co.cluster);
  };

  const handleSwitch = (co: { companyId: number; name: string; ownerRole: string }) => {
    if (co.name === (data.currentCompany || currentCompanyName)) return;
    if (isSwitchingCompany) return;
    client.onProfileSwitchCompany(co.companyId, co.name, co.ownerRole);
  };

  const handleCreate = () => {
    useUiStore.getState().openModal('createCompany');
    client.onCreateCompany();
  };

  return (
    <div className={styles.tabBody}>
      <p className={styles.companyInstructions}>
        You have registered the following companies in {data.worldName || 'this world'}.{' '}
        {isMinister ? 'Choose one.' : 'Choose one or create a new one.'}
      </p>
      {isSwitchingCompany && (
        <div className={styles.switchingBanner}>
          <Skeleton width="14px" height="14px" />
          <span>Switching company…</span>
        </div>
      )}
      {data.companies.map((co) => {
        const isActive = co.name === (data.currentCompany || currentCompanyName);
        return (
          <div
            key={co.companyId}
            className={`${styles.listRow} ${isActive ? styles.activeRow : styles.clickableRow} ${isSwitchingCompany ? styles.rowDisabled : ''}`}
            onClick={() => handleSwitch(co)}
            role={isActive ? undefined : 'button'}
            tabIndex={isActive ? undefined : 0}
            aria-disabled={isSwitchingCompany || undefined}
          >
            <div className={styles.rowMain}>
              <span className={styles.rowName}>
                {co.name}
                {isActive && <span className={styles.activeBadge}>Active</span>}
              </span>
              <span className={styles.rowSub}>{co.cluster} &middot; {co.companyType}</span>
            </div>
            <div className={styles.rowMeta}>
              <button
                type="button"
                className={styles.rowActionBtn}
                aria-label={`Open Profit & Loss of ${co.name}`}
                disabled={isSwitchingCompany}
                onClick={(e) => { e.stopPropagation(); openProfitLoss(co); }}
              >
                P&amp;L
              </button>
              <span className={styles.rowValue}>{co.facilityCount} facilities</span>
              <span className={styles.rowSub}>{co.ownerRole}</span>
            </div>
          </div>
        );
      })}
      {!isMinister && (
        <button className={styles.createCompanyBtn} onClick={handleCreate} disabled={isSwitchingCompany}>
          <Plus size={14} />
          Create New Company
        </button>
      )}
      {data.companies.length === 0 && <EmptyState message="No companies" />}
    </div>
  );
}

function CompanyProfitLossView({ view }: { view: CompanyProfitLossView }) {
  const client = useClient();
  const close = () => useProfileStore.getState().closeCompanyProfitLoss();
  const retry = () => {
    useProfileStore.getState().openCompanyProfitLoss(view.companyName, view.cluster);
    client.onProfileCompanyProfitLoss(view.companyName, view.cluster);
  };
  return (
    <div className={styles.tabBody}>
      <div className={styles.companyPlHeader}>
        <button type="button" className={styles.drawerBack} onClick={close} aria-label="Back to companies">
          <ArrowLeft size={16} />
        </button>
        <h4 className={styles.sectionTitle}>{view.companyName} · Profit &amp; Loss</h4>
      </div>
      {view.status === 'loading' && <SkeletonLines lines={6} />}
      {view.status === 'error' && (
        <div role="alert" className={styles.plError}>
          <p>Could not read the Profit &amp; Loss of {view.companyName}: {view.error}</p>
          <button type="button" className={styles.formCancel} onClick={retry}>Retry</button>
        </div>
      )}
      {view.status === 'loaded' && view.data && <ProfitLossNode node={view.data.root} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto-Connections Tab — with updated labels
// ---------------------------------------------------------------------------

function AutoConnectionsTab() {
  const data = useProfileStore((s) => s.autoConnections);
  const client = useClient();

  if (!data) return <EmptyState message="No connections data" />;
  if (data.cacheUnavailable) return <ProfileUnavailable />;

  const toggleOption = (fluidId: string, current: boolean, onAction: AutoConnectionActionType, offAction: AutoConnectionActionType) => {
    client.onProfileAutoConnectionAction(current ? offAction : onAction, fluidId);
  };

  const handleDeleteSupplier = (fluidId: string, facilityId: string) => {
    client.onProfileAutoConnectionAction('delete', fluidId, facilityId);
  };

  const handleOpenSearch = (fluidId: string, fluidName: string) => {
    useProfileStore.getState().openSupplierSearch(fluidId, fluidName);
    useUiStore.getState().openModal('supplierSearch');
  };

  return (
    <div className={styles.tabBody}>
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Initial Suppliers</h4>
        <p className={styles.sectionDesc}>
          Initial Suppliers are merely placed on the list of suppliers when you first create a facility. They do not prevent other suppliers from connecting to your buildings.
        </p>
      </div>
      {data.fluids.map((fluid) => (
        <div key={fluid.fluidId} className={styles.section}>
          <h4 className={styles.sectionTitle}>{fluid.fluidName}</h4>

          {/* Toggle switches — real checkboxes (keyboard + screen reader), see handoff 00 §2.6 */}
          <div className={styles.toggleGroup}>
            <Switch
              className={styles.toggleRow}
              label="Also hire a Trade Center"
              labelPosition="start"
              checked={fluid.hireTradeCenter}
              onChange={() => toggleOption(fluid.fluidId, fluid.hireTradeCenter, 'hireTradeCenter', 'dontHireTradeCenter')}
            />
            {fluid.storable && (
              <Switch
                className={styles.toggleRow}
                label="Auto-include only warehouses"
                labelPosition="start"
                checked={fluid.onlyWarehouses}
                onChange={() => toggleOption(fluid.fluidId, fluid.onlyWarehouses, 'onlyWarehouses', 'dontOnlyWarehouses')}
              />
            )}
          </div>

          {/* Supplier list */}
          {fluid.suppliers.length > 0 ? (
            fluid.suppliers.map((s, i) => (
              <div key={i} className={styles.listRow}>
                <div className={styles.rowMain}>
                  <span className={styles.rowName}>{s.facilityName}</span>
                  <span className={styles.rowSub}>{s.companyName}</span>
                </div>
                <button
                  className={styles.deleteBtn}
                  onClick={() => handleDeleteSupplier(fluid.fluidId, s.facilityId)}
                  aria-label={`Remove ${s.facilityName}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))
          ) : (
            <p className={styles.hint}>No suppliers</p>
          )}

          {/* Add supplier — opens search modal */}
          <button
            className={styles.addBtn}
            onClick={() => handleOpenSearch(fluid.fluidId, fluid.fluidName)}
          >
            <Plus size={12} />
            <span>Add Supplier</span>
          </button>
        </div>
      ))}
      {data.fluids.length === 0 && <EmptyState message="No initial suppliers configured" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Strategy Tab — Commercial strategy (diplomatic relations)
// ---------------------------------------------------------------------------

function PolicyTab() {
  const data = useProfileStore((s) => s.policy);
  const client = useClient();
  const [tycoonName, setTycoonName] = useState('');
  const [policyStatus, setPolicyStatus] = useState<number>(1); // default: Neutral
  const alliesAllowed = data?.alliesAllowed ?? true;

  // Delphi TPolicyStatus: 0=Ally, 1=Neutral, 2=Enemy
  const POLICY_LABELS: Record<number, string> = { 0: 'Ally', 1: 'Neutral', 2: 'Enemy' };
  const policyLabel = (val: number) => POLICY_LABELS[val] ?? 'Neutral';

  const handleSetPolicy = useCallback(() => {
    const trimmed = tycoonName.trim();
    if (!trimmed) return;
    client.onProfilePolicySet(trimmed, policyStatus);
    setTycoonName('');
    setPolicyStatus(1);
  }, [client, tycoonName, policyStatus]);

  return (
    <div className={styles.tabBody}>
      {/* Existing policies table */}
      {data?.cacheUnavailable ? (
        <ProfileUnavailable />
      ) : data && data.policies.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tycoon</th>
                <th>Your Policy</th>
                <th>Their Policy</th>
              </tr>
            </thead>
            <tbody>
              {data.policies.map((p) => (
                <tr key={p.tycoonName}>
                  <td>{p.tycoonName}</td>
                  <td>
                    <div className={styles.policyBtnGroup}>
                      <button
                        className={`${styles.policyBtn} ${p.yourPolicy === 2 ? styles.policyEnemy : ''}`}
                        onClick={() => client.onProfilePolicySet(p.tycoonName, 2)}
                      >
                        Enemy
                      </button>
                      <button
                        className={`${styles.policyBtn} ${p.yourPolicy === 1 ? styles.policyNeutral : ''}`}
                        onClick={() => client.onProfilePolicySet(p.tycoonName, 1)}
                      >
                        Neutral
                      </button>
                      {alliesAllowed ? (
                        <button
                          className={`${styles.policyBtn} ${p.yourPolicy === 0 ? styles.policyAlly : ''}`}
                          onClick={() => client.onProfilePolicySet(p.tycoonName, 0)}
                        >
                          Ally
                        </button>
                      ) : (
                        p.yourPolicy === 0 && (
                          <span className={`${styles.policyBtn} ${styles.policyAlly}`}>Ally</span>
                        )
                      )}
                    </div>
                  </td>
                  <td>{policyLabel(p.theirPolicy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        data && <EmptyState message="No diplomatic policies" />
      )}

      {/* Set policy towards a tycoon — always shown */}
      <div className={styles.inlineForm}>
        <label className={styles.formLabel}>Set policy towards a tycoon</label>
        <input
          className={styles.formInput}
          type="text"
          placeholder="Tycoon name..."
          value={tycoonName}
          onChange={(e) => setTycoonName(e.target.value)}
        />
        <label className={styles.formLabel}>Policy</label>
        <select
          className={styles.formSelect}
          value={policyStatus}
          onChange={(e) => setPolicyStatus(Number(e.target.value))}
        >
          {alliesAllowed && <option value={0}>Ally</option>}
          <option value={1}>Neutral</option>
          <option value={2}>Enemy</option>
        </select>
        <div className={styles.formActions}>
          <button
            className={styles.formSubmit}
            onClick={handleSetPolicy}
            disabled={!tycoonName.trim()}
          >
            Set Policy
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The section's page came back as "cannot retrieve Tycoon information", or did not come back at all. */
function ProfileUnavailable() {
  return (
    <ErrorState
      title="The server could not read your profile"
      description="This section is unavailable until the game server can read your tycoon again."
      onRetry={() => useProfileStore.getState().incrementRefresh()}
    />
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className={styles.empty}>{message}</div>;
}
