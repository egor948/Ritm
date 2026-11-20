/**
 * Первоначально поддерживаем только штатные секретные iCalendar URL Google Calendar.
 * Узкая allowlist снижает риск SSRF: сервер не принимает произвольные адреса.
 * Секретный URL никогда не должен возвращаться клиенту или попадать в логи.
 */
export function validateGoogleCalendarUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 2048) {
    throw new Error('Вставьте корректную ссылку iCalendar Google Calendar.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Ссылка календаря имеет неверный формат.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Поддерживаются только защищённые HTTPS-ссылки.');
  }
  if (url.hostname.toLowerCase() !== 'calendar.google.com') {
    throw new Error('Пока поддерживаются ссылки Google Calendar вида calendar.google.com.');
  }
  if (url.port && url.port !== '443') {
    throw new Error('Для ссылки календаря используется неподдерживаемый порт.');
  }
  if (url.username || url.password || url.hash) {
    throw new Error('Ссылка календаря содержит неподдерживаемые данные.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (
    segments.length < 4 ||
    segments[0] !== 'calendar' ||
    segments[1] !== 'ical' ||
    segments[segments.length - 1].toLowerCase() !== 'basic.ics'
  ) {
    throw new Error('Нужна секретная iCalendar-ссылка Google Calendar, заканчивающаяся на /basic.ics.');
  }

  return url.toString();
}
