import { VISITOR_COMPANY_ID, VISITOR_COMPANY } from './visitor-visa';

describe('visitor-visa', () => {
  it('agrees on the id and uses the reference client label', () => {
    expect(VISITOR_COMPANY.id).toBe(VISITOR_COMPANY_ID);
    expect(VISITOR_COMPANY.name).toBe('[VISITOR VISA]');
  });
});
