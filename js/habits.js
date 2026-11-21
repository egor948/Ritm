// Экран «Привычки» и детальная страница привычки.
import { h, todayStr, addDays, weekStart, parseYmd, monthStart, addMonths, daysInMonth, MONTHS_NOM, WD_SHORT, WD_LONG, plural, pad, fmtDayMonth, pct as pctOf } from './util.js';
import * as S from './store.js';
import {
  isScheduled, habitDone, habitValue, habitTarget, habitStreaks, habitRate, habitCell, dayScore,
} from './logic.js';
import { ic, cv, ring, seg, emptyState, openSheet, group, row, stepper, toast } from './ui.js';
import { screen, navBtn } from './shell.js';
import { openLayer, layerScreen } from './layers.js';
import { habitTap, habitAdjust, habitValueLabel } from './components.js';
import { editHabit } from './editors.js';
import { openGoalDetail } from './goals.js';
import { view } from './nav.js';

const scheduleText = (hb) => {
  const s = hb.schedule || { type: 'daily' };
  if (s.type === 'days') return [1, 2, 3, 4, 5, 6, 0].filter((d) => (s.days || []).includes(d)).map((d) => WD_SHORT[d]).join(', ');
  if (s.type === 'weekly') return `${s.perWeek} ${plural(s.perWeek, ['раз', 'раза', 'раз'])} в неделю`;
  return 'Каждый день';
};
const streakText = (st) => (st.unit === 'week' ? `${st.current} ${plural(st.current, ['неделя', 'недели', 'недель'])}` : `${st.current} ${plural(st.current, ['день', 'дня', 'дней'])}`);

/** Сколько раз привычка выполнена на текущей неделе. */
function weekProgress(hb, data) {
  const ws = weekStart(todayStr(), S.settings().weekStart);
  let n = 0;
  for (let i = 0; i < 7; i++) if (habitDone(data.idx, hb, addDays(ws, i))) n++;
  return n;
}

// ---------- обновление живых таймеров ----------
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
export function tickTimers() {
  document.querySelectorAll('[data-timer-start]').forEach((el) => { el.textContent = fmtClock(Date.now() - Number(el.dataset.timerStart)); });
}

// =====================================================================
// Экран
// =====================================================================
export function habitsScreen() {
  const data = S.data();
  const today = todayStr();
  const habits = data.habits.filter((x) => !x.archived);
  const sched = habits.filter((x) => isScheduled(x, today));
  const done = sched.filter((x) => habitDone(data.idx, x, today)).length;
  const best = habits.map((x) => ({ x, st: habitStreaks(x, data.idx, today, S.settings().weekStart) })).sort((a, b) => b.st.current - a.st.current)[0];
  const body = [];

  if (habits.length) {
    body.push(h('div', { class: 'rise', style: { '--i': 0 } }, seg({
      key: 'habits-tab', options: [{ v: 'today', label: 'Сегодня' }, { v: 'all', label: 'Все привычки' }], value: view.habitsTab,
      onChange: (v) => { view.habitsTab = v; document.dispatchEvent(new CustomEvent('rerender')); },
    })));
  }

  if (!habits.length) {
    body.push(emptyState({ emoji: '🌱', title: 'Создайте первую привычку', text: 'Ежедневные ритуалы, счётчики воды или таймер для медитации. Привычки можно связать с целями.', action: { label: 'Новая привычка', onClick: () => editHabit(null) } }));
  } else if (view.habitsTab === 'today') {
    body.push(h('div', { class: 'card summary rise', style: { '--i': 1 } },
      ring({ key: 'habits-sum', pct: sched.length ? done / sched.length : 0, size: 76, stroke: 9, color: 'green', center: h('b', null, `${done}/${sched.length}`) }),
      h('div', { class: 'summary-text' },
        h('b', null, done === sched.length && sched.length ? 'Все привычки выполнены 🎉' : 'Сегодня'),
        h('span', null, sched.length ? `Осталось ${sched.length - done} ${plural(sched.length - done, ['привычка', 'привычки', 'привычек'])}` : 'На сегодня привычек нет'),
        best && best.st.current > 1 ? h('span', { class: 'dim flame' }, ic('flame', 14), `Лучшая серия: ${best.x.title} — ${streakText(best.st)}`) : null)));
    body.push(h('div', { class: 'card list rise', style: { '--i': 2 } }, sched.map((x) => habitRow(x, data, today))));
    const off = habits.filter((x) => !isScheduled(x, today));
    if (off.length) {
      body.push(h('div', { class: 'sec-head' }, h('h3', null, 'Не по расписанию сегодня')));
      body.push(h('div', { class: 'card list dimmed' }, off.map((x) => h('div', { class: 'habit-off', onclick: () => openHabitDetail(x.id) }, h('span', { class: 'hm-emoji sm', style: { '--c': cv(x.color || 'green') } }, x.emoji), h('b', null, x.title), h('span', { class: 'dim' }, scheduleText(x))))));
    }
  } else {
    habits.forEach((x, i) => body.push(habitCard(x, data, i + 1)));
  }
  return screen({ id: 'habits', title: 'Привычки', eyebrow: sched.length ? `Сегодня ${done} из ${sched.length}` : 'Ритм дня', actions: [navBtn('plus', 'Новая привычка', () => editHabit(null))], children: body });
}

function habitRow(x, data, date) {
  const v = habitValue(data.idx, x, date);
  const target = habitTarget(x);
  const isDone = v >= target;
  const st = habitStreaks(x, data.idx, date, S.settings().weekStart);
  const running = x.type === 'timer' && S.timers()[x.id] && date === todayStr();
  const weekly = (x.schedule || {}).type === 'weekly';
  const main = h('button', {
    type: 'button', class: 'hr-main' + (isDone ? ' done' : ''), style: { '--c': cv(x.color || 'green') }, 'aria-label': isDone ? 'Снять отметку' : 'Отметить',
    onclick: (e) => habitTap(x, date, e.currentTarget),
  }, ring({ key: 'hr' + x.id, pct: v / target, size: 46, stroke: 10, color: x.color || 'green', center: isDone ? ic('check', 20) : x.type === 'timer' ? ic(running ? 'pause' : 'play', 18) : h('span', null, x.emoji || '•') }));
  let sub;
  if (x.type === 'timer') sub = running ? h('span', { class: 'timer-live', 'data-timer-start': S.timers()[x.id] }, fmtClock(Date.now() - S.timers()[x.id])) : `${v} из ${target} мин`;
  else if (x.type === 'count') sub = `${v} из ${target}${x.unit ? ' ' + x.unit : ''}`;
  else sub = weekly ? `${weekProgress(x, data)} из ${x.schedule.perWeek} на этой неделе` : x.time ? `в ${x.time}` : 'Да / нет';
  return h('div', { class: 'habit-row' + (isDone ? ' done' : '') },
    main,
    h('div', { class: 'hr-text', onclick: () => openHabitDetail(x.id) },
      h('b', null, x.title),
      h('span', null, sub, x.time && x.type !== 'check' ? ` · ${x.time}` : '')),
    x.type === 'count' ? h('div', { class: 'mini-step' },
      h('button', { 'aria-label': 'Меньше', onclick: () => habitAdjust(x, date, -1) }, ic('minus', 16)),
      h('button', { 'aria-label': 'Больше', onclick: (e) => habitTap(x, date, e.currentTarget) }, ic('plus', 16))) : null,
    st.current ? h('span', { class: 'streak-badge', title: 'Текущая серия' }, ic('flame', 14), st.current) : null);
}

export function heatmap(hb, data, weeks = 12) {
  const today = todayStr();
  const ws = weekStart(today, S.settings().weekStart);
  const grid = h('div', { class: 'heat', style: { '--c': cv(hb.color || 'green'), '--cols': weeks } });
  for (let w = weeks - 1; w >= 0; w--) {
    const col = h('div', { class: 'heat-col' });
    for (let d = 0; d < 7; d++) {
      const date = addDays(ws, -w * 7 + d);
      const future = date > today;
      const v = future ? null : habitCell(hb, data.idx, date);
      col.appendChild(h('i', { class: 'heat-cell' + (future ? ' future' : v == null ? ' off' : v >= 1 ? ' full' : v > 0 ? ' part' : ' zero') + (date === today ? ' today' : ''), style: v != null && v > 0 && v < 1 ? { '--v': 0.25 + v * 0.55 } : null, title: date }));
    }
    grid.appendChild(col);
  }
  return grid;
}

function habitMonthGrid(x, data, first) {
  const lead = (parseYmd(first).getDay() - S.settings().weekStart + 7) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('i', { class: 'habit-month-day blank', 'aria-hidden': 'true' }));
  for (let day = 1; day <= daysInMonth(first); day++) {
    const date = first.slice(0, 8) + pad(day);
    const future = date > todayStr();
    const value = future ? null : habitCell(x, data.idx, date);
    cells.push(h('i', {
      class: 'habit-month-day' + (future ? ' future' : value == null ? ' off' : value >= 1 ? ' full' : value > 0 ? ' part' : ' zero') + (date === todayStr() ? ' today' : ''),
      style: value != null && value > 0 && value < 1 ? { '--v': 0.2 + value * 0.65 } : null,
      title: date,
    }, day));
  }
  return h('div', { class: 'habit-month-grid', 'aria-label': 'История привычки за ' + first.slice(0, 7) }, cells);
}

function habitCard(x, data, i) {
  const st = habitStreaks(x, data.idx, todayStr(), S.settings().weekStart);
  const rate = habitRate(x, data.idx, todayStr(), 30, S.settings().weekStart);
  const gl = x.goalId && data.goals.find((g) => g.id === x.goalId);
  return h('div', { class: 'card habit-card rise pressable', style: { '--c': cv(x.color || 'green'), '--i': i }, onclick: () => openHabitDetail(x.id) },
    h('div', { class: 'hc-head' },
      h('div', { class: 'hm-emoji', style: { '--c': cv(x.color || 'green') } }, x.emoji || '•'),
      h('div', { class: 'hc-title' }, h('b', null, x.title), h('span', null, scheduleText(x), gl ? ` · ${gl.emoji || '🎯'} ${gl.title}` : '')),
      st.current ? h('span', { class: 'streak-badge' }, ic('flame', 14), streakText(st)) : null),
    habitMonthGrid(x, data, monthStart(todayStr())),
    h('div', { class: 'hc-stats' },
      h('span', null, h('b', null, st.best), ` ${st.unit === 'week' ? 'нед.' : 'дн.'} лучшая`),
      h('span', null, h('b', null, rate == null ? '—' : Math.round(rate * 100) + '%'), ' за 30 дней')));
}

// =====================================================================
// Детали привычки
// =====================================================================
let detailMonth = null;
export function openHabitDetail(id) {
  detailMonth = monthStart(todayStr());
  return openLayer({
    render(api) {
      const data = S.data();
      const x = data.habits.find((y) => y.id === id);
      if (!x) return null;
      const today = todayStr();
      const wsd = S.settings().weekStart;
      const st = habitStreaks(x, data.idx, today, wsd);
      const rate = habitRate(x, data.idx, today, 30, wsd);
      const total = data.logs.filter((l) => l.habitId === id && l.value >= habitTarget(x)).length;
      const v = habitValue(data.idx, x, today);
      const target = habitTarget(x);
      const gl = x.goalId && data.goals.find((g) => g.id === x.goalId);
      const color = x.color || 'green';
      const running = x.type === 'timer' && S.timers()[x.id];

      const children = [
        h('div', { class: 'hero', style: { '--c': cv(color) } },
          h('div', { class: 'hero-glow' }),
          h('div', { class: 'hero-row' },
            h('div', { class: 'hero-text' },
              h('div', { class: 'hero-emoji' }, x.emoji || '•'),
              h('h2', null, x.title),
              h('div', { class: 'hero-meta' }, scheduleText(x), x.time ? ` · ${x.time}` : '')),
            h('button', { class: 'ring-btn', onclick: (e) => habitTap(x, today, e.currentTarget), 'aria-label': 'Отметить сегодня' },
              ring({ key: 'hd' + id, pct: v / target, size: 112, stroke: 10, color, center: v >= target ? ic('check', 40) : x.type === 'timer' ? (running ? h('b', { class: 'timer-live big', 'data-timer-start': running }, fmtClock(Date.now() - running)) : ic('play', 34)) : h('div', { class: 'ring-big' }, h('b', null, v), h('small', null, `/${target}`)) }))),
          h('div', { class: 'hero-stats' },
            statBox(st.current, st.unit === 'week' ? 'нед. подряд' : 'дн. подряд'),
            statBox(st.best, 'рекорд'),
            statBox(rate == null ? '—' : Math.round(rate * 100) + '%', 'за 30 дней'),
            statBox(total, plural(total, ['раз', 'раза', 'раз']) + ' всего'))),
        gl ? h('button', { class: 'card goal-link pressable', onclick: () => openGoalDetail(gl.id) }, h('span', { class: 'hm-emoji sm', style: { '--c': cv(gl.color || 'blue') } }, gl.emoji || '🎯'), h('div', null, h('small', null, 'Привязана к цели'), h('b', null, gl.title)), ic('chevR', 18)) : null,
        h('div', { class: 'sec-head' }, h('h3', null, 'История')),
        monthCard(x, data, api),
        h('div', { class: 'pad-bottom' }),
      ];
      return layerScreen({
        title: x.title, backLabel: 'Привычки', onBack: () => api.close(),
        actions: [h('button', { class: 'nav-btn', 'aria-label': 'Изменить', onclick: () => editHabit(x) }, ic('edit', 21))],
        children,
      });
    },
  });
}
const statBox = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));

function monthCard(x, data, api) {
  const today = todayStr();
  const first = detailMonth;
  const lead = (parseYmd(first).getDay() - S.settings().weekStart + 7) % 7;
  const n = daysInMonth(first);
  const wd = [...Array(7)].map((_, i) => WD_SHORT[(S.settings().weekStart + i) % 7]);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('i', { class: 'mc-blank' }));
  for (let d = 1; d <= n; d++) {
    const date = `${first.slice(0, 8)}${pad(d)}`;
    const future = date > today;
    const c = future ? null : habitCell(x, data.idx, date);
    cells.push(h('button', {
      class: 'mc-day' + (c != null && c >= 1 ? ' full' : c > 0 ? ' part' : '') + (date === today ? ' today' : '') + (future ? ' future' : ''), disabled: future,
      style: c != null && c > 0 && c < 1 ? { '--v': 0.2 + c * 0.5 } : null,
      onclick: () => (x.type === 'check' ? S.setLog(x.id, date, habitValue(data.idx, x, date) >= 1 ? 0 : 1) : openValueSheet(x, date)),
    }, d));
  }
  return h('div', { class: 'card month-card', style: { '--c': cv(x.color || 'green') } },
    h('div', { class: 'mc-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Предыдущий месяц', onclick: () => { detailMonth = addMonths(first, -1); api.refresh(); } }, ic('chevL', 20)),
      h('b', null, `${MONTHS_NOM[parseYmd(first).getMonth()]} ${first.slice(0, 4)}`),
      h('button', { class: 'icon-btn', 'aria-label': 'Следующий месяц', onclick: () => { detailMonth = addMonths(first, 1); api.refresh(); }, disabled: false }, ic('chevR', 20))),
    h('div', { class: 'mc-wd' }, wd.map((w) => h('span', null, w))),
    h('div', { class: 'mc-grid' }, cells),
    h('div', { class: 'hint tight center' }, x.type === 'check' ? 'Нажмите на день, чтобы отметить или снять отметку' : 'Нажмите на день, чтобы изменить значение'));
}

function openValueSheet(x, date) {
  let value = habitValue(S.data().idx, x, date);
  openSheet({
    title: fmtDayMonth(date), left: { label: 'Отмена' }, right: { label: 'Готово', bold: true, onClick: (api) => { S.setLog(x.id, date, value); api.close(true); } },
    build(api) {
      api.body.append(group(row(`${x.emoji || ''} ${x.title}${x.unit ? ', ' + x.unit : ''}`, stepper(value, (v) => (value = v), { min: 0, max: 9999, step: x.type === 'timer' ? 5 : 1 }))), h('div', { class: 'group-note' }, `Цель: ${habitTarget(x)}${x.unit ? ' ' + x.unit : ''}`), h('div', { class: 'sheet-pad' }));
    },
  });
}
