import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SOFT_DELETE_WINDOW_MS } from '../src/domain/primitives.js';
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

describe('requirement CRUD (§6.5)', () => {
  let ctx: TestContext;
  let owner: Actor;
  let projectId: string;
  let projectKey: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    owner = await createActor(ctx);
    const project = await createProject(ctx, owner, uniqueKey('RQ'));
    projectId = project.id;
    projectKey = project.key;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('FR-REQ-001, FR-REQ-004: creates with defaults of draft/should/version 1', async () => {
    const created = await createRequirement(ctx, owner, projectId, {
      title: 'Defaults',
      statement: 'The system shall apply defaults.',
      type: 'functional',
    });

    expect(created.status).toBe('draft');
    expect(created.priority).toBe('should');
    expect(created.version).toBe(1);
  });

  it('FR-REQ-002: assigns sequential keys prefixed by the project key', async () => {
    const first = await createRequirement(ctx, owner, projectId, { title: 'One' });
    const second = await createRequirement(ctx, owner, projectId, { title: 'Two' });

    expect(first.key).toMatch(new RegExp(`^${projectKey}-\\d+$`));
    const firstNumber = Number(first.key.split('-')[1]);
    expect(second.key).toBe(`${projectKey}-${firstNumber + 1}`);
  });

  it('FR-REQ-003, INV-02: never reissues a key after deletion', async () => {
    const doomed = await createRequirement(ctx, owner, projectId, { title: 'Doomed' });
    await ctx.app.inject(as(owner, { method: 'DELETE', url: `/api/requirements/${doomed.id}` }));

    const next = await createRequirement(ctx, owner, projectId, { title: 'Next' });
    expect(next.key).not.toBe(doomed.key);
  });

  it('FR-REQ-016: rejects an invalid create in full, writing nothing', async () => {
    const before = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/projects/${projectId}/requirements` }),
    );

    const response = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/projects/${projectId}/requirements`,
        payload: { title: '', statement: 'x', type: 'functional' },
      }),
    );
    expect(response.statusCode).toBe(400);

    const after = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/projects/${projectId}/requirements` }),
    );
    expect(after.json().total).toBe(before.json().total);
  });

  it('FR-REQ-016: rejects an unknown requirement type', async () => {
    const response = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/projects/${projectId}/requirements`,
        payload: { title: 'Bad type', statement: 'The system shall.', type: 'imaginary' },
      }),
    );
    expect(response.statusCode).toBe(400);
  });

  it('FR-REQ-005: returns every attribute of §4.8', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Full read' });
    const response = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${created.id}` }),
    );

    expect(response.statusCode).toBe(200);
    for (const field of [
      'id', 'key', 'projectId', 'title', 'statement', 'rationale', 'type', 'priority',
      'status', 'acceptanceCriteria', 'source', 'ownerId', 'categoryId', 'parentId',
      'sortOrder', 'version', 'tags', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt',
    ]) {
      expect(response.json(), field).toHaveProperty(field);
    }
  });

  it('FR-REQ-006, FR-REQ-007: an update bumps the version and writes a revision', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Before' });

    const updated = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: created.version, title: 'After' },
      }),
    );

    expect(updated.statusCode).toBe(200);
    expect(updated.json().title).toBe('After');
    expect(updated.json().version).toBe(2);

    const revisions = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${created.id}/revisions` }),
    );
    expect(revisions.json()).toHaveLength(2);
  });

  it('FR-REQ-007: a no-op update neither bumps the version nor writes a revision', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Unchanged' });

    const response = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: created.version, title: 'Unchanged' },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().version).toBe(1);

    const revisions = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${created.id}/revisions` }),
    );
    expect(revisions.json()).toHaveLength(1);
  });

  it('FR-REQ-008: a stale version is rejected as a conflict and changes nothing', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Concurrent' });

    await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: 1, title: 'First writer wins' },
      }),
    );

    const second = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: 1, title: 'Second writer loses' },
      }),
    );

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('version_conflict');
    expect(second.json().error.details).toMatchObject({ expectedVersion: 1, actualVersion: 2 });

    const current = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${created.id}` }),
    );
    expect(current.json().title).toBe('First writer wins');
  });

  it('FR-REQ-009: rejects a transition that §4.12 does not allow', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Transitions' });

    const straightToVerified = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: 1, status: 'verified', acceptanceCriteria: 'Given, when, then.' },
      }),
    );
    expect(straightToVerified.statusCode).toBe(422);
    expect(straightToVerified.json().error.code).toBe('invalid_status_transition');
  });

  it('FR-REQ-009: a terminal status admits no further transition', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Terminal' });
    const rejected = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: 1, status: 'rejected' },
      }),
    );
    expect(rejected.statusCode).toBe(200);

    const revive = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: 2, status: 'draft' },
      }),
    );
    expect(revive.statusCode).toBe(422);
  });

  it('FR-REQ-010, INV-07: approval needs acceptance criteria, and cannot lose them', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Approval' });

    const toProposed = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: 1, status: 'proposed' },
      }),
    );
    expect(toProposed.statusCode).toBe(200);

    const withoutCriteria = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: 2, status: 'approved' },
      }),
    );
    expect(withoutCriteria.statusCode).toBe(422);
    expect(withoutCriteria.json().error.code).toBe('acceptance_criteria_required');

    const withCriteria = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: {
          version: 2,
          status: 'approved',
          acceptanceCriteria: 'The endpoint returns 200 for a valid request.',
        },
      }),
    );
    expect(withCriteria.statusCode).toBe(200);

    // INV-07 also survives an edit that only clears the criteria.
    const clear = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: 3, acceptanceCriteria: null },
      }),
    );
    expect(clear.statusCode).toBe(422);
  });

  it('FR-REQ-011, FR-SRCH-008: a soft delete hides it but keeps its revisions', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Soft deleted' });

    const deleted = await ctx.app.inject(
      as(owner, { method: 'DELETE', url: `/api/requirements/${created.id}` }),
    );
    expect(deleted.statusCode).toBe(200);

    const list = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/projects/${projectId}/requirements` }),
    );
    expect(list.json().items.map((r: { id: string }) => r.id)).not.toContain(created.id);

    const withDeleted = await ctx.app.inject(
      as(owner, {
        method: 'GET',
        url: `/api/projects/${projectId}/requirements?includeDeleted=true`,
      }),
    );
    expect(withDeleted.json().items.map((r: { id: string }) => r.id)).toContain(created.id);

    const revisions = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${created.id}/revisions` }),
    );
    expect(revisions.json().length).toBeGreaterThanOrEqual(2);
  });

  it('FR-REQ-012: refuses to delete a parent unless cascade is confirmed', async () => {
    const parent = await createRequirement(ctx, owner, projectId, { title: 'Parent' });
    const child = await createRequirement(ctx, owner, projectId, {
      title: 'Child',
      parentId: parent.id,
    });

    const refused = await ctx.app.inject(
      as(owner, { method: 'DELETE', url: `/api/requirements/${parent.id}` }),
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('requirement_has_children');

    const cascaded = await ctx.app.inject(
      as(owner, { method: 'DELETE', url: `/api/requirements/${parent.id}?cascade=true` }),
    );
    expect(cascaded.statusCode).toBe(200);
    expect(cascaded.json().deleted).toEqual(expect.arrayContaining([parent.id, child.id]));
  });

  it('FR-REQ-013: restores within the window, keeping its key', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Restorable' });
    await ctx.app.inject(as(owner, { method: 'DELETE', url: `/api/requirements/${created.id}` }));

    const restored = await ctx.app.inject(
      as(owner, { method: 'POST', url: `/api/requirements/${created.id}/restore` }),
    );

    expect(restored.statusCode).toBe(200);
    expect(restored.json().key).toBe(created.key);
    expect(restored.json().deletedAt).toBeNull();
  });

  it('FR-REQ-013: refuses to restore after 30 days', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Too old' });
    await ctx.app.inject(as(owner, { method: 'DELETE', url: `/api/requirements/${created.id}` }));

    await ctx.services.db
      .updateTable('requirements')
      .set({ deleted_at: new Date(Date.now() - SOFT_DELETE_WINDOW_MS - 1000).toISOString() })
      .where('id', '=', created.id)
      .execute();

    const restored = await ctx.app.inject(
      as(owner, { method: 'POST', url: `/api/requirements/${created.id}/restore` }),
    );
    expect(restored.statusCode).toBe(422);
    expect(restored.json().error.code).toBe('restore_window_expired');
  });

  it('FR-REQ-014: purges only after the window, and only for an owner', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Purgeable' });
    await ctx.app.inject(as(owner, { method: 'DELETE', url: `/api/requirements/${created.id}` }));

    const tooEarly = await ctx.app.inject(
      as(owner, { method: 'POST', url: `/api/requirements/${created.id}/purge` }),
    );
    expect(tooEarly.statusCode).toBe(422);
    expect(tooEarly.json().error.code).toBe('purge_window_open');

    await ctx.services.db
      .updateTable('requirements')
      .set({ deleted_at: new Date(Date.now() - SOFT_DELETE_WINDOW_MS - 1000).toISOString() })
      .where('id', '=', created.id)
      .execute();

    const purged = await ctx.app.inject(
      as(owner, { method: 'POST', url: `/api/requirements/${created.id}/purge` }),
    );
    expect(purged.statusCode).toBe(200);

    const gone = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${created.id}` }),
    );
    expect(gone.statusCode).toBe(404);
  });

  it('FR-REQ-003: a purged key is still never reissued', async () => {
    const before = await createRequirement(ctx, owner, projectId, { title: 'Before purge' });
    const number = Number(before.key.split('-')[1]);

    await ctx.app.inject(as(owner, { method: 'DELETE', url: `/api/requirements/${before.id}` }));
    await ctx.services.db
      .updateTable('requirements')
      .set({ deleted_at: new Date(Date.now() - SOFT_DELETE_WINDOW_MS - 1000).toISOString() })
      .where('id', '=', before.id)
      .execute();
    await ctx.app.inject(
      as(owner, { method: 'POST', url: `/api/requirements/${before.id}/purge` }),
    );

    const after = await createRequirement(ctx, owner, projectId, { title: 'After purge' });
    expect(Number(after.key.split('-')[1])).toBeGreaterThan(number);
  });

  it('FR-REQ-015: duplicates into a new draft with a new key and no history', async () => {
    const original = await createRequirement(ctx, owner, projectId, {
      title: 'Original',
      acceptanceCriteria: 'It works.',
      tags: ['alpha', 'beta'],
    });
    await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${original.id}`,
        payload: { version: 1, status: 'proposed' },
      }),
    );

    const copy = await ctx.app.inject(
      as(owner, { method: 'POST', url: `/api/requirements/${original.id}/duplicate` }),
    );

    expect(copy.statusCode).toBe(201);
    expect(copy.json().key).not.toBe(original.key);
    expect(copy.json().status).toBe('draft');
    expect(copy.json().version).toBe(1);
    expect(copy.json().tags).toEqual(['alpha', 'beta']);

    const revisions = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${copy.json().id}/revisions` }),
    );
    expect(revisions.json()).toHaveLength(1);
  });

  it('§4.8: an owner must be a member of the project', async () => {
    const outsider = await createActor(ctx);
    const response = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/projects/${projectId}/requirements`,
        payload: {
          title: 'Bad owner',
          statement: 'The system shall.',
          type: 'functional',
          ownerId: outsider.id,
        },
      }),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('owner_not_member');
  });
});
