import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { type AppConfig, configSchema } from './schema.ts';

export class ConfigError extends Error {}

/** Replaces `${VAR}` and `${VAR:-default}` in all string values. Missing variables are an error. */
export function interpolateEnv(value: unknown, env: NodeJS.ProcessEnv, path = ''): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/gi, (_, name: string, fallback?: string) => {
      const v = env[name];
      if (v !== undefined && v !== '') return v;
      if (fallback !== undefined) return fallback;
      throw new ConfigError(`environment variable ${name} is not set (used at ${path || 'root'})`);
    });
  }
  if (Array.isArray(value)) return value.map((v, i) => interpolateEnv(v, env, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolateEnv(v, env, path ? `${path}.${k}` : k)]),
    );
  }
  return value;
}

export function parseConfig(text: string, env: NodeJS.ProcessEnv = process.env): AppConfig {
  let raw: unknown;
  try {
    raw = parse(text) ?? {};
  } catch (error) {
    throw new ConfigError(`status.yaml is not valid YAML: ${(error as Error).message}`);
  }
  const result = configSchema.safeParse(interpolateEnv(raw, env));
  if (!result.success) {
    throw new ConfigError(`status.yaml is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export async function loadConfig(path: string, env: NodeJS.ProcessEnv = process.env): Promise<AppConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ConfigError(`config file not found: ${path} (set CONFIG_PATH)`);
    }
    throw error;
  }
  return parseConfig(text, env);
}
