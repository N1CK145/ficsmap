import { changelogSection, checkRelease } from '../../scripts/release.js';

const CHANGELOG = `# Changelog

All notable changes.

## [0.2.0] - 2026-11-20

### Added
- Route export.

## [0.1.0] - 2026-11-03

First public release.
`;

describe('changelogSection', () => {
  it('returns the body of a version section up to the next one', () => {
    expect(changelogSection(CHANGELOG, '0.2.0')).toBe('### Added\n- Route export.');
    expect(changelogSection(CHANGELOG, '0.1.0')).toBe('First public release.');
  });

  it('skips an Unreleased section above the versions', () => {
    const withUnreleased = CHANGELOG.replace('## [0.2.0]', '## [Unreleased]\n\n### Added\n- Admins.\n\n## [0.2.0]');
    expect(changelogSection(withUnreleased, '0.2.0')).toBe('### Added\n- Route export.');
    expect(checkRelease({ version: '0.2.0', latestTag: 'v0.1.0', changelog: withUnreleased })).toEqual([]);
  });

  it('is null for a missing or empty section', () => {
    expect(changelogSection(CHANGELOG, '0.3.0')).toBeNull();
    expect(changelogSection('## [0.4.0] - 2026-12-01\n\n## [0.3.0]\nx', '0.4.0')).toBeNull();
  });
});

describe('checkRelease', () => {
  it('accepts a version above the latest release with a CHANGELOG section', () => {
    expect(checkRelease({ version: '0.2.0', latestTag: 'v0.1.0', changelog: CHANGELOG })).toEqual([]);
    expect(checkRelease({ version: '0.1.0', latestTag: null, changelog: CHANGELOG })).toEqual([]);
  });

  it('names what is missing', () => {
    expect(checkRelease({ version: '0.1.0', latestTag: 'v0.1.0', changelog: CHANGELOG }).join('\n')).toMatch(/not above the latest release v0\.1\.0/);
    expect(checkRelease({ version: '0.3.0', latestTag: 'v0.2.0', changelog: CHANGELOG }).join('\n')).toMatch(/no "## \[0\.3\.0\]" section/);
    expect(checkRelease({ version: '0.3', latestTag: null, changelog: CHANGELOG }).join('\n')).toMatch(/not a version/);
  });
});
