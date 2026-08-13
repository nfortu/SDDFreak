import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { DbEngine } from '../config.js';

/**
 * Migrations run against a schema that changes as they go, so Kysely types
 * their connection loosely on purpose. This alias keeps that in one place
 * rather than scattering `any` through the file.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MigrationDb = Kysely<any>;

/**
 * TR-DB-005: one migration source applies to both engines.
 *
 * The schema builder emits portable DDL, so almost nothing here branches. The
 * single exception is the search index (TR-DB-011), which cannot be expressed
 * identically on FTS5 and tsvector — that divergence is confined to migration
 * 002 and to `search.ts` in the data-access layer, as TR-DB-013 requires.
 */
export function createMigrations(engine: DbEngine): Record<string, Migration> {
  return {
    '001_initial_schema': initialSchema,
    '002_search_index': searchIndex(engine),
  };
}

const initialSchema: Migration = {
  async up(db: MigrationDb): Promise<void> {
    await db.schema
      .createTable('users')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('email', 'text', (c) => c.notNull().unique())
      .addColumn('password_hash', 'text', (c) => c.notNull())
      .addColumn('display_name', 'text', (c) => c.notNull())
      .addColumn('is_administrator', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('is_active', 'integer', (c) => c.notNull().defaultTo(1))
      .addColumn('failed_login_count', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('locked_until', 'text')
      .addColumn('created_at', 'text', (c) => c.notNull())
      .addColumn('updated_at', 'text', (c) => c.notNull())
      .addColumn('anonymized_at', 'text')
      .execute();

    await db.schema
      .createTable('sessions')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('token_hash', 'text', (c) => c.notNull().unique())
      .addColumn('created_at', 'text', (c) => c.notNull())
      .addColumn('last_seen_at', 'text', (c) => c.notNull())
      .addColumn('absolute_expires_at', 'text', (c) => c.notNull())
      .addColumn('revoked_at', 'text')
      .addColumn('user_agent', 'text')
      .addColumn('ip', 'text')
      .execute();
    await db.schema.createIndex('sessions_user_idx').on('sessions').column('user_id').execute();

    await db.schema
      .createTable('password_reset_tokens')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('token_hash', 'text', (c) => c.notNull().unique())
      .addColumn('expires_at', 'text', (c) => c.notNull())
      .addColumn('used_at', 'text')
      .addColumn('created_at', 'text', (c) => c.notNull())
      .execute();

    await db.schema
      .createTable('projects')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('key', 'text', (c) => c.notNull().unique())
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('description', 'text')
      // FR-REQ-003 / INV-02: monotonic, never decremented, so a key is never reused.
      .addColumn('next_requirement_number', 'integer', (c) => c.notNull().defaultTo(1))
      .addColumn('created_at', 'text', (c) => c.notNull())
      .addColumn('created_by', 'text', (c) => c.notNull().references('users.id'))
      .addColumn('updated_at', 'text', (c) => c.notNull())
      .addColumn('updated_by', 'text', (c) => c.notNull().references('users.id'))
      .addColumn('deleted_at', 'text')
      .execute();

    await db.schema
      .createTable('memberships')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('project_id', 'text', (c) =>
        c.notNull().references('projects.id').onDelete('cascade'),
      )
      .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
      .addColumn('role', 'text', (c) => c.notNull())
      .addColumn('created_at', 'text', (c) => c.notNull())
      .addColumn('created_by', 'text', (c) => c.notNull().references('users.id'))
      .execute();
    // §4.5: a user holds exactly one role per project.
    await db.schema
      .createIndex('memberships_project_user_idx')
      .on('memberships')
      .columns(['project_id', 'user_id'])
      .unique()
      .execute();
    await db.schema.createIndex('memberships_user_idx').on('memberships').column('user_id').execute();

    await db.schema
      .createTable('categories')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('project_id', 'text', (c) =>
        c.notNull().references('projects.id').onDelete('cascade'),
      )
      .addColumn('parent_id', 'text', (c) => c.references('categories.id').onDelete('cascade'))
      .addColumn('name', 'text', (c) => c.notNull())
      .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('created_at', 'text', (c) => c.notNull())
      .addColumn('created_by', 'text', (c) => c.notNull().references('users.id'))
      .addColumn('updated_at', 'text', (c) => c.notNull())
      .addColumn('updated_by', 'text', (c) => c.notNull().references('users.id'))
      .execute();
    await db.schema
      .createIndex('categories_project_parent_idx')
      .on('categories')
      .columns(['project_id', 'parent_id'])
      .execute();
    // FR-ORG-004. A plain unique index would not catch duplicate roots, because
    // both engines treat NULLs as distinct — hence the two partial indexes.
    // The service enforces this too; these make the database agree.
    await sql`create unique index categories_sibling_name_idx
      on categories (project_id, parent_id, name) where parent_id is not null`.execute(db);
    await sql`create unique index categories_root_name_idx
      on categories (project_id, name) where parent_id is null`.execute(db);

    await db.schema
      .createTable('tags')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('project_id', 'text', (c) =>
        c.notNull().references('projects.id').onDelete('cascade'),
      )
      .addColumn('name', 'text', (c) => c.notNull())
      .execute();
    await db.schema
      .createIndex('tags_project_name_idx')
      .on('tags')
      .columns(['project_id', 'name'])
      .unique()
      .execute();

    await db.schema
      .createTable('requirements')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('key', 'text', (c) => c.notNull().unique())
      .addColumn('project_id', 'text', (c) =>
        c.notNull().references('projects.id').onDelete('cascade'),
      )
      .addColumn('title', 'text', (c) => c.notNull())
      .addColumn('statement', 'text', (c) => c.notNull())
      .addColumn('rationale', 'text')
      .addColumn('type', 'text', (c) => c.notNull())
      .addColumn('priority', 'text', (c) => c.notNull().defaultTo('should'))
      .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
      .addColumn('acceptance_criteria', 'text')
      .addColumn('source', 'text')
      .addColumn('owner_id', 'text', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('category_id', 'text', (c) => c.references('categories.id').onDelete('set null'))
      .addColumn('parent_id', 'text', (c) => c.references('requirements.id').onDelete('set null'))
      .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('version', 'integer', (c) => c.notNull().defaultTo(1))
      .addColumn('created_at', 'text', (c) => c.notNull())
      .addColumn('created_by', 'text', (c) => c.notNull().references('users.id'))
      .addColumn('updated_at', 'text', (c) => c.notNull())
      .addColumn('updated_by', 'text', (c) => c.notNull().references('users.id'))
      .addColumn('deleted_at', 'text')
      .execute();

    // NFR-PERF-102: every filter and sort of §6.7 is backed by an index.
    const requirementIndexes: Array<[string, string[]]> = [
      ['requirements_project_deleted_idx', ['project_id', 'deleted_at']],
      ['requirements_project_status_idx', ['project_id', 'status']],
      ['requirements_project_type_idx', ['project_id', 'type']],
      ['requirements_project_priority_idx', ['project_id', 'priority']],
      ['requirements_project_category_idx', ['project_id', 'category_id']],
      ['requirements_project_owner_idx', ['project_id', 'owner_id']],
      ['requirements_project_author_idx', ['project_id', 'created_by']],
      ['requirements_project_parent_idx', ['project_id', 'parent_id']],
      ['requirements_project_sort_idx', ['project_id', 'sort_order']],
      ['requirements_project_title_idx', ['project_id', 'title']],
      ['requirements_project_created_idx', ['project_id', 'created_at']],
      ['requirements_project_updated_idx', ['project_id', 'updated_at']],
    ];
    for (const [name, columns] of requirementIndexes) {
      await db.schema.createIndex(name).on('requirements').columns(columns).execute();
    }

    await db.schema
      .createTable('requirement_tags')
      .addColumn('requirement_id', 'text', (c) =>
        c.notNull().references('requirements.id').onDelete('cascade'),
      )
      .addColumn('tag_id', 'text', (c) => c.notNull().references('tags.id').onDelete('cascade'))
      .addPrimaryKeyConstraint('requirement_tags_pk', ['requirement_id', 'tag_id'])
      .execute();
    await db.schema
      .createIndex('requirement_tags_tag_idx')
      .on('requirement_tags')
      .column('tag_id')
      .execute();

    await db.schema
      .createTable('revisions')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('requirement_id', 'text', (c) =>
        c.notNull().references('requirements.id').onDelete('cascade'),
      )
      .addColumn('version', 'integer', (c) => c.notNull())
      .addColumn('snapshot', 'text', (c) => c.notNull())
      .addColumn('changed_by', 'text', (c) => c.notNull().references('users.id'))
      .addColumn('changed_at', 'text', (c) => c.notNull())
      .addColumn('change_kind', 'text', (c) => c.notNull())
      .execute();
    // INV-06: one revision per version, so the count and the counter agree.
    await db.schema
      .createIndex('revisions_requirement_version_idx')
      .on('revisions')
      .columns(['requirement_id', 'version'])
      .unique()
      .execute();

    await db.schema
      .createTable('audit_events')
      .addColumn('id', 'text', (c) => c.primaryKey())
      .addColumn('occurred_at', 'text', (c) => c.notNull())
      .addColumn('actor_user_id', 'text', (c) => c.references('users.id').onDelete('set null'))
      .addColumn('event_type', 'text', (c) => c.notNull())
      .addColumn('project_id', 'text')
      .addColumn('target_type', 'text')
      .addColumn('target_id', 'text')
      .addColumn('ip', 'text')
      .addColumn('user_agent', 'text')
      .addColumn('metadata', 'text')
      .execute();
    for (const [name, column] of [
      ['audit_events_occurred_idx', 'occurred_at'],
      ['audit_events_actor_idx', 'actor_user_id'],
      ['audit_events_project_idx', 'project_id'],
      ['audit_events_type_idx', 'event_type'],
    ] as const) {
      await db.schema.createIndex(name).on('audit_events').column(column).execute();
    }
  },

  async down(db: MigrationDb): Promise<void> {
    for (const table of [
      'audit_events',
      'revisions',
      'requirement_tags',
      'requirements',
      'tags',
      'categories',
      'memberships',
      'projects',
      'password_reset_tokens',
      'sessions',
      'users',
    ]) {
      await db.schema.dropTable(table).ifExists().execute();
    }
  },
};

/**
 * TR-DB-011: the accepted divergence. Both shapes expose the same four columns,
 * so only the WHERE clause differs at query time (see `search.ts`).
 */
function searchIndex(engine: DbEngine): Migration {
  return {
    async up(db: MigrationDb): Promise<void> {
      if (engine === 'sqlite') {
        await sql`create virtual table requirement_search using fts5(
          requirement_id unindexed,
          title,
          statement,
          rationale,
          tokenize='unicode61'
        )`.execute(db);
      } else {
        await sql`create table requirement_search (
          requirement_id text primary key references requirements(id) on delete cascade,
          title text not null default '',
          statement text not null default '',
          rationale text not null default '',
          search_vector tsvector generated always as (
            to_tsvector('english',
              coalesce(title, '') || ' ' || coalesce(statement, '') || ' ' || coalesce(rationale, ''))
          ) stored
        )`.execute(db);
        await sql`create index requirement_search_vector_idx
          on requirement_search using gin (search_vector)`.execute(db);
      }
    },

    async down(db: MigrationDb): Promise<void> {
      await sql`drop table if exists requirement_search`.execute(db);
    },
  };
}
