-- First-deposit bonus and referrals (lib/promos.js).
alter table users add column if not exists bonus_locked_cents bigint not null default 0;
alter table users add column if not exists wager_left_cents bigint not null default 0;
alter table users add column if not exists ref_code text;
alter table users add column if not exists referred_by uuid references users(id) on delete set null;
alter table users add column if not exists ref_active_at timestamptz;
create unique index if not exists users_ref_code on users (ref_code) where ref_code is not null;
create index if not exists users_referred_by on users (referred_by) where referred_by is not null;

create table if not exists referral_rewards (
  id           bigserial primary key,
  user_id      uuid not null references users(id) on delete cascade,
  milestone    integer not null,          -- 1 = first 10 active referrals, 2 = 20, …
  active_count integer not null,
  amount_cents integer not null,
  created_at   timestamptz not null default now(),
  unique (user_id, milestone)
);

insert into site_settings (key, value) values
  ('promo_first_enabled', 'true'), ('promo_first_match_pct', '100'), ('promo_first_cap_cents', '5000'), ('promo_wager_x', '5'),
  ('ref_enabled', 'true'), ('ref_every', '10'), ('ref_reward_cents', '1000'), ('ref_min_deposit_cents', '1000')
on conflict (key) do nothing;
