import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type TestContext,
  STRONG_PASSWORD,
  as,
  createActor,
  createTestContext,
  loginCookie,
} from './helpers.js';

describe('accounts (§6.1)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('FR-ACC-001: registers an account with email, password, and display name', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'Fresh.User@Example.test',
        password: STRONG_PASSWORD,
        displayName: 'Fresh User',
      },
    });

    expect(response.statusCode).toBe(201);
    // §8.4.1: normalized at the boundary, so uniqueness needs no citext.
    expect(response.json().email).toBe('fresh.user@example.test');
    expect(response.json().displayName).toBe('Fresh User');
  });

  it('FR-ACC-002: rejects a registration whose email is already registered', async () => {
    const payload = {
      email: 'duplicate@example.test',
      password: STRONG_PASSWORD,
      displayName: 'First',
    };
    const first = await ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...payload, displayName: 'Second' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('email_taken');
  });

  it('FR-ACC-002: matches case-insensitively when detecting a duplicate', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'DUPLICATE@EXAMPLE.TEST',
        password: STRONG_PASSWORD,
        displayName: 'Third',
      },
    });
    expect(response.statusCode).toBe(409);
  });

  it('FR-ACC-003: rejects a password shorter than 12 characters', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'short@example.test', password: 'elevenchars', displayName: 'Short' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('password_too_short');
  });

  it('FR-ACC-004: rejects a password from the breached list', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'breached@example.test', password: 'password1234', displayName: 'Bre' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('password_breached');
  });

  it('FR-ACC-005: stores a password only as an argon2id hash', async () => {
    const actor = await createActor(ctx);
    const row = await ctx.services.db
      .selectFrom('users')
      .select('password_hash')
      .where('id', '=', actor.id)
      .executeTakeFirstOrThrow();

    expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(row.password_hash).not.toContain(STRONG_PASSWORD);
  });

  it('FR-ACC-006: changes a password only when the current one is supplied', async () => {
    const actor = await createActor(ctx);

    const wrong = await ctx.app.inject(
      as(actor, {
        method: 'POST',
        url: '/api/auth/password/change',
        payload: { currentPassword: 'not-the-right-one-at-all', newPassword: 'another-good-passphrase-2' },
      }),
    );
    expect(wrong.statusCode).toBe(401);

    const right = await ctx.app.inject(
      as(actor, {
        method: 'POST',
        url: '/api/auth/password/change',
        payload: { currentPassword: STRONG_PASSWORD, newPassword: 'another-good-passphrase-2' },
      }),
    );
    expect(right.statusCode).toBe(200);

    await expect(loginCookie(ctx, actor.email, 'another-good-passphrase-2')).resolves.toContain(
      'sddfreak_session',
    );
  });

  it('FR-ACC-008: a password change revokes every other session', async () => {
    const actor = await createActor(ctx);
    const otherSession = await loginCookie(ctx, actor.email, STRONG_PASSWORD);

    const before = await ctx.app.inject(as(otherSession, { method: 'GET', url: '/api/auth/me' }));
    expect(before.statusCode).toBe(200);

    await ctx.app.inject(
      as(actor, {
        method: 'POST',
        url: '/api/auth/password/change',
        payload: { currentPassword: STRONG_PASSWORD, newPassword: 'yet-another-passphrase-3' },
      }),
    );

    const after = await ctx.app.inject(as(otherSession, { method: 'GET', url: '/api/auth/me' }));
    expect(after.statusCode).toBe(401);

    // The session that made the change survives.
    const current = await ctx.app.inject(as(actor, { method: 'GET', url: '/api/auth/me' }));
    expect(current.statusCode).toBe(200);
  });

  it('FR-ACC-007, FR-ACC-008: a reset token works once and revokes all sessions', async () => {
    const actor = await createActor(ctx);

    const request = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password/forgot',
      payload: { email: actor.email },
    });
    expect(request.statusCode).toBe(200);
    const token = request.json().previewToken as string;
    expect(token).toBeTruthy();

    const reset = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password/reset',
      payload: { token, newPassword: 'reset-passphrase-value-9' },
    });
    expect(reset.statusCode).toBe(200);

    // FR-ACC-008
    const old = await ctx.app.inject(as(actor, { method: 'GET', url: '/api/auth/me' }));
    expect(old.statusCode).toBe(401);

    // Single use.
    const reuse = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password/reset',
      payload: { token, newPassword: 'a-different-passphrase-8' },
    });
    expect(reuse.statusCode).toBe(400);
  });

  it('FR-ACC-007: says the same thing for an unregistered address', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password/forgot',
      payload: { email: 'nobody-here@example.test' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().previewToken).toBeUndefined();
  });

  it('FR-ACC-009: updates the actor’s own display name and email', async () => {
    const actor = await createActor(ctx);
    const response = await ctx.app.inject(
      as(actor, {
        method: 'PATCH',
        url: '/api/auth/me',
        payload: { displayName: 'Renamed', email: 'renamed@example.test' },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().displayName).toBe('Renamed');
    expect(response.json().email).toBe('renamed@example.test');
  });

  it('FR-ACC-010, FR-ACC-011: an admin deactivates an account, and its content survives', async () => {
    // Its own context: the administrator is the first account to be registered,
    // which is only well defined on an empty installation.
    const fresh = await createTestContext();
    try {
      const admin = await createActor(fresh);
      const victim = await createActor(fresh);

      const adminRow = await fresh.services.db
        .selectFrom('users')
        .select('is_administrator')
        .where('id', '=', admin.id)
        .executeTakeFirstOrThrow();
      expect(adminRow.is_administrator).toBe(1);

      const project = await fresh.app.inject(
        as(victim, {
          method: 'POST',
          url: '/api/projects',
          payload: { key: 'VICT', name: 'Victim' },
        }),
      );
      await fresh.app.inject(
        as(victim, {
          method: 'POST',
          url: `/api/projects/${project.json().id}/requirements`,
          payload: { title: 'Survives', statement: 'The system shall survive.', type: 'functional' },
        }),
      );

      const deactivate = await fresh.app.inject(
        as(admin, {
          method: 'POST',
          url: `/api/admin/users/${victim.id}/active`,
          payload: { isActive: false },
        }),
      );
      expect(deactivate.statusCode).toBe(200);

      // FR-AUTH-001: a deactivated account cannot authenticate.
      await expect(loginCookie(fresh, victim.email, STRONG_PASSWORD)).rejects.toThrow();

      // FR-ACC-011: the authored requirement and its attribution remain.
      const requirement = await fresh.services.db
        .selectFrom('requirements')
        .selectAll()
        .where('created_by', '=', victim.id)
        .executeTakeFirst();
      expect(requirement?.title).toBe('Survives');
    } finally {
      await fresh.close();
    }
  });

  it('NFR-CMP-001: exports the personal data held about the actor', async () => {
    const actor = await createActor(ctx);
    const response = await ctx.app.inject(as(actor, { method: 'GET', url: '/api/auth/me/export' }));

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.account.email).toBe(actor.email);
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(Array.isArray(body.authoredRequirements)).toBe(true);
  });

  it('NFR-CMP-002: erasure anonymizes the account but keeps authored content', async () => {
    const actor = await createActor(ctx);
    const project = await ctx.app.inject(
      as(actor, { method: 'POST', url: '/api/projects', payload: { key: 'ERAS', name: 'Erase' } }),
    );
    await ctx.app.inject(
      as(actor, {
        method: 'POST',
        url: `/api/projects/${project.json().id}/requirements`,
        payload: { title: 'Kept', statement: 'The system shall keep this.', type: 'functional' },
      }),
    );

    const erase = await ctx.app.inject(as(actor, { method: 'POST', url: '/api/auth/me/erase' }));
    expect(erase.statusCode).toBe(200);

    const user = await ctx.services.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', actor.id)
      .executeTakeFirstOrThrow();
    expect(user.display_name).toBe('Anonymized user');
    expect(user.email).not.toBe(actor.email);
    expect(user.anonymized_at).not.toBeNull();

    const requirement = await ctx.services.db
      .selectFrom('requirements')
      .selectAll()
      .where('created_by', '=', actor.id)
      .executeTakeFirst();
    expect(requirement?.title).toBe('Kept');
  });
});
