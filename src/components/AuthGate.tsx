'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'signed-out') router.replace('/login');
  }, [status, router]);

  if (status === 'loading') {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-neutral-500">Загрузка…</p>
      </main>
    );
  }

  if (status === 'signed-out') return null;

  return <>{children}</>;
}
