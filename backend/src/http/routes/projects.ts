import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { ProjectRole } from '../../services/authorization.js';
import type { Services } from '../../services/container.js';
import { metaOf, requireActor } from '../plugins.js';
import {
  CategorySchema,
  MemberSchema,
  ProjectSchema,
  RoleSchema,
  TagSchema,
} from '../schemas.js';

const ProjectParams = Type.Object({ projectId: Type.String() });

export function projectRoutes(services: Services): FastifyPluginAsyncTypebox {
  return async (app) => {
    /** FR-PRJ-005 */
    app.get(
      '/',
      {
        schema: {
          tags: ['projects'],
          summary: 'List your projects (FR-PRJ-005)',
          querystring: Type.Object({ includeDeleted: Type.Optional(Type.Boolean()) }),
          response: { 200: Type.Array(Type.Ref(ProjectSchema)) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.projects.listForUser(actor, request.query.includeDeleted ?? false);
      },
    );

    /** FR-PRJ-001, FR-PRJ-002, FR-PRJ-003 */
    app.post(
      '/',
      {
        schema: {
          tags: ['projects'],
          summary: 'Create a project (FR-PRJ-001)',
          body: Type.Object({
            key: Type.String({ minLength: 2, maxLength: 8 }),
            name: Type.String({ minLength: 1, maxLength: 100 }),
            description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          }),
          response: { 201: Type.Ref(ProjectSchema) },
        },
      },
      async (request, reply) => {
        const actor = await requireActor(request);
        const project = await services.projects.create(actor, request.body, metaOf(request));
        return reply.status(201).send(project);
      },
    );

    app.get(
      '/:projectId',
      {
        schema: {
          tags: ['projects'],
          params: ProjectParams,
          response: { 200: Type.Ref(ProjectSchema) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.projects.get(actor, request.params.projectId);
      },
    );

    /** FR-PRJ-004 is enforced by rejecting `key` here. */
    app.patch(
      '/:projectId',
      {
        schema: {
          tags: ['projects'],
          summary: 'Rename a project (FR-AUTHZ-005); the key is immutable (FR-PRJ-004)',
          params: ProjectParams,
          body: Type.Object({
            name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
            description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            key: Type.Optional(Type.String()),
          }),
          response: { 200: Type.Ref(ProjectSchema) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.projects.update(actor, request.params.projectId, request.body);
      },
    );

    /** FR-PRJ-007 */
    app.delete(
      '/:projectId',
      {
        schema: {
          tags: ['projects'],
          summary: 'Soft-delete a project (FR-PRJ-007)',
          params: ProjectParams,
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        await services.projects.softDelete(actor, request.params.projectId, metaOf(request));
        return { ok: true };
      },
    );

    /** FR-PRJ-008 */
    app.post(
      '/:projectId/restore',
      {
        schema: {
          tags: ['projects'],
          summary: 'Restore a deleted project within 30 days (FR-PRJ-008)',
          params: ProjectParams,
          response: { 200: Type.Ref(ProjectSchema) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.projects.restore(actor, request.params.projectId);
      },
    );

    app.get(
      '/:projectId/members',
      {
        schema: {
          tags: ['projects'],
          params: ProjectParams,
          response: { 200: Type.Array(Type.Ref(MemberSchema)) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.projects.listMembers(actor, request.params.projectId);
      },
    );

    /** FR-PRJ-006, FR-AUTHZ-009 */
    app.put(
      '/:projectId/members/:userId',
      {
        schema: {
          tags: ['projects'],
          summary: 'Add a member or change their role (FR-PRJ-006)',
          params: Type.Object({ projectId: Type.String(), userId: Type.String() }),
          body: Type.Object({ role: RoleSchema }),
          response: { 200: Type.Array(Type.Ref(MemberSchema)) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.projects.setMemberRole(
          actor,
          request.params.projectId,
          request.params.userId,
          request.body.role as ProjectRole,
          metaOf(request),
        );
      },
    );

    /** FR-PRJ-006 */
    app.delete(
      '/:projectId/members/:userId',
      {
        schema: {
          tags: ['projects'],
          summary: 'Remove a member (FR-PRJ-006)',
          params: Type.Object({ projectId: Type.String(), userId: Type.String() }),
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        await services.projects.removeMember(
          actor,
          request.params.projectId,
          request.params.userId,
          metaOf(request),
        );
        return { ok: true };
      },
    );

    // ---- categories (FR-ORG-001 to FR-ORG-007) -------------------------------

    app.get(
      '/:projectId/categories',
      {
        schema: {
          tags: ['categories'],
          params: ProjectParams,
          response: { 200: Type.Array(Type.Ref(CategorySchema)) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.categories.list(actor, request.params.projectId);
      },
    );

    app.post(
      '/:projectId/categories',
      {
        schema: {
          tags: ['categories'],
          summary: 'Create a category (FR-ORG-001)',
          params: ProjectParams,
          body: Type.Object({
            name: Type.String({ minLength: 1, maxLength: 100 }),
            parentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          }),
          response: { 201: Type.Ref(CategorySchema) },
        },
      },
      async (request, reply) => {
        const actor = await requireActor(request);
        const category = await services.categories.create(
          actor,
          request.params.projectId,
          request.body,
        );
        return reply.status(201).send(category);
      },
    );

    app.patch(
      '/:projectId/categories/:categoryId',
      {
        schema: {
          tags: ['categories'],
          summary: 'Rename or move a category (FR-ORG-001, FR-ORG-003)',
          params: Type.Object({ projectId: Type.String(), categoryId: Type.String() }),
          body: Type.Object({
            name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
            parentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          }),
          response: { 200: Type.Ref(CategorySchema) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        const { projectId, categoryId } = request.params;

        let result = null;
        if (request.body.name !== undefined) {
          result = await services.categories.rename(actor, projectId, categoryId, request.body.name);
        }
        if (request.body.parentId !== undefined) {
          result = await services.categories.move(
            actor,
            projectId,
            categoryId,
            request.body.parentId,
          );
        }
        if (!result) {
          const all = await services.categories.list(actor, projectId);
          result = all.find((c) => c.id === categoryId)!;
        }
        return result;
      },
    );

    /** FR-ORG-007 */
    app.post(
      '/:projectId/categories/reorder',
      {
        schema: {
          tags: ['categories'],
          summary: 'Reorder sibling categories (FR-ORG-007)',
          params: ProjectParams,
          body: Type.Object({
            parentId: Type.Union([Type.String(), Type.Null()]),
            orderedIds: Type.Array(Type.String()),
          }),
          response: { 200: Type.Array(Type.Ref(CategorySchema)) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.categories.reorder(
          actor,
          request.params.projectId,
          request.body.parentId,
          request.body.orderedIds,
        );
      },
    );

    /** FR-ORG-005 */
    app.delete(
      '/:projectId/categories/:categoryId',
      {
        schema: {
          tags: ['categories'],
          summary: 'Delete a category, reassigning its contents upward (FR-ORG-005)',
          params: Type.Object({ projectId: Type.String(), categoryId: Type.String() }),
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        await services.categories.remove(
          actor,
          request.params.projectId,
          request.params.categoryId,
        );
        return { ok: true };
      },
    );

    // ---- tags (FR-ORG-008 to FR-ORG-011) -------------------------------------

    app.get(
      '/:projectId/tags',
      {
        schema: {
          tags: ['tags'],
          summary: 'List tags, which also feeds suggestions (FR-ORG-010)',
          params: ProjectParams,
          response: { 200: Type.Array(Type.Ref(TagSchema)) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.tags.list(actor, request.params.projectId);
      },
    );

    /** FR-ORG-011 */
    app.patch(
      '/:projectId/tags/:tagId',
      {
        schema: {
          tags: ['tags'],
          summary: 'Rename a tag across the project (FR-ORG-011)',
          params: Type.Object({ projectId: Type.String(), tagId: Type.String() }),
          body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 50 }) }),
          response: { 200: Type.Ref(TagSchema) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.tags.rename(
          actor,
          request.params.projectId,
          request.params.tagId,
          request.body.name,
        );
      },
    );

    /** FR-ORG-011 */
    app.delete(
      '/:projectId/tags/:tagId',
      {
        schema: {
          tags: ['tags'],
          summary: 'Delete a tag, detaching it everywhere (FR-ORG-011)',
          params: Type.Object({ projectId: Type.String(), tagId: Type.String() }),
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        await services.tags.remove(actor, request.params.projectId, request.params.tagId);
        return { ok: true };
      },
    );
  };
}
