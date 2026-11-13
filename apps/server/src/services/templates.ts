import type { ComponentStatus, Impact, IncidentStatus, TemplateDto, templateSchema } from '@heartline/shared';
import type { z } from 'zod';
import type { AppConfig } from '../config/schema.ts';
import type { Db } from '../db/index.ts';
import type { TemplateTable } from '../db/schema.ts';
import { slugify } from '../util/slug.ts';
import { ConflictError, NotFoundError } from './monitors.ts';

export type TemplateInput = z.output<typeof templateSchema>;

const toDto = (r: TemplateTable): TemplateDto => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  title: r.title,
  body: r.body,
  status: r.status as IncidentStatus | null,
  impact: r.impact as Impact | null,
  services: (JSON.parse(r.services) as (string | { id: string; status: ComponentStatus })[]).map((s) =>
    typeof s === 'string' ? { id: s, status: null } : s,
  ),
  durationMs: r.duration_ms,
  source: r.source,
});

const columns = (t: TemplateInput) => ({
  kind: t.kind,
  name: t.name,
  title: t.title,
  body: t.body,
  status: t.kind === 'incident' ? (t.status ?? null) : null,
  impact: t.kind === 'incident' ? (t.impact ?? null) : null,
  services: JSON.stringify(t.services),
  duration_ms: t.kind === 'maintenance' ? (t.duration ?? null) : null,
});

/** Incident and maintenance templates: from status.yaml (read-only in the UI) or created in the UI and API. */
export class TemplateService {
  readonly #db: Db;
  #templates: TemplateDto[] = [];

  constructor(db: Db) {
    this.#db = db;
  }

  list(kind?: TemplateDto['kind']): TemplateDto[] {
    return kind ? this.#templates.filter((t) => t.kind === kind) : this.#templates;
  }

  require(id: string): TemplateDto {
    const t = this.#templates.find((x) => x.id === id);
    if (!t) throw new NotFoundError(`template "${id}" not found`);
    return t;
  }

  async reload(): Promise<void> {
    const rows = await this.#db.kysely
      .selectFrom('templates')
      .selectAll()
      .orderBy('position')
      .orderBy('name')
      .execute();
    this.#templates = rows.map(toDto);
  }

  /** Makes templates from status.yaml match the file; templates created in the UI are left alone. */
  async reconcile(config: AppConfig, now = Date.now()): Promise<void> {
    const wanted = config.templates.map((t) => ({ ...t, id: t.id ?? slugify(t.name) }));
    await this.#db.kysely.transaction().execute(async (trx) => {
      for (const [i, t] of wanted.entries()) {
        const row = { ...columns(t), source: 'config' as const, position: i, updated_at: now };
        await trx
          .insertInto('templates')
          .values({ id: t.id, ...row, created_at: now })
          .onConflict((oc) => oc.column('id').doUpdateSet(row))
          .execute();
      }
      let q = trx.deleteFrom('templates').where('source', '=', 'config');
      if (wanted.length)
        q = q.where(
          'id',
          'not in',
          wanted.map((t) => t.id),
        );
      await q.execute();
    });
    await this.reload();
  }

  async create(input: TemplateInput, now = Date.now()): Promise<TemplateDto> {
    const base = input.id ?? slugify(input.name);
    if (input.id && this.#templates.some((t) => t.id === base))
      throw new ConflictError(`a template with id "${base}" already exists`);
    let id = base;
    for (let n = 2; this.#templates.some((t) => t.id === id); n++) id = `${base}-${n}`;
    await this.#db.kysely
      .insertInto('templates')
      .values({
        id,
        ...columns(input),
        source: 'db',
        position: 100_000 + this.#templates.length,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await this.reload();
    return this.require(id);
  }

  async update(id: string, input: TemplateInput, now = Date.now()): Promise<TemplateDto> {
    if (this.require(id).source === 'config')
      throw new ConflictError('this template is managed in status.yaml');
    await this.#db.kysely
      .updateTable('templates')
      .set({ ...columns(input), updated_at: now })
      .where('id', '=', id)
      .execute();
    await this.reload();
    return this.require(id);
  }

  async remove(id: string): Promise<void> {
    if (this.require(id).source === 'config')
      throw new ConflictError('this template is managed in status.yaml');
    await this.#db.kysely.deleteFrom('templates').where('id', '=', id).execute();
    await this.reload();
  }
}
