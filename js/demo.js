// Демонстрационные данные: показывают, как цели, задачи, привычки и календарь связаны между собой.
import { addDays, todayStr, uid, diffDays, dow } from './util.js';
import { applyChanges, settings, setSettings } from './store.js';

// простой детерминированный генератор, чтобы пример выглядел одинаково
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export function loadDemo() {
  const t0 = todayStr();
  const d = (n) => addDays(t0, n);
  const r = rng(7);
  const ch = [];
  const add = (kind, rec) => { rec.id = rec.id || uid(); rec.createdAt = Date.now(); ch.push({ kind, rec }); return rec.id; };

  // ---- Цели ----
  const run = add('goals', { title: 'Пробежать полумарафон', emoji: '🏃', color: 'green', category: 'Здоровье', deadline: d(74), progressMode: 'tasks', parentId: null, notes: 'Забег в начале февраля. Главное — регулярность.' });
  const runBase = add('goals', { title: 'Базовая подготовка', emoji: '👟', color: 'green', parentId: run, progressMode: 'tasks' });
  const runKm = add('goals', { title: 'Набрать километраж', emoji: '📈', color: 'green', parentId: run, progressMode: 'metric', metric: { start: 0, target: 150, current: 62, unit: 'км' } });

  const eng = add('goals', { title: 'Английский на уровне B2', emoji: '🇬🇧', color: 'purple', category: 'Обучение', deadline: d(120), progressMode: 'weight', parentId: null });
  const engGram = add('goals', { title: 'Грамматика', emoji: '📘', color: 'purple', parentId: eng, progressMode: 'weight' });
  const engTalk = add('goals', { title: 'Разговорная практика', emoji: '🗣️', color: 'purple', parentId: eng, progressMode: 'tasks' });

  const proj = add('goals', { title: 'Запустить свой проект', emoji: '🚀', color: 'blue', category: 'Карьера', deadline: d(46), progressMode: 'weight', parentId: null, notes: 'MVP, первые 10 пользователей, страница с описанием.' });
  const projMvp = add('goals', { title: 'MVP', emoji: '🧩', color: 'blue', parentId: proj, progressMode: 'weight' });
  const projLaunch = add('goals', { title: 'Запуск и первые пользователи', emoji: '📣', color: 'blue', parentId: proj, progressMode: 'tasks' });

  const money = add('goals', { title: 'Накопить 500 000 ₽', emoji: '💰', color: 'orange', category: 'Финансы', deadline: d(200), progressMode: 'metric', parentId: null, metric: { start: 0, target: 500000, current: 185000, unit: '₽' } });

  // ---- Задачи ----
  const task = (title, goalId, o = {}) => add('tasks', { title, goalId, done: false, priority: 0, weight: 1, checklist: [], notes: '', ...o });
  const doneAt = (n) => Date.now() - n * 864e5;

  task('Составить план тренировок на месяц', runBase, { done: true, doneAt: doneAt(9), date: d(-9) });
  task('Купить кроссовки', runBase, { done: true, doneAt: doneAt(6), date: d(-6) });
  task('Пробежка 5 км без остановок', runBase, { date: d(0), time: '07:30', duration: 45, priority: 2, reminderMin: 10, checklist: [{ id: uid(), text: 'Разминка 10 минут', done: true }, { id: uid(), text: 'Растяжка после', done: false }] });
  task('Сдать анализы и ЭКГ', runBase, { date: d(2), priority: 1 });
  task('Записаться на забег', runBase, { date: d(5) });
  task('Тест на 10 км', runBase, { date: d(9) });

  task('Пройти тест на уровень (Cambridge)', engGram, { done: true, doneAt: doneAt(12), date: d(-12), weight: 2 });
  task('Модальные глаголы — повторить и упражнения', engGram, { date: d(1), time: '19:30', duration: 45, weight: 2 });
  task('Conditionals: 3 типа, практика', engGram, { date: d(4), weight: 3 });
  task('Phrasal verbs — 50 карточек', engGram, { weight: 2 });
  task('Найти партнёра для разговорной практики', engTalk, { date: d(0), priority: 1 });
  task('Первое занятие с репетитором', engTalk, { date: d(3), time: '18:00', duration: 60, reminderMin: 30 });
  task('Посмотреть сериал без субтитров (3 серии)', engTalk, {});

  task('Описать пользовательский сценарий', projMvp, { done: true, doneAt: doneAt(4), date: d(-4), weight: 2 });
  task('Макеты основных экранов', projMvp, { done: true, doneAt: doneAt(2), date: d(-2), weight: 3 });
  task('Сделать авторизацию и хранение данных', projMvp, { date: d(0), time: '11:00', duration: 120, weight: 5, priority: 3, checklist: [{ id: uid(), text: 'Схема базы', done: true }, { id: uid(), text: 'Регистрация и вход', done: false }, { id: uid(), text: 'Тесты', done: false }] });
  task('Подготовить публичную страницу', projLaunch, { date: d(-1), priority: 2 }); // просрочена
  task('Написать пост-анонс', projLaunch, { date: d(8) });
  task('Собрать список из 20 первых тестировщиков', projLaunch, { date: d(6) });

  task('Настроить автоматический перевод на накопления', money, { date: d(1), reminderMin: null });
  task('Разобрать подписки и лишние траты', money, {});
  task('Купить продукты на неделю', null, { date: d(0), priority: 1 });
  task('Оплатить интернет', null, { date: d(0), time: '21:00', duration: 15 });

  // ---- Привычки ----
  const hab = (title, emoji, color, o) => add('habits', { title, emoji, color, type: 'check', schedule: { type: 'daily' }, startDate: d(-70), goalId: null, ...o });
  const hMorn = hab('Утренняя зарядка', '🤸', 'green', { time: '07:00', remind: true, goalId: run });
  const hWater = hab('Выпить воду', '💧', 'blue', { type: 'count', target: 8, unit: 'стаканов' });
  const hRead = hab('Чтение', '📖', 'orange', { type: 'count', target: 20, unit: 'страниц', time: '22:00' });
  const hMed = hab('Медитация', '🧘', 'indigo', { type: 'timer', target: 10, unit: 'мин' });
  const hTrain = hab('Тренировка', '🏋️', 'red', { schedule: { type: 'weekly', perWeek: 3 }, goalId: run });
  const hEng = hab('Английский', '🎧', 'purple', { type: 'timer', target: 15, unit: 'мин', schedule: { type: 'days', days: [1, 2, 3, 4, 5] }, goalId: eng, time: '08:15', remind: true });
  const hSweet = hab('Без сладкого', '🍬', 'pink', { startDate: d(-30) });

  // ---- История привычек ----
  const habits = [
    [hMorn, 0.8, 1], [hWater, 0.85, 8], [hRead, 0.65, 20], [hMed, 0.6, 10], [hEng, 0.75, 15], [hSweet, 0.7, 1],
  ];
  for (const [id, p, full] of habits) {
    const start = id === hSweet ? -30 : -70;
    for (let n = start; n <= 0; n++) {
      const date = d(n);
      const dowN = dow(date);
      if (id === hEng && (dowN === 0 || dowN === 6)) continue;
      // последние 9 дней сделаем почти идеальными: красивая серия
      const ok = n > -9 && n < 0 ? r() < 0.97 : r() < p;
      if (n === 0) continue; // сегодняшний день оставляем пустым — есть что отметить
      if (!ok) { if (full > 1 && r() < 0.5) add('logs', { id: `${id}|${date}`, habitId: id, date, value: Math.round(full * (0.4 + r() * 0.4)) }); continue; }
      add('logs', { id: `${id}|${date}`, habitId: id, date, value: full });
    }
  }
  for (let n = -70; n < 0; n++) { // тренировки 3 раза в неделю
    const date = d(n);
    const w = dow(date);
    if ((w === 2 || w === 4 || w === 6) && r() < 0.85) add('logs', { id: `${hTrain}|${date}`, habitId: hTrain, date, value: 1 });
  }
  // вода сегодня: частично
  add('logs', { id: `${hWater}|${t0}`, habitId: hWater, date: t0, value: 3 });
  add('logs', { id: `${hMorn}|${t0}`, habitId: hMorn, date: t0, value: 1 });

  // ---- События ----
  const ev = (title, date, o) => add('events', { title, date, color: 'blue', allDay: false, repeat: { freq: 'none' }, reminderMin: null, ...o });
  ev('Планёрка', addDays(t0, -((dow(t0) + 6) % 7)), { start: '10:00', end: '10:45', color: 'blue', repeat: { freq: 'weekly', interval: 1, days: [1, 3] }, location: 'Zoom' });
  ev('Силовая тренировка', addDays(t0, -((dow(t0) + 5) % 7)), { start: '19:00', end: '20:00', color: 'green', repeat: { freq: 'weekly', interval: 1, days: [2, 4] }, location: 'Фитнес-клуб' });
  ev('Созвон с командой', d(0), { start: '16:00', end: '17:00', color: 'indigo', reminderMin: 10, location: 'Google Meet' });
  ev('Ужин с Аней', d(0), { start: '19:30', end: '21:00', color: 'orange', reminderMin: 30, location: 'Ресторан «Север»' });
  ev('Обед с коллегами', d(1), { start: '13:00', end: '14:00', color: 'orange' });
  ev('Стоматолог', d(3), { start: '15:30', end: '16:15', color: 'red', reminderMin: 60, location: 'Клиника на Арбате' });
  ev('День рождения мамы', d(9), { allDay: true, color: 'pink', repeat: { freq: 'yearly' }, reminderMin: 0 });
  ev('Поездка в Питер', d(14), { allDay: true, endDate: d(16), color: 'teal' });
  ev('Ревью проекта', d(5), { start: '12:00', end: '13:00', color: 'blue' });

  applyChanges(ch);
  if (!settings().onboarded) setSettings({ onboarded: true });
  return diffDays(t0, d(0));
}
