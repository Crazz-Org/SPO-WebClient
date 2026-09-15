/**
 * PromptDialog — a `Dialog` with one text field. Keeps the historical API
 * (`onSubmit(value)` / `onCancel`, `placeholder`, `defaultValue`) used by `ui-store.requestPrompt`.
 * Enter submits when the trimmed value is non-empty; the field is labelled by the message.
 */

import { useCallback, useId, useState } from 'react';
import { Dialog } from './Dialog';
import styles from './PromptDialog.module.css';

export interface PromptDialogProps {
  title: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  submitLabel?: string;
  type?: 'text' | 'password';
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  title,
  message,
  placeholder,
  defaultValue = '',
  submitLabel = 'Submit',
  type = 'text',
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputId = useId();
  const trimmed = value.trim();
  // A password is submitted raw: trimming it would silently mangle it.
  const canSubmit = type === 'password' ? value.length > 0 : trimmed.length > 0;
  const submitValue = type === 'password' ? value : trimmed;

  const submit = useCallback(() => {
    if (canSubmit) onSubmit(submitValue);
  }, [canSubmit, onSubmit, submitValue]);

  return (
    <Dialog
      title={title}
      description={message}
      kind="info"
      primary={{ label: submitLabel, onClick: submit, disabled: !canSubmit }}
      onClose={onCancel}
    >
      <input
        id={inputId}
        type={type}
        className={styles.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSubmit) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        aria-label={message}
        autoFocus
        spellCheck={false}
        autoComplete={type === 'password' ? 'current-password' : 'off'}
      />
    </Dialog>
  );
}
