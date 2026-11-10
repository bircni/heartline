import type pg from 'pg';
import { runCheck } from '../checks/index.ts';
import type { PluginRegistry } from '../checks/plugins.ts';
import type { CheckOutcome } from '../checks/types.ts';
import type { Db } from '../db/index.ts';
import type { LoadedMonitor, MonitorService } from '../services/monitors.ts';
import type { StatusEngine } from '../status/engine.ts';
import { log } from '../util/log.ts';
import { dayKey } from '@heartline/shared';

const LOCK_KEY = 7_271_337;

/**
 * Runs every active monitor on its interval. With Postgres, only the replica holding an advisory
 * lock runs checks, so several replicas can serve the API without double-checking.
 */
export class Scheduler {
  #db: Db;
  #monitors: MonitorService;
  #plugins: PluginRegistry;
  #engine: StatusEngine;
  #timers = new Map<string, NodeJS.Timeout>();
  #specs = new Map<string, string>();
  #running = new Set<string>();
  #leader = false;
  #lockClient: pg.PoolClient | null = null;
  #electionTimer: NodeJS.Timeout | null = null;
  #housekeepingTimer: NodeJS.Timeout | null = null;
  #stopped = true;
  #abort = new AbortController();
  #inFlight = new Set<Promise<unknown>>();
  retentionDays = 30;
  /** Called after every recorded check (version tracking). Errors are logged, never propagated. */
  onOutcome: ((monitor: LoadedMonitor, outcome: CheckOutcome) => Promise<void>) | null = null;

  constructor(db: Db, monitors: MonitorService, plugins: PluginRegistry, engine: StatusEngine) {
    this.#db = db;
    this.#monitors = monitors;
    this.#plugins = plugins;
    this.#engine = engine;
    monitors.onChange(() => this.#sync());
  }

  get isLeader(): boolean {
    return this.#leader;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    this.#abort = new AbortController();
    await this.#elect();
    this.#electionTimer = setInterval(() => void this.#elect(), 15_000);
    this.#housekeepingTimer = setInterval(() => void this.housekeeping(), 10 * 60_000);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#abort.abort();
    if (this.#electionTimer) clearInterval(this.#electionTimer);
    if (this.#housekeepingTimer) clearInterval(this.#housekeepingTimer);
    this.#clearAll();
    // Let running checks and housekeeping finish before the database is closed.
    await Promise.allSettled(this.#inFlight);
    if (this.#lockClient) {
      try {
        await this.#lockClient.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
      } catch {
        /* connection may already be gone */
      }
      this.#lockClient.release();
      this.#lockClient = null;
    }
    this.#leader = false;
  }

  async #elect(): Promise<void> {
    if (this.#stopped) return;
    if (!this.#db.pool) {
      if (!this.#leader) this.#becomeLeader();
      return;
    }
    if (this.#leader && this.#lockClient) {
      try {
        await this.#lockClient.query('select 1');
        return;
      } catch {
        log.warn('lost scheduler leadership (lock connection failed)');
        this.#lockClient.release(true);
        this.#lockClient = null;
        this.#leader = false;
        this.#clearAll();
      }
    }
    try {
      const client = await this.#db.pool.connect();
      const res = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [
        LOCK_KEY,
      ]);
      if (res.rows[0]?.locked) {
        this.#lockClient = client;
        this.#becomeLeader();
      } else {
        client.release();
      }
    } catch (error) {
      log.warn('scheduler election failed', { error });
    }
  }

  #becomeLeader(): void {
    this.#leader = true;
    log.info('this instance runs the checks', { monitors: this.#monitors.list().length });
    this.#sync();
    void this.housekeeping();
  }

  #clearAll(): void {
    for (const t of this.#timers.values()) clearTimeout(t);
    this.#timers.clear();
    this.#specs.clear();
  }

  /** Reconciles timers with the current monitor list; unchanged monitors keep their rhythm. */
  #sync(): void {
    if (!this.#leader || this.#stopped) return;
    const active = new Map(
      this.#monitors
        .list()
        .filter((m) => !m.paused)
        .map((m) => [m.id, m]),
    );
    for (const [id, timer] of this.#timers) {
      const m = active.get(id);
      if (!m || this.#specs.get(id) !== JSON.stringify(m.spec)) {
        clearTimeout(timer);
        this.#timers.delete(id);
        this.#specs.delete(id);
      }
    }
    for (const m of active.values()) {
      if (this.#timers.has(m.id)) continue;
      this.#specs.set(m.id, JSON.stringify(m.spec));
      // Spread first checks over a few seconds so a restart does not fire everything at once.
      this.#schedule(m, Math.floor(Math.random() * Math.min(5_000, m.spec.interval)));
    }
  }

  #schedule(monitor: LoadedMonitor, delay: number): void {
    const timer = setTimeout(async () => {
      const current = this.#monitors.get(monitor.id);
      if (!current || current.paused || !this.#leader) return;
      await this.runNow(current);
      if (this.#timers.get(monitor.id) === timer) this.#schedule(current, current.spec.interval);
    }, delay);
    timer.unref();
    this.#timers.set(monitor.id, timer);
  }

  /** Runs one check immediately and records it. Concurrent runs of the same monitor are skipped. */
  runNow(monitor: LoadedMonitor): Promise<CheckOutcome | null> {
    return this.#track(this.#runNow(monitor));
  }

  #track<T>(promise: Promise<T>): Promise<T> {
    this.#inFlight.add(promise);
    void promise.finally(() => this.#inFlight.delete(promise)).catch(() => {});
    return promise;
  }

  async #runNow(monitor: LoadedMonitor): Promise<CheckOutcome | null> {
    if (this.#running.has(monitor.id)) return null;
    this.#running.add(monitor.id);
    try {
      const outcome = await runCheck(monitor.spec, this.#plugins, this.#abort.signal);
      if (this.#abort.signal.aborted) return outcome;
      await this.#engine.record(monitor, outcome);
      if (this.onOutcome) {
        try {
          await this.onOutcome(monitor, outcome);
        } catch (error) {
          log.error('post-check hook failed', { service: monitor.id, error });
        }
      }
      return outcome;
    } catch (error) {
      log.error('check failed unexpectedly', { service: monitor.id, error });
      return null;
    } finally {
      this.#running.delete(monitor.id);
    }
  }

  housekeeping(now = Date.now()): Promise<void> {
    return this.#track(this.#housekeeping(now));
  }

  async #housekeeping(now: number): Promise<void> {
    if (!this.#leader || this.#stopped) return;
    try {
      const tz = this.#engine.settings.timezone;
      await this.#engine.refreshPercentiles([...new Set([dayKey(now - 86_400_000, tz), dayKey(now, tz)])]);
      const pruned = await this.#engine.pruneRawResults(this.retentionDays, now);
      if (pruned) log.info('pruned raw check results', { rows: pruned });
    } catch (error) {
      log.error('housekeeping failed', { error });
    }
  }
}
