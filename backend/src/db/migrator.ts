import type { Kysely } from 'kysely';
import { type Migration, type MigrationProvider, Migrator } from 'kysely/migration';
import { createMigrations } from './migrations.js';
import type { Database } from './types.js';

class StaticMigrationProvider implements MigrationProvider {
  constructor(private readonly migrations: Record<string, Migration>) {}
  async getMigrations(): Promise<Record<string, Migration>> {
    return this.migrations;
  }
}

/**
 * TR-DB-005: one committed migration source. NFR-MNT-006: migrations are
 * versioned and reversible.
 */
export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new StaticMigrationProvider(createMigrations()),
  });

  const { error, results } = await migrator.migrateToLatest();

  if (error) {
    const failed = results?.find((r) => r.status === 'Error');
    throw new Error(
      `Migration failed${failed ? ` at '${failed.migrationName}'` : ''}: ${String(error)}`,
    );
  }
}

export async function migrateDown(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new StaticMigrationProvider(createMigrations()),
  });
  const { error } = await migrator.migrateDown();
  if (error) throw new Error(`Rollback failed: ${String(error)}`);
}
