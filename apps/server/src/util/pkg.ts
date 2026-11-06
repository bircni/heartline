import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../../package.json') as { name: string; version: string };

/** Name and version of the running server (from apps/server/package.json). */
export const APP_NAME = 'heartline';
export const APP_VERSION: string = pkg.version;
export const USER_AGENT = `heartline/${APP_VERSION} (+https://github.com/bircni/heartline)`;
