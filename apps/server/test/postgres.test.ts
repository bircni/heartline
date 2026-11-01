import { PGlite, types } from '@electric-sql/pglite';
import type { Overview } from '@heartline/shared';
import { Kysely, PGliteDialect } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/index.ts';
import { openDb } from '../src/db/index.ts';
import type { Database } from '../src/db/schema.ts';
import { harness } from './helpers.ts';

/** The same scenario against any Postgres: migrations, upserts, bigint timestamps, auth tables. */
async function exercise(db: Db) {
  const h = await harness(undefined, { db });
  try {
    const web = h.runtime.monitors.require('web');
    const t = Date.now();
    await h.runtime.engine.record(web, { status: 'up', latencyMs: 120, message: 'ok' }, t);
    await h.runtime.engine.record(web, { status: 'down', latencyMs: null, message: 'HTTP 502' }, t + 1);
    await h.runtime.engine.record(web, { status: 'down', latencyMs: null, message: 'HTTP 502' }, t + 2);
    await h.runtime.engine.refreshPercentiles([new Date(t).toISOString().slice(0, 10)]);
    const o = (await (await h.request('/api/v1/overview?days=3')).json()) as Overview;
    const bar = o.groups[0]?.services[0]?.bars.at(-1);
    expect(o.status).toBe('down');
    expect(bar).toMatchObject({ checks: 3, avgLatencyMs: 120, p95LatencyMs: 120 });
    const detail = await (await h.request('/api/v1/services/web?days=7')).json();
    expect(detail.series).toEqual([expect.objectContaining({ avgLatencyMs: 120, highLatencyMs: 120 })]);
    expect(
      typeof (await db.kysely.selectFrom('check_results').select('checked_at').executeTakeFirstOrThrow())
        .checked_at,
    ).toBe('number');
    const cookie = await h.login();
    const tok = await h.request('/api/v1/admin/tokens', {
      method: 'POST',
      cookie,
      json: { name: 'pg', scopes: ['read'] },
    });
    expect(tok.status).toBe(201);
  } finally {
    await h.close();
  }
}

describe('postgres (PGlite)', () => {
  it('runs migrations and the status flow', async () => {
    expect.hasAssertions();
    const pglite = new PGlite({
      parsers: { [types.INT8]: (v: string) => Number(v), [types.NUMERIC]: (v: string) => Number(v) },
    });
    const kysely = new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) });
    await exercise({ kind: 'postgres', kysely, pool: null, close: () => kysely.destroy() });
  }, 60_000);
});

const docker = await import('testcontainers')
  .then((m) => m.getContainerRuntimeClient())
  .then(
    () => true,
    () => false,
  );

describe.skipIf(!docker)('postgres (container)', () => {
  it('works against real Postgres and elects exactly one scheduler leader', async () => {
    expect.hasAssertions();
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgres:18-alpine').start();
    try {
      await exercise(openDb(container.getConnectionUri()));
      const a = await harness(undefined, { db: openDb(container.getConnectionUri()) });
      const b = await harness(undefined, { db: openDb(container.getConnectionUri()) });
      try {
        await a.runtime.scheduler.start();
        await b.runtime.scheduler.start();
        expect([a.runtime.scheduler.isLeader, b.runtime.scheduler.isLeader].filter(Boolean)).toHaveLength(1);
      } finally {
        await a.close();
        await b.close();
      }
    } finally {
      await container.stop();
    }
  }, 180_000);
});
