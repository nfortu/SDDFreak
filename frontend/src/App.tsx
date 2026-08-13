import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Button, Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { ProjectPage } from './pages/ProjectPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { RequirementPage } from './pages/RequirementPage';
import { useSession } from './state/session';

export function App() {
  const { user, meta, loading, signOut } = useSession();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Starting" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border-subtle bg-surface-raised">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight text-ink">
            SDDFreak
          </Link>

          {/* TR-DB-008: a running preview says so, so it cannot be mistaken
              for a deployed installation. */}
          {meta?.isPreview && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300">
              local preview · {meta.engine}
            </span>
          )}

          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-ink-muted">{user.displayName}</span>
            {user.isAdministrator && (
              <span className="rounded bg-accent-soft px-2 py-0.5 text-[11px] text-ink">admin</span>
            )}
            <Button size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="/requirements/:requirementId" element={<RequirementPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="border-t border-border-subtle px-4 py-3 text-center text-xs text-ink-muted">
        {meta?.spec ?? 'SPEC-001'}
      </footer>
    </div>
  );
}
