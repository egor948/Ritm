-- Ritm: external calendar subscriptions, stage 1.
-- Secret iCalendar URLs are encrypted by the Edge Functions using AES-256-GCM.
-- This table intentionally has no client RLS policies: access is through authenticated Edge Functions only.

create table if not exists public.calendar_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 60),
  color          text not null default 'blue'
                 check (color in ('blue','indigo','purple','pink','red','orange','yellow','green','mint','teal')),
  visible        boolean not null default true,
  enabled        boolean not null default true,
  encrypted_url  text not null,
  url_iv         text not null,
  ics_content    text,
  etag           text,
  last_modified  text,
  last_sync_at   timestamptz,
  last_status    text not null default 'pending'
                 check (last_status in ('pending','ok','error')),
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, id)
);

create index if not exists calendar_subscriptions_due
  on public.calendar_subscriptions (enabled, last_sync_at)
  where enabled = true;
create index if not exists calendar_subscriptions_user
  on public.calendar_subscriptions (user_id, created_at);

alter table public.calendar_subscriptions enable row level security;
-- No policies are created for anon/authenticated. The service role is used only inside
-- the Edge Functions after the caller's JWT has been validated with auth.getUser().
revoke all on public.calendar_subscriptions from anon, authenticated;
grant all on public.calendar_subscriptions to service_role;

-- After deploying sync-calendar-subscriptions, schedule it with pg_cron + pg_net.
-- Replace PROJECT_REF and CRON_SECRET with the actual values stored in Supabase secrets:
--
-- select cron.schedule('sync-calendar-subscriptions', '*/15 * * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-calendar-subscriptions',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secret', '<CRON_SECRET>'
--     ),
--     body := '{}'::jsonb
--   );
-- $$);
