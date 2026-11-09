-- Legendary avatars: named characters with a personality, painted in the hyperrealistic
-- surreal style, who also star in games (lib/legends.js). Some epics unlock by playing Survivor.
alter table avatars drop constraint if exists avatars_collection_check;
alter table avatars add constraint avatars_collection_check check (collection in ('starter', 'custom', 'legendary'));

create table if not exists legends (
  id            text primary key,                 -- slug, e.g. emperor-bananas
  name          text not null,
  title         text not null default '',
  rarity        text not null default 'common' check (rarity in ('free', 'common', 'rare', 'epic')),
  emoji         text not null default '⭐',         -- stand-in until the portrait is painted
  category      text, archetype text,
  subject       text not null,                    -- what the painter is asked to photograph
  personality   text, accessory text, background text, extra text,
  bio           text not null default '',
  lines         jsonb not null default '{}',      -- { win: [], big: [], lose: [], idle: [] }
  price_cents   integer not null default 0 check (price_cents >= 0),
  unlock_rounds integer check (unlock_rounds is null or unlock_rounds > 0),   -- Survivor rounds that unlock it
  buyable       boolean not null default true,    -- false = unlock only
  status        text not null default 'live' check (status in ('live', 'hidden')),
  avatar_id     uuid references avatars(id) on delete set null,   -- the approved portrait
  pending_id    uuid references avatars(id) on delete set null,   -- a new portrait waiting for approval
  sort          integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- who unlocked what by playing (for the "unlocked!" message and the books)
create table if not exists legend_unlocks (
  user_id    uuid not null references users(id) on delete cascade,
  legend_id  text not null references legends(id) on delete cascade,
  how        text not null default 'survivor',
  seen       boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, legend_id)
);

-- Survivor rounds played (settled seats), counted as they happen; backfilled from history
alter table users add column if not exists survivor_rounds integer not null default 0;
update users u set survivor_rounds = x.n from (
  select s.user_id, count(*)::int n from pool_seats s join pool_rounds r on r.id = s.round_id
   where r.status = 'settled' and s.user_id is not null group by s.user_id) x
 where x.user_id = u.id and u.survivor_rounds = 0;

insert into site_settings (key, value) values ('legends_unlocks_enabled', 'true') on conflict (key) do nothing;
