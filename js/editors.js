// Редакторы: задача, событие, привычка, цель + быстрое добавление и подтверждения.
import { h, uid, todayStr, addDays, fromMin, toMin, clear, WD_SHORT, plural, captureScrollPosition, restoreScrollPosition } from './util.js';
import * as S from './store.js';
import { REMINDER_OPTIONS, REPEAT_LABELS } from './logic.js';
import {
  openSheet, actionSheet, toast, ic, cv, group, groupTitle, groupNote, row, textInput, dateInput, timeInput, selectInput,
  numberInput, colorPicker, emojiPicker, pills, stepper, seg, toggle,
} from './ui.js';

const CATEGORIES = ['Здоровье', 'Карьера', 'Обучение', 'Финансы', 'Отношения', 'Личное'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240].map((m) => ({ v: m, label: m < 60 ? `${m} мин` : m % 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m / 60} ч` }));

export function goalOptions(data, { allowNone = true, noneLabel = 'Без цели' } = {}) {
  const opts = allowNone ? [{ v: null, label: noneLabel }] : [];
  for (const g of data.goals.filter((x) => !x.parentId && !x.archived)) {
    opts.push({ v: g.id, label: `${g.emoji || '🎯'} ${g.title}` });
    for (const s of data.goals.filter((x) => x.parentId === g.id && !x.archived)) opts.push({ v: s.id, label: `  ↳ ${s.title}` });
  }
  return opts;
}

const shake = (el) => el && el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 320 });

/** Общий каркас редактора: черновик, перерисовка по структурным изменениям, сохранение, удаление. */
function editorShell({ title, draft, draw, onSave, onDelete, deleteLabel = 'Удалить', valid, onClose }) {
  return openSheet({
    title, tall: true, onClose,
    left: { label: 'Отмена' },
    right: { label: 'Готово', bold: true, onClick: (api) => { const err = valid && valid(draft); if (err) { toast(err); return; } onSave(draft); api.close(true); } },
    build(api) {
      const redraw = () => {
        const scroll = captureScrollPosition(api.body);
        clear(api.body);
        draw(api.body, draft, redraw, api);
        if (onDelete) api.body.appendChild(h('div', { class: 'group' }, h('button', { class: 'row-btn danger', onclick: () => onDelete(api) }, deleteLabel)));
        api.body.appendChild(h('div', { class: 'sheet-pad' }));
        restoreScrollPosition(api.body, scroll);
      };
      redraw();
    },
  });
}

// Несколько независимых напоминаний с собственными датой и временем.
function remindersGroup(d, redraw, defaultDate) {
  if (!Array.isArray(d.reminders)) d.reminders = [];
  const list = h('div', { class: 'reminder-list' });
  let addButton;

  const makeCard = (reminder) => {
    reminder.id = reminder.id || uid();
    reminder.date = reminder.date || defaultDate || todayStr();
    reminder.time = reminder.time || '09:00';

    const date = dateInput(reminder.date, (v) => {
      if (v) reminder.date = v;
      else date.querySelector('input').value = reminder.date;
    }, { clearable: false });
    const time = timeInput(reminder.time, (v) => {
      if (v) reminder.time = v;
      else time.querySelector('input').value = reminder.time;
    }, { clearable: false });

    const card = h('div', { class: 'reminder-card', 'data-scroll-anchor': `reminder:${reminder.id}` },
      h('div', { class: 'reminder-card-head' },
        h('div', { class: 'reminder-card-title' }, h('span', {}, 'Напоминание')),
        h('button', { type: 'button', class: 'reminder-remove', 'aria-label': 'Удалить напоминание', onclick: () => {
          const index = d.reminders.findIndex((item) => item.id === reminder.id);
          if (index < 0) return;
          d.reminders.splice(index, 1);
          card.remove();
        } }, ic('x', 15))),
      h('div', { class: 'reminder-fields' },
        h('label', { class: 'reminder-field' }, h('span', {}, 'Дата'), date),
        h('label', { class: 'reminder-field' }, h('span', {}, 'Время'), time)));
    return card;
  };

  d.reminders.forEach((reminder) => list.appendChild(makeCard(reminder)));
  addButton = h('button', {
    type: 'button',
    class: 'reminder-add',
    onclick: () => {
      const reminder = { id: uid(), date: defaultDate || todayStr(), time: '09:00' };
      d.reminders.push(reminder);
      list.insertBefore(makeCard(reminder), addButton);
    },
  }, ic('plus', 17), 'Добавить напоминание');
  list.appendChild(addButton);
  return list;
}

function legacyTaskReminders(task) {
  if (Array.isArray(task.reminders)) return task.reminders.map((r) => ({ ...r }));
  let date = task.date;
  let time = task.remindAt || null;
  if (!time && date && task.time && task.reminderMin != null) {
    const at = new Date(`${date}T${task.time}:00`);
    at.setMinutes(at.getMinutes() - Number(task.reminderMin || 0));
    date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  }
  return date && time ? [{ id: uid(), date, time }] : [];
}

// =====================================================================
// Задача
// =====================================================================
export function editTask(task, defaults = {}) {
  const data = S.data();
  const isNew = !task;
  const draft = task
    ? { ...task, reminders: legacyTaskReminders(task), checklist: (task.checklist || []).map((c) => ({ ...c })) }
    : { title: '', notes: '', goalId: null, date: null, time: null, duration: 30, done: false, priority: 0, weight: 1, reminderMin: null, remindAt: null, reminders: [], checklist: [], ...defaults };
  const goalMode = () => { const g = data.goals.find((x) => x.id === draft.goalId); if (!g) return null; const p = g.parentId && data.goals.find((x) => x.id === g.parentId); return (p && (p.progressMode === 'weight' || g.progressMode === 'weight')) || g.progressMode === 'weight' ? 'weight' : null; };

  return editorShell({
    title: isNew ? 'Новая задача' : 'Задача',
    draft,
    valid: (d) => (!d.title.trim() ? 'Введите название задачи' : null),
    onSave: (d) => {
      const out = { ...d, title: d.title.trim(), checklist: d.checklist.filter((c) => c.text.trim()) };
      out.reminders = (out.reminders || []).filter((r) => r.date && r.time).map((r) => ({ id: r.id || uid(), date: r.date, time: r.time }));
      // Старые поля больше не используются после миграции в массив.
      out.reminderMin = null; out.remindAt = null;
      S.upsert('tasks', out);
    },
    onDelete: isNew ? null : (api) => {
      const inv = S.remove('tasks', task.id);
      api.close(true);
      toast('Задача удалена', { label: 'Отменить', onClick: () => S.undo(inv) });
    },
    draw(body, d, redraw) {
      const titleInp = textInput({ value: d.title, placeholder: 'Что нужно сделать?', big: true, onInput: (v) => (d.title = v), autofocus: isNew });
      body.append(
        group(h('div', { class: 'row solo' }, titleInp)),
        group(h('div', { class: 'row solo' }, textInput({ value: d.notes, placeholder: 'Заметки', multiline: true, onInput: (v) => (d.notes = v) }))),
        groupTitle('Цель'),
        group(row('Привязать к цели', selectInput(goalOptions(data), d.goalId, (v) => { d.goalId = v; redraw(); }), { icon: 'target', iconColor: 'green' })),
        goalMode() ? group(row('Вес в прогрессе', stepper(d.weight || 1, (v) => (d.weight = v), { min: 1, max: 10 }), { icon: 'flag', iconColor: 'orange' }), groupNote('Чем больше вес, тем сильнее выполнение задачи двигает прогресс цели.')) : null,
        groupTitle('Когда'),
        group(
          h('div', { class: 'row' }, pills({
            options: [{ v: 'today', label: 'Сегодня' }, { v: 'tomorrow', label: 'Завтра' }, { v: 'week', label: 'Через неделю' }, { v: 'none', label: 'Без даты' }],
            value: d.date === todayStr() ? 'today' : d.date === addDays(todayStr(), 1) ? 'tomorrow' : d.date === addDays(todayStr(), 7) ? 'week' : !d.date ? 'none' : null,
            onChange: (v) => { d.date = v === 'today' ? todayStr() : v === 'tomorrow' ? addDays(todayStr(), 1) : v === 'week' ? addDays(todayStr(), 7) : null; redraw(); },
          })),
          row('Дата', dateInput(d.date, (v) => { d.date = v; redraw(); }), { icon: 'calendar', iconColor: 'red' }),
          d.date ? row('Время', timeInput(d.time, (v) => { d.time = v; redraw(); }), { icon: 'clock', iconColor: 'blue' }) : null,
          d.date && d.time ? row('Длительность', selectInput(DURATIONS, d.duration || 30, (v) => (d.duration = v)), { icon: 'clock', iconColor: 'indigo' }) : null,
          ),
        groupTitle('Напоминания'),
        remindersGroup(d, redraw, d.date || todayStr()),
        groupTitle('Приоритет'),
        group(h('div', { class: 'row' }, seg({ options: [{ v: 0, label: 'Нет' }, { v: 1, label: '!' }, { v: 2, label: '!!' }, { v: 3, label: '!!!' }], value: d.priority || 0, onChange: (v) => (d.priority = v) }))),
        groupTitle('Чек-лист'),
        checklistGroup(d),
      );
    },
  });
}

function checklistGroup(d) {
  const g = h('div', { class: 'group' });
  const focusWithoutScroll = (input) => requestAnimationFrame(() => {
    if (input && input.isConnected) input.focus({ preventScroll: true });
  });

  const makeRow = (item) => {
    item.id = item.id || uid();
    const inp = textInput({ value: item.text, placeholder: 'Пункт', onInput: (v) => (item.text = v) });
    const rowEl = h('div', {
      class: 'row check-row',
      'data-check-id': item.id,
      'data-scroll-anchor': `checklist:${item.id}`,
    },
      h('button', { type: 'button', class: 'mini-chk' + (item.done ? ' on' : ''), onclick: (e) => {
        item.done = !item.done;
        e.currentTarget.classList.toggle('on', item.done);
      } }, ic('check', 14)),
      h('div', { class: 'row-label grow' }, inp),
      h('button', { type: 'button', class: 'mini-x vis', 'aria-label': 'Удалить пункт', onclick: () => {
        const index = d.checklist.findIndex((entry) => entry.id === item.id);
        if (index < 0) return;
        const next = d.checklist[index + 1] || d.checklist[index - 1];
        d.checklist.splice(index, 1);
        rowEl.remove();
        if (next) {
          const nextInput = g.querySelector(`[data-check-id="${next.id}"] .inp`);
          // Не перемещаем страницу при восстановлении фокуса после удаления.
          if (document.activeElement === inp) focusWithoutScroll(nextInput);
        }
      } }, ic('x', 14)));

    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const index = d.checklist.findIndex((entry) => entry.id === item.id);
      if (index < 0) return;
      const next = { id: uid(), text: '', done: false };
      d.checklist.splice(index + 1, 0, next);
      const nextRow = makeRow(next);
      g.insertBefore(nextRow, rowEl.nextSibling);
      focusWithoutScroll(nextRow.querySelector('.inp'));
    });
    return rowEl;
  };

  const addButton = h('button', {
    type: 'button',
    class: 'row-btn',
    onclick: () => {
      const item = { id: uid(), text: '', done: false };
      d.checklist.push(item);
      const row = makeRow(item);
      g.insertBefore(row, addButton);
      focusWithoutScroll(row.querySelector('.inp'));
    },
  }, ic('plus', 18), ' Добавить пункт');

  d.checklist.forEach((item) => g.appendChild(makeRow(item)));
  g.appendChild(addButton);
  return g;
}

export function editEvent(ev, defaults = {}, occDate = null) {
  const isNew = !ev;
  const base = { title: '', date: todayStr(), start: '10:00', end: '11:00', allDay: false, endDate: null, color: 'blue', location: '', notes: '', reminderMin: null, reminders: [], repeat: { freq: 'none', interval: 1, days: [], until: null } };
  const draft = ev ? { ...base, ...ev, reminders: (ev.reminders || []).map((r) => ({ ...r })), repeat: { ...base.repeat, ...(ev.repeat || {}) } } : { ...base, ...defaults, reminders: (defaults.reminders || []).map((r) => ({ ...r })) };
  const data = S.data();
  const tmpl = data.events;
  void tmpl;
  return editorShell({
    title: isNew ? 'Новое событие' : 'Событие',
    draft,
    valid: (d) => (!d.title.trim() ? 'Введите название события' : !d.allDay && d.end && d.start && toMin(d.end) <= toMin(d.start) ? 'Время окончания должно быть позже начала' : null),
    onSave: (d) => {
      const out = { ...d, title: d.title.trim(), reminders: (d.reminders || []).filter((r) => r.date && r.time).map((r) => ({ id: r.id || uid(), date: r.date, time: r.time })) };
      if (out.allDay) { out.start = null; out.end = null; if (out.endDate && out.endDate <= out.date) out.endDate = null; } else out.endDate = null;
      if (out.repeat.freq === 'none') out.repeat = { freq: 'none' };
      else if (out.repeat.freq !== 'weekly') out.repeat = { freq: out.repeat.freq, interval: out.repeat.interval || 1, until: out.repeat.until || null };
      S.upsert('events', out);
    },
    onDelete: isNew ? null : (api) => {
      const repeating = ev.repeat && ev.repeat.freq && ev.repeat.freq !== 'none';
      const doDelete = () => {
        const inv = S.remove('events', ev.id);
        api.close(true);
        toast('Событие удалено', { label: 'Отменить', onClick: () => S.undo(inv) });
      };
      if (!repeating || !occDate) return doDelete();
      actionSheet({
        title: 'Повторяющееся событие',
        actions: [
          { label: 'Только это событие', danger: true, onClick: () => { const inv = S.applyChanges([{ kind: 'events', rec: { ...ev, exdates: [...(ev.exdates || []), occDate] } }]); api.close(true); toast('Событие пропущено', { label: 'Отменить', onClick: () => S.undo(inv) }); } },
          { label: 'Всю серию', danger: true, onClick: doDelete },
        ],
      });
    },
    draw(body, d, redraw) {
      const r = d.repeat;
      body.append(
        group(h('div', { class: 'row solo' }, textInput({ value: d.title, placeholder: 'Название', big: true, onInput: (v) => (d.title = v), autofocus: isNew })),
          h('div', { class: 'row solo' }, textInput({ value: d.location, placeholder: 'Место', onInput: (v) => (d.location = v) }))),
        group(
          row('Весь день', toggle(d.allDay, (v) => { d.allDay = v; redraw(); }), { icon: 'sun', iconColor: 'orange' }),
          row(d.allDay ? 'Начало' : 'Дата', dateInput(d.date, (v) => { d.date = v || todayStr(); redraw(); }, { clearable: false }), { icon: 'calendar', iconColor: 'red' }),
          d.allDay ? row('Конец', dateInput(d.endDate, (v) => (d.endDate = v))) : null,
          !d.allDay ? row('Начало', timeInput(d.start, (v) => { d.start = v; if (v && (!d.end || toMin(d.end) <= toMin(v))) { d.end = fromMin(Math.min(1439, toMin(v) + 60)); } redraw(); }, { clearable: false }), { icon: 'clock', iconColor: 'blue' }) : null,
          !d.allDay ? row('Конец', timeInput(d.end, (v) => (d.end = v), { clearable: false })) : null),
        groupTitle('Повтор и напоминание'),
        group(
          row('Повтор', selectInput(Object.entries(REPEAT_LABELS).map(([v, label]) => ({ v, label })), r.freq || 'none', (v) => { r.freq = v; if (v === 'weekly' && (!r.days || !r.days.length)) r.days = []; redraw(); }), { icon: 'repeat', iconColor: 'green' }),
          r.freq === 'weekly' ? h('div', { class: 'row' }, pills({ multi: true, options: WEEK_ORDER.map((n) => ({ v: n, label: WD_SHORT[n] })), value: r.days && r.days.length ? r.days : [new Date(d.date + 'T00:00').getDay()], onChange: (v) => (r.days = v) })) : null,
          r.freq && r.freq !== 'none' ? row('Каждые', stepper(r.interval || 1, (v) => (r.interval = v), { min: 1, max: 30, format: (v) => `${v} ${r.freq === 'daily' ? plural(v, ['день', 'дня', 'дней']) : r.freq === 'weekly' ? plural(v, ['неделю', 'недели', 'недель']) : r.freq === 'monthly' ? plural(v, ['месяц', 'месяца', 'месяцев']) : plural(v, ['год', 'года', 'лет'])}` })) : null,
          r.freq && r.freq !== 'none' ? row('Повторять до', dateInput(r.until, (v) => (r.until = v))) : null,
          row('Старое напоминание перед началом', selectInput(REMINDER_OPTIONS.map((o) => ({ v: o.v, label: d.allDay && o.v != null ? (o.v === 0 ? 'В 9:00 в этот день' : o.label) : o.label })).filter((o) => !d.allDay || o.v === null || o.v === 0), d.reminderMin, (v) => (d.reminderMin = v)), { icon: 'bell', iconColor: 'orange' })),
        groupTitle('Дополнительные напоминания'),
        remindersGroup(d, redraw, d.date),
        groupTitle('Цвет'),
        group(h('div', { class: 'row' }, colorPicker(d.color, (v) => (d.color = v)))),
        group(h('div', { class: 'row solo' }, textInput({ value: d.notes, placeholder: 'Заметки', multiline: true, onInput: (v) => (d.notes = v) }))),
      );
    },
  });
}

// =====================================================================
// Привычка
// =====================================================================
export function editHabit(habit, defaults = {}) {
  const isNew = !habit;
  const draft = habit ? { ...habit, schedule: { ...(habit.schedule || { type: 'daily' }) } }
    : { title: '', emoji: '🌱', color: 'green', type: 'check', target: 1, unit: '', schedule: { type: 'daily', days: [], perWeek: 3 }, time: null, remind: false, goalId: null, startDate: todayStr(), ...defaults };
  const data = S.data();
  return editorShell({
    title: isNew ? 'Новая привычка' : 'Привычка',
    draft,
    valid: (d) => (!d.title.trim() ? 'Введите название привычки' : d.schedule.type === 'days' && !(d.schedule.days || []).length ? 'Выберите дни недели' : null),
    onSave: (d) => {
      const out = { ...d, title: d.title.trim() };
      if (out.type === 'check') { out.target = 1; out.unit = ''; }
      if (!out.time) out.remind = false;
      S.upsert('habits', out);
    },
    onDelete: isNew ? null : (api) => {
      const inv = S.remove('habits', habit.id);
      api.close(true);
      toast('Привычка удалена', { label: 'Отменить', onClick: () => S.undo(inv) });
    },
    draw(body, d, redraw, api) {
      const s = d.schedule;
      body.append(
        group(h('div', { class: 'row solo' }, textInput({ value: d.title, placeholder: 'Название привычки', big: true, onInput: (v) => (d.title = v), autofocus: isNew }))),
        group(h('div', { class: 'row col' }, emojiPicker(d.emoji, (v) => (d.emoji = v))), h('div', { class: 'row' }, colorPicker(d.color, (v) => (d.color = v)))),
        groupTitle('Как отмечать'),
        group(
          h('div', { class: 'row' }, seg({ options: [{ v: 'check', label: 'Да / нет' }, { v: 'count', label: 'Счётчик' }, { v: 'timer', label: 'Таймер' }], value: d.type, onChange: (v) => { d.type = v; if (v !== 'check' && (!d.target || d.target < 1)) d.target = v === 'timer' ? 10 : 8; if (v === 'timer') d.unit = 'мин'; redraw(); } })),
          d.type !== 'check' ? row(d.type === 'timer' ? 'Цель, минут' : 'Цель в день', numberInput(d.target, (v) => (d.target = v || 1), { width: '90px' })) : null,
          d.type === 'count' ? row('Единица', textInput({ value: d.unit, placeholder: 'стаканов, страниц…', onInput: (v) => (d.unit = v) })) : null),
        groupTitle('Расписание'),
        group(
          h('div', { class: 'row' }, seg({ options: [{ v: 'daily', label: 'Каждый день' }, { v: 'days', label: 'По дням' }, { v: 'weekly', label: 'N в неделю' }], value: s.type, onChange: (v) => { s.type = v; redraw(); } })),
          s.type === 'days' ? h('div', { class: 'row' }, pills({ multi: true, options: WEEK_ORDER.map((n) => ({ v: n, label: WD_SHORT[n] })), value: s.days || [], onChange: (v) => (s.days = v) })) : null,
          s.type === 'weekly' ? row('Раз в неделю', stepper(s.perWeek || 3, (v) => (s.perWeek = v), { min: 1, max: 7 })) : null),
        groupTitle('Напоминание и цель'),
        group(
          row('Время', timeInput(d.time, (v) => { d.time = v; redraw(); }), { icon: 'clock', iconColor: 'blue' }),
          d.time ? row('Напоминать', toggle(d.remind, (v) => (d.remind = v)), { icon: 'bell', iconColor: 'orange' }) : null,
          row('Цель', selectInput(goalOptions(data), d.goalId, (v) => (d.goalId = v)), { icon: 'target', iconColor: 'green' })),
        groupNote('Привычку можно связать с целью — она появится на странице цели и учтётся в общей картине.'),
        !isNew ? group(h('button', { class: 'row-btn', onclick: () => { S.upsert('habits', { id: habit.id, archived: !habit.archived }); toast(habit.archived ? 'Привычка возвращена' : 'Привычка в архиве'); api.close(true); } }, habit.archived ? 'Вернуть из архива' : 'Архивировать')) : null,
      );
    },
  });
}

// =====================================================================
// Цель / подцель
// =====================================================================
export function editGoal(goal, defaults = {}) {
  const isNew = !goal;
  const data = S.data();
  const parent = goal ? data.goals.find((g) => g.id === goal.parentId) : defaults.parentId ? data.goals.find((g) => g.id === defaults.parentId) : null;
  const isSub = !!(parent || (goal && goal.parentId));
  const draft = goal
    ? { ...goal, metric: { ...(goal.metric || { start: 0, target: 100, current: 0, unit: '' }) } }
    : { title: '', emoji: isSub ? '🔹' : '🎯', color: parent ? parent.color : 'blue', category: '', deadline: null, progressMode: 'tasks', metric: { start: 0, target: 100, current: 0, unit: '' }, notes: '', parentId: null, ...defaults };
  return editorShell({
    title: isNew ? (isSub ? 'Новая подцель' : 'Новая цель') : isSub ? 'Подцель' : 'Цель',
    draft,
    valid: (d) => (!d.title.trim() ? 'Введите название' : d.progressMode === 'metric' && (d.metric.target == null || d.metric.target === d.metric.start) ? 'Укажите целевое значение, отличное от начального' : null),
    onSave: (d) => {
      const out = { ...d, title: d.title.trim() };
      if (out.progressMode === 'metric') {
        const m = out.metric;
        m.start = Number(m.start) || 0; m.target = Number(m.target) || 0; m.current = m.current == null ? m.start : Number(m.current);
        const prev = goal && goal.metric ? goal.metric.current : null;
        if (prev !== m.current) m.history = [...((goal && goal.metric && goal.metric.history) || []), { date: todayStr(), value: m.current }].slice(-60);
        else m.history = (goal && goal.metric && goal.metric.history) || [];
      }
      S.upsert('goals', out);
    },
    onDelete: isNew ? null : (api) => {
      const subs = data.goals.filter((g) => g.parentId === goal.id);
      const ids = new Set([goal.id, ...subs.map((s) => s.id)]);
      const n = data.tasks.filter((t) => ids.has(t.goalId)).length;
      actionSheet({
        title: `Удалить «${goal.title}»?`,
        message: n || subs.length ? `Будут удалены подцели (${subs.length}) и задачи (${n}). Привычки останутся, но отвяжутся от цели.` : undefined,
        actions: [{ label: 'Удалить', danger: true, onClick: () => { const inv = S.removeGoal(goal.id); api.close(true); document.dispatchEvent(new CustomEvent('goal-deleted', { detail: goal.id })); toast('Цель удалена', { label: 'Отменить', onClick: () => S.undo(inv) }); } }],
      });
    },
    draw(body, d, redraw, api) {
      const m = d.metric;
      body.append(
        group(h('div', { class: 'row solo' }, textInput({ value: d.title, placeholder: isSub ? 'Название подцели' : 'Чего вы хотите достичь?', big: true, onInput: (v) => (d.title = v), autofocus: isNew }))),
        group(h('div', { class: 'row col' }, emojiPicker(d.emoji, (v) => (d.emoji = v))), h('div', { class: 'row' }, colorPicker(d.color, (v) => (d.color = v)))),
        !isSub ? [
          groupTitle('Категория и срок'),
          group(
            h('div', { class: 'row' }, pills({ options: CATEGORIES.map((c) => ({ v: c, label: c })), value: d.category, onChange: (v) => (d.category = v === d.category ? '' : v) })),
            row('Своя категория', textInput({ value: CATEGORIES.includes(d.category) ? '' : d.category, placeholder: 'Название', onInput: (v) => (d.category = v) })),
            row('Срок', dateInput(d.deadline, (v) => (d.deadline = v)), { icon: 'flag', iconColor: 'red' })),
        ] : null,
        groupTitle('Как считать прогресс'),
        group(h('div', { class: 'row' }, seg({ options: [{ v: 'tasks', label: 'По задачам' }, { v: 'weight', label: 'По весу' }, { v: 'metric', label: 'Метрика' }], value: d.progressMode || 'tasks', onChange: (v) => { d.progressMode = v; redraw(); } }))),
        h('div', { class: 'group-note' }, d.progressMode === 'metric' ? 'Прогресс — это движение от начального значения к целевому, например «пробежать 150 км» или «похудеть с 90 до 80 кг».' : d.progressMode === 'weight' ? 'Каждая задача имеет вес (1–10). Выполнение тяжёлых задач двигает цель сильнее.' : 'Прогресс — доля выполненных задач цели и её подцелей.'),
        d.progressMode === 'metric' ? group(
          row('Начальное значение', numberInput(m.start, (v) => (m.start = v), { width: '110px' })),
          row('Сейчас', numberInput(m.current, (v) => (m.current = v), { width: '110px' })),
          row('Цель', numberInput(m.target, (v) => (m.target = v), { width: '110px' })),
          row('Единица', textInput({ value: m.unit, placeholder: 'км, ₽, кг…', onInput: (v) => (m.unit = v) }))) : null,
        group(h('div', { class: 'row solo' }, textInput({ value: d.notes, placeholder: 'Заметки: зачем эта цель, как поймёте, что достигли', multiline: true, onInput: (v) => (d.notes = v) }))),
        !isNew ? group(h('button', { class: 'row-btn', onclick: () => { S.upsert('goals', { id: goal.id, archived: !goal.archived }); toast(goal.archived ? 'Цель возвращена' : 'Цель в архиве'); document.dispatchEvent(new CustomEvent('goal-deleted', { detail: goal.id })); api.close(true); } }, goal.archived ? 'Вернуть из архива' : 'Архивировать')) : null,
      );
    },
  });
}

// =====================================================================
// Быстрое добавление
// =====================================================================
export function quickAdd({ date = null } = {}) {
  openSheet({
    title: 'Добавить', left: null, right: { label: 'Закрыть', onClick: (api) => api.close() },
    build(api) {
      let text = '';
      const add = (when) => {
        if (!text.trim()) { shake(input); input.focus(); return; }
        S.upsert('tasks', { title: text.trim(), done: false, goalId: null, date: when === 'today' ? todayStr() : when === 'tomorrow' ? addDays(todayStr(), 1) : when === 'date' ? date : null, priority: 0, weight: 1, checklist: [] });
        api.close(true);
        toast('Задача добавлена');
      };
      const input = textInput({ placeholder: 'Быстрая задача…', big: true, onInput: (v) => (text = v) });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(date ? 'date' : 'today'); });
      const tile = (icon, color, label, sub, fn) => h('button', { class: 'tile', style: { '--c': cv(color) }, onclick: () => { api.close(true); setTimeout(fn, 120); } }, h('span', { class: 'tile-ic' }, ic(icon, 24)), h('b', null, label), h('small', null, sub));
      api.body.append(
        group(h('div', { class: 'row solo' }, input)),
        h('div', { class: 'quick-when' }, pills({ options: [{ v: 'today', label: 'Сегодня' }, { v: 'tomorrow', label: 'Завтра' }, { v: 'none', label: 'Во входящие' }], value: null, onChange: add })),
        h('div', { class: 'tiles' },
          tile('list', 'blue', 'Задача', 'с датой, целью и чек-листом', () => editTask(null, date ? { date } : {})),
          tile('calendar', 'red', 'Событие', 'встреча, поездка, повтор', () => editEvent(null, date ? { date } : {})),
          tile('flame', 'orange', 'Привычка', 'ежедневная или по расписанию', () => editHabit(null)),
          tile('target', 'green', 'Цель', 'с подцелями и прогрессом', () => editGoal(null))),
        h('div', { class: 'sheet-pad' }));
      setTimeout(() => input.focus(), 450);
    },
  });
}
