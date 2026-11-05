import type {
  SoftwareDetail,
  SoftwareInventory,
  SoftwareSummary,
  UrgencyLevel,
  VersionSource,
  VulnSeverity,
  VulnerabilityDto,
} from '@heartline/shared';
import { URGENCY_LEVELS } from '@heartline/shared';
import type { CheckOutcome } from '../checks/types.ts';
import type { Db } from '../db/index.ts';
import type { MonitorSoftwareRow } from '../db/schema.ts';
import type { NotifierService } from '../notify/index.ts';
import type { LoadedMonitor, MonitorService } from '../services/monitors.ts';
import { NotFoundError } from '../services/monitors.ts';
import { log } from '../util/log.ts';
import { USER_AGENT } from '../util/pkg.ts';
import { type CatalogEntry, getCatalogEntry } from './catalog.ts';
import { type ResolvedProbe, probeVersion, resolveProbe } from './probe.ts';
import { IntelCache, RateGate, type SourceOpts, SourceUnavailable } from './sources/cache.ts';
import { EndoflifeClient, resolveCycle } from './sources/endoflife.ts';
import { KevClient } from './sources/kev.ts';
import { type MatchedVuln, mergeVulns } from './sources/merge.ts';
import { NvdClient, cveAffects } from './sources/nvd.ts';
import { OsvClient, fixedAfter, matchedRange } from './sources/osv.ts';
import { URGENCY_RANK, computeUrgency } from './urgency.ts';

export interface SoftwareSettings {
  enabled: boolean;
  refreshEveryMs: number;
  kevRefreshEveryMs: number;
  sources: { osv: boolean; nvd: boolean; endoflife: boolean; kev: boolean };
  notifySecurity: boolean;
  nvdApiKey: string | null;
  /** Never contact external sources. */
  offline: boolean;
}

export interface SoftwareDeps {
  db: Db;
  monitors: MonitorService;
  notifier: NotifierService;
  isLeader: () => boolean;
  fetchImpl?: typeof fetch;
}

const LAST_REFRESH_KEY = 'meta:last-refresh';
const TICK_MS = 60_000;
const PROBE_CONCURRENCY = 4;

interface Product {
  entry: CatalogEntry | undefined;
  slug: string;
  name: string;
  endoflife: string | null;
  cpe: string | null;
  osv: { ecosystem: string; name: string } | null;
  releasesUrl: string | null;
  track: boolean;
}

const parseJson = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

const EMPTY_COUNTS = (): Record<VulnSeverity, number> => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
});

/** Tracks running versions, looks up vulnerabilities and release information, and scores update urgency. */
export class SoftwareService {
  #db: Db;
  #monitors: MonitorService;
  #notifier: NotifierService;
  #isLeader: () => boolean;
  #fetch: typeof fetch;
  #cache: IntelCache;
  #gates = {
    osv: new RateGate(200),
    nvd: new RateGate(6_000),
    eol: new RateGate(200),
    kev: new RateGate(1_000),
  };
  #timer: NodeJS.Timeout | null = null;
  #inFlight = new Set<Promise<unknown>>();
  #refreshing = new Set<string>();
  #abort = new AbortController();
  #firstTick = true;
  settings: SoftwareSettings = {
    enabled: true,
    refreshEveryMs: 6 * 3_600_000,
    kevRefreshEveryMs: 24 * 3_600_000,
    sources: { osv: true, nvd: false, endoflife: true, kev: true },
    notifySecurity: true,
    nvdApiKey: null,
    offline: false,
  };

  constructor(deps: SoftwareDeps) {
    this.#db = deps.db;
    this.#monitors = deps.monitors;
    this.#notifier = deps.notifier;
    this.#isLeader = deps.isLeader;
    this.#fetch = deps.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.#cache = new IntelCache(deps.db);
  }

  configure(settings: SoftwareSettings): void {
    this.settings = settings;
    this.#gates.nvd = new RateGate(settings.nvdApiKey ? 700 : 6_000);
  }

  start(): void {
    this.#abort = new AbortController();
    this.#firstTick = true;
    this.#timer = setInterval(() => void this.tick(), TICK_MS);
    this.#timer.unref();
    // Give the scheduler a moment to elect a leader before the first pass.
    const t = setTimeout(() => void this.tick(), 3_000);
    t.unref();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#abort.abort();
    await Promise.allSettled(this.#inFlight);
  }

  #track<T>(promise: Promise<T>): Promise<T> {
    this.#inFlight.add(promise);
    void promise.finally(() => this.#inFlight.delete(promise)).catch(() => {});
    return promise;
  }

  // ---------------------------------------------------------------------------------------------
  // Products and probes

  #product(monitor: LoadedMonitor): Product | null {
    const sw = monitor.spec.software;
    if (!sw) return null;
    const entry = getCatalogEntry(sw.product);
    return {
      entry,
      slug: sw.product,
      name: sw.name ?? entry?.name ?? sw.product,
      endoflife: entry?.endoflife ?? null,
      cpe: sw.cpe ? sw.cpe.replace(/^cpe:2\.3:[aho]:/, '') : (entry?.cpe ?? null),
      osv: sw.osv ?? entry?.osv ?? null,
      releasesUrl: entry?.releasesUrl ?? null,
      track: sw.track,
    };
  }

  #probe(monitor: LoadedMonitor): ResolvedProbe {
    return resolveProbe(monitor.spec, getCatalogEntry(monitor.spec.software?.product ?? ''));
  }

  #tracked(): LoadedMonitor[] {
    return this.#monitors.list().filter((m) => m.spec.software);
  }

  /** Makes sure every tracked monitor has a row and drops rows of monitors that lost their software block. */
  async #syncRows(now: number): Promise<void> {
    const db = this.#db.kysely;
    const tracked = this.#tracked();
    const rows = await db.selectFrom('monitor_software').select(['monitor_id', 'product']).execute();
    const have = new Map(rows.map((r) => [r.monitor_id, r.product]));
    for (const m of tracked) {
      const product = m.spec.software?.product as string;
      if (!have.has(m.id)) {
        await db
          .insertInto('monitor_software')
          .values({ monitor_id: m.id, product, next_probe_at: 0, updated_at: now })
          .onConflict((oc) => oc.column('monitor_id').doNothing())
          .execute();
      } else if (have.get(m.id) !== product) {
        // Product changed: start over with the intel for the new product.
        await db.deleteFrom('monitor_vulnerabilities').where('monitor_id', '=', m.id).execute();
        await db
          .updateTable('monitor_software')
          .set({
            product,
            latest: null,
            latest_in_cycle: null,
            cycle: null,
            cycle_eol: null,
            intel_refreshed_at: null,
            urgency_level: 'unknown',
            urgency_score: 0,
            urgency_reasons: '[]',
            evaluated: 0,
            next_probe_at: 0,
            updated_at: now,
          })
          .where('monitor_id', '=', m.id)
          .execute();
      }
    }
    const ids = new Set(tracked.map((m) => m.id));
    const stale = rows.filter((r) => !ids.has(r.monitor_id)).map((r) => r.monitor_id);
    for (const id of stale) {
      await db.deleteFrom('monitor_software').where('monitor_id', '=', id).execute();
      await db.deleteFrom('monitor_vulnerabilities').where('monitor_id', '=', id).execute();
      await db.deleteFrom('monitor_software_history').where('monitor_id', '=', id).execute();
    }
  }

  /** Leader-only periodic work: due probes, then an intel refresh when the last one is old enough. */
  tick(now = Date.now()): Promise<void> {
    return this.#track(this.#tick(now));
  }

  async #tick(now: number): Promise<void> {
    if (!this.settings.enabled || !this.#isLeader() || this.#abort.signal.aborted) return;
    try {
      await this.#syncRows(now);
      const due = await this.#db.kysely
        .selectFrom('monitor_software')
        .select(['monitor_id'])
        .where('next_probe_at', '<=', now)
        .execute();
      const monitors = due
        .map((r) => this.#monitors.get(r.monitor_id))
        .filter((m): m is LoadedMonitor => Boolean(m));
      const spread = this.#firstTick;
      this.#firstTick = false;
      for (let i = 0; i < monitors.length; i += PROBE_CONCURRENCY) {
        if (this.#abort.signal.aborted) return;
        await Promise.all(
          monitors.slice(i, i + PROBE_CONCURRENCY).map(async (m) => {
            if (spread) await new Promise((r) => setTimeout(r, Math.random() * 2_000).unref());
            await this.probeNow(m).catch((error) =>
              log.warn('version probe failed', { service: m.id, error }),
            );
          }),
        );
      }
      const last = await this.#cache.get(LAST_REFRESH_KEY);
      if (!last || last.fetched_at + this.settings.refreshEveryMs <= now) await this.refreshAll(false, now);
    } catch (error) {
      log.error('software tick failed', { error });
    }
  }

  /** Runs the version probe of one monitor (separate URL or static value) and records the result. */
  async probeNow(monitor: LoadedMonitor, now = Date.now()): Promise<void> {
    const probe = this.#probe(monitor);
    const schedule = async (intervalMs: number) => {
      await this.#db.kysely
        .updateTable('monitor_software')
        .set({ next_probe_at: now + intervalMs, updated_at: now })
        .where('monitor_id', '=', monitor.id)
        .execute();
    };
    switch (probe.mode) {
      case 'static':
        await schedule(24 * 3_600_000);
        await this.observeVersion(monitor.id, probe.version, 'static', null, now);
        return;
      case 'separate': {
        await schedule(probe.intervalMs);
        if (this.settings.offline) {
          await this.observeVersion(monitor.id, null, 'probe', 'offline mode', now);
          return;
        }
        const res = await probeVersion(probe, this.#fetch, USER_AGENT, this.#abort.signal);
        await this.observeVersion(monitor.id, res.version, 'probe', res.error, now);
        return;
      }
      case 'inline':
      case 'plugin':
        // Versions arrive with every check result; nothing to probe here.
        await schedule(24 * 3_600_000);
        return;
      case 'none':
        await schedule(24 * 3_600_000);
        await this.#db.kysely
          .updateTable('monitor_software')
          .set({ probe_error: probe.error, updated_at: now })
          .where('monitor_id', '=', monitor.id)
          .execute();
        return;
    }
  }

  /** Hook for the scheduler: versions found inline in check responses or plugin output. */
  async observeCheck(monitor: LoadedMonitor, outcome: CheckOutcome): Promise<void> {
    if (!monitor.spec.software || outcome.version === undefined) return;
    if (!this.settings.enabled) return;
    const source: VersionSource = monitor.spec.type === 'plugin' ? 'plugin' : 'check';
    await this.observeVersion(
      monitor.id,
      outcome.version,
      source,
      outcome.version === null ? 'version not found in the response' : null,
    );
  }

  /**
   * Persists an observed version. A change is logged, recorded in the history, announced (when
   * security notifications are on) and followed by an immediate intel refresh.
   */
  async observeVersion(
    monitorId: string,
    version: string | null,
    source: VersionSource,
    error: string | null,
    at = Date.now(),
  ): Promise<void> {
    const monitor = this.#monitors.get(monitorId);
    if (!monitor?.spec.software) return;
    const db = this.#db.kysely;
    const row = await db
      .selectFrom('monitor_software')
      .selectAll()
      .where('monitor_id', '=', monitorId)
      .executeTakeFirst();
    const previous = row?.version ?? null;
    const changed = version !== null && previous !== null && previous !== version;
    const first = version !== null && previous === null;
    const update = {
      product: monitor.spec.software.product,
      version: version ?? previous,
      version_source: version ? source : (row?.version_source ?? null),
      version_seen_at: version ? at : (row?.version_seen_at ?? null),
      probe_error: error,
      updated_at: at,
      ...(changed
        ? { previous_version: previous, version_changed_at: at, notified_level: 'none', evaluated: 0 }
        : {}),
    };
    await db
      .insertInto('monitor_software')
      .values({ monitor_id: monitorId, next_probe_at: 0, ...update })
      .onConflict((oc) => oc.column('monitor_id').doUpdateSet(update))
      .execute();
    if (changed || first) {
      await db
        .insertInto('monitor_software_history')
        .values({ monitor_id: monitorId, version: version as string, seen_at: at })
        .onConflict((oc) => oc.columns(['monitor_id', 'seen_at']).doNothing())
        .execute();
    }
    if (changed) {
      log.info('software version changed', { service: monitorId, from: previous, to: version });
      if (this.settings.notifySecurity) {
        await this.#notifier.send(
          {
            kind: 'vulnerability',
            service: { id: monitor.id, name: monitor.name },
            product: this.#product(monitor)?.name ?? monitor.spec.software.product,
            version,
            previousVersion: previous,
            urgency: { level: 'unknown', score: 0, reasons: [] },
            newVulns: [],
            trigger: 'version-change',
            at,
          },
          monitor.spec.notify,
        );
      }
    }
    if (changed || first) {
      await this.refreshMonitor(monitorId, true, at).catch((e) =>
        log.warn('intel refresh after version change failed', { service: monitorId, error: e }),
      );
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Intel refresh

  #sourceOpts(gate: RateGate): SourceOpts {
    return {
      fetchImpl: this.#fetch,
      cache: this.#cache,
      gate,
      userAgent: USER_AGENT,
      signal: this.#abort.signal,
    };
  }

  async refreshAll(force = false, now = Date.now()): Promise<{ refreshed: number; errors: number }> {
    let refreshed = 0;
    let errors = 0;
    for (const m of this.#tracked()) {
      if (this.#abort.signal.aborted) break;
      try {
        await this.refreshMonitor(m.id, force, now);
        refreshed++;
      } catch (error) {
        errors++;
        log.warn('software refresh failed', { service: m.id, error });
      }
    }
    await this.#cache.touch(LAST_REFRESH_KEY, now);
    return { refreshed, errors };
  }

  /** Refreshes release and vulnerability data for one monitor and returns the detail. */
  async refreshMonitor(monitorId: string, force = false, now = Date.now()): Promise<SoftwareDetail> {
    const monitor = this.#monitors.require(monitorId);
    if (!monitor.spec.software) throw new NotFoundError(`service "${monitorId}" has no software block`);
    if (this.#refreshing.has(monitorId)) {
      const current = await this.detail(monitorId);
      if (current) return current;
    }
    this.#refreshing.add(monitorId);
    try {
      await this.#syncRows(now);
      const row = await this.#row(monitorId);
      if (!row) throw new NotFoundError(`service "${monitorId}" not found`);
      if (force || !row.intel_refreshed_at || row.intel_refreshed_at + this.settings.refreshEveryMs <= now)
        await this.#track(this.#refreshIntel(monitor, row, now));
      return (await this.detail(monitorId)) as SoftwareDetail;
    } finally {
      this.#refreshing.delete(monitorId);
    }
  }

  #row(monitorId: string) {
    return this.#db.kysely
      .selectFrom('monitor_software')
      .selectAll()
      .where('monitor_id', '=', monitorId)
      .executeTakeFirst();
  }

  async #refreshIntel(monitor: LoadedMonitor, row: MonitorSoftwareRow, now: number): Promise<void> {
    const product = this.#product(monitor) as Product;
    const version = row.version;
    const errors: string[] = [];
    const s = this.settings;
    let intelAvailable = false;
    let latest: string | null = row.latest;
    let latestInCycle: string | null = row.latest_in_cycle;
    let cycle: string | null = row.cycle;
    let cycleEol: string | null = row.cycle_eol;
    let eolFetched = row.eol_fetched_at;
    let vulns: MatchedVuln[] = [];

    if (s.offline) errors.push('offline mode');
    else {
      if (s.sources.endoflife && product.endoflife) {
        try {
          const cycles = await new EndoflifeClient(this.#sourceOpts(this.#gates.eol)).product(
            product.endoflife,
          );
          const resolved = resolveCycle(cycles, version);
          latest = resolved.latest;
          latestInCycle = resolved.latestInCycle;
          cycle = resolved.cycle?.cycle ?? null;
          cycleEol = resolved.eol;
          eolFetched = now;
        } catch (error) {
          errors.push(`endoflife: ${(error as Error).message}`);
        }
      }
      if (product.track && version) {
        const osvHits: {
          v: Awaited<ReturnType<OsvClient['query']>>[number];
          range: { introduced: string | null; fixed: string | null };
          fixedIn: string | null;
        }[] = [];
        const nvdHits: { c: Awaited<ReturnType<NvdClient['byCpe']>>[number]; fixedIn: string | null }[] = [];
        let anySource = false;
        if (s.sources.osv && product.osv) {
          anySource = true;
          try {
            const found = await new OsvClient(this.#sourceOpts(this.#gates.osv)).query(product.osv, version);
            for (const v of found) {
              const range = matchedRange(v, version);
              if (range) osvHits.push({ v, range, fixedIn: fixedAfter(v, version) ?? range.fixed });
            }
            intelAvailable = true;
          } catch (error) {
            errors.push(`osv: ${(error as Error).message}`);
          }
        }
        if (s.sources.nvd && product.cpe) {
          anySource = true;
          try {
            const found = await new NvdClient(this.#sourceOpts(this.#gates.nvd), s.nvdApiKey).byCpe(
              product.cpe,
              version,
            );
            for (const c of found) {
              const hit = cveAffects(c, product.cpe, version);
              if (hit) nvdHits.push({ c, fixedIn: hit.fixedIn });
            }
            intelAvailable = true;
          } catch (error) {
            errors.push(`nvd: ${(error as Error).message}`);
          }
        }
        if (!anySource)
          errors.push(`no vulnerability source for ${product.name} (no OSV package or CPE known)`);
        let kev = new Set<string>();
        if (s.sources.kev && (osvHits.length || nvdHits.length)) {
          try {
            kev = await new KevClient(this.#sourceOpts(this.#gates.kev), s.kevRefreshEveryMs).ids();
          } catch (error) {
            errors.push(`kev: ${(error as Error).message}`);
          }
        }
        vulns = mergeVulns(osvHits, nvdHits, kev);
      }
    }

    const db = this.#db.kysely;
    const existingLinks = await db
      .selectFrom('monitor_vulnerabilities')
      .selectAll()
      .where('monitor_id', '=', monitor.id)
      .execute();
    const existingIds = new Set(existingLinks.map((l) => l.vuln_id));
    const keep = intelAvailable || s.offline === false ? vulns : [];
    if (intelAvailable) {
      await db.transaction().execute(async (trx) => {
        for (const v of keep) {
          const vrow = {
            aliases: JSON.stringify(v.aliases),
            summary: v.summary,
            score: v.score,
            vector: v.vector,
            severity: v.severity,
            kev: v.kev ? 1 : 0,
            published_at: v.published,
            modified_at: v.modified,
            references_json: JSON.stringify(v.references),
            sources: JSON.stringify(v.sources),
            fetched_at: now,
          };
          await trx
            .insertInto('vulnerabilities')
            .values({ id: v.id, ...vrow })
            .onConflict((oc) => oc.column('id').doUpdateSet(vrow))
            .execute();
          await trx
            .insertInto('monitor_vulnerabilities')
            .values({
              monitor_id: monitor.id,
              vuln_id: v.id,
              fixed_in: v.fixedIn,
              introduced: v.introduced,
              first_seen_at: now,
              notified_at: null,
            })
            .onConflict((oc) =>
              oc
                .columns(['monitor_id', 'vuln_id'])
                .doUpdateSet({ fixed_in: v.fixedIn, introduced: v.introduced }),
            )
            .execute();
        }
        const current = new Set(keep.map((v) => v.id));
        const gone = existingLinks.filter((l) => !current.has(l.vuln_id)).map((l) => l.vuln_id);
        if (gone.length)
          await trx
            .deleteFrom('monitor_vulnerabilities')
            .where('monitor_id', '=', monitor.id)
            .where('vuln_id', 'in', gone)
            .execute();
      });
    } else {
      // Keep what we knew; it is better than nothing while the sources are down.
      vulns = await this.#vulnsOf(monitor.id);
    }

    const urgency = computeUrgency({
      version,
      latest,
      latestInCycle,
      cycle,
      cycleEol,
      vulns: vulns.map((v) => ({ id: v.id, score: v.score, kev: v.kev, fixedIn: v.fixedIn })),
      track: product.track,
      intelAvailable: intelAvailable || (!s.offline && vulns.length > 0),
      probeError: row.probe_error,
      now,
    });
    await db
      .updateTable('monitor_software')
      .set({
        latest,
        latest_in_cycle: latestInCycle,
        cycle,
        cycle_eol: cycleEol,
        eol_fetched_at: eolFetched,
        intel_refreshed_at: now,
        intel_error: errors.length ? errors.join('; ') : null,
        urgency_level: urgency.level,
        urgency_score: urgency.score,
        urgency_reasons: JSON.stringify(urgency.reasons),
        updated_at: now,
      })
      .where('monitor_id', '=', monitor.id)
      .execute();

    await this.#notify(monitor, product, row, version, urgency, vulns, existingIds, intelAvailable, now);
  }

  async #notify(
    monitor: LoadedMonitor,
    product: Product,
    row: MonitorSoftwareRow,
    version: string | null,
    urgency: { level: UrgencyLevel; score: number; reasons: string[] },
    vulns: MatchedVuln[],
    existingIds: Set<string>,
    intelAvailable: boolean,
    now: number,
  ): Promise<void> {
    const db = this.#db.kysely;
    const service = { id: monitor.id, name: monitor.name };
    const base = {
      kind: 'vulnerability' as const,
      service,
      product: product.name,
      version,
      previousVersion: null,
      urgency,
      at: now,
    };
    const firstEvaluation = !row.evaluated;
    let announced = false;
    if (intelAvailable) {
      const fresh = vulns.filter((v) => !existingIds.has(v.id));
      // The first evaluation of a service would otherwise dump its whole history; only shout if it matters.
      const announce =
        fresh.length > 0 && (!firstEvaluation || URGENCY_RANK[urgency.level] >= URGENCY_RANK.high);
      if (announce && this.settings.notifySecurity) {
        announced = true;
        await this.#notifier.send(
          {
            ...base,
            newVulns: fresh.map((v) => ({ id: v.id, score: v.score, kev: v.kev, fixedIn: v.fixedIn })),
            trigger: 'new-vulns',
          },
          monitor.spec.notify,
        );
      }
      if (fresh.length)
        await db
          .updateTable('monitor_vulnerabilities')
          .set({ notified_at: now })
          .where('monitor_id', '=', monitor.id)
          .where(
            'vuln_id',
            'in',
            fresh.map((v) => v.id),
          )
          .execute();
    }
    const notified = (row.notified_level in URGENCY_RANK ? row.notified_level : 'none') as UrgencyLevel;
    const rose = URGENCY_RANK[urgency.level] > URGENCY_RANK[notified];
    if (
      rose &&
      URGENCY_RANK[urgency.level] >= URGENCY_RANK.high &&
      this.settings.notifySecurity &&
      !announced
    ) {
      // Urgency rose without new vulnerabilities (a release went end-of-life, KEV listed a known CVE, …).
      await this.#notifier.send({ ...base, newVulns: [], trigger: 'urgency' }, monitor.spec.notify);
    }
    await db
      .updateTable('monitor_software')
      .set({ notified_level: rose ? urgency.level : notified, evaluated: 1 })
      .where('monitor_id', '=', monitor.id)
      .execute();
  }

  // ---------------------------------------------------------------------------------------------
  // Reads

  async #vulnsOf(monitorId: string): Promise<MatchedVuln[]> {
    const rows = await this.#db.kysely
      .selectFrom('monitor_vulnerabilities as mv')
      .innerJoin('vulnerabilities as v', 'v.id', 'mv.vuln_id')
      .selectAll('v')
      .select(['mv.fixed_in', 'mv.introduced'])
      .where('mv.monitor_id', '=', monitorId)
      .execute();
    return rows
      .map((r) => ({
        id: r.id,
        aliases: parseJson<string[]>(r.aliases, []),
        summary: r.summary,
        score: r.score,
        vector: r.vector,
        severity: r.severity as VulnSeverity,
        kev: Boolean(r.kev),
        fixedIn: r.fixed_in,
        introduced: r.introduced,
        published: r.published_at,
        modified: r.modified_at,
        references: parseJson<string[]>(r.references_json, []),
        sources: parseJson<('osv' | 'nvd')[]>(r.sources, []),
      }))
      .toSorted((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id));
  }

  async #counts(ids: string[]): Promise<Map<string, Record<VulnSeverity, number>>> {
    const out = new Map<string, Record<VulnSeverity, number>>();
    if (!ids.length) return out;
    const rows = await this.#db.kysely
      .selectFrom('monitor_vulnerabilities as mv')
      .innerJoin('vulnerabilities as v', 'v.id', 'mv.vuln_id')
      .select(['mv.monitor_id', 'v.severity'])
      .where('mv.monitor_id', 'in', ids)
      .execute();
    for (const r of rows) {
      const c = out.get(r.monitor_id) ?? EMPTY_COUNTS();
      const sev = (r.severity in c ? r.severity : 'unknown') as VulnSeverity;
      c[sev]++;
      out.set(r.monitor_id, c);
    }
    return out;
  }

  #summary(
    monitor: LoadedMonitor,
    row: MonitorSoftwareRow | undefined,
    counts: Record<VulnSeverity, number>,
  ): SoftwareSummary {
    const product = this.#product(monitor) as Product;
    const eol = row?.cycle_eol && /^\d{4}-\d{2}-\d{2}$/.test(row.cycle_eol) ? row.cycle_eol : null;
    const eolReached =
      row?.cycle_eol === 'true' || (eol !== null && Date.parse(`${eol}T00:00:00Z`) <= Date.now());
    return {
      product: product.slug,
      productName: product.name,
      version: row?.version ?? null,
      latest: row?.latest ?? null,
      latestInCycle: row?.latest_in_cycle ?? null,
      cycle: row?.cycle ?? null,
      eol,
      eolReached,
      versionSeenAt: row?.version_seen_at ?? null,
      urgency: (row?.urgency_level as UrgencyLevel | undefined) ?? 'unknown',
      score: row?.urgency_score ?? 0,
      vulns: counts,
    };
  }

  /** Summaries for every tracked monitor, keyed by monitor id. */
  async summaries(): Promise<Map<string, SoftwareSummary>> {
    const tracked = this.#tracked();
    const out = new Map<string, SoftwareSummary>();
    if (!tracked.length) return out;
    const ids = tracked.map((m) => m.id);
    const [rows, counts] = await Promise.all([
      this.#db.kysely.selectFrom('monitor_software').selectAll().where('monitor_id', 'in', ids).execute(),
      this.#counts(ids),
    ]);
    const byId = new Map(rows.map((r) => [r.monitor_id, r]));
    for (const m of tracked)
      out.set(m.id, this.#summary(m, byId.get(m.id), counts.get(m.id) ?? EMPTY_COUNTS()));
    return out;
  }

  #detailOf(
    monitor: LoadedMonitor,
    row: MonitorSoftwareRow | undefined,
    counts: Record<VulnSeverity, number>,
    vulns: MatchedVuln[],
  ): SoftwareDetail {
    const product = this.#product(monitor) as Product;
    return {
      ...this.#summary(monitor, row, counts),
      serviceId: monitor.id,
      serviceName: monitor.name,
      group: monitor.group,
      track: product.track,
      releasesUrl: product.releasesUrl,
      versionSource: (row?.version_source as VersionSource | null | undefined) ?? null,
      previousVersion: row?.previous_version ?? null,
      versionChangedAt: row?.version_changed_at ?? null,
      probeError: row?.probe_error ?? null,
      intelRefreshedAt: row?.intel_refreshed_at ?? null,
      intelError: row?.intel_error ?? null,
      reasons: parseJson<string[]>(row?.urgency_reasons ?? '[]', []),
      vulnerabilities: vulns.map(toDto),
    };
  }

  async detail(monitorId: string): Promise<SoftwareDetail | null> {
    const monitor = this.#monitors.require(monitorId);
    if (!monitor.spec.software) return null;
    const [row, counts, vulns] = await Promise.all([
      this.#row(monitorId),
      this.#counts([monitorId]),
      this.#vulnsOf(monitorId),
    ]);
    return this.#detailOf(monitor, row, counts.get(monitorId) ?? EMPTY_COUNTS(), vulns);
  }

  async inventory(now = Date.now()): Promise<SoftwareInventory> {
    const tracked = this.#tracked();
    const ids = tracked.map((m) => m.id);
    const [rows, counts, last] = await Promise.all([
      ids.length
        ? this.#db.kysely.selectFrom('monitor_software').selectAll().where('monitor_id', 'in', ids).execute()
        : Promise.resolve([] as MonitorSoftwareRow[]),
      this.#counts(ids),
      this.#cache.get(LAST_REFRESH_KEY),
    ]);
    const byId = new Map(rows.map((r) => [r.monitor_id, r]));
    const totals = Object.fromEntries(URGENCY_LEVELS.map((l) => [l, 0])) as Record<UrgencyLevel, number>;
    const services = tracked
      .map((m) => {
        const { vulnerabilities: _v, ...rest } = this.#detailOf(
          m,
          byId.get(m.id),
          counts.get(m.id) ?? EMPTY_COUNTS(),
          [],
        );
        totals[rest.urgency ?? 'unknown']++;
        return rest;
      })
      .toSorted(
        (a, b) =>
          URGENCY_RANK[b.urgency ?? 'unknown'] - URGENCY_RANK[a.urgency ?? 'unknown'] ||
          (b.score ?? 0) - (a.score ?? 0) ||
          a.serviceName.localeCompare(b.serviceName),
      );
    return { generatedAt: now, lastRefreshAt: last?.fetched_at ?? null, services, totals };
  }

  async csv(): Promise<string> {
    const inv = await this.inventory();
    const q = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      'service,product,version,latest,cycle,eol,urgency,score,critical,high,medium,low,unknown,top_reason',
    ];
    for (const s of inv.services)
      lines.push(
        [
          s.serviceId,
          s.product,
          s.version,
          s.latest,
          s.cycle,
          s.eol,
          s.urgency,
          s.score,
          s.vulns?.critical ?? 0,
          s.vulns?.high ?? 0,
          s.vulns?.medium ?? 0,
          s.vulns?.low ?? 0,
          s.vulns?.unknown ?? 0,
          s.reasons[0] ?? '',
        ]
          .map(q)
          .join(','),
      );
    return `${lines.join('\n')}\n`;
  }

  /** Counts of services at critical and high urgency, for the overview banner. */
  async security(): Promise<{ critical: number; high: number }> {
    const rows = await this.#db.kysely
      .selectFrom('monitor_software')
      .select(['urgency_level'])
      .where('urgency_level', 'in', ['critical', 'high'])
      .execute();
    return {
      critical: rows.filter((r) => r.urgency_level === 'critical').length,
      high: rows.filter((r) => r.urgency_level === 'high').length,
    };
  }
}

export function toDto(v: MatchedVuln): VulnerabilityDto {
  const cve = [v.id, ...v.aliases].find((a) => /^CVE-/i.test(a));
  const osvId = v.sources.includes('osv')
    ? ([v.id, ...v.aliases].find((a) => !/^CVE-/i.test(a)) ?? v.id)
    : null;
  return {
    id: v.id,
    aliases: v.aliases,
    summary: v.summary,
    score: v.score,
    severity: v.severity,
    vector: v.vector,
    kev: v.kev,
    fixedIn: v.fixedIn,
    introduced: v.introduced,
    publishedAt: v.published,
    sources: v.sources,
    urls: {
      osv: v.sources.includes('osv')
        ? `https://osv.dev/vulnerability/${encodeURIComponent(osvId ?? v.id)}`
        : null,
      nvd: cve ? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}` : null,
    },
    references: v.references,
  };
}

export { SourceUnavailable };
