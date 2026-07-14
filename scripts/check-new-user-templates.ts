import { config } from 'dotenv';
config({ path: '.env.local' });

// Проверяет, что пользователь без своих шаблонов видит публичные шаблоны
// через реальный API продакшена.

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

  const res = await fetch(`${BASE_URL}/api/templates`, { headers: { cookie } });
  const json = await res.json();
  console.log('own templates:', json.templates?.length ?? 0);
  console.log('public templates:', json.publicTemplates?.length ?? 0);
  for (const t of json.publicTemplates ?? []) {
    console.log('  -', t.name, '| status:', t.status, '| id:', t.id);
  }

  if (!json.publicTemplates || json.publicTemplates.length === 0) {
    throw new Error('Новый пользователь не видит публичные шаблоны!');
  }
  console.log('\nOK: новый пользователь без своих шаблонов видит готовые стили ✅');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
