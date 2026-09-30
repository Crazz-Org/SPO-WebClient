import {
  GOVERNED_TOWN,
  INTERFACE_LOG_BASE,
  LIMITS,
  LIVE_LOG_BASE,
  PRESIDENT_MEMBERS,
  PRIMARY_ACCOUNT,
  SECONDARY_ACCOUNT,
  TIMEOUTS,
  WORLD_NAME,
  ZONE_PATH,
} from './config';

describe('locked configuration', () => {
  it('keeps the accounts as approved — changing one needs developer sign-off', () => {
    expect(PRIMARY_ACCOUNT).toMatchObject({ username: 'SPO_test3', password: 'test3' });
    expect(SECONDARY_ACCOUNT).toMatchObject({ username: 'Crazz', password: 'test' });
  });

  it('targets planitia under Free Space, not BETA', () => {
    expect(WORLD_NAME).toBe('planitia');
    expect(ZONE_PATH).toBe('Root/Areas/America/Worlds');
  });

  it('names the town inside the blast radius', () => {
    expect(GOVERNED_TOWN).toBe('Helartia');
  });

  it('lists the six TPresidentialHall members the gate blocks on', () => {
    expect([...PRESIDENT_MEMBERS].sort()).toEqual([
      'RDOBanMinister',
      'RDOSetMinSalaryValue',
      'RDOSetMinistryBudget',
      'RDOSetTownTaxes',
      'RDOSitMayor',
      'RDOSitMinister',
    ]);
  });

  it('caps the retry loop at three attempts', () => {
    expect(LIMITS.maxAttempts).toBe(3);
  });

  it('keeps a positive gate attestation window', () => {
    expect(LIMITS.gateMaxAgeMinutes).toBeGreaterThan(0);
  });

  it('reads the Interface Server logs beside the model server ones', () => {
    expect(INTERFACE_LOG_BASE).toMatch(/\/FIVEINTERFACESERVER\/$/);
    expect(new URL('..', INTERFACE_LOG_BASE).href).toBe(new URL('..', LIVE_LOG_BASE).href);
  });

  it('keeps the WebSocket closed 20 s before session-resume resumes', () => {
    expect(TIMEOUTS.resumeGap).toBe(20_000);
  });

  it('bounds the read-back poll by the town-hall cache TTL plus a margin, never more', () => {
    // Kernel/Population.pas:1192 — a two-minute TTL (OB-29), plus 30 s.
    expect(TIMEOUTS.readBack).toBe(150_000);
    expect(TIMEOUTS.readBackPoll).toBe(5_000);
  });
});
