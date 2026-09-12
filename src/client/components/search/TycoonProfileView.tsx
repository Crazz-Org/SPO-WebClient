/**
 * TycoonProfileView — Displays a tycoon's profile from RenderTycoon.asp data.
 * Used inside SearchPanel when currentPage is 'tycoon-profile'.
 */

import { User, DollarSign, Trophy, Star, Award, Mail, Briefcase, FileText } from 'lucide-react';
import { formatMoney } from '../../format-utils';
import { useSearchStore } from '../../store/search-store';
import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import { GlassCard } from '../common';
import { tycoonAddress, writeTo } from '../mail/write-to';
import { openDirectory } from './DirectoryPage';
import styles from './SearchPanel.module.css';

export function TycoonProfileView() {
  const profile = useSearchStore((s) => s.tycoonProfileData?.profile);
  const worldName = useGameStore((s) => s.worldName);
  const client = useClient();

  if (!profile) {
    return <div className={styles.emptyState}>No profile data available.</div>;
  }


  return (
    <div className={styles.listContainer}>
      <GlassCard className={styles.profileCard} light>
        {/* Header: photo + name */}
        <div className={styles.profileHeader}>
          {profile.photoUrl ? (
            <img
              className={styles.profilePhoto}
              src={profile.photoUrl}
              alt={profile.name}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className={styles.profilePhotoPlaceholder}>
              <User size={28} />
            </div>
          )}
          <span className={styles.profileName}>{profile.name}</span>
        </div>

        {/* Stats grid */}
        <div className={styles.profileStatsGrid}>
          <span className={styles.profileStatLabel}>
            <DollarSign size={12} /> Fortune
          </span>
          <span className={styles.profileStatValue}>{formatMoney(profile.fortune)}</span>

          <span className={styles.profileStatLabel}>
            <DollarSign size={12} /> This Year
          </span>
          <span className={styles.profileStatValue}>{formatMoney(profile.thisYearProfit)}</span>

          <span className={styles.profileStatLabel}>
            <Trophy size={12} /> NTA Ranking
          </span>
          <span className={styles.profileStatValue}>{profile.ntaRanking}</span>

          <span className={styles.profileStatLabel}>
            <Award size={12} /> Level
          </span>
          <span className={styles.profileStatValue}>{profile.level}</span>

          <span className={styles.profileStatLabel}>
            <Star size={12} /> Prestige
          </span>
          <span className={styles.profileStatValue}>{profile.prestige} points</span>
        </div>

        <button
          type="button"
          className={styles.profileWriteBtn}
          onClick={() => writeTo(tycoonAddress(profile.name, worldName))}
        >
          <Mail size={14} /> Write to {profile.name}
        </button>

        {/* RenderTycoon.asp:119-139 — the card's own links: Show Profile, then Companies. */}
        <div className={styles.directoryActions}>
          <button
            type="button"
            className={styles.rowAction}
            onClick={() => {
              useSearchStore.getState().navigateTo('tycoon-full-profile');
              client.onSearchMenuTycoonFullProfile(profile.name);
            }}
          >
            <FileText size={12} /> Show Profile
          </button>
          <button
            type="button"
            className={styles.rowAction}
            onClick={() => openDirectory(client, { kind: 'tycoon-companies', tycoon: profile.name })}
          >
            <Briefcase size={12} /> Companies
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
