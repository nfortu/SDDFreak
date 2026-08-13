import { loadConfig } from './config.js';
import { createDb } from './db/connection.js';
import { migrateToLatest } from './db/migrator.js';
import { buildApp } from './http/app.js';
import { createServices } from './services/container.js';
import { ConsoleMailer } from './services/mailer.js';

const config = loadConfig();
const handle = createDb(config);

/**
 * TR-DB-002: the local preview creates and migrates its own database, so a
 * clean checkout needs no setup step of its own.
 *
 * Under the deployed profile the database is a separate container that may
 * still be starting, so the first connection is retried rather than fatal.
 */
async function migrateWithRetry(attempts = 10, delayMs = 1500): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await migrateToLatest(handle.db, handle.engine);
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.warn(
        `Database not ready (attempt ${attempt}/${attempts}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

await migrateWithRetry();

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
    `SDDFreak backend ready — profile=${config.profile} engine=${config.engine}`,
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
