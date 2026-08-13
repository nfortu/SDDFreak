import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import { Banner, Button, Card, Field, Input } from '../components/ui';
import { useSession } from '../state/session';

type Mode = 'sign-in' | 'sign-up' | 'forgot';

export function LoginPage() {
  const { signIn, signUp, meta } = useSession();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      if (mode === 'sign-in') {
        await signIn(email, password);
      } else if (mode === 'sign-up') {
        await signUp(email, password, displayName);
      } else {
        const result = await api.forgotPassword({ email });
        // FR-ACC-007: the same answer either way. Under the local preview
        // profile the token comes back inline, because there is no mail relay.
        setNotice(
          result.previewToken
            ? `Preview only — reset token: ${result.previewToken}`
            : 'If that address is registered, a reset link is on its way.',
        );
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">SDDFreak</h1>
          <p className="text-sm text-ink-muted">Requirements management — SPEC-001</p>
        </div>

        {meta?.isPreview && (
          <Banner tone="warning">
            <strong>Local preview.</strong> {meta.engine} · not for real data.
          </Banner>
        )}

        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            {mode === 'sign-up' && (
              <Field label="Display name">
                <Input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  maxLength={100}
                  autoComplete="name"
                />
              </Field>
            )}

            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </Field>

            {mode !== 'forgot' && (
              <Field
                label="Password"
                hint={mode === 'sign-up' ? 'At least 12 characters.' : undefined}
              >
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                />
              </Field>
            )}

            {error && <Banner tone="error">{error}</Banner>}
            {notice && <Banner tone="info">{notice}</Banner>}

            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy
                ? 'Working…'
                : mode === 'sign-in'
                  ? 'Sign in'
                  : mode === 'sign-up'
                    ? 'Create account'
                    : 'Send reset link'}
            </Button>
          </form>
        </Card>

        <div className="flex justify-between text-sm">
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => {
              setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up');
              setError(null);
              setNotice(null);
            }}
          >
            {mode === 'sign-up' ? 'I already have an account' : 'Create an account'}
          </button>
          {mode !== 'forgot' && (
            <button
              type="button"
              className="text-ink-muted hover:underline"
              onClick={() => {
                setMode('forgot');
                setError(null);
              }}
            >
              Forgot password
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
