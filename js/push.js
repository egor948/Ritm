// Push-уведомления: подписка устройства + локальные напоминания, пока приложение открыто.
import { CONFIG } from '../config.js';
import * as S from './store.js';
import * as Sync from './sync.js';
import { buildReminders } from './logic.js';
import { debounce, localDate } from './util.js';
import { toast } from './ui.js';

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let subscribed = false;
let hint = '';
let localTimers = [];

export function state() {
  const supported = 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window;
  let h = hint;
  if (!supported) h = isStandalone() ? 'Этот браузер не поддерживает push.' : 'Установите приложение на экран «Домой» через «Поделиться → На экран “Домой”», затем включите уведомления.';
  else if (!CONFIG.VAPID_PUBLIC_KEY) h = 'Уведомления работают, пока приложение открыто. Чтобы они приходили и при закрытом приложении, подключите сервер (см. README).';
  return { supported, permission: supported ? Notification.permission : 'denied', subscribed, hint: h };
}

const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
const reg = () => navigator.serviceWorker.ready;

export async function refresh() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const r = await reg();
    const sub = await r.pushManager.getSubscription();
    subscribed = Notification.permission === 'granted' && (!!sub || !CONFIG.VAPID_PUBLIC_KEY);
  } catch (_) { subscribed = false; }
}

export async function enable() {
  if (!('Notification' in window)) return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { hint = 'Доступ к уведомлениям не выдан. Разрешить можно в Настройки → Уведомления → Ритм.'; return false; }
  hint = '';
  try {
    if (CONFIG.VAPID_PUBLIC_KEY && Sync.configured()) {
      if (!Sync.getSession()) { hint = 'Чтобы получать push при закрытом приложении, войдите в аккаунт синхронизации.'; }
      else {
        const r = await reg();
        const sub = (await r.pushManager.getSubscription()) || (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(CONFIG.VAPID_PUBLIC_KEY) }));
        const j = sub.toJSON();
        await Sync.restCall('push_subscriptions?on_conflict=user_id,endpoint', {
          method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
          body: { user_id: Sync.getSession().userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
        });
        Sync.pushReminders().catch(() => {});
      }
    }
    subscribed = true;
    scheduleLocal();
    toast('Уведомления включены');
    return true;
  } catch (e) {
    hint = 'Не удалось подписаться: ' + (e.message || e);
    return false;
  }
}

export async function disable() {
  try {
    const r = await reg();
    const sub = await r.pushManager.getSubscription();
    if (sub) {
      if (Sync.getSession()) await Sync.restCall(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch (_) { /* ok */ }
  subscribed = false;
  localTimers.forEach(clearTimeout); localTimers = [];
  toast('Уведомления выключены');
}

export async function test() {
  try {
    const r = await reg();
    await r.showNotification('Ритм', { body: 'Тестовое уведомление. Всё работает ✨', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'rhythm-test' });
  } catch (e) { toast('Не удалось показать уведомление'); }
}

/** Локальные напоминания на ближайшие 12 часов: работают, пока приложение открыто или в фоне. */
export function scheduleLocal() {
  localTimers.forEach(clearTimeout); localTimers = [];
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const d = S.data();
  const now = new Date();
  const list = buildReminders(d, d.idx, now, 2, S.settings().defaultRemindAt || '09:00');
  for (const r of list) {
    const ms = new Date(r.fireAt).getTime() - Date.now();
    if (ms < 0 || ms > 12 * 3600 * 1000) continue;
    localTimers.push(setTimeout(async () => {
      try { const rg = await reg(); await rg.showNotification(r.title, { body: r.body, tag: r.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: r.url } }); } catch (_) { /* ok */ }
    }, Math.min(ms, 2147483000)));
  }
}

export function start() {
  refresh();
  const again = debounce(scheduleLocal, 1500);
  S.subscribe(again);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleLocal(); });
  scheduleLocal();
}
void localDate;
