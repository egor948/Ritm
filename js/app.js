// Точка входа: вкладки, перерисовка, тема, регистрация service worker, первый запуск.
import { h, clear, debounce, captureScrollPosition, restoreScrollPosition } from './util.js';
import * as S from './store.js';
import { ic, openSheet, hasOpenSheet, toast } from './ui.js';
import { setNavHandler, view } from './nav.js';
import { todayScreen } from './today.js';
import { calendarScreen, isDragging } from './calendar.js';
import { tasksScreen } from './tasks.js';
import { goalsScreen } from './goals.js';
import { habitsScreen, tickTimers } from './habits.js';
import { applyTheme, openPasswordRecoverySheet } from './settings.js';
import * as Sync from './sync.js';
import * as Push from './push.js';
import { closeTopLayer, hasLayer } from './layers.js';

const TABS = [
  { id: 'today', label: 'Сегодня', icon: 'sun', render: todayScreen },
  { id: 'calendar', label: 'Календарь', icon: 'calendar', render: calendarScreen },
  { id: 'tasks', label: 'Задачи', icon: 'list', render: tasksScreen },
  { id: 'goals', label: 'Цели', icon: 'target', render: goalsScreen },
  { id: 'habits', label: 'Привычки', icon: 'flame', render: habitsScreen },
];

let current = 'today';
const root = document.getElementById('view');
const tabbar = document.getElementById('tabbar');

const INSTALL_GUIDE_KEY = 'rhythm.install-guide.seen.v1';
let deferredInstallPrompt = null;
let installBanner = null;
let installActionArea = null;
let welcomeVisible = false;
let installGuideAttempted = false;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallAction();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  try { localStorage.setItem(INSTALL_GUIDE_KEY, '1'); } catch (_) { /* ok */ }
  closeInstallHint();
});

function buildTabbar() {
  clear(tabbar);
  tabbar.appendChild(h('div', { class: 'sidebar-brand', 'aria-label': 'Ритм' },
    h('img', { class: 'sidebar-brand-logo', src: 'icons/icon-192.png', alt: '' }),
    h('span', null, 'Ритм')));
  TABS.forEach((t) => {
    const b = h('button', { class: 'tab' + (t.id === current ? ' on' : ''), 'data-tab': t.id, 'aria-label': t.label, onclick: () => go(t.id) }, h('span', { class: 'tab-ic' }, ic(t.icon, 25)), h('span', { class: 'tab-label' }, t.label));
    tabbar.appendChild(b);
  });
}
function markTab() {
  tabbar.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === current));
}

function go(id) {
  if (!TABS.some((t) => t.id === id)) id = 'today';
  const changed = id !== current;
  if (changed) { while (hasLayer()) closeTopLayer(); }
  const was = current;
  current = id;
  if (location.hash !== '#/' + id) history.replaceState(null, '', '#/' + id);
  markTab();
  render({ enter: changed || was === null });
}
setNavHandler(go);

const scrollMemo = {};
function render({ enter = false } = {}) {
  const tab = TABS.find((t) => t.id === current);
  const old = root.querySelector('.scroll');
  const oldScroll = old && !enter ? captureScrollPosition(old) : null;
  if (old && !enter) scrollMemo[current] = old.scrollTop;
  let el;
  try { el = tab.render(); } catch (e) { console.error(e); el = h('div', { class: 'empty' }, h('h3', null, 'Что-то пошло не так'), h('p', null, String(e.message || e))); }
  el.classList.add('tab-screen');
  clear(root);
  root.classList.toggle('enter', enter);
  root.dataset.tab = current;
  root.appendChild(el);
  const sc = el.querySelector('.scroll:not(.cal-scroll)');
  if (el.mount) el.mount();
  if (sc && !enter) restoreScrollPosition(sc, oldScroll || { top: scrollMemo[current] || 0, anchor: null });
  if (enter) { scrollMemo[current] = 0; setTimeout(() => root.classList.remove('enter'), 900); }
}

const schedule = (() => {
  let q = false;
  return () => {
    if (q) return;
    q = true;
    requestAnimationFrame(() => {
      q = false;
      if (isDragging()) { setTimeout(schedule, 400); return; }
      const a = document.activeElement;
      if (a && root.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
      render();
    });
  };
})();

S.subscribe(schedule);
document.addEventListener('rerender', () => { if (!isDragging()) render(); });
window.addEventListener('hashchange', () => { const id = location.hash.replace('#/', ''); if (id && id !== current) go(id); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
S.subscribe(applyTheme);

// живые таймеры привычек и обновление «сейчас» раз в минуту
setInterval(tickTimers, 1000);
setInterval(() => { if (document.visibilityState === 'visible' && !hasOpenSheet() && !isDragging() && (current === 'today' || current === 'calendar')) render(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !isDragging()) render(); });

// ---------- первый запуск ----------
function welcome() {
  const d = S.raw();
  const empty = !d.goals.length && !d.tasks.length && !d.events.length && !d.habits.length;
  if (S.settings().onboarded || !empty) return;
  welcomeVisible = true;
  openSheet({
    title: '', left: null, cls: 'welcome', onClose: () => {
      welcomeVisible = false;
      S.setSettings({ onboarded: true });
      setTimeout(installHint, 450);
    },
    build(api) {
      const feat = (icon, c, t, s) => h('div', { class: 'wl-feat', style: { '--c': `var(--c-${c})` } }, h('span', null, ic(icon, 22)), h('div', null, h('b', null, t), h('small', null, s)));
      api.body.append(
        h('div', { class: 'wl' },
          h('div', { class: 'wl-logo' }, ic('sparkle', 38)),
          h('h1', null, 'Ритм'),
          h('p', null, 'Цели, задачи, привычки и календарь в одной системе. Всё связано между собой.'),
          h('div', { class: 'wl-feats' },
            feat('target', 'green', 'Цели и подцели', 'Прогресс считается по задачам, весу или метрике'),
            feat('calendar', 'red', 'Календарь', 'День, неделя, месяц, год. Задачи — на таймлайн'),
            feat('flame', 'orange', 'Привычки', 'Серии, счётчики, таймер и тепловая карта'),
            feat('bell', 'blue', 'Напоминания', 'Работают на iPhone, в том числе при закрытом приложении')),
          h('button', { class: 'btn-primary wide', onclick: () => { S.setSettings({ onboarded: true }); api.close(true); } }, 'Начать')));
    },
  });
}

// ---------- одноразовая инструкция установки PWA ----------

function closeInstallHint() {
  if (installBanner) installBanner.remove();
  installBanner = null;
  installActionArea = null;
}

async function triggerInstallPrompt() {
  const promptEvent = deferredInstallPrompt;
  if (!promptEvent) return;
  deferredInstallPrompt = null;
  const button = installActionArea && installActionArea.querySelector('button');
  if (button) button.disabled = true;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice && choice.outcome === 'accepted') {
      closeInstallHint();
      return;
    }
  } catch (error) {
    console.warn('PWA install prompt', error);
  }
  closeInstallHint();
}

function updateInstallAction() {
  if (!installBanner || !installActionArea || !deferredInstallPrompt || installActionArea.querySelector('button')) return;
  installActionArea.appendChild(h('button', {
    type: 'button',
    class: 'install-action',
    onclick: triggerInstallPrompt,
  }, 'Установить'));
}

function installInstructions() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const mobile = Boolean(navigator.userAgentData && navigator.userAgentData.mobile)
    || ios || android || /Mobile|IEMobile|Opera Mini/i.test(ua);
  const yandex = /YaBrowser/i.test(ua);
  const safariMac = !mobile && /Macintosh/i.test(ua) && /Safari/i.test(ua)
    && !/(Chrome|Chromium|CriOS|Edg|YaBrowser|Firefox)/i.test(ua);
  const chromium = /(Chrome|Chromium|CriOS|Edg|YaBrowser|OPR)/i.test(ua);

  if (ios) {
    return {
      title: 'Добавьте «Ритм» на экран «Домой»',
      text: 'Нажмите «Поделиться» → «На экран Домой» → «Добавить». Если доступен пункт «Открывать как веб‑приложение», включите его.',
    };
  }
  if (android) {
    return {
      title: 'Установите «Ритм» на телефон',
      text: 'Откройте меню браузера ⋮ и выберите «Установить приложение» или «Добавить на главный экран».',
    };
  }
  if (yandex) {
    return {
      title: 'Установите «Ритм» на компьютер',
      text: 'В Умной строке нажмите значок справа → «Установить как приложение». Можно выбрать отдельное окно и добавить ярлык.',
    };
  }
  if (safariMac) {
    return {
      title: 'Добавьте «Ритм» в Dock',
      text: 'В Safari откройте меню «Файл» → «Добавить в Dock». Эта возможность есть в Safari на macOS Sonoma и новее.',
    };
  }
  if (chromium) {
    return {
      title: 'Установите «Ритм» на компьютер',
      text: 'Нажмите значок установки справа от адресной строки или откройте меню браузера → «Установить приложение».',
    };
  }
  return {
    title: 'Установите «Ритм» как приложение',
    text: 'Откройте сайт в Chrome, Edge или Яндекс Браузере и выберите в меню браузера установку приложения.',
  };
}

function installHint() {
  if (installBanner || installGuideAttempted) return;
  const standalone = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']
    .some((mode) => window.matchMedia && window.matchMedia(`(display-mode: ${mode})`).matches)
    || navigator.standalone === true;
  if (standalone) return;

  let seen = false;
  try {
    seen = localStorage.getItem(INSTALL_GUIDE_KEY) === '1'
      || localStorage.getItem('rhythm.hint') === '1';
    if (!seen) localStorage.setItem(INSTALL_GUIDE_KEY, '1');
  } catch (_) { /* private browsing: keep the once-per-page guard */ }
  if (seen) return;
  installGuideAttempted = true;

  const guide = installInstructions();
  const copy = h('div', { class: 'install-copy' },
    h('b', null, guide.title),
    h('span', null, guide.text));
  installActionArea = h('div', { class: 'install-actions' });
  const dismiss = h('button', {
    type: 'button',
    class: 'install-dismiss',
    'aria-label': 'Понятно, закрыть инструкцию',
    onclick: closeInstallHint,
  }, ic('x', 18));
  installBanner = h('div', { class: 'install' }, copy, installActionArea, dismiss);
  document.getElementById('toasts').before(installBanner);
  updateInstallAction();
}

// ---------- запуск ----------
applyTheme();
buildTabbar();
const start = location.hash.replace('#/', '');
current = TABS.some((t) => t.id === start) ? start : 'today';
markTab();
render({ enter: true });
setTimeout(welcome, 350);
setTimeout(() => { if (!welcomeVisible) installHint(); }, 1600);
if (Sync.configured()) {
  // Завершаем OAuth callback до запуска фоновой синхронизации.
  Sync.handleOAuthCallback()
    .then(() => { if (Sync.takePasswordRecovery()) openPasswordRecoverySheet(); })
    .catch((e) => { console.warn('OAuth callback', e); toast(e.message || 'Не удалось завершить авторизацию'); })
    .finally(() => Sync.startAuto());
}
Push.start();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((registration) => registration.update())
    .catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open' && e.data.url) { const id = String(e.data.url).replace(/^.*#\//, ''); go(id); } });
}
void view; void debounce;
