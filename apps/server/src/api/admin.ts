import type { AdminMonitor, UserDto } from '@heartline/shared';
import {
  incidentCreateSchema,
  incidentPatchSchema,
  incidentUpdateCreateSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
  monitorSpecSchema,
  roleSchema,
  tokenCreateSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@heartline/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { type Vars, principalOf, requireScope } from '../auth/principal.ts';
import { isRole, maxScopeFor, roleAtLeast, scopeAtLeast } from '../auth/roles.ts';
import { describeTarget, runCheck } from '../checks/index.ts';
import type { AppContext } from '../context.ts';
import { NotFoundError, redactSpec, restoreSecrets, validateMonitorSpec } from '../services/monitors.ts';
import { listCatalog } from '../software/catalog.ts';
import { log } from '../util/log.ts';
import { BadRequestError, ForbiddenError, body } from './errors.ts';

export const monitorInputSchema = z.object({ group: z.string().min(1).max(80), spec: monitorSpecSchema });
const pluginTestSchema = z.object({
  plugin: z.string().min(1),
  args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export function adminRoutes(app: AppContext) {
  const r = new Hono<Vars>();
  const read = requireScope('read');
  const write = requireScope('write');
  const admin = requireScope('admin');

  const adminMonitors = async (): Promise<AdminMonitor[]> => {
    const states = await app.db.kysely.selectFrom('monitor_state').selectAll().execute();
    return app.monitors.list().map((m) => {
      const st = states.find((s) => s.monitor_id === m.id);
      return {
        id: m.id,
        name: m.name,
        group: m.group,
        kind: m.spec.type,
        source: m.source,
        paused: m.paused,
        status: m.paused ? 'paused' : ((st?.status as AdminMonitor['status'] | undefined) ?? 'unknown'),
        target: describeTarget(m.spec),
        lastCheckedAt: st?.last_checked_at ?? null,
        lastMessage: st?.last_message ?? null,
        spec: redactSpec(m.spec),
      };
    });
  };

  // Monitors
  r.get('/monitors', read, async (c) => c.json(await adminMonitors()));
  r.get('/monitors/:id', read, async (c) => {
    const m = (await adminMonitors()).find((x) => x.id === c.req.param('id'));
    if (!m) throw new NotFoundError(`service "${c.req.param('id')}" not found`);
    return c.json(m);
  });
  r.post('/monitors', admin, async (c) => {
    const input = await body(c, monitorInputSchema);
    validateMonitorSpec(input.spec, app);
    const m = await app.monitors.create(input.spec, input.group);
    return c.json(
      (await adminMonitors()).find((x) => x.id === m.id),
      201,
    );
  });
  r.put('/monitors/:id', admin, async (c) => {
    const input = await body(c, monitorInputSchema);
    const spec = restoreSecrets(input.spec, app.monitors.get(c.req.param('id'))?.spec);
    validateMonitorSpec(spec, app);
    await app.monitors.update(c.req.param('id'), spec, input.group);
    return c.json((await adminMonitors()).find((x) => x.id === c.req.param('id')));
  });
  r.delete('/monitors/:id', admin, async (c) => {
    await app.monitors.remove(c.req.param('id'));
    return c.body(null, 204);
  });
  r.post('/monitors/:id/run', write, async (c) => {
    const m = app.monitors.require(c.req.param('id'));
    const outcome = await app.scheduler.runNow(m);
    return c.json(outcome ?? { status: null, latencyMs: null, message: 'a check is already running' });
  });
  r.post('/monitors/:id/pause', write, async (c) => {
    const { paused } = await body(c, z.object({ paused: z.boolean() }));
    const m = await app.monitors.setPaused(c.req.param('id'), paused);
    await app.engine.setPausedState(m.id, paused);
    return c.json((await adminMonitors()).find((x) => x.id === m.id));
  });
  r.post('/monitors/:id/software/refresh', write, async (c) => {
    const m = app.monitors.require(c.req.param('id'));
    if (!m.spec.software) throw new BadRequestError('this service has no software block');
    await app.software.probeNow(m);
    return c.json(await app.software.refreshMonitor(m.id, true));
  });

  // Software inventory
  r.get('/software/catalog', read, (c) => c.json(listCatalog()));
  r.post('/software/refresh', write, (c) => {
    void app.software.refreshAll(true).catch((error) => log.warn('software refresh failed', { error }));
    return c.json({ queued: true }, 202);
  });

  // Plugins
  r.get('/plugins', read, (c) => c.json(app.plugins.list()));
  r.post('/plugins/test', admin, async (c) => {
    const input = await body(c, pluginTestSchema);
    const spec = monitorSpecSchema.parse({
      id: 'plugin-test',
      name: 'Plugin test',
      type: 'plugin',
      plugin: input.plugin,
      args: input.args,
    });
    return c.json(await runCheck(spec, app.plugins));
  });

  // Incidents
  r.post('/incidents', write, async (c) => {
    const p = principalOf(c);
    return c.json(await app.incidents.create(await body(c, incidentCreateSchema), p.name), 201);
  });
  r.post('/incidents/:id/updates', write, async (c) => {
    const p = principalOf(c);
    return c.json(
      await app.incidents.addUpdate(c.req.param('id'), await body(c, incidentUpdateCreateSchema), p.name),
    );
  });
  r.patch('/incidents/:id', write, async (c) =>
    c.json(await app.incidents.update(c.req.param('id'), await body(c, incidentPatchSchema))),
  );
  r.delete('/incidents/:id', admin, async (c) => {
    await app.incidents.remove(c.req.param('id'));
    return c.body(null, 204);
  });

  // Maintenance
  r.post('/maintenance', write, async (c) => {
    const p = principalOf(c);
    try {
      return c.json(await app.maintenance.create(await body(c, maintenanceCreateSchema), p.name), 201);
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof z.ZodError) throw error;
      if (error instanceof Error && /rrule|Unknown|Invalid/i.test(error.message))
        throw new BadRequestError(`invalid recurrence: ${error.message}`);
      throw error;
    }
  });
  r.put('/maintenance/:id', write, async (c) => {
    try {
      return c.json(await app.maintenance.update(c.req.param('id'), await body(c, maintenanceUpdateSchema)));
    } catch (error) {
      if (
        error instanceof Error &&
        /rrule|Unknown|Invalid/i.test(error.message) &&
        !(error instanceof z.ZodError)
      )
        throw new BadRequestError(`invalid recurrence: ${error.message}`);
      throw error;
    }
  });
  r.delete('/maintenance/:id', write, async (c) => {
    await app.maintenance.remove(c.req.param('id'));
    return c.body(null, 204);
  });

  // Notifiers
  r.get('/notifiers', read, async (c) => c.json(await app.notifier.list()));
  r.post('/notifiers/:id/test', admin, async (c) => c.json(await app.notifier.test(c.req.param('id'))));

  // API tokens: everyone manages their own; admins may list and revoke all.
  r.get('/tokens', read, async (c) => {
    const p = principalOf(c);
    const all = c.req.query('all') === 'true';
    if (all && p.scope !== 'admin')
      throw new ForbiddenError('listing all tokens needs the "admin" permission');
    return c.json(await app.tokens.list(all ? {} : { userId: p.userId }));
  });
  r.post('/tokens', read, async (c) => {
    const p = principalOf(c);
    if (p.via === 'token') throw new ForbiddenError('API tokens cannot create other tokens');
    const input = await body(c, tokenCreateSchema);
    const allowed = maxScopeFor(p.role);
    const tooHigh = input.scopes.filter((s) => !scopeAtLeast(allowed, s));
    if (tooHigh.length) throw new ForbiddenError(`your role cannot grant: ${tooHigh.join(', ')}`);
    const { token, dto } = await app.tokens.create(p.userId, input);
    return c.json({ token, ...dto }, 201);
  });
  r.delete('/tokens/:id', read, async (c) => {
    const p = principalOf(c);
    await app.tokens.revoke(c.req.param('id'), p.scope === 'admin' ? null : p.userId);
    return c.body(null, 204);
  });

  // Users
  const listUsers = async (): Promise<UserDto[]> => {
    const db = app.db.kysely;
    const users = await db
      .selectFrom('user')
      .select(['id', 'name', 'email', 'image', 'role', 'createdAt'])
      .orderBy('createdAt')
      .execute();
    const accounts = await db.selectFrom('account').select(['userId', 'providerId']).execute();
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image ?? null,
      role: isRole(u.role) ? u.role : 'viewer',
      providers: accounts.filter((a) => a.userId === u.id).map((a) => a.providerId),
      createdAt: new Date(u.createdAt as string | number | Date).getTime(),
    }));
  };
  r.get('/users', admin, async (c) => c.json(await listUsers()));
  r.post('/users', admin, async (c) => {
    const input = await body(c, userCreateSchema);
    if (!app.config().auth.local) throw new BadRequestError('local accounts are disabled in status.yaml');
    const email = input.email.toLowerCase();
    const exists = await app.db.kysely
      .selectFrom('user')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirst();
    if (exists) throw new BadRequestError('a user with this e-mail already exists');
    const ctx = await app.auth.$context;
    const user = await ctx.internalAdapter.createUser(
      { email, name: input.name, emailVerified: true, role: input.role },
      { method: 'admin' },
    );
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(input.password),
    });
    return c.json(
      (await listUsers()).find((u) => u.id === user.id),
      201,
    );
  });
  r.patch('/users/:id', admin, async (c) => {
    const p = principalOf(c);
    const { role } = await body(c, userUpdateSchema);
    const id = c.req.param('id');
    if (id === p.userId && !roleAtLeast(role, 'admin'))
      throw new BadRequestError('you cannot remove your own admin role');
    const res = await app.db.kysely
      .updateTable('user')
      .set({ role: roleSchema.parse(role) })
      .where('id', '=', id)
      .executeTakeFirst();
    if (!Number(res.numUpdatedRows)) throw new NotFoundError('user not found');
    return c.json((await listUsers()).find((u) => u.id === id));
  });
  r.delete('/users/:id', admin, async (c) => {
    const p = principalOf(c);
    const id = c.req.param('id');
    if (id === p.userId) throw new BadRequestError('you cannot delete yourself');
    const ctx = await app.auth.$context;
    await ctx.internalAdapter.deleteUserSessions(id);
    await app.db.kysely.deleteFrom('api_tokens').where('user_id', '=', id).execute();
    await ctx.internalAdapter.deleteUser(id);
    return c.body(null, 204);
  });

  return r;
}
