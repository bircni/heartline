import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

type ProxyEnv = Record<string, string | undefined>;

/** Loopback targets always connect directly, whatever NO_PROXY says. */
const LOOPBACK = ['localhost', '127.0.0.1', '::1'];

const pick = (env: ProxyEnv, name: string) => env[name.toLowerCase()] || env[name] || undefined;

/** True when HTTP_PROXY or HTTPS_PROXY (either case) is set. */
export const proxyConfigured = (env: ProxyEnv = process.env): boolean =>
  Boolean(pick(env, 'HTTPS_PROXY') || pick(env, 'HTTP_PROXY'));

/**
 * An undici dispatcher that routes requests through HTTP(S)_PROXY, honouring NO_PROXY plus the
 * loopback hosts, or undefined when no proxy is configured. `insecure` skips certificate
 * verification of the target (direct and tunnelled), not of the proxy itself.
 */
export function createProxyDispatcher(
  env: ProxyEnv = process.env,
  opts: { insecure?: boolean } = {},
): EnvHttpProxyAgent | undefined {
  if (!proxyConfigured(env)) return undefined;
  const tls = opts.insecure ? { rejectUnauthorized: false } : undefined;
  return new EnvHttpProxyAgent({
    httpProxy: pick(env, 'HTTP_PROXY'),
    httpsProxy: pick(env, 'HTTPS_PROXY'),
    noProxy: [pick(env, 'NO_PROXY'), ...LOOPBACK].filter(Boolean).join(','),
    ...(tls && { connect: tls, requestTls: tls }),
  });
}

/**
 * Installs the proxy dispatcher as undici's global dispatcher, which Node's global fetch shares,
 * so HTTP checks, provider status pages, software sources and notifiers use the proxy.
 * Importing the undici package otherwise leaves a plain dispatcher that ignores proxy variables.
 */
export function installProxyDispatcher(env: ProxyEnv = process.env): boolean {
  const dispatcher = createProxyDispatcher(env);
  if (!dispatcher) return false;
  setGlobalDispatcher(dispatcher);
  return true;
}
