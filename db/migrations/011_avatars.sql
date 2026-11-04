-- Kohler Avatar Factory: AI-painted avatars. Starter avatars are generated on the free
-- Cloudflare allowance; custom avatars are bought by players and generated on their own budget.

create table if not exists avatars (
  id          uuid primary key default gen_random_uuid(),
  collection  text not null default 'starter' check (collection in ('starter', 'custom')),
  owner_id    uuid references users(id) on delete cascade,          -- custom avatars only
  order_id    uuid,
  name        text not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  tier        text not null default 'free' check (tier in ('free', 'common', 'rare', 'epic', 'legendary', 'custom')),
  price_cents integer not null default 0 check (price_cents >= 0),
  category    text, subject text, personality text, accessory text, background text, extra text,
  prompt      text not null,
  seed        bigint,
  provider    text, model text,
  sha256      text, phash text,
  width       integer, height integer, bytes integer,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists avatars_status on avatars (collection, status, sort, created_at);
create index if not exists avatars_owner on avatars (owner_id) where owner_id is not null;
create unique index if not exists avatars_sha on avatars (sha256) where sha256 is not null;

create table if not exists avatar_files (
  avatar_id uuid not null references avatars(id) on delete cascade,
  size      text not null check (size in ('orig', '512', '128')),
  mime      text not null,
  data      bytea not null,
  primary key (avatar_id, size)
);

create table if not exists avatar_orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  price_cents integer not null,
  images      integer not null,
  spec        jsonb not null,
  status      text not null default 'generating' check (status in ('generating', 'ready', 'refunded')),
  refunded_cents integer not null default 0,
  is_test     boolean not null default false,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists avatar_orders_user on avatar_orders (user_id, created_at desc);

create table if not exists avatar_jobs (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('catalogue', 'custom')),
  order_id   uuid references avatar_orders(id) on delete cascade,
  user_id    uuid references users(id) on delete cascade,
  spec       jsonb not null,
  status     text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts   integer not null default 0,
  last_error text,
  next_at    timestamptz not null default now(),
  avatar_id  uuid references avatars(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists avatar_jobs_queue on avatar_jobs (status, next_at);

-- images generated per day, per provider and per kind, so the free allowance is never overrun
create table if not exists avatar_usage (
  day      date not null,
  provider text not null,
  kind     text not null,
  images   integer not null default 0,
  neurons  integer not null default 0,
  primary key (day, provider, kind)
);

-- a job left "running" by a crash goes back to the queue on the next start
update avatar_jobs set status = 'queued' where status = 'running';

insert into site_settings (key, value) values
  ('avatars_target', '100'),
  ('avatars_daily_images', '150'),
  ('avatars_auto_approve', 'false'),
  ('avatars_paused', 'false'),
  ('avatars_custom_enabled', 'true'),
  ('avatars_custom_price_cents', '499'),
  ('avatars_custom_images', '4')
on conflict (key) do nothing;
