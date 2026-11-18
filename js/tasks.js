// Экран «Задачи»: умные списки, поиск, группировка по целям.
import { h, todayStr, addDays, plural, clear } from './util.js';
import * as S from './store.js';
import { ic, cv, emptyState, actionSheet, toast } from './ui.js';
import { screen, navBtn } from './shell.js';
import { taskRow, goalColorOf, goalPath } from './components.js';
import { editTask } from './editors.js';
import { view } from './nav.js';
import { isTaskInCompletionWindow } from './task-completion.js';

export const FILTERS = [
  { v: 'today', label: 'Сегодня', icon: 'sun', color: 'blue' },
  { v: 'upcoming', label: 'План', icon: 'calendar', color: 'red' },
  { v: 'inbox', label: 'Без даты', icon: 'calendar', color: 'indigo' },
  { v: 'overdue', label: 'Просрочено', icon: 'flag', color: 'orange' },
  { v: 'all', label: 'Все', icon: 'list', color: 'green' },
  { v: 'done', label: 'Выполнено', icon: 'check', color: 'mint' },
];

export function filterTasks(tasks, f, today = todayStr()) {
  switch (f) {
    case 'today': return tasks.filter((t) => (!t.done || isTaskInCompletionWindow(t.id)) && t.date === today);
    case 'upcoming': return tasks.filter((t) => (!t.done || isTaskInCompletionWindow(t.id)) && t.date && t.date > today);
    case 'inbox': return tasks.filter((t) => (!t.done || isTaskInCompletionWindow(t.id)) && !t.date);
    case 'overdue': return tasks.filter((t) => (!t.done || isTaskInCompletionWindow(t.id)) && t.date && t.date < today);
    case 'done': return tasks.filter((t) => t.done);
    default: return tasks.filter((t) => !t.done || isTaskInCompletionWindow(t.id));
  }
}
export const countFor = (tasks, f, today = todayStr()) => filterTasks(tasks, f, today).length;

const byOrder = (a, b) => (a.time || '99').localeCompare(b.time || '99') || (b.priority || 0) - (a.priority || 0) || (a.createdAt || 0) - (b.createdAt || 0);

let query = '';

export function tasksScreen() {
  const data = S.data();
  const today = todayStr();
  const f = view.tasksFilter;
  const counts = Object.fromEntries(FILTERS.map((x) => [x.v, f === 'done' && x.v === 'done' ? countFor(data.tasks, 'done') : countFor(data.tasks, x.v)]));

  const tiles = h('div', { class: 'smart-grid rise', style: { '--i': 0 } }, FILTERS.map((x) => h('button', {
    class: 'smart-tile' + (f === x.v ? ' on' : ''), style: { '--c': cv(x.color) }, onclick: () => { view.tasksFilter = x.v; query = ''; document.dispatchEvent(new CustomEvent('rerender')); },
  }, h('span', { class: 'smart-ic' }, ic(x.icon, 18)), h('b', null, counts[x.v]), h('span', { class: 'smart-label' }, x.label))));

  const search = h('div', { class: 'search rise', style: { '--i': 1 } }, ic('search', 18), (() => {
    const inp = h('input', { type: 'search', placeholder: 'Поиск по задачам', value: query, oninput: (e) => { query = e.target.value; renderList(); } });
    return inp;
  })());

  const listHost = h('div', { class: 'task-groups' });
  function renderList() {
    clear(listHost);
    let list = query.trim() ? data.tasks.filter((t) => (f === 'done' ? t.done : (!t.done || isTaskInCompletionWindow(t.id))) && (t.title.toLowerCase().includes(query.trim().toLowerCase()) || (t.notes || '').toLowerCase().includes(query.trim().toLowerCase()))) : filterTasks(data.tasks, f);
    const title = FILTERS.find((x) => x.v === f).label;
    if (!list.length) {
      listHost.appendChild(emptyState({
        emoji: query ? '🔍' : f === 'done' ? '🏁' : f === 'overdue' ? '🌤️' : '✅',
        title: query ? 'Ничего не найдено' : f === 'overdue' ? 'Всё вовремя' : f === 'done' ? 'Пока ничего не выполнено' : 'Здесь пусто',
        text: query ? 'Попробуйте другой запрос.' : f === 'today' ? 'На сегодня задач нет. Добавьте новую или запланируйте задачи без даты.' : undefined,
        action: !query && f !== 'done' && f !== 'overdue' ? { label: 'Новая задача', onClick: () => editTask(null, f === 'today' ? { date: today } : {}) } : null,
      }));
      return;
    }
    if (f === 'upcoming' || f === 'overdue' || f === 'done' || query) {
      // по дате
      const sorted = [...list].sort((a, b) => (f === 'done' ? (b.doneAt || 0) - (a.doneAt || 0) : (a.date || '9999').localeCompare(b.date || '9999') || byOrder(a, b)));
      listHost.appendChild(h('div', { class: 'card list rise' }, sorted.map((t) => taskRow(t, data))));
      return;
    }
    // группировка по целям
    const groups = new Map();
    for (const t of list) {
      const key = t.goalId ? (goalPath(data, t.goalId) || {}).goal?.parentId || t.goalId : 'none';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    const keys = [...groups.keys()].sort((a, b) => (a === 'none') - (b === 'none'));
    keys.forEach((k, gi) => {
      const g = k === 'none' ? null : data.goals.find((x) => x.id === k);
      listHost.appendChild(h('div', { class: 'group-head rise', style: { '--i': gi, '--c': cv(g ? g.color || 'blue' : 'indigo') } },
        h('span', { class: 'gh-dot' }), h('b', null, g ? `${g.emoji || '🎯'} ${g.title}` : f === 'inbox' ? 'Без цели' : 'Без цели'), h('span', { class: 'dim' }, groups.get(k).length)));
      listHost.appendChild(h('div', { class: 'card list rise', style: { '--i': gi } }, groups.get(k).sort(byOrder).map((t) => taskRow(t, data, { showGoal: !!t.goalId && (goalPath(data, t.goalId) || {}).parent != null, showDate: f !== 'today' }))));
    });
  }
  renderList();

  return screen({
    id: 'tasks', title: 'Задачи', eyebrow: `${counts.today} на сегодня · ${counts.all} всего`,
    actions: [
      ...(f === 'done' && counts.done > 0 ? [navBtn('trash', 'Очистить выполненные', () => {
        const count = S.data().tasks.filter((t) => t.done).length;
        if (!count) return;
        actionSheet({
          title: 'Очистить «Выполнено»?',
          message: `Будут удалены все выполненные задачи (${count}), в том числе привязанные к целям. Прогресс таких целей пересчитается.`,
          actions: [{
            label: 'Удалить все выполненные',
            danger: true,
            onClick: () => {
              const completed = S.data().tasks.filter((t) => t.done);
              if (!completed.length) return;
              S.applyChanges(completed.map((t) => ({ kind: 'tasks', rec: { ...t, deleted: true } })));
              toast('Выполненные задачи удалены');
            },
          }],
        });
      })] : []),
      navBtn('plus', 'Новая задача', () => editTask(null, f === 'today' ? { date: today } : {})),
    ],
    children: [tiles, search, listHost],
  });
}
