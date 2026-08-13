import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type TestContext,
  as,
  createActor,
  createProject,
  createRequirement,
  createTestContext,
  uniqueKey,
  type Actor,
} from './helpers.js';

describe('authorization (§6.3)', () => {
  let ctx: TestContext;
  let owner: Actor;
  let editor: Actor;
  let viewer: Actor;
  let outsider: Actor;
  let projectId: string;
  let requirementId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    owner = await createActor(ctx);
    editor = await createActor(ctx);
    viewer = await createActor(ctx);
    outsider = await createActor(ctx);

    projectId = (await createProject(ctx, owner, uniqueKey('AZ'))).id;

    for (const [actor, role] of [
      [editor, 'editor'],
      [viewer, 'viewer'],
    ] as const) {
      const response = await ctx.app.inject(
        as(owner, {
          method: 'PUT',
          url: `/api/projects/${projectId}/members/${actor.id}`,
          payload: { role },
        }),
      );
      expect(response.statusCode).toBe(200);
    }

    requirementId = (await createRequirement(ctx, owner, projectId, {})).id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('FR-AUTHZ-002: a viewer can read requirements, categories, tags, and history', async () => {
    for (const url of [
      `/api/projects/${projectId}/requirements`,
      `/api/projects/${projectId}/categories`,
      `/api/projects/${projectId}/tags`,
      `/api/requirements/${requirementId}/revisions`,
    ]) {
      const response = await ctx.app.inject(as(viewer, { method: 'GET', url }));
      expect(response.statusCode, url).toBe(200);
    }
  });

  it('FR-AUTHZ-003: a viewer is refused every write', async () => {
    const create = await ctx.app.inject(
      as(viewer, {
        method: 'POST',
        url: `/api/projects/${projectId}/requirements`,
        payload: { title: 'No', statement: 'The system shall not.', type: 'functional' },
      }),
    );
    expect(create.statusCode).toBe(403);

    const update = await ctx.app.inject(
      as(viewer, {
        method: 'PATCH',
        url: `/api/requirements/${requirementId}`,
        payload: { version: 1, title: 'Nope' },
      }),
    );
    expect(update.statusCode).toBe(403);

    const remove = await ctx.app.inject(
      as(viewer, { method: 'DELETE', url: `/api/requirements/${requirementId}` }),
    );
    expect(remove.statusCode).toBe(403);

    const category = await ctx.app.inject(
      as(viewer, {
        method: 'POST',
        url: `/api/projects/${projectId}/categories`,
        payload: { name: 'Nope' },
      }),
    );
    expect(category.statusCode).toBe(403);
  });

  it('FR-AUTHZ-004: an editor can create, update, and delete content', async () => {
    const created = await createRequirement(ctx, editor, projectId, { title: 'Editor made this' });
    expect(created.key).toBeTruthy();

    const updated = await ctx.app.inject(
      as(editor, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: created.version, title: 'Editor changed this' },
      }),
    );
    expect(updated.statusCode).toBe(200);

    const deleted = await ctx.app.inject(
      as(editor, { method: 'DELETE', url: `/api/requirements/${created.id}` }),
    );
    expect(deleted.statusCode).toBe(200);
  });

  it('FR-AUTHZ-004: an editor cannot manage membership', async () => {
    const response = await ctx.app.inject(
      as(editor, {
        method: 'PUT',
        url: `/api/projects/${projectId}/members/${outsider.id}`,
        payload: { role: 'viewer' },
      }),
    );
    expect(response.statusCode).toBe(403);
  });

  it('FR-AUTHZ-005: an owner can manage membership and rename the project', async () => {
    const rename = await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/projects/${projectId}`,
        payload: { name: 'Renamed by owner' },
      }),
    );
    expect(rename.statusCode).toBe(200);
    expect(rename.json().name).toBe('Renamed by owner');
  });

  it('FR-AUTHZ-006: a non-member gets "not found", not "forbidden", everywhere', async () => {
    const project = await ctx.app.inject(
      as(outsider, { method: 'GET', url: `/api/projects/${projectId}` }),
    );
    expect(project.statusCode).toBe(404);

    const list = await ctx.app.inject(
      as(outsider, { method: 'GET', url: `/api/projects/${projectId}/requirements` }),
    );
    expect(list.statusCode).toBe(404);

    const requirement = await ctx.app.inject(
      as(outsider, { method: 'GET', url: `/api/requirements/${requirementId}` }),
    );
    expect(requirement.statusCode).toBe(404);

    const members = await ctx.app.inject(
      as(outsider, { method: 'GET', url: `/api/projects/${projectId}/members` }),
    );
    expect(members.statusCode).toBe(404);
  });

  it('FR-PRJ-005: a non-member never sees the project in their list', async () => {
    const response = await ctx.app.inject(as(outsider, { method: 'GET', url: '/api/projects' }));
    expect(response.statusCode).toBe(200);
    expect(response.json().map((p: { id: string }) => p.id)).not.toContain(projectId);
  });

  it('FR-AUTHZ-009: refuses to remove or demote the last owner', async () => {
    const demote = await ctx.app.inject(
      as(owner, {
        method: 'PUT',
        url: `/api/projects/${projectId}/members/${owner.id}`,
        payload: { role: 'viewer' },
      }),
    );
    expect(demote.statusCode).toBe(422);
    expect(demote.json().error.code).toBe('last_owner');

    const remove = await ctx.app.inject(
      as(owner, { method: 'DELETE', url: `/api/projects/${projectId}/members/${owner.id}` }),
    );
    expect(remove.statusCode).toBe(422);
  });

  it('FR-AUTHZ-009: allows demotion once a second owner exists', async () => {
    const second = await createActor(ctx);
    await ctx.app.inject(
      as(owner, {
        method: 'PUT',
        url: `/api/projects/${projectId}/members/${second.id}`,
        payload: { role: 'owner' },
      }),
    );

    const demote = await ctx.app.inject(
      as(owner, {
        method: 'PUT',
        url: `/api/projects/${projectId}/members/${owner.id}`,
        payload: { role: 'editor' },
      }),
    );
    expect(demote.statusCode).toBe(200);
  });

  it('FR-AUTHZ-007, FR-AUTHZ-008: an administrator reaches a project only by an audited grant', async () => {
    const fresh = await createTestContext();
    try {
      const admin = await createActor(fresh);
      const user = await createActor(fresh);
      const target = await createProject(fresh, user, 'ADMN');

      // Before the grant, an administrator is as blind as anyone else.
      const before = await fresh.app.inject(
        as(admin, { method: 'GET', url: `/api/projects/${target.id}` }),
      );
      expect(before.statusCode).toBe(404);

      const grant = await fresh.app.inject(
        as(admin, { method: 'POST', url: `/api/admin/projects/${target.id}/access` }),
      );
      expect(grant.statusCode).toBe(200);
      expect(grant.json().role).toBe('owner');

      const after = await fresh.app.inject(
        as(admin, { method: 'GET', url: `/api/projects/${target.id}` }),
      );
      expect(after.statusCode).toBe(200);

      // FR-AUTHZ-008: the grant is on the record.
      const audit = await fresh.app.inject(
        as(admin, { method: 'GET', url: '/api/admin/audit?eventType=admin_access_granted' }),
      );
      expect(audit.json().items).toHaveLength(1);
      expect(audit.json().items[0].projectId).toBe(target.id);
      expect(audit.json().items[0].actorUserId).toBe(admin.id);
    } finally {
      await fresh.close();
    }
  });

  it('FR-AUTHZ-007: a non-administrator cannot reach the admin surface', async () => {
    for (const url of ['/api/admin/users', '/api/admin/projects', '/api/admin/audit']) {
      const response = await ctx.app.inject(as(outsider, { method: 'GET', url }));
      expect(response.statusCode, url).toBe(403);
    }
  });
});
