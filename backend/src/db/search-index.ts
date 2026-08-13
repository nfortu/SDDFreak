import { type Kysely, sql } from 'kysely';
import type { DbEngine } from '../config.js';
import type { Database } from './types.js';

export interface SearchDocument {
  requirementId: string;
  title: string;
  statement: string;
  rationale: string | null;
}

/**
 * TR-DB-011 and TR-DB-013: this file is the whole of the engine divergence.
 * Everything above it in the stack calls the same three methods, and no
 * engine-specific SQL appears anywhere else (TR-DB-004).
 *
 * TR-DB-012 sets what must match across engines: whole-word matching over
 * title, statement, and rationale. Relevance ordering is explicitly allowed to
 * differ, so neither implementation ranks — ordering is applied by the caller.
 */
export class SearchIndex {
  constructor(
    private readonly engine: DbEngine,
    private readonly db: Kysely<Database>,
  ) {}

  private conn(trx?: Kysely<Database>): Kysely<Database> {
    return trx ?? this.db;
  }

  async upsert(doc: SearchDocument, trx?: Kysely<Database>): Promise<void> {
    const db = this.conn(trx);
    const rationale = doc.rationale ?? '';

    if (this.engine === 'sqlite') {
      // FTS5 has no upsert, and its "primary key" is an implicit rowid, so a
      // replace is delete-then-insert.
      await sql`delete from requirement_search where requirement_id = ${doc.requirementId}`.execute(
        db,
      );
      await sql`insert into requirement_search (requirement_id, title, statement, rationale)
        values (${doc.requirementId}, ${doc.title}, ${doc.statement}, ${rationale})`.execute(db);
      return;
    }

    await sql`insert into requirement_search (requirement_id, title, statement, rationale)
      values (${doc.requirementId}, ${doc.title}, ${doc.statement}, ${rationale})
      on conflict (requirement_id) do update
        set title = excluded.title,
            statement = excluded.statement,
            rationale = excluded.rationale`.execute(db);
  }

  async remove(requirementId: string, trx?: Kysely<Database>): Promise<void> {
    await sql`delete from requirement_search where requirement_id = ${requirementId}`.execute(
      this.conn(trx),
    );
  }

  /**
   * Returns the ids of matching requirements, unordered. The caller scopes them
   * to a project and applies its own sort, which is what keeps FR-SRCH-004
   * behaving identically on both engines.
   */
  async match(query: string): Promise<string[]> {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    if (this.engine === 'sqlite') {
      // Each term is quoted, so FTS5 operators a user happens to type ("OR",
      // "*", "NEAR") are matched literally rather than executed.
      const expression = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ');
      const result = await sql<{ requirement_id: string }>`
        select requirement_id from requirement_search where requirement_search match ${expression}
      `.execute(this.db);
      return result.rows.map((row) => row.requirement_id);
    }

    // plainto_tsquery ANDs the terms and ignores punctuation, matching the
    // SQLite behaviour above.
    const result = await sql<{ requirement_id: string }>`
      select requirement_id from requirement_search
      where search_vector @@ plainto_tsquery('english', ${terms.join(' ')})
    `.execute(this.db);
    return result.rows.map((row) => row.requirement_id);
  }
}

/** Whole-word tokens, per TR-DB-012. */
function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((term) => term.length > 0);
}
