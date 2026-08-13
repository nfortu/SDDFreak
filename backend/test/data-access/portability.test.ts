import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSqliteDb } from '../../src/db/connection.js';
import { migrateDown, migrateToLatest } from '../../src/db/migrator.js';
import {
  type Actor,
  type TestContext,
  as,
  createActor,
  createProject,
  createRequirement,
  createTestContext,
  uniqueKey,
} from '../helpers.js';

/**
 * §8.4: the storage-level promises. These assert the representations of
 * §8.4.1 at the row level rather than through the domain, so a change of
 * physical shape — the one thing a future engine swap (§2.3) would disturb —
 * fails here rather than in production.
 */
describe('data access on SQLite (§8.4)', () => {
  let ctx: TestContext;
  let owner: Actor;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    owner = await createActor(ctx);
    projectId = (await createProject(ctx, owner, uniqueKey('PT'))).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('TR-DB-005: the same migration source produced every table', async () => {
    for (const table of [
      'users',
      'sessions',
      'password_reset_tokens',
      'projects',
      'memberships',
      'categories',
      'tags',
      'requirement_tags',
      'requirements',
      'revisions',
      'audit_events',
      'requirement_search',
    ] as const) {
      const result = await ctx.services.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirst();
      expect(Number(result?.count), table).toBeGreaterThanOrEqual(0);
    }
  });

  it('TR-DB-009: a foreign-key violation is rejected', async () => {
    // Off by default per connection in SQLite, which is exactly why this is a
    // requirement rather than an assumption.
    await expect(
      ctx.services.db
        .insertInto('memberships')
        .values({
          id: 'fk-violation-test',
          project_id: 'no-such-project',
          user_id: owner.id,
          role: 'viewer',
          created_at: new Date().toISOString(),
          created_by: owner.id,
        })
        .execute(),
    ).rejects.toThrow();
  });

  it('§8.4.1: UUIDs are stored as canonical lowercase text', async () => {
    const row = await ctx.services.db
      .selectFrom('projects')
      .select('id')
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow();

    expect(typeof row.id).toBe('string');
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('§8.4.1: timestamps are ISO-8601 UTC text that sorts chronologically', async () => {
    const a = await createRequirement(ctx, owner, projectId, { title: 'Earlier' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await createRequirement(ctx, owner, projectId, { title: 'Later' });

    const rows = await ctx.services.db
      .selectFrom('requirements')
      .select(['id', 'created_at'])
      .where('id', 'in', [a.id, b.id])
      .orderBy('created_at', 'asc')
      .execute();

    expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
    for (const row of rows) {
      expect(typeof row.created_at).toBe('string');
      expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it('§8.4.1: booleans are stored as 0 and 1', async () => {
    const row = await ctx.services.db
      .selectFrom('users')
      .select(['is_active', 'is_administrator'])
      .where('id', '=', owner.id)
      .executeTakeFirstOrThrow();

    expect([0, 1, true, false]).toContain(row.is_active);
    expect(Number(row.is_active)).toBe(1);
  });

  it('§8.4.1: JSON columns round-trip through text', async () => {
    const created = await createRequirement(ctx, owner, projectId, { title: 'JSON round trip' });
    const revision = await ctx.services.db
      .selectFrom('revisions')
      .select('snapshot')
      .where('requirement_id', '=', created.id)
      .executeTakeFirstOrThrow();

    expect(typeof revision.snapshot).toBe('string');
    expect(JSON.parse(revision.snapshot).title).toBe('JSON round trip');
  });

  it('§8.4.1: email uniqueness needs no citext or NOCASE collation', async () => {
    const mixed = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'MiXeD.Case@Example.Test',
        password: 'a-perfectly-fine-passphrase-1',
        displayName: 'Mixed',
      },
    });
    expect(mixed.statusCode).toBe(201);
    expect(mixed.json().email).toBe('mixed.case@example.test');

    const clash = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'mixed.CASE@example.test',
        password: 'a-perfectly-fine-passphrase-1',
        displayName: 'Clash',
      },
    });
    expect(clash.statusCode).toBe(409);
  });

  it('TR-DB-012: search matches whole words over title, statement, and rationale', async () => {
    const project = await createProject(ctx, owner, uniqueKey('FT'));
    await createRequirement(ctx, owner, project.id, {
      title: 'Portable search',
      statement: 'The system shall index the word supercalifragilistic for retrieval.',
      rationale: 'Because searching matters.',
    });

    const search = async (q: string) =>
      (
        await ctx.app.inject(
          as(owner, {
            method: 'GET',
            url: `/api/projects/${project.id}/requirements?q=${encodeURIComponent(q)}`,
          }),
        )
      ).json().total;

    expect(await search('supercalifragilistic')).toBe(1);
    expect(await search('SUPERCALIFRAGILISTIC')).toBe(1); // case-insensitive
    expect(await search('portable')).toBe(1); // title
    expect(await search('searching')).toBe(1); // rationale
    expect(await search('supercalifragilistic retrieval')).toBe(1); // AND
    expect(await search('supercalifragilistic absent')).toBe(0);
    expect(await search('supercalifragilisti')).toBe(0); // whole words, not prefixes
  });

  it('FR-REQ-002: the key counter is monotonic under repeated allocation', async () => {
    const project = await createProject(ctx, owner, uniqueKey('KY'));

    const created = [];
    for (let index = 0; index < 5; index += 1) {
      created.push(await createRequirement(ctx, owner, project.id, { title: `Key ${index}` }));
    }

    const numbers = created.map((r) => Number(r.key.split('-')[1]));
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('NFR-PERF-102: the filter and sort columns of §6.7 are indexed', async () => {
    const indexed = (
      await sql<{ name: string }>`
        select name from sqlite_master where type = 'index' and tbl_name = 'requirements'
      `.execute(ctx.services.db)
    ).rows.map((r) => r.name);

    for (const expected of [
      'requirements_project_status_idx',
      'requirements_project_type_idx',
      'requirements_project_priority_idx',
      'requirements_project_category_idx',
      'requirements_project_owner_idx',
      'requirements_project_author_idx',
      'requirements_project_updated_idx',
    ]) {
      expect(indexed, expected).toContain(expected);
    }
  });

  it('TR-DB-008: the running system reports its own profile and engine', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/meta' });

    expect(response.statusCode).toBe(200);
    expect(response.json().engine).toBe('sqlite');
    expect(response.json().profile).toBe('local-preview');
    expect(response.json().isPreview).toBe(true);
  });

  it('NFR-MNT-004: the health endpoint reports dependency reachability', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
    expect(response.json().checks.database).toBe('ok');
    expect(response.json().engine).toBe('sqlite');
  });
});

/** TR-DB-005 with NFR-MNT-006: one migration source, applied and reversible. */
describe('migrations (§8.4)', () => {
  it('TR-DB-005: applies from empty and rolls every migration back', async () => {
    const handle = createSqliteDb(':memory:');

    try {
      await migrateToLatest(handle.db);

      const applied = async () =>
        (
          await sql<{ name: string }>`
            select name from sqlite_master where type in ('table', 'view')
          `.execute(handle.db)
        ).rows.map((r) => r.name);

      expect(await applied()).toContain('requirements');

      // Down to nothing: two migrations, so two steps. What survives is the
      // migrator's own bookkeeping, not application schema.
      await migrateDown(handle.db);
      await migrateDown(handle.db);

      const remaining = (await applied()).filter((name) => !name.startsWith('kysely_'));
      expect(remaining).toEqual([]);

      // Reversible means re-appliable, not merely droppable.
      await migrateToLatest(handle.db);
      expect(await applied()).toContain('requirement_search');
    } finally {
      await handle.close();
    }
  });
});
