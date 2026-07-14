import { writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
config({ path: '.env.local' });

// Проверяет, что пользователь без своих шаблонов может сгенерировать
// презентацию по общему (публичному) шаблону сервиса на реальном проде.

const BASE_URL = process.argv[2] ?? 'https://digital-designer-39i1.vercel.app';
const EMAIL = 'mrdaaan1+public-test@gmail.com';
const PASSWORD = 'TestPass123456';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const MAX_CHUNK_SIZE = 3180;

function buildAuthCookies(session: unknown): string {
  const name = `sb-${PROJECT_REF}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf-8').toString('base64url')}`;
  if (value.length <= MAX_CHUNK_SIZE) return `${name}=${value}`;
  const chunks: string[] = [];
  for (let i = 0; i * MAX_CHUNK_SIZE < value.length; i++) {
    chunks.push(`${name}.${i}=${value.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE)}`);
  }
  return chunks.join('; ');
}

async function main() {
  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const session = await loginRes.json();
  const cookie = buildAuthCookies(session);

  const templatesRes = await fetch(`${BASE_URL}/api/templates`, { headers: { cookie } });
  const templatesJson = await templatesRes.json();
  const publicTemplate = templatesJson.publicTemplates?.[0];
  if (!publicTemplate) throw new Error('нет публичных шаблонов');
  console.log('используем публичный шаблон:', publicTemplate.name, publicTemplate.id);

  const brief = `Продукт: онлайн-курс по личным финансам для начинающих.
Проблема: люди не умеют планировать бюджет и попадают в долги.
Решение: 6-недельный курс с практическими заданиями и трекером расходов.
Метрики: 3000 выпускников, 85% отмечают улучшение финансовой дисциплины.`;

  const genForm = new FormData();
  genForm.append('templateId', publicTemplate.id);
  genForm.append('contentBrief', brief);

  const genRes = await fetch(`${BASE_URL}/api/presentations`, { method: 'POST', headers: { cookie }, body: genForm });
  const genJson = await genRes.json();
  if (!genRes.ok) throw new Error(`generation failed: ${genRes.status} ${JSON.stringify(genJson)}`);
  console.log('presentationId:', genJson.presentationId);

  const statusRes = await fetch(`${BASE_URL}/api/presentations/${genJson.presentationId}/status`, { headers: { cookie } });
  const statusJson = await statusRes.json();
  console.log('status:', statusJson.presentation?.status, '| title:', statusJson.presentation?.title);
  if (statusJson.presentation?.status !== 'ready') {
    throw new Error(`не готово: ${JSON.stringify(statusJson)}`);
  }

  const downloadRes = await fetch(`${BASE_URL}/api/presentations/${genJson.presentationId}/download`, { headers: { cookie } });
  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  await writeFile('/tmp/public-template-result.pptx', buffer);
  console.log('скачано, размер:', buffer.length);
  console.log('\nOK: генерация по публичному шаблону работает ✅');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
