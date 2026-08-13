import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import {
  PRIORITIES,
  STATUSES,
  TYPES,
  TYPE_LABELS,
  type Category,
  type Diff,
  type Requirement,
  type Revision,
} from '../api/types';
import {
  Banner,
  Button,
  Card,
  Field,
  Input,
  PriorityBadge,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
} from '../components/ui';

interface Draft {
  title: string;
  statement: string;
  rationale: string;
  acceptanceCriteria: string;
  source: string;
  type: Requirement['type'];
  priority: Requirement['priority'];
  status: Requirement['status'];
  categoryId: string;
  tags: string;
}

const toDraft = (requirement: Requirement): Draft => ({
  title: requirement.title,
  statement: requirement.statement,
  rationale: requirement.rationale ?? '',
  acceptanceCriteria: requirement.acceptanceCriteria ?? '',
  source: requirement.source ?? '',
  type: requirement.type,
  priority: requirement.priority,
  status: requirement.status,
  categoryId: requirement.categoryId ?? '',
  tags: requirement.tags.join(', '),
});

export function RequirementPage() {
  const { requirementId = '' } = useParams();
  const navigate = useNavigate();

  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** NFR-USE-007: on a conflict, hold the server's copy beside the user's edits. */
  const [conflict, setConflict] = useState<Requirement | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const loaded = await api.requirement(requirementId);
    setRequirement(loaded);
    setDraft(toDraft(loaded));
    setRevisions(await api.revisions(requirementId));
    setCategories(await api.categories(loaded.projectId));
  }, [requirementId]);

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Could not load the requirement.');
      }
    })();
  }, [load]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!requirement || !draft) return;

    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      const updated = await api.updateRequirement(requirement.id, {
        version: requirement.version,
        title: draft.title,
        statement: draft.statement,
        rationale: draft.rationale || null,
        acceptanceCriteria: draft.acceptanceCriteria || null,
        source: draft.source || null,
        type: draft.type,
        priority: draft.priority,
        status: draft.status,
        categoryId: draft.categoryId || null,
        tags: draft.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      } as never);

      setRequirement(updated);
      setDraft(toDraft(updated));
      setRevisions(await api.revisions(requirement.id));
      setConflict(null);
      setNotice(`Saved as version ${updated.version}.`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.isVersionConflict) {
        // NFR-USE-007: show both, discard neither.
        setConflict(await api.requirement(requirement.id));
        setError(caught.message);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not save.');
      }
    } finally {
      setBusy(false);
    }
  };

  const showDiff = async (from: number, to: number) => {
    if (!requirement) return;
    setDiff(await api.diff(requirement.id, from, to));
  };

  const revert = async (toVersion: number) => {
    if (!requirement) return;
    try {
      await api.revert(requirement.id, toVersion);
      await load();
      setNotice(`Reverted to the content of version ${toVersion}, recorded as a new revision.`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not revert.');
    }
  };

  const remove = async (cascade: boolean) => {
    if (!requirement) return;
    try {
      await api.deleteRequirement(requirement.id, cascade);
      navigate(`/projects/${requirement.projectId}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'requirement_has_children') {
        setError(`${caught.message} Use “Delete subtree” to confirm.`);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not delete.');
      }
    }
  };

  if (!requirement || !draft) {
    return (
      <div className="p-8">
        {error ? <Banner tone="error">{error}</Banner> : <Spinner label="Loading requirement" />}
      </div>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/projects/${requirement.projectId}`}
          className="text-sm text-ink-muted hover:underline"
        >
          ← back to project
        </Link>
        <span className="font-mono text-sm font-semibold text-accent">{requirement.key}</span>
        <StatusBadge status={requirement.status} />
        <PriorityBadge priority={requirement.priority} />
        <span className="text-xs text-ink-muted">version {requirement.version}</span>
        {requirement.deletedAt && (
          <Button size="sm" onClick={() => void api.restoreRequirement(requirement.id).then(load)}>
            Restore
          </Button>
        )}
      </div>

      {notice && <Banner tone="success">{notice}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}

      {conflict && (
        <Card className="border-amber-400 p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">
            Someone else saved version {conflict.version} while you were editing
          </h2>
          <p className="mb-3 text-sm text-ink-muted">
            Your edits are still in the form below. Compare, then either take theirs or re-apply
            yours on top.
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase text-ink-muted">Theirs (saved)</dt>
              <dd className="mt-1 rounded border border-border-subtle p-2 text-ink">
                <p className="font-medium">{conflict.title}</p>
                <p className="text-ink-muted">{conflict.statement}</p>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-ink-muted">Yours (unsaved)</dt>
              <dd className="mt-1 rounded border border-border-subtle p-2 text-ink">
                <p className="font-medium">{draft.title}</p>
                <p className="text-ink-muted">{draft.statement}</p>
              </dd>
            </div>
          </dl>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setRequirement(conflict);
                setDraft(toDraft(conflict));
                setConflict(null);
                setError(null);
              }}
            >
              Take theirs, discard mine
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                // Re-base onto their version, keeping the user's text.
                setRequirement(conflict);
                setConflict(null);
                setError(null);
                setNotice('Rebased on the newer version — press Save to apply your edits.');
              }}
            >
              Keep mine, save on top
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card className="p-5">
          <form onSubmit={save} className="space-y-4">
            <Field label="Title">
              <Input
                value={draft.title}
                onChange={(event) => set('title', event.target.value)}
                maxLength={200}
                required
              />
            </Field>
            <Field label="Statement">
              <Textarea
                value={draft.statement}
                onChange={(event) => set('statement', event.target.value)}
                required
              />
            </Field>
            <Field label="Rationale" hint="Why this requirement exists.">
              <Textarea
                value={draft.rationale}
                onChange={(event) => set('rationale', event.target.value)}
              />
            </Field>
            <Field
              label="Acceptance criteria"
              hint="Required before the status can reach approved."
            >
              <Textarea
                value={draft.acceptanceCriteria}
                onChange={(event) => set('acceptanceCriteria', event.target.value)}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Type">
                <Select
                  value={draft.type}
                  onChange={(event) => set('type', event.target.value as Requirement['type'])}
                >
                  {TYPES.map((option) => (
                    <option key={option} value={option}>
                      {TYPE_LABELS[option]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority">
                <Select
                  value={draft.priority}
                  onChange={(event) =>
                    set('priority', event.target.value as Requirement['priority'])
                  }
                >
                  {PRIORITIES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status">
                <Select
                  value={draft.status}
                  onChange={(event) => set('status', event.target.value as Requirement['status'])}
                >
                  {STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Category">
                <Select
                  value={draft.categoryId}
                  onChange={(event) => set('categoryId', event.target.value)}
                >
                  <option value="">(uncategorized)</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {'— '.repeat(category.depth - 1)}
                      {category.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Source">
                <Input
                  value={draft.source}
                  onChange={(event) => set('source', event.target.value)}
                  maxLength={200}
                />
              </Field>
            </div>

            <Field label="Tags" hint="Comma separated.">
              <Input value={draft.tags} onChange={(event) => set('tags', event.target.value)} />
            </Field>

            <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-4">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" onClick={() => setDraft(toDraft(requirement))}>
                Reset
              </Button>
              <Button
                type="button"
                onClick={() =>
                  void api
                    .duplicateRequirement(requirement.id)
                    .then((copy) => navigate(`/requirements/${copy.id}`))
                }
              >
                Duplicate
              </Button>
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="danger" onClick={() => void remove(false)}>
                  Delete
                </Button>
                <Button type="button" variant="danger" onClick={() => void remove(true)}>
                  Delete subtree
                </Button>
              </div>
            </div>
          </form>
        </Card>

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">History</h2>
            <ol className="space-y-2 text-sm">
              {revisions.map((revision) => (
                <li key={revision.id} className="border-b border-border-subtle pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">v{revision.version}</span>
                    <span className="text-[11px] text-ink-muted">{revision.changeKind}</span>
                  </div>
                  <p className="text-xs text-ink-muted">
                    {revision.changedByName ?? 'unknown'} ·{' '}
                    {new Date(revision.changedAt).toLocaleString()}
                  </p>
                  <div className="mt-1 flex gap-2">
                    {revision.version > 1 && (
                      <button
                        type="button"
                        className="text-xs text-accent hover:underline"
                        onClick={() => void showDiff(revision.version - 1, revision.version)}
                      >
                        diff from v{revision.version - 1}
                      </button>
                    )}
                    {revision.version !== requirement.version && (
                      <button
                        type="button"
                        className="text-xs text-accent hover:underline"
                        onClick={() => void revert(revision.version)}
                      >
                        revert to this
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {diff && (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">
                v{diff.from} → v{diff.to}
              </h2>
              {diff.changes.length === 0 ? (
                <p className="text-sm text-ink-muted">No field changed.</p>
              ) : (
                <dl className="space-y-2 text-xs">
                  {diff.changes.map((change) => (
                    <div key={change.field}>
                      <dt className="font-semibold text-ink">{change.field}</dt>
                      <dd className="mt-0.5 space-y-0.5">
                        <p className="rounded bg-red-50 px-1.5 py-0.5 text-red-900 dark:bg-red-950 dark:text-red-200">
                          − {String(change.before ?? '(empty)')}
                        </p>
                        <p className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                          + {String(change.after ?? '(empty)')}
                        </p>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setDiff(null)}>
                Close
              </Button>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
