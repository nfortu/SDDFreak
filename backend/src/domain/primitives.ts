import { randomUUID, randomBytes, createHash } from 'node:crypto';

/**
 * §8.4.1: UUIDs are canonical lowercase hyphenated text, so a value survives a
 * dump and restore byte-for-byte.
 */
export function newId(): string {
  return randomUUID();
}

/**
 * §8.4.1: timestamps are ISO-8601 UTC with millisecond precision. Text in UTC
 * sorts chronologically, so ORDER BY needs no date type under it.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

export function isoPlus(ms: number, from: Date = new Date()): string {
  return new Date(from.getTime() + ms).toISOString();
}

export function isPast(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() <= Date.now();
}

/** §8.4.1: booleans are 0/1 in storage and real booleans in the domain. */
export const toDbBool = (value: boolean): number => (value ? 1 : 0);
export const fromDbBool = (value: number | boolean | null): boolean =>
  value === true || value === 1;

/**
 * §8.4.1: email uniqueness is a plain unique index over a value normalized at
 * the boundary, rather than citext or COLLATE NOCASE, whose semantics are
 * engine-specific.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** FR-ORG-009 */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Session credentials and reset tokens are stored only as hashes (§4.3). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const MS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;

/** FR-REQ-013, FR-PRJ-008, FR-REQ-014: the soft-delete window (Q12). */
export const SOFT_DELETE_WINDOW_MS = 30 * MS.day;
