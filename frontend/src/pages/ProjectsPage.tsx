import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { Project } from '../api/types';
import { Banner, Button, Card, EmptyState, Field, Input, Spinner } from '../components/ui';

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => setProjects(await api.projects());

  useEffect(() => {
    void load();
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await api.createProject({ key: key.toUpperCase(), name });
      setKey('');
      setName('');
      setCreating(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the project.');
    }
  };

  if (!projects) {
    return (
      <div className="p-8">
        <Spinner label="Loading projects" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Projects</h1>
          <p className="text-sm text-ink-muted">
            You see only the projects you are a member of.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating((open) => !open)}>
          {creating ? 'Cancel' : 'New project'}
        </Button>
      </header>

      {creating && (
        <Card className="p-5">
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            <Field label="Key" hint="2–8, A–Z then A–Z or 0–9">
              <Input
                value={key}
                onChange={(event) => setKey(event.target.value.toUpperCase())}
                required
                minLength={2}
                maxLength={8}
                pattern="[A-Z][A-Z0-9]{1,7}"
              />
            </Field>
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={100}
              />
            </Field>
            <Button type="submit" variant="primary">
              Create
            </Button>
          </form>
          {error && (
            <div className="mt-3">
              <Banner tone="error">{error}</Banner>
            </div>
          )}
        </Card>
      )}

      {projects.length === 0 ? (
        <EmptyState title="No projects yet">
          Create one to start capturing requirements.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                to={`/projects/${project.id}`}
                className="block rounded-lg border border-border-subtle bg-surface-raised p-4 transition-colors hover:border-accent"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-xs font-semibold tracking-wider text-accent">
                    {project.key}
                  </span>
                  <span className="text-xs text-ink-muted">{project.role}</span>
                </div>
                <p className="mt-1 font-medium text-ink">{project.name}</p>
                <p className="mt-2 text-xs text-ink-muted">
                  {project.requirementCount ?? 0} requirement
                  {project.requirementCount === 1 ? '' : 's'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
