/**
 * DiagnosisBanner — the first line a player reads about a facility (T2, missing-features B7).
 *
 * Renders a `FacilityDiagnosis` (parsed from the pushed status text — no extra read) as a
 * status word + a sentence + at most one action. Severity is carried by the word and the
 * icon, colour is secondary. Nothing renders for `severity: 'none'`.
 */

import { AlertTriangle, Check, Info, OctagonX } from 'lucide-react';
import type { BuildingDetailsTab } from '@/shared/types';
import type { DiagnosisAction, FacilityDiagnosis } from '@/shared/building-details/facility-diagnosis';
import { Button } from '../common';
import styles from './DiagnosisBanner.module.css';

/** The inspector section an action opens, found among the tabs the server declared. */
export function tabForAction(action: DiagnosisAction | undefined, tabs: BuildingDetailsTab[] | undefined): string | null {
  if (!action || !tabs) return null;
  const find = (re: RegExp) => tabs.find((t) => re.test(t.id) || re.test(t.name) || re.test(t.handlerName ?? ''))?.id ?? null;
  switch (action.kind) {
    case 'findSupplier':
    case 'openSupplies':
      return find(/suppl/i);
    case 'openServices':
      return find(/servic|compinput/i);
    case 'openWorkforce':
      return find(/work/i);
    case 'openResearch':
      return find(/research/i);
    default:
      return null;
  }
}

export function actionLabel(action: DiagnosisAction): string {
  switch (action.kind) {
    case 'findSupplier':
      return action.fluidName && action.fluidName !== 'supplies' ? `Find ${action.fluidName} suppliers` : 'Find suppliers';
    case 'openSupplies':
      return 'Open supplies';
    case 'openServices':
      return 'Open services';
    case 'openWorkforce':
      return 'Open workforce';
    case 'openResearch':
      return 'Open research';
    case 'connect':
      return 'Connect';
  }
}

export interface DiagnosisBannerProps {
  diagnosis: FacilityDiagnosis;
  /** Called with the action when the player clicks it; omit to render the banner read-only. */
  onAction?: (action: DiagnosisAction) => void;
  /** Hide the action even when one exists (the map overlay is read-only). */
  compact?: boolean;
}

function SeverityIcon({ severity }: { severity: FacilityDiagnosis['severity'] }) {
  const p = { size: 14, 'aria-hidden': true as const };
  switch (severity) {
    case 'stop':
      return <OctagonX {...p} />;
    case 'warning':
      return <AlertTriangle {...p} />;
    case 'ok':
      return <Check {...p} />;
    default:
      return <Info {...p} />;
  }
}

export function DiagnosisBanner({ diagnosis, onAction, compact }: DiagnosisBannerProps) {
  if (diagnosis.severity === 'none' || !diagnosis.message) return null;
  const cls = `${styles.banner} ${styles[diagnosis.severity]}`;
  return (
    <div className={cls} role={diagnosis.severity === 'stop' ? 'alert' : 'status'} title={diagnosis.raw}>
      <span className={styles.icon}><SeverityIcon severity={diagnosis.severity} /></span>
      <span className={styles.text}>
        <strong className={styles.label}>{diagnosis.label}</strong>
        <span aria-hidden="true"> — </span>
        {diagnosis.message}
      </span>
      {diagnosis.action && onAction && !compact && (
        <Button size="sm" variant={diagnosis.severity === 'stop' || diagnosis.severity === 'warning' ? 'primary' : 'secondary'} onClick={() => onAction(diagnosis.action!)}>
          {actionLabel(diagnosis.action)}
        </Button>
      )}
    </div>
  );
}
