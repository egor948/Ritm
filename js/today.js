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
  let frameId = 0;
  let startX = 0, startY = 0;
  let latestX = 0, latestY = 0;
  let grabOffsetX = 0, grabOffsetY = 0;
  let dragging = false, moved = false, suppressClick = false;
  let placeholder = null;

  const captureLayout = () => new Map(
    [...grid.children]
      .filter((node) => node !== card)
      .map((node) => [node, node.getBoundingClientRect()]),
  );

  // FLIP: сохраняем фактические экранные координаты, меняем порядок в grid
  // и плавно переносим каждый соседний элемент на новое место.
  const animateLayout = (before) => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const [node, oldRect] of before) {
      if (!node.isConnected) continue;
      node.getAnimations().forEach((animation) => animation.cancel());
      const nextRect = node.getBoundingClientRect();
      const dx = oldRect.left - nextRect.left;
      const dy = oldRect.top - nextRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      node.animate(
        [
          { transform: 'translate3d(' + dx + 'px, ' + dy + 'px, 0) scale(.97)' },
          { transform: 'translate3d(0, 0, 0) scale(1)' },
        ],
        {
          duration: reduceMotion ? 1 : 280,
          easing: 'cubic-bezier(.2, .85, .25, 1)',
        },
      );
    }
  };

  const movePlaceholder = (x, y) => {
    if (!placeholder || !dragging) return;

    // Ищем ближайший виджет даже тогда, когда палец находится в промежутке
    // между карточками или над пустой частью сетки.
    const candidates = [...grid.querySelectorAll('.widget-edit-card')].filter((node) => node !== card);
    if (!candidates.length) return;

    let target = null;
    let nearestDistance = Infinity;
    for (const node of candidates) {
      const rect = node.getBoundingClientRect();
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        target = node;
      }
    }
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const useHorizontalSide = !target.classList.contains('wide')
      && Math.abs(x - centerX) > Math.abs(y - centerY);
    const after = useHorizontalSide ? x > centerX : y > centerY;
    const anchor = after ? target.nextElementSibling : target;

    if (anchor === placeholder || (!after && placeholder.nextElementSibling === target)) return;
    if (after && target.nextElementSibling === placeholder) return;

    const before = captureLayout();
    if (anchor) grid.insertBefore(placeholder, anchor);
    else grid.appendChild(placeholder);
    moved = true;
    animateLayout(before);
  };

  const scheduleFrame = () => {
    if (!frameId) frameId = requestAnimationFrame(dragFrame);
  };

  const dragFrame = () => {
    frameId = 0;
    if (!dragging || !placeholder) return;

    // Карточка физически следует за указателем, сохраняя точку захвата.
    card.style.left = (latestX - grabOffsetX) + 'px';
    card.style.top = (latestY - grabOffsetY) + 'px';
    movePlaceholder(latestX, latestY);

    // Автопрокрутка списка, если перетаскиваемый виджет подошёл к краю экрана.
    const scrollArea = grid.closest('.scroll');
    if (scrollArea) {
      const bounds = scrollArea.getBoundingClientRect();
      let delta = 0;
      if (latestY < bounds.top + 58) delta = -10;
      else if (latestY > bounds.bottom - 58) delta = 10;
      if (delta) {
        const previous = scrollArea.scrollTop;
        scrollArea.scrollTop = Math.max(0, previous + delta);
        if (scrollArea.scrollTop !== previous) {
          frameId = requestAnimationFrame(dragFrame);
        }
      }
    }
  };

  const startDrag = () => {
    if (pointerId == null || dragging) return;
    const rect = card.getBoundingClientRect();
    const before = captureLayout();

    dragging = true;
    moved = false;
    grabOffsetX = startX - rect.left;
    grabOffsetY = startY - rect.top;

    placeholder = document.createElement('div');
    placeholder.className = 'widget-drag-placeholder' + (card.classList.contains('wide') ? ' wide' : '');
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.style.height = rect.height + 'px';
    if (card.classList.contains('wide')) placeholder.style.gridColumn = '1 / -1';
    grid.insertBefore(placeholder, card);

    // Выносим саму карточку на верхний слой: она не занимает место в сетке,
    // а вместо неё сетка сразу получает живой placeholder.
    card.classList.add('dragging');
    card.style.position = 'fixed';
    card.style.left = rect.left + 'px';
    card.style.top = rect.top + 'px';
    card.style.width = rect.width + 'px';
    card.style.height = rect.height + 'px';
    card.style.margin = '0';
    card.style.transformOrigin = grabOffsetX + 'px ' + grabOffsetY + 'px';
    document.body.appendChild(card);
    if (card.setPointerCapture) {
      try { card.setPointerCapture(pointerId); } catch (_) { /* capture уже установлен */ }
    }
    scheduleFrame();
    animateLayout(before);
  };

  const clearFloatingStyle = () => {
    for (const property of ['position', 'left', 'top', 'width', 'height', 'margin', 'transform', 'transform-origin']) {
      card.style.removeProperty(property);
    }
  };

  const finish = (event) => {
    if (pointerId == null || (event && event.pointerId !== pointerId)) return;
    const releasedPointerId = pointerId;
    clearTimeout(holdTimer);
    holdTimer = null;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;

    if (dragging && placeholder && placeholder.isConnected) {
      // Применяем последнюю координату даже если отпускание произошло
      // между двумя кадрами анимации.
      card.style.left = (latestX - grabOffsetX) + 'px';
      card.style.top = (latestY - grabOffsetY) + 'px';
      movePlaceholder(latestX, latestY);

      const releaseRect = card.getBoundingClientRect();
      placeholder.replaceWith(card);
      placeholder = null;
      card.classList.remove('dragging');
      clearFloatingStyle();

      const finalRect = card.getBoundingClientRect();
      const dx = releaseRect.left - finalRect.left;
      const dy = releaseRect.top - finalRect.top;
      const scaleX = finalRect.width ? releaseRect.width / finalRect.width : 1;
      const scaleY = finalRect.height ? releaseRect.height / finalRect.height : 1;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(scaleX - 1) > .01) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        card.animate(
          [
            { transform: 'translate3d(' + dx + 'px, ' + dy + 'px, 0) scale(' + scaleX + ', ' + scaleY + ')' },
            { transform: 'translate3d(0, 0, 0) scale(1, 1)' },
          ],
          { duration: reduceMotion ? 1 : 300, easing: 'cubic-bezier(.2, .85, .25, 1)' },
        );
      }
      if (moved) persistWidgetOrder(grid);
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 450);
    } else if (placeholder) {
      placeholder.remove();
      placeholder = null;
    }

    pointerId = null;
    dragging = false;
    moved = false;
    card.classList.remove('dragging');
    if (card.hasPointerCapture && card.hasPointerCapture(releasedPointerId)) {
      try { card.releasePointerCapture(releasedPointerId); } catch (_) { /* pointer уже освобождён */ }
    }
  };

  card.addEventListener('pointerdown', (event) => {
    if (pointerId != null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.target.closest && event.target.closest('.widget-edit-remove')) return;

    pointerId = event.pointerId;
    startX = latestX = event.clientX;
    startY = latestY = event.clientY;
    dragging = false;
    moved = false;

    // Захват указателя устанавливается до долгого нажатия, поэтому карточка
    // не теряет движение пальца, когда переносится в верхний слой страницы.
    if (card.setPointerCapture) {
      try { card.setPointerCapture(pointerId); } catch (_) { /* fallback */ }
    }
    holdTimer = setTimeout(startDrag, 145);
  });

  card.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    latestX = event.clientX;
    latestY = event.clientY;
    if (!dragging) {
      if (Math.hypot(latestX - startX, latestY - startY) > 12) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      return;
    }
    event.preventDefault();
    scheduleFrame();
  });

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
