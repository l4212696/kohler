-- Pool Pot: equal-stake social pools, one provably-fair winner, disclosed fee,
-- optional HOUSE seat that is always labelled.
--
-- Additive only. Nothing existing is altered except two nullable/limit columns
-- on users. Reverse with the block at the bottom of this file.

create table if not exists pool_tables (
  id             uuid primary key default gen_random_uuid(),
  code           text unique not null,                 -- share code, e.g. NEON7
  name           text not null,
  stake_cents    bigint not null check (stake_cents > 0),
  max_seats      int not null check (max_seats between 2 and 12),
  min_players    int not null default 2 check (min_players >= 2),  -- humans needed to start the clock
  countdown_secs int not null default 45 check (countdown_secs between 5 and 600),
  mode           text not null default 'classic' check (mode in ('classic','lightning')),
  house_seat     boolean not null default false,       -- HOUSE buys a labelled seat each round
  is_private     boolean not null default false,       -- crew tables: link-only, never in lobby
  created_by     uuid references users(id) on delete set null,
  active         boolean not null default true,
  sort           int not null default 0,
  created_at     timestamptz not null default now(),
  check (min_players <= max_seats)
);

create table if not exists pool_rounds (
  id                uuid primary key default gen_random_uuid(),
  table_id          uuid not null references pool_tables(id) on delete cascade,
  seq               int  not null,
  status            text not null default 'open'
                    check (status in ('open','countdown','settled','cancelled')),
  -- snapshot of the ticket when the round opened; admin edits never change a live round
  stake_cents       bigint not null,
  max_seats         int    not null,
  min_players       int    not null,
  countdown_secs    int    not null,
  fee_bps           int    not null check (fee_bps between 0 and 5000),
  house_seat        boolean not null,
  -- commit-reveal: hash is public from the start, seed is revealed at settle
  server_seed       text not null,
  server_seed_hash  text not null,
  client_seed       text,
  draw_hash         text,
  winner_index      int,
  winner_seat_id    uuid,
  pot_cents         bigint not null default 0,
  fee_cents         bigint not null default 0,
  payout_cents      bigint not null default 0,
  countdown_ends_at timestamptz,
  created_at        timestamptz not null default now(),
  settled_at        timestamptz,
  unique (table_id, seq)
);
-- at most one live round per table
create unique index if not exists pool_rounds_one_live
  on pool_rounds (table_id) where status in ('open','countdown');
create index if not exists pool_rounds_due
  on pool_rounds (countdown_ends_at) where status = 'countdown';
create index if not exists pool_rounds_recent on pool_rounds (settled_at desc) where status = 'settled';

create table if not exists pool_seats (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references pool_rounds(id) on delete cascade,
  seat_index  int  not null,
  user_id     uuid references users(id) on delete set null,
  is_house    boolean not null default false,
  client_seed text not null,
  stake_cents bigint not null,
  joined_at   timestamptz not null default now(),
  unique (round_id, seat_index),
  check (is_house or user_id is not null)
);
create unique index if not exists pool_seats_one_per_user on pool_seats (round_id, user_id) where user_id is not null;
create unique index if not exists pool_seats_one_house   on pool_seats (round_id) where is_house;

-- The HOUSE seat is not a user, so its money lives here, in cents.
-- kind: buyin (-stake) | payout (+winnings) | refund (+stake on cancel)
create table if not exists pool_house_ledger (
  id          bigserial primary key,
  round_id    uuid references pool_rounds(id) on delete set null,
  delta_cents bigint not null,
  kind        text not null,
  created_at  timestamptz not null default now()
);

-- Responsible-play controls (self-set; lowering is instant, raising waits 24h)
alter table users add column if not exists pool_cooloff_until     timestamptz;
alter table users add column if not exists pool_daily_limit_cents bigint;
alter table users add column if not exists pool_limit_changed_at  timestamptz;

insert into site_settings (key, value) values
  ('pool_enabled',          'false'),
  ('pool_paused',           'false'),
  ('pool_fee_bps',          '1000'),
  ('pool_house_seats',      'true'),
  ('pool_max_stake_cents',  '10000'),
  ('pool_crew_tables',      'true')
on conflict (key) do nothing;

insert into pool_tables (code, name, stake_cents, max_seats, min_players, countdown_secs, mode, house_seat, sort) values
  ('ZAP4',  'Lightning',   500,  4, 2, 20, 'lightning', false, 0),
  ('NEON7', 'Neon Table', 1000, 10, 2, 45, 'classic',   true,  1),
  ('VELVT', 'Velvet',     2500,  6, 2, 45, 'classic',   false, 2),
  ('APEX5', 'Apex',       5000,  8, 2, 60, 'classic',   true,  3)
on conflict (code) do nothing;

-- ── reverse ────────────────────────────────────────────────────────────────
-- Refund any live seats first (Admin → Pool → cancel live rounds), then:
--   drop table pool_house_ledger, pool_seats, pool_rounds, pool_tables;
--   alter table users drop column pool_cooloff_until,
--     drop column pool_daily_limit_cents, drop column pool_limit_changed_at;
--   delete from site_settings where key like 'pool_%';
