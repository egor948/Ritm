// Подключение внешних календарей Google Calendar. Секретные URL остаются только в форме и на сервере.
import { h, clear, COLOR_KEYS, plural, fmtLong } from './util.js';
import * as S from './store.js';
import * as Sync from './sync.js';
import { openSheet, actionSheet, group, groupTitle, groupNote, row, toggle, textInput, colorPicker, toast, ic, cv } from './ui.js';
import { parseCalendarICS } from './calendar-ics.js';

const state = { subscriptions: [], loading: false, error: '', loadedAt: 0, userId: null };
const listeners = new Set();
const parseCache = new Map();
let loadingPromise = null;
let started = false;
let sessionUserId = null;

const emit = () => {
  for (const fn of listeners) {
    try { fn(); } catch (error) { console.error('External calendar listener:', error); }
  }
};
const changed = () => {
  emit();
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('rerender'));
};
const sessionId = () => Sync.getSession() && Sync.getSession().userId || null;
const externalCalendarId = (id) => 'external-calendar:' + id;
const request = (action, payload = {}) => Sync.invokeFunction('calendar-subscriptions', { action, ...payload });

function replaceSubscription(subscription) {
  if (!subscription || !subscription.id) return;
  const index = state.subscriptions.findIndex((item) => item.id === subscription.id);
  if (index < 0) state.subscriptions = [...state.subscriptions, subscription];
  else state.subscriptions = state.subscriptions.map((item) => item.id === subscription.id ? subscription : item);
  state.loadedAt = Date.now();
  changed();
}

function removeSubscription(id) {
  state.subscriptions = state.subscriptions.filter((item) => item.id !== id);
  parseCache.delete(id);
  state.loadedAt = Date.now();
  if (S.settings().calFilters?.calendarId === externalCalendarId(id)) {
    S.setSettings({ calFilters: { ...(S.settings().calFilters || {}), calendarId: null } });
  }
  changed();
}

export function getExternalSubscriptions() {
  return state.subscriptions.slice();
}

export async function loadExternalSubscriptions(force = false) {
  const userId = sessionId();
  if (!userId) {
    state.subscriptions = [];
    state.userId = null;
    state.loadedAt = 0;
    state.error = '';
    changed();
    return [];
  }
  if (!force && state.userId === userId && state.loadedAt && Date.now() - state.loadedAt < 90000) {
    return state.subscriptions;
  }
  if (loadingPromise) return loadingPromise;

  state.loading = true;
  state.error = '';
  emit();
  loadingPromise = (async () => {
    try {
      const result = await request('list');
      if (sessionId() !== userId) return [];
      state.subscriptions = Array.isArray(result.subscriptions) ? result.subscriptions : [];
      state.userId = userId;
      state.loadedAt = Date.now();
      state.error = '';
      return state.subscriptions;
    } catch (error) {
      if (sessionId() === userId) state.error = error.message || 'Не удалось загрузить внешние календари.';
      return state.subscriptions;
    } finally {
      state.loading = false;
      loadingPromise = null;
      emit();
    }
  })();
  return loadingPromise;
}

export function startExternalCalendars() {
  if (started) return;
  started = true;
  sessionUserId = sessionId();
  if (sessionUserId) loadExternalSubscriptions(true);
  Sync.onChange(() => {
    const nextUserId = sessionId();
    if (nextUserId === sessionUserId) return;
    sessionUserId = nextUserId;
    state.subscriptions = [];
    state.userId = nextUserId;
    state.loadedAt = 0;
    state.error = '';
    parseCache.clear();
    changed();
    if (nextUserId) loadExternalSubscriptions(true);
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && sessionId()) loadExternalSubscriptions(false);
    });
  }
}

function parsedEvents(subscription) {
  const source = String(subscription.calendarData || '');
  if (!source) return [];
  const signature = String(subscription.lastSyncAt || '') + ':' + source.length + ':' + source.slice(0, 96);
  const cached = parseCache.get(subscription.id);
  if (cached && cached.signature === signature) return cached.events;
  try {
    const parsed = parseCalendarICS(source);
    const events = parsed.events.map((event, index) => ({
      ...event,
      id: 'external-event:' + subscription.id + ':' + encodeURIComponent(event.icsUid || String(index)),
      calendarId: externalCalendarId(subscription.id),
      color: subscription.color || 'blue',
      colorOverride: false,
      externalReadOnly: true,
      externalSubscriptionId: subscription.id,
      externalCalendarName: subscription.name || 'Внешний календарь',
    }));
    parseCache.set(subscription.id, { signature, events, warnings: parsed.warnings || [] });
    return events;
  } catch (error) {
    console.warn('Не удалось разобрать внешний календарь:', error);
    parseCache.set(subscription.id, { signature, events: [], warnings: [] });
    return [];
  }
}

export function externalEventsData(data) {
  const subscriptions = state.subscriptions.filter((item) => item && item.id);
  if (!subscriptions.length) return data;
  const calendars = [];
  const events = [];
  for (const subscription of subscriptions) {
    calendars.push({
      id: externalCalendarId(subscription.id),
      name: subscription.name || 'Внешний календарь',
      color: subscription.color || 'blue',
      visible: subscription.visible !== false,
      isExternal: true,
      externalSubscriptionId: subscription.id,
      createdAt: subscription.createdAt || null,
    });
    events.push(...parsedEvents(subscription));
  }
  return {
    ...data,
    calendars: [...(data.calendars || []), ...calendars],
    events: [...(data.events || []), ...events],
  };
}

function eventCount(subscription) {
  return parsedEvents(subscription).length;
}

function statusLabel(subscription) {
  if (!subscription.enabled) return 'Синхронизация приостановлена';
  if (subscription.lastStatus === 'error') return subscription.lastError || 'Ошибка обновления';
  if (subscription.lastStatus === 'ok') return 'Синхронизирован';
  return 'Ожидает первой синхронизации';
}

function shortSyncTime(value) {
  if (!value) return 'Ещё не обновлялся';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Время обновления неизвестно';
  return 'Обновлён ' + date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function selectExternalCalendar(subscription, managerApi, onSelectCalendar) {
  const id = externalCalendarId(subscription.id);
  S.setSettings({
    calFilters: { ...(S.settings().calFilters || {}), calendarId: id },
    calView: 'agenda',
  });
  if (onSelectCalendar) onSelectCalendar(id);
  managerApi.close(true);
  changed();
}

async function refreshSubscription(id) {
  try {
    const result = await request('refresh', { id });
    if (result.subscription) replaceSubscription(result.subscription);
    toast(result.warning || 'Внешний календарь обновлён');
  } catch (error) {
    if (error.payload && error.payload.subscription) replaceSubscription(error.payload.subscription);
    toast((error.payload && error.payload.warning) || error.message || 'Не удалось обновить календарь');
  }
}

async function updateSubscription(id, patch, successMessage) {
  try {
    const result = await request('update', { id, ...patch });
    if (result.subscription) replaceSubscription(result.subscription);
    if (successMessage) toast(successMessage);
    return true;
  } catch (error) {
    toast(error.message || 'Не удалось изменить календарь');
    return false;
  }
}

function openAddSubscription(onSaved) {
  const draft = { name: '', color: 'blue' };
  let nameControl;
  let urlInput;
  let saving = false;
  const save = async (sheet) => {
    if (saving) return;
    const name = String(draft.name || '').trim();
    const secretUrl = String(urlInput.value || '').trim();
    if (!name) { toast('Укажите название календаря'); nameControl.focus(); return; }
    if (!secretUrl) { toast('Вставьте секретную ссылку iCalendar'); urlInput.focus(); return; }

    // Секретную ссылку не сохраняем в состоянии приложения и очищаем поле до сетевого запроса.
    urlInput.value = '';
    saving = true;
    sheet.setRight({ label: 'Подключение…', bold: true });
    try {
      const result = await request('add', { name: name.slice(0, 60), color: draft.color, url: secretUrl });
      if (result.subscription) replaceSubscription(result.subscription);
      await loadExternalSubscriptions(true);
      sheet.close(true);
      if (result.warning) toast('Календарь добавлен, но пока не удалось загрузить его события: ' + result.warning);
      else toast('Внешний календарь подключён');
      if (onSaved) onSaved();
    } catch (error) {
      toast(error.message || 'Не удалось подключить календарь. Проверьте ссылку.');
      sheet.setRight({ label: 'Подключить', bold: true, onClick: save });
    } finally {
      saving = false;
    }
  };

  openSheet({
    title: 'Подключить календарь',
    left: { label: 'Отмена' },
    right: { label: 'Подключить', bold: true, onClick: save },
    tall: true,
    build(api) {
      nameControl = textInput({ value: '', placeholder: 'Например, Семья или Работа', big: true, onInput: (value) => { draft.name = value; } });
      urlInput = h('input', {
        class: 'inp external-calendar-url',
        type: 'url',
        placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics',
        autocomplete: 'off',
        autocapitalize: 'none',
        spellcheck: false,
        inputmode: 'url',
      });
      urlInput.autocomplete = 'off';
      urlInput.spellcheck = false;
      api.body.append(
        groupTitle('Название календаря'),
        group(h('div', { class: 'calendar-editor-name' }, nameControl)),
        groupTitle('Секретная ссылка iCalendar'),
        group(h('div', { class: 'external-calendar-url-wrap' }, urlInput)),
        groupNote('В Google Calendar откройте настройки нужного календаря → «Интеграция календаря» → «Секретный адрес в формате iCal». Ссылка даёт доступ к событиям — не отправляйте её другим людям.'),
        groupTitle('Цвет календаря'),
        group(h('div', { class: 'row' }, colorPicker(draft.color, (value) => { draft.color = value; }))),
        groupNote('События появятся в календаре Ritm отдельно от ваших личных событий.'),
        h('div', { class: 'pad-bottom' }),
      );
      setTimeout(() => nameControl.focus(), 360);
    },
  });
}

function openEditSubscription(subscription, onSaved) {
  const draft = {
    name: subscription.name || '',
    color: subscription.color || 'blue',
    enabled: subscription.enabled !== false,
  };
  let nameControl;
  const save = async (sheet) => {
    const name = String(draft.name || '').trim();
    if (!name) { toast('Укажите название календаря'); nameControl.focus(); return; }
    const ok = await updateSubscription(subscription.id, {
      name: name.slice(0, 60),
      color: draft.color,
      enabled: draft.enabled,
    }, 'Настройки внешнего календаря сохранены');
    if (ok) {
      sheet.close(true);
      if (onSaved) onSaved();
    }
  };
  openSheet({
    title: 'Настроить календарь',
    left: { label: 'Отмена' },
    right: { label: 'Сохранить', bold: true, onClick: save },
    tall: true,
    build(api) {
      nameControl = textInput({ value: draft.name, placeholder: 'Название календаря', big: true, onInput: (value) => { draft.name = value; } });
      api.body.append(
        groupTitle('Название'),
        group(h('div', { class: 'calendar-editor-name' }, nameControl)),
        groupTitle('Цвет'),
        group(h('div', { class: 'row' }, colorPicker(draft.color, (value) => { draft.color = value; }))),
        group(row('Автоматически обновлять', toggle(draft.enabled, (value) => { draft.enabled = value; }))),
        groupNote('При отключении автоматического обновления уже загруженные события останутся в Ritm.'),
        h('button', {
          class: 'row-btn danger calendar-delete-btn',
          type: 'button',
          onclick: () => actionSheet({
            title: 'Удалить внешний календарь?',
            message: 'Его события исчезнут из расписания Ritm. Исходный календарь Google Calendar не изменится.',
            actions: [{
              label: 'Удалить календарь',
              danger: true,
              onClick: async () => {
                try {
                  await request('delete', { id: subscription.id });
                  removeSubscription(subscription.id);
                  api.close(true);
                  if (onSaved) onSaved();
                  toast('Внешний календарь удалён');
                } catch (error) {
                  toast(error.message || 'Не удалось удалить календарь');
                }
              },
            }],
          }),
        }, ic('trash', 17), 'Удалить календарь'),
      );
    },
  });
}

export function openExternalCalendarManager(onChanged, onSelectCalendar) {
  let api;
  let busy = false;
  let unsubscribe = () => {};
  const draw = () => {
    if (!api || !api.body.isConnected) return;
    clear(api.body);
    const subscriptions = state.subscriptions.slice();
    const activeId = S.settings().calFilters?.calendarId || null;

    if (!Sync.getSession()) {
      api.body.append(
        group(h('div', { class: 'external-calendar-empty' }, h('b', null, 'Нужен аккаунт Ritm'), h('span', null, 'Войдите в аккаунт в настройках, чтобы подключать и синхронизировать внешние календари.'))),
      );
      return;
    }

    if (state.loading && !subscriptions.length) {
      api.body.append(group(h('div', { class: 'external-calendar-empty' }, ic('cloud', 25), h('span', null, 'Загружаем внешние календари…'))));
    } else if (state.error && !subscriptions.length) {
      api.body.append(group(h('div', { class: 'external-calendar-error' }, state.error)));
    }

    const rows = subscriptions.map((subscription) => {
      const selected = activeId === externalCalendarId(subscription.id);
      const count = eventCount(subscription);
      const rowNode = h('div', { class: 'external-calendar-row' },
        h('button', {
          type: 'button',
          class: 'external-calendar-open' + (selected ? ' selected' : ''),
          onclick: () => selectExternalCalendar(subscription, api, onSelectCalendar),
        },
          h('i', { class: 'calendar-color-dot', style: { '--c': cv(subscription.color || 'blue') } }),
          h('span', { class: 'external-calendar-copy' },
            h('b', null, subscription.name || 'Без названия'),
            h('small', null, count + ' ' + plural(count, ['событие', 'события', 'событий']) + ' · ' + (subscription.visible === false ? 'Скрыт' : 'Показывается')),
            h('small', { class: 'external-calendar-status' + (subscription.lastStatus === 'error' ? ' error' : '') }, statusLabel(subscription)),
            h('small', { class: 'external-calendar-updated' }, shortSyncTime(subscription.lastSyncAt))),
          selected ? h('span', { class: 'calendar-selected-mark' }, ic('check', 16)) : null),
        h('button', {
          type: 'button',
          class: 'calendar-manage-edit',
          'aria-label': 'Обновить внешний календарь',
          disabled: busy,
          onclick: async () => { if (busy) return; busy = true; draw(); await refreshSubscription(subscription.id); busy = false; draw(); },
        }, ic('repeat', 17)),
        h('button', {
          type: 'button',
          class: 'calendar-manage-edit',
          'aria-label': 'Настроить внешний календарь',
          onclick: () => openEditSubscription(subscription, () => { draw(); if (onChanged) onChanged(); }),
        }, ic('edit', 17)),
        (() => {
          const control = toggle(subscription.visible !== false, (visible) => {
            updateSubscription(subscription.id, { visible }).then((ok) => {
              if (ok) { draw(); if (onChanged) onChanged(); }
            });
          });
          control.setAttribute('aria-label', 'Показывать календарь ' + (subscription.name || ''));
          return control;
        })(),
      );
      return rowNode;
    });

    api.body.append(
      group(
        h('div', { class: 'external-calendar-intro' },
          h('div', { class: 'external-calendar-intro-icon' }, ic('cloud', 21)),
          h('div', null,
            h('b', null, 'Календари Google Calendar'),
            h('span', null, 'События обновляются автоматически каждые 15 минут. Ссылки хранятся на сервере в зашифрованном виде.'))),
      ),
      h('button', {
        type: 'button',
        class: 'btn-primary external-calendar-add',
        onclick: () => openAddSubscription(() => { draw(); if (onChanged) onChanged(); }),
      }, ic('plus', 17), 'Подключить календарь'),
      subscriptions.length ? group(...rows) : group(h('div', { class: 'external-calendar-empty' }, 'Пока нет подключённых календарей. Добавьте секретную iCalendar-ссылку Google Calendar.')),
      h('button', {
        type: 'button',
        class: 'calendar-show-all' + (!activeId ? ' selected' : ''),
        onclick: () => {
          if (onSelectCalendar) onSelectCalendar(null);
          S.setSettings({ calFilters: { ...(S.settings().calFilters || {}), calendarId: null }, calView: 'agenda' });
          api.close(true);
          changed();
        },
      }, 'Показать все календари'),
      group(
        h('button', {
          type: 'button',
          class: 'row-btn',
          disabled: state.loading || busy,
          onclick: async () => { await loadExternalSubscriptions(true); draw(); },
        }, ic('repeat', 17), 'Обновить список'),
      ),
      state.error && subscriptions.length ? groupNote(state.error) : null,
      h('div', { class: 'pad-bottom' }),
    );
  };

  api = openSheet({
    title: 'Внешние календари',
    left: null,
    right: { label: 'Готово', bold: true },
    tall: true,
    onClose: () => unsubscribe(),
    build(sheet) {
      api = sheet;
      unsubscribe = () => {};
      unsubscribe = (() => {
        let active = true;
        const fn = () => { if (active) draw(); };
        listeners.add(fn);
        return () => { active = false; listeners.delete(fn); };
      })();
      draw();
      loadExternalSubscriptions(false).then(draw);
    },
  });
  return api;
}

export function openExternalEventDetails(event) {
  const date = event.date ? fmtLong(event.date) : 'Дата не указана';
  const when = event.allDay || !event.start
    ? 'Весь день'
    : event.start + (event.end ? '–' + event.end : '');
  const content = [
    group(row('Календарь', h('span', { class: 'external-event-calendar' }, event.externalCalendarName || 'Внешний календарь'), { icon: 'calendar', iconColor: event.color || 'blue' })),
    group(row('Дата', date, { icon: 'calendar', iconColor: 'red' })),
    group(row('Время', when, { icon: 'clock', iconColor: 'blue' })),
    event.location ? group(row('Место', event.location, { icon: 'link', iconColor: 'orange' })) : null,
    event.notes ? group(groupTitle('Описание'), h('div', { class: 'external-event-notes' }, event.notes)) : null,
    groupNote('Это событие из внешнего календаря. Его можно просматривать в Ritm, но изменять нужно в исходном календаре Google.'),
  ];
  openSheet({
    title: event.title || 'Событие',
    left: { label: 'Закрыть' },
    right: null,
    tall: true,
    build(api) {
      api.body.append(...content, h('div', { class: 'pad-bottom' }));
    },
  });
}
