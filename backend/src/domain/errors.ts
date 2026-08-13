/**
 * NFR-SEC-006: what reaches the client is a code and a human message. Stack
 * traces, SQL, and internal identifiers stay on this side of the boundary.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown): AppError =>
  new AppError(400, code, message, details);

export const unauthorized = (message = 'Authentication is required'): AppError =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have permission to do that'): AppError =>
  new AppError(403, 'forbidden', message);

/**
 * FR-AUTHZ-006: a non-member must not learn that a project exists, so every
 * access denial on project-scoped data is reported as absence, not refusal.
 */
export const notFound = (message = 'Not found'): AppError =>
  new AppError(404, 'not_found', message);

export const conflict = (code: string, message: string, details?: unknown): AppError =>
  new AppError(409, code, message, details);

export const tooManyRequests = (message: string): AppError =>
  new AppError(429, 'rate_limited', message);

export const unprocessable = (code: string, message: string, details?: unknown): AppError =>
  new AppError(422, code, message, details);
