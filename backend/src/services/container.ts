import type { Kysely } from 'kysely';
import type { Config } from '../config.js';
import { SearchIndex } from '../db/search-index.js';
import type { Database } from '../db/types.js';
import { AccountsService } from './accounts.js';
import { AuditService } from './audit.js';
import { AuthService } from './auth.js';
import { AuthorizationService } from './authorization.js';
import { CategoriesService } from './categories.js';
import { ConsoleMailer, type Mailer } from './mailer.js';
import { ProjectsService } from './projects.js';
import { RequirementQueryService } from './requirement-queries.js';
import { RequirementsService } from './requirements.js';
import { RevisionsService } from './revisions.js';
import { TagsService } from './tags.js';

export interface Services {
  readonly config: Config;
  readonly db: Kysely<Database>;
  readonly mailer: Mailer;
  readonly audit: AuditService;
  readonly accounts: AccountsService;
  readonly auth: AuthService;
  readonly authz: AuthorizationService;
  readonly projects: ProjectsService;
  readonly categories: CategoriesService;
  readonly tags: TagsService;
  readonly requirements: RequirementsService;
  readonly queries: RequirementQueryService;
  readonly revisions: RevisionsService;
  readonly searchIndex: SearchIndex;
}

export function createServices(
  config: Config,
  db: Kysely<Database>,
  mailer: Mailer = new ConsoleMailer(),
): Services {
  const audit = new AuditService(db);
  const authz = new AuthorizationService(db, audit);
  const searchIndex = new SearchIndex(db);
  const tags = new TagsService(db, authz);
  const categories = new CategoriesService(db, authz);
  const requirements = new RequirementsService(db, authz, tags, searchIndex);

  return {
    config,
    db,
    mailer,
    audit,
    authz,
    searchIndex,
    tags,
    categories,
    requirements,
    accounts: new AccountsService(db, audit, mailer),
    auth: new AuthService(db, audit),
    projects: new ProjectsService(db, authz, audit),
    queries: new RequirementQueryService(db, authz, tags, categories, searchIndex),
    revisions: new RevisionsService(db, authz, requirements),
  };
}
