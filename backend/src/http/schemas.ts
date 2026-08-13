import { Type } from '@sinclair/typebox';
import { PROJECT_ROLES } from '../services/authorization.js';
import { PRIORITIES, REQUIREMENT_STATUSES, REQUIREMENT_TYPES } from '../domain/requirement-status.js';
import { SORT_FIELDS } from '../services/requirement-queries.js';

const nullableString = () => Type.Union([Type.String(), Type.Null()]);

export const ErrorResponse = Type.Object(
  {
    error: Type.Object({
      code: Type.String(),
      message: Type.String(),
      details: Type.Optional(Type.Unknown()),
    }),
  },
  { $id: 'Error' },
);

export const UserSchema = Type.Object(
  {
    id: Type.String(),
    email: Type.String(),
    displayName: Type.String(),
    isAdministrator: Type.Boolean(),
    isActive: Type.Boolean(),
    createdAt: Type.String(),
    updatedAt: Type.String(),
  },
  { $id: 'User' },
);

export const SessionSchema = Type.Object(
  {
    id: Type.String(),
    createdAt: Type.String(),
    lastSeenAt: Type.String(),
    ip: nullableString(),
    userAgent: nullableString(),
    current: Type.Boolean(),
  },
  { $id: 'Session' },
);

export const RoleSchema = Type.Union(PROJECT_ROLES.map((role) => Type.Literal(role)));

export const ProjectSchema = Type.Object(
  {
    id: Type.String(),
    key: Type.String(),
    name: Type.String(),
    description: nullableString(),
    role: RoleSchema,
    requirementCount: Type.Optional(Type.Number()),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    deletedAt: nullableString(),
  },
  { $id: 'Project' },
);

export const MemberSchema = Type.Object(
  {
    userId: Type.String(),
    displayName: Type.String(),
    email: Type.String(),
    role: RoleSchema,
  },
  { $id: 'Member' },
);

export const CategorySchema = Type.Object(
  {
    id: Type.String(),
    projectId: Type.String(),
    parentId: nullableString(),
    name: Type.String(),
    sortOrder: Type.Number(),
    depth: Type.Number(),
  },
  { $id: 'Category' },
);

export const TagSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    usageCount: Type.Optional(Type.Number()),
  },
  { $id: 'Tag' },
);

export const RequirementTypeSchema = Type.Union(REQUIREMENT_TYPES.map((t) => Type.Literal(t)));
export const RequirementStatusSchema = Type.Union(
  REQUIREMENT_STATUSES.map((s) => Type.Literal(s)),
);
export const PrioritySchema = Type.Union(PRIORITIES.map((p) => Type.Literal(p)));

export const RequirementSchema = Type.Object(
  {
    id: Type.String(),
    key: Type.String(),
    projectId: Type.String(),
    title: Type.String(),
    statement: Type.String(),
    rationale: nullableString(),
    type: RequirementTypeSchema,
    priority: PrioritySchema,
    status: RequirementStatusSchema,
    acceptanceCriteria: nullableString(),
    source: nullableString(),
    ownerId: nullableString(),
    categoryId: nullableString(),
    parentId: nullableString(),
    sortOrder: Type.Number(),
    version: Type.Number(),
    tags: Type.Array(Type.String()),
    createdAt: Type.String(),
    createdBy: Type.String(),
    updatedAt: Type.String(),
    updatedBy: Type.String(),
    deletedAt: nullableString(),
  },
  { $id: 'Requirement' },
);

export const RequirementListSchema = Type.Object({
  items: Type.Array(Type.Ref(RequirementSchema)),
  total: Type.Number(),
  limit: Type.Number(),
  offset: Type.Number(),
});

export const CreateRequirementBody = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  statement: Type.String({ minLength: 1, maxLength: 10_000 }),
  type: RequirementTypeSchema,
  rationale: Type.Optional(Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()])),
  priority: Type.Optional(PrioritySchema),
  status: Type.Optional(RequirementStatusSchema),
  acceptanceCriteria: Type.Optional(
    Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()]),
  ),
  source: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
  ownerId: Type.Optional(nullableString()),
  categoryId: Type.Optional(nullableString()),
  parentId: Type.Optional(nullableString()),
  tags: Type.Optional(Type.Array(Type.String({ maxLength: 50 }), { maxItems: 50 })),
});

export const UpdateRequirementBody = Type.Intersect([
  Type.Partial(CreateRequirementBody),
  Type.Object({ version: Type.Integer({ minimum: 1 }) }),
]);

export const ListRequirementsQuery = Type.Object({
  type: Type.Optional(Type.Union([Type.Array(Type.String()), Type.String()])),
  status: Type.Optional(Type.Union([Type.Array(Type.String()), Type.String()])),
  priority: Type.Optional(Type.Union([Type.Array(Type.String()), Type.String()])),
  tag: Type.Optional(Type.Union([Type.Array(Type.String()), Type.String()])),
  categoryId: Type.Optional(Type.String()),
  includeDescendants: Type.Optional(Type.Boolean()),
  uncategorized: Type.Optional(Type.Boolean()),
  ownerId: Type.Optional(Type.String()),
  authorId: Type.Optional(Type.String()),
  q: Type.Optional(Type.String()),
  includeDeleted: Type.Optional(Type.Boolean()),
  sort: Type.Optional(Type.Union(SORT_FIELDS.map((f) => Type.Literal(f)))),
  direction: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

export const RevisionSchema = Type.Object(
  {
    id: Type.String(),
    requirementId: Type.String(),
    version: Type.Number(),
    changedBy: Type.String(),
    changedByName: nullableString(),
    changedAt: Type.String(),
    changeKind: Type.String(),
    snapshot: Type.Ref(RequirementSchema),
  },
  { $id: 'Revision' },
);

export const DiffSchema = Type.Object({
  from: Type.Number(),
  to: Type.Number(),
  changes: Type.Array(
    Type.Object({
      field: Type.String(),
      before: Type.Unknown(),
      after: Type.Unknown(),
    }),
  ),
});

export const AuditEventSchema = Type.Object(
  {
    id: Type.String(),
    occurredAt: Type.String(),
    actorUserId: nullableString(),
    eventType: Type.String(),
    projectId: nullableString(),
    targetType: nullableString(),
    targetId: nullableString(),
    ip: nullableString(),
    userAgent: nullableString(),
    metadata: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  },
  { $id: 'AuditEvent' },
);

export const MetaSchema = Type.Object({
  /** TR-DB-008: the running system says which profile it is. */
  profile: Type.Union([Type.Literal('local-preview'), Type.Literal('deployed')]),
  isPreview: Type.Boolean(),
  /** CON-004: one engine, but still reported rather than assumed by clients. */
  engine: Type.Literal('sqlite'),
  spec: Type.String(),
});

export const SHARED_SCHEMAS = [
  ErrorResponse,
  UserSchema,
  SessionSchema,
  ProjectSchema,
  MemberSchema,
  CategorySchema,
  TagSchema,
  RequirementSchema,
  RevisionSchema,
  AuditEventSchema,
];
