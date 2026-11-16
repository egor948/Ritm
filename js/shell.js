// Каркас экрана в стиле iOS: большой заголовок, который сворачивается в компактный при прокрутке.
import { h } from './util.js';
import { ic } from './ui.js';

export const navBtn = (icon, label, onClick, cls = '') =>
  h('button', { type: 'button', class: 'nav-btn ' + cls, 'aria-label': label, onclick: onClick }, ic(icon, 22));

export function screen({ title, eyebrow, actions = [], children = [], fixed = false, header = null, id = '' }) {
  const nav = h('header', { class: 'nav' }, h('div', { class: 'nav-title' }, title), h('div', { class: 'nav-actions' }, actions));
  if (fixed) {
    return h('section', { class: 'screen fixed', 'data-screen': id }, h('header', { class: 'nav solid' }, header), h('div', { class: 'fixed-body' }, children));
  }
  const scroller = h('div', { class: 'scroll' },
    h('div', { class: 'large' }, eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null, h('h1', null, title)),
    h('div', { class: 'content' }, children));
  const el = h('section', { class: 'screen', 'data-screen': id }, nav, scroller);
  let tick = false;
  scroller.addEventListener('scroll', () => {
    if (tick) return;
    tick = true;
    requestAnimationFrame(() => { tick = false; el.classList.toggle('scrolled', scroller.scrollTop > 34); });
  }, { passive: true });
  el.scroller = scroller;
  return el;
}
