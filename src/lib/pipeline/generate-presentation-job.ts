import type { SupabaseClient } from '@supabase/supabase-js';
import { parseTemplate } from '../pptx/parse-template';
import { generateContentPlan } from '../llm/generate-content-plan';
import { buildPresentation } from '../pptx/generate-presentation';
import type { SlidePatternAnalysis } from '../llm/design-system-schema';
import { TEMPLATES_BUCKET, PRESENTATIONS_BUCKET } from '../storage/buckets';

async function updateJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: { status?: string; step?: string; progress?: number; error_message?: string | null },
) {
  await supabase.from('pipeline_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId);
}

// Полный цикл генерации: загрузить дизайн-систему шаблона -> LLM раскладывает
// бриф пользователя по паттернам -> клонируем XML слайдов-образцов с новым
// текстом -> сохраняем итоговый .pptx и записи слайдов в БД.
export async function runPresentationGenerationJob(
  supabase: SupabaseClient,
  presentationId: string,
  jobId: string,
): Promise<void> {
  try {
    await updateJob(supabase, jobId, { status: 'running', step: 'Загрузка презентации', progress: 5 });

    const { data: presentation, error: presentationError } = await supabase
      .from('presentations')
      .select('id, template_id, content_brief')
      .eq('id', presentationId)
      .single();
    if (presentationError || !presentation) throw new Error('Презентация не найдена');

    await supabase.from('presentations').update({ status: 'planning' }).eq('id', presentationId);

    const { data: patternRows, error: patternsError } = await supabase
      .from('slide_patterns')
      .select('id, pattern_key, label, description, source_slide_index, placeholders')
      .eq('template_id', presentation.template_id);
    if (patternsError || !patternRows || patternRows.length === 0) {
      throw new Error('Для этого шаблона ещё не построена дизайн-система');
    }

    const patterns: SlidePatternAnalysis[] = patternRows.map((row) => ({
      patternKey: row.pattern_key,
      label: row.label,
      description: row.description ?? '',
      sourceSlideIndex: row.source_slide_index,
      usageHint: row.description ?? '',
      placeholderRoles: row.placeholders,
    }));

    await updateJob(supabase, jobId, { step: 'LLM планирует слайды по брифу', progress: 25 });
    const plan = await generateContentPlan(patterns, presentation.content_brief);

    await supabase.from('presentations').update({ status: 'generating', title: plan.title }).eq('id', presentationId);
    await updateJob(supabase, jobId, { step: 'Сборка итогового .pptx', progress: 55 });

    const { data: templateRow, error: templateError } = await supabase
      .from('templates')
      .select('storage_path')
      .eq('id', presentation.template_id)
      .single();
    if (templateError || !templateRow) throw new Error('Исходный шаблон не найден');

    const { data: templateFileBlob, error: downloadError } = await supabase.storage
      .from(TEMPLATES_BUCKET)
      .download(templateRow.storage_path);
    if (downloadError || !templateFileBlob) throw new Error(`Не удалось скачать шаблон: ${downloadError?.message}`);

    const templateBuffer = Buffer.from(await templateFileBlob.arrayBuffer());
    const parsedTemplate = await parseTemplate(templateBuffer);

    const patternsByKey = new Map(patterns.map((p) => [p.patternKey, p]));
    const slidesByIndex = new Map(parsedTemplate.slides.map((s) => [s.index, s]));

    const resultBuffer = await buildPresentation({
      originalPptxBuffer: templateBuffer,
      contentPlan: plan,
      patternsByKey,
      slidesByIndex,
    });

    await updateJob(supabase, jobId, { step: 'Сохранение результата', progress: 90 });

    const resultPath = `${presentationId}/result.pptx`;
    const { error: uploadError } = await supabase.storage
      .from(PRESENTATIONS_BUCKET)
      .upload(resultPath, resultBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        upsert: true,
      });
    if (uploadError) throw new Error(`Не удалось сохранить результат: ${uploadError.message}`);

    const slideRows = plan.slides.map((slide, index) => {
      const patternRow = patternRows.find((p) => p.pattern_key === slide.patternKey);
      return {
        presentation_id: presentationId,
        position: index + 1,
        content: slide.content,
        notes: slide.notes,
        pattern_id: patternRow?.id ?? null,
      };
    });

    await supabase.from('presentation_slides').delete().eq('presentation_id', presentationId);
    await supabase.from('presentation_slides').insert(slideRows);

    await supabase
      .from('presentations')
      .update({ status: 'ready', result_storage_path: resultPath })
      .eq('id', presentationId);

    await updateJob(supabase, jobId, { status: 'succeeded', step: 'Готово', progress: 100 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from('presentations').update({ status: 'failed', error_message: message }).eq('id', presentationId);
    await updateJob(supabase, jobId, { status: 'failed', error_message: message });
  }
}
