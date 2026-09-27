/**
 * Tests for FileTransport — stream-backed file writing with size-based rotation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileTransport, ERROR_RETRY_MS } from './log-transport';

/** Poll (bounded) until `cond` holds. */
async function waitFor(cond: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

function readLines(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
}

describe('FileTransport', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spo-log-test-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the log directory if it does not exist', async () => {
    const logDir = path.join(tmpDir, 'nested', 'logs');
    const filePath = path.join(logDir, 'test.ndjson');
    const transport = new FileTransport({ filePath, maxFileSize: 1024, maxFiles: 3 });
    transport.write('{"msg":"hello"}');
    await transport.close();
    expect(fs.existsSync(logDir)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('writes NDJSON lines to the file', async () => {
    const filePath = path.join(tmpDir, 'test.ndjson');
    const transport = new FileTransport({ filePath, maxFileSize: 1024, maxFiles: 3 });
    transport.write('{"msg":"line1"}');
    transport.write('{"msg":"line2"}');
    await transport.close();
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ msg: 'line1' });
    expect(JSON.parse(lines[1])).toEqual({ msg: 'line2' });
  });

  it('rotates when file exceeds maxFileSize', async () => {
    const filePath = path.join(tmpDir, 'test.ndjson');
    // Set a very small max size to trigger rotation
    const transport = new FileTransport({ filePath, maxFileSize: 50, maxFiles: 3 });

    // Write enough to exceed 50 bytes
    transport.write('{"msg":"aaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'); // >50 bytes
    transport.write('{"msg":"bbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'); // triggers rotation
    await transport.close();

    // After rotation, the original file should have the new content
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(`${filePath}.1`)).toBe(true);

    const current = fs.readFileSync(filePath, 'utf8').trim();
    expect(current).toContain('bbbb');

    const rotated = fs.readFileSync(`${filePath}.1`, 'utf8').trim();
    expect(rotated).toContain('aaaa');
  });

  it('caps rotated files at maxFiles', async () => {
    const filePath = path.join(tmpDir, 'test.ndjson');
    const transport = new FileTransport({ filePath, maxFileSize: 30, maxFiles: 2 });

    // Write 4 batches to trigger multiple rotations
    transport.write('{"msg":"first-batch-data"}');
    transport.write('{"msg":"second-batch-data"}');
    transport.write('{"msg":"third-batch-data"}');
    transport.write('{"msg":"fourth-batch-data"}');
    await transport.close();

    // Should have current + .1 + .2 max (maxFiles=2)
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(`${filePath}.1`)).toBe(true);
    expect(fs.existsSync(`${filePath}.2`)).toBe(true);
    // .3 should NOT exist (capped at maxFiles)
    expect(fs.existsSync(`${filePath}.3`)).toBe(false);
  });

  it('appends to an existing file on restart', async () => {
    const filePath = path.join(tmpDir, 'test.ndjson');

    // Pre-populate the file
    fs.writeFileSync(filePath, '{"msg":"existing"}\n', 'utf8');

    const transport = new FileTransport({ filePath, maxFileSize: 1024, maxFiles: 3 });
    transport.write('{"msg":"new"}');
    await transport.close();

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ msg: 'existing' });
    expect(JSON.parse(lines[1])).toEqual({ msg: 'new' });
  });

  it('makes no synchronous fs call on the write path (rotations + close)', async () => {
    const filePath = path.join(tmpDir, 'test.ndjson');
    const transport = new FileTransport({ filePath, maxFileSize: 30, maxFiles: 2 });

    const realFs = jest.requireActual<typeof import('fs')>('fs');
    const pathSpies = [
      jest.spyOn(realFs, 'appendFileSync'),
      jest.spyOn(realFs, 'renameSync'),
      jest.spyOn(realFs, 'unlinkSync'),
      jest.spyOn(realFs, 'statSync'),
    ];
    const writeSyncSpy = jest.spyOn(realFs, 'writeSync');

    transport.write('{"msg":"first-batch-data"}');
    transport.write('{"msg":"second-batch-data"}');
    transport.write('{"msg":"third-batch-data"}');
    transport.write('{"msg":"fourth-batch-data"}');
    await transport.close();

    for (const spy of pathSpies) {
      const onOurFiles = spy.mock.calls.filter((args) => String(args[0]).startsWith(tmpDir));
      expect(onOurFiles).toEqual([]);
    }
    const nonStdio = writeSyncSpy.mock.calls.filter((args) => args[0] !== 1 && args[0] !== 2);
    expect(nonStdio).toEqual([]);
    // The rotations really happened (so the spies watched a real rotation).
    expect(fs.existsSync(`${filePath}.2`)).toBe(true);
  });

  describe('rotation over a stream', () => {
    it('keeps current + maxFiles rotated files, newest first', async () => {
      const filePath = path.join(tmpDir, 'test.ndjson');
      const transport = new FileTransport({ filePath, maxFileSize: 30, maxFiles: 2 });
      const lines = ['{"n":1,"pad":"aaaaaaaaaaaa"}', '{"n":2,"pad":"bbbbbbbbbbbb"}',
        '{"n":3,"pad":"cccccccccccc"}', '{"n":4,"pad":"dddddddddddd"}'];
      for (const l of lines) transport.write(l);
      await transport.close();

      expect(readLines(filePath)).toEqual([lines[3]]);
      expect(readLines(`${filePath}.1`)).toEqual([lines[2]]);
      expect(readLines(`${filePath}.2`)).toEqual([lines[1]]);
      expect(fs.existsSync(`${filePath}.3`)).toBe(false);
    });

    it('loses and duplicates no line, in write order across the files', async () => {
      const filePath = path.join(tmpDir, 'test.ndjson');
      const transport = new FileTransport({ filePath, maxFileSize: 30, maxFiles: 10 });
      const lines = [1, 2, 3, 4, 5].map((n) => `{"n":${n},"pad":"xxxxxxxxxxxx"}`);
      for (const l of lines) transport.write(l);
      await transport.close();

      const all: string[] = [];
      for (let i = 10; i >= 1; i--) {
        const f = `${filePath}.${i}`;
        if (fs.existsSync(f)) all.push(...readLines(f));
      }
      all.push(...readLines(filePath));
      expect(all).toEqual(lines);
    });
  });

  describe('close()', () => {
    it('flushes every accepted line, is idempotent, and drops writes after close', async () => {
      const filePath = path.join(tmpDir, 'test.ndjson');
      const transport = new FileTransport({ filePath, maxFileSize: 10 * 1024 * 1024, maxFiles: 3 });
      const lines = Array.from({ length: 1000 }, (_, i) => `{"i":${i}}`);
      for (const l of lines) transport.write(l);
      const first = transport.close();
      await first;
      expect(readLines(filePath)).toEqual(lines);

      const second = transport.close();
      expect(second).toBe(first);
      await expect(second).resolves.toBeUndefined();

      fs.rmSync(filePath);
      expect(() => transport.write('{"msg":"x"}')).not.toThrow();
      await new Promise((r) => setTimeout(r, 20));
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('resolves at once when nothing was ever written', async () => {
      const filePath = path.join(tmpDir, 'test.ndjson');
      const transport = new FileTransport({ filePath, maxFileSize: 1024, maxFiles: 3 });
      await expect(transport.close()).resolves.toBeUndefined();
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe('write error', () => {
    it('reports once on stderr, never throws, and resumes after the retry delay', async () => {
      const filePath = path.join(tmpDir, 'test.ndjson');
      fs.mkdirSync(filePath); // open fails with EISDIR
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const transport = new FileTransport({ filePath, maxFileSize: 1024 * 1024, maxFiles: 3 });

      expect(() => {
        transport.write('{"msg":"a"}');
        transport.write('{"msg":"b"}');
        transport.write('{"msg":"c"}');
      }).not.toThrow();

      await waitFor(() => stderrSpy.mock.calls.length > 0);
      const mentions = () => stderrSpy.mock.calls.filter((c) => String(c[0]).includes(filePath));
      expect(mentions()).toHaveLength(1);
      expect(String(stderrSpy.mock.calls[0][0])).toContain('write failed');

      // While suspended: more lines, no more stderr.
      transport.write('{"msg":"d"}');
      transport.write('{"msg":"e"}');
      await new Promise((r) => setTimeout(r, 20));
      expect(stderrSpy).toHaveBeenCalledTimes(1);

      fs.rmSync(filePath, { recursive: true });
      const realNow = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(realNow + ERROR_RETRY_MS + 1);

      transport.write('{"msg":"after"}');
      await transport.close();

      expect(readLines(filePath)).toEqual(['{"msg":"after"}']);
      const resumed = stderrSpy.mock.calls.filter((c) => /resumed, \d+ lines dropped/.test(String(c[0])));
      expect(resumed).toHaveLength(1);
      expect(String(resumed[0][0])).toContain('resumed, 2 lines dropped');
    });

    it('stays silent while a retry fails again', async () => {
      const filePath = path.join(tmpDir, 'test.ndjson');
      fs.mkdirSync(filePath);
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const transport = new FileTransport({ filePath, maxFileSize: 1024 * 1024, maxFiles: 3 });

      transport.write('{"msg":"a"}');
      await waitFor(() => stderrSpy.mock.calls.length > 0);

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + ERROR_RETRY_MS + 1);
      transport.write('{"msg":"retry"}'); // reopens, fails again
      await new Promise((r) => setTimeout(r, 50));
      nowSpy.mockRestore();
      await transport.close();

      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it('drops lines queued behind a rotation while the file is unavailable', async () => {
      const filePath = path.join(tmpDir, 'test.ndjson');
      fs.mkdirSync(filePath);
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      // The directory's size makes the first line trigger a queued rotation.
      const transport = new FileTransport({ filePath, maxFileSize: 1, maxFiles: 3 });
      jest.spyOn(fs.promises, 'rename').mockRejectedValue(new Error('no'));

      transport.write('{"msg":"a"}');
      transport.write('{"msg":"b"}');
      await waitFor(() => stderrSpy.mock.calls.length > 0);
      await transport.close();

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(fs.statSync(filePath).isDirectory()).toBe(true);
    });
  });

  describe('memory cap', () => {
    it('drops whole lines past the cap with one notice, then reports the resume', async () => {
      const filePath = path.join(tmpDir, 'test.ndjson');
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const transport = new FileTransport({
        filePath, maxFileSize: 1024 * 1024, maxFiles: 3, maxBufferedBytes: 200,
      });

      for (let i = 0; i < 100; i++) transport.write(JSON.stringify({ i, pad: 'yyyyyyyyyyyyyyyy' }));
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(String(stderrSpy.mock.calls[0][0])).toContain('write buffer full');

      await waitFor(() => fs.existsSync(filePath) && fs.statSync(filePath).size > 0);
      await new Promise((r) => setTimeout(r, 20));
      transport.write(JSON.stringify({ i: 100, pad: 'z' }));
      expect(stderrSpy).toHaveBeenCalledTimes(2);
      expect(String(stderrSpy.mock.calls[1][0])).toMatch(/resumed, \d+ lines dropped/);
      await transport.close();

      const parsed = readLines(filePath).map((l) => JSON.parse(l) as { i: number });
      const idx = parsed.map((p) => p.i);
      expect(idx.length).toBeLessThan(101);
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
      expect(idx[idx.length - 1]).toBe(100);
    });
  });
});
