/**
 * Phase 0 placeholder for the inspector: until implemented it renders the classic
 * BuildingSurface so v2 stays playable. The slot owner replaces this file.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';

jest.mock('../../components/sheet/BuildingSurface', () => ({ BuildingSurface: () => <div>V1_BUILDINGSURFACE</div> }));

import * as barrel from './index';
import { InspectorV2 } from './InspectorV2';

describe('v2 inspector placeholder', () => {
  it('is exported from its file and the barrel, and renders the classic BuildingSurface', () => {
    expect(barrel.InspectorV2).toBe(InspectorV2);
    renderWithProviders(<InspectorV2 />);
    expect(screen.getByText('V1_BUILDINGSURFACE')).toBeTruthy();
  });
});
