// Общие утилиты: даты, DOM-хелпер h(), форматирование, цвета.

export const pad = (n) => String(n).padStart(2, '0');

// ---------- Даты (строки YYYY-MM-DD в локальном времени) ----------
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const todayStr = () => ymd(new Date());
export const addDays = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const addMonths = (s, n) => {
  const d = parseYmd(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const max = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, max));
  return ymd(d);
};
export const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
export const dow = (s) => parseYmd(s).getDay(); // 0 = воскресенье
export const weekStart = (s, start = 1) => addDays(s, -((dow(s) - start + 7) % 7));
export const monthStart = (s) => s.slice(0, 8) + '01';
export const daysInMonth = (s) => {
  const d = parseYmd(s);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
};
export const monthEnd = (s) => s.slice(0, 8) + pad(daysInMonth(s));
export const monthsBetween = (a, b) => {
  const x = parseYmd(a), y = parseYmd(b);
  return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth());
};
export const dayOfMonth = (s) => Number(s.slice(8, 10));
export const range = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

// ---------- Время (минуты от полуночи) ----------
export const toMin = (t) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const fromMin = (m) => {
  m = Math.max(0, Math.min(1439, Math.round(m)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};
export const nowMin = () => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};
export const localDate = (dateStr, timeStr = '00:00') => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
};

// ---------- Форматирование (ru) ----------
export const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const WD_LONG = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

export const plural = (n, forms) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
};
export const fmtLong = (s) => {
  const d = parseYmd(s);
  return `${WD_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const fmtShort = (s) => {
  const d = parseYmd(s);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
};
export const fmtDayMonth = (s) => {
  const d = parseYmd(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
export const relativeDay = (s, today = todayStr()) => {
  const n = diffDays(today, s);
  if (n === 0) return 'Сегодня';
  if (n === 1) return 'Завтра';
  if (n === -1) return 'Вчера';
  return null;
};
export const fmtDateSmart = (s, today = todayStr()) => relativeDay(s, today) || fmtDayMonth(s) + (s.slice(0, 4) !== today.slice(0, 4) ? ' ' + s.slice(0, 4) : '');
export const fmtDuration = (min) => {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
};
export const fmtRemain = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'сейчас';
  if (m < 60) return `через ${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `через ${h} ч${m % 60 ? ' ' + (m % 60) + ' мин' : ''}`;
  const d = Math.round(h / 24);
  return `через ${d} ${plural(d, ['день', 'дня', 'дней'])}`;
};
export const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
};

// ---------- Разное ----------
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2) + Date.now().toString(36));
export const pct = (v) => Math.round(clamp(v, 0, 1) * 100);
export const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

// Цветовая палитра в стиле Apple
export const COLORS = {
  blue: '#0A84FF',
  indigo: '#5E5CE6',
  purple: '#BF5AF2',
  pink: '#FF375F',
  red: '#FF453A',
  orange: '#FF9F0A',
  yellow: '#FFD60A',
  green: '#30D158',
  mint: '#66D4CF',
  teal: '#40C8E0',
};
export const COLOR_KEYS = Object.keys(COLORS);
export const colorOf = (key) => COLORS[key] || COLORS.blue;

// ---------- DOM ----------
const SVG_NS = 'http://www.w3.org/2000/svg';
export function h(tag, props, ...children) {
  const isSvg = tag.startsWith('svg:');
  const el = isSvg ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' && !isSvg) el.value = v;
      else if (k === 'checked' && !isSvg) el.checked = !!v;
      else if (k === 'disabled' && !isSvg) el.disabled = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}
export const clear = (el) => {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
};
