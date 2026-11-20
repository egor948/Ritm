import { createClient } from 'npm:@supabase/supabase-js@2';
import { encryptCalendarUrl, fetchCalendarIcs, decryptCalendarUrl } from '../_shared/calendar-sync.ts';
import { validateGoogleCalendarUrl } from '../_shared/calendar-url.ts';

const env = (key: string) => Deno.env.get(key) ?? '';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const colors = new Set(['blue', 'indigo', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'mint', 'teal']);

type SubscriptionRow = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  visible: boolean;
  enabled: boolean;
  encrypted_url: string;
  url_iv: string;
  ics_content: string | null;
  etag: string | null;
  last_modified: string | null;
  last_sync_at: string | null;
  last_status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function publicRow(row: SubscriptionRow, includeData = true) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    visible: row.visible,
    enabled: row.enabled,
    calendarData: includeData ? row.ics_content : null,
    lastSyncAt: row.last_sync_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cleanError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Не удалось обновить календарь.';
  return message.slice(0, 400);
}

async function authenticate(req: Request) {
  const authorization = req.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) throw new Response('Требуется вход в аккаунт.', { status: 401 });
  const url = env('SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY');
  const service = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service || !env('CALENDAR_ENCRYPTION_KEY')) {
    throw new Response('Сервер подписок календарей не настроен.', { status: 500 });
  }
  const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await authClient.auth.getUser(token);
  if (error || !user) throw new Response('Сессия недействительна. Войдите снова.', { status: 401 });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  return { userId: user.id, admin };
}

async function syncRow(admin: ReturnType<typeof createClient>, row: SubscriptionRow) {
  try {
    const sourceUrl = await decryptCalendarUrl(row.encrypted_url, row.url_iv);
    const result = await fetchCalendarIcs(sourceUrl, { etag: row.etag, lastModified: row.last_modified });
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
    const { data, error } = await admin.from('calendar_subscriptions')
      .update(patch).eq('id', row.id).eq('user_id', row.user_id).select('*').single();
    if (error || !data) throw new Error('Не удалось сохранить обновлённый календарь.');
    return data as SubscriptionRow;
  } catch (error) {
    const message = cleanError(error);
    await admin.from('calendar_subscriptions')
      .update({ last_sync_at: new Date().toISOString(), last_status: 'error', last_error: message })
      .eq('id', row.id).eq('user_id', row.user_id);
    throw new Error(message);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405);

  try {
    const { userId, admin } = await authenticate(req);
    const text = await req.text();
    if (text.length > 12000) return json({ error: 'Слишком большой запрос.' }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(text || '{}'); } catch { return json({ error: 'Некорректный запрос.' }, 400); }
    const action = String(body.action || '');

    if (action === 'list') {
      const { data, error } = await admin.from('calendar_subscriptions')
        .select('*').eq('user_id', userId).order('created_at', { ascending: true });
      if (error) throw new Error('Не удалось получить список подписок.');
      return json({ subscriptions: (data || []).map((row) => publicRow(row as SubscriptionRow)) });
    }

    if (action === 'add') {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return json({ error: 'Укажите название календаря.' }, 400);
      const sourceUrl = validateGoogleCalendarUrl(body.url);
      const color = colors.has(String(body.color)) ? String(body.color) : 'blue';
      const encrypted = await encryptCalendarUrl(sourceUrl);
      const id = crypto.randomUUID();
      const { data, error } = await admin.from('calendar_subscriptions').insert({
        id, user_id: userId, name, color,
        visible: true, enabled: true,
        encrypted_url: encrypted.encryptedUrl,
        url_iv: encrypted.urlIv,
        last_status: 'pending',
      }).select('*').single();
      if (error || !data) throw new Error('Не удалось сохранить подписку.');
      let latest = data as SubscriptionRow;
      let syncError: string | null = null;
      try { latest = await syncRow(admin, latest); }
      catch (error) { syncError = cleanError(error); }
      return json({ subscription: publicRow(latest), warning: syncError });
    }

    const id = String(body.id || '');
    if (!id || id.length > 80) return json({ error: 'Не указан календарь.' }, 400);
    const { data: row, error: lookupError } = await admin.from('calendar_subscriptions')
      .select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    if (lookupError) throw new Error('Не удалось найти подписку.');
    if (!row) return json({ error: 'Подписка не найдена.' }, 404);
    const current = row as SubscriptionRow;

    if (action === 'delete') {
      const { error } = await admin.from('calendar_subscriptions').delete().eq('id', id).eq('user_id', userId);
      if (error) throw new Error('Не удалось удалить подписку.');
      return json({ ok: true });
    }

    if (action === 'update') {
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) {
        const name = String(body.name || '').trim().slice(0, 60);
        if (!name) return json({ error: 'Название не может быть пустым.' }, 400);
        patch.name = name;
      }
      if (body.color !== undefined) {
        if (!colors.has(String(body.color))) return json({ error: 'Недопустимый цвет календаря.' }, 400);
        patch.color = String(body.color);
      }
      if (body.visible !== undefined) patch.visible = !!body.visible;
      if (body.enabled !== undefined) patch.enabled = !!body.enabled;
      patch.updated_at = new Date().toISOString();
      const { data, error } = await admin.from('calendar_subscriptions')
        .update(patch).eq('id', id).eq('user_id', userId).select('*').single();
      if (error || !data) throw new Error('Не удалось изменить подписку.');
      return json({ subscription: publicRow(data as SubscriptionRow) });
    }

    if (action === 'refresh') {
      try {
        const latest = await syncRow(admin, current);
        return json({ subscription: publicRow(latest) });
      } catch (error) {
        const { data: latest } = await admin.from('calendar_subscriptions')
          .select('*').eq('id', id).eq('user_id', userId).single();
        return json({ subscription: latest ? publicRow(latest as SubscriptionRow) : null, warning: cleanError(error) }, 502);
      }
    }

    return json({ error: 'Неизвестная операция.' }, 400);
  } catch (error) {
    if (error instanceof Response) return json({ error: await error.text() }, error.status);
    return json({ error: cleanError(error) }, 500);
  }
});
