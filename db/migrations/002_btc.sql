alter table house_state add column if not exists balance_sats bigint not null default 0;
alter table house_state drop column if exists balance_cents;
alter table house_ledger add column if not exists delta_sats bigint not null default 0;

alter table withdrawals add column if not exists amount_sats bigint not null default 0;
alter table withdrawals add column if not exists fee_sats bigint not null default 0;

drop table if exists seen_deposits;
create table seen_deposits (
  tx_key  text primary key,          -- "<txid>:<deposit address>"
  user_id uuid not null references users(id) on delete cascade,
  sats    bigint not null,
  credited_cents bigint not null,
  price_usd numeric not null,
  created_at timestamptz not null default now()
);

create table deposit_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  txid text not null,
  sats bigint not null default 0,
  method text not null default 'btc',   -- btc | cashapp | paypal
  note text not null default '',
  status text not null default 'pending', -- pending | approved | rejected
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create unique index on deposit_claims (txid) where method = 'btc';