import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Services } from '../../services/container.js';
import { metaOf, requireActor } from '../plugins.js';
import { AuditEventSchema, UserSchema } from '../schemas.js';

/** FR-AUTHZ-007, FR-AUTHZ-008, FR-AUD-007 */
export function adminRoutes(services: Services): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.addHook('onRequest', async (request) => {
      const actor = await requireActor(request);
      services.authz.requireAdministrator(actor);
    });

    app.get(
      '/users',
      { schema: { tags: ['admin'], response: { 200: Type.Array(Type.Ref(UserSchema)) } } },
      async () => services.accounts.list(),
    );

    /** FR-ACC-010 */
    app.post(
      '/users/:userId/active',
      {
        schema: {
          tags: ['admin'],
          summary: 'Deactivate or reactivate an account (FR-ACC-010)',
          params: Type.Object({ userId: Type.String() }),
          body: Type.Object({ isActive: Type.Boolean() }),
          response: { 200: Type.Ref(UserSchema) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.accounts.setActive(
          actor.id,
          request.params.userId,
          request.body.isActive,
          metaOf(request),
        );
      },
    );

    /**
     * An administrator can see that projects exist, which is what makes
     * FR-AUTHZ-007 usable — but seeing the list is not seeing the contents.
     */
    app.get('/projects', { schema: { tags: ['admin'] } }, async (request) => {
      const actor = await requireActor(request);
      return services.projects.listAllForAdmin(actor);
    });

    /** FR-AUTHZ-007 and FR-AUTHZ-008 */
    app.post(
      '/projects/:projectId/access',
      {
        schema: {
          tags: ['admin'],
          summary: 'Grant yourself access to a project; always audited (FR-AUTHZ-008)',
          params: Type.Object({ projectId: Type.String() }),
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        const role = await services.projects.grantAdminAccess(
          actor,
          request.params.projectId,
          metaOf(request),
        );
        return { role };
      },
    );

    /** FR-AUD-007 */
    app.get(
      '/audit',
      {
        schema: {
          tags: ['admin'],
          summary: 'Read and filter the audit log (FR-AUD-007)',
          querystring: Type.Object({
            actorUserId: Type.Optional(Type.String()),
            eventType: Type.Optional(Type.String()),
            projectId: Type.Optional(Type.String()),
            from: Type.Optional(Type.String()),
            to: Type.Optional(Type.String()),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
            offset: Type.Optional(Type.Integer({ minimum: 0 })),
          }),
          response: {
            200: Type.Object({
              items: Type.Array(Type.Ref(AuditEventSchema)),
              total: Type.Number(),
            }),
          },
        },
      },
      async (request) => services.audit.list(request.query),
    );
  };
}
