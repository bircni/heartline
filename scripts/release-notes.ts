/**
 * Prints the CHANGELOG.md section of a tag, the body of its GitHub release.
 *
 *   node scripts/release-notes.ts v1.2.3 [CHANGELOG.md]
 */
import { readFileSync } from 'node:fs';
import { releaseNotes } from './release-lib.ts';

const [tag, file = 'CHANGELOG.md'] = process.argv.slice(2);
if (!tag) {
  console.error('usage: node scripts/release-notes.ts <tag> [changelog]');
  process.exit(2);
}
process.stdout.write(`${releaseNotes(readFileSync(file, 'utf8'), tag)}\n`);
