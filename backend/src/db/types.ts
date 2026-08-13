import type { Generated } from 'kysely';

/**
 * Physical schema. Representations follow §8.4.1, which avoids types only one
 * engine has: UUIDs as canonical text, timestamps as ISO-8601 UTC text,
 * booleans as 0/1, JSON as text.
 *
 * §4 remains the domain model; this is only how it is stored.
 */

export interface UsersTable {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  is_administrator: number;
  is_active: number;
  failed_login_count: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
  anonymized_at: string | null;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
  user_agent: string | null;
  ip: string | null;
}

export interface PasswordResetTokensTable {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface ProjectsTable {
  id: string;
  key: string;
  name: string;
  description: string | null;
  next_requirement_number: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  deleted_at: string | null;
}

export interface MembershipsTable {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  created_at: string;
  created_by: string;
}

export interface CategoriesTable {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

export interface TagsTable {
  id: string;
  project_id: string;
  name: string;
}

export interface RequirementTagsTable {
  requirement_id: string;
  tag_id: string;
}

export interface RequirementsTable {
  id: string;
  key: string;
  project_id: string;
  title: string;
  statement: string;
  rationale: string | null;
  type: string;
  priority: string;
  status: string;
  acceptance_criteria: string | null;
  source: string | null;
  owner_id: string | null;
  category_id: string | null;
  parent_id: string | null;
  sort_order: number;
  version: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  deleted_at: string | null;
}

export interface RevisionsTable {
  id: string;
  requirement_id: string;
  version: number;
  /** JSON as text (§8.4.1), parsed in the data-access layer. */
  snapshot: string;
  changed_by: string;
  changed_at: string;
  change_kind: string;
}

export interface AuditEventsTable {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  event_type: string;
  project_id: string | null;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  user_agent: string | null;
  /** JSON as text (§8.4.1). */
  metadata: string | null;
}

/**
 * TR-DB-011: an FTS5 virtual table. It is the only SQLite-specific object in
 * the schema, which is what TR-DB-015 asks for — the columns here are the
 * contract, the index type behind them is not.
 */
export interface RequirementSearchTable {
  requirement_id: string;
  title: string;
  statement: string;
  rationale: string;
}

export interface KyselyMigrationTable {
  name: string;
  timestamp: string;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  password_reset_tokens: PasswordResetTokensTable;
  projects: ProjectsTable;
  memberships: MembershipsTable;
  categories: CategoriesTable;
  tags: TagsTable;
  requirement_tags: RequirementTagsTable;
  requirements: RequirementsTable;
  revisions: RevisionsTable;
  audit_events: AuditEventsTable;
  requirement_search: RequirementSearchTable;
}

export type Db = Database;
export type { Generated };
