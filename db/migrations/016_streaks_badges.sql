-- Daily play streaks, XP from every bet, and achievement badges (lib/achievements.js).
alter table users add column if not exists last_play_day date;
alter table users add column if not exists best_streak integer not null default 0;
alter table users add column if not exists xp_bank_cents integer not null default 0;
alter table users add column if not exists badges text[] not null default '{}';

create table if not exists user_badges (
  user_id   uuid not null references users(id) on delete cascade,
  badge_id  text not null,
  earned_at timestamptz not null default now(),
  seen      boolean not null default false,
  primary key (user_id, badge_id)
);
