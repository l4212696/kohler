alter table product_groups
  add column if not exists is_gambling boolean not null default false;

create table if not exists site_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into site_settings (key, value)
values ('gambling_enabled', 'false')
on conflict (key) do nothing;
