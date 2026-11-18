// Календарь: день, неделя, месяц, год, повестка. События, задачи и привычки в одной сетке,
// задачи можно перетаскивать на таймлайн (долгое нажатие), блоки можно двигать и растягивать.
import {
  h, todayStr, addDays, addMonths, weekStart, monthStart, daysInMonth, parseYmd, ymd, dow, nowMin, fromMin, toMin, pad,
  MONTHS, MONTHS_NOM, WD_SHORT, WD_LONG, fmtDayMonth, fmtLong, plural, range, clear, clamp, relativeDay,
} from './util.js';
import * as S from './store.js';
import { dayItems, layoutColumns, expandEvents, dayScore, isDateNotPast } from './logic.js';
import { ic, cv, seg, openSheet, group, row, toggle, toast, dateInput, checkbox } from './ui.js';
import { screen, navBtn } from './shell.js';
import { editEvent, editTask, quickAdd } from './editors.js';
import { habitChip, completeTask } from './components.js';
import { openGoalDetail } from './goals.js';
import { view } from './nav.js';

const HOUR = { day: 60, week: 46 };
const SNAP = 15;

// ---------------------------------------------------------------- состояние перетаскивания
let drag = null;
let suppressClick = false;
export const isDragging = () => !!drag;
if (typeof document !== 'undefined') {
  document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
}

const snap = (m) => Math.round(m / SNAP) * SNAP;

/**
 * Долгое нажатие → перетаскивание.
 * spec: { dur: () => минуты, getCtx: () => ({ columns:[{date, el}], hourH, scroller }), onDrop(date, startMin), grab: 'top' | 'center' }
 */
function attachDrag(el, spec) {
  let timer = null, sx = 0, sy = 0, started = false, pid = null;
  const clearT = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('[data-nodrag]')) return;
    sx = e.clientX; sy = e.clientY; pid = e.pointerId; started = false;
    timer = setTimeout(() => { started = true; begin(); }, e.pointerType === 'mouse' ? 150 : 330);
  });
  el.addEventListener('pointermove', (e) => {
    if (!started) { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 9) clearT(); return; }
    drag.x = e.clientX; drag.y = e.clientY;
    update();
  });
  const up = (e) => {
    clearT();
    if (!started) return;
    started = false;
    finish(e.type === 'pointercancel');
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  function begin() {
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', margin: 0, transform: 'scale(1.03)' });
    document.body.appendChild(ghost);
    el.classList.add('drag-src');
    try { el.setPointerCapture(pid); } catch (_) { /* ok */ }
    if (navigator.vibrate) navigator.vibrate(12);
    drag = { el, ghost, rect, x: sx, y: sy, sx, sy, spec, ind: null, ctx: spec.getCtx(), raf: 0, target: null };
    drag.offY = spec.grab === 'center' ? 14 : sy - rect.top;
    loop();
  }
  function loop() {
    if (!drag) return;
    const { ctx } = drag;
    const sr = ctx.scroller.getBoundingClientRect();
    if (drag.y < sr.top + 70) ctx.scroller.scrollTop -= 9;
    else if (drag.y > sr.bottom - 70) ctx.scroller.scrollTop += 9;
    update();
    drag.raf = requestAnimationFrame(loop);
  }
  function update() {
    if (!drag) return;
    const { ghost, ctx, x, y, sx: ox, sy: oy } = drag;
    ghost.style.transform = `translate(${x - ox}px, ${y - oy}px) scale(1.03)`;
    const col = ctx.columns.find((c) => { const r = c.el.getBoundingClientRect(); return x >= r.left && x <= r.right; });
    if (!col) { setIndicator(null); drag.target = null; return; }
    const r = col.el.getBoundingClientRect();
    const dur = spec.dur();
    let min = snap(((y - drag.offY - r.top) / ctx.hourH) * 60);
    min = clamp(min, 0, 1440 - Math.min(dur, 1440));
    if (spec.grab === 'center') min = clamp(snap(((y - r.top) / ctx.hourH) * 60 - 7), 0, 1440 - dur);
    drag.target = { date: col.date, min };
    setIndicator(col, min, dur, ctx.hourH);
  }
  function setIndicator(col, min, dur, hourH) {
    if (!col) { if (drag.ind) { drag.ind.remove(); drag.ind = null; } return; }
    if (!drag.ind) drag.ind = h('div', { class: 'drop-ind' }, h('span', null));
    if (drag.ind.parentNode !== col.el) col.el.appendChild(drag.ind);
    drag.ind.style.top = (min / 60) * hourH + 'px';
    drag.ind.style.height = Math.max(22, (dur / 60) * hourH) + 'px';
    drag.ind.firstChild.textContent = `${fromMin(min)} – ${fromMin(Math.min(1440, min + dur))}`;
  }
  function finish(cancelled) {
    if (!drag) return;
    const d = drag;
    cancelAnimationFrame(d.raf);
    d.ghost.remove();
    d.el.classList.remove('drag-src');
    if (d.ind) d.ind.remove();
    drag = null;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 60);
    if (!cancelled && d.target) d.spec.onDrop(d.target.date, d.target.min);
    else if (!cancelled) toast('Отпустите на таймлайне, чтобы запланировать');
  }
}

/** Изменение длительности за нижний край. */
function attachResize(handle, block, spec) {
  let sy = 0, startH = 0, pid = null, active = false;
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    active = true; sy = e.clientY; startH = block.offsetHeight; pid = e.pointerId;
    try { handle.setPointerCapture(pid); } catch (_) { /* ok */ }
    block.classList.add('resizing');
    drag = { resizing: true };
  });
  handle.addEventListener('pointermove', (e) => {
    if (!active) return;
    const minH = (SNAP / 60) * spec.hourH;
    block.style.height = Math.max(minH, startH + e.clientY - sy) + 'px';
  });
  const end = (e) => {
    if (!active) return;
    active = false; drag = null;
    block.classList.remove('resizing');
    suppressClick = true; setTimeout(() => (suppressClick = false), 60);
    if (e.type === 'pointercancel') { block.style.height = startH + 'px'; return; }
    const durMin = Math.max(SNAP, snap(((block.offsetHeight + 2) / spec.hourH) * 60));
    spec.onResize(durMin);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------- перенос и изменение элементов
function moveItem(it, date, startMin) {
  if (!isDateNotPast(date)) { toast('Нельзя перенести задачу или мероприятие на прошедшую дату'); return; }
  if (it.type === 'task') {
    S.upsert('tasks', { id: it.id, date, time: fromMin(startMin), duration: null });
    toast(`Задача запланирована на ${fromMin(startMin)}`);
    return;
  }
  const e = it.ref;
  const dur = it.endMin - it.startMin;
  const repeating = e.repeat && e.repeat.freq && e.repeat.freq !== 'none';
  const patch = { id: e.id, start: fromMin(startMin), end: fromMin(Math.min(1439, startMin + dur)) };
  if (!repeating) patch.date = date;
  S.upsert('events', patch);
  if (repeating && date !== it.date) toast('У повторяющегося события изменено только время');
}
function resizeItem(it, durMin) {
  S.upsert('events', { id: it.id, end: fromMin(Math.min(1439, it.startMin + durMin)) });
}

// ---------------------------------------------------------------- построение таймлайна
let scrollTop = null;
let lastScroller = null;

function timeline({ dates, mode, data, filters, extraHeader }) {
  const hourH = HOUR[mode];
  const today = todayStr();
  const scroller = h('div', { class: 'cal-scroll' });
  lastScroller = scroller;
  const cols = [];
  const gutter = h('div', { class: 'tl-gutter', style: { height: hourH * 24 + 'px' } },
    [...Array(24)].map((_, i) => (i === 0 ? null : h('span', { style: { top: i * hourH + 'px' } }, `${pad(i)}:00`))));
  const grid = h('div', { class: 'tl-grid', style: { height: hourH * 24 + 'px' } });
  const lines = h('div', { class: 'tl-lines' }, [...Array(24)].map((_, i) => h('i', { style: { top: i * hourH + 'px' } })));
  const colsWrap = h('div', { class: 'tl-cols', style: { '--n': dates.length } });
  const ctxFn = () => ({ columns: cols, hourH, scroller });

  dates.forEach((date) => {
    const items = dayItems(data, date, { filters });
    const col = h('div', { class: 'tl-col' + (date === today ? ' today' : '') + (dates.length > 1 && date === view.calDate ? ' sel' : ''), 'data-date': date });
    cols.push({ date, el: col });
    col.addEventListener('click', (e) => {
      if (e.target !== col) return;
      const r = col.getBoundingClientRect();
      const m = clamp(Math.floor(((e.clientY - r.top) / hourH) * 2) * 30, 0, 1380);
      editEvent(null, { date, start: fromMin(m), end: fromMin(Math.min(1439, m + 60)) });
    });
    const layout = layoutColumns(items.timed);
    items.timed.forEach((it) => {
      const lay = layout.get(it.key) || { col: 0, cols: 1 };
      const top = (it.startMin / 60) * hourH;
      const height = Math.max(20, ((it.endMin - it.startMin) / 60) * hourH - 2);
      const isTask = it.type === 'task';
      const small = height < 34;
      const block = h('div', {
        class: 'blk ' + (isTask ? 'task' : 'event') + (it.done ? ' done' : '') + (small ? ' small' : ''),
        style: { top: top + 'px', height: height + 'px', left: `calc(${(lay.col / lay.cols) * 100}% + 1px)`, width: `calc(${100 / lay.cols}% - 3px)`, '--c': cv(it.color) },
        onclick: (e) => { e.stopPropagation(); isTask ? editTask(it.ref) : editEvent(it.ref, {}, date); },
      },
        isTask ? h('span', { class: 'blk-chk' + (it.done ? ' on' : ''), 'data-nodrag': 1, onclick: (e) => { e.stopPropagation(); completeTask(it.ref, !it.done, e.currentTarget); } }, ic('check', 11)) : null,
        h('div', { class: 'blk-text' }, h('b', null, it.title), !small && mode === 'day' ? h('span', null, `${fromMin(it.startMin)} – ${fromMin(it.endMin)}${it.type === 'event' && it.ref.location ? ' · ' + it.ref.location : ''}`) : null));
      if (!it.done || true) {
        attachDrag(block, { dur: () => it.endMin - it.startMin, getCtx: ctxFn, grab: 'top', onDrop: (d, m) => moveItem(it, d, m) });
        if (!isTask && height >= 30) {
          const handle = h('div', { class: 'blk-resize', 'data-nodrag': 1 });
          block.appendChild(handle);
          attachResize(handle, block, { hourH, onResize: (dur) => resizeItem(it, dur) });
        }
      }
      col.appendChild(block);
    });
    if (date === today) col.appendChild(h('div', { class: 'now-line', style: { top: (nowMin() / 60) * hourH + 'px' } }, h('i')));
    colsWrap.appendChild(col);
  });

  grid.append(lines, colsWrap);
  const body = h('div', { class: 'tl-body' }, gutter, grid);
  if (extraHeader) scroller.appendChild(extraHeader);
  scroller.appendChild(body);
  scroller.addEventListener('scroll', () => { scrollTop = scroller.scrollTop; }, { passive: true });
  scroller.mount = () => {
    if (scrollTop == null) scrollTop = Math.max(0, ((Math.min(nowMin(), 1080) - 90) / 60) * hourH);
    scroller.scrollTop = scrollTop + (extraHeader ? 0 : 0);
  };
  return scroller;
}

// ---------------------------------------------------------------- свайп влево/вправо
function addSwipe(el, onPrev, onNext) {
  let sx = 0, sy = 0, t0 = 0, ok = false;
  el.addEventListener('touchstart', (e) => { if (drag || e.touches.length !== 1) { ok = false; return; } ok = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now(); }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!ok || drag) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - t0 < 600) (dx > 0 ? onPrev : onNext)();
  }, { passive: true });
}

// ---------------------------------------------------------------- общие части
const filtersOf = () => S.settings().calFilters || {};
const step = (mode, date, dir) => (mode === 'day' ? addDays(date, dir) : mode === 'week' || mode === 'agenda' ? addDays(date, 7 * dir) : mode === 'month' ? addMonths(date, dir) : addMonths(date, 12 * dir));
const rerender = () => document.dispatchEvent(new CustomEvent('rerender'));
function shift(mode, dir) { view.calDir = dir; view.calDate = step(mode, view.calDate, dir); rerender(); }
const setMode = (v) => S.setSettings({ calView: v });

function titleFor(mode, date) {
  const d = parseYmd(date);
  if (mode === 'day') return { main: `${d.getDate()} ${MONTHS[d.getMonth()]}`, sub: `${WD_LONG[d.getDay()]}, ${d.getFullYear()}` };
  if (mode === 'week') {
    const a = weekStart(date, S.settings().weekStart), b = addDays(a, 6), da = parseYmd(a), db = parseYmd(b);
    const same = da.getMonth() === db.getMonth();
    return { main: same ? `${da.getDate()}–${db.getDate()} ${MONTHS[db.getMonth()]}` : `${da.getDate()} ${MONTHS[da.getMonth()].slice(0, 3)} – ${db.getDate()} ${MONTHS[db.getMonth()].slice(0, 3)}`, sub: String(db.getFullYear()) };
  }
  if (mode === 'month') return { main: MONTHS_NOM[d.getMonth()], sub: String(d.getFullYear()) };
  if (mode === 'year') return { main: String(d.getFullYear()), sub: 'Год' };
  return { main: 'Повестка', sub: `с ${fmtDayMonth(date)}` };
}

function pickDate() {
  let v = view.calDate;
  openSheet({
    title: 'Перейти к дате', left: { label: 'Отмена' }, right: { label: 'Перейти', bold: true, onClick: (api) => { view.calDate = v; api.close(true); rerender(); } },
    build(api) {
      api.body.append(group(row('Дата', dateInput(v, (x) => (v = x || v), { clearable: false }))), h('div', { class: 'sheet-pad' }));
    },
  });
}

function openFilters() {
  const f = { events: true, tasks: true, habits: true, goals: true, ...filtersOf() };
  const defs = [['events', 'События', 'calendar', 'red'], ['tasks', 'Задачи', 'list', 'blue'], ['habits', 'Привычки', 'flame', 'green'], ['goals', 'Сроки целей', 'target', 'purple']];
  openSheet({
    title: 'Показывать в календаре', left: null, right: { label: 'Готово', bold: true },
    build(api) {
      api.body.append(group(...defs.map(([k, label, icon, color]) => row(label, toggle(f[k], (v) => { f[k] = v; S.setSettings({ calFilters: { ...f } }); }), { icon, iconColor: color }))), h('div', { class: 'sheet-pad' }));
    },
  });
}

function header(mode, date) {
  const t = titleFor(mode, date);
  return h('div', { class: 'cal-head' },
    h('div', { class: 'cal-top' },
      h('button', { class: 'cal-title', onclick: pickDate }, h('b', null, t.main), h('small', null, t.sub)),
      h('div', { class: 'nav-actions' },
        h('button', { class: 'nav-btn', 'aria-label': 'Назад', onclick: () => shift(mode, -1) }, ic('chevL', 22)),
        h('button', { class: 'nav-btn', 'aria-label': 'Вперёд', onclick: () => shift(mode, 1) }, ic('chevR', 22)),
        navBtn('filter', 'Что показывать', openFilters),
        navBtn('plus', 'Добавить', () => quickAdd({ date })))),
    h('div', { class: 'cal-ctl' },
      seg({ key: 'cal-mode', cls: 'small', options: [{ v: 'day', label: 'День' }, { v: 'week', label: 'Неделя' }, { v: 'month', label: 'Месяц' }, { v: 'year', label: 'Год' }, { v: 'agenda', label: 'Список' }], value: mode, onChange: setMode }),
      h('button', { class: 'today-btn', onclick: () => { view.calDir = view.calDate > todayStr() ? -1 : 1; view.calDate = todayStr(); scrollTop = null; rerender(); } }, 'Сегодня')));
}

// ---------------------------------------------------------------- строки списка (месяц, повестка)
function itemRow(it, date) {
  const t = it.type;
  let time = '';
  let sub = '';
  if (t === 'goal') { time = 'срок'; sub = 'Дедлайн цели'; }
  else if (t === 'event') { const e = it.ref; time = e.allDay || !e.start ? 'весь день' : `${e.start}`; sub = e.allDay ? (e.endDate ? `до ${fmtDayMonth(e.endDate)}` : '') : `${e.start}–${e.end || ''}`; if (e.location) sub += (sub ? ' · ' : '') + e.location; }
  else { time = it.ref.time || 'задача'; sub = it.ref.time ? '' : 'Без времени'; }
  const click = t === 'goal' ? () => openGoalDetail(it.id) : t === 'event' ? () => editEvent(it.ref, {}, date) : () => editTask(it.ref);
  return h('div', { class: 'ag-item' + (it.done ? ' done' : ''), style: { '--c': cv(it.color) }, onclick: click },
    h('div', { class: 'ai-time' }, time), h('i', { class: 'ai-bar' }),
    h('div', { class: 'ai-main' }, h('b', null, it.title), sub ? h('span', null, sub) : null),
    t === 'task' ? checkbox({ done: it.done, color: it.color, size: 22, onToggle: (d, el) => completeTask(it.ref, d, el) }) : null);
}
function flatItems(data, date) {
  const it = dayItems(data, date, { filters: filtersOf() });
  const rows = [...it.deadlines, ...it.allDay, ...[...it.timed, ...it.dated].sort((a, b) => (a.startMin ?? 9999) - (b.startMin ?? 9999))];
  return { rows, habits: it.habits };
}

// =====================================================================
// Вид «День»
// =====================================================================
function dayView(date, data) {
  const f = filtersOf();
  const today = todayStr();
  const ws = weekStart(date, S.settings().weekStart);
  const strip = h('div', { class: 'week-strip' }, range(ws, addDays(ws, 6)).map((d) => {
    const it = dayItems(data, d, { filters: f });
    const n = it.timed.length + it.allDay.length + it.dated.length;
    return h('button', { class: 'ws-day' + (d === date ? ' sel' : '') + (d === today ? ' today' : ''), onclick: () => { view.calDir = d > date ? 1 : -1; view.calDate = d; rerender(); } },
      h('span', null, WD_SHORT[dow(d)]), h('b', null, parseYmd(d).getDate()), h('i', { class: n ? 'on' : '' }));
  }));

  const it = dayItems(data, date, { filters: f });
  const top = h('div', { class: 'day-top' });
  top.appendChild(strip);

  if (it.deadlines.length || it.allDay.length) {
    top.appendChild(h('div', { class: 'allday' },
      h('span', { class: 'allday-label' }, 'весь день'),
      h('div', { class: 'allday-items' }, [
        ...it.deadlines.map((d) => h('button', { class: 'ad-chip', style: { '--c': cv(d.color) }, onclick: () => openGoalDetail(d.id) }, '🎯 ' + d.title)),
        ...it.allDay.map((a) => h('button', { class: 'ad-chip', style: { '--c': cv(a.color) }, onclick: () => editEvent(a.ref, {}, date) }, a.title)),
      ])));
  }

  if (f.habits !== false && it.habits.length) {
    top.appendChild(h('div', { class: 'cal-habits' }, h('div', { class: 'hscroll' }, it.habits.map((x) => habitChip(x.ref, data, date)))));
  }

  // лоток: задачи, которые можно перетащить на время
  let ctxScroller = null;
  const tray = trayFor(date, data, () => ({ columns: colsRef(), hourH: HOUR.day, scroller: ctxScroller }));
  if (tray) top.appendChild(tray.el);

  const tl = timeline({ dates: [date], mode: 'day', data, filters: f, extraHeader: null });
  ctxScroller = tl;
  const colsRef = () => [...tl.querySelectorAll('.tl-col')].map((el) => ({ date: el.dataset.date, el }));
  if (tray) tray.bind(() => ({ columns: colsRef(), hourH: HOUR.day, scroller: tl }));
  const wrap = h('div', { class: 'cal-day' + (view.calDir ? (view.calDir > 0 ? ' in-r' : ' in-l') : '') }, top, tl);
  view.calDir = 0;
  addSwipe(wrap, () => shift('day', -1), () => shift('day', 1));
  wrap.mount = () => tl.mount();
  return wrap;
}

function trayFor(date, data) {
  const today = todayStr();
  const f = filtersOf();
  if (f.tasks === false) return null;
  const same = data.tasks.filter((t) => !t.done && t.date === date && !t.time);
  const overdue = date === today ? data.tasks.filter((t) => !t.done && t.date && t.date < today) : [];
  const inbox = data.tasks.filter((t) => !t.done && !t.date);
  const list = [...same, ...overdue, ...inbox].slice(0, 14);
  if (!list.length) return null;
  const chips = list.map((t) => {
    const g = t.goalId && data.goals.find((x) => x.id === t.goalId);
    const color = (g && (g.color || (g.parentId && (data.goals.find((x) => x.id === g.parentId) || {}).color))) || 'indigo';
    return { t, el: h('div', { class: 'tray-chip' + (t.date && t.date < today ? ' late' : ''), style: { '--c': cv(color) }, onclick: () => editTask(t) }, h('i'), h('span', null, t.title)), };
  });
  let getCtx = null;
  chips.forEach(({ t, el }) => attachDrag(el, { dur: () => 30, grab: 'center', getCtx: () => getCtx(), onDrop: (d, m) => { S.upsert('tasks', { id: t.id, date: d, time: fromMin(m), duration: null }); toast(`Задача запланирована на ${fromMin(m)}`); } }));
  const el = h('div', { class: 'tray' },
    h('div', { class: 'tray-head' }, h('b', null, 'К планированию'), h('span', null, 'удерживайте и перетащите на время')),
    h('div', { class: 'hscroll tray-row' }, chips.map((c) => c.el)));
  return { el, bind: (fn) => { getCtx = fn; } };
}

// =====================================================================
// Вид «Неделя»
// =====================================================================
function weekView(date, data) {
  const today = todayStr();
  const ws = weekStart(date, S.settings().weekStart);
  const dates = range(ws, addDays(ws, 6));
  const f = filtersOf();
  const head = h('div', { class: 'wk-head' }, h('i', { class: 'wk-gut' }), dates.map((d) => {
    const it = dayItems(data, d, { filters: f });
    return h('button', { class: 'wk-day' + (d === today ? ' today' : '') + (d === date ? ' sel' : ''), onclick: () => { view.calDate = d; S.setSettings({ calView: 'day' }); } },
      h('span', null, WD_SHORT[dow(d)]), h('b', null, parseYmd(d).getDate()),
      h('div', { class: 'wk-dots' }, it.allDay.slice(0, 2).map((a) => h('i', { style: { '--c': cv(a.color) } })), it.deadlines.length ? h('i', { style: { '--c': cv('purple') } }) : null));
  }));
  const tl = timeline({ dates, mode: 'week', data, filters: f });
  const wrap = h('div', { class: 'cal-week' + (view.calDir ? (view.calDir > 0 ? ' in-r' : ' in-l') : '') }, head, tl);
  view.calDir = 0;
  addSwipe(wrap, () => shift('week', -1), () => shift('week', 1));
  wrap.mount = () => tl.mount();
  return wrap;
}

// =====================================================================
// Вид «Месяц»
// =====================================================================
function monthView(date, data) {
  const today = todayStr();
  const f = filtersOf();
  const first = monthStart(date);
  const start = weekStart(first, S.settings().weekStart);
  const weeks = Math.ceil(((parseYmd(first).getDay() - S.settings().weekStart + 7) % 7 + daysInMonth(first)) / 7);
  const days = range(start, addDays(start, weeks * 7 - 1));
  const wd = [...Array(7)].map((_, i) => WD_SHORT[(S.settings().weekStart + i) % 7]);
  const grid = h('div', { class: 'mo-grid', style: { '--rows': weeks } }, days.map((d) => {
    const it = dayItems(data, d, { filters: f });
    const chips = [...it.deadlines, ...it.allDay, ...it.timed, ...it.dated];
    const inMonth = d.slice(0, 7) === first.slice(0, 7);
    const hb = it.habits.length;
    return h('button', { class: 'mo-cell' + (inMonth ? '' : ' out') + (d === today ? ' today' : '') + (d === date ? ' sel' : ''), onclick: () => { view.calDate = d; rerender(); } },
      h('span', { class: 'mo-num' }, parseYmd(d).getDate()),
      h('div', { class: 'mo-chips' }, chips.slice(0, 3).map((c) => h('i', { class: 'mo-chip' + (c.type === 'task' ? ' task' : ''), style: { '--c': cv(c.color) } }, c.title)), chips.length > 3 ? h('em', null, `+${chips.length - 3}`) : null),
      h('div', { class: 'mo-dots' }, chips.slice(0, 4).map((c) => h('i', { style: { '--c': cv(c.color) } }))));
  }));
  const { rows, habits } = flatItems(data, date);
  const sc = dayScore(data, data.idx, date);
  const list = h('div', { class: 'mo-list' },
    h('div', { class: 'mo-list-head' }, h('b', null, relativeDay(date) ? `${relativeDay(date)}, ${fmtDayMonth(date)}` : fmtLong(date)), h('button', { class: 'link-inline', onclick: () => S.setSettings({ calView: 'day' }) }, 'Открыть день')),
    rows.length || habits.length
      ? h('div', { class: 'card list' }, rows.map((r) => itemRow(r, date)), habits.length ? h('div', { class: 'ag-habits', onclick: () => S.setSettings({ calView: 'day' }) }, h('span', { class: 'ag-hic' }, ic('flame', 16)), h('b', null, `${habits.length} ${plural(habits.length, ['привычка', 'привычки', 'привычек'])}`), h('span', { class: 'dim' }, `${sc.done} из ${sc.total} дел выполнено`)) : null)
      : h('div', { class: 'hint center' }, 'В этот день ничего не запланировано'),
    h('button', { class: 'add-row', onclick: () => quickAdd({ date }) }, ic('plus', 18), 'Добавить на этот день'));
  const body = h('div', { class: 'cal-month' + (view.calDir ? (view.calDir > 0 ? ' in-r' : ' in-l') : '') }, h('div', { class: 'mo-wd' }, wd.map((w) => h('span', null, w))), grid, list, h('div', { class: 'pad-bottom' }));
  view.calDir = 0;
  addSwipe(body, () => shift('month', -1), () => shift('month', 1));
  const scroller = h('div', { class: 'cal-scroll plain' }, body);
  scroller.mount = () => {};
  return scroller;
}

// =====================================================================
// Вид «Год»
// =====================================================================
function yearView(date, data) {
  const year = Number(date.slice(0, 4));
  const today = todayStr();
  const f = filtersOf();
  const counts = new Map();
  const bump = (d, n = 1) => counts.set(d, (counts.get(d) || 0) + n);
  if (f.events !== false) for (const o of expandEvents(data.events, `${year}-01-01`, `${year}-12-31`)) bump(o.date);
  if (f.tasks !== false) for (const t of data.tasks) if (t.date && t.date.startsWith(String(year))) bump(t.date);
  if (f.goals !== false) for (const g of data.goals) if (g.deadline && g.deadline.startsWith(String(year))) bump(g.deadline);
  const months = [...Array(12)].map((_, m) => {
    const first = `${year}-${pad(m + 1)}-01`;
    const lead = (parseYmd(first).getDay() - S.settings().weekStart + 7) % 7;
    const n = daysInMonth(first);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('i', { class: 'ym-blank' }));
    for (let d = 1; d <= n; d++) {
      const ds = `${year}-${pad(m + 1)}-${pad(d)}`;
      const c = counts.get(ds) || 0;
      cells.push(h('i', { class: 'ym-day' + (ds === today ? ' today' : '') + (c ? ' has' : ''), style: c ? { '--k': Math.min(1, 0.3 + c * 0.2) } : null }, d));
    }
    return h('button', { class: 'ym' + (today.slice(0, 7) === first.slice(0, 7) ? ' cur' : ''), onclick: () => { view.calDate = today.slice(0, 7) === first.slice(0, 7) ? today : first; S.setSettings({ calView: 'month' }); } },
      h('b', null, MONTHS_NOM[m]), h('div', { class: 'ym-grid' }, cells));
  });
  const body = h('div', { class: 'cal-year' + (view.calDir ? (view.calDir > 0 ? ' in-r' : ' in-l') : '') }, h('div', { class: 'year-grid' }, months), h('div', { class: 'pad-bottom' }));
  view.calDir = 0;
  addSwipe(body, () => shift('year', -1), () => shift('year', 1));
  const scroller = h('div', { class: 'cal-scroll plain' }, body);
  scroller.mount = () => {};
  return scroller;
}

// =====================================================================
// Вид «Повестка»
// =====================================================================
let agendaDays = 30;
function agendaView(date, data) {
  const today = todayStr();
  const blocks = [];
  let shown = 0;
  for (let i = 0; i < agendaDays; i++) {
    const d = addDays(date, i);
    const { rows, habits } = flatItems(data, d);
    if (!rows.length && !(d === today && habits.length)) continue;
    shown++;
    blocks.push(h('div', { class: 'ag-day rise', style: { '--i': Math.min(shown, 8) } },
      h('div', { class: 'ag-day-head' + (d === today ? ' today' : ''), onclick: () => { view.calDate = d; S.setSettings({ calView: 'day' }); } },
        h('b', null, relativeDay(d, today) || WD_LONG[dow(d)]), h('span', null, fmtDayMonth(d))),
      h('div', { class: 'card list' }, rows.map((r) => itemRow(r, d)), d === today && habits.length ? h('div', { class: 'ag-habits', onclick: () => { view.calDate = d; S.setSettings({ calView: 'day' }); } }, h('span', { class: 'ag-hic' }, ic('flame', 16)), h('b', null, `${habits.length} ${plural(habits.length, ['привычка', 'привычки', 'привычек'])} на сегодня`)) : null)));
  }
  if (!blocks.length) blocks.push(h('div', { class: 'empty' }, h('div', { class: 'empty-emoji' }, '🗓️'), h('h3', null, 'Ничего не запланировано'), h('p', null, `На ближайшие ${agendaDays} дней дел нет.`)));
  blocks.push(h('button', { class: 'link-btn', onclick: () => { agendaDays += 30; rerender(); } }, 'Показать ещё 30 дней'), h('div', { class: 'pad-bottom' }));
  const body = h('div', { class: 'cal-agenda' }, blocks);
  const scroller = h('div', { class: 'cal-scroll plain' }, body);
  scroller.mount = () => {};
  return scroller;
}

// =====================================================================
export function calendarScreen() {
  const data = S.data();
  const mode = S.settings().calView || 'day';
  const date = view.calDate || todayStr();
  const body = { day: dayView, week: weekView, month: monthView, year: yearView, agenda: agendaView }[mode](date, data);
  const el = screen({ id: 'calendar', fixed: true, header: header(mode, date), children: [body] });
  el.mount = () => { const t = el.querySelector('.cal-scroll'); if (body.mount) body.mount(); else if (t && t.mount) t.mount(); };
  el.dataset.mode = mode;
  return el;
}
