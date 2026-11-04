-- Promos you can add, edit and switch off from Kohler Control (lib/promos.js).
-- Replaces the fixed first-deposit / referral settings with a list of promos.
create table if not exists promos (
  id           bigserial primary key,
  kind         text not null check (kind in ('deposit_match', 'referral', 'referral_milestone')),
  name         text not null,
  enabled      boolean not null default true,
  config       jsonb not null default '{}',
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,
  budget_cents bigint,                       -- null = no limit on what this promo can pay out
  spent_cents  bigint not null default 0,
  uses         integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- one row per payment; `key` makes every payment happen at most once
create table if not exists promo_grants (
  id           bigserial primary key,
  promo_id     bigint references promos(id) on delete set null,
  key          text not null unique,
  user_id      uuid not null references users(id) on delete cascade,
  role         text not null,               -- player | referrer | friend
  subject_id   uuid,                        -- the friend, for referral payments
  amount_cents bigint not null,
  created_at   timestamptz not null default now()
);
create index if not exists promo_grants_user on promo_grants (user_id);
create index if not exists promo_grants_promo on promo_grants (promo_id, role);

-- optional: hold referrals made from the referrer's own network (off by default; a switch in Promos)
alter table users add column if not exists signup_ip_hash text;
alter table users add column if not exists ref_flag text;

-- carry the old settings over as the first three promos (only on a fresh promos table).
-- The doubled first deposit starts off: the refer-a-friend bonus replaces it.
insert into promos (kind, name, enabled, config)
select 'deposit_match', 'First deposit match', false,   -- replaced by the invite bonus; switch it back on in Promos if you want it
       jsonb_build_object('firstOnly', true, 'pct', s.pct::int, 'cap', s.cap::int, 'minDeposit', 0, 'wagerX', s.wx::int)
  from (select coalesce((select value from site_settings where key = 'promo_first_enabled'), 'true') fe,
               coalesce((select value from site_settings where key = 'promo_first_match_pct'), '100') pct,
               coalesce((select value from site_settings where key = 'promo_first_cap_cents'), '5000') cap,
               coalesce((select value from site_settings where key = 'promo_wager_x'), '5') wx) s
 where not exists (select 1 from promos)
union all
select 'referral', 'Refer a friend', true,
       jsonb_build_object('minDeposit', 2000, 'referrerReward', 1000, 'friendReward', 500, 'friendWager', 10000, 'wagerX', 5, 'maxPerReferrer', 0)
 where not exists (select 1 from promos)
union all
select 'referral_milestone', 'Every 10 friends', false,
       jsonb_build_object('every', coalesce((select value from site_settings where key = 'ref_every'), '10')::int,
                          'reward', coalesce((select value from site_settings where key = 'ref_reward_cents'), '1000')::int, 'wagerX', 5)
 where not exists (select 1 from promos);

-- a friend counts as "active" once they've deposited $20 (was $10), unless you'd already changed it
update site_settings set value = '2000' where key = 'ref_min_deposit_cents' and value = '1000';
insert into site_settings (key, value) values ('ref_same_network_block', 'false') on conflict (key) do nothing;
