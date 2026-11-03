-- Test mode: an account flagged test_mode plays with fake money. Everything it
-- does is fenced off from real money:
--   * no deposit address, no on-chain withdrawals (withdrawals are simulated)
--   * shop orders are marked is_test and never reveal real delivery content
--   * Pool Pot seats go to a private sandbox copy of the table, filled by
--     simulated players; real players never see or join a sandbox table
--   * admin stats and the Pool books check exclude test accounts
--
-- Also switches gambling and Pool Pot on (owner request).

alter table users add column if not exists test_mode boolean not null default false;

alter table orders add column if not exists is_test boolean not null default false;

alter table pool_tables add column if not exists is_sandbox boolean not null default false;
alter table pool_tables add column if not exists sandbox_of uuid references pool_tables(id) on delete cascade;
create unique index if not exists pool_tables_one_sandbox
  on pool_tables (created_by, sandbox_of) where is_sandbox and sandbox_of is not null;

alter table pool_seats add column if not exists bot_name text;
alter table pool_seats drop constraint if exists pool_seats_check;
alter table pool_seats drop constraint if exists pool_seats_who;
alter table pool_seats add constraint pool_seats_who check (is_house or user_id is not null or bot_name is not null);

-- Pre-existing bug: 002 added house_ledger.delta_sats but left delta_cents NOT NULL
-- with no default, so every houseMove() insert failed (house balance never moved).
alter table house_ledger alter column delta_cents set default 0;

insert into site_settings (key, value) values ('gambling_enabled', 'true')
  on conflict (key) do update set value = 'true', updated_at = now();
insert into site_settings (key, value) values ('pool_enabled', 'true')
  on conflict (key) do update set value = 'true', updated_at = now();

-- reverse:
--   alter table pool_seats drop constraint pool_seats_who;
--   alter table pool_seats add constraint pool_seats_check check (is_house or user_id is not null);  -- after deleting bot seats
--   alter table pool_seats drop column bot_name;
--   alter table pool_tables drop column sandbox_of, drop column is_sandbox;
--   alter table orders drop column is_test;  alter table users drop column test_mode;
