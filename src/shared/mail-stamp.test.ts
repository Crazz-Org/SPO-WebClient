import { mailStampIndex, mailStampPath, MAIL_STAMP_COUNT } from './mail-stamp';

describe('mailStampIndex', () => {
  it('applies stamp mod 15', () => {
    expect(mailStampIndex(17)).toBe(2);
    expect(mailStampIndex(0)).toBe(0);
    expect(mailStampIndex(14)).toBe(14);
    expect(mailStampIndex(15)).toBe(0);
    expect(mailStampIndex(42)).toBe(12);
  });

  it('falls back to 0 for a missing or unparseable stamp', () => {
    expect(mailStampIndex(undefined)).toBe(0);
    expect(mailStampIndex(null)).toBe(0);
    expect(mailStampIndex(NaN)).toBe(0);
    expect(mailStampIndex(-3)).toBe(0);
    expect(mailStampIndex(2.5)).toBe(0);
  });

  it('MAIL_STAMP_COUNT is 15', () => {
    expect(MAIL_STAMP_COUNT).toBe(15);
  });
});

describe('mailStampPath', () => {
  it('builds the IIS path for the resolved index', () => {
    expect(mailStampPath(17)).toBe('/Five/0/Visual/Voyager/Mail/images/stamp2.jpg');
    expect(mailStampPath(undefined)).toBe('/Five/0/Visual/Voyager/Mail/images/stamp0.jpg');
  });
});
