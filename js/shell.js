// Каркас экрана в стиле iOS: большой заголовок, который сворачивается в компактный при прокрутке.
import { h } from './util.js';
import { ic } from './ui.js';

export const navBtn = (icon, label, onClick, cls = '') =>
  h('button', { type: 'button', class: 'nav-btn ' + cls, 'aria-label': label, 'data-nav-icon': icon, onclick: onClick }, ic(icon, 22));

const settingsAction = () => navBtn('gear', 'Настройки', () => document.dispatchEvent(new CustomEvent('open-settings')), 'nav-settings');
const screenActions = (actions) => actions.some((action) => action && action.dataset && action.dataset.navIcon === 'gear') ? actions : [...actions, settingsAction()];

export function screen({ title, eyebrow, actions = [], children = [], fixed = false, header = null, id = '' }) {
  const visibleActions = screenActions(actions);
  const nav = h('header', { class: 'nav' }, h('div', { class: 'nav-title' }, title), h('div', { class: 'nav-actions' }, visibleActions));
  if (fixed) {
    const headerHasSettings = !!(header && header.querySelector && header.querySelector('[data-nav-icon="gear"]'));
    return h('section', { class: 'screen fixed', 'data-screen': id }, h('header', { class: 'nav solid' }, header, headerHasSettings ? null : settingsAction()), h('div', { class: 'fixed-body' }, children));
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
