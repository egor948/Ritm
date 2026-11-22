// Общие компоненты экранов: строки задач, кружки привычек, прогресс-бары.
import { h, todayStr, fmtDateSmart, diffDays, fmtDuration, plural, pct as pctOf } from './util.js';
import * as S from './store.js';
import { goalProgress, habitDone, habitValue, habitTarget, habitStreaks } from './logic.js';
import { ic, cv, checkbox, burst, toast, ring } from './ui.js';
import { editTask } from './editors.js';
import { beginTaskCompletion, cancelTaskCompletion, isTaskExitStarted } from './task-completion.js';
import { withTaskSwipe } from './task-swipe.js';

const taskUndoToasts = new Map();

let popId = null; // элемент, которому нужно проиграть анимацию отметки при следующем рендере

export const goalById = (data, id) => data.goals.find((g) => g.id === id) || null;
export function goalColorOf(data, goalId) {
  const g = goalById(data, goalId);
  if (!g) return 'indigo';
  if (g.color) return g.color;
  const p = g.parentId && goalById(data, g.parentId);
  return (p && p.color) || 'blue';
}
export function goalPath(data, goalId) {
  const g = goalById(data, goalId);
  if (!g) return null;
  const p = g.parentId && goalById(data, g.parentId);
  return { goal: g, parent: p, title: p ? `${p.title} › ${g.title}` : g.title, emoji: (p || g).emoji || '🎯' };
}

export const progressBar = ({ pct, color = 'blue', key, cls = '' }) => {
  const fill = h('div', { class: 'bar-fill', style: { width: '0%' } });
  const v = Math.round(Math.max(0, Math.min(1, pct)) * 100);
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = v + '%'; }));
  return h('div', { class: 'bar ' + cls, style: { '--c': cv(color) } }, fill);
};

function clearTaskUndoToast(id) {
  const oldToast = taskUndoToasts.get(id);
  if (oldToast) oldToast.hide();
  taskUndoToasts.delete(id);
}

// ---------- Отметка задачи с эффектами ----------
export function completeTask(task, done, el) {
  const before = new Map();
  const data = S.data();
  const chain = [task.goalId, (goalById(data, task.goalId) || {}).parentId].filter(Boolean);
  for (const gid of chain) { const g = goalById(data, gid); if (g) before.set(gid, goalProgress(g, data).pct); }
  popId = task.id;

  if (!done) {
    cancelTaskCompletion(task.id);
    clearTaskUndoToast(task.id);
    S.setTaskDone(task.id, false);
    return;
  }

  const token = S.setTaskDone(task.id, true);
  if (!token) return;
  beginTaskCompletion(task.id);

  if (el) {
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, [goalColorOf(data, task.goalId), 'yellow', 'white'].map((c) => (c === 'white' ? 'mint' : c)));
  }

  let goalMessage = '';
  const after = S.data();
  for (const gid of chain) {
    const g = goalById(after, gid);
    if (g && (before.get(gid) ?? 0) < 1 && goalProgress(g, after).pct >= 1) {
      goalMessage = `${g.emoji || '🎯'} «${g.title}» — выполнено! Поздравляю 🎉`;
      break;
    }
  }

  const undoToast = toast(goalMessage || 'Задача выполнена', {
    label: 'Отменить',
    onClick: () => {
      if (!S.undoTaskDone(token)) {
        toast('Не удалось отменить: задача уже изменилась');
        return;
      }
      cancelTaskCompletion(task.id);
      taskUndoToasts.delete(task.id);
    },
  });
  taskUndoToasts.set(task.id, undoToast);
  setTimeout(() => {
    if (taskUndoToasts.get(task.id) === undoToast) taskUndoToasts.delete(task.id);
  }, 6500);
}

// ---------- Строка задачи ----------
export function taskRow(task, data, { showGoal = true, showDate = true, compact = false } = {}) {
  const today = todayStr();
  const color = goalColorOf(data, task.goalId);
  const gp = task.goalId ? goalPath(data, task.goalId) : null;
  const overdue = !task.done && task.date && task.date < today;
  const meta = [];
  if (showGoal && gp) meta.push(h('span', { class: 'meta-goal', style: { '--c': cv(color) } }, `${gp.emoji} ${gp.goal.title}`));
  if (showDate && task.date) {
    meta.push(h('span', { class: 'meta' + (overdue ? ' bad' : '') }, ic('calendar', 13), fmtDateSmart(task.date) + (task.time ? `, ${task.time}` : '')));
  } else if (task.time) meta.push(h('span', { class: 'meta' }, ic('clock', 13), task.time));
  if (task.checklist && task.checklist.length) {
    const d = task.checklist.filter((c) => c.done).length;
    meta.push(h('span', { class: 'meta' }, ic('list', 13), `${d}/${task.checklist.length}`));
  }
  if (task.goalId) meta.push(h('span', { class: 'meta weight' }, 'Вес ' + Math.max(1, Math.min(5, Number(task.weight) || 3)) + '/5'));
  if (task.priority) meta.push(h('span', { class: 'meta prio p' + task.priority }, '!'.repeat(task.priority)));
  if ((task.reminderMin != null && task.time) || task.remindAt) meta.push(h('span', { class: 'meta' }, ic('bell', 13)));
  const popNow = popId === task.id;
  if (popNow) popId = null;
  const row = h('div', { class: 'task-row' + (task.done ? ' done' : '') + (compact ? ' compact' : '') + (task.done && isTaskExitStarted(task.id) ? ' task-completion-exit' : ''), 'data-task-id': task.id, 'data-task-done': task.done ? 'true' : 'false', 'data-scroll-anchor': `task:${task.id}`, onclick: () => editTask(task) },
    checkbox({ done: task.done, color, pop: popNow, onToggle: (d, el) => completeTask(task, d, el) }),
    h('div', { class: 'task-main' },
      h('div', { class: 'task-title' }, task.title),
      meta.length ? h('div', { class: 'task-meta' }, meta) : null));
  return withTaskSwipe(task, row, () => {
    clearTaskUndoToast(task.id);
    cancelTaskCompletion(task.id);
  });
}

// ---------- Привычки ----------
export function habitValueLabel(habit, v) {
  if (habit.type === 'check') return v >= 1 ? 'Выполнено' : 'Не выполнено';
  const t = habitTarget(habit);
  return `${v} / ${t}${habit.unit ? ' ' + habit.unit : ''}`;
}

/** Основное действие по тапу на привычку. */
export function habitTap(habit, date, el) {
  const data = S.data();
  const v = habitValue(data.idx, habit, date);
  const target = habitTarget(habit);
  let next = v;
  if (habit.type === 'check') next = v >= 1 ? 0 : 1;
  else if (habit.type === 'count') next = v >= target ? 0 : v + 1;
  else {
    // таймер: старт / стоп (только для сегодняшнего дня)
    const running = S.timers()[habit.id];
    if (date !== todayStr()) next = v >= target ? 0 : target;
    else if (running) next = v + S.stopTimer(habit.id);
    else { S.startTimer(habit.id); return; }
  }
  S.setLog(habit.id, date, next);
  if (next >= target && v < target && el) {
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, [habit.color || 'green', 'yellow', 'mint']);
    const streak = habitStreaks(habit, S.data().idx, todayStr(), S.settings().weekStart).current;
    if (date === todayStr() && streak > 1 && streak % 7 === 0) toast(`🔥 ${streak} ${plural(streak, ['день', 'дня', 'дней'])} подряд: «${habit.title}»`);
  }
}
export function habitAdjust(habit, date, delta) {
  const v = habitValue(S.data().idx, habit, date);
  S.setLog(habit.id, date, Math.max(0, v + delta));
}

/** Круглая «таблетка» привычки для виджетов. */
export function habitChip(habit, data, date, { onLong } = {}) {
  const v = habitValue(data.idx, habit, date);
  const target = habitTarget(habit);
  const done = v >= target;
  const running = habit.type === 'timer' && S.timers()[habit.id] && date === todayStr();
  let timer;
  const chip = h('button', { type: 'button', class: 'hchip' + (done ? ' done' : '') + (running ? ' running' : ''), style: { '--c': cv(habit.color || 'green') } },
    ring({ key: 'hc' + habit.id + date, pct: v / target, size: 52, stroke: 9, color: habit.color || 'green', center: h('span', { class: 'hchip-emoji' }, done ? '✓' : habit.emoji || '•') }),
    h('span', { class: 'hchip-title' }, habit.title),
    habit.type !== 'check' ? h('span', { class: 'hchip-sub' }, `${v}/${target}`) : null);
  let pressed = false;
  chip.addEventListener('pointerdown', () => { pressed = false; timer = setTimeout(() => { pressed = true; onLong && onLong(); }, 450); });
  const cancel = () => clearTimeout(timer);
  chip.addEventListener('pointerup', cancel); chip.addEventListener('pointerleave', cancel); chip.addEventListener('pointercancel', cancel);
  chip.addEventListener('click', () => { if (!pressed) habitTap(habit, date, chip); });
  return chip;
}

export { ring, ic, cv };
