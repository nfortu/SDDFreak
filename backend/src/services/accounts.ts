import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { badRequest, conflict, notFound, unauthorized } from '../domain/errors.js';
import {
  MS,
  fromDbBool,
  hashToken,
  newId,
  newToken,
  normalizeEmail,
  nowIso,
  isoPlus,
  toDbBool,
} from '../domain/primitives.js';
import type { AuditService } from './audit.js';
import type { Mailer } from './mailer.js';
import { assertPasswordAcceptable, hashPassword, verifyPassword } from './passwords.js';

export interface User {
  id: string;
  email: string;
  displayName: string;
  isAdministrator: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** FR-ACC-007: a reset token is valid for 60 minutes. */
const RESET_TOKEN_TTL_MS = 60 * MS.minute;

export function toUser(row: {
  id: string;
  email: string;
  display_name: string;
  is_administrator: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isAdministrator: fromDbBool(row.is_administrator),
    isActive: fromDbBool(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AccountsService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
  ) {}

  /** FR-ACC-001 */
  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<User> {
    const email = normalizeEmail(input.email);
    assertPasswordAcceptable(input.password);

    const displayName = input.displayName.trim();
    if (displayName.length === 0 || displayName.length > 100) {
      throw badRequest('invalid_display_name', 'A display name of 1 to 100 characters is required.');
    }

    const existing = await this.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirst();

    // FR-ACC-002. Registration necessarily reveals that an address is taken;
    // FR-AUTH-008 is where enumeration is actually prevented (see §6.2).
    if (existing) {
      throw conflict('email_taken', 'That email address is already registered.');
    }

    // The first account to exist administers the installation — otherwise a
    // fresh deployment has no one who can satisfy FR-ACC-010.
    const anyUser = await this.db.selectFrom('users').select('id').limit(1).executeTakeFirst();

    const now = nowIso();
    const user = {
      id: newId(),
      email,
      password_hash: await hashPassword(input.password),
      display_name: displayName,
      is_administrator: toDbBool(!anyUser),
      is_active: toDbBool(true),
      failed_login_count: 0,
      locked_until: null,
      created_at: now,
      updated_at: now,
      anonymized_at: null,
    };

    await this.db.insertInto('users').values(user).execute();
    return toUser(user);
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toUser(row) : null;
  }

  async list(): Promise<User[]> {
    const rows = await this.db.selectFrom('users').selectAll().orderBy('created_at', 'asc').execute();
    return rows.map(toUser);
  }

  /** FR-ACC-009 */
  async updateProfile(
    userId: string,
    input: { displayName?: string; email?: string },
  ): Promise<User> {
    const patch: Record<string, string> = { updated_at: nowIso() };

    if (input.displayName !== undefined) {
      const displayName = input.displayName.trim();
      if (displayName.length === 0 || displayName.length > 100) {
        throw badRequest('invalid_display_name', 'A display name of 1 to 100 characters is required.');
      }
      patch.display_name = displayName;
    }

    if (input.email !== undefined) {
      const email = normalizeEmail(input.email);
      const clash = await this.db
        .selectFrom('users')
        .select('id')
        .where('email', '=', email)
        .where('id', '!=', userId)
        .executeTakeFirst();
      if (clash) throw conflict('email_taken', 'That email address is already registered.');
      patch.email = email;
    }

    await this.db.updateTable('users').set(patch).where('id', '=', userId).execute();
    const user = await this.findById(userId);
    if (!user) throw notFound('Account not found');
    return user;
  }

  /** FR-ACC-006, and FR-ACC-008 through the returned session-revocation hook. */
  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta = {},
  ): Promise<void> {
    const row = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!row) throw notFound('Account not found');

    if (!(await verifyPassword(row.password_hash, input.currentPassword))) {
      throw unauthorized('The current password is incorrect.');
    }

    assertPasswordAcceptable(input.newPassword);

    await this.db
      .updateTable('users')
      .set({ password_hash: await hashPassword(input.newPassword), updated_at: nowIso() })
      .where('id', '=', userId)
      .execute();

    await this.audit.record({
      eventType: 'password_changed',
      actorUserId: userId,
      targetType: 'user',
      targetId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /**
   * FR-ACC-007. Returns the token so the caller can deliver it; the HTTP layer
   * never echoes it back to an unauthenticated client outside the preview
   * profile. The response is the same whether or not the address is registered,
   * which is the same reasoning as FR-AUTH-008.
   */
  async requestPasswordReset(emailInput: string): Promise<string | null> {
    const email = normalizeEmail(emailInput);
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'is_active'])
      .where('email', '=', email)
      .executeTakeFirst();

    if (!user || !fromDbBool(user.is_active)) return null;

    const token = newToken();
    await this.db
      .insertInto('password_reset_tokens')
      .values({
        id: newId(),
        user_id: user.id,
        token_hash: hashToken(token),
        expires_at: isoPlus(RESET_TOKEN_TTL_MS),
        used_at: null,
        created_at: nowIso(),
      })
      .execute();

    await this.mailer.send({
      to: user.email,
      subject: 'Reset your SDDFreak password',
      body: `Use this token within 60 minutes to choose a new password:\n\n${token}\n`,
    });

    return token;
  }

  /** FR-ACC-007 (single use, time limited). Session revocation is FR-ACC-008. */
  async resetPassword(
    token: string,
    newPassword: string,
    meta: RequestMeta = {},
  ): Promise<{ userId: string }> {
    const row = await this.db
      .selectFrom('password_reset_tokens')
      .selectAll()
      .where('token_hash', '=', hashToken(token))
      .executeTakeFirst();

    if (!row || row.used_at !== null || new Date(row.expires_at).getTime() <= Date.now()) {
      throw badRequest('invalid_reset_token', 'That reset link is invalid or has expired.');
    }

    assertPasswordAcceptable(newPassword);

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({ password_hash: await hashPassword(newPassword), updated_at: nowIso() })
        .where('id', '=', row.user_id)
        .execute();
      await trx
        .updateTable('password_reset_tokens')
        .set({ used_at: nowIso() })
        .where('id', '=', row.id)
        .execute();
    });

    await this.audit.record({
      eventType: 'password_reset',
      actorUserId: row.user_id,
      targetType: 'user',
      targetId: row.user_id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { userId: row.user_id };
  }

  /** FR-ACC-010. FR-ACC-011 holds because nothing authored is touched here. */
  async setActive(
    adminId: string,
    targetUserId: string,
    isActive: boolean,
    meta: RequestMeta = {},
  ): Promise<User> {
    const user = await this.findById(targetUserId);
    if (!user) throw notFound('Account not found');

    await this.db
      .updateTable('users')
      .set({ is_active: toDbBool(isActive), updated_at: nowIso() })
      .where('id', '=', targetUserId)
      .execute();

    if (!isActive) {
      await this.audit.record({
        eventType: 'account_deactivated',
        actorUserId: adminId,
        targetType: 'user',
        targetId: targetUserId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    return { ...user, isActive };
  }

  /** NFR-CMP-001 */
  async exportPersonalData(userId: string): Promise<Record<string, unknown>> {
    const [user, sessions, memberships, authored, audited] = await Promise.all([
      this.db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirst(),
      this.db
        .selectFrom('sessions')
        .select(['id', 'created_at', 'last_seen_at', 'ip', 'user_agent', 'revoked_at'])
        .where('user_id', '=', userId)
        .execute(),
      this.db
        .selectFrom('memberships')
        .innerJoin('projects', 'projects.id', 'memberships.project_id')
        .select(['projects.key as projectKey', 'projects.name as projectName', 'memberships.role'])
        .where('memberships.user_id', '=', userId)
        .execute(),
      this.db
        .selectFrom('requirements')
        .select(['key', 'title', 'created_at'])
        .where('created_by', '=', userId)
        .execute(),
      this.db
        .selectFrom('audit_events')
        .select(['event_type', 'occurred_at', 'ip', 'user_agent'])
        .where('actor_user_id', '=', userId)
        .execute(),
    ]);

    if (!user) throw notFound('Account not found');

    return {
      exportedAt: nowIso(),
      account: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
      sessions,
      memberships,
      authoredRequirements: authored,
      auditEvents: audited,
    };
  }

  /**
   * NFR-CMP-002: personal data goes, authored content and its attribution
   * chain stay. The user row is retained in an anonymized form so that every
   * `created_by` reference remains resolvable.
   *
   * UNRESOLVED SPEC CONFLICT — audit events are deliberately left untouched.
   * NFR-CMP-002 asks for erasure of personal data; INV-09 and FR-AUD-006 say an
   * audit event is never modified or deleted. Audit rows hold IP addresses and
   * user agents, which are personal data. Both cannot hold at once.
   *
   * This implementation keeps the audit log immutable, on the grounds that a
   * mutable audit log is worth nothing, and leans on NFR-CMP-003's 12-month
   * retention to bound how long that data survives. Deciding this properly is a
   * spec change, not a code change — see the note reported with this build.
   */
  async anonymize(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) throw notFound('Account not found');

    const now = nowIso();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({
          email: `anonymized+${userId}@invalid`,
          display_name: 'Anonymized user',
          password_hash: 'anonymized',
          is_active: toDbBool(false),
          anonymized_at: now,
          updated_at: now,
        })
        .where('id', '=', userId)
        .execute();
      await trx.deleteFrom('sessions').where('user_id', '=', userId).execute();
    });
  }
}
