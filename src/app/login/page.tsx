'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Mode = 'signin' | 'signup';

function translateAuthError(message: string): string {
  if (message.includes('Invalid login credentials')) return 'Неверный email или пароль.';
  if (message.includes('User already registered')) return 'Пользователь с таким email уже зарегистрирован.';
  if (message.includes('Password should be at least')) return 'Пароль должен быть не короче 6 символов.';
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();

    if (mode === 'signup') {
      const { data, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
      setSubmitting(false);
      if (signUpError) {
        setError(translateAuthError(signUpError.message));
        return;
      }
      if (!data.session) {
        setNotice('Регистрация прошла успешно. Подтвердите email по ссылке из письма, затем войдите.');
        setMode('signin');
        return;
      }
      router.replace('/');
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);
    if (signInError) {
      setError(translateAuthError(signInError.message));
      return;
    }
    router.replace('/');
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm flex flex-col gap-6 animate-fade-in-up">
        <div className="text-center">
          <p className="text-3xl mb-2">🎨</p>
          <h1 className="font-display text-2xl font-extrabold">Цифровой дизайнер презентаций</h1>
          <p className="text-muted text-sm mt-1">Соберите презентацию в стиле вашего шаблона за минуты</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="you@company.ru"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl border border-card-border bg-card px-4 py-3 text-base outline-none focus:border-accent transition-colors"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl border border-card-border bg-card px-4 py-3 text-base outline-none focus:border-accent transition-colors"
          />
          <button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            className="rounded-xl bg-accent hover:bg-accent-dark transition-colors text-white py-3 font-semibold disabled:opacity-50 shadow-lg shadow-accent/20"
          >
            {submitting ? 'Секунду…' : mode === 'signin' ? 'Войти' : 'Зарегистрироваться'}
          </button>
          {error && <p className="text-danger text-sm text-center">{error}</p>}
          {notice && <p className="text-muted text-sm text-center">{notice}</p>}
        </form>

        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
            setError(null);
            setNotice(null);
          }}
          className="text-muted text-sm underline text-center"
        >
          {mode === 'signin' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
        </button>
      </div>
    </main>
  );
}
