/** Pure helpers for scripts/release.ts and scripts/release-notes.ts, kept apart so they can be tested. */

const BUMPS = ['patch', 'minor', 'major'] as const;
type Bump = (typeof BUMPS)[number];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** The next version: `patch`, `minor` or `major` from `current`, or an exact version such as `1.2.0-beta.1`. */
export function nextVersion(current: string, arg: string): string {
  const now = SEMVER.exec(current);
  if (!now) throw new Error(`The current version ${current} is not a semantic version.`);
  if (!(BUMPS as readonly string[]).includes(arg)) {
    if (!SEMVER.test(arg))
      throw new Error(`Use patch, minor, major or an exact version like 1.2.0, not "${arg}".`);
    return arg;
  }
  const [major, minor, patch] = [Number(now[1]), Number(now[2]), Number(now[3])];
  // A prerelease of the same core becomes that release, like npm's `semver.inc`.
  const pre = now[4] !== undefined;
  switch (arg as Bump) {
    case 'major':
      return pre && minor === 0 && patch === 0 ? `${major}.0.0` : `${major + 1}.0.0`;
    case 'minor':
      return pre && patch === 0 ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`;
    case 'patch':
      return pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
  }
}

/** Whether `a` is a newer version than `b`; a release is newer than its own prereleases. */
export function isNewer(a: string, b: string): boolean {
  const [pa, pb] = [SEMVER.exec(a), SEMVER.exec(b)];
  if (!pa || !pb) return false;
  for (const i of [1, 2, 3]) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d > 0;
  }
  if (pa[4] === pb[4]) return false;
  if (pa[4] === undefined) return true;
  if (pb[4] === undefined) return false;
  return pa[4].localeCompare(pb[4], undefined, { numeric: true }) > 0;
}

/** `package.json` text with its top-level `"version"` replaced, keeping the rest byte for byte. */
export function setPackageVersion(json: string, version: string): string {
  const next = json.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`);
  if (next === json && !json.includes(`"version": "${version}"`))
    throw new Error('package.json has no "version" field.');
  return next;
}

/**
 * The CHANGELOG.md section of `tag` (`v1.2.3`), without its heading, for the GitHub release body.
 * git-cliff writes `## [1.2.3] - 2026-11-10`; the section ends at the next `## `.
 */
export function releaseNotes(changelog: string, tag: string): string {
  const version = tag.replace(/^v/, '');
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
  return body || 'Maintenance release.';
}
