-- «Ритм»: схема для синхронизации и push-напоминаний.
-- Выполните целиком в Supabase → SQL Editor.

-- ---------------------------------------------------------------- данные приложения
create table if not exists public.items (
  user_id    uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text   not null,               -- goals | tasks | events | habits | logs | settings
  id         text   not null,
  data       jsonb  not null,
  updated_at bigint not null,               -- время правки на устройстве (мс)
  server_ts  bigint not null default 0,     -- время записи на сервере (мкс), по нему идёт синхронизация
  primary key (user_id, kind, id)
);
create index if not exists items_cursor on public.items (user_id, server_ts);

create or replace function public.items_touch() returns trigger language plpgsql as $$
begin
  new.server_ts := (extract(epoch from clock_timestamp()) * 1000000)::bigint;
  return new;
end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.items_touch();

alter table public.items enable row level security;
drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- Realtime: события об изменениях для мгновенной синхронизации
do $
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'items'
  ) then
    alter publication supabase_realtime add table public.items;
  end if;
end $;

-- ---------------------------------------------------------------- push-подписки устройств
create table if not exists public.push_subscriptions (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh   text not null,
  auth     text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subs" on public.push_subscriptions;
create policy "own subs" on public.push_subscriptions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- расписание напоминаний
create table if not exists public.reminders (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id      text not null,
  fire_at timestamptz not null,
  title   text not null,
  body    text,
  tag     text,
  url     text,
  sent    boolean not null default false,
  primary key (user_id, id)
);
create index if not exists reminders_due on public.reminders (fire_at) where sent = false;
alter table public.reminders enable row level security;
drop policy if exists "own reminders" on public.reminders;
create policy "own reminders" on public.reminders for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Приложение пересобирает список на ближайшие дни:
-- 1) будущие неотправленные напоминания заменяются актуальным расписанием;
-- 2) уже наступившие неотправленные напоминания сохраняются в очереди до отправки
--    или закрытия сервером по сроку давности (сейчас 6 часов).
create or replace function public.replace_reminders(items jsonb) returns void
language plpgsql security invoker as $
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
end $;

-- ---------------------------------------------------------------- отправка раз в минуту
-- 1) Включите расширения: Database → Extensions → pg_cron и pg_net.
-- 2) Задеплойте функцию send-reminders (см. README), затем выполните, подставив свои значения:
--
-- select cron.schedule('send-reminders', '* * * * *', $$
--   select net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
--     body    := '{}'::jsonb
--   );
-- $$);
