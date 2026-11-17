-- Ritm 4.5.3
-- Keep already-due reminders in the delivery queue when another device syncs.
-- Run once in Supabase Dashboard -> SQL Editor for an existing project.

-- Приложение пересобирает список на ближайшие дни:
-- 1) будущие неотправленные напоминания заменяются актуальным расписанием;
-- 2) уже наступившие неотправленные напоминания сохраняются в очереди до отправки
--    или закрытия сервером по сроку давности (сейчас 6 часов).
create or replace function public.replace_reminders(items jsonb) returns void
language plpgsql security invoker as $$
begin
  delete from public.reminders
  where user_id = auth.uid()
    and sent = false
    and fire_at > now();

  delete from public.reminders
  where user_id = auth.uid()
    and sent = true
    and fire_at < now() - interval '3 days';

  insert into public.reminders (user_id, id, fire_at, title, body, tag, url)
  select auth.uid(), x->>'id', (x->>'fireAt')::timestamptz, x->>'title', x->>'body', x->>'tag', x->>'url'
  from jsonb_array_elements(items) x
  on conflict (user_id, id) do nothing;
end $$;
