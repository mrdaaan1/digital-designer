import { readFile } from 'node:fs/promises';
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createAdminClient } from '../src/lib/supabase/admin';
import { TEMPLATES_BUCKET } from '../src/lib/storage/buckets';
import { runTemplateAnalysisJob } from '../src/lib/pipeline/analyze-template-job';

// Загружает готовые ("витринные") шаблоны для пользователей без своего .pptx.
// Работает напрямую через service_role, минуя auth и HTTP — запускается один
// раз при подготовке продакшена (или при добавлении нового готового стиля).
//
// Использование: npx tsx scripts/seed-public-templates.ts <name> <path.pptx>

async function main() {
  const name = process.argv[2];
  const path = process.argv[3];
  if (!name || !path) {
    console.error('Использование: tsx scripts/seed-public-templates.ts <name> <path-to.pptx>');
    process.exit(1);
  }

  const admin = createAdminClient();
  const buffer = await readFile(path);

  const { data: templateRow, error: insertError } = await admin
    .from('templates')
    .insert({
      owner_id: null,
      name,
      original_filename: path.split('/').pop() ?? 'template.pptx',
      storage_path: '',
      status: 'uploaded',
      is_public: true,
    })
    .select('id')
    .single();
  if (insertError || !templateRow) throw new Error(`insert failed: ${insertError?.message}`);

  const storagePath = `_public/${templateRow.id}/original.pptx`;
  const { error: uploadError } = await admin.storage.from(TEMPLATES_BUCKET).upload(storagePath, buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    upsert: true,
  });
  if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

  await admin.from('templates').update({ storage_path: storagePath, status: 'analyzing' }).eq('id', templateRow.id);

  const { data: jobRow, error: jobError } = await admin
    .from('pipeline_jobs')
    .insert({ job_type: 'template_analysis', template_id: templateRow.id, status: 'queued', progress: 0 })
    .select('id')
    .single();
  if (jobError || !jobRow) throw new Error(`job insert failed: ${jobError?.message}`);

  console.log(`Анализирую шаблон "${name}" (templateId=${templateRow.id})...`);
  await runTemplateAnalysisJob(admin, templateRow.id, jobRow.id);

  const { data: finalTemplate } = await admin.from('templates').select('status, error_message').eq('id', templateRow.id).single();
  console.log('Готово:', finalTemplate);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
