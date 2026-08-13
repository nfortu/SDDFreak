import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteDialect } from 'kysely';
import pg from 'pg';
import type { Config, DbEngine } from '../config.js';
import type { Database } from './types.js';

export interface DbHandle {
  readonly db: Kysely<Database>;
  readonly engine: DbEngine;
  close(): Promise<void>;
}

/**
 * Postgres returns `bigint` and `numeric` as strings to avoid precision loss.
 * Our integer columns are all small counters, and SQLite hands them back as
 * numbers, so we parse them here to keep `version` and `sort_order` the same
 * type under both engines (§8.4.1).
 */
function configurePgTypeParsers(): void {
  pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));
  pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => Number(value));
}

export function createDb(config: Config): DbHandle {
  if (config.engine === 'sqlite') {
    return createSqliteDb(config.sqliteFile);
  }
  return createPostgresDb(config.databaseUrl!);
}

export function createSqliteDb(file: string): DbHandle {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }

  const sqlite = new BetterSqlite3(file);

  // TR-DB-009: foreign keys are off by default in SQLite and are set per
  // connection. Without this, referential integrity silently differs between
  // the local preview and a deployed installation.
  sqlite.pragma('foreign_keys = ON');

  // TR-DB-010: WAL plus a busy timeout, so a concurrent reader is never handed
  // SQLITE_BUSY while a write is in flight. WAL needs a real file.
  if (file !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');

  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database: sqlite }),
  });

  return {
    db,
    engine: 'sqlite',
    async close() {
      await db.destroy();
    },
  };
}

export function createPostgresDb(connectionString: string): DbHandle {
  configurePgTypeParsers();
  const pool = new pg.Pool({ connectionString, max: 10 });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  return {
    db,
    engine: 'postgres',
    async close() {
      await db.destroy();
    },
  };
}
