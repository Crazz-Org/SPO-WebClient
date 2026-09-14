/**
 * CreateChannelModal — the New Channel form.
 *
 * The direct analogue of Voyager's New Channel dialog
 * (`Voyager.1/URLHandlers/NewChannelForm.pas`): a name, a password and its
 * confirmation, with Create disabled until the form is valid — the Delphi
 * `btnCreate.Enabled` rule, transcribed into `channelFormProblem`.
 *
 * Managed by ui-store modal state ('createChannel').
 */

import { useState, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';
import { useClient } from '../../context';
import { channelFormProblem } from '@/shared/chat-channel';
import { toErrorMessage } from '@/shared/error-utils';
import styles from './CreateChannelModal.module.css';

export function CreateChannelModal() {
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);
  const client = useClient();

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  // Reset the form when the modal opens
  useEffect(() => {
    if (modal === 'createChannel') {
      setName('');
      setPassword('');
      setConfirm('');
      setTouched(false);
      setLoading(false);
      setServerError('');
    }
  }, [modal]);

  const problem = channelFormProblem(name, password, confirm);

  const handleCancel = useCallback(() => {
    closeModal();
  }, [closeModal]);

  const handleSubmit = useCallback(async () => {
    if (loading) return;
    // Defence in depth: the disabled button is the gate, this is what makes
    // "an invalid form sends nothing" true even without it.
    if (channelFormProblem(name, password, confirm)) {
      setTouched(true);
      return;
    }

    setServerError('');
    setLoading(true);
    try {
      await client.onCreateChannel(name.trim(), password);
      closeModal();
    } catch (err: unknown) {
      // The modal stays mounted so the player can read why and correct it.
      setServerError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [name, password, confirm, loading, client, closeModal]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Deliberately not gated on `problem` here: `handleSubmit` re-checks it
      // and returns early, so Enter on an invalid form does nothing either way
      // — and that early return is the gate that survives if `disabled` ever
      // comes off the button.
      if (e.key === 'Enter' && !loading) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [loading, handleSubmit, handleCancel],
  );

  if (modal !== 'createChannel') return null;

  const message = serverError || (touched ? problem : null);

  return (
    <>
      <div className={styles.backdrop} onClick={handleCancel} aria-hidden="true" />
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-channel-title"
        aria-describedby="create-channel-message"
        onKeyDown={handleKeyDown}
      >
        <div className={styles.header}>
          <h2 className={styles.title} id="create-channel-title">New Channel</h2>
          <button className={styles.closeBtn} onClick={handleCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          <label className={styles.label} htmlFor="create-channel-name">Channel name</label>
          <input
            id="create-channel-name"
            className={styles.input}
            type="text"
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setTouched(true); }}
            disabled={loading}
          />

          <label className={styles.label} htmlFor="create-channel-password">Password (optional)</label>
          <input
            id="create-channel-password"
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setTouched(true); }}
            disabled={loading}
          />

          <label className={styles.label} htmlFor="create-channel-confirm">Confirm password</label>
          <input
            id="create-channel-confirm"
            className={styles.input}
            type="password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setTouched(true); }}
            disabled={loading}
          />

          <div className={styles.message} id="create-channel-message" role="alert">
            {message}
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={handleCancel} disabled={loading}>
            Cancel
          </button>
          <button
            className={styles.submitBtn}
            onClick={handleSubmit}
            disabled={problem !== null || loading}
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </>
  );
}
