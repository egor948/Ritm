// Редакторы: задача, событие, привычка, цель + быстрое добавление и подтверждения.
import { h, uid, todayStr, addDays, fromMin, toMin, ymd, localDate, clear, WD_SHORT, plural, captureScrollPosition, restoreScrollPosition } from './util.js';
import * as S from './store.js';
import * as Push from './push.js';
import { DEFAULT_CALENDAR_ID, calendarOptions } from './calendars.js';
import { REPEAT_LABELS, isReminderInFuture, isDateNotPast } from './logic.js';
import {
  openSheet, actionSheet, toast, ic, cv, group, groupTitle, groupNote, row, textInput, dateInput, timeInput, selectInput,
  numberInput, colorPicker, emojiPicker, pills, stepper, seg, toggle,
} from './ui.js';

const CATEGORIES = ['Здоровье', 'Карьера', 'Обучение', 'Финансы', 'Отношения', 'Личное'];

const PUSH_PROMPT_KEY = 'rhythm.push-prompt.v1';
let pushPromptHandled = false;

function rememberPushPromptChoice() {
  pushPromptHandled = true;
  try { localStorage.setItem(PUSH_PROMPT_KEY, '1'); } catch (_) { /* приватный режим */ }
}

/** Предлагает включить push после сохранения первого нового напоминания на устройстве. */
function offerPushPromptForNewReminder() {
  setTimeout(async () => {
    if (pushPromptHandled) return;
    try {
      if (localStorage.getItem(PUSH_PROMPT_KEY) === '1') {
        pushPromptHandled = true;
        return;
      }
    } catch (_) { /* используем флаг текущей сессии */ }

    await Push.refresh().catch(() => {});
    const state = Push.state();
    // Если разрешение уже выдано, уведомления уже работают или браузер
    // не поддерживает Web Push, не отвлекаем пользователя повторным вопросом.
    if (!state.supported || state.permission === 'denied' || state.subscribed) return;

    openSheet({
      title: '',
      left: null,
      right: null,
      cls: 'action',
      onClose: rememberPushPromptChoice,
      build(api) {
        api.body.append(
          h('div', { class: 'as-card push-prompt-card' },
            h('div', { class: 'push-prompt-head' },
              h('div', { class: 'push-prompt-icon' }, ic('bell', 25)),
              h('b', null, 'Включить push-уведомления?'),
              h('span', null, 'Разрешите «Ритму» присылать напоминания на этом устройстве. Для доставки, когда приложение закрыто, войдите в аккаунт Ritm.')),
            h('button', {
              type: 'button',
              class: 'as-btn push-prompt-enable',
              onclick: async () => {
                api.close(true);
                try {
                  const enabled = await Push.enable();
                  if (enabled) rememberPushPromptChoice();
                  else {
                    const message = Push.state().hint;
                    if (message) toast(message);
                  }
                } catch (error) {
                  toast(error.message || 'Не удалось включить уведомления');
                }
              },
            }, 'Включить'),
            h('button', {
              type: 'button',
              class: 'as-btn push-prompt-later',
              onclick: () => api.close(),
            }, 'Позже')),
        );
      },
    });
  }, 440);
}
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const normalizeImportance = (value) => { const n = Number(value); return Number.isFinite(n) ? Math.max(1, Math.min(5, Math.round(n))) : 3; };

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
function editorShell({ title, draft, draw, onSave, onDelete, deleteLabel = 'Удалить', valid, onClose, afterSave }) {
  return openSheet({
    title, tall: true, onClose,
    left: { label: 'Отмена' },
    right: { label: 'Готово', bold: true, onClick: (api) => {
      const err = valid && valid(draft);
      if (err) { toast(err); return; }
      onSave(draft);
      api.close(true);
      if (afterSave) setTimeout(() => afterSave(draft), 440);
    } },
    build(api) {
      const redraw = () => {
        const scroll = captureScrollPosition(api.body);
        // Prevent the sheet's generic observer from restoring a stale position
        // while the editor replaces controls after a segmented selection.
        api.body.dataset.scrollMode = 'free';
        clear(api.body);
        draw(api.body, draft, redraw, api);
        if (onDelete) api.body.appendChild(h('div', { class: 'group' }, h('button', { class: 'row-btn danger', onclick: () => onDelete(api) }, deleteLabel)));
        api.body.appendChild(h('div', { class: 'sheet-pad' }));
        restoreScrollPosition(api.body, scroll);
        requestAnimationFrame(() => requestAnimationFrame(() => { if (api.body.isConnected) delete api.body.dataset.scrollMode; }));
      };
      redraw();
    },
  });
}

// Следующая доступная минута — напоминания нельзя назначать в прошлом.
function reminderThreshold(now = new Date()) {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  return { date: ymd(next), time: fromMin(next.getHours() * 60 + next.getMinutes()) };
}

function reminderDefaults(preferredDate) {
  const threshold = reminderThreshold();
  const date = preferredDate && preferredDate >= threshold.date ? preferredDate : threshold.date;
  return { date, time: date === threshold.date ? threshold.time : '09:00' };
}

function reminderSnapshot(reminders) {
  return new Map((reminders || []).map((r) => [r.id, { date: r.date, time: r.time }]));
}

function changedReminderIsPast(reminders, original) {
  const now = new Date();
  return (reminders || []).some((r) => {
    const before = original.get(r.id);
    if (before && before.date === r.date && before.time === r.time) return false;
    return !isReminderInFuture(r, now);
  });
}

function changedDateIsPast(date, originalDate, explicitlyChanged = false) {
  return Boolean(date && !isDateNotPast(date) && (explicitlyChanged || date !== originalDate));
}

function taskReminderBoundary(taskDate, taskTime) {
  if (!taskDate) return null;
  const due = taskTime ? localDate(taskDate, taskTime) : localDate(addDays(taskDate, 1), '00:00');
  // Для задачи со временем разрешаем напоминание ровно в момент срока.
  // У задачи без времени крайним моментом остаётся 23:59 указанной даты.
  const latest = taskTime ? due : new Date(due.getTime() - 60000);
  return { date: ymd(latest), time: fromMin(latest.getHours() * 60 + latest.getMinutes()) };
}

function reminderIsAfterTask(reminder, taskDate, taskTime) {
  if (!taskDate || !reminder?.date || !reminder?.time) return false;
  const boundary = taskReminderBoundary(taskDate, taskTime);
  return reminder.date > boundary.date || (reminder.date === boundary.date && reminder.time > boundary.time);
}

function taskReminderDefaults(preferredDate, taskDate, taskTime, existing = []) {
  const defaults = reminderDefaults(preferredDate);
  const boundary = taskReminderBoundary(taskDate, taskTime);
  if (boundary) {
    if (defaults.date > boundary.date) {
      defaults.date = boundary.date;
      defaults.time = boundary.time;
    } else if (defaults.date === boundary.date && defaults.time > boundary.time) {
      defaults.time = boundary.time;
    }
  }
  const threshold = reminderThreshold();
  if (defaults.date < threshold.date || (defaults.date === threshold.date && defaults.time < threshold.time)) return null;

  const candidate = localDate(defaults.date, defaults.time);
  for (let attempt = 0; existing.some((reminder) => reminder.date === ymd(candidate) && reminder.time === fromMin(candidate.getHours() * 60 + candidate.getMinutes())); attempt++) {
    if (attempt >= 180) return null;
    candidate.setMinutes(candidate.getMinutes() + 1);
    const next = { date: ymd(candidate), time: fromMin(candidate.getHours() * 60 + candidate.getMinutes()) };
    if (reminderIsAfterTask(next, taskDate, taskTime) || !isReminderInFuture(next, new Date())) return null;
  }
  return { date: ymd(candidate), time: fromMin(candidate.getHours() * 60 + candidate.getMinutes()) };
}

function hasDuplicateTaskReminders(reminders) {
  const seen = new Set();
  for (const reminder of reminders || []) {
    if (!reminder.date || !reminder.time) continue;
    const key = `${reminder.date}T${reminder.time}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

// Несколько независимых напоминаний с собственными датой и временем.
function remindersGroup(d, redraw, defaultDate) {
  if (!Array.isArray(d.reminders)) d.reminders = [];
  const list = h('div', { class: 'reminder-list' });
  const refreshers = new Set();
  let addButton;

  const makeCard = (reminder) => {
    reminder.id = reminder.id || uid();
    const fallback = reminderDefaults(defaultDate);
    reminder.date = reminder.date || fallback.date;
    reminder.time = reminder.time || reminderDefaults(reminder.date).time;

    const date = dateInput(reminder.date, (v) => {
      const threshold = reminderThreshold();
      if (!v || v < threshold.date) {
        date.querySelector('input').value = reminder.date;
        toast('Нельзя поставить напоминание на прошедшую дату');
        return;
      }
      if (reminderIsAfterTask({ ...reminder, date: v }, d.date, d.time)) {
        date.querySelector('input').value = reminder.date;
        toast('Напоминание не может быть позже срока задачи');
        return;
      }
      if (d.reminders.some((item) => item.id !== reminder.id && item.date === v && item.time === reminder.time)) {
        date.querySelector('input').value = reminder.date;
        toast('На это время у задачи уже есть напоминание');
        return;
      }
      reminder.date = v;
      refreshLimits();
    }, { clearable: false });
    const time = timeInput(reminder.time, (v) => {
      if (!v || !isReminderInFuture({ date: reminder.date, time: v }, new Date())) {
        time.querySelector('input').value = reminder.time;
        toast('Нельзя поставить напоминание на прошедшее время');
        return;
      }
      if (reminderIsAfterTask({ ...reminder, time: v }, d.date, d.time)) {
        time.querySelector('input').value = reminder.time;
        toast('Напоминание не может быть позже срока задачи');
        return;
      }
      if (d.reminders.some((item) => item.id !== reminder.id && item.date === reminder.date && item.time === v)) {
        time.querySelector('input').value = reminder.time;
        toast('На это время у задачи уже есть напоминание');
        return;
      }
      reminder.time = v;
      refreshLimits();
    }, { clearable: false });

    const refreshLimits = () => {
      const threshold = reminderThreshold();
      const boundary = taskReminderBoundary(d.date, d.time);
      const dateField = date.querySelector('input');
      const timeField = time.querySelector('input');
      dateField.min = threshold.date;
      dateField.max = boundary?.date || '';
      timeField.min = reminder.date === threshold.date ? threshold.time : '';
      timeField.max = boundary && reminder.date === boundary.date ? boundary.time : '';
    };
    refreshLimits();
    refreshers.add(refreshLimits);

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
      const defaults = taskReminderDefaults(d.date || defaultDate || todayStr(), d.date, d.time, d.reminders);
      if (!defaults) {
        toast('Для этой задачи уже нет будущего времени напоминания');
        return;
      }
      const reminder = { id: uid(), ...defaults };
      d.reminders.push(reminder);
      list.insertBefore(makeCard(reminder), addButton);
    },
  }, ic('plus', 17), 'Добавить напоминание');
  list.appendChild(addButton);
  list.refreshTaskLimits = () => refreshers.forEach((refresh) => refresh());
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
    : { title: '', notes: '', goalId: null, date: null, time: null, done: false, priority: 0, weight: 3, reminderMin: null, remindAt: null, reminders: [], checklist: [], ...defaults };
  delete draft.duration;
  const originalDate = task ? (task.date || null) : null;
  let dateWasChanged = false;
  let selectedDatePreset = draft.date === todayStr() ? 'today' : draft.date === addDays(todayStr(), 1) ? 'tomorrow' : draft.date === addDays(todayStr(), 7) ? 'week' : !draft.date ? 'none' : null;
  draft.reminders = (draft.reminders || []).map((r) => ({ ...r, id: r.id || uid() }));
  const originalReminders = reminderSnapshot(draft.reminders);

  return editorShell({
    title: isNew ? 'Новая задача' : 'Задача',
    draft,
    valid: (d) => (!d.title.trim() ? 'Введите название задачи'
      : changedDateIsPast(d.date, originalDate, dateWasChanged) ? 'Нельзя назначить задачу на прошедшую дату'
        : changedReminderIsPast(d.reminders, originalReminders) ? 'Дата и время нового напоминания должны быть в будущем'
          : d.reminders.some((r) => reminderIsAfterTask(r, d.date, d.time)) ? 'Напоминание не может быть позже срока задачи'
            : hasDuplicateTaskReminders(d.reminders) ? 'Уберите повторяющиеся напоминания' : null),
    onSave: (d) => {
      const out = { ...d, title: d.title.trim(), priority: normalizePriority(d.priority), weight: normalizeImportance(d.weight), checklist: d.checklist.filter((c) => c.text.trim()) };
      out.reminders = (out.reminders || []).filter((r) => r.date && r.time).map((r) => ({ id: r.id || uid(), date: r.date, time: r.time }));
      out.duration = null;
      // Старые поля больше не используются после миграции в массив.
      out.reminderMin = null; out.remindAt = null;
      S.upsert('tasks', out);
    },
    afterSave: (d) => {
      if (d.reminders.some((reminder) => !originalReminders.has(reminder.id))) {
        offerPushPromptForNewReminder();
      }
    },
    onDelete: isNew ? null : (api) => {
      const inv = S.remove('tasks', task.id);
      api.close(true);
      toast('Задача удалена', { label: 'Отменить', onClick: () => S.undo(inv) });
    },
    draw(body, d, redraw) {
      const titleInp = textInput({ value: d.title, placeholder: 'Что нужно сделать?', big: true, onInput: (v) => (d.title = v), autofocus: isNew });
      let taskDatePresets;
      let taskTimeRow;
      let taskReminderList;
      const refreshTaskReminderLimits = () => taskReminderList?.refreshTaskLimits();
      const taskDateControl = dateInput(d.date, (v) => {
        if (changedDateIsPast(v, originalDate, true)) {
          taskDateControl.querySelector('input').value = d.date || '';
          toast('Нельзя назначить задачу на прошедшую дату');
          return;
        }
        dateWasChanged = true;
        d.date = v;
        selectedDatePreset = null;
        taskDatePresets?.querySelectorAll('.pill').forEach((pill) => pill.classList.remove('on'));
        if (taskTimeRow) taskTimeRow.style.display = d.date ? '' : 'none';
        refreshTaskReminderLimits();
      }, { min: todayStr() });
      taskTimeRow = row('Время', timeInput(d.time, (v) => {
        d.time = v;
        refreshTaskReminderLimits();
      }), { icon: 'clock', iconColor: 'blue' });
      taskTimeRow.style.display = d.date ? '' : 'none';
      const datePresets = taskDatePresets = pills({
        options: [{ v: 'today', label: 'Сегодня' }, { v: 'tomorrow', label: 'Завтра' }, { v: 'week', label: 'Через неделю' }, { v: 'none', label: 'Без даты' }],
        value: selectedDatePreset,
        onChange: (v) => {
          const nextDate = v === 'today' ? todayStr() : v === 'tomorrow' ? addDays(todayStr(), 1) : v === 'week' ? addDays(todayStr(), 7) : null;
          if (changedDateIsPast(nextDate, originalDate, true)) { toast('Нельзя назначить задачу на прошедшую дату'); return; }
          dateWasChanged = true;
          selectedDatePreset = v;
          d.date = nextDate;
          taskDateControl.querySelector('input').value = nextDate || '';
          if (taskTimeRow) taskTimeRow.style.display = nextDate ? '' : 'none';
          refreshTaskReminderLimits();
        },
      });
      taskReminderList = remindersGroup(d, redraw, d.date || todayStr());
      body.append(
        group(h('div', { class: 'row solo' }, titleInp)),
        group(h('div', { class: 'row solo' }, textInput({ value: d.notes, placeholder: 'Заметки', multiline: true, onInput: (v) => (d.notes = v) }))),
        groupTitle('Цель'),
        group(row('Привязать к цели', selectInput(goalOptions(data), d.goalId, (v) => { d.goalId = v; redraw(); }), { icon: 'target', iconColor: 'green' })),
        d.goalId ? group(
          row('Важность для цели', stepper(d.weight || 3, (v) => (d.weight = v), { min: 1, max: 5 }), { icon: 'flag', iconColor: 'orange' }),
          groupNote('Важность от 1 до 5 определяет, насколько выполнение задачи влияет на прогресс цели или подцели.'),
        ) : null,
        groupTitle('Когда'),
        group(
          h('div', { class: 'row' }, datePresets),
          row('Дата', taskDateControl, { icon: 'calendar', iconColor: 'red' }),
          taskTimeRow,
        ),
        groupTitle('Напоминания'),
        taskReminderList,
        groupTitle('Приоритет'),
        group(prioritySelector(d)),
        groupTitle('Чек-лист'),
        checklistGroup(d),
      );
    },
  });
}

function normalizePriority(value) {
  const priority = Number(value);
  return Number.isInteger(priority) && priority >= 0 && priority <= 3 ? priority : 0;
}

function prioritySelector(d) {
  const options = [{ value: 0, label: 'Нет' }, { value: 1, label: '!' }, { value: 2, label: '!!' }, { value: 3, label: '!!!' }];
  d.priority = normalizePriority(d.priority);
  const control = h('div', {
    class: 'priority-selector',
    role: 'group',
    'aria-label': 'Приоритет задачи',
    onclick: (event) => {
      const target = event.target.closest && event.target.closest('button[data-priority]');
      if (!target || !control.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      d.priority = normalizePriority(target.dataset.priority);
      control.querySelectorAll('button[data-priority]').forEach((button) => {
        const active = normalizePriority(button.dataset.priority) === d.priority;
        button.classList.toggle('on', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    },
  });
  options.forEach((option) => {
    const active = d.priority === option.value;
    control.appendChild(h('button', {
      type: 'button',
      class: 'priority-option' + (active ? ' on' : ''),
      'data-priority': String(option.value),
      'aria-pressed': active ? 'true' : 'false',
    }, option.label));
  });
  return control;
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

const EVENT_REMINDER_UNITS = [
  { v: 'minutes', label: 'Минуты', factor: 1 },
  { v: 'hours', label: 'Часы', factor: 60 },
  { v: 'days', label: 'Дни', factor: 1440 },
  { v: 'weeks', label: 'Недели', factor: 10080 },
];
const EVENT_REMINDER_FACTORS = Object.fromEntries(EVENT_REMINDER_UNITS.map((unit) => [unit.v, unit.factor]));
const EVENT_REMINDER_MAX = { minutes: 60, hours: 24, days: 7, weeks: 4 };
const eventReminderAmountMax = (unit) => EVENT_REMINDER_MAX[unit] || 60;
const clampEventReminderAmount = (amount, unit) => Math.max(1, Math.min(eventReminderAmountMax(unit), Math.round(Number(amount) || 1)));

function reminderUnitForMinutes(minutes) {
  if (minutes <= 0) return { amount: 1, unit: 'minutes' };
  for (const unit of [...EVENT_REMINDER_UNITS].reverse()) {
    if (minutes % unit.factor === 0) return { amount: minutes / unit.factor, unit: unit.v };
  }
  return { amount: minutes, unit: 'minutes' };
}

// Переводит старые абсолютные напоминания мероприятий в относительные интервалы.
function normalizeEventReminder(reminder, event) {
  if (reminder && EVENT_REMINDER_FACTORS[reminder.unit] && reminder.amount != null) {
    return { id: reminder.id || uid(), amount: clampEventReminderAmount(reminder.amount, reminder.unit), unit: reminder.unit };
  }
  if (!reminder?.date || !reminder?.time || !event?.date) return null;
  const startTime = event.allDay || !event.start ? '09:00' : event.start;
  const start = localDate(event.date, startTime);
  const fireAt = localDate(reminder.date, reminder.time);
  const minutes = Math.round((start.getTime() - fireAt.getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  return { id: reminder.id || uid(), ...reminderUnitForMinutes(minutes) };
}

function eventReminderDraft(event = {}) {
  const reminders = (event.reminders || []).map((r) => normalizeEventReminder(r, event)).filter(Boolean);
  if (!reminders.length && event.reminderMin != null && Number.isFinite(Number(event.reminderMin)) && Number(event.reminderMin) >= 0) {
    const minutes = event.allDay ? 0 : Math.round(Number(event.reminderMin));
    reminders.push({ id: uid(), ...reminderUnitForMinutes(minutes) });
  }
  const seen = new Set();
  return reminders.filter((r) => {
    const key = Number(r.amount) * (EVENT_REMINDER_FACTORS[r.unit] || 0);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function eventRemindersError(reminders) {
  const seen = new Set();
  for (const reminder of reminders || []) {
    const amount = Number(reminder.amount);
    const max = eventReminderAmountMax(reminder.unit);
    if (reminder.amount == null || reminder.amount === '' || !Number.isInteger(amount) || amount < 1 || amount > max || !EVENT_REMINDER_FACTORS[reminder.unit]) {
      return `Для выбранной единицы укажите число от 1 до ${max}`;
    }
    const total = amount * EVENT_REMINDER_FACTORS[reminder.unit];
    if (seen.has(total)) return 'Уберите повторяющиеся напоминания';
    seen.add(total);
  }
  return null;
}

function eventRemindersGroup(d) {
  if (!Array.isArray(d.reminders)) d.reminders = [];
  const list = h('div', { class: 'reminder-list' });
  let addButton;

  const makeCard = (reminder) => {
    reminder.id = reminder.id || uid();
    if (!EVENT_REMINDER_FACTORS[reminder.unit]) reminder.unit = 'minutes';
    reminder.amount = clampEventReminderAmount(reminder.amount == null ? 5 : reminder.amount, reminder.unit);
    let amount;
    const makeAmountControl = () => {
      const max = eventReminderAmountMax(reminder.unit);
      const options = Array.from({ length: max }, (_, index) => ({ v: index + 1, label: String(index + 1) }));
      const control = selectInput(options, reminder.amount, (v) => { reminder.amount = Number(v); });
      control.classList.add('reminder-amount');
      control.setAttribute('aria-label', 'Количество');
      return control;
    };
    amount = makeAmountControl();
    const unit = selectInput(EVENT_REMINDER_UNITS.map(({ v, label }) => ({ v, label })), reminder.unit, (v) => {
      reminder.unit = v;
      reminder.amount = clampEventReminderAmount(reminder.amount, v);
      const nextAmount = makeAmountControl();
      amount.replaceWith(nextAmount);
      amount = nextAmount;
    });
    unit.setAttribute('aria-label', 'Единица времени');

    const card = h('div', { class: 'reminder-card' },
      h('div', { class: 'reminder-card-head' },
        h('div', { class: 'reminder-card-title' }, h('span', {}, 'Напомнить за')),
        h('button', { type: 'button', class: 'reminder-remove', 'aria-label': 'Удалить напоминание', onclick: () => {
          const index = d.reminders.findIndex((item) => item.id === reminder.id);
          if (index < 0) return;
          d.reminders.splice(index, 1);
          card.remove();
        } }, ic('x', 15))),
      h('div', { class: 'reminder-fields reminder-relative-fields' }, amount, unit));
    return card;
  };

  d.reminders.forEach((reminder) => list.appendChild(makeCard(reminder)));
  addButton = h('button', {
    type: 'button',
    class: 'reminder-add',
    onclick: () => {
      const reminder = { id: uid(), amount: 5, unit: 'minutes' };
      d.reminders.push(reminder);
      list.insertBefore(makeCard(reminder), addButton);
    },
  }, ic('plus', 17), 'Добавить напоминание');
  list.appendChild(addButton);
  return list;
}

function eventDateDiff(from, to) {
  const a = from.split('-').map(Number);
  const b = to.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

function saveEventPreset(d) {
  if (!d.title || !d.title.trim()) { toast('Сначала укажите название события'); return; }
  const days = d.endDate && d.endDate > d.date ? eventDateDiff(d.date, d.endDate) : 0;
  const durationDays = Math.max(1, days + 1);
  const durationMinutes = Math.max(1, days * 1440 + toMin(d.end || '11:00') - toMin(d.start || '10:00'));
  S.upsert('eventPresets', {
    name: d.title.trim(),
    title: d.title.trim(),
    allDay: !!d.allDay,
    start: d.allDay ? null : (d.start || '10:00'),
    end: d.allDay ? null : (d.end || '11:00'),
    durationMinutes,
    durationDays,
    color: d.color || 'blue',
    colorOverride: !!d.colorOverride,
    calendarId: d.calendarId || DEFAULT_CALENDAR_ID,
    location: d.location || '',
    notes: d.notes || '',
    reminders: (d.reminders || []).map((reminder) => ({ amount: Number(reminder.amount), unit: reminder.unit })),
  });
  toast('Шаблон события сохранён');
}

function scheduleEventPreset(preset) {
  const allDay = !!preset.allDay;
  const slots = [{ id: uid(), date: todayStr(), start: preset.start || '10:00' }];
  const durationDays = Math.max(1, Number(preset.durationDays) || 1);
  const durationMinutes = Math.max(1, Number(preset.durationMinutes)
    || (toMin(preset.end || '11:00') - toMin(preset.start || '10:00')) || 60);

  openSheet({
    title: 'Расставить по датам',
    left: { label: 'Отмена' },
    right: { label: 'Создать', bold: true, onClick: (api) => {
      if (!slots.length) { toast('Добавьте хотя бы одну дату'); return; }
      if (slots.some((slot) => !slot.date || !isDateNotPast(slot.date))) {
        toast('Выберите сегодняшнюю или будущую дату для каждого события');
        return;
      }
      const duplicateKeys = new Set();
      for (const slot of slots) {
        const key = slot.date + '|' + (allDay ? 'all-day' : slot.start);
        if (duplicateKeys.has(key)) { toast('Уберите одинаковые даты и время'); return; }
        duplicateKeys.add(key);
      }
      const calendars = S.data().calendars;
      const calendarId = calendars.some((calendar) => calendar.id === preset.calendarId)
        ? preset.calendarId : DEFAULT_CALENDAR_ID;
      for (const slot of slots) {
        let end = null;
        let endDate = null;
        let start = null;
        if (allDay) {
          if (durationDays > 1) endDate = addDays(slot.date, durationDays - 1);
        } else {
          start = slot.start || preset.start || '10:00';
          const total = toMin(start) + durationMinutes;
          const offset = Math.floor(total / 1440);
          end = fromMin(total % 1440);
          if (offset > 0) endDate = addDays(slot.date, offset);
        }
        S.upsert('events', {
          title: preset.title || preset.name || 'Событие',
          date: slot.date,
          start,
          end,
          endDate,
          allDay,
          color: preset.color || 'blue',
          colorOverride: !!preset.colorOverride,
          calendarId,
          location: preset.location || '',
          notes: preset.notes || '',
          reminderMin: null,
          reminders: (preset.reminders || []).map((reminder) => ({ id: uid(), amount: Number(reminder.amount), unit: reminder.unit })),
          repeat: { freq: 'none' },
        });
      }
      api.close(true);
      toast('Создано событий: ' + slots.length);
    } },
    build(api) {
      const list = h('div', { class: 'preset-slots' });
      const renderSlot = (slot) => {
        const date = dateInput(slot.date, (value) => { slot.date = value || slot.date; }, { clearable: false, min: todayStr() });
        const fields = [row('Дата', date, { icon: 'calendar', iconColor: 'red' })];
        if (!allDay) fields.push(row('Время начала', timeInput(slot.start, (value) => { slot.start = value; }, { clearable: false }), { icon: 'clock', iconColor: 'blue' }));
        const card = h('div', { class: 'group preset-slot' }, ...fields);
        if (slots.length > 1) card.appendChild(h('button', {
          type: 'button',
          class: 'preset-slot-remove',
          'aria-label': 'Удалить дату',
          onclick: () => {
            const index = slots.findIndex((item) => item.id === slot.id);
            if (index >= 0) slots.splice(index, 1);
            card.remove();
          },
        }, ic('x', 16)));
        list.appendChild(card);
      };
      slots.forEach(renderSlot);
      api.body.append(
        groupNote('Шаблон «' + (preset.name || preset.title || 'Событие') + '». Длительность и остальные параметры сохраняются; для каждой даты можно задать своё время начала.'),
        list,
        h('button', { type: 'button', class: 'add-row', onclick: () => {
          const previous = slots[slots.length - 1];
          slots.push({ id: uid(), date: addDays(previous.date, 1), start: previous.start || preset.start || '10:00' });
          renderSlot(slots[slots.length - 1]);
        } }, ic('plus', 18), 'Добавить дату'),
        h('div', { class: 'sheet-pad' }),
      );
    },
  });
}

export function openEventScheduler() {
  const presets = S.data().eventPresets || [];
  openSheet({
    title: 'Шаблоны событий',
    left: null,
    right: { label: 'Закрыть' },
    build(api) {
      if (!presets.length) {
        api.body.append(
          h('div', { class: 'preset-empty' },
            h('div', { class: 'preset-empty-icon' }, ic('calendar', 26)),
            h('b', null, 'Пока нет шаблонов'),
            h('span', null, 'Откройте событие и нажмите «Сохранить как шаблон». Затем здесь можно будет расставить его по датам и времени.')),
          h('div', { class: 'sheet-pad' }),
        );
        return;
      }
      presets.forEach((preset) => {
        const duration = preset.allDay
          ? Math.max(1, Number(preset.durationDays) || 1) + ' дн. · весь день'
          : Math.floor((Number(preset.durationMinutes) || 60) / 60) + ' ч ' + ((Number(preset.durationMinutes) || 60) % 60) + ' мин';
        const card = h('div', { class: 'group event-preset-card' },
          h('div', { class: 'preset-card-copy' },
            h('b', null, preset.name || preset.title || 'Событие'),
            h('span', null, duration)),
          h('div', { class: 'preset-card-actions' },
            h('button', { type: 'button', class: 'preset-schedule-btn', onclick: () => {
              api.close(true);
              setTimeout(() => scheduleEventPreset(preset), 120);
            } }, ic('calendar', 16), 'Расставить даты'),
            h('button', { type: 'button', class: 'preset-remove-btn', 'aria-label': 'Удалить шаблон', onclick: () => {
              S.remove('eventPresets', preset.id);
              card.remove();
              toast('Шаблон удалён');
            } }, ic('trash', 16))),
        );
        api.body.appendChild(card);
      });
      api.body.appendChild(h('div', { class: 'sheet-pad' }));
    },
  });
}

export function editEvent(ev, defaults = {}, occDate = null) {
  const isNew = !ev;
  const defaultCalendarId = S.settings().calFilters?.calendarId || DEFAULT_CALENDAR_ID;
  const defaultCalendar = S.data().calendars.find((calendar) => calendar.id === defaultCalendarId);
  const base = { title: '', date: todayStr(), start: '10:00', end: '11:00', allDay: false, endDate: null, color: defaultCalendar?.color || 'blue', colorOverride: false, calendarId: defaultCalendarId, location: '', notes: '', reminderMin: null, reminders: [], repeat: { freq: 'none', interval: 1, days: [], until: null } };
  const source = ev || defaults;
  const draft = ev ? { ...base, ...ev, reminders: eventReminderDraft(source), repeat: { ...base.repeat, ...(ev.repeat || {}) } } : { ...base, ...defaults, reminders: eventReminderDraft(source) };
  const originalDate = ev ? (ev.date || null) : null;
  const originalEventReminderIds = new Set(draft.reminders.map((reminder) => reminder.id));
  let dateWasChanged = false;
  return editorShell({
    title: isNew ? 'Новое событие' : 'Событие',
    draft,
    valid: (d) => {
      const endDate = d.endDate || d.date;
      const invalidEnd = !d.allDay && d.start && d.end
        && (endDate < d.date || (endDate === d.date && toMin(d.end) <= toMin(d.start)));
      return !d.title.trim() ? 'Введите название события'
        : changedDateIsPast(d.date, originalDate, dateWasChanged) ? 'Нельзя назначить мероприятие на прошедшую дату'
          : eventRemindersError(d.reminders) || (invalidEnd ? 'Окончание должно быть позже начала' : null);
    },
    onSave: (d) => {
      const out = { ...d, title: d.title.trim(), reminders: (d.reminders || []).map((r) => ({ id: r.id || uid(), amount: Number(r.amount), unit: r.unit })) };
      out.reminderMin = null;
      if (out.allDay) { out.start = null; out.end = null; if (out.endDate && out.endDate < out.date) out.endDate = null; }
      else if (out.endDate && out.endDate <= out.date) out.endDate = null;
      if (out.repeat.freq === 'none') out.repeat = { freq: 'none' };
      else if (out.repeat.freq !== 'weekly') out.repeat = { freq: out.repeat.freq, interval: out.repeat.interval || 1, until: out.repeat.until || null };
      S.upsert('events', out);
    },
    afterSave: (d) => {
      if (d.reminders.some((reminder) => !originalEventReminderIds.has(reminder.id))) {
        offerPushPromptForNewReminder();
      }
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
    draw(body, d, redraw, api) {
      const r = d.repeat;
      const eventCalendarControl = selectInput(calendarOptions(S.data().calendars), d.calendarId || DEFAULT_CALENDAR_ID, (v) => {
        d.calendarId = v;
        const selected = S.data().calendars.find((calendar) => calendar.id === v);
        d.colorOverride = false;
        if (selected && selected.color) d.color = selected.color;
        redraw();
      });
      const endTimeControl = timeInput(d.end, (v) => (d.end = v), { clearable: false });
      const eventEndDateControl = dateInput(d.endDate && d.endDate > d.date ? d.endDate : d.date, (v) => {
        const nextDate = v || d.date;
        d.endDate = nextDate > d.date ? nextDate : null;
      }, { clearable: false, min: d.date });
      const eventDateControl = dateInput(d.date, (v) => {
        const nextDate = v || todayStr();
        if (changedDateIsPast(nextDate, originalDate, true)) {
          eventDateControl.querySelector('input').value = d.date || todayStr();
          toast('Нельзя назначить мероприятие на прошедшую дату');
          return;
        }
        dateWasChanged = true;
        d.date = nextDate;
        const endField = eventEndDateControl.querySelector('input');
        if (endField) {
          endField.min = nextDate;
          if (!d.endDate || d.endDate < nextDate) {
            d.endDate = null;
            endField.value = nextDate;
          }
        }
      }, { clearable: false, min: todayStr() });
      body.append(
        group(h('div', { class: 'row solo' }, textInput({ value: d.title, placeholder: 'Название', big: true, onInput: (v) => (d.title = v), autofocus: isNew })),
          h('div', { class: 'row solo' }, textInput({ value: d.location, placeholder: 'Место', onInput: (v) => (d.location = v) }))),
        group(
          row('Весь день', toggle(d.allDay, (v) => { d.allDay = v; redraw(); }), { icon: 'sun', iconColor: 'orange' }),
          row(d.allDay ? 'Начало' : 'Дата', eventDateControl, { icon: 'calendar', iconColor: 'red' }),
          d.allDay ? row('Конец', eventEndDateControl, { icon: 'calendar', iconColor: 'red' }) : null,
          !d.allDay ? row('Дата окончания', eventEndDateControl, { icon: 'calendar', iconColor: 'red' }) : null,
          !d.allDay ? row('Начало', timeInput(d.start, (v) => { d.start = v; if (v && (!d.end || toMin(d.end) <= toMin(v))) { d.end = fromMin(Math.min(1439, toMin(v) + 60)); endTimeControl.querySelector('input').value = d.end; } }, { clearable: false }), { icon: 'clock', iconColor: 'blue' }) : null,
          !d.allDay ? row('Конец', endTimeControl, { icon: 'clock', iconColor: 'blue' }) : null),
        groupTitle('Календарь'),
        group(row('Календарь', eventCalendarControl, { icon: 'calendar', iconColor: 'red' })),
        groupTitle('Повтор'),
        group(
          row('Повтор', selectInput(Object.entries(REPEAT_LABELS).map(([v, label]) => ({ v, label })), r.freq || 'none', (v) => { r.freq = v; if (v === 'weekly' && (!r.days || !r.days.length)) r.days = []; redraw(); }), { icon: 'repeat', iconColor: 'green' }),
          r.freq === 'weekly' ? h('div', { class: 'row' }, pills({ multi: true, options: WEEK_ORDER.map((n) => ({ v: n, label: WD_SHORT[n] })), value: r.days && r.days.length ? r.days : [new Date(d.date + 'T00:00').getDay()], onChange: (v) => (r.days = v) })) : null,
          r.freq && r.freq !== 'none' ? row('Каждые', stepper(r.interval || 1, (v) => (r.interval = v), { min: 1, max: 30, format: (v) => `${v} ${r.freq === 'daily' ? plural(v, ['день', 'дня', 'дней']) : r.freq === 'weekly' ? plural(v, ['неделю', 'недели', 'недель']) : r.freq === 'monthly' ? plural(v, ['месяц', 'месяца', 'месяцев']) : plural(v, ['год', 'года', 'лет'])}` })) : null,
          r.freq && r.freq !== 'none' ? row('Повторять до', dateInput(r.until, (v) => (r.until = v), { closeOnClear: true })) : null,
          ),
        groupTitle('Напоминания'),
        eventRemindersGroup(d),
        groupNote('Напоминания рассчитываются относительно начала мероприятия. Для событий на весь день точка отсчёта — 09:00.'),
        groupTitle('Цвет'),
        group(h('div', { class: 'row' }, colorPicker(d.color, (v) => { d.color = v; d.colorOverride = true; }))),
        group(h('div', { class: 'row solo' }, textInput({ value: d.notes, placeholder: 'Заметки', multiline: true, onInput: (v) => (d.notes = v) }))),
        group(
          h('button', { type: 'button', class: 'row-btn', onclick: () => saveEventPreset(d) }, 'Сохранить как шаблон'),
          !isNew ? h('button', { type: 'button', class: 'row-btn', onclick: () => {
            const sourceDate = occDate || d.date;
            const spanDays = d.endDate && d.endDate > d.date ? eventDateDiff(d.date, d.endDate) : 0;
            const targetDate = addDays(sourceDate, 1);
            const copy = {
              ...d,
              date: targetDate,
              endDate: spanDays ? addDays(targetDate, spanDays) : null,
              repeat: { freq: 'none' },
              reminders: (d.reminders || []).map((reminder) => ({ ...reminder, id: uid() })),
            };
            delete copy.id; delete copy.createdAt; delete copy.updatedAt; delete copy.deleted;
            delete copy.icsUid; delete copy.exdates;
            api.close(true);
            setTimeout(() => editEvent(null, copy), 120);
          } }, 'Дублировать событие') : null,
        ),
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
    : { title: '', emoji: '🌱', color: 'green', type: 'check', target: 1, unit: '', schedule: { type: 'daily', days: [], perWeek: 3 }, time: null, remind: false, goalId: null, weight: 3, startDate: todayStr(), ...defaults };
  const data = S.data();
  const originallyHadHabitReminder = !!(habit && habit.remind && habit.time);
  return editorShell({
    title: isNew ? 'Новая привычка' : 'Привычка',
    draft,
    valid: (d) => (!d.title.trim() ? 'Введите название привычки' : d.schedule.type === 'days' && !(d.schedule.days || []).length ? 'Выберите дни недели' : null),
    onSave: (d) => {
      const out = { ...d, title: d.title.trim(), weight: normalizeImportance(d.weight) };
      if (out.type === 'check') { out.target = 1; out.unit = ''; }
      if (!out.time) out.remind = false;
      const today = todayStr();
      if (habit) {
        const oldSchedule = habit.schedule || { type: 'daily' };
        const nextSchedule = out.schedule || { type: 'daily' };
        if (JSON.stringify(oldSchedule) !== JSON.stringify(nextSchedule)) {
          const history = [...(habit.scheduleHistory || [])];
          const from = habit.scheduleEffectiveFrom || habit.startDate || (habit.createdAt ? ymd(new Date(habit.createdAt)) : today);
          const to = addDays(today, -1);
          if (from <= to) history.push({ from, to, schedule: oldSchedule });
          out.scheduleHistory = history;
          out.scheduleEffectiveFrom = today;
        }
      } else {
        out.scheduleEffectiveFrom = out.startDate || today;
      }
      const oldGoalId = habit ? (habit.goalId || null) : null;
      if (out.goalId && out.goalId !== oldGoalId) out.goalLinkedAt = today;
      else if (!out.goalId) out.goalLinkedAt = null;
      else out.goalLinkedAt = habit ? (habit.goalLinkedAt || null) : (out.goalId ? today : null);
      S.upsert('habits', out);
    },
    afterSave: (d) => {
      if (!originallyHadHabitReminder && d.remind && d.time) {
        offerPushPromptForNewReminder();
      }
    },
    onDelete: isNew ? null : (api) => {
      const inv = S.remove('habits', habit.id);
      api.close(true);
      toast('Привычка удалена', { label: 'Отменить', onClick: () => S.undo(inv) });
    },
    draw(body, d, redraw, api) {
      const s = d.schedule;
      const markingGroup = group();
      const scheduleGroup = group();
      const renderMarking = () => {
        clear(markingGroup);
        markingGroup.append(
          h('div', { class: 'row' }, seg({
            options: [{ v: 'check', label: 'Да / нет' }, { v: 'count', label: 'Счётчик' }, { v: 'timer', label: 'Таймер' }],
            value: d.type,
            onChange: (v) => {
              d.type = v;
              if (v !== 'check' && (!d.target || d.target < 1)) d.target = v === 'timer' ? 10 : 8;
              if (v === 'timer') d.unit = 'мин';
              renderMarking();
            },
          })),
          d.type !== 'check' ? row(d.type === 'timer' ? 'Цель, минут' : 'Цель в день', numberInput(d.target, (v) => (d.target = v || 1), { width: '90px' })) : null,
          d.type === 'count' ? row('Единица', textInput({ value: d.unit, placeholder: 'стаканов, страниц…', onInput: (v) => (d.unit = v) })) : null,
        );
      };
      const renderSchedule = () => {
        clear(scheduleGroup);
        scheduleGroup.append(
          h('div', { class: 'row' }, seg({
            options: [{ v: 'daily', label: 'Каждый день' }, { v: 'days', label: 'По дням' }, { v: 'weekly', label: 'N в неделю' }],
            value: s.type,
            onChange: (v) => { s.type = v; renderSchedule(); },
          })),
          s.type === 'days' ? h('div', { class: 'row' }, pills({ multi: true, options: WEEK_ORDER.map((n) => ({ v: n, label: WD_SHORT[n] })), value: s.days || [], onChange: (v) => (s.days = v) })) : null,
          s.type === 'weekly' ? row('Раз в неделю', stepper(s.perWeek || 3, (v) => (s.perWeek = v), { min: 1, max: 7 })) : null,
        );
      };
      renderMarking();
      renderSchedule();
      body.append(
        group(h('div', { class: 'row solo' }, textInput({ value: d.title, placeholder: 'Название привычки', big: true, onInput: (v) => (d.title = v), autofocus: isNew }))),
        group(h('div', { class: 'row col' }, emojiPicker(d.emoji, (v) => (d.emoji = v))), h('div', { class: 'row' }, colorPicker(d.color, (v) => (d.color = v)))),
        groupTitle('Как отмечать'),
        markingGroup,
        groupTitle('Расписание'),
        scheduleGroup,
        groupTitle('Напоминание и цель'),
        group(
          row('Время', timeInput(d.time, (v) => { d.time = v; }), { icon: 'clock', iconColor: 'blue' }),
          d.time ? row('Напоминать', toggle(d.remind, (v) => (d.remind = v)), { icon: 'bell', iconColor: 'orange' }) : null,
          row('Цель', selectInput(goalOptions(data), d.goalId, (v) => { d.goalId = v; redraw(); }), { icon: 'target', iconColor: 'green' }),
          d.goalId ? row('Важность для цели', stepper(d.weight || 3, (v) => (d.weight = v), { min: 1, max: 5 }), { icon: 'flag', iconColor: 'orange' }) : null),
        groupNote('Привязанная привычка учитывается в прогрессе по своему расписанию и сроку цели. Если срока нет, привычка отображается, но не меняет общий процент.'),
        !isNew ? group(h('button', { class: 'row-btn', onclick: () => { S.upsert('habits', { id: habit.id, archived: !habit.archived }); toast(habit.archived ? 'Привычка возвращена' : 'Привычка в архиве'); api.close(true); } }, habit.archived ? 'Вернуть из архива' : 'Архивировать')) : null,
      );
    },
  });
}

// =====================================================================
// Цель / подцель
// =====================================================================
function progressModeDescription(mode) {
  if (mode === 'metric') return 'Метрика добавляется к подцелям, задачам и привычкам как ещё один элемент прогресса. Её важность тоже можно настроить от 1 до 5.';
  return 'Прогресс считается по подцелям, задачам и привычкам. У каждого элемента своя важность от 1 до 5; выполнение более важного шага сильнее влияет на общий процент.';
}

export function editGoal(goal, defaults = {}) {
  const isNew = !goal;
  const data = S.data();
  const parent = goal ? data.goals.find((g) => g.id === goal.parentId) : defaults.parentId ? data.goals.find((g) => g.id === defaults.parentId) : null;
  const isSub = !!(parent || (goal && goal.parentId));
  const draft = goal
    ? { ...goal, priority: goal.priority || 3, weight: goal.weight || 3, progressMode: goal.progressMode === 'metric' ? 'metric' : 'tasks', metric: { start: 0, target: 100, current: 0, unit: '', weight: 3, ...(goal.metric || {}) } }
    : { title: '', emoji: isSub ? '🔹' : '🎯', color: parent ? parent.color : 'blue', category: '', deadline: null, priority: 3, weight: 3, progressMode: 'tasks', metric: { start: 0, target: 100, current: 0, unit: '', weight: 3 }, notes: '', parentId: null, ...defaults };
  return editorShell({
    title: isNew ? (isSub ? 'Новая подцель' : 'Новая цель') : isSub ? 'Подцель' : 'Цель',
    draft,
    valid: (d) => (!d.title.trim() ? 'Введите название' : d.progressMode === 'metric' && (d.metric.target == null || d.metric.target === d.metric.start) ? 'Укажите целевое значение, отличное от начального' : null),
    onSave: (d) => {
      const out = { ...d, title: d.title.trim(), priority: normalizeImportance(d.priority), weight: normalizeImportance(d.weight) };
      out.progressMode = out.progressMode === 'metric' ? 'metric' : 'tasks';
      if (out.metric) out.metric.weight = normalizeImportance(out.metric.weight);
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
      const progressNote = h('div', { class: 'group-note' }, progressModeDescription(d.progressMode));
      const metricFields = group(
        row('Начальное значение', numberInput(m.start, (v) => (m.start = v), { width: '110px' })),
        row('Сейчас', numberInput(m.current, (v) => (m.current = v), { width: '110px' })),
        row('Цель', numberInput(m.target, (v) => (m.target = v), { width: '110px' })),
        row('Единица', textInput({ value: m.unit, placeholder: 'км, ₽, кг…', onInput: (v) => (m.unit = v) })),
        row('Важность метрики', stepper(m.weight || 3, (v) => (m.weight = v), { min: 1, max: 5 })),
      );
      metricFields.style.display = d.progressMode === 'metric' ? '' : 'none';
      body.append(
        group(h('div', { class: 'row solo' }, textInput({ value: d.title, placeholder: isSub ? 'Название подцели' : 'Чего вы хотите достичь?', big: true, onInput: (v) => (d.title = v), autofocus: isNew }))),
        group(h('div', { class: 'row col' }, emojiPicker(d.emoji, (v) => (d.emoji = v))), h('div', { class: 'row' }, colorPicker(d.color, (v) => (d.color = v)))),
        !isSub ? [
          groupTitle('Категория и срок'),
          group(
            h('div', { class: 'row' }, pills({ options: CATEGORIES.map((c) => ({ v: c, label: c })), value: d.category, onChange: (v) => (d.category = v === d.category ? '' : v) })),
            row('Своя категория', textInput({ value: CATEGORIES.includes(d.category) ? '' : d.category, placeholder: 'Название', onInput: (v) => (d.category = v) })),
            row('Срок', dateInput(d.deadline, (v) => (d.deadline = v)), { icon: 'flag', iconColor: 'red' }),
            row('Приоритет цели', stepper(d.priority || 3, (v) => (d.priority = v), { min: 1, max: 5 }), { icon: 'target', iconColor: 'orange' })),
        ] : [
          groupTitle('Подцель'),
          group(
            row('Срок подцели', dateInput(d.deadline || null, (v) => (d.deadline = v)), { icon: 'calendar', iconColor: 'red' }),
            row('Важность в цели', stepper(d.weight || 3, (v) => (d.weight = v), { min: 1, max: 5 }), { icon: 'flag', iconColor: 'orange' })),
          groupNote('Срок можно не задавать — тогда подцель автоматически унаследует срок главной цели. Важность определяет её долю в прогрессе родительской цели.'),
        ],
        groupTitle('Как считать прогресс'),
        group(h('div', { class: 'row' }, seg({
          options: [{ v: 'tasks', label: 'По элементам' }, { v: 'metric', label: 'С метрикой' }],
          value: d.progressMode || 'tasks',
          onChange: (v) => {
            d.progressMode = v;
            progressNote.textContent = progressModeDescription(v);
            metricFields.style.display = v === 'metric' ? '' : 'none';
          },
        }))),
        progressNote,
        metricFields,
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
        const taskDate = when === 'today' ? todayStr() : when === 'tomorrow' ? addDays(todayStr(), 1) : when === 'date' ? date : null;
        if (taskDate && !isDateNotPast(taskDate)) { toast('Нельзя создать задачу на прошедшую дату'); return; }
        S.upsert('tasks', { title: text.trim(), done: false, goalId: null, date: taskDate, priority: 0, weight: 1, checklist: [] });
        api.close(true);
        toast('Задача добавлена');
      };
      const input = textInput({ placeholder: 'Быстрая задача…', big: true, onInput: (v) => (text = v) });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(date ? 'date' : 'today'); });
      const tile = (icon, color, label, sub, fn) => h('button', { class: 'tile', style: { '--c': cv(color) }, onclick: () => { api.close(true); setTimeout(fn, 120); } }, h('span', { class: 'tile-ic' }, ic(icon, 24)), h('b', null, label), h('small', null, sub));
      api.body.append(
        group(h('div', { class: 'row solo' }, input)),
        h('div', { class: 'quick-when' }, pills({ options: [{ v: 'today', label: 'Сегодня' }, { v: 'tomorrow', label: 'Завтра' }, { v: 'none', label: 'Без даты' }], value: null, onChange: add })),
        h('div', { class: 'tiles' },
          tile('list', 'blue', 'Задача', 'с датой, целью и чек-листом', () => editTask(null, date ? { date } : {})),
          tile('calendar', 'red', 'Событие', 'встреча, поездка, повтор', () => editEvent(null, date ? { date } : {})),
          tile('flame', 'orange', 'Привычка', 'ежедневная или по расписанию', () => editHabit(null)),
          tile('target', 'green', 'Цель', 'с подцелями и прогрессом', () => editGoal(null))),
        h('button', { type: 'button', class: 'link-btn event-schedule-link', onclick: () => {
          api.close(true);
          setTimeout(openEventScheduler, 120);
        } }, 'Шаблоны событий и планирование'),
        h('div', { class: 'sheet-pad' }));
      setTimeout(() => input.focus(), 450);
    },
  });
}
