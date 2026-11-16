// Детальные экраны поверх вкладок (цель, привычка) с жестом «назад» от левого края.
import { h, clear } from './util.js';
import * as S from './store.js';
import { ic } from './ui.js';

const stack = [];

export function openLayer({ render }) {
  const host = document.getElementById('layers');
  const el = h('div', { class: 'layer' });
  host.appendChild(el);
  let closed = false;
  const api = {
    close() {
      if (closed) return;
      closed = true;
      unsub();
      document.removeEventListener('goal-deleted', onGoalDeleted);
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      el.classList.remove('show');
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 420);
    },
    refresh,
    el,
  };
  function refresh() {
    if (closed) return;
    const old = el.querySelector('.scroll');
    const top = old ? old.scrollTop : 0;
    const node = render(api);
    if (!node) { api.close(); return; }
    clear(el);
    el.appendChild(node);
    const sc = el.querySelector('.scroll');
    if (sc) sc.scrollTop = top;
  }
  const unsub = S.subscribe(refresh);
  const onGoalDeleted = () => refresh();
  document.addEventListener('goal-deleted', onGoalDeleted);
  refresh();
  stack.push(api);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));

  // жест «назад» от левого края
  let sx = null, sy = 0, dx = 0, active = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.clientX > 26 || e.pointerType === 'mouse') return;
    sx = e.clientX; sy = e.clientY; dx = 0; active = false;
  });
  el.addEventListener('pointermove', (e) => {
    if (sx == null) return;
    const mx = e.clientX - sx, my = e.clientY - sy;
    if (!active && Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) { active = true; el.style.transition = 'none'; el.setPointerCapture(e.pointerId); }
    if (!active) return;
    dx = Math.max(0, mx);
    el.style.transform = `translateX(${dx}px)`;
  });
  const end = () => {
    if (sx == null) return;
    sx = null;
    el.style.transition = '';
    if (active && dx > window.innerWidth * 0.33) { el.style.transform = ''; api.close(); } else el.style.transform = '';
    active = false;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  return api;
}

export const closeTopLayer = () => { const t = stack[stack.length - 1]; if (t) { t.close(); return true; } return false; };
export const hasLayer = () => stack.length > 0;

/** Каркас детального экрана: кнопка «назад», компактный заголовок, действия справа. */
export function layerScreen({ title, backLabel = 'Назад', onBack, actions = [], children }) {
  const nav = h('header', { class: 'nav' },
    h('button', { type: 'button', class: 'nav-back', onclick: onBack }, ic('chevL', 22), h('span', null, backLabel)),
    h('div', { class: 'nav-title center' }, title),
    h('div', { class: 'nav-actions' }, actions));
  const scroller = h('div', { class: 'scroll' }, h('div', { class: 'content detail' }, children));
  const el = h('section', { class: 'screen' }, nav, scroller);
  let tick = false;
  scroller.addEventListener('scroll', () => {
    if (tick) return;
    tick = true;
    requestAnimationFrame(() => { tick = false; el.classList.toggle('scrolled', scroller.scrollTop > 60); });
  }, { passive: true });
  return el;
}
