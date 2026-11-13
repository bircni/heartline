import type { AdminMonitor, GroupDto, UserDto } from '@heartline/shared';
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
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { type Vars, principalOf, requireScope } from '../auth/principal.ts';
import { isRole, maxScopeFor, roleAtLeast, scopeAtLeast } from '../auth/roles.ts';
import { describeTarget, runCheck } from '../checks/index.ts';
import type { AppContext } from '../context.ts';
import { groupIdSchema } from '../config/schema.ts';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  redactSpec,
  restoreSecrets,
  validateMonitorSpec,
} from '../services/monitors.ts';
import { listCatalog } from '../software/catalog.ts';
import { log } from '../util/log.ts';
import type { Actor, AuditInput } from '../services/audit.ts';
import { BadRequestError, ForbiddenError, body } from './errors.ts';
import { clientIp } from './rate-limit.ts';

export const monitorInputSchema = z
  .object({
    /** Group id. */
    groupId: groupIdSchema.optional(),
    /** Group id or name; a name no group has creates a new group. Ignored when `groupId` is given. */
    group: z.string().trim().min(1).max(80).optional(),
    spec: monitorSpecSchema,
  })
  .refine((m) => m.groupId || m.group, { message: 'groupId or group is required', path: ['groupId'] });

export const groupInputSchema = z.object({
  id: groupIdSchema.optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(1000).nullable().optional(),
  collapsed: z.boolean().optional(),
  hideUnlessDegraded: z.boolean().optional(),
});

/**
 * The group a monitor input names; a new name creates a UI-managed group, recorded in the audit log under
 * the same actor as the monitor change.
 */
export async function groupFor(
  app: Pick<AppContext, 'groups' | 'audit'>,
  input: { groupId?: string; group?: string },
  actor: Actor,
): Promise<GroupDto> {
  if (input.groupId) {
    const g = app.groups.get(input.groupId);
    if (!g) throw new ValidationError(`unknown group "${input.groupId}"`);
    return g;
  }
  const name = input.group as string;
  const existing = app.groups.find(name);
  if (existing) return existing;
  const g = await app.groups.create({ name: name.trim() });
  await app.audit.record(actor, {
    action: 'group.create',
    entityType: 'group',
    entityId: g.id,
    summary: `Created group ${g.name} for a new monitor`,
  });
  return g;
}
const pluginTestSchema = z.object({
  plugin: z.string().min(1),
  args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export function adminRoutes(app: AppContext) {
  const r = new Hono<Vars>();
  const read = requireScope('read');
  const write = requireScope('write');
  const admin = requireScope('admin');
  /** Records a change by the caller of this request. */
  const audit = (c: Context<Vars>, entry: AuditInput) =>
    app.audit.record(principalOf(c), { ...entry, ip: clientIp(c, app.config().rateLimit.trustProxy) });

  const adminMonitors = async (): Promise<AdminMonitor[]> => {
    const states = await app.db.kysely.selectFrom('monitor_state').selectAll().execute();
    return app.monitors.list().map((m) => {
      const st = states.find((s) => s.monitor_id === m.id);
      return {
        id: m.id,
        name: m.name,
        group: m.group,
        groupId: m.groupId,
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
    const group = await groupFor(app, input, principalOf(c));
    const m = await app.monitors.create(input.spec, group.id);
    await audit(c, {
      action: 'monitor.create',
      entityType: 'monitor',
      entityId: m.id,
      summary: `Created monitor ${m.name}`,
      detail: { group: group.id, spec: input.spec },
    });
    return c.json(
      (await adminMonitors()).find((x) => x.id === m.id),
      201,
    );
  });
  r.put('/monitors/:id', admin, async (c) => {
    const input = await body(c, monitorInputSchema);
    const spec = restoreSecrets(input.spec, app.monitors.get(c.req.param('id'))?.spec);
    validateMonitorSpec(spec, app);
    // Checked before a new group is created for the update, so a refused update leaves no group behind.
    if (app.monitors.require(c.req.param('id')).source === 'config')
      throw new ConflictError('this service is managed in status.yaml');
    const group = await groupFor(app, input, principalOf(c));
    const m = await app.monitors.update(c.req.param('id'), spec, group.id);
    await audit(c, {
      action: 'monitor.update',
      entityType: 'monitor',
      entityId: m.id,
      summary: `Updated monitor ${m.name}`,
      detail: { group: group.id, spec },
    });
    return c.json((await adminMonitors()).find((x) => x.id === c.req.param('id')));
  });
  r.delete('/monitors/:id', admin, async (c) => {
    const id = c.req.param('id');
    const name = app.monitors.get(id)?.name ?? id;
    await app.monitors.remove(id);
    await audit(c, {
      action: 'monitor.delete',
      entityType: 'monitor',
      entityId: id,
      summary: `Deleted monitor ${name}`,
    });
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
    await audit(c, {
      action: paused ? 'monitor.pause' : 'monitor.resume',
      entityType: 'monitor',
      entityId: m.id,
      summary: `${paused ? 'Paused' : 'Resumed'} monitor ${m.name}`,
    });
    return c.json((await adminMonitors()).find((x) => x.id === m.id));
  });
  r.post('/monitors/:id/software/refresh', write, async (c) => {
    const m = app.monitors.require(c.req.param('id'));
    if (!m.spec.software) throw new BadRequestError('this service has no software block');
    await app.software.probeNow(m);
    return c.json(await app.software.refreshMonitor(m.id, true));
  });

  // Groups
  r.get('/groups', read, (c) => c.json(app.groups.list()));
  r.post('/groups', admin, async (c) => {
    const input = await body(c, groupInputSchema);
    const g = await app.groups.create(input);
    await audit(c, {
      action: 'group.create',
      entityType: 'group',
      entityId: g.id,
      summary: `Created group ${g.name}`,
      detail: input,
    });
    return c.json(g, 201);
  });
  r.put('/groups/order', admin, async (c) => {
    const { ids } = await body(c, z.object({ ids: z.array(z.string()).min(1) }));
    const list = await app.groups.reorder(ids);
    await audit(c, {
      action: 'group.reorder',
      entityType: 'group',
      summary: 'Reordered groups',
      detail: { ids },
    });
    return c.json(list);
  });
  r.put('/groups/:id', admin, async (c) => {
    const { id: _ignored, ...input } = await body(c, groupInputSchema);
    const g = await app.groups.update(c.req.param('id'), input);
    await audit(c, {
      action: 'group.update',
      entityType: 'group',
      entityId: g.id,
      summary: `Updated group ${g.name}`,
      detail: input,
    });
    return c.json(g);
  });
  r.delete('/groups/:id', admin, async (c) => {
    const g = app.groups.require(c.req.param('id'));
    await app.groups.remove(g.id);
    await audit(c, {
      action: 'group.delete',
      entityType: 'group',
      entityId: g.id,
      summary: `Deleted group ${g.name}`,
    });
    return c.body(null, 204);
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
    const input = await body(c, incidentCreateSchema);
    const i = await app.incidents.create(input, p.name);
    await audit(c, {
      action: 'incident.create',
      entityType: 'incident',
      entityId: i.id,
      summary: `Declared incident “${i.title}”`,
      detail: input,
    });
    return c.json(i, 201);
  });
  r.post('/incidents/:id/updates', write, async (c) => {
    const p = principalOf(c);
    const input = await body(c, incidentUpdateCreateSchema);
    const i = await app.incidents.addUpdate(c.req.param('id'), input, p.name);
    await audit(c, {
      action: 'incident.post_update',
      entityType: 'incident',
      entityId: i.id,
      summary: `Posted a “${input.status}” update to “${i.title}”`,
      detail: input,
    });
    return c.json(i);
  });
  r.patch('/incidents/:id', write, async (c) => {
    const input = await body(c, incidentPatchSchema);
    const i = await app.incidents.update(c.req.param('id'), input);
    await audit(c, {
      action: 'incident.edit',
      entityType: 'incident',
      entityId: i.id,
      summary: `Edited incident “${i.title}”`,
      detail: input,
    });
    return c.json(i);
  });
  r.delete('/incidents/:id', admin, async (c) => {
    const id = c.req.param('id');
    const title = (await app.incidents.get(id).catch(() => null))?.title ?? id;
    await app.incidents.remove(id);
    await audit(c, {
      action: 'incident.delete',
      entityType: 'incident',
      entityId: id,
      summary: `Deleted incident “${title}”`,
    });
    return c.body(null, 204);
  });

  // Maintenance
  r.post('/maintenance', write, async (c) => {
    const p = principalOf(c);
    try {
      const input = await body(c, maintenanceCreateSchema);
      const m = await app.maintenance.create(input, p.name);
      await audit(c, {
        action: 'maintenance.create',
        entityType: 'maintenance',
        entityId: m.id,
        summary: `Scheduled maintenance “${m.title}”`,
        detail: input,
      });
      return c.json(m, 201);
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof z.ZodError) throw error;
      if (error instanceof Error && /rrule|Unknown|Invalid/i.test(error.message))
        throw new BadRequestError(`invalid recurrence: ${error.message}`);
      throw error;
    }
  });
  r.put('/maintenance/:id', write, async (c) => {
    try {
      const input = await body(c, maintenanceUpdateSchema);
      const m = await app.maintenance.update(c.req.param('id'), input);
      await audit(c, {
        action: 'maintenance.update',
        entityType: 'maintenance',
        entityId: m.id,
        summary: `Updated maintenance “${m.title}”`,
        detail: input,
      });
      return c.json(m);
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
    const id = c.req.param('id');
    const title = app.maintenance.list().find((m) => m.id === id)?.title ?? id;
    await app.maintenance.remove(id);
    await audit(c, {
      action: 'maintenance.delete',
      entityType: 'maintenance',
      entityId: id,
      summary: `Deleted maintenance “${title}”`,
    });
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
    await audit(c, {
      action: 'token.create',
      entityType: 'token',
      entityId: dto.id,
      summary: `Created API token ${dto.name} (${dto.prefix})`,
      detail: { scopes: dto.scopes, expiresAt: dto.expiresAt },
    });
    return c.json({ token, ...dto }, 201);
  });
  r.delete('/tokens/:id', read, async (c) => {
    const p = principalOf(c);
    await app.tokens.revoke(c.req.param('id'), p.scope === 'admin' ? null : p.userId);
    await audit(c, {
      action: 'token.revoke',
      entityType: 'token',
      entityId: c.req.param('id'),
      summary: 'Revoked an API token',
    });
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
    await audit(c, {
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      summary: `Added local user ${input.name} <${email}> as ${input.role}`,
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
    const user = (await listUsers()).find((u) => u.id === id);
    await audit(c, {
      action: 'user.role',
      entityType: 'user',
      entityId: id,
      summary: `Changed the role of ${user?.name ?? id} to ${role}`,
      detail: { role },
    });
    return c.json(user);
  });
  r.delete('/users/:id', admin, async (c) => {
    const p = principalOf(c);
    const id = c.req.param('id');
    if (id === p.userId) throw new BadRequestError('you cannot delete yourself');
    const victim = (await listUsers()).find((u) => u.id === id);
    const ctx = await app.auth.$context;
    await ctx.internalAdapter.deleteUserSessions(id);
    await app.db.kysely.deleteFrom('api_tokens').where('user_id', '=', id).execute();
    await ctx.internalAdapter.deleteUser(id);
    await audit(c, {
      action: 'user.delete',
      entityType: 'user',
      entityId: id,
      summary: `Deleted user ${victim ? `${victim.name} <${victim.email}>` : id}`,
    });
    return c.body(null, 204);
  });

  // Audit log
  r.get('/audit', admin, async (c) => {
    const before = Number(c.req.query('before'));
    return c.json(
      await app.audit.list({
        limit: Number.parseInt(c.req.query('limit') ?? '100', 10) || 100,
        before: Number.isFinite(before) && before > 0 ? before : undefined,
        entityType: c.req.query('entityType') || undefined,
        entityId: c.req.query('entityId') || undefined,
        actor: c.req.query('actor') || undefined,
      }),
    );
  });

  return r;
}
