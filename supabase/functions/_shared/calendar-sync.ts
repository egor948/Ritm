import { validateGoogleCalendarUrl } from './calendar-url.ts';

const env = (key: string) => Deno.env.get(key) ?? '';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function encryptionKey() {
  const raw = decodeBase64(env('CALENDAR_ENCRYPTION_KEY'));
  if (raw.length !== 32) throw new Error('Серверное шифрование календарей не настроено.');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptCalendarUrl(url: string) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(url));
  return { encryptedUrl: encodeBase64(new Uint8Array(encrypted)), urlIv: encodeBase64(iv) };
}

export async function decryptCalendarUrl(encryptedUrl: string, urlIv: string) {
  const key = await encryptionKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(urlIv) },
    key,
    decodeBase64(encryptedUrl),
  );
  const url = decoder.decode(decrypted);
  return validateGoogleCalendarUrl(url);
}

export type CalendarFetchResult = {
  changed: boolean;
  content?: string;
  etag?: string | null;
  lastModified?: string | null;
};

export async function fetchCalendarIcs(
  url: string,
  previous: { etag?: string | null; lastModified?: string | null } = {},
): Promise<CalendarFetchResult> {
  const safeUrl = validateGoogleCalendarUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = new Headers({
      Accept: 'text/calendar, text/plain;q=0.8',
      'Cache-Control': 'no-cache',
    });
    if (previous.etag) headers.set('If-None-Match', previous.etag);
    if (previous.lastModified) headers.set('If-Modified-Since', previous.lastModified);

    const response = await fetch(safeUrl, {
      method: 'GET',
      headers,
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (response.status === 304) {
      return { changed: false, etag: previous.etag ?? null, lastModified: previous.lastModified ?? null };
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Источник календаря перенаправляет запрос. Обновите ссылку Google Calendar.');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new Error('Google Calendar отклонил ссылку. Проверьте секретную ссылку и доступ к календарю.');
      }
      throw new Error('Google Calendar временно недоступен (HTTP ' + response.status + ').');
    }

    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (type && !['text/calendar', 'text/plain', 'application/octet-stream'].some((allowed) => type.includes(allowed))) {
      throw new Error('Источник вернул не календарный файл iCalendar.');
    }
    const declaredLength = Number(response.headers.get('content-length') || 0);
    const maxBytes = 1024 * 1024;
    if (declaredLength > maxBytes) throw new Error('Файл календаря больше допустимого размера 1 МБ.');

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Google Calendar вернул пустой ответ.');
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Файл календаря больше допустимого размера 1 МБ.');
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    const content = decoder.decode(joined).replace(/^\uFEFF/, '').trim();
    if (!/^BEGIN:VCALENDAR(?:\r?\n|$)/i.test(content)) {
      throw new Error('Полученный файл не распознан как календарь iCalendar.');
    }

    return {
      changed: true,
      content,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    };
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw new Error('Google Calendar не ответил за 15 секунд.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
