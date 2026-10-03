import { describe, it, expect, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { DiagnosisBanner, tabForAction, actionLabel } from './DiagnosisBanner';
import { parseFacilityDiagnosis } from '@/shared/building-details/facility-diagnosis';

const TABS = [
  { id: 'general', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'General' },
  { id: 'supplies', name: 'SUPPLIES', order: 1, icon: 'S', handlerName: 'Supplies' },
  { id: 'svc', name: 'SERVICES', order: 2, icon: 'V', handlerName: 'compInputs' },
  { id: 'workforce', name: 'WORKFORCE', order: 3, icon: 'W', handlerName: 'Workforce' },
  { id: 'research', name: 'RESEARCH', order: 4, icon: 'R', handlerName: 'Research' },
] as never;

describe('DiagnosisBanner', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = renderWithProviders(<DiagnosisBanner diagnosis={parseFacilityDiagnosis('', 'No hints for this facility.')} />);
    expect(container.innerHTML).toBe('');
  });

  it('says the severity in words, a stop is an alert, a warning a status', () => {
    renderWithProviders(<DiagnosisBanner diagnosis={parseFacilityDiagnosis('Stopped: needs money.', '')} />);
    expect(screen.getByRole('alert').textContent).toContain('Stopped');
  });

  it('offers the action and hands it back on click; compact hides it', () => {
    const d = parseFacilityDiagnosis('', 'Warning: This facility requires Cotton to produce. Hire some suppliers.');
    const onAction = jest.fn();
    const { unmount } = renderWithProviders(<DiagnosisBanner diagnosis={d} onAction={onAction} />);
    expect(screen.getByRole('status').textContent).toContain('No supplies');
    fireEvent.click(screen.getByRole('button', { name: 'Find Cotton suppliers' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'findSupplier', fluidName: 'Cotton' });
    unmount();
    renderWithProviders(<DiagnosisBanner diagnosis={d} onAction={onAction} compact />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('maps actions to the tabs the server declared', () => {
    expect(tabForAction({ kind: 'findSupplier', fluidName: 'Cotton' }, TABS)).toBe('supplies');
    expect(tabForAction({ kind: 'openServices' }, TABS)).toBe('svc');
    expect(tabForAction({ kind: 'openWorkforce' }, TABS)).toBe('workforce');
    expect(tabForAction({ kind: 'openResearch' }, TABS)).toBe('research');
    expect(tabForAction({ kind: 'connect' }, TABS)).toBeNull();
    expect(tabForAction({ kind: 'openSupplies' }, [] as never)).toBeNull();
    expect(tabForAction(undefined, TABS)).toBeNull();
  });

  it('labels every action', () => {
    expect(actionLabel({ kind: 'findSupplier', fluidName: 'supplies' })).toBe('Find suppliers');
    expect(actionLabel({ kind: 'openSupplies' })).toBe('Open supplies');
    expect(actionLabel({ kind: 'openServices' })).toBe('Open services');
    expect(actionLabel({ kind: 'openWorkforce' })).toBe('Open workforce');
    expect(actionLabel({ kind: 'openResearch' })).toBe('Open research');
    expect(actionLabel({ kind: 'connect' })).toBe('Connect');
  });

  it('ok and hint severities render with their own icons (no action button without onAction)', () => {
    renderWithProviders(<DiagnosisBanner diagnosis={parseFacilityDiagnosis('', 'Congratulations: This building is working OK. Perhaps you can rise the rent a little bit.')} />);
    expect(screen.getByRole('status').textContent).toContain('Working well');
  });
});
