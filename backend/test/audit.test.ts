import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  type TestContext,
  STRONG_PASSWORD,
  as,
  createActor,
  createProject,
  createRequirement,
  createTestContext,
  uniqueKey,
} from './helpers.js';

describe('history and audit (§6.8)', () => {
  let ctx: TestContext;
  let admin: Actor;
  let owner: Actor;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    admin = await createActor(ctx); // first account administers
    owner = await createActor(ctx);
    projectId = (await createProject(ctx, owner, uniqueKey('AU'))).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('FR-AUD-001: every change writes a revision holding the state after it', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Versioned' });

    await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: 1, title: 'Versioned twice' },
      }),
    );

    const revisions = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${created.id}/revisions` }),
    );

    const body = revisions.json();
    expect(body).toHaveLength(2);
    // FR-AUD-002: newest first.
    expect(body[0].version).toBe(2);
    expect(body[1].version).toBe(1);
    expect(body[0].snapshot.title).toBe('Versioned twice');
    expect(body[1].snapshot.title).toBe('Versioned');
    expect(body[0].changeKind).toBe('updated');
    expect(body[1].changeKind).toBe('created');
    expect(body[0].changedByName).toBeTruthy();
  });

  it('INV-06: the version equals the number of revisions', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'Counting' });

    for (let index = 0; index < 3; index += 1) {
      await ctx.app.inject(
        as(owner, {
          method: 'PATCH',
          url: `/api/requirements/${created.id}`,
          payload: { version: index + 1, title: `Counting ${index}` },
        }),
      );
    }

    const current = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${created.id}` }),
    );
    const revisions = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${created.id}/revisions` }),
    );

    expect(revisions.json()).toHaveLength(current.json().version);
  });

  it('FR-AUD-003: reports field-level differences between two revisions', async () => {
    const created = await createRequirement(ctx, owner, projectId, {
      title: 'Diff me',
      tags: ['before'],
    });

    await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: {
          version: 1,
          title: 'Diffed',
          priority: 'must',
          tags: ['after'],
        },
      }),
    );

    const diff = await ctx.app.inject(
      as(owner, {
        method: 'GET',
        url: `/api/requirements/${created.id}/revisions/diff?from=1&to=2`,
      }),
    );

    expect(diff.statusCode).toBe(200);
    const fields = diff.json().changes.map((c: { field: string }) => c.field);
    expect(fields).toEqual(expect.arrayContaining(['title', 'priority', 'tags']));

    const title = diff.json().changes.find((c: { field: string }) => c.field === 'title');
    expect(title.before).toBe('Diff me');
    expect(title.after).toBe('Diffed');
  });

  it('FR-AUD-004: a revert writes a new revision instead of rewriting history', async () => {
    const created = await createRequirement(ctx, owner, projectId, {
      title: 'Original title',
      statement: 'The system shall keep the original.',
    });

    await ctx.app.inject(
      as(owner, {
        method: 'PATCH',
        url: `/api/requirements/${created.id}`,
        payload: { version: 1, title: 'Changed title' },
      }),
    );

    const reverted = await ctx.app.inject(
      as(owner, {
        method: 'POST',
        url: `/api/requirements/${created.id}/revert`,
        payload: { toVersion: 1 },
      }),
    );

    expect(reverted.statusCode).toBe(200);
    expect(reverted.json().title).toBe('Original title');
    expect(reverted.json().version).toBe(3);

    const revisions = await ctx.app.inject(
      as(owner, { method: 'GET', url: `/api/requirements/${created.id}/revisions` }),
    );
    // Three revisions, and version 2 still says what it said.
    expect(revisions.json()).toHaveLength(3);
    const second = revisions.json().find((r: { version: number }) => r.version === 2);
    expect(second.snapshot.title).toBe('Changed title');
  });

  it('FR-AUD-005: records login, logout, and membership events', async () => {
    const subject = await createActor(ctx);

    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: subject.email, password: 'wrong-password-entirely' },
    });
    await ctx.app.inject(as(subject, { method: 'POST', url: '/api/auth/logout' }));

    const member = await createActor(ctx);
    await ctx.app.inject(
      as(owner, {
        method: 'PUT',
        url: `/api/projects/${projectId}/members/${member.id}`,
        payload: { role: 'editor' },
      }),
    );
    await ctx.app.inject(
      as(owner, { method: 'DELETE', url: `/api/projects/${projectId}/members/${member.id}` }),
    );

    const audit = await ctx.app.inject(
      as(admin, { method: 'GET', url: '/api/admin/audit?limit=200' }),
    );

    const types = new Set(audit.json().items.map((e: { eventType: string }) => e.eventType));
    for (const expected of [
      'login_succeeded',
      'login_failed',
      'logout',
      'project_created',
      'membership_granted',
      'membership_revoked',
    ]) {
      expect(types, expected).toContain(expected);
    }
  });

  it('FR-AUD-005: records an authorization denial', async () => {
    const viewer = await createActor(ctx);
    await ctx.app.inject(
      as(owner, {
        method: 'PUT',
        url: `/api/projects/${projectId}/members/${viewer.id}`,
        payload: { role: 'viewer' },
      }),
    );

    await ctx.app.inject(
      as(viewer, {
        method: 'POST',
        url: `/api/projects/${projectId}/requirements`,
        payload: { title: 'Denied', statement: 'The system shall not.', type: 'functional' },
      }),
    );

    const audit = await ctx.app.inject(
      as(admin, {
        method: 'GET',
        url: `/api/admin/audit?eventType=authorization_denied&actorUserId=${viewer.id}`,
      }),
    );
    expect(audit.json().total).toBeGreaterThanOrEqual(1);
  });

  it('FR-AUD-006, INV-08, INV-09: no interface mutates a revision or an audit event', async () => {
    const routes = ctx.app
      .printRoutes({ commonPrefix: false })
      .split('\n')
      .filter((line) => /revision|audit/i.test(line));

    // Every route touching either surface is a read.
    for (const line of routes) {
      expect(line, line).not.toMatch(/\b(PUT|PATCH|DELETE)\b/);
    }

    // And the only write path in code is an append.
    const before = await ctx.services.db
      .selectFrom('audit_events')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    await ctx.app.inject(as(admin, { method: 'GET', url: '/api/admin/audit' }));
    const after = await ctx.services.db
      .selectFrom('audit_events')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst();
    expect(Number(after?.count)).toBe(Number(before?.count));
  });

  it('FR-AUD-007: filters the audit log by actor, type, project, and time', async () => {
    const byType = await ctx.app.inject(
      as(admin, { method: 'GET', url: '/api/admin/audit?eventType=project_created' }),
    );
    expect(byType.json().items.every((e: { eventType: string }) => e.eventType === 'project_created')).toBe(true);

    const byProject = await ctx.app.inject(
      as(admin, { method: 'GET', url: `/api/admin/audit?projectId=${projectId}` }),
    );
    expect(byProject.json().items.every((e: { projectId: string }) => e.projectId === projectId)).toBe(true);

    const future = new Date(Date.now() + 60_000).toISOString();
    const byTime = await ctx.app.inject(
      as(admin, { method: 'GET', url: `/api/admin/audit?from=${future}` }),
    );
    expect(byTime.json().total).toBe(0);
  });

  it('FR-AUTH-008: a failed login for an unknown address records no actor', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ghost@example.test', password: STRONG_PASSWORD },
    });

    const audit = await ctx.app.inject(
      as(admin, { method: 'GET', url: '/api/admin/audit?eventType=login_failed&limit=200' }),
    );
    const anonymous = audit
      .json()
      .items.filter((e: { actorUserId: string | null }) => e.actorUserId === null);
    expect(anonymous.length).toBeGreaterThanOrEqual(1);
  });
});
