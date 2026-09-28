/**
 * scripts/changelog.js — the derived-version rule and the grouping behind the release
 * notes. The pure functions only; the git-facing CLI is exercised by the workflow.
 */

import * as fs from 'fs';
import * as path from 'path';

interface ParsedCommit {
  prefix: string;
  breaking: boolean;
  description: string;
}

interface ChangelogModule {
  parseCommit(message: string): ParsedCommit | null;
  categorize(subjects: string[]): Record<string, ParsedCommit[]>;
  baseFromTag(tag: string | null): string | null;
  nextVersion(base: string, subjects: string[]): { version: string; skip: boolean };
  renderSections(categories: Record<string, ParsedCommit[]>): string;
  generateMarkdownSection(version: string, date: string, categories: Record<string, ParsedCommit[]>): string;
}

const changelog: ChangelogModule = require('../../scripts/changelog.js');

describe('parseCommit', () => {
  it('reads prefix, scope, breaking marker and description', () => {
    expect(changelog.parseCommit('feat(bench): refuse a dirty tree')).toEqual({
      prefix: 'feat',
      breaking: false,
      description: 'refuse a dirty tree',
    });
    expect(changelog.parseCommit('feat!: drop the old frame')).toEqual({
      prefix: 'feat',
      breaking: true,
      description: 'drop the old frame',
    });
    expect(changelog.parseCommit('fix: a thing (#34)')?.description).toBe('a thing (#34)');
  });

  it('returns null for anything that is not a conventional subject', () => {
    expect(changelog.parseCommit('Merge pull request #30')).toBeNull();
    expect(changelog.parseCommit('merge: release v1.3.2-beta')).not.toBeNull();
    expect(changelog.parseCommit('no colon here')).toBeNull();
  });
});

describe('baseFromTag', () => {
  it('strips the v and any prerelease suffix', () => {
    expect(changelog.baseFromTag('v1.3.2-beta')).toBe('1.3.2');
    expect(changelog.baseFromTag('v1.2.1')).toBe('1.2.1');
    expect(changelog.baseFromTag('1.0.0-rc.1')).toBe('1.0.0');
  });

  it('rejects non-version tags', () => {
    expect(changelog.baseFromTag('bench-2026')).toBeNull();
    expect(changelog.baseFromTag('v1.2')).toBeNull();
    expect(changelog.baseFromTag(null)).toBeNull();
  });
});

describe('nextVersion', () => {
  it('skips when nothing was committed since the tag', () => {
    expect(changelog.nextVersion('v1.3.2-beta', [])).toEqual({ version: '1.3.2', skip: true });
  });

  it('bumps the minor on any feat, scoped or breaking, and resets the patch', () => {
    expect(changelog.nextVersion('v1.3.2-beta', ['fix: a', 'feat(bench): b'])).toEqual({
      version: '1.4.0',
      skip: false,
    });
    expect(changelog.nextVersion('v1.4.3', ['feat!: b'])).toEqual({ version: '1.5.0', skip: false });
  });

  it('bumps the patch otherwise — fixes, docs, chores, even unparseable subjects', () => {
    expect(changelog.nextVersion('v1.3.2-beta', ['fix: a'])).toEqual({ version: '1.3.3', skip: false });
    expect(changelog.nextVersion('v1.4.0', ['docs: a', 'chore: b'])).toEqual({ version: '1.4.1', skip: false });
    expect(changelog.nextVersion('v1.4.0', ['whatever'])).toEqual({ version: '1.4.1', skip: false });
  });

  it('never carries a prerelease suffix forward and keeps the major', () => {
    const { version } = changelog.nextVersion('v1.3.2-beta', ['feat: a']);
    expect(version).toBe('1.4.0');
    expect(version).not.toMatch(/-/);
  });

  it('throws on a base that is not a version', () => {
    expect(() => changelog.nextVersion('nope', ['feat: a'])).toThrow(/not a version/);
  });
});

describe('categorize + renderSections', () => {
  const subjects = [
    'docs: align the chain (#39)',
    'feat(bench): refuse a dirty tree (#38)',
    'chore: add test.md (#36)',
    'fix: read Accept Cloning live (#34)',
    'perf: cache the chunk',
    'refactor: derive the separators',
    'Merge pull request #30 from x/y',
    'test: decouple the suite',
  ];

  it('groups by section in the fixed order and drops test/chore/merges', () => {
    const categories = changelog.categorize(subjects);
    expect(Object.keys(categories).sort()).toEqual(['Added', 'Changed', 'Documentation', 'Fixed']);
    expect(categories.Changed.map((c) => c.description)).toEqual(['cache the chunk', 'derive the separators']);

    const md = changelog.renderSections(categories);
    expect(md).toBe(
      [
        '### Added',
        '- refuse a dirty tree (#38)',
        '',
        '### Fixed',
        '- read Accept Cloning live (#34)',
        '',
        '### Changed',
        '- cache the chunk',
        '- derive the separators',
        '',
        '### Documentation',
        '- align the chain (#39)',
        '',
      ].join('\n'),
    );
  });

  it('omits empty sections and renders nothing for no player-facing commit', () => {
    expect(changelog.renderSections(changelog.categorize(['chore: x']))).toBe('');
    expect(changelog.renderSections(changelog.categorize(['fix: y']))).toBe('### Fixed\n- y\n');
  });

  it('generateMarkdownSection prefixes the Keep-a-Changelog heading', () => {
    const md = changelog.generateMarkdownSection('1.4.0', '2026-08-22', changelog.categorize(['fix: y']));
    expect(md.startsWith('## [1.4.0] - 2026-08-22\n\n### Fixed\n- y\n')).toBe(true);
  });

});

describe('the in-app changelog generator is retired', () => {
  const root = path.resolve(__dirname, '..', '..');

  it('release.yml no longer runs --json but still runs --next and --notes', () => {
    const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf-8');
    expect(workflow).not.toMatch(/changelog\.js\s+--json/);
    expect(workflow).toMatch(/changelog\.js\s+--next/);
    expect(workflow).toMatch(/changelog\.js\s+--notes/);
  });

  it('the module no longer exports jsonEntries or compareVersions', () => {
    expect(changelog).not.toHaveProperty('jsonEntries');
    expect(changelog).not.toHaveProperty('compareVersions');
  });

  it('src/client/changelog-data.json does not exist', () => {
    expect(fs.existsSync(path.join(root, 'src', 'client', 'changelog-data.json'))).toBe(false);
  });
});
