import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { unlock } from './unlock';
import { WorldLock } from './world-lock';
import { SECONDARY_ACCOUNT } from './config';

function tempLock(): WorldLock {
  return new WorldLock(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-unlock-')));
}

describe('unlock', () => {
  it('says so when there was nothing to clear', () => {
    expect(unlock(tempLock())).toMatch(/nothing to clear/);
  });

  it('clears a dirty lock and lists what was pending', () => {
    const lock = tempLock();
    lock.acquire('fix/a', 1, () => false);
    lock.addPendingRestore({
      key: 'RDOSetTaxValue:k1',
      what: 'Helartia tax row 0',
      x: 10,
      y: 20,
      propertyName: 'RDOSetTaxValue',
      originalValue: '7',
    });
    expect(() => lock.release('crashed')).toThrow();

    const message = unlock(lock);

    expect(message).toMatch(/Cleared a dirty lock/);
    expect(message).toMatch(/Reason: crashed/);
    expect(message).toMatch(/Helartia tax row 0 at \(10,20\) RDOSetTaxValue -> "7"/);
    expect(message).toContain('key: RDOSetTaxValue:k1');
    expect(lock.read().dirty).toBe(false);
  });

  it('prints what and key for an entry that is not a building property', () => {
    const lock = tempLock();
    lock.addPendingRestore({
      key: 'RDOSetPolicyStatus:k2',
      what: `SPO_test3 policy toward ${SECONDARY_ACCOUNT.username} — put back "0"`,
      originalValue: '0',
    });
    const message = unlock(lock);
    expect(message).toContain(`SPO_test3 policy toward ${SECONDARY_ACCOUNT.username} — put back "0" -> "0" [key: RDOSetPolicyStatus:k2]`);
    expect(message).not.toContain('at (');
  });

  it('prints a keyless entry written before keys existed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-unlock-'));
    fs.writeFileSync(
      path.join(dir, 'world-lock.json'),
      JSON.stringify({
        holder: null,
        pendingRestores: [{ what: 'Helartia tax row 0', x: 1, y: 2, propertyName: 'RDOSetTaxValue', originalValue: '7' }],
        dirty: true,
      }),
      'utf8',
    );
    const message = unlock(new WorldLock(dir));
    expect(message).toContain('Helartia tax row 0 at (1,2) RDOSetTaxValue -> "7"');
    expect(message).toContain('(none — written before keys existed)');
  });
});
