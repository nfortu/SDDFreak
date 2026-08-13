import type { components } from './schema';

/**
 * TR-STR-004: every shape below is generated from the backend's OpenAPI
 * description. Nothing here is hand-written, so the two trees cannot drift
 * without the generation step failing.
 */
export type Requirement = components['schemas']['Requirement'];
export type Project = components['schemas']['Project'];
export type Category = components['schemas']['Category'];
export type Tag = components['schemas']['Tag'];
export type User = components['schemas']['User'];
export type Member = components['schemas']['Member'];
export type Revision = components['schemas']['Revision'];
export type Session = components['schemas']['Session'];
export type AuditEvent = components['schemas']['AuditEvent'];

export type RequirementType = Requirement['type'];
export type RequirementStatus = Requirement['status'];
export type Priority = Requirement['priority'];
export type ProjectRole = Project['role'];

export interface RequirementList {
  items: Requirement[];
  total: number;
  limit: number;
  offset: number;
}

export interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export interface Diff {
  from: number;
  to: number;
  changes: FieldDiff[];
}

export interface RequirementNode extends Requirement {
  children: RequirementNode[];
}

export interface TreeCategory {
  id: string | null;
  name: string;
  requirements: RequirementNode[];
  children: TreeCategory[];
}

export interface Meta {
  profile: 'local-preview' | 'deployed';
  isPreview: boolean;
  engine: 'sqlite';
  spec: string;
}

/** §4.12, mirrored here only to shape the UI — the backend decides (TR-FE-006). */
export const STATUSES: RequirementStatus[] = [
  'draft',
  'proposed',
  'approved',
  'implemented',
  'verified',
  'rejected',
  'obsolete',
];

export const TYPES: RequirementType[] = [
  'functional',
  'non_functional',
  'technical',
  'constraint',
  'business',
];

export const PRIORITIES: Priority[] = ['must', 'should', 'could', 'wont'];

export const TYPE_LABELS: Record<RequirementType, string> = {
  functional: 'Functional',
  non_functional: 'Non-functional',
  technical: 'Technical',
  constraint: 'Constraint',
  business: 'Business',
};
