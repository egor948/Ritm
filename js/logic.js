// Чистая доменная логика: без DOM и без хранилища, чтобы её можно было тестировать в node.
import {
  addDays, diffDays, dow, weekStart, range, parseYmd, ymd, daysInMonth, dayOfMonth,
  monthsBetween, toMin, fromMin, localDate, clamp,
} from './util.js';

// =====================================================================
// Цели: прогресс
// =====================================================================

export const subgoalsOf = (goals, goalId) => goals.filter((g) => g.parentId === goalId && !g.archived);

/** Все задачи цели: её собственные и задачи подцелей. */
export function subtreeTasks(goalId, data) {
  const ids = new Set([goalId, ...data.goals.filter((g) => g.parentId === goalId).map((g) => g.id)]);
  return data.tasks.filter((t) => ids.has(t.goalId));
}

/**
 * Прогресс цели или подцели.
 *  - mode 'tasks'  : доля выполненных задач
 *  - mode 'weight' : доля выполненных задач с учётом их веса
 *  - mode 'metric' : (текущее - старт) / (цель - старт)
 */
export function goalProgress(goal, data) {
  const mode = goal.progressMode || 'tasks';
  if (mode === 'metric' && goal.metric) {
    const { start = 0, target = 0, current = start } = goal.metric;
    const span = target - start;
    const pct = span === 0 ? (current === target ? 1 : 0) : clamp((current - start) / span, 0, 1);
    return { pct, done: current, total: target, mode, unit: goal.metric.unit || '' };
  }
  const tasks = subtreeTasks(goal.id, data);
  if (mode === 'weight') {
    const total = tasks.reduce((s, t) => s + (t.weight || 1), 0);
    const done = tasks.filter((t) => t.done).reduce((s, t) => s + (t.weight || 1), 0);
    return { pct: total ? done / total : 0, done: tasks.filter((t) => t.done).length, total: tasks.length, mode };
  }
  const done = tasks.filter((t) => t.done).length;
  return { pct: tasks.length ? done / tasks.length : 0, done, total: tasks.length, mode: 'tasks' };
}

// =====================================================================
// Привычки
// =====================================================================

export const habitTarget = (h) => (h.type === 'check' ? 1 : Math.max(1, h.target || 1));
export const logKey = (habitId, date) => `${habitId}|${date}`;
export function buildLogIndex(logs) {
  const m = new Map();
  for (const l of logs) m.set(logKey(l.habitId, l.date), l.value || 0);
  return m;
}
export const habitValue = (idx, habit, date) => idx.get(logKey(habit.id, date)) || 0;
export const habitDone = (idx, habit, date) => habitValue(idx, habit, date) >= habitTarget(habit);
const createdDate = (h) => h.startDate || (h.createdAt ? ymd(new Date(h.createdAt)) : '1970-01-01');

/** Привычка «ежедневная/по дням» привязана к конкретным датам; «N раз в неделю» — гибкая. */
export function isScheduled(habit, date) {
  if (habit.archived) return false;
  if (date < createdDate(habit)) return false;
  const s = habit.schedule || { type: 'daily' };
  if (s.type === 'days') return (s.days || []).includes(dow(date));
  return true; // daily и weekly
}

const weekCount = (habit, idx, wkStart) => {
  let n = 0;
  for (let i = 0; i < 7; i++) if (habitDone(idx, habit, addDays(wkStart, i))) n++;
  return n;
};

/** Серия: текущая и лучшая. Для «N в неделю» считаются недели, иначе — запланированные дни. */
export function habitStreaks(habit, idx, today, weekStartDay = 1) {
  const s = habit.schedule || { type: 'daily' };
  const start = createdDate(habit);
  if (s.type === 'weekly') {
    const need = Math.max(1, s.perWeek || 1);
    let wk = weekStart(today, weekStartDay);
    const firstWk = weekStart(start > today ? today : start, weekStartDay);
    let current = 0, broken = false, best = 0, run = 0;
    // идём назад от текущей недели
    for (let w = wk; w >= firstWk; w = addDays(w, -7)) {
      const met = weekCount(habit, idx, w) >= need;
      if (w === wk) { if (met) current++; continue; }
      if (!broken) { if (met) current++; else broken = true; }
    }
    // лучшая серия — вперёд
    for (let w = firstWk; w <= wk; w = addDays(w, 7)) {
      const met = weekCount(habit, idx, w) >= need;
      if (met) { run++; best = Math.max(best, run); } else if (w !== wk) run = 0;
    }
    return { current, best: Math.max(best, current), unit: 'week' };
  }
  let current = 0, best = 0, run = 0, broken = false;
  const startClamped = start > today ? today : start;
  const total = diffDays(startClamped, today);
  for (let i = 0; i <= total; i++) {
    const d = addDays(startClamped, i);
    if (!isScheduled(habit, d)) continue;
    if (habitDone(idx, habit, d)) { run++; best = Math.max(best, run); } else if (d !== today) run = 0;
  }
  for (let i = total; i >= 0 && !broken; i--) {
    const d = addDays(startClamped, i);
    if (!isScheduled(habit, d)) continue;
    if (habitDone(idx, habit, d)) current++;
    else if (d === today) continue;
    else broken = true;
  }
  return { current, best: Math.max(best, current), unit: 'day' };
}

/** Доля выполнения за последние N дней. */
export function habitRate(habit, idx, today, days = 30, weekStartDay = 1) {
  const s = habit.schedule || { type: 'daily' };
  const from = addDays(today, -(days - 1));
  const start = createdDate(habit);
  const begin = start > from ? start : from;
  if (begin > today) return null;
  if (s.type === 'weekly') {
    const need = Math.max(1, s.perWeek || 1);
    const dayCount = diffDays(begin, today) + 1;
    const wanted = Math.max(1, Math.round((dayCount / 7) * need));
    let done = 0;
    for (const d of range(begin, today)) if (habitDone(idx, habit, d)) done++;
    return clamp(done / wanted, 0, 1);
  }
  let sched = 0, done = 0;
  for (const d of range(begin, today)) {
    if (!isScheduled(habit, d)) continue;
    sched++;
    if (habitDone(idx, habit, d)) done++;
  }
  return sched ? done / sched : null;
}

/** Состояние ячейки для тепловой карты: 0..1 (доля выполнения), null — не по расписанию. */
export function habitCell(habit, idx, date) {
  if (!isScheduled(habit, date) && !habitValue(idx, habit, date)) return null;
  return clamp(habitValue(idx, habit, date) / habitTarget(habit), 0, 1);
}

// =====================================================================
// Повторяющиеся события
// =====================================================================

export const REPEAT_LABELS = { none: 'Не повторять', daily: 'Каждый день', weekly: 'Каждую неделю', monthly: 'Каждый месяц', yearly: 'Каждый год' };

function occursOn(ev, d) {
  const r = ev.repeat;
  if (!r || !r.freq || r.freq === 'none') return d === ev.date;
  if (d < ev.date) return false;
  if (r.until && d > r.until) return false;
  const interval = Math.max(1, r.interval || 1);
  switch (r.freq) {
    case 'daily':
      return diffDays(ev.date, d) % interval === 0;
    case 'weekly': {
      const days = r.days && r.days.length ? r.days : [dow(ev.date)];
      if (!days.includes(dow(d))) return false;
      const weeks = Math.floor(diffDays(weekStart(ev.date, 1), weekStart(d, 1)) / 7);
      return weeks % interval === 0;
    }
    case 'monthly': {
      if (monthsBetween(ev.date, d) % interval !== 0) return false;
      return dayOfMonth(d) === Math.min(dayOfMonth(ev.date), daysInMonth(d));
    }
    case 'yearly': {
      const a = parseYmd(ev.date), b = parseYmd(d);
      if ((b.getFullYear() - a.getFullYear()) % interval !== 0) return false;
      if (a.getMonth() !== b.getMonth()) return false;
      const dd = Math.min(a.getDate(), daysInMonth(d));
      return b.getDate() === dd;
    }
    default:
      return d === ev.date;
  }
}

/** Развернуть события в экземпляры на диапазоне дат [from, to]. */
export function expandEvents(events, from, to) {
  const out = [];
  for (const ev of events) {
    if (ev.deleted) continue;
    const ex = new Set(ev.exdates || []);
    const rep = ev.repeat && ev.repeat.freq && ev.repeat.freq !== 'none';
    if (!rep) {
      const last = ev.allDay && ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date;
      const a = ev.date > from ? ev.date : from;
      const b = last < to ? last : to;
      for (let d = a; d <= b; d = addDays(d, 1)) out.push(occurrence(ev, d));
      continue;
    }
    const a = ev.date > from ? ev.date : from;
    const b = ev.repeat.until && ev.repeat.until < to ? ev.repeat.until : to;
    for (let d = a; d <= b; d = addDays(d, 1)) {
      if (ex.has(d)) continue;
      if (occursOn(ev, d)) out.push(occurrence(ev, d));
    }
  }
  return out;
}
/**
 * Проверяет, что дата не раньше сегодняшнего дня по локальному календарю.
 * Пустая дата разрешена (например, задача без срока).
 */
export function isDateNotPast(date, now = new Date()) {
  return !date || date >= ymd(now);
}

/**
 * Проверяет, что независимое напоминание назначено на будущее по локальному времени.
 * Сравнение строгое: текущая минута не считается будущим временем.
 */
export function isReminderInFuture(reminder, now = new Date()) {
  if (!reminder || !reminder.date || !reminder.time) return false;
  return localDate(reminder.date, reminder.time).getTime() > now.getTime();
}

const occurrence = (ev, date) => ({ type: 'event', id: ev.id, key: `${ev.id}@${date}`, date, ref: ev });

// =====================================================================
// Элементы дня для календаря
// =====================================================================

const TASK_CALENDAR_SLOT_MINUTES = 30; // Только визуальный размер блока, не свойство задачи.

/**
 * Всё, что относится к дню. Возвращает группы для отображения.
 * data: { events, tasks, habits, goals }, idx: индекс логов привычек
 */
export function dayItems(data, date, opts = {}) {
  const f = { events: true, tasks: true, habits: true, goals: true, ...(opts.filters || {}) };
  const calendarById = new Map((data.calendars || []).map((calendar) => [calendar.id, calendar]));
  const eventColor = (event) => {
    const calendar = calendarById.get(event.calendarId || 'calendar-default');
    return event.colorOverride ? (event.color || 'blue') : (calendar && calendar.color) || event.color || 'blue';
  };
  const goalColor = (gid) => {
    const g = data.goals.find((x) => x.id === gid);
    if (!g) return null;
    if (g.color) return g.color;
    const p = g.parentId && data.goals.find((x) => x.id === g.parentId);
    return p ? p.color : null;
  };
  const allDay = [], timed = [], dated = [], habits = [], deadlines = [];
  if (f.events) {
    for (const o of expandEvents(data.events, date, date)) {
      const e = o.ref;
      if (e.allDay || !e.start) allDay.push({ ...o, title: e.title, color: eventColor(e) });
      else {
        const s = toMin(e.start);
        let en = e.end ? toMin(e.end) : s + 60;
        if (en <= s) en = Math.min(1440, s + 30);
        timed.push({ ...o, title: e.title, color: eventColor(e), startMin: s, endMin: en });
      }
    }
  }
  if (f.tasks) {
    for (const t of data.tasks) {
      if (t.date !== date) continue;
      const color = goalColor(t.goalId) || 'indigo';
      if (t.time) {
        const s = toMin(t.time);
        timed.push({ type: 'task', id: t.id, key: `${t.id}@${date}`, date, ref: t, title: t.title, color, startMin: s, endMin: Math.min(1440, s + TASK_CALENDAR_SLOT_MINUTES), done: t.done });
      } else dated.push({ type: 'task', id: t.id, key: `${t.id}@${date}`, date, ref: t, title: t.title, color, done: t.done });
    }
  }
  if (f.habits) {
    for (const h of data.habits) if (isScheduled(h, date)) habits.push({ type: 'habit', id: h.id, key: `${h.id}@${date}`, date, ref: h, title: h.title, color: h.color || 'green' });
  }
  if (f.goals) {
    for (const g of data.goals) {
      if (g.deadline === date && !g.archived) deadlines.push({ type: 'goal', id: g.id, key: `${g.id}@${date}`, date, ref: g, title: g.title, color: g.color || 'blue' });
    }
  }
  timed.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  allDay.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return { allDay, timed, dated, habits, deadlines };
}

/** Раскладка пересекающихся блоков по колонкам (как в Календаре Apple). */
export function layoutColumns(items) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const res = new Map();
  let group = [], groupEnd = -1;
  const flush = () => {
    if (!group.length) return;
    const cols = [];
    for (const it of group) {
      let placed = false;
      for (let c = 0; c < cols.length; c++) {
        if (cols[c] <= it.startMin) { cols[c] = it.endMin; res.set(it.key, { col: c, cols: 0 }); placed = true; break; }
      }
      if (!placed) { cols.push(it.endMin); res.set(it.key, { col: cols.length - 1, cols: 0 }); }
    }
    for (const it of group) res.get(it.key).cols = cols.length;
    group = [];
  };
  for (const it of sorted) {
    if (group.length && it.startMin >= groupEnd) { flush(); groupEnd = -1; }
    group.push(it);
    groupEnd = Math.max(groupEnd, it.endMin);
  }
  flush();
  return res;
}

// =====================================================================
// Оценка дня (для виджетов)
// =====================================================================

/** Доля выполненного за день: привычки по расписанию + задачи, запланированные на день. */
export function dayScore(data, idx, date) {
  let total = 0, done = 0;
  for (const h of data.habits) {
    if (!isScheduled(h, date)) continue;
    if ((h.schedule || {}).type === 'weekly') { // гибкие: учитываем, только если выполнено или сегодня
      if (!habitDone(idx, h, date) && date !== ymd(new Date())) continue;
    }
    total++;
    if (habitDone(idx, h, date)) done++;
  }
  for (const t of data.tasks) {
    if (t.date === date || (t.done && t.doneAt && ymd(new Date(t.doneAt)) === date && !t.date)) {
      total++;
      if (t.done) done++;
    }
  }
  return { total, done, pct: total ? done / total : 0 };
}

// =====================================================================
// Напоминания: общая функция для приложения и сервера
// =====================================================================

export const REMINDER_OPTIONS = [
  { v: null, label: 'Нет' },
  { v: 0, label: 'В момент начала' },
  { v: 5, label: 'За 5 минут' },
  { v: 10, label: 'За 10 минут' },
  { v: 15, label: 'За 15 минут' },
  { v: 30, label: 'За 30 минут' },
  { v: 60, label: 'За 1 час' },
  { v: 1440, label: 'За 1 день' },
];

/**
 * Строит список напоминаний на ближайшие horizonDays дней.
 * Возвращает [{ id, fireAt (ISO UTC), title, body, tag, url }]
 */
const EVENT_REMINDER_FACTORS = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };

function eventReminderDate(start, reminder) {
  const amount = Number(reminder.amount);
  if (!Number.isInteger(amount) || amount < 0 || !EVENT_REMINDER_FACTORS[reminder.unit]) return null;
  const when = new Date(start);
  if (reminder.unit === 'weeks') when.setDate(when.getDate() - amount * 7);
  else if (reminder.unit === 'days') when.setDate(when.getDate() - amount);
  else when.setTime(when.getTime() - amount * EVENT_REMINDER_FACTORS[reminder.unit] * 60000);
  return when;
}

// Возвращает короткий диапазон дат самих событий, напоминания которых попадут в очередь.
function eventOccurrenceRange(staleBefore, horizonEnd, reminder) {
  const amount = Number(reminder.amount);
  if (!Number.isInteger(amount) || amount < 0 || !EVENT_REMINDER_FACTORS[reminder.unit]) return null;
  const delta = amount * EVENT_REMINDER_FACTORS[reminder.unit];
  if (reminder.unit === 'days' || reminder.unit === 'weeks') {
    const days = amount * (reminder.unit === 'weeks' ? 7 : 1);
    return {
      from: addDays(ymd(new Date(staleBefore)), days),
      to: addDays(ymd(new Date(horizonEnd - 1)), days),
    };
  }
  return {
    from: ymd(new Date(staleBefore + delta * 60000)),
    to: ymd(new Date(horizonEnd - 1 + delta * 60000)),
  };
}

export function buildReminders(data, idx, now = new Date(), horizonDays = 14, defaultTime = '09:00') {
  const out = [];
  // Держим клиентское расписание в том же окне опоздания, что и сервер (6 часов).
  // Это позволяет поставить в очередь напоминание, если синхронизация произошла
  // уже после его времени, но сервер ещё успевает его доставить.
  const staleBefore = now.getTime() - 6 * 3600 * 1000;
  const horizonEnd = localDate(addDays(ymd(now), horizonDays + 1), '00:00').getTime();
  const push = (id, when, title, body, tag, url) => {
    if (!when || !Number.isFinite(when.getTime()) || when.getTime() < staleBefore || when.getTime() >= horizonEnd) return;
    out.push({ id, fireAt: when.toISOString(), title, body, tag, url });
  };
  const offset = (min) => (min || 0) * 60000;

  if (data.settings?.notifyEvents !== false) {
    for (const e of data.events || []) {
      // Старое поле в минутах поддерживается до первого сохранения события в новом редакторе.
      if (e.reminderMin != null) {
        const legacy = { amount: e.allDay || !e.start ? 0 : Math.max(0, Number(e.reminderMin) || 0), unit: 'minutes' };
        const range = eventOccurrenceRange(staleBefore, horizonEnd, legacy);
        if (range) for (const o of expandEvents([e], range.from, range.to)) {
          const allDay = e.allDay || !e.start;
          const time = allDay ? defaultTime : e.start;
          const start = localDate(o.date, time);
          const when = new Date(start.getTime() - (allDay ? 0 : offset(e.reminderMin)));
          push('ev:' + e.id + ':' + o.date, when, e.title, allDay ? 'Весь день' : 'Время: ' + e.start, 'ev-' + e.id, '#/calendar');
        }
      }

      // Отдельно ищем каждое относительное напоминание в ближайшем окне срабатывания.
      // Это не разворачивает многолетние серии даже при напоминании за тысячи недель.
      for (const reminder of (e.reminders || [])) {
        if (EVENT_REMINDER_FACTORS[reminder.unit]) {
          const range = eventOccurrenceRange(staleBefore, horizonEnd, reminder);
          if (!range) continue;
          for (const o of expandEvents([e], range.from, range.to)) {
            const allDay = e.allDay || !e.start;
            const start = localDate(o.date, allDay ? defaultTime : e.start);
            const when = eventReminderDate(start, reminder);
            if (when) push('evr:' + e.id + ':' + o.date + ':' + reminder.id, when, e.title, allDay ? 'Весь день' : 'Время: ' + e.start, 'evr-' + e.id + '-' + o.date + '-' + reminder.id, '#/calendar');
          }
        } else if (reminder.date && reminder.time) {
          // Старые абсолютные напоминания продолжают работать до сохранения мероприятия.
          push('evr:' + e.id + ':' + reminder.id, localDate(reminder.date, reminder.time), e.title, 'Напоминание о событии', 'evr-' + e.id + '-' + reminder.id, '#/calendar');
        }
      }
    }
  }

  if (data.settings?.notifyTasks !== false) {
    for (const t of data.tasks) {
      if (t.done) continue;
      // Поддержка старых записей до их первого сохранения в новом редакторе.
      if (!Array.isArray(t.reminders) || !t.reminders.length) {
        if (t.date && t.time && t.reminderMin != null) {
          const when = new Date(localDate(t.date, t.time).getTime() - offset(t.reminderMin));
          push(`tk:${t.id}`, when, t.title, `Время: ${t.time}`, `tk-${t.id}`, '#/tasks');
        } else if (t.date && !t.time && t.remindAt) {
          push(`tk:${t.id}`, localDate(t.date, t.remindAt), t.title, `Время: ${t.remindAt}`, `tk-${t.id}`, '#/tasks');
        }
      }
      const seenTaskReminderTimes = new Set();
      const taskDueAt = t.date
        ? (t.time ? localDate(t.date, t.time) : localDate(addDays(t.date, 1), '00:00'))
        : null;
      for (const r of (t.reminders || [])) {
        if (!r.date || !r.time) continue;
        const when = localDate(r.date, r.time);
        if (taskDueAt && when.getTime() >= taskDueAt.getTime()) continue;
        const fireKey = when.getTime();
        if (seenTaskReminderTimes.has(fireKey)) continue;
        seenTaskReminderTimes.add(fireKey);
        push(`tkr:${t.id}:${r.id}`, when, t.title, 'Напоминание о задаче', `tkr-${t.id}-${r.id}`, '#/tasks');
      }
    }
  }
  out.sort((a, b) => a.fireAt.localeCompare(b.fireAt));
  return out;
}

// =====================================================================
// Синхронизация: слияние по последней правке
// =====================================================================

/** Вернуть более свежую запись; при равенстве — локальную. */
export const pickNewer = (local, remote) => {
  if (!local) return remote;
  if (!remote) return local;
  return (remote.updatedAt || 0) > (local.updatedAt || 0) ? remote : local;
};

// Время в минутах → «Ч:ММ»
export const hhmm = fromMin;
