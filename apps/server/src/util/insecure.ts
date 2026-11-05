import { Agent } from 'undici';

let agent: Agent | undefined;

/** Shared undici dispatcher that skips certificate verification (`ignoreTls`). */
export const insecureDispatcher = (): Agent =>
  (agent ??= new Agent({ connect: { rejectUnauthorized: false } }));
