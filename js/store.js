// Хранилище: единое состояние, сохранение в localStorage, подписки, мягкое удаление (для отмены и синхронизации).
import { uid, ymd } from './util.js';
import { buildLogIndex, pickNewer } from './logic.js';

const KEY = 'rhythm.v1';
const LOCAL_THEME_KEY = 'rhythm.device.theme';
const THEMES = ['auto', 'light', 'dark'];
let deviceTheme = null;
let storageKey = KEY;
const accountKey = (userId) => userId ? `${KEY}.account.${userId}` : KEY;
export const DEFAULT_CALENDAR_ID = 'calendar-default';
export const KINDS = ['goals', 'tasks', 'events', 'eventPresets', 'habits', 'logs', 'calendars'];

function ensureCalendarState(s) {
  if (!Array.isArray(s.calendars)) s.calendars = [];
  if (!s.dirty) s.dirty = {};
  const now = Date.now();
  let base = s.calendars.find((calendar) => calendar.id === DEFAULT_CALENDAR_ID);
  if (!base) {
    base = { id: DEFAULT_CALENDAR_ID, name: 'Личный календарь', color: 'blue', isDefault: true, visible: true, createdAt: now, updatedAt: now };
    s.calendars.push(base);
    s.dirty[`calendars:${DEFAULT_CALENDAR_ID}`] = 1;
  } else if (base.deleted) {
    base.deleted = false;
    base.updatedAt = now;
    s.dirty[`calendars:${DEFAULT_CALENDAR_ID}`] = 1;
  } else {
    base.isDefault = true;
    if (!base.name) base.name = 'Личный календарь';
    if (!base.color) base.color = 'blue';
    if (base.visible == null) base.visible = true;
  }
  for (const event of s.events || []) {
    if (event.deleted) continue;
    let changed = false;
    if (!event.calendarId) { event.calendarId = DEFAULT_CALENDAR_ID; changed = true; }
    // Старые события сохраняют свой прежний цвет; новые по умолчанию наследуют цвет календаря.
    if (event.colorOverride == null) { event.colorOverride = true; changed = true; }
    if (changed) {
      event.updatedAt = Math.max(event.updatedAt || 0, now);
      s.dirty[`events:${event.id}`] = 1;
    }
  }
}

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
  goals: [], tasks: [], events: [], eventPresets: [], habits: [], logs: [], calendars: [],
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
      ensureCalendarState(merged);
      return merged;
    }
  } catch (e) {
    console.warn('Не удалось прочитать данные', e);
  }
  const fresh = emptyState();
  ensureCalendarState(fresh);
  return fresh;
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
    calendars: live(state.calendars),
    eventPresets: live(state.eventPresets),
    settings: state.settings,
  };
  snap.idx = buildLogIndex(snap.logs);
  return snap;
}
export const settings = () => state.settings;

/** Тема интерфейса хранится отдельно от профиля и облачных настроек. */
export function localTheme() {
  if (deviceTheme !== null) return deviceTheme;

  let stored = null;
  let canPersist = false;
  try {
    stored = localStorage.getItem(LOCAL_THEME_KEY);
    canPersist = true;
  } catch (_) { /* localStorage может быть недоступен в приватном режиме */ }

  if (THEMES.includes(stored)) {
    deviceTheme = stored;
  } else {
    // Однократно переносим старую тему из локальных настроек этого устройства.
    deviceTheme = THEMES.includes(state.settings.theme) ? state.settings.theme : 'auto';
    try {
      localStorage.setItem(LOCAL_THEME_KEY, deviceTheme);
      canPersist = true;
    } catch (_) { canPersist = false; }
  }

  // Удаляем legacy-поле только после того, как локальная копия надёжно записана.
  if (canPersist && Object.prototype.hasOwnProperty.call(state.settings, 'theme')) {
    delete state.settings.theme;
    save();
  }
  return deviceTheme;
}

export function setLocalTheme(theme) {
  deviceTheme = THEMES.includes(theme) ? theme : 'auto';
  try { localStorage.setItem(LOCAL_THEME_KEY, deviceTheme); } catch (_) { /* используем значение в памяти до перезапуска */ }
  if (Object.prototype.hasOwnProperty.call(state.settings, 'theme')) {
    delete state.settings.theme;
    save();
  }
  return deviceTheme;
}

const syncableSettings = () => {
  const { theme: _localOnlyTheme, ...shared } = state.settings;
  return shared;
};

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
  if (!t || !!t.done === !!done) return null;
  const previous = { done: !!t.done, doneAt: t.doneAt ?? null };
  const doneAt = done ? Date.now() : null;
  upsert('tasks', { id, done: !!done, doneAt });
  return done ? { id, previous, doneAt } : null;
}

/** Отменить конкретное выполнение, не затрагивая более поздние изменения задачи. */
export function undoTaskDone(token) {
  if (!token) return false;
  const t = find('tasks', token.id);
  if (!t || !t.done || t.doneAt !== token.doneAt) return false;
  upsert('tasks', { id: token.id, done: token.previous.done, doneAt: token.previous.doneAt });
  return true;
}

export function setLog(habitId, date, value) {
  upsert('logs', { id: `${habitId}|${date}`, habitId, date, value: Math.max(0, value) });
}

export function setSettings(patch) {
  localTheme();
  const sharedPatch = { ...patch };
  delete sharedPatch.theme; // тема устройства никогда не записывается в профиль
  state.settings = { ...state.settings, ...sharedPatch, updatedAt: Date.now() };
  delete state.settings.theme;
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
    if (kind === 'settings') out.push({ kind, id: 'main', data: syncableSettings(), key });
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
      // Сохраняем старую локальную тему до чтения настроек с сервера.
      localTheme();
      if ((rec.updatedAt || 0) > (state.settings.updatedAt || 0)) {
        const shared = { ...rec };
        delete shared.theme;
        state.settings = { ...defaultSettings(), ...shared };
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
  if (changed) { ensureCalendarState(state); commit(); }
  return changed;
}

// ---------- Экспорт / импорт ----------
export function exportJSON() {
  const { goals, tasks, events, eventPresets, habits, logs, calendars } = state;
  return JSON.stringify({ app: 'rhythm', version: 1, exportedAt: new Date().toISOString(), goals, tasks, events, eventPresets, habits, logs, calendars, settings: syncableSettings() }, null, 2);
}
export function importJSON(text, { replace = true } = {}) {
  const obj = JSON.parse(text);
  if (obj.app !== 'rhythm') throw new Error('Это не резервная копия «Ритма»');
  if (replace) {
    // Существующие данные помечаем удалёнными; базовый календарь сохраняем для старых резервных копий.
    for (const k of KINDS) for (const r of state[k]) {
      if (!r.deleted && !(k === 'calendars' && r.id === DEFAULT_CALENDAR_ID)) {
        r.deleted = true; r.updatedAt = Date.now(); state.dirty[`${k}:${r.id}`] = 1;
      }
    }
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
  ensureCalendarState(state);
  commit();
}
/** Стереть все данные. Записи помечаются удалёнными, чтобы очистка дошла и до других устройств. */
export function resetAll() {
  const now = Date.now();
  for (const k of KINDS) for (const r of state[k]) {
    if (!r.deleted && !(k === 'calendars' && r.id === DEFAULT_CALENDAR_ID)) {
      r.deleted = true; r.updatedAt = now; state.dirty[`${k}:${r.id}`] = 1;
    }
  }
  state.timers = {};
  const baseCalendar = state.calendars.find((calendar) => calendar.id === DEFAULT_CALENDAR_ID);
  if (baseCalendar) {
    Object.assign(baseCalendar, { name: 'Личный календарь', color: 'blue', visible: true, isDefault: true, deleted: false, updatedAt: now });
    state.dirty[`calendars:${DEFAULT_CALENDAR_ID}`] = 1;
  }
  if (state.settings.calFilters?.calendarId) {
    state.settings = { ...state.settings, calFilters: { ...state.settings.calFilters, calendarId: null }, updatedAt: now };
    state.dirty['settings:main'] = 1;
  }
  commit();
}
export function replaceAllWith(newState) {
  localTheme();
  const nextSettings = { ...defaultSettings(), ...(newState.settings || {}) };
  delete nextSettings.theme;
  state = { ...emptyState(), ...newState, settings: nextSettings };
  ensureCalendarState(state);
  commit();
}

/** Переключить локальный профиль. Данные разных аккаунтов хранятся отдельно. */
export function switchAccount(userId = null) {
  flush();
  storageKey = accountKey(userId);
  state = load(storageKey);
  // На первом запуске переносим тему именно из выбранного аккаунта,
  // до возможного объединения гостевых настроек.
  localTheme();
  delete state.settings.theme;
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
  localTheme();
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
    if (deviceTheme !== null) delete account.settings.theme;
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
