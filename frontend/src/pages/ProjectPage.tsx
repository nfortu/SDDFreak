import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api, type RequirementFilters } from '../api/client';
import {
  PRIORITIES,
  STATUSES,
  TYPES,
  TYPE_LABELS,
  type Category,
  type Project,
  type Requirement,
  type RequirementList,
  type Tag,
} from '../api/types';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PriorityBadge,
  Select,
  Spinner,
  StatusBadge,
  TagChip,
  Textarea,
  cx,
} from '../components/ui';

const PAGE_SIZE = 25;

/** FR-SRCH-002/003/004: the filter state lives in the URL so a view is shareable. */
function filtersFromParams(params: URLSearchParams): RequirementFilters {
  const list = (key: string) => params.getAll(key);
  return {
    q: params.get('q') ?? undefined,
    type: list('type').length ? list('type') : undefined,
    status: list('status').length ? list('status') : undefined,
    priority: list('priority').length ? list('priority') : undefined,
    tag: list('tag').length ? list('tag') : undefined,
    categoryId: params.get('categoryId') ?? undefined,
    includeDescendants: params.get('includeDescendants') === 'true' || undefined,
    uncategorized: params.get('uncategorized') === 'true' || undefined,
    includeDeleted: params.get('includeDeleted') === 'true' || undefined,
    sort: params.get('sort') ?? 'key',
    direction: (params.get('direction') as 'asc' | 'desc' | null) ?? 'asc',
    limit: PAGE_SIZE,
    offset: Number(params.get('offset') ?? 0),
  };
}

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();

  const [project, setProject] = useState<Project | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [result, setResult] = useState<RequirementList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);

  const filters = useMemo(() => filtersFromParams(params), [params]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'offset') next.delete('offset');
    setParams(next, { replace: true });
  };

  const toggleMulti = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    const current = next.getAll(key);
    next.delete(key);
    for (const item of current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]) {
      next.append(key, item);
    }
    next.delete('offset');
    setParams(next, { replace: true });
  };

  const loadRequirements = useCallback(async () => {
    setError(null);
    try {
      setResult(await api.requirements(projectId, filters));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load requirements.');
    }
  }, [projectId, filters]);

  useEffect(() => {
    void (async () => {
      try {
        const [loadedProject, loadedCategories, loadedTags] = await Promise.all([
          api.project(projectId),
          api.categories(projectId),
          api.tags(projectId),
        ]);
        setProject(loadedProject);
        setCategories(loadedCategories);
        setTags(loadedTags);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Could not load the project.');
      }
    })();
  }, [projectId]);

  useEffect(() => {
    void loadRequirements();
  }, [loadRequirements]);

  const canEdit = project?.role === 'owner' || project?.role === 'editor';

  const applyBulk = async (changes: Record<string, unknown>) => {
    if (selected.size === 0) return;
    try {
      await api.bulkUpdate(projectId, [...selected], changes);
      setSelected(new Set());
      await loadRequirements();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Bulk change failed.');
    }
  };

  if (!project) {
    return (
      <div className="p-8">
        {error ? <Banner tone="error">{error}</Banner> : <Spinner label="Loading project" />}
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-5">
        <div>
          <p className="font-mono text-xs font-semibold tracking-wider text-accent">
            {project.key}
          </p>
          <h1 className="text-lg font-semibold tracking-tight text-ink">{project.name}</h1>
          <p className="text-xs text-ink-muted">your role: {project.role}</p>
        </div>

        <CategorySidebar
          projectId={projectId}
          categories={categories}
          activeId={filters.categoryId ?? null}
          uncategorized={filters.uncategorized ?? false}
          includeDescendants={filters.includeDescendants ?? false}
          canEdit={canEdit}
          onSelect={(id, uncategorized) => {
            const next = new URLSearchParams(params);
            next.delete('offset');
            if (uncategorized) {
              next.set('uncategorized', 'true');
              next.delete('categoryId');
            } else if (id) {
              next.set('categoryId', id);
              next.delete('uncategorized');
            } else {
              next.delete('categoryId');
              next.delete('uncategorized');
            }
            setParams(next, { replace: true });
          }}
          onToggleDescendants={() =>
            setParam('includeDescendants', filters.includeDescendants ? null : 'true')
          }
          onChanged={async () => setCategories(await api.categories(projectId))}
        />

        {tags.length > 0 && (
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Tags
            </h2>
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleMulti('tag', tag.name)}
                  className={cx(
                    'rounded px-1.5 py-0.5 text-[11px]',
                    filters.tag?.includes(tag.name)
                      ? 'bg-accent text-white'
                      : 'bg-accent-soft text-ink hover:opacity-80',
                  )}
                >
                  {tag.name} <span className="opacity-60">{tag.usageCount ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      <main className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            placeholder="Search title, statement, rationale…"
            defaultValue={filters.q ?? ''}
            onChange={(event) => setParam('q', event.target.value)}
            className="max-w-xs"
            aria-label="Search requirements"
          />
          <Select
            value={filters.sort}
            onChange={(event) => setParam('sort', event.target.value)}
            aria-label="Sort by"
            className="w-auto"
          >
            {['key', 'title', 'status', 'priority', 'createdAt', 'updatedAt'].map((field) => (
              <option key={field} value={field}>
                sort: {field}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            onClick={() => setParam('direction', filters.direction === 'asc' ? 'desc' : 'asc')}
          >
            {filters.direction === 'asc' ? '↑ asc' : '↓ desc'}
          </Button>
          <div className="ml-auto flex gap-2">
            <a
              href={api.exportUrl(projectId, filters, 'csv')}
              className="inline-flex items-center rounded-md border border-border-subtle px-2.5 py-1 text-xs text-ink hover:bg-accent-soft"
            >
              CSV
            </a>
            <a
              href={api.exportUrl(projectId, filters, 'json')}
              className="inline-flex items-center rounded-md border border-border-subtle px-2.5 py-1 text-xs text-ink hover:bg-accent-soft"
            >
              JSON
            </a>
            {canEdit && (
              <Button variant="primary" size="sm" onClick={() => setShowCreate((open) => !open)}>
                {showCreate ? 'Cancel' : 'New requirement'}
              </Button>
            )}
          </div>
        </div>

        <FacetRow
          label="Type"
          options={TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
          active={filters.type ?? []}
          onToggle={(value) => toggleMulti('type', value)}
        />
        <FacetRow
          label="Status"
          options={STATUSES.map((s) => ({ value: s, label: s }))}
          active={filters.status ?? []}
          onToggle={(value) => toggleMulti('status', value)}
        />
        <FacetRow
          label="Priority"
          options={PRIORITIES.map((p) => ({ value: p, label: p }))}
          active={filters.priority ?? []}
          onToggle={(value) => toggleMulti('priority', value)}
        />

        {showCreate && canEdit && (
          <CreateRequirementForm
            projectId={projectId}
            categories={categories}
            onCreated={async () => {
              setShowCreate(false);
              await loadRequirements();
              setTags(await api.tags(projectId));
            }}
          />
        )}

        {error && <Banner tone="error">{error}</Banner>}

        {selected.size > 0 && canEdit && (
          <Card className="flex flex-wrap items-center gap-2 p-3">
            <span className="text-sm text-ink">{selected.size} selected</span>
            <Select
              defaultValue=""
              className="w-auto"
              aria-label="Set priority for selection"
              onChange={(event) =>
                event.target.value && void applyBulk({ priority: event.target.value })
              }
            >
              <option value="">Set priority…</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
            <Select
              defaultValue=""
              className="w-auto"
              aria-label="Set status for selection"
              onChange={(event) =>
                event.target.value && void applyBulk({ status: event.target.value })
              }
            >
              <option value="">Set status…</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </Card>
        )}

        {!result ? (
          <Spinner label="Loading requirements" />
        ) : result.items.length === 0 ? (
          <EmptyState title="Nothing matches">
            Adjust the filters, or clear the search box.
          </EmptyState>
        ) : (
          <>
            <ul className="space-y-2">
              {result.items.map((requirement) => (
                <RequirementRow
                  key={requirement.id}
                  requirement={requirement}
                  selectable={canEdit}
                  selected={selected.has(requirement.id)}
                  onToggle={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(requirement.id)) next.delete(requirement.id);
                      else next.add(requirement.id);
                      return next;
                    })
                  }
                />
              ))}
            </ul>

            <div className="flex items-center justify-between text-sm text-ink-muted">
              <span>
                {result.offset + 1}–{Math.min(result.offset + result.limit, result.total)} of{' '}
                {result.total}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={result.offset === 0}
                  onClick={() => setParam('offset', String(Math.max(0, result.offset - PAGE_SIZE)))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  disabled={result.offset + result.limit >= result.total}
                  onClick={() => setParam('offset', String(result.offset + PAGE_SIZE))}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function FacetRow({
  label,
  options,
  active,
  onToggle,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  active: string[];
  onToggle(value: string): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={active.includes(option.value)}
          onClick={() => onToggle(option.value)}
          className={cx(
            'rounded border px-2 py-0.5 text-xs transition-colors',
            active.includes(option.value)
              ? 'border-accent bg-accent text-white'
              : 'border-border-subtle text-ink-muted hover:border-accent hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function RequirementRow({
  requirement,
  selectable,
  selected,
  onToggle,
}: {
  requirement: Requirement;
  selectable: boolean;
  selected: boolean;
  onToggle(): void;
}) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface-raised p-3">
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1"
          aria-label={`Select ${requirement.key}`}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/requirements/${requirement.id}`}
            className="font-mono text-xs font-semibold text-accent hover:underline"
          >
            {requirement.key}
          </Link>
          <StatusBadge status={requirement.status} />
          <PriorityBadge priority={requirement.priority} />
          <span className="text-[11px] text-ink-muted">{TYPE_LABELS[requirement.type]}</span>
          {requirement.deletedAt && (
            <span className="text-[11px] font-medium text-red-600 dark:text-red-400">deleted</span>
          )}
        </div>
        <Link to={`/requirements/${requirement.id}`} className="mt-1 block">
          <p className="truncate font-medium text-ink">{requirement.title}</p>
          <p className="truncate text-sm text-ink-muted">{requirement.statement}</p>
        </Link>
        {requirement.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {requirement.tags.map((tag) => (
              <TagChip key={tag} name={tag} />
            ))}
          </div>
        )}
      </div>
      <span className="shrink-0 text-[11px] text-ink-muted">v{requirement.version}</span>
    </li>
  );
}

function CategorySidebar({
  projectId,
  categories,
  activeId,
  uncategorized,
  includeDescendants,
  canEdit,
  onSelect,
  onToggleDescendants,
  onChanged,
}: {
  projectId: string;
  categories: Category[];
  activeId: string | null;
  uncategorized: boolean;
  includeDescendants: boolean;
  canEdit: boolean;
  onSelect(id: string | null, uncategorized: boolean): void;
  onToggleDescendants(): void;
  onChanged(): Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await api.createCategory(projectId, { name, parentId: parentId || null });
      setName('');
      setParentId('');
      setAdding(false);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add the category.');
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Categories</h2>
        {canEdit && (
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={() => setAdding((open) => !open)}
          >
            {adding ? 'cancel' : '+ add'}
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={add} className="mb-3 space-y-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Category name"
            required
            maxLength={100}
          />
          <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">(top level)</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {'— '.repeat(category.depth - 1)}
                {category.name}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="primary" className="w-full">
            Add category
          </Button>
          {error && <Banner tone="error">{error}</Banner>}
        </form>
      )}

      <ul className="space-y-0.5 text-sm">
        <li>
          <button
            type="button"
            onClick={() => onSelect(null, false)}
            className={cx(
              'w-full rounded px-2 py-1 text-left',
              !activeId && !uncategorized ? 'bg-accent-soft font-medium text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            All requirements
          </button>
        </li>
        {categories.map((category) => (
          <li key={category.id} style={{ paddingLeft: `${(category.depth - 1) * 0.75}rem` }}>
            <button
              type="button"
              onClick={() => onSelect(category.id, false)}
              className={cx(
                'w-full truncate rounded px-2 py-1 text-left',
                activeId === category.id
                  ? 'bg-accent-soft font-medium text-ink'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {category.name}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => onSelect(null, true)}
            className={cx(
              'w-full rounded px-2 py-1 text-left',
              uncategorized ? 'bg-accent-soft font-medium text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            Uncategorized
          </button>
        </li>
      </ul>

      {activeId && (
        <label className="mt-2 flex items-center gap-2 px-2 text-xs text-ink-muted">
          <input type="checkbox" checked={includeDescendants} onChange={onToggleDescendants} />
          include sub-categories
        </label>
      )}
    </div>
  );
}

function CreateRequirementForm({
  projectId,
  categories,
  onCreated,
}: {
  projectId: string;
  categories: Category[];
  onCreated(): Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [statement, setStatement] = useState('');
  const [type, setType] = useState<Requirement['type']>('functional');
  const [priority, setPriority] = useState<Requirement['priority']>('should');
  const [categoryId, setCategoryId] = useState('');
  const [tagText, setTagText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createRequirement(projectId, {
        title,
        statement,
        type,
        priority,
        categoryId: categoryId || null,
        tags: tagText
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      } as never);
      setTitle('');
      setStatement('');
      setTagText('');
      await onCreated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the requirement.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Title">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={200}
          />
        </Field>
        <Field label="Statement" hint="One sentence where possible.">
          <Textarea
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
            required
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type">
            <Select
              value={type}
              onChange={(event) => setType(event.target.value as Requirement['type'])}
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
              value={priority}
              onChange={(event) => setPriority(event.target.value as Requirement['priority'])}
            >
              {PRIORITIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">(uncategorized)</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {'— '.repeat(category.depth - 1)}
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Tags" hint="Comma separated. Normalized to lowercase.">
          <Input value={tagText} onChange={(event) => setTagText(event.target.value)} />
        </Field>
        {error && <Banner tone="error">{error}</Banner>}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create requirement'}
        </Button>
      </form>
    </Card>
  );
}
