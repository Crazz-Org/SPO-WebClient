import { accountId, settingsKey, SETTINGS_KEY_PREFIX } from './account-settings';

describe('settingsKey', () => {
  it('ignores surrounding spaces and case', () => {
    expect(settingsKey(' crazz ')).toBe(settingsKey('CRAZZ'));
    expect(settingsKey('crazz')).toBe(`${SETTINGS_KEY_PREFIX}CRAZZ`);
  });

  it('turns inner spaces into dots, as the directory server does', () => {
    expect(settingsKey('bob smith')).toBe(settingsKey('bob.smith'));
    expect(accountId('bob  smith')).toBe('BOB.SMITH');
  });

  it('falls back to a fixed id for an empty name', () => {
    expect(accountId('   ')).toBe('player');
  });
});
