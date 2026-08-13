import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { badRequest, conflict, notFound, unprocessable } from '../domain/errors.js';
import { SOFT_DELETE_WINDOW_MS, newId, nowIso } from '../domain/primitives.js';
import type { RequestMeta, User } from './accounts.js';
import type { AuditService } from './audit.js';
import { type AuthorizationService, PROJECT_ROLES, type ProjectRole } from './authorization.js';

/** FR-PRJ-003 */
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/;

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  role: ProjectRole;
  requirementCount?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Member {
  userId: string;
  displayName: string;
  email: string;
  role: ProjectRole;
}

export class ProjectsService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  /** FR-PRJ-001, FR-PRJ-002 */
  async create(
    actor: User,
    input: { key: string; name: string; description?: string | null },
    meta: RequestMeta = {},
  ): Promise<Project> {
    const key = input.key.trim().toUpperCase();
    if (!PROJECT_KEY_PATTERN.test(key)) {
      throw badRequest(
        'invalid_project_key',
        'A project key is 2 to 8 characters: an uppercase letter followed by uppercase letters or digits.',
      );
    }

    const name = input.name.trim();
    if (name.length === 0 || name.length > 100) {
      throw badRequest('invalid_project_name', 'A project name of 1 to 100 characters is required.');
    }

    const clash = await this.db
      .selectFrom('projects')
      .select('id')
      .where('key', '=', key)
      .executeTakeFirst();
    if (clash) throw conflict('project_key_taken', `Project key '${key}' is already in use.`);

    const now = nowIso();
    const id = newId();

    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('projects')
        .values({
          id,
          key,
          name,
          description: input.description?.trim() || null,
          next_requirement_number: 1,
          created_at: now,
          created_by: actor.id,
          updated_at: now,
          updated_by: actor.id,
          deleted_at: null,
        })
        .execute();

      // FR-PRJ-002: the creator owns it, which also satisfies INV-01 from the
      // first moment the project exists.
      await trx
        .insertInto('memberships')
        .values({
          id: newId(),
          project_id: id,
          user_id: actor.id,
          role: 'owner',
          created_at: now,
          created_by: actor.id,
        })
        .execute();
    });

    await this.audit.record({
      eventType: 'project_created',
      actorUserId: actor.id,
      projectId: id,
      targetType: 'project',
      targetId: id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { key },
    });

    return {
      id,
      key,
      name,
      description: input.description?.trim() || null,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  }

  /** FR-PRJ-005: exactly the projects the actor is a member of. */
  async listForUser(actor: User, includeDeleted = false): Promise<Project[]> {
    let query = this.db
      .selectFrom('projects')
      .innerJoin('memberships', 'memberships.project_id', 'projects.id')
      .select([
        'projects.id as id',
        'projects.key as key',
        'projects.name as name',
        'projects.description as description',
        'projects.created_at as createdAt',
        'projects.updated_at as updatedAt',
        'projects.deleted_at as deletedAt',
        'memberships.role as role',
      ])
      .where('memberships.user_id', '=', actor.id);

    if (!includeDeleted) query = query.where('projects.deleted_at', 'is', null);

    const rows = await query.orderBy('projects.key', 'asc').execute();

    const counts = await this.db
      .selectFrom('requirements')
      .select(['project_id'])
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('deleted_at', 'is', null)
      .groupBy('project_id')
      .execute();
    const countByProject = new Map(counts.map((c) => [c.project_id, Number(c.count)]));

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      role: row.role as ProjectRole,
      requirementCount: countByProject.get(row.id) ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    }));
  }

  async get(actor: User, projectId: string): Promise<Project> {
    const access = await this.authz.requireAccess(actor, projectId);
    const row = await this.db
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', access.projectId)
      .executeTakeFirstOrThrow();

    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      role: access.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  /** FR-AUTHZ-005 (rename). FR-PRJ-004 holds because `key` is not updatable. */
  async update(
    actor: User,
    projectId: string,
    input: { name?: string; description?: string | null; key?: string },
  ): Promise<Project> {
    await this.authz.requireAccess(actor, projectId, 'owner');

    if (input.key !== undefined) {
      throw unprocessable(
        'project_key_immutable',
        "A project's key cannot be changed after creation.",
      );
    }

    const patch: Record<string, string | null> = { updated_at: nowIso(), updated_by: actor.id };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length === 0 || name.length > 100) {
        throw badRequest('invalid_project_name', 'A project name of 1 to 100 characters is required.');
      }
      patch.name = name;
    }
    if (input.description !== undefined) patch.description = input.description?.trim() || null;

    await this.db.updateTable('projects').set(patch).where('id', '=', projectId).execute();
    return this.get(actor, projectId);
  }

  /** FR-PRJ-007 */
  async softDelete(actor: User, projectId: string, meta: RequestMeta = {}): Promise<void> {
    await this.authz.requireAccess(actor, projectId, 'owner');
    await this.db
      .updateTable('projects')
      .set({ deleted_at: nowIso(), updated_at: nowIso(), updated_by: actor.id })
      .where('id', '=', projectId)
      .execute();

    await this.audit.record({
      eventType: 'project_deleted',
      actorUserId: actor.id,
      projectId,
      targetType: 'project',
      targetId: projectId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /** FR-PRJ-008: restorable for 30 days (Q12). */
  async restore(actor: User, projectId: string): Promise<Project> {
    await this.authz.requireAccessIncludingDeleted(actor, projectId, 'owner');

    const row = await this.db
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!row) throw notFound('Project not found');
    if (!row.deleted_at) return this.get(actor, projectId);

    if (Date.now() - new Date(row.deleted_at).getTime() > SOFT_DELETE_WINDOW_MS) {
      throw unprocessable(
        'restore_window_expired',
        'This project was deleted more than 30 days ago and can no longer be restored.',
      );
    }

    await this.db
      .updateTable('projects')
      .set({ deleted_at: null, updated_at: nowIso(), updated_by: actor.id })
      .where('id', '=', projectId)
      .execute();

    return this.get(actor, projectId);
  }

  async listMembers(actor: User, projectId: string): Promise<Member[]> {
    await this.authz.requireAccess(actor, projectId);
    const rows = await this.db
      .selectFrom('memberships')
      .innerJoin('users', 'users.id', 'memberships.user_id')
      .select([
        'users.id as userId',
        'users.display_name as displayName',
        'users.email as email',
        'memberships.role as role',
      ])
      .where('memberships.project_id', '=', projectId)
      .orderBy('users.display_name', 'asc')
      .execute();

    return rows.map((row) => ({ ...row, role: row.role as ProjectRole }));
  }

  /** FR-PRJ-006 (add and change), FR-AUTHZ-009 (never orphan a project). */
  async setMemberRole(
    actor: User,
    projectId: string,
    targetUserId: string,
    role: ProjectRole,
    meta: RequestMeta = {},
  ): Promise<Member[]> {
    await this.authz.requireAccess(actor, projectId, 'owner');

    if (!PROJECT_ROLES.includes(role)) {
      throw badRequest('invalid_role', `Role must be one of: ${PROJECT_ROLES.join(', ')}.`);
    }

    const target = await this.db
      .selectFrom('users')
      .select(['id'])
      .where('id', '=', targetUserId)
      .executeTakeFirst();
    if (!target) throw notFound('User not found');

    const existing = await this.authz.roleOn(targetUserId, projectId);

    if (existing === 'owner' && role !== 'owner') {
      await this.assertNotLastOwner(projectId, targetUserId);
    }

    const now = nowIso();
    if (existing) {
      await this.db
        .updateTable('memberships')
        .set({ role })
        .where('project_id', '=', projectId)
        .where('user_id', '=', targetUserId)
        .execute();
    } else {
      await this.db
        .insertInto('memberships')
        .values({
          id: newId(),
          project_id: projectId,
          user_id: targetUserId,
          role,
          created_at: now,
          created_by: actor.id,
        })
        .execute();
    }

    await this.audit.record({
      eventType: existing ? 'membership_changed' : 'membership_granted',
      actorUserId: actor.id,
      projectId,
      targetType: 'user',
      targetId: targetUserId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { role, previousRole: existing },
    });

    return this.listMembers(actor, projectId);
  }

  /** FR-PRJ-006 (remove) */
  async removeMember(
    actor: User,
    projectId: string,
    targetUserId: string,
    meta: RequestMeta = {},
  ): Promise<void> {
    await this.authz.requireAccess(actor, projectId, 'owner');

    const existing = await this.authz.roleOn(targetUserId, projectId);
    if (!existing) throw notFound('That user is not a member of this project');
    if (existing === 'owner') await this.assertNotLastOwner(projectId, targetUserId);

    await this.db
      .deleteFrom('memberships')
      .where('project_id', '=', projectId)
      .where('user_id', '=', targetUserId)
      .execute();

    await this.audit.record({
      eventType: 'membership_revoked',
      actorUserId: actor.id,
      projectId,
      targetType: 'user',
      targetId: targetUserId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { previousRole: existing },
    });
  }

  /**
   * FR-AUTHZ-007 and FR-AUTHZ-008: an administrator reaches a project by
   * granting themselves membership, and the grant is recorded. There is no
   * silent bypass anywhere else in the codebase.
   */
  async grantAdminAccess(
    admin: User,
    projectId: string,
    meta: RequestMeta = {},
  ): Promise<ProjectRole> {
    this.authz.requireAdministrator(admin);

    const project = await this.db
      .selectFrom('projects')
      .select(['id', 'key'])
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!project) throw notFound('Project not found');

    const existing = await this.authz.roleOn(admin.id, projectId);
    if (existing) return existing;

    await this.db
      .insertInto('memberships')
      .values({
        id: newId(),
        project_id: projectId,
        user_id: admin.id,
        role: 'owner',
        created_at: nowIso(),
        created_by: admin.id,
      })
      .execute();

    await this.audit.record({
      eventType: 'admin_access_granted',
      actorUserId: admin.id,
      projectId,
      targetType: 'project',
      targetId: projectId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { projectKey: project.key, grantedRole: 'owner' },
    });

    return 'owner';
  }

  /** Administrators can see that projects exist in order to grant themselves access. */
  async listAllForAdmin(admin: User): Promise<Array<Omit<Project, 'role'>>> {
    this.authz.requireAdministrator(admin);
    const rows = await this.db.selectFrom('projects').selectAll().orderBy('key', 'asc').execute();
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    }));
  }

  /** INV-01 / FR-AUTHZ-009 */
  private async assertNotLastOwner(projectId: string, targetUserId: string): Promise<void> {
    const owners = await this.db
      .selectFrom('memberships')
      .select('user_id')
      .where('project_id', '=', projectId)
      .where('role', '=', 'owner')
      .execute();

    const remaining = owners.filter((o) => o.user_id !== targetUserId);
    if (remaining.length === 0) {
      throw unprocessable(
        'last_owner',
        'A project must keep at least one owner. Promote another member first.',
      );
    }
  }
}
