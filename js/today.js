// Экран «Сегодня»: настраиваемые виджеты.
import { h, todayStr, addDays, greeting, fmtLong, nowMin, fromMin, fmtRemain, plural, WD_SHORT, dow, localDate } from './util.js';
import * as S from './store.js';
import { visibleEventsData } from './calendars.js';
import { dayItems, dayScore, isScheduled, habitDone, habitStreaks, goalProgress, habitTarget } from './logic.js';
import { ic, cv, ring, emptyState, openSheet, toast } from './ui.js';
import { screen, navBtn } from './shell.js';
import { taskRow, habitChip, progressBar } from './components.js';
import { editTask, editEvent, quickAdd, editHabit, editGoal } from './editors.js';
import { go, view } from './nav.js';
import { openGoalDetail, progressLabel } from './goals.js';
import { openHabitDetail } from './habits.js';
import { filterTasks } from './tasks.js';
import { isTaskInCompletionWindow, isTaskExitStarted } from './task-completion.js';
import { openExternalEventDetails } from './external-calendars.js';

const WIDE = new Set(['habits', 'agenda', 'tasks', 'goals', 'week']);
let widgetsEditMode = false;

const TITLES = {
  day: ['День', 'target', 'blue'], next: ['Дальше', 'clock', 'red'], habits: ['Привычки', 'flame', 'green'], agenda: ['Расписание', 'calendar', 'red'],
  tasks: ['Задачи на сегодня', 'list', 'blue'], goals: ['Цели', 'target', 'purple'], week: ['Неделя', 'sparkle', 'indigo'], streak: ['Серия', 'flame', 'orange'], overdue: ['Просрочено', 'flag', 'orange'],
};

function widgetShell(id, i, body, { onClick, extra } = {}) {
  const [title, icon, color] = TITLES[id];
  return h('div', { class: 'widget rise' + (WIDE.has(id) ? ' wide' : '') + (onClick ? ' pressable' : '') + ' w-' + id, style: { '--c': cv(color), '--i': i }, onclick: onClick },
    h('div', { class: 'w-head' }, h('span', { class: 'w-ic' }, ic(icon, 15)), h('span', { class: 'w-title' }, title), extra || null),
    body);
}

function persistWidgetOrder(grid) {
  const settings = S.settings();
  const byId = new Map(settings.widgets.map((widget) => [widget.id, widget]));
  const visibleOrder = [...grid.querySelectorAll('.widget-edit-card')].map((node) => byId.get(node.dataset.widgetId)).filter(Boolean);
  const hidden = settings.widgets.filter((widget) => !widget.on);
  S.setSettings({ widgets: [...visibleOrder, ...hidden] });
}

function bindWidgetDrag(card, grid) {
  let pointerId = null;
  let holdTimer = null;
  let startX = 0, startY = 0;
  let dragging = false, moved = false, suppressClick = false;

  card.addEventListener('pointerdown', (event) => {
    if (pointerId != null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.target.closest('.widget-edit-remove')) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dragging = false;
    moved = false;
    holdTimer = setTimeout(() => {
      if (pointerId !== event.pointerId) return;
      dragging = true;
      card.classList.add('dragging');
      try { card.setPointerCapture(pointerId); } catch (_) {}
    }, 190);
  });

  card.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    if (!dragging) {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      return;
    }
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.widget-edit-card');
    if (!target || target === card || target.parentElement !== grid) return;
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const horizontal = Math.abs(event.clientX - cx) > Math.abs(event.clientY - cy);
    const after = horizontal ? event.clientX > cx : event.clientY > cy;
    const nextSibling = after ? target.nextElementSibling : target;
    if (nextSibling !== card && nextSibling !== card.nextElementSibling) {
      grid.insertBefore(card, nextSibling || null);
      moved = true;
    }
  });

  const finish = (event) => {
    if (event.pointerId !== pointerId) return;
    clearTimeout(holdTimer);
    holdTimer = null;
    card.classList.remove('dragging');
    if (dragging && moved) {
      suppressClick = true;
      persistWidgetOrder(grid);
      setTimeout(() => { suppressClick = false; }, 500);
    }
    pointerId = null;
    dragging = false;
  };
  card.addEventListener('pointerup', finish);
  card.addEventListener('pointercancel', finish);
  card.addEventListener('lostpointercapture', finish);
  card.addEventListener('click', (event) => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick = false;
  }, true);
}

function openWidgetPicker() {
  const available = S.settings().widgets.filter((widget) => !widget.on);
  if (!available.length) { toast('Все виджеты уже добавлены'); return; }
  openSheet({
    title: 'Добавить виджет',
    left: { label: 'Отмена' },
    right: null,
    tall: true,
    build(api) {
      api.body.append(
        h('div', { class: 'widget-picker-list' }, available.map((widget) => h('button', {
          type: 'button',
          class: 'widget-picker-item',
          onclick: () => {
            const next = S.settings().widgets.map((item) => item.id === widget.id ? { ...item, on: true } : item);
            S.setSettings({ widgets: next });
            api.close(true);
            document.dispatchEvent(new CustomEvent('rerender'));
          },
        },
          h('span', { class: 'widget-picker-icon' }, ic(TITLES[widget.id]?.[1] || 'sparkle', 19)),
          h('span', { class: 'widget-picker-copy' }, h('b', null, TITLES[widget.id]?.[0] || widget.id), h('small', null, WIDGET_DESCRIPTIONS[widget.id] || 'Дополнительный виджет')),
          ic('plus', 18)))),
        h('div', { class: 'sheet-pad' }),
      );
    },
  });
}

const WIDGET_DESCRIPTIONS = {
  day: 'Общий процент выполненных дел и привычек',
  next: 'Следующее событие или задача по времени',
  habits: 'Быстрые отметки привычек на сегодня',
  agenda: 'События и задачи сегодняшнего дня',
  tasks: 'Список задач, запланированных на сегодня',
  goals: 'Краткий прогресс активных целей',
  week: 'Активность и выполнение за неделю',
  streak: 'Текущая серия выполнения привычек',
  overdue: 'Задачи, срок которых уже прошёл',
};

function makeWidgetCard(widget, index, ctx, grid) {
  const content = RENDER[widget.id] ? RENDER[widget.id](ctx, index) : null;
  if (!content || !widgetsEditMode) return content;
  const card = h('div', { class: 'widget-edit-card' + (WIDE.has(widget.id) ? ' wide' : ''), 'data-widget-id': widget.id },
    h('div', { class: 'widget-edit-tools' },
      h('button', { type: 'button', class: 'widget-edit-remove', 'aria-label': 'Удалить виджет ' + (TITLES[widget.id]?.[0] || widget.id), onclick: (event) => {
        event.stopPropagation();
        S.setSettings({ widgets: S.settings().widgets.map((item) => item.id === widget.id ? { ...item, on: false } : item) });
        document.dispatchEvent(new CustomEvent('rerender'));
      } }, ic('trash', 17))),
    content);
  bindWidgetDrag(card, grid);
  return card;
}

export function todayScreen() {
  const data = visibleEventsData(S.data());
  const today = todayStr();
  const ws = S.settings().widgets.filter((w) => w.on);
  const items = dayItems(data, today);
  const visibleTask = (item) => item.type !== 'task' || !item.done || isTaskInCompletionWindow(item.id);
  items.timed = items.timed.filter(visibleTask);
  items.dated = items.dated.filter(visibleTask);
  const ctx = { data, today, items, wsd: S.settings().weekStart };
  const total = data.goals.length + data.tasks.length + data.events.length + data.habits.length;

  const children = [];
  if (!total) {
    children.push(emptyState({ emoji: '👋', title: 'Добро пожаловать в «Ритм»', text: 'Здесь будут ваши цели, задачи, привычки и календарь. Начните с чего-нибудь одного — всё остальное свяжется само.', action: { label: 'Добавить первое', onClick: () => quickAdd() } }));
  } else if (!ws.length) {
    children.push(emptyState({ emoji: '🧩', title: 'Виджетов нет', text: 'Добавьте нужные блоки на экран «Сегодня».', action: { label: 'Добавить виджет', onClick: openWidgetPicker } }));
  } else {
    const grid = h('div', { class: 'widgets' });
    grid.append(...ws.map((widget, index) => makeWidgetCard(widget, index, ctx, grid)));
    if (widgetsEditMode) {
      grid.append(h('button', { type: 'button', class: 'widget-add-tile', onclick: openWidgetPicker }, ic('plus', 24), h('b', null, 'Добавить виджет')));
    }
    children.push(grid);
  }
  return screen({
    id: 'today', title: greeting(), eyebrow: fmtLong(today),
    actions: widgetsEditMode
      ? [navBtn('plus', 'Добавить виджет', openWidgetPicker), navBtn('check', 'Готово', () => { widgetsEditMode = false; document.dispatchEvent(new CustomEvent('rerender')); })]
      : [navBtn('edit', 'Изменить виджеты', () => { widgetsEditMode = true; document.dispatchEvent(new CustomEvent('rerender')); })],
    children,
  });
}

const RENDER = {
  day({ data, today }, i) {
    const s = dayScore(data, data.idx, today);
    return widgetShell('day', i, h('div', { class: 'w-center' },
      ring({ key: 'w-day', pct: s.pct, size: 92, stroke: 11, color: 'blue', center: h('div', { class: 'ring-big' }, h('b', null, Math.round(s.pct * 100)), h('small', null, '%')) }),
      h('div', { class: 'w-sub' }, s.total ? `${s.done} из ${s.total} дел` : 'Дел нет')));
  },

  next({ items, today }, i) {
    const now = nowMin();
    const up = items.timed.filter((x) => x.endMin > now && !x.done).sort((a, b) => a.startMin - b.startMin)[0];
    let body;
    if (up) {
      const ongoing = up.startMin <= now;
      const ms = localDate(today, fromMin(up.startMin)).getTime() - Date.now();
      body = h('div', { class: 'w-next' },
        h('div', { class: 'w-time' }, ongoing ? 'Сейчас' : fromMin(up.startMin)),
        h('div', { class: 'w-next-title', style: { '--c': cv(up.color) } }, up.title),
        h('div', { class: 'w-sub' }, ongoing ? `до ${fromMin(up.endMin)}` : fmtRemain(ms)));
    } else body = h('div', { class: 'w-next idle' }, h('div', { class: 'w-time' }, '✨'), h('div', { class: 'w-sub' }, items.timed.length ? 'На сегодня всё' : 'Расписание свободно'));
    return widgetShell('next', i, body, { onClick: () => go('calendar', { calDate: today }) });
  },

  habits({ data, today }, i) {
    const list = data.habits.filter((x) => isScheduled(x, today));
    const done = list.filter((x) => habitDone(data.idx, x, today)).length;
    const body = list.length
      ? h('div', { class: 'hchips' }, list.map((x) => habitChip(x, data, today, { onLong: () => openHabitDetail(x.id) })))
      : h('div', { class: 'w-empty' }, data.habits.length ? 'На сегодня привычек нет' : 'Привычек пока нет', h('button', { class: 'btn-tint', onclick: () => editHabit(null) }, ic('plus', 16), 'Добавить'));
    return widgetShell('habits', i, body, { extra: list.length ? h('span', { class: 'w-count' }, `${done}/${list.length}`) : null });
  },

  agenda({ items, today }, i) {
    const now = nowMin();
    const rows = [];
    for (const d of items.deadlines) rows.push({ k: 'g' + d.id, time: 'срок', title: `Цель: ${d.title}`, color: d.color, sub: null, onClick: () => openGoalDetail(d.id), past: false, order: -2 });
    for (const a of items.allDay) rows.push({ k: a.key, time: 'весь день', title: a.title, color: a.color, sub: a.ref.location, onClick: () => (a.ref.externalReadOnly ? openExternalEventDetails({ ...a.ref, date: a.date }) : editEvent(a.ref, {}, today)), past: false, order: -1 });
    for (const t of items.timed) rows.push({
      k: t.key, taskId: t.type === 'task' ? t.id : null, taskDone: !!t.done, time: fromMin(t.startMin), end: fromMin(t.endMin), title: t.title, color: t.color, sub: t.type === 'event' ? t.ref.location : 'Задача', past: t.endMin <= now || t.done, order: t.startMin,
      onClick: () => (t.type === 'event' ? (t.ref.externalReadOnly ? openExternalEventDetails({ ...t.ref, date: t.date }) : editEvent(t.ref, {}, today)) : editTask(t.ref)),
    });
    rows.sort((a, b) => a.order - b.order);
    const shown = rows.slice(0, 5);
    const body = rows.length
      ? h('div', { class: 'ag-list' }, shown.map((r) => h('div', { class: 'ag-row' + (r.past ? ' past' : '') + (r.taskId && isTaskExitStarted(r.taskId) ? ' task-completion-exit' : ''), ...(r.taskId ? { 'data-task-id': r.taskId, 'data-task-done': r.taskDone ? 'true' : 'false' } : {}), style: { '--c': cv(r.color) }, onclick: (e) => { e.stopPropagation(); r.onClick(); } },
        h('div', { class: 'ag-time' }, h('b', null, r.time), r.end ? h('span', null, r.end) : null), h('i', { class: 'ag-bar' }),
        h('div', { class: 'ag-main' }, h('b', null, r.title), r.sub ? h('span', null, r.sub) : null))),
        rows.length > 5 ? h('div', { class: 'w-more' }, `и ещё ${rows.length - 5}`) : null)
      : h('div', { class: 'w-empty' }, 'Сегодня нет событий', h('button', { class: 'btn-tint', onclick: (e) => { e.stopPropagation(); editEvent(null, { date: today }); } }, ic('plus', 16), 'Событие'));
    return widgetShell('agenda', i, body, { onClick: () => go('calendar', { calDate: today }) });
  },

  tasks({ data, today }, i) {
    const open = data.tasks.filter((t) => (!t.done || isTaskInCompletionWindow(t.id)) && t.date && t.date <= today).sort((a, b) => (a.date < today ? -1 : 0) - (b.date < today ? -1 : 0) || (a.time || '99').localeCompare(b.time || '99') || (b.priority || 0) - (a.priority || 0));
    const doneToday = data.tasks.filter((t) => t.done && t.date === today);
    const shown = open.slice(0, 5);
    const body = h('div', { class: 'w-tasks' },
      shown.length ? h('div', { class: 'list flat' }, shown.map((t) => taskRow(t, data, { compact: true, showDate: t.date < today }))) : h('div', { class: 'w-empty' }, doneToday.length ? 'Все задачи на сегодня выполнены 🎉' : 'На сегодня задач нет'),
      open.length > 5 ? h('button', { class: 'link-btn left', onclick: () => go('tasks', { tasksFilter: 'today' }) }, `Ещё ${open.length - 5}`) : null,
      h('button', { class: 'add-row', onclick: () => editTask(null, { date: today }) }, ic('plus', 18), 'Новая задача'));
    return widgetShell('tasks', i, body, { extra: h('span', { class: 'w-count' }, doneToday.length ? `${doneToday.length} ✓` : open.length ? String(open.length) : '') });
  },

  goals({ data }, i) {
    const tops = data.goals.filter((g) => !g.parentId && !g.archived).sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
    const body = tops.length
      ? h('div', { class: 'hscroll goals-row' }, tops.map((g) => {
        const p = goalProgress(g, data);
        return h('div', { class: 'mini-goal pressable', style: { '--c': cv(g.color || 'blue') }, onclick: () => openGoalDetail(g.id) },
          ring({ key: 'wg' + g.id, pct: p.pct, size: 62, stroke: 10, color: g.color || 'blue', center: h('span', { class: 'mg-emoji' }, g.emoji || '🎯') }),
          h('b', null, g.title), h('span', null, `${Math.round(p.pct * 100)}%`));
      }))
      : h('div', { class: 'w-empty' }, 'Целей пока нет', h('button', { class: 'btn-tint', onclick: () => editGoal(null) }, ic('plus', 16), 'Цель'));
    return widgetShell('goals', i, body, { extra: h('button', { class: 'w-link', onclick: () => go('goals') }, 'Все') });
  },

  week({ data, today }, i) {
    const days = [...Array(7)].map((_, k) => addDays(today, k - 6));
    const scores = days.map((d) => dayScore(data, data.idx, d));
    const avg = scores.filter((s) => s.total).reduce((a, s, _, arr) => a + s.pct / arr.length, 0);
    const body = h('div', { class: 'w-week' },
      h('div', { class: 'bars' }, days.map((d, k) => h('div', { class: 'bar-col' + (d === today ? ' today' : '') },
        h('div', { class: 'vbar' }, h('i', { style: { height: `${Math.max(scores[k].total ? 8 : 4, scores[k].pct * 100)}%`, '--d': k * 60 + 'ms' } })),
        h('span', null, WD_SHORT[dow(d)])))),
      h('div', { class: 'w-sub' }, `В среднем ${Math.round(avg * 100)}% выполнения за неделю`));
    return widgetShell('week', i, body);
  },

  streak({ data, today, wsd }, i) {
    const best = data.habits.filter((x) => !x.archived).map((x) => ({ x, st: habitStreaks(x, data.idx, today, wsd) })).sort((a, b) => b.st.current - a.st.current)[0];
    const n = best ? best.st.current : 0;
    return widgetShell('streak', i, h('div', { class: 'w-streak' },
      h('div', { class: 'w-big' }, ic('flame', 28, n ? 'hot' : ''), h('b', null, n)),
      h('div', { class: 'w-sub' }, best && n ? `${best.x.emoji || ''} ${best.x.title}` : 'Начните серию сегодня')),
      { onClick: () => go('habits') });
  },

  overdue({ data, today }, i) {
    const n = filterTasks(data.tasks, 'overdue', today).length;
    return widgetShell('overdue', i, h('div', { class: 'w-streak' + (n ? ' bad' : '') },
      h('div', { class: 'w-big' }, h('b', null, n)),
      h('div', { class: 'w-sub' }, n ? plural(n, ['задача ждёт', 'задачи ждут', 'задач ждут']) : 'Всё вовремя ✓')),
      { onClick: () => go('tasks', { tasksFilter: 'overdue' }) });
  },
};
