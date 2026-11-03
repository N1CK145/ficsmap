import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

/**
 * This build's version: `version` of the nearest package.json named "ficsmap" above this file
 * (src/server/version in dev, dist/server/src/server/version in the image, where /app/package.json is copied).
 */
export function appVersion(): string {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'ficsmap' && pkg.version) return (cached = pkg.version);
    }
    const up = dirname(dir);
    if (up === dir) throw new Error('package.json of ficsmap not found');
    dir = up;
  }
}

/** The GitHub release page of a version. */
export function releaseUrl(version: string): string {
  return `https://github.com/N1CK145/ficsmap/releases/tag/v${version}`;
}
