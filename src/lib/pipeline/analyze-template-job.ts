import type { SupabaseClient } from '@supabase/supabase-js';
import { parseTemplate } from '../pptx/parse-template';
import { analyzeDesignSystem } from '../llm/analyze-design-system';
import { renderPptxToPng } from './render-client';
import { TEMPLATES_BUCKET } from '../storage/buckets';

// Полный цикл анализа шаблона: скачать .pptx из Storage -> распарсить XML ->
// отрендерить слайды в PNG (render-service) -> LLM-анализ дизайн-системы ->
// сохранить design system + slide patterns в БД. Прогресс пишется в
// pipeline_jobs, чтобы UI мог показывать статус.

async function updateJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: { status?: string; step?: string; progress?: number; error_message?: string | null },
) {
  await supabase.from('pipeline_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId);
}

export async function runTemplateAnalysisJob(
  supabase: SupabaseClient,
  templateId: string,
  jobId: string,
): Promise<void> {
  try {
    await updateJob(supabase, jobId, { status: 'running', step: 'Скачивание шаблона', progress: 5 });

    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select('id, storage_path')
      .eq('id', templateId)
      .single();
    if (templateError || !template) throw new Error('Шаблон не найден');

    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from(TEMPLATES_BUCKET)
      .download(template.storage_path);
    if (downloadError || !fileBlob) throw new Error(`Не удалось скачать шаблон: ${downloadError?.message}`);

    const arrayBuffer = await fileBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await updateJob(supabase, jobId, { step: 'Разбор структуры .pptx', progress: 20 });
    const parsed = await parseTemplate(buffer);

    await updateJob(supabase, jobId, { step: 'Рендер слайдов для визуального анализа', progress: 35 });
    const slidePngsBase64 = await renderPptxToPng(buffer);

    await updateJob(supabase, jobId, { step: 'LLM-анализ дизайн-системы', progress: 55 });
    const analysis = await analyzeDesignSystem(parsed, slidePngsBase64);

    await updateJob(supabase, jobId, { step: 'Сохранение дизайн-системы', progress: 85 });

    await supabase.from('template_design_systems').upsert(
      {
        template_id: templateId,
        theme: parsed.theme,
        typography: analysis.typography,
        color_roles: analysis.paletteRoles,
        spacing: analysis.spacingScale,
        raw_analysis: analysis,
      },
      { onConflict: 'template_id' },
    );

    const patternRows = analysis.slidePatterns.map((pattern) => {
      const sourceSlide = parsed.slides.find((s) => s.index === pattern.sourceSlideIndex);
      return {
        template_id: templateId,
        pattern_key: pattern.patternKey,
        label: pattern.label,
        description: pattern.description,
        source_slide_index: pattern.sourceSlideIndex,
        layout_xml_path: sourceSlide?.layoutIndex ? `ppt/slideLayouts/slideLayout${sourceSlide.layoutIndex}.xml` : null,
        placeholders: pattern.placeholderRoles,
      };
    });

    await supabase.from('slide_patterns').delete().eq('template_id', templateId);
    await supabase.from('slide_patterns').insert(patternRows);

    await supabase
      .from('templates')
      .update({
        status: 'ready',
        slide_width_emu: parsed.slideWidthEmu,
        slide_height_emu: parsed.slideHeightEmu,
      })
      .eq('id', templateId);

    await updateJob(supabase, jobId, { status: 'succeeded', step: 'Готово', progress: 100 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from('templates').update({ status: 'failed', error_message: message }).eq('id', templateId);
    await updateJob(supabase, jobId, { status: 'failed', error_message: message });
  }
}
