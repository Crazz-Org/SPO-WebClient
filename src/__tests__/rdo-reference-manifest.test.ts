/**
 * scripts/rdo-reference-manifest.json pins the reference Pascal tree (`~/SPO-Original`) that
 * `File.pas:Line` citations in src/shared/rdo-members.ts point into, so a citation stays
 * permanently checkable against the exact bytes it was verified against.
 *
 * This test recomputes each listed file's git blob hash from the real tree on disk and
 * compares it to the manifest — a mismatch means the reference tree moved, which should
 * never happen silently (it is a frozen historical archive, not a live checkout that tracks
 * upstream).
 *
 * Guarded: when `~/SPO-Original` (or `SPO_ORIGINAL_DIR`) is not present — e.g. a CI checkout
 * that does not have it — every test here skips with a clearly stated reason, never fails as
 * though the tree had actually diverged.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface ManifestFile {
  path: string;
  gitBlobSha1?: string;
  contentSha256?: string;
  citedByMembers: string[];
}

interface Manifest {
  referenceRoot: string;
  isGitRepo: boolean;
  commit?: string;
  hashAlgorithm: 'git-blob-sha1' | 'content-sha256';
  files: ManifestFile[];
}

const manifest: Manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../scripts/rdo-reference-manifest.json'), 'utf8'),
);

const referenceRoot = process.env.SPO_ORIGINAL_DIR || path.join(require('os').homedir(), 'SPO-Original');

function referenceRootAvailable(): boolean {
  try {
    return fs.statSync(referenceRoot).isDirectory();
  } catch {
    return false;
  }
}

const available = referenceRootAvailable();

function gitBlobSha1(root: string, relPath: string): string {
  return execFileSync('git', ['hash-object', relPath], { cwd: root, encoding: 'utf8' }).trim();
}

if (!available) {
  // console note rather than a silent no-op, per the task: state the skip reason clearly.
  // eslint-disable-next-line no-console
  console.warn(
    `rdo-reference-manifest.test.ts: skipping — reference tree not found at ${referenceRoot}. ` +
      `Set SPO_ORIGINAL_DIR or ensure ~/SPO-Original exists to run this suite.`,
  );
}

describe('scripts/rdo-reference-manifest.json', () => {
  it('lists at least one file', () => {
    expect(manifest.files.length).toBeGreaterThan(0);
  });

  it('every listed file is actually cited by at least one member', () => {
    for (const f of manifest.files) {
      expect(f.citedByMembers.length).toBeGreaterThan(0);
    }
  });

  it('declares a hash algorithm consistent with whether the reference tree is a git repo', () => {
    if (manifest.isGitRepo) {
      expect(manifest.hashAlgorithm).toBe('git-blob-sha1');
      expect(manifest.commit).toBeTruthy();
    } else {
      expect(manifest.hashAlgorithm).toBe('content-sha256');
    }
  });

  (available ? describe : describe.skip)('pinned hashes match the real tree on disk', () => {
    it(`the reference tree at ${referenceRoot} is still a git repository, as the manifest assumes`, () => {
      const isRepo = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: referenceRoot,
        encoding: 'utf8',
      }).trim();
      expect(isRepo).toBe(String(manifest.isGitRepo));
    });

    it.each(manifest.files.map(f => [f.path, f] as const))(
      '%s matches its pinned git blob hash',
      (_label, file) => {
        expect(manifest.isGitRepo).toBe(true); // this manifest was built against a real git repo
        expect(file.gitBlobSha1).toBeTruthy();
        const actual = gitBlobSha1(referenceRoot, file.path);
        expect(actual).toBe(file.gitBlobSha1);
      },
    );

    it('the pinned commit is still the tree\'s current HEAD (informational pin, not just the blobs)', () => {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: referenceRoot, encoding: 'utf8' }).trim();
      expect(head).toBe(manifest.commit);
    });
  });
});
