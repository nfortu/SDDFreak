import type { FastifyInstance, InjectOptions } from 'fastify';
import { loadConfig, type Config } from '../src/config.js';
import { createPostgresDb, createSqliteDb, type DbHandle } from '../src/db/connection.js';
import { migrateToLatest } from '../src/db/migrator.js';
import { buildApp } from '../src/http/app.js';
import { createServices, type Services } from '../src/services/container.js';
import { ConsoleMailer } from '../src/services/mailer.js';

process.env.NODE_ENV = 'test';

/**
 * TR-DB-006: the whole suite runs against SQLite by default, and the
 * data-access suite runs again with DB_ENGINE=postgres in CI. Nothing in the
 * tests knows which engine is underneath.
 */
export const TEST_ENGINE = (process.env.DB_ENGINE ?? 'sqlite') as 'sqlite' | 'postgres';

export interface TestContext {
  app: FastifyInstance;
  services: Services;
  config: Config;
  handle: DbHandle;
  close(): Promise<void>;
}

let schemaCounter = 0;

export async function createTestContext(): Promise<TestContext> {
  const base = loadConfig({
    APP_PROFILE: 'local-preview',
    DB_ENGINE: TEST_ENGINE,
    SESSION_SECRET: 'test-secret-that-is-definitely-long-enough-000000',
    CORS_ORIGIN: 'http://localhost:5173',
  });

  let handle: DbHandle;
  if (TEST_ENGINE === 'postgres') {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required to run the suite against Postgres');

    // Each context gets its own schema, so parallel suites cannot see each
    // other's rows. SQLite gets the same isolation for free from :memory:.
    const schema = `test_${process.pid}_${++schemaCounter}`;
    const admin = createPostgresDb(url);
    await admin.db.schema.createSchema(schema).ifNotExists().execute();
    await admin.close();

    const separator = url.includes('?') ? '&' : '?';
    handle = createPostgresDb(`${url}${separator}options=-c%20search_path%3D${schema}`);
  } else {
    handle = createSqliteDb(':memory:');
  }

  const config: Config = { ...base, engine: handle.engine };
  await migrateToLatest(handle.db, handle.engine);

  const services = createServices(config, handle.db, new ConsoleMailer(() => {}));
  const app = await buildApp(config, services);
  await app.ready();

  return {
    app,
    services,
    config,
    handle,
    async close() {
      await app.close();
      await handle.close();
    },
  };
}

export interface Actor {
  id: string;
  email: string;
  cookie: string;
}

let userCounter = 0;

export const STRONG_PASSWORD = 'a-perfectly-fine-passphrase-1';

/** Registers an account and logs it in, returning the session cookie to reuse. */
export async function createActor(
  ctx: TestContext,
  overrides: { email?: string; password?: string; displayName?: string } = {},
): Promise<Actor> {
  const email = overrides.email ?? `user${++userCounter}-${process.pid}@example.test`;
  const password = overrides.password ?? STRONG_PASSWORD;

  const registration = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password, displayName: overrides.displayName ?? `User ${userCounter}` },
  });

  if (registration.statusCode !== 201) {
    throw new Error(`register failed: ${registration.statusCode} ${registration.body}`);
  }

  const cookie = await loginCookie(ctx, email, password);
  return { id: registration.json().id, email, cookie };
}

export async function loginCookie(
  ctx: TestContext,
  email: string,
  password: string,
): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });

  if (response.statusCode !== 200) {
    throw new Error(`login failed: ${response.statusCode} ${response.body}`);
  }

  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
  return raw.split(';')[0]!;
}

/** Issues a request as the given actor. */
export function as(actor: Actor | string, options: InjectOptions): InjectOptions {
  const cookie = typeof actor === 'string' ? actor : actor.cookie;
  return { ...options, headers: { ...options.headers, cookie } };
}

export async function createProject(
  ctx: TestContext,
  actor: Actor,
  key: string,
  name = `${key} project`,
): Promise<{ id: string; key: string }> {
  const response = await ctx.app.inject(
    as(actor, { method: 'POST', url: '/api/projects', payload: { key, name } }),
  );
  if (response.statusCode !== 201) {
    throw new Error(`create project failed: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

export async function createRequirement(
  ctx: TestContext,
  actor: Actor,
  projectId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, never> & { id: string; key: string; version: number }> {
  const response = await ctx.app.inject(
    as(actor, {
      method: 'POST',
      url: `/api/projects/${projectId}/requirements`,
      payload: { title: 'A requirement', statement: 'The system shall do a thing.', type: 'functional', ...payload },
    }),
  );
  if (response.statusCode !== 201) {
    throw new Error(`create requirement failed: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

/** A unique uppercase project key, since keys are unique system-wide. */
let keyCounter = 0;
export function uniqueKey(prefix = 'P'): string {
  return `${prefix}${(++keyCounter).toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
}
