import { markdownToText } from '@heartline/shared';
import type {
  ComponentStatus,
  Incident,
  IncidentUpdateDto,
  Maintenance,
  NotifierDto,
  ServiceRef,
  ServiceStatus,
  UrgencyLevel,
} from '@heartline/shared';
import { createTransport } from 'nodemailer';
import type { NotifierConfig } from '../config/schema.ts';
import type { Db } from '../db/index.ts';
import { log } from '../util/log.ts';

export type NotificationEvent =
  | {
      kind: 'status';
      service: { id: string; name: string };
      from: ServiceStatus;
      to: ServiceStatus;
      message: string | null;
      at: number;
      reminder?: boolean;
    }
  | { kind: 'incident'; incident: Incident; update: IncidentUpdateDto }
  | {
      kind: 'maintenance';
      maintenance: Maintenance;
      event: 'scheduled' | 'reminder' | 'started' | 'completed' | 'update';
      /** Markdown. */
      message: string;
      at: number;
    }
  | {
      kind: 'vulnerability';
      service: ServiceRef;
      product: string;
      version: string | null;
      previousVersion: string | null;
      latest: string | null;
      /** Release page of the latest version, when known. */
      latestUrl: string | null;
      urgency: { level: UrgencyLevel; score: number; reasons: string[] };
      newVulns: { id: string; score: number | null; kev: boolean; fixedIn: string | null }[];
      trigger: 'new-vulns' | 'urgency' | 'version-change';
      at: number;
    }
  | { kind: 'test'; at: number };

export interface RenderedMessage {
  title: string;
  text: string;
  facts: [string, string][];
  /** Adaptive Card colour token: Good, Warning, Attention, Accent. */
  tone: 'Good' | 'Warning' | 'Attention' | 'Accent';
  url: string | null;
}

const STATUS_LABEL: Record<ServiceStatus, string> = {
  operational: 'operational',
  degraded: 'degraded',
  partial: 'partly down',
  down: 'down',
  maintenance: 'in maintenance',
  paused: 'paused',
  unknown: 'unknown',
};

const COMPONENT_LABEL: Record<ComponentStatus, string> = {
  operational: 'operational',
  degraded: 'degraded',
  partial: 'partial outage',
  down: 'major outage',
};

export function render(event: NotificationEvent, baseUrl: string, siteTitle: string): RenderedMessage {
  if (event.kind === 'test') {
    return {
      title: `${siteTitle}: test notification`,
      text: 'If you can read this, the channel works.',
      facts: [],
      tone: 'Accent',
      url: baseUrl,
    };
  }
  if (event.kind === 'status') {
    const recovered = event.to === 'operational';
    const title = recovered
      ? `${event.service.name} recovered`
      : `${event.reminder ? 'Still ' : ''}${event.service.name} is ${STATUS_LABEL[event.to]}`;
    return {
      title,
      text: event.message ?? (recovered ? 'All checks are passing again.' : 'Checks are failing.'),
      facts: [
        ['Service', event.service.name],
        ['Status', `${STATUS_LABEL[event.from]} → ${STATUS_LABEL[event.to]}`],
        ['Time', new Date(event.at).toISOString()],
      ],
      tone: recovered ? 'Good' : event.to === 'down' ? 'Attention' : 'Warning',
      url: `${baseUrl}/services/${encodeURIComponent(event.service.id)}`,
    };
  }
  if (event.kind === 'vulnerability') {
    const { service, urgency } = event;
    const n = event.newVulns.length;
    const title =
      event.trigger === 'version-change'
        ? `${service.name} updated to ${event.version ?? 'unknown version'}`
        : event.trigger === 'new-vulns'
          ? `${service.name}: ${n} new vulnerabilit${n === 1 ? 'y' : 'ies'} (${urgency.level})`
          : `${service.name} needs an update: ${urgency.level}`;
    const text =
      event.trigger === 'version-change'
        ? `Version changed from ${event.previousVersion ?? 'unknown'} to ${event.version ?? 'unknown'}.`
        : urgency.reasons.slice(0, 5).join('\n') || 'No details.';
    const facts: [string, string][] = [
      ['Product', event.product],
      ['Version', event.version ?? 'unknown'],
      ['Urgency', `${urgency.level} (${urgency.score}/100)`],
    ];
    if (event.latest && event.latest !== event.version) facts.push(['Latest', event.latest]);
    const fix = event.newVulns.map((v) => v.fixedIn).find((f) => f);
    if (fix) facts.push(['Fixed in', fix]);
    if (event.latestUrl) facts.push(['Release notes', event.latestUrl]);
    return {
      title,
      text: event.latestUrl ? `${text}\n${event.latestUrl}` : text,
      facts,
      tone:
        urgency.level === 'critical' || urgency.level === 'high'
          ? 'Attention'
          : urgency.level === 'medium'
            ? 'Warning'
            : 'Accent',
      url: `${baseUrl}/services/${encodeURIComponent(service.id)}`,
    };
  }
  if (event.kind === 'maintenance') {
    const m = event.maintenance;
    const start = m.nextStartsAt ?? m.startsAt;
    const end = m.nextEndsAt ?? m.endsAt;
    const title = {
      scheduled: `Maintenance scheduled: ${m.title}`,
      reminder: `Maintenance starts soon: ${m.title}`,
      started: `Maintenance started: ${m.title}`,
      completed: `Maintenance completed: ${m.title}`,
      update: `Maintenance update: ${m.title}`,
    }[event.event];
    return {
      title,
      text: markdownToText(event.event === 'scheduled' && m.description ? m.description : event.message),
      facts: [
        ['When', `${new Date(start).toISOString()} – ${new Date(end).toISOString()}`],
        ['Status', m.status.replace('_', ' ')],
        ['Affected', m.services.map((s) => s.name).join(', ') || 'all services'],
      ],
      tone: event.event === 'completed' ? 'Good' : 'Accent',
      url: `${baseUrl}/maintenance/${m.id}`,
    };
  }
  const { incident, update } = event;
  const facts: [string, string][] = [
    ['Impact', incident.impact],
    [
      'Affected',
      incident.services.map((s) => `${s.name} (${COMPONENT_LABEL[s.status]})`).join(', ') || 'none listed',
    ],
  ];
  if (update.components.length)
    facts.push([
      'Changed',
      update.components
        .map(
          (c) =>
            `${c.name}: ${c.oldStatus ? `${COMPONENT_LABEL[c.oldStatus]} → ` : ''}${COMPONENT_LABEL[c.newStatus]}`,
        )
        .join(', '),
    ]);
  return {
    title: `${incident.title}: ${update.status}`,
    text: markdownToText(update.message),
    facts,
    tone: update.status === 'resolved' ? 'Good' : incident.impact === 'major' ? 'Attention' : 'Warning',
    url: `${baseUrl}/incidents/${incident.id}`,
  };
}

/** Payload for a Teams "post to a channel when a webhook request is received" workflow. */
export function teamsPayload(m: RenderedMessage): unknown {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: m.title, weight: 'Bolder', size: 'Medium', color: m.tone, wrap: true },
            { type: 'TextBlock', text: m.text, wrap: true },
            ...(m.facts.length
              ? [{ type: 'FactSet', facts: m.facts.map(([title, value]) => ({ title, value })) }]
              : []),
          ],
          actions: m.url ? [{ type: 'Action.OpenUrl', title: 'Open status page', url: m.url }] : [],
        },
      },
    ],
  };
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return '…';
  }
}

export class NotifierService {
  #db: Db;
  #notifiers: NotifierConfig[] = [];
  #baseUrl: string;
  #siteTitle = 'Status';
  #fetch: typeof fetch;

  constructor(db: Db, baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.#db = db;
    this.#baseUrl = baseUrl;
    this.#fetch = fetchImpl;
  }

  configure(notifiers: NotifierConfig[], siteTitle: string): void {
    this.#notifiers = notifiers;
    this.#siteTitle = siteTitle;
  }

  has(id: string): boolean {
    return this.#notifiers.some((n) => n.id === id);
  }

  async list(): Promise<NotifierDto[]> {
    const states = await this.#db.kysely.selectFrom('notifier_state').selectAll().execute();
    return this.#notifiers.map((n) => {
      const st = states.find((s) => s.notifier_id === n.id);
      const target =
        n.type === 'teams'
          ? maskUrl(n.webhookUrl)
          : n.type === 'webhook'
            ? maskUrl(n.url)
            : `${n.smtp.host}:${n.smtp.port} → ${n.to.join(', ')}`;
      return {
        id: n.id,
        type: n.type,
        target,
        lastSentAt: st?.last_sent_at ?? null,
        lastError: st?.last_error ?? null,
      };
    });
  }

  /** Sends to the given notifiers (all configured notifiers when `ids` is empty). Never throws. */
  async send(event: NotificationEvent, ids: string[] = []): Promise<void> {
    const targets = ids.length ? this.#notifiers.filter((n) => ids.includes(n.id)) : this.#notifiers;
    const message = render(event, this.#baseUrl, this.#siteTitle);
    await Promise.all(targets.map((n) => this.#deliver(n, message, event)));
  }

  async test(id: string): Promise<{ ok: boolean; error: string | null }> {
    const n = this.#notifiers.find((x) => x.id === id);
    if (!n) return { ok: false, error: `notifier "${id}" not found` };
    const error = await this.#deliver(
      n,
      render({ kind: 'test', at: Date.now() }, this.#baseUrl, this.#siteTitle),
      { kind: 'test', at: Date.now() },
    );
    return { ok: error === null, error };
  }

  async #deliver(n: NotifierConfig, m: RenderedMessage, event: NotificationEvent): Promise<string | null> {
    let error: string | null = null;
    try {
      if (n.type === 'teams') await this.#post(n.webhookUrl, teamsPayload(m), {});
      else if (n.type === 'webhook')
        await this.#post(
          n.url,
          { event: event.kind, title: m.title, text: m.text, url: m.url, data: event },
          n.headers,
        );
      else {
        const transport = createTransport({
          host: n.smtp.host,
          port: n.smtp.port,
          secure: n.smtp.secure,
          ...(n.smtp.user ? { auth: { user: n.smtp.user, pass: n.smtp.password ?? '' } } : {}),
        });
        const lines = [m.text, '', ...m.facts.map(([k, v]) => `${k}: ${v}`), ...(m.url ? ['', m.url] : [])];
        await transport.sendMail({ from: n.from, to: n.to, subject: m.title, text: lines.join('\n') });
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      log.warn('notification failed', { notifier: n.id, error });
    }
    await this.#db.kysely
      .insertInto('notifier_state')
      .values({ notifier_id: n.id, last_sent_at: Date.now(), last_error: error })
      .onConflict((oc) =>
        oc.column('notifier_id').doUpdateSet({ last_sent_at: Date.now(), last_error: error }),
      )
      .execute();
    return error;
  }

  async #post(url: string, body: unknown, headers: Record<string, string>): Promise<void> {
    const res = await this.#fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
