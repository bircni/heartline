import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}
