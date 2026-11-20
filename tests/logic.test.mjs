import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as L from '../js/logic.js';
import * as U from '../js/util.js';
import { parseCalendarICS, buildCalendarICS } from '../js/calendar-ics.js';
import { filterCalendarEvents, DEFAULT_CALENDAR_ID } from '../js/calendars.js';
import * as Store from '../js/store.js';

const T = '2026-11-15'; // воскресенье
const mkHabit = (o = {}) => ({ id: 'h1', title: 'Бег', type: 'check', schedule: { type: 'daily' }, startDate: '2026-10-01', ...o });
const idxOf = (habit, dates, value = 1) => L.buildLogIndex(dates.map((d) => ({ habitId: habit.id, date: d, value })));

test('даты: addDays / weekStart / diffDays', () => {
  assert.equal(U.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(U.weekStart(T, 1), '2026-11-09'); // воскресенье → понедельник прошлого дня недели
  assert.equal(U.weekStart('2026-11-09', 1), '2026-11-09');
  assert.equal(U.weekStart(T, 0), '2026-11-15');
  assert.equal(U.diffDays('2026-11-01', T), 14);
  assert.equal(U.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(U.fromMin(U.toMin('07:45')), '07:45');
});

test('plural', () => {
  assert.equal(U.plural(1, ['день', 'дня', 'дней']), 'день');
  assert.equal(U.plural(3, ['день', 'дня', 'дней']), 'дня');
  assert.equal(U.plural(11, ['день', 'дня', 'дней']), 'дней');
  assert.equal(U.plural(21, ['день', 'дня', 'дней']), 'день');
});

test('прогресс цели: по задачам, по весу, по метрике', () => {
  const goals = [
    { id: 'g', title: 'Цель' },
    { id: 's', title: 'Подцель', parentId: 'g' },
  ];
  const tasks = [
    { id: 1, goalId: 'g', done: true, weight: 1 },
    { id: 2, goalId: 's', done: false, weight: 3 },
    { id: 3, goalId: 's', done: true, weight: 1 },
    { id: 4, goalId: 'other', done: true },
  ];
  const data = { goals, tasks };
  let p = L.goalProgress(goals[0], data);
  assert.equal(p.total, 3);
  assert.equal(p.done, 2);
  assert.ok(Math.abs(p.pct - 2 / 3) < 1e-9);
  p = L.goalProgress({ ...goals[0], progressMode: 'weight' }, data);
  assert.ok(Math.abs(p.pct - 2 / 5) < 1e-9);
  p = L.goalProgress(goals[1], data);
  assert.equal(p.pct, 0.5);
  p = L.goalProgress({ id: 'm', progressMode: 'metric', metric: { start: 0, target: 100, current: 25, unit: 'км' } }, data);
  assert.equal(p.pct, 0.25);
  // убывающая метрика: вес 90 → 80, сейчас 85
  p = L.goalProgress({ id: 'm', progressMode: 'metric', metric: { start: 90, target: 80, current: 85 } }, data);
  assert.equal(p.pct, 0.5);
  p = L.goalProgress({ id: 'm', progressMode: 'metric', metric: { start: 0, target: 10, current: 50 } }, data);
  assert.equal(p.pct, 1);
  p = L.goalProgress({ id: 'empty' }, data);
  assert.equal(p.pct, 0);
});

test('серия ежедневной привычки: сегодня ещё не отмечено не ломает серию', () => {
  const h = mkHabit();
  const idx = idxOf(h, ['2026-11-12', '2026-11-13', '2026-11-14']);
  const s = L.habitStreaks(h, idx, T);
  assert.equal(s.current, 3);
  assert.equal(s.best, 3);
  const idx2 = idxOf(h, ['2026-11-12', '2026-11-13', '2026-11-14', T]);
  assert.equal(L.habitStreaks(h, idx2, T).current, 4);
});

test('серия ломается пропуском; лучшая серия сохраняется', () => {
  const h = mkHabit();
  const idx = idxOf(h, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-13', '2026-11-14']);
  const s = L.habitStreaks(h, idx, T);
  assert.equal(s.current, 2);
  assert.equal(s.best, 5);
});

test('серия по дням недели пропускает нерабочие дни', () => {
  // пн, ср, пт
  const h = mkHabit({ schedule: { type: 'days', days: [1, 3, 5] } });
  const idx = idxOf(h, ['2026-11-09', '2026-11-11', '2026-11-13']); // пн ср пт
  assert.equal(L.habitStreaks(h, idx, T).current, 3);
  assert.equal(L.isScheduled(h, '2026-11-10'), false);
  assert.equal(L.isScheduled(h, '2026-11-09'), true);
});

test('привычка-счётчик считается выполненной по достижении цели', () => {
  const h = mkHabit({ type: 'count', target: 8 });
  const idx = L.buildLogIndex([{ habitId: 'h1', date: T, value: 7 }, { habitId: 'h1', date: '2026-11-14', value: 8 }]);
  assert.equal(L.habitDone(idx, h, T), false);
  assert.equal(L.habitDone(idx, h, '2026-11-14'), true);
  assert.equal(L.habitCell(h, idx, T), 7 / 8);
});

test('серия «N раз в неделю» считается неделями', () => {
  const h = mkHabit({ schedule: { type: 'weekly', perWeek: 3 } });
  // неделя 2–8 ноября: 3 раза, неделя 9–15 ноября: 3 раза (текущая выполнена)
  const idx = idxOf(h, ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09', '2026-11-11', '2026-11-13']);
  const s = L.habitStreaks(h, idx, T);
  assert.equal(s.unit, 'week');
  assert.equal(s.current, 2);
  // текущая неделя не выполнена — предыдущая всё равно в серии
  const idx2 = idxOf(h, ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09']);
  assert.equal(L.habitStreaks(h, idx2, T).current, 1);
});

test('процент выполнения за период', () => {
  const h = mkHabit();
  const idx = idxOf(h, ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
  assert.equal(L.habitRate(h, idx, T, 5), 4 / 5); // 11..15, из них выполнено 4 (11,12,13,14)
});

test('повторяющиеся события: ежедневно, еженедельно по дням, ежемесячно, ежегодно, исключения', () => {
  const daily = { id: 'd', title: 'Д', date: '2026-11-10', start: '09:00', repeat: { freq: 'daily', interval: 2 } };
  let occ = L.expandEvents([daily], '2026-11-10', '2026-11-16').map((o) => o.date);
  assert.deepEqual(occ, ['2026-11-10', '2026-11-12', '2026-11-14', '2026-11-16']);

  const weekly = { id: 'w', title: 'W', date: '2026-11-02', start: '10:00', repeat: { freq: 'weekly', interval: 1, days: [1, 3] } };
  occ = L.expandEvents([weekly], '2026-11-02', '2026-11-15').map((o) => o.date);
  assert.deepEqual(occ, ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11']);

  const biweekly = { id: 'b', title: 'B', date: '2026-11-02', repeat: { freq: 'weekly', interval: 2 } };
  occ = L.expandEvents([biweekly], '2026-11-01', '2026-11-30').map((o) => o.date);
  assert.deepEqual(occ, ['2026-11-02', '2026-11-16', '2026-11-30']);

  const monthly = { id: 'm', title: 'M', date: '2026-01-31', repeat: { freq: 'monthly' } };
  occ = L.expandEvents([monthly], '2026-01-01', '2026-04-30').map((o) => o.date);
  assert.deepEqual(occ, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);

  const yearly = { id: 'y', title: 'Y', date: '2024-02-29', repeat: { freq: 'yearly' } };
  occ = L.expandEvents([yearly], '2025-01-01', '2026-12-31').map((o) => o.date);
  assert.deepEqual(occ, ['2025-02-28', '2026-02-28']);

  const until = { id: 'u', title: 'U', date: '2026-11-10', repeat: { freq: 'daily', until: '2026-11-12' } };
  occ = L.expandEvents([until], '2026-11-01', '2026-11-30').map((o) => o.date);
  assert.deepEqual(occ, ['2026-11-10', '2026-11-11', '2026-11-12']);

  const ex = { id: 'x', title: 'X', date: '2026-11-10', repeat: { freq: 'daily' }, exdates: ['2026-11-11'] };
  occ = L.expandEvents([ex], '2026-11-10', '2026-11-12').map((o) => o.date);
  assert.deepEqual(occ, ['2026-11-10', '2026-11-12']);

  const multi = { id: 'mu', title: 'Отпуск', allDay: true, date: '2026-11-20', endDate: '2026-11-22' };
  occ = L.expandEvents([multi], '2026-11-01', '2026-11-30').map((o) => o.date);
  assert.deepEqual(occ, ['2026-11-20', '2026-11-21', '2026-11-22']);

  const del = { id: 'z', title: 'Z', date: '2026-11-10', deleted: true };
  assert.equal(L.expandEvents([del], '2026-11-01', '2026-11-30').length, 0);
});

test('элементы дня: события, задачи, привычки, дедлайны', () => {
  const data = {
    events: [
      { id: 'e1', title: 'Встреча', date: T, start: '10:00', end: '11:00', color: 'red' },
      { id: 'e2', title: 'ДР', date: T, allDay: true },
    ],
    tasks: [
      { id: 't1', title: 'Позвонить', date: T, time: '10:30', duration: 120, goalId: 'g' },
      { id: 't2', title: 'Купить', date: T },
      { id: 't3', title: 'Другой день', date: '2026-11-16' },
    ],
    habits: [mkHabit()],
    goals: [{ id: 'g', title: 'Цель', color: 'green', deadline: T }],
  };
  const d = L.dayItems(data, T);
  assert.equal(d.timed.length, 2);
  assert.equal(d.timed[0].title, 'Встреча');
  assert.equal(d.timed[1].color, 'green'); // цвет задачи наследуется от цели
  assert.equal(d.timed[1].endMin - d.timed[1].startMin, 30); // старое поле duration больше не влияет на задачи
  assert.equal(d.allDay.length, 1);
  assert.equal(d.dated.length, 1);
  assert.equal(d.habits.length, 1);
  assert.equal(d.deadlines.length, 1);
  const f = L.dayItems(data, T, { filters: { tasks: false, habits: false } });
  assert.equal(f.timed.length, 1);
  assert.equal(f.habits.length, 0);
});

test('раскладка пересекающихся блоков по колонкам', () => {
  const items = [
    { key: 'a', startMin: 600, endMin: 660 },
    { key: 'b', startMin: 630, endMin: 700 },
    { key: 'c', startMin: 660, endMin: 720 },
    { key: 'd', startMin: 800, endMin: 830 },
  ];
  const l = L.layoutColumns(items);
  assert.equal(l.get('a').col, 0);
  assert.equal(l.get('b').col, 1);
  assert.equal(l.get('c').col, 0); // освободилась колонка 0
  assert.equal(l.get('a').cols, 2);
  assert.equal(l.get('d').cols, 1);
});

test('push-напоминания: только события и задачи', () => {
  const now = new Date(2026, 10, 15, 12, 0, 0);
  const data = {
    events: [
      { id: 'e1', title: 'Встреча', date: '2026-11-15', start: '15:00', reminderMin: 30 },
      { id: 'e2', title: 'Без напоминания', date: '2026-11-15', start: '16:00' },
      { id: 'e3', title: 'Недавно прошло', date: '2026-11-15', start: '09:00', reminderMin: 10 },
      { id: 'e4', title: 'Слишком давно', date: '2026-11-15', start: '05:00', reminderMin: 0 },
    ],
    tasks: [
      { id: 't1', title: 'Оплатить', date: '2026-11-16', time: '12:00', reminderMin: 60 },
      { id: 't2', title: 'Утром', date: '2026-11-17', remindAt: '09:00' },
      { id: 't3', title: 'Сделано', date: '2026-11-16', time: '12:00', reminderMin: 0, done: true },
      { id: 't4', title: 'Через две минуты', date: '2026-11-15', time: '12:02', reminderMin: 0 },
    ],
    habits: [mkHabit({ remind: true, time: '20:00', emoji: '🏃' })],
    goals: [],
  };
  const idx = idxOf(data.habits[0], [T]); // сегодня уже выполнено
  const r = L.buildReminders(data, idx, now, 3);
  const ids = r.map((x) => x.id);
  assert.ok(ids.includes('ev:e1:2026-11-15'));
  assert.ok(!ids.some((i) => i.startsWith('ev:e2')));
  assert.ok(ids.includes('ev:e3:2026-11-15')); // недавно наступившие остаются в окне доставки
  assert.ok(!ids.some((i) => i.startsWith('ev:e4'))); // старше 6 часов — не отправляем
  assert.ok(ids.includes('tk:t1'));
  assert.ok(ids.includes('tk:t2'));
  assert.ok(!ids.includes('tk:t3'));
  assert.ok(ids.includes('tk:t4')); // задача через две минуты ставится в расписание
  assert.ok(!ids.some((i) => i.startsWith('hb:'))); // привычки не отправляются в push
  // 15:00 минус 30 мин = 14:30 по локальному времени
  const e1 = r.find((x) => x.id === 'ev:e1:2026-11-15');
  assert.equal(new Date(e1.fireAt).getTime(), new Date(2026, 10, 15, 14, 30).getTime());
  // отсортировано по времени
  assert.deepEqual([...r].map((x) => x.fireAt), [...r].map((x) => x.fireAt).sort());

  const onlyTasks = L.buildReminders({ ...data, settings: { notifyEvents: false, notifyTasks: true } }, idx, now, 3);
  assert.ok(onlyTasks.every((x) => x.id.startsWith('tk:')));
  const onlyEvents = L.buildReminders({ ...data, settings: { notifyEvents: true, notifyTasks: false } }, idx, now, 3);
  assert.ok(onlyEvents.every((x) => x.id.startsWith('ev:')));
  const none = L.buildReminders({ ...data, settings: { notifyEvents: false, notifyTasks: false } }, idx, now, 3);
  assert.equal(none.length, 0);
});


test('push-напоминания: недавнее опоздание через полночь попадает в очередь', () => {
  const now = new Date(2026, 10, 16, 1, 0, 0);
  const data = {
    events: [],
    tasks: [
      { id: 'yesterday', title: 'Вчера поздно', date: '2026-11-15', remindAt: '23:30', time: null, done: false },
    ],
    habits: [],
    goals: [],
  };
  const r = L.buildReminders(data, new Map(), now, 14);
  assert.ok(r.some((item) => item.id === 'tk:yesterday'));
});

test('оценка дня', () => {
  const h = mkHabit();
  const data = { habits: [h], tasks: [{ id: 't', date: T, done: true }, { id: 'u', date: T, done: false }] };
  const idx = idxOf(h, [T]);
  const s = L.dayScore(data, idx, T);
  assert.equal(s.total, 3);
  assert.equal(s.done, 2);
});

test('слияние: побеждает более свежая запись', () => {
  assert.equal(L.pickNewer({ updatedAt: 5 }, { updatedAt: 9 }).updatedAt, 9);
  assert.equal(L.pickNewer({ updatedAt: 9 }, { updatedAt: 5 }).updatedAt, 9);
  assert.equal(L.pickNewer(null, { updatedAt: 1 }).updatedAt, 1);
});

test('дата новой задачи или мероприятия не может быть в прошлом', () => {
  const now = new Date(2026, 10, 18, 10, 0, 30);
  assert.equal(L.isDateNotPast('2026-11-17', now), false);
  assert.equal(L.isDateNotPast('2026-11-18', now), true);
  assert.equal(L.isDateNotPast('2026-11-19', now), true);
  assert.equal(L.isDateNotPast(null, now), true);
});

test('нельзя назначить независимое напоминание на прошедшую дату или время', () => {
  const now = new Date(2026, 10, 18, 10, 0, 30);
  assert.equal(L.isReminderInFuture({ date: '2026-11-17', time: '12:00' }, now), false);
  assert.equal(L.isReminderInFuture({ date: '2026-11-18', time: '10:00' }, now), false);
  assert.equal(L.isReminderInFuture({ date: '2026-11-18', time: '10:01' }, now), true);
  assert.equal(L.isReminderInFuture({ date: '2026-11-19', time: '00:01' }, now), true);
  assert.equal(L.isReminderInFuture({ date: '2026-11-18', time: '' }, now), false);
});

test('несколько независимых напоминаний задачи и события с собственными датами и временем', () => {
  const now = new Date(2026, 10, 15, 12, 0, 0);
  const data = {
    events: [{ id: 'ev-multi', title: 'Встреча', date: '2026-11-15', start: '15:00',
      reminders: [{ id: 'r1', date: '2026-11-15', time: '12:30' }, { id: 'r2', date: '2026-11-16', time: '08:15' }] }],
    tasks: [{ id: 'tk-multi', title: 'Подготовить отчёт', date: '2026-11-20',
      reminders: [{ id: 'a', date: '2026-11-15', time: '13:10' }, { id: 'b', date: '2026-11-18', time: '19:45' }] }],
    habits: [], goals: [],
  };
  const reminders = L.buildReminders(data, new Map(), now, 14);
  assert.deepEqual(reminders.map((r) => r.id), [
    'evr:ev-multi:r1', 'tkr:tk-multi:a', 'evr:ev-multi:r2', 'tkr:tk-multi:b',
  ]);
  assert.equal(new Date(reminders[0].fireAt).getTime(), new Date(2026, 10, 15, 12, 30).getTime());
  assert.equal(new Date(reminders[1].fireAt).getTime(), new Date(2026, 10, 15, 13, 10).getTime());
  assert.equal(new Date(reminders[2].fireAt).getTime(), new Date(2026, 10, 16, 8, 15).getTime());
  assert.equal(new Date(reminders[3].fireAt).getTime(), new Date(2026, 10, 18, 19, 45).getTime());
});

test('независимые напоминания сохраняются даже без даты задачи и не отправляются после выполнения', () => {
  const now = new Date(2026, 10, 15, 12, 0, 0);
  const task = { id: 't', title: 'Задача', done: false, reminders: [{ id: 'r', date: '2026-11-15', time: '13:00' }] };
  assert.equal(L.buildReminders({ tasks: [task], events: [], settings: { notifyTasks: true } }, new Map(), now).length, 1);
  assert.equal(L.buildReminders({ tasks: [{ ...task, done: true }], events: [], settings: { notifyTasks: true } }, new Map(), now).length, 0);
});

test('календарные папки фильтруют события по видимости и выбранному календарю', () => {
  const calendars = [
    { id: DEFAULT_CALENDAR_ID, visible: true },
    { id: 'birthdays', visible: true },
    { id: 'work', visible: false },
  ];
  const events = [
    { id: 'old-event', title: 'Старое событие' },
    { id: 'birthday', calendarId: 'birthdays' },
    { id: 'meeting', calendarId: 'work' },
  ];
  assert.deepEqual(filterCalendarEvents(events, calendars).map((event) => event.id), ['old-event', 'birthday']);
  assert.deepEqual(filterCalendarEvents(events, calendars, 'birthdays').map((event) => event.id), ['birthday']);
  assert.deepEqual(filterCalendarEvents(events, calendars, 'work'), []);
  assert.equal(events.length, 3);
});

test('в хранилище доступен базовый календарь для старых и новых событий', () => {
  const data = Store.data();
  assert.ok(data.calendars.some((calendar) => calendar.id === DEFAULT_CALENDAR_ID && calendar.isDefault));
});

test('цвет событий наследуется от календаря, а ручное переопределение сохраняется', () => {
  const data = {
    calendars: [
      { id: DEFAULT_CALENDAR_ID, color: 'blue', visible: true },
      { id: 'birthdays', color: 'pink', visible: true },
    ],
    events: [
      { id: 'inherited', title: 'Вечеринка', date: T, start: '09:00', end: '10:00', calendarId: 'birthdays', color: 'blue', colorOverride: false },
      { id: 'custom', title: 'Старое событие', date: T, start: '11:00', end: '12:00', calendarId: DEFAULT_CALENDAR_ID, color: 'orange', colorOverride: true },
    ],
    tasks: [], habits: [], goals: [],
  };
  const items = L.dayItems(data, T);
  assert.equal(items.timed.find((item) => item.id === 'inherited').color, 'pink');
  assert.equal(items.timed.find((item) => item.id === 'custom').color, 'orange');
});

test('iCalendar импортирует события, повторы, исключения, напоминания и события на весь день', () => {
  const source = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:weekly-meeting@example.test',
    'DTSTART:20261123T100000',
    'DTEND:20261123T110000',
    'SUMMARY:Meeting\\, planning',
    'DESCRIPTION:Line one\\nLine two',
    'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4',
    'EXDATE:20261125T100000',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:holiday@example.test',
    'DTSTART;VALUE=DATE:20261224',
    'DTEND;VALUE=DATE:20261227',
    'SUMMARY:Holiday',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const parsed = parseCalendarICS(source);
  assert.equal(parsed.events.length, 2);
  const meeting = parsed.events.find((event) => event.icsUid === 'weekly-meeting@example.test');
  assert.equal(meeting.title, 'Meeting, planning');
  assert.equal(meeting.notes, 'Line one\nLine two');
  assert.equal(meeting.start, '10:00');
  assert.equal(meeting.end, '11:00');
  assert.deepEqual(meeting.repeat, { freq: 'weekly', interval: 2, days: [1, 3], until: '2026-12-09' });
  assert.deepEqual(meeting.exdates, ['2026-11-25']);
  assert.deepEqual(meeting.reminders.map((item) => [item.amount, item.unit]), [[15, 'minutes']]);
  const holiday = parsed.events.find((event) => event.icsUid === 'holiday@example.test');
  assert.equal(holiday.allDay, true);
  assert.equal(holiday.endDate, '2026-12-26');
});

test('iCalendar корректно считает COUNT для BYDAY, когда DTSTART не совпадает с днём повтора', () => {
  const source = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:sunday-series@example.test',
    'DTSTART:20261128T100000', 'DTEND:20261128T110000', 'SUMMARY:Sunday series',
    'RRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=2',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\\r\\n');
  const parsed = parseCalendarICS(source);
  const event = parsed.events[0];
  assert.equal(event.repeat.until, '2026-12-06');
  assert.ok(parsed.warnings.some((warning) => warning.includes('не входит в BYDAY')));
});

test('iCalendar экспорт и повторный импорт сохраняют UID, цвет, повторение и напоминания', () => {
  const event = {
    id: 'event-roundtrip',
    icsUid: 'roundtrip@example.test',
    title: 'Праздник, вместе',
    date: '2026-12-24',
    start: '18:30',
    end: '19:30',
    allDay: false,
    location: 'Дом; зал',
    notes: 'Первая строка\nВторая строка',
    color: 'pink',
    colorOverride: true,
    repeat: { freq: 'yearly', interval: 1, until: '2030-12-24' },
    exdates: ['2027-12-24'],
    reminders: [{ id: 'rem-1', amount: 2, unit: 'hours' }],
  };
  const content = buildCalendarICS({ name: 'Праздники' }, [event]);
  const parsed = parseCalendarICS(content);
  assert.equal(parsed.events.length, 1);
  const result = parsed.events[0];
  assert.equal(result.icsUid, event.icsUid);
  assert.equal(result.title, event.title);
  assert.equal(result.location, event.location);
  assert.equal(result.notes, event.notes);
  assert.equal(result.color, 'pink');
  assert.equal(result.colorOverride, true);
  assert.deepEqual(result.repeat, event.repeat);
  assert.deepEqual(result.exdates, event.exdates);
  assert.deepEqual(result.reminders.map((item) => [item.amount, item.unit]), [[2, 'hours']]);
});

test('iCalendar предупреждает о неподдерживаемых отдельных изменениях повторения', () => {
  const source = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:series@example.test',
    'DTSTART:20261123T100000', 'DTEND:20261123T110000', 'SUMMARY:Series',
    'RRULE:FREQ=DAILY;COUNT=3', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:series@example.test',
    'RECURRENCE-ID:20261124T100000',
    'DTSTART:20261124T120000', 'DTEND:20261124T130000', 'SUMMARY:Moved',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const parsed = parseCalendarICS(source);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].title, 'Series');
  assert.ok(parsed.warnings.some((warning) => warning.includes('отдельное вхождение')));
});
