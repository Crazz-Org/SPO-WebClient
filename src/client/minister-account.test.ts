import { isMinisterAccount } from './minister-account';

describe('isMinisterAccount', () => {
  it.each(['Minister of Health', 'minister of health', 'MINISTER OF X'])(
    'is true for %s',
    (username) => {
      expect(isMinisterAccount(username)).toBe(true);
    },
  );

  it.each(['SPO_test3', 'Mayor of Helartia', 'President of Shamba', '', 'Prime Minister of X'])(
    'is false for %s',
    (username) => {
      expect(isMinisterAccount(username)).toBe(false);
    },
  );
});
