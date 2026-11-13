import { Agent, type Dispatcher } from 'undici';
import { createProxyDispatcher } from './proxy.ts';

let agent: Dispatcher | undefined;

/** Shared undici dispatcher that skips certificate verification (`ignoreTls`), proxy-aware. */
export const insecureDispatcher = (): Dispatcher =>
  (agent ??=
    createProxyDispatcher(process.env, { insecure: true }) ??
    new Agent({ connect: { rejectUnauthorized: false } }));
