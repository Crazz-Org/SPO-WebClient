/**
 * MausoleumControls — owner-only epitaph editor and cancel-transcendence button.
 *
 * Extracted from PropertyGroup.tsx (issue 576). MausoleumSheet.pas is the
 * legacy reference: EncodeParagraph/DecodeParagraph (:76-107), the owner gate
 * `fOwnFac` (:127-137), and `btnCancel.Enabled := fOwnFac and (Transcended <> '1')` (:145).
 */

import { useState, useEffect } from 'react';
import { useUiStore } from '../../store/ui-store';
import { SaveIndicator } from './SaveIndicator';
import { splitParagraphs, joinParagraphs } from './property-utils';
import styles from './PropertyGroup.module.css';

export interface EpitaphEditorProps {
  value: string;
  pendingKey?: string;
  onSave: (joined: string) => void;
}

export function EpitaphEditor({ value, pendingKey, onSave }: EpitaphEditorProps) {
  const [text, setText] = useState(() => splitParagraphs(value).join('\n'));

  useEffect(() => {
    setText(splitParagraphs(value).join('\n'));
  }, [value]);

  return (
    <div>
      <textarea
        aria-label="Words of Wisdom"
        rows={4}
        className={styles.epitaphTextarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className={styles.epitaphActions}>
        <button type="button" className={styles.actionBtn} onClick={() => onSave(joinParagraphs(text))}>
          Save epitaph
        </button>
        {pendingKey && <SaveIndicator propertyKey={pendingKey} />}
      </div>
    </div>
  );
}

export interface CancelTranscendenceProps {
  onCancel: () => void;
}

export function CancelTranscendence({ onCancel }: CancelTranscendenceProps) {
  return (
    <button
      type="button"
      className={styles.upgradeStopBtn}
      onClick={() => {
        useUiStore.getState().requestConfirm(
          'Cancel transcendence?',
          'This mausoleum will be deleted and the transcendence will not take place. This cannot be undone.',
          onCancel,
          { kind: 'destructive', confirmLabel: 'Delete mausoleum', cancelLabel: 'Keep it', typeToConfirm: null },
        );
      }}
    >
      Cancel transcendence
    </button>
  );
}
