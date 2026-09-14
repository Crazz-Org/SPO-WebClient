/**
 * TutorialPanel — the live assignment, as a panel.
 *
 * This is what the reference client opened a URL frame for
 * (`Voyager/URLNotification.pas:77-85`): the server pushes "there is an
 * assignment", and a surface appears carrying its title, its goal and the
 * instructions for that kind and stage. Continue, Back and Close act on the
 * live task object through the gateway; the panel then follows whatever stage
 * the server reports.
 *
 * It draws no close button of its own — the Sheet supplies one
 * (`Sheet.tsx:148`), which is what "the panel can be dismissed" rests on.
 */

import { useEffect, useCallback } from 'react';
import { ArrowLeft, ArrowRight, X, CheckCircle2, Sparkles } from 'lucide-react';
import { useTutorialStore } from '../../store/tutorial-store';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import { ProgressBar, Button } from '../common';
import type { TutorialState } from '@/shared/types';
import { tutorialContentFor } from './tutorial-content';
import styles from './TutorialPanel.module.css';

/**
 * Substitute the five placeholders the content module declares.
 *
 * Anything else stays literal: the ASP pages interpolated far more than this
 * from their own server-side query, and a half-filled sentence is worse than a
 * rewritten one (which is why those sentences were rewritten instead).
 */
export function fillPlaceholders(
  text: string, assignment: TutorialState, tycoon: string, world: string,
): string {
  return text
    .replace(/\{tycoon\}/g, tycoon || 'Tycoon')
    .replace(/\{world\}/g, world || 'this world')
    .replace(/\{company\}/g, assignment.company || 'your company')
    .replace(/\{town\}/g, assignment.town || 'your town')
    .replace(/\{goal\}/g, assignment.goal || 'your goal');
}

export function TutorialPanel() {
  const assignment = useTutorialStore((s) => s.assignment);
  const loaded = useTutorialStore((s) => s.loaded);
  const pending = useTutorialStore((s) => s.pending);
  const tycoonName = useGameStore((s) => s.username);
  const worldName = useGameStore((s) => s.worldName);
  const client = useClient();

  // Opened from the profile with no push having arrived: ask once, so the
  // surface is correct rather than empty. `loaded` is what makes it once.
  useEffect(() => {
    if (!loaded) client.onTutorialState();
  }, [loaded, client]);

  const act = useCallback((action: 'next' | 'prev' | 'close' | 'complete') => {
    useTutorialStore.getState().setPending(action);
    client.onTutorialAction(action);
    // Closing is the player's decision, not the server's: the surface goes now,
    // and RDOClose travels on its own. The store is cleared by the kind-1
    // `nopTutorial_OFF` push the server sends back (`Tasks/Tasks.pas:636-644`).
    if (action === 'close') useUiStore.getState().popSurface();
  }, [client]);

  // No assignment is a rendered nothing — not an empty panel, not a skeleton.
  // This is the criterion's last bullet and it is deliberately the first line.
  if (!assignment) return null;

  const content = tutorialContentFor(assignment.kindId, assignment.stage);
  const fill = (text: string) => fillPlaceholders(text, assignment, tycoonName, worldName);
  const busy = pending !== null;

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <Sparkles size={16} className={styles.titleIcon} aria-hidden="true" />
          <h2 className={styles.title}>{assignment.name || 'Assignment'}</h2>
        </div>
        {content && <p className={styles.heading}>{fill(content.heading)}</p>}
        <ProgressBar value={assignment.progress / 100} variant="gold" showLabel />
      </header>

      {assignment.goal !== '' && (
        <p className={styles.goal}>
          <span className={styles.goalLabel}>Goal</span>
          <span className={styles.goalValue}>{assignment.goal}</span>
        </p>
      )}

      {content && content.paragraphs.length > 0 && (
        <div className={styles.body}>
          {content.paragraphs.map((p, i) => (
            <p key={i} className={styles.paragraph}>{fill(p)}</p>
          ))}
        </div>
      )}

      {assignment.done && (
        <div className={styles.done}>
          <p className={styles.doneText}>
            <CheckCircle2 size={16} aria-hidden="true" />
            Congratulations, you have completed this Assignment.
          </p>
          <Button
            variant="primary"
            iconLeft={<Sparkles size={14} />}
            disabled={busy}
            onClick={() => act('complete')}
          >
            Get New Assignment
          </Button>
        </div>
      )}

      <footer className={styles.footer}>
        {/* Back is disabled at stage 0 rather than refused there: the server
            no-ops RDOPrevStep at stage 0 (`InformativeTask.pas:54-62`), so the
            guard belongs where the player can see it. */}
        <Button
          variant="secondary"
          iconLeft={<ArrowLeft size={14} />}
          disabled={busy || assignment.stage === 0}
          onClick={() => act('prev')}
        >
          Back
        </Button>
        <Button
          variant="primary"
          iconRight={<ArrowRight size={14} />}
          disabled={busy}
          onClick={() => act('next')}
        >
          Continue
        </Button>
        <Button
          variant="ghost"
          iconLeft={<X size={14} />}
          disabled={busy}
          onClick={() => act('close')}
        >
          Close
        </Button>
      </footer>
    </div>
  );
}
