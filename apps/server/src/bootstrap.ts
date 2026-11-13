import { type FSWatcher, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { sha256 } from './util/ids.ts';
import type { SiteInfo } from '@heartline/shared';
import { type Auth, createAuth, migrateAuth, seedUsers } from './auth/auth.ts';
import { TokenService } from './auth/tokens.ts';
import { PluginRegistry } from './checks/plugins.ts';
import { loadConfig } from './config/load.ts';
import type { AppConfig } from './config/schema.ts';
import type { AppContext } from './context.ts';
import { type Db, openDb } from './db/index.ts';
import { migrate } from './db/migrations.ts';
import type { Env } from './env.ts';
import { NotifierService } from './notify/index.ts';
import { Scheduler } from './scheduler/scheduler.ts';
import { RateLimiter } from './api/rate-limit.ts';
import { AuditService, SYSTEM } from './services/audit.ts';
import { IncidentService } from './services/incidents.ts';
import { MaintenanceService } from './services/maintenance.ts';
import { GroupService } from './services/groups.ts';
import { TemplateService } from './services/templates.ts';
import { MonitorService } from './services/monitors.ts';
import { PushService } from './services/push.ts';
import { QueryService } from './services/queries.ts';
import { SoftwareService } from './software/service.ts';
import { StatusEngine } from './status/engine.ts';
import { log } from './util/log.ts';

export interface Runtime extends AppContext {
  applyConfig(config: AppConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface BootstrapOptions {
  env: Env;
  config: AppConfig;
  db?: Db;
  fetchImpl?: typeof fetch;
  /** Extra trusted origins for auth (the Vite dev server). */
  devOrigins?: string[];
}

export async function bootstrap(opts: BootstrapOptions): Promise<Runtime> {
  const { env } = opts;
  let config = opts.config;
  const db = opts.db ?? openDb(env.databaseUrl);
  await migrate(db.kysely);
  await migrateAuth(env, config, db);

  const auth: Auth = createAuth(env, config, db, opts.devOrigins, () => config);
  const plugins = new PluginRegistry(env.pluginsDir);
  await plugins.load();
  const monitors = new MonitorService(db);
  const groups = new GroupService(db);
  const templates = new TemplateService(db);
  const notifier = new NotifierService(db, env.baseUrl, opts.fetchImpl);
  const maintenance = new MaintenanceService(db, monitors, notifier);
  const incidents = new IncidentService(db, monitors, notifier);
  const audit = new AuditService(db);
  const rateLimiter = new RateLimiter(db);
  const engine = new StatusEngine(db, notifier, incidents, maintenance);
  engine.audit = audit;
  maintenance.audit = audit;
  const scheduler = new Scheduler(db, monitors, plugins, engine);
  const push = new PushService(db, monitors);
  scheduler.push = push;
  const software = new SoftwareService({
    db,
    monitors,
    notifier,
    isLeader: () => scheduler.isLeader,
    fetchImpl: opts.fetchImpl,
  });
  scheduler.onOutcome = (m, o) => software.observeCheck(m, o);
  scheduler.housekeepingTasks.push(
    {
      name: 'audit log',
      run: async (now) => {
        const pruned = await audit.prune(config.retention.auditDays, now);
        if (pruned) log.info('pruned audit log', { rows: pruned });
      },
    },
    {
      name: 'rate limits',
      run: (now) =>
        rateLimiter.prune(
          Math.max(config.rateLimit.public.window, config.rateLimit.auth.window, 3_600_000),
          now,
        ),
    },
  );

  const site = (): SiteInfo => ({
    title: config.site.title,
    description: config.site.description ?? null,
    timezone: config.site.timezone,
    logoUrl: config.site.logoUrl ?? null,
    theme: config.site.theme,
  });
  const queries = new QueryService({
    db,
    monitors,
    groups,
    incidents,
    maintenance,
    site,
    rawRetentionDays: () => config.retention.rawDays,
    software: () => software.summaries(),
    security: () => software.security(),
  });
  engine.upstream = (m) => queries.upstream(m);
  const tokens = new TokenService(db);

  const applyConfig = async (next: AppConfig) => {
    config = next;
    notifier.configure(next.notifiers, next.site.title);
    incidents.notifyIncidents = next.notifications.incidents;
    maintenance.notifyChannels = next.notifications.maintenance;
    maintenance.reminderBeforeMs = next.maintenance.reminderBefore;
    engine.settings = {
      timezone: next.site.timezone,
      recoveryNotifications: next.notifications.recovery,
      reminderEveryMs: next.notifications.reminderEvery,
    };
    scheduler.retentionDays = next.retention.rawDays;
    const nvdApiKey = next.software.nvdApiKey?.trim() || env.nvdApiKey;
    software.configure({
      enabled: next.software.enabled,
      refreshEveryMs: next.software.refreshEvery,
      kevRefreshEveryMs: next.software.kevRefreshEvery,
      sources: {
        osv: next.software.sources.osv,
        nvd: next.software.sources.nvd === 'auto' ? nvdApiKey !== null : next.software.sources.nvd,
        endoflife: next.software.sources.endoflife,
        kev: next.software.sources.kev,
        releases: next.software.sources.releases,
      },
      notifySecurity: next.notifications.security,
      nvdApiKey,
      githubToken: next.software.githubToken?.trim() || env.githubToken,
      offline: env.offline,
    });
    await plugins.load();
    await maintenance.reload();
    await groups.reconcile(next);
    await monitors.reconcile(next);
    await push.syncConfigTokens();
    await groups.prune(next);
    await templates.reconcile(next);
    await seedUsers(auth, next, db);
  };
  await applyConfig(config);

  let watcher: FSWatcher | null = null;
  let reloadTimer: NodeJS.Timeout | null = null;
  let maintenanceTimer: NodeJS.Timeout | null = null;
  let tickTimer: NodeJS.Timeout | null = null;

  const runtime: Runtime = {
    env,
    config: () => config,
    site,
    db,
    auth,
    tokens,
    plugins,
    monitors,
    push,
    groups,
    templates,
    maintenance,
    incidents,
    notifier,
    engine,
    scheduler,
    queries,
    software,
    audit,
    rateLimiter,
    applyConfig,
    async start() {
      await scheduler.start();
      software.start();
      // Maintenance windows can be edited by another replica; refresh the cache regularly.
      maintenanceTimer = setInterval(() => {
        void maintenance.reload().catch(() => {});
        void groups.reload().catch(() => {});
        void templates.reload().catch(() => {});
      }, 60_000);
      maintenanceTimer.unref();
      // Starts, ends and reminders of maintenance windows; only the leader moves them along.
      tickTimer = setInterval(() => {
        if (scheduler.isLeader)
          void maintenance.tick().catch((error) => log.error('maintenance tick failed', { error }));
      }, 15_000);
      tickTimer.unref();
      let lastHash = sha256(await readFile(env.configPath, 'utf8').catch(() => ''));
      try {
        // ConfigMap updates swap a symlink; watching the path catches both edits and swaps.
        watcher = watch(env.configPath, { persistent: false }, () => {
          if (reloadTimer) clearTimeout(reloadTimer);
          reloadTimer = setTimeout(async () => {
            try {
              const hash = sha256(await readFile(env.configPath, 'utf8'));
              if (hash === lastHash) return;
              lastHash = hash;
              await applyConfig(await loadConfig(env.configPath));
              log.info('reloaded status.yaml');
              // Every replica reloads; one entry is enough.
              if (scheduler.isLeader)
                await audit.record(SYSTEM, {
                  action: 'config.reload',
                  entityType: 'config',
                  entityId: null,
                  summary: 'Reloaded status.yaml',
                });
            } catch (error) {
              log.error('status.yaml reload failed; keeping the previous config', {
                error: (error as Error).message,
              });
            }
          }, 500);
        });
      } catch (error) {
        log.warn('cannot watch config file for changes', { error });
      }
    },
    async stop() {
      watcher?.close();
      if (reloadTimer) clearTimeout(reloadTimer);
      if (maintenanceTimer) clearInterval(maintenanceTimer);
      if (tickTimer) clearInterval(tickTimer);
      await software.stop();
      await scheduler.stop();
      await db.close();
    },
  };
  return runtime;
}
