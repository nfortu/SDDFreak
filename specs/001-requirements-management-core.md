# SPEC-001 — Requirements Management System: Core

- **Status:** draft
- **Version:** 0.6
- **Created:** 2026-08-12
- **Last updated:** 2026-08-20
- **Supersedes:** —
- **Blocking questions:** none. One open item (Q17, team size / delivery date) affects sequencing only, not content.

---

## 1. Purpose

Define the first increment of a system for capturing and maintaining software
requirements. This increment delivers the foundation everything else builds on:
authenticated users, and the ability to create, read, update, delete, organize,
and categorize requirements.

The system is itself a requirements-driven product, so it must hold its own
specification without special-casing.

## 2. Scope

### 2.1 Product shape (decided — Q1, Q2)

A **self-hosted web application**, single-tenant, serving a browser UI over a
documented internal HTTP API. One deployment serves one organization, and is
operable by a single administrator.

The HTTP API is internal: it is documented and stable enough for the UI to be
built against it, but it carries no third-party compatibility guarantee in this
increment.

### 2.2 In scope

- User accounts and authentication (§6.1, §6.2)
- Authorization by role, at the project level (§6.3)
- Projects as the container for requirements (§6.4)
- Full CRUD over requirements (§6.5)
- Organization: category hierarchy, tags, parent/child decomposition (§6.6)
- Listing, filtering, and search (§6.7)
- Change history and audit trail (§6.8)

### 2.3 Out of scope (deferred to later specs)

- **Performance and capacity targets** — no timing budget, no load target, no
  corpus-size target is committed in this increment (decided, Q14; see §7.1)
- **Approval workflow** — reviewers, sign-off, rejection with comments (decided, Q11)
- **Data import from external tools** — there is no incumbent tool and no
  existing corpus to migrate (decided, Q15)
- **A second database engine** — SQLite is the sole system of record for this
  development phase; PostgreSQL support is deferred to a later spec (decided,
  Q18 as revised; see §8.4)
- Traceability links between requirements and code, tests, or issues
- Baselines and versioned snapshots of a whole project
- Formal document export (PDF/DOCX) and templating
- Comments, discussion threads, notifications
- Attachments (diagrams, mockups)
- Moving a requirement between projects
- Real-time collaborative editing
- SSO / SAML / OIDC, multi-factor authentication
- A public, versioned third-party API
- Multi-tenancy

## 3. Glossary

| Term | Definition |
| ---- | ---------- |
| **Requirement** | A single, atomic statement of something the system under specification must do or must be true of it. |
| **Project** | A named container owning a set of requirements, categories, and tags. The unit of access control. |
| **Category** | A node in a per-project hierarchical taxonomy. A requirement belongs to at most one. |
| **Tag** | A flat, per-project label. A requirement may carry many. |
| **Requirement key** | The human-readable, permanent identifier of a requirement within its project (e.g. `AUTH-14`). |
| **Revision** | An immutable snapshot of a requirement's content taken after a change. |
| **Member** | A user holding a role on a project. |
| **Actor** | The authenticated user on whose behalf a request is made. |

## 4. Domain model

### 4.1 Entity relationships

```
User ──< Session
  │
  └──< Membership >── Project ──< Category ──┐ (self-referencing tree)
                         │  │                │
                         │  └──< Tag         │
                         │         ╲         │
                         └──< Requirement ───┘
                                 │  │
                                 │  └── parent Requirement (self-referencing)
                                 └──< Revision

AuditEvent ── (actor: User, optional target: any entity)
```

### 4.2 User

| Attribute | Type | Constraints |
| --------- | ---- | ----------- |
| `id` | UUID | PK, immutable |
| `email` | string ≤ 254 | unique, case-insensitive, valid address |
| `password_hash` | string | Argon2id or bcrypt cost ≥ 12; never exposed |
| `display_name` | string 1–100 | |
| `is_administrator` | boolean | default `false` |
| `is_active` | boolean | default `true`; `false` denies authentication |
| `failed_login_count` | integer | default 0, reset on success |
| `locked_until` | timestamp | null when not locked |
| `created_at`, `updated_at` | timestamp | |
| `anonymized_at` | timestamp | set on erasure (NFR-CMP-002); `email` and `display_name` replaced with a placeholder |

### 4.3 Session

| Attribute | Type | Constraints |
| --------- | ---- | ----------- |
| `id` | UUID | PK |
| `user_id` | UUID | FK → User |
| `token_hash` | string | hash of the session credential; the credential itself is never stored |
| `created_at` | timestamp | |
| `last_seen_at` | timestamp | drives the idle timeout |
| `absolute_expires_at` | timestamp | `created_at` + 24 h |
| `revoked_at` | timestamp | null while active |
| `user_agent`, `ip` | string | recorded for the session list |

A password reset token is modelled the same way: single-use, hashed, with an
expiry and a `used_at`.

### 4.4 Project

| Attribute | Type | Constraints |
| --------- | ---- | ----------- |
| `id` | UUID | PK |
| `key` | string 2–8 | unique system-wide, `^[A-Z][A-Z0-9]{1,7}$`, immutable after creation |
| `name` | string 1–100 | |
| `description` | text | optional |
| `next_requirement_number` | integer | monotonic, never decremented — the source of key uniqueness |
| `created_at`, `created_by`, `updated_at`, `updated_by` | | |
| `deleted_at` | timestamp | soft delete, purgeable after 30 days |

### 4.5 Membership

| Attribute | Type | Constraints |
| --------- | ---- | ----------- |
| `id` | UUID | PK |
| `project_id` | UUID | FK → Project |
| `user_id` | UUID | FK → User |
| `role` | enum | `owner` \| `editor` \| `viewer` |
| `created_at`, `created_by` | | |

Unique on (`project_id`, `user_id`) — a user holds exactly one role per project.

### 4.6 Category

| Attribute | Type | Constraints |
| --------- | ---- | ----------- |
| `id` | UUID | PK |
| `project_id` | UUID | FK → Project, immutable |
| `parent_id` | UUID | FK → Category, null at root, same project |
| `name` | string 1–100 | unique among siblings |
| `sort_order` | integer | position among siblings |
| `created_at`, `created_by`, `updated_at`, `updated_by` | | |

### 4.7 Tag

| Attribute | Type | Constraints |
| --------- | ---- | ----------- |
| `id` | UUID | PK |
| `project_id` | UUID | FK → Project |
| `name` | string 1–50 | lowercase, trimmed, unique within project |

Join table `requirement_tag` (`requirement_id`, `tag_id`), unique on the pair.

### 4.8 Requirement

| Attribute | Type | Req'd | Constraints |
| --------- | ---- | ----- | ----------- |
| `id` | UUID | yes | PK, immutable |
| `key` | string | yes | `<PROJECT_KEY>-<N>`, unique, immutable, never reused |
| `project_id` | UUID | yes | FK → Project, immutable |
| `title` | string 1–200 | yes | |
| `statement` | text 1–10 000 | yes | Markdown without raw HTML (Q8) |
| `rationale` | text ≤ 10 000 | no | Markdown without raw HTML |
| `type` | enum | yes | `functional` \| `non_functional` \| `technical` \| `constraint` \| `business` |
| `priority` | enum | yes | `must` \| `should` \| `could` \| `wont`; default `should` |
| `status` | enum | yes | `draft` \| `proposed` \| `approved` \| `implemented` \| `verified` \| `rejected` \| `obsolete`; default `draft` |
| `acceptance_criteria` | text ≤ 10 000 | conditional | Required to reach `approved` (FR-REQ-010) |
| `source` | string ≤ 200 | no | Originating stakeholder or document |
| `owner_id` | UUID | no | FK → User; must be a member of the project |
| `category_id` | UUID | no | FK → Category, same project; at most one (Q7) |
| `parent_id` | UUID | no | FK → Requirement, same project, acyclic |
| `sort_order` | integer | yes | position among siblings within its category |
| `version` | integer | yes | starts at 1, +1 per content change |
| `created_at`, `created_by`, `updated_at`, `updated_by` | | yes | |
| `deleted_at` | timestamp | no | soft delete, purgeable after 30 days |

### 4.9 Revision

| Attribute | Type | Constraints |
| --------- | ---- | ----------- |
| `id` | UUID | PK |
| `requirement_id` | UUID | FK → Requirement |
| `version` | integer | unique with `requirement_id` |
| `snapshot` | JSON | complete attribute set *after* the change |
| `changed_by` | UUID | FK → User |
| `changed_at` | timestamp | |
| `change_kind` | enum | `created` \| `updated` \| `deleted` \| `restored` \| `reverted` |

Immutable once written.

### 4.10 AuditEvent

| Attribute | Type | Constraints |
| --------- | ---- | ----------- |
| `id` | UUID | PK |
| `occurred_at` | timestamp | |
| `actor_user_id` | UUID | null for failed logins with an unknown email |
| `event_type` | enum | `login_succeeded`, `login_failed`, `account_locked`, `logout`, `password_changed`, `password_reset`, `authorization_denied`, `membership_granted`, `membership_changed`, `membership_revoked`, `project_created`, `project_deleted`, `admin_access_granted`, `account_deactivated` |
| `project_id` | UUID | when project-scoped |
| `target_type`, `target_id` | string, UUID | the affected entity |
| `ip`, `user_agent` | string | |
| `metadata` | JSON | event-specific detail |

Append-only. No update or delete path exists in any interface.

### 4.11 Invariants

| ID | Invariant |
| -- | --------- |
| **INV-01** | Every project has at least one `owner` membership. |
| **INV-02** | A requirement's `key` never changes and is never reused within its project, including after purge. |
| **INV-03** | A category's ancestor chain is acyclic and at most 5 levels deep. |
| **INV-04** | A requirement's parent chain is acyclic. |
| **INV-05** | A requirement's `category_id` and `parent_id` reference entities in the same project. |
| **INV-06** | `version` equals the count of revisions for that requirement. |
| **INV-07** | A requirement whose `status` is `approved` or later has a non-empty `acceptance_criteria`. |
| **INV-08** | A revision, once written, is never modified or deleted. |
| **INV-09** | An audit event, once written, is never modified or deleted. |
| **INV-10** | Soft-deleted entities are excluded from every default query path. |

### 4.12 Requirement status transitions

```
draft ⇄ proposed ⇄ approved → implemented → verified
                                    │            │
                                    └────────────┴──→ (back to draft)

any non-terminal status → rejected | obsolete    (terminal)
```

Any `editor` may perform any permitted transition — there is no reviewer gate
in this increment (Q11).

## 5. Verification legend

Each requirement below carries a verification method:

| Code | Method |
| ---- | ------ |
| **T** | Automated test |
| **D** | Demonstration against a running system |
| **A** | Analysis or measurement |
| **I** | Inspection or review |

## 6. Functional requirements

### 6.1 Accounts

| ID | Requirement | V |
| -- | ----------- | - |
| **FR-ACC-001** | The system shall allow a person to register an account with an email address, a password, and a display name. | T |
| **FR-ACC-002** | The system shall reject a registration whose email address is already registered. | T |
| **FR-ACC-003** | The system shall reject a password shorter than 12 characters. | T |
| **FR-ACC-004** | The system shall reject a password that appears in a known-breached-password list. | T |
| **FR-ACC-005** | The system shall store passwords only as salted hashes produced by Argon2id or by bcrypt at cost 12 or higher. | I |
| **FR-ACC-006** | The system shall allow an authenticated user to change their own password, requiring the current password. | T |
| **FR-ACC-007** | The system shall allow a user to request a password reset, delivering a single-use token valid for 60 minutes to the registered email address. | T |
| **FR-ACC-008** | The system shall revoke all of a user's sessions other than the acting one when that user's password is changed or reset. | T |
| **FR-ACC-009** | The system shall allow an authenticated user to view and update their own display name and email address. | T |
| **FR-ACC-010** | The system shall allow an administrator to deactivate and reactivate an account. | T |
| **FR-ACC-011** | The system shall retain the authored content and authorship attribution of a deactivated account. | T |

### 6.2 Authentication

| ID | Requirement | V |
| -- | ----------- | - |
| **FR-AUTH-001** | The system shall authenticate a user presenting a registered email address and its matching password, when the account is active. | T |
| **FR-AUTH-002** | The system shall issue a session credential on successful authentication that identifies the user on subsequent requests. | T |
| **FR-AUTH-003** | The system shall reject a session credential more than 24 hours old. | T |
| **FR-AUTH-004** | The system shall reject a session credential unused for more than 2 hours. | T |
| **FR-AUTH-005** | The system shall allow a user to terminate the current session, and to terminate all of their other sessions. | T |
| **FR-AUTH-006** | The system shall list a user's active sessions with their creation time, last-seen time, and originating address. | T |
| **FR-AUTH-007** | The system shall lock an account for 15 minutes after 5 consecutive failed authentication attempts within 15 minutes. | T |
| **FR-AUTH-008** | The system shall return an identical response and an indistinguishable response time for an unknown email address, a wrong password, and a locked or deactivated account. | T |
| **FR-AUTH-009** | The system shall deny any request to a non-public resource that does not carry a valid session credential. | T |

*Rationale for FR-AUTH-008: registration (FR-ACC-002) necessarily reveals that
an address is taken. Account enumeration is therefore accepted at registration
and prevented at the authentication and reset endpoints, which are the ones
exposed to untrusted bulk probing (see NFR-SEC-008).*

### 6.3 Authorization

| ID | Requirement | V |
| -- | ----------- | - |
| **FR-AUTHZ-001** | The system shall support exactly the project roles `owner`, `editor`, and `viewer`, and the system role `administrator`. | I |
| **FR-AUTHZ-002** | A `viewer` shall be able to read the project's requirements, categories, tags, and revision history. | T |
| **FR-AUTHZ-003** | A `viewer` shall be denied every operation that creates, modifies, or deletes project content. | T |
| **FR-AUTHZ-004** | An `editor` shall hold every `viewer` permission, and shall additionally be able to create, update, and delete requirements, categories, and tags. | T |
| **FR-AUTHZ-005** | An `owner` shall hold every `editor` permission, and shall additionally be able to manage membership, rename the project, delete the project, and purge soft-deleted content. | T |
| **FR-AUTHZ-006** | The system shall deny a user holding no membership on a project every operation on that project and its contents, and shall not disclose the project's existence. | T |
| **FR-AUTHZ-007** | An administrator shall be able to manage accounts and to grant themselves a membership on any project. | T |
| **FR-AUTHZ-008** | The system shall record an `admin_access_granted` audit event whenever an administrator grants themselves access to a project they were not a member of. | T |
| **FR-AUTHZ-009** | The system shall reject any membership change that would leave a project without an `owner`. | T |
| **FR-AUTHZ-010** | The system shall enforce every authorization rule server-side, independently of what the client requested or displayed. | I |

### 6.4 Projects

| ID | Requirement | V |
| -- | ----------- | - |
| **FR-PRJ-001** | The system shall allow any authenticated user to create a project with a key, a name, and an optional description. | T |
| **FR-PRJ-002** | The system shall grant the creator of a project the `owner` role on it. | T |
| **FR-PRJ-003** | The system shall require a project key matching `^[A-Z][A-Z0-9]{1,7}$` and unique across the system. | T |
| **FR-PRJ-004** | The system shall reject any attempt to change a project's key after creation. | T |
| **FR-PRJ-005** | The system shall list to a user exactly those projects on which they hold a membership. | T |
| **FR-PRJ-006** | The system shall allow an `owner` to add a user to the project with a role, to change a member's role, and to remove a member. | T |
| **FR-PRJ-007** | The system shall allow an `owner` to soft-delete a project, hiding it and its contents from all listings. | T |
| **FR-PRJ-008** | The system shall allow an `owner` to restore a soft-deleted project within 30 days of its deletion. | T |

### 6.5 Requirement CRUD

| ID | Requirement | V |
| -- | ----------- | - |
| **FR-REQ-001** | The system shall allow an `editor` to create a requirement supplying at minimum a title, a statement, and a type. | T |
| **FR-REQ-002** | The system shall assign each new requirement the key `<PROJECT_KEY>-<N>`, where `N` is the project's `next_requirement_number`, and shall then increment that number. | T |
| **FR-REQ-003** | The system shall never reuse or reassign a requirement key, including after the requirement is purged. | T |
| **FR-REQ-004** | The system shall set a new requirement's status to `draft`, its priority to `should`, and its version to 1 when these are not supplied. | T |
| **FR-REQ-005** | The system shall return, for a user with read access, a single requirement with every attribute of §4.8. | T |
| **FR-REQ-006** | The system shall allow an `editor` to update any attribute of a requirement other than `id`, `key`, `project_id`, `version`, and the audit attributes. | T |
| **FR-REQ-007** | The system shall increment `version` and write a revision on every update that changes at least one stored attribute. | T |
| **FR-REQ-008** | The system shall make no change and shall report a conflict when an update supplies a `version` other than the stored one. | T |
| **FR-REQ-009** | The system shall reject a status transition not permitted by §4.12. | T |
| **FR-REQ-010** | The system shall reject a transition to `approved` when `acceptance_criteria` is empty. | T |
| **FR-REQ-011** | The system shall allow an `editor` to soft-delete a requirement, removing it from default listings while preserving its revisions. | T |
| **FR-REQ-012** | The system shall reject the deletion of a requirement having children, unless the request explicitly confirms deletion of the whole subtree. | T |
| **FR-REQ-013** | The system shall allow an `editor` to restore a soft-deleted requirement within 30 days, retaining its original key. | T |
| **FR-REQ-014** | The system shall allow a project `owner` to permanently purge a requirement that has been soft-deleted for more than 30 days. | T |
| **FR-REQ-015** | The system shall allow an `editor` to duplicate a requirement, producing a new requirement in status `draft` with a new key and no revision history. | T |
| **FR-REQ-016** | The system shall validate every attribute against the constraints of §4.8 and shall reject an invalid create or update in full, applying no partial change. | T |

### 6.6 Organization and categorization

| ID | Requirement | V |
| -- | ----------- | - |
| **FR-ORG-001** | The system shall allow an `editor` to create, rename, move, and delete categories within a project. | T |
| **FR-ORG-002** | The system shall support category nesting to a depth of at least 5 levels, and shall reject a create or move exceeding that depth. | T |
| **FR-ORG-003** | The system shall reject a category move that would place a category within its own subtree. | T |
| **FR-ORG-004** | The system shall reject a category name that duplicates a sibling's name. | T |
| **FR-ORG-005** | On deletion of a category, the system shall reassign its child categories and its requirements to that category's parent, or leave them uncategorized when it was a root. | T |
| **FR-ORG-006** | The system shall allow a requirement to be assigned to at most one category, and to be left uncategorized. | T |
| **FR-ORG-007** | The system shall allow an `editor` to reorder sibling categories, and shall preserve that order in every listing. | T |
| **FR-ORG-008** | The system shall allow an `editor` to attach tags to and detach tags from a requirement, with no limit below 50 tags per requirement. | T |
| **FR-ORG-009** | The system shall normalize a tag name by trimming whitespace and lowercasing it, and shall reuse the existing tag when the normalized name already exists in the project. | T |
| **FR-ORG-010** | The system shall offer the project's existing tags as suggestions while a tag is being entered. | D |
| **FR-ORG-011** | The system shall allow an `editor` to rename a tag across the project, and to delete a tag, detaching it from every requirement. | T |
| **FR-ORG-012** | The system shall allow an `editor` to set a requirement's parent to another requirement in the same project, expressing decomposition. | T |
| **FR-ORG-013** | The system shall reject a parent assignment that would create a cycle. | T |
| **FR-ORG-014** | The system shall allow an `editor` to reorder sibling requirements within a category, and shall preserve that order in every listing. | T |
| **FR-ORG-015** | The system shall allow an `editor` to set the category, tags, status, priority, or owner of a selected set of requirements in one operation, applying the change to all of them or to none. | T |

### 6.7 Listing, filtering, and search

| ID | Requirement | V |
| -- | ----------- | - |
| **FR-SRCH-001** | The system shall return the requirements of a project in pages of a caller-specified size, defaulting to 50 and capped at 200, reporting the total match count. | T |
| **FR-SRCH-002** | The system shall filter the list by any combination of type, status, priority, category, tag, owner, and author. | T |
| **FR-SRCH-003** | The system shall support filtering by a category either alone or together with all of its descendants, at the caller's choice. | T |
| **FR-SRCH-004** | The system shall sort the list by key, title, status, priority, creation time, or last-update time, ascending or descending. | T |
| **FR-SRCH-005** | The system shall provide full-text search over `title`, `statement`, and `rationale`. | T |
| **FR-SRCH-006** | The system shall restrict every search and listing result to projects on which the actor holds a membership. | T |
| **FR-SRCH-007** | The system shall return requirements as a tree reflecting the category hierarchy and, within it, the parent–child decomposition. | T |
| **FR-SRCH-008** | The system shall exclude soft-deleted requirements from listings and search unless the caller explicitly requests them. | T |
| **FR-SRCH-009** | The system shall export the current filtered result set as CSV and as JSON. | T |
| **FR-SRCH-010** | The user interface shall carry the active filters, sort, and search term in the URL, so that a filtered view can be shared and restored by that URL alone. | D |

### 6.8 History and audit

| ID | Requirement | V |
| -- | ----------- | - |
| **FR-AUD-001** | The system shall write an immutable revision on each change to a requirement, capturing the complete attribute set after the change, the acting user, and the timestamp. | T |
| **FR-AUD-002** | The system shall return the revision history of a requirement in reverse chronological order. | T |
| **FR-AUD-003** | The system shall report the field-level differences between any two revisions of a requirement. | T |
| **FR-AUD-004** | The system shall allow an `editor` to revert a requirement's content to an earlier revision, recording the reversion as a new revision rather than by rewriting history. | T |
| **FR-AUD-005** | The system shall write an audit event for each event type listed in §4.10. | T |
| **FR-AUD-006** | The system shall expose no interface through which an audit event or a revision can be modified or deleted. | I |
| **FR-AUD-007** | The system shall allow an administrator to read and filter the audit log by actor, event type, project, and time range. | T |

## 7. Non-functional requirements

### 7.1 Performance and capacity — deferred (decided, Q14)

**No performance, load, or capacity target is committed in this increment.**
There is no stated user population to derive one from, and inventing numbers
would create commitments nobody has agreed to and load tests nobody can
interpret.

Consequences, stated so the deferral is a decision rather than an oversight:

- No response-time budget applies. Slowness is a defect only when a user
  reports it as one.
- No load test gates this increment.
- Optimization work is out of scope unless it fixes an observed problem.

Two structural requirements survive, because they are cheap now and expensive
to retrofit. Neither commits to a number.

| ID | Requirement | V |
| -- | ----------- | - |
| **NFR-PERF-101** | Every endpoint returning a collection shall be paginated, with no unbounded result set reachable through any interface. | I |
| **NFR-PERF-102** | Every query supporting a filter or sort in §6.7 shall be backed by an index covering that access path. | I |

A successor spec sets real targets once the user population is known. Until
then, §12 records nothing about performance.

### 7.2 Scalability

| ID | Requirement | V |
| -- | ----------- | - |
| **NFR-SCAL-003** | The application tier shall hold no per-user state in process, so that a second instance can be added without changing application code. | I |

*Capacity targets are deferred with §7.1. NFR-SCAL-003 is retained as an
architectural constraint, not a performance claim.*

### 7.3 Availability and durability

| ID | Requirement | V |
| -- | ----------- | - |
| **NFR-AVL-002** | Requirement, revision, and audit data shall be backed up at least daily, with a recovery point objective of 24 hours and a recovery time objective of 4 hours. | I |
| **NFR-AVL-003** | Backup restoration shall be exercised and verified at least quarterly. | D |
| **NFR-AVL-004** | No acknowledged write shall be lost on the failure of a single node. | D |

*No uptime percentage is committed; it is deferred with §7.1. Durability is
kept, because data loss is not a performance concern — a requirements corpus is
often the only record of a decision.*

### 7.4 Security

| ID | Requirement | V |
| -- | ----------- | - |
| **NFR-SEC-001** | All client traffic shall use TLS 1.2 or higher; plaintext HTTP shall be redirected and never served content. | I |
| **NFR-SEC-002** | Data shall be encrypted at rest. | I |
| **NFR-SEC-003** | Session credentials shall be delivered as `HttpOnly`, `Secure`, `SameSite=Lax` cookies, or by an equivalent mechanism unreadable by client-side script. | I |
| **NFR-SEC-004** | State-changing requests shall be protected against cross-site request forgery. | T |
| **NFR-SEC-005** | User-supplied Markdown shall be rendered with raw HTML and script stripped. | T |
| **NFR-SEC-006** | Error responses shall disclose no stack trace, query text, or internal identifier to a client. | T |
| **NFR-SEC-007** | The application shall be reviewed against the OWASP Top 10 before each release. | I |
| **NFR-SEC-008** | Authentication, registration, and password-reset endpoints shall be rate-limited per source address and per account. | T |
| **NFR-SEC-009** | Dependencies shall be scanned for known vulnerabilities on every build, and no release shall ship with a known unpatched critical vulnerability. | I |

### 7.5 Usability and accessibility

| ID | Requirement | V |
| -- | ----------- | - |
| **NFR-USE-001** | The user interface shall conform to WCAG 2.1 Level AA. | I |
| **NFR-USE-002** | Every function reachable by pointer shall be reachable by keyboard alone. | D |
| **NFR-USE-003** | In a moderated test of 5 participants who have not used the system before, at least 4 shall create their first requirement within 3 minutes without consulting documentation. | D |
| **NFR-USE-004** | The interface shall be usable at viewport widths from 360 px upward. | D |
| **NFR-USE-005** | A validation error shall identify the offending field and state how to correct it. | D |
| **NFR-USE-006** | Unsaved edits shall survive an accidental navigation away from an edit form. | D |
| **NFR-USE-007** | A version conflict (FR-REQ-008) shall be presented to the user with both versions and without discarding their unsaved input. | D |
| **NFR-USE-008** | Secondary controls that are not needed to read the list — the type, status, and priority facets of FR-SRCH-002 — shall be presented in a collapsible section, collapsed on first view, so the default view is not cluttered by them. The section's whole header shall act as the expand/collapse control, and shall carry a right-aligned indicator of its current state. | D |
| **NFR-USE-009** | While such a section is collapsed, the interface shall state how many filters inside it are active and offer a single control that clears them. A view opened from a URL that already carries those filters (FR-SRCH-010) shall show the section expanded. | D |

### 7.6 Maintainability and observability

| ID | Requirement | V |
| -- | ----------- | - |
| **NFR-MNT-001** | Automated tests shall cover at least 80 % of the business-logic layer by line. | A |
| **NFR-MNT-002** | Every requirement in §6 marked **T** shall map to at least one named automated test. | I |
| **NFR-MNT-003** | The system shall emit structured logs carrying a correlation identifier that spans a single request. | I |
| **NFR-MNT-004** | The system shall expose a health endpoint reporting liveness and the reachability of each dependency. | T |
| **NFR-MNT-005** | The system shall emit request-rate, error-rate, and latency-distribution metrics per endpoint. | D |
| **NFR-MNT-006** | Database schema changes shall be applied by versioned, reversible migrations. | I |

*NFR-MNT-005 asks only that the metrics exist. No threshold is set on them —
see §7.1.*

### 7.7 Compliance and data protection

| ID | Requirement | V |
| -- | ----------- | - |
| **NFR-CMP-001** | The system shall export, on request, all personal data held about a user in a machine-readable format. | T |
| **NFR-CMP-002** | The system shall erase a user's personal data on request, replacing authorship references with an anonymized placeholder while retaining requirement and revision content. | T |
| **NFR-CMP-003** | Audit events shall be retained for at least 12 months. | I |

## 8. Technical requirements (decided, Q16)

Requirements on the implementation itself, as distinct from what the system
does (§6) or how well it does it (§7).

### 8.1 Backend

| ID | Requirement | V |
| -- | ----------- | - |
| **TR-BE-001** | The backend shall be implemented in TypeScript running on Node.js, on a release line under active long-term support. | I |
| **TR-BE-002** | The backend TypeScript configuration shall enable `strict`, and the build shall fail on a type error. | I |
| **TR-BE-003** | The backend shall expose its functionality solely as an HTTP API exchanging JSON. | I |
| **TR-BE-004** | The backend shall be the sole writer to the database; no other component shall hold database credentials. | I |
| **TR-BE-005** | The backend shall publish a machine-readable OpenAPI description of its API, verified against the implementation in CI. | T |
| **TR-BE-006** | The backend shall validate every request body and query parameter against a schema at the boundary, before it reaches business logic. | T |
| **TR-BE-007** | The backend shall run without a browser and shall be fully exercisable by its automated test suite alone. | I |

### 8.2 Frontend

| ID | Requirement | V |
| -- | ----------- | - |
| **TR-FE-001** | The frontend shall be implemented in TypeScript with React. | I |
| **TR-FE-002** | The frontend TypeScript configuration shall enable `strict`, and the build shall fail on a type error. | I |
| **TR-FE-003** | The frontend shall use Tailwind CSS for styling, and shall introduce no second styling framework. | I |
| **TR-FE-004** | The frontend shall obtain and modify all data exclusively through the backend HTTP API of §8.1. | I |
| **TR-FE-005** | The frontend shall build to static assets servable by any static file server, requiring no server-side rendering. | D |
| **TR-FE-006** | The frontend shall treat every authorization decision as advisory, using it only to shape the interface, never as enforcement (see FR-AUTHZ-010). | I |
| **TR-FE-007** | The backend origin shall be configurable at deployment time without rebuilding the frontend. | D |

### 8.3 Source layout and boundary

| ID | Requirement | V |
| -- | ----------- | - |
| **TR-STR-001** | The backend and the frontend shall live in separate top-level source trees, `backend/` and `frontend/`. | I |
| **TR-STR-002** | Each tree shall carry its own dependency manifest, lockfile, test suite, linter configuration, and build script, and shall build without reference to the other. | I |
| **TR-STR-003** | Neither tree shall import source files from the other. | T |
| **TR-STR-004** | Types shared across the boundary shall be generated from the OpenAPI description of TR-BE-005, and the generated output shall be reproducible from a committed command. | T |
| **TR-STR-005** | Each tree shall produce its own container image. | I |
| **TR-STR-006** | The two images shall be brought up by a single committed compose manifest (CON-002), requiring no separate database service (§8.4). | D |
| **TR-STR-007** | Either tree shall be replaceable by a different implementation satisfying the same API contract, without changes to the other. | I |

*Rationale for §8.3: the separation is a hard boundary, not a folder
convention. TR-STR-003 and TR-STR-004 are what keep it from eroding into a
shared-code monolith the first time a type is convenient to reuse.*

### 8.4 Database and environment profiles (decided, Q18 as revised 2026-08-13)

**SQLite is the sole database engine.** For this development phase the system
runs on one engine and one engine only; PostgreSQL support is deferred to a
later spec (§2.3).

The backend still runs under two environment profiles. They no longer differ in
what stores the data — both are SQLite — but in whether the installation is
permitted to hold data anyone cares about, which is what §8.4.3 turns on.

| Profile | Purpose |
| ------- | ------- |
| **local preview** | Development and demonstration on a single machine, with no external service to install or run |
| **deployed** | Any installation holding data anyone cares about |

| ID | Requirement | V |
| -- | ----------- | - |
| **TR-DB-001** | The backend's system of record shall be a single SQLite database file, requiring no external database service under either profile. | D |
| **TR-DB-002** | The local preview profile shall bring up a working system from a clean checkout with one documented command, creating and migrating its database automatically. | D |
| **TR-DB-003** | *Withdrawn (§8.4.4).* | — |
| **TR-DB-004** | The backend shall reach the database only through a data-access layer, and no SQL shall appear outside that layer. | I |
| **TR-DB-005** | Every migration (NFR-MNT-006) shall be applied from a single committed migration source. | T |
| **TR-DB-006** | The full automated test suite shall pass against SQLite in CI. | T |
| **TR-DB-007** | The local preview profile shall load a committed seed dataset on request, yielding a populated system suitable for demonstration. | D |
| **TR-DB-008** | A system running under the local preview profile shall identify itself as such in its interface, so it cannot be mistaken for a deployed installation. | D |
| **TR-DB-009** | The backend shall enable foreign-key enforcement on every SQLite connection, so that referential integrity is enforced by the database rather than by application code. | T |
| **TR-DB-010** | The backend shall open SQLite in WAL mode with a busy timeout, so that a concurrent reader is never served a locking error. | T |
| **TR-DB-014** | The database file location shall be selected by deployment configuration alone — no code change, no conditional compilation, no separate build artifact. | I |
| **TR-DB-015** | SQLite-specific SQL shall be confined to the data-access layer of TR-DB-004, so that adding a second engine later touches no business logic. | I |

*TR-DB-015 and §8.4.1 are the whole of what remains of the two-engine design:
the portability work already done is kept, because it costs nothing to hold and
is what makes the deferred PostgreSQL spec cheap to pick up. What is gone is
the obligation to run, test, and operate a second engine now.*

#### 8.4.1 Storage representations chosen for portability

Chosen so that no value depends on a type only SQLite has, and none would have
to be rewritten to move the corpus to another engine. These bind the physical
representation only; §4 remains the domain model.

| Concept | Representation | Reason |
| ------- | -------------- | ------ |
| UUID | canonical lowercase hyphenated text | SQLite has no UUID type; text keeps values identical across a dump and restore, and is accepted verbatim by every engine |
| Timestamp | ISO-8601 UTC string, millisecond precision | SQLite has no date type; UTC text sorts chronologically and removes timezone handling from the storage layer |
| Boolean | integer 0/1 in storage, boolean in the domain | SQLite has no boolean type |
| JSON (`snapshot`, `metadata`) | text containing JSON, parsed in the data-access layer | avoids depending on `jsonb` operators SQLite cannot express |
| Email uniqueness | lowercased at the boundary before write, plain unique index | removes reliance on `citext` and `COLLATE NOCASE`, whose semantics are engine-specific |

#### 8.4.2 Full-text search

| ID | Requirement | V |
| -- | ----------- | - |
| **TR-DB-011** | Full-text search (FR-SRCH-005) shall be implemented with SQLite FTS5. | I |
| **TR-DB-012** | The implementation shall satisfy FR-SRCH-005 for whole-word matching over `title`, `statement`, and `rationale`; no relevance ranking is required, and ordering shall be applied by the caller. | T |
| **TR-DB-013** | *Withdrawn (§8.4.4).* | — |

*On write concurrency: SQLite serializes writers. That is acceptable here
because no concurrency target is committed (§7.1). The optimistic concurrency
control of FR-REQ-008 is unaffected — it is enforced by comparing `version`,
not by engine-level locking.*

#### 8.4.3 Requirements not applicable to the local preview profile

The local preview profile exists for development and demonstration and shall
never hold real data. These requirements apply in full to the deployed profile
and do not apply to it:

- **NFR-SEC-001** (TLS) — served over localhost
- **NFR-SEC-002** (encryption at rest) — a plain file on the developer's disk
- **NFR-AVL-002…004** (backup, restore drills, single-node durability)
- **NFR-CMP-003** (12-month audit retention)

TR-DB-008 exists precisely so this distinction is visible to anyone looking at
a running system, rather than inferred from configuration. It matters more now
than it did when the two profiles ran different engines: nothing about the
storage itself tells the two apart any more.

#### 8.4.4 Withdrawn requirements

Withdrawn by the SQLite-only decision of §8.4. The identifiers are retired, not
recycled — a retired ID is never reissued, so a reference to it in a commit,
test name, or older revision stays unambiguous.

| ID | Was | Why withdrawn |
| -- | --- | ------------- |
| **TR-DB-003** | The active engine shall be selected by deployment configuration alone. | Vacuous with one engine. The part still worth requiring — configuration selecting the database location, one build artifact — is now TR-DB-014. |
| **TR-DB-013** | Any divergence beyond TR-DB-011 shall be confined to the data-access layer and recorded in this section. | There is no second engine to diverge from. TR-DB-015 keeps the containment requirement it existed to enforce. |

## 9. Constraints

| ID | Constraint | Source |
| -- | ---------- | ------ |
| **CON-001** | The system shall be deployable on a single host by one administrator, without a dedicated operations team. | Q2 |
| **CON-002** | The system shall be distributed as containers, deployable with a single compose-style manifest. | Q2 |
| **CON-003** | The system shall depend on no managed cloud service that has no self-hosted substitute. | Q2 |
| **CON-004** | The system shall use a single relational database as its system of record: SQLite, under both profiles. | §4, §8.4 |
| **CON-005** | The implementation stack is fixed: Node.js + TypeScript on the backend, React + TypeScript + Tailwind CSS on the frontend, in separate source trees. | Q16, §8 |
| **CON-006** | *TODO — team size and target delivery date, which bound how much of §6 lands in one increment (Q17).* | — |

## 10. Assumptions

- One deployment serves one organization; cross-organization isolation is not required.
- Users have modern evergreen browsers.
- An SMTP relay is available for password-reset delivery.
- Requirement text is Markdown, not rich binary content.
- The requirement corpus is authored by people, not machine-generated in bulk.
- The system starts empty; there is no legacy corpus (Q15).

## 11. Decisions

Questions resolved. Kept so the reasoning is not re-litigated.

| # | Question | Decision |
| - | -------- | -------- |
| Q1 | Web app, API, or both? | Web UI over a documented **internal** HTTP API (§2.1) |
| Q2 | Self-hosted or SaaS? | **Self-hosted, single-tenant.** Drives CON-001…003 |
| Q3 | Global administrator acceptable? | Yes, with every self-grant audited (FR-AUTHZ-007, FR-AUTHZ-008) |
| Q4 | Enough with four roles? | Four fixed roles; no per-object permissioning (FR-AUTHZ-001) |
| Q5 | Key scope | Per-project, prefixed by project key (FR-REQ-002) |
| Q6 | Renumbering | Never — keys are permanent and never reused (FR-REQ-003, INV-02) |
| Q7 | Classification model | **One category + unlimited tags** (FR-ORG-006, FR-ORG-008) |
| Q8 | Markdown | Markdown with raw HTML stripped (§4.8, NFR-SEC-005) |
| Q9 | Attachments | Deferred (§2.3) |
| Q10 | Baselines | Deferred; per-requirement revisions only (§2.3, §6.8) |
| Q11 | Approval workflow | **Out of scope.** Any editor may transition status (§4.12) |
| Q12 | Soft-delete window | 30 days; purge by project owner (FR-REQ-014, FR-PRJ-008) |
| Q13 | Auth mechanism | Email + password for v1, identity layer kept swappable for later SSO |
| Q14 | Performance and capacity targets | **Dismissed for the MVP.** No timing, load, or corpus-size target is committed (§7.1) |
| Q15 | Data import | **Not needed.** No incumbent tool, no existing corpus (§2.3, §10) |
| Q16 | Technology stack | **Node.js + TypeScript backend, React + TypeScript + Tailwind frontend, separate source trees** (§8, CON-005) |
| Q18 | Database engine | **SQLite only**, under both profiles (§8.4, CON-004). *Revised 2026-08-13: the original decision was SQLite for local preview and PostgreSQL when deployed, selected by configuration alone. PostgreSQL is deferred to a later spec (§2.3) so this development phase carries one engine to run, test, and operate. The portability constraints it motivated (§8.4.1, TR-DB-015) are retained deliberately, so reinstating it is a spec and a dialect, not a data migration.* |

## 12. Acceptance criteria for this increment

Satisfied when all of the following hold:

- [ ] A new user can register, log in, and log out.
- [ ] Authentication responses are indistinguishable across unknown email, wrong password, and locked account (FR-AUTH-008).
- [ ] An account locks after 5 failed attempts and unlocks after 15 minutes.
- [ ] A password change revokes every other session.
- [ ] An authenticated user can create a project and holds `owner` on it.
- [ ] An owner can add an `editor` and a `viewer`, and each role's permitted and denied operations behave per §6.3.
- [ ] A non-member receives an identical not-found response for every endpoint of a project (FR-AUTHZ-006).
- [ ] Removing the last owner of a project is rejected.
- [ ] An editor creates a requirement and it receives key `<KEY>-1`; the next receives `-2`; deleting and recreating does not reissue `-1`.
- [ ] An editor can read, update, soft-delete, and restore a requirement.
- [ ] An update carrying a stale version is rejected as a conflict and changes nothing.
- [ ] A transition to `approved` without acceptance criteria is rejected; with them, it succeeds.
- [ ] Categories can be created, nested 5 deep, reordered, moved, and deleted with reassignment per FR-ORG-005; a 6th level and a move-into-own-subtree are rejected.
- [ ] A requirement can be categorized, tagged, and given a parent; a parent cycle is rejected.
- [ ] Tags normalize to lowercase and deduplicate within a project.
- [ ] A bulk change over a selection applies to all of them or to none.
- [ ] The list can be filtered by every dimension in FR-SRCH-002, including category-with-descendants, and sorted by every field in FR-SRCH-004.
- [ ] The type, status, and priority facets start collapsed on a fresh view, expand and collapse from a click anywhere on the section header as well as by keyboard alone, the right-aligned indicator reflects the current state, and the toggle reports that state to assistive technology (NFR-USE-002, NFR-USE-008).
- [ ] Opening a URL that already carries type, status, or priority filters shows the facet section expanded, labelled with the active count, and clearing it removes exactly those filters from the URL (NFR-USE-009, FR-SRCH-010).
- [ ] Full-text search returns a requirement by a word from its statement, and never returns one from a project the actor cannot read.
- [ ] Every update writes a revision; any two revisions can be diffed; a revert produces a new revision rather than removing one.
- [ ] The audit log records every event type in §4.10 and offers no mutation path.
- [ ] `backend/` and `frontend/` each build, lint, and test on their own, with no source import across the boundary (TR-STR-002, TR-STR-003).
- [ ] The compose manifest brings up backend and frontend from a clean checkout, with no database service (TR-STR-006).
- [ ] A clean checkout yields a running system on SQLite with one command, with no database service installed or running (TR-DB-001, TR-DB-002).
- [ ] Moving the database file requires only a configuration change, with the same build artifact (TR-DB-014).
- [ ] The single migration source applies cleanly from empty, and every migration rolls back (TR-DB-005, NFR-MNT-006).
- [ ] The full test suite passes against SQLite (TR-DB-006).
- [ ] Full-text search returns a requirement by a word from its statement (FR-SRCH-005, TR-DB-012).
- [ ] A foreign-key violation is rejected by the database, on a fresh connection (TR-DB-009).
- [ ] The seed dataset loads and the local preview identifies itself as a preview (TR-DB-007, TR-DB-008).
- [ ] The OpenAPI description matches the implementation, and the frontend's API types regenerate from it without manual edit (TR-BE-005, TR-STR-004).
- [ ] Every **T**-marked requirement in §6 and §8 maps to a named automated test.

*No performance criterion appears here, by decision Q14.*
