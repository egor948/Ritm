// Хранилище: единое состояние, сохранение в localStorage, подписки, мягкое удаление (для отмены и синхронизации).
import { uid, ymd } from './util.js';
import { buildLogIndex, pickNewer } from './logic.js';

const KEY = 'rhythm.v1';
let storageKey = KEY;
const accountKey = (userId) => userId ? `${KEY}.account.${userId}` : KEY;
export const KINDS = ['goals', 'tasks', 'events', 'habits', 'logs'];

export const DEFAULT_WIDGETS = [
  { id: 'day', on: true },
  { id: 'next', on: true },
  { id: 'habits', on: true },
  { id: 'agenda', on: true },
  { id: 'tasks', on: true },
  { id: 'goals', on: true },
  { id: 'week', on: true },
  { id: 'streak', on: true },
  { id: 'overdue', on: true },
];

const defaultSettings = () => ({
  theme: 'auto', // auto | light | dark
  weekStart: 1, // 1 = понедельник
  calView: 'day',
  calFilters: { events: true, tasks: true, habits: true, goals: true },
  widgets: DEFAULT_WIDGETS.map((w) => ({ ...w })),
  defaultRemindAt: '09:00',
  notifyTasks: true,
  notifyEvents: true,
  onboarded: false,
  updatedAt: 0,
});

const emptyState = () => ({
  v: 1,
  goals: [], tasks: [], events: [], habits: [], logs: [],
  settings: defaultSettings(),
  dirty: {}, // 'kind:id' → 1, ожидают отправки на сервер
  sync: { cursor: null, lastSyncAt: 0 },
  timers: {}, // habitId → время старта (мс), только на устройстве
});

function load(key = storageKey) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const s = JSON.parse(raw);
      const base = emptyState();
      const merged = { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) } };
      // новые виджеты, появившиеся после обновления, добавляем в конец
      const have = new Set(merged.settings.widgets.map((w) => w.id));
      for (const w of DEFAULT_WIDGETS) if (!have.has(w.id)) merged.settings.widgets.push({ ...w });
      return merged;
    }
  } catch (e) {
    console.warn('Не удалось прочитать данные', e);
  }
  return emptyState();
}

let state = load();
const subs = new Set();
let snap = null;
let notifyQueued = false;
let saveTimer = null;

export const subscribe = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch (e) {
    console.warn('Не удалось сохранить данные', e);
  }
}
export function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  save();
}
function commit() {
  snap = null;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 120);
  if (!notifyQueued) {
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      for (const fn of [...subs]) {
        try { fn(); } catch (e) { console.error(e); }
      }
    });
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  window.addEventListener('pagehide', flush);
}

const live = (a) => a.filter((x) => !x.deleted);

/** Снимок «живых» данных + индекс логов привычек. Пересобирается при изменениях. */
export function data() {
  if (snap) return snap;
  snap = {
    goals: live(state.goals),
    tasks: live(state.tasks),
    events: live(state.events),
    habits: live(state.habits),
    logs: live(state.logs),
    settings: state.settings,
  };
  snap.idx = buildLogIndex(snap.logs);
  return snap;
}
export const settings = () => state.settings;
export const raw = () => state;
export const find = (kind, id) => state[kind].find((x) => x.id === id && !x.deleted) || null;

// ---------- Изменения ----------

/** Применить пачку изменений; вернёт обратную пачку для отмены. */
export function applyChanges(changes) {
  const inverse = [];
  const now = Date.now();
  for (const { kind, rec } of changes) {
    const arr = state[kind];
    const i = arr.findIndex((x) => x.id === rec.id);
    inverse.push({ kind, rec: i >= 0 ? { ...arr[i] } : { id: rec.id, deleted: true } });
    const next = { ...rec, updatedAt: now };
    if (i >= 0) arr[i] = next; else arr.push(next);
    state.dirty[`${kind}:${rec.id}`] = 1;
  }
  commit();
  return inverse;
}

export function upsert(kind, obj) {
  const arr = state[kind];
  const cur = obj.id ? arr.find((x) => x.id === obj.id) : null;
  const rec = cur ? { ...cur, ...obj, deleted: false } : { createdAt: Date.now(), ...obj, id: obj.id || uid() };
  applyChanges([{ kind, rec }]);
  return rec;
}

export function remove(kind, id) {
  const cur = state[kind].find((x) => x.id === id);
  if (!cur) return [];
  return applyChanges([{ kind, rec: { ...cur, deleted: true } }]);
}

/** Удаление цели: подцели и их задачи удаляются, привычки остаются без цели. */
export function removeGoal(id) {
  const changes = [];
  const sub = state.goals.filter((g) => !g.deleted && g.parentId === id).map((g) => g.id);
  const ids = new Set([id, ...sub]);
  for (const g of state.goals) if (!g.deleted && ids.has(g.id)) changes.push({ kind: 'goals', rec: { ...g, deleted: true } });
  for (const t of state.tasks) if (!t.deleted && ids.has(t.goalId)) changes.push({ kind: 'tasks', rec: { ...t, deleted: true } });
  for (const h of state.habits) if (!h.deleted && ids.has(h.goalId)) changes.push({ kind: 'habits', rec: { ...h, goalId: null } });
  return applyChanges(changes);
}

export const undo = (inverse) => applyChanges(inverse);

export function setTaskDone(id, done) {
  const t = find('tasks', id);
  if (!t) return;
  upsert('tasks', { id, done, doneAt: done ? Date.now() : null });
}

export function setLog(habitId, date, value) {
  upsert('logs', { id: `${habitId}|${date}`, habitId, date, value: Math.max(0, value) });
}

export function setSettings(patch) {
  state.settings = { ...state.settings, ...patch, updatedAt: Date.now() };
  state.dirty['settings:main'] = 1;
  commit();
}

// ---------- Таймеры привычек (только на устройстве) ----------
export const timers = () => state.timers;
export function startTimer(habitId) {
  state.timers[habitId] = Date.now();
  commit();
}
/** Останавливает таймер, возвращает прошедшие минуты (округление вверх). */
export function stopTimer(habitId) {
  const t = state.timers[habitId];
  delete state.timers[habitId];
  commit();
  return t ? Math.max(1, Math.ceil((Date.now() - t) / 60000)) : 0;
}

// ---------- Синхронизация ----------
export const syncMeta = () => state.sync;
export function setSyncMeta(patch) {
  state.sync = { ...state.sync, ...patch };
  save();
}
export function dirtyEntries() {
  const out = [];
  for (const key of Object.keys(state.dirty)) {
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    if (kind === 'settings') out.push({ kind, id: 'main', data: state.settings, key });
    else {
      const rec = state[kind] && state[kind].find((x) => x.id === id);
      if (rec) out.push({ kind, id, data: rec, key, updatedAt: rec.updatedAt });
    }
  }
  return out;
}
export function clearDirty(entries) {
  for (const e of entries) {
    const cur = e.kind === 'settings' ? state.settings : state[e.kind].find((x) => x.id === e.id);
    if (!cur || cur.updatedAt === e.data.updatedAt) delete state.dirty[e.key];
  }
  save();
}
export function markAllDirty() {
  for (const k of KINDS) for (const r of state[k]) state.dirty[`${k}:${r.id}`] = 1;
  state.dirty['settings:main'] = 1;
  save();
}
/** Принять записи с сервера. Побеждает более свежая правка. Возвращает число обновлённых записей. */
export function applyRemote(rows) {
  let changed = 0;
  for (const row of rows) {
    const rec = row.data;
    if (!rec) continue;
    if (row.kind === 'settings') {
      if ((rec.updatedAt || 0) > (state.settings.updatedAt || 0)) {
        state.settings = { ...defaultSettings(), ...rec };
        changed++;
      }
      continue;
    }
    const arr = state[row.kind];
    if (!arr) continue;
    const i = arr.findIndex((x) => x.id === rec.id);
    const local = i >= 0 ? arr[i] : null;
    const win = pickNewer(local, rec);
    if (win === rec && win !== local) {
      if (i >= 0) arr[i] = rec; else arr.push(rec);
      delete state.dirty[`${row.kind}:${rec.id}`];
      changed++;
    }
  }
  if (changed) commit();
  return changed;
}

// ---------- Экспорт / импорт ----------
export function exportJSON() {
  const { goals, tasks, events, habits, logs, settings: st } = state;
  return JSON.stringify({ app: 'rhythm', version: 1, exportedAt: new Date().toISOString(), goals, tasks, events, habits, logs, settings: st }, null, 2);
}
export function importJSON(text, { replace = true } = {}) {
  const obj = JSON.parse(text);
  if (obj.app !== 'rhythm') throw new Error('Это не резервная копия «Ритма»');
  if (replace) {
    // помечаем существующие как удалённые, чтобы синхронизация сняла их и на других устройствах
    for (const k of KINDS) for (const r of state[k]) if (!r.deleted) { r.deleted = true; r.updatedAt = Date.now(); state.dirty[`${k}:${r.id}`] = 1; }
  }
  const now = Date.now();
  for (const k of KINDS) {
    for (const r of obj[k] || []) {
      const i = state[k].findIndex((x) => x.id === r.id);
      const rec = { ...r, deleted: !!r.deleted, updatedAt: now };
      if (i >= 0) state[k][i] = rec; else state[k].push(rec);
      state.dirty[`${k}:${r.id}`] = 1;
    }
  }
  if (obj.settings) setSettings({ ...obj.settings });
  commit();
}
/** Стереть все данные. Записи помечаются удалёнными, чтобы очистка дошла и до других устройств. */
export function resetAll() {
  const now = Date.now();
  for (const k of KINDS) for (const r of state[k]) if (!r.deleted) { r.deleted = true; r.updatedAt = now; state.dirty[`${k}:${r.id}`] = 1; }
  state.timers = {};
  commit();
}
export function replaceAllWith(newState) {
  state = { ...emptyState(), ...newState, settings: { ...defaultSettings(), ...(newState.settings || {}) } };
  commit();
}

/** Переключить локальный профиль. Данные разных аккаунтов хранятся отдельно. */
export function switchAccount(userId = null) {
  flush();
  storageKey = accountKey(userId);
  state = load(storageKey);
  snap = null;
  commit();
  flush();
  return { userId: userId || null };
}


/** Удаляет локальные данные и резервные копии удалённого аккаунта на этом устройстве. */
export function clearAccountStorage(userId) {
  if (!userId) return;
  flush();
  const prefix = `${KEY}.account.${userId}`;
  const backupPrefix = `${KEY}.backup.${userId}.`;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key === prefix || key === `${KEY}.merged.${userId}` || key.startsWith(backupPrefix)) localStorage.removeItem(key);
  }
}

/**
 * Однократно объединить гостевые данные с текущим аккаунтом.
 * Сначала сохраняется полный backup обоих хранилищ; при ошибке backup объединение не выполняется.
 */
export function mergeGuestIntoCurrent(userId) {
  if (!userId) throw new Error('Не указан аккаунт для объединения');
  const marker = `${KEY}.merged.${userId}`;
  if (localStorage.getItem(marker) === '1') return { merged: false, alreadyDone: true };
  flush();
  const guest = load(KEY);
  const account = state;
  const backup = {
    app: 'rhythm-merge-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    userId,
    guest,
    account,
  };
  // Если backup нельзя сохранить, не начинаем операцию слияния.
  localStorage.setItem(`${KEY}.backup.${userId}.${Date.now()}`, JSON.stringify(backup));

  let mergedCount = 0;
  for (const kind of KINDS) {
    for (const incoming of guest[kind] || []) {
      const index = account[kind].findIndex((item) => item.id === incoming.id);
      const current = index >= 0 ? account[kind][index] : null;
      const winner = pickNewer(current, incoming);
      if (winner === incoming && winner !== current) {
        if (index >= 0) account[kind][index] = { ...incoming };
        else account[kind].push({ ...incoming });
        account.dirty[`${kind}:${incoming.id}`] = 1;
        mergedCount++;
      }
    }
  }
  if ((guest.settings?.updatedAt || 0) > (account.settings?.updatedAt || 0)) {
    account.settings = { ...defaultSettings(), ...guest.settings };
    account.dirty['settings:main'] = 1;
    mergedCount++;
  }
  // Таймеры не синхронизируются и не переносятся между профилями.
  state = account;
  commit();
  flush();
  localStorage.setItem(marker, '1');
  return { merged: true, count: mergedCount };
}

export const todayKey = () => ymd(new Date());
