import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
    .select('id, title, status, error_message, result_storage_path')
    .eq('id', id)
    .single();
  if (presentationError || !presentation) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: job } = await supabase
    .from('pipeline_jobs')
    .select('status, step, progress, error_message')
    .eq('presentation_id', id)
    .eq('job_type', 'presentation_generation')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ presentation, job });
}
