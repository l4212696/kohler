-- Casino host platform: third-party game providers talk to Kohler through the
-- seamless wallet API (/api/casino/v1/...). Money stays in the existing ledger.

-- One row per game provider / aggregator. secret_enc is the shared HMAC key,
-- sealed with KEY_ENC (AES-256-GCM), never stored in plain text.
create table if not exists casino_providers (
  id          text primary key,                 -- e.g. 'kohler-studio', 'softswiss'
  name        text not null,
  secret_enc  text not null,
  launch_url  text,                             -- aggregator game-launch endpoint (external providers)
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);

create table if not exists casino_games (
  id            text primary key,               -- provider's game id
  provider_id   text not null references casino_providers(id),
  name          text not null,
  category      text not null check (category in ('slots','live','table','originals')),
  engine        text not null,                  -- slot | roulette | blackjack | dice | plinko | wheel | external
  theme         jsonb not null default '{}',
  rtp           numeric(5,2),                   -- disclosed return to player, %
  volatility    text,
  min_bet_cents bigint not null default 10,
  max_bet_cents bigint not null default 10000,
  tags          text[] not null default '{}',
  active        boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);

-- A game session is created when a player opens a game. The token goes to the
-- provider in the launch URL; we only store its hash.
create table if not exists casino_sessions (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  game_id     text not null references casino_games(id),
  provider_id text not null references casino_providers(id),
  currency    text not null default 'USD',
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists casino_sessions_user on casino_sessions (user_id, created_at desc);

-- Every wallet call, exactly once. (provider_id, transaction_id) is the
-- idempotency key: a retried call returns the original result instead of
-- moving money twice.
create table if not exists casino_transactions (
  id                 bigserial primary key,
  provider_id        text not null references casino_providers(id),
  transaction_id     text not null,
  kind               text not null check (kind in ('bet','win','rollback')),
  user_id            uuid not null references users(id) on delete cascade,
  game_id            text not null,
  round_id           text not null,
  amount_cents       bigint not null check (amount_cents >= 0),
  balance_after      bigint not null,
  ref_transaction_id text,                       -- rollback: the bet it cancels
  request_hash       text not null,              -- detects a reused id with different content
  status             text not null default 'ok' check (status in ('ok','rolled_back','tombstone')),
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (provider_id, transaction_id)
);
create index if not exists casino_tx_round on casino_transactions (provider_id, round_id);
create index if not exists casino_tx_user on casino_transactions (user_id, created_at desc);
create index if not exists casino_tx_ref on casino_transactions (provider_id, ref_transaction_id) where ref_transaction_id is not null;

-- Provider-side state for multi-step games (blackjack). In a real deployment
-- this lives on the provider's servers; Kohler Studio keeps it here.
create table if not exists studio_rounds (
  id         text primary key,
  user_id    uuid,
  game_id    text not null,
  state      jsonb not null,
  status     text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
