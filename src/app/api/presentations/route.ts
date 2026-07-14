import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PRESENTATIONS_BUCKET } from '@/lib/storage/buckets';
import { runPresentationGenerationJob } from '@/lib/pipeline/generate-presentation-job';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: presentations, error } = await supabase
    .from('presentations')
    .select('id, title, status, created_at, template_id, templates(name)')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ presentations });
}

// Создаёт презентацию по брифу пользователя и уже готовой дизайн-системе шаблона.
// Принимает multipart/form-data: templateId, contentBrief, опционально contentFile.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const formData = await request.formData();
  const templateId = formData.get('templateId') as string | null;
  const contentBrief = (formData.get('contentBrief') as string | null)?.trim();
  const contentFile = formData.get('contentFile');

  if (!templateId) return NextResponse.json({ error: 'templateId обязателен' }, { status: 400 });
  if (!contentBrief) return NextResponse.json({ error: 'contentBrief обязателен' }, { status: 400 });

  const { data: template, error: templateError } = await supabase
    .from('templates')
    .select('id, status, owner_id')
    .eq('id', templateId)
    .single();
  if (templateError || !template) return NextResponse.json({ error: 'Шаблон не найден' }, { status: 404 });
  if (template.status !== 'ready') {
    return NextResponse.json({ error: 'Дизайн-система шаблона ещё не готова' }, { status: 409 });
  }

  const { data: presentationRow, error: insertError } = await supabase
    .from('presentations')
    .insert({
      owner_id: user.id,
      template_id: templateId,
      title: 'Новая презентация',
      content_brief: contentBrief,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertError || !presentationRow) {
    return NextResponse.json({ error: `Не удалось создать презентацию: ${insertError?.message}` }, { status: 500 });
  }

  if (contentFile instanceof Blob && (contentFile as File).name) {
    const buffer = Buffer.from(await contentFile.arrayBuffer());
    const path = `${user.id}/${presentationRow.id}/content-source`;
    const { error: uploadError } = await supabase.storage.from(PRESENTATIONS_BUCKET).upload(path, buffer, {
      upsert: true,
    });
    if (!uploadError) {
      await supabase.from('presentations').update({ content_file_storage_path: path }).eq('id', presentationRow.id);
    }
  }

  const { data: jobRow, error: jobError } = await supabase
    .from('pipeline_jobs')
    .insert({ job_type: 'presentation_generation', presentation_id: presentationRow.id, status: 'queued', progress: 0 })
    .select('id')
    .single();
  if (jobError || !jobRow) {
    return NextResponse.json({ error: `Не удалось создать задачу генерации: ${jobError?.message}` }, { status: 500 });
  }

  try {
    await runPresentationGenerationJob(supabase, presentationRow.id, jobRow.id);
  } catch (err) {
    console.error('presentation generation job failed', err);
  }

  return NextResponse.json({ presentationId: presentationRow.id, jobId: jobRow.id });
}
