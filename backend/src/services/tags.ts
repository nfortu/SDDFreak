import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { badRequest, conflict, notFound } from '../domain/errors.js';
import { newId, normalizeTagName } from '../domain/primitives.js';
import type { User } from './accounts.js';
import type { AuthorizationService } from './authorization.js';

/** FR-ORG-008: "no limit below 50 tags per requirement". */
export const MAX_TAGS_PER_REQUIREMENT = 50;

export interface Tag {
  id: string;
  name: string;
  usageCount?: number;
}

export class TagsService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
  ) {}

  /** FR-ORG-010 feeds from this. */
  async list(actor: User, projectId: string): Promise<Tag[]> {
    await this.authz.requireAccess(actor, projectId);

    const [tags, counts] = await Promise.all([
      this.db
        .selectFrom('tags')
        .select(['id', 'name'])
        .where('project_id', '=', projectId)
        .orderBy('name', 'asc')
        .execute(),
      this.db
        .selectFrom('requirement_tags')
        .innerJoin('requirements', 'requirements.id', 'requirement_tags.requirement_id')
        .select('requirement_tags.tag_id as tagId')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('requirements.project_id', '=', projectId)
        .where('requirements.deleted_at', 'is', null)
        .groupBy('requirement_tags.tag_id')
        .execute(),
    ]);

    const usage = new Map(counts.map((c) => [c.tagId, Number(c.count)]));
    return tags.map((tag) => ({ ...tag, usageCount: usage.get(tag.id) ?? 0 }));
  }

  /**
   * FR-ORG-009: names are normalized, and an existing tag with the normalized
   * name is reused rather than duplicated.
   */
  async resolveIds(
    projectId: string,
    names: string[],
    trx: Kysely<Database> = this.db,
  ): Promise<string[]> {
    const normalized = [...new Set(names.map(normalizeTagName).filter((n) => n.length > 0))];

    if (normalized.length > MAX_TAGS_PER_REQUIREMENT) {
      throw badRequest(
        'too_many_tags',
        `A requirement may carry at most ${MAX_TAGS_PER_REQUIREMENT} tags.`,
      );
    }
    for (const name of normalized) {
      if (name.length > 50) {
        throw badRequest('invalid_tag_name', 'A tag name may be at most 50 characters.');
      }
    }
    if (normalized.length === 0) return [];

    const existing = await trx
      .selectFrom('tags')
      .select(['id', 'name'])
      .where('project_id', '=', projectId)
      .where('name', 'in', normalized)
      .execute();

    const byName = new Map(existing.map((t) => [t.name, t.id]));
    const missing = normalized.filter((name) => !byName.has(name));

    if (missing.length > 0) {
      const created = missing.map((name) => ({ id: newId(), project_id: projectId, name }));
      await trx.insertInto('tags').values(created).execute();
      for (const tag of created) byName.set(tag.name, tag.id);
    }

    return normalized.map((name) => byName.get(name)!);
  }

  /** FR-ORG-011 (rename across the project) */
  async rename(actor: User, projectId: string, tagId: string, name: string): Promise<Tag> {
    await this.authz.requireAccess(actor, projectId, 'editor');
    const normalized = normalizeTagName(name);
    if (normalized.length === 0 || normalized.length > 50) {
      throw badRequest('invalid_tag_name', 'A tag name of 1 to 50 characters is required.');
    }

    const tag = await this.db
      .selectFrom('tags')
      .select(['id', 'name'])
      .where('id', '=', tagId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (!tag) throw notFound('Tag not found');

    const clash = await this.db
      .selectFrom('tags')
      .select('id')
      .where('project_id', '=', projectId)
      .where('name', '=', normalized)
      .where('id', '!=', tagId)
      .executeTakeFirst();
    if (clash) {
      throw conflict('tag_name_taken', `A tag called '${normalized}' already exists here.`);
    }

    await this.db.updateTable('tags').set({ name: normalized }).where('id', '=', tagId).execute();
    return { id: tagId, name: normalized };
  }

  /** FR-ORG-011 (delete, detaching from every requirement) */
  async remove(actor: User, projectId: string, tagId: string): Promise<void> {
    await this.authz.requireAccess(actor, projectId, 'editor');
    const tag = await this.db
      .selectFrom('tags')
      .select('id')
      .where('id', '=', tagId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (!tag) throw notFound('Tag not found');

    // requirement_tags cascades on delete, which is the detachment.
    await this.db.deleteFrom('tags').where('id', '=', tagId).execute();
  }

  /**
   * `executor` must be the surrounding transaction when called from inside one.
   * SQLite serves the whole application from a single connection, so reaching
   * for the root handle mid-transaction deadlocks rather than erroring.
   */
  async namesFor(
    requirementIds: string[],
    executor: Kysely<Database> = this.db,
  ): Promise<Map<string, string[]>> {
    if (requirementIds.length === 0) return new Map();

    const rows = await executor
      .selectFrom('requirement_tags')
      .innerJoin('tags', 'tags.id', 'requirement_tags.tag_id')
      .select(['requirement_tags.requirement_id as requirementId', 'tags.name as name'])
      .where('requirement_tags.requirement_id', 'in', requirementIds)
      .orderBy('tags.name', 'asc')
      .execute();

    const out = new Map<string, string[]>();
    for (const row of rows) {
      const list = out.get(row.requirementId) ?? [];
      list.push(row.name);
      out.set(row.requirementId, list);
    }
    return out;
  }
}
