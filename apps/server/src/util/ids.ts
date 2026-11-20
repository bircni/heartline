import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

let lastMs = 0;
let counter = 0;

/**
 * A UUIDv7 (RFC 9562): the millisecond time first, then a counter, so ids sort in the order they were made,
 * also within one millisecond. Strictly increasing in this process, even if the clock steps back.
 */
export function newOrderedId(now = Date.now()): string {
  if (now > lastMs) {
    lastMs = now;
    counter = 0;
  } else if (++counter > 0xfff) {
    // 4096 ids in one millisecond: borrow the next one.
    lastMs++;
    counter = 0;
  }
  const b = randomBytes(16);
  b.writeUIntBE(lastMs, 0, 6);
  b[6] = 0x70 | (counter >> 8);
  b[7] = counter & 0xff;
  b[8] = 0x80 | (b[8]! & 0x3f);
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}
