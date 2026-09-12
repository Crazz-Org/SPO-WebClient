/**
 * Drives the real gateway through the `abandon-role` scenario, exactly as
 * `company-list-scenario.test.ts` does. `switchCompany` is replaced with a
 * stub that performs only the first two things the real one does
 * (`login-handler.ts:744-750`: set the current company, set the active
 * identity) — the rest is the world re-login over TCP, L2 ground with its own
 * coverage in `login-handler.test.ts:1351+`.
 */

jest.mock('node-fetch', () => ({ __esModule: true, default: jest.fn() }));

import fetch from 'node-fetch';
import { StarpeaceSession } from '@/server/spo_session';
import { HttpMock } from '../http-mock';
import { createAbandonRoleScenario, MOCK_HOME_COMPANY } from './abandon-role-scenario';

const fetchMock = fetch as unknown as jest.Mock;

function setupSession(): { session: StarpeaceSession; requestedUrls: string[] } {
  const session = new StarpeaceSession();
  session.setCurrentWorldInfo({ name: 'Shamba', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 8000 });
  session.setCachedUsername('SPO_test3');
  session.setCachedPassword('test3');
  session.setDaAddr('158.69.153.134');
  session.setDaPort(7001);
  session.setInterfaceServerId('8161308');

  jest.spyOn(session, 'switchCompany').mockImplementation(async (c) => {
    session.setCurrentCompany(c);
    session.setActiveUsername(c.ownerRole ?? null);
  });

  const requestedUrls: string[] = [];
  return { session, requestedUrls };
}

describe('abandon-role scenario — gateway round-trip', () => {
  beforeEach(() => fetchMock.mockReset());

  it('entered as the role: reads the personal company list before resigning, then switches home', async () => {
    const { http } = createAbandonRoleScenario();
    const mock = new HttpMock();
    mock.addScenario(http);
    const { session, requestedUrls } = setupSession();
    session.setActiveUsername('Mayor of Kalisz');
    session.setCurrentCompany({ id: '56', name: 'Mayor of Kalisz', ownerRole: 'Mayor of Kalisz' });

    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      requestedUrls.push(u);
      const result = mock.match('GET', u);
      return result
        ? { ok: true, status: result.status, statusText: 'OK', text: async () => result.body, url: u }
        : { ok: false, status: 404, statusText: 'Not Found', text: async () => '', url: u };
    });

    const result = await session.abandonRole();

    expect(result.outcome).toBe('switched');
    expect(result.company).toEqual(MOCK_HOME_COMPANY);

    const logonIdx = requestedUrls.findIndex(u => u.includes('logonComplete.asp'));
    const commitIdx = requestedUrls.findIndex(u => u.includes('rdoAbandonRole.asp'));
    expect(logonIdx).toBeGreaterThanOrEqual(0);
    expect(commitIdx).toBeGreaterThan(logonIdx);
    expect(requestedUrls[logonIdx]).toContain('UserName=SPO_test3');
    expect(requestedUrls[logonIdx]).not.toContain('UserName=Mayor');

    expect(session.switchCompany).toHaveBeenCalledTimes(1);
    expect(session.switchCompany).toHaveBeenCalledWith(MOCK_HOME_COMPANY);
    expect(session.currentCompany?.name).toBe('SPO_test3 - Green');
    expect(session.activeUsername).toBe('SPO_test3');
  });

  it('entered as the personal tycoon: unchanged, no switch, the resignation still happens', async () => {
    const { http } = createAbandonRoleScenario();
    const mock = new HttpMock();
    mock.addScenario(http);
    const { session, requestedUrls } = setupSession();
    session.setActiveUsername('SPO_test3');
    session.setCurrentCompany({ id: '55', name: 'SPO_test3 - Green', ownerRole: 'SPO_test3' });

    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      requestedUrls.push(u);
      const result = mock.match('GET', u);
      return result
        ? { ok: true, status: result.status, statusText: 'OK', text: async () => result.body, url: u }
        : { ok: false, status: 404, statusText: 'Not Found', text: async () => '', url: u };
    });

    const result = await session.abandonRole();

    expect(result.outcome).toBe('unchanged');
    expect(session.switchCompany).not.toHaveBeenCalled();
    expect(session.currentCompany?.name).toBe('SPO_test3 - Green');
    expect(requestedUrls.some(u => u.includes('rdoAbandonRole.asp'))).toBe(true);
  });

  it('no personal company: no-company, switch not called', async () => {
    const { http } = createAbandonRoleScenario(undefined, { personalCompanies: [] });
    const mock = new HttpMock();
    mock.addScenario(http);
    const { session } = setupSession();
    session.setActiveUsername('Mayor of Kalisz');
    session.setCurrentCompany({ id: '56', name: 'Mayor of Kalisz', ownerRole: 'Mayor of Kalisz' });

    fetchMock.mockImplementation(async (url: unknown) => {
      const result = mock.match('GET', String(url));
      return result
        ? { ok: true, status: result.status, statusText: 'OK', text: async () => result.body, url: String(url) }
        : { ok: false, status: 404, statusText: 'Not Found', text: async () => '', url: String(url) };
    });

    const result = await session.abandonRole();

    expect(result.outcome).toBe('no-company');
    expect(session.switchCompany).not.toHaveBeenCalled();
  });

  it('abandon refused: the role is still held, no switch, current company untouched', async () => {
    const { http } = createAbandonRoleScenario(undefined, { roleStillHeld: true });
    const mock = new HttpMock();
    mock.addScenario(http);
    const { session } = setupSession();
    session.setActiveUsername('Mayor of Kalisz');
    session.setCurrentCompany({ id: '56', name: 'Mayor of Kalisz', ownerRole: 'Mayor of Kalisz' });

    fetchMock.mockImplementation(async (url: unknown) => {
      const result = mock.match('GET', String(url));
      return result
        ? { ok: true, status: result.status, statusText: 'OK', text: async () => result.body, url: String(url) }
        : { ok: false, status: 404, statusText: 'Not Found', text: async () => '', url: String(url) };
    });

    const result = await session.abandonRole();

    expect(result.success).toBe(false);
    expect(session.switchCompany).not.toHaveBeenCalled();
    expect(session.currentCompany?.name).toBe('Mayor of Kalisz');
  });
});
