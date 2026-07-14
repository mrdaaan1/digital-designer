import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Возвращаем собственные шаблоны пользователя и общие ("витринные") шаблоны
  // сервиса — так пользователь без своего .pptx всё равно может сгенерировать
  // презентацию по одному из готовых стилей.
  const [ownResult, publicResult] = await Promise.all([
    supabase
      .from('templates')
      .select('id, name, status, created_at, is_public')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('templates')
      .select('id, name, status, created_at, is_public')
      .eq('is_public', true)
      .order('created_at', { ascending: false }),
  ]);

  if (ownResult.error) return NextResponse.json({ error: ownResult.error.message }, { status: 500 });
  if (publicResult.error) return NextResponse.json({ error: publicResult.error.message }, { status: 500 });

  return NextResponse.json({
    templates: ownResult.data ?? [],
    publicTemplates: publicResult.data ?? [],
  });
}
