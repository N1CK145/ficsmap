import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { compareVersions, isVersion } from '../src/shared/version.js';

/*
 * Release helpers for CI (.github/workflows): the version is bumped by hand in package.json and
 * every version needs a "## [X.Y.Z] - YYYY-MM-DD" section in CHANGELOG.md.
 *   tsx scripts/release.ts notes            prints the section of the current version (fails without one)
 *   tsx scripts/release.ts check <tag|"">   fails unless the version is above the latest release tag and has a section
 */

/** The body of `## [version]` up to the next `## ` heading, trimmed; null when missing or empty. */
export function changelogSection(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(l => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body === '' ? null : body;
}

/** Problems that block releasing `version`; empty when it is fine. */
export function checkRelease(o: { version: string; latestTag: string | null; changelog: string }): string[] {
  if (!isVersion(o.version)) return [`package.json version "${o.version}" is not a version (X.Y.Z)`];
  const problems: string[] = [];
  const latest = o.latestTag?.replace(/^v/, '');
  if (latest && isVersion(latest) && compareVersions(o.version, latest) <= 0) {
    problems.push(`version ${o.version} is not above the latest release ${o.latestTag}: bump it in package.json`);
  }
  if (changelogSection(o.changelog, o.version) === null) problems.push(`CHANGELOG.md has no "## [${o.version}]" section (or it is empty)`);
  return problems;
}

function main(): void {
  const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  const [cmd, tag] = process.argv.slice(2);
  if (cmd === 'notes') {
    const section = changelogSection(changelog, version);
    if (section === null) {
      console.error(`CHANGELOG.md has no "## [${version}]" section`);
      process.exit(1);
    }
    console.log(section);
  } else if (cmd === 'check') {
    const problems = checkRelease({ version, latestTag: tag ? tag : null, changelog });
    for (const p of problems) console.error(`::error::${p}`);
    if (problems.length > 0) process.exit(1);
    console.log(`ok: ${version} can be released`);
  } else {
    console.error('usage: tsx scripts/release.ts notes | check <latest-tag>');
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
