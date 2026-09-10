/**
 * MediaPage — SearchPanel drill-down listing every newspaper in the world.
 * Newspapers.asp:12-24 iterates the world's Newspapers\ folder; a row here opens
 * that paper's board the same way OverviewSection's Town Hall path does, without
 * needing the player to be near the town.
 */

import { Newspaper } from 'lucide-react';
import { useSearchStore } from '../../store/search-store';
import { useNewspaperStore } from '../../store/newspaper-store';
import { useUiStore } from '../../store/ui-store';
import { GlassCard } from '../common';
import type { NewspaperListing } from '@/shared/types';
import styles from './SearchPanel.module.css';

export function MediaPage() {
  const papers = useSearchStore((s) => s.newspapersData?.newspapers) ?? [];

  if (papers.length === 0) {
    return <div className={styles.emptyState}>No newspapers in this world yet.</div>;
  }

  const openPaper = (paper: NewspaperListing) => {
    useNewspaperStore.getState().openFor({
      paperName: paper.paperName,
      townName: paper.townName,
      isCapitol: false,
      buildingX: 0,
      buildingY: 0,
    }, 'paper');
    useUiStore.getState().openModal('newspaper');
  };

  return (
    <div className={styles.listContainer}>
      {papers.map((paper: NewspaperListing) => (
        <GlassCard
          key={`${paper.townName}/${paper.paperName}`}
          className={styles.listItem}
          light
          onClick={() => openPaper(paper)}
        >
          <div className={styles.listItemHeader}>
            <Newspaper size={16} className={styles.listItemIcon} />
            <span className={styles.listItemTitle}>{paper.paperName}</span>
          </div>
          <div className={styles.listItemDetails}>
            <span>{paper.townName}</span>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}
