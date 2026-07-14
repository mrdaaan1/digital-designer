'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AuthGate } from '@/components/AuthGate';
import type { JobStatus, PresentationStatus } from '@/lib/types';

type PresentationStatusResponse = {
  presentation: {
    id: string;
    title: string;
    status: PresentationStatus;
    error_message: string | null;
    result_storage_path: string | null;
  };
  job: JobStatus;
};

const STEP_LABELS: Record<PresentationStatus, string> = {
  pending: 'В очереди…',
  planning: 'AI распределяет контент по слайдам…',
  generating: 'Собираю итоговый файл…',
  rendering: 'Финальная сборка…',
  ready: 'Готово',
  failed: 'Ошибка',
};

function PresentationContent({ presentationId }: { presentationId: string }) {
  const [data, setData] = useState<PresentationStatusResponse | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/presentations/${presentationId}/status`);
    if (res.ok) setData(await res.json());
  }, [presentationId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const status = data?.presentation.status;
    if (status === 'ready' || status === 'failed') return;
    const interval = setInterval(load, 2500);
    return () => clearInterval(interval);
  }, [data, load]);

  if (!data) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-muted">Загрузка…</p>
      </main>
    );
  }

  const { presentation, job } = data;
  const isDone = presentation.status === 'ready';
  const isFailed = presentation.status === 'failed';

  return (
    <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-10 flex flex-col gap-6">
      <header className="animate-fade-in-up">
        <Link href="/" className="text-muted text-sm underline">
          ← Все шаблоны
        </Link>
        <h1 className="font-display text-2xl font-extrabold mt-2">{presentation.title}</h1>
      </header>

      <section className="card-elevated rounded-2xl p-6 animate-fade-in-up">
        {!isDone && !isFailed && (
          <>
            <h2 className="font-semibold mb-3">{STEP_LABELS[presentation.status]}</h2>
            <div className="w-full h-2 rounded-full bg-accent-soft overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-500"
                style={{ width: `${job?.progress ?? 0}%` }}
              />
            </div>
            <p className="text-muted text-sm mt-2">{job?.step ?? 'Подготовка…'}</p>
          </>
        )}

        {isFailed && (
          <>
            <h2 className="font-semibold text-danger mb-2">Не удалось собрать презентацию</h2>
            <p className="text-muted text-sm">{presentation.error_message ?? job?.error_message}</p>
          </>
        )}

        {isDone && (
          <div className="flex flex-col items-center gap-4 py-4 animate-scale-in">
            <span className="text-4xl">✅</span>
            <p className="font-semibold text-lg">Презентация готова</p>
            <a
              href={`/api/presentations/${presentationId}/download`}
              className="rounded-xl bg-accent hover:bg-accent-dark transition-colors text-white px-6 py-3 font-semibold shadow-lg shadow-accent/20"
            >
              Скачать .pptx
            </a>
          </div>
        )}
      </section>
    </main>
  );
}

export default function PresentationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AuthGate>
      <PresentationContent presentationId={id} />
    </AuthGate>
  );
}
