/** This build's product version, e.g. "0.1.0" (package.json, bumped by hand). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

/** The GitHub repository. */
export const REPO_URL = 'https://github.com/N1CK145/ficsmap';

/** The GitHub release page of this version. */
export const RELEASE_URL = `${REPO_URL}/releases/tag/v${APP_VERSION}`;
