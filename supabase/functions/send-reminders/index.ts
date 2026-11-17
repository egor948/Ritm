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

  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
  const missing = required.filter((name) => !env(name));
  if (missing.length) {
    console.error('Missing Edge Function secrets:', missing.join(', '));
    return Response.json({ error: 'Missing server configuration', missing }, { status: 500 });
  }

  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  try {
    webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  } catch (e) {
    console.error('VAPID configuration error:', (e as Error).message);
    return Response.json({ error: 'Invalid VAPID configuration' }, { status: 500 });
  }

  const now = new Date();
  const stale = new Date(now.getTime() - 6 * 3600 * 1000).toISOString();

  // Слишком старые напоминания (сервер был недоступен) закрываем,
  // чтобы не присылать уведомления за прошедший день.
  const { error: staleError } = await sb.from('reminders')
    .update({ sent: true }).eq('sent', false).lt('fire_at', stale);
  if (staleError) {
    console.error('Could not close stale reminders:', staleError.message);
    return Response.json({ error: 'Could not process stale reminders' }, { status: 500 });
  }

  const { data: due, error } = await sb
    .from('reminders').select('*')
    .eq('sent', false).lte('fire_at', now.toISOString()).gte('fire_at', stale)
    .limit(200);
  if (error) return new Response(error.message, { status: 500 });
  if (!due || !due.length) return Response.json({ due: 0, sent: 0, failed: 0 });

  const users = [...new Set(due.map((r) => r.user_id))];
  const { data: subs, error: subsError } = await sb
    .from('push_subscriptions').select('*').in('user_id', users);
  if (subsError) {
    console.error('Could not load push subscriptions:', subsError.message);
    return Response.json({ error: 'Could not load push subscriptions' }, { status: 500 });
  }

  const byUser = new Map<string, typeof subs>();
  for (const s of subs ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  let sent = 0;
  let failed = 0;
  const successfulReminderIds: string[] = [];
  const dead: { user_id: string; endpoint: string }[] = [];

  await Promise.all(due.map(async (r) => {
    const payload = JSON.stringify({
      title: r.title,
      body: r.body ?? '',
      tag: r.tag ?? r.id,
      url: r.url ?? '#/today',
    });
    let reminderSent = false;

    for (const s of byUser.get(r.user_id) ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 3600, urgency: 'high' },
        );
        reminderSent = true;
        sent++;
      } catch (e) {
        const err = e as { statusCode?: number; body?: unknown; message?: string };
        const code = err.statusCode;
        if (code === 404 || code === 410) {
          dead.push({ user_id: s.user_id, endpoint: s.endpoint });
        } else {
          // Ответ push-провайдера помогает диагностировать 401/403.
          // Не записываем endpoint, ключи подписки или секреты.
          const responseBody = err.body == null ? '' : String(err.body).slice(0, 1000);
          console.error('Push provider rejected notification:', JSON.stringify({
            statusCode: code ?? null,
            body: responseBody,
            message: err.message ?? String(e),
          }));
        }
      }
    }

    if (reminderSent) successfulReminderIds.push(r.id);
    else failed++;
  }));

  // Помечаем отправленными только напоминания, доставленные хотя бы одной подписке.
  // При отсутствии подписки или ошибке провайдера напоминание остаётся для повторной попытки.
  if (successfulReminderIds.length) {
    const { error: updateError } = await sb.from('reminders')
      .update({ sent: true })
      .in('id', successfulReminderIds)
      .in('user_id', users);
    if (updateError) {
      console.error('Could not mark delivered reminders as sent:', updateError.message);
      return Response.json({ error: 'Push sent but reminder status update failed', sent, failed }, { status: 500 });
    }
  }

  for (const d of dead) {
    const { error: deleteError } = await sb.from('push_subscriptions')
      .delete().eq('user_id', d.user_id).eq('endpoint', d.endpoint);
    if (deleteError) console.error('Could not remove expired push subscription:', deleteError.message);
  }

  return Response.json({
    due: due.length,
    sent,
    failed,
    markedSent: successfulReminderIds.length,
    removedSubscriptions: dead.length,
  });
});
