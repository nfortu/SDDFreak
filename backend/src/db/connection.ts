import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { Config } from '../config.js';
import type { Database } from './types.js';

export interface DbHandle {
  readonly db: Kysely<Database>;
  close(): Promise<void>;
}

/** TR-DB-014: the file comes from configuration; nothing else varies. */
export function createDb(config: Config): DbHandle {
  return createSqliteDb(config.sqliteFile);
}

export function createSqliteDb(file: string): DbHandle {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }

  const sqlite = new BetterSqlite3(file);

  // TR-DB-009: foreign keys are off by default in SQLite and are set per
  // connection. Without this, referential integrity is left to application
  // code, which is exactly what the constraint exists to avoid.
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
    async close() {
      await db.destroy();
    },
  };
}
