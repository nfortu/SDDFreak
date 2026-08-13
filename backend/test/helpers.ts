import type { FastifyInstance, InjectOptions } from 'fastify';
import { loadConfig, type Config } from '../src/config.js';
import { createSqliteDb, type DbHandle } from '../src/db/connection.js';
import { migrateToLatest } from '../src/db/migrator.js';
import { buildApp } from '../src/http/app.js';
import { createServices, type Services } from '../src/services/container.js';
import { ConsoleMailer } from '../src/services/mailer.js';

process.env.NODE_ENV = 'test';

export interface TestContext {
  app: FastifyInstance;
  services: Services;
  config: Config;
  handle: DbHandle;
  close(): Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const config = loadConfig({
    APP_PROFILE: 'local-preview',
    SESSION_SECRET: 'test-secret-that-is-definitely-long-enough-000000',
    CORS_ORIGIN: 'http://localhost:5173',
  });

  // TR-DB-006: the suite runs on the same engine the system runs on. Each
  // context gets its own :memory: database, so parallel suites cannot see each
  // other's rows.
  const handle = createSqliteDb(':memory:');
  await migrateToLatest(handle.db);

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
