import { decryptCalendarUrl, encryptCalendarUrl } from './calendar-sync.ts';

Deno.test('encrypts calendar URLs and decrypts them back', async () => {
  const previous = Deno.env.get('CALENDAR_ENCRYPTION_KEY');
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < keyBytes.length; i++) keyBytes[i] = i + 1;
  let binary = '';
  for (const byte of keyBytes) binary += String.fromCharCode(byte);
  Deno.env.set('CALENDAR_ENCRYPTION_KEY', btoa(binary));
  try {
    const source = 'https://calendar.google.com/calendar/ical/demo%40example.com/private-token/basic.ics';
    const encrypted = await encryptCalendarUrl(source);
    if (!encrypted.encryptedUrl || !encrypted.urlIv) throw new Error('Encrypted fields must be present.');
    if (encrypted.encryptedUrl.includes('calendar.google.com')) throw new Error('Ciphertext must not contain the source URL.');
    const restored = await decryptCalendarUrl(encrypted.encryptedUrl, encrypted.urlIv);
    if (restored !== source) throw new Error('Decrypted calendar URL differs from the source.');
  } finally {
    if (previous === undefined) Deno.env.delete('CALENDAR_ENCRYPTION_KEY');
    else Deno.env.set('CALENDAR_ENCRYPTION_KEY', previous);
  }
});
