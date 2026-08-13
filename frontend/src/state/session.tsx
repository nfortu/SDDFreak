import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import type { Meta, User } from '../api/types';

interface SessionValue {
  user: User | null;
  meta: Meta | null;
  loading: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      // FR-AUTH-009: no valid session is the normal unauthenticated state.
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      // TR-DB-008: the profile badge needs this before anything is rendered.
      try {
        setMeta(await api.meta());
      } catch {
        setMeta(null);
      }
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      meta,
      loading,
      async signIn(email, password) {
        setUser(await api.login({ email, password }));
      },
      async signUp(email, password, displayName) {
        await api.register({ email, password, displayName });
        setUser(await api.login({ email, password }));
      },
      async signOut() {
        await api.logout();
        setUser(null);
      },
      refresh,
    }),
    [user, meta, loading, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}
