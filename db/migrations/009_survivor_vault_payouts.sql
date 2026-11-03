-- Survivor (replaces Pool Pot's winner-takes-most), the Vault (cosmetics) and
-- automatic payouts. Applied automatically when the server starts.

-- ── Survivor ───────────────────────────────────────────────────────────────
-- Every live Pool Pot round was played under the old rules: refund all seats first.
with live as (select id from pool_rounds where status in ('open','countdown')),
     owed as (select user_id, round_id, stake_cents from pool_seats where round_id in (select id from live) and user_id is not null)
insert into ledger (user_id, delta_cents, kind, ref, meta)
select user_id, stake_cents, 'pool_refund', round_id::text, '{"reason":"Survivor upgrade"}' from owed;
update users u set balance_cents = u.balance_cents + x.s
  from (select user_id, sum(stake_cents) s from pool_seats
         where round_id in (select id from pool_rounds where status in ('open','countdown')) and user_id is not null group by user_id) x
 where u.id = x.user_id;
insert into pool_house_ledger (round_id, delta_cents, kind)
select s.round_id, s.stake_cents, 'refund' from pool_seats s join pool_rounds r on r.id = s.round_id
 join pool_tables t on t.id = r.table_id where r.status in ('open','countdown') and s.is_house and not t.is_sandbox;
update pool_rounds set status = 'cancelled', settled_at = now() where status in ('open','countdown');

alter table pool_tables drop constraint if exists pool_tables_mode_check;
alter table pool_tables add constraint pool_tables_mode_check check (mode in ('duel','classic','squad','blitz','lightning','crew'));
alter table pool_tables add column if not exists losers int not null default 1 check (losers >= 1);
alter table pool_tables add column if not exists house_fill boolean not null default true;
alter table pool_rounds add column if not exists losers_n int not null default 1;
alter table pool_rounds add column if not exists loser_indexes int[];
alter table pool_rounds add column if not exists share_cents bigint not null default 0;
alter table pool_rounds add column if not exists last_join_at timestamptz;
alter table pool_rounds add column if not exists loser_names text[];
alter table pool_rounds add column if not exists loser_seat_ids uuid[];
alter table pool_seats add column if not exists label text;          -- 'Kohler' for house seats
drop index if exists pool_seats_one_house;                           -- tables may carry up to 2 house seats now

-- old tables retire; existing crew tables keep going under Survivor rules
update pool_tables set active = false where code in ('ZAP4','NEON7','VELVT','APEX5');
update pool_tables set mode = 'crew', min_players = max_seats, losers = case when max_seats >= 10 then 2 else 1 end, house_seat = false
 where is_private;

insert into pool_tables (code, name, stake_cents, max_seats, min_players, countdown_secs, mode, losers, house_seat, house_fill, sort) values
  ('DUEL5',  'Duel',      500,   2,  2, 30, 'duel',    1, false, false, 0),
  ('DUEL25', 'Duel',     2500,   2,  2, 30, 'duel',    1, false, false, 1),
  ('DUEL100','Duel',    10000,   2,  2, 30, 'duel',    1, false, false, 2),
  ('CLS1',   'Classic',   100,   3,  3, 30, 'classic', 1, false, false, 3),
  ('CLS5',   'Classic',   500,   3,  3, 30, 'classic', 1, false, false, 4),
  ('CLS20',  'Classic',  2000,   3,  3, 30, 'classic', 1, false, false, 5),
  ('SQD10',  'Squad',    1000,   5,  5, 30, 'squad',   1, false, true,  6),
  ('SQD50',  'Squad',    5000,   5,  5, 30, 'squad',   1, false, true,  7),
  ('BLZ1',   'Blitz',     100,  10, 10, 30, 'blitz',   2, false, true,  8),
  ('BLZ5',   'Blitz',     500,  10, 10, 30, 'blitz',   2, false, true,  9)
on conflict (code) do nothing;

insert into site_settings (key, value) values
  ('survivor_house_fill', 'true'),          -- Kohler seats top up slow tables
  ('survivor_house_after_secs', '30'),      -- …after this long without a new player
  ('survivor_house_max', '2'),              -- at most this many Kohler seats per table
  ('survivor_house_min_table', '5'),        -- only on tables this big or bigger
  ('payouts_auto', 'false'),                -- automatic BTC payouts start OFF
  ('payouts_max_cents', '20000'),           -- auto-pay only withdrawals up to $200
  ('payouts_daily_cents', '100000'),        -- and at most $1,000 per 24h in total
  ('payouts_min_age_hours', '24'),          -- account must be this old
  ('payouts_require_deposit', 'true')       -- and must have made a real deposit
on conflict (key) do nothing;

-- ── Vault (cosmetics) ──────────────────────────────────────────────────────
create table if not exists user_items (
  user_id     uuid not null references users(id) on delete cascade,
  item_id     text not null,
  price_cents bigint not null default 0,
  is_test     boolean not null default false,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table users add column if not exists equip jsonb not null default '{}';
alter table users add column if not exists pass_until timestamptz;

-- ── payouts ────────────────────────────────────────────────────────────────
alter table withdrawals add column if not exists auto boolean not null default false;
alter table withdrawals add column if not exists note text;
