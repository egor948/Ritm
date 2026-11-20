// Синхронизация данных между устройствами через Supabase (REST, без SDK).
// Схема простая: одна таблица items(kind, id, data), побеждает более свежая правка (updatedAt).
import { CONFIG } from '../config.js';
import * as S from './store.js';
import { buildReminders } from './logic.js';
import { debounce } from './util.js';

const AUTH_KEY = 'rhythm.auth';
const listeners = new Set();
let session = null;
let busy = false;
let lastError = '';
let timer = null;
let realtimeClient = null;
let realtimeChannel = null;
let realtimeUserId = null;
let realtimeLoading = null;
let realtimeState = 'off';
let autoStarted = false;

try { session = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (_) { session = null; }
if (session && session.userId) {
  S.switchAccount(session.userId);
  try { S.mergeGuestIntoCurrent(session.userId); }
  catch (e) { lastError = 'Не удалось создать резервную копию перед объединением: ' + (e.message || e); }
}

export const configured = () => !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
export const status = () => ({ configured: configured(), signedIn: !!session, email: session && session.email, busy, error: lastError, lastSyncAt: S.syncMeta().lastSyncAt, realtime: realtimeState, online: typeof navigator === 'undefined' ? true : navigator.onLine, pending: Object.keys(S.raw().dirty || {}).length });
export const getSession = () => session;

async function userRequest(method = 'GET', body) {
  const access = await token();
  const res = await fetch(`${base()}/auth/v1/user`, {
    method,
    headers: headers(access),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json.msg || json.message || json.error_description || 'Не удалось обновить профиль';
    throw new Error(/same.*email|already.*registered|already.*exists/i.test(message) ? 'Этот email уже используется' : message);
  }
  if (json.email) {
    session = { ...session, email: json.email };
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(session)); } catch (_) {}
    emit();
  }
  return json;
}

export async function getProfile() {
  if (!session) throw new Error('Войдите в аккаунт');
  const user = await userRequest('GET');
  return {
    id: user.id,
    email: user.email || session.email,
    name: user.user_metadata?.full_name || user.user_metadata?.name || '',
    avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture || '',
    providers: user.app_metadata?.providers || [user.app_metadata?.provider || 'email'],
    emailVerified: !!user.email_confirmed_at,
    createdAt: user.created_at || null,
    lastSignInAt: user.last_sign_in_at || null,
  };
}

export async function updateProfile(name) {
  const current = await getProfile();
  const clean = String(name || '').trim().slice(0, 60);
  const user = await userRequest('PUT', { data: { full_name: clean } });
  return { ...current, name: user.user_metadata?.full_name || clean };
}

export async function changePassword(password) {
  if (!session) throw new Error('Войдите в аккаунт');
  if (String(password).length < 8) throw new Error('Пароль должен содержать минимум 8 символов');
  await userRequest('PUT', { password });
  return true;
}

export async function changeEmail(email) {
  if (!session) throw new Error('Войдите в аккаунт');
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(clean)) throw new Error('Введите корректный email');
  await userRequest('PUT', { email: clean });
  return true;
}

export async function requestPasswordReset(email) {
  if (!configured()) throw new Error('Сервер не настроен');
  const redirect = location.origin + location.pathname;
  const res = await fetch(`${base()}/auth/v1/recover?redirect_to=${encodeURIComponent(redirect)}`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ email: String(email || '').trim().toLowerCase() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.msg || json.message || 'Не удалось отправить письмо');
  return true;
}

export function takePasswordRecovery() {
  const pending = localStorage.getItem('rhythm.password.recovery') === '1';
  if (pending) localStorage.removeItem('rhythm.password.recovery');
  return pending;
}

export async function deleteAccount() {
  if (!session) throw new Error('Войдите в аккаунт');
  const access = await token();
  const res = await fetch(`${base()}/functions/v1/delete-account`, {
    method: 'POST',
    headers: { ...headers(access), Authorization: `Bearer ${access}` },
    body: JSON.stringify({ confirm: 'DELETE' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || json.message || 'Не удалось удалить аккаунт');
  const userId = session.userId;
  S.switchAccount(null);
  S.clearAccountStorage(userId);
  saveSession(null);
  return true;
}


function saveSession(s) {
  session = s;
  try { s ? localStorage.setItem(AUTH_KEY, JSON.stringify(s)) : localStorage.removeItem(AUTH_KEY); } catch (_) { /* ok */ }
  emit();
}

const base = () => CONFIG.SUPABASE_URL.replace(/\/$/, '');
const headers = (token) => ({ apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${token || CONFIG.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' });

async function authCall(path, body) {
  const res = await fetch(`${base()}/auth/v1/${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = json.error_description || json.msg || json.message || json.error || 'Ошибка входа';
    const isSignup = String(path || '').startsWith('signup?');
    const duplicateEmail = isSignup && /(already registered|user already exists|email already in use|already been registered)/i.test(m);
    throw new Error(/invalid login/i.test(m) ? 'Неверный email или пароль' : duplicateEmail ? 'Этот email уже зарегистрирован' : /confirm/i.test(m) ? 'Подтверждение Email включено в настройках Supabase. Отключите Confirm email для регистрации без письма.' : m);
  }
  return json;
}
const toSession = (j) => ({ access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 - 30000, userId: j.user && j.user.id, email: j.user && j.user.email });

const OAUTH_VERIFIER_KEY = 'rhythm.oauth.verifier';
const OAUTH_REDIRECT_KEY = 'rhythm.oauth.redirect';

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function activateSession(next) {
  if (!next.userId || !next.access || !next.refresh) throw new Error('Supabase не вернул полноценную сессию');
  const previousUserId = session && session.userId || null;
  try {
    S.switchAccount(next.userId);
    S.mergeGuestIntoCurrent(next.userId);
  } catch (e) {
    S.switchAccount(previousUserId);
    throw e;
  }
  saveSession(next);
  await syncNow(true);
  await startRealtime(next.access);
}

export async function startGoogleOAuth() {
  if (!configured()) throw new Error('Сервер не настроен');
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) throw new Error('Для входа через Google нужен современный браузер и защищённое соединение HTTPS');
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));
  const redirect = location.origin + location.pathname;
  localStorage.setItem(OAUTH_VERIFIER_KEY, verifier);
  localStorage.setItem(OAUTH_REDIRECT_KEY, redirect);
  const url = new URL(`${base()}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirect);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 's256');
  location.assign(url.toString());
}

/** Обрабатывает возврат из Google по PKCE. Вызывать один раз при запуске приложения. */
export async function handleOAuthCallback() {
  const params = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const code = params.get('code');
  const hashAccess = hashParams.get('access_token');
  const hashRefresh = hashParams.get('refresh_token');
  const flowType = params.get('type') || hashParams.get('type');
  const error = params.get('error_description') || params.get('error') || hashParams.get('error_description') || hashParams.get('error');
  if (!code && !hashAccess && !error) return false;

  const verifier = localStorage.getItem(OAUTH_VERIFIER_KEY);
  const redirect = localStorage.getItem(OAUTH_REDIRECT_KEY) || (location.origin + location.pathname);
  localStorage.removeItem(OAUTH_VERIFIER_KEY);
  localStorage.removeItem(OAUTH_REDIRECT_KEY);

  if (error) {
    history.replaceState(null, '', redirect);
    throw new Error(error.replaceAll('+', ' '));
  }

  let next;
  if (code) {
    if (!verifier) throw new Error('Не найдена проверка безопасности OAuth. Начните вход через Google заново.');
    const j = await authCall('token?grant_type=pkce', { auth_code: code, code_verifier: verifier });
    next = toSession(j);
  } else if (hashAccess && hashRefresh) {
    // Supabase email confirmation may return tokens in the URL fragment.
    const expiresIn = Number(hashParams.get('expires_in') || 3600);
    const userRes = await fetch(`${base()}/auth/v1/user`, { headers: headers(hashAccess) });
    const user = await userRes.json().catch(() => ({}));
    if (!userRes.ok || !user.id) throw new Error(user.message || 'Не удалось получить профиль после подтверждения email');
    next = {
      access: hashAccess,
      refresh: hashRefresh,
      expiresAt: Number(hashParams.get('expires_at')) * 1000 || Date.now() + expiresIn * 1000 - 30000,
      userId: user.id,
      email: user.email,
    };
  }
  history.replaceState(null, '', redirect);
  if (flowType === 'recovery') localStorage.setItem('rhythm.password.recovery', '1');
  await activateSession(next);
  return true;
}


export async function signIn(email, password) {
  if (!configured()) throw new Error('Сервер не настроен');
  const j = await authCall('token?grant_type=password', { email, password });
  await activateSession(toSession(j));
  return { ok: true };
}
export async function signUp(email, password) {
  if (!configured()) throw new Error('Сервер не настроен');
  const redirect = location.origin + location.pathname;
  const j = await authCall('signup?redirect_to=' + encodeURIComponent(redirect), { email, password });
  if (!j.access_token) throw new Error('Supabase всё ещё ожидает подтверждение Email. Проверьте, что Confirm email выключен в настройках провайдера Email.');
  await activateSession(toSession(j));
  return { ok: true };
}
export async function signOut() {
  // Сначала сохраняем профиль аккаунта, затем возвращаемся к независимому гостевому хранилищу.
  S.flush();
  stopRealtime();
  S.switchAccount(null);
  saveSession(null);
}

async function token() {
  if (!session) throw new Error('Нет входа');
  if (Date.now() < session.expiresAt) return session.access;
  const previous = session;
  let j;
  try {
    j = await authCall('token?grant_type=refresh_token', { refresh_token: previous.refresh });
  } catch (error) {
    // Another open tab may have rotated the refresh token and saved the new session.
    let latest = null;
    try { latest = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (_) {}
    if (latest && latest.userId === previous.userId && latest.refresh && latest.refresh !== previous.refresh) {
      session = latest;
      if (Date.now() < Number(latest.expiresAt || 0)) return latest.access;
      try {
        j = await authCall('token?grant_type=refresh_token', { refresh_token: latest.refresh });
      } catch (_) {
        throw new Error('Сессия Ritm устарела. Войдите в аккаунт Ritm заново, затем повторите подключение календаря.');
      }
    } else if (/refresh_token_already_used|already been used|invalid refresh token/i.test(error.message || '')) {
      throw new Error('Сессия Ritm устарела. Войдите в аккаунт Ritm заново, затем повторите подключение календаря.');
    } else {
      throw error;
    }
  }
  saveSession({ ...toSession(j), email: session.email, userId: session.userId });
  if (realtimeClient) realtimeClient.realtime.setAuth(session.access).catch((e) => console.warn('Realtime auth', e));
  return session.access;
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const t = await token();
  const res = await fetch(`${base()}/rest/v1/${path}`, { method, headers: { ...headers(t), ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}
export const restCall = rest;

/** Вызов авторизованной Supabase Edge Function с текущей сессией Ritm. */
export async function invokeFunction(name, body = {}) {
  if (!configured()) throw new Error('Сервер не настроен');
  if (!session) throw new Error('Войдите в аккаунт');
  const safeName = String(name || '').trim();
  if (!/^[a-z0-9-]{1,64}$/i.test(safeName)) throw new Error('Некорректное имя серверной функции');
  const access = await token();
  const res = await fetch(`${base()}/functions/v1/${safeName}`, {
    method: 'POST',
    headers: headers(access),
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(json.error || json.message || `Сервер ответил ${res.status}`);
    error.payload = json;
    error.status = res.status;
    throw error;
  }
  return json;
}

const PAGE = 500;
async function pull() {
  let cursor = S.syncMeta().cursor || 0;
  let total = 0;
  for (;;) {
    const rows = await rest(`items?select=kind,id,data,server_ts&server_ts=gt.${cursor}&order=server_ts.asc&limit=${PAGE}`);
    if (!rows || !rows.length) break;
    total += S.applyRemote(rows.map((r) => ({ kind: r.kind, id: r.id, data: r.data })));
    cursor = rows[rows.length - 1].server_ts;
    S.setSyncMeta({ cursor });
    if (rows.length < PAGE) break;
  }
  return total;
}

async function push() {
  const entries = S.dirtyEntries();
  if (!entries.length) return 0;
  for (let i = 0; i < entries.length; i += 200) {
    const chunk = entries.slice(i, i + 200);
    await rest('items?on_conflict=user_id,kind,id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: chunk.map((e) => ({ user_id: session.userId, kind: e.kind, id: e.id, data: e.data, updated_at: e.data.updatedAt || Date.now() })),
    });
    S.clearDirty(chunk);
  }
  return entries.length;
}

/** Расписание напоминаний для серверной отправки push. */
export async function pushReminders() {
  if (!configured() || !session) return;
  const d = S.data();
  const list = buildReminders(d, d.idx, new Date(), 14, S.settings().defaultRemindAt || '09:00').slice(0, 300);
  await rest('rpc/replace_reminders', { method: 'POST', body: { items: list } });
}

export async function syncNow(manual = false) {
  if (!configured() || !session || busy) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  busy = true; lastError = ''; emit();
  try {
    await pull(); // сначала забираем чужие правки: более свежие записи заменят локальные
    await push();
    await pull();
    S.setSyncMeta({ lastSyncAt: Date.now() });
    pushReminders().catch((e) => console.warn('reminders', e));
    return true;
  } catch (e) {
    lastError = e.message || 'Ошибка синхронизации';
    if (manual) console.warn(e);
    return false;
  } finally {
    busy = false; emit();
  }
}

// Realtime доставляет сигнал об изменениях, а REST pull забирает полные записи
// с учётом курсора server_ts. Периодическая проверка остаётся страховкой.
const soon = debounce(() => syncNow(), 1200);
const realtimePullSoon = debounce(() => syncNow(), 350);

async function startRealtime(accessToken) {
  if (!session || !session.userId || !configured() || typeof WebSocket === 'undefined') { realtimeState = 'off'; emit(); return false; }
  const userId = session.userId;
  if (realtimeChannel && realtimeUserId === userId) {
    try { await realtimeClient.realtime.setAuth(accessToken); } catch (_) {}
    return true;
  }
  stopRealtime();
  realtimeState = 'connecting'; emit();
  try {
    if (!realtimeLoading) {
      realtimeLoading = import('https://esm.sh/@supabase/supabase-js@2')
        .then((mod) => {
          realtimeClient = mod.createClient(base(), CONFIG.SUPABASE_ANON_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          });
          return realtimeClient;
        })
        .finally(() => { realtimeLoading = null; });
    }
    const client = await realtimeLoading;
    if (!session || session.userId !== userId) return false;
    await client.realtime.setAuth(accessToken);
    realtimeUserId = userId;
    realtimeChannel = client
      .channel('ritm-items-' + userId)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'items', filter: 'user_id=eq.' + userId,
      }, () => realtimePullSoon())
      .subscribe((state, error) => {
        if (state === 'SUBSCRIBED') { realtimeState = 'connected'; lastError = ''; emit(); }
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') { realtimeState = 'error'; emit(); console.warn('Supabase Realtime:', state, error || ''); }
        else if (state === 'CLOSED') { realtimeState = 'off'; emit(); }
        else { realtimeState = 'connecting'; emit(); }
      });
    return true;
  } catch (e) {
    realtimeState = 'error'; emit();
    console.warn('Realtime недоступен, используется резервная синхронизация:', e);
    return false;
  }
}

function stopRealtime() {
  if (realtimeClient && realtimeChannel) {
    try { realtimeClient.removeChannel(realtimeChannel); } catch (_) {}
  }
  realtimeChannel = null;
  realtimeUserId = null;
  realtimeState = 'off';
}

export function startAuto() {
  if (autoStarted) return;
  autoStarted = true;
  S.subscribe(() => { if (session && Object.keys(S.raw().dirty).length) soon(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncNow();
      if (session) token().then(startRealtime).catch(() => {});
    }
  });
  window.addEventListener('online', () => {
    syncNow();
    if (session) token().then(startRealtime).catch(() => {});
  });
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  syncNow().then(() => { if (session) token().then(startRealtime).catch(() => {}); });
}
