// Экран «Цели» и детальная страница цели: подцели, задачи, привычки, метрика.
import { h, todayStr, diffDays, fmtDayMonth, plural, pct as pctOf, addDays, clear } from './util.js';
import * as S from './store.js';
import { goalProgress, subgoalsOf, subtreeTasks, habitStreaks, habitRate, habitDone, habitTarget } from './logic.js';
import { ic, cv, ring, pills, emptyState, openSheet, group, row, numberInput, toast, stepper } from './ui.js';
import { screen, navBtn } from './shell.js';
import { openLayer, layerScreen } from './layers.js';
import { progressBar, taskRow } from './components.js';
import { editGoal, editTask, editHabit } from './editors.js';
import { openHabitDetail } from './habits.js';
import { view } from './nav.js';
import { isTaskInCompletionWindow } from './task-completion.js';

const expandedBlocks = new Set(); // свёрнутые подцели хранятся здесь (по умолчанию всё раскрыто)

export function deadlineInfo(goal, today = todayStr()) {
  if (!goal.deadline) return null;
  const n = diffDays(today, goal.deadline);
  const date = fmtDayMonth(goal.deadline);
  if (n < 0) return { text: `${date} · просрочено на ${-n} ${plural(-n, ['день', 'дня', 'дней'])}`, tone: 'bad', n };
  if (n === 0) return { text: `${date} · сегодня`, tone: 'warn', n };
  return { text: `${date} · ${n} ${plural(n, ['день', 'дня', 'дней'])}`, tone: n <= 14 ? 'warn' : '', n };
}

export const progressLabel = (p) => {
  if (p.mode === 'metric') return `${fmtNum(p.done)} из ${fmtNum(p.total)}${p.unit ? ' ' + p.unit : ''}`;
  return p.total ? `${p.done} из ${p.total} ${plural(p.total, ['задачи', 'задач', 'задач'])}` : 'Нет задач';
};
export const fmtNum = (n) => (Math.abs(n) >= 10000 ? Math.round(n).toLocaleString('ru-RU') : String(Math.round(n * 100) / 100).replace('.', ','));

// =====================================================================
// Список целей
// =====================================================================
export function goalsScreen() {
  const data = S.data();
  const tops = data.goals.filter((g) => !g.parentId);
  const active = tops.filter((g) => !g.archived);
  const archived = tops.filter((g) => g.archived);
  const cats = [...new Set(active.map((g) => g.category).filter(Boolean))];
  if (view.goalsCategory !== 'all' && !cats.includes(view.goalsCategory)) view.goalsCategory = 'all';
  const shown = active.filter((g) => view.goalsCategory === 'all' || g.category === view.goalsCategory)
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  const progresses = active.map((g) => goalProgress(g, data).pct);
  const avg = progresses.length ? progresses.reduce((s, v) => s + v, 0) / progresses.length : 0;

  const body = [];
  if (active.length) {
    body.push(h('div', { class: 'card summary rise', style: { '--i': 0 } },
      ring({ key: 'goals-sum', pct: avg, size: 76, stroke: 9, color: 'blue', center: h('b', null, Math.round(avg * 100) + '%') }),
      h('div', { class: 'summary-text' },
        h('b', null, 'Общий прогресс'),
        h('span', null, `${active.length} ${plural(active.length, ['активная цель', 'активные цели', 'активных целей'])}`),
        (() => { const next = active.filter((g) => g.deadline && goalProgress(g, data).pct < 1).sort((a, b) => a.deadline.localeCompare(b.deadline))[0]; return next ? h('span', { class: 'dim' }, `Ближайший срок: «${next.title}» — ${deadlineInfo(next).text.split(' · ')[1] || ''}`) : null; })())));
    if (cats.length) body.push(h('div', { class: 'hscroll rise', style: { '--i': 1 } }, pills({ options: [{ v: 'all', label: 'Все' }, ...cats.map((c) => ({ v: c, label: c }))], value: view.goalsCategory, onChange: (v) => { view.goalsCategory = v; document.dispatchEvent(new CustomEvent('rerender')); } })));
    shown.forEach((g, i) => body.push(goalCard(g, data, i + 2)));
    if (archived.length) body.push(h('button', { class: 'link-btn rise', style: { '--i': shown.length + 3 }, onclick: () => openArchive(archived) }, `Архив · ${archived.length}`));
  } else {
    body.push(emptyState({ emoji: '🎯', title: 'Начните с первой цели', text: 'Разбейте её на подцели и задачи — прогресс будет считаться сам, а задачи появятся в календаре.', action: { label: 'Создать цель', onClick: () => editGoal(null) } }));
  }
  return screen({ id: 'goals', title: 'Цели', eyebrow: active.length ? `${Math.round(avg * 100)}% в среднем` : 'Планы и достижения', actions: [navBtn('plus', 'Новая цель', () => editGoal(null))], children: body });
}

export function goalCard(goal, data, i = 0) {
  const p = goalProgress(goal, data);
  const subs = subgoalsOf(data.goals, goal.id);
  const dl = deadlineInfo(goal);
  const habits = data.habits.filter((x) => x.goalId === goal.id || subs.some((s) => s.id === x.goalId));
  return h('div', { class: 'goal-card rise pressable', style: { '--c': cv(goal.color || 'blue'), '--i': i }, onclick: () => openGoalDetail(goal.id) },
    h('div', { class: 'goal-top' },
      h('div', { class: 'goal-emoji' }, goal.emoji || '🎯'),
      h('div', { class: 'goal-head' },
        h('div', { class: 'goal-title' }, goal.title),
        h('div', { class: 'goal-sub' }, [goal.category, progressLabel(p)].filter(Boolean).join(' · '))),
      ring({ key: 'g' + goal.id, pct: p.pct, size: 58, stroke: 10, color: goal.color || 'blue', center: h('span', { class: 'ring-pct' }, Math.round(p.pct * 100)) })),
    subs.length ? h('div', { class: 'goal-subs' }, subs.slice(0, 3).map((s) => {
      const sp = goalProgress(s, data);
      return h('div', { class: 'sub-line' }, h('span', { class: 'sub-name' }, `${s.emoji || '•'} ${s.title}`), progressBar({ pct: sp.pct, color: s.color || goal.color || 'blue' }), h('span', { class: 'sub-pct' }, Math.round(sp.pct * 100) + '%'));
    }), subs.length > 3 ? h('div', { class: 'sub-more' }, `ещё ${subs.length - 3}`) : null) : null,
    h('div', { class: 'goal-foot' },
      dl ? h('span', { class: 'chip ' + dl.tone }, ic('flag', 13), dl.text) : null,
      habits.length ? h('span', { class: 'chip' }, ic('flame', 13), `${habits.length} ${plural(habits.length, ['привычка', 'привычки', 'привычек'])}`) : null,
      p.pct >= 1 ? h('span', { class: 'chip ok' }, ic('check', 13), 'Достигнута') : null));
}

function openArchive(list) {
  openSheet({
    title: 'Архив целей', left: null, right: { label: 'Готово', bold: true }, build(api) {
      api.body.append(group(...list.map((g) => h('div', { class: 'row', onclick: () => { api.close(); openGoalDetail(g.id); } }, h('div', { class: 'row-label' }, `${g.emoji || '🎯'} ${g.title}`), h('div', { class: 'row-ctl dim' }, ic('chevR', 18))))));
    },
  });
}

// =====================================================================
// Детали цели
// =====================================================================
export function openGoalDetail(id) {
  return openLayer({
    render(api) {
      const data = S.data();
      const goal = data.goals.find((g) => g.id === id);
      if (!goal || (goal.deleted)) return null;
      const p = goalProgress(goal, data);
      const subs = data.goals.filter((g) => g.parentId === id && !g.archived);
      const direct = data.tasks.filter((t) => t.goalId === id);
      const dl = deadlineInfo(goal);
      const habits = data.habits.filter((x) => !x.archived && (x.goalId === id || subs.some((s) => s.id === x.goalId)));
      const all = subtreeTasks(id, data);
      const openTasks = all.filter((t) => !t.done).length;
      const color = goal.color || 'blue';

      const children = [];
      children.push(h('div', { class: 'hero', style: { '--c': cv(color) } },
        h('div', { class: 'hero-glow' }),
        h('div', { class: 'hero-row' },
          h('div', { class: 'hero-text' },
            h('div', { class: 'hero-emoji' }, goal.emoji || '🎯'),
            h('h2', null, goal.title),
            h('div', { class: 'hero-meta' }, goal.category || null, dl ? h('span', { class: dl.tone }, dl.text) : null)),
          ring({ key: 'gd' + id, pct: p.pct, size: 112, stroke: 10, color, center: h('div', { class: 'ring-big' }, h('b', null, Math.round(p.pct * 100)), h('small', null, '%')) })),
        h('div', { class: 'hero-stats' },
          stat(p.mode === 'metric' ? fmtNum(p.done) : p.done, p.mode === 'metric' ? (p.unit || 'сейчас') : plural(p.done, ['выполнена', 'выполнено', 'выполнено'])),
          stat(p.mode === 'metric' ? fmtNum(p.total) : openTasks, p.mode === 'metric' ? 'цель' : 'осталось'),
          stat(subs.length, plural(subs.length, ['подцель', 'подцели', 'подцелей'])),
          stat(habits.length, plural(habits.length, ['привычка', 'привычки', 'привычек'])))));

      if (goal.progressMode === 'metric') children.push(metricCard(goal, color));
      if (goal.notes) children.push(h('div', { class: 'card note' }, goal.notes));

      // Подцели
      children.push(sectionHead('Подцели', [{ icon: 'plus', label: 'Подцель', onClick: () => editGoal(null, { parentId: id, color }) }]));
      if (!subs.length) children.push(h('div', { class: 'hint' }, 'Подцели помогают разбить большую цель на этапы. У каждой — свои задачи и свой прогресс.'));
      subs.forEach((s) => children.push(subBlock(s, data, color, api)));

      // Задачи самой цели
      children.push(sectionHead(subs.length ? 'Другие задачи цели' : 'Задачи', [{ icon: 'plus', label: 'Задача', onClick: () => editTask(null, { goalId: id }) }]));
      children.push(taskList(direct, data, { goalId: id }));

      // Привычки
      children.push(sectionHead('Привычки цели', [{ icon: 'plus', label: 'Привычка', onClick: () => editHabit(null, { goalId: id, color }) }]));
      if (!habits.length) children.push(h('div', { class: 'hint' }, 'Привяжите привычки, которые приближают вас к цели, например регулярные тренировки.'));
      else children.push(h('div', { class: 'card list' }, habits.map((hb) => habitMini(hb, data))));

      children.push(h('div', { class: 'pad-bottom' }));
      return layerScreen({
        title: goal.title, backLabel: 'Цели', onBack: () => api.close(),
        actions: [h('button', { class: 'nav-btn', 'aria-label': 'Изменить', onclick: () => editGoal(goal) }, ic('edit', 21))],
        children,
      });
    },
  });
}

const stat = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));
export const sectionHead = (title, actions = []) => h('div', { class: 'sec-head' }, h('h3', null, title), h('div', { class: 'sec-actions' }, actions.map((a) => h('button', { class: 'sec-btn', onclick: a.onClick }, ic(a.icon, 16), a.label))));

function sortTasks(list) {
  return [...list].sort((a, b) => (a.done - b.done) || (a.date || '9999').localeCompare(b.date || '9999') || (b.priority || 0) - (a.priority || 0) || (a.createdAt || 0) - (b.createdAt || 0));
}
export function taskList(list, data, { goalId } = {}) {
  const visible = list.filter((t) => !t.done || isTaskInCompletionWindow(t.id));
  if (!visible.length) return h('div', { class: 'hint' }, 'Пока нет задач.');
  return h('div', { class: 'card list' }, sortTasks(visible).map((t) => taskRow(t, data, { showGoal: false })));
}

function subBlock(sub, data, parentColor, api) {
  const p = goalProgress(sub, data);
  const tasks = data.tasks.filter((t) => t.goalId === sub.id);
  const color = sub.color || parentColor;
  const collapsed = expandedBlocks.has(sub.id);
  return h('div', { class: 'card sub-block', style: { '--c': cv(color) } },
    h('div', { class: 'sub-head', onclick: () => { collapsed ? expandedBlocks.delete(sub.id) : expandedBlocks.add(sub.id); api.refresh(); } },
      ring({ key: 'sb' + sub.id, pct: p.pct, size: 40, stroke: 12, color, center: h('span', { class: 'ring-pct sm' }, Math.round(p.pct * 100)) }),
      h('div', { class: 'sub-info' }, h('b', null, `${sub.emoji || '•'} ${sub.title}`), h('span', null, progressLabel(p))),
      h('button', { class: 'icon-btn', 'aria-label': 'Изменить подцель', onclick: (e) => { e.stopPropagation(); editGoal(sub); } }, ic('edit', 18)),
      h('span', { class: 'chev' + (collapsed ? '' : ' open') }, ic('chevD', 18))),
    collapsed ? null : h('div', { class: 'sub-body' },
      sub.progressMode === 'metric' ? metricCard(sub, color, true) : null,
      tasks.some((t) => !t.done || isTaskInCompletionWindow(t.id))
        ? sortTasks(tasks.filter((t) => !t.done || isTaskInCompletionWindow(t.id))).map((t) => taskRow(t, data, { showGoal: false }))
        : h('div', { class: 'hint tight' }, 'В этой подцели пока нет активных задач.'),
      h('button', { class: 'add-row', onclick: () => editTask(null, { goalId: sub.id }) }, ic('plus', 18), 'Добавить задачу')));
}

function habitMini(hb, data) {
  const st = habitStreaks(hb, data.idx, todayStr(), S.settings().weekStart);
  const rate = habitRate(hb, data.idx, todayStr(), 30, S.settings().weekStart);
  const doneToday = habitDone(data.idx, hb, todayStr());
  return h('div', { class: 'habit-mini', onclick: () => openHabitDetail(hb.id) },
    h('div', { class: 'hm-emoji', style: { '--c': cv(hb.color || 'green') } }, hb.emoji || '•'),
    h('div', { class: 'hm-main' }, h('b', null, hb.title), h('span', null, rate == null ? 'Только начали' : `${Math.round(rate * 100)}% за 30 дней`)),
    st.current ? h('span', { class: 'streak-badge' }, ic('flame', 14), st.current + (st.unit === 'week' ? ' нед' : '')) : null,
    doneToday ? h('span', { class: 'ok-dot' }, ic('check', 14)) : null);
}

// ---------- Метрика ----------
function sparkline(history, color) {
  if (!history || history.length < 2) return null;
  const vals = history.map((x) => x.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const W = 280, H = 48, pad = 4;
  const pts = vals.map((v, i) => [pad + (i * (W - pad * 2)) / (vals.length - 1), H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z`;
  const last = pts[pts.length - 1];
  return h('svg:svg', { viewBox: `0 0 ${W} ${H}`, class: 'spark' },
    h('svg:path', { d: area, class: 'spark-area' }), h('svg:path', { d, class: 'spark-line' }), h('svg:circle', { cx: last[0], cy: last[1], r: 3.5, class: 'spark-dot' }));
}
function metricCard(goal, color, inline = false) {
  const m = goal.metric || { start: 0, target: 100, current: 0 };
  const p = goalProgress(goal, S.data());
  return h('div', { class: (inline ? 'metric inline' : 'card metric') , style: { '--c': cv(color) } },
    h('div', { class: 'metric-top' },
      h('div', { class: 'metric-val' }, h('b', null, fmtNum(m.current)), h('span', null, ` / ${fmtNum(m.target)}${m.unit ? ' ' + m.unit : ''}`)),
      h('button', { class: 'btn-tint', onclick: () => openMetricUpdate(goal) }, ic('plus', 16), 'Обновить')),
    progressBar({ pct: p.pct, color }),
    sparkline(m.history, color));
}
function openMetricUpdate(goal) {
  const m = goal.metric || { start: 0, target: 100, current: 0 };
  let value = m.current;
  openSheet({
    title: 'Обновить значение', left: { label: 'Отмена' }, right: { label: 'Готово', bold: true, onClick: (api) => {
      S.upsert('goals', { id: goal.id, metric: { ...m, current: value, history: [...(m.history || []), { date: todayStr(), value }].slice(-60) } });
      api.close(true);
      toast('Значение обновлено');
    } },
    build(api) {
      const step = Math.abs(m.target - m.start) >= 1000 ? 1000 : Math.abs(m.target - m.start) >= 100 ? 10 : 1;
      const inp = numberInput(value, (v) => (value = v == null ? m.start : v), { width: '140px' });
      api.body.append(
        group(row(`Текущее значение${m.unit ? ', ' + m.unit : ''}`, inp)),
        h('div', { class: 'quick-steps' },
          [-step * 5, -step, step, step * 5].map((d) => h('button', { class: 'btn-tint', onclick: () => { value = Math.round((Number(value) + d) * 100) / 100; inp.value = value; } }, (d > 0 ? '+' : '−') + fmtNum(Math.abs(d))))),
        h('div', { class: 'sheet-pad' }));
    },
  });
}
