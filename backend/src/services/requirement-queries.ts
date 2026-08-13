import { type Kysely, type SelectQueryBuilder, sql } from 'kysely';
import type { SearchIndex } from '../db/search-index.js';
import type { Database } from '../db/types.js';
import { badRequest } from '../domain/errors.js';
import type { User } from './accounts.js';
import type { AuthorizationService } from './authorization.js';
import type { CategoriesService } from './categories.js';
import { type Requirement, mapRequirement } from './requirements.js';
import type { TagsService } from './tags.js';

/** FR-SRCH-001 */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** FR-SRCH-004 */
export const SORT_FIELDS = [
  'key',
  'title',
  'status',
  'priority',
  'createdAt',
  'updatedAt',
] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export interface ListQuery {
  type?: string[];
  status?: string[];
  priority?: string[];
  categoryId?: string | null;
  /** FR-SRCH-003 */
  includeDescendants?: boolean;
  uncategorized?: boolean;
  tag?: string[];
  ownerId?: string;
  authorId?: string;
  parentId?: string | null;
  /** FR-SRCH-005 */
  q?: string;
  /** FR-SRCH-008 */
  includeDeleted?: boolean;
  sort?: SortField;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ListResult {
  items: Requirement[];
  total: number;
  limit: number;
  offset: number;
}

export interface RequirementNode extends Requirement {
  children: RequirementNode[];
}

export interface TreeCategory {
  id: string | null;
  name: string;
  requirements: RequirementNode[];
  children: TreeCategory[];
}

/**
 * Logical rather than alphabetical ordering. Written as a CASE so the two
 * engines agree without either of them needing an enum type.
 */
const PRIORITY_RANK = sql<number>`case priority
  when 'must' then 0 when 'should' then 1 when 'could' then 2 when 'wont' then 3 else 4 end`;

const STATUS_RANK = sql<number>`case status
  when 'draft' then 0 when 'proposed' then 1 when 'approved' then 2 when 'implemented' then 3
  when 'verified' then 4 when 'rejected' then 5 when 'obsolete' then 6 else 7 end`;

export class RequirementQueryService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly tags: TagsService,
    private readonly categories: CategoriesService,
    private readonly searchIndex: SearchIndex,
  ) {}

  /** FR-SRCH-001 to FR-SRCH-006, FR-SRCH-008 */
  async list(actor: User, projectId: string, query: ListQuery): Promise<ListResult> {
    // FR-SRCH-006: scoping happens here, before anything is read.
    await this.authz.requireAccess(actor, projectId);

    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const offset = Math.max(query.offset ?? 0, 0);

    let matchedIds: string[] | null = null;
    if (query.q?.trim()) {
      matchedIds = await this.searchIndex.match(query.q);
      if (matchedIds.length === 0) {
        return { items: [], total: 0, limit, offset };
      }
    }

    let categoryIds: string[] | null = null;
    if (query.categoryId) {
      categoryIds = query.includeDescendants
        ? await this.categories.subtreeIds(projectId, query.categoryId)
        : [query.categoryId];
    }

    let tagRequirementIds: string[] | null = null;
    if (query.tag?.length) {
      const rows = await this.db
        .selectFrom('requirement_tags')
        .innerJoin('tags', 'tags.id', 'requirement_tags.tag_id')
        .select('requirement_tags.requirement_id as id')
        .where('tags.project_id', '=', projectId)
        .where(
          'tags.name',
          'in',
          query.tag.map((t) => t.trim().toLowerCase()),
        )
        .execute();
      tagRequirementIds = [...new Set(rows.map((r) => r.id))];
      if (tagRequirementIds.length === 0) return { items: [], total: 0, limit, offset };
    }

    const restrictIds = intersect(matchedIds, tagRequirementIds);
    if (restrictIds !== null && restrictIds.length === 0) {
      return { items: [], total: 0, limit, offset };
    }

    const applyFilters = <T>(
      builder: SelectQueryBuilder<Database, 'requirements', T>,
    ): SelectQueryBuilder<Database, 'requirements', T> => {
      let q = builder.where('project_id', '=', projectId);

      // FR-SRCH-008
      if (!query.includeDeleted) q = q.where('deleted_at', 'is', null);

      if (query.type?.length) q = q.where('type', 'in', query.type);
      if (query.status?.length) q = q.where('status', 'in', query.status);
      if (query.priority?.length) q = q.where('priority', 'in', query.priority);
      if (query.ownerId) q = q.where('owner_id', '=', query.ownerId);
      if (query.authorId) q = q.where('created_by', '=', query.authorId);
      if (query.uncategorized) q = q.where('category_id', 'is', null);
      else if (categoryIds) q = q.where('category_id', 'in', categoryIds);
      if (query.parentId === null) q = q.where('parent_id', 'is', null);
      else if (query.parentId) q = q.where('parent_id', '=', query.parentId);
      if (restrictIds) q = q.where('id', 'in', restrictIds);

      return q;
    };

    const countRow = await applyFilters(
      this.db.selectFrom('requirements').select((eb) => eb.fn.countAll<number>().as('count')),
    ).executeTakeFirst();

    let rowsQuery = applyFilters(this.db.selectFrom('requirements').selectAll());
    rowsQuery = this.applySort(rowsQuery, query.sort ?? 'key', query.direction ?? 'asc');

    const rows = await rowsQuery.limit(limit).offset(offset).execute();
    const tagNames = await this.tags.namesFor(rows.map((r) => r.id));

    return {
      items: rows.map((row) => mapRequirement(row, tagNames.get(row.id) ?? [])),
      total: Number(countRow?.count ?? 0),
      limit,
      offset,
    };
  }

  /** FR-SRCH-004 */
  private applySort<T>(
    query: SelectQueryBuilder<Database, 'requirements', T>,
    field: SortField,
    direction: 'asc' | 'desc',
  ): SelectQueryBuilder<Database, 'requirements', T> {
    switch (field) {
      case 'key':
        // Keys share a project prefix, so ordering by length first puts PRJ-2
        // ahead of PRJ-10 without a numeric cast either engine might read
        // differently.
        return query
          .orderBy(sql`length(key)`, direction)
          .orderBy('key', direction);
      case 'title':
        return query.orderBy('title', direction).orderBy('key', 'asc');
      case 'status':
        return query.orderBy(STATUS_RANK, direction).orderBy('key', 'asc');
      case 'priority':
        return query.orderBy(PRIORITY_RANK, direction).orderBy('key', 'asc');
      case 'createdAt':
        return query.orderBy('created_at', direction).orderBy('key', 'asc');
      case 'updatedAt':
        return query.orderBy('updated_at', direction).orderBy('key', 'asc');
      default:
        throw badRequest('invalid_sort', `sort must be one of: ${SORT_FIELDS.join(', ')}.`);
    }
  }

  /**
   * FR-SRCH-007: the category hierarchy, and within it the parent–child
   * decomposition.
   */
  async tree(actor: User, projectId: string): Promise<TreeCategory[]> {
    await this.authz.requireAccess(actor, projectId);

    const [categories, all] = await Promise.all([
      this.categories.list(actor, projectId),
      this.exportAll(actor, projectId, { sort: 'key' }),
    ]);

    const byCategory = new Map<string | null, Requirement[]>();
    for (const requirement of all) {
      const list = byCategory.get(requirement.categoryId) ?? [];
      list.push(requirement);
      byCategory.set(requirement.categoryId, list);
    }

    const buildRequirementForest = (items: Requirement[]): RequirementNode[] => {
      const nodes = new Map(items.map((r) => [r.id, { ...r, children: [] as RequirementNode[] }]));
      const roots: RequirementNode[] = [];
      for (const item of items) {
        const node = nodes.get(item.id)!;
        const parent = item.parentId ? nodes.get(item.parentId) : undefined;
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      const sortNodes = (list: RequirementNode[]): void => {
        list.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
        for (const node of list) sortNodes(node.children);
      };
      sortNodes(roots);
      return roots;
    };

    const buildCategory = (parentId: string | null): TreeCategory[] =>
      categories
        .filter((c) => c.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((category) => ({
          id: category.id,
          name: category.name,
          requirements: buildRequirementForest(byCategory.get(category.id) ?? []),
          children: buildCategory(category.id),
        }));

    const uncategorized = byCategory.get(null) ?? [];
    const roots = buildCategory(null);

    if (uncategorized.length > 0) {
      roots.push({
        id: null,
        name: 'Uncategorized',
        requirements: buildRequirementForest(uncategorized),
        children: [],
      });
    }

    return roots;
  }

  /** FR-SRCH-009 */
  async exportAll(
    actor: User,
    projectId: string,
    query: ListQuery,
  ): Promise<Requirement[]> {
    await this.authz.requireAccess(actor, projectId);
    const out: Requirement[] = [];
    let offset = 0;

    for (;;) {
      const page = await this.list(actor, projectId, {
        ...query,
        limit: MAX_PAGE_SIZE,
        offset,
      });
      out.push(...page.items);
      offset += page.items.length;
      if (page.items.length === 0 || out.length >= page.total) break;
    }

    return out;
  }
}

export function toCsv(requirements: Requirement[]): string {
  const columns = [
    'key',
    'title',
    'statement',
    'rationale',
    'type',
    'priority',
    'status',
    'acceptanceCriteria',
    'source',
    'tags',
    'version',
    'createdAt',
    'updatedAt',
  ] as const;

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = Array.isArray(value) ? value.join(' ') : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [columns.join(',')];
  for (const requirement of requirements) {
    lines.push(columns.map((column) => escape(requirement[column])).join(','));
  }
  return lines.join('\n');
}

function intersect(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  const right = new Set(b);
  return a.filter((id) => right.has(id));
}
