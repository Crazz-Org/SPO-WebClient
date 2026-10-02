/**
 * OverviewSection — the synthetic first tab of a standard facility.
 *
 * Shows what v1 put between the header and the section menu (`QuickStats`: the parsed
 * details, construction progress or the sales list), then one card per server section so
 * the inspector still opens on a map of everything the facility offers. Nothing here costs
 * a read: the details and sales came with the focus push, and opening a card is the same
 * as clicking its tab.
 */

import { ChevronRight } from 'lucide-react';
import type { BuildingFocusInfo } from '@/shared/types';
import { QuickStats } from '../../components/building/QuickStats';
import type { SectionTabItem } from './inspector-model';
import styles from './InspectorV2.module.css';

interface OverviewSectionProps {
  focus: BuildingFocusInfo;
  /** The server sections, already sorted, without Overview itself. */
  sections: SectionTabItem[];
  onOpen: (tabId: string) => void;
}

export function OverviewSection({ focus, sections, onOpen }: OverviewSectionProps) {
  return (
    <div className={styles.overview}>
      <QuickStats focus={focus} />
      {sections.length > 0 && (
        <nav className={styles.sectionCards} aria-label="All sections">
          {sections.map((s) => (
            <button key={s.id} type="button" className={styles.sectionCard} onClick={() => onOpen(s.id)}>
              <span className={styles.sectionCardLabel}>{s.label}</span>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
