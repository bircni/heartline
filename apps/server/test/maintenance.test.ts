import type { Maintenance } from '@heartline/shared';
import type { Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.ts';
import { migrate, migrateTo } from '../src/db/migrations.ts';
import { MaintenanceService } from '../src/services/maintenance.ts';
import { type Harness, harness } from './helpers.ts';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Titles of the maintenance messages sent to the Teams stub, in order. */
const sentTitles = () =>
  h!.sent.map(
    (m) =>
      (m.body as { attachments: { content: { body: { text: string }[] } }[] }).attachments[0]!.content
        .body[0]!.text,
  );

async function setup() {
  h = await harness();
  const cookie = await h.login();
  const req = (path: string, method = 'GET', body?: unknown) =>
    h!.request(`/api/v1${path}`, { method, cookie, json: body });
  return { req, m: h.runtime.maintenance };
}

describe('maintenance lifecycle', () => {
  it('reminds, starts and completes a one-off window once each', async () => {
    const { req, m } = await setup();
    const t0 = Date.now();
    const start = t0 + 2 * HOUR;
    const w: Maintenance = await (
      await req('/admin/maintenance', 'POST', {
        title: 'DB upgrade',
        description: 'Writes **pause** briefly.',
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + HOUR).toISOString(),
        services: ['web'],
      })
    ).json();
    expect(w).toMatchObject({ status: 'scheduled', active: false, updates: [] });
    expect(sentTitles()).toEqual(['Maintenance scheduled: DB upgrade']);

    await m.tick(start - 2 * HOUR + MIN); // too early for the reminder
    await m.tick(start - 30 * MIN);
    await m.tick(start - 29 * MIN);
    await m.tick(start + MIN);
    expect(m.get(w.id, start + MIN)).toMatchObject({ status: 'in_progress', active: true });
    expect(m.isActive('web', start + MIN)).toBe(true);
    await m.tick(start + 2 * MIN);
    await m.tick(start + HOUR + MIN);
    await m.tick(start + HOUR + 2 * MIN);
    const done = m.get(w.id, start + HOUR + 2 * MIN);
    expect(done).toMatchObject({ status: 'completed', completedAt: start + HOUR, active: false });
    expect(done.updates.map((u) => u.status)).toEqual(['completed', 'in_progress']);
    expect(sentTitles()).toEqual([
      'Maintenance scheduled: DB upgrade',
      'Maintenance starts soon: DB upgrade',
      'Maintenance started: DB upgrade',
      'Maintenance completed: DB upgrade',
    ]);

    // Completed windows take no more updates and are listed as past.
    expect(
      (await req(`/admin/maintenance/${w.id}/updates`, 'POST', { status: 'verifying', message: 'x' })).status,
    ).toBe(409);
  });

  it('takes manual updates, completes at the planned end even while verifying, and ends early by hand', async () => {
    const { req, m } = await setup();
    const now = Date.now();
    const mk = async (title: string) =>
      (await (
        await req('/admin/maintenance', 'POST', {
          title,
          startsAt: new Date(now - MIN).toISOString(),
          endsAt: new Date(now + HOUR).toISOString(),
          notify: false,
        })
      ).json()) as Maintenance;
    const a = await mk('Verify me');
    await m.tick(now);
    const verifying: Maintenance = await (
      await req(`/admin/maintenance/${a.id}/updates`, 'POST', {
        status: 'verifying',
        message: 'Checking the result',
        notify: false,
      })
    ).json();
    expect(verifying.status).toBe('verifying');
    await m.tick(now + HOUR + MIN);
    expect(m.get(a.id, now + HOUR + MIN).status).toBe('completed');

    const b = await mk('Done early');
    await req(`/admin/maintenance/${b.id}/updates`, 'POST', {
      status: 'completed',
      message: 'All done',
      notify: false,
    });
    expect(m.get(b.id).active).toBe(false);
    expect(m.isActive('web')).toBe(false);
    expect(
      ((await (await req('/maintenance?state=past')).json()) as Maintenance[]).map((x) => x.title),
    ).toContain('Done early');
  });

  it('runs recurring windows by themselves and refuses manual updates on them', async () => {
    const { req, m } = await setup();
    const day = 24 * HOUR;
    const first = Math.ceil(Date.now() / day) * day + 2 * HOUR; // 02:00 UTC tomorrow
    const w: Maintenance = await (
      await req('/admin/maintenance', 'POST', {
        title: 'Nightly backup',
        startsAt: new Date(first).toISOString(),
        endsAt: new Date(first + 30 * MIN).toISOString(),
        recurrence: 'FREQ=DAILY',
        notify: false,
      })
    ).json();
    expect(
      (await req(`/admin/maintenance/${w.id}/updates`, 'POST', { status: 'verifying', message: 'x' })).status,
    ).toBe(409);
    for (const d of [0, 1]) {
      const s = first + d * day;
      await m.tick(s - 30 * MIN);
      await m.tick(s + MIN);
      await m.tick(s + 2 * MIN);
      expect(m.get(w.id, s + MIN)).toMatchObject({ status: 'in_progress', active: true });
      await m.tick(s + 31 * MIN);
      await m.tick(s + 32 * MIN);
    }
    expect(m.get(w.id, first + day + 40 * MIN)).toMatchObject({
      status: 'scheduled',
      nextStartsAt: first + 2 * day,
    });
    expect(sentTitles()).toEqual([
      'Maintenance starts soon: Nightly backup',
      'Maintenance started: Nightly backup',
      'Maintenance completed: Nightly backup',
      'Maintenance starts soon: Nightly backup',
      'Maintenance started: Nightly backup',
      'Maintenance completed: Nightly backup',
    ]);
    const audit = await (await req('/admin/audit?entityType=maintenance')).json();
    expect(audit.filter((e: { actor: { via: string } }) => e.actor.via === 'system')).toHaveLength(4);
  });

  it('notices a start or end late without notifying', async () => {
    const { req, m } = await setup();
    const now = Date.now();
    const w: Maintenance = await (
      await req('/admin/maintenance', 'POST', {
        title: 'Missed',
        startsAt: new Date(now + MIN).toISOString(),
        endsAt: new Date(now + 2 * MIN).toISOString(),
        notify: false,
      })
    ).json();
    await m.tick(now + HOUR);
    expect(m.get(w.id, now + HOUR).status).toBe('completed');
    expect(h!.sent).toEqual([]);
  });

  it('never runs a transition twice, even with two leaders on one database', async () => {
    const { req, m } = await setup();
    const other = new MaintenanceService(h!.runtime.db, h!.runtime.monitors, null);
    const now = Date.now();
    const w: Maintenance = await (
      await req('/admin/maintenance', 'POST', {
        title: 'Twice',
        startsAt: new Date(now + MIN).toISOString(),
        endsAt: new Date(now + HOUR).toISOString(),
        notify: false,
      })
    ).json();
    await Promise.all([m.tick(now + 2 * MIN), other.tick(now + 2 * MIN)]);
    await Promise.all([m.tick(now + HOUR + MIN), other.tick(now + HOUR + MIN)]);
    await m.reload(now + HOUR + MIN);
    expect(m.get(w.id, now + HOUR + MIN).updates.map((u) => u.status)).toEqual(['completed', 'in_progress']);
    expect(sentTitles()).toEqual(['Maintenance started: Twice', 'Maintenance completed: Twice']);
  });
});

describe('maintenance migration', () => {
  it('sets the status of one-off windows from their times', async () => {
    const db = openDb('sqlite::memory:');
    await migrateTo(db.kysely, '0006_incident_components');
    const now = Date.now();
    const row = (id: string, start: number, end: number, recurrence: string | null = null) => ({
      id,
      title: id,
      description: null,
      starts_at: start,
      ends_at: end,
      recurrence,
      created_at: now,
      created_by: null,
    });
    await (db.kysely as Kysely<any>)
      .insertInto('maintenances')
      .values([
        row('past', now - 2 * HOUR, now - HOUR),
        row('now', now - HOUR, now + HOUR),
        row('later', now + HOUR, now + 2 * HOUR),
        row('weekly', now - 30 * 86_400_000, now - 30 * 86_400_000 + HOUR, 'FREQ=WEEKLY'),
      ])
      .execute();
    await migrate(db.kysely);
    const rows = await db.kysely
      .selectFrom('maintenances')
      .select(['id', 'status', 'completed_at'])
      .orderBy('id')
      .execute();
    expect(rows).toEqual([
      { id: 'later', status: 'scheduled', completed_at: null },
      { id: 'now', status: 'in_progress', completed_at: null },
      { id: 'past', status: 'completed', completed_at: now - HOUR },
      { id: 'weekly', status: 'scheduled', completed_at: null },
    ]);
    await db.close();
  });
});
