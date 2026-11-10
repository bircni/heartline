/**
 * Cuts a release from main: bumps the version, writes CHANGELOG.md, commits, tags and pushes.
 * The tag starts the release in CI (container image, then the GitHub release with the changelog).
 *
 *   pnpm release                 # patch
 *   pnpm release minor
 *   pnpm release 1.0.0-beta.1    # an exact version; a "-" makes it a prerelease
 *   pnpm release patch --dry-run # shows what would happen and what would stop it
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { isNewer, nextVersion, setPackageVersion } from './release-lib.ts';

const BRANCH = 'main';
const REMOTE = 'origin';
/** Every package carries the same version; the server reports the first one at /api/v1/version. */
const PACKAGES = ['apps/server/package.json', 'apps/web/package.json', 'packages/shared/package.json'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bumpArg = args.find((a) => !a.startsWith('--')) ?? 'patch';

/** Output of a command, or null when it fails; checks read failures as answers. */
function out(cmd: string, cmdArgs: string[]): string | null {
  try {
    return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/** Runs a step with the terminal attached, or prints it in a dry run. */
function run(cmd: string, cmdArgs: string[]): void {
  const pretty = [cmd, ...cmdArgs].join(' ');
  if (dryRun) {
    console.log(`[dry-run] ${pretty}`);
    return;
  }
  const res = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`Command failed: ${pretty}`);
}

const current = (JSON.parse(readFileSync(PACKAGES[0] as string, 'utf8')) as { version: string }).version;
const version = nextVersion(current, bumpArg);
const tag = `v${version}`;

/** Everything that would tag the wrong commit or fail halfway. */
function problems(): string[] {
  const found: string[] = [];
  if (!isNewer(version, current)) found.push(`${version} is not newer than the current ${current}.`);
  const branch = out('git', ['branch', '--show-current']);
  if (branch !== BRANCH)
    found.push(`Releases are cut from ${BRANCH}, but this is ${branch || 'a detached HEAD'}.`);
  if (out('git', ['status', '--porcelain']))
    found.push('The working tree is not clean. Commit or stash your changes first.');
  if (out('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`]) !== null)
    found.push(`Tag ${tag} already exists locally.`);
  for (const [tool, hint] of [
    ['git-cliff', 'brew install git-cliff'],
    ['gh', 'brew install gh'],
  ] as const)
    if (out(tool, ['--version']) === null) found.push(`${tool} is not installed (${hint}).`);

  const refs = out('git', ['ls-remote', REMOTE, `refs/heads/${BRANCH}`, `refs/tags/${tag}`]);
  if (refs === null) {
    found.push(`Could not read ${REMOTE}.`);
    return found;
  }
  if (refs.includes(`refs/tags/${tag}`)) found.push(`Tag ${tag} already exists on ${REMOTE}.`);
  const head = out('git', ['rev-parse', 'HEAD']);
  const remoteHead = refs
    .split('\n')
    .find((l) => l.endsWith(`refs/heads/${BRANCH}`))
    ?.split('\t')[0];
  if (remoteHead !== head) found.push(`HEAD is not in sync with ${REMOTE}/${BRANCH}; pull or push first.`);

  // The push to main already ran CI on this commit; release only what passed it.
  const runs = out('gh', [
    'run',
    'list',
    '--workflow',
    'ci.yml',
    '--commit',
    head ?? '',
    '--json',
    'status,conclusion',
  ]);
  const latest = runs ? (JSON.parse(runs) as { status: string; conclusion: string }[])[0] : undefined;
  if (!latest) found.push(`CI has not run on ${head?.slice(0, 7)} yet.`);
  else if (latest.status !== 'completed')
    found.push(`CI is still running on ${head?.slice(0, 7)}; wait for it.`);
  else if (latest.conclusion !== 'success') found.push(`CI ${latest.conclusion} on ${head?.slice(0, 7)}.`);
  return found;
}

const found = problems();
if (found.length > 0) {
  console.error(found.map((p) => `✗ ${p}`).join('\n'));
  if (!dryRun) process.exit(1);
}

console.log(`Releasing ${current} → ${version}${version.includes('-') ? ' (prerelease)' : ''}`);
for (const file of PACKAGES) {
  if (dryRun) console.log(`[dry-run] set "version": "${version}" in ${file}`);
  else writeFileSync(file, setPackageVersion(readFileSync(file, 'utf8'), version));
}
run('git-cliff', ['--config', '.cliff.toml', '--tag', tag, '--output', 'CHANGELOG.md']);
run('pnpm', ['exec', 'oxfmt', 'CHANGELOG.md']);
run('git', ['add', 'CHANGELOG.md', ...PACKAGES]);
run('git', ['commit', '-m', `chore(release): ${tag}`]);
run('git', ['tag', '-a', tag, '-m', tag]);
// Atomic: either both land or neither, so a tag never points at an unpushed commit.
run('git', ['push', '--atomic', REMOTE, BRANCH, tag]);
console.log(
  dryRun ? 'Dry run: nothing was changed.' : `Pushed ${tag}; CI publishes the image and the release.`,
);
