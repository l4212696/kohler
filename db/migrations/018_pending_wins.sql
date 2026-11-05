-- Game wins the wallet couldn't take at once. Retried until they land (lib/casino/studio.js),
-- so a win is never lost when a serverless function stops between requests.
create table if not exists studio_pending_wins (
  transaction_id text primary key,
  user_id        uuid references users(id) on delete cascade,
  body           jsonb not null,
  tries          integer not null default 0,
  status         text not null default 'pending' check (status in ('pending', 'failed')),
  last_error     text,
  next_at        timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists studio_pending_wins_due on studio_pending_wins (status, next_at);
create index if not exists studio_pending_wins_user on studio_pending_wins (user_id) where status = 'pending';
