import { reconnectWorldSocket } from './login-handler';
import type { LoginContext } from './login-handler';
import type { RdoPacket } from '../../shared/types';

/**
 * O-H1 / O-H2 — the zombie session.
 *
 * The old code probed the OLD ClientViewId with `get TycoonId` and took a
 * "light" reconnect path when it answered. That probe cannot fail:
 * TInterfaceServer.Logoff extracts the ClientView from fClients and leaves
 * `//ClientView.Free;` commented out (InterfaceServer.pas:3314-3326), so the
 * object is leaked but alive and answers a plain field read — while we are
 * already out of the list the server iterates to deliver pushes.
 *
 * These tests drive the REAL reconnectWorldSocket. The existing
 * __tests__/world-reconnect.test.ts mocks it away, so the inside of the
 * function was never covered — the §7 blind spot of the audit.
 */

interface Sent {
  member?: string;
  action?: string;
  targetId?: string;
}

const OLD_CONTEXT_ID = '8161308';
const NEW_CONTEXT_ID = '9427733';

function makeCtx(): { ctx: LoginContext; sent: Sent[]; known: Map<string, string> } {
  const sent: Sent[] = [];
  const known = new Map<string, string>();

  const sendRdoRequest = jest.fn(async (_socket: string, packet: Record<string, unknown>) => {
    sent.push({
      member: packet.member as string | undefined,
      action: packet.action as string | undefined,
      targetId: packet.targetId as string | undefined,
    });

    switch (packet.member) {
      case 'Logon':
        return { payload: `res="#${NEW_CONTEXT_ID}"` } as RdoPacket;
      case 'TycoonId':
        return { payload: 'TycoonId="#22"' } as RdoPacket;
      case 'RDOCnntId':
        return { payload: 'RDOCnntId="#40530807"' } as RdoPacket;
      default:
        return { payload: 'res="#0"' } as RdoPacket;
    }
  });

  const ctx = {
    currentWorldInfo: { ip: '127.0.0.1', port: 7000 },
    worldContextId: OLD_CONTEXT_ID,
    interfaceServerId: '30430748',
    cachedUsername: 'SPO_test3',
    cachedPassword: 'test3',
    rdoCnntId: '11111111',
    tycoonId: '22',
    currentCompany: null,
    log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    createSocket: jest.fn().mockResolvedValue(undefined),
    initWorldPool: jest.fn(),
    populateWorldPool: jest.fn(),
    getSocket: jest.fn().mockReturnValue(null),
    sendRdoRequest,
    setInterfaceServerId: jest.fn(),
    setWorldContextId: jest.fn(),
    setTycoonId: jest.fn(),
    setRdoCnntId: jest.fn(),
    setKnownObject: jest.fn((name: string, id: string) => { known.set(name, id); }),
    // Stand in for the InitClient push: the server fires it while handling
    // RegisterEventsById, so the re-login waits for it before going on.
    setWaitingForInitClient: jest.fn(),
    setInitClientReceived: jest.fn(),
    setInitClientResolver: jest.fn((resolve: (() => void) | null) => { if (resolve) queueMicrotask(resolve); }),
  } as unknown as LoginContext;

  return { ctx, sent, known };
}

describe('reconnectWorldSocket — no light path (O-H1)', () => {
  it('always re-Logons', async () => {
    const { ctx, sent } = makeCtx();

    await reconnectWorldSocket(ctx);

    expect(sent.map(s => s.member)).toContain('Logon');
  });

  // The regression sentinel. `get TycoonId` on the OLD context id WAS the probe.
  // Reading TycoonId on the NEW context id after Logon is legitimate and
  // expected, so the assertion is deliberately scoped to the old id.
  it('never probes the stale ClientViewId', async () => {
    const { ctx, sent } = makeCtx();

    await reconnectWorldSocket(ctx);

    const staleReads = sent.filter(s => s.targetId === OLD_CONTEXT_ID && s.action === 'get');
    expect(staleReads).toEqual([]);
  });

  // O-H2: RDOCnntId is the memory address of the socket object
  // (WinSockRDOConnectionsServer.pas:664-668). Re-using the one read from the
  // dead socket either matched nothing or, worse, matched another client's.
  it('re-reads RDOCnntId before re-registering events', async () => {
    const { ctx, sent } = makeCtx();

    await reconnectWorldSocket(ctx);

    const members = sent.map(s => s.member);
    const cnntRead = members.indexOf('RDOCnntId');
    const register = members.indexOf('RegisterEventsById');

    expect(cnntRead).toBeGreaterThanOrEqual(0);
    expect(register).toBeGreaterThan(cnntRead);
  });

  it('registers events against the NEW context id, not the old one', async () => {
    const { ctx, sent } = makeCtx();

    await reconnectWorldSocket(ctx);

    const register = sent.find(s => s.member === 'RegisterEventsById');
    expect(register?.targetId).toBe(NEW_CONTEXT_ID);
  });
});

describe('reconnectWorldSocket — InterfaceEvents handshake', () => {
  // RegisterEventsById makes the server turn around and ask `idof
  // "InterfaceEvents"`. If we cannot resolve it, InitClient never arrives and
  // the login times out looking like a network fault. The old fallback path
  // called fullWorldRelogin without this registration — broken the same way.
  it('registers InterfaceEvents before RegisterEventsById is sent', async () => {
    const { ctx, known } = makeCtx();
    const setKnownObject = ctx.setKnownObject as jest.Mock;
    const sendRdoRequest = ctx.sendRdoRequest as jest.Mock;

    await reconnectWorldSocket(ctx);

    expect(known.get('InterfaceEvents')).toMatch(/^\d+$/);

    const registerCall = sendRdoRequest.mock.invocationCallOrder[
      sendRdoRequest.mock.calls.findIndex(
        (c: unknown[]) => (c[1] as { member?: string }).member === 'RegisterEventsById'
      )
    ];
    const knownCall = setKnownObject.mock.invocationCallOrder[
      setKnownObject.mock.calls.findIndex((c: unknown[]) => c[0] === 'InterfaceEvents')
    ];

    expect(knownCall).toBeLessThan(registerCall);
  });
});

describe('reconnectWorldSocket — preconditions', () => {
  it('refuses to reconnect with no world info', async () => {
    const { ctx } = makeCtx();
    (ctx as { currentWorldInfo: unknown }).currentWorldInfo = null;

    await expect(reconnectWorldSocket(ctx)).rejects.toThrow(/No world info/);
  });

  it('refuses to re-Logon without cached credentials', async () => {
    const { ctx } = makeCtx();
    (ctx as { cachedPassword: unknown }).cachedPassword = null;

    await expect(reconnectWorldSocket(ctx)).rejects.toThrow(/No cached credentials/);
  });
});
