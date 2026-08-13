import { unprocessable } from './errors.js';

export const REQUIREMENT_STATUSES = [
  'draft',
  'proposed',
  'approved',
  'implemented',
  'verified',
  'rejected',
  'obsolete',
] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const REQUIREMENT_TYPES = [
  'functional',
  'non_functional',
  'technical',
  'constraint',
  'business',
] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const PRIORITIES = ['must', 'should', 'could', 'wont'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** §4.12 terminal states. */
const TERMINAL: readonly RequirementStatus[] = ['rejected', 'obsolete'];

/**
 * §4.12. Any editor may perform any permitted transition — there is no
 * reviewer gate in this increment (Q11).
 */
const ALLOWED: Record<RequirementStatus, readonly RequirementStatus[]> = {
  draft: ['proposed', 'rejected', 'obsolete'],
  proposed: ['draft', 'approved', 'rejected', 'obsolete'],
  approved: ['proposed', 'draft', 'implemented', 'rejected', 'obsolete'],
  implemented: ['verified', 'draft', 'rejected', 'obsolete'],
  verified: ['draft', 'rejected', 'obsolete'],
  rejected: [],
  obsolete: [],
};

export function isTerminal(status: RequirementStatus): boolean {
  return TERMINAL.includes(status);
}

export function canTransition(from: RequirementStatus, to: RequirementStatus): boolean {
  if (from === to) return true;
  return (ALLOWED[from] ?? []).includes(to);
}

/** Statuses at or beyond `approved`, which INV-07 gates on acceptance criteria. */
const REQUIRES_ACCEPTANCE_CRITERIA: readonly RequirementStatus[] = [
  'approved',
  'implemented',
  'verified',
];

export function requiresAcceptanceCriteria(status: RequirementStatus): boolean {
  return REQUIRES_ACCEPTANCE_CRITERIA.includes(status);
}

/** FR-REQ-009 and FR-REQ-010, enforced together so a caller sees one clear reason. */
export function assertTransition(
  from: RequirementStatus,
  to: RequirementStatus,
  acceptanceCriteria: string | null,
): void {
  if (!canTransition(from, to)) {
    throw unprocessable(
      'invalid_status_transition',
      `A requirement cannot move from '${from}' to '${to}'.` +
        (isTerminal(from) ? ` '${from}' is a terminal status.` : ''),
    );
  }
  if (requiresAcceptanceCriteria(to) && !acceptanceCriteria?.trim()) {
    throw unprocessable(
      'acceptance_criteria_required',
      `A requirement needs acceptance criteria before it can reach '${to}'.`,
    );
  }
}
