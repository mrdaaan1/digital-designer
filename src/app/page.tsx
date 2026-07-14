'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthGate } from '@/components/AuthGate';
import { useAuth } from '@/lib/auth-context';
import type { TemplateSummary, TemplateStatus } from '@/lib/types';

const STATUS_LABELS: Record<TemplateStatus, string> = {
  uploaded: 'Загружен',
  analyzing: 'Анализ дизайн-системы…',
  ready: 'Готов',
  failed: 'Ошибка анализа',
};

const STATUS_COLORS: Record<TemplateStatus, string> = {
  uploaded: 'text-muted',
  analyzing: 'text-accent',
  ready: 'text-success',
  failed: 'text-danger',
};

function HomeContent() {
  const { supabase } = useAuth();
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTemplates = useCallback(async () => {
    const res = await fetch('/api/templates');
    if (res.ok) {
      const data = await res.json();
      setTemplates(data.templates ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Пока хотя бы один шаблон в статусе "analyzing" — обновляем список раз в 3с,
  // чтобы карточка сама переключилась на "Готов" без ручного refresh.
  useEffect(() => {
    if (!templates.some((t) => t.status === 'analyzing')) return;
    const interval = setInterval(loadTemplates, 3000);
    return () => clearInterval(interval);
  }, [templates, loadTemplates]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      setUploadError('Поддерживаются только файлы .pptx');
      return;
    }

    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', file.name.replace(/\.pptx$/i, ''));

    const res = await fetch('/api/templates/upload', { method: 'POST', body: formData });
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setUploadError(data.error ?? 'Не удалось загрузить шаблон');
      return;
    }

    const data = await res.json();
    router.push(`/templates/${data.templateId}`);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-10 flex flex-col gap-8">
      <header className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="font-display text-2xl font-extrabold">Цифровой дизайнер презентаций</h1>
          <p className="text-muted text-sm mt-1">Загрузите шаблон — остальное сделает AI</p>
        </div>
        <button onClick={handleSignOut} className="text-muted text-sm underline">
          Выйти
        </button>
      </header>

      <section className="card-elevated rounded-2xl p-6 animate-fade-in-up">
        <h2 className="font-semibold text-lg mb-1">Новый шаблон</h2>
        <p className="text-muted text-sm mb-4">
          Загрузите .pptx — сервис разберёт его дизайн-систему: палитру, типографику и паттерны слайдов,
          чтобы затем автоматически собирать в этом стиле новые презентации.
        </p>
        <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-card-border py-10 cursor-pointer hover:border-accent transition-colors">
          <span className="text-3xl">📊</span>
          <span className="text-sm font-medium">{uploading ? 'Загрузка и анализ…' : 'Выбрать файл .pptx'}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pptx"
            className="hidden"
            disabled={uploading}
            onChange={handleFileChange}
          />
        </label>
        {uploadError && <p className="text-danger text-sm mt-3">{uploadError}</p>}
      </section>

      <section className="flex flex-col gap-3 animate-fade-in-up">
        <h2 className="font-semibold text-lg">Ваши шаблоны</h2>
        {loading && <p className="text-muted text-sm">Загрузка…</p>}
        {!loading && templates.length === 0 && (
          <p className="text-muted text-sm">Пока нет ни одного шаблона — загрузите первый выше.</p>
        )}
        <div className="flex flex-col gap-2">
          {templates.map((template) => (
            <Link
              key={template.id}
              href={`/templates/${template.id}`}
              className="card-elevated card-elevated-interactive rounded-xl px-4 py-3 flex items-center justify-between"
            >
              <span className="font-medium">{template.name}</span>
              <span className={`text-sm ${STATUS_COLORS[template.status]}`}>{STATUS_LABELS[template.status]}</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

export default function HomePage() {
  return (
    <AuthGate>
      <HomeContent />
    </AuthGate>
  );
}
