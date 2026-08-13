# SDDFreak

A requirements management system, built to its own specification:
[`specs/001-requirements-management-core.md`](specs/001-requirements-management-core.md)
(SPEC-001 v0.4).

Requirements carry stable keys, a category hierarchy, tags, decomposition,
immutable revisions, and an append-only audit log — behind per-project roles.

## Run it locally

Two terminals, no database to install (TR-DB-001, TR-DB-002):

```bash
# 1. backend — creates and migrates its own SQLite file, then seeds it
cd backend
npm install
npm run seed        # optional, but gives you something to look at
npm run dev         # http://localhost:3000

# 2. frontend
cd frontend
npm install
npm run dev         # http://localhost:5173
```

Seeded accounts, all with the password `preview-passphrase-2026`:

| Account               | Role on `RMS` |
| --------------------- | ------------- |
| `admin@example.test`  | owner, and administrator of the installation |
| `editor@example.test` | editor        |
| `viewer@example.test` | viewer        |

### With containers

One manifest brings up both images, and a database service only where the
profile needs one (TR-STR-006):

```bash
docker compose up --build                     # local preview, SQLite → :8080
docker compose --profile postgres up --build  # deployed shape, PostgreSQL
```

For the PostgreSQL variant, set `APP_PROFILE=deployed`, `DB_ENGINE=postgres`,
and a real `SESSION_SECRET` (the backend refuses to start without one under the
deployed profile).

## Layout

The two trees are a hard boundary, not a folder convention (§8.3). Neither
imports source from the other, and the check is a test rather than a
convention:

```
backend/    Node + TypeScript, Fastify, Kysely      (TR-BE-*)
frontend/   React + TypeScript + Tailwind, Vite     (TR-FE-*)
specs/      the specification this implements
compose.yaml
```

Shared types are **generated** from the backend's OpenAPI description, never
hand-copied (TR-STR-004):

```bash
cd backend  && npm run openapi   # writes backend/openapi.json
cd frontend && npm run gen:api   # writes frontend/src/api/schema.d.ts
```

## Two database engines

The engine is chosen by configuration alone — same code, same build artifact
(TR-DB-003):

| Profile         | Engine     | For                                    |
| --------------- | ---------- | -------------------------------------- |
| `local-preview` | SQLite     | development and demonstration, one file |
| `deployed`      | PostgreSQL | anything holding data anyone cares about |

The local preview announces itself in the UI (TR-DB-008) and is exempt from the
deployed profile's TLS, encryption-at-rest, backup, and retention requirements
(§8.4.3). It must not hold real data.

Portability decisions that are painful to reverse live in §8.4.1: UUIDs as
canonical text, timestamps as ISO-8601 UTC text, booleans as 0/1, JSON as text,
and email uniqueness by lowercasing at the boundary rather than `citext`.

**Full-text search is the one accepted divergence** (TR-DB-011): FTS5 on SQLite,
`tsvector` on PostgreSQL. Whole-word matching is equivalent; relevance ordering
is explicitly not.

## Tests

```bash
cd backend
npm test         # whole suite on SQLite
npm run test:pg  # data-access suite on PostgreSQL (needs DATABASE_URL)
npm run lint
npm run typecheck
```

Tests are named for the requirements they verify (`FR-REQ-008`, `INV-06`, …) so
a failure points at a clause rather than at a function.
