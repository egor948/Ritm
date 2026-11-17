// Точка входа: вкладки, перерисовка, тема, регистрация service worker, первый запуск.
import { h, clear, debounce } from './util.js';
import * as S from './store.js';
import { ic, openSheet, hasOpenSheet, toast } from './ui.js';
import { setNavHandler, view } from './nav.js';
import { todayScreen } from './today.js';
import { calendarScreen, isDragging } from './calendar.js';
import { tasksScreen } from './tasks.js';
import { goalsScreen } from './goals.js';
import { habitsScreen, tickTimers } from './habits.js';
import { applyTheme } from './settings.js';
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

function buildTabbar() {
  clear(tabbar);
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
  if (old && !enter) scrollMemo[current] = old.scrollTop;
  let el;
  try { el = tab.render(); } catch (e) { console.error(e); el = h('div', { class: 'empty' }, h('h3', null, 'Что-то пошло не так'), h('p', null, String(e.message || e))); }
  el.classList.add('tab-screen');
  clear(root);
  root.classList.toggle('enter', enter);
  root.dataset.tab = current;
  root.appendChild(el);
  const sc = el.querySelector('.scroll:not(.cal-scroll)');
  if (sc && !enter && scrollMemo[current]) sc.scrollTop = scrollMemo[current];
  if (el.mount) el.mount();
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
  openSheet({
    title: '', left: null, cls: 'welcome', onClose: () => S.setSettings({ onboarded: true }),
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

// ---------- подсказка по установке (iPhone, Safari, не в режиме приложения) ----------
function installHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let dismissed = false;
  try { dismissed = localStorage.getItem('rhythm.hint') === '1'; } catch (_) { /* ok */ }
  if (!ios || standalone || dismissed) return;
  const bar = h('div', { class: 'install' },
    h('div', null, h('b', null, 'Установите «Ритм»'), h('span', null, 'Нажмите «Поделиться» ', h('i', { class: 'ios-share' }, '⎙'), ' → «На экран “Домой”» — приложение откроется на весь экран и сможет присылать напоминания.')),
    h('button', { 'aria-label': 'Закрыть', onclick: () => { bar.remove(); try { localStorage.setItem('rhythm.hint', '1'); } catch (_) { /* ok */ } } }, ic('x', 18)));
  document.getElementById('toasts').before(bar);
}

// ---------- запуск ----------
applyTheme();
buildTabbar();
const start = location.hash.replace('#/', '');
current = TABS.some((t) => t.id === start) ? start : 'today';
markTab();
render({ enter: true });
setTimeout(welcome, 350);
setTimeout(installHint, 1200);
if (Sync.configured()) {
  // Завершаем OAuth callback до запуска фоновой синхронизации.
  Sync.handleOAuthCallback()
    .catch((e) => { console.warn('Google OAuth', e); toast(e.message || 'Не удалось завершить вход через Google'); })
    .finally(() => Sync.startAuto());
}
Push.start();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open' && e.data.url) { const id = String(e.data.url).replace(/^.*#\//, ''); go(id); } });
}
void view; void debounce;
