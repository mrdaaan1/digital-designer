'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthGate } from '@/components/AuthGate';
import type { JobStatus, SlidePatternSummary, TemplateStatus } from '@/lib/types';

type TemplateStatusResponse = {
  template: { id: string; name: string; status: TemplateStatus; error_message: string | null };
  job: JobStatus;
  patterns: SlidePatternSummary[];
};

function TemplateContent({ templateId }: { templateId: string }) {
  const router = useRouter();
  const [data, setData] = useState<TemplateStatusResponse | null>(null);
  const [contentBrief, setContentBrief] = useState('');
  const [contentFile, setContentFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/templates/${templateId}/status`);
    if (res.ok) setData(await res.json());
  }, [templateId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (data?.template.status !== 'analyzing') return;
    const interval = setInterval(load, 2500);
    return () => clearInterval(interval);
  }, [data, load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contentBrief.trim()) return;

    setSubmitting(true);
    setSubmitError(null);

    const formData = new FormData();
    formData.append('templateId', templateId);
    formData.append('contentBrief', contentBrief.trim());
    if (contentFile) formData.append('contentFile', contentFile);

    const res = await fetch('/api/presentations', { method: 'POST', body: formData });
    setSubmitting(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setSubmitError(err.error ?? 'Не удалось запустить генерацию');
      return;
    }

    const result = await res.json();
    router.push(`/presentations/${result.presentationId}`);
  }

  if (!data) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-muted">Загрузка…</p>
      </main>
    );
  }

  const { template, job, patterns } = data;

  return (
    <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-10 flex flex-col gap-8">
      <header className="animate-fade-in-up">
        <Link href="/" className="text-muted text-sm underline">
          ← Все шаблоны
        </Link>
        <h1 className="font-display text-2xl font-extrabold mt-2">{template.name}</h1>
      </header>

      {template.status === 'analyzing' && (
        <section className="card-elevated rounded-2xl p-6 animate-fade-in-up">
          <h2 className="font-semibold mb-3">Анализирую дизайн-систему шаблона…</h2>
          <div className="w-full h-2 rounded-full bg-accent-soft overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-500"
              style={{ width: `${job?.progress ?? 0}%` }}
            />
          </div>
          <p className="text-muted text-sm mt-2">{job?.step ?? 'Подготовка…'}</p>
        </section>
      )}

      {template.status === 'failed' && (
        <section className="card-elevated rounded-2xl p-6 border-danger animate-fade-in-up">
          <h2 className="font-semibold text-danger mb-2">Не удалось разобрать шаблон</h2>
          <p className="text-muted text-sm">{template.error_message ?? job?.error_message}</p>
        </section>
      )}

      {template.status === 'ready' && (
        <>
          <section className="card-elevated rounded-2xl p-6 animate-fade-in-up">
            <h2 className="font-semibold mb-3">Найденные паттерны слайдов ({patterns.length})</h2>
            <div className="grid sm:grid-cols-2 gap-2">
              {patterns.map((p) => (
                <div key={p.pattern_key} className="rounded-lg bg-accent-soft px-3 py-2">
                  <p className="font-medium text-sm">{p.label}</p>
                  {p.description && <p className="text-muted text-xs mt-0.5">{p.description}</p>}
                </div>
              ))}
            </div>
          </section>

          <section className="card-elevated rounded-2xl p-6 animate-fade-in-up">
            <h2 className="font-semibold text-lg mb-1">Новая презентация</h2>
            <p className="text-muted text-sm mb-4">
              Опишите продукт, тезисы и данные — AI разложит контент по слайдам в стиле этого шаблона.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <textarea
                required
                rows={8}
                placeholder="Например: продукт X решает проблему Y для аудитории Z. Ключевые метрики: ... Этапы плана: ..."
                value={contentBrief}
                onChange={(e) => setContentBrief(e.target.value)}
                className="rounded-xl border border-card-border bg-card px-4 py-3 text-base outline-none focus:border-accent transition-colors resize-y"
              />
              <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
                <span className="underline">Приложить файл с контентом (опционально)</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setContentFile(e.target.files?.[0] ?? null)}
                />
                {contentFile && <span>{contentFile.name}</span>}
              </label>
              <button
                type="submit"
                disabled={submitting || !contentBrief.trim()}
                className="rounded-xl bg-accent hover:bg-accent-dark transition-colors text-white py-3 font-semibold disabled:opacity-50 shadow-lg shadow-accent/20"
              >
                {submitting ? 'Собираю презентацию…' : 'Сгенерировать презентацию'}
              </button>
              {submitError && <p className="text-danger text-sm">{submitError}</p>}
            </form>
          </section>
        </>
      )}
    </main>
  );
}

export default function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AuthGate>
      <TemplateContent templateId={id} />
    </AuthGate>
  );
}
