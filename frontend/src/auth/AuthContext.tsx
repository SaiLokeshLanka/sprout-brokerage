import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiUser, onSessionLost, refreshSession, SessionResponse, setAccessToken } from '../api/client';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: ApiUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (fullName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Replace the cached profile after an update (e.g. KYC verified). */
  setUser: (user: ApiUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<ApiUser | null>(null);

  const startSession = useCallback((session: SessionResponse) => {
    setAccessToken(session.accessToken);
    setUserState(session.user);
    setStatus('authenticated');
  }, []);

  const endSession = useCallback(() => {
    setAccessToken(null);
    setUserState(null);
    setStatus('anonymous');
  }, []);

  // On first load, try to restore the session from the refresh cookie.
  useEffect(() => {
    let cancelled = false;
    refreshSession().then((session) => {
      if (cancelled) return;
      if (session) startSession(session);
      else endSession();
    });
    onSessionLost(endSession);
    return () => {
      cancelled = true;
    };
  }, [startSession, endSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      setUser: setUserState,
      login: async (email, password) => {
        startSession(await api.post<SessionResponse>('/auth/login', { email, password }, { auth: false }));
      },
      register: async (fullName, email, password) => {
        startSession(await api.post<SessionResponse>('/auth/register', { fullName, email, password }, { auth: false }));
      },
      logout: async () => {
        try {
          await api.post('/auth/logout', undefined, { auth: false });
        } finally {
          endSession();
        }
      },
    }),
    [status, user, startSession, endSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
