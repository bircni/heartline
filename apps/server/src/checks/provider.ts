import { type MonitorSpec, type ProviderPreset, findProvider } from '@heartline/shared';
import { USER_AGENT } from '../util/pkg.ts';
import { type CheckOutcome, errorMessage } from './types.ts';

type ProviderSpec = Extract<MonitorSpec, { type: 'provider' }>;
type Level = 'up' | 'maintenance' | 'degraded' | 'down';

const RANK: Record<Level, number> = { up: 0, maintenance: 1, degraded: 2, down: 3 };
const FEED_WINDOW = 6 * 3_600_000;
const MAX_MESSAGE = 480;

/** Microsoft endpoints; tests point them at a local server. */
export const m365Endpoints = {
  login: 'https://login.microsoftonline.com',
  graph: 'https://graph.microsoft.com',
};

/** A status that could not be read: neither up nor down. */
class Unreadable extends Error {}

interface Finding {
  level: Level;
  /** Affected component, product or service with its state, e.g. `Search (partial outage)`. */
  label?: string;
  /** Open incident or maintenance title, optionally with a link. */
  note?: string;
}

const worst = (findings: Finding[]): Level =>
  findings.reduce<Level>((acc, f) => (RANK[f.level] > RANK[acc] ? f.level : acc), 'up');

const norm = (s: string) => s.trim().toLowerCase();

function matcher(components: string[]): (name: string) => boolean {
  const wanted = new Set(components.map(norm));
  return (name) => wanted.size === 0 || wanted.has(norm(name));
}

/** Names from `components` that none of `available` matched (case-insensitive). */
function missing(components: string[], available: Iterable<string>): string[] {
  const have = new Set([...available].map(norm));
  return components.filter((c) => !have.has(norm(c)));
}

function summarize(findings: Finding[]): string | null {
  const labels = [...new Set(findings.filter((f) => f.label && f.level !== 'up').map((f) => f.label))];
  const notes = [...new Set(findings.map((f) => f.note).filter((n): n is string => Boolean(n)))];
  const parts = [labels.join(', '), notes.join(' · ')].filter(Boolean);
  if (!parts.length) return null;
  const text = parts.join(' – ');
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

async function getJson(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers },
    signal,
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Unreadable(`status source answered HTTP ${res.status}`);
  }
  const text = await res.text();
  try {
    // Some providers send a byte order mark.
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Unreadable('status source did not return JSON');
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

// --- Atlassian Statuspage -------------------------------------------------------------------

const SP_LEVEL: Record<string, Level> = {
  operational: 'up',
  under_maintenance: 'maintenance',
  degraded_performance: 'degraded',
  partial_outage: 'degraded',
  major_outage: 'down',
};

function statuspageUrl(base: string): string {
  if (/\.json(\?|$)/.test(base)) return base;
  return `${base.replace(/\/+$/, '')}/api/v2/summary.json`;
}

export function evaluateStatuspage(body: unknown, components: string[]): Finding[] {
  if (!isObj(body) || !Array.isArray(body.components)) throw new Unreadable('not a Statuspage summary');
  const all = body.components.filter(isObj).map((c) => ({
    id: String(c.id ?? ''),
    name: String(c.name ?? ''),
    status: String(c.status ?? 'operational'),
    group: c.group === true,
    groupId: str(c.group_id),
  }));
  const match = matcher(components);
  const unknown = missing(
    components,
    all.map((c) => c.name),
  );
  if (unknown.length) throw new Unreadable(`no component named ${unknown.join(', ')}`);

  // A selected group selects its members; groups themselves only mirror their members.
  const groupIds = new Set(all.filter((c) => c.group && match(c.name)).map((c) => c.id));
  const selected = all.filter(
    (c) => !c.group && (components.length === 0 || match(c.name) || (c.groupId && groupIds.has(c.groupId))),
  );
  const ids = new Set(selected.map((c) => c.id));
  const findings: Finding[] = selected.map((c) => ({
    level: SP_LEVEL[c.status] ?? 'degraded',
    label: `${c.name} (${c.status.replaceAll('_', ' ')})`,
  }));

  const touches = (item: Record<string, unknown>) =>
    components.length === 0 ||
    (Array.isArray(item.components) && item.components.some((c) => isObj(c) && ids.has(String(c.id))));
  for (const i of Array.isArray(body.incidents) ? body.incidents.filter(isObj) : []) {
    if (i.status === 'resolved' || i.status === 'postmortem' || !touches(i)) continue;
    const impact = String(i.impact ?? 'none');
    findings.push({
      // Component states carry the real impact; an incident without components still matters.
      level: impact === 'critical' ? 'down' : impact === 'none' ? 'up' : 'degraded',
      note: [str(i.name), str(i.shortlink)].filter(Boolean).join(' '),
    });
  }
  for (const m of Array.isArray(body.scheduled_maintenances)
    ? body.scheduled_maintenances.filter(isObj)
    : []) {
    if ((m.status !== 'in_progress' && m.status !== 'verifying') || !touches(m)) continue;
    findings.push({
      level: 'maintenance',
      note: `Maintenance: ${[str(m.name), str(m.shortlink)].filter(Boolean).join(' ')}`,
    });
  }
  // Pages without components report through the overall indicator only.
  if (all.length === 0 && isObj(body.status)) {
    const indicator = String(body.status.indicator ?? 'none');
    const level: Level =
      indicator === 'critical'
        ? 'down'
        : indicator === 'major' || indicator === 'minor'
          ? 'degraded'
          : indicator === 'maintenance'
            ? 'maintenance'
            : 'up';
    findings.push({ level, label: str(body.status.description) ?? undefined });
  }
  return findings;
}

// --- Google Workspace / Google Cloud --------------------------------------------------------

export function evaluateGoogle(
  body: unknown,
  components: string[],
  base: string,
  now = Date.now(),
): Finding[] {
  if (!Array.isArray(body)) throw new Unreadable('not a Google incidents list');
  const match = matcher(components);
  const findings: Finding[] = [];
  for (const i of body.filter(isObj)) {
    if (i.end) continue;
    const begin = Date.parse(String(i.begin ?? ''));
    if (Number.isFinite(begin) && begin > now) continue;
    const products = (Array.isArray(i.affected_products) ? i.affected_products : [])
      .filter(isObj)
      .map((p) => String(p.title ?? ''))
      .filter(Boolean);
    const hit = components.length === 0 ? products : products.filter(match);
    if (components.length && hit.length === 0) continue;
    const impact = String(i.status_impact ?? '');
    const severity = String(i.severity ?? '');
    const level: Level =
      impact === 'SERVICE_OUTAGE' || (!impact && severity === 'high')
        ? 'down'
        : impact === 'SERVICE_DISRUPTION' || (!impact && severity === 'medium')
          ? 'degraded'
          : 'up';
    const link = str(i.uri) ? new URL(String(i.uri), base).href : null;
    findings.push({
      level,
      label: hit.length ? hit.join(', ') : undefined,
      note: [str(i.external_desc)?.split('\n')[0], link].filter(Boolean).join(' '),
    });
  }
  return findings;
}

// --- Slack ------------------------------------------------------------------------------------

export function evaluateSlack(body: unknown, components: string[]): Finding[] {
  if (!isObj(body) || !Array.isArray(body.active_incidents))
    throw new Unreadable('not a Slack status response');
  const match = matcher(components);
  const findings: Finding[] = [];
  for (const i of body.active_incidents.filter(isObj)) {
    if (i.status && i.status !== 'active') continue;
    const services = (Array.isArray(i.services) ? i.services : []).map(String);
    const hit = components.length === 0 ? services : services.filter(match);
    if (components.length && hit.length === 0) continue;
    const type = String(i.type ?? 'incident');
    findings.push({
      level: type === 'outage' ? 'down' : type === 'incident' ? 'degraded' : 'up',
      label: hit.length ? hit.join(', ') : undefined,
      note: [str(i.title), str(i.url)].filter(Boolean).join(' '),
    });
  }
  return findings;
}

// --- Microsoft 365 service health (Graph) ----------------------------------------------------

const M365_LEVEL: Record<string, Level> = {
  serviceOperational: 'up',
  serviceRestored: 'up',
  falsePositive: 'up',
  postIncidentReviewPublished: 'up',
  resolved: 'up',
  resolvedExternal: 'up',
  mitigated: 'up',
  mitigatedExternal: 'up',
  serviceInterruption: 'down',
};

export function evaluateM365(overviews: unknown, issues: unknown, components: string[]): Finding[] {
  if (!isObj(overviews) || !Array.isArray(overviews.value))
    throw new Unreadable('not a Graph health overview');
  const rows = overviews.value.filter(isObj).map((o) => ({
    id: String(o.id ?? ''),
    service: String(o.service ?? ''),
    status: String(o.status ?? 'serviceOperational'),
  }));
  const unknown = missing(components, [...rows.map((r) => r.service), ...rows.map((r) => r.id)]);
  if (unknown.length) throw new Unreadable(`no Microsoft 365 service named ${unknown.join(', ')}`);
  const match = matcher(components);
  const selected = rows.filter((r) => match(r.service) || match(r.id));
  const names = new Set(selected.flatMap((r) => [norm(r.service), norm(r.id)]));
  const findings: Finding[] = selected.map((r) => ({
    // Degradation, investigations and recovery phases are all partial impact.
    level: M365_LEVEL[r.status] ?? 'degraded',
    label: `${r.service} (${r.status.replace(/([A-Z])/g, ' $1').toLowerCase()})`,
  }));
  const open = isObj(issues) && Array.isArray(issues.value) ? issues.value.filter(isObj) : [];
  for (const i of open) {
    if (i.isResolved === true || !names.has(norm(String(i.service ?? '')))) continue;
    const title = [str(i.id), str(i.title)].filter(Boolean).join(': ');
    if (title) findings.push({ level: 'up', note: title });
  }
  return findings;
}

const tokens = new Map<string, { token: string; expires: number }>();

async function m365Token(cfg: NonNullable<ProviderSpec['m365']>, signal: AbortSignal): Promise<string> {
  const key = `${cfg.tenantId}/${cfg.clientId}`;
  const cached = tokens.get(key);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch(`${m365Endpoints.login}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'user-agent': USER_AGENT, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: `${m365Endpoints.graph}/.default`,
      grant_type: 'client_credentials',
    }),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.access_token !== 'string') {
    const reason = str(body.error_description)?.split('\n')[0] ?? str(body.error) ?? `HTTP ${res.status}`;
    throw new Unreadable(`Microsoft sign-in failed: ${reason}`);
  }
  tokens.set(key, {
    token: body.access_token,
    expires: Date.now() + Number(body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

async function checkM365(spec: ProviderSpec, signal: AbortSignal): Promise<Finding[]> {
  if (!spec.m365) throw new Unreadable('m365 credentials are missing');
  const token = await m365Token(spec.m365, signal);
  const auth = { authorization: `Bearer ${token}` };
  const base = `${m365Endpoints.graph}/v1.0/admin/serviceAnnouncement`;
  const overviews = await getJson(`${base}/healthOverviews`, signal, auth).catch((error: unknown) => {
    if (error instanceof Unreadable && error.message.endsWith('401'))
      tokens.delete(`${spec.m365?.tenantId}/${spec.m365?.clientId}`);
    throw error;
  });
  // Issue titles are a nice-to-have; the overview alone decides the status.
  const issues = await getJson(
    `${base}/issues?$filter=${encodeURIComponent('isResolved eq false')}`,
    signal,
    auth,
  ).catch(() => null);
  return evaluateM365(overviews, issues, spec.components);
}

// --- RSS / Atom ------------------------------------------------------------------------------

const decode = (s: string) =>
  s
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? decode(m[1] as string) : null;
}

export function parseFeed(xml: string): { title: string; link: string | null; at: number | null }[] {
  const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return items.map((item) => {
    const href = /<link[^>]*\bhref="([^"]+)"/i.exec(item)?.[1] ?? null;
    const date =
      tag(item, 'pubDate') ?? tag(item, 'updated') ?? tag(item, 'published') ?? tag(item, 'dc:date');
    const at = date ? Date.parse(date) : Number.NaN;
    return {
      title: tag(item, 'title') ?? '(untitled)',
      link: href ? decode(href) : tag(item, 'link'),
      at: Number.isFinite(at) ? at : null,
    };
  });
}

const RESOLVED = /\b(resolved|completed|mitigated|restored)\b/i;

export function evaluateFeed(
  xml: string,
  components: string[],
  window: number | null,
  now = Date.now(),
): Finding[] {
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) throw new Unreadable('not an RSS or Atom feed');
  const wanted = components.map(norm);
  return parseFeed(xml)
    .filter((i) => window === null || (i.at !== null && now - i.at <= window))
    .filter((i) => !RESOLVED.test(i.title))
    .filter((i) => wanted.length === 0 || wanted.some((w) => norm(i.title).includes(w)))
    .map((i) => ({ level: 'degraded' as const, note: [i.title, i.link].filter(Boolean).join(' ') }));
}

async function checkFeed(spec: ProviderSpec, url: string, signal: AbortSignal): Promise<Finding[]> {
  const res = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/rss+xml, application/atom+xml, application/xml',
    },
    signal,
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Unreadable(`status source answered HTTP ${res.status}`);
  }
  // The Azure feed only lists open issues; other feeds keep their history.
  const window = spec.window ?? (spec.provider === 'azure' ? null : FEED_WINDOW);
  return evaluateFeed(await res.text(), spec.components, window);
}

// ---------------------------------------------------------------------------------------------

export function providerUrl(spec: ProviderSpec, preset: ProviderPreset): string | null {
  return spec.url ?? preset.url;
}

export async function checkProvider(spec: ProviderSpec, signal: AbortSignal): Promise<CheckOutcome> {
  const preset = findProvider(spec.provider);
  if (!preset) return { status: 'unknown', latencyMs: null, message: `unknown provider "${spec.provider}"` };
  const url = providerUrl(spec, preset);
  try {
    let findings: Finding[];
    if (preset.kind === 'm365') findings = await checkM365(spec, signal);
    else if (!url) throw new Unreadable('no status URL configured');
    else if (preset.kind === 'feed') findings = await checkFeed(spec, url, signal);
    else if (preset.kind === 'statuspage')
      findings = evaluateStatuspage(await getJson(statuspageUrl(url), signal), spec.components);
    else if (preset.kind === 'google')
      findings = evaluateGoogle(await getJson(url, signal), spec.components, preset.homepage ?? url);
    else findings = evaluateSlack(await getJson(url, signal), spec.components);
    const level = worst(findings);
    return { status: level, latencyMs: null, message: summarize(findings) };
  } catch (error) {
    const reason = error instanceof Unreadable ? error.message : errorMessage(error);
    return { status: 'unknown', latencyMs: null, message: `status unavailable: ${reason}` };
  }
}
