/**
 * V2Boundary — the safety net under the new interface.
 *
 * If anything inside the v2 tree fails to render (or its lazy chunk fails to load), the player
 * is put back on the classic interface with a toast saying so, instead of a blank screen. The
 * switch is remembered (`setUiVersion` saves it), so a reload does not land on the same crash.
 * The map, the session and the open surfaces are untouched: they live outside React or in stores.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useUiStore } from '../store/ui-store';
import { showToast } from '../components/common/Toast';
import { reportClientError } from '../error-reporter';

export const V2_FALLBACK_MESSAGE = 'The new interface hit an error — back to the classic one';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class V2Boundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[V2Boundary]', error, info.componentStack);
    reportClientError('boundary', error);
    useUiStore.getState().setUiVersion('v1');
    showToast(V2_FALLBACK_MESSAGE, 'warning');
  }

  render() {
    // Rendering nothing for the one frame before App swaps to the classic GameScreen.
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
