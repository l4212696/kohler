alter table users
  add column if not exists admin_role text not null default 'catalog';

update users
set admin_role = 'catalog'
where is_admin = true and (admin_role is null or admin_role = 'god');

alter table withdrawals
  add column if not exists platform_fee_cents bigint not null default 0;

alter table orders
  add column if not exists platform_fee_cents bigint not null default 0;

create table if not exists platform_fees (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  kind text not null,
  ref text,
  amount_cents bigint not null,
  amount_sats bigint not null default 0,
  created_at timestamptz not null default now()
);
