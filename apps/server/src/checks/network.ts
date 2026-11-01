import { spawn } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { MonitorSpec } from '@heartline/shared';
import { type CheckOutcome, down, errorMessage, up, withLatencyThreshold } from './types.ts';

type Spec<T extends MonitorSpec['type']> = Extract<MonitorSpec, { type: T }>;

export function checkTcp(spec: Spec<'tcp'>, signal: AbortSignal): Promise<CheckOutcome> {
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = netConnect({ host: spec.host, port: spec.port, signal });
    socket.once('connect', () => {
      const latency = Math.round(performance.now() - started);
      socket.destroy();
      resolve(withLatencyThreshold(up(latency, 'connected'), spec.degradedAfter));
    });
    socket.once('error', (error) => {
      socket.destroy();
      resolve(down(errorMessage(error), Math.round(performance.now() - started)));
    });
  });
}

export async function checkDns(spec: Spec<'dns'>, signal: AbortSignal): Promise<CheckOutcome> {
  const resolver = new Resolver({ timeout: spec.timeout, tries: 1 });
  if (spec.server) resolver.setServers([spec.server]);
  const abort = () => resolver.cancel();
  signal.addEventListener('abort', abort, { once: true });
  const started = performance.now();
  try {
    const raw = await resolver.resolve(spec.host, spec.record);
    const latency = Math.round(performance.now() - started);
    const answers = (raw as unknown[]).map((a) => {
      if (typeof a === 'string') return a;
      if (Array.isArray(a)) return a.join('');
      const rec = a as { exchange?: string; name?: string };
      return rec.exchange ?? rec.name ?? JSON.stringify(a);
    });
    if (answers.length === 0) return down('no records', latency);
    if (spec.expect?.length) {
      const missing = spec.expect.filter((e) => !answers.includes(e));
      if (missing.length) return down(`missing ${missing.join(', ')} (got ${answers.join(', ')})`, latency);
    }
    return withLatencyThreshold(up(latency, `${spec.record} ${answers.join(', ')}`), spec.degradedAfter);
  } catch (error) {
    return down(errorMessage(error), Math.round(performance.now() - started));
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export function checkTls(spec: Spec<'tls'>, signal: AbortSignal): Promise<CheckOutcome> {
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = tlsConnect({
      host: spec.host,
      port: spec.port,
      servername: spec.servername ?? spec.host,
      rejectUnauthorized: false,
    });
    const onAbort = () => socket.destroy(new Error('timed out'));
    signal.addEventListener('abort', onAbort, { once: true });
    socket.once('close', () => signal.removeEventListener('abort', onAbort));
    socket.once('secureConnect', () => {
      const latency = Math.round(performance.now() - started);
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      const authError = socket.authorizationError;
      socket.destroy();
      if (!cert?.valid_to) return resolve(down('no certificate presented', latency));
      const daysLeft = Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86_400_000);
      if (daysLeft < 0) return resolve(down(`certificate expired ${-daysLeft} days ago`, latency));
      if (!authorized) return resolve(down(`certificate not trusted: ${String(authError)}`, latency));
      const msg = `certificate valid, ${daysLeft} days left`;
      if (daysLeft < spec.minDays) return resolve({ status: 'degraded', latencyMs: latency, message: msg });
      resolve(up(latency, msg));
    });
    socket.once('error', (error) => {
      socket.destroy();
      resolve(down(errorMessage(error), Math.round(performance.now() - started)));
    });
  });
}

export function parsePingOutput(stdout: string): number | null {
  const m = stdout.match(/time[=<]\s*([\d.]+)\s*ms/);
  return m ? Math.round(Number(m[1])) : null;
}

export function checkIcmp(spec: Spec<'icmp'>, signal: AbortSignal): Promise<CheckOutcome> {
  const seconds = Math.max(1, Math.ceil(spec.timeout / 1000));
  const args =
    process.platform === 'darwin'
      ? ['-c', '1', '-t', String(seconds), spec.host]
      : ['-c', '1', '-W', String(seconds), spec.host];
  return new Promise((resolve) => {
    const child = spawn('ping', args, { signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.once('error', (error) => resolve(down(errorMessage(error))));
    child.once('close', (code) => {
      const latency = parsePingOutput(out);
      if (code === 0) resolve(withLatencyThreshold(up(latency, 'reply received'), spec.degradedAfter));
      else resolve(down(out.trim().split('\n').at(-1) || `ping exited with ${code}`, latency));
    });
  });
}
