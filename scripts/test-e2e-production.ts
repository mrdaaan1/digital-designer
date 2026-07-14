import { readFile, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
config({ path: '.env.local' });

// End-to-end тест продакшен-деплоя: логин -> загрузка шаблона (анализ) ->
// генерация презентации -> скачивание готового .pptx. Работает через те же
// HTTP-эндпоинты, что и браузерный UI, эмулируя auth-cookie @supabase/ssr.

const BASE_URL = process.argv[2] ?? 'https://digital-designer-39i1.vercel.app';
const TEMPLATE_PATH = process.argv[3] ?? '/Users/daniil/Downloads/Sber_AI_Hack_Project_Proposal.pptx';
const EMAIL = 'mrdaaan1+hackathon2@gmail.com';
const PASSWORD = 'TestPass123456';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];

// Формат хранения сессии в cookie у @supabase/ssr: "base64-" + base64url(JSON
// сессии), при длине > MAX_CHUNK_SIZE значение режется на чанки name.0, name.1...
const MAX_CHUNK_SIZE = 3180;

function toBase64Url(json: string): string {
  return Buffer.from(json, 'utf-8').toString('base64url');
}

function buildAuthCookies(session: unknown): string {
  const name = `sb-${PROJECT_REF}-auth-token`;
  const value = `base64-${toBase64Url(JSON.stringify(session))}`;
  if (value.length <= MAX_CHUNK_SIZE) {
    return `${name}=${value}`;
  }
  const chunks: string[] = [];
  for (let i = 0; i * MAX_CHUNK_SIZE < value.length; i++) {
    chunks.push(`${name}.${i}=${value.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE)}`);
  }
  return chunks.join('; ');
}

async function main() {
  console.log('1) логин в Supabase...');
  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status} ${await loginRes.text()}`);
  const session = await loginRes.json();
  const cookie = buildAuthCookies(session);
  console.log('   ok, cookie chunks:', cookie.split('; ').length);

  console.log('2) загрузка шаблона + анализ дизайн-системы (может занять минуты — LibreOffice+LLM)...');
  const templateBuffer = await readFile(TEMPLATE_PATH);
  const uploadForm = new FormData();
  uploadForm.append(
    'file',
    new Blob([new Uint8Array(templateBuffer)], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }),
    'e2e-template.pptx',
  );
  uploadForm.append('name', 'E2E тестовый шаблон');

  const uploadRes = await fetch(`${BASE_URL}/api/templates/upload`, {
    method: 'POST',
    headers: { cookie },
    body: uploadForm,
  });
  const uploadJson = await uploadRes.json();
  if (!uploadRes.ok) throw new Error(`upload failed: ${uploadRes.status} ${JSON.stringify(uploadJson)}`);
  console.log('   templateId:', uploadJson.templateId);

  console.log('3) статус шаблона...');
  const statusRes = await fetch(`${BASE_URL}/api/templates/${uploadJson.templateId}/status`, {
    headers: { cookie },
  });
  const statusJson = await statusRes.json();
  console.log('   template status:', statusJson.template?.status, '| job:', statusJson.job?.status, statusJson.job?.step);
  if (statusJson.template?.status !== 'ready') {
    throw new Error(`анализ не завершился: ${JSON.stringify(statusJson)}`);
  }
  console.log('   паттерны:', statusJson.patterns.map((p: { pattern_key: string }) => p.pattern_key).join(', '));

  console.log('4) генерация презентации по брифу...');
  const brief = `Продукт: сервис доставки готовой еды "ОбедВдом" для офисных сотрудников.
Проблема: сотрудники тратят 40+ минут в день на поиск обеда, офисные кухни перегружены.
Решение: подписка на ежедневную доставку сбалансированных обедов точно к обеденному перерыву.
Метрики: 12 000 активных подписчиков, средний чек 450 руб, retention 78% на 3-й месяц.
План: запуск в 5 новых городах в 2027, партнёрство с бизнес-центрами.
Команда: основатели с опытом в фудтехе и логистике.`;

  const genForm = new FormData();
  genForm.append('templateId', uploadJson.templateId);
  genForm.append('contentBrief', brief);

  const genRes = await fetch(`${BASE_URL}/api/presentations`, {
    method: 'POST',
    headers: { cookie },
    body: genForm,
  });
  const genJson = await genRes.json();
  if (!genRes.ok) throw new Error(`generation failed: ${genRes.status} ${JSON.stringify(genJson)}`);
  console.log('   presentationId:', genJson.presentationId);

  console.log('5) статус презентации...');
  const presStatusRes = await fetch(`${BASE_URL}/api/presentations/${genJson.presentationId}/status`, {
    headers: { cookie },
  });
  const presStatusJson = await presStatusRes.json();
  console.log('   status:', presStatusJson.presentation?.status, '| title:', presStatusJson.presentation?.title);
  if (presStatusJson.presentation?.status !== 'ready') {
    throw new Error(`генерация не завершилась: ${JSON.stringify(presStatusJson)}`);
  }

  console.log('6) скачивание готового .pptx...');
  const downloadRes = await fetch(`${BASE_URL}/api/presentations/${genJson.presentationId}/download`, {
    headers: { cookie },
  });
  if (!downloadRes.ok) throw new Error(`download failed: ${downloadRes.status}`);
  const resultBuffer = Buffer.from(await downloadRes.arrayBuffer());
  await writeFile('/tmp/e2e-result.pptx', resultBuffer);
  console.log('   сохранено /tmp/e2e-result.pptx, размер:', resultBuffer.length);

  console.log('\nE2E ТЕСТ ПРОЙДЕН ✅');
}

main().catch((err) => {
  console.error('E2E FAILED:', err);
  process.exit(1);
});
