import { DB_ENGINE, loadConfig } from './config.js';
import { createDb } from './db/connection.js';
import { migrateToLatest } from './db/migrator.js';
import { buildApp } from './http/app.js';
import { createServices } from './services/container.js';
import { ConsoleMailer } from './services/mailer.js';

const config = loadConfig();
const handle = createDb(config);

/**
 * TR-DB-002: the system creates and migrates its own database, so a clean
 * checkout needs no setup step of its own. The file is local and opened by
 * this process (TR-DB-001), so there is no service to wait for — a failure
 * here is a real failure and stops startup.
 */
await migrateToLatest(handle.db);

const services = createServices(config, handle.db, new ConsoleMailer());
const app = await buildApp(config, services);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await handle.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `SDDFreak backend ready — profile=${config.profile} engine=${DB_ENGINE} db=${config.sqliteFile}`,
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
