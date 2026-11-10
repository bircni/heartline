import { describe, expect, it } from 'vitest';
import { isNewer, nextVersion, releaseNotes, setPackageVersion } from './release-lib.ts';

describe('nextVersion', () => {
  it('bumps patch, minor and major', () => {
    expect(nextVersion('0.1.0', 'patch')).toBe('0.1.1');
    expect(nextVersion('0.1.3', 'minor')).toBe('0.2.0');
    expect(nextVersion('0.9.3', 'major')).toBe('1.0.0');
  });

  it('turns a prerelease into its release', () => {
    expect(nextVersion('1.0.0-beta.2', 'major')).toBe('1.0.0');
    expect(nextVersion('1.2.0-rc.1', 'minor')).toBe('1.2.0');
    expect(nextVersion('1.2.3-rc.1', 'patch')).toBe('1.2.3');
  });

  it('takes an exact version and rejects anything else', () => {
    expect(nextVersion('0.1.0', '1.0.0-beta.1')).toBe('1.0.0-beta.1');
    expect(() => nextVersion('0.1.0', 'v1.0')).toThrow(/patch, minor, major/);
  });
});

describe('isNewer', () => {
  it('compares versions and prereleases', () => {
    expect(isNewer('0.2.0', '0.1.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0-rc.1')).toBe(true);
    expect(isNewer('1.0.0-rc.10', '1.0.0-rc.9')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
  });
});

describe('setPackageVersion', () => {
  it('changes only the version', () => {
    const json = '{\n  "name": "x",\n  "version": "0.1.0",\n  "dependencies": { "y": "0.1.0" }\n}\n';
    expect(setPackageVersion(json, '0.2.0')).toBe(json.replace('"version": "0.1.0"', '"version": "0.2.0"'));
  });
});

describe('releaseNotes', () => {
  const changelog = `# Changelog

## [0.2.0] - 2026-11-10

### Features

- **web:** One sidebar

## [0.1.0] - 2026-10-01

### Bug Fixes

- Something
`;

  it('returns the section of a tag without its heading', () => {
    expect(releaseNotes(changelog, 'v0.2.0')).toBe('### Features\n\n- **web:** One sidebar');
    expect(releaseNotes(changelog, 'v0.1.0')).toBe('### Bug Fixes\n\n- Something');
  });

  it('fails when the tag has no section', () => {
    expect(() => releaseNotes(changelog, 'v9.9.9')).toThrow(/no section for 9.9.9/);
  });
});
