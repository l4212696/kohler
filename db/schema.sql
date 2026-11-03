create extension if not exists pgcrypto;

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  username      citext unique,
  password_hash text,
  is_admin      boolean not null default false,
  admin_role    text not null default 'catalog',
  banned        boolean not null default false,
  balance_cents bigint  not null default 0,
  xp            int     not null default 0,
  streak        int     not null default 0,
  last_bet_at   timestamptz,
  last_bonus_at timestamptz,
  created_at    timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table magic_links (
  token_hash text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);

create table deposit_addresses (
  address text primary key,
  user_id uuid not null references users(id) on delete cascade,
  idx     int  not null unique,
  created_at timestamptz not null default now()
);

create table ledger (
  id         bigserial primary key,
  user_id    uuid not null references users(id) on delete cascade,
  delta_cents bigint not null,
  kind       text not null,           -- deposit|withdraw|order|bet|payout|bonus|adjust
  ref        text,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on ledger (user_id, created_at desc);

create table withdrawals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  amount_cents bigint not null,
  address    text not null,
  status     text not null default 'pending',  -- pending|sent|rejected
  tx_hash    text,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create table product_groups (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  description text not null default '',
  logo_url    text,
  country     text not null default 'WW',   -- ISO-2 or 'WW' for worldwide
  category    text not null default 'Other',
  tags        text[] not null default '{}',
  wallet_address text,
  wallet_pk_enc  text,
  sort        int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table products (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references product_groups(id) on delete cascade,
  name       text not null,
  price_cents bigint not null check (price_cents >= 0),
  stock      int,
  delivery   text not null default '',   -- text delivered on purchase
  sort       int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index on products (group_id, price_cents);

create table orders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  group_id   uuid references product_groups(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  price_cents bigint not null,
  status     text not null default 'paid',   -- paid|delivered|refunded
  delivery   text not null default '',
  created_at timestamptz not null default now()
);

create table support_tickets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete set null,
  name       text not null,
  contact    text not null,
  subject    text not null,
  body       text not null,
  status     text not null default 'open',   -- open|closed
  created_at timestamptz not null default now()
);

create table support_messages (
  id        bigserial primary key,
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  from_admin boolean not null default false,
  body      text not null,
  created_at timestamptz not null default now()
);

create table game_rounds (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references users(id) on delete cascade,
  game      text not null,
  stake_cents bigint not null,
  multiplier numeric(10,2) not null default 2,
  win_chance numeric(6,4) not null,
  outcome   numeric(10,2),           -- crash point or null
  win       boolean,
  payout_cents bigint not null default 0,
  pick      text,
  started_at timestamptz not null default now(),
  settled_at timestamptz
);
create index on game_rounds (user_id, started_at desc);

create table house_state (
  id smallint primary key default 1,
  wallet_address text,
  balance_cents bigint not null default 0,
  tau numeric not null default 6.0,
  edge numeric not null default 0.985,
  max_chance numeric not null default 0.4925,
  min_chance numeric not null default 0.02,
  max_multiplier numeric not null default 100,
  max_stake_pct numeric not null default 0.25,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint house_singleton check (id = 1)
);
insert into house_state (id) values (1) on conflict do nothing;

create table house_ledger (
  id bigserial primary key,
  delta_cents bigint not null,
  kind text not null,
  ref text,
  created_at timestamptz not null default now()
);

create table seen_deposits (
  tx_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  amount_wei numeric not null,
  credited_cents bigint not null,
  created_at timestamptz not null default now()
);

create table settings (
  key text primary key,
  value text not null
);

create table admin_audit (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);