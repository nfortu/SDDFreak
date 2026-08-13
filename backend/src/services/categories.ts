import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { badRequest, conflict, notFound, unprocessable } from '../domain/errors.js';
import { newId, nowIso } from '../domain/primitives.js';
import type { User } from './accounts.js';
import type { AuthorizationService } from './authorization.js';

/** FR-ORG-002 and INV-03: at least 5 levels, and no more. */
export const MAX_CATEGORY_DEPTH = 5;

export interface Category {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  depth: number;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

interface Row {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
}

export class CategoriesService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
  ) {}

  private async rows(projectId: string): Promise<Row[]> {
    return this.db
      .selectFrom('categories')
      .select(['id', 'project_id', 'parent_id', 'name', 'sort_order'])
      .where('project_id', '=', projectId)
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')
      .execute();
  }

  async list(actor: User, projectId: string): Promise<Category[]> {
    await this.authz.requireAccess(actor, projectId);
    const rows = await this.rows(projectId);
    const depths = depthMap(rows);
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      parentId: row.parent_id,
      name: row.name,
      sortOrder: row.sort_order,
      depth: depths.get(row.id) ?? 1,
    }));
  }

  async tree(actor: User, projectId: string): Promise<CategoryNode[]> {
    const flat = await this.list(actor, projectId);
    return buildTree(flat);
  }

  /** FR-ORG-001 (create), FR-ORG-002 (depth), FR-ORG-004 (sibling names) */
  async create(
    actor: User,
    projectId: string,
    input: { name: string; parentId?: string | null; sortOrder?: number },
  ): Promise<Category> {
    await this.authz.requireAccess(actor, projectId, 'editor');
    const name = this.validName(input.name);
    const rows = await this.rows(projectId);

    const parentId = input.parentId ?? null;
    if (parentId) {
      const parent = rows.find((r) => r.id === parentId);
      if (!parent) throw notFound('Parent category not found');
      const parentDepth = depthMap(rows).get(parentId) ?? 1;
      if (parentDepth + 1 > MAX_CATEGORY_DEPTH) {
        throw unprocessable(
          'category_too_deep',
          `Categories may not nest more than ${MAX_CATEGORY_DEPTH} levels deep.`,
        );
      }
    }

    this.assertSiblingNameFree(rows, parentId, name, null);

    const siblings = rows.filter((r) => r.parent_id === parentId);
    const now = nowIso();
    const category: Row = {
      id: newId(),
      project_id: projectId,
      parent_id: parentId,
      name,
      sort_order: input.sortOrder ?? siblings.length,
    };

    await this.db
      .insertInto('categories')
      .values({
        ...category,
        created_at: now,
        created_by: actor.id,
        updated_at: now,
        updated_by: actor.id,
      })
      .execute();

    return {
      id: category.id,
      projectId,
      parentId,
      name,
      sortOrder: category.sort_order,
      depth: parentId ? (depthMap(rows).get(parentId) ?? 1) + 1 : 1,
    };
  }

  /** FR-ORG-001 (rename) */
  async rename(actor: User, projectId: string, categoryId: string, name: string): Promise<Category> {
    await this.authz.requireAccess(actor, projectId, 'editor');
    const rows = await this.rows(projectId);
    const current = rows.find((r) => r.id === categoryId);
    if (!current) throw notFound('Category not found');

    const next = this.validName(name);
    this.assertSiblingNameFree(rows, current.parent_id, next, categoryId);

    await this.db
      .updateTable('categories')
      .set({ name: next, updated_at: nowIso(), updated_by: actor.id })
      .where('id', '=', categoryId)
      .execute();

    return {
      id: categoryId,
      projectId,
      parentId: current.parent_id,
      name: next,
      sortOrder: current.sort_order,
      depth: depthMap(rows).get(categoryId) ?? 1,
    };
  }

  /** FR-ORG-001 (move), FR-ORG-003 (no cycles), FR-ORG-002 (depth) */
  async move(
    actor: User,
    projectId: string,
    categoryId: string,
    newParentId: string | null,
  ): Promise<Category> {
    await this.authz.requireAccess(actor, projectId, 'editor');
    const rows = await this.rows(projectId);
    const current = rows.find((r) => r.id === categoryId);
    if (!current) throw notFound('Category not found');

    if (newParentId) {
      const parent = rows.find((r) => r.id === newParentId);
      if (!parent) throw notFound('Parent category not found');

      // FR-ORG-003: a category cannot be moved inside its own subtree, which
      // includes moving it onto itself.
      if (newParentId === categoryId || descendantsOf(rows, categoryId).has(newParentId)) {
        throw unprocessable(
          'category_cycle',
          'A category cannot be moved inside its own subtree.',
        );
      }

      const parentDepth = depthMap(rows).get(newParentId) ?? 1;
      const height = subtreeHeight(rows, categoryId);
      if (parentDepth + height > MAX_CATEGORY_DEPTH) {
        throw unprocessable(
          'category_too_deep',
          `That move would nest categories more than ${MAX_CATEGORY_DEPTH} levels deep.`,
        );
      }
    }

    this.assertSiblingNameFree(rows, newParentId, current.name, categoryId);

    await this.db
      .updateTable('categories')
      .set({ parent_id: newParentId, updated_at: nowIso(), updated_by: actor.id })
      .where('id', '=', categoryId)
      .execute();

    const updated = await this.rows(projectId);
    return {
      id: categoryId,
      projectId,
      parentId: newParentId,
      name: current.name,
      sortOrder: current.sort_order,
      depth: depthMap(updated).get(categoryId) ?? 1,
    };
  }

  /** FR-ORG-007 */
  async reorder(
    actor: User,
    projectId: string,
    parentId: string | null,
    orderedIds: string[],
  ): Promise<Category[]> {
    await this.authz.requireAccess(actor, projectId, 'editor');
    const rows = await this.rows(projectId);
    const siblings = new Set(
      rows.filter((r) => r.parent_id === parentId).map((r) => r.id),
    );

    for (const id of orderedIds) {
      if (!siblings.has(id)) {
        throw badRequest('not_a_sibling', 'Every id must be a category with the given parent.');
      }
    }

    await this.db.transaction().execute(async (trx) => {
      for (const [index, id] of orderedIds.entries()) {
        await trx
          .updateTable('categories')
          .set({ sort_order: index, updated_at: nowIso(), updated_by: actor.id })
          .where('id', '=', id)
          .execute();
      }
    });

    return this.list(actor, projectId);
  }

  /**
   * FR-ORG-005: children and requirements move up to the deleted category's
   * parent, or become uncategorized when it was a root.
   */
  async remove(actor: User, projectId: string, categoryId: string): Promise<void> {
    await this.authz.requireAccess(actor, projectId, 'editor');
    const rows = await this.rows(projectId);
    const current = rows.find((r) => r.id === categoryId);
    if (!current) throw notFound('Category not found');

    const newParent = current.parent_id;

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('categories')
        .set({ parent_id: newParent, updated_at: nowIso(), updated_by: actor.id })
        .where('parent_id', '=', categoryId)
        .execute();

      await trx
        .updateTable('requirements')
        .set({ category_id: newParent, updated_at: nowIso(), updated_by: actor.id })
        .where('category_id', '=', categoryId)
        .execute();

      await trx.deleteFrom('categories').where('id', '=', categoryId).execute();
    });
  }

  /** Ids of a category and everything beneath it — FR-SRCH-003 uses this. */
  async subtreeIds(projectId: string, categoryId: string): Promise<string[]> {
    const rows = await this.rows(projectId);
    return [categoryId, ...descendantsOf(rows, categoryId)];
  }

  private validName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
      throw badRequest('invalid_category_name', 'A category name of 1 to 100 characters is required.');
    }
    return trimmed;
  }

  /** FR-ORG-004 */
  private assertSiblingNameFree(
    rows: Row[],
    parentId: string | null,
    name: string,
    exceptId: string | null,
  ): void {
    const clash = rows.find(
      (r) =>
        r.parent_id === parentId &&
        r.id !== exceptId &&
        r.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      throw conflict('category_name_taken', `A sibling category is already called '${name}'.`);
    }
  }
}

function depthMap(rows: Row[]): Map<string, number> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depths = new Map<string, number>();

  const depthOf = (id: string, seen = new Set<string>()): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 1; // defensive: the database prevents cycles
    seen.add(id);

    const row = byId.get(id);
    const depth = row?.parent_id ? depthOf(row.parent_id, seen) + 1 : 1;
    depths.set(id, depth);
    return depth;
  };

  for (const row of rows) depthOf(row.id);
  return depths;
}

function descendantsOf(rows: Row[], id: string): Set<string> {
  const childrenOf = new Map<string | null, Row[]>();
  for (const row of rows) {
    const list = childrenOf.get(row.parent_id) ?? [];
    list.push(row);
    childrenOf.set(row.parent_id, list);
  }

  const out = new Set<string>();
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (out.has(next.id)) continue;
    out.add(next.id);
    stack.push(...(childrenOf.get(next.id) ?? []));
  }
  return out;
}

/** 1 for a leaf, 2 for a parent of leaves, and so on. */
function subtreeHeight(rows: Row[], id: string): number {
  const children = rows.filter((r) => r.parent_id === id);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => subtreeHeight(rows, child.id)));
}

function buildTree(categories: Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>(
    categories.map((c) => [c.id, { ...c, children: [] }]),
  );
  const roots: CategoryNode[] = [];

  for (const category of categories) {
    const node = nodes.get(category.id)!;
    if (category.parentId && nodes.has(category.parentId)) {
      nodes.get(category.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sort = (list: CategoryNode[]): void => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    for (const node of list) sort(node.children);
  };
  sort(roots);

  return roots;
}
