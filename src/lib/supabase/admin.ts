import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Клиент с service_role — используется только на сервере (API routes,
// фоновые pipeline-шаги), обходит RLS. Никогда не импортировать в клиентский код.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
