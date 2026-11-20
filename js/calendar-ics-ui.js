// Интерфейс импорта и экспорта календарей iCalendar (.ics).
import { h, uid, clear, plural } from './util.js';
import * as S from './store.js';
import { openSheet, group, groupTitle, groupNote, row, selectInput, toast, ic } from './ui.js';
import { parseCalendarICS, buildCalendarICS } from './calendar-ics.js';

const DEFAULT_CALENDAR_ID = S.DEFAULT_CALENDAR_ID;

function calendarOptions() {
  return S.data().calendars.map((calendar) => ({ v: calendar.id, label: calendar.name || 'Без названия' }));
}

function safeFileName(value) {
  const name = String(value || 'Календарь')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
  return (name || 'Календарь') + '.ics';
}

export function exportCalendarIcs(calendar, events) {
  const content = buildCalendarICS(calendar, events);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(calendar.name);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast(`Экспортировано событий: ${events.length}`);
}

function readFile(file) {
  if (file && typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsText(file, 'UTF-8');
  });
}

function shortDate(date) {
  const [year, month, day] = String(date || '').split('-');
  return year && month && day ? day + '.' + month + '.' + year : '';
}

export function openCalendarIcsImport(defaultCalendarId = DEFAULT_CALENDAR_ID, onImported) {
  const state = { calendarId: defaultCalendarId, parsed: null, fileName: '', fileError: '' };
  let api;

  const fileInput = h('input', {
    type: 'file',
    accept: '.ics,text/calendar,application/ics',
    style: { display: 'none' },
    onchange: async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      state.parsed = null;
      state.fileName = file.name || 'calendar.ics';
      state.fileError = '';
      draw();
      if (file.size > 10 * 1024 * 1024) {
        state.fileError = 'Файл слишком большой. Максимальный размер — 10 МБ.';
        draw();
        return;
      }
      try {
        const text = await readFile(file);
        if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Это не файл календаря iCalendar (.ics).');
        const parsed = parseCalendarICS(text);
        if (!parsed.total || !parsed.events.length) throw new Error('В файле не найдено ни одного подходящего события.');
        state.parsed = parsed;
      } catch (error) {
        state.fileError = error && error.message || 'Не удалось прочитать календарь.';
      }
      draw();
    },
  });

  const draw = () => {
    clear(api.body);
    const parsed = state.parsed;
    const countNew = parsed ? parsed.events.filter((event) => !S.data().events.some((existing) => existing.icsUid && existing.icsUid === event.icsUid)).length : 0;
    const countUpdate = parsed ? parsed.events.length - countNew : 0;
    const previewRows = parsed ? parsed.events.slice(0, 6).map((event) =>
      h('div', { class: 'calendar-ics-preview-row' },
        h('b', null, event.title),
        h('span', null, `${shortDate(event.date)}${event.allDay ? ' · весь день' : ' · ' + event.start}${event.repeat?.freq && event.repeat.freq !== 'none' ? ' · повтор' : ''}`))) : [];

    const controls = [
      group(
        h('div', { class: 'calendar-ics-file-row' },
          h('div', { class: 'calendar-ics-file-icon' }, ic('inbox', 22)),
          h('div', { class: 'calendar-ics-file-copy' },
            h('b', null, state.fileName || 'Файл не выбран'),
            h('small', null, state.fileName ? 'iCalendar · .ics' : 'Выбери файл календаря с устройства')),
          h('button', { type: 'button', class: 'calendar-ics-pick', onclick: () => { fileInput.value = ''; fileInput.click(); } }, state.fileName ? 'Заменить' : 'Выбрать')),
        fileInput,
      ),
      state.fileError ? h('div', { class: 'calendar-ics-error' }, state.fileError) : null,
      groupTitle('Куда добавить события'),
      group(row('Календарь', selectInput(calendarOptions(), state.calendarId, (value) => { state.calendarId = value; }), { icon: 'calendar', iconColor: 'red' })),
      parsed ? group(
        h('div', { class: 'calendar-ics-summary' },
          h('b', null, `Найдено ${parsed.events.length} ${plural(parsed.events.length, ['событие', 'события', 'событий'])}`),
          h('span', null, `${countNew} новых · ${countUpdate} будут обновлены`)),
        h('div', { class: 'calendar-ics-preview' }, previewRows),
        parsed.events.length > 6 ? h('div', { class: 'calendar-ics-more' }, `И ещё ${parsed.events.length - 6}`) : null,
      ) : null,
      parsed && parsed.warnings.length ? group(
        groupTitle('Особенности файла'),
        h('div', { class: 'calendar-ics-warnings' }, parsed.warnings.slice(0, 6).map((warning) => h('p', null, warning))),
        parsed.warnings.length > 6 ? h('div', { class: 'calendar-ics-more' }, `И ещё ${parsed.warnings.length - 6} предупреждений`) : null,
      ) : null,
      groupNote('События с тем же UID будут обновлены. Остальные добавятся в выбранный календарь. Отсутствующие в файле события не удаляются.'),
      parsed ? h('button', {
        type: 'button',
        class: 'btn-primary calendar-ics-import-btn',
        onclick: () => {
          const current = S.data();
          const calendar = current.calendars.find((item) => item.id === state.calendarId);
          if (!calendar) { toast('Выбери существующий календарь'); return; }
          let created = 0, updated = 0;
          for (const imported of state.parsed.events) {
            const existing = current.events.find((item) => item.icsUid && item.icsUid === imported.icsUid);
            if (existing) updated++; else created++;
            S.upsert('events', {
              ...(existing || {}),
              ...imported,
              id: existing ? existing.id : uid(),
              calendarId: calendar.id,
              color: imported.colorOverride ? imported.color : calendar.color || 'blue',
            });
          }
          api.close(true);
          onImported && onImported();
          document.dispatchEvent(new CustomEvent('rerender'));
          toast(`Добавлено: ${created}, обновлено: ${updated}`);
        },
      }, `Импортировать ${parsed.events.length} ${plural(parsed.events.length, ['событие', 'события', 'событий'])}`) : null,
      h('div', { class: 'pad-bottom' }),
    ];
    api.body.append(...controls);
  };

  api = openSheet({
    title: 'Импорт календаря',
    left: { label: 'Отмена' },
    right: { label: 'Готово' },
    tall: true,
    build(sheet) { api = sheet; draw(); },
  });
  return api;
}
