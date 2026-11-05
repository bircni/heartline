import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CheckStatus, MonitorSpec, PluginDto } from '@heartline/shared';
import { duration } from '@heartline/shared';
import { parse } from 'yaml';
import { z } from 'zod';
import { cleanVersion } from '../software/version.ts';
import { log } from '../util/log.ts';
import { type CheckOutcome, down, errorMessage } from './types.ts';

const manifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  description: z.string().optional(),
  /** Executable and fixed leading arguments, run without a shell, cwd = plugin directory. */
  command: z.array(z.string().min(1)).min(1),
  timeout: duration.default(30_000),
  args: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]*$/i),
      z.object({
        type: z.enum(['string', 'number', 'boolean']).default('string'),
        required: z.boolean().default(false),
        default: z.union([z.string(), z.number(), z.boolean()]).optional(),
        description: z.string().optional(),
      }),
    )
    .default({}),
});

export interface Plugin extends z.output<typeof manifestSchema> {
  dir: string;
}

const resultSchema = z.object({
  status: z.enum(['up', 'degraded', 'down']).optional(),
  latency_ms: z.number().nonnegative().optional(),
  message: z.string().max(2000).optional(),
  /** Running version of the checked software, e.g. "16.2". */
  version: z.string().max(100).optional(),
});

export class PluginRegistry {
  #plugins = new Map<string, Plugin>();
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  async load(): Promise<void> {
    const next = new Map<string, Plugin>();
    let entries: string[] = [];
    try {
      entries = (await readdir(this.dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const entry of entries) {
      const dir = resolve(this.dir, entry);
      try {
        const manifest = manifestSchema.parse(parse(await readFile(join(dir, 'plugin.yaml'), 'utf8')));
        next.set(manifest.name, { ...manifest, dir });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        log.warn('ignoring invalid plugin', { dir, error: errorMessage(error) });
      }
    }
    this.#plugins = next;
  }

  get(name: string): Plugin | undefined {
    return this.#plugins.get(name);
  }

  list(): PluginDto[] {
    return [...this.#plugins.values()].map((p) => ({
      name: p.name,
      description: p.description ?? null,
      args: Object.fromEntries(
        Object.entries(p.args).map(([k, a]) => [
          k,
          { type: a.type, required: a.required, description: a.description ?? null },
        ]),
      ),
    }));
  }

  /** Validates monitor args against the plugin manifest and returns the resolved environment. */
  resolveArgs(plugin: Plugin, args: Record<string, string | number | boolean>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, def] of Object.entries(plugin.args)) {
      const value = args[name] ?? def.default;
      if (value === undefined) {
        if (def.required) throw new Error(`plugin ${plugin.name}: missing required arg "${name}"`);
        continue;
      }
      if (def.type === 'number' && Number.isNaN(Number(value)))
        throw new Error(`plugin ${plugin.name}: arg "${name}" must be a number`);
      env[`STATUS_ARG_${name.toUpperCase()}`] = String(value);
    }
    const unknown = Object.keys(args).filter((k) => !(k in plugin.args));
    if (unknown.length) throw new Error(`plugin ${plugin.name}: unknown args ${unknown.join(', ')}`);
    return env;
  }

  async run(spec: Extract<MonitorSpec, { type: 'plugin' }>, signal: AbortSignal): Promise<CheckOutcome> {
    const plugin = this.get(spec.plugin);
    if (!plugin) return down(`plugin "${spec.plugin}" is not installed`);
    let argEnv: Record<string, string>;
    try {
      argEnv = this.resolveArgs(plugin, spec.args);
    } catch (error) {
      return down(errorMessage(error));
    }
    return runPlugin(plugin, argEnv, Math.min(spec.timeout, plugin.timeout), signal, spec.id);
  }
}

const EXIT_STATUS: Record<number, CheckStatus> = { 0: 'up', 1: 'down', 2: 'degraded' };
const MAX_OUTPUT = 64 * 1024;

export function interpretPluginOutput(
  code: number | null,
  stdout: string,
  stderr: string,
  elapsed: number,
): CheckOutcome {
  let status: CheckStatus =
    code !== null && code in EXIT_STATUS ? (EXIT_STATUS[code] as CheckStatus) : 'down';
  let latency: number | null = elapsed;
  let message: string | null = null;
  let version: string | undefined;
  const lastLine = stdout.trim().split('\n').at(-1) ?? '';
  if (lastLine.startsWith('{')) {
    try {
      const parsed = resultSchema.parse(JSON.parse(lastLine));
      if (parsed.status) status = parsed.status;
      if (parsed.latency_ms !== undefined) latency = Math.round(parsed.latency_ms);
      if (parsed.message) message = parsed.message;
      if (parsed.version) version = cleanVersion(parsed.version) || undefined;
    } catch {
      message = 'plugin printed invalid JSON';
    }
  } else if (lastLine) {
    message = lastLine.slice(0, 500);
  }
  if (!message && status !== 'up') {
    message =
      stderr.trim().split('\n').at(-1)?.slice(0, 500) ||
      (code === null ? 'plugin was killed' : `exit code ${code}`);
  }
  return version === undefined
    ? { status, latencyMs: latency, message }
    : { status, latencyMs: latency, message, version };
}

function runPlugin(
  plugin: Plugin,
  argEnv: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal,
  monitorId: string,
): Promise<CheckOutcome> {
  const started = performance.now();
  const [cmd, ...fixedArgs] = plugin.command as [string, ...string[]];
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, fixedArgs, {
      cwd: plugin.dir,
      // Plugins see a minimal environment: their args plus PATH/HOME/LANG, never the server's secrets.
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: process.env.HOME ?? '/tmp',
        LANG: 'C.UTF-8',
        STATUS_MONITOR_ID: monitorId,
        ...argEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString();
    });
    let settled = false;
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      const elapsed = Math.round(performance.now() - started);
      resolvePromise(
        down(error.name === 'AbortError' ? `timed out after ${timeoutMs} ms` : errorMessage(error), elapsed),
      );
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      resolvePromise(interpretPluginOutput(code, stdout, stderr, Math.round(performance.now() - started)));
    });
  });
}
