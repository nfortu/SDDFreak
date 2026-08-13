import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  type TestContext,
  as,
  createActor,
  createProject,
  createRequirement,
  createTestContext,
  uniqueKey,
} from './helpers.js';

describe('organization and categorization (§6.6)', () => {
  let ctx: TestContext;
  let owner: Actor;
  let projectId: string;

  const createCategory = async (name: string, parentId: string | null = null) => {
    const response = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/projects/${projectId}/categories`,
        payload: { name, parentId },
      }),
    );
    return response;
  };

  beforeAll(async () => {
    ctx = await createTestContext();
    owner = await createActor(ctx);
    projectId = (await createProject(ctx, owner, uniqueKey('OG'))).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('FR-ORG-002, INV-03: nests 5 levels and refuses a 6th', async () => {
    let parentId: string | null = null;
    const ids: string[] = [];

    for (let level = 1; level <= 5; level += 1) {
      const response = await createCategory(`Level ${level}`, parentId);
      expect(response.statusCode, `level ${level}`).toBe(201);
      expect(response.json().depth).toBe(level);
      parentId = response.json().id;
      ids.push(parentId!);
    }

    const sixth = await createCategory('Level 6', parentId);
    expect(sixth.statusCode).toBe(422);
    expect(sixth.json().error.code).toBe('category_too_deep');
  });

  it('FR-ORG-004: refuses a name that duplicates a sibling', async () => {
    const first = await createCategory('Unique among siblings');
    expect(first.statusCode).toBe(201);

    const clash = await createCategory('Unique among siblings');
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('category_name_taken');

    // The same name is fine under a different parent.
    const nested = await createCategory('Unique among siblings', first.json().id);
    expect(nested.statusCode).toBe(201);
  });

  it('FR-ORG-003: refuses to move a category into its own subtree', async () => {
    const root = await createCategory('Move root');
    const child = await createCategory('Move child', root.json().id);

    const intoChild = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/projects/${projectId}/categories/${root.json().id}`,
        payload: { parentId: child.json().id },
      }),
    );
    expect(intoChild.statusCode).toBe(422);
    expect(intoChild.json().error.code).toBe('category_cycle');

    const intoItself = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/projects/${projectId}/categories/${root.json().id}`,
        payload: { parentId: root.json().id },
      }),
    );
    expect(intoItself.statusCode).toBe(422);
  });

  it('FR-ORG-005: deleting a category lifts its children and requirements to the parent', async () => {
    const grandparent = await createCategory('Grandparent');
    const parent = await createCategory('Parent cat', grandparent.json().id);
    const child = await createCategory('Child cat', parent.json().id);

    const requirement = await createRequirement(ctx, owner, projectId, {
      title: 'Categorized',
      categoryId: parent.json().id,
    });

    const deleted = await ctx.app.inject(
      as(owner, {
        method: 'DELETE',
        url: `/api/projects/${projectId}/categories/${parent.json().id}`,
      }),
    );
    expect(deleted.statusCode).toBe(200);

    const categories = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/projects/${projectId}/categories` }),
    );
    const movedChild = categories
      .json()
      .find((c: { id: string }) => c.id === child.json().id);
    expect(movedChild.parentId).toBe(grandparent.json().id);

    const moved = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${requirement.id}` }),
    );
    expect(moved.json().categoryId).toBe(grandparent.json().id);
  });

  it('FR-ORG-005: a deleted root category leaves its requirements uncategorized', async () => {
    const root = await createCategory('Lonely root');
    const requirement = await createRequirement(ctx, owner, projectId, {
      title: 'Orphaned',
      categoryId: root.json().id,
    });

    await ctx.app.inject(
      as(owner, {
        method: 'DELETE',
        url: `/api/projects/${projectId}/categories/${root.json().id}`,
      }),
    );

    const after = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${requirement.id}` }),
    );
    expect(after.json().categoryId).toBeNull();
  });

  it('FR-ORG-007: reorders sibling categories and keeps that order', async () => {
    const a = await createCategory('Order A');
    const b = await createCategory('Order B');
    const c = await createCategory('Order C');
    const ids = [c.json().id, a.json().id, b.json().id];

    const response = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/projects/${projectId}/categories/reorder`,
        payload: { parentId: null, orderedIds: ids },
      }),
    );
    expect(response.statusCode).toBe(200);

    const ordered = response
      .json()
      .filter((cat: { id: string }) => ids.includes(cat.id))
      .sort((x: { sortOrder: number }, y: { sortOrder: number }) => x.sortOrder - y.sortOrder)
      .map((cat: { id: string }) => cat.id);
    expect(ordered).toEqual(ids);
  });

  it('FR-ORG-006: a requirement takes at most one category and may take none', async () => {
    const category = await createCategory('Single');
    const requirement = await createRequirement(ctx, owner, projectId, {
      title: 'One category',
      categoryId: category.json().id,
    });
    expect(requirement.categoryId).toBe(category.json().id);

    const cleared = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${requirement.id}`,
        payload: { version: requirement.version, categoryId: null },
      }),
    );
    expect(cleared.json().categoryId).toBeNull();
  });

  it('FR-ORG-009: normalizes tags and reuses an existing one', async () => {
    const first = await createRequirement(ctx, owner, projectId, {
      title: 'Tagged one',
      tags: ['  Security  ', 'PERFORMANCE'],
    });
    expect(first.tags).toEqual(['performance', 'security']);

    const second = await createRequirement(ctx, owner, projectId, {
      title: 'Tagged two',
      tags: ['security'],
    });
    expect(second.tags).toEqual(['security']);

    const tags = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/projects/${projectId}/tags` }),
    );
    const security = tags.json().filter((t: { name: string }) => t.name === 'security');
    expect(security).toHaveLength(1);
    expect(security[0].usageCount).toBe(2);
  });

  it('FR-ORG-011: renames a tag across the project and deletes it everywhere', async () => {
    const requirement = await createRequirement(ctx, owner, projectId, {
      title: 'Tag lifecycle',
      tags: ['renameable'],
    });

    const tags = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/projects/${projectId}/tags` }),
    );
    const tag = tags.json().find((t: { name: string }) => t.name === 'renameable');

    const renamed = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/projects/${projectId}/tags/${tag.id}`,
        payload: { name: 'Renamed Tag' },
      }),
    );
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe('renamed tag');

    const afterRename = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${requirement.id}` }),
    );
    expect(afterRename.json().tags).toContain('renamed tag');

    const deleted = await ctx.app.inject(
      as(owner, { method: 'DELETE', url: `/api/projects/${projectId}/tags/${tag.id}` }),
    );
    expect(deleted.statusCode).toBe(200);

    const afterDelete = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${requirement.id}` }),
    );
    expect(afterDelete.json().tags).not.toContain('renamed tag');
  });

  it('FR-ORG-012, FR-ORG-013, INV-04: sets a parent but refuses a cycle', async () => {
    const root = await createRequirement(ctx, owner, projectId, { title: 'Hierarchy root' });
    const child = await createRequirement(ctx, owner, projectId, {
      title: 'Hierarchy child',
      parentId: root.id,
    });
    const grandchild = await createRequirement(ctx, owner, projectId, {
      title: 'Hierarchy grandchild',
      parentId: child.id,
    });

    expect(child.parentId).toBe(root.id);

    // Direct cycle.
    const selfParent = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${root.id}`,
        payload: { version: root.version, parentId: root.id },
      }),
    );
    expect(selfParent.statusCode).toBe(422);
    expect(selfParent.json().error.code).toBe('parent_cycle');

    // Indirect cycle, two levels down.
    const indirect = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${root.id}`,
        payload: { version: root.version, parentId: grandchild.id },
      }),
    );
    expect(indirect.statusCode).toBe(422);
    expect(indirect.json().error.code).toBe('parent_cycle');
  });

  it('FR-ORG-012: refuses a parent from another project', async () => {
    const other = await createProject(ctx, owner, uniqueKey('OT'));
    const foreign = await createRequirement(ctx, owner, other.id, { title: 'Foreign' });

    const response = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/projects/${projectId}/requirements`,
        payload: {
          title: 'Cross project',
          statement: 'The system shall.',
          type: 'functional',
          parentId: foreign.id,
        },
      }),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('parent_other_project');
  });

  it('FR-ORG-014: reorders sibling requirements and keeps that order', async () => {
    const project = await createProject(ctx, owner, uniqueKey('OR'));
    const a = await createRequirement(ctx, owner, project.id, { title: 'A' });
    const b = await createRequirement(ctx, owner, project.id, { title: 'B' });
    const c = await createRequirement(ctx, owner, project.id, { title: 'C' });

    const response = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/projects/${project.id}/requirements/reorder`,
        payload: { categoryId: null, orderedIds: [c.id, a.id, b.id] },
      }),
    );
    expect(response.statusCode).toBe(200);

    const tree = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/projects/${project.id}/requirements/tree` }),
    );
    const uncategorized = tree.json().find((node: { id: string | null }) => node.id === null);
    expect(uncategorized.requirements.map((r: { id: string }) => r.id)).toEqual([c.id, a.id, b.id]);
  });

  it('FR-ORG-015: a bulk change applies to all of them', async () => {
    const project = await createProject(ctx, owner, uniqueKey('BK'));
    const one = await createRequirement(ctx, owner, project.id, { title: 'Bulk one' });
    const two = await createRequirement(ctx, owner, project.id, { title: 'Bulk two' });

    const response = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/projects/${project.id}/requirements/bulk`,
        payload: {
          requirementIds: [one.id, two.id],
          changes: { priority: 'must', addTags: ['bulk'] },
        },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().updated).toBe(2);

    for (const id of [one.id, two.id]) {
      const after = await ctx.app.inject(as(owner, { method: 'GET', url: `/api/requirements/${id}` }));
      expect(after.json().priority).toBe('must');
      expect(after.json().tags).toContain('bulk');
    }
  });

  it('FR-ORG-015: a bulk change with one illegal transition applies to none', async () => {
    const project = await createProject(ctx, owner, uniqueKey('BN'));
    const legal = await createRequirement(ctx, owner, project.id, {
      title: 'Legal',
      status: 'proposed',
      acceptanceCriteria: 'Given a thing, it works.',
    });
    // A terminal status cannot move on, so this one poisons the batch.
    const poison = await createRequirement(ctx, owner, project.id, { title: 'Poison' });
    await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${poison.id}`,
        payload: { version: 1, status: 'obsolete' },
      }),
    );

    const response = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/projects/${project.id}/requirements/bulk`,
        payload: {
          requirementIds: [legal.id, poison.id],
          changes: { status: 'approved' },
        },
      }),
    );

    expect(response.statusCode).toBe(422);

    const untouched = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${legal.id}` }),
    );
    expect(untouched.json().status).toBe('proposed');
  });
});
