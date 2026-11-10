import type { Role } from '@heartline/shared';

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

/** Whether `role` has at least the rights of `needed`. */
export function can(role: Role | undefined, needed: Role): boolean {
  return role !== undefined && RANK[role] >= RANK[needed];
}
