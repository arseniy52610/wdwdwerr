-- ============================================================
-- BYNEXVPN — схема таблицы статистики для Supabase
-- Выполнить в Supabase -> SQL Editor -> New query -> Run
-- ============================================================

create table if not exists events (
  id bigint generated always as identity primary key,
  visitor_id text not null,
  session_id text not null,
  type text not null,          -- pageview | click | heartbeat
  page text not null,          -- например / или /#pricing
  label text default '',       -- название кнопки для click
  country text default '',     -- ISO-код страны, например RU
  referrer text default '',    -- источник перехода
  device text default '',      -- Телефон | Компьютер | Планшет
  created_at timestamptz not null default now()
);

create index if not exists events_created_at_idx on events (created_at desc);
create index if not exists events_type_idx on events (type);

alter table events enable row level security;

create policy "anon insert events"
  on events for insert to anon with check (true);

create policy "anon select events"
  on events for select to anon using (true);
