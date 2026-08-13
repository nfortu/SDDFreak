import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { newId, nowIso } from '../domain/primitives.js';

/** §4.10 event types. */
export const AUDIT_EVENT_TYPES = [
  'login_succeeded',
  'login_failed',
  'account_locked',
  'logout',
  'password_changed',
  'password_reset',
  'authorization_denied',
  'membership_granted',
  'membership_changed',
  'membership_revoked',
  'project_created',
  'project_deleted',
  'admin_access_granted',
  'account_deactivated',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export interface AuditEventInput {
  eventType: AuditEventType;
  actorUserId?: string | null;
  projectId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditEventRecord {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  eventType: string;
  projectId: string | null;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AuditFilter {
  actorUserId?: string;
  eventType?: string;
  projectId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/**
 * FR-AUD-005 records these events; FR-AUD-006 is satisfied structurally — this
 * class exposes `record` and `list` and nothing else. There is no update or
 * delete path to reach, which is what INV-09 asks for.
 */
export class AuditService {
  constructor(private readonly db: Kysely<Database>) {}

  async record(event: AuditEventInput): Promise<void> {
    await this.db
      .insertInto('audit_events')
      .values({
        id: newId(),
        occurred_at: nowIso(),
        actor_user_id: event.actorUserId ?? null,
        event_type: event.eventType,
        project_id: event.projectId ?? null,
        target_type: event.targetType ?? null,
        target_id: event.targetId ?? null,
        ip: event.ip ?? null,
        user_agent: event.userAgent ?? null,
        metadata: event.metadata ? JSON.stringify(event.metadata) : null,
      })
      .execute();
  }

  /** Counts a user's recent failures, which is what FR-AUTH-007 locks on. */
  async countRecentFailedLogins(userId: string, since: string): Promise<number> {
    const row = await this.db
      .selectFrom('audit_events')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('actor_user_id', '=', userId)
      .where('event_type', '=', 'login_failed')
      .where('occurred_at', '>=', since)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /** A success breaks the run of consecutive failures FR-AUTH-007 counts. */
  async lastSuccessfulLoginAt(userId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('audit_events')
      .select('occurred_at')
      .where('actor_user_id', '=', userId)
      .where('event_type', '=', 'login_succeeded')
      .orderBy('occurred_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.occurred_at ?? null;
  }

  /** FR-AUD-007 */
  async list(filter: AuditFilter): Promise<{ items: AuditEventRecord[]; total: number }> {
    const limit = Math.min(filter.limit ?? 50, 200);
    const offset = filter.offset ?? 0;

    let query = this.db.selectFrom('audit_events').selectAll();
    let countQuery = this.db
      .selectFrom('audit_events')
      .select((eb) => eb.fn.countAll<number>().as('count'));

    if (filter.actorUserId) {
      query = query.where('actor_user_id', '=', filter.actorUserId);
      countQuery = countQuery.where('actor_user_id', '=', filter.actorUserId);
    }
    if (filter.eventType) {
      query = query.where('event_type', '=', filter.eventType);
      countQuery = countQuery.where('event_type', '=', filter.eventType);
    }
    if (filter.projectId) {
      query = query.where('project_id', '=', filter.projectId);
      countQuery = countQuery.where('project_id', '=', filter.projectId);
    }
    if (filter.from) {
      query = query.where('occurred_at', '>=', filter.from);
      countQuery = countQuery.where('occurred_at', '>=', filter.from);
    }
    if (filter.to) {
      query = query.where('occurred_at', '<=', filter.to);
      countQuery = countQuery.where('occurred_at', '<=', filter.to);
    }

    const [rows, count] = await Promise.all([
      query.orderBy('occurred_at', 'desc').limit(limit).offset(offset).execute(),
      countQuery.executeTakeFirst(),
    ]);

    return {
      total: Number(count?.count ?? 0),
      items: rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurred_at,
        actorUserId: row.actor_user_id,
        eventType: row.event_type,
        projectId: row.project_id,
        targetType: row.target_type,
        targetId: row.target_id,
        ip: row.ip,
        userAgent: row.user_agent,
        metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
      })),
    };
  }
}
