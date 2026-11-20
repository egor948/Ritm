// Пользовательские календари: управление, видимость и выбор календаря для события.
import { h, uid, clear, COLOR_KEYS, plural } from './util.js';
import * as S from './store.js';
import { openSheet, actionSheet, group, groupTitle, groupNote, row, toggle, textInput, colorPicker, toast, ic, cv } from './ui.js';
import { openCalendarIcsImport, exportCalendarIcs } from './calendar-ics-ui.js';

export const DEFAULT_CALENDAR_ID = S.DEFAULT_CALENDAR_ID;

export function eventCalendarId(event) {
  return event && event.calendarId || DEFAULT_CALENDAR_ID;
}

export function calendarOptions(calendars = S.data().calendars) {
  const list = [...(calendars || [])].filter((calendar) => !calendar.deleted);
  if (!list.some((calendar) => calendar.id === DEFAULT_CALENDAR_ID)) {
    list.unshift({ id: DEFAULT_CALENDAR_ID, name: 'Личный календарь' });
  }
  return list.map((calendar) => ({ v: calendar.id, label: calendar.name || 'Без названия' }));
}

/** Скрытие календаря действует в приложении целиком; выбранный фильтр применяется только к экрану календаря. */
export function filterCalendarEvents(events, calendars = [], selectedId = null) {
  const byId = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  return events.filter((event) => {
    const id = eventCalendarId(event);
    const calendar = byId.get(id);
    if (calendar && calendar.visible === false) return false;
    return !selectedId || id === selectedId;
  });
}

export function visibleEventsData(data, { selected = false } = {}) {
  const selectedId = selected && S.settings().calFilters && S.settings().calFilters.calendarId;
  return { ...data, events: filterCalendarEvents(data.events, data.calendars || [], selectedId) };
}

function openCalendarEditor(calendar, onSaved) {
  const isNew = !calendar;
  const draft = {
    name: calendar ? calendar.name : '',
    color: calendar && COLOR_KEYS.includes(calendar.color) ? calendar.color : 'blue',
  };
  let nameControl;
  const api = openSheet({
    title: isNew ? 'Новый календарь' : 'Настроить календарь',
    left: { label: 'Отмена' },
    right: {
      label: 'Сохранить',
      bold: true,
      onClick: (sheet) => {
        const name = String(draft.name || '').trim();
        if (!name) { toast('Укажите название календаря'); nameControl.focus(); return; }
        const duplicate = S.data().calendars.some((item) => item.id !== (calendar && calendar.id) && String(item.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase());
        if (duplicate) { toast('Календарь с таким названием уже есть'); nameControl.focus(); return; }
        S.upsert('calendars', {
          ...(calendar || {}),
          id: calendar ? calendar.id : uid(),
          name: name.slice(0, 60),
          color: draft.color,
          visible: calendar ? calendar.visible !== false : true,
          isDefault: !!(calendar && calendar.id === DEFAULT_CALENDAR_ID),
        });
        sheet.close(true);
        onSaved && onSaved();
        toast(isNew ? 'Календарь создан' : 'Календарь обновлён');
      },
    },
    tall: true,
    build(sheet) {
      nameControl = textInput({ value: draft.name, placeholder: 'Например, Дни рождения', big: true, onInput: (value) => { draft.name = value; } });
      sheet.body.append(
        group(groupTitle('Название'), h('div', { class: 'calendar-editor-name' }, nameControl)),
        groupTitle('Цвет календаря'),
        group(h('div', { class: 'row' }, colorPicker(draft.color, (value) => { draft.color = value; }))),
        groupNote('Цвет помогает быстро отличать события этого календаря от остальных.'),
        calendar && calendar.id !== DEFAULT_CALENDAR_ID
          ? h('button', { class: 'row-btn danger calendar-delete-btn', onclick: () => {
              actionSheet({
                title: 'Удалить календарь?',
                message: 'Все его события останутся в Ritm и будут перенесены в «Личный календарь».',
                actions: [{
                  label: 'Удалить календарь',
                  danger: true,
                  onClick: () => {
                    const changes = [
                      ...S.data().events.filter((event) => eventCalendarId(event) === calendar.id)
                        .map((event) => ({ kind: 'events', rec: { ...event, calendarId: DEFAULT_CALENDAR_ID } })),
                      { kind: 'calendars', rec: { ...calendar, deleted: true } },
                    ];
                    const inverse = S.applyChanges(changes);
                    if (S.settings().calFilters?.calendarId === calendar.id) {
                      S.setSettings({ calFilters: { ...(S.settings().calFilters || {}), calendarId: null } });
                    }
                    sheet.close(true);
                    onSaved && onSaved();
                    toast('Календарь удалён', { label: 'Отменить', onClick: () => { S.undo(inverse); onSaved && onSaved(); } });
                  },
                }],
              });
            } }, ic('trash', 17), 'Удалить календарь')
          : null,
      );
    },
  });
  return api;
}

export function openCalendarManager(onFilters, onSelectCalendar) {
  let api;
  const draw = () => {
    const data = S.data();
    const calendars = [...data.calendars].sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || (a.createdAt || 0) - (b.createdAt || 0));
    const activeId = S.settings().calFilters && S.settings().calFilters.calendarId || null;
    clear(api.body);
    const rows = calendars.map((calendar) => {
      const count = data.events.filter((event) => eventCalendarId(event) === calendar.id).length;
      const selected = activeId === calendar.id;
      return h('div', { class: 'calendar-manage-row' },
        h('button', {
          type: 'button',
          class: 'calendar-manage-open' + (selected ? ' selected' : ''),
          onclick: () => {
            if (calendar.visible === false) S.upsert('calendars', { id: calendar.id, visible: true });
            if (onSelectCalendar) onSelectCalendar(calendar.id);
            S.setSettings({ calFilters: { ...(S.settings().calFilters || {}), calendarId: calendar.id }, calView: 'agenda' });
            api.close(true);
            document.dispatchEvent(new CustomEvent('rerender'));
          },
        },
          h('i', { class: 'calendar-color-dot', style: { '--c': cv(calendar.color || 'blue') } }),
          h('span', { class: 'calendar-manage-copy' },
            h('b', null, calendar.name || 'Без названия'),
            h('small', null, `${count} ${plural(count, ['событие', 'события', 'событий'])} · ${calendar.visible === false ? 'Скрыт' : 'Показывается'}`)),
          selected ? h('span', { class: 'calendar-selected-mark' }, ic('check', 16)) : null),
        h('button', { type: 'button', class: 'calendar-manage-export', 'aria-label': `Экспортировать ${calendar.name || 'календарь'}`, disabled: count === 0, onclick: () => exportCalendar(calendar) }, ic('down', 17)),
        h('button', { type: 'button', class: 'calendar-manage-edit', 'aria-label': 'Настроить календарь', onclick: () => openCalendarEditor(calendar, draw) }, ic('edit', 17)),
        (() => {
          const control = toggle(calendar.visible !== false, (visible) => {
            S.upsert('calendars', { id: calendar.id, visible });
            if (!visible && S.settings().calFilters?.calendarId === calendar.id) {
              S.setSettings({ calFilters: { ...(S.settings().calFilters || {}), calendarId: null } });
            }
            draw();
          });
          control.setAttribute('aria-label', `Показывать календарь ${calendar.name || ''}`);
          return control;
        })(),
      );
    });
    const exportCalendar = (calendar) => {
      const events = S.data().events.filter((event) => eventCalendarId(event) === calendar.id);
      if (!events.length) { toast('В этом календаре пока нет событий'); return; }
      exportCalendarIcs(calendar, events);
    };
    api.body.append(
      group(
        h('button', { type: 'button', class: 'row-btn', onclick: () => openCalendarIcsImport(activeId || DEFAULT_CALENDAR_ID, draw) }, ic('inbox', 17), 'Импортировать .ics'),
        h('button', { type: 'button', class: 'row-btn', onclick: () => {
          const data = S.data();
          if (!data.events.length) { toast('Пока нечего экспортировать'); return; }
          exportCalendarIcs({ name: 'Все календари Ritm' }, data.events);
        } }, ic('down', 17), 'Экспортировать всё'),
      ),
      h('button', {
        type: 'button',
        class: 'calendar-show-all' + (!activeId ? ' selected' : ''),
        onclick: () => {
          if (onSelectCalendar) onSelectCalendar(null);
          S.setSettings({ calFilters: { ...(S.settings().calFilters || {}), calendarId: null }, calView: 'agenda' });
          api.close(true);
          document.dispatchEvent(new CustomEvent('rerender'));
        },
      }, 'Показать все календари'),
      group(...rows),
      group(
        h('button', { type: 'button', class: 'row-btn', onclick: () => openCalendarEditor(null, draw) }, ic('plus', 17), 'Создать календарь'),
        onFilters ? h('button', { type: 'button', class: 'row-btn', onclick: onFilters }, ic('filter', 17), 'Что показывать в календаре') : null,
      ),
      groupNote('Скрытый календарь не отображается в расписании, но его события и напоминания сохраняются. Нажмите на название, чтобы открыть события этого календаря.'),
      h('div', { class: 'pad-bottom' }),
    );
  };
  api = openSheet({
    title: 'Мои календари',
    left: null,
    right: { label: 'Готово', bold: true },
    tall: true,
    build(sheet) { api = sheet; draw(); },
  });
  return api;
}
