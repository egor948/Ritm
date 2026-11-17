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

try { session = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (_) { session = null; }
if (session && session.userId) {
  S.switchAccount(session.userId);
  try { S.mergeGuestIntoCurrent(session.userId); }
  catch (e) { lastError = 'Не удалось создать резервную копию перед объединением: ' + (e.message || e); }
}

export const configured = () => !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
export const status = () => ({ configured: configured(), signedIn: !!session, email: session && session.email, busy, error: lastError, lastSyncAt: S.syncMeta().lastSyncAt });
export const getSession = () => session;

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
    throw new Error(/invalid login/i.test(m) ? 'Неверный email или пароль' : /already/i.test(m) ? 'Этот email уже зарегистрирован' : /confirm/i.test(m) ? 'Подтвердите email по ссылке из письма' : m);
  }
  return json;
}
const toSession = (j) => ({ access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 - 30000, userId: j.user && j.user.id, email: j.user && j.user.email });

const OAUTH_VERIFIER_KEY = 'rhythm.oauth.verifier';
const OAUTH_REDIRECT_KEY = 'rhythm.oauth.redirect';

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
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
  const code = params.get('code');
  const error = params.get('error_description') || params.get('error');
  if (!code && !error) return false;
  const verifier = localStorage.getItem(OAUTH_VERIFIER_KEY);
  const redirect = localStorage.getItem(OAUTH_REDIRECT_KEY) || (location.origin + location.pathname);
  localStorage.removeItem(OAUTH_VERIFIER_KEY);
  localStorage.removeItem(OAUTH_REDIRECT_KEY);
  history.replaceState(null, '', redirect + (location.hash || ''));
  if (error) throw new Error(error.replace(/\\+/g, ' '));
  if (!code || !verifier) throw new Error('Не удалось завершить вход через Google. Начните авторизацию заново.');
  const j = await authCall('token?grant_type=pkce', { auth_code: code, code_verifier: verifier });
  await activateSession(toSession(j));
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
  const j = await authCall('signup', { email, password });
  if (!j.access_token) return { needsConfirm: true };
  await activateSession(toSession(j));
  return { ok: true };
}
export async function signOut() {
  // Сначала сохраняем профиль аккаунта, затем возвращаемся к независимому гостевому хранилищу.
  S.flush();
  S.switchAccount(null);
  saveSession(null);
}

async function token() {
  if (!session) throw new Error('Нет входа');
  if (Date.now() < session.expiresAt) return session.access;
  const j = await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh });
  saveSession({ ...toSession(j), email: session.email, userId: session.userId });
  return session.access;
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const t = await token();
  const res = await fetch(`${base()}/rest/v1/${path}`, { method, headers: { ...headers(t), ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}
export const restCall = rest;

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

// автоматическая синхронизация: после правок, при возвращении в приложение, по сети
const soon = debounce(() => syncNow(), 2500);
export function startAuto() {
  S.subscribe(() => { if (session && Object.keys(S.raw().dirty).length) soon(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', () => syncNow());
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  syncNow();
}
