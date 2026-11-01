import type { ApiTokenDto, Scope } from '@heartline/shared';
import type { tokenCreateSchema } from '@heartline/shared';
import type { z } from 'zod';
import type { Db } from '../db/index.ts';
import { newId, randomToken, sha256 } from '../util/ids.ts';
import { NotFoundError } from '../services/monitors.ts';

export const TOKEN_PREFIX = 'hl_';

export interface TokenOwner {
  tokenId: string;
  userId: string;
  scopes: Scope[];
}

export class TokenService {
  #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  async create(
    userId: string,
    input: z.output<typeof tokenCreateSchema>,
  ): Promise<{ token: string; dto: ApiTokenDto }> {
    const token = `${TOKEN_PREFIX}${randomToken(24)}`;
    const now = Date.now();
    const row = {
      id: newId(),
      user_id: userId,
      name: input.name,
      prefix: token.slice(0, 9),
      hash: sha256(token),
      scopes: JSON.stringify([...new Set(input.scopes)]),
      created_at: now,
      last_used_at: null,
      expires_at: input.expiresInDays ? now + input.expiresInDays * 86_400_000 : null,
    };
    await this.#db.kysely.insertInto('api_tokens').values(row).execute();
    return { token, dto: (await this.list({ id: row.id }))[0] as ApiTokenDto };
  }

  async list(filter: { userId?: string; id?: string } = {}): Promise<ApiTokenDto[]> {
    let q = this.#db.kysely
      .selectFrom('api_tokens')
      .leftJoin('user', 'user.id', 'api_tokens.user_id')
      .select([
        'api_tokens.id',
        'api_tokens.name',
        'api_tokens.prefix',
        'api_tokens.scopes',
        'api_tokens.created_at',
        'api_tokens.last_used_at',
        'api_tokens.expires_at',
        'user.name as owner',
      ])
      .orderBy('api_tokens.created_at', 'desc');
    if (filter.userId) q = q.where('api_tokens.user_id', '=', filter.userId);
    if (filter.id) q = q.where('api_tokens.id', '=', filter.id);
    const rows = await q.execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: `${r.prefix}…`,
      scopes: JSON.parse(r.scopes) as Scope[],
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      expiresAt: r.expires_at,
      owner: r.owner ?? 'deleted user',
    }));
  }

  async revoke(id: string, userId: string | null): Promise<void> {
    let q = this.#db.kysely.deleteFrom('api_tokens').where('id', '=', id);
    if (userId) q = q.where('user_id', '=', userId);
    const res = await q.executeTakeFirst();
    if (!Number(res.numDeletedRows)) throw new NotFoundError('token not found');
  }

  async verify(token: string, now = Date.now()): Promise<TokenOwner | null> {
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    const row = await this.#db.kysely
      .selectFrom('api_tokens')
      .select(['id', 'user_id', 'scopes', 'expires_at', 'last_used_at'])
      .where('hash', '=', sha256(token))
      .executeTakeFirst();
    if (!row || (row.expires_at !== null && row.expires_at <= now)) return null;
    // Avoid a write per request: only refresh last_used_at once a minute.
    if (!row.last_used_at || now - row.last_used_at > 60_000) {
      await this.#db.kysely
        .updateTable('api_tokens')
        .set({ last_used_at: now })
        .where('id', '=', row.id)
        .execute();
    }
    return { tokenId: row.id, userId: row.user_id, scopes: JSON.parse(row.scopes) as Scope[] };
  }
}
