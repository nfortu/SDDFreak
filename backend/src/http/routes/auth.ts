import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Services } from '../../services/container.js';
import { SESSION_COOKIE, metaOf, requireActor, setSessionCookie } from '../plugins.js';
import { SessionSchema, UserSchema } from '../schemas.js';

export function authRoutes(services: Services): FastifyPluginAsyncTypebox {
  const secureCookies = services.config.profile === 'deployed';

  return async (app) => {
    /** FR-ACC-001 */
    app.post(
      '/register',
      {
        schema: {
          tags: ['auth'],
          summary: 'Register an account (FR-ACC-001)',
          body: Type.Object({
            email: Type.String({ format: 'email', maxLength: 254 }),
            password: Type.String({ minLength: 1, maxLength: 512 }),
            displayName: Type.String({ minLength: 1, maxLength: 100 }),
          }),
          response: { 201: Type.Ref(UserSchema) },
        },
      },
      async (request, reply) => {
        const user = await services.accounts.register(request.body);
        return reply.status(201).send(user);
      },
    );

    /** FR-AUTH-001, FR-AUTH-002 */
    app.post(
      '/login',
      {
        schema: {
          tags: ['auth'],
          summary: 'Log in (FR-AUTH-001)',
          body: Type.Object({
            email: Type.String({ maxLength: 254 }),
            password: Type.String({ maxLength: 512 }),
          }),
          response: { 200: Type.Ref(UserSchema) },
        },
      },
      async (request, reply) => {
        const { user, token } = await services.auth.login(
          request.body.email,
          request.body.password,
          metaOf(request),
        );
        setSessionCookie(reply, token, secureCookies);
        return user;
      },
    );

    /** FR-AUTH-005 */
    app.post(
      '/logout',
      { schema: { tags: ['auth'], summary: 'End the current session (FR-AUTH-005)' } },
      async (request, reply) => {
        if (request.sessionId && request.actor) {
          await services.auth.logout(request.sessionId, request.actor.id, metaOf(request));
        }
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return { ok: true };
      },
    );

    /** FR-AUTH-005 (all other sessions) */
    app.post(
      '/logout-others',
      { schema: { tags: ['auth'], summary: 'End every other session (FR-AUTH-005)' } },
      async (request) => {
        const actor = await requireActor(request);
        const revoked = await services.auth.revokeOtherSessions(actor.id, request.sessionId ?? null);
        return { revoked };
      },
    );

    app.get(
      '/me',
      { schema: { tags: ['auth'], response: { 200: Type.Ref(UserSchema) } } },
      async (request) => requireActor(request),
    );

    /** FR-AUTH-006 */
    app.get(
      '/sessions',
      {
        schema: {
          tags: ['auth'],
          summary: 'List active sessions (FR-AUTH-006)',
          response: { 200: Type.Array(Type.Ref(SessionSchema)) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.auth.listSessions(actor.id, request.sessionId ?? '');
      },
    );

    /** FR-ACC-006 and FR-ACC-008 */
    app.post(
      '/password/change',
      {
        schema: {
          tags: ['auth'],
          summary: 'Change password (FR-ACC-006)',
          body: Type.Object({
            currentPassword: Type.String({ maxLength: 512 }),
            newPassword: Type.String({ maxLength: 512 }),
          }),
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        await services.accounts.changePassword(actor.id, request.body, metaOf(request));
        // FR-ACC-008: every other session goes, this one stays.
        const revoked = await services.auth.revokeOtherSessions(actor.id, request.sessionId ?? null);
        return { ok: true, otherSessionsRevoked: revoked };
      },
    );

    /** FR-ACC-007 */
    app.post(
      '/password/forgot',
      {
        schema: {
          tags: ['auth'],
          summary: 'Request a password reset (FR-ACC-007)',
          body: Type.Object({ email: Type.String({ maxLength: 254 }) }),
        },
      },
      async (request) => {
        const token = await services.accounts.requestPasswordReset(request.body.email);

        // The response never varies with whether the address is registered —
        // same reasoning as FR-AUTH-008. Under the local preview profile the
        // token comes back in the body because there is no SMTP relay (§8.4.3);
        // a deployed installation only ever sends it by mail.
        if (services.config.isPreview && token) {
          return { ok: true, previewToken: token };
        }
        return { ok: true };
      },
    );

    /** FR-ACC-007, FR-ACC-008 */
    app.post(
      '/password/reset',
      {
        schema: {
          tags: ['auth'],
          summary: 'Reset a password with a token (FR-ACC-007)',
          body: Type.Object({
            token: Type.String({ maxLength: 256 }),
            newPassword: Type.String({ maxLength: 512 }),
          }),
        },
      },
      async (request) => {
        const { userId } = await services.accounts.resetPassword(
          request.body.token,
          request.body.newPassword,
          metaOf(request),
        );
        // FR-ACC-008: a reset revokes everything, including any session the
        // attacker may already hold.
        await services.auth.revokeOtherSessions(userId, null);
        return { ok: true };
      },
    );

    /** FR-ACC-009 */
    app.patch(
      '/me',
      {
        schema: {
          tags: ['auth'],
          summary: 'Update your own profile (FR-ACC-009)',
          body: Type.Object({
            displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
            email: Type.Optional(Type.String({ format: 'email', maxLength: 254 })),
          }),
          response: { 200: Type.Ref(UserSchema) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.accounts.updateProfile(actor.id, request.body);
      },
    );

    /** NFR-CMP-001 */
    app.get(
      '/me/export',
      { schema: { tags: ['auth'], summary: 'Export your personal data (NFR-CMP-001)' } },
      async (request, reply) => {
        const actor = await requireActor(request);
        const data = await services.accounts.exportPersonalData(actor.id);
        return reply
          .header('content-disposition', 'attachment; filename="personal-data.json"')
          .send(data);
      },
    );

    /** NFR-CMP-002 */
    app.post(
      '/me/erase',
      { schema: { tags: ['auth'], summary: 'Erase your personal data (NFR-CMP-002)' } },
      async (request, reply) => {
        const actor = await requireActor(request);
        await services.accounts.anonymize(actor.id);
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return { ok: true };
      },
    );
  };
}
