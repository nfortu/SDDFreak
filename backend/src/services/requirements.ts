import { type Kysely, sql } from 'kysely';
import type { SearchIndex } from '../db/search-index.js';
import type { Database, RequirementsTable } from '../db/types.js';
import { badRequest, conflict, notFound, unprocessable } from '../domain/errors.js';
import { SOFT_DELETE_WINDOW_MS, newId, nowIso } from '../domain/primitives.js';
import {
  PRIORITIES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  type Priority,
  type RequirementStatus,
  type RequirementType,
  assertTransition,
  requiresAcceptanceCriteria,
} from '../domain/requirement-status.js';
import type { User } from './accounts.js';
import type { AuthorizationService } from './authorization.js';
import type { TagsService } from './tags.js';

export interface Requirement {
  id: string;
  key: string;
  projectId: string;
  title: string;
  statement: string;
  rationale: string | null;
  type: RequirementType;
  priority: Priority;
  status: RequirementStatus;
  acceptanceCriteria: string | null;
  source: string | null;
  ownerId: string | null;
  categoryId: string | null;
  parentId: string | null;
  sortOrder: number;
  version: number;
  tags: string[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt: string | null;
}

export interface CreateRequirementInput {
  title: string;
  statement: string;
  type: RequirementType;
  rationale?: string | null;
  priority?: Priority;
  status?: RequirementStatus;
  acceptanceCriteria?: string | null;
  source?: string | null;
  ownerId?: string | null;
  categoryId?: string | null;
  parentId?: string | null;
  tags?: string[];
}

export interface UpdateRequirementInput extends Partial<CreateRequirementInput> {
  /** FR-REQ-008: the version the caller believes it is editing. */
  version: number;
}

const MAX_TITLE = 200;
const MAX_TEXT = 10_000;
const MAX_SOURCE = 200;

export function mapRequirement(row: RequirementsTable, tags: string[] = []): Requirement {
  return {
    id: row.id,
    key: row.key,
    projectId: row.project_id,
    title: row.title,
    statement: row.statement,
    rationale: row.rationale,
    type: row.type as RequirementType,
    priority: row.priority as Priority,
    status: row.status as RequirementStatus,
    acceptanceCriteria: row.acceptance_criteria,
    source: row.source,
    ownerId: row.owner_id,
    categoryId: row.category_id,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    version: row.version,
    tags,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    deletedAt: row.deleted_at,
  };
}

export class RequirementsService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly tags: TagsService,
    private readonly searchIndex: SearchIndex,
  ) {}

  /** FR-REQ-001 to FR-REQ-004 */
  async create(
    actor: User,
    projectId: string,
    input: CreateRequirementInput,
  ): Promise<Requirement> {
    await this.authz.requireAccess(actor, projectId, 'editor');

    const fields = this.validateContent(input, {
      title: input.title,
      statement: input.statement,
      type: input.type,
    });

    const status = input.status ?? 'draft';
    const priority = input.priority ?? 'should';
    this.assertEnum('status', status, REQUIREMENT_STATUSES);
    this.assertEnum('priority', priority, PRIORITIES);

    // A requirement created straight into `approved` still has to satisfy
    // INV-07, so the same gate runs on create as on update.
    if (requiresAcceptanceCriteria(status) && !fields.acceptanceCriteria?.trim()) {
      throw unprocessable(
        'acceptance_criteria_required',
        `A requirement needs acceptance criteria before it can be created as '${status}'.`,
      );
    }

    await this.assertReferencesValid(projectId, {
      categoryId: input.categoryId ?? null,
      parentId: input.parentId ?? null,
      ownerId: input.ownerId ?? null,
    });

    const now = nowIso();

    return this.db.transaction().execute(async (trx) => {
      const key = await this.allocateKey(trx, projectId);
      const siblingCount = await trx
        .selectFrom('requirements')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('project_id', '=', projectId)
        .where('category_id', input.categoryId ? '=' : 'is', input.categoryId ?? null)
        .executeTakeFirst();

      const row: RequirementsTable = {
        id: newId(),
        key,
        project_id: projectId,
        title: fields.title,
        statement: fields.statement,
        rationale: fields.rationale,
        type: input.type,
        priority,
        status,
        acceptance_criteria: fields.acceptanceCriteria,
        source: fields.source,
        owner_id: input.ownerId ?? null,
        category_id: input.categoryId ?? null,
        parent_id: input.parentId ?? null,
        sort_order: Number(siblingCount?.count ?? 0),
        version: 1,
        created_at: now,
        created_by: actor.id,
        updated_at: now,
        updated_by: actor.id,
        deleted_at: null,
      };

      await trx.insertInto('requirements').values(row).execute();

      const tagNames = await this.applyTags(trx, projectId, row.id, input.tags ?? []);
      await this.searchIndex.upsert(
        {
          requirementId: row.id,
          title: row.title,
          statement: row.statement,
          rationale: row.rationale,
        },
        trx,
      );

      const requirement = mapRequirement(row, tagNames);
      await this.writeRevision(trx, requirement, actor.id, 'created');
      return requirement;
    });
  }

  /**
   * FR-REQ-002 and INV-02. The counter is bumped and read in one statement, so
   * two concurrent creates cannot be handed the same number. RETURNING is
   * available on both engines (SQLite since 3.35, Postgres always), which keeps
   * this out of the engine-divergence list.
   */
  private async allocateKey(trx: Kysely<Database>, projectId: string): Promise<string> {
    const project = await trx
      .updateTable('projects')
      .set({ next_requirement_number: sql`next_requirement_number + 1` })
      .where('id', '=', projectId)
      .returning(['key', 'next_requirement_number'])
      .executeTakeFirst();

    if (!project) throw notFound('Project not found');
    return `${project.key}-${Number(project.next_requirement_number) - 1}`;
  }

  /** FR-REQ-005 */
  async get(actor: User, requirementId: string): Promise<Requirement> {
    const row = await this.db
      .selectFrom('requirements')
      .selectAll()
      .where('id', '=', requirementId)
      .executeTakeFirst();
    if (!row) throw notFound('Requirement not found');

    await this.authz.requireAccess(actor, row.project_id);

    const tags = await this.tags.namesFor([row.id]);
    return mapRequirement(row, tags.get(row.id) ?? []);
  }

  async getByKey(actor: User, projectId: string, key: string): Promise<Requirement> {
    await this.authz.requireAccess(actor, projectId);
    const row = await this.db
      .selectFrom('requirements')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('key', '=', key.toUpperCase())
      .executeTakeFirst();
    if (!row) throw notFound('Requirement not found');

    const tags = await this.tags.namesFor([row.id]);
    return mapRequirement(row, tags.get(row.id) ?? []);
  }

  /** FR-REQ-006 to FR-REQ-010, FR-REQ-016 */
  async update(
    actor: User,
    requirementId: string,
    input: UpdateRequirementInput,
  ): Promise<Requirement> {
    const current = await this.loadLive(requirementId);
    await this.authz.requireAccess(actor, current.project_id, 'editor');

    // FR-REQ-008: check before doing any work, and again in the WHERE clause
    // below, so a racing writer cannot slip between the two.
    if (input.version !== current.version) {
      throw conflict(
        'version_conflict',
        'This requirement changed since you loaded it. Review the differences and try again.',
        { expectedVersion: input.version, actualVersion: current.version },
      );
    }

    const nextStatus = input.status ?? (current.status as RequirementStatus);
    const nextAcceptance =
      input.acceptanceCriteria !== undefined
        ? (input.acceptanceCriteria?.trim() || null)
        : current.acceptance_criteria;

    if (input.status !== undefined) {
      this.assertEnum('status', input.status, REQUIREMENT_STATUSES);
      // FR-REQ-009 and FR-REQ-010 together.
      assertTransition(current.status as RequirementStatus, nextStatus, nextAcceptance);
    } else if (requiresAcceptanceCriteria(nextStatus) && !nextAcceptance) {
      // INV-07 also has to survive an edit that only clears the criteria.
      throw unprocessable(
        'acceptance_criteria_required',
        `A requirement at status '${nextStatus}' must keep its acceptance criteria.`,
      );
    }

    if (input.priority !== undefined) this.assertEnum('priority', input.priority, PRIORITIES);
    if (input.type !== undefined) this.assertEnum('type', input.type, REQUIREMENT_TYPES);

    const fields = this.validateContent(input, {
      title: input.title ?? current.title,
      statement: input.statement ?? current.statement,
      type: (input.type ?? current.type) as RequirementType,
    });

    await this.assertReferencesValid(current.project_id, {
      categoryId: input.categoryId !== undefined ? input.categoryId : current.category_id,
      parentId: input.parentId !== undefined ? input.parentId : current.parent_id,
      ownerId: input.ownerId !== undefined ? input.ownerId : current.owner_id,
      selfId: current.id,
    });

    const now = nowIso();
    const patch: Partial<RequirementsTable> = {
      title: fields.title,
      statement: fields.statement,
      rationale: input.rationale !== undefined ? fields.rationale : current.rationale,
      type: input.type ?? current.type,
      priority: input.priority ?? current.priority,
      status: nextStatus,
      acceptance_criteria: nextAcceptance,
      source: input.source !== undefined ? fields.source : current.source,
      owner_id: input.ownerId !== undefined ? input.ownerId : current.owner_id,
      category_id: input.categoryId !== undefined ? input.categoryId : current.category_id,
      parent_id: input.parentId !== undefined ? input.parentId : current.parent_id,
    };

    return this.db.transaction().execute(async (trx) => {
      const existingTags = (await this.tags.namesFor([current.id], trx)).get(current.id) ?? [];
      const tagsChanged =
        input.tags !== undefined && !sameTagSet(existingTags, input.tags);

      // FR-REQ-007: a no-op update neither bumps the version nor writes a
      // revision, so history records changes rather than saves.
      const contentChanged = (Object.keys(patch) as Array<keyof RequirementsTable>).some(
        (field) => patch[field] !== current[field],
      );

      if (!contentChanged && !tagsChanged) {
        return mapRequirement(current, existingTags);
      }

      const result = await trx
        .updateTable('requirements')
        .set({
          ...patch,
          version: current.version + 1,
          updated_at: now,
          updated_by: actor.id,
        })
        .where('id', '=', current.id)
        .where('version', '=', input.version)
        .executeTakeFirst();

      if (Number(result.numUpdatedRows ?? 0) === 0) {
        throw conflict(
          'version_conflict',
          'This requirement changed while you were saving. Review the differences and try again.',
        );
      }

      const tagNames = tagsChanged
        ? await this.applyTags(trx, current.project_id, current.id, input.tags ?? [])
        : existingTags;

      await this.searchIndex.upsert(
        {
          requirementId: current.id,
          title: patch.title!,
          statement: patch.statement!,
          rationale: patch.rationale ?? null,
        },
        trx,
      );

      const updated = mapRequirement(
        {
          ...current,
          ...patch,
          version: current.version + 1,
          updated_at: now,
          updated_by: actor.id,
        } as RequirementsTable,
        tagNames,
      );

      await this.writeRevision(trx, updated, actor.id, 'updated');
      return updated;
    });
  }

  /** FR-REQ-011, FR-REQ-012 */
  async softDelete(
    actor: User,
    requirementId: string,
    options: { cascade?: boolean } = {},
  ): Promise<{ deleted: string[] }> {
    const current = await this.loadLive(requirementId);
    await this.authz.requireAccess(actor, current.project_id, 'editor');

    const children = await this.db
      .selectFrom('requirements')
      .select('id')
      .where('parent_id', '=', current.id)
      .where('deleted_at', 'is', null)
      .execute();

    if (children.length > 0 && !options.cascade) {
      throw conflict(
        'requirement_has_children',
        `This requirement has ${children.length} child requirement(s). Confirm to delete the whole subtree.`,
        { childCount: children.length },
      );
    }

    const ids = options.cascade ? await this.subtreeIds(current.id) : [current.id];
    const now = nowIso();

    await this.db.transaction().execute(async (trx) => {
      for (const id of ids) {
        const before = await trx
          .selectFrom('requirements')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirstOrThrow();

        // A deletion is a change, so it takes a version of its own. INV-06
        // wants one revision per version, and the unique index enforces it.
        const version = before.version + 1;

        await trx
          .updateTable('requirements')
          .set({ deleted_at: now, updated_at: now, updated_by: actor.id, version })
          .where('id', '=', id)
          .execute();

        // Excluded from search along with the listings (FR-SRCH-008).
        await this.searchIndex.remove(id, trx);

        const tagNames = (await this.tags.namesFor([id], trx)).get(id) ?? [];
        await this.writeRevision(
          trx,
          mapRequirement(
            { ...before, deleted_at: now, updated_at: now, updated_by: actor.id, version },
            tagNames,
          ),
          actor.id,
          'deleted',
        );
      }
    });

    return { deleted: ids };
  }

  /** FR-REQ-013: restorable for 30 days, keeping its key. */
  async restore(actor: User, requirementId: string): Promise<Requirement> {
    const row = await this.db
      .selectFrom('requirements')
      .selectAll()
      .where('id', '=', requirementId)
      .executeTakeFirst();
    if (!row) throw notFound('Requirement not found');
    await this.authz.requireAccess(actor, row.project_id, 'editor');

    if (!row.deleted_at) return this.get(actor, requirementId);

    if (Date.now() - new Date(row.deleted_at).getTime() > SOFT_DELETE_WINDOW_MS) {
      throw unprocessable(
        'restore_window_expired',
        'This requirement was deleted more than 30 days ago and can no longer be restored.',
      );
    }

    const now = nowIso();
    return this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('requirements')
        .set({ deleted_at: null, updated_at: now, updated_by: actor.id, version: row.version + 1 })
        .where('id', '=', requirementId)
        .execute();

      await this.searchIndex.upsert(
        {
          requirementId: row.id,
          title: row.title,
          statement: row.statement,
          rationale: row.rationale,
        },
        trx,
      );

      const tagNames = (await this.tags.namesFor([row.id], trx)).get(row.id) ?? [];
      const restored = mapRequirement(
        { ...row, deleted_at: null, version: row.version + 1, updated_at: now, updated_by: actor.id },
        tagNames,
      );
      await this.writeRevision(trx, restored, actor.id, 'restored');
      return restored;
    });
  }

  /**
   * FR-REQ-014. INV-02 survives this because `next_requirement_number` is never
   * decremented, so the purged key is simply never issued again.
   */
  async purge(actor: User, requirementId: string): Promise<void> {
    const row = await this.db
      .selectFrom('requirements')
      .selectAll()
      .where('id', '=', requirementId)
      .executeTakeFirst();
    if (!row) throw notFound('Requirement not found');
    await this.authz.requireAccess(actor, row.project_id, 'owner');

    if (!row.deleted_at) {
      throw unprocessable('not_deleted', 'Only a deleted requirement can be purged.');
    }
    if (Date.now() - new Date(row.deleted_at).getTime() <= SOFT_DELETE_WINDOW_MS) {
      throw unprocessable(
        'purge_window_open',
        'A requirement can only be purged once it has been deleted for more than 30 days.',
      );
    }

    await this.db.transaction().execute(async (trx) => {
      await this.searchIndex.remove(requirementId, trx);
      await trx.deleteFrom('requirements').where('id', '=', requirementId).execute();
    });
  }

  /** FR-REQ-015 */
  async duplicate(actor: User, requirementId: string): Promise<Requirement> {
    const source = await this.loadLive(requirementId);
    await this.authz.requireAccess(actor, source.project_id, 'editor');

    const tagNames = (await this.tags.namesFor([source.id])).get(source.id) ?? [];

    return this.create(actor, source.project_id, {
      title: `${source.title} (copy)`.slice(0, MAX_TITLE),
      statement: source.statement,
      rationale: source.rationale,
      type: source.type as RequirementType,
      priority: source.priority as Priority,
      // A duplicate always starts in draft, whatever the original had reached.
      status: 'draft',
      acceptanceCriteria: source.acceptance_criteria,
      source: source.source,
      ownerId: source.owner_id,
      categoryId: source.category_id,
      parentId: source.parent_id,
      tags: tagNames,
    });
  }

  /** FR-ORG-014 */
  async reorder(
    actor: User,
    projectId: string,
    categoryId: string | null,
    orderedIds: string[],
  ): Promise<void> {
    await this.authz.requireAccess(actor, projectId, 'editor');

    const siblings = await this.db
      .selectFrom('requirements')
      .select('id')
      .where('project_id', '=', projectId)
      .where('category_id', categoryId ? '=' : 'is', categoryId)
      .where('deleted_at', 'is', null)
      .execute();
    const allowed = new Set(siblings.map((s) => s.id));

    for (const id of orderedIds) {
      if (!allowed.has(id)) {
        throw badRequest(
          'not_a_sibling',
          'Every id must be a live requirement in the given category.',
        );
      }
    }

    await this.db.transaction().execute(async (trx) => {
      for (const [index, id] of orderedIds.entries()) {
        await trx
          .updateTable('requirements')
          .set({ sort_order: index })
          .where('id', '=', id)
          .execute();
      }
    });
  }

  /** FR-ORG-015: applied to all of them or to none. */
  async bulkUpdate(
    actor: User,
    projectId: string,
    requirementIds: string[],
    changes: {
      categoryId?: string | null;
      status?: RequirementStatus;
      priority?: Priority;
      ownerId?: string | null;
      addTags?: string[];
      removeTags?: string[];
    },
  ): Promise<{ updated: number }> {
    await this.authz.requireAccess(actor, projectId, 'editor');
    if (requirementIds.length === 0) return { updated: 0 };

    const rows = await this.db
      .selectFrom('requirements')
      .selectAll()
      .where('id', 'in', requirementIds)
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .execute();

    if (rows.length !== requirementIds.length) {
      throw notFound('One or more requirements were not found in this project');
    }

    if (changes.status !== undefined) this.assertEnum('status', changes.status, REQUIREMENT_STATUSES);
    if (changes.priority !== undefined) this.assertEnum('priority', changes.priority, PRIORITIES);

    // Validate every row up front: FR-ORG-015 says all or none, so a single
    // illegal transition has to stop the whole batch before anything is written.
    if (changes.status !== undefined) {
      for (const row of rows) {
        assertTransition(
          row.status as RequirementStatus,
          changes.status,
          row.acceptance_criteria,
        );
      }
    }

    if (changes.categoryId !== undefined || changes.ownerId !== undefined) {
      await this.assertReferencesValid(projectId, {
        categoryId: changes.categoryId ?? null,
        parentId: null,
        ownerId: changes.ownerId ?? null,
      });
    }

    const now = nowIso();

    await this.db.transaction().execute(async (trx) => {
      for (const row of rows) {
        const patch: Partial<RequirementsTable> = {};
        if (changes.categoryId !== undefined) patch.category_id = changes.categoryId;
        if (changes.status !== undefined) patch.status = changes.status;
        if (changes.priority !== undefined) patch.priority = changes.priority;
        if (changes.ownerId !== undefined) patch.owner_id = changes.ownerId;

        await trx
          .updateTable('requirements')
          .set({ ...patch, version: row.version + 1, updated_at: now, updated_by: actor.id })
          .where('id', '=', row.id)
          .execute();

        if (changes.addTags?.length || changes.removeTags?.length) {
          const current = (await this.tags.namesFor([row.id], trx)).get(row.id) ?? [];
          const next = new Set(current);
          for (const tag of changes.addTags ?? []) next.add(tag.trim().toLowerCase());
          for (const tag of changes.removeTags ?? []) next.delete(tag.trim().toLowerCase());
          await this.applyTags(trx, projectId, row.id, [...next]);
        }

        const after = await trx
          .selectFrom('requirements')
          .selectAll()
          .where('id', '=', row.id)
          .executeTakeFirstOrThrow();
        const tagNames = (await this.tags.namesFor([row.id], trx)).get(row.id) ?? [];
        await this.writeRevision(trx, mapRequirement(after, tagNames), actor.id, 'updated');
      }
    });

    return { updated: rows.length };
  }

  // ---------------------------------------------------------------------------

  private async loadLive(requirementId: string): Promise<RequirementsTable> {
    const row = await this.db
      .selectFrom('requirements')
      .selectAll()
      .where('id', '=', requirementId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw notFound('Requirement not found');
    return row;
  }

  private async subtreeIds(rootId: string): Promise<string[]> {
    const out = [rootId];
    let frontier = [rootId];

    while (frontier.length > 0) {
      const children = await this.db
        .selectFrom('requirements')
        .select('id')
        .where('parent_id', 'in', frontier)
        .where('deleted_at', 'is', null)
        .execute();
      frontier = children.map((c) => c.id).filter((id) => !out.includes(id));
      out.push(...frontier);
    }

    return out;
  }

  private async applyTags(
    trx: Kysely<Database>,
    projectId: string,
    requirementId: string,
    names: string[],
  ): Promise<string[]> {
    const tagIds = await this.tags.resolveIds(projectId, names, trx);
    await trx.deleteFrom('requirement_tags').where('requirement_id', '=', requirementId).execute();
    if (tagIds.length > 0) {
      await trx
        .insertInto('requirement_tags')
        .values(tagIds.map((tagId) => ({ requirement_id: requirementId, tag_id: tagId })))
        .execute();
    }
    const rows = await trx
      .selectFrom('tags')
      .select('name')
      .where('id', 'in', tagIds.length > 0 ? tagIds : [''])
      .orderBy('name', 'asc')
      .execute();
    return rows.map((r) => r.name);
  }

  /** FR-AUD-001 and INV-06: one revision per version, holding the state after. */
  private async writeRevision(
    trx: Kysely<Database>,
    requirement: Requirement,
    actorId: string,
    changeKind: 'created' | 'updated' | 'deleted' | 'restored' | 'reverted',
  ): Promise<void> {
    await trx
      .insertInto('revisions')
      .values({
        id: newId(),
        requirement_id: requirement.id,
        version: requirement.version,
        snapshot: JSON.stringify(requirement),
        changed_by: actorId,
        changed_at: nowIso(),
        change_kind: changeKind,
      })
      .execute();
  }

  private assertEnum<T extends string>(
    field: string,
    value: string,
    allowed: readonly T[],
  ): asserts value is T {
    if (!allowed.includes(value as T)) {
      throw badRequest('invalid_value', `${field} must be one of: ${allowed.join(', ')}.`);
    }
  }

  private validateContent(
    input: Partial<CreateRequirementInput>,
    resolved: { title: string; statement: string; type: RequirementType },
  ): {
    title: string;
    statement: string;
    rationale: string | null;
    acceptanceCriteria: string | null;
    source: string | null;
  } {
    const title = resolved.title.trim();
    if (title.length === 0 || title.length > MAX_TITLE) {
      throw badRequest('invalid_title', `A title of 1 to ${MAX_TITLE} characters is required.`);
    }

    const statement = resolved.statement.trim();
    if (statement.length === 0 || statement.length > MAX_TEXT) {
      throw badRequest(
        'invalid_statement',
        `A statement of 1 to ${MAX_TEXT} characters is required.`,
      );
    }

    this.assertEnum('type', resolved.type, REQUIREMENT_TYPES);

    const longField = (value: string | null | undefined, field: string): string | null => {
      const trimmed = value?.trim();
      if (!trimmed) return null;
      if (trimmed.length > MAX_TEXT) {
        throw badRequest(`invalid_${field}`, `${field} may be at most ${MAX_TEXT} characters.`);
      }
      return trimmed;
    };

    const source = input.source?.trim() || null;
    if (source && source.length > MAX_SOURCE) {
      throw badRequest('invalid_source', `source may be at most ${MAX_SOURCE} characters.`);
    }

    return {
      title,
      statement,
      rationale: longField(input.rationale, 'rationale'),
      acceptanceCriteria: longField(input.acceptanceCriteria, 'acceptance_criteria'),
      source,
    };
  }

  /** INV-04, INV-05, and the owner-must-be-a-member rule from §4.8. */
  private async assertReferencesValid(
    projectId: string,
    refs: {
      categoryId: string | null;
      parentId: string | null;
      ownerId: string | null;
      selfId?: string;
    },
  ): Promise<void> {
    if (refs.categoryId) {
      const category = await this.db
        .selectFrom('categories')
        .select('id')
        .where('id', '=', refs.categoryId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!category) throw notFound('Category not found in this project');
    }

    if (refs.ownerId) {
      const member = await this.db
        .selectFrom('memberships')
        .select('id')
        .where('user_id', '=', refs.ownerId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!member) {
        throw unprocessable(
          'owner_not_member',
          'A requirement owner must be a member of the project.',
        );
      }
    }

    if (refs.parentId) {
      if (refs.selfId && refs.parentId === refs.selfId) {
        throw unprocessable('parent_cycle', 'A requirement cannot be its own parent.');
      }

      const parent = await this.db
        .selectFrom('requirements')
        .select(['id', 'project_id'])
        .where('id', '=', refs.parentId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!parent) throw notFound('Parent requirement not found');
      if (parent.project_id !== projectId) {
        throw unprocessable(
          'parent_other_project',
          'A parent requirement must belong to the same project.',
        );
      }

      // FR-ORG-013 / INV-04: walk the ancestor chain looking for ourselves.
      if (refs.selfId) {
        let cursor: string | null = refs.parentId;
        const seen = new Set<string>();
        while (cursor) {
          if (cursor === refs.selfId) {
            throw unprocessable(
              'parent_cycle',
              'That parent would create a cycle in the requirement hierarchy.',
            );
          }
          if (seen.has(cursor)) break;
          seen.add(cursor);

          const next: { parent_id: string | null } | undefined = await this.db
            .selectFrom('requirements')
            .select('parent_id')
            .where('id', '=', cursor)
            .executeTakeFirst();
          cursor = next?.parent_id ?? null;
        }
      }
    }
  }
}

function sameTagSet(a: string[], b: string[]): boolean {
  const left = new Set(a.map((t) => t.trim().toLowerCase()));
  const right = new Set(b.map((t) => t.trim().toLowerCase()));
  if (left.size !== right.size) return false;
  for (const tag of left) if (!right.has(tag)) return false;
  return true;
}
