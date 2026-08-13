import { loadConfig } from './config.js';
import { createDb } from './db/connection.js';
import { migrateToLatest } from './db/migrator.js';
import { createServices } from './services/container.js';
import { ConsoleMailer } from './services/mailer.js';
import type { User } from './services/accounts.js';

/**
 * TR-DB-007: a committed seed dataset, so the local preview yields a populated
 * system to demonstrate rather than an empty one to explain.
 *
 * Safe to run twice: it does nothing if the installation already has accounts.
 */
const config = loadConfig();
const handle = createDb(config);

if (config.profile !== 'local-preview') {
  console.error('Refusing to seed: APP_PROFILE is not local-preview (§8.4.3).');
  process.exit(1);
}

await migrateToLatest(handle.db, handle.engine);
const services = createServices(config, handle.db, new ConsoleMailer(() => {}));

const existing = await handle.db.selectFrom('users').select('id').limit(1).executeTakeFirst();
if (existing) {
  console.log('Database already has accounts — nothing to seed.');
  await handle.close();
  process.exit(0);
}

const PASSWORD = 'preview-passphrase-2026';

// The first account registered administers the installation.
const admin = await services.accounts.register({
  email: 'admin@example.test',
  password: PASSWORD,
  displayName: 'Avery Admin',
});
const editor = await services.accounts.register({
  email: 'editor@example.test',
  password: PASSWORD,
  displayName: 'Eden Editor',
});
const viewer = await services.accounts.register({
  email: 'viewer@example.test',
  password: PASSWORD,
  displayName: 'Vic Viewer',
});

const project = await services.projects.create(admin, {
  key: 'RMS',
  name: 'Requirements Management System',
  description: 'The system described by SPEC-001, specified in itself.',
});

await services.projects.setMemberRole(admin, project.id, editor.id, 'editor');
await services.projects.setMemberRole(admin, project.id, viewer.id, 'viewer');

const category = async (name: string, parentId: string | null = null): Promise<string> =>
  (await services.categories.create(admin, project.id, { name, parentId })).id;

const accounts = await category('Accounts and access');
const authentication = await category('Authentication', accounts);
const authorization = await category('Authorization', accounts);
const requirementsArea = await category('Requirements');
const organization = await category('Organization', requirementsArea);
const quality = await category('Quality attributes');

interface Seed {
  title: string;
  statement: string;
  type: 'functional' | 'non_functional' | 'technical' | 'constraint' | 'business';
  priority?: 'must' | 'should' | 'could' | 'wont';
  categoryId?: string;
  tags?: string[];
  rationale?: string;
  acceptanceCriteria?: string;
  status?: 'draft' | 'proposed' | 'approved';
}

const seeds: Seed[] = [
  {
    title: 'Register an account',
    statement:
      'The system shall allow a person to register an account with an email address, a password, and a display name.',
    type: 'functional',
    priority: 'must',
    categoryId: accounts,
    tags: ['accounts'],
    acceptanceCriteria: 'A new address yields an account; a known address is rejected.',
    status: 'approved',
  },
  {
    title: 'Uniform authentication failures',
    statement:
      'The system shall return an identical response and an indistinguishable response time for an unknown email address, a wrong password, and a locked account.',
    type: 'non_functional',
    priority: 'must',
    categoryId: authentication,
    tags: ['security', 'accounts'],
    rationale: 'Anything else lets an attacker enumerate which addresses are registered.',
    acceptanceCriteria: 'All three cases return the same body and status.',
    status: 'approved',
  },
  {
    title: 'Lock after repeated failures',
    statement:
      'The system shall lock an account for 15 minutes after 5 consecutive failed authentication attempts within 15 minutes.',
    type: 'functional',
    priority: 'must',
    categoryId: authentication,
    tags: ['security'],
    acceptanceCriteria: 'A sixth attempt is refused even with the right password.',
    status: 'approved',
  },
  {
    title: 'Project roles',
    statement:
      'The system shall support exactly the project roles owner, editor, and viewer, and the system role administrator.',
    type: 'functional',
    priority: 'must',
    categoryId: authorization,
    tags: ['access-control'],
    status: 'proposed',
  },
  {
    title: 'Hide projects from non-members',
    statement:
      'The system shall deny a user holding no membership on a project every operation on that project, and shall not disclose the project’s existence.',
    type: 'functional',
    priority: 'must',
    categoryId: authorization,
    tags: ['access-control', 'security'],
    rationale: 'A refusal confirms existence; an absence does not.',
    status: 'proposed',
  },
  {
    title: 'Permanent requirement keys',
    statement:
      'The system shall never reuse or reassign a requirement key, including after the requirement is purged.',
    type: 'functional',
    priority: 'must',
    categoryId: requirementsArea,
    tags: ['traceability'],
    rationale: 'A key printed in a document must keep meaning the same thing forever.',
    acceptanceCriteria: 'Deleting and recreating never reissues a number.',
    status: 'approved',
  },
  {
    title: 'Optimistic concurrency on update',
    statement:
      'The system shall make no change and shall report a conflict when an update supplies a version other than the stored one.',
    type: 'functional',
    priority: 'must',
    categoryId: requirementsArea,
    tags: ['editing'],
    acceptanceCriteria: 'A stale write is refused and the stored content is unchanged.',
    status: 'approved',
  },
  {
    title: 'Acceptance criteria before approval',
    statement:
      'The system shall reject a transition to approved when acceptance criteria is empty.',
    type: 'functional',
    priority: 'should',
    categoryId: requirementsArea,
    tags: ['quality'],
    status: 'proposed',
  },
  {
    title: 'One category, many tags',
    statement:
      'The system shall allow a requirement to be assigned to at most one category, and to be left uncategorized.',
    type: 'functional',
    priority: 'should',
    categoryId: organization,
    tags: ['organization'],
    status: 'draft',
  },
  {
    title: 'Category nesting depth',
    statement:
      'The system shall support category nesting to a depth of at least 5 levels, and shall reject a create or move exceeding that depth.',
    type: 'constraint',
    priority: 'could',
    categoryId: organization,
    tags: ['organization'],
    status: 'draft',
  },
  {
    title: 'Full-text search',
    statement:
      'The system shall provide full-text search over title, statement, and rationale.',
    type: 'functional',
    priority: 'should',
    categoryId: requirementsArea,
    tags: ['search'],
    status: 'draft',
  },
  {
    title: 'Accessible interface',
    statement: 'The user interface shall conform to WCAG 2.1 Level AA.',
    type: 'non_functional',
    priority: 'should',
    categoryId: quality,
    tags: ['accessibility'],
    status: 'draft',
  },
  {
    title: 'Portable across database engines',
    statement:
      'The active database engine shall be selected by deployment configuration alone, with no code change and no separate build artifact.',
    type: 'technical',
    priority: 'must',
    categoryId: quality,
    tags: ['portability'],
    rationale: 'The local preview must be a preview of the real thing, not a parallel build.',
    status: 'proposed',
  },
];

const created = [];
for (const seed of seeds) {
  created.push(
    await services.requirements.create(admin as User, project.id, {
      title: seed.title,
      statement: seed.statement,
      type: seed.type,
      priority: seed.priority ?? 'should',
      rationale: seed.rationale ?? null,
      acceptanceCriteria: seed.acceptanceCriteria ?? null,
      categoryId: seed.categoryId ?? null,
      tags: seed.tags ?? [],
      status: seed.status ?? 'draft',
      source: 'SPEC-001',
    }),
  );
}

// A little decomposition, so the tree view has something to show (FR-ORG-012).
const parent = created.find((r) => r.title === 'Project roles');
const child = created.find((r) => r.title === 'Hide projects from non-members');
if (parent && child) {
  await services.requirements.update(admin, child.id, {
    version: child.version,
    parentId: parent.id,
  });
}

// A second revision on one requirement, so history and diff have content.
const evolving = created.find((r) => r.title === 'Full-text search');
if (evolving) {
  await services.requirements.update(editor, evolving.id, {
    version: evolving.version,
    statement:
      'The system shall provide full-text search over title, statement, and rationale, scoped to the projects the user may read.',
    rationale: 'Scoping is part of the requirement, not an implementation detail.',
  });
}

console.log(
  [
    '',
    'Seeded the local preview.',
    '',
    `  project    RMS — ${created.length} requirements, 6 categories`,
    '  admin      admin@example.test',
    '  editor     editor@example.test',
    '  viewer     viewer@example.test',
    `  password   ${PASSWORD}`,
    '',
  ].join('\n'),
);

await handle.close();
