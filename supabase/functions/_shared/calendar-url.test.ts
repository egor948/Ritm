import { validateGoogleCalendarUrl } from './calendar-url.ts';

Deno.test('accepts a Google Calendar secret iCalendar URL', () => {
  const input = 'https://calendar.google.com/calendar/ical/demo%40example.com/private-token/basic.ics';
  const result = validateGoogleCalendarUrl(input);
  if (result !== input) throw new Error('Expected the canonical Google Calendar URL to be preserved.');
});

Deno.test('rejects non-HTTPS calendar URLs', () => {
  let rejected = false;
  try { validateGoogleCalendarUrl('http://calendar.google.com/calendar/ical/demo/private-token/basic.ics'); }
  catch { rejected = true; }
  if (!rejected) throw new Error('HTTP URL must be rejected.');
});

Deno.test('rejects arbitrary hosts and localhost targets', () => {
  for (const input of [
    'https://example.com/calendar.ics',
    'https://localhost/calendar/ical/demo/private-token/basic.ics',
    'https://127.0.0.1/calendar/ical/demo/private-token/basic.ics',
  ]) {
    let rejected = false;
    try { validateGoogleCalendarUrl(input); } catch { rejected = true; }
    if (!rejected) throw new Error('Unsafe URL must be rejected: ' + input);
  }
});

Deno.test('rejects wrong paths, credentials, ports and fragments', () => {
  for (const input of [
    'https://calendar.google.com/calendar/basic.ics',
    'https://user:pass@calendar.google.com/calendar/ical/demo/private-token/basic.ics',
    'https://calendar.google.com:8443/calendar/ical/demo/private-token/basic.ics',
    'https://calendar.google.com/calendar/ical/demo/private-token/basic.ics#fragment',
  ]) {
    let rejected = false;
    try { validateGoogleCalendarUrl(input); } catch { rejected = true; }
    if (!rejected) throw new Error('Invalid URL must be rejected: ' + input);
  }
});
