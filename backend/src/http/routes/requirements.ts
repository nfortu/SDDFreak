import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Services } from '../../services/container.js';
import { toCsv } from '../../services/requirement-queries.js';
import type { ListQuery, SortField } from '../../services/requirement-queries.js';
import { requireActor } from '../plugins.js';
import {
  CreateRequirementBody,
  DiffSchema,
  ListRequirementsQuery,
  PrioritySchema,
  RequirementListSchema,
  RequirementSchema,
  RequirementStatusSchema,
  RevisionSchema,
  UpdateRequirementBody,
} from '../schemas.js';

const asArray = (value: string[] | string | undefined): string[] | undefined => {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : value.split(',').filter(Boolean);
};

function toListQuery(query: Record<string, unknown>): ListQuery {
  return {
    type: asArray(query.type as string[] | string | undefined),
    status: asArray(query.status as string[] | string | undefined),
    priority: asArray(query.priority as string[] | string | undefined),
    tag: asArray(query.tag as string[] | string | undefined),
    categoryId: (query.categoryId as string | undefined) ?? null,
    includeDescendants: query.includeDescendants as boolean | undefined,
    uncategorized: query.uncategorized as boolean | undefined,
    ownerId: query.ownerId as string | undefined,
    authorId: query.authorId as string | undefined,
    q: query.q as string | undefined,
    includeDeleted: query.includeDeleted as boolean | undefined,
    sort: query.sort as SortField | undefined,
    direction: query.direction as 'asc' | 'desc' | undefined,
    limit: query.limit as number | undefined,
    offset: query.offset as number | undefined,
  };
}

export function requirementRoutes(services: Services): FastifyPluginAsyncTypebox {
  return async (app) => {
    /** FR-SRCH-001 to FR-SRCH-006, FR-SRCH-008 */
    app.get(
      '/projects/:projectId/requirements',
      {
        schema: {
          tags: ['requirements'],
          summary: 'List, filter, sort, and search requirements (FR-SRCH-001…006)',
          params: Type.Object({ projectId: Type.String() }),
          querystring: ListRequirementsQuery,
          response: { 200: RequirementListSchema },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.queries.list(
          actor,
          request.params.projectId,
          toListQuery(request.query as Record<string, unknown>),
        );
      },
    );

    /** FR-SRCH-007 */
    app.get(
      '/projects/:projectId/requirements/tree',
      {
        schema: {
          tags: ['requirements'],
          summary: 'Category hierarchy with parent–child decomposition (FR-SRCH-007)',
          params: Type.Object({ projectId: Type.String() }),
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.queries.tree(actor, request.params.projectId);
      },
    );

    /** FR-SRCH-009 */
    app.get(
      '/projects/:projectId/requirements/export',
      {
        schema: {
          tags: ['requirements'],
          summary: 'Export the filtered result set as CSV or JSON (FR-SRCH-009)',
          params: Type.Object({ projectId: Type.String() }),
          querystring: Type.Intersect([
            ListRequirementsQuery,
            Type.Object({
              format: Type.Optional(Type.Union([Type.Literal('csv'), Type.Literal('json')])),
            }),
          ]),
        },
      },
      async (request, reply) => {
        const actor = await requireActor(request);
        const query = request.query as Record<string, unknown>;
        const requirements = await services.queries.exportAll(
          actor,
          request.params.projectId,
          toListQuery(query),
        );

        if (query.format === 'csv') {
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', 'attachment; filename="requirements.csv"')
            .send(toCsv(requirements));
        }

        return reply
          .header('content-disposition', 'attachment; filename="requirements.json"')
          .send(requirements);
      },
    );

    /** FR-REQ-001 */
    app.post(
      '/projects/:projectId/requirements',
      {
        schema: {
          tags: ['requirements'],
          summary: 'Create a requirement (FR-REQ-001, FR-REQ-002)',
          params: Type.Object({ projectId: Type.String() }),
          body: CreateRequirementBody,
          response: { 201: Type.Ref(RequirementSchema) },
        },
      },
      async (request, reply) => {
        const actor = await requireActor(request);
        const requirement = await services.requirements.create(
          actor,
          request.params.projectId,
          request.body,
        );
        return reply.status(201).send(requirement);
      },
    );

    /** FR-ORG-015 */
    app.post(
      '/projects/:projectId/requirements/bulk',
      {
        schema: {
          tags: ['requirements'],
          summary: 'Apply one change to many requirements, all or none (FR-ORG-015)',
          params: Type.Object({ projectId: Type.String() }),
          body: Type.Object({
            requirementIds: Type.Array(Type.String(), { minItems: 1 }),
            changes: Type.Object({
              categoryId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              status: Type.Optional(RequirementStatusSchema),
              priority: Type.Optional(PrioritySchema),
              ownerId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              addTags: Type.Optional(Type.Array(Type.String({ maxLength: 50 }))),
              removeTags: Type.Optional(Type.Array(Type.String({ maxLength: 50 }))),
            }),
          }),
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.requirements.bulkUpdate(
          actor,
          request.params.projectId,
          request.body.requirementIds,
          request.body.changes,
        );
      },
    );

    /** FR-ORG-014 */
    app.post(
      '/projects/:projectId/requirements/reorder',
      {
        schema: {
          tags: ['requirements'],
          summary: 'Reorder siblings within a category (FR-ORG-014)',
          params: Type.Object({ projectId: Type.String() }),
          body: Type.Object({
            categoryId: Type.Union([Type.String(), Type.Null()]),
            orderedIds: Type.Array(Type.String()),
          }),
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        await services.requirements.reorder(
          actor,
          request.params.projectId,
          request.body.categoryId,
          request.body.orderedIds,
        );
        return { ok: true };
      },
    );

    /** FR-REQ-005 */
    app.get(
      '/requirements/:requirementId',
      {
        schema: {
          tags: ['requirements'],
          params: Type.Object({ requirementId: Type.String() }),
          response: { 200: Type.Ref(RequirementSchema) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.requirements.get(actor, request.params.requirementId);
      },
    );

    /** FR-REQ-006 to FR-REQ-010 */
    app.patch(
      '/requirements/:requirementId',
      {
        schema: {
          tags: ['requirements'],
          summary: 'Update a requirement with optimistic concurrency (FR-REQ-006…010)',
          params: Type.Object({ requirementId: Type.String() }),
          body: UpdateRequirementBody,
          response: { 200: Type.Ref(RequirementSchema) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.requirements.update(
          actor,
          request.params.requirementId,
          request.body as Parameters<typeof services.requirements.update>[2],
        );
      },
    );

    /** FR-REQ-011, FR-REQ-012 */
    app.delete(
      '/requirements/:requirementId',
      {
        schema: {
          tags: ['requirements'],
          summary: 'Soft-delete a requirement (FR-REQ-011, FR-REQ-012)',
          params: Type.Object({ requirementId: Type.String() }),
          querystring: Type.Object({ cascade: Type.Optional(Type.Boolean()) }),
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.requirements.softDelete(actor, request.params.requirementId, {
          cascade: request.query.cascade ?? false,
        });
      },
    );

    /** FR-REQ-013 */
    app.post(
      '/requirements/:requirementId/restore',
      {
        schema: {
          tags: ['requirements'],
          summary: 'Restore a soft-deleted requirement (FR-REQ-013)',
          params: Type.Object({ requirementId: Type.String() }),
          response: { 200: Type.Ref(RequirementSchema) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.requirements.restore(actor, request.params.requirementId);
      },
    );

    /** FR-REQ-014 */
    app.post(
      '/requirements/:requirementId/purge',
      {
        schema: {
          tags: ['requirements'],
          summary: 'Permanently purge a long-deleted requirement (FR-REQ-014)',
          params: Type.Object({ requirementId: Type.String() }),
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        await services.requirements.purge(actor, request.params.requirementId);
        return { ok: true };
      },
    );

    /** FR-REQ-015 */
    app.post(
      '/requirements/:requirementId/duplicate',
      {
        schema: {
          tags: ['requirements'],
          summary: 'Duplicate a requirement into a new draft (FR-REQ-015)',
          params: Type.Object({ requirementId: Type.String() }),
          response: { 201: Type.Ref(RequirementSchema) },
        },
      },
      async (request, reply) => {
        const actor = await requireActor(request);
        const copy = await services.requirements.duplicate(actor, request.params.requirementId);
        return reply.status(201).send(copy);
      },
    );

    /** FR-AUD-002 */
    app.get(
      '/requirements/:requirementId/revisions',
      {
        schema: {
          tags: ['history'],
          summary: 'Revision history, newest first (FR-AUD-002)',
          params: Type.Object({ requirementId: Type.String() }),
          response: { 200: Type.Array(Type.Ref(RevisionSchema)) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.revisions.list(actor, request.params.requirementId);
      },
    );

    /** FR-AUD-003 */
    app.get(
      '/requirements/:requirementId/revisions/diff',
      {
        schema: {
          tags: ['history'],
          summary: 'Field-level differences between two revisions (FR-AUD-003)',
          params: Type.Object({ requirementId: Type.String() }),
          querystring: Type.Object({
            from: Type.Integer({ minimum: 1 }),
            to: Type.Integer({ minimum: 1 }),
          }),
          response: { 200: DiffSchema },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.revisions.diff(
          actor,
          request.params.requirementId,
          request.query.from,
          request.query.to,
        );
      },
    );

    /** FR-AUD-004 */
    app.post(
      '/requirements/:requirementId/revert',
      {
        schema: {
          tags: ['history'],
          summary: 'Revert content to an earlier revision, as a new revision (FR-AUD-004)',
          params: Type.Object({ requirementId: Type.String() }),
          body: Type.Object({ toVersion: Type.Integer({ minimum: 1 }) }),
          response: { 200: Type.Ref(RequirementSchema) },
        },
      },
      async (request) => {
        const actor = await requireActor(request);
        return services.revisions.revert(
          actor,
          request.params.requirementId,
          request.body.toVersion,
        );
      },
    );
  };
}
