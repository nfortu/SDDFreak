import { writeFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { createSqliteDb } from './db/connection.js';
import { migrateToLatest } from './db/migrator.js';
import { buildApp } from './http/app.js';
import { createServices } from './services/container.js';

/**
 * TR-BE-005 and TR-STR-004: the description is emitted from the running route
 * definitions, and the frontend's types are generated from this file. Both
 * sides therefore move together or the generation step fails.
 */
const config = { ...loadConfig(), engine: 'sqlite' as const, sqliteFile: ':memory:' };
const handle = createSqliteDb(':memory:');
await migrateToLatest(handle.db, 'sqlite');

const app = await buildApp(config, createServices(config, handle.db));
await app.ready();

const document = app.swagger();
writeFileSync('openapi.json', `${JSON.stringify(document, null, 2)}\n`);

await app.close();
await handle.close();

console.log('Wrote openapi.json');
