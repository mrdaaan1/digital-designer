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

  const { data: template, error: templateError } = await supabase
    .from('templates')
    .select('id, name, status, error_message')
    .eq('id', id)
    .single();
  if (templateError || !template) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: job } = await supabase
    .from('pipeline_jobs')
    .select('status, step, progress, error_message')
    .eq('template_id', id)
    .eq('job_type', 'template_analysis')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let patterns: { pattern_key: string; label: string; description: string | null }[] = [];
  if (template.status === 'ready') {
    const { data } = await supabase
      .from('slide_patterns')
      .select('pattern_key, label, description')
      .eq('template_id', id);
    patterns = data ?? [];
  }

  return NextResponse.json({ template, job, patterns });
}
