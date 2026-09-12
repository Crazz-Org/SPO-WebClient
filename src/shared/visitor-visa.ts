import type { CompanyInfo } from './types/domain-types';

/** chooseVisa.asp:44 — `SetCompany&Name=[VISITOR VISA]&Id=0`; visitor ≡ companyId = 0 (VoyagerWindow.pas:402). */
export const VISITOR_COMPANY_ID = '0';
export const VISITOR_COMPANY: CompanyInfo = { id: VISITOR_COMPANY_ID, name: '[VISITOR VISA]' };
