import type {
  AuditEvent,
  Category,
  Diff,
  Member,
  Meta,
  Project,
  ProjectRole,
  Requirement,
  RequirementList,
  Revision,
  Session,
  Tag,
  TreeCategory,
  User,
} from './types';

/**
 * TR-FE-007: the backend origin is read at runtime, so one built bundle serves
 * any deployment. Empty means same-origin, which is how the dev proxy and the
 * container both run.
 */
const BASE = (window as { __BACKEND_ORIGIN__?: string }).__BACKEND_ORIGIN__ ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** FR-REQ-008 / NFR-USE-007: the one error the editor handles specially. */
  get isVersionConflict(): boolean {
    return this.code === 'version_conflict';
  }
}

type Query = Record<string, string | number | boolean | string[] | null | undefined>;

function toQueryString(query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; query?: Query } = {},
): Promise<T> {
  const response = await fetch(`${BASE}${path}${toQueryString(options.query)}`, {
    method,
    // The session is a cookie (NFR-SEC-003), so every call must carry it.
    credentials: 'include',
    headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const error = (payload as { error?: { code: string; message: string; details?: unknown } })
      ?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'request_failed',
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details,
    );
  }

  return payload as T;
}

export interface RequirementFilters {
  type?: string[];
  status?: string[];
  priority?: string[];
  tag?: string[];
  categoryId?: string;
  includeDescendants?: boolean;
  uncategorized?: boolean;
  ownerId?: string;
  authorId?: string;
  q?: string;
  includeDeleted?: boolean;
  sort?: string;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export const api = {
  meta: () => request<Meta>('GET', '/api/meta'),

  // --- accounts and sessions (§6.1, §6.2) ---------------------------------
  register: (body: { email: string; password: string; displayName: string }) =>
    request<User>('POST', '/api/auth/register', { body }),
  login: (body: { email: string; password: string }) =>
    request<User>('POST', '/api/auth/login', { body }),
  logout: () => request<{ ok: boolean }>('POST', '/api/auth/logout'),
  logoutOthers: () => request<{ revoked: number }>('POST', '/api/auth/logout-others'),
  me: () => request<User>('GET', '/api/auth/me'),
  updateProfile: (body: { displayName?: string; email?: string }) =>
    request<User>('PATCH', '/api/auth/me', { body }),
  sessions: () => request<Session[]>('GET', '/api/auth/sessions'),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<{ ok: boolean; otherSessionsRevoked: number }>('POST', '/api/auth/password/change', {
      body,
    }),
  forgotPassword: (body: { email: string }) =>
    request<{ ok: boolean; previewToken?: string }>('POST', '/api/auth/password/forgot', { body }),
  resetPassword: (body: { token: string; newPassword: string }) =>
    request<{ ok: boolean }>('POST', '/api/auth/password/reset', { body }),

  // --- projects (§6.4) -----------------------------------------------------
  projects: (includeDeleted = false) =>
    request<Project[]>('GET', '/api/projects', { query: { includeDeleted } }),
  project: (id: string) => request<Project>('GET', `/api/projects/${id}`),
  createProject: (body: { key: string; name: string; description?: string | null }) =>
    request<Project>('POST', '/api/projects', { body }),
  updateProject: (id: string, body: { name?: string; description?: string | null }) =>
    request<Project>('PATCH', `/api/projects/${id}`, { body }),
  deleteProject: (id: string) => request<{ ok: boolean }>('DELETE', `/api/projects/${id}`),
  restoreProject: (id: string) => request<Project>('POST', `/api/projects/${id}/restore`),
  members: (id: string) => request<Member[]>('GET', `/api/projects/${id}/members`),
  setMemberRole: (projectId: string, userId: string, role: ProjectRole) =>
    request<Member[]>('PUT', `/api/projects/${projectId}/members/${userId}`, { body: { role } }),
  removeMember: (projectId: string, userId: string) =>
    request<{ ok: boolean }>('DELETE', `/api/projects/${projectId}/members/${userId}`),

  // --- categories and tags (§6.6) ------------------------------------------
  categories: (projectId: string) =>
    request<Category[]>('GET', `/api/projects/${projectId}/categories`),
  createCategory: (projectId: string, body: { name: string; parentId?: string | null }) =>
    request<Category>('POST', `/api/projects/${projectId}/categories`, { body }),
  updateCategory: (
    projectId: string,
    categoryId: string,
    body: { name?: string; parentId?: string | null },
  ) => request<Category>('PATCH', `/api/projects/${projectId}/categories/${categoryId}`, { body }),
  deleteCategory: (projectId: string, categoryId: string) =>
    request<{ ok: boolean }>('DELETE', `/api/projects/${projectId}/categories/${categoryId}`),
  tags: (projectId: string) => request<Tag[]>('GET', `/api/projects/${projectId}/tags`),
  renameTag: (projectId: string, tagId: string, name: string) =>
    request<Tag>('PATCH', `/api/projects/${projectId}/tags/${tagId}`, { body: { name } }),
  deleteTag: (projectId: string, tagId: string) =>
    request<{ ok: boolean }>('DELETE', `/api/projects/${projectId}/tags/${tagId}`),

  // --- requirements (§6.5, §6.7) -------------------------------------------
  requirements: (projectId: string, filters: RequirementFilters = {}) =>
    request<RequirementList>('GET', `/api/projects/${projectId}/requirements`, {
      query: filters as Query,
    }),
  requirementTree: (projectId: string) =>
    request<TreeCategory[]>('GET', `/api/projects/${projectId}/requirements/tree`),
  requirement: (id: string) => request<Requirement>('GET', `/api/requirements/${id}`),
  createRequirement: (projectId: string, body: Partial<Requirement> & { title: string }) =>
    request<Requirement>('POST', `/api/projects/${projectId}/requirements`, { body }),
  updateRequirement: (id: string, body: Partial<Requirement> & { version: number }) =>
    request<Requirement>('PATCH', `/api/requirements/${id}`, { body }),
  deleteRequirement: (id: string, cascade = false) =>
    request<{ deleted: string[] }>('DELETE', `/api/requirements/${id}`, { query: { cascade } }),
  restoreRequirement: (id: string) =>
    request<Requirement>('POST', `/api/requirements/${id}/restore`),
  duplicateRequirement: (id: string) =>
    request<Requirement>('POST', `/api/requirements/${id}/duplicate`),
  bulkUpdate: (
    projectId: string,
    requirementIds: string[],
    changes: Record<string, unknown>,
  ) =>
    request<{ updated: number }>('POST', `/api/projects/${projectId}/requirements/bulk`, {
      body: { requirementIds, changes },
    }),
  exportUrl: (projectId: string, filters: RequirementFilters, format: 'csv' | 'json') =>
    `${BASE}/api/projects/${projectId}/requirements/export${toQueryString({
      ...(filters as Query),
      format,
    })}`,

  // --- history (§6.8) -------------------------------------------------------
  revisions: (id: string) => request<Revision[]>('GET', `/api/requirements/${id}/revisions`),
  diff: (id: string, from: number, to: number) =>
    request<Diff>('GET', `/api/requirements/${id}/revisions/diff`, { query: { from, to } }),
  revert: (id: string, toVersion: number) =>
    request<Requirement>('POST', `/api/requirements/${id}/revert`, { body: { toVersion } }),

  // --- administration (§6.3, §6.8) -----------------------------------------
  adminUsers: () => request<User[]>('GET', '/api/admin/users'),
  adminAudit: (query: Record<string, string | number> = {}) =>
    request<{ items: AuditEvent[]; total: number }>('GET', '/api/admin/audit', { query }),
};
