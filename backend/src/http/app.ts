import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { Ajv } from 'ajv';
import ajvFormats from 'ajv-formats';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { DB_ENGINE, type Config } from '../config.js';
import type { Services } from '../services/container.js';
import { registerAuthentication, registerErrorHandler } from './plugins.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { requirementRoutes } from './routes/requirements.js';
import { MetaSchema, SHARED_SCHEMAS } from './schemas.js';

export async function buildApp(config: Config, services: Services): Promise<FastifyInstance> {
  const app = Fastify({
    // NFR-MNT-003: one correlation id per request, present on every log line.
    genReqId: () => randomUUID(),
    logger: {
      level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(cors, {
    origin: config.corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  await app.register(cookie, { secret: config.sessionSecret });

  // TR-BE-005: the OpenAPI description is generated from the same schemas that
  // validate requests, so it cannot drift from the implementation.
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'SDDFreak Requirements API',
        description:
          'Internal API for SPEC-001 (Requirements Management System: Core). ' +
          'Internal per §2.1: documented and stable enough for the UI, with no ' +
          'third-party compatibility guarantee.',
        version: '0.1.0',
      },
      tags: [
        { name: 'auth', description: 'Accounts, sessions, passwords (§6.1, §6.2)' },

        { name: 'projects', description: 'Projects and membership (§6.4)' },
        { name: 'categories', description: 'Category hierarchy (§6.6)' },
        { name: 'tags', description: 'Tags (§6.6)' },
        { name: 'requirements', description: 'Requirement CRUD and search (§6.5, §6.7)' },
        { name: 'history', description: 'Revisions and diffs (§6.8)' },
        { name: 'admin', description: 'Administration and audit (§6.3, §6.8)' },
      ],
    },
    // Keep the shared schemas' own names in the document, so the types
    // generated for the frontend read as `Requirement` rather than `def-3`
    // (TR-STR-004).
    refResolver: {
      buildLocalReference(json, _baseUri, _fragment, i) {
        return (json.$id as string | undefined) ?? `def-${i}`;
      },
    },
  });

  for (const schema of SHARED_SCHEMAS) {
    app.addSchema(schema);
  }

  /**
   * TR-BE-006: validate at the boundary — but a query string carries every
   * value as text, while a JSON body already has real types.
   *
   * Fastify coerces both by default, which silently turns a body's `null` into
   * `""`. That matters here: `categoryId: null` means "uncategorize this"
   * (FR-ORG-006) and `parentId: null` means "make this a root", and an empty
   * string means neither. So bodies get a strict validator and everything else
   * keeps coercion.
   */
  const coercing = new Ajv({ coerceTypes: true, useDefaults: true, allErrors: false });
  const exact = new Ajv({ coerceTypes: false, useDefaults: true, allErrors: false });
  // ajv-formats ships as CommonJS, so the callable sits on `.default` under ESM.
  const formatsModule = ajvFormats as unknown as {
    default?: (ajv: Ajv) => void;
  } & ((ajv: Ajv) => void);
  const addFormats = formatsModule.default ?? formatsModule;
  for (const ajv of [coercing, exact]) {
    addFormats(ajv);
    for (const schema of SHARED_SCHEMAS) ajv.addSchema(schema);
  }

  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === 'body' ? exact : coercing).compile(schema),
  );

  registerErrorHandler(app);
  registerAuthentication(app, services);

  // NFR-MNT-004
  app.get(
    '/health',
    { schema: { tags: ['meta'], summary: 'Liveness and dependency reachability (NFR-MNT-004)' } },
    async (_request, reply) => {
      const checks: Record<string, string> = {};
      let healthy = true;

      try {
        await services.db.selectFrom('users').select('id').limit(1).execute();
        checks.database = 'ok';
      } catch {
        checks.database = 'unreachable';
        healthy = false;
      }

      return reply.status(healthy ? 200 : 503).send({
        status: healthy ? 'ok' : 'degraded',
        engine: DB_ENGINE,
        profile: config.profile,
        checks,
      });
    },
  );

  /** TR-DB-008: the running system identifies its own profile. */
  app.get(
    '/api/meta',
    { schema: { tags: ['meta'], response: { 200: MetaSchema } } },
    async () => ({
      profile: config.profile,
      isPreview: config.isPreview,
      engine: DB_ENGINE,
      spec: 'SPEC-001 v0.5',
    }),
  );

  app.get(
    '/openapi.json',
    { schema: { tags: ['meta'], response: { 200: Type.Unknown() } } },
    async () => app.swagger(),
  );

  await app.register(authRoutes(services), { prefix: '/api/auth' });
  await app.register(projectRoutes(services), { prefix: '/api/projects' });
  await app.register(requirementRoutes(services), { prefix: '/api' });
  await app.register(adminRoutes(services), { prefix: '/api/admin' });

  return app;
}
