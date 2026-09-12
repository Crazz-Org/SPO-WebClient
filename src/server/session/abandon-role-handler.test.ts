import { abandonRole } from './abandon-role-handler';
import type { AbandonRoleContext } from './abandon-role-handler';
import type { CompanyInfo } from '../../shared/types';

const HOME: CompanyInfo = { id: '55', name: 'SPO_test3 - Green', ownerRole: 'SPO_test3' };
const ROLE_COMPANY: CompanyInfo = { id: '56', name: 'Mayor of Kalisz', ownerRole: 'Mayor of Kalisz' };

interface Fakes {
  ctx: AbandonRoleContext;
  readPersonalCompanies: jest.Mock;
  executeCurriculumAction: jest.Mock;
  switchCompany: jest.Mock;
  logWarn: jest.Mock;
}

function makeCtx(overrides?: {
  activeUsername?: string | null;
  readPersonalCompanies?: jest.Mock;
  executeCurriculumAction?: jest.Mock;
  switchCompany?: jest.Mock;
}): Fakes {
  const readPersonalCompanies = overrides?.readPersonalCompanies ?? jest.fn().mockResolvedValue([HOME, ROLE_COMPANY]);
  const executeCurriculumAction = overrides?.executeCurriculumAction
    ?? jest.fn().mockResolvedValue({ success: true, message: 'abandonRole completed successfully' });
  const switchCompany = overrides?.switchCompany ?? jest.fn().mockResolvedValue(undefined);
  const logWarn = jest.fn();

  const ctx: AbandonRoleContext = {
    cachedUsername: 'SPO_test3',
    activeUsername: overrides?.activeUsername ?? 'SPO_test3',
    currentCompany: null,
    log: { debug: jest.fn(), info: jest.fn(), warn: logWarn, error: jest.fn() },
    readPersonalCompanies,
    executeCurriculumAction,
    switchCompany,
  };

  return { ctx, readPersonalCompanies, executeCurriculumAction, switchCompany, logWarn };
}

describe('abandonRole', () => {
  it('entered as the personal tycoon: unchanged, switchCompany not called', async () => {
    const { ctx, switchCompany } = makeCtx({ activeUsername: 'SPO_test3' });
    const result = await abandonRole(ctx);
    expect(result).toEqual({ success: true, message: 'abandonRole completed successfully', outcome: 'unchanged' });
    expect(switchCompany).not.toHaveBeenCalled();
  });

  it('entered as the role: reads companies before resigning, then switches to the personal one', async () => {
    const { ctx, switchCompany, readPersonalCompanies, executeCurriculumAction } = makeCtx({ activeUsername: 'Mayor of Kalisz' });
    const result = await abandonRole(ctx);
    expect(result).toEqual({ success: true, message: 'abandonRole completed successfully', outcome: 'switched', company: HOME });
    expect(switchCompany).toHaveBeenCalledWith(HOME);

    const readOrder = readPersonalCompanies.mock.invocationCallOrder[0];
    const executeOrder = executeCurriculumAction.mock.invocationCallOrder[0];
    expect(readOrder).toBeLessThan(executeOrder);
  });

  it('the owner match is case-insensitive', async () => {
    const { ctx } = makeCtx({
      activeUsername: 'Mayor of Kalisz',
      readPersonalCompanies: jest.fn().mockResolvedValue([{ id: '55', name: 'SPO_test3 - Green', ownerRole: 'spo_test3' }]),
    });
    const result = await abandonRole(ctx);
    expect(result.outcome).toBe('switched');
    expect(result.company?.id).toBe('55');
  });

  it('a company with no ownerRole counts as the personal one', async () => {
    const { ctx } = makeCtx({
      activeUsername: 'Mayor of Kalisz',
      readPersonalCompanies: jest.fn().mockResolvedValue([{ id: '55', name: 'SPO_test3 - Green' }]),
    });
    const result = await abandonRole(ctx);
    expect(result.outcome).toBe('switched');
  });

  it('no personal company: no-company, switchCompany not called', async () => {
    const { ctx, switchCompany } = makeCtx({
      activeUsername: 'Mayor of Kalisz',
      readPersonalCompanies: jest.fn().mockResolvedValue([ROLE_COMPANY]),
    });
    const result = await abandonRole(ctx);
    expect(result).toEqual({ success: true, message: 'abandonRole completed successfully', outcome: 'no-company' });
    expect(switchCompany).not.toHaveBeenCalled();
  });

  it('resignation refused: unchanged, switchCompany not called, read still happens', async () => {
    const { ctx, readPersonalCompanies, switchCompany } = makeCtx({
      activeUsername: 'Mayor of Kalisz',
      executeCurriculumAction: jest.fn().mockResolvedValue({ success: false, message: 'abandonRole was not applied: the role is still held' }),
    });
    const result = await abandonRole(ctx);
    expect(result).toEqual({ success: false, message: 'abandonRole was not applied: the role is still held', outcome: 'unchanged' });
    expect(readPersonalCompanies).toHaveBeenCalled();
    expect(switchCompany).not.toHaveBeenCalled();
  });

  it('a read failure is treated as no companies, and resignation still proceeds', async () => {
    const { ctx, executeCurriculumAction, logWarn } = makeCtx({
      activeUsername: 'Mayor of Kalisz',
      readPersonalCompanies: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    const result = await abandonRole(ctx);
    expect(result.outcome).toBe('no-company');
    expect(executeCurriculumAction).toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalled();
  });

  it('switchCompany rejecting reports the failure without losing the resignation', async () => {
    const { ctx } = makeCtx({
      activeUsername: 'Mayor of Kalisz',
      switchCompany: jest.fn().mockRejectedValue(new Error('world unreachable')),
    });
    const result = await abandonRole(ctx);
    expect(result).toEqual({
      success: false,
      message: 'Role abandoned, but returning to SPO_test3 - Green failed: world unreachable',
      outcome: 'unchanged',
    });
  });
});
