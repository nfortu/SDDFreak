import { loadConfig } from '../config.js';
import { createDb } from './connection.js';
import { migrateDown, migrateToLatest } from './migrator.js';

const config = loadConfig();
const handle = createDb(config);
const direction = process.argv[2] ?? 'up';

try {
  if (direction === 'down') {
    await migrateDown(handle.db);
    console.log(`Rolled back one migration on ${config.sqliteFile}.`);
  } else {
    await migrateToLatest(handle.db);
    console.log(`Schema is up to date on ${config.sqliteFile}.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
