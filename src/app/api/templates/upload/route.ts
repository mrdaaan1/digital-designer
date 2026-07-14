import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { TEMPLATES_BUCKET } from '@/lib/storage/buckets';
import { runTemplateAnalysisJob } from '@/lib/pipeline/analyze-template-job';

export const runtime = 'nodejs';
export const maxDuration = 300; // анализ шаблона: рендер + LLM могут занять несколько минут

// Принимает multipart/form-data с полем "file" (.pptx) и опциональным "name".
// Создаёт запись templates, загружает файл в Storage, запускает анализ
// дизайн-системы синхронно (await) — для хакатон-масштаба этого достаточно,
// прогресс всё равно отслеживается через pipeline_jobs и polling на клиенте.
//
// Пишем через admin-клиент (service_role): вся цепочка анализа шаблона —
// системная фоновая операция, а не прямое действие пользователя от его лица,
// поэтому RLS-политики на template_design_systems/slide_patterns/pipeline_jobs
// сознательно ограничены только service_role (владение проверяется явно через
// owner_id, а не через RLS-контекст запроса).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const formData = await request.formData();
  const file = formData.get('file');
  const name = (formData.get('name') as string | null) ?? null;

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'Поле "file" обязательно (.pptx)' }, { status: 400 });
  }
  const originalFilename = (file as File).name ?? 'template.pptx';
  if (!originalFilename.toLowerCase().endsWith('.pptx')) {
    return NextResponse.json({ error: 'Поддерживаются только файлы .pptx' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const { data: templateRow, error: insertError } = await supabase
    .from('templates')
    .insert({
      owner_id: user.id,
      name: name || originalFilename.replace(/\.pptx$/i, ''),
      original_filename: originalFilename,
      storage_path: '', // заполним ниже после успешной загрузки
      status: 'uploaded',
    })
    .select('id')
    .single();
  if (insertError || !templateRow) {
    return NextResponse.json({ error: `Не удалось создать шаблон: ${insertError?.message}` }, { status: 500 });
  }

  const storagePath = `${user.id}/${templateRow.id}/original.pptx`;
  const { error: uploadError } = await admin.storage.from(TEMPLATES_BUCKET).upload(storagePath, buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    upsert: true,
  });
  if (uploadError) {
    await admin.from('templates').delete().eq('id', templateRow.id);
    return NextResponse.json({ error: `Не удалось загрузить файл: ${uploadError.message}` }, { status: 500 });
  }

  await admin.from('templates').update({ storage_path: storagePath, status: 'analyzing' }).eq('id', templateRow.id);

  const { data: jobRow, error: jobError } = await admin
    .from('pipeline_jobs')
    .insert({ job_type: 'template_analysis', template_id: templateRow.id, status: 'queued', progress: 0 })
    .select('id')
    .single();
  if (jobError || !jobRow) {
    return NextResponse.json({ error: `Не удалось создать задачу анализа: ${jobError?.message}` }, { status: 500 });
  }

  // Vercel serverless-функции не гарантируют работу кода после отправки ответа
  // (нет фоновых воркеров) — поэтому дожидаемся анализа здесь же, в пределах
  // maxDuration. Прогресс всё равно обновляется в pipeline_jobs по шагам,
  // так что клиент может параллельно опрашивать статус, если запрос долгий.
  try {
    await runTemplateAnalysisJob(admin, templateRow.id, jobRow.id);
  } catch (err) {
    console.error('template analysis job failed', err);
  }

  return NextResponse.json({ templateId: templateRow.id, jobId: jobRow.id });
}
