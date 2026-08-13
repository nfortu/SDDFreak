import { loadConfig } from '../config.js';
import { createDb } from './connection.js';
import { migrateDown, migrateToLatest } from './migrator.js';

const config = loadConfig();
const handle = createDb(config);
const direction = process.argv[2] ?? 'up';

try {
  if (direction === 'down') {
    await migrateDown(handle.db, handle.engine);
    console.log(`Rolled back one migration on ${handle.engine}.`);
  } else {
    await migrateToLatest(handle.db, handle.engine);
    console.log(`Schema is up to date on ${handle.engine}.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
