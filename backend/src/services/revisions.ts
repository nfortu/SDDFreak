import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { notFound, unprocessable } from '../domain/errors.js';
import type { User } from './accounts.js';
import type { AuthorizationService } from './authorization.js';
import type { Requirement, RequirementsService } from './requirements.js';

export interface Revision {
  id: string;
  requirementId: string;
  version: number;
  changedBy: string;
  changedByName: string | null;
  changedAt: string;
  changeKind: string;
  snapshot: Requirement;
}

export interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

/** Fields worth diffing — bookkeeping columns are noise in a change view. */
const COMPARED_FIELDS: Array<keyof Requirement> = [
  'title',
  'statement',
  'rationale',
  'type',
  'priority',
  'status',
  'acceptanceCriteria',
  'source',
  'ownerId',
  'categoryId',
  'parentId',
  'tags',
  'deletedAt',
];

export class RevisionsService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly requirements: RequirementsService,
  ) {}

  /** FR-AUD-002: reverse chronological. */
  async list(actor: User, requirementId: string): Promise<Revision[]> {
    const requirement = await this.loadAny(requirementId);
    await this.authz.requireAccess(actor, requirement.project_id);

    const rows = await this.db
      .selectFrom('revisions')
      .leftJoin('users', 'users.id', 'revisions.changed_by')
      .select([
        'revisions.id as id',
        'revisions.requirement_id as requirementId',
        'revisions.version as version',
        'revisions.snapshot as snapshot',
        'revisions.changed_by as changedBy',
        'revisions.changed_at as changedAt',
        'revisions.change_kind as changeKind',
        'users.display_name as changedByName',
      ])
      .where('revisions.requirement_id', '=', requirementId)
      .orderBy('revisions.version', 'desc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      requirementId: row.requirementId,
      version: row.version,
      changedBy: row.changedBy,
      changedByName: row.changedByName,
      changedAt: row.changedAt,
      changeKind: row.changeKind,
      snapshot: JSON.parse(row.snapshot) as Requirement,
    }));
  }

  async get(actor: User, requirementId: string, version: number): Promise<Revision> {
    const revisions = await this.list(actor, requirementId);
    const revision = revisions.find((r) => r.version === version);
    if (!revision) throw notFound(`No revision ${version} for this requirement`);
    return revision;
  }

  /** FR-AUD-003: field-level differences between any two revisions. */
  async diff(
    actor: User,
    requirementId: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<{ from: number; to: number; changes: FieldDiff[] }> {
    const revisions = await this.list(actor, requirementId);
    const from = revisions.find((r) => r.version === fromVersion);
    const to = revisions.find((r) => r.version === toVersion);

    if (!from) throw notFound(`No revision ${fromVersion} for this requirement`);
    if (!to) throw notFound(`No revision ${toVersion} for this requirement`);

    const changes: FieldDiff[] = [];
    for (const field of COMPARED_FIELDS) {
      const before = from.snapshot[field] ?? null;
      const after = to.snapshot[field] ?? null;
      if (!equal(before, after)) {
        changes.push({ field, before, after });
      }
    }

    return { from: fromVersion, to: toVersion, changes };
  }

  /**
   * FR-AUD-004: restoring earlier content is itself a change. The old revision
   * stays where it is and a new one is written on top, so INV-08 holds and the
   * history reads as what actually happened.
   */
  async revert(
    actor: User,
    requirementId: string,
    toVersion: number,
  ): Promise<Requirement> {
    const requirement = await this.loadAny(requirementId);
    await this.authz.requireAccess(actor, requirement.project_id, 'editor');

    if (requirement.deleted_at) {
      throw unprocessable(
        'requirement_deleted',
        'Restore this requirement before reverting its content.',
      );
    }

    const target = await this.get(actor, requirementId, toVersion);
    if (toVersion === requirement.version) {
      throw unprocessable('already_at_version', 'That is already the current version.');
    }

    const snapshot = target.snapshot;

    return this.requirements.update(actor, requirementId, {
      version: requirement.version,
      title: snapshot.title,
      statement: snapshot.statement,
      rationale: snapshot.rationale,
      type: snapshot.type,
      priority: snapshot.priority,
      // Status is deliberately not reverted: moving back through §4.12 has to
      // stay a decision an editor makes explicitly, not a side effect.
      acceptanceCriteria: snapshot.acceptanceCriteria,
      source: snapshot.source,
      ownerId: snapshot.ownerId,
      categoryId: snapshot.categoryId,
      parentId: snapshot.parentId,
      tags: snapshot.tags,
    });
  }

  private async loadAny(requirementId: string): Promise<{
    project_id: string;
    version: number;
    deleted_at: string | null;
  }> {
    const row = await this.db
      .selectFrom('requirements')
      .select(['project_id', 'version', 'deleted_at'])
      .where('id', '=', requirementId)
      .executeTakeFirst();
    if (!row) throw notFound('Requirement not found');
    return row;
  }
}

function equal(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}
