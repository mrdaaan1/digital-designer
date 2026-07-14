'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  supabase: SupabaseClient;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: currentUser } }) => {
      setUser(currentUser);
      setStatus(currentUser ? 'signed-in' : 'signed-out');
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setStatus(session?.user ? 'signed-in' : 'signed-out');
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <AuthContext.Provider value={{ status, user, supabase }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
