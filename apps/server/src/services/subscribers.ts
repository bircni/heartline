import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  Incident,
  IncidentUpdateDto,
  ServiceStatus,
  SubscriberDto,
  SubscriberEvent,
  SubscriptionDto,
  subscribeSchema,
  subscriberPrefsSchema,
} from '@heartline/shared';
import { SUBSCRIBER_EVENTS, markdownToText } from '@heartline/shared';
import { sql } from 'kysely';
import { createTransport } from 'nodemailer';
import type { z } from 'zod';
import type { NotifierConfig } from '../config/schema.ts';
import type { Db } from '../db/index.ts';
import type { SubscriberTable } from '../db/schema.ts';
import { type Mail, confirmMail, eventMail, manageMail } from '../notify/subscriber-mail.ts';
import { newId } from '../util/ids.ts';
import { log } from '../util/log.ts';
import type { AuditService } from './audit.ts';
import type { MaintenanceEvent } from './maintenance.ts';
import type { MonitorService } from './monitors.ts';
import { NotFoundError, ValidationError } from './monitors.ts';

/** Something subscribers may hear about, as stored in the outbox. */
export interface SubscriberMessage {
  type: SubscriberEvent;
  subject: string;
  /** Markdown. */
  body: string;
  url: string;
  /** Affected service ids; empty means everyone who chose this type. */
  services: string[];
  /** Followers of this incident get it whatever they chose. */
  incidentId?: string;
  at: number;
}

export interface MailTransport {
  sendMail(m: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    headers: Record<string, string>;
  }): Promise<unknown>;
}

type Purpose = 'confirm' | 'manage';
/** Confirmation and manage mails before notifications: someone is waiting for them. */
const sqlKindOrder = sql`case when kind = 'event' then 1 else 0 end`;
const BACKOFF = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];
const MAX_ATTEMPTS = 5;
/** A confirmation or manage link is not sent again to the same address within this time. */
const RESEND_MS = 5 * 60_000;

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString();

export interface SubscriberSettings {
  enabled: boolean;
  events: SubscriberEvent[];
  confirmTtlMs: number;
  ratePerMinute: number;
  /** The e-mail notifier whose mail server and sender are used; null disables e-mail. */
  mailer: Extract<NotifierConfig, { type: 'email' }> | null;
}

/**
 * Status page subscribers: double opt-in sign-up, signed links (confirm, manage, unsubscribe) and e-mail
 * delivery. Events go to an outbox that any replica writes; only the leader expands and sends them, at
 * most `ratePerMinute`, retrying failures with backoff.
 */
export class SubscriberService {
  readonly #db: Db;
  readonly #secret: string;
  readonly #monitors: MonitorService;
  readonly #transportFactory: (mailer: NonNullable<SubscriberSettings['mailer']>) => MailTransport;
  #transport: { key: string; t: MailTransport } | null = null;
  #allowance = 0;
  #lastRefill = 0;
  #timer: NodeJS.Timeout | null = null;
  #running: Promise<void> | null = null;
  settings: SubscriberSettings = {
    enabled: false,
    events: [],
    confirmTtlMs: 0,
    ratePerMinute: 60,
    mailer: null,
  };
  baseUrl: string;
  siteTitle = 'Status';
  isLeader: () => boolean = () => true;
  audit: AuditService | null = null;

  constructor(opts: {
    db: Db;
    secret: string;
    baseUrl: string;
    monitors: MonitorService;
    transportFactory?: (mailer: NonNullable<SubscriberSettings['mailer']>) => MailTransport;
  }) {
    this.#db = opts.db;
    this.#secret = opts.secret;
    this.baseUrl = opts.baseUrl;
    this.#monitors = opts.monitors;
    this.#transportFactory =
      opts.transportFactory ??
      ((m) =>
        createTransport({
          pool: true,
          host: m.smtp.host,
          port: m.smtp.port,
          secure: m.smtp.secure,
          ...(m.smtp.user ? { auth: { user: m.smtp.user, pass: m.smtp.password ?? '' } } : {}),
        }));
  }

  /** E-mail sign-up works: the feature is on and a mail server is configured. */
  get emailEnabled(): boolean {
    return this.settings.enabled && this.settings.mailer !== null;
  }

  // Links -------------------------------------------------------------------------------------------

  #sign(payload: string): string {
    return createHmac('sha256', this.#secret).update(`subscriber:${payload}`).digest('base64url');
  }

  /** A link token: purpose, subscriber, its token version and an expiry, signed with AUTH_SECRET. */
  token(purpose: Purpose, s: Pick<SubscriberTable, 'id' | 'token_version'>, expires = 0): string {
    const payload = `${purpose}.${s.id}.${s.token_version}.${expires}`;
    return `${b64(payload)}.${this.#sign(payload)}`;
  }

  async #verify(token: string | undefined, purpose: Purpose, now: number): Promise<SubscriberTable> {
    const invalid = new ValidationError('this link is invalid or has expired');
    const [p64, sig] = (token ?? '').split('.');
    if (!p64 || !sig) throw invalid;
    const payload = unb64(p64);
    const expected = Buffer.from(this.#sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid;
    const [kind, id, version, expires] = payload.split('.');
    if (kind !== purpose || !id) throw invalid;
    if (Number(expires) > 0 && Number(expires) < now) throw invalid;
    const s = await this.#db.kysely
      .selectFrom('subscribers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!s || s.token_version !== Number(version)) throw invalid;
    return s;
  }

  #link(path: string, token: string): string {
    return `${this.baseUrl}${path}?t=${encodeURIComponent(token)}`;
  }

  // Sign-up and self-service ---------------------------------------------------------------------------

  #events(chosen: SubscriberEvent[] | undefined): SubscriberEvent[] {
    const offered = this.settings.events;
    const list = chosen ? chosen.filter((e) => offered.includes(e)) : offered;
    return list.length ? list : offered;
  }

  /**
   * Signs an address up, or sends its manage link when it is already subscribed. Always succeeds
   * silently, so nobody can tell which addresses are subscribed.
   */
  async subscribe(input: z.output<typeof subscribeSchema>, now = Date.now()): Promise<void> {
    if (!this.emailEnabled) throw new ValidationError('e-mail subscriptions are not available');
    const email = input.email.trim().toLowerCase();
    const components =
      input.components === 'all' ? null : input.components.filter((id) => this.#monitors.get(id));
    const events = this.#events(input.events);
    const db = this.#db.kysely;
    let s = await db.selectFrom('subscribers').selectAll().where('email', '=', email).executeTakeFirst();
    if (s?.status === 'active') {
      if (!s.last_sent_at || now - s.last_sent_at > RESEND_MS) await this.#queue('manage', s.id, now);
      return;
    }
    await db.transaction().execute(async (trx) => {
      if (!s) {
        const row = {
          id: newId(),
          email,
          status: 'pending' as const,
          events: JSON.stringify(events),
          all_components: components ? 0 : 1,
          token_version: 1,
          created_at: now,
          confirmed_at: null,
          unsubscribed_at: null,
          last_sent_at: null,
          last_error: null,
        };
        await trx.insertInto('subscribers').values(row).execute();
        s = row;
      } else {
        await trx
          .updateTable('subscribers')
          .set({ status: 'pending', events: JSON.stringify(events), all_components: components ? 0 : 1 })
          .where('id', '=', s.id)
          .execute();
      }
      const id = s.id;
      await trx.deleteFrom('subscriber_components').where('subscriber_id', '=', id).execute();
      for (const c of components ?? [])
        await trx.insertInto('subscriber_components').values({ subscriber_id: id, monitor_id: c }).execute();
      if (input.incidentId)
        await trx
          .insertInto('subscriber_incidents')
          .values({ subscriber_id: id, incident_id: input.incidentId })
          .onConflict((oc) => oc.columns(['subscriber_id', 'incident_id']).doNothing())
          .execute();
    });
    const current = s as SubscriberTable;
    if (!current.last_sent_at || now - current.last_sent_at > RESEND_MS)
      await this.#queue('confirm', current.id, now);
  }

  /** Confirms a sign-up; returns the manage token, so the confirm page can lead on to the settings. */
  async confirm(token: string | undefined, now = Date.now()): Promise<{ manageToken: string }> {
    const s = await this.#verify(token, 'confirm', now);
    if (s.status !== 'active') {
      await this.#db.kysely
        .updateTable('subscribers')
        .set({ status: 'active', confirmed_at: now, unsubscribed_at: null })
        .where('id', '=', s.id)
        .execute();
      await this.audit?.record(
        { kind: 'subscriber', id: s.id, email: s.email },
        {
          action: 'subscriber.confirm',
          entityType: 'subscriber',
          entityId: s.id,
          summary: `${s.email} confirmed their subscription`,
        },
      );
    }
    return { manageToken: this.token('manage', s) };
  }

  async me(token: string | undefined, now = Date.now()): Promise<SubscriptionDto> {
    const s = await this.#verify(token, 'manage', now);
    return this.#subscription(s);
  }

  async #subscription(s: SubscriberTable): Promise<SubscriptionDto> {
    const db = this.#db.kysely;
    const [components, incidents] = await Promise.all([
      db.selectFrom('subscriber_components').select('monitor_id').where('subscriber_id', '=', s.id).execute(),
      db
        .selectFrom('subscriber_incidents')
        .innerJoin('incidents', 'incidents.id', 'subscriber_incidents.incident_id')
        .select(['incidents.id', 'incidents.title'])
        .where('subscriber_incidents.subscriber_id', '=', s.id)
        .execute(),
    ]);
    return {
      email: s.email,
      status: s.status,
      events: (JSON.parse(s.events) as SubscriberEvent[]).filter((e) => this.settings.events.includes(e)),
      components: s.all_components ? 'all' : components.map((c) => c.monitor_id),
      incidents,
      available: {
        events: this.settings.events,
        services: this.#monitors.list().map((m) => ({ id: m.id, name: m.name, group: m.group })),
      },
    };
  }

  async updatePrefs(
    token: string | undefined,
    prefs: z.output<typeof subscriberPrefsSchema>,
    now = Date.now(),
  ): Promise<SubscriptionDto> {
    const s = await this.#verify(token, 'manage', now);
    if (s.status === 'unsubscribed') throw new ValidationError('this address is unsubscribed; sign up again');
    await this.#db.kysely.transaction().execute(async (trx) => {
      if (prefs.events)
        await trx
          .updateTable('subscribers')
          .set({ events: JSON.stringify(this.#events(prefs.events)) })
          .where('id', '=', s.id)
          .execute();
      if (prefs.components) {
        await trx
          .updateTable('subscribers')
          .set({ all_components: prefs.components === 'all' ? 1 : 0 })
          .where('id', '=', s.id)
          .execute();
        await trx.deleteFrom('subscriber_components').where('subscriber_id', '=', s.id).execute();
        if (prefs.components !== 'all')
          for (const c of new Set(prefs.components))
            if (this.#monitors.get(c))
              await trx
                .insertInto('subscriber_components')
                .values({ subscriber_id: s.id, monitor_id: c })
                .execute();
      }
      if (prefs.incidents) {
        await trx.deleteFrom('subscriber_incidents').where('subscriber_id', '=', s.id).execute();
        for (const i of new Set(prefs.incidents))
          await trx
            .insertInto('subscriber_incidents')
            .values({ subscriber_id: s.id, incident_id: i })
            .execute();
      }
    });
    const fresh = await this.#db.kysely
      .selectFrom('subscribers')
      .selectAll()
      .where('id', '=', s.id)
      .executeTakeFirstOrThrow();
    return this.#subscription(fresh);
  }

  /** Unsubscribes; every link sent before stops working. */
  async unsubscribe(token: string | undefined, now = Date.now()): Promise<void> {
    const s = await this.#verify(token, 'manage', now);
    await this.#db.kysely
      .updateTable('subscribers')
      .set({ status: 'unsubscribed', unsubscribed_at: now, token_version: s.token_version + 1 })
      .where('id', '=', s.id)
      .execute();
    await this.#db.kysely
      .deleteFrom('subscriber_deliveries')
      .where('subscriber_id', '=', s.id)
      .where('status', '=', 'pending')
      .execute();
    await this.audit?.record(
      { kind: 'subscriber', id: s.id, email: s.email },
      {
        action: 'subscriber.unsubscribe',
        entityType: 'subscriber',
        entityId: s.id,
        summary: `${s.email} unsubscribed`,
      },
    );
  }

  /** Sends the manage link to an active subscriber; silent for anyone else. */
  async manageLink(email: string, now = Date.now()): Promise<void> {
    const s = await this.#db.kysely
      .selectFrom('subscribers')
      .selectAll()
      .where('email', '=', email.trim().toLowerCase())
      .executeTakeFirst();
    if (s?.status === 'active' && (!s.last_sent_at || now - s.last_sent_at > RESEND_MS))
      await this.#queue('manage', s.id, now);
  }

  async #queue(kind: 'confirm' | 'manage', subscriberId: string, now: number): Promise<void> {
    const id = newId();
    await this.#db.kysely
      .insertInto('subscriber_deliveries')
      .values({
        id,
        kind,
        event_id: null,
        subscriber_id: subscriberId,
        dedupe: id,
        status: 'pending',
        attempts: 0,
        next_attempt_at: now,
        locked_until: null,
        sent_at: null,
        error: null,
        created_at: now,
      })
      .execute();
    // Mark it right away, so a second request within RESEND_MS sends nothing more.
    await this.#db.kysely
      .updateTable('subscribers')
      .set({ last_sent_at: now })
      .where('id', '=', subscriberId)
      .execute();
  }

  // Admin -----------------------------------------------------------------------------------------------

  async list(): Promise<SubscriberDto[]> {
    const db = this.#db.kysely;
    const [rows, components, incidents] = await Promise.all([
      db.selectFrom('subscribers').selectAll().orderBy('created_at', 'desc').execute(),
      db.selectFrom('subscriber_components').selectAll().execute(),
      db.selectFrom('subscriber_incidents').selectAll().execute(),
    ]);
    return rows.map((s) => ({
      id: s.id,
      email: s.email,
      status: s.status,
      events: JSON.parse(s.events) as SubscriberEvent[],
      components: s.all_components
        ? 'all'
        : components.filter((c) => c.subscriber_id === s.id).map((c) => c.monitor_id),
      incidents: incidents.filter((i) => i.subscriber_id === s.id).length,
      createdAt: s.created_at,
      confirmedAt: s.confirmed_at,
      lastSentAt: s.last_sent_at,
      lastError: s.last_error,
    }));
  }

  async remove(id: string): Promise<string> {
    const s = await this.#db.kysely
      .selectFrom('subscribers')
      .select('email')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!s) throw new NotFoundError('subscriber not found');
    await this.#db.kysely.transaction().execute(async (trx) => {
      for (const table of ['subscriber_components', 'subscriber_incidents', 'subscriber_deliveries'] as const)
        await trx.deleteFrom(table).where('subscriber_id', '=', id).execute();
      await trx.deleteFrom('subscribers').where('id', '=', id).execute();
    });
    return s.email;
  }

  // Events ----------------------------------------------------------------------------------------------

  /** Puts a message in the outbox. Any replica may call it; a repeated dedupe key is ignored. */
  async emit(message: SubscriberMessage, dedupeKey: string, now = Date.now()): Promise<void> {
    if (!this.settings.enabled || !this.settings.events.includes(message.type)) return;
    try {
      await this.#db.kysely
        .insertInto('subscriber_events')
        .values({
          id: newId(),
          type: message.type,
          dedupe_key: dedupeKey,
          payload: JSON.stringify(message),
          created_at: now,
          expanded_at: null,
        })
        .onConflict((oc) => oc.column('dedupe_key').doNothing())
        .execute();
    } catch (error) {
      log.error('cannot queue subscriber notification', { error });
    }
  }

  /** Incident created or updated. People's incidents follow each update's notify switch. */
  async onIncident(e: {
    incident: Incident;
    update: IncidentUpdateDto;
    notify: boolean;
    postmortem?: boolean;
  }): Promise<void> {
    const i = e.incident;
    if (!i.automatic && !e.notify) return;
    const headline = e.postmortem
      ? `Postmortem: ${i.title}`
      : i.updates.length === 1 || e.update.id === i.updates.at(-1)?.id
        ? i.title
        : `${e.update.status === 'resolved' ? 'Resolved' : 'Update'}: ${i.title}`;
    const changes = e.update.components
      .map((c) => `- ${c.name}: ${c.newStatus.replace('_', ' ')}`)
      .join('\n');
    await this.emit(
      {
        type: i.automatic ? 'automaticIncidents' : 'incidents',
        subject: headline,
        body: `**${e.postmortem ? 'Postmortem' : e.update.status[0]?.toUpperCase() + e.update.status.slice(1)}**\n\n${e.update.message}${changes ? `\n\n${changes}` : ''}`,
        url: `${this.baseUrl}/incidents/${i.id}`,
        services: i.services.map((s) => s.id),
        incidentId: i.id,
        at: e.update.createdAt,
      },
      e.postmortem ? `pm:${i.id}:${e.update.createdAt}` : `inc:${i.id}:${e.update.id}`,
    );
  }

  async onMaintenance(e: MaintenanceEvent): Promise<void> {
    const m = e.maintenance;
    const prefix = {
      scheduled: 'Scheduled maintenance',
      reminder: 'Maintenance starts soon',
      started: 'Maintenance started',
      completed: 'Maintenance completed',
      update: 'Maintenance update',
    }[e.kind];
    const body = e.kind === 'scheduled' && m.description ? m.description : e.message;
    await this.emit(
      {
        type: 'maintenance',
        subject: `${prefix}: ${m.title}`,
        body,
        url: `${this.baseUrl}/maintenance/${m.id}`,
        services: m.services.map((s) => s.id),
        at: e.at,
      },
      `maint:${m.id}:${e.occurrence}:${e.kind}${e.kind === 'update' ? `:${e.at}` : ''}`,
    );
  }

  async onStatus(e: {
    service: { id: string; name: string };
    to: ServiceStatus;
    message: string | null;
    at: number;
  }): Promise<void> {
    const word = e.to === 'operational' ? 'is operational again' : e.to === 'down' ? 'is down' : `is ${e.to}`;
    await this.emit(
      {
        type: 'componentStatus',
        subject: `${e.service.name} ${word}`,
        body: e.message ?? '',
        url: `${this.baseUrl}/services/${e.service.id}`,
        services: [e.service.id],
        at: e.at,
      },
      `comp:${e.service.id}:${e.at}`,
    );
  }

  // Dispatch (leader) -----------------------------------------------------------------------------------

  start(): void {
    this.#timer = setInterval(() => {
      if (!this.isLeader() || this.#running) return;
      this.#running = this.dispatch()
        .catch((error) => log.error('subscriber dispatch failed', { error }))
        .finally(() => {
          this.#running = null;
        });
    }, 5_000);
    this.#timer.unref();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    await this.#running;
  }

  /** Expands new events into deliveries, then sends what is due within the rate limit. */
  async dispatch(now = Date.now()): Promise<void> {
    await this.#expand(now);
    await this.#send(now);
  }

  async #expand(now: number): Promise<void> {
    const db = this.#db.kysely;
    const events = await db
      .selectFrom('subscriber_events')
      .selectAll()
      .where('expanded_at', 'is', null)
      .orderBy('created_at')
      .limit(50)
      .execute();
    for (const ev of events) {
      const msg = JSON.parse(ev.payload) as SubscriberMessage;
      const claimed = await db
        .updateTable('subscriber_events')
        .set({ expanded_at: now })
        .where('id', '=', ev.id)
        .where('expanded_at', 'is', null)
        .executeTakeFirst();
      if (!Number(claimed.numUpdatedRows)) continue;
      if (!this.emailEnabled || !this.settings.events.includes(msg.type)) continue;
      const recipients = await this.#recipients(msg);
      for (const subscriberId of recipients)
        await db
          .insertInto('subscriber_deliveries')
          .values({
            id: newId(),
            kind: 'event',
            event_id: ev.id,
            subscriber_id: subscriberId,
            dedupe: `${ev.id}:${subscriberId}`,
            status: 'pending',
            attempts: 0,
            next_attempt_at: now,
            locked_until: null,
            sent_at: null,
            error: null,
            created_at: now,
          })
          .onConflict((oc) => oc.column('dedupe').doNothing())
          .execute();
    }
  }

  async #recipients(msg: SubscriberMessage): Promise<string[]> {
    const db = this.#db.kysely;
    const [active, components, followers] = await Promise.all([
      db
        .selectFrom('subscribers')
        .select(['id', 'events', 'all_components'])
        .where('status', '=', 'active')
        .execute(),
      msg.services.length
        ? db
            .selectFrom('subscriber_components')
            .select('subscriber_id')
            .where('monitor_id', 'in', msg.services)
            .execute()
        : Promise.resolve([]),
      msg.incidentId
        ? db
            .selectFrom('subscriber_incidents')
            .select('subscriber_id')
            .where('incident_id', '=', msg.incidentId)
            .execute()
        : Promise.resolve([]),
    ]);
    const overlap = new Set(components.map((c) => c.subscriber_id));
    const following = new Set(followers.map((f) => f.subscriber_id));
    return active
      .filter(
        (s) =>
          following.has(s.id) ||
          ((JSON.parse(s.events) as SubscriberEvent[]).includes(msg.type) &&
            (s.all_components || msg.services.length === 0 || overlap.has(s.id))),
      )
      .map((s) => s.id);
  }

  #mailer(): MailTransport | null {
    const m = this.settings.mailer;
    if (!m) return null;
    const key = JSON.stringify(m.smtp);
    if (this.#transport?.key !== key) this.#transport = { key, t: this.#transportFactory(m) };
    return this.#transport.t;
  }

  async #send(now: number): Promise<void> {
    const transport = this.#mailer();
    if (!transport || !this.settings.mailer) return;
    // Token bucket: up to ratePerMinute, refilled continuously.
    const rate = this.settings.ratePerMinute;
    this.#allowance = Math.min(
      rate,
      this.#allowance + ((now - (this.#lastRefill || now - 60_000)) / 60_000) * rate,
    );
    this.#lastRefill = now;
    const budget = Math.floor(this.#allowance);
    if (budget < 1) return;
    const db = this.#db.kysely;
    const due = await db
      .selectFrom('subscriber_deliveries')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb('status', '=', 'pending'),
          eb.and([eb('status', '=', 'sending'), eb('locked_until', '<', now)]),
        ]),
      )
      .where('next_attempt_at', '<=', now)
      // Confirmation and manage links first: someone is waiting for them.
      .orderBy(sqlKindOrder)
      .orderBy('created_at')
      .limit(budget)
      .execute();
    for (const d of due) {
      const claim = await db
        .updateTable('subscriber_deliveries')
        .set({ status: 'sending', locked_until: now + 5 * 60_000 })
        .where('id', '=', d.id)
        .where('status', '=', d.status)
        .executeTakeFirst();
      if (!Number(claim.numUpdatedRows)) continue;
      this.#allowance -= 1;
      const s = await db
        .selectFrom('subscribers')
        .selectAll()
        .where('id', '=', d.subscriber_id)
        .executeTakeFirst();
      if (!s || (d.kind === 'event' && s.status !== 'active')) {
        await db.deleteFrom('subscriber_deliveries').where('id', '=', d.id).execute();
        continue;
      }
      try {
        const mail = await this.#compose(d.kind, d.event_id, s, now);
        await transport.sendMail({ from: this.settings.mailer.from, to: s.email, ...mail });
        await db
          .updateTable('subscriber_deliveries')
          .set({ status: 'sent', sent_at: now, error: null, attempts: d.attempts + 1 })
          .where('id', '=', d.id)
          .execute();
        await db
          .updateTable('subscribers')
          .set({ last_sent_at: now, last_error: null })
          .where('id', '=', s.id)
          .execute();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attempts = d.attempts + 1;
        log.warn('subscriber e-mail failed', { attempts, error: message });
        await db
          .updateTable('subscriber_deliveries')
          .set({
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            attempts,
            error: message,
            locked_until: null,
            next_attempt_at: now + (BACKOFF[attempts - 1] ?? BACKOFF.at(-1) ?? 60_000),
          })
          .where('id', '=', d.id)
          .execute();
        await db.updateTable('subscribers').set({ last_error: message }).where('id', '=', s.id).execute();
      }
    }
  }

  async #compose(
    kind: 'event' | 'confirm' | 'manage',
    eventId: string | null,
    s: SubscriberTable,
    now: number,
  ): Promise<Mail> {
    const site = this.siteTitle;
    if (kind === 'confirm') {
      const token = this.token('confirm', s, now + this.settings.confirmTtlMs);
      return confirmMail(
        site,
        this.#link('/subscriptions/confirm', token),
        Math.round(this.settings.confirmTtlMs / 3_600_000),
      );
    }
    const manage = this.token('manage', s);
    if (kind === 'manage') return manageMail(site, this.#link('/subscriptions/manage', manage));
    const ev = await this.#db.kysely
      .selectFrom('subscriber_events')
      .select('payload')
      .where('id', '=', eventId as string)
      .executeTakeFirstOrThrow();
    const msg = JSON.parse(ev.payload) as SubscriberMessage;
    return eventMail(
      site,
      {
        subject: msg.subject,
        body: msg.body || markdownToText(msg.subject),
        url: msg.url,
        when: new Date(msg.at).toUTCString(),
      },
      {
        manage: this.#link('/subscriptions/manage', manage),
        unsubscribe: this.#link('/subscriptions/manage', manage) + '&unsubscribe=1',
        oneClick: `${this.baseUrl}/api/v1/subscribers/unsubscribe?t=${encodeURIComponent(manage)}`,
      },
    );
  }

  /** Drops sent and failed deliveries and expanded events older than `days`. */
  async prune(days = 30, now = Date.now()): Promise<void> {
    const before = now - days * 86_400_000;
    await this.#db.kysely
      .deleteFrom('subscriber_deliveries')
      .where('status', 'in', ['sent', 'failed'])
      .where('created_at', '<', before)
      .execute();
    await this.#db.kysely.deleteFrom('subscriber_events').where('expanded_at', '<', before).execute();
  }

  /** The offered event types, for the sign-up form. */
  static offered(cfg: {
    incidents: boolean;
    automaticIncidents: boolean;
    maintenance: boolean;
    componentStatus: boolean;
  }): SubscriberEvent[] {
    return SUBSCRIBER_EVENTS.filter((e) => cfg[e]);
  }
}
