type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level | undefined) ?? 'info'] ?? ORDER.info;
const json = process.env.LOG_FORMAT === 'json';

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < threshold) return;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (json) {
    stream.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`);
    return;
  }
  const extra = fields
    ? ` ${Object.entries(fields)
        .map(
          ([k, v]) =>
            `${k}=${v instanceof Error ? v.message : typeof v === 'string' ? v : JSON.stringify(v)}`,
        )
        .join(' ')}`
    : '';
  stream.write(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}${extra}\n`);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};
