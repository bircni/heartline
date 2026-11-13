import { PGlite, types } from '@electric-sql/pglite';
import type { AdminMonitor, GroupDto, Overview } from '@heartline/shared';
import { Kysely, PGliteDialect } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/load.ts';
import { type Db, openDb } from '../src/db/index.ts';
import { migrate, migrateTo } from '../src/db/migrations.ts';
import type { Database } from '../src/db/schema.ts';
import { ADMIN, type Harness, harness } from './helpers.ts';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const yaml = (groups: string) => `
site: { title: Groups, timezone: UTC }
groups:
${groups}
auth:
  users:
    - { email: ${ADMIN.email}, name: Admin, password: ${ADMIN.password}, role: admin }
`;

const TWO = yaml(`
  - name: Core services
    description: The important ones
    collapsed: true
    monitors:
      - { id: web, name: Website, type: tcp, host: 127.0.0.1, port: 1 }
      - { id: api, name: API, type: tcp, host: 127.0.0.1, port: 1 }
  - id: edge
    name: Edge
    hideUnlessDegraded: true
    monitors:
      - { id: cdn, name: CDN, type: tcp, host: 127.0.0.1, port: 1 }
`);

async function seedOldDatabase(db: Db) {
  await migrateTo(db.kysely, '0004_audit_rate_limits');
  const now = Date.now();
  const row = (id: string, group: string, source: 'config' | 'db', position: number) => ({
    id,
    group_name: group,
    name: id,
    type: 'tcp',
    spec: JSON.stringify({ id, name: id, type: 'tcp', host: '127.0.0.1', port: 1 }),
    source,
    position,
    paused: 0,
    created_at: now,
    updated_at: now,
  });
  await (db.kysely as Kysely<any>)
    .insertInto('monitors')
    .values([
      row('web', 'Core services', 'config', 0),
      row('api', 'Core services', 'config', 1),
      row('ui-only', 'Core services', 'db', 100_000),
      row('extra', 'Extra stuff', 'db', 100_001),
    ])
    .execute();
}

async function checkUpgrade(db: Db) {
  await seedOldDatabase(db);
  await migrate(db.kysely);
  const groups = await db.kysely.selectFrom('monitor_groups').selectAll().orderBy('position').execute();
  expect(groups.map((g) => [g.id, g.name, g.source])).toEqual([
    ['core-services', 'Core services', 'config'],
    ['extra-stuff', 'Extra stuff', 'db'],
  ]);
  const monitors = await db.kysely.selectFrom('monitors').select(['id', 'group_id']).orderBy('id').execute();
  expect(monitors).toEqual([
    { id: 'api', group_id: 'core-services' },
    { id: 'extra', group_id: 'extra-stuff' },
    { id: 'ui-only', group_id: 'core-services' },
    { id: 'web', group_id: 'core-services' },
  ]);
}

describe('groups migration', () => {
  it('turns group names into groups on SQLite', async () => {
    const db = openDb('sqlite::memory:');
    await checkUpgrade(db);
    // The first config load adopts the migrated group: same id, same monitors.
    h = await harness(
      yaml(`
  - name: Core services
    monitors:
      - { id: web, name: Website, type: tcp, host: 127.0.0.1, port: 1 }
      - { id: api, name: API, type: tcp, host: 127.0.0.1, port: 1 }
`),
      { db },
    );
    expect(h.runtime.monitors.require('ui-only').groupId).toBe('core-services');
    expect(h.runtime.groups.list().map((g) => g.id)).toEqual(['core-services', 'extra-stuff']);
  });

  it('turns group names into groups on Postgres', async () => {
    expect.hasAssertions();
    const pglite = new PGlite({ parsers: { [types.INT8]: (v: string) => Number(v) } });
    const kysely = new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) });
    const db: Db = { kind: 'postgres', kysely, pool: null, close: () => kysely.destroy() };
    await checkUpgrade(db);
    await db.close();
  }, 60_000);
});

describe('groups', () => {
  it('come from status.yaml with their settings, in file order, and roll up their services', async () => {
    h = await harness(TWO);
    const groups = h.runtime.groups.list();
    expect(groups.map((g) => [g.id, g.name, g.collapsed, g.hideUnlessDegraded, g.source])).toEqual([
      ['core-services', 'Core services', true, false, 'config'],
      ['edge', 'Edge', false, true, 'config'],
    ]);
    const web = h.runtime.monitors.require('web');
    const api = h.runtime.monitors.require('api');
    const t = Date.now();
    await h.runtime.engine.record(web, { status: 'up', latencyMs: 10, message: 'ok' }, t);
    await h.runtime.engine.record(api, { status: 'down', latencyMs: null, message: 'no' }, t);
    await h.runtime.engine.record(api, { status: 'down', latencyMs: null, message: 'no' }, t + 1);
    const o: Overview = await (await h.request('/api/v1/overview?days=2')).json();
    const core = o.groups[0]!;
    expect(core).toMatchObject({
      id: 'core-services',
      description: 'The important ones',
      collapsed: true,
      status: 'down',
    });
    expect(core.bars.at(-1)).toMatchObject({ checks: 3, state: 'down' });
    expect(core.uptime).toBeCloseTo(33.33, 1);
    expect(core.services.map((s) => [s.id, s.groupId])).toEqual([
      ['web', 'core-services'],
      ['api', 'core-services'],
    ]);
  });

  it('rejects two groups with the same id', () => {
    expect(() =>
      parseConfig(
        yaml(`
  - name: Core
  - name: core
`),
        {},
      ),
    ).toThrow(/share the id "core"/);
  });

  it('keep a group that left status.yaml while UI monitors still use it', async () => {
    h = await harness(TWO);
    const cookie = await h.login();
    const created = await h.request('/api/v1/admin/monitors', {
      method: 'POST',
      cookie,
      json: { groupId: 'edge', spec: { id: 'dns', name: 'DNS', type: 'tcp', host: '127.0.0.1', port: 1 } },
    });
    expect(created.status).toBe(201);
    await h.runtime.applyConfig(
      parseConfig(
        yaml(`
  - name: Renamed core
    id: core-services
    monitors:
      - { id: web, name: Website, type: tcp, host: 127.0.0.1, port: 1 }
`),
        {},
      ),
    );
    expect(h.runtime.groups.list().map((g) => [g.id, g.name, g.source])).toEqual([
      ['core-services', 'Renamed core', 'config'],
      ['edge', 'Edge', 'db'],
    ]);
    expect(h.runtime.monitors.get('cdn')).toBeUndefined();
    expect(h.runtime.monitors.require('dns').group).toBe('Edge');
  });

  it('are managed through the admin API', async () => {
    h = await harness(TWO);
    const cookie = await h.login();
    const req = (path: string, method: string, json?: unknown) =>
      h!.request(`/api/v1/admin${path}`, { method, cookie, json });

    // A monitor naming a new group creates it; an existing name or id reuses it.
    const m: AdminMonitor = await (
      await req('/monitors', 'POST', {
        group: 'Office',
        spec: { id: 'printer', name: 'Printer', type: 'tcp', host: 'p', port: 1 },
      })
    ).json();
    expect(m.groupId).toBe('office');
    expect(
      (
        await req('/monitors', 'POST', {
          group: 'office',
          spec: { id: 'nas', name: 'NAS', type: 'tcp', host: 'n', port: 1 },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await req('/monitors', 'POST', {
          groupId: 'nope',
          spec: { id: 'x', name: 'X', type: 'tcp', host: 'x', port: 1 },
        })
      ).status,
    ).toBe(400);
    expect(
      (await req('/monitors', 'POST', { spec: { id: 'y', name: 'Y', type: 'tcp', host: 'y', port: 1 } }))
        .status,
    ).toBe(400);

    const lab: GroupDto = await (
      await req('/groups', 'POST', { name: 'Lab', description: 'Experiments' })
    ).json();
    expect(lab).toMatchObject({ id: 'lab', source: 'db', description: 'Experiments' });
    expect((await req('/groups', 'POST', { id: 'lab', name: 'Lab again' })).status).toBe(409);
    const edited: GroupDto = await (await req('/groups/lab', 'PUT', { name: 'Lab', collapsed: true })).json();
    expect(edited.collapsed).toBe(true);
    expect((await req('/groups/core-services', 'PUT', { name: 'X' })).status).toBe(409);
    expect((await req('/groups/office', 'DELETE')).status).toBe(409);

    const order: GroupDto[] = await (await req('/groups/order', 'PUT', { ids: ['lab', 'office'] })).json();
    expect(order.map((g) => g.id)).toEqual(['core-services', 'edge', 'lab', 'office']);
    expect((await req('/groups/order', 'PUT', { ids: ['edge'] })).status).toBe(409);

    expect((await req('/groups/lab', 'DELETE')).status).toBe(204);
    const audit = await (await req('/audit?entityType=group', 'GET')).json();
    expect(audit.map((e: { action: string }) => e.action)).toEqual([
      'group.delete',
      'group.reorder',
      'group.update',
      'group.create',
      'group.create',
    ]);
  });
});
