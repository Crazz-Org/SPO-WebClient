/**
 * ConnectingGauge — deadline progress for a login-stage overlay.
 *
 * Fills over the RDO deadline the gateway actually arms for the step
 * (`TIMEOUT_CONFIG[category].rdoMs`), so the bar reaches full exactly when the
 * gateway's own timeout error would land.
 */

import { useEffect, useState } from 'react';
import { ProgressBar } from '../common';
import { TimeoutCategory, TIMEOUT_CONFIG } from '@/shared/timeout-categories';
import styles from './ConnectingGauge.module.css';

interface ConnectingGaugeProps {
  /** Caption under the gauge — the same text the overlay shows today. */
  label: string;
  /** The category the gateway arms for this step; the gauge fills over TIMEOUT_CONFIG[category].rdoMs. */
  category: TimeoutCategory;
}

export function ConnectingGauge({ label, category }: ConnectingGaugeProps) {
  const deadlineMs = TIMEOUT_CONFIG[category].rdoMs;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 250);
    return () => clearInterval(interval);
  }, []);

  const progress = Math.min(1, elapsed / deadlineMs);

  return (
    <div className={styles.gauge} data-deadline-reached={progress >= 1 ? 'true' : undefined}>
      <ProgressBar value={progress} variant="gold" height={6} className={styles.bar} />
      <span className={styles.text}>{label}</span>
    </div>
  );
}
