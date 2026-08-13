import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, unauthorized } from '../domain/errors.js';
import type { User } from '../services/accounts.js';
import type { Services } from '../services/container.js';

export const SESSION_COOKIE = 'sddfreak_session';

declare module 'fastify' {
  interface FastifyRequest {
    actor?: User;
    sessionId?: string;
  }
}

export interface RequestMetaShape {
  ip: string | null;
  userAgent: string | null;
}

export function metaOf(request: FastifyRequest): RequestMetaShape {
  return {
    ip: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

/** FR-AUTH-009 */
export async function requireActor(request: FastifyRequest): Promise<User> {
  if (!request.actor) throw unauthorized();
  return request.actor;
}

interface MaybeFastifyError {
  statusCode?: number;
  validation?: unknown;
  message?: string;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((raw: unknown, request, reply) => {
    const error = raw as MaybeFastifyError;

    if (raw instanceof AppError) {
      return reply.status(raw.status).send({
        error: { code: raw.code, message: raw.message, details: raw.details },
      });
    }
    // Fastify's own schema validation (TR-BE-006) rejects at the boundary.
    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: 'invalid_request',
          message: 'The request did not match the expected shape.',
          details: error.validation,
        },
      });
    }

    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      // NFR-SEC-006: the detail stays in the log, not in the response.
      return reply
        .status(500)
        .send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
    }

    return reply
      .status(status)
      .send({ error: { code: 'request_failed', message: error.message } });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } });
  });
}

/**
 * Resolves the session on every request (FR-AUTH-002 to FR-AUTH-004) and
 * enforces the CSRF check of NFR-SEC-004.
 *
 * The cookie is SameSite=Lax, which already blocks cross-site form posts; the
 * Origin comparison covers the rest and costs nothing.
 */
export function registerAuthentication(app: FastifyInstance, services: Services): void {
  const allowedOrigins = new Set(
    services.config.corsOrigin
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const method = request.method.toUpperCase();
    const isStateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(method);

    if (isStateChanging) {
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        return reply.status(403).send({
          error: {
            code: 'cross_origin_blocked',
            message: 'This request did not come from an allowed origin.',
          },
        });
      }
    }

    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;

    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;

    const session = await services.auth.authenticate(unsigned.value);
    if (!session) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return;
    }

    request.actor = session.user;
    request.sessionId = session.sessionId;
  });
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  secure: boolean,
): void {
  // NFR-SEC-003
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    signed: true,
    path: '/',
    maxAge: 24 * 60 * 60,
  });
}
