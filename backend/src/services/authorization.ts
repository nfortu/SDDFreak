import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { forbidden, notFound } from '../domain/errors.js';
import type { User } from './accounts.js';
import type { AuditService } from './audit.js';

/** FR-AUTHZ-001: exactly these project roles, plus the system administrator. */
export const PROJECT_ROLES = ['owner', 'editor', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

const RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };

export interface ProjectAccess {
  projectId: string;
  projectKey: string;
  role: ProjectRole;
}

export class AuthorizationService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  /**
   * FR-AUTHZ-006: a user with no membership must not learn that the project
   * exists, so every failure here is absence rather than refusal. An
   * administrator is no exception — they reach a project by granting themselves
   * a membership (FR-AUTHZ-007), which is auditable (FR-AUTHZ-008), rather than
   * by an implicit bypass that would leave no trace.
   */
  async requireAccess(
    user: User,
    projectId: string,
    minimum: ProjectRole = 'viewer',
  ): Promise<ProjectAccess> {
    const row = await this.db
      .selectFrom('projects')
      .innerJoin('memberships', 'memberships.project_id', 'projects.id')
      .select([
        'projects.id as projectId',
        'projects.key as projectKey',
        'memberships.role as role',
      ])
      .where('projects.id', '=', projectId)
      .where('projects.deleted_at', 'is', null)
      .where('memberships.user_id', '=', user.id)
      .executeTakeFirst();

    if (!row) throw notFound('Project not found');

    const role = row.role as ProjectRole;
    if (RANK[role] < RANK[minimum]) {
      await this.audit.record({
        eventType: 'authorization_denied',
        actorUserId: user.id,
        projectId,
        targetType: 'project',
        targetId: projectId,
        metadata: { held: role, required: minimum },
      });
      // FR-AUTHZ-003: a viewer is refused, not told the project is missing —
      // they already know it exists.
      throw forbidden(`This action needs the '${minimum}' role; you hold '${role}'.`);
    }

    return { projectId: row.projectId, projectKey: row.projectKey, role };
  }

  /** Same rules, but for a soft-deleted project an owner may still restore. */
  async requireAccessIncludingDeleted(
    user: User,
    projectId: string,
    minimum: ProjectRole,
  ): Promise<ProjectAccess> {
    const row = await this.db
      .selectFrom('projects')
      .innerJoin('memberships', 'memberships.project_id', 'projects.id')
      .select([
        'projects.id as projectId',
        'projects.key as projectKey',
        'memberships.role as role',
      ])
      .where('projects.id', '=', projectId)
      .where('memberships.user_id', '=', user.id)
      .executeTakeFirst();

    if (!row) throw notFound('Project not found');
    const role = row.role as ProjectRole;
    if (RANK[role] < RANK[minimum]) {
      throw forbidden(`This action needs the '${minimum}' role; you hold '${role}'.`);
    }
    return { projectId: row.projectId, projectKey: row.projectKey, role };
  }

  async roleOn(userId: string, projectId: string): Promise<ProjectRole | null> {
    const row = await this.db
      .selectFrom('memberships')
      .select('role')
      .where('user_id', '=', userId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    return (row?.role as ProjectRole) ?? null;
  }

  /** FR-AUTHZ-007 */
  requireAdministrator(user: User): void {
    if (!user.isAdministrator) {
      throw forbidden('This action is restricted to administrators.');
    }
  }

  static atLeast(role: ProjectRole, minimum: ProjectRole): boolean {
    return RANK[role] >= RANK[minimum];
  }
}
