import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { unauthorized } from '../domain/errors.js';
import {
  MS,
  fromDbBool,
  hashToken,
  isPast,
  isoPlus,
  newId,
  newToken,
  normalizeEmail,
  nowIso,
} from '../domain/primitives.js';
import type { AuditService } from './audit.js';
import { type RequestMeta, type User, toUser } from './accounts.js';
import { burnVerificationTime, verifyPassword } from './passwords.js';

/** FR-AUTH-003 */
const ABSOLUTE_SESSION_MS = 24 * MS.hour;
/** FR-AUTH-004 */
const IDLE_SESSION_MS = 2 * MS.hour;
/** FR-AUTH-007 */
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * MS.minute;
const LOCKOUT_DURATION_MS = 15 * MS.minute;

export interface SessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

/**
 * FR-AUTH-008: one message, one shape, for an unknown address, a wrong
 * password, a locked account, and a deactivated account.
 */
function genericAuthFailure(): never {
  throw unauthorized('Those credentials are not valid.');
}

export class AuthService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  /** FR-AUTH-001, FR-AUTH-002 */
  async login(
    emailInput: string,
    password: string,
    meta: RequestMeta = {},
  ): Promise<{ user: User; token: string }> {
    const email = normalizeEmail(emailInput);
    const row = await this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();

    if (!row) {
      // Keep the expensive path on this branch too, so the response time does
      // not separate "no such account" from "wrong password" (FR-AUTH-008).
      await burnVerificationTime(password);
      await this.audit.record({
        eventType: 'login_failed',
        actorUserId: null,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { reason: 'unknown_email' },
      });
      genericAuthFailure();
    }

    const locked = row.locked_until !== null && !isPast(row.locked_until);
    const passwordMatches = await verifyPassword(row.password_hash, password);

    if (locked) {
      await this.audit.record({
        eventType: 'login_failed',
        actorUserId: row.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { reason: 'locked' },
      });
      genericAuthFailure();
    }

    if (!fromDbBool(row.is_active)) {
      await this.audit.record({
        eventType: 'login_failed',
        actorUserId: row.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { reason: 'inactive' },
      });
      genericAuthFailure();
    }

    if (!passwordMatches) {
      await this.registerFailure(row.id, meta);
      genericAuthFailure();
    }

    const token = newToken();
    const now = nowIso();

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({ failed_login_count: 0, locked_until: null, updated_at: now })
        .where('id', '=', row.id)
        .execute();
      await trx
        .insertInto('sessions')
        .values({
          id: newId(),
          user_id: row.id,
          token_hash: hashToken(token),
          created_at: now,
          last_seen_at: now,
          absolute_expires_at: isoPlus(ABSOLUTE_SESSION_MS),
          revoked_at: null,
          user_agent: meta.userAgent ?? null,
          ip: meta.ip ?? null,
        })
        .execute();
    });

    await this.audit.record({
      eventType: 'login_succeeded',
      actorUserId: row.id,
      targetType: 'user',
      targetId: row.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { user: toUser(row), token };
  }

  /**
   * FR-AUTH-007. The window is derived from the audit log rather than a
   * separate counter column, so "5 within 15 minutes" means exactly that
   * instead of "5 since whenever the counter was last reset".
   */
  private async registerFailure(userId: string, meta: RequestMeta): Promise<void> {
    await this.audit.record({
      eventType: 'login_failed',
      actorUserId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { reason: 'bad_password' },
    });

    // "Consecutive" is the operative word in FR-AUTH-007: a successful login in
    // between breaks the run, so the window starts at the later of the 15-minute
    // boundary and the last success.
    const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MS).toISOString();
    const lastSuccess = await this.audit.lastSuccessfulLoginAt(userId);
    const since = lastSuccess && lastSuccess > windowStart ? lastSuccess : windowStart;
    const recent = await this.audit.countRecentFailedLogins(userId, since);

    const patch: { failed_login_count: number; updated_at: string; locked_until?: string } = {
      failed_login_count: recent,
      updated_at: nowIso(),
    };

    if (recent >= LOCKOUT_THRESHOLD) {
      patch.locked_until = isoPlus(LOCKOUT_DURATION_MS);
      await this.audit.record({
        eventType: 'account_locked',
        actorUserId: userId,
        targetType: 'user',
        targetId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { failuresInWindow: recent },
      });
    }

    await this.db.updateTable('users').set(patch).where('id', '=', userId).execute();
  }

  /** FR-AUTH-003, FR-AUTH-004, FR-AUTH-009 */
  async authenticate(token: string): Promise<{ user: User; sessionId: string } | null> {
    const session = await this.db
      .selectFrom('sessions')
      .selectAll()
      .where('token_hash', '=', hashToken(token))
      .executeTakeFirst();

    if (!session || session.revoked_at !== null) return null;

    // FR-AUTH-003: absolute lifetime.
    if (isPast(session.absolute_expires_at)) return null;

    // FR-AUTH-004: idle lifetime.
    const idleDeadline = new Date(session.last_seen_at).getTime() + IDLE_SESSION_MS;
    if (idleDeadline <= Date.now()) return null;

    const row = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', session.user_id)
      .executeTakeFirst();

    if (!row || !fromDbBool(row.is_active)) return null;

    await this.db
      .updateTable('sessions')
      .set({ last_seen_at: nowIso() })
      .where('id', '=', session.id)
      .execute();

    return { user: toUser(row), sessionId: session.id };
  }

  /** FR-AUTH-005 */
  async logout(sessionId: string, userId: string, meta: RequestMeta = {}): Promise<void> {
    await this.db
      .updateTable('sessions')
      .set({ revoked_at: nowIso() })
      .where('id', '=', sessionId)
      .execute();
    await this.audit.record({
      eventType: 'logout',
      actorUserId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /** FR-AUTH-005 (all other sessions) and FR-ACC-008. */
  async revokeOtherSessions(userId: string, keepSessionId: string | null): Promise<number> {
    let query = this.db
      .updateTable('sessions')
      .set({ revoked_at: nowIso() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null);

    if (keepSessionId) query = query.where('id', '!=', keepSessionId);

    const result = await query.executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  /** FR-AUTH-006 */
  async listSessions(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const rows = await this.db
      .selectFrom('sessions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();

    return rows
      .filter((row) => !isPast(row.absolute_expires_at))
      .map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        ip: row.ip,
        userAgent: row.user_agent,
        current: row.id === currentSessionId,
      }));
  }
}
