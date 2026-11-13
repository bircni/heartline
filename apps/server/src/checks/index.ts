import { type MonitorSpec, findProvider } from '@heartline/shared';
import { checkHttp } from './http.ts';
import { checkDns, checkIcmp, checkTcp, checkTls } from './network.ts';
import type { PluginRegistry } from './plugins.ts';
import { checkProvider } from './provider.ts';
import type { CheckOutcome } from './types.ts';

export async function runCheck(
  spec: MonitorSpec,
  plugins: PluginRegistry,
  parent?: AbortSignal,
): Promise<CheckOutcome> {
  // Plugins enforce their own timeout (manifest vs. monitor), everything else uses the monitor timeout.
  const signal =
    spec.type === 'plugin'
      ? (parent ?? new AbortController().signal)
      : AbortSignal.any([AbortSignal.timeout(spec.timeout), ...(parent ? [parent] : [])]);
  switch (spec.type) {
    case 'http':
      return checkHttp(spec, signal);
    case 'tcp':
      return checkTcp(spec, signal);
    case 'dns':
      return checkDns(spec, signal);
    case 'tls':
      return checkTls(spec, signal);
    case 'icmp':
      return checkIcmp(spec, signal);
    case 'plugin':
      return plugins.run(spec, signal);
    case 'provider':
      return checkProvider(spec, signal);
  }
}

export function describeTarget(spec: MonitorSpec): string {
  switch (spec.type) {
    case 'http':
      return spec.url;
    case 'tcp':
    case 'tls':
      return `${spec.host}:${spec.port}`;
    case 'dns':
      return `${spec.host} (${spec.record}${spec.server ? ` @${spec.server}` : ''})`;
    case 'icmp':
      return spec.host;
    case 'plugin':
      return [spec.plugin, ...Object.entries(spec.args).map(([k, v]) => `${k}=${v}`)].join(' ');
    case 'provider': {
      const preset = findProvider(spec.provider);
      const where = spec.url ?? preset?.homepage ?? preset?.name ?? spec.provider;
      return spec.components.length ? `${where} (${spec.components.join(', ')})` : where;
    }
  }
}
