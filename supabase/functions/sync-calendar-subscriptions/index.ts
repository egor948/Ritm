import { createClient } from 'npm:@supabase/supabase-js@2';
import { decryptCalendarUrl, fetchCalendarIcs } from '../_shared/calendar-sync.ts';

const env = (key: string) => Deno.env.get(key) ?? '';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Row = {
  id: string; user_id: string; encrypted_url: string; url_iv: string;
  etag: string | null; last_modified: string | null;
};

Deno.serve(async (req) => {
  const secret = env('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 });

  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CALENDAR_ENCRYPTION_KEY'];
  const missing = required.filter((key) => !env(key));
  if (missing.length) return json({ error: 'Missing server configuration', missing }, 500);

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const cutoff = new Date(Date.now() - 12 * 60 * 1000).toISOString();
  const { data: rows, error } = await admin.from('calendar_subscriptions')
    .select('id,user_id,encrypted_url,url_iv,etag,last_modified')
    .eq('enabled', true).or('last_sync_at.is.null,last_sync_at.lt.' + cutoff)
    .order('last_sync_at', { ascending: true, nullsFirst: true }).limit(100);
  if (error) {
    console.error('Calendar subscription query failed:', error.message);
    return json({ error: 'Could not load calendar subscriptions.' }, 500);
  }

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  for (const row of (rows || []) as Row[]) {
    try {
      const url = await decryptCalendarUrl(row.encrypted_url, row.url_iv);
      const result = await fetchCalendarIcs(url, { etag: row.etag, lastModified: row.last_modified });
      const patch = {
        last_sync_at: new Date().toISOString(),
        last_status: 'ok',
        last_error: null,
        ...(result.changed ? {
          ics_content: result.content,
          etag: result.etag,
          last_modified: result.lastModified,
        } : {}),
      };
      const { error: updateError } = await admin.from('calendar_subscriptions')
        .update(patch).eq('id', row.id).eq('user_id', row.user_id);
      if (updateError) throw new Error(updateError.message);
      if (result.changed) updated++; else unchanged++;
    } catch (error) {
      failed++;
      const message = (error instanceof Error ? error.message : 'Ошибка синхронизации').slice(0, 400);
      const { error: updateError } = await admin.from('calendar_subscriptions')
        .update({ last_sync_at: new Date().toISOString(), last_status: 'error', last_error: message })
        .eq('id', row.id).eq('user_id', row.user_id);
      if (updateError) console.error('Could not record calendar sync error:', updateError.message);
    }
  }

  return json({ checked: (rows || []).length, updated, unchanged, failed });
});
