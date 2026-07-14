import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PRESENTATIONS_BUCKET } from '@/lib/storage/buckets';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: presentation, error: presentationError } = await supabase
    .from('presentations')
    .select('title, status, result_storage_path')
    .eq('id', id)
    .single();
  if (presentationError || !presentation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (presentation.status !== 'ready' || !presentation.result_storage_path) {
    return NextResponse.json({ error: 'Презентация ещё не готова' }, { status: 409 });
  }

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from(PRESENTATIONS_BUCKET)
    .download(presentation.result_storage_path);
  if (downloadError || !fileBlob) {
    return NextResponse.json({ error: `Не удалось скачать файл: ${downloadError?.message}` }, { status: 500 });
  }

  const arrayBuffer = await fileBlob.arrayBuffer();
  const filename = `${presentation.title.replace(/[^\p{L}\p{N}\s-]/gu, '').trim() || 'presentation'}.pptx`;

  return new NextResponse(arrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
