/**
 * Conformity sweep — RDO frames must be written via writeRdoFrame() (Latin-1).
 *
 * The Delphi servers speak ANSI single-byte on the wire. A raw
 * socket.write(string) encodes UTF-8 and corrupts characters >= 0x80.
 * This test scans production server sources and fails if any raw
 * `socket.write(` call site reappears outside rdo-helpers.ts.
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const SERVER_SRC = path.resolve(__dirname, '..');

/** Only rdo-helpers.ts (the helper implementation) may call socket.write. */
const ALLOWLIST = new Set(['rdo-helpers.ts']);

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === '__mocks__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Identifiers whose .write() is NOT an RDO socket (audited non-RDO surfaces):
 * - res: HTTP/SSE responses in server.ts
 * - transport: browser WebSocket transport in server.ts
 * - pictureSocket: the cache server's picture-transfer TCP connection
 *   (session/picture-transfer.ts) — bare "User=/World=/Size=" + JPEG bytes,
 *   no RDO framing, no separator, issue #705
 */
const NON_RDO_WRITERS = new Set(['res', 'transport', 'pictureSocket']);

describe('no raw socket.write() on RDO sockets', () => {
  it('every RDO write goes through writeRdoFrame()', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SERVER_SRC)) {
      if (ALLOWLIST.has(path.basename(file))) continue;
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        // Hardened (audit): match ANY `<identifier>.write(` — not just a variable
        // literally named `socket` — so aliased or pooled socket references
        // (e.g. `poolConn.socket.write(`, `sock.write(`, `conn.write(`) are caught.
        const matches = line.matchAll(/\b(\w+)!?\.write\(/g);
        for (const m of matches) {
          if (!NON_RDO_WRITERS.has(m[1])) {
            offenders.push(`${path.relative(SERVER_SRC, file)}:${i + 1}: ${line.trim()}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
