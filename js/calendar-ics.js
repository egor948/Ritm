// Чтение и создание файлов iCalendar (.ics), без зависимости от DOM.
import { addDays, addMonths, daysInMonth, dow, parseYmd, ymd, weekStart } from './util.js';

const DAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const CODE_DAYS = Object.fromEntries(Object.entries(DAY_CODES).map(([code, day]) => [day, code]));
const FREQ_MAP = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };

function splitUnquoted(value, delimiter) {
  const out = [];
  let current = '';
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (char === delimiter && !quoted) { out.push(current); current = ''; }
    else current += char;
  }
  out.push(current);
  return out;
}

function parseProperty(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = splitUnquoted(left, ';');
  const params = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).toUpperCase();
    params[key] = part.slice(eq + 1).replace(/^"(.*)"$/, '$1');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

function unescapeText(value) {
  return String(value || '')
    .replace(/\\\\/g, '\u0000')
    .replace(/\\[nN]/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\u0000/g, '\\');
}

function dateText(year, month, day) {
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function localDateText(date) {
  return dateText(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function localTimeText(date) {
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function zonedWallEpoch(year, month, day, hour, minute, second, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let epoch = wall;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(epoch)).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const offset = represented - epoch;
    const next = wall - offset;
    if (next === epoch) break;
    epoch = next;
  }
  return epoch;
}

function parseIcsDate(value, params = {}, warnings = []) {
  const raw = String(value || '').trim();
  let match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (match) {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = dateText(year, month, day);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(dateText(year, month, 1))) return null;
    return { date, time: null, allDay: true };
  }
  match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i.exec(raw);
  if (!match) return null;
  const parts = match.slice(1, 7).map((part) => Number(part || 0));
  const [checkYear, checkMonth, checkDay, checkHour, checkMinute, checkSecond] = parts;
  const check = new Date(checkYear, checkMonth - 1, checkDay, checkHour, checkMinute, checkSecond);
  if (check.getFullYear() !== checkYear || check.getMonth() + 1 !== checkMonth || check.getDate() !== checkDay
      || check.getHours() !== checkHour || check.getMinutes() !== checkMinute || check.getSeconds() !== checkSecond) return null;
  const [year, month, day, hour, minute, second] = parts;
  let date;
  if (match[7]) {
    date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  } else if (params.TZID) {
    try {
      date = new Date(zonedWallEpoch(year, month, day, hour, minute, second, params.TZID));
    } catch (_) {
      warnings.push('Не удалось распознать часовой пояс ' + params.TZID + '; использовано местное время устройства.');
      date = new Date(year, month - 1, day, hour, minute, second);
    }
  } else {
    date = new Date(year, month - 1, day, hour, minute, second);
  }
  if (Number.isNaN(date.getTime())) return null;
  return { date: localDateText(date), time: localTimeText(date), allDay: false };
}

function parseDurationMinutes(value) {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(value || '').trim());
  if (!match) return null;
  const total = (Number(match[2] || 0) * 7 * 1440)
    + (Number(match[3] || 0) * 1440)
    + (Number(match[4] || 0) * 60)
    + Number(match[5] || 0)
    + (Number(match[6] || 0) / 60);
  return Math.round(total) * (match[1] === '-' ? -1 : 1);
}

function dateMatchesRule(start, candidate, freq, interval, days) {
  if (candidate < start) return false;
  if (freq === 'daily') {
    const diff = Math.round((parseYmd(candidate) - parseYmd(start)) / 86400000);
    return diff % interval === 0;
  }
  if (freq === 'weekly') {
    if (!(days || [dow(start)]).includes(dow(candidate))) return false;
    const weeks = Math.floor((parseYmd(weekStart(candidate, 1)) - parseYmd(weekStart(start, 1))) / 604800000);
    return weeks % interval === 0;
  }
  if (freq === 'monthly') {
    const months = (Number(candidate.slice(0, 4)) - Number(start.slice(0, 4))) * 12
      + Number(candidate.slice(5, 7)) - Number(start.slice(5, 7));
    const day = Number(start.slice(8, 10));
    return months >= 0 && months % interval === 0 && Number(candidate.slice(8, 10)) === Math.min(day, daysInMonth(candidate));
  }
  if (freq === 'yearly') {
    const years = Number(candidate.slice(0, 4)) - Number(start.slice(0, 4));
    const initial = parseYmd(start);
    const current = parseYmd(candidate);
    return years >= 0 && years % interval === 0
      && current.getMonth() === initial.getMonth()
      && current.getDate() === Math.min(initial.getDate(), daysInMonth(candidate));
  }
  return false;
}

function shiftMonthClamped(date, months) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 + months;
  const day = Number(date.slice(8, 10));
  const target = new Date(year, month, 1);
  return dateText(target.getFullYear(), target.getMonth() + 1, Math.min(day, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
}

function countUntil(start, freq, interval, days, count) {
  if (count <= 1) return start;
  if (freq === 'daily') return addDays(start, (count - 1) * interval);
  if (freq === 'weekly' && days && days.length) {
    const sorted = [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const startOffset = (dow(start) + 6) % 7;
    const firstWeek = sorted.filter((day) => (day + 6) % 7 >= startOffset);
    if (count <= firstWeek.length) {
      const day = firstWeek[count - 1];
      return addDays(weekStart(start, 1), (day + 6) % 7);
    }
    const remaining = count - firstWeek.length;
    const activeWeek = (1 + Math.floor((remaining - 1) / sorted.length)) * interval;
    const day = sorted[(remaining - 1) % sorted.length];
    return addDays(weekStart(start, 1), activeWeek * 7 + (day + 6) % 7);
  }
  if (freq === 'weekly') return addDays(start, (count - 1) * interval * 7);
  if (freq === 'monthly') return shiftMonthClamped(start, (count - 1) * interval);
  if (freq === 'yearly') return shiftMonthClamped(start, (count - 1) * interval * 12);
  let current = start;
  let matches = 0;
  let last = start;
  for (let i = 0; i < 200000 && matches < count; i++) {
    if (dateMatchesRule(start, current, freq, interval, days)) {
      matches++;
      last = current;
    }
    if (matches < count) current = addDays(current, 1);
  }
  return matches === count ? last : null;
}

function parseRule(value, start, warnings, summary) {
  const fields = {};
  for (const part of String(value || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) fields[part.slice(0, i).toUpperCase()] = part.slice(i + 1).toUpperCase();
  }
  const freq = FREQ_MAP[fields.FREQ];
  if (!freq) {
    warnings.push('Повторение «' + summary + '» не поддерживается и импортировано как разовое событие.');
    return { freq: 'none' };
  }
  const rawInterval = Math.max(1, Number(fields.INTERVAL) || 1);
  const interval = Math.min(30, rawInterval);
  if (rawInterval > 30) warnings.push('Интервал повторения «' + summary + '» ограничен 30 в Ritm.');
  let days = [];
  if (fields.BYDAY) {
    const tokens = fields.BYDAY.split(',');
    const parsed = tokens.map((token) => {
      const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token);
      return m && !m[1] ? DAY_CODES[m[2]] : null;
    });
    if (freq !== 'weekly' || parsed.some((day) => day == null)) {
      warnings.push('Дополнительное правило повторения для «' + summary + '» упрощено до базового интервала.');
    } else days = [...new Set(parsed)].sort((a, b) => a - b);
  }
  const unsupported = Object.keys(fields).filter((key) => !['FREQ', 'INTERVAL', 'UNTIL', 'COUNT', 'BYDAY', 'WKST'].includes(key));
  if (unsupported.length || fields.WKST && fields.WKST !== 'MO') {
    warnings.push('Часть сложного правила повторения для «' + summary + '» не поддерживается.');
  }
  let until = null;
  if (freq === 'weekly' && days.length && !days.includes(dow(start))) {
    warnings.push('Дата начала события «' + summary + '» не входит в BYDAY. В Ritm будут показаны только выбранные дни недели.');
  }
  if (fields.COUNT) {
    const count = Math.max(1, Math.min(10000, Number(fields.COUNT) || 1));
    if (Number(fields.COUNT) > 10000) warnings.push('Количество повторов «' + summary + '» ограничено 10000.');
    until = countUntil(start, freq, interval, days.length ? days : null, count);
  } else if (fields.UNTIL) {
    const parsed = parseIcsDate(fields.UNTIL, {}, warnings);
    until = parsed && parsed.date;
  }
  return { freq, interval, days, until };
}

function parseEvents(text) {
  const unfolded = String(text || '').replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const components = [];
  let current = null;
  let alarm = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') { current = { props: [], alarms: [] }; alarm = null; continue; }
    if (!current) continue;
    if (upper === 'BEGIN:VALARM') { alarm = []; continue; }
    if (upper === 'END:VALARM') {
      if (alarm) current.alarms.push(alarm);
      alarm = null;
      continue;
    }
    if (upper === 'END:VEVENT') { components.push(current); current = null; alarm = null; continue; }
    const prop = parseProperty(line);
    if (prop) {
      if (alarm) alarm.push(prop);
      else current.props.push(prop);
    }
  }
  return components;
}

function first(props, name) {
  return props.find((prop) => prop.name === name) || null;
}

function all(props, name) {
  return props.filter((prop) => prop.name === name);
}

function stableId(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 'ritm-' + (hash >>> 0).toString(16);
}

export function parseCalendarICS(text) {
  const warnings = [];
  const events = [];
  const components = parseEvents(text);
  if (components.length > 5000) warnings.push('Файл содержит больше 5000 событий; импортирована только первая часть.');
  for (const component of components.slice(0, 5000)) {
    const props = component.props;
    const startProp = first(props, 'DTSTART');
    const start = startProp && parseIcsDate(startProp.value, startProp.params, warnings);
    if (!start) {
      warnings.push('Одно событие пропущено: отсутствует или некорректна дата начала.');
      continue;
    }
    const summary = unescapeText((first(props, 'SUMMARY') || {}).value || 'Без названия').trim() || 'Без названия';
    if (String((first(props, 'STATUS') || {}).value || '').toUpperCase() === 'CANCELLED') continue;
    if (first(props, 'RECURRENCE-ID')) {
      warnings.push('Изменённое отдельное вхождение «' + summary + '» пропущено; основное правило повторения сохранено без этой правки.');
      continue;
    }
    if (all(props, 'RDATE').length) warnings.push('Дополнительные даты повторения события «' + summary + '» не поддерживаются и были пропущены.');
    const endProp = first(props, 'DTEND');
    const parsedEnd = endProp && parseIcsDate(endProp.value, endProp.params, warnings);
    if (endProp && !parsedEnd) warnings.push('Некорректное окончание события «' + summary + '» было проигнорировано.');
    const allDay = start.allDay;
    let endDate = null;
    let end = null;
    if (allDay) {
      if (parsedEnd && parsedEnd.allDay && parsedEnd.date > start.date) endDate = addDays(parsedEnd.date, -1);
      else if (parsedEnd && !parsedEnd.allDay) warnings.push('Окончание события «' + summary + '» не совпадает с форматом даты начала и было проигнорировано.');
      else if (!parsedEnd) {
        const durationProp = first(props, 'DURATION');
        const duration = durationProp && parseDurationMinutes(durationProp.value);
        if (duration > 0) {
          const days = Math.max(1, Math.ceil(duration / 1440));
          if (days > 1) endDate = addDays(start.date, days - 1);
        }
      }
    } else if (parsedEnd) {
      if (parsedEnd.date !== start.date) {
        warnings.push('Событие «' + summary + '» длится дольше одного календарного дня; в Ritm оно отображается до конца даты начала.');
        end = '23:59';
      } else end = parsedEnd.time;
    }
    if (!allDay && !end) {
      const durationProp = first(props, 'DURATION');
      const duration = durationProp && parseDurationMinutes(durationProp.value);
      const [hh, mm] = start.time.split(':').map(Number);
      const endMinutes = Math.min(1439, hh * 60 + mm + (duration > 0 ? duration : 60));
      end = String(Math.floor(endMinutes / 60)).padStart(2, '0') + ':' + String(endMinutes % 60).padStart(2, '0');
    }
    if (!allDay && end <= start.time) {
      warnings.push('Время окончания события «' + summary + '» скорректировано, чтобы оно было позже начала.');
      const [hh, mm] = start.time.split(':').map(Number);
      const m = Math.min(1439, hh * 60 + mm + 30);
      end = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    }
    let repeat = { freq: 'none' };
    const ruleProp = first(props, 'RRULE');
    if (ruleProp) repeat = parseRule(ruleProp.value, start.date, warnings, summary);
    if (allDay && endDate && repeat.freq !== 'none') {
      warnings.push('Многодневное повторяющееся событие «' + summary + '» в Ritm будет отображаться только в дату начала каждого повтора.');
    }
    const exdates = [];
    for (const prop of all(props, 'EXDATE')) {
      for (const value of prop.value.split(',')) {
        const parsed = parseIcsDate(value, prop.params, warnings);
        if (parsed && parsed.date >= start.date) exdates.push(parsed.date);
      }
    }
    const reminders = [];
    for (const alarm of component.alarms) {
      const trigger = first(alarm, 'TRIGGER');
      const action = String((first(alarm, 'ACTION') || {}).value || 'DISPLAY').toUpperCase();
      if (action !== 'DISPLAY') {
        warnings.push('Напоминание другого типа у события «' + summary + '» не импортировано.');
        continue;
      }
      if (trigger && String(trigger.params.RELATED || '').toUpperCase() === 'END') {
        warnings.push('Напоминание относительно окончания события «' + summary + '» не поддерживается.');
        continue;
      }
      const minutes = trigger && parseDurationMinutes(trigger.value);
      if (minutes != null && minutes <= 0) {
        const duration = Math.abs(minutes);
        const unit = duration && duration % 10080 === 0 ? 'weeks'
          : duration && duration % 1440 === 0 ? 'days'
            : duration && duration % 60 === 0 ? 'hours' : 'minutes';
        const factor = unit === 'weeks' ? 10080 : unit === 'days' ? 1440 : unit === 'hours' ? 60 : 1;
        let amount = duration / factor;
        if (amount > 9999) {
          warnings.push('Интервал напоминания события «' + summary + '» ограничен 9999 ' + unit + ' в Ritm.');
          amount = 9999;
        }
        const key = amount + ':' + unit;
        if (!reminders.some((r) => r.key === key)) reminders.push({ amount, unit, key });
      } else if (minutes > 0) {
        warnings.push('Напоминание после начала события «' + summary + '» не импортировано.');
      } else if (trigger && minutes == null) {
        warnings.push('Абсолютное напоминание у события «' + summary + '» не поддерживается и не импортировано.');
      }
    }
    const uidProp = first(props, 'UID');
    const icsUid = uidProp && uidProp.value.trim()
      ? uidProp.value.trim()
      : stableId(summary + '|' + start.date + '|' + (start.time || '') + '|' + (first(props, 'LOCATION') || {}).value);
    const description = unescapeText((first(props, 'DESCRIPTION') || {}).value || '');
    const colorProp = first(props, 'X-RITM-COLOR');
    const colorOverrideProp = first(props, 'X-RITM-COLOR-OVERRIDE');
    events.push({
      icsUid,
      title: summary,
      date: start.date,
      start: allDay ? null : start.time,
      end: allDay ? null : end,
      allDay,
      endDate,
      location: unescapeText((first(props, 'LOCATION') || {}).value || ''),
      notes: description,
      reminders: reminders.map(({ amount, unit }, index) => ({ id: 'ics-rem-' + index + '-' + stableId(icsUid), amount, unit })),
      repeat,
      exdates: [...new Set(exdates)],
      color: colorProp ? colorProp.value : 'blue',
      colorOverride: colorOverrideProp ? colorOverrideProp.value.toUpperCase() === 'TRUE' : !!colorProp,
    });
  }
  const unique = new Map();
  for (const event of events) unique.set(event.icsUid, event);
  return { events: [...unique.values()], warnings, total: components.length };
}

function escapeText(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function foldLine(line) {
  const chunks = [];
  let current = '';
  let bytes = 0;
  for (const char of Array.from(line)) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75 && current) {
      chunks.push(current);
      current = ' ' + char;
      bytes = 1 + size;
    } else {
      current += char;
      bytes += size;
    }
  }
  chunks.push(current);
  return chunks.join('\r\n');
}

function icsDate(date) {
  return String(date || '').replaceAll('-', '');
}

function icsDateTime(date, time) {
  return icsDate(date) + 'T' + String(time || '00:00').replace(':', '') + '00';
}

function formatRule(event) {
  const repeat = event.repeat || {};
  if (!repeat.freq || repeat.freq === 'none') return null;
  const freq = Object.keys(FREQ_MAP).find((key) => FREQ_MAP[key] === repeat.freq);
  if (!freq) return null;
  const parts = ['FREQ=' + freq];
  if (repeat.interval && repeat.interval > 1) parts.push('INTERVAL=' + repeat.interval);
  if (repeat.freq === 'weekly' && repeat.days && repeat.days.length) {
    parts.push('BYDAY=' + repeat.days.slice().sort((a, b) => a - b).map((day) => CODE_DAYS[day]).join(','));
  }
  if (repeat.until) parts.push('UNTIL=' + (event.allDay ? icsDate(repeat.until) : icsDateTime(repeat.until, event.start)));
  return parts.join(';');
}

function reminderTrigger(reminder) {
  const amount = Math.max(0, Number(reminder.amount) || 0);
  const unit = reminder.unit;
  if (unit === 'weeks') return '-P' + amount + 'W';
  if (unit === 'days') return '-P' + amount + 'D';
  if (unit === 'hours') return '-PT' + amount + 'H';
  return '-PT' + amount + 'M';
}

function foldCalendarLine(name, value) {
  return name + ':' + value;
}

export function buildCalendarICS(calendar, events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ritm//Calendar 1.0//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldCalendarLine('X-WR-CALNAME', escapeText(calendar.name || 'Календарь')),
  ];
  const now = new Date();
  const stamp = now.getUTCFullYear() + String(now.getUTCMonth() + 1).padStart(2, '0')
    + String(now.getUTCDate()).padStart(2, '0') + 'T'
    + String(now.getUTCHours()).padStart(2, '0') + String(now.getUTCMinutes()).padStart(2, '0')
    + String(now.getUTCSeconds()).padStart(2, '0') + 'Z';
  for (const event of events) {
    if (event.deleted) continue;
    const uid = event.icsUid || (event.id + '@ritm.local');
    lines.push('BEGIN:VEVENT', 'UID:' + escapeText(uid), 'DTSTAMP:' + stamp);
    if (event.allDay) {
      lines.push('DTSTART;VALUE=DATE:' + icsDate(event.date));
      lines.push('DTEND;VALUE=DATE:' + icsDate(addDays(event.endDate || event.date, 1)));
    } else {
      lines.push('DTSTART:' + icsDateTime(event.date, event.start || '09:00'));
      lines.push('DTEND:' + icsDateTime(event.date, event.end || event.start || '10:00'));
    }
    lines.push(foldCalendarLine('SUMMARY', escapeText(event.title || 'Без названия')));
    if (event.location) lines.push(foldCalendarLine('LOCATION', escapeText(event.location)));
    if (event.notes) lines.push(foldCalendarLine('DESCRIPTION', escapeText(event.notes)));
    if (event.colorOverride && event.color) {
      lines.push('X-RITM-COLOR:' + event.color, 'X-RITM-COLOR-OVERRIDE:TRUE');
    }
    const rule = formatRule(event);
    if (rule) lines.push('RRULE:' + rule);
    if (event.exdates && event.exdates.length) {
      const values = event.exdates.map((date) => event.allDay ? icsDate(date) : icsDateTime(date, event.start || '09:00'));
      lines.push((event.allDay ? 'EXDATE;VALUE=DATE:' : 'EXDATE:') + values.join(','));
    }
    for (const reminder of event.reminders || []) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        foldCalendarLine('DESCRIPTION', escapeText(event.title || 'Напоминание')),
        'TRIGGER:' + reminderTrigger(reminder),
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map((line) => line.startsWith(' ') ? line : foldLine(line)).join('\r\n') + '\r\n';
}
