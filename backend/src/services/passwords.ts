import { hash, verify } from '@node-rs/argon2';
import { isBreachedPassword } from '../domain/breached-passwords.js';
import { badRequest } from '../domain/errors.js';

/** FR-ACC-003 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * FR-ACC-005: Argon2id. @node-rs/argon2 defaults to the id variant; the cost
 * parameters below are the OWASP baseline (19 MiB, 2 passes).
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function assertPasswordAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      'password_too_short',
      `A password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  // FR-ACC-004
  if (isBreachedPassword(password)) {
    throw badRequest(
      'password_breached',
      'That password appears in a known list of breached passwords. Choose another.',
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * FR-AUTH-008 requires an indistinguishable *response time* as well as an
 * identical response. Verifying against a real hash when no account exists
 * keeps the expensive path on every branch, so an attacker cannot separate
 * "unknown email" from "wrong password" with a stopwatch.
 */
let dummyHashPromise: Promise<string> | null = null;

export function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('timing-equalisation-placeholder-value');
  return dummyHashPromise;
}

export async function burnVerificationTime(password: string): Promise<void> {
  await verifyPassword(await dummyHash(), password);
}
