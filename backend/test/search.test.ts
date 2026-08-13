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

describe('listing, filtering, and search (§6.7)', () => {
  let ctx: TestContext;
  let owner: Actor;
  let projectId: string;
  let categoryId: string;
  let childCategoryId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    owner = await createActor(ctx);
    projectId = (await createProject(ctx, owner, uniqueKey('SR'))).id;

    const parent = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/projects/${projectId}/categories`,
        payload: { name: 'Security' },
      }),
    );
    categoryId = parent.json().id;

    const child = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/projects/${projectId}/categories`,
        payload: { name: 'Authentication', parentId: categoryId },
      }),
    );
    childCategoryId = child.json().id;

    await createRequirement(ctx, owner, projectId, {
      title: 'Password hashing',
      statement: 'The system shall store passwords using argon2id hashing.',
      type: 'non_functional',
      priority: 'must',
      categoryId,
      tags: ['security'],
    });
    await createRequirement(ctx, owner, projectId, {
      title: 'Session expiry',
      statement: 'The system shall expire an idle session after two hours.',
      type: 'functional',
      priority: 'should',
      categoryId: childCategoryId,
      tags: ['security', 'sessions'],
    });
    await createRequirement(ctx, owner, projectId, {
      title: 'Export to CSV',
      statement: 'The system shall export requirements as comma separated values.',
      type: 'functional',
      priority: 'could',
      rationale: 'Analysts live in spreadsheets.',
      tags: ['reporting'],
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const list = async (query = '') =>
    ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/projects/${projectId}/requirements${query}` }),
    );

  it('FR-SRCH-001: pages with a default of 50, a cap of 200, and a total', async () => {
    const response = await list();
    expect(response.statusCode).toBe(200);
    expect(response.json().limit).toBe(50);
    expect(response.json().total).toBe(3);

    const paged = await list('?limit=2&offset=0');
    expect(paged.json().items).toHaveLength(2);
    expect(paged.json().total).toBe(3);

    const capped = await list('?limit=500');
    expect(capped.statusCode).toBe(400);
  });

  it('FR-SRCH-002: filters by type, status, priority, tag, owner, and author', async () => {
    expect((await list('?type=functional')).json().total).toBe(2);
    expect((await list('?type=non_functional')).json().total).toBe(1);
    expect((await list('?priority=must')).json().total).toBe(1);
    expect((await list('?status=draft')).json().total).toBe(3);
    expect((await list('?tag=security')).json().total).toBe(2);
    expect((await list('?tag=reporting')).json().total).toBe(1);
    expect((await list(`?authorId=${owner.id}`)).json().total).toBe(3);
    expect((await list(`?ownerId=${owner.id}`)).json().total).toBe(0);
  });

  it('FR-SRCH-002: combines filters conjunctively', async () => {
    const response = await list('?type=functional&tag=security');
    expect(response.json().total).toBe(1);
    expect(response.json().items[0].title).toBe('Session expiry');
  });

  it('FR-SRCH-003: filters by a category alone or with its descendants', async () => {
    const alone = await list(`?categoryId=${categoryId}`);
    expect(alone.json().total).toBe(1);
    expect(alone.json().items[0].title).toBe('Password hashing');

    const withDescendants = await list(`?categoryId=${categoryId}&includeDescendants=true`);
    expect(withDescendants.json().total).toBe(2);
  });

  it('FR-SRCH-002: filters to the uncategorized', async () => {
    const response = await list('?uncategorized=true');
    expect(response.json().total).toBe(1);
    expect(response.json().items[0].title).toBe('Export to CSV');
  });

  it('FR-SRCH-004: sorts by key numerically rather than lexicographically', async () => {
    const project = await createProject(ctx, owner, uniqueKey('NM'));
    for (let index = 0; index < 11; index += 1) {
      await createRequirement(ctx, owner, project.id, { title: `Item ${index}` });
    }

    const response = await ctx.app.inject(
      as(owner, {
        method: 'GET',
        url: `/api/projects/${project.id}/requirements?sort=key&direction=asc&limit=200`,
      }),
    );

    const numbers = response
      .json()
      .items.map((r: { key: string }) => Number(r.key.split('-')[1]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(numbers[numbers.length - 1]).toBe(11);
  });

  it('FR-SRCH-004: sorts by priority in MoSCoW order, not alphabetically', async () => {
    const response = await list('?sort=priority&direction=asc');
    expect(response.json().items.map((r: { priority: string }) => r.priority)).toEqual([
      'must',
      'should',
      'could',
    ]);
  });

  it('FR-SRCH-004: sorts by title and by update time, both directions', async () => {
    const ascending = await list('?sort=title&direction=asc');
    const descending = await list('?sort=title&direction=desc');

    const titles = ascending.json().items.map((r: { title: string }) => r.title);
    expect(titles).toEqual([...titles].sort());
    expect(descending.json().items.map((r: { title: string }) => r.title)).toEqual(
      [...titles].reverse(),
    );

    const byUpdate = await list('?sort=updatedAt&direction=desc');
    expect(byUpdate.statusCode).toBe(200);
  });

  it('FR-SRCH-005, TR-DB-012: finds a requirement by a word in its statement', async () => {
    const response = await list('?q=argon2id');
    expect(response.json().total).toBe(1);
    expect(response.json().items[0].title).toBe('Password hashing');
  });

  it('FR-SRCH-005: searches title and rationale as well as statement', async () => {
    expect((await list('?q=expiry')).json().total).toBe(1);
    expect((await list('?q=spreadsheets')).json().total).toBe(1);
    expect((await list('?q=nothingmatchesthis')).json().total).toBe(0);
  });

  it('FR-SRCH-005: ANDs the terms of a multi-word query', async () => {
    expect((await list('?q=idle%20session')).json().total).toBe(1);
    expect((await list('?q=idle%20argon2id')).json().total).toBe(0);
  });

  it('FR-SRCH-005: treats engine operators as literal text', async () => {
    // "OR" and "*" are FTS5 syntax; matching them literally is what keeps a
    // user's punctuation from becoming a query language.
    const response = await list('?q=session%20OR%20argon2id');
    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(0);
  });

  it('FR-SRCH-005: reflects an edit in the search index', async () => {
    const created = await createRequirement(ctx, owner, projectId, {
      title: 'Indexed',
      statement: 'The system shall mention zebracrossing.',
    });
    expect((await list('?q=zebracrossing')).json().total).toBe(1);

    await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: 1, statement: 'The system shall mention aardvark instead.' },
      }),
    );

    expect((await list('?q=zebracrossing')).json().total).toBe(0);
    expect((await list('?q=aardvark')).json().total).toBe(1);

    await ctx.app.inject(as(owner, { method: 'DELETE', url: `/api/requirements/${created.id}` }));
    expect((await list('?q=aardvark')).json().total).toBe(0);
  });

  it('FR-SRCH-006: a search never reaches a project the actor cannot read', async () => {
    const stranger = await createActor(ctx);
    const secret = await createProject(ctx, stranger, uniqueKey('SC'));
    await createRequirement(ctx, stranger, secret.id, {
      title: 'Confidential',
      statement: 'The system shall keep the magicword safe.',
    });

    const mine = await list('?q=magicword');
    expect(mine.json().total).toBe(0);

    const theirs = await ctx.app.inject(
      as(stranger, { method: 'GET', url: `/api/projects/${secret.id}/requirements?q=magicword` }),
    );
    expect(theirs.json().total).toBe(1);

    const crossProject = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/projects/${secret.id}/requirements` }),
    );
    expect(crossProject.statusCode).toBe(404);
  });

  it('FR-SRCH-007: returns a tree of categories with nested decomposition', async () => {
    const project = await createProject(ctx, owner, uniqueKey('TR'));
    const category = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/projects/${project.id}/categories`,
        payload: { name: 'Root category' },
      }),
    );
    const parent = await createRequirement(ctx, owner, project.id, {
      title: 'Parent requirement',
      categoryId: category.json().id,
    });
    await createRequirement(ctx, owner, project.id, {
      title: 'Child requirement',
      categoryId: category.json().id,
      parentId: parent.id,
    });

    const response = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/projects/${project.id}/requirements/tree` }),
    );

    expect(response.statusCode).toBe(200);
    const root = response.json().find((node: { name: string }) => node.name === 'Root category');
    expect(root.requirements).toHaveLength(1);
    expect(root.requirements[0].title).toBe('Parent requirement');
    expect(root.requirements[0].children).toHaveLength(1);
    expect(root.requirements[0].children[0].title).toBe('Child requirement');
  });

  it('FR-SRCH-009: exports the filtered result set as JSON and as CSV', async () => {
    const json = await ctx.app.inject(
      as(owner, {
        method: 'GET',
        url: `/api/projects/${projectId}/requirements/export?format=json&type=functional`,
      }),
    );
    expect(json.statusCode).toBe(200);
    expect(json.json()).toHaveLength(2);

    const csv = await ctx.app.inject(
      as(owner, {
        method: 'GET',
        url: `/api/projects/${projectId}/requirements/export?format=csv`,
      }),
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');

    const lines = csv.body.trim().split('\n');
    expect(lines[0]).toContain('key,title,statement');
    expect(lines.length).toBe(4); // header plus three live requirements
  });

  it('FR-SRCH-009: quotes CSV fields containing commas and quotes', async () => {
    const project = await createProject(ctx, owner, uniqueKey('CS'));
    await createRequirement(ctx, owner, project.id, {
      title: 'Comma, quote " and newline',
      statement: 'The system shall handle "awkward", characters.',
    });

    const csv = await ctx.app.inject(
      as(owner, {
        method: 'GET',
        url: `/api/projects/${project.id}/requirements/export?format=csv`,
      }),
    );

    expect(csv.body).toContain('"Comma, quote "" and newline"');
  });
});
