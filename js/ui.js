// UI-кит: иконки, кольца прогресса, сегменты, переключатели, шиты, тосты, элементы форм.
import { h, clamp, COLOR_KEYS, clear, append } from './util.js';

// ---------------------------------------------------------------- иконки
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="4"/><path d="M3.5 10.2h17M8 3v4M16 3v4"/>',
  target: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
  flame: '<path d="M12 3c.6 3.4 5.2 5.4 5.2 10.2A5.2 5.2 0 0 1 12 18.4a5.2 5.2 0 0 1-5.2-5.2c0-2.2 1-3.6 2.2-4.8.2 1.8 1 2.8 2 3.2C11 8.8 10.6 5.8 12 3z"/>',
  list: '<path d="M4.2 7.2l1.7 1.7 3-3.2M4.2 16.4l1.7 1.7 3-3.2M12.5 7.4H20M12.5 16.6H20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevL: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  chevR: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  chevD: '<path d="M5.5 9.5L12 16l6.5-6.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  check: '<path d="M5 12.8l4.4 4.4L19 7.4"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.8 7l.8 12.2h8.8L17.2 7M10 11v5M14 11v5"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.6 1.8H4.4zM10 20.6a2.2 2.2 0 0 0 4 0"/>',
  repeat: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19M16 3l3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5M8 21l-3-3 3-3"/>',
  flag: '<path d="M6 21V4.5M6 5c3-1.8 5.4 1.4 8.5 0 1.4-.6 2.6-.7 3.5-.5v8c-.9-.2-2.1-.1-3.5.5-3.1 1.4-5.5-1.8-8.5 0"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13"/>',
  minus: '<path d="M5.5 12h13"/>',
  edit: '<path d="M4.5 19.5l1-4L16.8 4.2a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.5 18.5zM14.5 6.5l3 3"/>',
  inbox: '<path d="M3.5 13l2.4-7.2A2 2 0 0 1 7.8 4.5h8.4a2 2 0 0 1 1.9 1.3L20.5 13v4.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM3.5 13h5l1 2.5h5l1-2.5h5"/>',
  cloud: '<path d="M7 18.5a4.3 4.3 0 0 1-.6-8.6 5.8 5.8 0 0 1 11.3 1.2 3.7 3.7 0 0 1-.5 7.4z"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9zM18.5 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  drag: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>',
  up: '<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/>',
  down: '<path d="M12 5v13M6.5 12.5L12 18l5.5-5.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
};
export function ic(name, size = 22, cls = '') {
  const el = document.createElement('span');
  el.className = 'ic ' + cls;
  el.style.width = el.style.height = size + 'px';
  el.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return el;
}

/** CSS-переменная цвета по ключу палитры. */
export const cv = (key) => `var(--c-${COLOR_KEYS.includes(key) ? key : 'blue'})`;

// ---------------------------------------------------------------- кольцо прогресса
const ringPrev = new Map();
export const resetRingMemory = () => ringPrev.clear();
export function ring({ key, pct, size = 56, stroke = 8, color = 'blue', center, cls = '' }) {
  const r = (100 - stroke) / 2;
  const C = 2 * Math.PI * r;
  const target = clamp(pct, 0, 1);
  const prev = key != null && ringPrev.has(key) ? ringPrev.get(key) : 0;
  if (key != null) ringPrev.set(key, target);
  const fg = h('svg:circle', { cx: 50, cy: 50, r, class: 'ring-fg', 'stroke-width': stroke, 'stroke-dasharray': C, 'stroke-dashoffset': C * (1 - prev) });
  if (prev !== target || prev === 0) {
    requestAnimationFrame(() => requestAnimationFrame(() => { fg.style.strokeDashoffset = C * (1 - target); }));
  } else fg.style.strokeDashoffset = C * (1 - target);
  const svg = h('svg:svg', { viewBox: '0 0 100 100', class: 'ring-svg' },
    h('svg:circle', { cx: 50, cy: 50, r, class: 'ring-bg', 'stroke-width': stroke }), fg);
  return h('div', { class: 'ring ' + cls, style: { width: size + 'px', height: size + 'px', '--c': cv(color) } }, svg, center != null ? h('div', { class: 'ring-c' }, center) : null);
}

// ---------------------------------------------------------------- сегментированный контрол
const segPrev = new Map();
export function seg({ key, options, value, onChange, cls = '' }) {
  const n = options.length;
  const idx = Math.max(0, options.findIndex((o) => o.v === value));
  const prev = key != null && segPrev.has(key) ? segPrev.get(key) : idx;
  if (key != null) segPrev.set(key, idx);
  const el = h('div', { class: 'seg ' + cls, style: { '--n': n, '--i': prev } },
    h('div', { class: 'seg-thumb' }),
    options.map((o, i) => h('button', {
      type: 'button', class: 'seg-btn' + (i === idx ? ' on' : ''),
      onclick: () => {
        if (o.v === value) return;
        el.style.setProperty('--i', i);
        [...el.querySelectorAll('.seg-btn')].forEach((b, j) => b.classList.toggle('on', j === i));
        onChange(o.v);
      },
    }, o.label)));
  if (prev !== idx) requestAnimationFrame(() => requestAnimationFrame(() => el.style.setProperty('--i', idx)));
  return el;
}

// ---------------------------------------------------------------- переключатель
export function toggle(value, onChange) {
  return h('input', { type: 'checkbox', class: 'switch', checked: !!value, onchange: (e) => onChange(e.target.checked) });
}

// ---------------------------------------------------------------- чекбокс
export function checkbox({ done, color = 'blue', onToggle, pop = false, size = 26 }) {
  const el = h('button', {
    type: 'button', class: 'chk' + (done ? ' done' : '') + (pop ? ' pop' : ''),
    style: { '--c': cv(color), width: size + 'px', height: size + 'px' },
    'aria-label': done ? 'Снять отметку' : 'Выполнить',
    onclick: (e) => { e.stopPropagation(); onToggle(!done, el); },
  }, h('svg:svg', { viewBox: '0 0 24 24', class: 'chk-mark' }, h('svg:path', { d: 'M6 12.8l4 4 8-9' })));
  return el;
}

// ---------------------------------------------------------------- всплеск конфетти
export function burst(x, y, colors = ['blue', 'green', 'orange', 'pink', 'purple', 'yellow']) {
  const layer = document.getElementById('fx') || document.body;
  for (let i = 0; i < 16; i++) {
    const p = h('i', { class: 'fx-dot', style: { left: x + 'px', top: y + 'px', background: cv(colors[i % colors.length]) } });
    layer.appendChild(p);
    const a = (Math.PI * 2 * i) / 16 + Math.random() * 0.4;
    const dist = 40 + Math.random() * 50;
    const anim = p.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(${Math.cos(a) * dist - 4}px, ${Math.sin(a) * dist - 4}px) scale(.2)`, opacity: 0 },
    ], { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(.2,.8,.3,1)' });
    anim.onfinish = () => p.remove();
  }
}

// ---------------------------------------------------------------- тосты
export function toast(message, action) {
  const host = document.getElementById('toasts');
  const el = h('div', { class: 'toast' },
    h('span', { class: 'toast-msg' }, message),
    action ? h('button', { class: 'toast-act', onclick: () => { action.onClick(); hide(); } }, action.label) : null);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  let timer = setTimeout(hide, action ? 6000 : 3200);
  function hide() {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }
  el.addEventListener('click', (e) => { if (!e.target.closest('.toast-act')) hide(); });
  return { hide };
}

// ---------------------------------------------------------------- шиты
let zTop = 100;
const openSheets = [];
export const hasOpenSheet = () => openSheets.length > 0;

/**
 * Открывает нижний лист.
 * build(api) наполняет api.body; api.close() закрывает, api.setRight(btn) меняет правую кнопку.
 */
export function openSheet({ title = '', left, right, build, onClose, tall = false, cls = '' }) {
  const layer = h('div', { class: 'sheet-layer', style: { zIndex: ++zTop } });
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const titleEl = h('div', { class: 'sheet-title' }, title);
  const leftSlot = h('div', { class: 'sheet-side l' });
  const rightSlot = h('div', { class: 'sheet-side r' });
  const head = h('div', { class: 'sheet-head' }, h('div', { class: 'grabber' }), h('div', { class: 'sheet-bar' }, leftSlot, titleEl, rightSlot));
  const body = h('div', { class: 'sheet-body' });
  // append() у тела шита пропускает null/false и разворачивает массивы (нативный выводил бы «null»)
  body.append = (...c) => append(body, c);
  const sheet = h('div', { class: 'sheet ' + (tall ? 'tall ' : '') + cls }, head, body);
  layer.append(backdrop, sheet);
  document.getElementById('sheets').appendChild(layer);

  let closed = false;
  let stableBodyScrollTop = body.scrollTop;
  let pointerScrollTop = null;
  let restoreTimers = [];
  let restoringScroll = false;
  let scrollObserver = null;

  const restoreBodyPosition = (top) => {
    stableBodyScrollTop = Math.max(0, Number(top) || 0);
    restoringScroll = true;
    const apply = () => {
      if (closed || !body.isConnected) return;
      body.scrollTop = stableBodyScrollTop;
    };
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
    for (const timer of restoreTimers) clearTimeout(timer);
    restoreTimers = [0, 60, 180, 360, 650, 900].map((delay, index) => setTimeout(() => {
      apply();
      if (index === 5) {
        restoringScroll = false;
        pointerScrollTop = null;
      }
    }, delay));
  };

  const rememberBodyPosition = () => {
    if (!restoringScroll && pointerScrollTop == null) stableBodyScrollTop = body.scrollTop;
  };
  const rememberButtonPress = (event) => {
    const button = event.target.closest && event.target.closest('button');
    if (!button) {
      // A new gesture on the scroll area means the user intentionally wants to scroll.
      pointerScrollTop = null;
      restoringScroll = false;
      for (const timer of restoreTimers) clearTimeout(timer);
      restoreTimers = [];
      stableBodyScrollTop = body.scrollTop;
      return;
    }
    pointerScrollTop = body.scrollTop;
    stableBodyScrollTop = pointerScrollTop;
  };
  const onBodyClickCapture = (event) => {
    if (pointerScrollTop == null) return;
    // Capture runs before the button handler; restoring is deferred until after
    // its DOM changes and the iOS touch/click sequence have completed.
    restoreBodyPosition(pointerScrollTop);
  };

  const api = {
    body, sheet,
    setTitle: (t) => { titleEl.textContent = t; },
    setLeft: (b) => { clear(leftSlot); if (b) leftSlot.appendChild(btnFor(b)); },
    setRight: (b) => { clear(rightSlot); if (b) rightSlot.appendChild(btnFor(b)); },
    close: (silent) => {
      if (closed) return;
      closed = true;
      const i = openSheets.indexOf(api);
      if (i >= 0) openSheets.splice(i, 1);
      layer.classList.remove('show');
      sheet.style.transform = '';
      if (window.visualViewport) { window.visualViewport.removeEventListener('resize', fit); window.visualViewport.removeEventListener('scroll', fit); }
      body.removeEventListener('scroll', rememberBodyPosition);
      body.removeEventListener('pointerdown', rememberButtonPress, true);
      body.removeEventListener('touchstart', rememberButtonPress, true);
      body.removeEventListener('click', onBodyClickCapture, true);
      if (scrollObserver) scrollObserver.disconnect();
      for (const timer of restoreTimers) clearTimeout(timer);
      restoreTimers = [];
      setTimeout(() => layer.remove(), 380);
      if (!silent && onClose) onClose();
    },
  };
  const btnFor = (b) => h('button', { type: 'button', class: 'sheet-btn' + (b.bold ? ' bold' : '') + (b.danger ? ' danger' : ''), onclick: () => (b.onClick ? b.onClick(api) : api.close()) }, b.icon ? ic(b.icon, 22) : b.label);
  if (left !== null) api.setLeft(left || { label: 'Закрыть' });
  if (right) api.setRight(right);

  // клавиатура на iPhone уменьшает только «видимую» область: подгоняем под неё слой шита
  const fit = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const savedTop = pointerScrollTop == null ? stableBodyScrollTop : pointerScrollTop;
    layer.style.top = vv.offsetTop + 'px';
    layer.style.height = vv.height + 'px';
    layer.style.bottom = 'auto';
    // iOS may reset a nested overflow scroller when the visual viewport moves.
    restoreBodyPosition(savedTop);
  };
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', fit); window.visualViewport.addEventListener('scroll', fit); }

  backdrop.addEventListener('click', () => api.close());
  // смахивание вниз за шапку
  let startY = null, dy = 0, startT = 0;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    startY = e.clientY; dy = 0; startT = performance.now();
    head.setPointerCapture(e.pointerId);
    sheet.style.transition = 'none';
  });
  head.addEventListener('pointermove', (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(clamp(1 - dy / 500, 0.2, 1));
  });
  const end = () => {
    if (startY == null) return;
    const v = dy / Math.max(1, performance.now() - startT);
    startY = null;
    sheet.style.transition = '';
    backdrop.style.opacity = '';
    if (dy > 110 || v > 0.6) api.close(); else sheet.style.transform = '';
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);

  build(api);

  // Keep the editor's own scroll container stable across iOS DOM/layout changes.
  body.addEventListener('scroll', rememberBodyPosition, { passive: true });
  body.addEventListener('pointerdown', rememberButtonPress, true);
  body.addEventListener('touchstart', rememberButtonPress, { capture: true, passive: true });
  body.addEventListener('click', onBodyClickCapture, true);
  if (typeof MutationObserver !== 'undefined') {
    scrollObserver = new MutationObserver(() => {
      const savedTop = pointerScrollTop == null ? stableBodyScrollTop : pointerScrollTop;
      restoreBodyPosition(savedTop);
    });
    scrollObserver.observe(body, { childList: true, subtree: true });
  }

  openSheets.push(api);
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('show')));
  return api;
}

/** Меню действий в стиле iOS. */
export function actionSheet({ title, message, actions }) {
  return openSheet({
    title: '', left: null, cls: 'action', build(api) {
      api.body.append(
        h('div', { class: 'as-card' },
          title || message ? h('div', { class: 'as-head' }, title ? h('b', null, title) : null, message ? h('span', null, message) : null) : null,
          actions.map((a) => h('button', { class: 'as-btn' + (a.danger ? ' danger' : ''), onclick: () => { api.close(); a.onClick && a.onClick(); } }, a.label))),
        h('button', { class: 'as-btn cancel', onclick: () => api.close() }, 'Отмена'));
    },
  });
}

// ---------------------------------------------------------------- элементы форм
export const group = (...rows) => h('div', { class: 'group' }, rows);
export const groupTitle = (t) => h('div', { class: 'group-title' }, t);
export const groupNote = (t) => h('div', { class: 'group-note' }, t);
export const row = (label, control, opts = {}) => h('div', { class: 'row' + (opts.cls ? ' ' + opts.cls : ''), onclick: opts.onClick },
  opts.icon ? h('div', { class: 'row-ic', style: { '--c': cv(opts.iconColor || 'blue') } }, ic(opts.icon, 17)) : null,
  h('div', { class: 'row-label' }, label),
  control != null ? h('div', { class: 'row-ctl' }, control) : null);

export function textInput({ value = '', placeholder = '', onInput, big = false, multiline = false, autofocus = false, name }) {
  const el = multiline
    ? h('textarea', { class: 'inp' + (big ? ' big' : ''), rows: 3, placeholder, name, oninput: (e) => onInput && onInput(e.target.value) })
    : h('input', { class: 'inp' + (big ? ' big' : ''), type: 'text', placeholder, name, enterkeyhint: 'done', autocomplete: 'off', oninput: (e) => onInput && onInput(e.target.value) });
  el.value = value || '';
  if (autofocus) setTimeout(() => el.focus(), 420);
  return el;
}
export function dateInput(value, onChange, { clearable = true, min = null, max = null } = {}) {
  const inp = h('input', {
    class: 'inp dt',
    type: 'date',
    min,
    max,
    onchange: (e) => onChange(e.target.value || null),
  });
  inp.value = value || '';
  const wrap = h('div', { class: 'dt-wrap' }, inp,
    clearable && value ? h('button', { type: 'button', class: 'mini-x', 'aria-label': 'Очистить', onclick: () => { inp.value = ''; onChange(null); wrap.querySelector('.mini-x').remove(); } }, ic('x', 14)) : null);
  return wrap;
}
export function timeInput(value, onChange, { clearable = true } = {}) {
  const inp = h('input', {
    class: 'inp dt',
    type: 'time',
    onchange: (e) => onChange(e.target.value || null),
  });
  inp.value = value || '';
  const wrap = h('div', { class: 'dt-wrap' }, inp,
    clearable && value ? h('button', { type: 'button', class: 'mini-x', 'aria-label': 'Очистить', onclick: () => { inp.value = ''; onChange(null); wrap.querySelector('.mini-x').remove(); } }, ic('x', 14)) : null);
  return wrap;
}
export function selectInput(options, value, onChange) {
  const sel = h('select', { class: 'inp sel', onchange: (e) => { const o = options[e.target.selectedIndex]; onChange(o.v); } },
    options.map((o) => h('option', { value: String(o.v) }, o.label)));
  const i = options.findIndex((o) => o.v === value);
  sel.selectedIndex = i >= 0 ? i : 0;
  return sel;
}
export function numberInput(value, onChange, { placeholder = '0', step = 'any', width } = {}) {
  const el = h('input', { class: 'inp num', type: 'number', inputmode: 'decimal', step, placeholder, style: width ? { width } : null, oninput: (e) => onChange(e.target.value === '' ? null : Number(e.target.value)) });
  el.value = value == null ? '' : value;
  return el;
}
export function colorPicker(value, onChange) {
  const wrap = h('div', { class: 'swatches' });
  COLOR_KEYS.forEach((k) => {
    wrap.appendChild(h('button', {
      type: 'button', class: 'swatch' + (k === value ? ' on' : ''), style: { '--c': cv(k) }, 'aria-label': k,
      onclick: () => { wrap.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on')); wrap.children[COLOR_KEYS.indexOf(k)].classList.add('on'); onChange(k); },
    }));
  });
  return wrap;
}
const EMOJI = ['🎯', '🏃', '💪', '📚', '🧘', '💧', '🍎', '😴', '💰', '🚀', '🎨', '🎧', '🇬🇧', '✍️', '🧠', '🌱', '🏠', '✈️', '❤️', '⭐', '🔥', '🎸', '🧹', '💼'];
export function emojiPicker(value, onChange) {
  const wrap = h('div', { class: 'emojis' });
  const input = h('input', { class: 'emoji-in', type: 'text', maxlength: 4, value: value || '', placeholder: '🙂', oninput: (e) => { onChange(e.target.value.trim()); mark(e.target.value.trim()); } });
  const mark = (v) => wrap.querySelectorAll('.emo').forEach((b) => b.classList.toggle('on', b.textContent === v));
  EMOJI.forEach((e) => wrap.appendChild(h('button', { type: 'button', class: 'emo' + (e === value ? ' on' : ''), onclick: () => { input.value = e; onChange(e); mark(e); } }, e)));
  return h('div', null, h('div', { class: 'emoji-row' }, h('span', { class: 'emoji-label' }, 'Свой значок'), input), wrap);
}
/** Ряд «пилюль» для выбора одного или нескольких значений. */
export function pills({ options, value, multi = false, onChange, cls = '' }) {
  const sel = new Set(multi ? value || [] : [value]);
  const el = h('div', { class: 'pills ' + cls }, options.map((o) => h('button', {
    type: 'button', class: 'pill' + (sel.has(o.v) ? ' on' : ''), style: o.color ? { '--c': cv(o.color) } : null,
    onclick: (e) => {
      if (multi) { sel.has(o.v) ? sel.delete(o.v) : sel.add(o.v); e.currentTarget.classList.toggle('on'); onChange([...sel]); }
      else { sel.clear(); sel.add(o.v); el.querySelectorAll('.pill').forEach((p) => p.classList.remove('on')); e.currentTarget.classList.add('on'); onChange(o.v); }
    },
  }, o.label)));
  return el;
}
export function stepper(value, onChange, { min = 0, max = 99999, step = 1, format = (v) => v } = {}) {
  const out = h('span', { class: 'step-val' }, format(value));
  let v = value;
  const set = (n) => { v = clamp(n, min, max); out.textContent = format(v); onChange(v); };
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', onclick: () => set(v - step), 'aria-label': 'Меньше' }, ic('minus', 18)), out,
    h('button', { type: 'button', onclick: () => set(v + step), 'aria-label': 'Больше' }, ic('plus', 18)));
}
export function emptyState({ emoji = '✨', title, text, action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-emoji' }, emoji), h('h3', null, title), text ? h('p', null, text) : null,
    action ? h('button', { class: 'btn-primary', onclick: action.onClick }, action.label) : null);
}
