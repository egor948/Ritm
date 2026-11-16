// Edge Function: раз в минуту (pg_cron) отправляет push по наступившим напоминаниям.
// Деплой: supabase functions deploy send-reminders --no-verify-jwt
// Секреты: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com), CRON_SECRET
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(async (req) => {
  if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

  const now = new Date();
  const stale = new Date(now.getTime() - 6 * 3600 * 1000).toISOString();

  // слишком старые (сервер был недоступен) — просто закрываем, чтобы не присылать «вчерашнее»
  await sb.from('reminders').update({ sent: true }).eq('sent', false).lt('fire_at', stale);

  const { data: due, error } = await sb
    .from('reminders').select('*')
    .eq('sent', false).lte('fire_at', now.toISOString()).gte('fire_at', stale)
    .limit(200);
  if (error) return new Response(error.message, { status: 500 });
  if (!due || !due.length) return Response.json({ sent: 0 });

  const users = [...new Set(due.map((r) => r.user_id))];
  const { data: subs } = await sb.from('push_subscriptions').select('*').in('user_id', users);
  const byUser = new Map<string, typeof subs>();
  for (const s of subs ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  let sent = 0;
  const dead: { user_id: string; endpoint: string }[] = [];
  await Promise.all(due.map(async (r) => {
    const payload = JSON.stringify({ title: r.title, body: r.body ?? '', tag: r.tag ?? r.id, url: r.url ?? '#/today' });
    for (const s of byUser.get(r.user_id) ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push({ user_id: s.user_id, endpoint: s.endpoint });
        else console.error('push failed', code, (e as Error).message);
      }
    }
  }));

  await sb.from('reminders').update({ sent: true }).in('id', due.map((r) => r.id)).in('user_id', users);
  for (const d of dead) await sb.from('push_subscriptions').delete().eq('user_id', d.user_id).eq('endpoint', d.endpoint);

  return Response.json({ due: due.length, sent, removedSubscriptions: dead.length });
});
