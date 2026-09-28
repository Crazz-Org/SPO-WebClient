import { logErrors, withRenderer, setupEscapeHandler } from './handler-utils';
import { ClientBridge } from '../bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';

// Mock ClientBridge.log
jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
  },
}));

describe('handler-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('logErrors', () => {
    it('returns the result of the async function on success', async () => {
      const result = await logErrors('Test', async () => 42);
      expect(result).toBe(42);
    });

    it('returns undefined and logs on error', async () => {
      const result = await logErrors('Test', async () => {
        throw new Error('boom');
      });
      expect(result).toBeUndefined();
      expect(ClientBridge.log).toHaveBeenCalledWith('Error', 'Test: boom');
    });

    it('handles non-Error thrown values', async () => {
      await logErrors('Test', async () => {
        throw 'string error';
      });
      expect(ClientBridge.log).toHaveBeenCalledWith('Error', expect.stringContaining('Test:'));
    });
  });

  describe('withRenderer', () => {
    it('calls fn with renderer when available', () => {
      const mockRenderer = { setRoadDrawingMode: jest.fn() };
      const ctx = {
        getRenderer: () => mockRenderer,
      } as unknown as ClientHandlerContext;

      const result = withRenderer(ctx, (r) => {
        r.setRoadDrawingMode(true);
        return 'done';
      });

      expect(result).toBe('done');
      expect(mockRenderer.setRoadDrawingMode).toHaveBeenCalledWith(true);
    });

    it('returns undefined when no renderer', () => {
      const ctx = {
        getRenderer: () => null,
      } as unknown as ClientHandlerContext;

      const fn = jest.fn();
      const result = withRenderer(ctx, fn);

      expect(result).toBeUndefined();
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('setupEscapeHandler', () => {
    let listeners: Array<{ event: string; handler: (e: unknown) => void }>;
    let removedListeners: Array<{ event: string; handler: (e: unknown) => void }>;

    beforeEach(() => {
      listeners = [];
      removedListeners = [];
      // Mock document as plain object (no jsdom in test env)
      (globalThis as unknown as Record<string, unknown>).document = {
        addEventListener: jest.fn((event: string, handler: (e: unknown) => void) => {
          listeners.push({ event, handler });
        }),
        removeEventListener: jest.fn((event: string, handler: (e: unknown) => void) => {
          removedListeners.push({ event, handler });
        }),
      };
    });

    afterEach(() => {
      delete (globalThis as unknown as Record<string, unknown>).document;
    });

    it('registers a keydown listener', () => {
      setupEscapeHandler(() => true, () => {});
      expect(listeners).toHaveLength(1);
      expect(listeners[0].event).toBe('keydown');
    });

    it('calls cancel and removes listener on Escape when active', () => {
      const cancel = jest.fn();
      setupEscapeHandler(() => true, cancel);

      const handler = listeners[0].handler;
      handler({ key: 'Escape' });

      expect(cancel).toHaveBeenCalled();
      expect(removedListeners).toHaveLength(1);
      expect(removedListeners[0].handler).toBe(handler);
    });

    it('does not cancel on Escape when not active', () => {
      const cancel = jest.fn();
      setupEscapeHandler(() => false, cancel);

      listeners[0].handler({ key: 'Escape' });

      expect(cancel).not.toHaveBeenCalled();
    });

    it('ignores non-Escape keys', () => {
      const cancel = jest.fn();
      setupEscapeHandler(() => true, cancel);

      listeners[0].handler({ key: 'Enter' });

      expect(cancel).not.toHaveBeenCalled();
    });
  });
});
