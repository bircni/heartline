import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteDialect } from '@better-auth/kysely-adapter/node-sqlite-dialect';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.ts';

export type DbKind = 'sqlite' | 'postgres';

export interface Db {
  kind: DbKind;
  kysely: Kysely<Database>;
  /** Present for Postgres; used for advisory-lock leader election. */
  pool: pg.Pool | null;
  close(): Promise<void>;
}

// int8 (bigint) columns hold millisecond timestamps, which fit safely in a JS number.
pg.types.setTypeParser(20, (v) => Number(v));
// numeric (e.g. avg()) is returned as text by default.
pg.types.setTypeParser(1700, (v) => Number(v));

export function openDb(url: string): Db {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const kysely = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    return { kind: 'postgres', kysely, pool, close: () => kysely.destroy() };
  }
  const path = url.replace(/^sqlite:(\/\/)?/, '');
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  const kysely = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database }) });
  return { kind: 'sqlite', kysely, pool: null, close: () => kysely.destroy() };
}
