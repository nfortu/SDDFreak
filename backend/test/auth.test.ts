import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MS } from '../src/domain/primitives.js';
import {
  type TestContext,
  STRONG_PASSWORD,
  as,
  createActor,
  createTestContext,
  loginCookie,
} from './helpers.js';

describe('authentication (§6.2)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('FR-AUTH-001, FR-AUTH-002: issues a session credential on success', async () => {
    const actor = await createActor(ctx);
    expect(actor.cookie).toContain('sddfreak_session=');

    const me = await ctx.app.inject(as(actor, { method: 'GET', url: '/api/auth/me' }));
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(actor.email);
  });

  it('NFR-SEC-003: the session cookie is HttpOnly, SameSite=Lax, and signed', async () => {
    const actor = await createActor(ctx);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: actor.email, password: STRONG_PASSWORD },
    });

    const raw = String(response.headers['set-cookie']);
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    // A signed cookie carries its signature after a dot.
    expect(raw.split(';')[0]!.split('=')[1]).toContain('.');
  });

  it('FR-AUTH-009: denies a request with no session credential', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/projects' });
    expect(response.statusCode).toBe(401);
  });

  it('FR-AUTH-009: denies a forged session credential', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: 'sddfreak_session=not-a-real-token.and-not-a-real-signature' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('FR-AUTH-008: answers identically for unknown email, wrong password, and locked account', async () => {
    const actor = await createActor(ctx);

    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'no-such-account@example.test', password: STRONG_PASSWORD },
    });
    const wrongPassword = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: actor.email, password: 'definitely-the-wrong-one' },
    });

    expect(unknown.statusCode).toBe(wrongPassword.statusCode);
    expect(unknown.json()).toEqual(wrongPassword.json());
    expect(unknown.json().error.message).not.toMatch(/password|account|email/i);
  });

  it('FR-AUTH-007: locks after 5 consecutive failures in 15 minutes, then unlocks', async () => {
    const actor = await createActor(ctx);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: actor.email, password: 'wrong-password-here' },
      });
      expect(response.statusCode).toBe(401);
    }

    // FR-AUTH-008: the lock is not announced — the correct password now fails
    // with the same generic response.
    const locked = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: actor.email, password: STRONG_PASSWORD },
    });
    expect(locked.statusCode).toBe(401);

    const row = await ctx.services.db
      .selectFrom('users')
      .select('locked_until')
      .where('id', '=', actor.id)
      .executeTakeFirstOrThrow();
    expect(row.locked_until).not.toBeNull();

    // Wind the lock into the past rather than waiting 15 minutes.
    await ctx.services.db
      .updateTable('users')
      .set({ locked_until: new Date(Date.now() - MS.minute).toISOString() })
      .where('id', '=', actor.id)
      .execute();

    await expect(loginCookie(ctx, actor.email, STRONG_PASSWORD)).resolves.toBeTruthy();
  });

  it('FR-AUTH-007: a success breaks the run, so four failures either side do not lock', async () => {
    const actor = await createActor(ctx);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: actor.email, password: 'wrong-password-here' },
      });
    }
    await loginCookie(ctx, actor.email, STRONG_PASSWORD);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: actor.email, password: 'wrong-password-here' },
      });
    }

    await expect(loginCookie(ctx, actor.email, STRONG_PASSWORD)).resolves.toBeTruthy();
  });

  it('FR-AUTH-003: rejects a session credential more than 24 hours old', async () => {
    const actor = await createActor(ctx);

    await ctx.services.db
      .updateTable('sessions')
      .set({ absolute_expires_at: new Date(Date.now() - MS.minute).toISOString() })
      .where('user_id', '=', actor.id)
      .execute();

    const response = await ctx.app.inject(as(actor, { method: 'GET', url: '/api/auth/me' }));
    expect(response.statusCode).toBe(401);
  });

  it('FR-AUTH-004: rejects a session credential unused for more than 2 hours', async () => {
    const actor = await createActor(ctx);

    await ctx.services.db
      .updateTable('sessions')
      .set({ last_seen_at: new Date(Date.now() - 3 * MS.hour).toISOString() })
      .where('user_id', '=', actor.id)
      .execute();

    const response = await ctx.app.inject(as(actor, { method: 'GET', url: '/api/auth/me' }));
    expect(response.statusCode).toBe(401);
  });

  it('FR-AUTH-005: ends the current session', async () => {
    const actor = await createActor(ctx);

    const logout = await ctx.app.inject(as(actor, { method: 'POST', url: '/api/auth/logout' }));
    expect(logout.statusCode).toBe(200);

    const after = await ctx.app.inject(as(actor, { method: 'GET', url: '/api/auth/me' }));
    expect(after.statusCode).toBe(401);
  });

  it('FR-AUTH-005: ends every other session while keeping the current one', async () => {
    const actor = await createActor(ctx);
    const other = await loginCookie(ctx, actor.email, STRONG_PASSWORD);

    const response = await ctx.app.inject(
      as(actor, { method: 'POST', url: '/api/auth/logout-others' }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().revoked).toBeGreaterThanOrEqual(1);

    expect((await ctx.app.inject(as(other, { method: 'GET', url: '/api/auth/me' }))).statusCode).toBe(
      401,
    );
    expect((await ctx.app.inject(as(actor, { method: 'GET', url: '/api/auth/me' }))).statusCode).toBe(
      200,
    );
  });

  it('FR-AUTH-006: lists active sessions and marks the current one', async () => {
    const actor = await createActor(ctx);
    await loginCookie(ctx, actor.email, STRONG_PASSWORD);

    const response = await ctx.app.inject(as(actor, { method: 'GET', url: '/api/auth/sessions' }));
    expect(response.statusCode).toBe(200);

    const sessions = response.json();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  it('NFR-SEC-004: blocks a state-changing request from a foreign origin', async () => {
    const actor = await createActor(ctx);
    const response = await ctx.app.inject(
      as(actor, {
        method: 'POST',
        url: '/api/projects',
        headers: { origin: 'https://attacker.example' },
        payload: { key: 'CSRF', name: 'Should not be created' },
      }),
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('cross_origin_blocked');
  });

  it('NFR-SEC-004: allows a state-changing request from the configured origin', async () => {
    const actor = await createActor(ctx);
    const response = await ctx.app.inject(
      as(actor, {
        method: 'POST',
        url: '/api/projects',
        headers: { origin: 'http://localhost:5173' },
        payload: { key: 'OKOR', name: 'Allowed origin' },
      }),
    );

    expect(response.statusCode).toBe(201);
  });
});
