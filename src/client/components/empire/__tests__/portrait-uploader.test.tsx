import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useProfileStore } from '../../../store/profile-store';
import { useGameStore } from '../../../store/game-store';
import { ClientBridge } from '../../../bridge/client-bridge';
import * as ToastModule from '../../common/Toast';
import { WsMessageType } from '@/shared/types';
import { ProfilePanel } from '../ProfilePanel';
import type { TycoonProfileFull } from '@/shared/types';

function makeProfile(overrides: Partial<TycoonProfileFull> = {}): TycoonProfileFull {
  return {
    name: 'Crazz',
    realName: 'Crazz',
    ranking: 1,
    budget: '0',
    prestige: 0,
    facPrestige: 0,
    researchPrestige: 0,
    facCount: 0,
    facMax: 0,
    area: 0,
    nobPoints: 0,
    licenceLevel: 0,
    failureLevel: 0,
    levelName: 'Novice',
    levelTier: 0,
    ...overrides,
  };
}

describe('PortraitUploader', () => {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  let drawImageCalls: unknown[][];
  let toBlobCalls: unknown[][];

  beforeEach(() => {
    useProfileStore.getState().reset();
    useGameStore.setState({ username: 'Crazz' });

    drawImageCalls = [];
    toBlobCalls = [];
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      return {
        clearRect: jest.fn(),
        drawImage: (...args: unknown[]) => { drawImageCalls.push(args); },
      } as unknown as CanvasRenderingContext2D;
    } as never;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, ...rest: unknown[]) {
      toBlobCalls.push([cb, ...rest]);
      cb(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }));
    } as never;

    (globalThis as unknown as { URL: { createObjectURL: () => string; revokeObjectURL: () => void } }).URL.createObjectURL =
      () => 'blob:fake';
    (globalThis as unknown as { URL: { createObjectURL: () => string; revokeObjectURL: () => void } }).URL.revokeObjectURL =
      () => { /* noop */ };

    (globalThis as unknown as { Image: unknown }).Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 400;
      naturalHeight = 400;
      private _src = '';
      get src(): string { return this._src; }
      set src(v: string) {
        this._src = v;
        queueMicrotask(() => this.onload?.());
      }
    };
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
    HTMLCanvasElement.prototype.toBlob = origToBlob;
  });

  async function loadAFile(file = new File(['bytes'], 'photo.png', { type: 'image/png' })) {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
    });
  }

  it('renders the control when profile.name matches the session username', () => {
    act(() => {
      useProfileStore.getState().setProfile(makeProfile({ name: 'Crazz' }));
    });
    renderWithProviders(<ProfilePanel />);
    expect(screen.getByLabelText('Change portrait')).toBeTruthy();
  });

  it('does not render the control when the name does not match, nor when username is empty', () => {
    act(() => {
      useProfileStore.getState().setProfile(makeProfile({ name: 'SomeoneElse' }));
    });
    renderWithProviders(<ProfilePanel />);
    expect(screen.queryByLabelText('Change portrait')).toBeNull();

    useGameStore.setState({ username: '' });
    act(() => {
      useProfileStore.getState().setProfile(makeProfile({ name: '' }));
    });
    renderWithProviders(<ProfilePanel />);
    expect(screen.queryByLabelText('Change portrait')).toBeNull();
  });

  it('creates a 150x200 canvas, draws the crop rect, and encodes JPEG on Send', async () => {
    act(() => {
      useProfileStore.getState().setProfile(makeProfile({ name: 'Crazz' }));
    });
    const onProfileUploadPicture = jest.fn();
    renderWithProviders(<ProfilePanel />, { clientCallbacks: createSpiedCallbacks({ onProfileUploadPicture }) });
    fireEvent.click(screen.getByLabelText('Change portrait'));

    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(150);
    expect(canvas.height).toBe(200);

    await loadAFile();
    expect(drawImageCalls.length).toBeGreaterThan(0);
    const lastDraw = drawImageCalls[drawImageCalls.length - 1];
    // nine-argument form: image, sx, sy, sw, sh, dx, dy, dw, dh
    expect(lastDraw).toHaveLength(9);
    expect(lastDraw[5]).toBe(0);
    expect(lastDraw[6]).toBe(0);
    expect(lastDraw[7]).toBe(150);
    expect(lastDraw[8]).toBe(200);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(onProfileUploadPicture).toHaveBeenCalledTimes(1);
    });
    expect(toBlobCalls[0][1]).toBe('image/jpeg');
    const sentBase64 = onProfileUploadPicture.mock.calls[0][0] as string;
    expect(sentBase64.startsWith('data:')).toBe(false);
  });

  it('arrow keys, mouse drag and the zoom slider all redraw the canvas', async () => {
    act(() => {
      useProfileStore.getState().setProfile(makeProfile({ name: 'Crazz' }));
    });
    renderWithProviders(<ProfilePanel />);
    fireEvent.click(screen.getByLabelText('Change portrait'));
    await loadAFile();

    const canvas = screen.getByRole('img', { name: 'Portrait crop preview' });
    const before = drawImageCalls.length;
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent.keyDown(canvas, { key: 'ArrowUp' });
    fireEvent.keyDown(canvas, { key: 'ArrowDown' });
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(drawImageCalls.length).toBeGreaterThan(before);

    const afterKeys = drawImageCalls.length;
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas, { clientX: 20, clientY: 15 });
    fireEvent.mouseUp(canvas);
    expect(drawImageCalls.length).toBeGreaterThan(afterKeys);

    const zoomInput = document.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(zoomInput, { target: { value: '2' } });
    expect(drawImageCalls.length).toBeGreaterThan(0);
  });

  it('a decode failure lands in the inline error', async () => {
    act(() => {
      useProfileStore.getState().setProfile(makeProfile({ name: 'Crazz' }));
    });
    (globalThis as unknown as { Image: unknown }).Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onerror?.()); }
    };
    renderWithProviders(<ProfilePanel />);
    fireEvent.click(screen.getByLabelText('Change portrait'));

    await loadAFile();

    expect((await screen.findByRole('alert')).textContent).toContain('could not be decoded');
  });

  it('an oversized file leaves onProfileUploadPicture uncalled and shows the reason inline', async () => {
    act(() => {
      useProfileStore.getState().setProfile(makeProfile({ name: 'Crazz' }));
    });
    const onProfileUploadPicture = jest.fn();
    renderWithProviders(<ProfilePanel />, { clientCallbacks: createSpiedCallbacks({ onProfileUploadPicture }) });
    fireEvent.click(screen.getByLabelText('Change portrait'));

    const bigFile = new File([new Uint8Array(9 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    await loadAFile(bigFile);

    expect(screen.getByRole('alert').textContent).toContain('8 MB');
    expect(onProfileUploadPicture).not.toHaveBeenCalled();
  });

  it('a text/plain file leaves onProfileUploadPicture uncalled and shows the reason inline', async () => {
    act(() => {
      useProfileStore.getState().setProfile(makeProfile({ name: 'Crazz' }));
    });
    const onProfileUploadPicture = jest.fn();
    renderWithProviders(<ProfilePanel />, { clientCallbacks: createSpiedCallbacks({ onProfileUploadPicture }) });
    fireEvent.click(screen.getByLabelText('Change portrait'));

    const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await loadAFile(textFile);

    expect(screen.getByRole('alert').textContent).toContain('text/plain');
    expect(onProfileUploadPicture).not.toHaveBeenCalled();
  });

  it('a failed upload restores the previous portrait and shows the server message', async () => {
    act(() => {
      useProfileStore.getState().setProfile(makeProfile({ name: 'Crazz' }));
      useProfileStore.setState({ portraitDataUrl: 'data:image/jpeg;base64,before' });
      useProfileStore.getState().applyPortrait('data:image/jpeg;base64,new');
    });
    expect(useProfileStore.getState().portraitDataUrl).toBe('data:image/jpeg;base64,new');

    const showToastSpy = jest.spyOn(ToastModule, 'showToast');
    await act(async () => {
      ClientBridge.handleProfileResponse({
        type: WsMessageType.RESP_PROFILE_UPLOAD_PICTURE,
        wsRequestId: 'r1',
        success: false,
        reason: 'WRONG_DIMENSIONS',
        message: 'Picture must be 150x200; this one is 400x400.',
      } as never);
    });

    await waitFor(() => {
      expect(useProfileStore.getState().portraitDataUrl).toBe('data:image/jpeg;base64,before');
    });
    expect(showToastSpy).toHaveBeenCalledWith('Picture must be 150x200; this one is 400x400.', 'error');
    showToastSpy.mockRestore();
  });
});
